const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server.cjs');

test('accounts, private persistent history, retries, logout and guest isolation', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metsu-db-test-'));
  const database = path.join(dir, 'test.sqlite');
  let { app, db } = createApp({ database });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function request(url, method = 'GET', body, cookie = '', headers = {}) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Metsu-Request': '1', Cookie: cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0], rawCookie: res.headers.get('set-cookie') };
  }
  assert.equal((await request('/api/history')).status, 401);
  assert.equal((await request('/api/history', 'POST', {})).status, 401);
  assert.equal((await request('/api/register', 'POST', { username: 'a', password: 'short' })).status, 400);
  const first = await request('/api/register', 'POST', { username: 'PlayerOne', password: 'correct horse battery' });
  assert.equal(first.status, 200); assert.match(first.rawCookie, /HttpOnly/); assert.match(first.rawCookie, /SameSite=Strict/);
  assert.equal(first.data.user.username, 'playerone');
  const stored = db.prepare('SELECT * FROM users').get();
  assert.notEqual(stored.password_hash, 'correct horse battery'); assert.equal(stored.password_hash.length, 128);
  assert.equal((await request('/api/register', 'POST', { username: 'PLAYERONE', password: 'correct horse battery' })).status, 409);
  assert.equal((await request('/api/login', 'POST', { username: 'playerone', password: 'incorrect password' })).status, 401);
  const second = await request('/api/register', 'POST', { username: 'playertwo', password: 'another long password' });
  const item = { id: 'abcdefgh_0', runId: 'abcdefgh', ownerId: first.data.user.id, mode: 'punch',
    category: '仕事', monster: 'career', form: 'normal', stress: 4, elapsedMs: 12000, attacks: 9, damage: 150,
    startedAt: new Date(Date.now() - 12000).toISOString(), endedAt: new Date().toISOString() };
  assert.equal((await request('/api/history', 'POST', item, second.cookie)).status, 400);
  assert.equal((await request('/api/history', 'POST', item, first.cookie, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/api/history', 'POST', item, first.cookie, { 'X-Metsu-Request': '' })).status, 403);
  assert.equal((await request('/api/history', 'POST', { ...item, stress: 99 }, first.cookie)).status, 400);
  assert.equal((await request('/api/history', 'POST', { ...item, monster: '../api' }, first.cookie)).status, 400);
  assert.equal((await request('/api/history', 'POST', item, first.cookie)).status, 200);
  assert.equal((await request('/api/history', 'POST', item, first.cookie)).status, 200);
  await request('/api/history', 'POST', { ...item, id: 'abcdefgh_1', monster: 'study' }, first.cookie);
  const history = (await request('/api/history', 'GET', undefined, first.cookie)).data;
  assert.equal(history.rows.length, 2); assert.equal(history.stats.games, 1); assert.equal(history.stats.elapsed_ms, 24000);
  assert.equal(history.trend.length, 1); assert.equal(history.rows[0].rawText, undefined);
  assert.equal((await request('/api/history', 'GET', undefined, second.cookie)).data.rows.length, 0);
  assert.equal((await request('/api/history?offset=-1', 'GET', undefined, first.cookie)).status, 400);
  for (const file of ['/server.cjs', '/data/metsu.sqlite', '/package.json', '/.git/config']) assert.equal((await request(file)).status, 404);
  assert.match((await request('/api.js')).data, /SPEECH_API_KEY: ""/);
  // Read the same SQLite database through a second connection to verify disk persistence.
  const reopened = createApp({ database });
  assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM battles').get().n, 2); reopened.db.close();
  await request('/api/logout', 'POST', {}, first.cookie);
  assert.equal((await request('/api/history', 'GET', undefined, first.cookie)).status, 401);
  const login = await request('/api/login', 'POST', { username: 'playerone', password: 'correct horse battery' });
  assert.equal(login.status, 200);
  await request('/api/history', 'DELETE', {}, second.cookie);
  assert.equal((await request('/api/history', 'GET', undefined, login.cookie)).data.rows.length, 2);
  await request('/api/history', 'DELETE', {}, login.cookie);
  assert.equal((await request('/api/history', 'GET', undefined, login.cookie)).data.rows.length, 0);
});
