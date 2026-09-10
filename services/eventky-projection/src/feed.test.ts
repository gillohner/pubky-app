// @vitest-environment node
import { once } from 'node:events';
import {
  CALENDAR_FIXTURE,
  EVENT_FIXTURE,
  FIXTURE_CALENDAR_URI,
  FIXTURE_CONTRIBUTOR,
  FIXTURE_EVENT_URI,
  FIXTURE_OWNER,
} from '@eventky/fixtures';
import ICAL from 'ical.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProjectionServer } from './http';
import { CalendarProjector } from './projector';
import { ProjectionStore } from './store';
import type { SourcePost } from './types';
import { buildTestWorkers, fetchLoopback } from './worker-fixtures';
import { ProjectionWorkers } from './workers';

const calendar: SourcePost = { uri: FIXTURE_CALENDAR_URI, kind: 'calendar', content: JSON.stringify(CALENDAR_FIXTURE) };
const event: SourcePost = { uri: FIXTURE_EVENT_URI, kind: 'event', content: JSON.stringify(EVENT_FIXTURE) };
const stores: ProjectionStore[] = [];
let built: ReturnType<typeof buildTestWorkers>;
beforeAll(() => {
  built = buildTestWorkers();
});
afterAll(() => {
  built.close();
});
function setup(posts = [calendar, event]) {
  const store = new ProjectionStore(':memory:', 'test-nexus', 'explicit-fixtures');
  stores.push(store);
  store.beginInventory();
  store.stageInventory(posts);
  store.finishInventory('epoch:1');
  store.setReady(true);
  return { store, projector: new CalendarProjector(store) };
}
const events = (body: string | null) => new ICAL.Component(ICAL.parse(body!)).getAllSubcomponents('vevent');
afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
});

