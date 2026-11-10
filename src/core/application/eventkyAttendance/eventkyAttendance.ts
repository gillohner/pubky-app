import { EventkyAttendanceService } from '@/services/eventkyAttendance/eventkyAttendance';

export class EventkyAttendanceApplication {
  static fetchReplies(eventId: string, skip = 0, viewerId?: string | null) {
    return EventkyAttendanceService.fetchReplies(eventId, skip, viewerId);
  }

  static fetch(eventId: string) {
    return EventkyAttendanceService.fetch(eventId);
  }
}
