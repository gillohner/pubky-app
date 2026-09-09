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
let manifest = await fs.readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => ({ origin, owner: ownerId, checks: [], posts: [] }));
manifest.owner = ownerId;
const context = await chromium.launchPersistentContext('/tmp/eventky-staging-browser-owner', {
  headless: true, viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Zurich',
});
const page = context.pages()[0] ?? await context.newPage();
page.setDefaultTimeout(45000);
const evidence = '/tmp/eventky-staging-authoring';
await fs.mkdir(evidence, { recursive: true });
const save = () => fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
const check = async (name) => { manifest.checks.push({name, at:new Date().toISOString()}); await save(); console.log('PASS', name); };
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
  const button = page.getByRole('button', {name: `Add ${kind}`, exact:true}).first();
  if (!await button.isVisible()) await page.locator('textarea[name="post-input-textarea"]').first().click();
  await button.click();
  return page.getByRole('dialog', {name: `New ${kind}`, exact:true});
}
async function chooseDate(label, iso) {
  await page.getByRole('button', {name:label,exact:true}).click();
  const date = new Date(`${iso}T12:00:00`);
  const month = date.toLocaleDateString('en-US',{month:'long'});
  const heading = `${month} ${date.getFullYear()}`;
  for(let attempt=0;attempt<24 && !await page.getByText(heading,{exact:true}).isVisible();attempt++) {
    await page.getByRole('button',{name:'Go to the Next Month'}).click();
  }
  await page.getByRole('button', {name:new RegExp(`${month} ${date.getDate()}(?:st|nd|rd|th), ${date.getFullYear()}`)}).click();
}
const postWrites = [];
page.on('response', async response => {
  const request = response.request();
  if(request.method() !== 'PUT' || !request.url().includes('/pub/pubky.app/posts/') || !response.ok()) return;
  try {
    const body = JSON.parse(request.postData());
    const match = new URL(request.url()).pathname.match(/\/pub\/pubky\.app\/posts\/([^/]+)$/);
    if(!match || !['event','calendar'].includes(body.kind)) return;
    const content = JSON.parse(body.content);
    postWrites.push({ id:`${ownerId}:${match[1]}`, uri:`pubky://${ownerId}/pub/pubky.app/posts/${match[1]}`, kind:body.kind, title:content.summary ?? content.name, content });
  } catch { /* Non-JSON upload requests are attachments, not post envelopes. */ }
});
async function publish(dialog, kind, title) {
  await dialog.getByRole('button',{name:`Publish ${kind}`,exact:true}).click();
  await dialog.waitFor({state:'hidden',timeout:90000});
  const deadline=Date.now()+15000;
  while(Date.now()<deadline && !postWrites.some(post=>post.title===title)) await page.waitForTimeout(200);
  const post=postWrites.findLast(post=>post.title===title);
  assert(post, 'A successful native homeserver PUT must provide the fixture identity');
  manifest.posts.push(post); await save(); await check(`${kind} published through native UI`);
  console.log('FIXTURE',JSON.stringify({kind,id:post.id,uri:post.uri,title}));
  return post;
}
async function createFixtures() {
  if(manifest.posts.some(post=>post.kind==='event')) throw new Error('Fixtures already exist; use edit phase instead of duplicating them');
  const suffix=new Date().toISOString().slice(0,16).replaceAll(':','-');
  const calendarTitle=`Eventky staging community ${suffix}`;
  let dialog=await openComposer('calendar');
  await dialog.getByRole('textbox',{name:'Calendar name',exact:true}).fill(calendarTitle);
  await dialog.locator('[contenteditable="true"]').fill('Community calendar for real staging integration checks.');
  // Contributor selection is tested after the new guest profile reaches the staging index.
  await capture('calendar-composer');
  const calendar=await publish(dialog,'calendar',calendarTitle);
  // Reopen against fresh indexed native calendar data, preserving this account's UI writes.
  const eventTitle=`Eventky staging meetup ${suffix}`;
  dialog=await openComposer('event');
  await dialog.getByRole('textbox',{name:'Event title',exact:true}).fill(eventTitle);
  await dialog.locator('[contenteditable="true"]').fill('A recurring community meetup. Bring your calendar ideas.');
  await chooseDate('Start date','2026-10-01');
  await chooseDate('End date','2026-10-01');
  await dialog.getByLabel('Start time',{exact:true}).fill('18:00');
  await dialog.getByLabel('End time',{exact:true}).fill('20:00');
  await dialog.getByRole('button',{name:'Event timezone',exact:true}).click();
  await page.getByRole('textbox',{name:'Search timezones'}).fill('New York');
  await page.getByRole('button',{name:'America/New York',exact:true}).click();
  await dialog.getByRole('textbox',{name:'Venue or location',exact:true}).fill('Community studio');
  await dialog.getByRole('checkbox',{name:calendarTitle,exact:true}).check({timeout:90000});
  await dialog.getByText('Recurrence and advanced details',{exact:true}).click();
  await dialog.getByRole('combobox',{name:'Repeats',exact:true}).selectOption('weekly');
  await dialog.getByRole('textbox',{name:'Recurrence rule',exact:true}).fill('FREQ=WEEKLY;COUNT=6');
  await dialog.getByRole('button',{name:'Add new tag',exact:true}).click();
  await dialog.locator('[data-cy="add-tag-input"]').fill('eventky-staging');
  await dialog.locator('[data-cy="add-tag-input"]').press('Enter');
  await capture('event-composer');
  const event=await publish(dialog,'event',eventTitle);
  assert.equal(event.content.dtstart.tzid,'America/New_York');
  assert(event.content.calendar_uris.includes(calendar.uri));
  assert.equal(event.content.rrule,'FREQ=WEEKLY;COUNT=6');
  await check('event timezone, recurrence and named calendar membership persisted');
  await page.goto(`${origin}/post/${event.id.replace(':', '/')}`,{waitUntil:'domcontentloaded'});
  await capture('event-post');
}
async function editEvent() {
  const fixture=manifest.posts.find(post=>post.kind==='event');
  assert(fixture,'Create the real staging event first');
  await page.goto(`${origin}/post/${fixture.id.replace(':','/')}`,{waitUntil:'domcontentloaded'});
  await page.locator('[data-cy="post-more-btn"]').first().click();
  await page.locator('[data-cy="post-menu-action-edit"]').click();
  const dialog=page.getByRole('dialog',{name:'Edit event',exact:true});
  await dialog.getByRole('textbox',{name:'Event title',exact:true}).fill(`${fixture.title} · updated`);
  await dialog.getByText('Recurrence and advanced details',{exact:true}).click();
  await dialog.getByRole('button',{name:'Preview occurrences'}).click();
  await dialog.getByText('Oct 1, 2026, 6:00 PM (America/New_York)',{exact:true}).click();
  await chooseDate('Move to date','2026-10-02');
  await dialog.getByRole('button',{name:'Apply to this occurrence'}).click();
  await dialog.getByRole('button',{name:'Preview occurrences'}).click();
  await dialog.getByText('Oct 8, 2026, 6:00 PM (America/New_York)',{exact:true}).click();
  await dialog.getByRole('button',{name:'Cancel this occurrence'}).click();
  const {default:sharp}=await import('sharp');
  const attachment=`${evidence}/community-banner.png`;
  await sharp(Buffer.from('<svg width="480" height="160" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="160" fill="#101010"/><text x="24" y="90" fill="#c8ff00" font-size="32" font-family="sans-serif">Community meetup</text></svg>')).png().toFile(attachment);
  await dialog.locator('input[type="file"]').setInputFiles(attachment);
  await capture('event-edit');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await dialog.waitFor({state:'hidden',timeout:90000});
  const deadline=Date.now()+15000;
  while(Date.now()<deadline && !postWrites.some(post=>post.id===fixture.id)) await page.waitForTimeout(200);
  const saved=postWrites.findLast(post=>post.id===fixture.id);
  assert(saved,'Edited source must be confirmed by the homeserver response');
  assert.equal(saved.content.uid,fixture.content.uid);
  assert(saved.content.overrides.some(item=>item.recurrence_id.value==='2026-10-01T18:00:00' && item.changes.dtstart.value==='2026-10-02T18:00:00'));
  assert(saved.content.overrides.some(item=>item.recurrence_id.value==='2026-10-08T18:00:00' && item.changes.status==='CANCELLED'));
  manifest.posts=manifest.posts.map(post=>post.id===saved.id?saved:post);
  await check('native edit moved and cancelled occurrences while preserving series identity');
  await capture('edited-event-post');
}
async function curateCalendar() {
  const calendar=manifest.posts.find(post=>post.kind==='calendar');
  const event=manifest.posts.find(post=>post.kind==='event');
  assert(calendar && event,'Create staging calendar and event first');
  const guestId='ybjyked1u5ktb37rhzq71ddogywq7dcwmjsdumdcrh7u8reuscxy';
  const guestResponse=await context.request.get(`${origin}/v0/user/${guestId}/details`);
  assert(guestResponse.ok(),'Guest profile must be indexed before contributor selection');
  async function openCalendar() {
    await page.goto(`${origin}/post/${calendar.id.replace(':','/')}`,{waitUntil:'domcontentloaded'});
    await page.locator('[data-cy="post-more-btn"]').first().click();
    await page.locator('[data-cy="post-menu-action-edit"]').click();
    return page.getByRole('dialog',{name:'Edit calendar',exact:true});
  }
  let dialog=await openCalendar();
  await dialog.getByRole('textbox',{name:'Find contributors'}).fill('Eventky staging guest');
  await dialog.getByRole('button',{name:'Eventky staging guest',exact:true}).click();
  await dialog.getByText(/^Excluded events/).click();
  await dialog.getByRole('checkbox',{name:event.title,exact:true}).check();
  await capture('calendar-curation');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await dialog.waitFor({state:'hidden',timeout:90000});
  let saved=postWrites.findLast(post=>post.id===calendar.id);
  assert(saved?.content.contributors.includes(guestId));
  assert(saved.content.excluded_event_uris.includes(event.uri));
  await check('full-name contributor selection and named event exclusion persisted');
  // Restore membership for the final shared demo, keeping the approved guest contributor.
  dialog=await openCalendar();
  await dialog.getByText(/^Excluded events/).click();
  await dialog.getByRole('checkbox',{name:event.title,exact:true}).uncheck();
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await dialog.waitFor({state:'hidden',timeout:90000});
  saved=postWrites.findLast(post=>post.id===calendar.id);
  assert(!saved.content.excluded_event_uris.includes(event.uri));
  manifest.posts=manifest.posts.map(post=>post.id===saved.id?saved:post);
  await check('named event exclusion can be removed without modifying the event post');
}
async function capture(name) {
  await page.evaluate(()=>{
    const active=document.activeElement;
    if(active instanceof HTMLInputElement && ['text','search','url','email'].includes(active.type)) active.setSelectionRange(0,0);
    if(active instanceof HTMLElement) active.blur();
    window.getSelection()?.removeAllRanges();
  });
  await page.locator('[role="dialog"]').evaluateAll(dialogs=>dialogs.forEach(dialog=>{dialog.scrollTop=0;}));
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({path:`${evidence}/${name}-desktop.png`,fullPage:false});
  await page.setViewportSize({width:390,height:844});
  await page.locator('[role="dialog"]').evaluateAll(dialogs=>dialogs.forEach(dialog=>{dialog.scrollTop=0;}));
  await page.waitForTimeout(250);
  await page.screenshot({path:`${evidence}/${name}-mobile.png`,fullPage:false});
  await page.setViewportSize({width:1440,height:1000});
}
try {
  await page.goto(`${origin}/home`, {waitUntil:'domcontentloaded',timeout:120000});
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
    const status = await context.request.get(`${origin}/api/eventky/status`).then(response=>response.json());
    assert.equal(status.value?.backend_id,'http://staging-nexus:8080','Isolated staging Nexus is mandatory');
    if(phase === 'create') await createFixtures();
    else if(phase === 'edit') await editEvent();
    else if(phase === 'curate') await curateCalendar();
    else if(phase === 'compose-preview') {
      const event=manifest.posts.find(post=>post.kind==='event');
      await page.goto(`${origin}/post/${event.id.replace(':','/')}`,{waitUntil:'domcontentloaded'});
      await page.locator('[data-cy="post-more-btn"]').first().click();
      await page.locator('[data-cy="post-menu-action-edit"]').click();
      await page.getByRole('dialog',{name:'Edit event',exact:true}).getByRole('textbox',{name:'Event title',exact:true}).waitFor();
      await capture('event-composer');
      await check('existing event opens in native editor without a source write');
    }
    else if(phase === 'view') {
      const event=manifest.posts.find(post=>post.kind==='event');
      await page.goto(`${origin}/post/${event.id.replace(':','/')}`,{waitUntil:'domcontentloaded'});
      await page.getByText(event.title,{exact:true}).first().waitFor({timeout:90000});
      await capture('event-post');
      await check('published event renders in native post shell');
    }
    else throw new Error(`Authoring phase ${phase} is not prepared yet`);
  }
} catch (error) {
  console.error(error.stack ?? String(error));
  await page.screenshot({path:`${evidence}/failure.png`,fullPage:false}).catch(()=>{});
  await fs.writeFile(`${evidence}/failure.txt`, await page.locator('body').innerText().catch(()=>''));
  process.exitCode=1;
} finally { await save(); await context.close(); }
