// Run with npm run test:browser (Edge on Windows, Playwright Chromium elsewhere).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('../server.cjs');
(async () => {
  const { app, db } = createApp({ database: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); const errors = []; let guestWrites = 0, watchGuest = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (watchGuest && request.url().endsWith('/api/history') && request.method() === 'POST') guestWrites++; });
  const shots = path.join(os.tmpdir(), 'metsu-flow-previews'); fs.mkdirSync(shots, { recursive: true });
  const shot = name => page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
  async function noOverflow(label) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, label); }
  async function battle() {
    await page.locator('#input-text').fill('仕事がつらい'); await page.locator('#generate-btn').click();
    await page.waitForURL('**/battle.html');
    await page.locator('#monster').waitFor();
    for (let i = 0; i < 50; i++) {
      if (await page.locator('#monster').isDisabled()) break;
      await page.locator('#monster').click();
    }
    await page.waitForURL('**/result.html', { timeout: 15000 });
  }
  try {
    await page.goto(base); await page.locator('#guest-btn').waitFor();
    await shot('welcome');
    assert.equal(await page.getByText('STRESS BREAKER / METSU').count(), 0);
    await page.locator('#show-register').click();
    await page.locator('#username').fill('browser_player'); await page.locator('#password').fill('long test password');
    await page.locator('#auth-submit').click(); await page.locator('#history-panel').waitFor();
    await page.locator('#stress-level').fill('5');
    await page.locator('#choose-mode').click(); await page.locator('#input-text').waitFor();
    await battle();
    await page.waitForFunction(() => document.getElementById('history-save-status').textContent.includes('保存しました'));
    await page.locator('#replay-btn').click();
    await page.waitForFunction(() => document.getElementById('history-monsters').textContent === '1');
    await page.locator('.history-details summary').click(); await shot('account-history');
    assert.equal(await page.locator('.history-item').count(), 1);
    await page.reload(); await page.waitForFunction(() => document.getElementById('history-games').textContent === '1');
    for (const width of [320, 375, 390, 447, 448, 620, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 }); await noOverflow(`dashboard ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // A failed history write must remain visibly pending, then retry exactly once.
    await page.route('**/api/history', route => route.request().method() === 'POST'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary offline test' }) }) : route.continue());
    await page.locator('#choose-mode').click(); await page.locator('#input-text').waitFor(); await battle();
    await page.locator('#retry-save').waitFor();
    assert.match(await page.locator('#history-save-status').innerText(), /未保存/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM battles').get().n, 1);
    await page.unroute('**/api/history'); await page.locator('#retry-save').click();
    await page.waitForFunction(() => document.getElementById('history-save-status').textContent.includes('保存しました'));
    await page.reload();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM battles').get().n, 2);
    await page.locator('#replay-btn').click(); await page.locator('#leave-btn').waitFor();
    await page.locator('#leave-btn').click(); await page.locator('#guest-btn').waitFor();
    watchGuest = true;
    await page.locator('#guest-btn').click();
    assert.equal(await page.locator('#history-panel').isVisible(), false);
    assert.equal(await page.locator('#stress-control').isVisible(), false);
    await page.locator('input[name="hand-mode"][value="shake"]').check();
    await shot('guest-modes');
    await page.locator('#choose-mode').click();
    await page.locator('#input-text').waitFor();
    assert.match(await page.locator('#selected-mode-label').textContent(), /シェイク/);
    await page.locator('#back-to-modes').click();
    await page.locator('input[name="play-style"][value="bag"]').check();
    assert.equal(await page.locator('#hand-modes').isVisible(), false);
    await page.locator('#choose-mode').click(); await battle();
    assert.match(await page.locator('#history-save-status').innerText(), /保存されません/);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('metsuBattleData')), null);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('metsuResultData')), null);
    assert.equal(guestWrites, 0); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM battles').get().n, 2);
    await page.locator('#replay-btn').click(); await page.locator('#leave-btn').click();
    for (const width of [320, 375, 390, 447, 448, 620, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 }); await noOverflow(`welcome ${width}`);
    }
    await page.locator('#show-login').click();
    await page.locator('#username').fill('browser_player'); await page.locator('#password').fill('long test password');
    await page.locator('#auth-submit').click();
    await page.waitForFunction(() => document.getElementById('history-monsters').textContent === '2');
    assert.deepEqual(errors, []);
    console.log(`PASS: register/login, account history, guest privacy, modes, 8 viewport widths. Previews: ${shots}`);
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve)); db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
