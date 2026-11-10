import { type PostResult, type PubkyAppPost, PubkyAppPostKind, PubkySpecsBuilder } from 'pubky-app-specs';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';

/** Public v0 envelope accepted by the universal-kind Nexus. Custom content stays opaque. */
export type PubkyPostWire = {
  kind: string;
  content: string;
  parent?: string | null;
  embed?: string | null;
  attachments?: string[] | null;
  lock?: string | null;
};

export type PostSource = PubkyAppPost | PubkyPostWire;
export type UniversalPostResult = {
  post: PubkyPostWire;
  meta: { id: string; url: string; path: string };
};
export type NormalizedPostResult = PostResult | UniversalPostResult;

export const MAX_CUSTOM_POST_BYTES = 512 * 1024;
const BUILTIN_KINDS = ['short', 'long', 'image', 'video', 'link', 'file', 'collection'] as const;
const FROZEN_WHITESPACE =
  '\\u0009-\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const EMBED_TRIM = new RegExp(`^[${FROZEN_WHITESPACE}]+|[${FROZEN_WHITESPACE}]+$`, 'g');
const EMBED_FORBIDDEN = new RegExp(`[${FROZEN_WHITESPACE}\\u0000-\\u001f\\u007f]`);

function invalid(message: string): never {
  throw Err.validation(ValidationErrorCode.INVALID_INPUT, message, {
    service: ErrorService.PubkyAppSpecs,
    operation: 'validatePostWire',
  });
}

export function builtinPostKind(kind: string): PubkyAppPostKind | undefined {
  const index = BUILTIN_KINDS.findIndex((value) => value === kind);
  return index < 0 ? undefined : (index as PubkyAppPostKind);
}

export function postKindFromEnum(kind: PubkyAppPostKind): string {
  return BUILTIN_KINDS.find((_, index) => index === kind) ?? invalid('Unsupported built-in post kind');
}

/** Only call on a specs getter, never on an arbitrary network kind. */
export function postKindFromSpecs(kind: string): string {
  const known = BUILTIN_KINDS.find((value) => value === kind || value[0].toUpperCase() + value.slice(1) === kind);
  return known ?? kind;
}

/** Converts actual WASM output once; raw post strings are never case-folded. */
export function toPostWire(source: PostSource): PubkyPostWire {
  const isSpecs = 'toJson' in source && typeof source.toJson === 'function';
  const json = isSpecs ? source.toJson() : source;
  const embed = typeof json.embed === 'object' && json.embed !== null ? json.embed.uri : json.embed;
  return {
    kind: isSpecs ? postKindFromSpecs(json.kind) : json.kind,
    content: json.content,
    parent: json.parent ?? null,
    embed: embed ?? null,
    attachments: json.attachments ?? null,
    lock: json.lock ?? null,
  };
}

/** URI acceptance does not grant permission to execute or navigate to its scheme. */
export function normalizePostEmbed(input: string): string {
  const value = input.replace(EMBED_TRIM, '');
  if ([...value].length > 1024 || EMBED_FORBIDDEN.test(value)) {
    return invalid('Embed must be at most 1024 characters without whitespace or controls');
  }
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):([\s\S]+)$/.exec(value);
  if (!match) return invalid('Embed must have a URI scheme and target');
  const [, rawScheme, remainder] = match;
  const scheme = rawScheme.toLowerCase();
  if (scheme === 'pubky') {
    let url: URL;
    try {
      url = new URL(value);
      const builder = new PubkySpecsBuilder(url.hostname);
      builder.free();
    } catch {
      return invalid('Pubky embed must have a valid public key');
    }
    if (!url.hostname || url.username || url.password || !url.pathname.startsWith('/pub/')) {
      return invalid('Pubky embed must reference public storage');
    }
  } else if (scheme.startsWith('pubky')) {
    return invalid('Reserved Pubky embed scheme');
  } else if ((scheme === 'http' || scheme === 'https') && !/^\/\/[^/]/.test(remainder)) {
    return invalid('Web embed must contain a host');
  }
  return `${scheme}:${remainder}`;
}

/** Validate generic constraints after common-field specs validation/sanitization. */
export function validatePostWire(post: PubkyPostWire): PubkyPostWire {
  const bytes = new TextEncoder();
  if (
    typeof post.kind !== 'string' ||
    !post.kind ||
    bytes.encode(post.kind).length > 128 ||
    /[\p{White_Space}\p{Cc},]/u.test(post.kind)
  ) {
    return invalid('Post kind must be 1–128 UTF-8 bytes without whitespace, controls or commas');
  }
  if (typeof post.content !== 'string') return invalid('Post content must be a string');
  if (post.content === '[DELETED]') return invalid('Post content cannot be the reserved deletion marker');
  if (!post.content.trim() && !post.embed && !post.attachments) {
    return invalid('Post must have content, an embed, or attachments');
  }
  if (builtinPostKind(post.kind) === undefined && bytes.encode(JSON.stringify(post)).length > MAX_CUSTOM_POST_BYTES) {
    return invalid('Custom post exceeds 512 KiB');
  }
  return post;
}
