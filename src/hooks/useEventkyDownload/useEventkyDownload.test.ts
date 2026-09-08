import { exportEventIcs } from '@eventky/ical';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/molecules/Toaster/toast';
import { eventkyEventFixture } from '@/test/fixtures/eventky';
import { useEventkyDownload } from './useEventkyDownload';

vi.mock('@eventky/ical', () => ({ exportEventIcs: vi.fn() }));
vi.mock('@/molecules/Toaster/toast');

const createObjectURL = vi.fn(() => 'blob:calendar-export');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useEventkyDownload', () => {
  it('downloads the exporter result with a fixed filename and releases its object URL', () => {
    vi.mocked(exportEventIcs).mockReturnValue({ ok: true, value: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' });
    const clicked: Array<{ name: string; href: string; connected: boolean }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ name: this.download, href: this.href, connected: this.isConnected });
    });
    const { result } = renderHook(useEventkyDownload);
    const uri = `pubky://${'y'.repeat(52)}/pub/pubky.app/posts/0000000000001`;
    act(() => result.current.downloadEvent(eventkyEventFixture, uri));
    expect(exportEventIcs).toHaveBeenCalledWith(eventkyEventFixture, { postUri: uri });
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'text/calendar;charset=utf-8' }));
    expect(clicked).toEqual([{ name: 'event.ics', href: 'blob:calendar-export', connected: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    act(() => vi.runAllTimers());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:calendar-export');
  });

  it('reports export failures without creating an incomplete file', () => {
    vi.mocked(exportEventIcs).mockReturnValue({ ok: false, issues: ['Unsupported timezone.'] });
    const { result } = renderHook(useEventkyDownload);
    act(() => result.current.downloadEvent(eventkyEventFixture, 'pubky://source'));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ variant: 'error', description: 'Could not export this event.' });
  });

  it('passes native attachment URIs into the exported event', () => {
    vi.mocked(exportEventIcs).mockReturnValue({ ok: true, value: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { result } = renderHook(useEventkyDownload);
    const uri = `pubky://${'y'.repeat(52)}/pub/pubky.app/posts/0000000000001`;
    const attachments = [`pubky://${'y'.repeat(52)}/pub/pubky.app/files/0000000000002`];
    act(() => result.current.downloadEvent(eventkyEventFixture, uri, attachments));
    expect(exportEventIcs).toHaveBeenCalledWith(eventkyEventFixture, { postUri: uri, attachmentUris: attachments });
  });
});
