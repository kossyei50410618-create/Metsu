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

// Zigセンサー入力で攻撃を有効化・無効化するための閾値定義。
const ZIG_WS_PORT = 8765;
const ZIG_ACCEL_ATTACK_THRESHOLD = 0.45;
const ZIG_GYRO_INVALIDATE_NEGATIVE_X = -0.5;
const ZIG_GYRO_INVALIDATE_POSITIVE_X = 0.5;
const ZIG_GRAVITY_MIN_Y = 0.98;
const ZIG_GRAVITY_MAX_Y = 1.02;
const ZIG_GRAVITY_READY_HOLD_MS = 1500;
const ZIG_REATTACK_COOLDOWN_MS = 600;

let zigSocket = null;
let zigAttackActive = false;
let zigMotionState = 'ready';
let zigGravityHoldStartedAt = null;
let zigAttackEnabled = false;
let zigLastGyroX = 0;
let zigCooldownStartedAt = null;

function setAttackAvailability(enabled) {
  const attackReadyEl = getElement('attack-ready');
  if (!attackReadyEl) return;
  attackReadyEl.innerText = enabled ? '攻撃可能' : '攻撃不可';
  attackReadyEl.hidden = false;
}

// Zigセンサーの値を、オブジェクト形式またはフラット形式の入力から{x,y,z}へ正規化して取り出す関数。
function extractZigVector(data, prefix) {
  const sensordata = (data && typeof data.sensordata === 'object') ? data.sensordata : data;
  const nested = sensordata ? sensordata[prefix] : null;
  if (nested && typeof nested === 'object') {
    return { x: Number(nested.x ?? 0), y: Number(nested.y ?? 0), z: Number(nested.z ?? 0) };
  }
  const flatSource = sensordata || {};
  return {
    x: Number(flatSource[`${prefix}.x`] ?? 0),
    y: Number(flatSource[`${prefix}.y`] ?? 0),
    z: Number(flatSource[`${prefix}.z`] ?? 0),
  };
}

// WebSocketで受け取ったZigセンサー情報を読み、攻撃判定と攻撃可否の状態遷移を管理する関数。
function handleZigSimData(raw) {
  if (!zigAttackActive) return;
  let data;
  try { data = JSON.parse(raw); } catch (err) { return; }

  const accel = extractZigVector(data, 'accel');
  const gyro = extractZigVector(data, 'gyro');
  const gravity = extractZigVector(data, 'gravity');
  const now = Date.now();
  const hintEl = getElement('attack-hint');

  if (zigMotionState === 'cooldown' && zigCooldownStartedAt !== null) {
    if (now - zigCooldownStartedAt < ZIG_REATTACK_COOLDOWN_MS) {
      if (hintEl) hintEl.innerText = '攻撃後の揺れ待機中...';
      zigLastGyroX = gyro.x;
      return;
    }
    zigMotionState = 'ready';
    zigCooldownStartedAt = null;
  }

  const accelForce = Math.max(0, -accel.z);
  const gyroX = gyro.x;
  const gravityY = gravity.y ?? 0;

  // ジャイロ x 軸が -0.5 未満から +0.5 超に切り替わると攻撃を無効化。
  if (zigLastGyroX < ZIG_GYRO_INVALIDATE_NEGATIVE_X && gyroX > ZIG_GYRO_INVALIDATE_POSITIVE_X) {
    zigAttackEnabled = false;
    zigMotionState = 'ready';
    zigGravityHoldStartedAt = null;
    setAttackAvailability(false);
    if (hintEl) hintEl.innerText = '攻撃を無効化しました。重力安定で有効化待ち...';
  }

  // 無効化後は重力 y=0.95〜1.05 が 1.5 秒安定したら再有効化する。
  if (!zigAttackEnabled) {
    const gravityIsStable = gravityY >= ZIG_GRAVITY_MIN_Y && gravityY <= ZIG_GRAVITY_MAX_Y;
    if (!gravityIsStable) {
      zigGravityHoldStartedAt = null;
      zigLastGyroX = gyroX;
      return;
    }

    if (zigGravityHoldStartedAt === null) {
      zigGravityHoldStartedAt = now;
      if (hintEl) hintEl.innerText = '重力安定を確認中...';
      zigLastGyroX = gyroX;
      return;
    }

    if (now - zigGravityHoldStartedAt >= ZIG_GRAVITY_READY_HOLD_MS) {
      zigAttackEnabled = true;
      zigMotionState = 'ready';
      zigGravityHoldStartedAt = null;
      if (hintEl) hintEl.innerText = '攻撃有効化: 大きく攻撃可能';
      setAttackAvailability(true);
    }

    zigLastGyroX = gyroX;
    return;
  }

  // 有効化後、ジャイロ x 軸が負方向のときだけ開始を認める。
  if (gyroX >= 0 || zigMotionState === 'cooldown') {
    zigLastGyroX = gyroX;
    return;
  }

  if (accelForce < ZIG_ACCEL_ATTACK_THRESHOLD) {
    zigLastGyroX = gyroX;
    return;
  }

  const power = Math.max(1, Math.min(3, 1 + accelForce / 4));
  attackMonster(power);
  zigAttackEnabled = false;
  zigMotionState = 'cooldown';
  zigGravityHoldStartedAt = null;
  zigCooldownStartedAt = now;
  if (hintEl) hintEl.innerText = '攻撃後の揺れ待機中...';
  setAttackAvailability(false);

  zigLastGyroX = gyroX;
}

