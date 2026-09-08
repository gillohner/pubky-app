import { type IcsImportReport, importCalendarIcs } from '@eventky/ical';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventkyImportDb } from '@/models/eventkyImport/eventkyImport';
import { importCalendarIcsInWorker } from './eventkyImportPreview';
import { useEventkyImport } from './useEventkyImport';

// Publication tests use the real parser; the worker transport has its own deadline/lifecycle suite.
vi.mock('./eventkyImportPreview', async () => {
  const { importCalendarIcs } = await import('@eventky/ical');
  return {
    importCalendarIcsInWorker: vi.fn(async (...args: Parameters<typeof importCalendarIcs>) =>
      importCalendarIcs(...args),
    ),
  };
});

const mocks = vi.hoisted(() => ({
  author: 'y'.repeat(52),
  backend: 'https://nexus.example',
  serial: 0,
  createPostId: vi.fn(),
  prepareCreate: vi.fn(),
  commitPreparedCreate: vi.fn(),
  prepareEdit: vi.fn(),
  commitPreparedEdit: vi.fn(),
  fetchSource: vi.fn(),
}));
vi.mock('@/controllers/post/post', () => ({ PostController: mocks }));
vi.mock('@/libs/runtime-config/runtime-config', () => ({
  getEventkyEnabled: () => true,
  getNexusUrl: () => mocks.backend,
}));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: mocks.author }),
    { getState: () => ({ currentUserPubky: mocks.author }) },
  ),
}));

