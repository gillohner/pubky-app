'use client';

import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { Input } from '@/atoms/Input/Input';
import { useEventkyEvents } from '@/hooks/useEventkyPostForm/useEventkyEvents';
import type { useEventkyPostForm } from '@/hooks/useEventkyPostForm/useEventkyPostForm';

/** Calendar owners curate membership without changing an event or its discussion. */
export function EventkyExclusionPicker({
  state,
}: {
  state: Pick<ReturnType<typeof useEventkyPostForm>, 'form' | 'postId'>;
}) {
  const { events, isLoading, error, hasMore, loadMore } = useEventkyEvents();
  const [query, setQuery] = useState('');
  const calendarUri = state.postId ? `pubky://${state.postId.replace(':', '/pub/pubky.app/posts/')}` : undefined;
  return (
    <Controller
      control={state.form.control}
      name="excludedEventUris"
      render={({ field }) => {
        const excluded = field.value.split('\n').filter(Boolean);
        const candidates = events.filter(
          ({ uri, name, event }) =>
            (excluded.includes(uri) || (calendarUri && event.calendar_uris?.includes(calendarUri))) &&
            name.toLowerCase().includes(query.toLowerCase()),
        );
        return (
          <details className="rounded-md border border-input p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Excluded events{excluded.length ? ` (${excluded.length})` : ''}
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Hide selected events from this calendar. Their posts and discussions stay available.
              </p>
              <Input
                aria-label="Find events to exclude"
                placeholder="Find an event"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {candidates.map(({ uri, name }) => (
                <Checkbox
                  key={uri}
                  label={name}
                  checked={excluded.includes(uri)}
                  onCheckedChange={(checked) =>
                    field.onChange(
                      (checked ? [...excluded, uri] : excluded.filter((value) => value !== uri)).join('\n'),
                    )
                  }
                />
              ))}
              {excluded
                .filter((uri) => !events.some((event) => event.uri === uri))
                .map((uri, index) => (
                  <Checkbox
                    key={uri}
                    label={`Unavailable event ${index + 1}`}
                    checked
                    onCheckedChange={() => field.onChange(excluded.filter((value) => value !== uri).join('\n'))}
                  />
                ))}
              {isLoading && <p className="text-sm text-muted-foreground">Loading events…</p>}
              {!isLoading && !error && !candidates.length && (
                <p className="text-sm text-muted-foreground">No matching events in this calendar.</p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {(hasMore || error) && (
                <Button type="button" variant="ghost" size="sm" disabled={isLoading} onClick={loadMore}>
                  {error ? 'Retry' : 'Load more events'}
                </Button>
              )}
            </div>
          </details>
        );
      }}
    />
  );
}
