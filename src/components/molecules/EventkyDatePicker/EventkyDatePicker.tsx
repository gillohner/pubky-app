'use client';

import { forwardRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { Button } from '@/atoms/Button/Button';
import { Popover, PopoverContent, PopoverTrigger } from '@/atoms/Popover/Popover';

export interface EventkyDatePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  invalid?: boolean;
}

/** A civil-date picker: selecting a day never converts it through UTC. Weeks start on Monday. */
export const EventkyDatePicker = forwardRef<HTMLButtonElement, EventkyDatePickerProps>(function EventkyDatePicker(
  { id, value, onChange, onBlur, disabled, invalid },
  ref,
) {
  const [open, setOpen] = useState(false);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : undefined;
  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          ref={ref}
          onBlur={onBlur}
          type="button"
          variant="outline"
          className="justify-start rounded-md font-normal"
          aria-invalid={invalid}
          disabled={disabled}
        >
          <CalendarDays className="size-4" />
          {date
            ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Choose date'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <DayPicker
          mode="single"
          selected={date}
          defaultMonth={date}
          weekStartsOn={1}
          showOutsideDays
          onSelect={(selected) => {
            if (!selected) return;
            onChange(
              `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`,
            );
            setOpen(false);
          }}
          classNames={{
            root: 'relative',
            months: 'flex flex-col',
            month: 'space-y-3',
            month_caption: 'flex h-9 items-center justify-center text-sm font-medium',
            nav: 'absolute inset-x-0 top-0 flex justify-between',
            button_previous: 'flex size-9 items-center justify-center rounded-md hover:bg-accent',
            button_next: 'flex size-9 items-center justify-center rounded-md hover:bg-accent',
            month_grid: 'border-collapse',
            weekdays: 'flex',
            weekday: 'w-9 text-center text-xs font-normal text-muted-foreground',
            week: 'mt-1 flex',
            day: 'size-9 text-center text-sm',
            day_button: 'size-9 rounded-md hover:bg-accent focus-visible:outline-ring',
            selected: '[&>button]:bg-brand [&>button]:text-background',
            today: '[&>button]:ring-1 [&>button]:ring-brand',
            outside: 'text-muted-foreground opacity-50',
          }}
          components={{
            Chevron: ({ orientation }) =>
              orientation === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />,
          }}
        />
      </PopoverContent>
    </Popover>
  );
});
