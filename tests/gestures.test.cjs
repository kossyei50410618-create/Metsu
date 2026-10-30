const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function detector(mode) {
  const window = {}; const hits = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../gestures.js'), 'utf8'), { window });
  const d = window.MetsuGestures.createDetector(mode, power => hits.push(power));
  const sample = (x, time, y = 0) => d.sample({ accel: { x, y, z: 1 }, gravity: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 0 } }, time);
  const calibrate = (start = 0) => { for (let t = start; t <= start + 800; t += 100) sample(0, t); };
  return { d, sample, hits, calibrate };
}
test('punch requires calibration and a distinct pulse, and sustained force cannot repeat', () => {
  const a = detector('punch');
  a.sample(2, 0); assert.equal(a.hits.length, 0);
  a.calibrate(100); a.sample(1, 1000); assert.equal(a.hits.length, 1);
  a.sample(1.5, 1300); a.sample(1.5, 1500); assert.equal(a.hits.length, 1);
  a.sample(0, 1600); a.sample(1, 1700); assert.equal(a.hits.length, 2);
});
test('shake requires opposing peaks on the same axis, with timing and cooldown', () => {
  const a = detector('shake'); a.calibrate();
  a.sample(0.7, 900); a.sample(0.9, 1000); assert.equal(a.hits.length, 0);
  a.sample(-0.8, 1100); assert.equal(a.hits.length, 1);
  a.sample(0.8, 1200); a.sample(-0.8, 1300); assert.equal(a.hits.length, 1);
  a.sample(-0.8, 1550); assert.equal(a.hits.length, 2);
});
test('a stopped/restarted stream must recalibrate and a gravity-only tilt never hits', () => {
  const a = detector('punch'); a.calibrate(); a.sample(1, 2000); assert.equal(a.hits.length, 0);
  a.calibrate(2100); a.sample(0, 3000); assert.equal(a.hits.length, 0);
  a.d.reset(); a.sample(2, 3100); assert.equal(a.hits.length, 0);
});
