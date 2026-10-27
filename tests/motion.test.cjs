const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function motionEnvironment(options = {}) {
  const listeners = new Map();
  const timers = new Map();
  const samples = [];
  const statuses = [];
  let timerId = 0;
  let now = 0;
  const window = {
    isSecureContext: true,
    DeviceMotionEvent: function () {},
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
    ...options,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../motion.js'), 'utf8'), {
    window,
    Date: { now: () => now },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  const reader = window.MetsuMotion.createReader({ onSample: s => samples.push(s), onStatus: s => statuses.push(s) });
  return {
    window, reader, samples, statuses, listeners,
    normalizer: window.MetsuMotion.createNormalizer(),
    emit: event => listeners.get('devicemotion')?.(event),
    advance: ms => { now += ms; },
    expire: () => { for (const fn of [...timers.values()]) fn(); },
  };
}
function event(overrides = {}) {
  return {
    accelerationIncludingGravity: { x: 9.80665, y: 0, z: 9.80665 },
    acceleration: { x: 9.80665, y: 0, z: 0 },
    rotationRate: { alpha: 180, beta: 90, gamma: -90 },
    timeStamp: 16,
    ...overrides,
  };
}

test('browser units and rotation axes match battle units without subtracting gravity twice', () => {
  const sample = motionEnvironment().normalizer.read(event());
  assert.equal(sample.accel.x, 1);
  assert.equal(sample.gravity.x, 0);
  assert.equal(sample.gravity.z, 1);
  assert.equal(sample.gyro.x, Math.PI / 2);
  assert.equal(sample.gyro.y, -Math.PI / 2);
  assert.equal(sample.gyro.z, Math.PI);
  assert.equal(sample.estimatedGravity, false);
});

test('missing linear acceleration uses filtered gravity and reset removes old orientation', () => {
  const { normalizer } = motionEnvironment();
  const still = event({ acceleration: null, accelerationIncludingGravity: { x: 0, y: 0, z: 9.80665 } });
  assert.equal(normalizer.read(still).gravity.z, 1);
  const moving = normalizer.read(event({ acceleration: null, timeStamp: 32 }));
  assert.equal(moving.estimatedGravity, true);
  assert.ok(moving.gravity.x > 0 && moving.gravity.x < moving.accel.x);
  normalizer.reset();
  assert.equal(normalizer.read(still).gravity.x, 0);
});

test('null, partial and non-finite required sensor values are rejected', () => {
  const { normalizer } = motionEnvironment();
  for (const invalid of [
    { rotationRate: null }, { rotationRate: { alpha: 0, beta: null, gamma: 0 } },
    { accelerationIncludingGravity: null },
    { accelerationIncludingGravity: { x: NaN, y: 0, z: 1 } },
  ]) assert.equal(normalizer.read(event(invalid)), null);
});

test('insecure pages and unsupported browsers never attach a listener', async () => {
  for (const [options, expected] of [[{ isSecureContext: false }, 'insecure'], [{ DeviceMotionEvent: null }, 'unsupported']]) {
    const a = motionEnvironment(options);
    await a.reader.start();
    assert.equal(a.statuses.at(-1), expected);
    assert.equal(a.listeners.size, 0);
  }
});

test('iOS permission is requested synchronously from start; samples arrive only after grant', async () => {
  let grant;
  let calls = 0;
  const a = motionEnvironment({ DeviceMotionEvent: { requestPermission() {
    calls++;
    return new Promise(resolve => { grant = resolve; });
  } } });
  const start = a.reader.start();
  assert.equal(calls, 1);
  assert.equal(a.listeners.size, 0);
  await a.reader.start();
  assert.equal(calls, 1);
  grant('granted');
  await start;
  a.emit(event());
  assert.equal(a.samples.length, 1);
  assert.equal(a.statuses.at(-1), 'streaming');
});

test('denied and rejected permissions leave a retryable reader', async () => {
  for (const requestPermission of [async () => 'denied', async () => { throw new Error('denied'); }]) {
    const a = motionEnvironment({ DeviceMotionEvent: { requestPermission } });
    await a.reader.start();
    assert.equal(a.reader.running, false);
    assert.equal(a.statuses.at(-1), 'denied');
    a.window.DeviceMotionEvent.requestPermission = async () => 'granted';
    await a.reader.start();
    assert.equal(a.reader.running, true);
  }
});

test('stop while permission is pending prevents late approval restarting capture', async () => {
  let grant;
  const a = motionEnvironment({ DeviceMotionEvent: { requestPermission: () => new Promise(resolve => { grant = resolve; }) } });
  const started = a.reader.start();
  a.reader.stop('paused');
  grant('granted');
  await started;
  assert.equal(a.reader.running, false);
  assert.equal(a.listeners.size, 0);
  assert.equal(a.statuses.at(-1), 'paused');
});

test('missing samples and stalled streams time out; stop detaches capture', async () => {
  const a = motionEnvironment();
  await a.reader.start();
  a.emit(event({ rotationRate: null }));
  a.expire();
  assert.equal(a.statuses.at(-1), 'unavailable');
  await a.reader.start();
  a.emit(event());
  assert.equal(a.samples.length, 1);
  a.expire();
  assert.equal(a.statuses.at(-1), 'unavailable');
  a.emit(event());
  assert.equal(a.samples.length, 1);
  assert.equal(a.reader.running, false);
});

test('a gap in valid samples requests recalibration before forwarding resumed data', async () => {
  const a = motionEnvironment();
  await a.reader.start();
  a.emit(event());
  a.advance(800);
  a.emit(event());
  assert.equal(a.statuses.filter(s => s === 'streaming').length, 2);
});
