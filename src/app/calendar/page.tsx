import { Suspense } from 'react';
import { Calendar } from '@/templates/Calendar/Calendar';

export default function CalendarPage() {
  return (
    <Suspense>
      <Calendar />
    </Suspense>
  );
}
