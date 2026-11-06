const CONFIG = {
  // 各種しきい値
  STATE_CONFIDENCE_THRESHOLD: 0.7,
  PATTERN_CONFIDENCE_THRESHOLD: 0.7,
  SAFETY_CONFIDENCE_THRESHOLD: 0.82,

  // 【追加】音声認識の精度向上用の設定
  MIN_SPEECH_VOLUME: 0.02,    // 録音中の最大音量がこれ未満なら「声が小さい／雑音」として聞き返す
  USE_ON_DEVICE_BIASING: true, // 対応ブラウザでは端末内認識＋単語ブーストを使う
  SILENCE_END_MS: 1800,       // 最後の発話からこの時間が経ったら認識を終了
  HARD_TIMEOUT_MS: 20000,     // 認識全体の上限時間
  MAX_ALTERNATIVES: 5,        // 取得する認識候補の数
};

// 【追加】Gemini を使わない補正用データ
// 認識候補の中から優先して選びたい単語（ストレス・悩みに関する語彙）
const EXPECTED_KEYWORDS = [
  '仕事', '上司', '部下', '同僚', '会社', '残業', '給料', 'お金', '家族', '親', '子供',
  '友達', '恋人', '健康', '病気', '睡眠', '勉強', '試験', '時間', 'スマホ', '将来',
  'むかつく', 'ムカつく', 'イライラ', '腹が立つ', '疲れた', '不安', '悩み', '怒り',
];

// よくある誤認識の置き換え表（「誤って認識されやすい語」: 「正しい語」）
// 実際に起きた誤認識を見つけるたびに、ここへ追加してください
const CORRECTION_DICT = {
  // 例: 'じょうし': '上司',
  // 例: 'ざんぎょ': '残業',
};

// ==============================
// 補正辞書（手書き＋学習）
// ・CORRECTION_DICT: 自分で書く置き換え表
// ・学習辞書: 以前の確認画面で保存した sessionStorage の補正を引き続き使う
// ==============================
const LEARNED_DICT_KEY = 'speechLearnedCorrections';

function loadLearnedDict() {
  if (window.MetsuAccount?.guest) return {};
  try {
    return JSON.parse(sessionStorage.getItem(`${LEARNED_DICT_KEY}:${window.MetsuAccount?.user?.id || 'legacy'}`)) || {};
  } catch (e) {
    return {};
  }
}

function getCorrectionDict() {
  return { ...CORRECTION_DICT, ...loadLearnedDict() };
}

function applyCorrectionDict(text) {
  let result = text;
  for (const [wrong, right] of Object.entries(getCorrectionDict())) {
    if (wrong && result.includes(wrong)) result = result.split(wrong).join(right);
  }
  return result;
}

// 単語ブースト用のリスト（期待語彙＋学習した正しい語）
function getBiasPhrases() {
  const map = new Map();
  EXPECTED_KEYWORDS.forEach((w) => map.set(w, 3.0));
  Object.values(getCorrectionDict()).forEach((w) => map.set(w, 5.0));
  return Array.from(map.entries());
}

// 「えーっと」「あのー」など、はっきりしたフィラーを取り除く
// （「あの人」などを壊さないよう、伸ばす形・明確な形だけを対象にする）
function removeFillers(text) {
  return text.replace(/(えーっと|えーと|えっと|あのー+|そのー+|うーん|んー+)/g, '');
}

function getElement(id) {
  return document.getElementById(id);
}
window.getElement = getElement;

function resetToInputScreen(event) {
  event?.preventDefault();
  sessionStorage.removeItem('metsuBattleData');
  sessionStorage.removeItem('metsuResultData');
  window.location.href = 'index.html';
}

const GEMINI_ANALYSIS_TIMEOUT_MS = 20000;

async function generateResponse(_prompt, input, options = {}) {
  const remainingMs = (options.deadlineAt || Date.now() + GEMINI_ANALYSIS_TIMEOUT_MS) - Date.now();
  if (remainingMs <= 0) throw new Error('AI analysis timed out');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remainingMs);
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Metsu-Request': '1' },
      body: JSON.stringify({ kind: options.kind || 'speech', input }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('AI analysis unavailable (HTTP ' + response.status + ')');
    const data = await response.json();
    if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('AI analysis was empty');
    return data.text.trim();
  } finally { clearTimeout(timer); }
}

