'use client';

import { useId } from 'react';
import { CalendarDays, ImagePlus, Loader2, Send } from 'lucide-react';
import { Controller } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { Container } from '@/atoms/Container/Container';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Typography } from '@/atoms/Typography/Typography';
import type { useEventkyPostForm } from '@/hooks/useEventkyPostForm/useEventkyPostForm';
import type { EventkyPostFormData, EventkyPostKind } from '@/hooks/useEventkyPostForm/useEventkyPostForm.types';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';
import { ControlledTextareaField } from '@/molecules/ControlledTextareaField/ControlledTextareaField';
import { MarkdownEditor } from '@/molecules/MarkdownEditor/MarkdownEditor';
import { PostInputAttachments } from '@/molecules/PostInputAttachments/PostInputAttachments';
import { PostInputTags } from '@/organisms/PostInputTags/PostInputTags';
import { EventkyRecurrenceEditor } from './EventkyRecurrenceEditor';

type FormState = ReturnType<typeof useEventkyPostForm>;
type TextField = {
  [K in keyof EventkyPostFormData]: EventkyPostFormData[K] extends string ? K : never;
}[keyof EventkyPostFormData];

function DateField({
  state,
  name,
  label,
  type,
}: {
  state: FormState;
  name: TextField;
  label: string;
  type: 'date' | 'time';
}) {
  const id = useId();
  return (
    <Container className="gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Controller
        control={state.form.control}
        name={name}
        render={({ field, fieldState }) => (
          <>
            <Input
              {...field}
              id={id}
              type={type}
              className="scheme-dark"
              step={type === 'time' ? 1 : undefined}
              aria-invalid={!!fieldState.error}
            />
            {fieldState.error && (
              <Typography size="sm" role="alert">
                {fieldState.error.message}
              </Typography>
            )}
          </>
        )}
      />
    </Container>
  );
}

