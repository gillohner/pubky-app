import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventkyImportPreviewRunner } from './eventkyImportPreview';
import {
  IMPORT_PREVIEW_MAX_BYTES,
  IMPORT_PREVIEW_MAX_RESULT_BYTES,
  importPreviewFailure,
  type ImportPreviewTransport,
  serializeImportPreview,
} from './eventkyImportPreview.types';

const options = { now: '2026-09-08T12:00:00Z', defaultTimezone: 'Europe/Zurich' };
function transport() {
  const value: ImportPreviewTransport = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
  const reply = (report: unknown) =>
    value.onmessage?.call(value as Worker, new MessageEvent('message', { data: report }));
  return { value, reply };
}
afterEach(() => vi.useRealTimers());

describe('bounded browser import transport', () => {
  it('preserves the report, timestamps and existing-UID metadata through one worker', async () => {
    const worker = transport();
    const runner = new EventkyImportPreviewRunner({ createWorker: () => worker.value });
    const report = {
      entries: [
        {
          uid: 'event@example.org',
          action: 'review-update',
          existingPostUri: 'pubky://source/pub/pubky.app/posts/0000000000000',
          warnings: [],
          errors: [],
          requiresAcknowledgement: [],
        },
      ],
      warnings: ['Review source metadata.'],
      errors: [],
    };
    const pending = runner.run('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', options);
    expect(worker.value.postMessage).toHaveBeenCalledWith({
      version: 1,
      text: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
      options,
    });
    worker.reply({ version: 1, report: JSON.stringify(report) });
    expect(await pending).toEqual(report);
    expect(worker.value.terminate).toHaveBeenCalledOnce();
    expect(worker.value.onmessage).toBeNull();
  });

  it('terminates at the deadline, rejects concurrency without another worker, and permits a fresh preview', async () => {
    vi.useFakeTimers();
    const worker = transport();
    const createWorker = vi.fn(() => worker.value);
    const runner = new EventkyImportPreviewRunner({ createWorker });
    const pending = runner.run('calendar', options);
    expect((await runner.run('second', options)).errors).toEqual([
      'Another import preview is running. Wait and try again.',
    ]);
    expect(createWorker).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).errors).toEqual(['The import preview exceeded its time limit. Try a smaller file.']);
    expect(worker.value.terminate).toHaveBeenCalledOnce();
    const fresh = runner.run('fresh', options);
    worker.reply({ version: 1, report: JSON.stringify({ entries: [], warnings: [], errors: [] }) });
    expect((await fresh).errors).toEqual([]);
  });

  it('cancels active work and ignores late results; an already aborted request allocates nothing', async () => {
    const worker = transport();
    const createWorker = vi.fn(() => worker.value);
    const runner = new EventkyImportPreviewRunner({ createWorker });
    const signal = new AbortController();
    const pending = runner.run('calendar', options, signal.signal);
    const late = worker.value.onmessage;
    signal.abort();
    late?.call(
      worker.value as Worker,
      new MessageEvent('message', {
        data: { version: 1, report: JSON.stringify({ entries: [], warnings: [], errors: [] }) },
      }),
    );
    expect((await pending).errors).toEqual(['The import preview was cancelled.']);
    expect((await runner.run('calendar', options, signal.signal)).errors).toEqual([
      'The import preview was cancelled.',
    ]);
    expect(createWorker).toHaveBeenCalledOnce();
  });

  it('checks UTF-8 bytes before creating a worker and bounds result serialization amplification', async () => {
    const createWorker = vi.fn();
    const runner = new EventkyImportPreviewRunner({ createWorker });
    expect((await runner.run('é'.repeat(IMPORT_PREVIEW_MAX_BYTES / 2 + 1), options)).errors).toEqual([
      'Choose an iCalendar file of at most 2 MiB.',
    ]);
    expect(createWorker).not.toHaveBeenCalled();
    const entry = {
      uid: 'large',
      warnings: ['x'.repeat(100000)],
      errors: [],
      requiresAcknowledgement: [],
      action: 'create' as const,
    };
    expect(
      serializeImportPreview({ entries: Array.from({ length: 100 }, () => entry), errors: [], warnings: [] }),
    ).toBeNull();
    const encoded = serializeImportPreview(importPreviewFailure('Static failure.'));
    expect(JSON.parse(encoded!)).toEqual(importPreviewFailure('Static failure.'));
  });

  it('turns startup, transport and oversized-result failures into static reports', async () => {
    const startup = new EventkyImportPreviewRunner({
      createWorker: () => {
        throw 'private source content';
      },
    });
    expect((await startup.run('calendar', options)).errors).toEqual([
      'The import preview could not start. Try again or reload the app.',
    ]);
    for (const response of [
      { version: 2, report: '{}' },
      { version: 1, report: 'invalid json' },
      { version: 1, report: 'x'.repeat(IMPORT_PREVIEW_MAX_RESULT_BYTES + 1) },
    ]) {
      const worker = transport();
      const pending = new EventkyImportPreviewRunner({ createWorker: () => worker.value }).run('calendar', options);
      worker.reply(response);
      expect((await pending).errors).toEqual(['The import preview returned an invalid result.']);
      expect(worker.value.terminate).toHaveBeenCalledOnce();
    }
    const worker = transport();
    const pending = new EventkyImportPreviewRunner({ createWorker: () => worker.value }).run('calendar', options);
    worker.value.onerror?.call(
      Object.assign(new EventTarget(), { onerror: null }),
      new ErrorEvent('error', { message: 'private data' }),
    );
    expect((await pending).errors).toEqual(['The import preview could not start. Try again or reload the app.']);
  });
});