async function analyzeSpeechText(transcript, deadlineAt = Date.now() + GEMINI_ANALYSIS_TIMEOUT_MS) {
  const analysis = await generateResponse(null, transcript, { kind: 'speech', deadlineAt });
  if (!/[。！？!?」』]$/.test(analysis)) throw new Error('AI analysis was incomplete');
  return analysis;
}

function shouldAnalyzeAudioFeatures(audioStats) {
  if (!audioStats || !audioStats.toneSampleCount || audioStats.toneSampleCount < 3) return false;
  if (!Number.isFinite(audioStats.maxVolume) || audioStats.maxVolume <= 0) return false;
  return true;
}

async function analyzeAudioFeatures(audioStats, deadlineAt = Date.now() + GEMINI_ANALYSIS_TIMEOUT_MS) {
  if (!shouldAnalyzeAudioFeatures(audioStats)) return '';
  const analysis = await generateResponse(null, JSON.stringify(audioStats), { kind: 'audio', deadlineAt });
  return analysis.replace(/\*\*/g, '');
}

window.generateResponse = generateResponse;
window.analyzeSpeechText = analyzeSpeechText;
window.analyzeAudioFeatures = analyzeAudioFeatures;
window.shouldAnalyzeAudioFeatures = shouldAnalyzeAudioFeatures;

function normalizeSpeechTranscript(transcript) {
  if (typeof transcript !== 'string') return '';
  return transcript.replace(/\s+/g, '');
}

function isSpeechRecognitionSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function useRecordedVoice() {
  const mobile = navigator.userAgentData?.mobile ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return !!(window.MediaRecorder && navigator.mediaDevices?.getUserMedia &&
    (mobile || !isSpeechRecognitionSupported()));
}

