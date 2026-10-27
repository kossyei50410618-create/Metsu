// battle.js
let hp = 100;
let maxHp = 100;
let lastAttackTime = 0;
let weakSpot = null;

// 討伐結果画面（result.html）で使う統計値
let battleStartTime = null;
let attackCount = 0;
let totalDamageDealt = 0;
let maxSingleDamage = 0;

const RESULT_DATA_KEY = 'metsuResultData';
const MONSTER_DEFEAT_EFFECT_MS = 2200;

// Browser sensor thresholds: acceleration/gravity in G, gyro in rad/s.
const SENSOR_ACCEL_ATTACK_THRESHOLD = 0.55;
// 各方向の自然な最大傾きを保存し、誤差マージンを超える動きを攻撃候補にする。
const SENSOR_REATTACK_COOLDOWN_MS = 140;
const SENSOR_TILT_RANGE_MARGIN = 0.1;
const SENSOR_TILT_AXIS_LEARN_THRESHOLD = 0.04;
const SENSOR_STATIONARY_RESET_MS = 1500;
const SENSOR_STATIONARY_ACCEL_THRESHOLD = 0.08;
const SENSOR_STATIONARY_GYRO_THRESHOLD = 0.12;
const SENSOR_STATIONARY_POSITION_EPSILON = 0.02;
const SENSOR_ATTACK_GYRO_THRESHOLD = 0.8;
const SENSOR_BASELINE_ALPHA = 0.02;

let sensorAttackActive = false;
let sensorMotionState = 'ready';
let sensorAttackEnabled = false;
let sensorLastHitAt = null;
let sensorBaseline = null;
let sensorSwingAxis = null;
let sensorLastTilt = null;
let sensorTiltDirection = 0;
let sensorTurningPoint = 0;
let sensorTiltPeaks = { positive: null, negative: null };
let sensorAwaitingStillness = false;
let sensorStillSince = null;
let sensorPreviousGravity = null;

function setAttackAvailability(enabled) {
  const attackReadyEl = document.getElementById('attack-ready');
  if (!attackReadyEl) return;
  attackReadyEl.innerText = enabled ? '攻撃可能' : '攻撃不可';
  attackReadyEl.hidden = false;
}

