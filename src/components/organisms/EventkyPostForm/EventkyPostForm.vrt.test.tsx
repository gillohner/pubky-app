import { EVENT_FIXTURE, FIXTURE_OWNER } from '@eventky/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { DialogEventkyPost } from '@/organisms/DialogEventkyPost/DialogEventkyPost';
import { matchVrtFrameScreenshot, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';

const mocks = vi.hoisted(() => ({ prepareEdit: vi.fn(), commitPreparedEdit: vi.fn(), fetch: vi.fn() }));
vi.mock('@/controllers/post/post', () => ({ PostController: mocks }));
vi.mock('@/hooks/useEventkyCalendar/useEventkyCalendars', () => ({
  useEventkyCalendars: () => ({ calendars: [], isLoading: false, hasMore: false, loadMore: vi.fn() }),
}));
vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>()),
  getEventkyEnabled: () => true,
}));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: 'y'.repeat(52) }),
    { getState: () => ({ currentUserPubky: 'y'.repeat(52) }) },
  ),
}));
vi.mock('@/hooks/useEventkyAttachments/useEventkyAttachments', () => ({
  useEventkyAttachments: () => ({
    ready: true,
    changed: false,
    attachments: [],
    existingAttachments: [],
    setAttachments: vi.fn(),
    removeExisting: vi.fn(),
    handleFilesAdded: vi.fn(),
    fileInputRef: { current: null },
    editChanges: undefined,
  }),
}));
vi.mock('@/molecules/Toaster/toast', () => ({ toast: vi.fn() }));

describe('native Eventky event composer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepareEdit.mockResolvedValue({});
    mocks.commitPreparedEdit.mockResolvedValue(undefined);
  });

  for (const [name, viewport] of [
    ['desktop', VRT_VIEWPORT_DESKTOP],
    ['mobile', VRT_VIEWPORT_MOBILE],
  ] as const) {
    it(`renders and edits an event on ${name}`, async () => {
      await renderForVRT(
        <DialogEventkyPost
          open
          onOpenChange={vi.fn()}
          kind="event"
          source={{ ...EVENT_FIXTURE, calendar_uris: [] }}
          originalContent={JSON.stringify({ ...EVENT_FIXTURE, calendar_uris: [] })}
          postId={`${FIXTURE_OWNER}:0034A0X7NJ52B`}
        />,
        { viewport },
      );
      await expect.element(page.getByRole('dialog')).toBeVisible();
      await expect
        .element(page.getByRole('textbox', { name: 'Event title', exact: true }))
        .toHaveValue(EVENT_FIXTURE.summary);
      await page.getByText('Description', { exact: true }).click();
      await matchVrtFrameScreenshot(`eventky-composer-${name}`);
      await page.getByRole('button', { name: 'Start date', exact: true }).click();
      await matchVrtFrameScreenshot(`eventky-date-picker-${name}`);
      await page.getByRole('button', { name: /Thursday, October 1st, 2026/ }).click();
      await page.getByRole('textbox', { name: 'Event title', exact: true }).fill('Community planning');
      await page.getByText('Recurrence and advanced details', { exact: true }).click();
      await page.getByRole('button', { name: 'Preview from', exact: true }).click();
      await matchVrtFrameScreenshot(`eventky-recurrence-preview-date-${name}`);
      await page.getByRole('button', { name: /Thursday, October 1st, 2026/ }).click();
      await page.getByRole('button', { name: 'Preview occurrences' }).click();
      await expect.element(page.getByText('Occurrences in the next 90 days (up to 30 shown).')).toBeVisible();
      await page.getByText('Oct 1, 2026, 6:00 PM (Europe/Zurich)', { exact: true }).click();
      await page.getByRole('button', { name: 'Move to date', exact: true }).click();
      await matchVrtFrameScreenshot(`eventky-recurrence-move-date-${name}`);
      await page.getByRole('button', { name: /Friday, October 2nd, 2026/ }).click();
      await page.getByRole('button', { name: 'Apply to this occurrence' }).click();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect.poll(() => mocks.prepareEdit.mock.calls.length).toBe(1);
      expect(JSON.parse(mocks.prepareEdit.mock.calls[0][0].content).summary).toBe('Community planning');
      expect(mocks.prepareEdit.mock.calls[0][0].expectedContent).toContain(EVENT_FIXTURE.uid);
      expect(JSON.parse(mocks.prepareEdit.mock.calls[0][0].content).overrides[0]).toMatchObject({
        recurrence_id: { type: 'zoned', value: '2026-10-01T18:00:00', tzid: 'Europe/Zurich' },
        changes: { dtstart: { type: 'zoned', value: '2026-10-02T18:00:00', tzid: 'Europe/Zurich' } },
      });
    });
  }
});
