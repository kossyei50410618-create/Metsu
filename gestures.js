// Phone-in-hand gestures. Bag mode intentionally keeps battle.js's original detector.
(function (root) {
  function createDetector(mode, onHit) {
    let quietSince = null, ready = false, previousAt = null, lastHit = -Infinity;
    let punchArmed = true, peak = null;
    function reset() { quietSince = null; ready = false; previousAt = null; lastHit = -Infinity; punchArmed = true; peak = null; }
    function sample(value, now = Date.now()) {
      if (previousAt !== null && now - previousAt > 500) reset();
      previousAt = now;
      const linear = ['x', 'y', 'z'].map(axis => value.accel[axis] - value.gravity[axis]);
      const force = Math.hypot(...linear);
      const rotation = Math.hypot(value.gyro.x, value.gyro.y, value.gyro.z);
      if (!Number.isFinite(force) || !Number.isFinite(rotation)) return false;
      if (!ready) {
        if (force < 0.12 && rotation < 0.2) {
          if (quietSince === null) quietSince = now;
          if (now - quietSince >= 800) ready = true;
        } else quietSince = null;
        return ready;
      }
      if (mode === 'punch') {
        // A distinct acceleration pulse must settle before another hit.
        if (force < 0.2) punchArmed = true;
        if (punchArmed && force >= 0.8 && now - lastHit >= 450) {
          punchArmed = false; lastHit = now; onHit(Math.min(2.5, 1 + force / 4));
        }
      } else if (mode === 'shake') {
        // Require two opposite peaks, rejecting a single bump or slow tilt.
        if (peak && now - peak.at > 700) peak = null;
        if (force >= 0.55) {
          const axis = linear.reduce((best, x, i) => Math.abs(x) > Math.abs(linear[best]) ? i : best, 0);
          const sign = Math.sign(linear[axis]);
          if (peak && peak.axis === axis && peak.sign !== sign && now - peak.at >= 70 && now - lastHit >= 400) {
            lastHit = now; peak = null; onHit(Math.min(2, 1 + force / 5));
          } else if (!peak) peak = { axis, sign, at: now };
        }
      }
      return ready;
    }
    return { sample, reset };
  }
  root.MetsuGestures = { createDetector };
})(window);
