import { EventkyImportApplication } from '@/application/eventkyImport/eventkyImport';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { getNexusUrl } from '@/libs/runtime-config/runtime-config';
import type { EventkyImportRecord } from '@/models/eventkyImport/eventkyImport';
import { useAuthStore } from '@/stores/auth/auth.store';

export class EventkyImportController {
  static getScope(authorId: string): string {
    return JSON.stringify([authorId, getNexusUrl()]);
  }
  static assertAccount(authorId: string, scope: string) {
    if (useAuthStore.getState().currentUserPubky !== authorId || this.getScope(authorId) !== scope) {
      throw Err.auth(AuthErrorCode.SESSION_EXPIRED, 'Calendar import account changed', {
        service: ErrorService.Local,
        operation: 'calendarImport',
      });
    }
  }
  static getRecords(authorId: string, scope: string, source: string) {
    this.assertAccount(authorId, scope);
    return EventkyImportApplication.getRecords(scope, source);
  }
  static reserve(authorId: string, record: EventkyImportRecord, previousFingerprint?: string) {
    this.assertAccount(authorId, record.scope);
    return EventkyImportApplication.reserve(record, previousFingerprint);
  }
  static markPublished(authorId: string, record: EventkyImportRecord) {
    this.assertAccount(authorId, record.scope);
    return EventkyImportApplication.markPublished(record);
  }
  static markAttempted(authorId: string, record: EventkyImportRecord) {
    this.assertAccount(authorId, record.scope);
    return EventkyImportApplication.markAttempted(record);
  }
}
