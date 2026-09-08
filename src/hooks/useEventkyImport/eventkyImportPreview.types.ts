import type { IcsImportOptions, IcsImportReport } from '@eventky/ical';

export const IMPORT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_PREVIEW_MAX_OPTIONS_BYTES = 512 * 1024;
export const IMPORT_PREVIEW_MAX_RESULT_BYTES = 8 * 1024 * 1024;
export const IMPORT_PREVIEW_TIMEOUT_MS = 5000;

export type ImportPreviewRequest = { version: 1; text: string; options: IcsImportOptions };
export type ImportPreviewResponse = { version: 1; report: string };
export type ImportPreviewTransport = Pick<
  Worker,
  'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>;

export function importPreviewFailure(message: string): IcsImportReport {
  return { entries: [], warnings: [], errors: [message] };
}

/** Sum independent report sections before joining, so repeated timezone definitions cannot create an unbounded message. */
export function serializeImportPreview(report: IcsImportReport): string | null {
  const encoder = new TextEncoder();
  let bytes = 0;
  const chunks: string[] = [];
  const add = (value: string): boolean => {
    if (value.length > IMPORT_PREVIEW_MAX_RESULT_BYTES) return false;
    bytes += encoder.encode(value).byteLength;
    if (bytes > IMPORT_PREVIEW_MAX_RESULT_BYTES) return false;
    chunks.push(value);
    return true;
  };
  if (!add('{"entries":[')) return null;
  for (let index = 0; index < report.entries.length; index++) {
    if ((index && !add(',')) || !add(JSON.stringify(report.entries[index]))) return null;
  }
  if (
    !add('],"warnings":') ||
    !add(JSON.stringify(report.warnings)) ||
    !add(',"errors":') ||
    !add(JSON.stringify(report.errors))
  )
    return null;
  if (report.calendar && (!add(',"calendar":') || !add(JSON.stringify(report.calendar)))) return null;
  return add('}') ? chunks.join('') : null;
}
