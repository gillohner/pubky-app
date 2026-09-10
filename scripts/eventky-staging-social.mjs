import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

// Real UI journeys with a disposable staging identity. Never export signing keys or browser storage.
const origin = process.env.EVENTKY_TEST_ORIGIN ?? 'https://159.69.22.174';
const phase = process.env.EVENTKY_SOCIAL_PHASE ?? 'inspect';
const evidence = '/tmp/eventky-staging-social';
const manifest = JSON.parse(await fs.readFile('/tmp/eventky-staging-fixtures.json', 'utf8'));
const event = manifest.posts.find((post) => post.kind === 'event');
assert(event, 'A real owner event fixture is required');
const guest = JSON.parse(await fs.readFile('/tmp/eventky-staging-guest-public.json', 'utf8'));
const guestId = guest.pubky.replace(/^pubky/, '');
const reportPath = `${evidence}/results.json`;
await fs.mkdir(evidence, { recursive: true });
const report = await fs
  .readFile(reportPath, 'utf8')
  .then(JSON.parse)
  .catch(() => ({ origin, event: event.id, guest: guestId, checks: [], writes: [] }));
const context = await chromium.launchPersistentContext('/tmp/eventky-staging-browser-guest', {
  headless: true,
  viewport: { width: 1440, height: 1000 },
  timezoneId: 'Europe/Zurich',
});
const page = context.pages()[0] ?? (await context.newPage());
if (phase === 'attendance-v2') {
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/v0/stream/posts')) console.log('READ', response.status(), url.pathname);
  });
}
page.setDefaultTimeout(30000);
const save = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
const checked = (name) => report.checks.some((check) => check.name === name);
const check = async (name) => {
  if (!checked(name)) report.checks.push({ name, at: new Date().toISOString() });
  await save();
  console.log('PASS', name);
};
const isStaging = (url) =>
  url.hostname === 'homeserver.staging.pubky.app' ||
  url.hostname === 'staging.homeserver.pubky.app' ||
  url.hostname.endsWith('.staging.homeserver.pubky.app');
