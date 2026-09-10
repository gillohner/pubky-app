import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/atoms/Tooltip/Tooltip';
import { useSettingsStore } from '@/stores/settings/settings.store';
import { eventkyCalendarFixture, eventkyEventFixture } from '@/test/fixtures/eventky';
import { EventkyPostContent } from './EventkyPostContent';

const { mockPathname, mockEventkyEnabled, mockAttachments } = vi.hoisted(() => ({
  mockPathname: vi.fn(() => '/home'),
  mockEventkyEnabled: vi.fn(() => true),
  mockAttachments: vi.fn(() => null),
}));
vi.mock('@/hooks/useDeviceTimezone/useDeviceTimezone', () => ({ useDeviceTimezone: () => 'America/New_York' }));
vi.mock('next/navigation', () => ({ usePathname: mockPathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>()),
  getEventkyCalendarEnabled: mockEventkyEnabled,
}));
// Attachment persistence and media IO have their own tests; assert delegation of the native envelope here.
vi.mock('@/organisms/PostAttachments/PostAttachments', () => ({ PostAttachments: mockAttachments }));

vi.mock('@/organisms/EventkyAttendance/EventkyAttendance', () => ({
  EventkyAttendance: () => <div>Attendance actions</div>,
}));

const postId = `${'y'.repeat(52)}:0000000000001`;
const renderContent = (kind: string, value: unknown) =>
  render(
    <TooltipProvider>
      <EventkyPostContent
        postId={postId}
        kind={kind}
        content={JSON.stringify(value)}
        attachments={null}
        localAttachments={undefined}
      />
    </TooltipProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname.mockReturnValue('/home');
  mockEventkyEnabled.mockReturnValue(true);
  useSettingsStore.getState().setShowConfirm(true);
});

describe('EventkyPostContent', () => {
  it('renders native event details, locations and recurrence without a cover', () => {
    renderContent('event', {
      ...eventkyEventFixture,
      status: 'CANCELLED',
      rrule: 'FREQ=WEEKLY;COUNT=3',
      locations: [{ id: 'office', kind: 'PHYSICAL', label: 'Zurich meetup space', address: 'Main street' }],
    });
    expect(screen.getByRole('heading', { name: 'Pubky community meetup' })).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText(/1:30 PM EDT/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download calendar file' })).not.toBeInTheDocument();
    expect(screen.getByText('Repeats weekly')).toBeInTheDocument();
    expect(screen.getByText('Zurich meetup space')).toBeInTheDocument();
    expect(screen.queryByText(/schema_version/)).not.toBeInTheDocument();
    expect(mockAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: null, localAttachments: undefined }),
      undefined,
    );
  });

  it('uses the existing external-link confirmation and prevents parent navigation', () => {
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <TooltipProvider>
          <EventkyPostContent
            postId={postId}
            kind="event"
            content={JSON.stringify({ ...eventkyEventFixture, url: 'https://example.com/meetup' })}
            attachments={null}
            localAttachments={undefined}
          />
        </TooltipProvider>
      </div>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Event website' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('shows full Markdown on the canonical post page', () => {
    mockPathname.mockReturnValue('/post/author/id');
    renderContent('event', {
      ...eventkyEventFixture,
      styled_description: {
        format: 'markdown',
        content: 'Introduction.\n\n## Agenda\n\n- Discuss calendars\n- Build together',
      },
    });
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByText('Build together')).toBeInTheDocument();
  });

  it('links a calendar to its canonical URI and hides discovery when disabled', () => {
    const { unmount } = renderContent('calendar', eventkyCalendarFixture);
    const uri = `pubky://${'y'.repeat(52)}/pub/pubky.app/posts/0000000000001`;
    expect(screen.getByRole('link', { name: 'Upcoming events' })).toHaveAttribute(
      'href',
      `/calendar?calendar=${encodeURIComponent(uri)}`,
    );
    unmount();
    mockEventkyEnabled.mockReturnValue(false);
    renderContent('calendar', eventkyCalendarFixture);
    expect(screen.getByRole('heading', { name: 'Pubky gatherings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Upcoming events' })).not.toBeInTheDocument();
  });

  it.each([
    ['event', { ...eventkyEventFixture, schema_version: 99 }],
    [
      'event',
      {
        ...eventkyEventFixture,
        locations: [{ id: 'bad', kind: 'VIRTUAL', label: 'Unsafe', uri: 'javascript:alert(1)' }],
      },
    ],
    ['event', { secret: 'never render this' }],
    ['Event', eventkyEventFixture],
    ['vendor:event', { secret: 'never render this' }],
  ])('renders a safe fallback for unsupported %s formats', (kind, value) => {
    renderContent(kind, value);
    expect(screen.getByText('Unsupported post format')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByText(/never render this|schema_version/)).not.toBeInTheDocument();
    expect(mockAttachments).not.toHaveBeenCalled();
  });
});
