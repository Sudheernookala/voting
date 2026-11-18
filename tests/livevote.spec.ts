import { test, expect, devices, type Browser, type Page } from '@playwright/test';

// End-to-end tests against the local Firebase emulator, using the real security rules.
// Run: npm run test:e2e

const phone = devices['iPhone 13'];

async function newPage(browser: Browser, mobile = false) {
  const ctx = await browser.newContext(mobile ? phone : { viewport: { width: 1280, height: 1000 } });
  return ctx.newPage();
}

/** Signs in as a Google user through the auth emulator (no real Google account needed). */
async function signInGoogle(page: Page, email: string) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__livevote?.auth.currentUser);
  await page.evaluate(async email => {
    const { auth, authLib } = (window as any).__livevote;
    await authLib.signInWithCredential(auth, authLib.GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true })));
  }, email);
  await page.reload();
}

/** Runs a raw database operation as the current user. Returns 'OK' or 'DENIED'. */
function tryDb(page: Page, fn: string, arg: unknown = null): Promise<string> {
  return page.evaluate(async ([fn, arg]) => {
    const { auth, db, dbLib: d } = (window as any).__livevote;
    const uid = auth.currentUser.uid;
    try { await new Function('d', 'db', 'uid', 'arg', `return (${fn})(d, db, uid, arg)`)(d, db, uid, arg); return 'OK'; }
    catch { return 'DENIED'; }
  }, [fn, arg] as const);
}

async function hostCreatesMeeting(browser: Browser, title: string) {
  const host = await newPage(browser);
  await signInGoogle(host, 'host@example.com');
  await host.fill('#mtitle', title);
  await host.click('#createForm button');
  await host.waitForURL(/host=/);
  return { host, code: new URL(host.url()).searchParams.get('host')! };
}

async function addCategory(host: Page, title: string, options: string, multi = 1) {
  await host.fill('#ctitle', title);
  await host.fill('#opt', options);
  await host.click('#addOpt');
  await host.selectOption('#cmulti', String(multi));
  await host.click('[data-open="1"]');
  await expect(host.locator('h2', { hasText: title })).toBeVisible();
}

async function joinAs(browser: Browser, code: string, name: string | null) {
  const p = await newPage(browser, true);
  await p.goto(`/?join=${code}`);
  if (name) await p.fill('#vname', name); else await p.check('#vanon');
  await p.click('#nameForm button');
  await expect(p.getByText(/Hi/)).toBeVisible();
  return p;
}

const card = (p: Page, title: string) => p.locator('.card', { has: p.locator('h2', { hasText: title }) });

async function vote(p: Page, category: string, picks: string[]) {
  const c = card(p, category);
  for (const label of picks) await c.locator('.option', { hasText: label }).click();
  await c.locator('[data-submit]').click();
  await expect(c.getByText('is recorded')).toBeVisible();
}

test('only listed hosts can create meetings', async ({ browser }) => {
  const visitor = await newPage(browser);
  await visitor.goto('/');
  await expect(visitor.getByText('Join a vote')).toBeVisible();
  await expect(visitor.locator('#createForm')).toHaveCount(0);
  await visitor.waitForFunction(() => (window as any).__livevote?.auth.currentUser);
  const create = `(d, db) => d.update(d.ref(db, '/'), { 'hostSecrets/ZZZZZ2': 'k'.repeat(32), 'meetings/ZZZZZ2/info': { title: 'x', createdAt: 1 } })`;
  expect(await tryDb(visitor, create)).toBe('DENIED');
  expect(await tryDb(visitor, `(d, db) => d.set(d.ref(db, 'admins/me@x,com'), true)`)).toBe('DENIED');

  const outsider = await newPage(browser);
  await signInGoogle(outsider, 'stranger@example.com');
  await expect(outsider.getByText('Not allowed to host')).toBeVisible();
  expect(await tryDb(outsider, create)).toBe('DENIED');

  const { host } = await hostCreatesMeeting(browser, 'Access test');
  await expect(host.getByText('No voting categories yet')).toBeVisible();
});

