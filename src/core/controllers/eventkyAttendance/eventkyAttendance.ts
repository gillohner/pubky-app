import { EventkyAttendanceApplication } from '@/application/eventkyAttendance/eventkyAttendance';

export class EventkyAttendanceController {
  static fetch(eventId: string) {
    return EventkyAttendanceApplication.fetch(eventId);
  }
}
