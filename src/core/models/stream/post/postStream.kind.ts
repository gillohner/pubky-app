import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';

const ENCODED_KIND_PREFIX = 'k~';
const SIMPLE_KIND = /^[A-Za-z0-9._-]+$/;

function isValidKind(kind: string): boolean {
  return kind.length > 0 && new TextEncoder().encode(kind).length <= 128 && !/[\p{White_Space}\p{Cc},]/u.test(kind);
}

/** Encode a raw, exact kind for a cache-key segment; `all` is a literal kind here. */
export function postKindToStreamSegment(kind: string): string {
  if (!isValidKind(kind)) {
    throw invalidKind();
  }
  if (SIMPLE_KIND.test(kind) && kind !== 'all') return kind;
  try {
    return `${ENCODED_KIND_PREFIX}${encodeURIComponent(kind)}`;
  } catch {
    throw invalidKind();
  }
}

/** `all` is the unfiltered sentinel; encoded `k~all` filters the literal custom kind. */
export function streamSegmentToPostKind(segment: string): string | undefined {
  if (segment === 'all') return undefined;
  let kind: string;
  try {
    kind = segment.startsWith(ENCODED_KIND_PREFIX)
      ? decodeURIComponent(segment.slice(ENCODED_KIND_PREFIX.length))
      : segment;
  } catch {
    throw invalidKind();
  }
  if (!isValidKind(kind) || (!segment.startsWith(ENCODED_KIND_PREFIX) && !SIMPLE_KIND.test(segment))) {
    throw invalidKind();
  }
  return kind;
}

/** Check a persisted key without turning malformed filters into an unfiltered query. */
export function isPostStreamKindSegment(segment: string | undefined): segment is string {
  if (!segment) return false;
  if (segment === 'all') return true;
  try {
    const kind = segment.startsWith(ENCODED_KIND_PREFIX)
      ? decodeURIComponent(segment.slice(ENCODED_KIND_PREFIX.length))
      : segment;
    return isValidKind(kind) && (segment.startsWith(ENCODED_KIND_PREFIX) || SIMPLE_KIND.test(segment));
  } catch {
    return false;
  }
}

function invalidKind() {
  return Err.validation(ValidationErrorCode.INVALID_INPUT, 'Invalid post kind filter', {
    service: ErrorService.Nexus,
    operation: 'parsePostKindFilter',
  });
}
