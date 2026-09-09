import { postUriSchema } from '@eventky/contract';
import { z } from 'zod';
import type { ChangeBatch, HydratedSource, InventoryPage, SourceAdapter, SourcePost } from './types';

const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const headSchema = z.object({ epoch: z.string().min(1).max(255), revision: decimal, minimum_revision: decimal });
const wireSchema = z.object({ kind: z.string().min(1).max(128), content: z.string().max(512 * 1024) });
const recordSchema = z.object({ revision: decimal, uri: postUriSchema, post: wireSchema.nullable() });
const inventorySchema = headSchema.extend({
  items: z.array(recordSchema).max(100),
  next_cursor: z.string().max(2048).nullable(),
});
const changesSchema = headSchema.extend({
  items: z.array(recordSchema).max(100),
  cursor: decimal,
  through: decimal,
  caught_up: z.boolean(),
});
const checkpointSchema = z.object({
  epoch: z.string().min(1).max(255),
  revision: decimal,
  through: decimal.optional(),
});
type Checkpoint = z.infer<typeof checkpointSchema>;

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (value: string): unknown => {
  if (value.length > 8192) throw new Error('Source cursor is too large.');
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
};

class SourceResetError extends Error {}

/** Server-only adapter for the private generic Nexus source log. The bearer token never reaches a browser. */
export class NexusProjectionSource implements SourceAdapter {
  readonly backendId: string;
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
    private readonly pause: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('Invalid Nexus source URL.');
    if (token.length < 32) throw new Error('A server-side Nexus sync token of at least 32 characters is required.');
    this.backendId = url.toString().replace(/\/$/, '');
  }

  private async get(path: string): Promise<unknown> {
    // Inventory/replay needs several consecutive requests. Preserve the current request
    // across throttling; restarting the whole pass can spend every available token on head.
    let response: Response | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      response = await this.request(`${this.backendId}/v0/projection/posts/${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (response.status !== 429) break;
      const retryAfter = response.headers.get('retry-after');
      await response.body?.cancel();
      if (attempt === 5) throw new Error('Nexus sync remained rate limited after bounded retries.');
      const seconds =
        retryAfter && /^\d+$/.test(retryAfter)
          ? Number(retryAfter)
          : retryAfter
            ? (Date.parse(retryAfter) - Date.now()) / 1000
            : 2 ** attempt;
      // A malformed header uses exponential backoff. A valid long delay is left to
      // the next sync pass instead of holding the single writer for unbounded time.
      if (Number.isFinite(seconds) && seconds > 60)
        throw new Error('Nexus sync rate-limit delay exceeds the retry budget.');
      await this.pause(Math.max(1000, (Number.isFinite(seconds) ? seconds : 2 ** attempt) * 1000));
    }
    if (!response) throw new Error('Nexus sync response is empty.');
    if (response.status === 410) {
      await response.body?.cancel();
      throw new SourceResetError('Nexus source epoch or retention changed.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Nexus sync request failed with HTTP ${response.status}.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Nexus sync response is empty.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > 32 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('Nexus sync response exceeds the byte limit.');
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  private async head() {
    return headSchema.parse(await this.get('head'));
  }
  private validAt(checkpoint: Checkpoint, head: z.infer<typeof headSchema>) {
    return (
      checkpoint.epoch === head.epoch &&
      BigInt(checkpoint.revision) >= BigInt(head.minimum_revision) &&
      BigInt(checkpoint.revision) <= BigInt(head.revision)
    );
  }

  async inventory(cursor?: string): Promise<InventoryPage> {
    const state = cursor
      ? z.object({ start: checkpointSchema, after: z.string().max(2048) }).parse(decode(cursor))
      : { start: await this.head(), after: '' };
    const params = new URLSearchParams({
      epoch: state.start.epoch,
      since: state.start.revision,
      kinds: 'event,calendar',
      limit: '50',
    });
    if (state.after) params.set('after', state.after);
    const page = inventorySchema.parse(await this.get(`inventory?${params}`));
    if (!this.validAt(state.start, page)) throw new SourceResetError('Inventory source watermark expired.');
    const posts: SourcePost[] = page.items.map((item) => {
      if (!item.post) throw new Error('Inventory returned a deletion instead of a current source post.');
      if (BigInt(item.revision) > BigInt(page.revision))
        throw new Error('Inventory source is newer than its checkpoint.');
      return { uri: item.uri, kind: item.post.kind, content: item.post.content };
    });
    return {
      posts,
      checkpoint: encode({ epoch: state.start.epoch, revision: state.start.revision }),
      next_cursor: page.next_cursor
        ? encode({ start: { epoch: state.start.epoch, revision: state.start.revision }, after: page.next_cursor })
        : null,
    };
  }

  async changes(value: string): Promise<ChangeBatch> {
    const checkpoint = checkpointSchema.parse(decode(value));
    try {
      const head = await this.head();
      if (!this.validAt(checkpoint, head)) return { checkpoint: value, changes: [], caught_up: false, reset: true };
      const through = checkpoint.through ?? head.revision;
      const params = new URLSearchParams({ epoch: checkpoint.epoch, after: checkpoint.revision, through, limit: '50' });
      const page = changesSchema.parse(await this.get(`changes?${params}`));
      if (
        page.epoch !== checkpoint.epoch ||
        page.through !== through ||
        BigInt(page.cursor) < BigInt(checkpoint.revision) ||
        BigInt(page.cursor) > BigInt(through)
      )
        throw new Error('Nexus change range is inconsistent.');
      let previous = BigInt(checkpoint.revision);
      const changes = page.items.map((item) => {
        if (BigInt(item.revision) <= previous || BigInt(item.revision) > BigInt(page.cursor))
          throw new Error('Nexus change revisions are not strictly ordered.');
        previous = BigInt(item.revision);
        const source: HydratedSource = item.post
          ? { status: 'present', post: { uri: item.uri, kind: item.post.kind, content: item.post.content } }
          : { status: 'deleted', uri: item.uri };
        return { uri: item.uri, source };
      });
      if (!page.caught_up && (!page.items.length || page.items.at(-1)!.revision !== page.cursor))
        throw new Error('Nexus change cursor does not match its last returned record.');
      if (page.caught_up && page.cursor !== through)
        throw new Error('Nexus did not reach the captured replay watermark.');
      return {
        checkpoint: encode({ epoch: checkpoint.epoch, revision: page.cursor, ...(page.caught_up ? {} : { through }) }),
        changes,
        caught_up: page.caught_up,
      };
    } catch (e) {
      if (e instanceof SourceResetError) return { checkpoint: value, changes: [], caught_up: false, reset: true };
      throw e;
    }
  }

  async verifySnapshot(start: string): Promise<void> {
    if (!this.validAt(checkpointSchema.parse(decode(start)), await this.head()))
      throw new SourceResetError('Inventory replay is no longer retained.');
  }

  async hydrate(uri: string): Promise<HydratedSource> {
    // Every invalidation carries an immutable committed payload. Never fall back to stale Redis.
    return { status: 'unavailable', uri };
  }
}
