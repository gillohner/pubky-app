import { EventkyAttendanceService } from '@/services/eventkyAttendance/eventkyAttendance';

export class EventkyAttendanceApplication {
  static fetch(eventId: string) {
    return EventkyAttendanceService.fetch(eventId);
  }
}