/** Uses the same editor, attachment picker, tag controls and design tokens as the post composer. */
export function EventkyPostForm({
  state,
  kind,
  onSubmit,
}: {
  state: FormState;
  kind: EventkyPostKind;
  onSubmit: () => void;
}) {
  const { form, isEditing, pendingRetry } = state;
  const {
    fileInputRef,
    attachments,
    setAttachments,
    existingAttachments,
    removeExisting,
    handleFilesAdded,
    openPicker,
    ready,
  } = state.files;
  const allDay = form.watch('allDay');
  const useDuration = form.watch('useDuration');
  const timeMode = form.watch('timeMode');
  const busy = form.formState.isSubmitting;
  const input = (name: TextField, label: string, placeholder?: string) => (
    <ControlledInputField
      name={name}
      control={form.control}
      label={label}
      placeholder={placeholder}
      maxLength={name === 'title' ? (kind === 'calendar' ? 100 : 500) : undefined}
    />
  );
  const check = (name: 'allDay' | 'useDuration' | 'transparent', label: string) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Checkbox checked={field.value} onCheckedChange={(value) => field.onChange(value === true)} label={label} />
      )}
    />
  );
  return (
    <Container className="gap-5" data-cy="eventky-post-form">
      <Typography size="sm" className="text-muted-foreground">
        {kind === 'event'
          ? 'Publish an event with comments, tags, bookmarks and reposts.'
          : 'Publish a calendar and curate events from you and your contributors.'}{' '}
        All published details are public.
      </Typography>
      <fieldset disabled={busy || pendingRetry} className="flex min-w-0 flex-col gap-5">
        {input('title', kind === 'event' ? 'Event title' : 'Calendar name')}
        <Container className="gap-2">
          <Label>{kind === 'event' ? 'Description' : 'About this calendar'}</Label>
          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <>
                <MarkdownEditor
                  markdown={field.value}
                  onChange={field.onChange}
                  readOnly={busy || pendingRetry}
                  placeholder="Add details…"
                />
                {fieldState.error && <Typography role="alert">{fieldState.error.message}</Typography>}
              </>
            )}
          />
        </Container>
        {kind === 'event' ? (
          <>
            {check('allDay', 'All-day event')}
            <Container overrideDefaults className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DateField state={state} name="startDate" label="Start date" type="date" />
              {!allDay && <DateField state={state} name="startTime" label="Start time" type="time" />}
              {(!useDuration || allDay) && (
                <DateField
                  state={state}
                  name="endDate"
                  label={allDay ? 'Last day (inclusive)' : 'End date'}
                  type="date"
                />
              )}
              {!allDay && !useDuration && <DateField state={state} name="endTime" label="End time" type="time" />}
            </Container>
            {!allDay && (
              <>
                <Label htmlFor="eventky-time-mode">Time interpretation</Label>
                <Controller
                  control={form.control}
                  name="timeMode"
                  render={({ field }) => (
                    <select
                      {...field}
                      id="eventky-time-mode"
                      className="rounded-md border border-input bg-background p-2"
                    >
                      <option value="zoned">Named timezone</option>
                      <option value="utc">UTC</option>
                      <option value="floating">Local time wherever viewed</option>
                    </select>
                  )}
                />
                {timeMode === 'zoned' && input('timezone', 'Timezone', 'Europe/Zurich')}
                {check('useDuration', 'Set a duration instead of an end time')}
                {useDuration && input('duration', 'Duration', 'PT1H30M')}
              </>
            )}
            <Container overrideDefaults className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {input('location', 'Venue or location')}
              {input('locationUrl', 'Location link', 'https://…')}
              {input('onlineUrl', 'Online meeting link', 'https://…')}
              {input('website', 'Event website', 'https://…')}
            </Container>
            <details className="rounded-md border border-input p-4">
              <summary className="cursor-pointer font-medium">Recurrence and advanced details</summary>
              <Container className="mt-4 gap-4">
                <EventkyRecurrenceEditor state={state} />
                <Label htmlFor="eventky-status">Status</Label>
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <select {...field} id="eventky-status" className="rounded-md border border-input bg-background p-2">
                      <option value="CONFIRMED">Confirmed</option>
                      <option value="TENTATIVE">Tentative</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  )}
                />
                {input('organizerName', 'Organizer name')}
                {input('organizerUrl', 'Organizer contact link', 'mailto:…')}
                {input('categories', 'Calendar categories', 'Community, Workshop')}
                {check('transparent', 'Show this time as free')}
                <ControlledTextareaField
                  name="calendarUris"
                  control={form.control}
                  label="Calendars"
                  placeholder="One pubky://…/pub/pubky.app/posts/… calendar link per line"
                  rows={3}
                />
                <Typography size="sm" className="text-muted-foreground">
                  An event appears in a calendar when its author is the owner or an approved contributor. Calendar
                  categories are separate from the social tags below.
                </Typography>
              </Container>
            </details>
          </>
        ) : (
          <>
            {input('timezone', 'Default timezone', 'Europe/Zurich')}
            {input('color', 'Calendar color', '#6757E8')}
            {input('website', 'Calendar website', 'https://…')}
            <ControlledTextareaField
              name="contributors"
              control={form.control}
              label="Contributors"
              placeholder="One public key per line"
              rows={3}
            />
            <Typography size="sm" className="text-muted-foreground">
              Contributors can include their own events in this calendar. They cannot edit your posts.
            </Typography>
            <ControlledTextareaField
              name="excludedEventUris"
              control={form.control}
              label="Excluded events"
              placeholder="One event post link per line"
              rows={3}
            />
            <Typography size="sm" className="text-muted-foreground">
              Exclude an event from this calendar without changing its post or discussion.
            </Typography>
            <Label htmlFor="eventky-week-start">Week starts on</Label>
            <Controller
              control={form.control}
              name="weekStart"
              render={({ field }) => (
                <select {...field} id="eventky-week-start" className="rounded-md border border-input bg-background p-2">
                  {(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const).map((day, index) => (
                    <option key={day} value={day}>
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][index]}
                    </option>
                  ))}
                </select>
              )}
            />
            {input('defaultDuration', 'Default event duration', 'PT1H')}
          </>
        )}
        <PostInputAttachments
          ref={fileInputRef}
          attachments={attachments}
          setAttachments={setAttachments}
          existingAttachments={existingAttachments}
          onRemoveExisting={removeExisting}
          handleFilesAdded={handleFilesAdded}
          isSubmitting={busy || pendingRetry}
        />
        <Button type="button" variant="secondary" size="sm" onClick={openPicker}>
          <ImagePlus className="size-4" /> Add attachment
        </Button>
        {!isEditing && <PostInputTags tags={state.tags} onTagsChange={state.setTags} disabled={busy || pendingRetry} />}
      </fieldset>
      {form.formState.errors.root && (
        <Typography role="alert" className="text-destructive">
          {form.formState.errors.root.message}
        </Typography>
      )}
      <Button type="button" onClick={onSubmit} disabled={busy || !ready || state.hasConflict} data-cy="eventky-publish">
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : pendingRetry ? (
          <Send className="size-4" />
        ) : (
          <CalendarDays className="size-4" />
        )}
        {busy
          ? 'Saving…'
          : pendingRetry
            ? 'Retry save'
            : isEditing
              ? 'Save changes'
              : kind === 'event'
                ? 'Publish event'
                : 'Publish calendar'}
      </Button>
    </Container>
  );
}
