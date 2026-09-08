'use client';

import { useId, useState } from 'react';
import { type EventOccurrence, expandOccurrences } from '@eventky/recurrence';
import { isSupportedTimeZone, occurrenceKey } from '@eventky/temporal';
import { Controller } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Typography } from '@/atoms/Typography/Typography';
import type { useEventkyPostForm } from '@/hooks/useEventkyPostForm/useEventkyPostForm';
import { formatCalendarTime } from '@/libs/eventky/display';
import {
  movedOccurrenceTime,
  moveOccurrence,
  patchOccurrence,
  presetRule,
  previewWindow,
  type RecurrencePreset,
  recurrencePreset,
} from '@/libs/eventky/recurrenceEditor';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';

type State = ReturnType<typeof useEventkyPostForm>;

function OccurrenceEditor({ occurrence, state }: { occurrence: EventOccurrence; state: State }) {
  const id = useId();
  const [date, setDate] = useState(occurrence.start.value.slice(0, 10));
  const [time, setTime] = useState(
    occurrence.start.type === 'date' ? '00:00' : occurrence.start.value.slice(11).replace(/Z$/, ''),
  );
  const [title, setTitle] = useState(occurrence.event.summary);
  const [error, setError] = useState('');
  const apply = () => {
    const start = movedOccurrenceTime(occurrence.start, date, time);
    if (!start.ok) {
      setError(start.issues.join(' '));
      return;
    }
    state.form.setValue(
      'overrides',
      patchOccurrence(
        state.form.getValues('overrides'),
        occurrence.recurrence_id,
        moveOccurrence(occurrence, start.value, title),
      ),
      { shouldDirty: true, shouldValidate: true },
    );
  };
  return (
    <details className="rounded-md border border-input p-3">
      <summary className="cursor-pointer">
        {formatCalendarTime(occurrence.start)}
        {occurrence.event.status === 'CANCELLED' ? ' · Cancelled' : ''}
      </summary>
      <Container className="mt-3 gap-3">
        <Typography size="sm" className="text-muted-foreground">
          Original occurrence: {formatCalendarTime(occurrence.recurrence_id)}. Its discussion stays on the series post.
        </Typography>
        <Label htmlFor={`${id}-title`}>Title for this occurrence</Label>
        <Input id={`${id}-title`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} />
        <Label htmlFor={`${id}-date`}>Move to date</Label>
        <Input id={`${id}-date`} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        {occurrence.start.type !== 'date' && (
          <>
            <Label htmlFor={`${id}-time`}>Move to time</Label>
            <Input
              id={`${id}-time`}
              type="time"
              step={1}
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </>
        )}
        <Container overrideDefaults className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={apply}>
            Apply to this occurrence
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              state.form.setValue(
                'overrides',
                patchOccurrence(state.form.getValues('overrides'), occurrence.recurrence_id, { status: 'CANCELLED' }),
                { shouldDirty: true },
              )
            }
          >
            Cancel this occurrence
          </Button>
        </Container>
        {error && (
          <Typography role="alert" size="sm">
            {error}
          </Typography>
        )}
      </Container>
    </details>
  );
}

export function EventkyRecurrenceEditor({ state }: { state: State }) {
  const id = useId();
  const [date, setDate] = useState(state.form.getValues('startDate'));
  const [preview, setPreview] = useState<{ signature: string; items: EventOccurrence[]; message: string } | null>(null);
  const values = state.form.watch();
  const signature = JSON.stringify(values);
  const overrides = values.overrides;
  const refresh = () => {
    const event = state.previewEvent();
    if (!event.ok) {
      setPreview({ signature, items: [], message: event.issues.join(' ') });
      return;
    }
    const timezone =
      values.timeMode === 'zoned' && isSupportedTimeZone(values.timezone)
        ? values.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const window = previewWindow(date, timezone);
    if (!window.ok) {
      setPreview({ signature, items: [], message: window.issues.join(' ') });
      return;
    }
    const result = expandOccurrences(event.value, {
      ...window.value,
      timezone,
      maxOccurrences: 30,
      maxIterations: 20000,
    });
    setPreview({
      signature,
      items: result.occurrences,
      message:
        result.status === 'complete' ? 'Occurrences in the next 90 days (up to 30 shown).' : result.issues.join(' '),
    });
  };
  return (
    <Container className="gap-4">
      <Label htmlFor={`${id}-repeat`}>Repeats</Label>
      <Controller
        name="recurrence"
        control={state.form.control}
        render={({ field }) => (
          <select
            id={`${id}-repeat`}
            className="rounded-md border border-input bg-background p-2"
            value={recurrencePreset(field.value)}
            onChange={(event) =>
              field.onChange(presetRule(event.target.value as RecurrencePreset, values.startDate, field.value))
            }
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Weekly on this weekday</option>
            <option value="monthly">Monthly on this date</option>
            <option value="yearly">Yearly on this date</option>
            <option value="custom">Custom rule</option>
          </select>
        )}
      />
      {values.recurrence && (
        <>
          <ControlledInputField
            name="recurrence"
            control={state.form.control}
            label="Recurrence rule"
            placeholder="FREQ=WEEKLY;INTERVAL=2;COUNT=10"
          />
          <Typography size="sm" className="text-muted-foreground">
            Use INTERVAL for spacing, COUNT for a fixed number, or UNTIL for the last date. Monthly dates that do not
            exist are skipped. All occurrences share this post’s comments and tags.
          </Typography>
        </>
      )}
      <Container overrideDefaults className="flex flex-wrap items-end gap-2">
        <Container className="gap-2">
          <Label htmlFor={`${id}-preview`}>Preview from</Label>
          <Input
            id={`${id}-preview`}
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setPreview(null);
            }}
          />
        </Container>
        <Button type="button" variant="secondary" size="sm" onClick={refresh}>
          Preview occurrences
        </Button>
      </Container>
      {preview && (
        <>
          <Typography role="status" size="sm">
            {preview.signature !== signature
              ? 'The draft changed. Refresh the preview to edit occurrences.'
              : preview.message}
          </Typography>
          {preview.signature === signature &&
            preview.items.map((item) => <OccurrenceEditor key={item.key} occurrence={item} state={state} />)}
        </>
      )}
      {overrides.length > 0 && (
        <Container className="gap-2">
          <Typography size="sm">Changes to individual occurrences ({overrides.length})</Typography>
          {overrides.map((item) => (
            <Container
              key={occurrenceKey(item.recurrence_id)}
              overrideDefaults
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-input p-2"
            >
              <Typography size="sm">
                {formatCalendarTime(item.recurrence_id)}
                {item.changes.status === 'CANCELLED' ? ' · Cancelled' : ' · Edited'}
              </Typography>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  state.form.setValue(
                    'overrides',
                    overrides.filter(
                      (candidate) => occurrenceKey(candidate.recurrence_id) !== occurrenceKey(item.recurrence_id),
                    ),
                    { shouldDirty: true },
                  )
                }
              >
                Restore from series
              </Button>
            </Container>
          ))}
        </Container>
      )}
    </Container>
  );
}
