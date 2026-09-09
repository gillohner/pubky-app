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
page.setDefaultTimeout(30000);
const save = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
const checked = (name) => report.checks.some((check) => check.name === name);
const check = async (name) => {
  if (!checked(name)) report.checks.push({ name, at: new Date().toISOString() });
  await save();
  console.log('PASS', name);
};
const isStaging = (url) =>
  url.hostname === 'staging.homeserver.pubky.app' || url.hostname.endsWith('.staging.homeserver.pubky.app');
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
  const source = await context.request.get(response.url());
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
  await page.keyboard.press('Escape');
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
  await openEvent();
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
    } else if (phase === 'reload') await verifyReload();
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
