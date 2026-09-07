import { describe, expect, it } from 'vitest';
import { reconcileTagCounts } from '@/pipes/tag/tag-cache';
import type { NexusTag } from '@/services/nexus/nexus.types';

const tag = (count: number, relationship: boolean): NexusTag => ({
  label: 'x',
  taggers: [],
  taggers_count: count,
  relationship,
});

describe('tag count reconciliation', () => {
  it.each([
    { name: 'unacknowledged addition', intent: true, remote: [], total: 0, expected: 1, unique: 1 },
    { name: 'acknowledged addition', intent: true, remote: [tag(1, true)], total: 1, expected: 1, unique: 1 },
    { name: 'addition to an existing label', intent: true, remote: [tag(3, false)], total: 3, expected: 4, unique: 1 },
    { name: 'removal of the last tagger', intent: false, remote: [tag(1, true)], total: 1, expected: 0, unique: 0 },
    { name: 'removal with another tagger', intent: false, remote: [tag(2, true)], total: 2, expected: 1, unique: 1 },
    { name: 'acknowledged removal', intent: false, remote: [], total: 0, expected: 0, unique: 0 },
  ])('$name', ({ intent, remote, total, expected, unique }) => {
    expect(
      reconcileTagCounts(
        { tags: total, unique_tags: remote.length },
        remote,
        { id: 'post', tags: [], mutations: { x: { viewerId: 'viewer', relationship: intent, expiresAt: 200 } } },
        { tags: 9, unique_tags: 9 },
        'viewer',
        100,
      ),
    ).toEqual({ tags: expected, unique_tags: unique });
  });

  it('accepts authoritative totals after protection expires', () => {
    expect(
      reconcileTagCounts(
        { tags: 4, unique_tags: 3 },
        [],
        { id: 'post', tags: [], mutations: { x: { viewerId: 'viewer', relationship: true, expiresAt: 100 } } },
        { tags: 9, unique_tags: 9 },
        'viewer',
        100,
      ),
    ).toEqual({ tags: 4, unique_tags: 3 });
  });

  it.each([
    { name: 'pending addition', intent: true, previous: 41, expected: 41 },
    { name: 'pending removal', intent: false, previous: 39, expected: 39 },
    { name: 'stale low total with an addition', intent: true, previous: 1, expected: 40 },
    { name: 'stale low total with a removal', intent: false, previous: 0, expected: 39 },
    { name: 'stale high total with an addition', intent: true, previous: 80, expected: 41 },
    { name: 'stale high total with a removal', intent: false, previous: 80, expected: 40 },
  ])('bounds $name when a preview cannot acknowledge the label', ({ intent, previous, expected }) => {
    expect(
      reconcileTagCounts(
        { tags: 40, unique_tags: 40 },
        [],
        { id: 'post', tags: [], mutations: { x: { viewerId: 'viewer', relationship: intent, expiresAt: 200 } } },
        { tags: previous, unique_tags: previous },
        'viewer',
        100,
      ),
    ).toEqual({ tags: expected, unique_tags: expected });
  });
});
