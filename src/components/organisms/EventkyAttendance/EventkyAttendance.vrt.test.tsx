import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { matchVrtFrameScreenshot, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { EventkyAttendance } from './EventkyAttendance';

const fixture = vi.hoisted(() => ({
  people: [
    { author: 'y'.repeat(52), name: 'Amelia Rivera', status: 'ACCEPTED' },
    { author: 'b'.repeat(52), name: 'Theo Müller', status: 'ACCEPTED' },
    { author: 'n'.repeat(52), name: 'Samira Community Calendar Collective', status: 'ACCEPTED' },
    { author: 'd'.repeat(52), name: 'Noah Kim', status: 'TENTATIVE' },
    { author: 'r'.repeat(52), name: 'Jun Park', status: 'DECLINED' },
  ],
}));
vi.mock('@/hooks/useEventkyAttendance/useEventkyAttendance', () => ({
  useEventkyAttendance: () => ({
    status: 'ACCEPTED',
    signedIn: true,
    busy: false,
    loading: false,
    failed: false,
    pendingStatus: undefined,
    counts: { ACCEPTED: 3, TENTATIVE: 1, DECLINED: 1 },
    attendees: fixture.people,
    complete: true,
    hasMore: false,
    respond: vi.fn(),
    refresh: vi.fn(),
    loadMore: vi.fn(),
  }),
}));
vi.mock('@/hooks/useUserDetailsFromIds/useUserDetailsFromIds', () => ({
  useUserDetailsFromIds: ({ userIds }: { userIds: string[] }) => ({
    users: fixture.people
      .filter((person) => userIds.includes(person.author))
      .map((person) => ({ id: person.author, name: person.name })),
    isLoading: false,
  }),
}));
vi.mock('@/stores/auth/auth.store', () => ({
  useAuthStore: (select: (value: { currentUserPubky: string }) => unknown) =>
    select({ currentUserPubky: 'y'.repeat(52) }),
}));

describe('native event attendees', () => {
  for (const [name, viewport] of [
    ['desktop', VRT_VIEWPORT_DESKTOP],
    ['mobile', VRT_VIEWPORT_MOBILE],
  ] as const) {
    it(`shows a compact response row and grouped people on ${name}`, async () => {
      await renderForVRT(
        <div className="mx-auto mt-6 w-full max-w-xl rounded-lg border border-input p-4">
          <h2 className="mb-4 text-lg font-semibold">Pubky community meetup</h2>
          <EventkyAttendance postId={`${'y'.repeat(52)}:0035P2T1T0B20`} eventUid="community-meetup" />
        </div>,
        { viewport },
      );
      await expect.element(page.getByRole('button', { name: 'View attendees' })).toBeVisible();
      await matchVrtFrameScreenshot(`eventky-attendance-row-${name}`);
      await page.getByRole('button', { name: 'View attendees' }).click();
      await expect.element(page.getByRole('dialog', { name: 'Attendees', exact: true })).toBeVisible();
      await expect.element(page.getByRole('link', { name: /Amelia Rivera/ })).toBeVisible();
      await matchVrtFrameScreenshot(`eventky-attendees-going-${name}`);
      await page.getByRole('button', { name: 'Maybe (1)', exact: true }).click();
      await expect.element(page.getByRole('link', { name: /Noah Kim/ })).toBeVisible();
      await expect.element(page.getByRole('link', { name: /Amelia Rivera/ })).not.toBeInTheDocument();
      await matchVrtFrameScreenshot(`eventky-attendees-maybe-${name}`);
    });
  }
});