const ics = (title = 'Imported workshop', privateEvent = false) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:workshop@example.org\r\nDTSTAMP:20260908T120000Z\r\nDTSTART:20261001T160000Z\r\nDURATION:PT1H\r\nSUMMARY:${title}\r\n${privateEvent ? 'CLASS:PRIVATE\r\n' : ''}END:VEVENT\r\nEND:VCALENDAR\r\n`;

type Hook = ReturnType<typeof renderHook<ReturnType<typeof useEventkyImport>, unknown>>;
async function preview(hook: Hook, content: string, group = false) {
  await act(async () => {
    await hook.result.current.selectFile({ size: content.length, text: async () => content } as File);
  });
  await act(async () => {
    expect(await hook.result.current.scan()).toBe(true);
  });
  act(() => {
    hook.result.current.form.setValue('createCalendar', group);
    hook.result.current.form.setValue('publicAcknowledged', true);
  });
}

describe('calendar import publication', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.author = 'y'.repeat(52);
    mocks.backend = 'https://nexus.example';
    mocks.serial = 0;
    await eventkyImportDb.records.clear();
    mocks.createPostId.mockImplementation(() => `0034A0X7NJ5${++mocks.serial}A`);
    mocks.prepareCreate.mockImplementation(async (params) => params);
    mocks.prepareEdit.mockImplementation(async (params) => params);
    mocks.commitPreparedCreate.mockImplementation(async (params) => ({
      compositePostId: `${mocks.author}:${params.postId}`,
      tagsFailed: false,
    }));
    mocks.commitPreparedEdit.mockResolvedValue(undefined);
    mocks.fetchSource.mockResolvedValue(null);
  });

  it.each(['file', 'account'] as const)('discards an asynchronous preview after a %s change', async (changed) => {
    let finish!: (report: IcsImportReport) => void;
    vi.mocked(importCalendarIcsInWorker).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const hook = renderHook(() => useEventkyImport());
    await act(async () => {
      await hook.result.current.selectFile({ size: ics().length, text: async () => ics() } as File);
    });
    let pending!: Promise<boolean>;
    act(() => {
      pending = hook.result.current.scan();
    });
    await waitFor(() => expect(importCalendarIcsInWorker).toHaveBeenCalledOnce());
    if (changed === 'file') {
      await act(async () => {
        await hook.result.current.selectFile({ size: ics().length, text: async () => ics('Replacement') } as File);
      });
    } else {
      mocks.author = 'b'.repeat(52);
      hook.rerender();
    }
    await act(async () => {
      finish(importCalendarIcs(ics(), { now: '2026-09-08T12:00:00Z' }));
      expect(await pending).toBe(false);
    });
    expect(hook.result.current.preview).toBeUndefined();
    expect(mocks.prepareCreate).not.toHaveBeenCalled();
  });

  it('serializes preview clicks before asynchronous validation and parsing', async () => {
    const hook = renderHook(() => useEventkyImport());
    await act(async () => {
      await hook.result.current.selectFile({ size: ics().length, text: async () => ics() } as File);
    });
    await act(async () => {
      expect(await Promise.all([hook.result.current.scan(), hook.result.current.scan()])).toEqual([true, false]);
    });
    expect(importCalendarIcsInWorker).toHaveBeenCalledOnce();
  });

  it('previews privately and requires explicit acknowledgement before publishing a private source', async () => {
    const hook = renderHook(() => useEventkyImport());
    await preview(hook, ics('Private workshop', true));
    expect(mocks.prepareCreate).not.toHaveBeenCalled();
    await act(async () => {
      expect(await hook.result.current.submit()).toBe(false);
    });
    expect(mocks.prepareCreate).not.toHaveBeenCalled();
    act(() => hook.result.current.form.setValue('acknowledged', ['workshop@example.org']));
    await act(async () => {
      expect(await hook.result.current.submit()).toBe(true);
    });
    const params = mocks.prepareCreate.mock.calls[0][0];
    expect(params.customKind).toBe('event');
    expect(JSON.parse(params.content).uid).toBe('workshop@example.org');
    expect(params.content).not.toContain('Calendar import');
    expect(params.tags).toBeUndefined();
  });

  it('reuses an uncertain write identity and exact payload after closing and reopening the importer', async () => {
    mocks.commitPreparedCreate.mockRejectedValueOnce(new Error('response lost'));
    const first = renderHook(() => useEventkyImport());
    await preview(first, ics());
    await act(async () => {
      expect(await first.result.current.submit()).toBe(false);
    });
    const original = mocks.prepareCreate.mock.calls[0][0];
    first.unmount();
    const resumed = renderHook(() => useEventkyImport());
    await preview(resumed, ics());
    act(() => {
      resumed.result.current.form.setValue('selected', ['workshop@example.org']);
      resumed.result.current.form.setValue('approvedUpdates', ['workshop@example.org']);
    });
    await act(async () => {
      expect(await resumed.result.current.submit()).toBe(false);
    });
    expect(mocks.prepareCreate).toHaveBeenCalledTimes(1);
    act(() => resumed.result.current.form.setValue('missingAcknowledged', true));
    await act(async () => {
      expect(await resumed.result.current.submit()).toBe(true);
    });
    expect(mocks.prepareCreate.mock.calls[1][0]).toEqual(original);
    expect(mocks.createPostId).toHaveBeenCalledTimes(1);
    expect((await eventkyImportDb.records.toArray())[0].status).toBe('published');
  });

  it('creates a calendar first and claims membership using the actual allocated native post URI', async () => {
    const hook = renderHook(() => useEventkyImport());
    await preview(hook, ics(), true);
    await act(async () => {
      expect(await hook.result.current.submit()).toBe(true);
    });
    const [calendar, event] = mocks.prepareCreate.mock.calls.map(([params]) => params);
    expect(calendar.customKind).toBe('calendar');
    expect(event.customKind).toBe('event');
    expect(JSON.parse(event.content).calendar_uris).toEqual([
      `pubky://${mocks.author}/pub/pubky.app/posts/${calendar.postId}`,
    ]);
  });

  it('marks repeated files unchanged and does not republish them', async () => {
    const first = renderHook(() => useEventkyImport());
    await preview(first, ics());
    await act(async () => {
      await first.result.current.submit();
    });
    first.unmount();
    const second = renderHook(() => useEventkyImport());
    await preview(second, ics());
    expect(second.result.current.preview?.entries[0].action).toBe('unchanged');
    expect(second.result.current.form.getValues('selected')).toEqual([]);
    await act(async () => {
      expect(await second.result.current.submit()).toBe(false);
    });
    expect(mocks.prepareCreate).toHaveBeenCalledTimes(1);
  });

  it('updates only the owned mapped post with an unchanged source and explicit update approval', async () => {
    const first = renderHook(() => useEventkyImport());
    await preview(first, ics());
    await act(async () => {
      await first.result.current.submit();
    });
    const record = (await eventkyImportDb.records.toArray())[0];
    mocks.fetchSource.mockResolvedValue({ kind: 'event', content: record.payload });
    first.unmount();
    const update = renderHook(() => useEventkyImport());
    await preview(update, ics('Revised workshop'));
    act(() => update.result.current.form.setValue('selected', ['workshop@example.org']));
    await act(async () => {
      expect(await update.result.current.submit()).toBe(false);
    });
    expect(mocks.prepareEdit).not.toHaveBeenCalled();
    act(() => update.result.current.form.setValue('approvedUpdates', ['workshop@example.org']));
    await act(async () => {
      expect(await update.result.current.submit()).toBe(true);
    });
    const edit = mocks.prepareEdit.mock.calls[0][0];
    expect(edit.compositePostId).toBe(record.postId);
    expect(edit.expectedContent).toBe(record.payload);
    expect(JSON.parse(edit.content)).toMatchObject({
      uid: 'workshop@example.org',
      summary: 'Revised workshop',
      sequence: 1,
    });
  });

  it('rejects a backend switch before publication', async () => {
    const hook = renderHook(() => useEventkyImport());
    await preview(hook, ics());
    mocks.backend = 'https://other-nexus.example';
    await act(async () => {
      expect(await hook.result.current.submit()).toBe(false);
    });
    expect(mocks.prepareCreate).not.toHaveBeenCalled();
  });

  it('confirms an update that reached the homeserver before its response was lost, without another PUT', async () => {
    const first = renderHook(() => useEventkyImport());
    await preview(first, ics());
    await act(async () => {
      await first.result.current.submit();
    });
    const record = (await eventkyImportDb.records.toArray())[0];
    mocks.fetchSource.mockResolvedValue({ kind: 'event', content: record.payload });
    first.unmount();
    const update = renderHook(() => useEventkyImport());
    await preview(update, ics('Saved remotely'));
    act(() => {
      update.result.current.form.setValue('selected', ['workshop@example.org']);
      update.result.current.form.setValue('approvedUpdates', ['workshop@example.org']);
    });
    mocks.commitPreparedEdit.mockImplementationOnce(async (params) => {
      mocks.fetchSource.mockResolvedValue({ kind: 'event', content: params.content });
      throw new Error('response lost after PUT');
    });
    await act(async () => {
      expect(await update.result.current.submit()).toBe(false);
    });
    update.unmount();
    const resumed = renderHook(() => useEventkyImport());
    await preview(resumed, ics('Saved remotely'));
    act(() => {
      resumed.result.current.form.setValue('selected', ['workshop@example.org']);
      resumed.result.current.form.setValue('approvedUpdates', ['workshop@example.org']);
    });
    await act(async () => {
      expect(await resumed.result.current.submit()).toBe(true);
    });
    expect(mocks.commitPreparedEdit).toHaveBeenCalledTimes(1);
    expect((await eventkyImportDb.records.toArray())[0].status).toBe('published');
  });

  it('never overwrites a manually changed post when resuming a creation with a lost response', async () => {
    mocks.commitPreparedCreate.mockRejectedValueOnce(new Error('uncertain'));
    const hook = renderHook(() => useEventkyImport());
    await preview(hook, ics());
    await act(async () => {
      await hook.result.current.submit();
    });
    mocks.fetchSource.mockResolvedValue({ kind: 'short', content: 'A later manual edit' });
    await act(async () => {
      expect(await hook.result.current.submit()).toBe(false);
    });
    expect(mocks.commitPreparedCreate).toHaveBeenCalledTimes(1);
    expect(hook.result.current.message).toContain('reserved post has changed');
  });

  it('keeps an existing ungrouped source ungrouped on later imports', async () => {
    const first = renderHook(() => useEventkyImport());
    await preview(first, ics());
    await act(async () => {
      await first.result.current.submit();
    });
    first.unmount();
    const next = renderHook(() => useEventkyImport());
    await act(async () => {
      await next.result.current.selectFile({ size: 100, text: async () => ics() } as File);
    });
    await act(async () => {
      await next.result.current.scan();
    });
    expect(next.result.current.groupingLocked).toBe(true);
    expect(next.result.current.hasImportedCalendar).toBe(false);
    expect(next.result.current.form.getValues('createCalendar')).toBe(false);
  });
});
