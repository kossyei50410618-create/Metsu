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
  const micStatus = document.getElementById('mic-status');
  if (micStatus) micStatus.textContent = 'マイクを停止しました。';
  const micMeterFill = document.getElementById('mic-meter-fill');
  if (micMeterFill) micMeterFill.style.width = '0%';
  const micMeterValue = document.getElementById('mic-meter-value');
  if (micMeterValue) micMeterValue.textContent = '0.00';
  const micToneFrequency = document.getElementById('mic-tone-frequency');
  if (micToneFrequency) micToneFrequency.textContent = '-- Hz';
  const micToneLabel = document.getElementById('mic-tone-label');
  if (micToneLabel) micToneLabel.textContent = '音声なし';
});
