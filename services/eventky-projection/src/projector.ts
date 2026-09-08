import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getPostAuthor, isCalendarMember, parseEventkyContent, postUriSchema } from '@eventky/contract';
import { CALENDAR_ENGINE_VERSION, expandOccurrences } from '@eventky/recurrence';
import type { CalendarContent } from '@eventky/types';
import type {
  OccurrencePage,
  OccurrenceQuery,
  ProjectedOccurrence,
  ProjectionCoverage,
  ProjectionResult,
  ProjectionStatus,
} from '@eventky-api/types';
import { Temporal } from '@js-temporal/polyfill';
import { buildCalendarFeed, type CalendarFeedRequest } from './feed';
import type { ProjectionStore } from './store';
import type { ProjectionSnapshot } from './work.types';
import { MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_SOURCES } from './work.types';

const ENGINE_VERSION = CALENDAR_ENGINE_VERSION;
const MAX_SERIES = 5000;
const MAX_OCCURRENCES = 20000;
const MAX_ITERATIONS = 100000;

function normalizeQuery(query: OccurrenceQuery): Omit<Required<OccurrenceQuery>, 'cursor'> | null {
  try {
    const from = Temporal.Instant.from(query.from);
    const to = Temporal.Instant.from(query.to);
    if (to.epochMilliseconds <= from.epochMilliseconds || to.epochMilliseconds - from.epochMilliseconds > 93 * 86400000)
      return null;
    from.toZonedDateTimeISO(query.timezone);
    const calendars = [...new Set(query.calendars ?? [])].sort();
    if (calendars.length > 32 || calendars.some((uri) => !postUriSchema.safeParse(uri).success)) return null;
    if (query.author && !/^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/.test(query.author)) return null;
    const limit = query.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return null;
    return {
      from: from.toString(),
      to: to.toString(),
      timezone: query.timezone,
      calendars,
      author: query.author ?? '',
      include_cancelled: query.include_cancelled ?? true,
      limit,
    };
  } catch {
    return null;
  }
}

export class CalendarProjector {
  constructor(
    private readonly store: Pick<
      ProjectionStore,
      'metadata' | 'sourceStats' | 'pendingCount' | 'cursorKey' | 'feedSnapshot' | 'cacheGet' | 'cachePut'
    >,
  ) {}

  snapshot(): ProjectionSnapshot {
    return this.store.feedSnapshot(MAX_SNAPSHOT_SOURCES, MAX_SNAPSHOT_BYTES);
  }

  snapshotStillCurrent(snapshot: Pick<ProjectionSnapshot, 'metadata' | 'pending'>): boolean {
    const current = this.status();
    return (
      current.projection_revision === snapshot.metadata.revision &&
      current.coverage.source_checkpoint === snapshot.metadata.checkpoint &&
      current.coverage.pending_changes === snapshot.pending &&
      current.coverage.complete
    );
  }

  status(): ProjectionStatus {
    const metadata = this.store.metadata();
    const sources = this.store.sourceStats();
    const pending = this.store.pendingCount();
    const reasons: string[] = [];
    if (sources.total > MAX_SNAPSHOT_SOURCES) reasons.push('source-count-limit');
    if (sources.bytes > MAX_SNAPSHOT_BYTES) reasons.push('source-byte-limit');
    if (!metadata.reconciled_at) reasons.push('inventory-not-complete');
    if (!metadata.source_ready) reasons.push('source-not-caught-up');
    if (!metadata.checked_at || Date.now() - Date.parse(metadata.checked_at) > 60000)
      reasons.push('source-check-stale');
    if (pending) reasons.push('changes-pending');
    if (sources.unavailable) reasons.push('source-records-unavailable');
    if (sources.invalid) reasons.push('unsupported-or-invalid-records');
    return {
      backend_id: metadata.backend_id,
      projection_revision: metadata.revision,
      engine_version: ENGINE_VERSION,
      sources: sources.total,
      invalid_sources: sources.invalid,
      unavailable_sources: sources.unavailable,
      coverage: {
        complete: reasons.length === 0,
        reasons,
        scope: metadata.scope,
        last_reconciled_at: metadata.reconciled_at,
        source_checkpoint: metadata.checkpoint,
        pending_changes: pending,
      },
    };
  }

  subscription(calendarUri: string, request: CalendarFeedRequest = {}) {
    if (!postUriSchema.safeParse(calendarUri).success)
      return { status: 400 as const, headers: { 'Cache-Control': 'no-store' }, body: 'Invalid calendar post URI.' };
    return buildCalendarFeed(this.snapshot(), calendarUri, request);
  }

  private sign(value: string) {
    return createHmac('sha256', this.store.cursorKey()).update(value).digest('base64url');
  }
  private encodeCursor(query: string, revision: number, offset: number) {
    const value = Buffer.from(JSON.stringify({ query, revision, offset })).toString('base64url');
    return `${value}.${this.sign(value)}`;
  }
  private decodeCursor(cursor: string, query: string, revision: number): number | null {
    try {
      if (cursor.length > 2048) return null;
      const [value, signature, extra] = cursor.split('.');
      const expected = this.sign(value);
      if (
        extra ||
        !signature ||
        signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      )
        return null;
      const data = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
      return data.query === query &&
        data.revision === revision &&
        Number.isSafeInteger(data.offset) &&
        data.offset >= 0 &&
        data.offset <= MAX_OCCURRENCES
        ? data.offset
        : null;
    } catch {
      return null;
    }
  }

