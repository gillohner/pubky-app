import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

// Persistent disposable staging identity; never export its browser storage or signing keys.
const origin = process.env.EVENTKY_TEST_ORIGIN ?? 'https://159.69.22.174';
const stagingHomeserver = 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy';
const phase = process.env.EVENTKY_AUTHORING_PHASE ?? 'inspect';
const manifestPath = '/tmp/eventky-staging-fixtures.json';
const owner = JSON.parse(await fs.readFile('/tmp/eventky-staging-owner-public.json', 'utf8'));
const ownerId = owner.pubky.length === 57 && owner.pubky.startsWith('pubky') ? owner.pubky.slice(5) : owner.pubky;
let manifest = await fs
  .readFile(manifestPath, 'utf8')
  .then(JSON.parse)
  .catch(() => ({ origin, owner: ownerId, checks: [], posts: [] }));
manifest.owner = ownerId;
const context = await chromium.launchPersistentContext('/tmp/eventky-staging-browser-owner', {
  headless: true,
  viewport: { width: 1440, height: 1000 },
  timezoneId: 'Europe/Zurich',
});
const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(45000);
const evidence = '/tmp/eventky-staging-authoring';
await fs.mkdir(evidence, { recursive: true });
const save = () => fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
const check = async (name) => {
  manifest.checks.push({ name, at: new Date().toISOString() });
  await save();
  console.log('PASS', name);
};
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === 'homeserver.pubky.app') {
    console.error('BLOCKED production homeserver request');
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
});
page.on('pageerror', (error) => console.error('Browser exception:', error.message));
async function openComposer(kind) {
  await page.goto(`${origin}/home`, { waitUntil: 'domcontentloaded' });
  const button = page.getByRole('button', { name: `Add ${kind}`, exact: true }).first();
  if (!(await button.isVisible())) await page.locator('textarea[name="post-input-textarea"]').first().click();
  await button.click();
  return page.getByRole('dialog', { name: `New ${kind}`, exact: true });
}
async function chooseDate(label, iso) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const date = new Date(`${iso}T12:00:00`);
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const heading = `${month} ${date.getFullYear()}`;
  for (let attempt = 0; attempt < 24 && !(await page.getByText(heading, { exact: true }).isVisible()); attempt++) {
    await page.getByRole('button', { name: 'Go to the Next Month' }).click();
  }
  await page
    .locator('[data-state="open"][role="dialog"]')
    .getByRole('button', { name: new RegExp(`${month} ${date.getDate()}(?:st|nd|rd|th), ${date.getFullYear()}`) })
    .click();
}
const postWrites = [];
const sourceRequests = new Map();
const postDeletes = [];
page.on('response', (response) => {
  const request = response.request();
  if (request.method() === 'DELETE' && request.url().includes('/pub/pubky.app/posts/') && response.ok()) {
    postDeletes.push({ url: request.url(), status: response.status() });
  }
});
page.on('response', async (response) => {
  const request = response.request();
  if (request.method() !== 'PUT' || !request.url().includes('/pub/pubky.app/posts/') || !response.ok()) return;
  try {
    const body = JSON.parse(request.postData());
    const match = new URL(request.url()).pathname.match(/\/pub\/pubky\.app\/posts\/([^/]+)$/);
    if (!match || !['event', 'calendar'].includes(body.kind)) return;
    const content = JSON.parse(body.content);
    // Keep request credentials only in memory to verify the exact same staging resource.
    const readHeaders = { ...request.headers() };
    delete readHeaders['content-length'];
    delete readHeaders['content-type'];
    sourceRequests.set(`${ownerId}:${match[1]}`, { url: request.url(), headers: readHeaders });
    postWrites.push({
      id: `${ownerId}:${match[1]}`,
      uri: `pubky://${ownerId}/pub/pubky.app/posts/${match[1]}`,
      kind: body.kind,
      title: content.summary ?? content.name,
      content,
    });
  } catch {
    /* Non-JSON upload requests are attachments, not post envelopes. */
  }
});
async function publish(dialog, kind, title) {
  await dialog.getByRole('button', { name: `Publish ${kind}`, exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 90000 });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !postWrites.some((post) => post.title === title)) await page.waitForTimeout(200);
  const post = postWrites.findLast((post) => post.title === title);
  assert(post, 'A successful native homeserver PUT must provide the fixture identity');
  manifest.posts.push(post);
  await save();
  await check(`${kind} published through native UI`);
  console.log('FIXTURE', JSON.stringify({ kind, id: post.id, uri: post.uri, title }));
  return post;
}
async function createFixtures() {
  if (manifest.posts.some((post) => post.kind === 'event'))
    throw new Error('Fixtures already exist; use edit phase instead of duplicating them');
  const suffix = new Date().toISOString().slice(0, 16).replaceAll(':', '-');
  const calendarTitle = `Eventky staging community ${suffix}`;
  let dialog = await openComposer('calendar');
  await dialog.getByRole('textbox', { name: 'Calendar name', exact: true }).fill(calendarTitle);
  await dialog.locator('[contenteditable="true"]').fill('Community calendar for real staging integration checks.');
  // Contributor selection is tested after the new guest profile reaches the staging index.
  await capture('calendar-composer');
  const calendar = await publish(dialog, 'calendar', calendarTitle);
  // Reopen against fresh indexed native calendar data, preserving this account's UI writes.
  const eventTitle = `Eventky staging meetup ${suffix}`;
  dialog = await openComposer('event');
  await dialog.getByRole('textbox', { name: 'Event title', exact: true }).fill(eventTitle);
  await dialog.locator('[contenteditable="true"]').fill('A recurring community meetup. Bring your calendar ideas.');
  await chooseDate('Start date', '2026-10-01');
  await chooseDate('End date', '2026-10-01');
  await dialog.getByLabel('Start time', { exact: true }).fill('18:00');
  await dialog.getByLabel('End time', { exact: true }).fill('20:00');
  await dialog.getByRole('button', { name: 'Event timezone', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search timezones' }).fill('New York');
  await page.getByRole('button', { name: 'America/New York', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Venue or location', exact: true }).fill('Community studio');
  await dialog.getByRole('checkbox', { name: calendarTitle, exact: true }).check({ timeout: 90000 });
  await dialog.getByText('Recurrence and advanced details', { exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Repeats', exact: true }).selectOption('weekly');
  await dialog.getByRole('textbox', { name: 'Recurrence rule', exact: true }).fill('FREQ=WEEKLY;COUNT=6');
  await dialog.getByRole('button', { name: 'Add new tag', exact: true }).click();
  await dialog.locator('[data-cy="add-tag-input"]').fill('eventky-staging');
  await dialog.locator('[data-cy="add-tag-input"]').press('Enter');
  await capture('event-composer');
  const event = await publish(dialog, 'event', eventTitle);
  assert.equal(event.content.dtstart.tzid, 'America/New_York');
  assert(event.content.calendar_uris.includes(calendar.uri));
  assert.equal(event.content.rrule, 'FREQ=WEEKLY;COUNT=6');
  await check('event timezone, recurrence and named calendar membership persisted');
  await page.goto(`${origin}/post/${event.id.replace(':', '/')}`, { waitUntil: 'domcontentloaded' });
  await capture('event-post');
}
async function editEvent() {
  const fixture = manifest.posts.find((post) => post.kind === 'event');
  assert(fixture, 'Create the real staging event first');
  await page.goto(`${origin}/post/${fixture.id.replace(':', '/')}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="post-more-btn"]').first().click();
  await page.locator('[data-cy="post-menu-action-edit"]').click();
  const dialog = page.getByRole('dialog', { name: 'Edit event', exact: true });
  await dialog.getByRole('textbox', { name: 'Event title', exact: true }).fill(`${fixture.title} · updated`);
  await dialog.getByText('Recurrence and advanced details', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Preview occurrences' }).click();
  await dialog.getByText('Oct 1, 2026, 6:00 PM (America/New_York)', { exact: true }).click();
  await chooseDate('Move to date', '2026-10-02');
  await dialog.getByRole('button', { name: 'Apply to this occurrence' }).click();
  await dialog.getByRole('button', { name: 'Preview occurrences' }).click();
  await dialog.getByText('Oct 8, 2026, 6:00 PM (America/New_York)', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel this occurrence' }).click();
  const { default: sharp } = await import('sharp');
  const attachment = `${evidence}/community-banner.png`;
  await sharp(
    Buffer.from(
      '<svg width="480" height="160" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="160" fill="#101010"/><text x="24" y="90" fill="#c8ff00" font-size="32" font-family="sans-serif">Community meetup</text></svg>',
    ),
  )
    .png()
    .toFile(attachment);
  await dialog.locator('input[type="file"]').setInputFiles(attachment);
  await capture('event-edit');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 90000 });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !postWrites.some((post) => post.id === fixture.id)) await page.waitForTimeout(200);
  const saved = postWrites.findLast((post) => post.id === fixture.id);
  assert(saved, 'Edited source must be confirmed by the homeserver response');
  assert.equal(saved.content.uid, fixture.content.uid);
  assert(
    saved.content.overrides.some(
      (item) =>
        item.recurrence_id.value === '2026-10-01T18:00:00' && item.changes.dtstart.value === '2026-10-02T18:00:00',
    ),
  );
  assert(
    saved.content.overrides.some(
      (item) => item.recurrence_id.value === '2026-10-08T18:00:00' && item.changes.status === 'CANCELLED',
    ),
  );
  manifest.posts = manifest.posts.map((post) => (post.id === saved.id ? saved : post));
  await check('native edit moved and cancelled occurrences while preserving series identity');
  await capture('edited-event-post');
}
async function curateCalendar() {
  const calendar = manifest.posts.find((post) => post.kind === 'calendar');
  const event = manifest.posts.find((post) => post.kind === 'event');
  assert(calendar && event, 'Create staging calendar and event first');
  const guestId = 'ybjyked1u5ktb37rhzq71ddogywq7dcwmjsdumdcrh7u8reuscxy';
  const guestResponse = await context.request.get(`${origin}/v0/user/${guestId}/details`);
  assert(guestResponse.ok(), 'Guest profile must be indexed before contributor selection');
  async function openCalendar() {
    await page.goto(`${origin}/post/${calendar.id.replace(':', '/')}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-cy="post-more-btn"]').first().click();
    await page.locator('[data-cy="post-menu-action-edit"]').click();
    return page.getByRole('dialog', { name: 'Edit calendar', exact: true });
  }
  let dialog = await openCalendar();
  await dialog.getByRole('textbox', { name: 'Find contributors' }).fill('Eventky staging guest');
  await dialog.getByRole('button', { name: 'Eventky staging guest', exact: true }).click();
  await dialog.getByText(/^Excluded events/).click();
  await dialog.getByRole('checkbox', { name: event.title, exact: true }).check();
  await capture('calendar-curation');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 90000 });
  let saved = postWrites.findLast((post) => post.id === calendar.id);
  assert(saved?.content.contributors.includes(guestId));
  assert(saved.content.excluded_event_uris.includes(event.uri));
  await check('full-name contributor selection and named event exclusion persisted');
  // Restore membership for the final shared demo, keeping the approved guest contributor.
  dialog = await openCalendar();
  await dialog.getByText(/^Excluded events/).click();
  await dialog.getByRole('checkbox', { name: event.title, exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 90000 });
  saved = postWrites.findLast((post) => post.id === calendar.id);
  assert(!saved.content.excluded_event_uris.includes(event.uri));
  manifest.posts = manifest.posts.map((post) => (post.id === saved.id ? saved : post));
  await check('named event exclusion can be removed without modifying the event post');
}
async function curateGuestEvent() {
  const calendar = manifest.posts.find((post) => post.kind === 'calendar');
  const eventId = process.env.EVENTKY_GUEST_EVENT_ID;
  const eventTitle = process.env.EVENTKY_GUEST_EVENT_TITLE;
  assert(calendar && eventId && eventTitle, 'An existing guest event identity and title are required');
  const [author, postId] = eventId.split(':');
  assert.equal(author, 'ybjyked1u5ktb37rhzq71ddogywq7dcwmjsdumdcrh7u8reuscxy');
  const uri = `pubky://${author}/pub/pubky.app/posts/${postId}`;
  const query = new URLSearchParams({
    from: '2026-10-03T22:00:00Z',
    to: '2026-10-05T22:00:00Z',
    timezone: 'Europe/Zurich',
    calendar: calendar.uri,
  });
  async function projected(present) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const response = await context.request.get(`${origin}/api/eventky/occurrences?${query}`);
      const result = await response.json();
      if (
        result.ok &&
        result.value.coverage.complete &&
        !result.value.next_cursor &&
        result.value.items.some((item) => item.post_uri === uri) === present
      ) {
        await fs.writeFile(
          `${evidence}/guest-${present ? 'included' : 'excluded'}-projection.json`,
          JSON.stringify(result, null, 2),
        );
        return;
      }
      await page.waitForTimeout(2000);
    }
    throw new Error(`Guest projection membership did not become ${present}`);
  }
  await projected(true);
  for (const excluded of [true, false]) {
    await page.goto(`${origin}/post/${calendar.id.replace(':', '/')}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-cy="post-more-btn"]').first().click();
    await page.locator('[data-cy="post-menu-action-edit"]').click();
    const dialog = page.getByRole('dialog', { name: 'Edit calendar', exact: true });
    await dialog.getByText(/^Excluded events/).click();
    await dialog.getByRole('checkbox', { name: eventTitle, exact: true }).setChecked(excluded);
    await capture(excluded ? 'guest-exclusion' : 'calendar-composer');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 90000 });
    const saved = postWrites.findLast((post) => post.id === calendar.id);
    assert.equal(saved?.content.excluded_event_uris.includes(uri), excluded);
    manifest.posts = manifest.posts.map((post) => (post.id === saved.id ? saved : post));
    await projected(!excluded);
    await check(
      `guest contributed event ${excluded ? 'excluded' : 'restored'} through native calendar picker and complete projection`,
    );
  }
}
async function allDayLifecycle() {
  assert(
    !manifest.disposableAllDay,
    'An all-day lifecycle already exists; inspect its durable status before creating another',
  );
  const calendar = manifest.posts.find((post) => post.kind === 'calendar');
  assert(calendar, 'Keep and reuse the main staging calendar');
  const title = `Eventky staging all-day ${new Date().toISOString().slice(0, 16).replaceAll(':', '-')}`;
  const dialog = await openComposer('event');
  await dialog.getByRole('textbox', { name: 'Event title', exact: true }).fill(title);
  await dialog.locator('[contenteditable="true"]').fill('Disposable all-day staging lifecycle fixture.');
  const durationToggle = dialog.getByRole('checkbox', { name: 'Set a duration instead of an end time', exact: true });
  await durationToggle.check();
  await dialog.getByRole('spinbutton', { name: 'Hours', exact: true }).waitFor();
  await durationToggle.uncheck();
  await dialog.getByLabel('End time', { exact: true }).waitFor();

  await dialog.getByRole('checkbox', { name: 'All-day event', exact: true }).check();
  await chooseDate('Start date', '2026-10-03');
  await chooseDate('Last day (inclusive)', '2026-10-03');
  assert.equal(
    await dialog.getByRole('button', { name: 'Event timezone', exact: true }).count(),
    0,
    'All-day dates have no timezone chooser',
  );
  await dialog.getByRole('checkbox', { name: calendar.title, exact: true }).check();
  await capture('all-day-composer');
  const post = await publish(dialog, 'event', title);
  manifest.disposableAllDay = {
    id: post.id,
    uri: post.uri,
    calendar: calendar.uri,
    deleted: false,
    projectionDeletionVerified: false,
  };
  await save();
  assert.deepEqual(post.content.dtstart, { type: 'date', value: '2026-10-03' });
  assert.deepEqual(post.content.dtend, { type: 'date', value: '2026-10-04' });
  assert(post.content.calendar_uris.includes(calendar.uri));
  await check('all-day date, exclusive end and named calendar membership persisted');
  const source = sourceRequests.get(post.id);
  assert(source, 'Capture the authoritative all-day source request');
  assert.notEqual(new URL(source.url).hostname, 'homeserver.pubky.app');
  const before = await context.request.get(source.url, { headers: source.headers });
  assert.equal(before.status(), 200, 'The exact source must exist before deletion');
  assert.equal(JSON.parse((await before.json()).content).uid, post.content.uid);
  await page.goto(`${origin}/post/${post.id.replace(':', '/')}`, { waitUntil: 'domcontentloaded' });
  await page.getByText(title, { exact: true }).first().waitFor();
  await page.getByText('Oct 3, 2026 · All day', { exact: true }).waitFor();
  await capture('all-day-post');
  await check('all-day post displays the unchanged device calendar date');
  const visibleQuery = new URLSearchParams({
    from: '2026-10-02T22:00:00Z',
    to: '2026-10-04T22:00:00Z',
    timezone: 'Europe/Zurich',
    calendar: calendar.uri,
  });
  const indexedDeadline = Date.now() + 120000;
  while (Date.now() < indexedDeadline && !manifest.disposableAllDay.projectionSeen) {
    const projected = await context.request
      .get(`${origin}/api/eventky/occurrences?${visibleQuery}`)
      .then((response) => response.json());
    if (
      projected.ok &&
      projected.value.coverage.complete &&
      projected.value.items.some((item) => item.post_uri === post.uri)
    ) {
      manifest.disposableAllDay.projectionSeen = true;
      await check('all-day occurrence is present in its selected complete calendar projection');
    } else await page.waitForTimeout(2000);
  }
  assert(
    manifest.disposableAllDay.projectionSeen,
    'Wait for indexed all-day presence before testing deletion propagation',
  );

  await page.locator('[data-cy="post-more-btn"]').first().click();
  await page.locator('[data-cy="post-menu-action-delete"]').click();
  await page.locator('[data-cy="dialog-confirm-delete-btn"]').click();
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && !postDeletes.some((item) => item.url === source.url)) await page.waitForTimeout(250);
  assert(
    postDeletes.some((item) => item.url === source.url),
    'Native delete must receive a successful homeserver response',
  );
  const after = await context.request.get(source.url, { headers: source.headers });
  assert.equal(after.status(), 404, 'The same authoritative staging resource is absent after deletion');
  manifest.disposableAllDay.deleted = true;
  manifest.disposableAllDay.deletedAt = new Date().toISOString();
  await check('native all-day deletion confirmed by homeserver DELETE and subsequent GET 404');
  await verifyAllDayProjectionDeletion();
}
async function verifyAllDayProjectionDeletion() {
  const fixture = manifest.disposableAllDay;
  assert(fixture?.deleted, 'Authoritative source deletion must pass before projection absence is checked');
  assert(fixture.projectionSeen, 'Projection must have contained this fixture before its deletion');
  const query = new URLSearchParams({
    from: '2026-10-02T22:00:00Z',
    to: '2026-10-04T22:00:00Z',
    timezone: 'Europe/Zurich',
    calendar: fixture.calendar,
  });
  const deadline = Date.now() + 120000;
  let lastCode = 'NOT_READY';
  while (Date.now() < deadline) {
    const response = await context.request.get(`${origin}/api/eventky/occurrences?${query}`);
    const result = await response.json();
    lastCode = result.ok ? result.value.coverage.reasons.join(',') : result.code;
    if (
      result.ok &&
      result.value.coverage.complete &&
      !result.value.next_cursor &&
      !result.value.items.some((item) => item.post_uri === fixture.uri)
    ) {
      fixture.projectionDeletionVerified = true;
      fixture.projectionRevision = result.value.projection_revision;
      await check('complete calendar projection excludes the deleted all-day source');
      return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error(`Projection deletion remains unverified after authoritative deletion: ${lastCode}`);
}
async function capture(name) {
  const dialogHeading = page.getByRole('dialog').last().locator('h2:not(.sr-only)').first();
  if (await dialogHeading.isVisible()) await dialogHeading.click();
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && ['text', 'search', 'url', 'email'].includes(active.type))
      active.setSelectionRange(0, 0);
    window.getSelection()?.removeAllRanges();
  });
  await page.locator('[role="dialog"]').evaluateAll((dialogs) =>
    dialogs.forEach((dialog) => {
      dialog.scrollTop = 0;
    }),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${evidence}/${name}-desktop.png`, fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[role="dialog"]').evaluateAll((dialogs) =>
    dialogs.forEach((dialog) => {
      dialog.scrollTop = 0;
    }),
  );
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${evidence}/${name}-mobile.png`, fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
}
try {
  await page.goto(`${origin}/home`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const config = await page.evaluate(() => window.__PUBKY_CONFIG__);
  assert.equal(config.homeserver, stagingHomeserver, 'Staging homeserver is mandatory');
  assert.equal(config.deployEnv, 'staging', 'Staging deployment is mandatory');
  await check('runtime uses staging homeserver');
  if (phase === 'inspect') {
    await fs.writeFile(`${evidence}/inspect.txt`, await page.locator('body').innerText());
    await capture('home');
    console.log('Read-only inspection complete; authoring awaits isolated staging Nexus routing.');
  } else {
    assert.equal(process.env.EVENTKY_STAGING_ROUTE_READY, 'yes', 'Explicit isolated staging route gate is required');
    const status = await context.request.get(`${origin}/api/eventky/status`).then((response) => response.json());
    assert.equal(status.value?.backend_id, 'http://staging-nexus:8080', 'Isolated staging Nexus is mandatory');
    if (phase === 'create') await createFixtures();
    else if (phase === 'edit') await editEvent();
    else if (phase === 'curate') await curateCalendar();
    else if (phase === 'curate-guest') await curateGuestEvent();
    else if (phase === 'all-day') await allDayLifecycle();
    else if (phase === 'verify-all-day-deletion') await verifyAllDayProjectionDeletion();
    else if (phase === 'compose-preview') {
      for (const kind of ['event', 'calendar']) {
        const post = manifest.posts.find((item) => item.kind === kind);
        await page.goto(`${origin}/post/${post.id.replace(':', '/')}`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-cy="post-more-btn"]').first().click();
        await page.locator('[data-cy="post-menu-action-edit"]').click();
        await page
          .getByRole('dialog', { name: `Edit ${kind}`, exact: true })
          .getByRole('textbox', { name: kind === 'event' ? 'Event title' : 'Calendar name', exact: true })
          .waitFor();
        const dialog = page.getByRole('dialog', { name: `Edit ${kind}`, exact: true });
        if (kind === 'event') await dialog.getByText('Recurrence and advanced details', { exact: true }).click();
        await dialog.locator('[contenteditable="true"]').waitFor({ state: 'visible' });
        const text = await dialog.innerText();
        assert(
          !/Show this time as free|\bimport\b|\bexport\b|\breminders?\b|\balarms?\b|paste.{0,30}uri|calendar uri|event uri/i.test(
            text,
          ),
          'Removed authoring controls must remain absent, including advanced details',
        );
        const resourceControls = await dialog
          .locator('input, textarea')
          .evaluateAll((inputs) =>
            inputs.map((input) => ({
              name: input.getAttribute('name'),
              label: input.getAttribute('aria-label'),
              placeholder: input.getAttribute('placeholder'),
            })),
          );
        assert(
          !/calendarUris|excludedEventUris|paste.{0,30}uri|public key/i.test(JSON.stringify(resourceControls)),
          'Calendar, contributor and event resources use native named pickers',
        );
        assert.equal(
          await dialog.getByRole('button', { name: 'Event timezone', exact: true }).count(),
          kind === 'event' ? 1 : 0,
        );
        await fs.writeFile(
          `${evidence}/${kind}-authoring-audit.json`,
          JSON.stringify({ text, resourceControls, timezoneChooser: kind === 'event' }, null, 2),
        );
        await check(`${kind} authoring absence audit passed with native resource pickers and event-only timezone`);
        await capture(`${kind}-composer`);
        assert.equal(postWrites.length, 0, 'Read-only editor inspection must not publish changes');
        await check(`existing ${kind} opens in native editor without a source write`);
      }
    } else if (phase === 'view') {
      const event = manifest.posts.find((post) => post.kind === 'event');
      await page.goto(`${origin}/post/${event.id.replace(':', '/')}`, { waitUntil: 'domcontentloaded' });
      await page.getByText(event.title, { exact: true }).first().waitFor({ timeout: 90000 });
      await capture('event-post');
      await check('published event renders in native post shell');
    } else throw new Error(`Authoring phase ${phase} is not prepared yet`);
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
