// Optional interface enhancements; gameplay remains in the original modules.
const feelingInput = document.getElementById('input-text');
function refreshInputFeedback() {
  if (!feelingInput) return;
  document.getElementById('character-count').textContent = `${Array.from(feelingInput.value).length} 文字`;
  feelingInput.removeAttribute('aria-invalid');
  document.getElementById('input-error').textContent = '';
  refreshMonsterPreview();
}

function refreshMonsterPreview() {
  const preview = document.getElementById('preview-monster');
  if (!preview || !feelingInput) return;
  const text = feelingInput.value.trim();
  const category = text ? classifyCategory(text) : null;
  const type = category?.monster || 'human';
  const sprite = type === 'normal' ? 'assets/monster-fallback.svg' : monsters[type]?.sprite;
  preview.src = sprite || 'assets/monster-fallback.svg';
  preview.alt = category ? category.label : '対人関係のモンスター';
  document.getElementById('preview-heading').textContent = text ? 'TARGET PREVIEW' : 'MONSTER ARCHIVE';
  document.getElementById('preview-name').textContent = category ? category.label : '対人関係のモンスター';
  document.getElementById('preview-status').textContent = text ? 'ターゲット予測完了 · 討伐開始でバトルへ' : 'モヤモヤを入力すると、ターゲットが変化';
  document.querySelectorAll('[data-monster]').forEach((button) => {
    button.setAttribute('aria-pressed', String(Boolean(text) && button.dataset.monster === type));
  });
}
if (feelingInput) {
  feelingInput.addEventListener('input', refreshInputFeedback);
  document.querySelectorAll('[data-example]').forEach((button) => button.addEventListener('click', () => {
    feelingInput.value = button.dataset.example;
    refreshInputFeedback();
    feelingInput.focus();
  }));
  refreshInputFeedback();
}
document.getElementById('mic-stop-btn')?.addEventListener('click', () => {
  stopMicMeter();
  document.getElementById('mic-status').textContent = 'マイクを停止しました。文字入力でも遊べます。';
  document.getElementById('mic-meter-fill').style.width = '0%';
  document.getElementById('mic-meter-value').textContent = '0.00';
  document.getElementById('mic-tone-frequency').textContent = '-- Hz';
  document.getElementById('mic-tone-label').textContent = '音声なし';
});
