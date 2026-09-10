'use client';

import { useId, useState } from 'react';
import { Globe } from 'lucide-react';
import { useWatch } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Popover, PopoverContent, PopoverTrigger } from '@/atoms/Popover/Popover';
import type { useEventkyPostForm } from '@/hooks/useEventkyPostForm/useEventkyPostForm';

/** Event authoring timezone; calendar display always follows the device. */
export function EventkyTimezoneField({ state }: { state: Pick<ReturnType<typeof useEventkyPostForm>, 'form'> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [timezone, timeMode] = useWatch({ control: state.form.control, name: ['timezone', 'timeMode'] });
  const zones = [...new Set([timezone, 'UTC', ...Intl.supportedValuesOf('timeZone')])];
  const matching = zones.filter((zone) => zone.replaceAll('_', ' ').toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>Event timezone</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" className="justify-start rounded-md font-normal">
            <Globe className="size-4" />
            <span className="truncate">
              {timeMode === 'floating' ? 'Local time wherever viewed' : timezone.replaceAll('_', ' ')}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-2">
          <Input
            aria-label="Search timezones"
            placeholder="Search city or timezone"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="mt-2 max-h-60 overflow-y-auto" aria-label="Timezones">
            {matching.map((zone) => (
              <Button
                key={zone}
                type="button"
                variant="ghost"
                className="w-full justify-start rounded-md font-normal"
                aria-pressed={zone === timezone && timeMode !== 'floating'}
                onClick={() => {
                  state.form.setValue('timezone', zone, { shouldDirty: true, shouldValidate: true });
                  state.form.setValue('timeMode', zone === 'UTC' ? 'utc' : 'zoned', { shouldDirty: true });
                  setOpen(false);
                  setQuery('');
                }}
              >
                {zone.replaceAll('_', ' ')}
              </Button>
            ))}
            {!matching.length && <p className="p-3 text-sm text-muted-foreground">No matching timezones.</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
