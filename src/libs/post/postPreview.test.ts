import { describe, expect, it } from 'vitest';
import { eventkyCalendarFixture, eventkyEventFixture } from '@/test/fixtures/eventky';
import { deriveTextPreview } from './postPreview';
import { canEditPostContent, deriveCopyText } from './postPreview';

describe('deriveTextPreview', () => {
  it('uses human-readable custom titles and timezones in previews and copied text', () => {
    const post = { kind: 'event', content: JSON.stringify(eventkyEventFixture) };
    const localStart = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(Date.UTC(2026, 9, 25, 17, 30));
    expect(deriveTextPreview(post)).toContain(`Pubky community meetup · ${localStart}`);
    expect(deriveCopyText(post)).toContain('Discuss decentralized calendars.');
    expect(deriveCopyText(post)).not.toContain('schema_version');
    expect(deriveTextPreview({ kind: 'calendar', content: JSON.stringify(eventkyCalendarFixture) })).toBe(
      'Pubky gatherings',
    );
    expect(canEditPostContent(post)).toBe(true);
  });
  it.each([
    ['event', '{broken'],
    ['event', JSON.stringify({ ...eventkyEventFixture, schema_version: 2 })],
    ['Event', JSON.stringify(eventkyEventFixture)],
    ['vendor:event', '{"secret":"opaque"}'],
  ])('fails closed for %s unsupported content', (kind, content) => {
    expect(deriveTextPreview({ kind, content })).toBe('Unsupported post format');
    expect(deriveCopyText({ kind, content })).toBe('Unsupported post format');
    expect(canEditPostContent({ kind, content })).toBe(false);
  });
  it('returns the deleted notice for a deleted post regardless of kind', () => {
    expect(deriveTextPreview({ content: '[DELETED]', kind: 'short' })).toBe(
      'This post has been deleted by its author.',
    );
    expect(deriveTextPreview({ content: '[DELETED]', kind: 'long' })).toBe('This post has been deleted by its author.');
  });

  it('returns the parsed article title for a long post', () => {
    const content = JSON.stringify({ title: 'My Article', body: 'Body text' });
    expect(deriveTextPreview({ content, kind: 'long' })).toBe('My Article');
  });

  it('falls back to raw content for a long post with unparseable content', () => {
    expect(deriveTextPreview({ content: 'plain text', kind: 'long' })).toBe('plain text');
  });

  it('returns the parsed collection name for a collection post', () => {
    const content = JSON.stringify({ name: 'My Collection' });
    expect(deriveTextPreview({ content, kind: 'collection' })).toBe('My Collection');
  });

  it('falls back to raw content for a collection post with unparseable content', () => {
    expect(deriveTextPreview({ content: 'plain text', kind: 'collection' })).toBe('plain text');
  });

  it('returns raw content for other kinds', () => {
    expect(deriveTextPreview({ content: 'hello', kind: 'short' })).toBe('hello');
    expect(deriveTextPreview({ content: 'hello', kind: 'image' })).toBe('hello');
    expect(deriveTextPreview({ content: 'https://x.test', kind: 'link' })).toBe('https://x.test');
  });
});