describe('complete public calendar subscriptions', () => {
  it('exports complete masters with stable UID and original moved/cancelled instance identities', () => {
    const { projector } = setup([
      calendar,
      {
        ...event,
        content: JSON.stringify({
          ...EVENT_FIXTURE,
          overrides: [
            {
              recurrence_id: { ...EVENT_FIXTURE.dtstart, value: '2026-10-08T18:00:00' },
              changes: { dtstart: { ...EVENT_FIXTURE.dtstart, value: '2026-10-09T19:00:00' }, status: 'CANCELLED' },
            },
          ],
        }),
      },
    ]);
    const result = projector.subscription(calendar.uri);
    expect(result.status).toBe(200);
    const components = events(result.body);
    expect(components).toHaveLength(2);
    expect(components[0].getFirstPropertyValue('uid')).toBe(EVENT_FIXTURE.uid);
    expect(components[0].getFirstPropertyValue('rrule')?.toString()).toContain('COUNT=6');
    expect(components[1].getFirstPropertyValue('recurrence-id')?.toString()).toBe('2026-10-08T18:00:00');
    expect(components[1].getFirstPropertyValue('status')).toBe('CANCELLED');
    expect(components[0].getFirstPropertyValue('x-pubky-post-uri')).toBe(event.uri);
    expect(result.headers['X-Eventky-Recurrence']).toBe('complete-series');
  });

  it('enforces authenticated author membership and reevaluates revocation and owner exclusion', () => {
    const { projector, store } = setup();
    expect(events(projector.subscription(calendar.uri).body)).toHaveLength(1);
    store.applyHydration({
      status: 'present',
      post: { ...calendar, content: JSON.stringify({ ...CALENDAR_FIXTURE, contributors: [] }) },
    });
    expect(events(projector.subscription(calendar.uri).body)).toHaveLength(0);
    store.applyHydration({
      status: 'present',
      post: { ...calendar, content: JSON.stringify({ ...CALENDAR_FIXTURE, excluded_event_uris: [event.uri] }) },
    });
    expect(events(projector.subscription(calendar.uri).body)).toHaveLength(0);
    expect(store.getSource(event.uri)).not.toBeNull();
    const unapproved = event.uri.replace(FIXTURE_CONTRIBUTOR, FIXTURE_OWNER);
    store.applyHydration({ status: 'present', post: { ...event, uri: unapproved } });
    expect(events(projector.subscription(calendar.uri).body)).toHaveLength(1);
  });

  it('changes validators on deletion and never serves deleted payload from a previous feed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T12:00:00.000Z'));
    const { projector, store } = setup();
    const first = projector.subscription(calendar.uri);
    expect(projector.subscription(calendar.uri, { ifNoneMatch: first.headers.ETag }).status).toBe(304);
    expect(projector.subscription(calendar.uri, { ifModifiedSince: first.headers['Last-Modified'] }).status).toBe(304);
    vi.setSystemTime(new Date('2026-09-08T12:00:01.000Z'));
    store.applyHydration({ status: 'deleted', uri: event.uri });
    const deleted = projector.subscription(calendar.uri, {
      ifNoneMatch: first.headers.ETag,
      ifModifiedSince: first.headers['Last-Modified'],
    });
    expect(deleted.status).toBe(200);
    expect(deleted.headers.ETag).not.toBe(first.headers.ETag);
    expect(deleted.headers['Last-Modified']).not.toBe(first.headers['Last-Modified']);
    expect(deleted.body).not.toContain(EVENT_FIXTURE.summary);
    expect(events(deleted.body)).toHaveLength(0);
    store.applyHydration({ status: 'deleted', uri: calendar.uri });
    expect(projector.subscription(calendar.uri).status).toBe(404);
  });

  it('checks current completeness before honoring a matching ETag', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T12:00:00.000Z'));
    const { projector, store } = setup();
    const first = projector.subscription(calendar.uri);
    vi.setSystemTime(new Date('2026-09-08T12:01:01.000Z'));
    expect(projector.subscription(calendar.uri, { ifNoneMatch: first.headers.ETag }).status).toBe(503);
    store.setReady(true);
    store.enqueue([event.uri], 'epoch:2', true);
    expect(projector.subscription(calendar.uri).status).toBe(503);
    store.applyHydration({ status: 'unavailable', uri: event.uri });
    expect(projector.subscription(calendar.uri).status).toBe(503);
    store.applyHydration({ status: 'present', post: event });
    expect(projector.subscription(calendar.uri).status).toBe(200);
  });

  it('fails closed for invalid, unsupported, ambiguous UID and over-limit content', () => {
    expect(setup([calendar, { ...event, content: '{}' }]).projector.subscription(calendar.uri).status).toBe(503);
    expect(
      setup([
        calendar,
        { ...event, content: JSON.stringify({ ...EVENT_FIXTURE, rrule: 'FREQ=SECONDLY;COUNT=2' }) },
      ]).projector.subscription(calendar.uri).status,
    ).toBe(503);
    const duplicate = { ...event, uri: event.uri.replace(/B$/, 'C') };
    expect(setup([calendar, event, duplicate]).projector.subscription(calendar.uri).status).toBe(503);
    const posts = Array.from({ length: 501 }, (_, index) => ({
      ...event,
      uri: `${event.uri.slice(0, -13)}${String(index).padStart(13, '0')}`,
      content: JSON.stringify({ ...EVENT_FIXTURE, uid: `series-${index}` }),
    }));
    expect(setup([calendar, ...posts]).projector.subscription(calendar.uri).status).toBe(503);
  });

  it('aligns occurrence query bounds with the engine while subscriptions remain complete-series', () => {
    const { projector } = setup();
    expect(
      projector.query({ from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z', timezone: 'UTC' }),
    ).toMatchObject({ ok: false, code: 'INVALID_QUERY' });
    expect(projector.subscription(calendar.uri).status).toBe(200);
  });

  it('serves real GET/HEAD and conditional HTTP without accepting arbitrary URL targets', async () => {
    const { projector } = setup();
    const server = createProjectionServer(
      projector,
      new ProjectionWorkers(projector, { workerPath: built.workerPath }),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') return;
    const origin = `http://127.0.0.1:${address.port}`;
    const url = `${origin}/v1/calendar.ics?${new URLSearchParams({ calendar: calendar.uri })}`;
    try {
      const response = await fetchLoopback(url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/calendar');
      expect(events(await response.text())).toHaveLength(1);
      const unchanged = await fetchLoopback(url, { headers: { 'If-None-Match': response.headers.get('etag')! } });
      expect(unchanged.status).toBe(304);
      expect(await unchanged.text()).toBe('');
      const head = await fetchLoopback(url, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      expect((await fetchLoopback(`${url}&url=https://example.org`)).status).toBe(400);
      expect((await fetchLoopback(`${origin}/v1/calendar.ics?calendar=https://example.org`)).status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
