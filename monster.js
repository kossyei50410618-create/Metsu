// monster.js
const monsters = {
  human: { color: 'radial-gradient(circle, #d946ef 0%, #7c3aed 100%)', shadow: '#d946ef', sprite: 'assets/human.png' },
  family: { color: 'radial-gradient(circle, #be123c 0%, #881337 100%)', shadow: '#fb7185', sprite: 'assets/family.png' },
  career: { color: 'radial-gradient(circle, #0ea5e9 0%, #1d4ed8 100%)', shadow: '#0ea5e9', sprite: 'assets/career.png' },
  money: { color: 'radial-gradient(circle, #4d7c0f 0%, #a3e635 100%)', shadow: '#a3e635', sprite: 'assets/money.png' },
  health: { color: 'radial-gradient(circle, #16a34a 0%, #0f766e 100%)', shadow: '#16a34a', sprite: 'assets/health.png' },
  self: { color: 'radial-gradient(circle, #ec4899 0%, #db2777 100%)', shadow: '#ec4899', sprite: 'assets/self.png' },
  time: { color: 'radial-gradient(circle, #f97316 0%, #ea580c 100%)', shadow: '#f97316', sprite: 'assets/time.png' },
  digital: { color: 'radial-gradient(circle, #0ea5e9 0%, #0284c7 100%)', shadow: '#0ea5e9', sprite: 'assets/digital.png' },
  study: { color: 'radial-gradient(circle, #facc15 0%, #eab308 100%)', shadow: '#facc15', sprite: 'assets/study.png' },
  probability: { color: 'radial-gradient(circle, #fde047 0%, #f59e0b 100%)', shadow: '#f59e0b', sprite: 'assets/probability.png' },
  habit: { color: 'radial-gradient(circle, #64748b 0%, #334155 100%)', shadow: '#64748b', sprite: 'assets/habit.png' },
  leisure: { color: 'radial-gradient(circle, #0f766e 0%, #115e59 100%)', shadow: '#2dd4bf', sprite: 'assets/leisure.png' },
  normal: { color: 'radial-gradient(circle, #334155 0%, #0f172a 100%)', shadow: '#64748b', sprite: 'assets/nomal.png' }
};

let monsterType = 'normal';
let currentCategory = 'その他';

// ==== 連戦キュー(secondaryカテゴリがあれば「主敵→副敵」の順で連戦する) ====
let monsterQueue = [];      // [{ key, label, monster }, ...]
let monsterQueueIndex = 0;

const BATTLE_DATA_KEY = 'metsuBattleData';
const SM_VOLUME_THRESHOLD = 0.2;

// classifyCategoryWithVectors の戻り値(category)から、倒すべき敵の一覧を組み立てる。
// secondary が無ければ1体だけの配列になる(今までと完全に同じ挙動)。
function buildMonsterQueue(category) {
  const queue = [{ key: category.key, label: category.label, monster: category.monster }];
  if (category.secondary) {
    queue.push({
      key: category.secondary.key,
      label: category.secondary.label,
      monster: category.secondary.monster,
    });
  }
  return queue;
}

// 次の敵がキューに残っているか
function hasNextMonster() {
  return monsterQueueIndex < monsterQueue.length - 1;
}

function getMonsterForm(volume) {
  if (typeof volume !== 'number' || volume <= 0) return 'normal';
  if (volume > EX_VOLUME_THRESHOLD) return 'ex';
  if (volume < SM_VOLUME_THRESHOLD) return 'sm';
  return 'normal';
}

async function generateMonsterImage(typeName, form = 'normal') {
  const resolvedType = typeName || monsterType;
  const baseType = resolvedType || 'normal';
  if (baseType === 'normal' || !monsters[baseType]) return 'assets/monster-fallback.svg';
  const sprite = monsters[baseType].sprite;
  if (form === 'normal') return sprite;
  return sprite.replace(/\.png$/, `_${form}.png`);
}

async function generateMonster(analysisText = null) {
  const inputText = getElement('input-text');
  const rawText = inputText ? inputText.value.trim() : '';
  const storedData = readBattleData();
  const sourceText = analysisText || rawText || storedData?.analysisText || storedData?.rawText;
  if (!sourceText) return alert('内容を入力してください');

  const isFirstEntry = !getElement('battle-screen');

  let activeCategory;

  if (isFirstEntry) {
    // input-screen側: まだキューは無いので、新しく分類してキューを作る
    const shouldReuseStoredCategory = storedData?.category && !analysisText && !rawText;
    const classifiedCategory = shouldReuseStoredCategory ? storedData.category : await classifyCategoryWithVectors(sourceText);

    monsterQueue = buildMonsterQueue(classifiedCategory);
    monsterQueueIndex = 0;
    activeCategory = monsterQueue[0];

    const monsterForm = getMonsterForm(micMaxVolume);
    // 討伐結果画面で使うため、音量の最大値と声のトーンの平均もここで確定させて引き継ぐ
    const micStats = (typeof window.getMicSessionStats === 'function') ? window.getMicSessionStats() : null;
    saveBattleData({
      rawText: rawText || storedData?.rawText || sourceText,
      analysisText: analysisText || storedData?.analysisText || '',
      category: classifiedCategory, // 表示用に元の分類結果(label/secondary込み)も保持
      queue: monsterQueue,
      queueIndex: 0,
      monsterForm,
      micMaxVolume: micStats?.maxVolume ?? micMaxVolume,
      micAvgTone: micStats?.avgTone ?? null,
      micAvgToneLabel: micStats?.avgToneLabel ?? '不明',
    });
    window.location.href = 'battle.html';
    return;
  }

  // battle-screen側: 保存済みのキューを復元して1体目を描画する
  monsterQueue = storedData?.queue?.length ? storedData.queue : buildMonsterQueue(storedData?.category || { key: 'unknown', label: 'その他', monster: 'normal' });
  monsterQueueIndex = storedData?.queueIndex ?? 0;
  activeCategory = monsterQueue[monsterQueueIndex];

  const monsterForm = storedData?.monsterForm || (storedData?.isExForm ? 'ex' : getMonsterForm(micMaxVolume));
  await renderMonster(activeCategory, monsterForm, storedData);
}