// Normalized browser samples: accel/gravity in G, gyro in rad/s.
function handleSensorSample(sample) {
  if (!sensorAttackActive) return;
  const { accel, gyro, gravity } = sample;
  const now = Date.now();
  const hintEl = getElement('attack-hint');

  // 静止時の重力を基準にし、3D重力ベクトルを振り子の傾きとして追跡する。
  if (!sensorBaseline) sensorBaseline = cloneSensorSample(sample);
  const elapsedSinceHit = sensorLastHitAt === null ? Infinity : now - sensorLastHitAt;
  const centeredSample = subtractSensorSamples(sample, sensorBaseline);
  const gravityDelta = centeredSample.gravity;
  if (!sensorSwingAxis && vectorMagnitude(gravityDelta) >= SENSOR_TILT_AXIS_LEARN_THRESHOLD) {
    const length = vectorMagnitude(gravityDelta);
    sensorSwingAxis = { x: gravityDelta.x / length, y: gravityDelta.y / length, z: gravityDelta.z / length };
  }
  const tilt = sensorSwingAxis ? dotSensorVector(gravityDelta, sensorSwingAxis) : 0;
  updateSensorTiltExtrema(tilt);
  // accel から gravity を引いて直線加速度を求める。軸方向に依存せず3Dの強さを使う。
  const linearAcceleration = {
    x: accel.x - gravity.x,
    y: accel.y - gravity.y,
    z: accel.z - gravity.z,
  };
  const rawAccelForce = vectorMagnitude(linearAcceleration);
  const gyroMagnitude = vectorMagnitude(gyro);

  if (sensorAwaitingStillness) {
    const gravityStable = sensorPreviousGravity !== null
      && vectorMagnitude({
        x: gravity.x - sensorPreviousGravity.x,
        y: gravity.y - sensorPreviousGravity.y,
        z: gravity.z - sensorPreviousGravity.z,
      }) <= SENSOR_STATIONARY_POSITION_EPSILON;
    const isStationary = gravityStable
      && rawAccelForce <= SENSOR_STATIONARY_ACCEL_THRESHOLD
      && gyroMagnitude <= SENSOR_STATIONARY_GYRO_THRESHOLD;
    if (isStationary) {
      if (sensorStillSince === null) sensorStillSince = now;
    } else {
      sensorStillSince = null;
    }
    sensorPreviousGravity = { ...gravity };

    if (sensorStillSince !== null && now - sensorStillSince >= SENSOR_STATIONARY_RESET_MS) {
      sensorBaseline = cloneSensorSample(sample);
      sensorSwingAxis = null;
      sensorLastTilt = null;
      sensorTiltDirection = 0;
      sensorTurningPoint = 0;
      sensorTiltPeaks = { positive: null, negative: null };
      sensorLastHitAt = null;
      sensorAwaitingStillness = false;
      sensorStillSince = null;
      sensorPreviousGravity = null;
      sensorAttackEnabled = true;
      setAttackAvailability(true);
      if (hintEl) hintEl.innerText = '安定';
    }
    return;
  }

  if (!sensorAttackEnabled) {
    sensorAttackEnabled = true;
    setAttackAvailability(true);
  }

  if (sensorLastHitAt !== null && elapsedSinceHit < SENSOR_REATTACK_COOLDOWN_MS) {
    return;
  }

  const isFirstAttack = sensorLastHitAt === null;
  const peak = tilt >= 0 ? sensorTiltPeaks.positive : sensorTiltPeaks.negative;
  const outsideNaturalRange = peak !== null
    && Math.abs(tilt) > Math.abs(peak) + SENSOR_TILT_RANGE_MARGIN;
  const isNewAttack = isFirstAttack
    ? rawAccelForce >= SENSOR_ACCEL_ATTACK_THRESHOLD && gyroMagnitude >= SENSOR_ATTACK_GYRO_THRESHOLD
    : outsideNaturalRange && rawAccelForce >= SENSOR_ACCEL_ATTACK_THRESHOLD
      && gyroMagnitude >= SENSOR_ATTACK_GYRO_THRESHOLD;

  if (!isNewAttack) {
    if (sensorLastHitAt === null) {
      sensorBaseline = blendSensorSamples(sensorBaseline, sample, SENSOR_BASELINE_ALPHA);
    }
    return;
  }

  const attackStrength = rawAccelForce;
  const power = Math.max(1, Math.min(3, 1 + attackStrength / 4));
  sensorMotionState = 'cooldown';
  sensorLastHitAt = now;
  if (hintEl) hintEl.innerText = '攻撃方向を記録しました。';
  attackMonster(power);
}

function vectorMagnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function dotSensorVector(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

// 傾きの方向が反転したら、直前の端点をその側の自然な最大振幅として保存する。
function updateSensorTiltExtrema(tilt) {
  if (sensorLastTilt === null) {
    sensorLastTilt = tilt;
    sensorTurningPoint = tilt;
    return;
  }
  const direction = Math.sign(tilt - sensorLastTilt);
  if (direction !== 0 && sensorTiltDirection !== 0 && direction !== sensorTiltDirection) {
    if (sensorTurningPoint >= 0) sensorTiltPeaks.positive = sensorTurningPoint;
    else sensorTiltPeaks.negative = sensorTurningPoint;
    sensorTurningPoint = tilt;
  } else if (direction > 0) {
    sensorTurningPoint = Math.max(sensorTurningPoint, tilt);
  } else if (direction < 0) {
    sensorTurningPoint = Math.min(sensorTurningPoint, tilt);
  }
  if (direction !== 0) sensorTiltDirection = direction;
  sensorLastTilt = tilt;
}

function cloneSensorSample(sample) {
  return {
    accel: { ...sample.accel },
    gyro: { ...sample.gyro },
    gravity: { ...sample.gravity },
  };
}

function mapSensorSample(sample, mapper) {
  const result = {};
  ['accel', 'gyro', 'gravity'].forEach((sensor) => {
    result[sensor] = {};
    ['x', 'y', 'z'].forEach((axis) => {
      result[sensor][axis] = mapper(sample[sensor][axis], sensor, axis);
    });
  });
  return result;
}

function subtractSensorSamples(left, right) {
  return mapSensorSample(left, (value, sensor, axis) => value - right[sensor][axis]);
}

function blendSensorSamples(baseline, sample, alpha) {
  return mapSensorSample(baseline, (value, sensor, axis) => (
    value + alpha * (sample[sensor][axis] - value)
  ));
}

// Sensorの攻撃検知を開始し、初期状態と接続を準備する関数。
function startSensorAttackDetection() {
  sensorAttackActive = true;
  sensorMotionState = 'ready';
  sensorAttackEnabled = false;
  sensorAwaitingStillness = true;
  sensorStillSince = null;
  sensorPreviousGravity = null;
  sensorLastHitAt = null;
  sensorBaseline = null;
  sensorSwingAxis = null;
  sensorLastTilt = null;
  sensorTiltDirection = 0;
  sensorTurningPoint = 0;
  sensorTiltPeaks = { positive: null, negative: null };
  setAttackAvailability(false);
  showSensorCalibrationHint();
}

// Sensorの攻撃検知を止め、状態変数とセンサー接続の状態をリセットする関数。
function stopSensorAttackDetection() {
  sensorAttackActive = false;
  sensorMotionState = 'ready';
  sensorAttackEnabled = false;
  sensorAwaitingStillness = false;
  sensorStillSince = null;
  sensorPreviousGravity = null;
  sensorLastHitAt = null;
  sensorBaseline = null;
  sensorSwingAxis = null;
  sensorLastTilt = null;
  sensorTiltDirection = 0;
  sensorTurningPoint = 0;
  sensorTiltPeaks = { positive: null, negative: null };
  setAttackAvailability(false);
}

// Permission, capture lifecycle, and sensor controls for this battle page.
const motionStatusMessages = {
  idle: 'スマホのセンサーを有効にしてください。',
  requesting: 'センサーの許可を確認しています…',
  waiting: 'センサーの値を待っています…',
  streaming: 'スマホのセンサーで接続中',
  insecure: 'センサーにはHTTPSが必要です。HTTPSのURLで開いてください。',
  unsupported: 'このブラウザーはセンサーに対応していません。スマホのSafariやChromeで開いてください。',
  denied: 'センサーが許可されていません。サイトの設定で許可してから再度お試しください。',
  unavailable: '加速度・ジャイロの値を取得できません。設定を確認して再接続するか、タップで攻撃してください。',
  paused: 'センサーを一時停止しました。再開するには有効化ボタンを押してください。',
  stopped: 'センサーを停止しました。タップで攻撃できます。',
};
let lastSensorDisplayAt = 0;
const motionReader = window.MetsuMotion.createReader({
  onSample(sample) {
    const now = Date.now();
    if (now - lastSensorDisplayAt >= 150) {
      lastSensorDisplayAt = now;
      const readings = document.getElementById('sensor-readings');
      const format = vector => ['x', 'y', 'z'].map(axis => vector[axis].toFixed(2)).join(', ');
      if (readings) readings.textContent =
        `加速度（重力込み）[G]: ${format(sample.accel)}\n重力${sample.estimatedGravity ? '（推定）' : ''} [G]: ${format(sample.gravity)}\nジャイロ [rad/s]: ${format(sample.gyro)}`;
    }
    handleSensorSample(sample);
  },
  onStatus(status) {
    const statusEl = document.getElementById('motion-status');
    if (statusEl) statusEl.textContent = motionStatusMessages[status];
    document.getElementById('sensor-start-btn').disabled = ['requesting', 'waiting', 'streaming'].includes(status);
    document.getElementById('sensor-stop-btn').disabled = !['requesting', 'waiting', 'streaming'].includes(status);
    document.getElementById('sensor-calibrate-btn').disabled = status !== 'streaming';
    if (status === 'streaming') {
      if (sensorAttackActive && hp > 0) startSensorAttackDetection();
    } else {
      sensorAttackEnabled = false;
      sensorStillSince = null;
      setAttackAvailability(false);
      const hint = document.getElementById('attack-hint');
      if (hint) hint.innerText = 'モンスターをタップしても攻撃できます。';
      document.getElementById('sensor-readings').textContent = '加速度・重力・ジャイロ: --';
    }
  },
});

function showSensorCalibrationHint() {
  const hint = document.getElementById('attack-hint');
  if (hint) hint.innerText = motionReader.running
    ? 'スマホを1.5秒静止して調整してください。'
    : 'センサーを有効にするか、モンスターをタップして攻撃できます。';
}

function stopPhoneSensors() { motionReader.stop(); }
document.getElementById('sensor-start-btn').addEventListener('click', () => motionReader.start());
document.getElementById('sensor-stop-btn').addEventListener('click', stopPhoneSensors);
document.getElementById('sensor-calibrate-btn').addEventListener('click', () => {
  if (sensorAttackActive && hp > 0) startSensorAttackDetection();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) motionReader.stop('paused');
});
window.addEventListener('pagehide', stopPhoneSensors);

