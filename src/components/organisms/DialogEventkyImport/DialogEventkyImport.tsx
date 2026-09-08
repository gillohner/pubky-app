'use client';

import { useId } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { Controller } from 'react-hook-form';
import { Button } from '@/atoms/Button/Button';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { Container } from '@/atoms/Container/Container';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/atoms/Dialog/Dialog';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Typography } from '@/atoms/Typography/Typography';
import { useEventkyImport } from '@/hooks/useEventkyImport/useEventkyImport';
import { formatCalendarTime } from '@/libs/eventky/display';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';

/** Mount only while open. Durable publication progress stays in the scoped local import ledger. */
export function DialogEventkyImport({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const id = useId();
  const state = useEventkyImport();
  const { form, preview } = state;
  const listCheck = (
    name: 'selected' | 'acknowledged' | 'approvedUpdates',
    uid: string,
    label: string,
    disabled = false,
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field }) => (
        <Checkbox
          label={label}
          disabled={disabled}
          checked={field.value.includes(uid)}
          onCheckedChange={(checked) =>
            field.onChange(checked ? [...new Set([...field.value, uid])] : field.value.filter((item) => item !== uid))
          }
        />
      )}
    />
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!state.busy) onOpenChange(next);
      }}
    >
      <DialogContent className="w-4xl" hiddenTitle="Import calendar">
        <DialogHeader>
          <DialogTitle>Import calendar</DialogTitle>
          <DialogDescription>Review an iCalendar file and publish selected events as native posts.</DialogDescription>
        </DialogHeader>
        <Container className="gap-4">
          <Typography size="sm" className="text-muted-foreground">
            The preview stays in this browser. Publishing makes the selected details public. Attachments are preserved
            as references; remote files are not downloaded. Imported alarms do not enable reminders.
          </Typography>
          <fieldset disabled={state.busy} className="flex min-w-0 flex-col gap-4">
            <ControlledInputField
              name="source"
              control={form.control}
              label="Import source name"
              placeholder="Community calendar"
            />
            <Typography size="sm" className="text-muted-foreground">
              Use the same source name for future imports from this calendar. This private label keeps retries and
              updates linked on this browser and account. Keep separate calendars under separate names.
            </Typography>
            <Label htmlFor={`${id}-file`}>iCalendar file (up to 2 MiB)</Label>
            <Input
              id={`${id}-file`}
              type="file"
              accept=".ics,text/calendar"
              onChange={(event) => {
                void state.selectFile(event.target.files?.[0]);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!state.hasFile}
              onClick={() => {
                void state.scan();
              }}
            >
              <FileUp className="size-4" /> Preview import
            </Button>
            {preview && (
              <>
                {preview.errors.map((error, index) => (
                  <Typography key={index} role="alert" className="text-destructive">
                    {error}
                  </Typography>
                ))}
                {preview.warnings.map((warning, index) => (
                  <Typography key={index} size="sm">
                    {warning}
                  </Typography>
                ))}
                <Controller
                  name="createCalendar"
                  control={form.control}
                  render={({ field }) => (
                    <Checkbox
                      disabled={state.groupingLocked}
                      label="Group these events in their imported calendar"
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  )}
                />
                {state.groupingLocked && (
                  <Typography size="sm" className="text-muted-foreground">
                    This source keeps its original grouping choice. Edit calendar membership from individual posts.
                  </Typography>
                )}
                {!state.hasImportedCalendar && !state.groupingLocked && form.watch('createCalendar') && (
                  <ControlledInputField name="calendarName" control={form.control} label="Calendar name" />
                )}
                <Typography size="sm">
                  {preview.entries.length} event series found. Recurring instances stay within their series post.
                </Typography>
                {preview.entries.map((entry) => (
                  <Container key={entry.uid} className="gap-3 rounded-md border border-input p-4">
                    {listCheck(
                      'selected',
                      entry.uid,
                      entry.event?.summary ?? 'Invalid event',
                      !entry.event || !!entry.errors.length || entry.action === 'unchanged',
                    )}
                    {entry.event && (
                      <Typography size="sm">
                        {formatCalendarTime(entry.event.dtstart)}
                        {entry.event.rrule ? ' · Recurring' : ''}
                      </Typography>
                    )}
                    <Typography size="sm" className="text-muted-foreground">
                      {entry.action === 'unchanged'
                        ? 'Already imported unchanged'
                        : entry.action === 'review-update'
                          ? 'Existing post: approve update or resume saved publication'
                          : entry.action === 'conflict'
                            ? 'Conflict requires review'
                            : 'New event post'}
                    </Typography>
                    {entry.event?.description && (
                      <details>
                        <summary className="cursor-pointer">Review description</summary>
                        <Typography size="sm" className="mt-2 whitespace-pre-wrap">
                          {entry.event.description}
                        </Typography>
                      </details>
                    )}
                    {(entry.warnings.length > 0 || entry.requiresAcknowledgement.length > 0) && (
                      <Container className="gap-2">
                        {[...entry.warnings, ...entry.requiresAcknowledgement].map((warning, index) => (
                          <Typography key={index} size="sm">
                            {warning}
                          </Typography>
                        ))}
                      </Container>
                    )}
                    {entry.requiresAcknowledgement.length > 0 &&
                      listCheck('acknowledged', entry.uid, 'I reviewed these privacy and metadata warnings')}
                    {entry.action === 'review-update' &&
                      listCheck('approvedUpdates', entry.uid, 'Update or resume the mapped post I own')}
                    {entry.event?.extensions && (
                      <details>
                        <summary className="cursor-pointer">Review preserved source metadata</summary>
                        <pre className="mt-2 max-h-48 overflow-auto text-xs break-all whitespace-pre-wrap">
                          {JSON.stringify(entry.event.extensions, null, 2)}
                        </pre>
                      </details>
                    )}
                    {entry.errors.map((error, index) => (
                      <Typography key={index} role="alert" size="sm" className="text-destructive">
                        {error}
                      </Typography>
                    ))}
                    {state.progress[entry.uid] && (
                      <Typography role="status" size="sm">
                        {state.progress[entry.uid]}
                      </Typography>
                    )}
                  </Container>
                ))}
                <Controller
                  name="publicAcknowledged"
                  control={form.control}
                  render={({ field }) => (
                    <Checkbox
                      label="I understand that selected events and preserved metadata will be public"
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  )}
                />
                {state.hasPendingWrites && (
                  <Controller
                    name="missingAcknowledged"
                    control={form.control}
                    render={({ field }) => (
                      <Checkbox
                        label="If an unfinished creation has no post, publish its saved version again (this may recreate a post I deleted)"
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                    )}
                  />
                )}
              </>
            )}
          </fieldset>
          {state.message && (
            <Typography role="status" size="sm">
              {state.message}
            </Typography>
          )}
          {preview && (
            <Button
              type="button"
              disabled={state.busy || !!preview.errors.length}
              onClick={() => {
                void state.submit();
              }}
            >
              {state.busy && <Loader2 className="size-4 animate-spin" />}
              {state.busy ? 'Importing…' : 'Publish selected events'}
            </Button>
          )}
        </Container>
      </DialogContent>
    </Dialog>
  );
}
