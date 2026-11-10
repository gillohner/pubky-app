'use client';
import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('focus', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    window.removeEventListener('focus', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
};
const getDeviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const getServerTimezone = () => 'UTC';
/** Avoid a server/browser hydration mismatch; reading uses the device zone after hydration, with no preference. */
export function useDeviceTimezone() {
  return useSyncExternalStore(subscribe, getDeviceTimezone, getServerTimezone);
}
