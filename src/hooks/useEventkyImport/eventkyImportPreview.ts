import type { IcsImportOptions, IcsImportReport } from '@eventky/ical';
import {
  IMPORT_PREVIEW_MAX_BYTES,
  IMPORT_PREVIEW_MAX_OPTIONS_BYTES,
  IMPORT_PREVIEW_MAX_RESULT_BYTES,
  IMPORT_PREVIEW_TIMEOUT_MS,
  importPreviewFailure,
  type ImportPreviewRequest,
  type ImportPreviewResponse,
  type ImportPreviewTransport,
} from './eventkyImportPreview.types';

function createWorker(): ImportPreviewTransport {
  return new Worker(new URL('./eventkyImportPreview.worker.ts', import.meta.url), {
    type: 'module',
    name: 'eventky-import-preview',
  });
}

/** One active bounded preview per runner; expected worker failures resolve to a report with static errors. */
export class EventkyImportPreviewRunner {
  private active = false;
  private readonly timeoutMs: number;
  constructor(private readonly options: { createWorker?: () => ImportPreviewTransport; timeoutMs?: number } = {}) {
    this.timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(1, Math.min(options.timeoutMs!, IMPORT_PREVIEW_TIMEOUT_MS))
      : IMPORT_PREVIEW_TIMEOUT_MS;
  }

  run(text: string, options: IcsImportOptions, signal?: AbortSignal): Promise<IcsImportReport> {
    if (signal?.aborted) return Promise.resolve(importPreviewFailure('The import preview was cancelled.'));
    if (this.active)
      return Promise.resolve(importPreviewFailure('Another import preview is running. Wait and try again.'));
    if (
      typeof text !== 'string' ||
      text.length > IMPORT_PREVIEW_MAX_BYTES ||
      new TextEncoder().encode(text).byteLength > IMPORT_PREVIEW_MAX_BYTES
    )
      return Promise.resolve(importPreviewFailure('Choose an iCalendar file of at most 2 MiB.'));
    try {
      if (
        (options.existing?.length ?? 0) > 500 ||
        new TextEncoder().encode(JSON.stringify(options)).byteLength > IMPORT_PREVIEW_MAX_OPTIONS_BYTES
      )
        return Promise.resolve(importPreviewFailure('The import history is too large for one preview.'));
    } catch {
      return Promise.resolve(importPreviewFailure('The import settings could not be read.'));
    }
    this.active = true;
    return new Promise((resolve) => {
      let worker: ImportPreviewTransport | undefined;
      let done = false;
      const finish = (report: IcsImportReport) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (worker) {
          worker.onmessage = null;
          worker.onerror = null;
          worker.onmessageerror = null;
          worker.terminate();
        }
        this.active = false;
        resolve(report);
      };
      const abort = () => finish(importPreviewFailure('The import preview was cancelled.'));
      const timer = setTimeout(
        () => finish(importPreviewFailure('The import preview exceeded its time limit. Try a smaller file.')),
        this.timeoutMs,
      );
      const started = performance.now();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        worker = (this.options.createWorker ?? createWorker)();
        worker.onmessage = (event: MessageEvent<ImportPreviewResponse>) => {
          if (done) return;
          if (performance.now() - started > this.timeoutMs) {
            finish(importPreviewFailure('The import preview exceeded its time limit. Try a smaller file.'));
            return;
          }
          try {
            const value = event.data;
            if (
              value?.version !== 1 ||
              typeof value.report !== 'string' ||
              value.report.length > IMPORT_PREVIEW_MAX_RESULT_BYTES ||
              new TextEncoder().encode(value.report).byteLength > IMPORT_PREVIEW_MAX_RESULT_BYTES
            ) {
              finish(importPreviewFailure('The import preview returned an invalid result.'));
              return;
            }
            const report = JSON.parse(value.report) as IcsImportReport;
            if (
              !Array.isArray(report.entries) ||
              report.entries.length > 500 ||
              !Array.isArray(report.errors) ||
              !Array.isArray(report.warnings)
            ) {
              finish(importPreviewFailure('The import preview returned an invalid result.'));
              return;
            }
            finish(report);
          } catch {
            finish(importPreviewFailure('The import preview returned an invalid result.'));
          }
        };
        worker.onerror = (event: ErrorEvent) => {
          event.preventDefault();
          finish(importPreviewFailure('The import preview could not start. Try again or reload the app.'));
        };
        worker.onmessageerror = () => finish(importPreviewFailure('The import preview returned an invalid result.'));
        worker.postMessage({ version: 1, text, options } satisfies ImportPreviewRequest);
      } catch {
        finish(importPreviewFailure('The import preview could not start. Try again or reload the app.'));
      }
    });
  }
}

const preview = new EventkyImportPreviewRunner();
export function importCalendarIcsInWorker(
  text: string,
  options: IcsImportOptions,
  execution: { signal?: AbortSignal } = {},
): Promise<IcsImportReport> {
  return preview.run(text, options, execution.signal);
}
