/** Must match the projection service: exact kind, NUL separator, exact content bytes. */
export async function eventkySourceHash(kind: string, content: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${kind}\0${content}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
