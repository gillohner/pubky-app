import { DatabaseErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { eventkyImportDb, type EventkyImportRecord } from '@/models/eventkyImport/eventkyImport';

export type ImportReservation =
  | { ok: true; record: EventkyImportRecord }
  | { ok: false; reason: 'pending-different-import' | 'changed-ledger' };

export class EventkyImportService {
  static async getRecords(scope: string, source: string): Promise<EventkyImportRecord[]> {
    try {
      return await eventkyImportDb.records.where('[scope+source]').equals([scope, source]).toArray();
    } catch (cause) {
      throw Err.database(DatabaseErrorCode.QUERY_FAILED, 'Could not read calendar import records', {
        service: ErrorService.Local,
        operation: 'getImportRecords',
        cause,
      });
    }
  }

  /** Reserve the payload and post identity atomically before the first homeserver write. */
  static async reserve(record: EventkyImportRecord, previousFingerprint?: string): Promise<ImportReservation> {
    try {
      return await eventkyImportDb.transaction('rw', eventkyImportDb.records, async () => {
        const previous = await eventkyImportDb.records.get(record.key);
        if (previous?.fingerprint === record.fingerprint) return { ok: true, record: previous };
        if (previous?.status === 'pending') return { ok: false, reason: 'pending-different-import' };
        if (previous?.fingerprint !== previousFingerprint) return { ok: false, reason: 'changed-ledger' };
        await eventkyImportDb.records.put(record);
        return { ok: true, record };
      });
    } catch (cause) {
      throw Err.database(DatabaseErrorCode.WRITE_FAILED, 'Could not reserve calendar import', {
        service: ErrorService.Local,
        operation: 'reserveImport',
        cause,
      });
    }
  }

  static async markPublished(record: EventkyImportRecord): Promise<void> {
    try {
      await eventkyImportDb.transaction('rw', eventkyImportDb.records, async () => {
        const current = await eventkyImportDb.records.get(record.key);
        if (current?.postId === record.postId && current.fingerprint === record.fingerprint) {
          await eventkyImportDb.records.put({ ...current, status: 'published', updatedAt: Date.now() });
        }
      });
    } catch (cause) {
      throw Err.database(DatabaseErrorCode.WRITE_FAILED, 'Could not confirm calendar import', {
        service: ErrorService.Local,
        operation: 'markImportPublished',
        cause,
      });
    }
  }

  static async markAttempted(record: EventkyImportRecord): Promise<void> {
    try {
      await eventkyImportDb.transaction('rw', eventkyImportDb.records, async () => {
        const current = await eventkyImportDb.records.get(record.key);
        if (current?.postId === record.postId && current.fingerprint === record.fingerprint)
          await eventkyImportDb.records.update(record.key, { attempted: true });
      });
    } catch (cause) {
      throw Err.database(DatabaseErrorCode.WRITE_FAILED, 'Could not retain calendar publication intent', {
        service: ErrorService.Local,
        operation: 'markImportAttempted',
        cause,
      });
    }
  }
}
