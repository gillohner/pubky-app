'use client';

import { CalendarDays, ImagePlus, Loader2, Send } from 'lucide-react';
import { Controller } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { Container } from '@/atoms/Container/Container';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/atoms/Select/Select';
import { Typography } from '@/atoms/Typography/Typography';
import type { useEventkyPostForm } from '@/hooks/useEventkyPostForm/useEventkyPostForm';
import type { EventkyPostFormData, EventkyPostKind } from '@/hooks/useEventkyPostForm/useEventkyPostForm.types';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';
import { MarkdownEditor } from '@/molecules/MarkdownEditor/MarkdownEditor';
import { PostInputAttachments } from '@/molecules/PostInputAttachments/PostInputAttachments';
import { PostInputTags } from '@/organisms/PostInputTags/PostInputTags';
import { EventkyCalendarPicker } from './EventkyCalendarPicker';
import { EventkyContributorPicker } from './EventkyContributorPicker';
import { EventkyDateField } from './EventkyDateField';
import { EventkyDurationField } from './EventkyDurationField';
import { EventkyExclusionPicker } from './EventkyExclusionPicker';
import { EventkyRecurrenceEditor } from './EventkyRecurrenceEditor';
import { EventkyTimezoneField } from './EventkyTimezoneField';

type FormState = ReturnType<typeof useEventkyPostForm>;
type TextField = {
  [K in keyof EventkyPostFormData]: EventkyPostFormData[K] extends string ? K : never;
}[keyof EventkyPostFormData];

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
              <EventkyDateField state={state} name="startDate" label="Start date" type="date" />
              {!allDay && <EventkyDateField state={state} name="startTime" label="Start time" type="time" />}
              {(!useDuration || allDay) && (
                <EventkyDateField
                  state={state}
                  name="endDate"
                  label={allDay ? 'Last day (inclusive)' : 'End date'}
                  type="date"
                />
              )}
              {!allDay && !useDuration && (
                <EventkyDateField state={state} name="endTime" label="End time" type="time" />
              )}
            </Container>
            {!allDay && (
              <>
                <EventkyTimezoneField state={state} />
                {check('useDuration', 'Set a duration instead of an end time')}
                {useDuration && <EventkyDurationField state={state} />}
              </>
            )}
            <Container overrideDefaults className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {input('location', 'Venue or location')}
              {input('locationUrl', 'Location link', 'https://…')}
              {input('onlineUrl', 'Online meeting link', 'https://…')}
              {input('website', 'Event website', 'https://…')}
            </Container>
            <EventkyCalendarPicker state={state} />
            <details className="rounded-md border border-input p-4">
              <summary className="cursor-pointer font-medium">Recurrence and advanced details</summary>
              <Container className="mt-4 gap-4">
                <EventkyRecurrenceEditor state={state} />
                <Label htmlFor="eventky-status">Status</Label>
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="eventky-status"
                        className="w-full rounded-md border border-input px-3 font-normal"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                        <SelectItem value="TENTATIVE">Tentative</SelectItem>
                        <SelectItem value="CANCELLED">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                {input('organizerName', 'Organizer name')}
                {input('organizerUrl', 'Organizer contact link', 'mailto:…')}
                {input('categories', 'Calendar categories', 'Community, Workshop')}
                {check('transparent', 'Show this time as free')}
              </Container>
            </details>
          </>
        ) : (
          <>
            <Controller
              control={form.control}
              name="color"
              render={({ field }) => (
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="eventky-calendar-color">Calendar color</Label>
                  <Input {...field} id="eventky-calendar-color" type="color" className="h-10 w-16 cursor-pointer p-1" />
                </div>
              )}
            />
            {input('website', 'Calendar website', 'https://…')}
            <EventkyContributorPicker state={state} />
            {isEditing && <EventkyExclusionPicker state={state} />}
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
