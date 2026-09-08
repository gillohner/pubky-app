'use client';

import { useEffect, useRef, useState } from 'react';
import { parseEventkyContent, serializeEventkyContent } from '@eventky/contract';
import type { IcsImportReport } from '@eventky/ical';
import type { CalendarContent, EventContent } from '@eventky/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { EventkyImportController } from '@/controllers/eventkyImport/eventkyImport';
import { PostController } from '@/controllers/post/post';
import { importFingerprint, importPostUri, importRecordKey, replaceImportedEvent } from '@/libs/eventky/import';
import { getEventkyEnabled, getNexusUrl } from '@/libs/runtime-config/runtime-config';
import type { EventkyImportRecord } from '@/models/eventkyImport/eventkyImport';
import { useAuthStore } from '@/stores/auth/auth.store';
import { importCalendarIcsInWorker } from './eventkyImportPreview';
import { EVENTKY_IMPORT_DEFAULTS, type EventkyImportForm, eventkyImportSchema } from './useEventkyImport.types';

type Preview = {
  report: IcsImportReport;
  records: EventkyImportRecord[];
  author: string;
  scope: string;
  source: string;
};

/** Publication always goes through the native post controller; the ledger owns only retry intent. */
export function useEventkyImport() {
  const author = useAuthStore((state) => state.currentUserPubky);
  const backend = getNexusUrl();
  const form = useForm<EventkyImportForm>({
    resolver: zodResolver(eventkyImportSchema),
    defaultValues: EVENTKY_IMPORT_DEFAULTS,
  });
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [groupingLocked, setGroupingLocked] = useState(false);
  const [hasImportedCalendar, setHasImportedCalendar] = useState(false);
  const [hasPendingWrites, setHasPendingWrites] = useState(false);
  const flight = useRef(false);
  const fileVersion = useRef(0);
  const previewAbort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      previewAbort.current?.abort();
      fileVersion.current += 1;
    },
    [author, backend],
  );

  const selectFile = async (file?: File) => {
    const version = ++fileVersion.current;
    previewAbort.current?.abort();
    setPreview(null);
    setText(null);
    setMessage('');
    setProgress({});
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMessage('Choose an iCalendar file of at most 2 MiB.');
      return;
    }
    try {
      const content = await file.text();
      if (version === fileVersion.current) setText(content);
    } catch {
      if (version === fileVersion.current) setMessage('The file could not be read.');
    }
  };

  const scan = async (): Promise<boolean> => {
    if (!text || !author || flight.current) return false;
    flight.current = true;
    const version = fileVersion.current;
    const cancellation = new AbortController();
    previewAbort.current = cancellation;
    setBusy(true);
    setMessage('');
    setPreview(null);
    setProgress({});
    try {
      if (!(await form.trigger('source')) || cancellation.signal.aborted) return false;
      const source = form.getValues('source').trim();
      const scope = EventkyImportController.getScope(author);
      const records = await EventkyImportController.getRecords(author, scope, source);
      EventkyImportController.assertAccount(author, scope);
      if (cancellation.signal.aborted || version !== fileVersion.current) return false;
      const calendar = records.find((record) => record.kind === 'calendar');
      const report = await importCalendarIcsInWorker(
        text,
        {
          now: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
          calendarUid: calendar?.uid ?? `${crypto.randomUUID()}@eventky.pubky`,
          defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        },
        { signal: cancellation.signal },
      );
      EventkyImportController.assertAccount(author, scope);
      if (cancellation.signal.aborted || version !== fileVersion.current || source !== form.getValues('source').trim())
        return false;
      setGroupingLocked(records.length > 0);
      setHasImportedCalendar(!!calendar);
      setHasPendingWrites(records.some((record) => record.status === 'pending'));
      if (records.length) form.setValue('createCalendar', !!calendar);
      for (const entry of report.entries) {
        if (!entry.event) continue;
        entry.contentFingerprint = importFingerprint(entry.event);
        const record = records.find((record) => record.kind === 'event' && record.uid === entry.uid);
        if (record) {
          entry.existingPostUri = importPostUri(record.postId);
          entry.action =
            record.status === 'published' && record.fingerprint === entry.contentFingerprint
              ? 'unchanged'
              : 'review-update';
          if (record.status === 'pending' && record.fingerprint !== entry.contentFingerprint) {
            entry.action = 'conflict';
            entry.errors.push('A different version has an unfinished save. Reimport that version first to confirm it.');
          }
        }
      }
      form.setValue('calendarName', report.calendar?.name ?? 'Imported calendar');
      form.setValue(
        'selected',
        report.entries
          .filter((entry) => entry.event && !entry.errors.length && entry.action === 'create')
          .map((entry) => entry.uid),
      );
      form.setValue('acknowledged', []);
      form.setValue('approvedUpdates', []);
      form.setValue('publicAcknowledged', false);
      form.setValue('missingAcknowledged', false);
      setPreview({ report, records, scope, source, author });
      return true;
    } catch {
      setMessage('Import history could not be loaded. No posts were published.');
      return false;
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };

  const publishRecord = async (
    record: EventkyImportRecord,
    previousFingerprint?: string,
  ): Promise<EventkyImportRecord | null> => {
    const reservation = await EventkyImportController.reserve(author!, record, previousFingerprint);
    if (!reservation.ok) {
      setMessage('Import history changed. Preview the file again before continuing.');
      return null;
    }
    record = reservation.record;
    setGroupingLocked(true);
    EventkyImportController.assertAccount(author!, record.scope);
    if (record.status !== 'published') {
      setHasPendingWrites(true);
      const source = await PostController.fetchSource({ compositeId: record.postId });
      EventkyImportController.assertAccount(author!, record.scope);
      if (source?.kind === record.kind && source.content === record.payload) {
        await EventkyImportController.markPublished(author!, record);
        return { ...record, status: 'published' };
      }
      if (
        source &&
        (record.expectedContent === undefined ||
          source.kind !== record.kind ||
          source.content !== record.expectedContent)
      ) {
        setMessage('The reserved post has changed. Open it to resolve those changes before continuing this import.');
        return null;
      }
      if (!source && record.expectedContent !== undefined) {
        setMessage('The post being updated is missing. The import will not recreate it.');
        return null;
      }
      if (!source && record.attempted !== false && !form.getValues('missingAcknowledged')) {
        setMessage(
          'An unfinished creation has no current post. Confirm whether to publish its saved version again before retrying.',
        );
        return null;
      }
      if (record.expectedContent !== undefined) {
        const prepared = await PostController.prepareEdit({
          compositePostId: record.postId,
          content: record.payload,
          expectedContent: record.expectedContent,
        });
        EventkyImportController.assertAccount(author!, record.scope);
        await EventkyImportController.markAttempted(author!, record);
        EventkyImportController.assertAccount(author!, record.scope);
        await PostController.commitPreparedEdit(prepared);
      } else {
        const prepared = await PostController.prepareCreate({
          authorId: author!,
          postId: record.postId.split(':')[1],
          customKind: record.kind,
          content: record.payload,
        });
        EventkyImportController.assertAccount(author!, record.scope);
        await EventkyImportController.markAttempted(author!, record);
        EventkyImportController.assertAccount(author!, record.scope);
        await PostController.commitPreparedCreate(prepared);
      }
      await EventkyImportController.markPublished(author!, record);
    }
    return { ...record, status: 'published' };
  };

  const submit = async (): Promise<boolean> => {
    if (!preview || !author || flight.current || !getEventkyEnabled()) return false;
    if (
      preview.author !== author ||
      preview.scope !== EventkyImportController.getScope(author) ||
      preview.source !== form.getValues('source').trim()
    ) {
      setMessage('The account, backend or source changed. Preview the file again.');
      return false;
    }
    let complete = false;
    flight.current = true;
    setBusy(true);
    setMessage('');
    try {
      await form.handleSubmit(async (values) => {
        if (!values.publicAcknowledged) {
          setMessage('Confirm that the selected event details will become public.');
          return;
        }
        if (preview.report.errors.length) {
          setMessage('Resolve the file errors before publishing.');
          return;
        }
        const entries = preview.report.entries.filter((entry) => values.selected.includes(entry.uid));
        if (!entries.length) {
          setMessage('Select at least one event to publish.');
          return;
        }
        if (
          entries.some(
            (entry) =>
              !entry.event ||
              entry.errors.length ||
              (entry.requiresAcknowledgement.length && !values.acknowledged.includes(entry.uid)) ||
              (entry.action === 'review-update' && !values.approvedUpdates.includes(entry.uid)),
          )
        ) {
          setMessage('Review the selected events, warnings and update approvals before publishing.');
          return;
        }
        let records = await EventkyImportController.getRecords(author, preview.scope, preview.source);
        if (records.length && values.createCalendar !== records.some((record) => record.kind === 'calendar')) {
          setMessage('Keep the original grouping choice for this source, or preview under a new source name.');
          return;
        }
        let calendarUri: string | undefined;
        const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        if (values.createCalendar && preview.report.calendar) {
          const previous = records.find((record) => record.kind === 'calendar');
          if (previous) {
            const published = await publishRecord(previous);
            if (!published) return;
            const current = await PostController.fetchSource({ compositeId: published.postId });
            const parsed = current && parseEventkyContent(current.kind, current.content);
            if (!parsed || parsed.status !== 'supported' || parsed.kind !== 'calendar') {
              setMessage('The imported calendar is unavailable. Restore it or choose a new import source.');
              return;
            }
            calendarUri = importPostUri(published.postId);
          } else {
            const calendar: CalendarContent = { ...preview.report.calendar, name: values.calendarName };
            const serialized = serializeEventkyContent(calendar);
            if (!serialized.ok) {
              setMessage('The calendar details are invalid.');
              return;
            }
            const postId = `${author}:${PostController.createPostId(author)}`;
            const published = await publishRecord({
              key: importRecordKey(preview.scope, preview.source, 'calendar', 'calendar'),
              scope: preview.scope,
              source: preview.source,
              uid: calendar.uid,
              kind: 'calendar',
              postId,
              payload: serialized.value,
              fingerprint: calendar.uid,
              status: 'pending',
              attempted: false,
              updatedAt: Date.now(),
            });
            if (!published) return;
            calendarUri = importPostUri(published.postId);
            setHasImportedCalendar(true);
            records = [...records, published];
          }
        }
        for (const entry of entries) {
          if (
            useAuthStore.getState().currentUserPubky !== author ||
            EventkyImportController.getScope(author) !== preview.scope
          ) {
            setMessage('Import paused because the account or backend changed.');
            return;
          }
          const previous = records.find((record) => record.kind === 'event' && record.uid === entry.uid);
          if (previous?.status === 'published' && previous.fingerprint === entry.contentFingerprint) {
            setProgress((state) => ({ ...state, [entry.uid]: 'Already imported' }));
            continue;
          }
          setProgress((state) => ({ ...state, [entry.uid]: 'Saving…' }));
          let event: EventContent = { ...entry.event!, calendar_uris: calendarUri ? [calendarUri] : [] };
          let expectedContent: string | undefined;
          if (previous?.status === 'published') {
            if (!values.approvedUpdates.includes(entry.uid)) {
              setMessage('An event already exists. Preview again and approve its update.');
              return;
            }
            const current = await PostController.fetchSource({ compositeId: previous.postId });
            const parsed = current && parseEventkyContent(current.kind, current.content);
            if (
              !current ||
              !parsed ||
              parsed.status !== 'supported' ||
              parsed.kind !== 'event' ||
              current.content !== previous.payload
            ) {
              setMessage(
                'An imported post was edited or removed since the last import. Open that post to resolve its changes before updating.',
              );
              return;
            }
            const updated = replaceImportedEvent(parsed.value, event, now);
            if (!updated.success) {
              setMessage('An event update could not be validated.');
              return;
            }
            event = updated.data;
            expectedContent = current.content;
          }
          const serialized = serializeEventkyContent(event);
          if (!serialized.ok) {
            setMessage('An event could not be validated.');
            return;
          }
          const record: EventkyImportRecord =
            previous?.status === 'pending'
              ? previous
              : {
                  key: importRecordKey(preview.scope, preview.source, 'event', entry.uid),
                  scope: preview.scope,
                  source: preview.source,
                  uid: entry.uid,
                  kind: 'event',
                  postId: previous?.postId ?? `${author}:${PostController.createPostId(author)}`,
                  payload: serialized.value,
                  fingerprint: entry.contentFingerprint!,
                  status: 'pending',
                  expectedContent,
                  attempted: false,
                  updatedAt: Date.now(),
                };
          const published = await publishRecord(record, previous?.fingerprint);
          if (!published) return;
          records = [...records.filter((candidate) => candidate.key !== published.key), published];
          setProgress((state) => ({ ...state, [entry.uid]: 'Published' }));
        }
        setMessage('Import complete. Events are ordinary posts with comments and tags.');
        setHasPendingWrites(false);
        complete = true;
      })();
    } catch {
      setMessage(
        'Import paused. Saved progress is retained; retry or reopen this file with the same source name to confirm the same posts.',
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
    return complete;
  };
  return {
    form,
    selectFile,
    scan,
    submit,
    preview: preview?.report,
    busy,
    message,
    progress,
    hasFile: text !== null,
    groupingLocked,
    hasImportedCalendar,
    hasPendingWrites,
  };
}
