import { importCalendarIcs } from '@eventky/ical';
import {
  IMPORT_PREVIEW_MAX_BYTES,
  importPreviewFailure,
  type ImportPreviewRequest,
  type ImportPreviewResponse,
  serializeImportPreview,
} from './eventkyImportPreview.types';

// One preview per worker. This module parses local text only; it never fetches URLs or publishes records.
self.onmessage = (event: MessageEvent<ImportPreviewRequest>) => {
  let report;
  try {
    const { version, text, options } = event.data;
    report =
      version !== 1 ||
      typeof text !== 'string' ||
      text.length > IMPORT_PREVIEW_MAX_BYTES ||
      new TextEncoder().encode(text).byteLength > IMPORT_PREVIEW_MAX_BYTES
        ? importPreviewFailure('Choose an iCalendar file of at most 2 MiB.')
        : importCalendarIcs(text, options);
  } catch {
    report = importPreviewFailure('The import preview could not be prepared. Try a smaller file.');
  }
  const serialized =
    serializeImportPreview(report) ??
    JSON.stringify(importPreviewFailure('The import preview is too large. Split this calendar into smaller files.'));
  self.postMessage({ version: 1, report: serialized } satisfies ImportPreviewResponse);
  self.close();
};
