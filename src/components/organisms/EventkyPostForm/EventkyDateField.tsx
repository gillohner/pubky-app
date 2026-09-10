'use client';

import { useId } from 'react';
import { Controller } from 'react-hook-form';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import type { useEventkyPostForm } from '@/hooks/useEventkyPostForm/useEventkyPostForm';
import { EventkyDatePicker } from '@/molecules/EventkyDatePicker/EventkyDatePicker';

type DateName = 'startDate' | 'endDate' | 'startTime' | 'endTime';

/** ShadCN date-picker composition; date values remain civil dates without UTC conversion. */
export function EventkyDateField({
  state,
  name,
  label,
  type,
}: {
  state: Pick<ReturnType<typeof useEventkyPostForm>, 'form'>;
  name: DateName;
  label: string;
  type: 'date' | 'time';
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Controller
        control={state.form.control}
        name={name}
        render={({ field, fieldState }) => {
          return (
            <>
              {type === 'time' ? (
                <Input
                  {...field}
                  id={id}
                  type="time"
                  step={1}
                  className="scheme-dark"
                  aria-invalid={!!fieldState.error}
                />
              ) : (
                <EventkyDatePicker
                  id={id}
                  ref={field.ref}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  invalid={!!fieldState.error}
                />
              )}
              {fieldState.error && (
                <p role="alert" className="text-sm text-destructive">
                  {fieldState.error.message}
                </p>
              )}
            </>
          );
        }}
      />
    </div>
  );
}