// One getUserMedia stream feeds both Web Audio and MediaRecorder. Mobile speech
// services can interrupt a separate microphone capture even in the same browser.
async function listenRecorded() {
  const controls = getElement('voice-recording-controls');
  const finishButton = getElement('voice-finish-btn');
  const cancelButton = getElement('voice-cancel-btn');
  const status = getElement('mic-status');
  let recorder;
  let cancelled = false;
  let timeout;
  let silenceCheck;
  let rejectRecording;
  let transcriptionController;
  const finish = () => {
    if (recorder?.state === 'recording') recorder.stop();
  };
  const cancel = () => {
    cancelled = true;
    transcriptionController?.abort();
    finish();
    stopMicMeter();
  };
  const interrupted = () => {
    rejectRecording?.(new Error('マイクが切断されました。画面を開いたまま、もう一度お試しください。'));
    finish();
  };
  const visibilityChanged = () => { if (document.hidden) cancel(); };
  let track;
  controls.hidden = false;
  finishButton.disabled = true;
  cancelButton.disabled = false;
  finishButton.addEventListener('click', finish);
  cancelButton.addEventListener('click', cancel);
  document.addEventListener('visibilitychange', visibilityChanged);
  try {
    status.innerText = 'マイクを準備しています。使用を許可してください。';
    const ready = await window.initMicMeter();
    if (cancelled) return null;
    if (!ready) throw new Error('マイクを開始できませんでした。Chromeのマイク権限を確認し、通話や録音を終了してから再試行してください。');
    const stream = window.getMicStream();
    track = stream.getAudioTracks()[0];
    track.addEventListener('ended', interrupted);
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
      .find(type => window.MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('このブラウザーでは音声を録音できません。文字で入力してください。');
    recorder = new window.MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
    window.startMicVolumeCollection();
    const blob = await new Promise((resolve, reject) => {
      rejectRecording = reject;
      const chunks = [];
      let bytes = 0;
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        bytes += event.data.size;
        if (bytes > 1000000) {
          reject(new Error('録音データが大きすぎます。短く話してもう一度お試しください。'));
          finish();
        } else chunks.push(event.data);
      };
      recorder.onerror = () => {
        reject(new Error('録音中にエラーが発生しました。もう一度お試しください。'));
        finish();
      };
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
      recorder.start(250);
      finishButton.disabled = false;
      status.innerText = '録音中… 話し終わったら「話し終わった」を押してください。';
      timeout = setTimeout(finish, CONFIG.HARD_TIMEOUT_MS);
      let lastVoiceAt = Date.now();
      let heardVoice = false;
      silenceCheck = setInterval(() => {
        if (window.getMicData().volume >= CONFIG.MIN_SPEECH_VOLUME) {
          heardVoice = true;
          lastVoiceAt = Date.now();
        }
        if (heardVoice && Date.now() - lastVoiceAt >= CONFIG.SILENCE_END_MS) finish();
      }, 100);
    });
    clearTimeout(timeout);
    clearInterval(silenceCheck);
    window.stopMicVolumeCollection();
    stopMicMeter();
    if (cancelled) return null;
    if (!blob.size) throw new Error('音声が録音されませんでした。もう一度お試しください。');
    controls.hidden = true;
    status.innerText = '録音完了。AIで文字起こししています…';
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    transcriptionController = new AbortController();
    const transcribeTimeout = setTimeout(() => transcriptionController.abort(), GEMINI_ANALYSIS_TIMEOUT_MS);
    try {
      const response = await fetch('/api/transcribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Metsu-Request': '1' },
        body: JSON.stringify({ audio: btoa(binary), mimeType: blob.type.split(';')[0] }),
        signal: transcriptionController.signal,
      });
      if (!response.ok) throw new Error('AIの文字起こしを利用できませんでした。通信を確認して再試行するか、文字で入力してください。');
      const data = await response.json();
      if (cancelled) return null;
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      return { segments: text && text !== 'NO_SPEECH' ? [[{ text, confidence: 0 }]] : [] };
    } catch (error) {
      if (cancelled) return null;
      if (error.name === 'AbortError') throw new Error('AIの文字起こしが時間内に完了しませんでした。もう一度お試しください。');
      throw error;
    } finally { clearTimeout(transcribeTimeout); }
  } finally {
    clearTimeout(timeout);
    clearInterval(silenceCheck);
    rejectRecording = null;
    track?.removeEventListener('ended', interrupted);
    document.removeEventListener?.('visibilitychange', visibilityChanged);
    finishButton.removeEventListener?.('click', finish);
    cancelButton.removeEventListener?.('click', cancel);
    finish();
    window.stopMicVolumeCollection();
    stopMicMeter();
    controls.hidden = true;
    finishButton.disabled = true;
    cancelButton.disabled = true;
  }
}

// ==============================
// 端末内認識＋単語ブースト（対応ブラウザのみ）
// 使えない場合は false を返し、通常のクラウド認識にフォールバックする
// ==============================
async function setupBiasing(SR, recognition) {
  if (!CONFIG.USE_ON_DEVICE_BIASING) return false;
  try {
    if (typeof SR.available !== 'function') return false;
    if (typeof SpeechRecognitionPhrase === 'undefined') return false;
    if (!('phrases' in recognition) || !('processLocally' in recognition)) return false;

    const options = { langs: ['ja-JP'], processLocally: true };
    const availability = await SR.available(options);

    // まだ言語パックが無い場合は、次回以降のために裏でインストールだけ始める
    if (
      (availability === 'downloadable' || availability === 'after-download') &&
      typeof SR.install === 'function'
    ) {
      SR.install(options).catch(() => { });
      return false;
    }
    if (availability !== 'available') return false;

    recognition.processLocally = true;
    recognition.phrases = getBiasPhrases().map(
      ([phrase, boost]) => new SpeechRecognitionPhrase(phrase, boost)
    );
    return true;
  } catch (e) {
    console.warn('単語ブーストを使えませんでした（通常の認識を使います）:', e);
    return false;
  }
}

