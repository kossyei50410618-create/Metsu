// Optional interface enhancements; gameplay remains in the original modules.
const feelingInput = document.getElementById('input-text');
function refreshInputFeedback() {
  if (!feelingInput) return;
  document.getElementById('character-count').textContent = `${Array.from(feelingInput.value).length} 文字`;
  feelingInput.removeAttribute('aria-invalid');
  document.getElementById('input-error').textContent = '';
}

if (feelingInput) {
  feelingInput.addEventListener('input', refreshInputFeedback);
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
