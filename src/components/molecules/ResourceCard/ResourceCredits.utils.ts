import {
  PinakesCreditField,
  PinakesCreditProvider,
  type TPinakesCard,
  type TPinakesCredit,
} from '@/services/pinakes/pinakes.types';
import { getHttpUrl, getLinkHost } from './ResourceCard.utils';

/** The fields a credit can name, in the order the credits are listed. */
const CREDITED_FIELDS: readonly string[] = [PinakesCreditField.DESCRIPTION, PinakesCreditField.IMAGE];

/** What each credited field is called on a credit line. */
export const CREDIT_FIELD_LABELS: Readonly<Record<string, string>> = {
  [PinakesCreditField.DESCRIPTION]: 'Text',
  [PinakesCreditField.IMAGE]: 'Image',
};

const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  [PinakesCreditProvider.WIKIPEDIA]: 'Wikipedia',
  [PinakesCreditProvider.WIKIMEDIA_COMMONS]: 'Wikimedia Commons',
};

/** schema.org music types: their cards say when they have no description. */
const MUSIC_TYPES: readonly string[] = ['MusicGroup', 'MusicAlbum', 'MusicRecording'];

/** A person's card from this site is an artist's. */
const MUSIC_PERSON_SITE = 'MusicBrainz';

/** `CC-BY-SA-4.0` → `BY-SA`, `4.0`. */
const CREATIVE_COMMONS_LICENSE = /^CC-([A-Z]+(?:-[A-Z]+)*)-(\d+(?:\.\d+)?)$/i;

/** `CC0-1.0` → `1.0`. */
const CC0_LICENSE = /^CC0-(\d+(?:\.\d+)?)$/i;

const PUBLIC_DOMAIN = 'public-domain';

/**
 * The credits a card shows: one per enriched value it shows, the text's first. A credit for a
 * field the card has no value for (or whose image did not load), or for a field this app does not
 * show, is left out. Absent, `null` and `[]` credits are all none.
 */
export function getShownCredits(
  card: Pick<TPinakesCard, 'credits' | 'description'>,
  { imageShown }: { imageShown: boolean },
): TPinakesCredit[] {
  const shown = (credit: TPinakesCredit) =>
    credit.field === PinakesCreditField.DESCRIPTION ? Boolean(card.description) : imageShown;
  return (card.credits ?? [])
    .filter((credit) => CREDITED_FIELDS.includes(credit.field) && shown(credit))
    .sort((a, b) => CREDITED_FIELDS.indexOf(a.field) - CREDITED_FIELDS.indexOf(b.field));
}

/** A provider by its name; an unknown one by its source's host, else its id as given. */
export function getCreditProviderName(credit: Pick<TPinakesCredit, 'provider' | 'source_url'>): string {
  return PROVIDER_NAMES[credit.provider] ?? getLinkHost(credit.source_url) ?? credit.provider;
}

/**
 * A license id in words: `CC-BY-SA-4.0` → `CC BY-SA 4.0`, `CC0-1.0` → `CC0 1.0`, `public-domain`
 * → `Public domain`; any other id as given. `null` without one.
 */
export function getLicenseLabel(license: string | null | undefined): string | null {
  const id = license?.trim();
  if (!id) return null;
  if (id.toLowerCase() === PUBLIC_DOMAIN) return 'Public domain';
  const creativeCommons = CREATIVE_COMMONS_LICENSE.exec(id);
  if (creativeCommons) return `CC ${creativeCommons[1].toUpperCase()} ${creativeCommons[2]}`;
  const cc0 = CC0_LICENSE.exec(id);
  if (cc0) return `CC0 ${cc0[1]}`;
  return id;
}

/**
 * What a credit's `subject` (the entity its content is about, when another one) is called:
 * `its MusicBrainz work` for `https://musicbrainz.org/work/<id>`, `a related page on <host>` for
 * another web link. `null` when the subject is not `http(s)`.
 */
export function getCreditSubjectLabel(subject: string | null | undefined): string | null {
  const url = getHttpUrl(subject);
  if (!url) return null;
  const { hostname, pathname } = new URL(url);
  const host = hostname.replace(/^www\./i, '');
  const entity = pathname.split('/')[1];
  if (host === 'musicbrainz.org' && entity) return `its MusicBrainz ${entity.replaceAll('-', ' ')}`;
  return `a related page on ${host}`;
}

/**
 * A card for music: a music group, album or recording, or a person from MusicBrainz (an artist).
 * Such a card says when it has no description, instead of leaving it out.
 */
export function isMusicResource(card: Pick<TPinakesCard, 'type' | 'type_path' | 'site'>): boolean {
  const types = card.type ? [...card.type_path, card.type] : card.type_path;
  if (types.some((type) => MUSIC_TYPES.includes(type))) return true;
  return types.includes('Person') && card.site?.trim() === MUSIC_PERSON_SITE;
}