await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (
    url.hostname === 'homeserver.pubky.app' ||
    (request.method() === 'PUT' && url.pathname.includes('/pub/pubky.app/') && !isStaging(url))
  ) {
    console.error('BLOCKED non-staging homeserver request', request.method(), url.hostname);
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
});
async function capture(name) {
  await page.screenshot({ path: `${evidence}/${name}-desktop.png`, fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${evidence}/${name}-mobile.png`, fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function openEvent() {
  await page.goto(`${origin}/post/${event.id.replace(':', '/')}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByText(event.title, { exact: true }).first().waitFor({ timeout: 30000 });
}
async function writeThroughUi(name, path, predicate, action) {
  if (checked(name)) return;
  const responsePromise = page.waitForResponse(
    (response) => {
      const request = response.request();
      if (request.method() !== 'PUT' || !new URL(request.url()).pathname.includes(path)) return false;
      try {
        return predicate(JSON.parse(request.postData()));
      } catch {
        return false;
      }
    },
    { timeout: 90000 },
  );
  // An action failure closes the browser before the network wait settles. Keep that cleanup rejection handled.
  void responsePromise.catch(() => {});
  await action();
  const response = await responsePromise;
  assert(isStaging(new URL(response.url())), 'Writes must reach only the staging homeserver');
  assert(response.ok(), `Homeserver PUT must succeed (${response.status()})`);
  const body = JSON.parse(response.request().postData());
  const headers = { ...response.request().headers() };
  delete headers['content-length'];
  delete headers['content-type'];
  const source = await context.request.get(response.url(), { headers, maxRedirects: 0 });
  assert(source.ok(), 'Public source must be readable after successful PUT');
  const persisted = await source.json();
  assert(predicate(persisted), 'Homeserver GET must confirm the published object');
  report.writes.push({
    check: name,
    url: response.url(),
    status: response.status(),
    kind: body.kind ?? path.split('/').filter(Boolean).at(-1),
  });
  await check(name);
}
async function attendance() {
  const group = page.getByRole('group', { name: 'Your attendance' }).first();
  for (const [label, status] of [
    ['Going', 'ACCEPTED'],
    ['Maybe', 'TENTATIVE'],
  ]) {
    if (checked(`attendance ${label} published`)) continue;
    await writeThroughUi(
      `attendance ${label} published`,
      '/pub/pubky.app/posts/',
      (body) => {
        if (body.kind !== 'attendance' || body.parent !== event.uri) return false;
        const content = JSON.parse(body.content);
        return content.partstat === status && content.event_uid === event.content.uid;
      },
      async () => {
        await group.getByRole('button', { name: label, exact: true }).click();
      },
    );
    await page.waitForFunction(
      ({ label }) =>
        [...document.querySelectorAll('[aria-label="Your attendance"] button')].some(
          (button) => button.textContent.trim() === label && button.getAttribute('aria-pressed') === 'true',
        ),
      { label },
    );
    await capture(`attendance-${label.toLowerCase()}`);
  }
}
async function social() {
  const comment = 'Looking forward to this Eventky staging meetup.';
  await writeThroughUi(
    'native comment published',
    '/pub/pubky.app/posts/',
    (body) => body.parent === event.uri && body.kind === 'short' && body.content === comment,
    async () => {
      await page.locator('[data-cy="post-reply-btn"]').first().click();
      const input = page.locator('[data-cy="reply-post-input"]');
      await input.locator('textarea').fill(comment);
      await input.locator('[data-cy="post-input-action-bar-reply"]').click();
    },
  );
  await page
    .getByRole('dialog')
    .last()
    .waitFor({ state: 'hidden' })
    .catch(() => {});
  await writeThroughUi(
    'native tag published',
    '/pub/pubky.app/tags/',
    (body) => JSON.stringify(body).includes(event.uri) && JSON.stringify(body).includes('eventky-social'),
    async () => {
      await page.locator('[data-cy="post-tag-add-button"]').first().click();
      const input = page.locator('[data-cy="add-tag-input"]').first();
      await input.fill('eventky-social');
      await input.press('Enter');
    },
  );
  await writeThroughUi(
    'native bookmark published',
    '/pub/pubky.app/bookmarks/',
    (body) => JSON.stringify(body).includes(event.uri),
    async () => {
      await page.locator('[data-cy="post-bookmark-btn"]').first().click();
      await page.locator('[data-cy="post-save-bookmarks-option"]').click();
    },
  );
  if (await page.locator('[data-cy="post-save-bookmarks-option"]').isVisible()) {
    // Save picker stays open for multi-save; dismiss by an ordinary outside pointer click.
    await page.mouse.click(300, 120);
    await page.locator('[data-cy="post-save-bookmarks-option"]').waitFor({ state: 'hidden' });
  }
  await writeThroughUi(
    'native repost published',
    '/pub/pubky.app/posts/',
    (body) => body.embed === event.uri,
    async () => {
      await page.locator('[data-cy="post-repost-btn"]').first().click();
      const input = page.locator('[data-cy="repost-post-input"]');
      await input.locator('textarea').fill('Join this community event on Eventky.');
      await input.locator('[data-cy="post-input-action-bar-repost"]').click();
    },
  );
  await capture('native-social-controls');
}
async function verifyReload() {
  await openEvent();
  const deadline = Date.now() + 180000;
  for (;;) {
    const maybe = page
      .getByRole('group', { name: 'Your attendance' })
      .first()
      .getByRole('button', { name: 'Maybe', exact: true });
    if ((await maybe.getAttribute('aria-pressed').catch(() => null)) === 'true') break;
    if (Date.now() > deadline)
      throw new Error('Indexed attendance did not survive reload within the bounded indexing wait');
    await page.waitForTimeout(5000);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await check('attendance Maybe survives native reload');
  await capture('reloaded-event');
}
async function calendarViews() {
  const calendar = manifest.posts.find((post) => post.kind === 'calendar');
  assert(calendar, 'A real calendar fixture is required');
  await page.goto(`${origin}/calendar`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Calendar', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'Europe/Zurich');
  assert.equal(await page.getByLabel('Display timezone', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Local calendar preferences', { exact: true }).count(), 0);
  for (const name of [/import/i, /export/i, /subscribe/i, /subscription/i, /alarm/i, /reminder/i, /display timezone/i, /saved preferences/i]) {
    assert.equal(await page.getByRole('button', { name }).count(), 0, `Removed calendar control ${name} stays absent`);
    assert.equal(await page.getByRole('link', { name }).count(), 0, `Removed calendar link ${name} stays absent`);
    assert.equal(await page.getByLabel(name).count(), 0, `Removed calendar input ${name} stays absent`);
  }
  await check('deployed calendar omits import export subscriptions alarms preferences and display timezone controls');
  await page.getByRole('button', { name: 'Date', exact: true }).click();
  for (let attempt = 0; attempt < 12 && !(await page.getByText('October 2026', { exact: true }).isVisible()); attempt++)
    await page.getByRole('button', { name: 'Go to the Next Month' }).click();
  await page.getByRole('button', { name: /October 3rd, 2026/ }).click();
  const choice = page.getByRole('button', { name: calendar.title, exact: true });
  await choice.click();
  await page.waitForURL((url) => url.searchParams.getAll('calendar').includes(calendar.uri));
  assert.equal(await choice.getAttribute('aria-pressed'), 'true');
  await choice.click();
  await page.waitForURL((url) => !url.searchParams.has('calendar'));
  assert.equal(await choice.getAttribute('aria-pressed'), 'false');
  await choice.click();
  await page.waitForURL((url) => url.searchParams.getAll('calendar').includes(calendar.uri));
  await check('named calendar selection toggles without URI entry or local preferences');

  const query = new URLSearchParams({
    from: '2026-10-01T00:00:00Z',
    to: '2026-11-01T00:00:00Z',
    timezone: 'Europe/Zurich',
    calendar: calendar.uri,
    include_cancelled: 'true',
  });
  const response = await context.request.get(`${origin}/api/eventky/occurrences?${query}`);
  assert.equal(response.status(), 200, 'Real calendar projection must be ready');
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.value.coverage.complete, true, 'Projection must have complete source coverage');
  const first = result.value.items.find(
    (item) => item.post_id === event.id && item.start_epoch_ms === Date.parse('2026-10-02T22:00:00Z'),
  );
  assert(first, 'The rescheduled New York October 2 event must project to October 3 in Zurich');
  assert.equal(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Zurich',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(first.start_epoch_ms),
    '2026-10-03',
  );
  await check('real rescheduled New York event appears on October 3 in device timezone');
  for (const view of ['Month', 'Week', 'Day', 'Agenda']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    if (view === 'Agenda') await page.getByRole('heading', { name: event.title, exact: true }).first().waitFor();
    else {
      const table = page.getByRole('table', { name: `${view} calendar` });
      await table.getByRole('button').filter({ hasText: event.title }).first().waitFor();
    }
    await capture(`calendar-${view.toLowerCase()}`);
    await page.setViewportSize({ width: 390, height: 844 });
    if (view !== 'Agenda') {
      const table = page.getByRole('table', { name: `${view} calendar` });
      const button = table.getByRole('button').filter({ hasText: event.title }).first();
      await page.waitForFunction(
        ({ title, view }) => {
          const table = document.querySelector(`table[aria-label="${view} calendar"]`);
          const button = [...table.querySelectorAll('button')].find((button) => button.textContent.includes(title));
          const rect = button?.getBoundingClientRect();
          const frame = table.parentElement.getBoundingClientRect();
          return rect && rect.left >= frame.left && rect.right <= frame.right;
        },
        { title: event.title, view },
      );
      assert(await button.isVisible());
    }
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      'Calendar must not overflow the mobile document',
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await check(`real event visible in ${view.toLowerCase()} view on desktop and mobile`);
  }
}

async function chooseComposerDate(label, iso) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const date = new Date(`${iso}T12:00:00`);
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const heading = `${month} ${date.getFullYear()}`;
  for (let attempt = 0; attempt < 12 && !(await page.getByText(heading, { exact: true }).isVisible()); attempt++)
    await page.getByRole('button', { name: 'Go to the Next Month' }).click();
  await page
    .getByRole('button', { name: new RegExp(`${month} ${date.getDate()}(?:st|nd|rd|th), ${date.getFullYear()}`) })
    .click();
}
async function inspectVisuals() {
  await openEvent();
  await page.getByRole('feed', { name: 'Event comments', exact: true }).getByText('Looking forward to this Eventky staging meetup.', { exact: true }).waitFor({ timeout: 90000 });
  const images = await page.locator('img').evaluateAll((images) => images.map((img) => ({ src: img.currentSrc || img.src, width: img.naturalWidth, complete: img.complete, alt: img.alt })));
  for (const img of images.filter((img) => !img.width)) {
    const response = await context.request.get(img.src);
    const url = new URL(img.src);
    console.log('IMAGE', JSON.stringify({ ...img, src: `${url.origin}${url.pathname}`, status: response.status(), type: response.headers()['content-type'] }));
  }
  const comment = page.getByRole('feed', { name: 'Event comments', exact: true }).getByText('Looking forward to this Eventky staging meetup.', { exact: true });
  await comment.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/attendance-v2-event-comments-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await comment.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/attendance-v2-event-comments-mobile.png` });
}

async function attendanceV2() {
  const calendar = manifest.posts.find((post) => post.kind === 'calendar');
  assert(calendar, 'Owner calendar is required for occurrence scope');
  const attendanceGroup = (scope) => page.getByRole('group', { name: `Your attendance · ${scope}`, exact: true });
  async function verifyGroups(expected, label) {
    await page.getByRole('button', { name: 'View attendees', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Attendees', exact: true });
    let guestRows = 0;
    const allPeople = new Set();
    for (const status of ['Going', 'Maybe', "Can't go"]) {
      await dialog
        .getByRole('button', { name: new RegExp(`^${status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(`) })
        .click();
      const list = dialog.getByRole('list', { name: `${status} attendees`, exact: true });
      const hrefs = await list.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      assert.equal(new Set(hrefs).size, hrefs.length, 'Each identity appears once within an attendee group');
      for (const href of hrefs) {
        assert(!allPeople.has(href), 'Each identity appears in only one current attendance group');
        allPeople.add(href);
      }
      const count = hrefs.filter((href) => href.includes(guestId)).length;
      assert.equal(count, status === expected ? 1 : 0, `Guest belongs only to ${expected}`);
      guestRows += count;
    }
    assert.equal(guestRows, 1, 'One current guest response across all groups');
    await dialog.getByRole('button', { name: new RegExp(`^${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(`) }).click();
    await capture(`attendance-v2-${label}-dialog`);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await check(`grouped attendees show one current guest row for ${label}`);
  }
  async function waitSelected(scope, label, reopen) {
    const deadline = Date.now() + 180000;
    for (;;) {
      const button = attendanceGroup(scope).getByRole('button', { name: label, exact: true });
      await page.waitForFunction(({ scope, label }) => {
        const group = document.querySelector(`[role="group"][aria-label="Your attendance · ${scope}"]`);
        return [...(group?.querySelectorAll('button') ?? [])].some((button) => button.textContent.trim() === label && !button.disabled);
      }, { scope, label }, { timeout: 90000 });
      if ((await button.getAttribute('aria-pressed').catch(() => null)) === 'true') return;
      assert(Date.now() < deadline, `${scope} ${label} must survive indexed reload`);
      await page.waitForTimeout(5000);
      await reopen();
    }
  }
  const query = new URLSearchParams({
    from: '2026-10-02T22:00:00Z',
    to: '2026-10-03T22:00:00Z',
    timezone: 'Europe/Zurich',
    calendar: calendar.uri,
  });
  const projected = await context.request
    .get(`${origin}/api/eventky/occurrences?${query}`)
    .then((response) => response.json());
  assert(projected.ok && projected.value.coverage.complete, 'Complete real occurrence projection required');
  const occurrence = projected.value.items.find((item) => item.post_id === event.id);
  assert(occurrence?.recurrence_id, 'Recurring fixture has stable original recurrence identity');
  async function openOccurrence() {
    await page.goto(`${origin}/calendar?calendar=${encodeURIComponent(calendar.uri)}`, {
      waitUntil: 'domcontentloaded',
    });
    await chooseComposerDate('Date', '2026-10-03');
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await page
      .getByRole('table', { name: 'Day calendar' })
      .getByRole('button')
      .filter({ hasText: event.title })
      .first()
      .click();
    await attendanceGroup('This occurrence').waitFor();
  }
  await openEvent();
  await attendanceGroup('Whole series').waitFor();
  await writeThroughUi(
    'v2 whole-event decline published',
    '/pub/pubky.app/posts/',
    (body) => {
      if (body.kind !== 'attendance' || body.parent !== event.uri) return false;
      const value = JSON.parse(body.content);
      return (
        value.partstat === 'DECLINED' && value.event_uid === event.content.uid && value.recurrence_id === undefined
      );
    },
    () => attendanceGroup('Whole series').getByRole('button', { name: "Can't go", exact: true }).click(),
  );
  await openEvent();
  await waitSelected('Whole series', "Can't go", openEvent);
  await verifyGroups("Can't go", 'whole-event-declined');
  await check('v2 whole-event decline survives reload');
  const feed = page.getByRole('feed', { name: 'Event comments', exact: true });
  await feed.getByText('Looking forward to this Eventky staging meetup.', { exact: true }).waitFor();
  for (const status of ['Going', 'Maybe', "Can't go"])
    assert.equal(await feed.getByText(status, { exact: true }).count(), 0);
  await page.waitForFunction(() => {
    const feed = document.querySelector('[role="feed"][aria-label="Event comments"]');
    const rows = [...feed.querySelectorAll(':scope > [role="article"]')];
    const size = Number(rows[0]?.getAttribute('aria-setsize'));
    const badge = document.querySelector('[data-cy="post-reply-btn"]')?.getAttribute('aria-label');
    return size >= 1 && badge === `Reply to post (${size})`;
  });
  await check('event discussion preserves ordinary comment and excludes attendance cards and badge counts');
  await capture('attendance-v2-event-comments');
  await openOccurrence();
  await writeThroughUi(
    'v2 occurrence going published',
    '/pub/pubky.app/posts/',
    (body) => {
      if (body.kind !== 'attendance' || body.parent !== event.uri) return false;
      const value = JSON.parse(body.content);
      return (
        value.partstat === 'ACCEPTED' &&
        value.event_uid === event.content.uid &&
        JSON.stringify(value.recurrence_id) === JSON.stringify(occurrence.recurrence_id)
      );
    },
    () => attendanceGroup('This occurrence').getByRole('button', { name: 'Going', exact: true }).click(),
  );
  await openOccurrence();
  await waitSelected('This occurrence', 'Going', openOccurrence);
  await verifyGroups('Going', 'occurrence-going');
  await check('v2 occurrence Going survives reload with original recurrence identity');
  await openEvent();
  await waitSelected('Whole series', "Can't go", openEvent);
  await verifyGroups("Can't go", 'whole-event-still-declined');
  await check('v2 occurrence override leaves whole-event decline unchanged');
}

async function contributorLifecycle() {
  const calendar = manifest.posts.find((post) => post.kind === 'calendar');
  assert(calendar, 'Owner calendar fixture is required');
  const details = await context.request.get(`${origin}/v0/post/${calendar.id.replace(':', '/')}/details`);
  assert(details.ok(), 'Owner calendar must be indexed');
  const indexed = await details.json();
  assert(
    JSON.parse(indexed.content).contributors?.includes(guestId),
    'Owner must first approve and index this guest as a contributor',
  );
  if (!report.contributor) {
    report.contributor = {
      title: `Guest community session ${new Date().toISOString().slice(0, 16)}`,
      calendar: calendar.uri,
    };
    await save();
    await page.goto(`${origin}/home`, { waitUntil: 'domcontentloaded' });
    const add = page.getByRole('button', { name: 'Add event', exact: true }).first();
    if (!(await add.isVisible())) await page.locator('textarea[name="post-input-textarea"]').first().click();
    await add.click();
    const dialog = page.getByRole('dialog', { name: 'New event', exact: true });
    await dialog.getByRole('textbox', { name: 'Event title', exact: true }).fill(report.contributor.title);
    await dialog
      .locator('[contenteditable="true"]')
      .fill('A disposable guest contribution to the shared staging calendar.');
    await chooseComposerDate('Start date', '2026-10-04');
    await chooseComposerDate('End date', '2026-10-04');
    await dialog.getByLabel('Start time', { exact: true }).fill('10:00');
    await dialog.getByLabel('End time', { exact: true }).fill('11:00');
    await dialog.getByRole('checkbox', { name: calendar.title, exact: true }).check();
    await capture('contributor-composer');
    const savedPromise = page.waitForResponse(
      (response) => {
        if (response.request().method() !== 'PUT' || !response.url().includes('/pub/pubky.app/posts/')) return false;
        try {
          const body = JSON.parse(response.request().postData());
          return body.kind === 'event' && JSON.parse(body.content).summary === report.contributor.title;
        } catch {
          return false;
        }
      },
      { timeout: 90000 },
    );
    void savedPromise.catch(() => {});
    await dialog.getByRole('button', { name: 'Publish event', exact: true }).click();
    const saved = await savedPromise;
    assert(saved.ok() && isStaging(new URL(saved.url())), 'Guest event must be written successfully to staging');
    const body = JSON.parse(saved.request().postData());
    const content = JSON.parse(body.content);
    assert(content.calendar_uris.includes(calendar.uri), 'Guest source must name the approved calendar');
    const postId = new URL(saved.url()).pathname.split('/').at(-1);
    Object.assign(report.contributor, {
      id: `${guestId}:${postId}`,
      uri: `pubky://${guestId}/pub/pubky.app/posts/${postId}`,
      sourceUrl: saved.url(),
      deleted: false,
    });
    await save();
    const headers = { ...saved.request().headers() };
    delete headers['content-length'];
    delete headers['content-type'];
    const source = await context.request.get(saved.url(), { headers, maxRedirects: 0 });
    assert.equal(source.status(), 200);
    assert(JSON.parse((await source.json()).content).calendar_uris.includes(calendar.uri));
    await check('approved guest publishes event into named owner calendar');
    await dialog.waitFor({ state: 'hidden' });
  }
  assert(report.contributor.id, 'Uncertain prior publication must be inspected before creating another guest event');
  const fixture = report.contributor;
  const query = new URLSearchParams({
    from: '2026-10-03T22:00:00Z',
    to: '2026-10-04T22:00:00Z',
    timezone: 'Europe/Zurich',
    calendar: calendar.uri,
  });
  async function waitForMembership(present) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const response = await context.request.get(`${origin}/api/eventky/occurrences?${query}`);
      const result = await response.json();
      if (
        result.ok &&
        result.value.coverage.complete &&
        result.value.items.some((item) => item.post_uri === fixture.uri) === present
      )
        return;
      await page.waitForTimeout(3000);
    }
    throw new Error(
      `Guest calendar membership did not become ${present ? 'present' : 'absent'} in complete projection`,
    );
  }
  if (!fixture.deleted) {
    await waitForMembership(true);
    fixture.projectionSeen = true;
    await save();
    await check('approved contributor event appears in complete owner-calendar projection');
    await page.goto(`${origin}/post/${fixture.id.replace(':', '/')}`, { waitUntil: 'domcontentloaded' });
    await page.getByText(fixture.title, { exact: true }).first().waitFor();
    await capture('contributor-event');
    if (process.env.EVENTKY_HOLD_CONTRIBUTOR_DELETE === 'yes') {
      console.log('READY owner curation', fixture.id);
      return;
    }
    const deletedPromise = page.waitForResponse(
      (response) => response.request().method() === 'DELETE' && response.url() === fixture.sourceUrl,
      { timeout: 90000 },
    );
    void deletedPromise.catch(() => {});
    await page.locator('[data-cy="post-more-btn"]').first().click();
    await page.locator('[data-cy="post-menu-action-delete"]').click();
    await page.locator('[data-cy="dialog-confirm-delete-btn"]').click();
    const deleted = await deletedPromise;
    assert(deleted.ok() && isStaging(new URL(deleted.url())));
    const headers = { ...deleted.request().headers() };
    delete headers['content-length'];
    delete headers['content-type'];
    assert.equal(
      (await context.request.get(deleted.url(), { headers, maxRedirects: 0 })).status(),
      404,
      'Deleted guest source must return404',
    );
    fixture.deleted = true;
    await save();
    await check('guest event native deletion confirmed by staging DELETE and GET404');
  }
  assert(fixture.projectionSeen, 'Prove membership presence before checking its removal');
  await waitForMembership(false);
  fixture.projectionRemovalVerified = true;
  await save();
  await check('deleted guest event removed from complete owner-calendar projection');
}

try {
  await page.goto(`${origin}/home`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const config = await page.evaluate(() => window.__PUBKY_CONFIG__);
  const activeIdentity = await page.evaluate(
    () => JSON.parse(localStorage.getItem('auth-store') ?? 'null')?.state?.currentUserPubky,
  );
  assert.equal(activeIdentity, guestId, 'Exclusive guest profile must retain the expected disposable identity');
  assert.equal(config.homeserver, guest.homeserver, 'Runtime must use staging homeserver');
  assert.equal(config.deployEnv, 'staging', 'Runtime must be staging');
  const status = await context.request.get(`${origin}/api/eventky/status`).then((response) => response.json());
  assert.equal(status.value?.backend_id, 'http://staging-nexus:8080', 'Isolated staging Nexus is required');
  await check('isolated staging runtime verified');
  if (!['contribute', 'calendar'].includes(phase)) await openEvent();
  if (phase === 'inspect') {
    await fs.writeFile(`${evidence}/inspect.txt`, await page.locator('body').innerText());
    await capture('inspect');
    console.log('Read-only guest inspection complete');
  } else {
    assert.equal(process.env.EVENTKY_STAGING_ROUTE_READY, 'yes', 'Explicit staging route gate is required');
    if (phase === 'run') {
      await attendance();
      await social();
      await verifyReload();
      await calendarViews();
    } else if (phase === 'reload') await verifyReload();
    else if (phase === 'calendar') await calendarViews();
    else if (phase === 'contribute') await contributorLifecycle();
    else if (phase === 'attendance-v2') await attendanceV2();
    else if (phase === 'visuals') await inspectVisuals();
    else throw new Error('Unknown social phase');
  }
} catch (error) {
  console.error(error.stack ?? String(error));
  await page.screenshot({ path: `${evidence}/failure.png`, fullPage: false }).catch(() => {});
  await fs.writeFile(
    `${evidence}/failure.txt`,
    await page
      .locator('body')
      .innerText()
      .catch(() => ''),
  );
  process.exitCode = 1;
} finally {
  await save();
  await context.close();
}
