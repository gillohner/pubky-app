import { attendanceLabels, parseAttendance } from '@eventky/attendance';
import { getEventkyPlainText, parseEventkyContent } from '@eventky/contract';
import { formatEventSchedule } from '@/libs/eventky/display';
import { isPostDeleted } from '@/libs/utils/utils';
import { parseArticleContent } from './articleContent';
import { parseCollectionContent } from './collectionContent';

/**
 * Derives a human-readable, single-string preview of a post's content, used for
 * both the `<meta>` description (`generateMetadata`) and the dynamic Open Graph
 * image text. Kept in one place so the two never drift.
 *
 * Branching:
 *   - deleted        → a fixed "deleted" notice
 *   - `long` article → the parsed article title (falls back to raw content)
 *   - `collection`   → the parsed collection name (falls back to raw content)
 *   - event/calendar → validated semantic summary
 *   - other known kinds → raw text; unknown formats → a safe fixed label
 *
 * Pure function — does not truncate; callers apply `truncateByGraphemes`.
 */
export function deriveTextPreview({ content, kind }: { content: string; kind: string }): string {
  if (isPostDeleted(content)) {
    return 'This post has been deleted by its author.';
  }
  if (kind === 'attendance') {
    const response = parseAttendance(content);
    return response ? attendanceLabels[response.partstat] : UNSUPPORTED_POST_FORMAT;
  }
  if (kind === 'long') {
    return parseArticleContent(content)?.title || content;
  }
  if (kind === 'collection') {
    return parseCollectionContent(content)?.name ?? content;
  }
  if (!isBuiltinPostKind(kind)) {
    const parsed = parseEventkyContent(kind, content);
    if (parsed.status !== 'supported') return UNSUPPORTED_POST_FORMAT;
    if (parsed.kind === 'calendar') return parsed.value.name;
    return `${parsed.value.summary} · ${formatEventSchedule(parsed.value)}${parsed.value.status === 'CANCELLED' ? ' · Cancelled' : ''}`;
  }
  return content;
}

export const UNSUPPORTED_POST_FORMAT = 'Unsupported post format';

/** Exact wire kinds only. Arbitrary custom kinds never become plain-text posts. */
export function isBuiltinPostKind(kind: string): boolean {
  return ['short', 'long', 'image', 'video', 'link', 'file', 'collection'].includes(kind);
}

export function isPlainTextPostKind(kind: string): boolean {
  return ['short', 'image', 'video', 'link', 'file'].includes(kind);
}

export function canEditPostContent({ kind, content }: { kind: string; content: string }): boolean {
  return (
    !isPostDeleted(content) && (isBuiltinPostKind(kind) || parseEventkyContent(kind, content).status === 'supported')
  );
}

export function deriveCopyText(post: { kind: string; content: string }): string {
  if (post.kind === 'attendance') return deriveTextPreview(post);
  if (isBuiltinPostKind(post.kind) || isPostDeleted(post.content)) return deriveTextPreview(post);
  return parseEventkyContent(post.kind, post.content).status === 'supported'
    ? getEventkyPlainText(post.kind, post.content)
    : UNSUPPORTED_POST_FORMAT;
}
