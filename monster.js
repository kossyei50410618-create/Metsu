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
  hobby: { color: 'radial-gradient(circle, #0f766e 0%, #115e59 100%)', shadow: '#2dd4bf', sprite: 'assets/hobby.png' },
  normal: { color: 'radial-gradient(circle, #334155 0%, #0f172a 100%)', shadow: '#64748b', sprite: 'assets/hobby.png' }
};

let monsterType = 'normal';
let currentCategory = 'その他';
const BATTLE_DATA_KEY = 'metsuBattleData';
const SM_VOLUME_THRESHOLD = 0.2;

function getMonsterForm(volume) {
  if (typeof volume !== 'number' || volume <= 0) return 'normal';
  if (volume > EX_VOLUME_THRESHOLD) return 'ex';
  if (volume < SM_VOLUME_THRESHOLD) return 'sm';
  return 'normal';
}

async function generateMonsterImage(typeName, form = 'normal') {
  const resolvedType = typeName || monsterType;
  const baseType = resolvedType || 'normal';
  const sprite = monsters[baseType]?.sprite || monsters.normal.sprite;
  if (form === 'normal') return sprite;
  return sprite.replace(/\.png$/, `_${form}.png`);
}

async function generateMonster(analysisText = null) {
  const inputText = getElement('input-text');
  const rawText = inputText ? inputText.value.trim() : '';
  const storedData = readBattleData();
  const sourceText = analysisText || rawText || storedData?.analysisText || storedData?.rawText;
  if (!sourceText) return alert('内容を入力してください');

  const category = storedData?.category && !analysisText && !rawText
    ? storedData.category
    : await classifyCategoryWithVectors(sourceText);
  monsterType = category.monster;
  currentCategory = category.label;

  if (!getElement('battle-screen')) {
    const monsterForm = getMonsterForm(micMaxVolume);
    saveBattleData({
      rawText: rawText || storedData?.rawText || sourceText,
      analysisText: analysisText || storedData?.analysisText || '',
      category,
      monsterForm,
    });
    window.location.href = 'battle.html';
    return;
  }

  const statusText = getElement('status-text');
  if (statusText) statusText.innerText = '分類中... ベクトルを使って判定しています';

  maxHp = Math.floor(Math.random() * 81) + 100;
  hp = maxHp;

  const monsterEl = getElement('monster');
  const monsterImg = getElement('monster-img');
  const style = monsters[monsterType] || monsters.normal;
  const monsterForm = storedData?.monsterForm || (storedData?.isExForm ? 'ex' : getMonsterForm(micMaxVolume));
  const isExForm = monsterForm === 'ex';
  const imageSrc = await generateMonsterImage(monsterType, monsterForm);

  monsterEl.style.background = style.color;
  monsterEl.style.boxShadow = `0 0 ${isExForm ? 70 : 50}px ${style.shadow}`;
  monsterImg.removeAttribute('src');
  monsterImg.alt = '画像読み込み中...';

  monsterImg.onerror = () => {
    console.warn(`モンスター画像の読み込みに失敗しました: ${imageSrc}`);
    monsterImg.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjU2IiBjeT0iMjU2IiByPSIyNTYiIGZpbGw9IiNkZGQiLz48dGV4dCB4PSIyNTYiIHk9IjI3NiIgc3R5bGU9ImZpbGw6I2NjYztmb250OiAzMHB4IEFyaWFsO3RleHQtYW5jaG9yOiBtaWRkbGU7IiBkeT0iLjM1ZW0iPlVQPC90ZXh0Pjwvc3ZnPg==';
    monsterImg.alt = '画像読み込み失敗';
  };

  const formLabel = monsterForm === 'ex' ? ' (EX)' : monsterForm === 'sm' ? ' (SM)' : '';
  if (statusText) statusText.innerText = `画像読み込み中... ${currentCategory}${formLabel}`;

  try {
    monsterImg.src = await generateMonsterImage(monsterType, monsterForm);
  } catch (err) {
    console.error("画像読み込み失敗。デフォルト画像に切り替えます:", err);
    monsterImg.src = imageSrc;
  }

  getElement('attack-hint').innerText = '';
  if (statusText) statusText.innerText = `ENTITY DETECTED: ${currentCategory}${formLabel}`;
  getElement('display-text').innerText = storedData?.analysisText ? `解析: ${storedData.analysisText}` : `入力: ${sourceText}`;
  getElement('category-label').innerText = `分類: ${currentCategory}`;
  syncHpUi();

  setWeakSpot(monsterType);
  startZigAttackDetection();
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