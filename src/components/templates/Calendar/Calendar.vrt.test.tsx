import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { Card } from '@/atoms/Card/Card';
import { EventkyPostContent } from '@/organisms/EventkyPostContent/EventkyPostContent';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useEventkyCalendarStore } from '@/stores/eventkyCalendar/eventkyCalendar.store';
import { eventkyCalendarFixture, eventkyEventFixture } from '@/test/fixtures/eventky';
import { projectionPostId, projectionPostUri } from '@/test/fixtures/eventkyProjection';
import { matchVrtFrameScreenshot, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { Calendar } from './Calendar';

const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), copy: vi.fn(), download: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/calendar',
}));
vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>()),
  getEventkyCalendarEnabled: () => true,
  getEventkyEnabled: () => false,
}));
vi.mock('@/libs/eventky/calendarView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/eventky/calendarView')>()),
  calendarToday: () => '2026-10-25',
}));
vi.mock('@/hooks/useEventkyCalendar/useEventkyCalendar', async () => {
  const { eventkyEventFixture } = await import('@/test/fixtures/eventky');
  const { projectedOccurrenceFixture, occurrencePageFixture } = await import('@/test/fixtures/eventkyProjection');
  const result = {
    items: [
      {
        projection: projectedOccurrenceFixture,
        event: eventkyEventFixture,
        sourceContent: JSON.stringify(eventkyEventFixture),
      },
    ],
    hidden: 0,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    coverage: occurrencePageFixture().coverage,
    incomplete: false,
    stale: false,
    refresh: mocks.refresh,
  };
  return { useEventkyCalendar: () => result };
});
vi.mock('@/hooks/useEventkyCalendar/useEventkyCalendars', () => ({
  useEventkyCalendars: () => ({
    calendars: [{ uri: projectionPostUri, name: 'Pubky builders' }],
    isLoading: false,
    hasMore: false,
  }),
}));
vi.mock('@/hooks/useEventkyAttendance/useEventkyAttendance', () => ({
  useEventkyAttendance: () => ({
    status: 'ACCEPTED',
    signedIn: true,
    busy: false,
    loading: false,
    failed: false,
    complete: true,
    counts: { ACCEPTED: 8, TENTATIVE: 2, DECLINED: 1 },
    respond: vi.fn(),
  }),
}));
vi.mock('@/hooks/usePostDetails/usePostDetails', async () => {
  const { eventkyEventFixture } = await import('@/test/fixtures/eventky');
  const { projectionPostId, projectionPostUri } = await import('@/test/fixtures/eventkyProjection');
  return {
    usePostDetails: () => ({
      postDetails: {
        id: projectionPostId,
        uri: projectionPostUri,
        kind: 'event',
        content: JSON.stringify(eventkyEventFixture),
        attachments: null,
        is_blurred: false,
      },
      isLoading: false,
    }),
  };
});
// Keep the native post-content boundary and occurrence renderer; this fixture omits the social chrome's network IO.
vi.mock('@/organisms/PostMain/PostMain', async () => {
  const { Card } = await import('@/atoms/Card/Card');
  const { PostContentBase } = await import('@/organisms/PostContentBase/PostContentBase');
  return {
    PostMain: ({ postId }: { postId: string }) => (
      <Card className="p-6">
        <PostContentBase postId={postId} />
      </Card>
    ),
  };
});
vi.mock('@/organisms/ContentLayout/ContentLayout', () => ({
  ContentLayout: ({ children }: { children: ReactNode }) => (
    <main className="mx-auto h-full max-w-6xl overflow-auto p-4 md:p-6">{children}</main>
  ),
}));
vi.mock('@/hooks/useCopyToClipboard/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: mocks.copy }),
}));
vi.mock('@/hooks/useEventkyDownload/useEventkyDownload', () => ({
  useEventkyDownload: () => ({ downloadEvent: mocks.download }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentUserPubky: 'y'.repeat(52) });
  useEventkyCalendarStore.setState({ scopes: {} });
});

describe('native Eventky calendar display', () => {
  for (const [name, viewport] of [
    ['desktop', VRT_VIEWPORT_DESKTOP],
    ['mobile', VRT_VIEWPORT_MOBILE],
  ] as const) {
    it(`renders calendar controls and opens an occurrence on ${name}`, async () => {
      await renderForVRT(<Calendar />, { viewport });
      await expect.element(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
      await page.getByRole('button', { name: name === 'mobile' ? 'Day' : 'Week', exact: true }).click();
      await expect
        .element(page.getByRole('table', { name: `${name === 'mobile' ? 'Day' : 'Week'} calendar` }))
        .toBeInTheDocument();
      await matchVrtFrameScreenshot(`eventky-calendar-${name}`);
      await page.getByRole('button', { name: /Pubky community meetup/ }).click();
      await expect.element(page.getByRole('region', { name: 'Selected event' })).toBeInTheDocument();
      await expect.element(page.getByRole('heading', { name: 'Pubky community meetup' })).toBeVisible();
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
      const main = document.querySelector('main')!;
      expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth);
    });

    it(`renders native event and calendar actions on ${name}`, async () => {
      await renderForVRT(
        <main className="mx-auto grid h-full max-w-5xl content-start gap-4 overflow-auto p-4 md:grid-cols-2 md:p-6">
          <Card className="p-5">
            <EventkyPostContent
              postId={projectionPostId}
              kind="event"
              content={JSON.stringify({
                ...eventkyEventFixture,
                rrule: 'FREQ=WEEKLY;COUNT=4',
                locations: [
                  { id: 'venue', kind: 'PHYSICAL', label: 'Zurich community space', address: 'Zurich, Switzerland' },
                ],
              })}
              attachments={null}
              localAttachments={undefined}
            />
          </Card>
          <Card className="p-5">
            <EventkyPostContent
              postId={projectionPostId.replace(/1$/, '2')}
              kind="calendar"
              content={JSON.stringify(eventkyCalendarFixture)}
              attachments={null}
              localAttachments={undefined}
            />
          </Card>
        </main>,
        { viewport },
      );
      await expect.element(page.getByRole('heading', { name: eventkyEventFixture.summary })).toBeVisible();
      await matchVrtFrameScreenshot(`eventky-native-content-${name}`);
      await expect
        .element(page.getByRole('link', { name: 'Upcoming events' }))
        .toHaveAttribute('href', `/calendar?calendar=${encodeURIComponent(projectionPostUri.replace(/1$/, '2'))}`);
      const main = document.querySelector('main')!;
      expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth);
    });
  }
});