// 現在のHP値をバーと表示テキストへ反映し、モンスター画像の見た目も更新する関数。
function syncHpUi() {
  const hpFill = getElement('hp-fill');
  const hpValue = getElement('hp-value');
  if (!hpFill || !hpValue) return;

  const safeMaxHp = Math.max(1, maxHp);
  const safeHp = Math.max(0, Math.min(safeMaxHp, hp));
  const percent = (safeHp / safeMaxHp) * 100;
  hpFill.style.width = `${percent}%`;
  if (window.MetsuAudio) MetsuAudio.setTension(percent);
  hpValue.innerText = `HP: ${safeHp} / ${safeMaxHp}`;
  const hpBar = getElement('hp-bar');
  hpBar.setAttribute('aria-valuemax', safeMaxHp);
  hpBar.setAttribute('aria-valuenow', safeHp);
  if (typeof updateMonsterImageForHealth === 'function') {
    updateMonsterImageForHealth(safeHp, safeMaxHp);
  }
}

// 攻撃時の一時的なステータスメッセージを表示して、少し後に元のメッセージへ戻す関数。
function showAttackFeedback(message) {
  const status = getElement('status-text');
  const previous = status.innerText;
  status.innerText = message;
  setTimeout(() => {
    if (status.innerText === message) status.innerText = previous;
  }, 900);
}

// モンスターへのダメージ計算と攻撃結果更新、HP減少と演出をまとめて処理する関数。
function attackMonster(eventOrPower) {
  if (hp <= 0) return;
  const now = Date.now();
  const inputPower = typeof eventOrPower === 'number' ? eventOrPower : 1;
  let baseDamage = 0;
  let feedback = '攻撃！';

  switch (monsterType) {
    case 'study': baseDamage = 18; break;
    case 'human': baseDamage = 20; break;
    case 'career': baseDamage = 19; break;
    case 'money': baseDamage = 17; break;
    case 'health': baseDamage = 16; break;
    case 'self': baseDamage = 17; break;
    case 'time': baseDamage = 18; break;
    case 'digital': baseDamage = 14; break;
    case 'probability': baseDamage = 13; break;
    case 'habit': baseDamage = 16; break;
    default: baseDamage = 15;
  }

  const damage = Math.round(baseDamage * inputPower * 0.8);
  attackCount += 1;
  const counter = getElement('attack-count');
  if (counter) counter.textContent = String(attackCount).padStart(2, '0');
  feedback = `HIT! −${damage} HP`;
  if (damage > 0) {
    hp -= damage;
    if (hp < 0) hp = 0;
    totalDamageDealt += damage;
    if (damage > maxSingleDamage) maxSingleDamage = damage;
  }

  syncHpUi();
  showAttackFeedback(feedback);
  lastAttackTime = now;

  document.body.style.transform = `translate(${Math.random() * 10 - 5}px, ${Math.random() * 10 - 5}px)`;
  setTimeout(() => document.body.style.transform = 'translate(0,0)', 50);

  createParticles();
  if (window.MetsuAudio) MetsuAudio.hit(inputPower, hp <= 0);
  if (hp <= 0) destroyMonster();
}