  query(input: OccurrenceQuery): ProjectionResult<OccurrencePage> {
    const query = normalizeQuery(input);
    if (!query)
      return {
        ok: false,
        code: 'INVALID_QUERY',
        message: 'Choose a valid timezone, post references, and a range of at most 93 days.',
      };
    const status = this.status();
    const fingerprint = createHash('sha256').update(JSON.stringify(query)).digest('hex');
    const offset = input.cursor ? this.decodeCursor(input.cursor, fingerprint, status.projection_revision) : 0;
    if (offset === null)
      return {
        ok: false,
        code: 'STALE_CURSOR',
        message: 'The calendar changed or the page cursor is invalid. Reload the range.',
      };
    const cacheKey = `${ENGINE_VERSION}:${status.projection_revision}:${fingerprint}`;
    const cached = this.store.cacheGet(cacheKey);
    let expanded: { items: ProjectedOccurrence[]; reasons: string[] };
    if (cached) expanded = JSON.parse(cached);
    else {
      const sources = this.snapshot().sources;
      if (!sources)
        return { ok: false, code: 'UNAVAILABLE', message: 'The calendar inventory exceeds bounded query limits.' };
      const calendars = new Map<string, CalendarContent>();
      for (const source of sources) {
        if (source.kind !== 'calendar' || source.state !== 'valid') continue;
        const parsed = parseEventkyContent(source.kind, source.content);
        if (parsed.status === 'supported' && parsed.kind === 'calendar') calendars.set(source.uri, parsed.value);
      }
      const reasons = new Set<string>();
      for (const uri of query.calendars) if (!calendars.has(uri)) reasons.add('selected-calendar-unavailable');
      const candidates = sources.filter((source) => source.kind === 'event' && source.state === 'valid');
      if (candidates.length > MAX_SERIES) reasons.add('series-work-limit');
      const items: ProjectedOccurrence[] = [];
      let iterationsLeft = MAX_ITERATIONS;
      for (const source of candidates.slice(0, MAX_SERIES)) {
        if (query.author && getPostAuthor(source.uri) !== query.author) continue;
        const parsed = parseEventkyContent(source.kind, source.content);
        if (parsed.status !== 'supported' || parsed.kind !== 'event') continue;
        if (
          query.calendars.length &&
          !query.calendars.some((uri) => {
            const calendar = calendars.get(uri);
            return calendar && isCalendarMember(uri, calendar, source.uri, parsed.value);
          })
        )
          continue;
        if (iterationsLeft <= 0 || items.length >= MAX_OCCURRENCES) {
          reasons.add('occurrence-work-limit');
          break;
        }
        const result = expandOccurrences(parsed.value, {
          from: query.from,
          to: query.to,
          timezone: query.timezone,
          maxIterations: Math.min(iterationsLeft, 20000),
          maxOccurrences: Math.min(2000, MAX_OCCURRENCES - items.length),
        });
        iterationsLeft -= result.iterations;
        if (result.status !== 'complete') reasons.add(`expansion-${result.status}`);
        const author = getPostAuthor(source.uri)!;
        const id = source.uri.split('/').at(-1)!;
        for (const occurrence of result.occurrences) {
          const eventStatus = occurrence.event.status ?? 'CONFIRMED';
          if (!query.include_cancelled && eventStatus === 'CANCELLED') continue;
          items.push({
            post_uri: source.uri,
            post_id: `${author}:${id}`,
            recurrence_id: occurrence.recurrence_id,
            occurrence_key: occurrence.key,
            start: occurrence.start,
            end: occurrence.end,
            start_epoch_ms: occurrence.start_epoch_ms,
            end_epoch_ms: occurrence.end_epoch_ms,
            status: eventStatus,
            source_hash: source.hash,
          });
        }
      }
      items.sort(
        (a, b) =>
          a.start_epoch_ms - b.start_epoch_ms ||
          a.post_uri.localeCompare(b.post_uri) ||
          a.occurrence_key.localeCompare(b.occurrence_key),
      );
      expanded = { items, reasons: [...reasons] };
      this.store.cachePut(cacheKey, JSON.stringify(expanded));
    }
    const reasons = [...new Set([...status.coverage.reasons, ...expanded.reasons])];
    const coverage: ProjectionCoverage = { ...status.coverage, complete: reasons.length === 0, reasons };
    const nextOffset = offset + query.limit;
    return {
      ok: true,
      value: {
        items: expanded.items.slice(offset, nextOffset),
        next_cursor:
          nextOffset < expanded.items.length
            ? this.encodeCursor(fingerprint, status.projection_revision, nextOffset)
            : null,
        projection_revision: status.projection_revision,
        coverage,
      },
    };
  }
}
