import { AUTH_PERSIST_KEY } from '@/stores/persistedKeys';
import { useAuthStore } from './auth.store';

/** Shared IndexedDB holds one viewer's relationships. Reload other windows when that viewer changes. */
export function subscribeAccountChanges(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== AUTH_PERSIST_KEY && event.key !== null) return;
    try {
      const viewer = event.newValue ? (JSON.parse(event.newValue)?.state?.currentUserPubky ?? null) : null;
      if (viewer !== useAuthStore.getState().currentUserPubky) onChange();
    } catch {
      // Invalid external storage is handled by normal session restoration, not adopted here.
    }
  };
  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
}
