import { PublicKey } from '@synonymdev/pubky';

/** A resource name must be a raw, canonical key accepted by follow/unfollow mutations. */
export function isCanonicalPubky(value: string): boolean {
  if (value.length !== 52) return false;
  try {
    const key = PublicKey.from(value);
    try {
      return key.z32() === value;
    } finally {
      key.free();
    }
  } catch {
    return false;
  }
}