test('voting: single, multiple choice and anonymous, then reveal the winner', async ({ browser }) => {
  const { host, code } = await hostCreatesMeeting(browser, 'Awards Night');
  await addCategory(host, 'Best Speaker', 'Kiran, Priya, John');
  await addCategory(host, 'Best Team Players', 'Asha, Ravi, Meena, Tom', 2);
  await expect(host.getByText('Multiple choice: up to 2 per person')).toBeVisible();

  const asha = await joinAs(browser, code, 'Asha');
  const ravi = await joinAs(browser, code, 'Ravi');
  const anon = await joinAs(browser, code, null);
  await expect(anon.getByText('voting anonymously')).toBeVisible();

  await vote(asha, 'Best Speaker', ['Priya']);
  await vote(ravi, 'Best Speaker', ['Priya']);
  await vote(anon, 'Best Speaker', ['Kiran']);

  // multiple choice: a third pick is refused
  const c = card(asha, 'Best Team Players');
  await c.locator('.option', { hasText: 'Ravi' }).click();
  await c.locator('.option', { hasText: 'Meena' }).click();
  await c.locator('.option', { hasText: 'Tom' }).click();
  await expect(asha.getByText('You can choose up to 2')).toBeVisible();
  await c.locator('[data-submit]').click();
  await expect(c.getByText('Your vote for Ravi, Meena is recorded')).toBeVisible();

  // host results
  const speaker = card(host, 'Best Speaker');
  await expect(speaker.getByText('3 votes received out of 3 joined')).toBeVisible();
  await expect(speaker.getByText('Leading: Priya with 2 votes')).toBeVisible();
  await speaker.getByText('Verify: who voted for whom').click();
  const priyaRow = speaker.locator('.voter-list li', { hasText: 'Priya:' });
  await expect(priyaRow).toContainText('Asha');
  await expect(priyaRow).toContainText('Ravi');
  await expect(speaker.locator('.voter-list li', { hasText: 'Kiran:' })).toContainText('1 anonymous');

  // ----- attacks from a participant -----
  const catIds = await host.evaluate(() => [...document.querySelectorAll('[data-reveal]')].map(b => (b as HTMLElement).dataset.reveal));
  const speakerId = await speaker.locator('[data-reveal]').getAttribute('data-reveal');
  const base = `meetings/${code}`;
  expect(await tryDb(asha, `(d, db, uid, a) => d.set(d.ref(db, a + '/ballots/' + uid + '/' + '${speakerId}'), 'x')`, base)).toBe('DENIED'); // vote twice
  expect(await tryDb(asha, `(d, db, uid, a) => d.get(d.ref(db, a + '/ballots'))`, base)).toBe('DENIED'); // read everyone's votes
  expect(await tryDb(asha, `(d, db, uid, a) => d.update(d.ref(db, a + '/categories/${speakerId}'), { status: 'closed', reveal: { at: 1, winners: [], votes: 0, voters: 0 } })`, base)).toBe('DENIED'); // fake a reveal
  expect(catIds.length).toBe(2);
  await expect(asha.locator('main')).toBeVisible(); // a rejected fake reveal must not crash the page

  // ----- reveal the winner -----
  host.once('dialog', d => d.accept());
  await speaker.locator('[data-reveal]').click();
  const revealedAt = Date.now();
  // every screen shows the countdown at the same time, then the winner
  await Promise.all([host, asha, anon].map(p => expect(p.locator('.reveal').getByText('And the winner is…')).toBeVisible()));
  await Promise.all([host, asha, anon].map(p => expect(p.locator('.reveal .reveal-name')).toHaveText('Priya', { timeout: 8000 })));
  await expect(asha.locator('.reveal').getByText('2 votes · 3 voters took part')).toBeVisible();
  await asha.locator('.reveal').getByRole('button', { name: 'Close' }).click();
  await expect(asha.locator('.card', { hasText: 'Best Speaker' }).getByText('Winner: Priya')).toBeVisible(); // stays on the closed card
  await expect(speaker.getByText('Winner revealed')).toBeVisible();

  // a participant who opens the page later only sees the result, not the animation
  const late = await joinAs(browser, code, 'Late Larry');
  await late.waitForTimeout(1000);
  if (Date.now() - revealedAt > 30_000) await expect(late.locator('.reveal')).toHaveCount(0);
  await expect(late.locator('.card', { hasText: 'Best Speaker' }).getByText('Winner: Priya')).toBeVisible();
});

test('reveal shows a tie', async ({ browser }) => {
  const { host, code } = await hostCreatesMeeting(browser, 'Tie test');
  await addCategory(host, 'Best Idea', 'Alpha, Beta');
  const a = await joinAs(browser, code, 'A');
  const b = await joinAs(browser, code, 'B');
  await vote(a, 'Best Idea', ['Alpha']);
  await vote(b, 'Best Idea', ['Beta']);
  host.once('dialog', d => d.accept());
  await card(host, 'Best Idea').locator('[data-reveal]').click();
  await expect(a.locator('.reveal').getByText("It's a tie!")).toBeVisible({ timeout: 8000 });
  await expect(a.locator('.reveal .reveal-name')).toHaveText('Alpha & Beta');
});

test('feedback: answer, thank-you, host deletes', async ({ browser }) => {
  const { host, code } = await hostCreatesMeeting(browser, 'Feedback test');
  const p = await joinAs(browser, code, 'Asha');
  await host.fill('#fbQ', 'How was it?');
  await host.click('#fbOpen');
  await expect(p.locator('#fbOverlay')).toBeVisible();
  await p.click('[data-star="4"]');
  await p.fill('#fbText', 'Great session');
  await p.click('#fbSend');
  await expect(p.getByText('Thank you!')).toBeVisible();
  await expect(host.getByText('Great session')).toBeVisible();
  expect(await tryDb(p, `(d, db, uid, a) => d.get(d.ref(db, a + '/feedback/round')).then(s => d.remove(d.ref(db, a + '/responses/' + s.val())))`, `meetings/${code}`)).toBe('DENIED');
  host.once('dialog', d => d.accept());
  await host.locator('[data-del-vid]').click();
  await expect(host.getByText('No feedback yet.')).toBeVisible();
});

test('host sees past meetings and can delete them', async ({ browser }) => {
  const { host, code } = await hostCreatesMeeting(browser, 'Quarterly Review');
  await host.goto('/');
  const item = host.locator('#myMeetings li', { hasText: 'Quarterly Review' });
  await expect(item).toContainText('deletes in 30 days');
  host.once('dialog', d => d.accept());
  await item.locator(`[data-del="${code}"]`).click();
  await expect(item).toHaveCount(0);
});
