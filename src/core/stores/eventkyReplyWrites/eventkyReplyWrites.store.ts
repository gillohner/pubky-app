import { create } from 'zustand';

export const eventkyReplyContext = (backend: string, viewer: string | null | undefined, eventId: string) =>
  JSON.stringify([backend, viewer ?? null, eventId]);
const EMPTY: string[] = [];
export const useEventkyReplyWritesStore = create<{
  pending: Record<string, string[]>;
  expected: Record<string, Record<string, string>>;
  add: (context: string, id: string, expectedSource: string) => void;
  acknowledge: (context: string, ids: string[], expected?: Record<string, string>) => void;
}>((set) => ({
  pending: {},
  expected: {},
  add: (context, id, expectedSource) =>
    set((state) => ({
      pending: { ...state.pending, [context]: [...new Set([...(state.pending[context] ?? EMPTY), id])] },
      expected: { ...state.expected, [context]: { ...state.expected[context], [id]: expectedSource } },
    })),
  acknowledge: (context, ids, versions) =>
    set((state) => {
      const previous = state.pending[context];
      const matches = ids.filter((id) => !versions || state.expected[context]?.[id] === versions[id]);
      if (!previous?.some((id) => matches.includes(id))) return state;
      const remaining = previous.filter((id) => !matches.includes(id));
      const pending = { ...state.pending };
      const expected = { ...state.expected };
      if (remaining.length) {
        pending[context] = remaining;
        expected[context] = Object.fromEntries(remaining.map((id) => [id, state.expected[context][id]]));
      } else {
        delete pending[context];
        delete expected[context];
      }
      return { pending, expected };
    }),
}));
export const EMPTY_PENDING_EVENTKY_REPLIES = EMPTY;
