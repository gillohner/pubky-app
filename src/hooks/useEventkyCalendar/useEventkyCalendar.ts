'use client';

import { useEffect, useState } from 'react';
import { parseEventkyContent } from '@eventky/contract';
import { occurrenceKey } from '@eventky/temporal';
import type { OccurrencePage, OccurrenceQuery } from '@eventky-api/types';
import { useLiveQuery } from 'dexie-react-hooks';
import { EventkyController } from '@/controllers/eventky/eventky';
import { PostController } from '@/controllers/post/post';
import { useMutedUsers } from '@/hooks/useMutedUsers/useMutedUsers';
import { eventkySourceHash } from '@/libs/eventky/sourceHash';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useSettingsStore } from '@/stores/settings/settings.store';
import type { CalendarOccurrence } from './useEventkyCalendar.types';

export function useEventkyCalendar(query: OccurrenceQuery | null) {
  const viewerId = useAuthStore((state) => state.currentUserPubky);
  const blurCensored = useSettingsStore((state) => state.privacy.blurCensored);
  const { mutedUserIdSet, isLoading: isLoadingMutedUsers } = useMutedUsers();
  const key = JSON.stringify([query, viewerId]);
  const [request, setRequest] = useState<{ key: string; page?: OccurrencePage; error?: string; loading: boolean }>({
    key: '',
    loading: false,
  });
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!query) return;
    const abort = new AbortController();
    let running = false;
    const load = async () => {
      if (running || abort.signal.aborted) return;
      running = true;
      setRequest((previous) => ({ key, page: previous.key === key ? previous.page : undefined, loading: true }));
      let result = await EventkyController.fetchOccurrences(query, abort.signal);
      if (!result.ok && result.code === 'STALE_CURSOR' && !abort.signal.aborted)
        result = await EventkyController.fetchOccurrences(query, abort.signal);
      if (!result.ok) {
        if (!abort.signal.aborted)
          setRequest({
            key,
            loading: false,
            error:
              result.code === 'INVALID_QUERY'
                ? 'Choose a valid date range, timezone and calendar.'
                : 'Calendar results are unavailable. Try refreshing.',
          });
        running = false;
        return;
      }
      const unique = [...new Map(result.value.items.map((item) => [item.post_id, item])).values()];
      // Hydrate normal posts through their own controller. Projection data never creates social records.
      for (let offset = 0; offset < unique.length && !abort.signal.aborted; offset += 8) {
        await Promise.allSettled(
          unique.slice(offset, offset + 8).map(async (item) => {
            const post = await PostController.getOrFetch({
              compositeId: item.post_id,
              viewerId: viewerId ?? undefined,
            });
            if (!post || (await eventkySourceHash(post.kind, post.content)) !== item.source_hash)
              await PostController.fetch({ compositeId: item.post_id, viewerId: viewerId ?? undefined });
          }),
        );
      }
      if (!abort.signal.aborted) setRequest({ key, page: result.value, loading: false });
      running = false;
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      abort.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // The serialized query key makes object recreation harmless while preserving exact filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshCount]);

  const page = request.key === key ? request.page : undefined;
  const viewerFilterKey = JSON.stringify([blurCensored, [...mutedUserIdSet].sort()]);
  const hydrated = useLiveQuery(async () => {
    if (!page) return undefined;
    const items: CalendarOccurrence[] = [];
    let hidden = 0;
    let unavailable = 0;
    let mismatched = 0;
    const ids = [...new Set(page.items.map((item) => item.post_id))];
    const posts = await Promise.all(
      ids.map(
        async (compositeId) =>
          [compositeId, await PostController.getDetails({ compositeId }).catch(() => null)] as const,
      ),
    );
    const postMap = new Map(posts);
    const hashes = new Map(
      await Promise.all(
        posts.map(
          async ([id, post]) =>
            [id, post ? await eventkySourceHash(post.kind, post.content).catch(() => null) : null] as const,
        ),
      ),
    );
    for (const projection of page.items) {
      const post = postMap.get(projection.post_id);
      if (!post) {
        unavailable++;
        continue;
      }
      const author = projection.post_id.split(':')[0];
      if (mutedUserIdSet.has(author) || post.is_blurred) {
        hidden++;
        continue;
      }
      const expectedUri = `pubky://${projection.post_id.replace(':', '/pub/pubky.app/posts/')}`;
      if (hashes.get(post.id) !== projection.source_hash || expectedUri !== projection.post_uri) {
        mismatched++;
        continue;
      }
      const parsed = parseEventkyContent(post.kind, post.content);
      if (parsed.status !== 'supported' || parsed.kind !== 'event') {
        unavailable++;
        continue;
      }
      const source = parsed.value;
      const patch = source.overrides?.find(
        (override) => occurrenceKey(override.recurrence_id) === projection.occurrence_key,
      )?.changes;
      items.push({
        projection,
        sourceContent: post.content,
        event: {
          ...source,
          dtstart: projection.start,
          dtend: projection.end,
          duration: undefined,
          status: projection.status,
          summary: patch?.summary ?? source.summary,
          description: patch?.description === undefined ? source.description : (patch.description ?? undefined),
          styled_description:
            patch?.styled_description === undefined
              ? source.styled_description
              : (patch.styled_description ?? undefined),
          locations: patch?.locations === undefined ? source.locations : (patch.locations ?? undefined),
          url: patch?.url === undefined ? source.url : (patch.url ?? undefined),
          transp: patch?.transp === undefined ? source.transp : (patch.transp ?? undefined),
          alarms: patch?.alarms === undefined ? source.alarms : (patch.alarms ?? undefined),
        },
      });
    }
    return { page, viewerFilterKey, items, hidden, unavailable, mismatched };
  }, [page, viewerFilterKey]);

  const error = request.key === key ? request.error : undefined;
  const current =
    hydrated?.page === page && hydrated?.viewerFilterKey === viewerFilterKey && !isLoadingMutedUsers
      ? hydrated
      : undefined;
  return {
    items: current?.items ?? [],
    hidden: current?.hidden ?? 0,
    isLoading: !!query && !error && (!page || !current),
    isRefreshing: request.key === key && request.loading,
    error,
    coverage: page?.coverage,
    incomplete: !!page && (!page.coverage.complete || !!current?.unavailable || !!current?.mismatched),
    stale: !!current?.mismatched,
    refresh: () => setRefreshCount((value) => value + 1),
  };
}