// 攻撃のヒット演出として、モンスター周辺に粒子アニメーションを生成する関数。
function createParticles() {
  const monsterRect = getElement('monster').getBoundingClientRect();
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = (monsterRect.left + monsterRect.width / 2) + 'px';
    p.style.top = (monsterRect.top + monsterRect.height / 2) + 'px';
    p.style.background = monsters[monsterType].shadow;
    document.body.appendChild(p);

    const angle = Math.random() * Math.PI * 2;
    const velocity = Math.random() * 8 + 4;
    let x = 0, y = 0;

    const move = setInterval(() => {
      x += Math.cos(angle) * velocity;
      y += Math.sin(angle) * velocity;
      p.style.transform = `translate(${x}px, ${y}px)`;
      p.style.opacity = parseFloat(p.style.opacity || 1) - 0.05;
      if (p.style.opacity <= 0) {
        clearInterval(move);
        p.remove();
      }
    }, 20);
  }
}

function playMonsterDissolve(onComplete, effectsLayer, showEffects = true) {
  const monsterEl = getElement('monster');
  if (!monsterEl) {
    onComplete();
    return;
  }

  monsterEl.setAttribute('aria-hidden', 'true');
  monsterEl.disabled = true;

  if (showEffects) {
    const monsterRect = monsterEl.getBoundingClientRect();
    const monsterImg = getElement('monster-img');
    const imageSrc = monsterImg && (monsterImg.currentSrc || monsterImg.src)
      ? (monsterImg.currentSrc || monsterImg.src)
      : 'assets/monster-fallback.svg';
    const imageWidth = monsterImg && monsterImg.naturalWidth ? monsterImg.naturalWidth : monsterRect.width;
    const imageHeight = monsterImg && monsterImg.naturalHeight ? monsterImg.naturalHeight : monsterRect.height;
    const viewportWidth = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || monsterRect.width;
    const viewportHeight = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || monsterRect.height;
    const columns = 18;
    const rows = 24;
    const scale = Math.max(monsterRect.width / imageWidth, monsterRect.height / imageHeight);
    const backgroundWidth = imageWidth * scale;
    const backgroundHeight = imageHeight * scale;
    const cropLeft = (backgroundWidth - monsterRect.width) / 2;
    const cropTop = (backgroundHeight - monsterRect.height) / 2;

    if (monsterEl.classList && typeof monsterEl.classList.add === 'function') {
      monsterEl.classList.add('monster-dissolving');
    } else {
      monsterEl.className = `${monsterEl.className || ''} monster-dissolving`.trim();
    }

    const shardWidth = monsterRect.width / columns;
    const shardHeight = monsterRect.height / rows;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x = column * shardWidth;
        const y = row * shardHeight;
        const width = Math.min(shardWidth, monsterRect.width - x);
        const height = Math.min(shardHeight, monsterRect.height - y);
        const shard = document.createElement('div');
        shard.className = 'image-shard';
        shard.style.left = `${monsterRect.left + x}px`;
        shard.style.top = `${monsterRect.top + y}px`;
        shard.style.width = `${width}px`;
        shard.style.height = `${height}px`;
        shard.style.backgroundImage = `url("${imageSrc}")`;
        shard.style.backgroundSize = `${backgroundWidth}px ${backgroundHeight}px`;
        shard.style.backgroundPosition = `${-(cropLeft + x)}px ${-(cropTop + y)}px`;

        const targetX = Math.random() * Math.max(0, viewportWidth - width);
        const targetY = Math.random() * Math.max(0, viewportHeight - height);
        const shardStyle = {
          '--scatter-x': `${targetX - (monsterRect.left + x)}px`,
          '--scatter-y': `${targetY - (monsterRect.top + y)}px`,
          '--shard-rotation': `${Math.random() * 360 - 180}deg`,
          '--shard-delay': `${Math.random() * 120}ms`,
        };
        Object.entries(shardStyle).forEach(([property, value]) => {
          if (typeof shard.style.setProperty === 'function') {
            shard.style.setProperty(property, value);
          } else {
            shard.style[property] = value;
          }
        });
        effectsLayer.appendChild(shard);
        setTimeout(() => shard.remove(), 1100);
      }
    }
  }

  setTimeout(() => {
    onComplete();
  }, 900);
}

