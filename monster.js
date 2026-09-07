// monster.js
const monsters = {
  human: { color: 'radial-gradient(circle, #d946ef 0%, #7c3aed 100%)', shadow: '#d946ef', sprite: 'assets/human.bmp' },
  career: { color: 'radial-gradient(circle, #0ea5e9 0%, #1d4ed8 100%)', shadow: '#0ea5e9', sprite: 'assets/career.bmp' },
  money: { color: 'radial-gradient(circle, #4d7c0f 0%, #a3e635 100%)', shadow: '#a3e635', sprite: 'assets/money.bmp' },
  health: { color: 'radial-gradient(circle, #16a34a 0%, #0f766e 100%)', shadow: '#16a34a', sprite: 'assets/health.bmp' },
  self: { color: 'radial-gradient(circle, #ec4899 0%, #db2777 100%)', shadow: '#ec4899', sprite: 'assets/self.bmp' },
  time: { color: 'radial-gradient(circle, #f97316 0%, #ea580c 100%)', shadow: '#f97316', sprite: 'assets/time.bmp' },
  digital: { color: 'radial-gradient(circle, #0ea5e9 0%, #0284c7 100%)', shadow: '#0ea5e9', sprite: 'assets/digital.bmp' },
  study: { color: 'radial-gradient(circle, #facc15 0%, #eab308 100%)', shadow: '#facc15', sprite: 'assets/study.bmp' },
  probability: { color: 'radial-gradient(circle, #fde047 0%, #f59e0b 100%)', shadow: '#f59e0b', sprite: 'assets/probability.bmp' },
  habit: { color: 'radial-gradient(circle, #64748b 0%, #334155 100%)', shadow: '#64748b', sprite: 'assets/habit.bmp' },
  normal: { color: 'radial-gradient(circle, #334155 0%, #0f172a 100%)', shadow: '#64748b', sprite: 'assets/normal.bmp' }
};

let monsterType = 'normal';
let currentCategory = 'その他';

async function generateMonsterImage(typeName, isExVersion = false) {
  const resolvedType = typeName || monsterType;
  const baseType = resolvedType || 'normal';
  const variantSuffix = isExVersion ? '_ex' : '';
  return `assets/${baseType}${variantSuffix}.bmp`;
}

async function generateMonster(analysisText = null) {
  const rawText = getElement('input-text').value;
  const sourceText = analysisText || rawText;
  if (!sourceText) return alert('内容を入力してください');

  getElement('status-text').innerText = '分類中... ベクトルを使って判定しています';
  const category = await classifyCategoryWithVectors(sourceText);
  monsterType = category.monster;
  currentCategory = category.label;

  maxHp = Math.floor(Math.random() * 81) + 100;
  hp = maxHp;

  const monsterEl = getElement('monster');
  const monsterImg = getElement('monster-img');
  const style = monsters[monsterType] || monsters.normal;
  const isExForm = micMaxVolume > EX_VOLUME_THRESHOLD;
  const imageSrc = `assets/${monsterType}${isExForm ? '_ex' : ''}.bmp`;

  monsterEl.style.background = style.color;
  monsterEl.style.boxShadow = `0 0 ${isExForm ? 70 : 50}px ${style.shadow}`;
  monsterImg.removeAttribute('src');
  monsterImg.alt = '画像読み込み中...';

  monsterImg.onerror = () => {
    console.warn(`モンスター画像の読み込みに失敗しました: ${imageSrc}`);
    monsterImg.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjU2IiBjeT0iMjU2IiByPSIyNTYiIGZpbGw9IiNkZGQiLz48dGV4dCB4PSIyNTYiIHk9IjI3NiIgc3R5bGU9ImZpbGw6I2NjYztmb250OiAzMHB4IEFyaWFsO3RleHQtYW5jaG9yOiBtaWRkbGU7IiBkeT0iLjM1ZW0iPlVQPC90ZXh0Pjwvc3ZnPg==';
    monsterImg.alt = '画像読み込み失敗';
  };

  getElement('status-text').innerText = `画像読み込み中... ${currentCategory}${isExForm ? ' (EX: 最大音圧 0.3超)' : ''}`;

  try {
    monsterImg.src = await generateMonsterImage(monsterType, isExForm);
  } catch (err) {
    console.error("画像読み込み失敗。デフォルト画像に切り替えます:", err);
    monsterImg.src = imageSrc;
  }

  getElement('attack-hint').innerText = '';
  getElement('status-text').innerText = `ENTITY DETECTED: ${currentCategory}${isExForm ? ' (EX: 最大音圧 0.3超)' : ''}`;
  getElement('display-text').innerText = analysisText ? `解析: ${analysisText}` : `入力: ${rawText}`;
  getElement('category-label').innerText = `分類: ${currentCategory}`;
  syncHpUi();

  getElement('input-screen').style.display = 'none';
  getElement('battle-screen').style.display = 'flex';
  setWeakSpot(monsterType);
  startZigAttackDetection();
}

function setWeakSpot(type) {
  const weakSpotEl = getElement('weak-spot');
  if (weakSpotEl) weakSpotEl.style.display = 'none';
  weakSpot = null;
}