// Browser motion input. Game units: acceleration/gravity in G, gyro in rad/s.
(function (root) {
  const STANDARD_GRAVITY = 9.80665;
  const RAD_PER_DEGREE = Math.PI / 180;
  const axes = ['x', 'y', 'z'];
  const finiteVector = value => value && axes.every(axis => Number.isFinite(value[axis]));

  function createNormalizer() {
    let gravityEstimate = null;
    let previousTime = null;
    return {
      reset() { gravityEstimate = null; previousTime = null; },
      read(event) {
        const total = event.accelerationIncludingGravity;
        const rotation = event.rotationRate;
        // Missing values must not become zero: that would falsely indicate stillness.
        if (!finiteVector(total) || !rotation ||
            !['alpha', 'beta', 'gamma'].every(axis => Number.isFinite(rotation[axis]))) return null;
        const accel = Object.fromEntries(axes.map(axis => [axis, total[axis] / STANDARD_GRAVITY]));
        const estimatedGravity = !finiteVector(event.acceleration);
        const time = Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now();
        if (!estimatedGravity) {
          gravityEstimate = Object.fromEntries(axes.map(axis => [
            axis, (total[axis] - event.acceleration[axis]) / STANDARD_GRAVITY,
          ]));
        } else {
          // Time-based low-pass filter for devices without linear acceleration.
          const dt = previousTime === null ? 16 : Math.max(1, Math.min(100, time - previousTime));
          const alpha = 1 - Math.exp(-dt / 300);
          if (!gravityEstimate) gravityEstimate = { ...accel };
          else axes.forEach(axis => { gravityEstimate[axis] += alpha * (accel[axis] - gravityEstimate[axis]); });
        }
        previousTime = time;
        return {
          accel,
          gravity: { ...gravityEstimate },
          gyro: {
            x: rotation.beta * RAD_PER_DEGREE,
            y: rotation.gamma * RAD_PER_DEGREE,
            z: rotation.alpha * RAD_PER_DEGREE,
          },
          estimatedGravity,
        };
      },
    };
  }

  function createReader({ onSample, onStatus }) {
    const normalizer = createNormalizer();
    let running = false;
    let pending = false;
    let generation = 0;
    let watchdog = null;
    let streaming = false;
    let lastSampleAt = null;

    function stop(status = 'stopped') {
      generation += 1;
      pending = false;
      running = false;
      streaming = false;
      clearTimeout(watchdog);
      watchdog = null;
      root.removeEventListener('devicemotion', receive);
      normalizer.reset();
      onStatus(status);
    }

    function armWatchdog() {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => stop('unavailable'), 4000);
    }

    function receive(event) {
      if (!running) return;
      const now = Date.now();
      const interrupted = !streaming || (lastSampleAt !== null && now - lastSampleAt > 500);
      if (interrupted) normalizer.reset();
      const sample = normalizer.read(event);
      if (!sample) return;
      if (interrupted) {
        // Recalibrate if the stream was interrupted, even before the watchdog fires.
        streaming = true;
        onStatus('streaming');
      }
      lastSampleAt = now;
      armWatchdog();
      onSample(sample);
    }

    async function start() {
      if (running || pending) return;
      if (!root.isSecureContext) { onStatus('insecure'); return; }
      const MotionEvent = root.DeviceMotionEvent;
      if (!MotionEvent) { onStatus('unsupported'); return; }
      const request = ++generation;
      pending = true;
      onStatus('requesting');
      try {
        // Must be invoked directly by the user's click (especially on iOS).
        if (typeof MotionEvent.requestPermission === 'function') {
          const permission = await MotionEvent.requestPermission();
          if (request !== generation) return;
          if (permission !== 'granted') { stop('denied'); return; }
        }
        if (request !== generation) return;
        pending = false;
        running = true;
        streaming = false;
        lastSampleAt = null;
        normalizer.reset();
        root.addEventListener('devicemotion', receive);
        onStatus('waiting');
        armWatchdog();
      } catch (error) {
        if (request === generation) stop('denied');
      }
    }
    return { start, stop, get running() { return running; } };
  }

  root.MetsuMotion = { createNormalizer, createReader };
})(window);
