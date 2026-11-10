'use client';

import { createContext, type ReactNode, useContext } from 'react';
import type { CalendarOccurrence } from '@/hooks/useEventkyCalendar/useEventkyCalendar.types';

const OccurrenceContext = createContext<CalendarOccurrence | null>(null);
export function EventkyOccurrenceProvider({
  occurrence,
  children,
}: {
  occurrence: CalendarOccurrence;
  children: ReactNode;
}) {
  return <OccurrenceContext.Provider value={occurrence}>{children}</OccurrenceContext.Provider>;
}
export function useEventkyOccurrence() {
  return useContext(OccurrenceContext);
}
