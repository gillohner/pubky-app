import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { eventkyImportDb } from '@/models/eventkyImport/eventkyImport';
import { DialogEventkyImport } from '@/organisms/DialogEventkyImport/DialogEventkyImport';
import { matchVrtFrameScreenshot, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';

const mocks = vi.hoisted(() => ({
  createPostId: vi.fn(),
  prepareCreate: vi.fn(),
  commitPreparedCreate: vi.fn(),
  fetchSource: vi.fn(),
}));
vi.mock('@/controllers/post/post', () => ({ PostController: mocks }));
vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>()),
  getEventkyEnabled: () => true,
  getNexusUrl: () => 'https://nexus.example',
}));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: { currentUserPubky: string }) => unknown) => selector({ currentUserPubky: 'y'.repeat(52) }),
    { getState: () => ({ currentUserPubky: 'y'.repeat(52) }) },
  ),
}));

const calendar =
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:private-workshop@example.org\r\nDTSTAMP:20260908T120000Z\r\nDTSTART:20261001T160000Z\r\nDURATION:PT1H\r\nSUMMARY:Community workshop\r\nDESCRIPTION:Meet the local Pubky community.\r\nCLASS:PRIVATE\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

describe('iCalendar import browser flow', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await eventkyImportDb.records.clear();
    let serial = 0;
    mocks.createPostId.mockImplementation(() => `0034A0X7NJ5${++serial}A`);
    mocks.prepareCreate.mockImplementation(async (params) => params);
    mocks.commitPreparedCreate.mockImplementation(async (params) => ({
      compositePostId: `${'y'.repeat(52)}:${params.postId}`,
      tagsFailed: false,
    }));
    mocks.fetchSource.mockResolvedValue(null);
  });

  for (const [name, viewport] of [
    ['desktop', VRT_VIEWPORT_DESKTOP],
    ['mobile', VRT_VIEWPORT_MOBILE],
  ] as const) {
    it(`previews and explicitly publishes private source data on ${name}`, async () => {
      await renderForVRT(<DialogEventkyImport open onOpenChange={vi.fn()} />, { viewport });
      await page
        .getByLabelText('iCalendar file (up to 2 MiB)')
        .upload(new File([calendar], 'workshop.ics', { type: 'text/calendar' }));
      await page.getByRole('button', { name: 'Preview import' }).click();
      await expect
        .element(page.getByText('1 event series found. Recurring instances stay within their series post.'))
        .toBeVisible();
      await matchVrtFrameScreenshot(`eventky-import-${name}`);
      await page.getByRole('button', { name: 'Publish selected events' }).click();
      expect(mocks.prepareCreate).not.toHaveBeenCalled();
      await page.getByRole('checkbox', { name: 'I reviewed these privacy and metadata warnings' }).click();
      await page
        .getByRole('checkbox', { name: 'I understand that selected events and preserved metadata will be public' })
        .click();
      await page.getByRole('button', { name: 'Publish selected events' }).click();
      await expect
        .element(page.getByText('Import complete. Events are ordinary posts with comments and tags.'))
        .toBeVisible();
      expect(mocks.prepareCreate.mock.calls.map(([params]) => params.customKind)).toEqual(['calendar', 'event']);
    });
  }
});