// Zigセンサー用のWebSocket接続を開始して、攻撃入力を受け取れる状態にする関数。
function connectZigSim() {
  if (zigSocket || typeof WebSocket === 'undefined') return;
  const host = location.hostname || 'localhost';
  try {
    zigSocket = new WebSocket(`ws://${host}:${ZIG_WS_PORT}`);
  } catch (err) {
    console.warn('ZIG SIM WebSocket接続に失敗:', err);
    zigSocket = null;
    return;
  }

  zigSocket.onopen = () => {
    const hintEl = getElement('attack-hint');
    if (hintEl) hintEl.innerText = 'パンチングボール接続中: 叩いて攻撃！';
  };
  zigSocket.onmessage = (event) => handleZigSimData(event.data);
  zigSocket.onerror = () => {
    const hintEl = getElement('attack-hint');
    if (hintEl) hintEl.innerText = 'センサー未接続 · パンチングボールの接続を確認してください。';
  };
  zigSocket.onclose = () => {
    zigSocket = null;
    const hintEl = getElement('attack-hint');
    if (hintEl) hintEl.innerText = 'センサー未接続 · パンチングボールの接続を確認してください。';
    if (zigAttackActive) {
      setTimeout(() => {
        if (zigAttackActive && !zigSocket) connectZigSim();
      }, 1000);
    }
  };
}

// 既存のZigセンサー接続を閉じて、攻撃検知を安全に切り離す関数。
function disconnectZigSim() {
  if (zigSocket) {
    try { zigSocket.close(); } catch (err) { }
    zigSocket = null;
  }
}

// Zigの攻撃検知を開始し、初期状態と接続を準備する関数。
function startZigAttackDetection() {
  zigAttackActive = true;
  zigMotionState = 'ready';
  zigGravityHoldStartedAt = null;
  zigAttackEnabled = false;
  zigLastGyroX = 0;
  setAttackAvailability(false);
  connectZigSim();
}

// Zigの攻撃検知を止め、状態変数とセンサー接続の状態をリセットする関数。
function stopZigAttackDetection() {
  zigAttackActive = false;
  zigGravityHoldStartedAt = null;
  zigMotionState = 'ready';
  zigAttackEnabled = false;
  zigLastGyroX = 0;
  setAttackAvailability(false);
}

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

  const damage = Math.round(baseDamage * inputPower);
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

function playMonsterDissolve(onComplete) {
  const monsterEl = getElement('monster');
  if (!monsterEl) {
    onComplete();
    return;
  }

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
  monsterEl.setAttribute('aria-hidden', 'true');
  monsterEl.disabled = true;

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
      document.body.appendChild(shard);
      setTimeout(() => shard.remove(), 1100);
    }
  }

  setTimeout(() => {
    onComplete();
  }, 900);
}

function playScreenCrack() {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
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

  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 1800);
}

function playDefeatCelebration(hasNext) {
  playScreenCrack();
  const celebration = document.createElement('div');
  celebration.className = 'defeat-celebration';
  celebration.setAttribute('aria-hidden', 'true');

  const banner = document.createElement('div');
  banner.className = 'defeat-banner';
  const title = document.createElement('strong');
  title.textContent = 'FINISH';
  const subtitle = document.createElement('span');
  subtitle.textContent = hasNext ? 'NEXT BATTLE' : 'MISSION COMPLETE';
  banner.appendChild(title);
  banner.appendChild(subtitle);
  document.body.appendChild(celebration);
  document.body.appendChild(banner);

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
    document.body.appendChild(sparkle);
    setTimeout(() => sparkle.remove(), MONSTER_DEFEAT_EFFECT_MS);
  }

  setTimeout(() => celebration.remove(), MONSTER_DEFEAT_EFFECT_MS);
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
  stopZigAttackDetection();
  window.location.href = 'result.html';
}

// モンスターを倒したあと、次の敵がいれば連戦を続け、無ければ結果画面へ進む関数。
// hasNextMonster / spawnNextMonster は monster.js 側で定義されている。
function destroyMonster() {
  finalizeBattleResult();
  stopZigAttackDetection();
  const hasNext = typeof hasNextMonster === 'function' && hasNextMonster();
  playDefeatCelebration(hasNext);
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
  });
}