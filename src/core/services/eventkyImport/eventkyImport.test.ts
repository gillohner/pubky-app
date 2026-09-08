import { beforeEach, describe, expect, it } from 'vitest';
import { EventkyImportDatabase, eventkyImportDb, type EventkyImportRecord } from '@/models/eventkyImport/eventkyImport';
import { EventkyImportService } from './eventkyImport';

const intent: EventkyImportRecord = {
  key: 'key',
  scope: 'account/backend',
  source: 'calendar',
  uid: 'uid',
  kind: 'event',
  postId: 'owner:first',
  payload: 'same exact payload',
  fingerprint: 'fingerprint',
  status: 'pending',
  updatedAt: 1,
};

describe('durable calendar import reservation', () => {
  beforeEach(async () => {
    await eventkyImportDb.records.clear();
  });

  it('assigns one stable post identity when two tabs reserve the same import concurrently', async () => {
    const results = await Promise.all([
      EventkyImportService.reserve(intent),
      EventkyImportService.reserve({ ...intent, postId: 'owner:other' }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => result.ok && result.record.postId)).toEqual(['owner:first', 'owner:first']);
    expect(await eventkyImportDb.records.count()).toBe(1);
  });

  it('does not replace an uncertain publication with changed content', async () => {
    await EventkyImportService.reserve(intent);
    expect(
      await EventkyImportService.reserve(
        { ...intent, payload: 'different', fingerprint: 'different' },
        intent.fingerprint,
      ),
    ).toEqual({ ok: false, reason: 'pending-different-import' });
    expect((await eventkyImportDb.records.get(intent.key))?.payload).toBe(intent.payload);
  });

  it('requires the reviewed ledger revision before replacing a completed import', async () => {
    await EventkyImportService.reserve(intent);
    await EventkyImportService.markPublished(intent);
    const edit = { ...intent, payload: 'edit', fingerprint: 'new', expectedContent: intent.payload };
    expect(await EventkyImportService.reserve(edit, 'stale')).toEqual({ ok: false, reason: 'changed-ledger' });
    expect(await EventkyImportService.reserve(edit, intent.fingerprint)).toEqual({ ok: true, record: edit });
    await EventkyImportService.markPublished(intent);
    expect((await eventkyImportDb.records.get(intent.key))?.status).toBe('pending');
  });

  it('retains retry intent across database reconnection and scopes discovery to account/backend/source', async () => {
    await EventkyImportService.reserve(intent);
    const reopened = new EventkyImportDatabase();
    expect(await reopened.records.get(intent.key)).toEqual(intent);
    reopened.close();
    expect(await EventkyImportService.getRecords('another-account/backend', intent.source)).toEqual([]);
    expect(await EventkyImportService.getRecords(intent.scope, 'other-source')).toEqual([]);
    expect(await EventkyImportService.getRecords(intent.scope, intent.source)).toEqual([intent]);
  });
});
