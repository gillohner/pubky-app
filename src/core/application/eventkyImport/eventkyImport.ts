import type { EventkyImportRecord } from '@/models/eventkyImport/eventkyImport';
import { EventkyImportService } from '@/services/eventkyImport/eventkyImport';

export class EventkyImportApplication {
  static getRecords(scope: string, source: string) {
    return EventkyImportService.getRecords(scope, source);
  }
  static reserve(record: EventkyImportRecord, previousFingerprint?: string) {
    return EventkyImportService.reserve(record, previousFingerprint);
  }
  static markPublished(record: EventkyImportRecord) {
    return EventkyImportService.markPublished(record);
  }
  static markAttempted(record: EventkyImportRecord) {
    return EventkyImportService.markAttempted(record);
  }
}