// ==============================
// 音声認識（改良版）
// ・候補を複数取得
// ・話し終わるまで待つ（言いよどみで切れない）
// ・対応ブラウザでは端末内認識＋単語ブースト
// 戻り値: { segments: [[{text, confidence}, ...], ...], interim: string }
//   segments は「確定した区間ごとの候補リスト」
// ==============================
async function listen(allowBiasing = true, onInterim = null) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    throw new Error("このブラウザは音声認識に対応していません。Chrome または Edge をお試しください。");
  }

  const recognition = new SR();
  recognition.lang = "ja-JP";
  recognition.interimResults = true;
  recognition.continuous = true;                         // 言いよどんでも切れない
  recognition.maxAlternatives = CONFIG.MAX_ALTERNATIVES; // 候補を複数取得

  const biased = allowBiasing ? await setupBiasing(SR, recognition) : false;

  return new Promise((resolve, reject) => {
    const finalSegments = [];
    let interimText = "";
    let resolved = false;
    let silenceTimer = null;
    let hardTimeoutId = null;
    let stopFallbackId = null;

    function clearTimers() {
      clearTimeout(silenceTimer);
      clearTimeout(hardTimeoutId);
      clearTimeout(stopFallbackId);
    }

    // 結果を返して終了
    function finish() {
      if (resolved) return;
      resolved = true;
      clearTimers();
      try { recognition.stop(); } catch (e) { }
      window.stopMicVolumeCollection();

      // 確定しなかった途中結果が残っていれば、最後の区間として使う
      if (interimText) {
        finalSegments.push([{ text: interimText, confidence: 0 }]);
        interimText = "";
      }
      resolve({ segments: finalSegments, interim: "" });
    }

    function fail(err) {
      if (resolved) return;
      resolved = true;
      clearTimers();
      try { recognition.stop(); } catch (e) { }
      window.stopMicVolumeCollection();
      reject(err);
    }

    // 認識を止める。最後の確定結果が届くのを待ってから onend で finish する。
    // 届かない場合に備えて 1.5 秒後に強制終了する。
    function requestStop() {
      if (resolved) return;
      try { recognition.stop(); } catch (e) { }
      clearTimeout(stopFallbackId);
      stopFallbackId = setTimeout(finish, 1500);
    }

    // 話している間は終了を先延ばしにする
    function armSilenceTimer() {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(requestStop, CONFIG.SILENCE_END_MS);
    }

    recognition.onstart = () => {
      window.startMicVolumeCollection();
      // Keep recognition.start() in the click gesture; measure the same utterance
      // independently once recognition has acquired its microphone.
      void window.initMicMeter();
    };

    recognition.onresult = (event) => {
      interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const candidates = Array.from(result).map((alt) => ({
            text: alt.transcript,
            confidence: alt.confidence,
          }));
          finalSegments.push(candidates);
        } else {
          interimText += result[0].transcript;
        }
      }
      // 話している最中に、聞き取れている内容を画面に出す（間違いにすぐ気づける）
      if (onInterim) {
        try { onInterim(finalSegments.map((c) => c[0].text).join('') + interimText); } catch (e) { }
      }
      armSilenceTimer();
    };

    recognition.onerror = (event) => {
      // 端末内認識／単語ブーストが使えなかった場合は、通常の認識でやり直す
      if (
        biased &&
        ['language-not-supported', 'phrases-not-supported', 'service-not-allowed'].includes(event.error)
      ) {
        if (resolved) return;
        resolved = true;
        clearTimers();
        window.stopMicVolumeCollection();
        resolve(listen(false, onInterim));
        return;
      }
      if (event.error === 'no-speech' ||
          (event.error === 'aborted' && (finalSegments.length || interimText))) {
        finish();
      } else {
        const messages = {
          'not-allowed': 'マイクまたは音声入力が許可されていません。ブラウザーのサイト設定を確認してください。',
          'service-not-allowed': 'このブラウザーでは音声入力を利用できません。別のブラウザーか文字入力をお試しください。',
          'audio-capture': 'マイクを取得できません。通話や録音を終了して、もう一度お試しください。',
          'network': '音声認識サービスに接続できません。通信環境を確認して、もう一度お試しください。',
          'aborted': 'ブラウザーが音声入力を中断しました。もう一度音声ボタンを押すか、文字で入力してください。',
          'language-not-supported': '日本語の音声認識を利用できません。別のブラウザーか文字入力をお試しください。',
        };
        fail(new Error(messages[event.error] || `音声認識エラー: ${event.error}`));
      }
    };

    recognition.onend = () => finish();

    hardTimeoutId = setTimeout(requestStop, CONFIG.HARD_TIMEOUT_MS);

    try {
      recognition.start();
    } catch (e) {
      fail(new Error(`音声認識の開始に失敗: ${e.message}`));
    }
  });
}

