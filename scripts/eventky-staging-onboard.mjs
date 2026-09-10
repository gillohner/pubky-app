import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const role = process.env.EVENTKY_TEST_ROLE ?? 'owner';
if (!['owner', 'guest'].includes(role)) throw new Error('Unknown fixture role');
const origin = process.env.EVENTKY_TEST_ORIGIN ?? 'https://159.69.22.174';
const profile = `/tmp/eventky-staging-browser-${role}`;
await fs.mkdir(profile, { recursive: true, mode: 0o700 });
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: { width: 1440, height: 1000 },
  timezoneId: 'Europe/Zurich',
});
const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(90000);
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) console.log('NAV', new URL(frame.url()).pathname);
});
page.on('pageerror', (error) => console.log('Browser exception', error.name));
try {
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'homeserver.pubky.app') throw new Error('Production homeserver request blocked');
    await route.continue();
  });
  await page.goto(origin, { timeout: 120000, waitUntil: 'domcontentloaded' });
  const config = await page.evaluate(() => window.__PUBKY_CONFIG__);
  if (config.homeserver !== 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy' || config.deployEnv !== 'staging')
    throw new Error('Refuse non-staging app');
  console.log('Staging configuration verified');
  await page.locator('#create-account-btn').click();
  await page.locator('[data-cy="invite-code-link"]').click();
  console.log('READY_FOR_TOKEN');
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.includes('\n')) break;
  }
  const token = raw.trim();
  await page.locator('[data-cy="human-invite-code-input"]').fill(token);
  await page.locator('[data-cy="human-invite-code-continue-btn"]').click();
  await page.locator('#create-keys-in-browser-btn').click();
  const pubky = await page.locator('[data-cy="pubky-display"]').inputValue();
  await page.locator('#public-key-navigation-continue-btn').click();
  await page.locator('#backup-navigation-continue-btn').click();
  await page.locator('#profile-name-input').fill(`Eventky staging ${role}`);
  await page.locator('#profile-bio-input').fill('Disposable staging account for native calendar end-to-end tests.');
  await page.locator('#profile-finish-btn').click();
  await page.locator('[data-testid="tags-of-interest-form"] #profile-finish-btn').click();
  await page.waitForURL('**/home');
  await page.locator('#welcome-explore-pubky-btn').click();
  await fs.writeFile(
    `/tmp/eventky-staging-${role}-public.json`,
    JSON.stringify({ pubky, origin, homeserver: config.homeserver }),
    { mode: 0o600 },
  );
  await page.screenshot({ path: `/tmp/eventky-staging-${role}-home.png`, fullPage: true });
  console.log('Staging onboarding passed', pubky);
} catch (error) {
  console.error('Onboarding failed', error instanceof Error ? error.name : 'Unknown error');
  console.error('Path', new URL(page.url()).pathname);
  process.exitCode = 1;
} finally {
  await context.close();
}
