import { FIXTURE_CALENDAR_URI } from '@eventky/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventkyFeedProxyController } from './eventky-feed-proxy';

const { read, enabled } = vi.hoisted(() => ({ read: vi.fn(), enabled: vi.fn() }));
vi.mock('@/application/eventky-feed-proxy/eventky-feed-proxy', () => ({ EventkyFeedProxyApplication: { read } }));
vi.mock('@/libs/runtime-config/runtime-config', () => ({ getEventkyCalendarEnabled: enabled }));
beforeEach(() => {
  vi.clearAllMocks();
  enabled.mockReturnValue(true);
  read.mockResolvedValue({ status: 200, headers: {}, body: '' });
});

describe('calendar feed request validation', () => {
  it('rejects arbitrary fetch targets, duplicate and extra query fields before transport', async () => {
    for (const query of [
      new URLSearchParams({ calendar: 'https://example.org' }),
      new URLSearchParams([
        ['calendar', FIXTURE_CALENDAR_URI],
        ['calendar', FIXTURE_CALENDAR_URI],
      ]),
      new URLSearchParams({ calendar: FIXTURE_CALENDAR_URI, url: 'https://example.org' }),
    ]) {
      expect((await EventkyFeedProxyController.read(query, {})).status).toBe(400);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('allows public canonical calendar requests and respects the feature switch', async () => {
    const parameters = new URLSearchParams({ calendar: FIXTURE_CALENDAR_URI });
    expect((await EventkyFeedProxyController.read(parameters, {})).status).toBe(200);
    expect(read).toHaveBeenCalledWith(FIXTURE_CALENDAR_URI, {});
    enabled.mockReturnValue(false);
    expect((await EventkyFeedProxyController.read(parameters, { head: true })).status).toBe(503);
  });
});
