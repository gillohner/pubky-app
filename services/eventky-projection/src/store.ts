import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parseEventkyContent, postUriSchema } from '@eventky/contract';
import type { HydratedSource, ProjectionMetadata, SourceInvalidation, SourcePost, StoredSource } from './types';
import { MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_SOURCES, type ProjectionSnapshot } from './work.types';

export const sourceHash = (source: SourcePost): string =>
  createHash('sha256').update(`${source.kind}\0${source.content}`).digest('hex');

/** Derived data only. Source records remain normal Pubky posts on their authors' homeservers. */
export class ProjectionStore {
  private readonly db: DatabaseSync;
  constructor(path: string, backendId: string, scope: ProjectionMetadata['scope'] = 'configured-nexus') {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS sources (uri TEXT PRIMARY KEY, kind TEXT NOT NULL, content TEXT NOT NULL,
        hash TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL, content_bytes INTEGER NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS source_kind ON sources(kind);
      CREATE TABLE IF NOT EXISTS inventory_stage (uri TEXT PRIMARY KEY, kind TEXT NOT NULL, content TEXT NOT NULL, content_bytes INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS jobs (uri TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, payload TEXT) STRICT;
      CREATE TABLE IF NOT EXISTS occurrence_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT;
    `);
    const version = this.getMeta<number>('schema_version');
    if (version !== null && version !== 1 && version !== 2) {
      this.db.close();
      throw new Error('Unsupported projection schema version.');
    }
    const previous = this.getMeta<ProjectionMetadata>('state');
    if (previous && previous.backend_id !== backendId) {
      this.db.close();
      throw new Error('Projection database belongs to a different Nexus. Use a separate database.');
    }
    if (
      !this.db
        .prepare('PRAGMA table_info(sources)')
        .all()
        .some((column) => column.name === 'content_bytes')
    ) {
      // One-time derived-store migration; request-time budgets use a covering index without reading bodies.
      this.transaction(() => {
        this.db.exec('ALTER TABLE sources ADD COLUMN content_bytes INTEGER NOT NULL DEFAULT 0');
        this.db.exec('UPDATE sources SET content_bytes=length(CAST(content AS BLOB))');
      });
    }
    // A previous process may have stopped during enumeration. Staging is never authoritative.
    this.db.exec('DELETE FROM inventory_stage');
    if (
      !this.db
        .prepare('PRAGMA table_info(inventory_stage)')
        .all()
        .some((column) => column.name === 'content_bytes')
    )
      this.db.exec('ALTER TABLE inventory_stage ADD COLUMN content_bytes INTEGER NOT NULL DEFAULT 0');
    this.db.exec('CREATE INDEX IF NOT EXISTS stage_budget ON inventory_stage(content_bytes)');
    this.db.exec('CREATE INDEX IF NOT EXISTS source_budget ON sources(state,content_bytes)');
    this.setMeta('schema_version', 2);
    if (!previous)
      this.setMeta('state', {
        backend_id: backendId,
        revision: 0,
        scope,
        reconciled_at: null,
        checked_at: null,
        checkpoint: null,
        source_ready: false,
      } satisfies ProjectionMetadata);
    if (!this.getMeta('cursor_key')) this.setMeta('cursor_key', randomBytes(32).toString('hex'));
  }

  close() {
    this.db.close();
  }
  private getMeta<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key);
    return row ? (JSON.parse(String(row.value)) as T) : null;
  }
  private setMeta(key: string, value: unknown) {
    this.db
      .prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  }
  metadata(): ProjectionMetadata {
    return this.getMeta<ProjectionMetadata>('state')!;
  }
  cursorKey(): string {
    return this.getMeta<string>('cursor_key')!;
  }
  private transaction<T>(action: () => T, readOnly = false): T {
    this.db.exec(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  private bumpRevision() {
    const state = this.metadata();
    this.setMeta('state', { ...state, revision: state.revision + 1 });
    this.setMeta('revision_modified_at', new Date().toISOString());
    this.db.exec('DELETE FROM occurrence_cache');
  }
  allSources(): StoredSource[] {
    return this.db.prepare('SELECT * FROM sources ORDER BY uri').all() as unknown as StoredSource[];
  }
  sourceStats() {
    const rows = this.db
      .prepare('SELECT state,content_bytes FROM sources INDEXED BY source_budget LIMIT ?')
      .all(MAX_SNAPSHOT_SOURCES + 1);
    return {
      bytes: rows.reduce((sum, row) => sum + Number(row.content_bytes), 0),
      total: rows.length,
      invalid: rows.filter((row) => row.state === 'invalid').length,
      unavailable: rows.filter((row) => row.state === 'unavailable').length,
    };
  }
  /** A bounded, atomic current-state read. Never consults inventory staging or deleted payloads. */
  feedSnapshot(maxSources: number, maxBytes: number): ProjectionSnapshot {
    return this.transaction(() => {
      const metadata = this.metadata();
      const stats = this.sourceStats();
      const withinCount = stats.total <= Math.min(maxSources, MAX_SNAPSHOT_SOURCES);
      const bytes = stats.bytes;
      return {
        metadata,
        stats,
        pending: this.pendingCount(),
        lastModified: this.getMeta<string>('revision_modified_at') ?? metadata.reconciled_at,
        sources: withinCount && bytes <= Math.min(maxBytes, MAX_SNAPSHOT_BYTES) ? this.allSources() : null,
        cursorKey: this.cursorKey(),
      };
    }, true);
  }
  getSource(uri: string): StoredSource | null {
    return (
      (this.db.prepare('SELECT * FROM sources WHERE uri=?').get(uri) as unknown as StoredSource | undefined) ?? null
    );
  }
  private upsert(source: SourcePost, now: string) {
    if (!postUriSchema.safeParse(source.uri).success) throw new Error('Invalid source post URI.');
    if ((source.kind !== 'event' && source.kind !== 'calendar') || source.content === '[DELETED]') {
      this.db.prepare('DELETE FROM sources WHERE uri=?').run(source.uri);
      return;
    }
    const parsed = parseEventkyContent(source.kind, source.content);
    const state = parsed.status === 'supported' ? 'valid' : 'invalid';
    this.db
      .prepare(
        `INSERT INTO sources(uri,kind,content,hash,state,updated_at,content_bytes) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(uri) DO UPDATE SET kind=excluded.kind,content=excluded.content,hash=excluded.hash,state=excluded.state,updated_at=excluded.updated_at,content_bytes=excluded.content_bytes`,
      )
      .run(source.uri, source.kind, source.content, sourceHash(source), state, now, Buffer.byteLength(source.content));
  }

  /** Apply hydration and acknowledge its durable job in one transaction. */
  applyHydration(result: HydratedSource, now = new Date().toISOString()) {
    this.transaction(() => {
      const uri = result.status === 'present' ? result.post.uri : result.uri;
      const before = this.getSource(uri);
      if (result.status === 'present') this.upsert(result.post, now);
      else if (result.status === 'deleted') this.db.prepare('DELETE FROM sources WHERE uri=?').run(uri);
      else this.db.prepare("UPDATE sources SET state='unavailable',updated_at=? WHERE uri=?").run(now, uri);
      const after = this.getSource(uri);
      if (before?.hash !== after?.hash || before?.state !== after?.state) this.bumpRevision();
      if (result.status !== 'unavailable') this.db.prepare('DELETE FROM jobs WHERE uri=?').run(uri);
      else
        this.db
          .prepare('UPDATE jobs SET attempts=attempts+1,next_attempt=? WHERE uri=?')
          .run(Date.parse(now) + 5000, uri);
    });
  }

  enqueue(uris: string[], checkpoint: string, caughtUp: boolean) {
    this.enqueueChanges(
      uris.map((uri) => ({ uri })),
      checkpoint,
      caughtUp,
    );
  }
  enqueueChanges(changes: SourceInvalidation[], checkpoint: string, caughtUp: boolean) {
    this.transaction(() => {
      const insert = this.db.prepare(
        'INSERT INTO jobs(uri,payload) VALUES(?,?) ON CONFLICT(uri) DO UPDATE SET payload=excluded.payload,attempts=0,next_attempt=0',
      );
      for (const change of changes) {
        if (!postUriSchema.safeParse(change.uri).success) throw new Error('Invalid change URI.');
        if (
          change.source &&
          (change.source.status === 'present' ? change.source.post.uri : change.source.uri) !== change.uri
        )
          throw new Error('Change source identity mismatch.');
        insert.run(change.uri, change.source ? JSON.stringify(change.source) : null);
      }
      this.setMeta('state', {
        ...this.metadata(),
        checkpoint,
        source_ready: caughtUp,
        checked_at: new Date().toISOString(),
      });
    });
  }
  jobSource(uri: string): HydratedSource | null {
    const payload = this.db.prepare('SELECT payload FROM jobs WHERE uri=?').get(uri)?.payload;
    return typeof payload === 'string' ? JSON.parse(payload) : null;
  }
  pendingCount(): number {
    return Number(this.db.prepare('SELECT count(*) AS count FROM jobs').get()!.count);
  }
  dueJobs(now = Date.now(), limit = 100): string[] {
    return this.db
      .prepare('SELECT uri FROM jobs WHERE next_attempt<=? ORDER BY next_attempt,uri LIMIT ?')
      .all(now, limit)
      .map((row) => String(row.uri));
  }
  setReady(ready: boolean) {
    this.setMeta('state', { ...this.metadata(), source_ready: ready, checked_at: new Date().toISOString() });
  }

  beginInventory() {
    this.db.exec('DELETE FROM inventory_stage');
    this.setReady(false);
  }
  private checkStagingBudget() {
    const rows = this.db
      .prepare('SELECT content_bytes FROM inventory_stage INDEXED BY stage_budget LIMIT ?')
      .all(MAX_SNAPSHOT_SOURCES + 1);
    if (
      rows.length > MAX_SNAPSHOT_SOURCES ||
      rows.reduce((sum, row) => sum + Number(row.content_bytes), 0) > MAX_SNAPSHOT_BYTES
    )
      throw new Error('Inventory exceeds the bounded source count or byte budget.');
  }
  stageInventory(posts: SourcePost[]) {
    this.transaction(() => {
      const insert = this.db.prepare(
        'INSERT INTO inventory_stage(uri,kind,content,content_bytes) VALUES(?,?,?,?) ON CONFLICT(uri) DO UPDATE SET kind=excluded.kind,content=excluded.content,content_bytes=excluded.content_bytes',
      );
      for (const post of posts) {
        if (!postUriSchema.safeParse(post.uri).success) throw new Error('Inventory contains an invalid post URI.');
        if (post.kind === 'event' || post.kind === 'calendar')
          insert.run(post.uri, post.kind, post.content, Buffer.byteLength(post.content));
      }
      this.checkStagingBudget();
    });
  }
  stageChange(change: SourceInvalidation) {
    if (!change.source || change.source.status === 'unavailable')
      throw new Error('Inventory replay requires a definitive source payload.');
    const uri = change.source.status === 'present' ? change.source.post.uri : change.source.uri;
    if (uri !== change.uri || !postUriSchema.safeParse(uri).success)
      throw new Error('Inventory replay identity mismatch.');
    if (change.source.status === 'present' && ['event', 'calendar'].includes(change.source.post.kind))
      this.stageInventory([change.source.post]);
    else this.db.prepare('DELETE FROM inventory_stage WHERE uri=?').run(uri);
  }
  /** Call only after every page in one complete source snapshot was validated. */
  finishInventory(checkpoint: string, now = new Date().toISOString()) {
    this.transaction(() => {
      this.checkStagingBudget();
      const staged = this.db.prepare('SELECT * FROM inventory_stage ORDER BY uri').all() as unknown as SourcePost[];
      this.db.exec('DELETE FROM sources');
      for (const source of staged) this.upsert(source, now);
      this.db.exec('DELETE FROM inventory_stage; DELETE FROM jobs');
      this.setMeta('state', { ...this.metadata(), checkpoint, reconciled_at: now, source_ready: false });
      this.bumpRevision();
    });
  }
  cacheGet(key: string): string | null {
    return (
      (this.db.prepare('SELECT value FROM occurrence_cache WHERE key=?').get(key)?.value as string | undefined) ?? null
    );
  }
  cachePut(key: string, value: string) {
    this.db
      .prepare('INSERT OR REPLACE INTO occurrence_cache(key,value,created_at) VALUES(?,?,?)')
      .run(key, value, Date.now());
    this.db.exec(
      'DELETE FROM occurrence_cache WHERE key NOT IN (SELECT key FROM occurrence_cache ORDER BY created_at DESC LIMIT 128)',
    );
  }
}