function playScreenCrack(effectsLayer) {
  const viewportWidth = (document.documentElement && document.documentElement.clientWidth) || window.innerWidth;
  const viewportHeight = (document.documentElement && document.documentElement.clientHeight) || window.innerHeight;
  const monsterRect = getElement('monster')?.getBoundingClientRect();
  const centerX = monsterRect ? monsterRect.left + monsterRect.width / 2 : viewportWidth / 2;
  const centerY = monsterRect ? monsterRect.top + monsterRect.height / 2 : viewportHeight / 2;
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const overlay = document.createElementNS(svgNamespace, 'svg');
  overlay.classList.add('screen-crack-overlay');
  overlay.setAttribute('viewBox', `0 0 ${viewportWidth} ${viewportHeight}`);
  overlay.setAttribute('preserveAspectRatio', 'none');
  overlay.setAttribute('aria-hidden', 'true');

  const addCrack = (points, isBranch = false) => {
    const path = document.createElementNS(svgNamespace, 'path');
    path.classList.add('screen-crack');
    if (isBranch) path.classList.add('screen-crack-branch');
    path.setAttribute('d', points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' '));
    overlay.appendChild(path);
  };

  const mainCrackCount = 16;
  for (let i = 0; i < mainCrackCount; i++) {
    const angle = (Math.PI * 2 * i / mainCrackCount) + (Math.random() - 0.5) * 0.24;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const edgeDistance = Math.min(
      directionX > 0 ? (viewportWidth - centerX) / directionX : directionX < 0 ? -centerX / directionX : Infinity,
      directionY > 0 ? (viewportHeight - centerY) / directionY : directionY < 0 ? -centerY / directionY : Infinity,
    );
    const segmentCount = 7;
    const points = [[centerX, centerY]];
    for (let segment = 1; segment <= segmentCount; segment++) {
      const distance = edgeDistance * segment / segmentCount;
      const jitter = segment === segmentCount ? 0 : (Math.random() - 0.5) * 34;
      points.push([
        centerX + directionX * distance - directionY * jitter,
        centerY + directionY * distance + directionX * jitter,
      ]);
    }
    addCrack(points);

    const branchSegment = 2 + Math.floor(Math.random() * 4);
    const branchOrigin = points[branchSegment];
    const branchAngle = angle + (Math.random() < 0.5 ? -1 : 1) * (0.48 + Math.random() * 0.7);
    const branchLength = 70 + Math.random() * Math.max(viewportWidth, viewportHeight) * 0.36;
    const branchPoints = [branchOrigin];
    for (let segment = 1; segment <= 3; segment++) {
      const distance = branchLength * segment / 3;
      const jitter = segment === 3 ? 0 : (Math.random() - 0.5) * 24;
      branchPoints.push([
        branchOrigin[0] + Math.cos(branchAngle) * distance - Math.sin(branchAngle) * jitter,
        branchOrigin[1] + Math.sin(branchAngle) * distance + Math.cos(branchAngle) * jitter,
      ]);
    }
    addCrack(branchPoints, true);
  }

  effectsLayer.appendChild(overlay);
  setTimeout(() => overlay.remove(), 1800);
}

