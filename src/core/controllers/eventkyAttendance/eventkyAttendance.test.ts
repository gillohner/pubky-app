import { beforeEach, expect, it, vi } from 'vitest';
import { EventkyAttendanceController } from './eventkyAttendance';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  persist: vi.fn(),
  auth: { currentUserPubky: 'viewer' },
  backend: 'nexus-a',
}));
vi.mock('@/application/eventkyAttendance/eventkyAttendance', () => ({
  EventkyAttendanceApplication: { fetchReplies: mocks.fetch },
}));
vi.mock('@/application/post/post', () => ({ PostApplication: { persistEventkyReplies: mocks.persist } }));
vi.mock('@/config/nexus', () => ({ getNexusUrl: () => mocks.backend }));
vi.mock('@/stores/auth/auth.store', () => ({ useAuthStore: { getState: () => mocks.auth } }));
const batch = { sources: [], posts: [], complete: true, nextSkip: null };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUserPubky = 'viewer';
  mocks.backend = 'nexus-a';
  mocks.fetch.mockResolvedValue(batch);
  mocks.persist.mockResolvedValue({ ...batch, acknowledged: [] });
});
it('deduplicates concurrent roster/discussion reads including hydration', async () => {
  await Promise.all([
    EventkyAttendanceController.fetchReplies('owner:event'),
    EventkyAttendanceController.fetchReplies('owner:event'),
  ]);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.persist).toHaveBeenCalledTimes(1);
});
it('does not hydrate a response into another viewer or backend context', async () => {
  mocks.fetch.mockImplementation(async () => {
    mocks.auth.currentUserPubky = 'another';
    mocks.backend = 'nexus-b';
    return batch;
  });
  await EventkyAttendanceController.fetchReplies('owner:event');
  expect(mocks.persist).not.toHaveBeenCalled();
});
