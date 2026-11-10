import { beforeEach, expect, it } from 'vitest';
import { useEventkyReplyWritesStore as store } from './eventkyReplyWrites.store';

beforeEach(() => store.setState({ pending: {}, expected: {} }));
it('does not acknowledge a newer pending edit using an older hydration result', () => {
  store.getState().add('context', 'reply', 'old prepared source');
  const old = store.getState().expected.context;
  store.getState().add('context', 'reply', 'new prepared source');
  store.getState().acknowledge('context', ['reply'], old);
  expect(store.getState().pending.context).toEqual(['reply']);
});
