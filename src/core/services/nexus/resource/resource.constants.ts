/** Tags one card asks for: more than a card shows, so its character budget picks the visible ones. */
export const RESOURCE_TAGS_LIMIT = 20;

/**
 * When, after a tag write, a card reads the link's tags again from Nexus (ms after the write), which
 * indexes a write within seconds. Until the last of them, Nexus' answers keep the viewer's write
 * when they do not show it yet; from then on they are shown as they are, so a write Nexus did not
 * take does not look saved until a reload.
 */
export const RESOURCE_TAG_REREADS_MS = [5_000, 15_000] as const;

/** How old a write Nexus' answer still does not show is when it is dropped from the answers. */
export const RESOURCE_TAG_UNCONFIRMED_MS = RESOURCE_TAG_REREADS_MS[RESOURCE_TAG_REREADS_MS.length - 1];
