import { limits } from 'pubky-social-specs';
import { getSafeExternalUrl } from '@/libs/utils/safeExternalUrl';
import { isSameDomain } from '@/libs/utils/utils';
import { getFirstLinkMatch, getLinkUrls } from './postLinkUrl';

/**
 * A post's `embed` when it is a web link, else null. The data model stores a web reference as
 * written and only with a lower-case `http://` or `https://` prefix; any other value (a post's
 * `pubky://` reference, `isbn:`, `javascript:`…) is not a web embed.
 */
export function getWebEmbedUrl(embed: string | null | undefined): string | null {
  if (!embed || !(embed.startsWith('http://') || embed.startsWith('https://'))) return null;
  return getSafeExternalUrl(embed) === embed ? embed : null;
}

/**
 * The link a new post embeds: the first link of its text, when it is an external web link the
 * data model can store as `embed` (at most `referenceUriMaxLength` code points). The data model
 * stores a web reference as written, so only a link written with its `http://` or `https://`
 * scheme is embedded; one written without a scheme keeps the plain preview. A link to this app's
 * own pages is not an external resource and is left to the in-app preview.
 */
export function getComposerEmbedUrl(content: string): string | null {
  const match = getFirstLinkMatch(content);
  if (!match?.schema) return null;
  const url = getWebEmbedUrl(match.url);
  if (!url || isSameDomain(url)) return null;
  return [...url].length <= limits.referenceUriMaxLength ? url : null;
}

/**
 * The stored web embed a post view previews under `content`. An edit keeps the stored `embed`
 * while its text may no longer hold that link, so the embed is shown only while it is still one
 * of the text's links; a post without text (another client may write one) shows it as is.
 */
export function getShownEmbedUrl(embedUrl: string | null | undefined, content: string): string | null {
  if (!embedUrl) return null;
  if (!content.trim()) return embedUrl;
  return getLinkUrls(content).includes(embedUrl) ? embedUrl : null;
}
