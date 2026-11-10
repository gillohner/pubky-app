'use client';
import { useState } from 'react';
import { attendanceLabels, type AttendanceStatus } from '@eventky/attendance';
import type { CalendarTime } from '@eventky/types';
import { ChevronRight, Users } from 'lucide-react';
import { getUserProfileUrl } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/atoms/Dialog/Dialog';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { useEventkyAttendance } from '@/hooks/useEventkyAttendance/useEventkyAttendance';
import { useUserDetailsFromIds } from '@/hooks/useUserDetailsFromIds/useUserDetailsFromIds';
import { formatPublicKey } from '@/libs/utils/utils';
import { AvatarWithFallback } from '@/organisms/AvatarWithFallback/AvatarWithFallback';

export function EventkyAttendance({
  postId,
  eventUid,
  recurrenceId,
  cancelled = false,
  recurring = false,
}: {
  postId: string;
  eventUid: string;
  recurrenceId?: CalendarTime;
  cancelled?: boolean;
  recurring?: boolean;
}) {
  const attendance = useEventkyAttendance(postId, eventUid, recurrenceId);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AttendanceStatus>('ACCEPTED');
  const [visibleLimit, setVisibleLimit] = useState(50);
  const attendees = attendance.attendees;
  const previews = attendees.filter((person) => person.status !== 'DECLINED').slice(0, 5);
  const group = attendees.filter((person) => person.status === selected);
  const visible = group.slice(0, visibleLimit);
  const userIds = [...new Set((open ? [...visible, ...previews] : previews).map((person) => person.author))];
  const { users } = useUserDetailsFromIds({ userIds });
  const identities = new Map(users.map((user) => [user.id, user]));
  const scope = recurrenceId ? 'This occurrence' : recurring ? 'Whole series' : 'Whole event';
  return (
    <Container className="gap-3" onClick={(event) => event.stopPropagation()}>
      <Container
        overrideDefaults
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={`Your attendance · ${scope}`}
      >
        {(Object.keys(attendanceLabels) as AttendanceStatus[]).map((status) => (
          <Button
            key={status}
            variant={attendance.status === status ? 'default' : 'outline'}
            size="sm"
            aria-pressed={attendance.status === status}
            disabled={
              !attendance.signedIn ||
              attendance.busy ||
              attendance.loading ||
              cancelled ||
              (!!attendance.pendingStatus && attendance.pendingStatus !== status)
            }
            onClick={() => void attendance.respond(status)}
          >
            {attendance.pendingStatus === status
              ? `Retry ${attendanceLabels[status].toLowerCase()}`
              : attendanceLabels[status]}
          </Button>
        ))}
        <Typography as="span" size="xs" className="text-muted-foreground">
          {scope}
        </Typography>
      </Container>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setVisibleLimit(50);
        }}
      >
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto w-full justify-between gap-3 rounded-lg px-0 py-2 text-left"
            aria-label="View attendees"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex -space-x-2" aria-hidden="true">
                {previews.length ? (
                  previews.map((person) => (
                    <AvatarWithFallback
                      key={person.author}
                      size="md"
                      className="ring-2 ring-background"
                      avatarUrl={identities.get(person.author)?.avatarUrl}
                      name={identities.get(person.author)?.name ?? formatPublicKey({ key: person.author })}
                      fallbackSeed={person.author}
                    />
                  ))
                ) : (
                  <Users className="size-5 text-muted-foreground" />
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-semibold">Attendees</span>
                <span className="text-xs font-normal text-muted-foreground" aria-live="polite">
                  {attendance.loading
                    ? 'Loading responses…'
                    : attendance.failed
                      ? 'Responses unavailable'
                      : `${attendance.counts.ACCEPTED} going · ${attendance.counts.TENTATIVE} maybe${attendance.complete ? '' : ' · Partial results'}`}
                </span>
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </DialogTrigger>
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto sm:max-w-md"
          onClick={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>Attendees</DialogTitle>
            <DialogDescription>{scope}. Each person appears under their current public response.</DialogDescription>
          </DialogHeader>
          <Container overrideDefaults className="flex flex-wrap gap-2" role="group" aria-label="Attendance groups">
            {(Object.keys(attendanceLabels) as AttendanceStatus[]).map((status) => (
              <Button
                key={status}
                size="sm"
                variant={selected === status ? 'default' : 'outline'}
                aria-pressed={selected === status}
                onClick={() => {
                  setSelected(status);
                  setVisibleLimit(50);
                }}
              >
                {attendanceLabels[status]} ({attendance.counts[status]})
              </Button>
            ))}
          </Container>
          <ul className="flex flex-col gap-1" aria-label={`${attendanceLabels[selected]} attendees`}>
            {visible.map((person) => {
              const user = identities.get(person.author);
              return (
                <li key={person.author}>
                  <Link
                    href={getUserProfileUrl(person.author)}
                    className="flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-muted"
                  >
                    <AvatarWithFallback
                      size="md"
                      avatarUrl={user?.avatarUrl}
                      name={user?.name ?? formatPublicKey({ key: person.author })}
                      fallbackSeed={person.author}
                    />
                    <span className="min-w-0 truncate text-sm font-semibold">
                      {user?.name ?? formatPublicKey({ key: person.author })}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {!visible.length && (
            <Typography size="sm" className="text-muted-foreground">
              {attendance.loading
                ? 'Loading responses…'
                : attendance.complete
                  ? 'No responses in this group yet.'
                  : 'No responses in this group among the loaded results.'}
            </Typography>
          )}
          {visible.length < group.length && (
            <Button variant="outline" onClick={() => setVisibleLimit((count) => count + 50)}>
              Show more people
            </Button>
          )}
          {!attendance.complete && (
            <Typography size="xs" className="text-muted-foreground">
              Partial results. More responses may not have been loaded or indexed yet.
            </Typography>
          )}
          <Button
            variant="outline"
            disabled={attendance.loading}
            onClick={() => void (attendance.hasMore ? attendance.loadMore() : attendance.refresh())}
          >
            {attendance.hasMore ? 'Load more responses' : 'Refresh responses'}
          </Button>
        </DialogContent>
      </Dialog>
      <Typography size="xs" className="text-muted-foreground">
        {attendance.signedIn ? 'Your response is public.' : 'Sign in to respond.'}
      </Typography>
    </Container>
  );
}
