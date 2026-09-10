'use client';

import { useId } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { Controller } from 'react-hook-form';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import type { useEventkyPostForm } from '@/hooks/useEventkyPostForm/useEventkyPostForm';

/** Friendly units on screen, RFC duration in the form's serialized contract. */
export function EventkyDurationField({ state }: { state: Pick<ReturnType<typeof useEventkyPostForm>, 'form'> }) {
  const id = useId();
  return (
    <Controller
      control={state.form.control}
      name="duration"
      render={({ field }) => {
        let hours = 1;
        let minutes = 0;
        let seconds = 0;
        try {
          const duration = Temporal.Duration.from(field.value);
          hours = duration.weeks * 168 + duration.days * 24 + duration.hours;
          minutes = duration.minutes;
          seconds = duration.seconds;
        } catch {
          /* An invalid saved draft is replaced when the author enters a duration. */
        }
        const update = (nextHours: number, nextMinutes: number, nextSeconds = seconds) =>
          field.onChange(`PT${nextHours}H${nextMinutes}M${nextSeconds}S`);
        return (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-hours`}>Hours</Label>
              <Input
                id={`${id}-hours`}
                type="number"
                min={0}
                value={hours}
                onChange={(event) => update(Math.max(0, Number(event.target.value)), minutes)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-minutes`}>Minutes</Label>
              <Input
                id={`${id}-minutes`}
                type="number"
                min={0}
                max={59}
                value={minutes}
                onChange={(event) => update(hours, Math.max(0, Math.min(59, Number(event.target.value))))}
              />
            </div>
            {seconds !== 0 && (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-seconds`}>Seconds</Label>
                <Input
                  id={`${id}-seconds`}
                  type="number"
                  min={0}
                  max={59}
                  value={seconds}
                  onChange={(event) => update(hours, minutes, Math.max(0, Math.min(59, Number(event.target.value))))}
                />
              </div>
            )}
          </div>
        );
      }}
    />
  );
}
