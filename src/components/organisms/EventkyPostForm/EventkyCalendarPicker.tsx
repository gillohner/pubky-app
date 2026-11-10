'use client';

import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { Input } from '@/atoms/Input/Input';
import { useEventkyCalendars } from '@/hooks/useEventkyCalendar/useEventkyCalendars';
import type { useEventkyPostForm } from '@/hooks/useEventkyPostForm/useEventkyPostForm';
import { useAuthStore } from '@/stores/auth/auth.store';

export function EventkyCalendarPicker({ state }: { state: Pick<ReturnType<typeof useEventkyPostForm>, 'form'> }) {
  const { calendars, isLoading, error, hasMore, loadMore } = useEventkyCalendars();
  const author = useAuthStore((store) => store.currentUserPubky);
  const [query, setQuery] = useState('');
  return (
    <Controller
      control={state.form.control}
      name="calendarUris"
      render={({ field }) => {
        const selected = field.value.split('\n').filter(Boolean);
        const options = calendars.filter(
          ({ id, uri, name, calendar }) =>
            (selected.includes(uri) || id.split(':')[0] === author || calendar.contributors?.includes(author ?? '')) &&
            name.toLowerCase().includes(query.toLowerCase()),
        );
        const unavailable = selected.filter((uri) => !calendars.some((calendar) => calendar.uri === uri));
        return (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Calendars</p>
            <Input
              aria-label="Find calendars"
              placeholder="Find a calendar"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="flex max-h-48 flex-col gap-3 overflow-y-auto">
              {options.map(({ uri, name }) => (
                <Checkbox
                  key={uri}
                  label={name}
                  checked={selected.includes(uri)}
                  onCheckedChange={(checked) =>
                    field.onChange(
                      (checked ? [...new Set([...selected, uri])] : selected.filter((value) => value !== uri)).join(
                        '\n',
                      ),
                    )
                  }
                />
              ))}
              {unavailable.map((uri, index) => (
                <Checkbox
                  key={uri}
                  label={`Unavailable calendar ${index + 1}`}
                  checked
                  onCheckedChange={() => field.onChange(selected.filter((value) => value !== uri).join('\n'))}
                />
              ))}
            </div>
            {isLoading && <p className="text-sm text-muted-foreground">Loading calendars…</p>}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {!isLoading && !error && !options.length && (
              <p className="text-sm text-muted-foreground">
                {query ? 'No matching calendars.' : 'Your calendars and calendars you contribute to appear here.'}
              </p>
            )}
            {(hasMore || error) && (
              <Button type="button" variant="ghost" size="sm" disabled={isLoading} onClick={loadMore}>
                {error ? 'Retry' : 'Load more calendars'}
              </Button>
            )}
          </div>
        );
      }}
    />
  );
}
