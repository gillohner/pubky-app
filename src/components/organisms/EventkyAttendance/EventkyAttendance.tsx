'use client';
import { attendanceLabels, type AttendanceStatus } from '@eventky/attendance';
import type { CalendarTime } from '@eventky/types';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Typography } from '@/atoms/Typography/Typography';
import { useEventkyAttendance } from '@/hooks/useEventkyAttendance/useEventkyAttendance';

export function EventkyAttendance({
  postId,
  eventUid,
  recurrenceId,
  cancelled = false,
}: {
  postId: string;
  eventUid: string;
  recurrenceId?: CalendarTime;
  cancelled?: boolean;
}) {
  const attendance = useEventkyAttendance(postId, eventUid, recurrenceId);
  return (
    <Container className="gap-2" onClick={(event) => event.stopPropagation()}>
      <Typography size="sm">{recurrenceId ? 'Attending this occurrence?' : 'Attending?'}</Typography>
      <Container overrideDefaults className="flex flex-wrap gap-2" role="group" aria-label="Your attendance">
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
      </Container>
      <Typography size="xs" className="text-muted-foreground" aria-live="polite">
        {attendance.loading
          ? 'Loading responses…'
          : attendance.failed
            ? 'Responses are temporarily unavailable.'
            : `${attendance.counts.ACCEPTED} going · ${attendance.counts.TENTATIVE} maybe${attendance.complete ? '' : ' · Partial results'}`}
      </Typography>
      <Typography size="xs" className="text-muted-foreground">
        {attendance.signedIn ? 'Your response is public.' : 'Sign in to respond.'}
      </Typography>
    </Container>
  );
}
