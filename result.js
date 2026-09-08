// result.js — 討伐結果画面の描画
const RESULT_DATA_KEY = 'metsuResultData';

function formatElapsed(ms) {
  if (!ms || ms < 0) return '--.--秒';
  return `${(ms / 1000).toFixed(2)}秒`;
}

function formatVolume(volume) {
  if (typeof volume !== 'number' || isNaN(volume)) return '--%';
  return `${Math.round(Math.min(1, Math.max(0, volume)) * 100)}%`;
}

function formatTone(avgTone, label) {
  if (typeof avgTone !== 'number' || isNaN(avgTone)) return '測定なし';
  return `${avgTone.toFixed(1)} Hz（${label || '不明'}）`;
}

function formLabelOf(form) {
  if (form === 'ex') return 'EX（激怒）';
  if (form === 'sm') return 'SM（小型）';
  return '通常';
}

// 討伐タイムと攻撃回数から簡易ランクを算出する（演出用のおまけ要素）
function computeRank(elapsedMs, attackCount) {
  const seconds = elapsedMs / 1000;
  if (elapsedMs > 0 && seconds <= 5 && attackCount <= 6) return 'S';
  if (elapsedMs > 0 && seconds <= 10 && attackCount <= 10) return 'A';
  if (elapsedMs > 0 && seconds <= 20) return 'B';
  return 'C';
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

function readResultData() {
  try {
    return JSON.parse(sessionStorage.getItem(RESULT_DATA_KEY) || 'null');
  } catch (err) {
    return null;
  }
}

function renderResultScreen() {
  const data = readResultData();
  const msgEl = document.getElementById('reset-msg');

  if (!data) {
    // データがない場合（直接result.htmlを開いた場合など）は簡易表示のみ
    if (msgEl) msgEl.innerText = '討伐完了！';
    const detailsEl = document.getElementById('result-details');
    if (detailsEl) detailsEl.style.display = 'none';
    return;
  }

  if (msgEl) msgEl.innerText = `『${data.category || 'その他'}』を討伐した！`;

  setText('result-time', formatElapsed(data.elapsedMs));
  setText('result-max-volume', formatVolume(data.maxVolume));
  setText('result-avg-tone', formatTone(data.avgTone, data.avgToneLabel));
  setText('result-attack-count', `${data.attackCount ?? 0} 回`);
  setText('result-total-damage', `${data.totalDamageDealt ?? 0}`);
  const avgDamage = data.attackCount ? Math.round((data.totalDamageDealt || 0) / data.attackCount) : 0;
  setText('result-avg-damage', `${avgDamage}`);
  setText('result-max-hit', `${data.maxSingleDamage ?? 0}`);
  setText('result-form', formLabelOf(data.monsterForm));
  setText('result-rank', computeRank(data.elapsedMs, data.attackCount ?? 0));

  const sourceTextEl = document.getElementById('result-source-text');
  if (sourceTextEl) {
    sourceTextEl.innerText = data.analysisText || data.rawText || '（記録なし）';
  }
}

renderResultScreen();