// 実際にモンスターをバトル画面に描画する処理(初回表示・連戦での再召喚の両方から呼ばれる)
async function renderMonster(category, monsterForm, storedData) {
  monsterType = category.monster;
  currentCategory = category.label;

  const statusText = getElement('status-text');
  if (statusText) statusText.innerText = 'モンスターを準備しています…';

  maxHp = Math.floor(Math.random() * 81) + 100;
  hp = maxHp;

  const monsterEl = getElement('monster');
  const monsterImg = getElement('monster-img');
  const style = monsters[monsterType] || monsters.normal;
  const isExForm = monsterForm === 'ex';
  const imageSrc = await generateMonsterImage(monsterType, monsterForm);

  monsterEl.style.background = style.color;
  monsterEl.style.boxShadow = `0 12px ${isExForm ? 35 : 24}px ${style.shadow}35`;
  monsterImg.removeAttribute('src');
  monsterImg.alt = '画像読み込み中...';

  monsterImg.onerror = () => {
    console.warn(`モンスター画像の読み込みに失敗しました: ${imageSrc}`);
    monsterImg.onerror = null;
    monsterImg.src = 'assets/monster-fallback.svg';
    monsterImg.alt = 'モヤモヤのモンスター';
  };

  const formLabel = monsterForm === 'ex' ? ' (EX)' : monsterForm === 'sm' ? ' (SM)' : '';
  const queueLabel = monsterQueue.length > 1 ? ` [${monsterQueueIndex + 1}/${monsterQueue.length}]` : '';
  if (statusText) statusText.innerText = `画像読み込み中... ${currentCategory}${formLabel}`;

  try {
    monsterImg.src = await generateMonsterImage(monsterType, monsterForm);
  } catch (err) {
    console.error("画像読み込み失敗。デフォルト画像に切り替えます:", err);
    monsterImg.src = imageSrc;
  }

  getElement('attack-hint').innerText = '';
  if (statusText) statusText.innerText = `${currentCategory}のモンスター${formLabel}${queueLabel}`;
  getElement('display-text').innerText = storedData?.analysisText ? `解析: ${storedData.analysisText}` : `入力: ${storedData?.rawText || ''}`;
  getElement('category-label').innerText = `分類: ${currentCategory}${queueLabel}`;
  monsterImg.alt = `${currentCategory}のモンスター`;
  syncHpUi();

  setWeakSpot(monsterType);

  // 討伐タイム計測と攻撃統計をここでリセットしてから戦闘を開始する
  battleStartTime = Date.now();
  attackCount = 0;
  totalDamageDealt = 0;
  maxSingleDamage = 0;

  startZigAttackDetection();
}

// 1体倒した後、キューに次の敵がいれば呼ばれる(battle.js の destroyMonster から呼び出す)
async function spawnNextMonster() {
  if (!hasNextMonster()) return false;

  monsterQueueIndex += 1;
  const storedData = readBattleData();
  saveBattleData({ ...storedData, queueIndex: monsterQueueIndex });

  const nextCategory = monsterQueue[monsterQueueIndex];
  const monsterForm = storedData?.monsterForm || 'normal';
  await renderMonster(nextCategory, monsterForm, storedData);
  return true;
}

function saveBattleData(data) {
  sessionStorage.setItem(BATTLE_DATA_KEY, JSON.stringify(data));
}

function readBattleData() {
  try {
    return JSON.parse(sessionStorage.getItem(BATTLE_DATA_KEY) || 'null');
  } catch (error) {
    sessionStorage.removeItem(BATTLE_DATA_KEY);
    return null;
  }
}

async function initializeBattlePage() {
  if (!readBattleData()) {
    window.location.href = 'index.html';
    return;
  }
  await generateMonster();
}

function setWeakSpot(type) {
  const weakSpotEl = getElement('weak-spot');
  if (weakSpotEl) weakSpotEl.style.display = 'none';
  weakSpot = null;
}
