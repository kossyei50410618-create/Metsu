const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server.cjs');

test('Gemini proxy keeps credentials private, validates requests, limits use and sanitizes failures', async t => {
  const calls = []; let fail = false;
  const { app, db } = createApp({ database: ':memory:', gemini: {
    apiKey: 'private-test-key', model: 'test-model',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return fail ? { ok: false, status: 403 } : { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '仕事に対する怒り。' }] } }] }) };
    },
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (body, extra = {}) => fetch(base + '/api/analyze', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Metsu-Request': '1', ...extra }, body: JSON.stringify(body) });
  const body = { kind: 'speech', input: '仕事がつらい' };
  assert.equal((await request(body, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request(body, { 'X-Metsu-Request': '' })).status, 403);
  assert.equal((await request({ ...body, model: 'attacker-model' })).status, 400);
  assert.equal((await request({ ...body, input: 'a'.repeat(4001) })).status, 400);
  assert.equal((await request({ kind: 'other', input: 'x' })).status, 400);
  assert.equal(calls.length, 0);
  assert.deepEqual(await (await request(body)).json(), { text: '仕事に対する怒り。' });
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'private-test-key');
  assert.ok(!calls[0].url.includes('private-test-key'));
  assert.ok(JSON.parse(calls[0].options.body).systemInstruction.parts[0].text.length > 0);
  for (const file of ['/.env', '/.env.example', '/gemini.cjs', '/gemini-prompts.json']) assert.equal((await fetch(base + file)).status, 404);
  assert.ok(!(await (await fetch(base + '/script.js')).text()).includes('SPEECH_API_KEY'));
  fail = true;
  const failure = await request(body);
  assert.equal(failure.status, 502);
  assert.ok(!(await failure.text()).includes('private-test-key'));
  fail = false;
  for (let i = 0; i < 18; i++) assert.equal((await request(body)).status, 200);
  assert.equal((await request(body)).status, 429);
});

test('Gemini remains optional when the server has no key', async t => {
  const { app, db } = createApp({ database: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/analyze`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Metsu-Request': '1' }, body: JSON.stringify({ kind: 'speech', input: 'hello' }) });
  assert.equal(res.status, 503);
});

test('recorded voice uses validated inline audio, shared rate limits and private audio credentials', async t => {
  const calls = [];
  const { app, db } = createApp({ database: ':memory:', gemini: {
    apiKey: 'text-secret', audioKey: 'audio-secret',
    fetchImpl: async (_url, options) => {
      calls.push(options);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '仕事がつらい' }] } }] }) };
    },
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (body, headers = {}) => fetch(base + '/api/transcribe', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Metsu-Request': '1', ...headers }, body: JSON.stringify(body) });
  const body = { audio: Buffer.alloc(20000).toString('base64'), mimeType: 'audio/webm' };
  assert.equal((await request(body, { Origin: 'https://evil.example' })).status, 403);
  for (const invalid of [{ ...body, mimeType: 'text/html' }, { ...body, audio: 'invalid!' },
    { ...body, audio: 'AAAA'.repeat(350001) }, { ...body, model: 'override' }, {}]) {
    assert.equal((await request(invalid)).status, 400);
  }
  assert.equal(calls.length, 0);
  const response = await request(body);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: '仕事がつらい' });
  assert.equal(calls[0].headers['x-goog-api-key'], 'audio-secret');
  const payload = JSON.parse(calls[0].body);
  assert.deepEqual(payload.contents[0].parts, [{ inlineData: { mimeType: 'audio/webm', data: body.audio } }]);
  assert.match(payload.systemInstruction.parts[0].text, /NO_SPEECH/);
  for (let i = 0; i < 19; i++) assert.equal((await request(body)).status, 200);
  const limited = await fetch(base + '/api/analyze', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Metsu-Request': '1' },
    body: JSON.stringify({ kind: 'speech', input: '仕事' }) });
  assert.equal(limited.status, 429);
});