// ==============================
// 誤認識の補正（Gemini は使わず、端末内だけで行う）
// ・辞書（手書き＋学習）を各候補に適用
// ・各区間の候補から、信頼度＋期待語彙の一致で最良のものを選ぶ
// 戻り値: { text, confidence(null=不明), corrected }
// ==============================
function correctTranscript(segments) {
  let corrected = false;
  const confidences = [];

  const picked = segments.map((cands) => {
    let bestText = applyCorrectionDict(cands[0].text);
    let bestConfidence = cands[0].confidence || 0;
    let bestScore = -Infinity;

    cands.forEach((c, rank) => {
      const fixedText = applyCorrectionDict(c.text);
      const conf = c.confidence || 0;
      const keywordHits = EXPECTED_KEYWORDS.filter((w) => fixedText.includes(w)).length;
      // 信頼度に、期待語彙の一致ボーナスを足す。順位が下がるほど少し減点
      const score = conf + keywordHits * 0.15 - rank * 0.01;
      if (score > bestScore) {
        bestScore = score;
        bestText = fixedText;
        bestConfidence = conf;
        // 辞書で直った、または第1候補以外を期待語彙つきで選んだ場合は「補正した」
        if (fixedText !== c.text) corrected = true;
        if (rank > 0 && keywordHits > 0) corrected = true;
      }
    });

    confidences.push(bestConfidence);
    return bestText;
  });

  const text = picked.join('');
  if (!text) return { text: '', confidence: null, corrected: false };

  // ブラウザによっては confidence が常に 0 になるため、その場合は「不明」として扱う
  const hasConfidence = confidences.some((v) => v > 0);
  const avgConfidence = hasConfidence
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : null;

  return { text, confidence: avgConfidence, corrected };
}

function updatePipelineStage(message) {
  const stage = document.getElementById('pipeline-stage');
  if (stage) stage.innerText = message;
}

async function startRecognition() {
  const status = document.getElementById('mic-status') || document.getElementById('status-text');
  const inputText = document.getElementById('input-text');

  if (!status || !inputText) return;
  const recordedVoice = useRecordedVoice();
  if (!recordedVoice && !isSpeechRecognitionSupported()) {
    status.innerText = 'お使いのブラウザは音声認識に対応していません。Chrome または Edge をお試しください。';
    updatePipelineStage('音声認識非対応');
    return;
  }

  if (window.isSecureContext === false) {
    status.innerText = '音声入力にはHTTPSが必要です。HTTPSのURLで開くか、文字で入力してください。';
    updatePipelineStage('安全な接続が必要です');
    return;
  }
  // Release any diagnostic session before starting this utterance.
  stopMicMeter();

  updatePipelineStage('ステップ 1/3: 音声を入力しています');
  status.innerText = '録音中... 話してください。';

  try {
    const recognized = recordedVoice ? await listenRecorded() : await listen(false, (heard) => {
      status.innerText = `録音中... 「${heard}」`;
    });
    if (recognized === null) {
      status.innerText = '録音をキャンセルしました。';
      updatePipelineStage('音声入力がキャンセルされました。');
      return;
    }
    window.stopMicVolumeCollection();

    const audioStats = window.getMicSessionStats();
    stopMicMeter();

    const segments = recognized.segments.filter((cands) => cands.length > 0 && cands[0].text);
    if (segments.length === 0) {
      status.innerText = '音声が聞き取れませんでした。もう一度お話しください。';
      updatePipelineStage('音声を確認できませんでした。もう一度お試しください。');
      return;
    }

    // 誤認識の補正（辞書＋候補の選び直し）
    const result = correctTranscript(segments);
    const normalizedTranscript = normalizeSpeechTranscript(removeFillers(result.text));

    if (!normalizedTranscript) {
      status.innerText = '音声が聞き取れませんでした。もう一度お話しください。';
      updatePipelineStage('音声を確認できませんでした。もう一度お試しください。');
      return;
    }

    inputText.value = normalizedTranscript;
    inputText.dispatchEvent(new Event('input', { bubbles: true }));
    updatePipelineStage('ステップ 2/3: AIで内容と声を解析しています');
    status.innerText = `認識した内容: 「${normalizedTranscript}」`;

    let analysis = '';
    let analysisStatus = 'failed';
    let audioAnalysisStatus = shouldAnalyzeAudioFeatures(audioStats) ? 'failed' : 'unavailable';
    const geminiDeadlineAt = Date.now() + GEMINI_ANALYSIS_TIMEOUT_MS;
    let audioAnalysis = '';
    // Both requests get the full time budget instead of audio receiving only
    // whatever remains after text analysis.
    await Promise.all([
      analyzeSpeechText(normalizedTranscript, geminiDeadlineAt).then(text => {
        analysis = text;
        analysisStatus = 'success';
      }).catch(error => console.warn('音声解析エラー:', error)),
      shouldAnalyzeAudioFeatures(audioStats)
        ? analyzeAudioFeatures(audioStats, geminiDeadlineAt).then(text => {
          audioAnalysis = text;
          audioAnalysisStatus = 'success';
        }).catch(error => console.warn('音響特徴量解析エラー:', error))
        : Promise.resolve(),
    ]);

    updatePipelineStage('ステップ 3/3: モンスターを生成しています');
    await generateMonster(analysis || normalizedTranscript, audioAnalysis, {
      analysisStatus, audioAnalysisStatus, inputMode: 'voice',
    });
  } catch (error) {
    status.innerText = error.message || '音声認識中にエラーが発生しました。';
    updatePipelineStage('音声認識中にエラーが発生しました。');
  } finally {
    window.stopMicVolumeCollection();
    stopMicMeter();
  }
}