function playDefeatCelebration() {
  const effectsLayer = document.createElement('div');
  effectsLayer.className = 'defeat-effects-layer';
  effectsLayer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(effectsLayer);
  playScreenCrack(effectsLayer);

  const celebration = document.createElement('div');
  celebration.className = 'defeat-celebration';
  celebration.setAttribute('aria-hidden', 'true');

  const banner = document.createElement('div');
  banner.className = 'defeat-banner';
  const title = document.createElement('strong');
  title.textContent = 'FINISH';
  const subtitle = document.createElement('span');
  subtitle.textContent = 'MISSION COMPLETE';
  banner.appendChild(title);
  banner.appendChild(subtitle);
  effectsLayer.appendChild(celebration);
  effectsLayer.appendChild(banner);

  const sparkleCount = 48;
  const sparkleColors = ['var(--cyan)', 'var(--purple)', 'var(--monster-accent)'];
  for (let i = 0; i < sparkleCount; i++) {
    const sparkle = document.createElement('span');
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.max(window.innerWidth || 0, window.innerHeight || 0) * (0.35 + Math.random() * 0.65);
    sparkle.className = 'victory-spark';
    sparkle.style.setProperty('--spark-x', `${Math.cos(angle) * distance}px`);
    sparkle.style.setProperty('--spark-y', `${Math.sin(angle) * distance}px`);
    sparkle.style.setProperty('--spark-spin', `${Math.random() * 540 - 270}deg`);
    sparkle.style.setProperty('--spark-delay', `${Math.random() * 180}ms`);
    sparkle.style.setProperty('--spark-color', sparkleColors[Math.floor(Math.random() * sparkleColors.length)]);
    effectsLayer.appendChild(sparkle);
    setTimeout(() => sparkle.remove(), MONSTER_DEFEAT_EFFECT_MS);
  }

  setTimeout(() => effectsLayer.remove(), MONSTER_DEFEAT_EFFECT_MS);
  return effectsLayer;
}

// 討伐にかかった時間や攻撃統計、音量・トーンをまとめて結果画面に渡すための保存データを作る関数。
function finalizeBattleResult() {
  const elapsedMs = battleStartTime ? Date.now() - battleStartTime : 0;
  const storedData = readBattleData() || {};
  const micStats = (typeof window.getMicSessionStats === 'function') ? window.getMicSessionStats() : null;

  const resultData = {
    category: currentCategory,
    monsterType,
    monsterForm: storedData.monsterForm || 'normal',
    rawText: storedData.rawText || '',
    analysisText: storedData.analysisText || '',
    audioAnalysisText: storedData.audioAnalysisText || '',
    elapsedMs,
    attackCount,
    totalDamageDealt,
    maxSingleDamage,
    maxHp,
    maxVolume: storedData.micMaxVolume ?? micStats?.maxVolume ?? 0,
    avgTone: storedData.micAvgTone ?? micStats?.avgTone ?? null,
    avgToneLabel: storedData.micAvgToneLabel ?? micStats?.avgToneLabel ?? '不明',
  };

  try {
    sessionStorage.setItem(RESULT_DATA_KEY, JSON.stringify(resultData));
  } catch (err) {
    console.warn('討伐結果の保存に失敗しました:', err);
  }
}

// 討伐結果画面へ遷移するための画面切り替え用関数。
function showReplayScreen() {
  stopSensorAttackDetection();
  motionReader.stop();
  window.location.href = 'result.html';
}

// モンスターを倒したあと、次の敵がいれば連戦を続け、無ければ結果画面へ進む関数。
// hasNextMonster / spawnNextMonster は monster.js 側で定義されている。
function destroyMonster() {
  finalizeBattleResult();
  const hasNext = typeof hasNextMonster === 'function' && hasNextMonster();
  stopSensorAttackDetection();
  const effectsLayer = hasNext ? null : playDefeatCelebration();
  if (window.MetsuAudio) MetsuAudio.defeat(hasNext);
  const monsterEl = getElement('monster');
  if (monsterEl) {
    monsterEl.setAttribute('data-state', 'defeated');
    monsterEl.disabled = true;
  }

  playMonsterDissolve(() => {
    if (hasNext) {
      showAttackFeedback('撃破！ 次の敵が現れた...');
      setTimeout(async () => {
        await spawnNextMonster();
      }, 1000);
      return;
    }

    setTimeout(() => showReplayScreen(), MONSTER_DEFEAT_EFFECT_MS - 900);
  }, effectsLayer, !hasNext);
}
