// battle.js
let hp = 100;
let maxHp = 100;
let lastAttackTime = 0;
let weakSpot = null;

const ZIG_WS_PORT = 8765;
const ZIG_ACCEL_ATTACK_THRESHOLD = 0.45;
const ZIG_ATTACK_COOLDOWN_MS = 5000;

let zigSocket = null;
let zigAttackActive = false;
let zigMotionState = 'ready';
let zigAttackCooldownUntil = null;

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

function handleZigSimData(raw) {
  if (!zigAttackActive) return;
  let data;
  try { data = JSON.parse(raw); } catch (err) { return; }

  const accel = extractZigVector(data, 'accel');
  const accelMagnitude = Math.sqrt(accel.x ** 2 + accel.y ** 2 + accel.z ** 2);
  const now = Date.now();
  const hintEl = getElement('attack-hint');

  if (zigMotionState === 'cooldown') {
    if (zigAttackCooldownUntil !== null && now >= zigAttackCooldownUntil) {
      zigMotionState = 'ready';
      zigAttackCooldownUntil = null;
      if (hintEl) hintEl.innerText = 'パンチングボール接続中: 叩いて攻撃！';
      return;
    }
    if (hintEl) hintEl.innerText = '5秒後次の攻撃を受け付けます...';
    return;
  }

  const gyro = extractZigVector(data, 'gyro');
  if (accelMagnitude < ZIG_ACCEL_ATTACK_THRESHOLD || gyro.x >= 0) return;

  const negativeGyroX = Math.max(0, -gyro.x);
  const power = Math.max(1, Math.min(3, 1 + negativeGyroX / 4));

  attackMonster(power);
  zigMotionState = 'cooldown';
  zigAttackCooldownUntil = now + ZIG_ATTACK_COOLDOWN_MS;
}

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
    if (hintEl) hintEl.innerText = 'センサー未接続 · タップやキーボードで遊べます。';
  };
  zigSocket.onclose = () => {
    zigSocket = null;
    const hintEl = getElement('attack-hint');
    if (hintEl) hintEl.innerText = 'センサー未接続 · タップやキーボードで遊べます。';
  };
}

function disconnectZigSim() {
  if (zigSocket) {
    try { zigSocket.close(); } catch (err) { }
    zigSocket = null;
  }
}

function startZigAttackDetection() {
  zigAttackActive = true;
  zigMotionState = 'ready';
  zigAttackCooldownUntil = null;
  connectZigSim();
}

function stopZigAttackDetection() {
  zigAttackActive = false;
  zigAttackCooldownUntil = null;
}

function syncHpUi() {
  const hpFill = getElement('hp-fill');
  const hpValue = getElement('hp-value');
  if (!hpFill || !hpValue) return;

  const safeMaxHp = Math.max(1, maxHp);
  const safeHp = Math.max(0, Math.min(safeMaxHp, hp));
  const percent = (safeHp / safeMaxHp) * 100;
  hpFill.style.width = `${percent}%`;
  hpValue.innerText = `HP: ${safeHp}`;
  const hpBar = getElement('hp-bar');
  hpBar.setAttribute('aria-valuemax', safeMaxHp);
  hpBar.setAttribute('aria-valuenow', safeHp);
}

function showAttackFeedback(message) {
  const status = getElement('status-text');
  const previous = status.innerText;
  status.innerText = message;
  setTimeout(() => {
    if (status.innerText === message) status.innerText = previous;
  }, 900);
}

function attackMonster(eventOrPower) {
  if (hp <= 0 || !zigAttackActive) return;
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
  if (damage > 0) {
    hp -= damage;
    if (hp < 0) hp = 0;
  }

  syncHpUi();
  showAttackFeedback(feedback);
  lastAttackTime = now;

  document.body.style.transform = `translate(${Math.random() * 10 - 5}px, ${Math.random() * 10 - 5}px)`;
  setTimeout(() => document.body.style.transform = 'translate(0,0)', 50);

  createParticles();
  if (hp <= 0) destroyMonster();
}

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

function showReplayScreen() {
  stopZigAttackDetection();
  window.location.href = 'result.html';
}

// 1体倒した後、キュー　に次の敵(secondaryカテゴリ)がいれば連戦、いなければ結果画面へ。
// hasNextMonster / spawnNextMonster は monster.js 側で定義されている。
function destroyMonster() {
  stopZigAttackDetection();

  if (typeof hasNextMonster === 'function' && hasNextMonster()) {
    showAttackFeedback('撃破！ 次の敵が現れた...');
    setTimeout(async () => {
      await spawnNextMonster();
    }, 1000);
    return;
  }

  showReplayScreen();
}