// イベント　リスナー
const voiceBtn = document.getElementById('voice-btn');
const generateBtn = document.getElementById('generate-btn');
const monsterEl = document.getElementById('monster');
const replayBtn = document.getElementById('replay-btn');
let inputBusy = false;
async function runInputAction(useVoice) {
  if (inputBusy) return;
  const input = getElement('input-text');
  const error = getElement('input-error');
  if (!useVoice && !input.value.trim()) {
    error.textContent = '今の気持ちをひとこと入力してください。入力例も使えます。';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  inputBusy = true;
  error.textContent = '';
  const activeButton = useVoice ? voiceBtn : generateBtn;
  const originalMarkup = activeButton.innerHTML;
  const controls = document.querySelectorAll('#input-screen button, #input-screen textarea, #input-screen input, #back-to-modes');
  const disabledStates = Array.from(controls, (control) => control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  getElement('input-screen').setAttribute('aria-busy', 'true');
  activeButton.textContent = useVoice ? '音声入力中…' : 'モンスターを準備中…';
  try {
    if (useVoice) {
      await startRecognition();
    } else {
      updatePipelineStage('モンスターを準備しています…');
      await generateMonster();
    }
  } catch (err) {
    error.textContent = 'うまく準備できませんでした。もう一度お試しください。';
    updatePipelineStage('');
  } finally {
    inputBusy = false;
    controls.forEach((control, index) => { control.disabled = disabledStates[index]; });
    // Voice collection closes the microphone on completion.
    if (useVoice) {
      stopMicMeter();
      getElement('mic-start-btn').disabled = false;
      getElement('mic-calibrate-btn').disabled = true;
    }
    activeButton.innerHTML = originalMarkup;
    getElement('input-screen').removeAttribute('aria-busy');
  }
}
if (voiceBtn) voiceBtn.addEventListener('click', () => runInputAction(true));
if (generateBtn) generateBtn.addEventListener('click', () => runInputAction(false));
if (monsterEl) monsterEl.addEventListener('click', attackMonster);
const attackButton = document.getElementById('attack-button');
if (attackButton) attackButton.addEventListener('click', attackMonster);
if (replayBtn) replayBtn.addEventListener('click', resetToInputScreen);

window.addEventListener('beforeunload', () => {
  if (typeof stopPhoneSensors === 'function') stopPhoneSensors();
});

if (document.getElementById('battle-screen') && typeof initializeBattlePage === 'function') {
  initializeBattlePage();
}
