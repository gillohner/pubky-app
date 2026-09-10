'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Controller, useWatch } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Input } from '@/atoms/Input/Input';
import type { useEventkyPostForm } from '@/hooks/useEventkyPostForm/useEventkyPostForm';
import { useSearchAutocomplete } from '@/hooks/useSearchAutocomplete/useSearchAutocomplete';
import { useUserDetailsFromIds } from '@/hooks/useUserDetailsFromIds/useUserDetailsFromIds';

export function EventkyContributorPicker({ state }: { state: Pick<ReturnType<typeof useEventkyPostForm>, 'form'> }) {
  const [query, setQuery] = useState('');
  const contributors = useWatch({ control: state.form.control, name: 'contributors' });
  const selected = contributors.split('\n').filter(Boolean);
  const { users: selectedUsers } = useUserDetailsFromIds({ userIds: selected });
  const { users, isLoading } = useSearchAutocomplete({ query, enabled: query.trim().length >= 2 });
  return (
    <Controller
      control={state.form.control}
      name="contributors"
      render={({ field }) => (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Contributors</p>
          <Input
            aria-label="Find contributors"
            placeholder="Search people by name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {selected.map((id, index) => (
            <div key={id} className="flex items-center justify-between gap-2 text-sm">
              <span>{selectedUsers.find((user) => user.id === id)?.name ?? `Contributor ${index + 1}`}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${selectedUsers.find((user) => user.id === id)?.name ?? `contributor ${index + 1}`}`}
                onClick={() => field.onChange(selected.filter((value) => value !== id).join('\n'))}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          {query && isLoading && <p className="text-sm text-muted-foreground">Searching people…</p>}
          {query.trim().length >= 2 && !isLoading && !users.length && (
            <p className="text-sm text-muted-foreground">No matching people.</p>
          )}
          {query && (
            <div className="max-h-48 overflow-y-auto">
              {users
                .filter((user) => !selected.includes(user.id))
                .map((user) => (
                  <Button
                    key={user.id}
                    type="button"
                    variant="ghost"
                    className="w-full justify-start rounded-md"
                    onClick={() => {
                      field.onChange([...selected, user.id].join('\n'));
                      setQuery('');
                    }}
                  >
                    {user.name}
                  </Button>
                ))}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Contributors can add their own events. They cannot edit your posts.
          </p>
        </div>
      )}
    />
  );
}
