'use client';

import type { EventContent } from '@eventky/contract';
import { exportEventIcs } from '@eventky/ical';
import { toast } from '@/molecules/Toaster/toast';

/** Download a calendar snapshot without importing events into another application. */
export function useEventkyDownload() {
  const downloadEvent = (event: EventContent, postUri: string, attachmentUris?: string[]): void => {
    const result = exportEventIcs(event, { postUri, ...(attachmentUris ? { attachmentUris } : {}) });
    if (!result.ok) {
      toast({ variant: 'error', description: 'Could not export this event.' });
      return;
    }
    const url = URL.createObjectURL(new Blob([result.value], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'event.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Browsers must have a chance to consume the object URL before it is revoked.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return { downloadEvent };
}
