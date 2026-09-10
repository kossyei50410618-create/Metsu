// main.js
const CONFIG = {
  // 役割を分けるため、共通補助キーではなく専用キーを保持する
  SPEECH_API_KEY: "AQ.Ab8RN6LNvjPKhwe5_YVP6SzPACWf9nVDKLIaCDwenJcjTlftJA",
  AUDIO_API_KEY: "AQ.Ab8RN6JJ0atrf9NcSJNUbG7L1Y0W1lwyDmTdz1V6EP0OTH2cww",

  // 文字起こし後のテキスト解析に使うモデル
  SPEECH_ANALYSIS_MODEL: "gemini-3.1-flash-lite",

  // 音響特徴量（音の大きさ・周波数・抑揚）に使うモデル
  AUDIO_ANALYSIS_MODEL: "gemini-3.5-flash-lite",
  JUDGE_MODEL: "gemini-3.5-flash-lite",

  // 各種しきい値
  STATE_CONFIDENCE_THRESHOLD: 0.7,
  PATTERN_CONFIDENCE_THRESHOLD: 0.7,
  SAFETY_CONFIDENCE_THRESHOLD: 0.82,
};

function getElement(id) {
  return document.getElementById(id);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetToInputScreen() {
  sessionStorage.removeItem('metsuBattleData');
  window.location.href = 'index.html';
}

async function generateResponse(prompt, userMessage, options = {}) {
  const {
    model = CONFIG.SPEECH_ANALYSIS_MODEL,
    temperature = 0.7,
    maxOutputTokens = 800,
    apiKey = CONFIG.GEMINI_API_KEY,
  } = options;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const requestBody = {
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: { temperature, maxOutputTokens },
  };

  // 429/503 が出ても連続リトライを避け、即時に失敗させる。
  const MAX_RETRIES = 0;
  const RETRY_DELAYS = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      const data = await response.json();
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts
        ?.map((part) => part.text || '')
        .join('')
        .trim();
      if (!text) throw new Error('Gemini APIが空の解析結果を返しました。');
      if (candidate.finishReason === 'MAX_TOKENS') {
        throw new Error('Gemini APIの解析結果が途中で終了しました。');
      }
      return text;
    }

    const errorText = await response.text();
    const isRetryable = response.status === 503 || response.status === 429;

    if (isRetryable && attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt];
      console.warn(`[llm] ${response.status} エラー。${delay / 1000}秒後にリトライ...`);
      await sleep(delay);
      continue;
    }
    throw new Error(`LLM API エラー: ${errorText}`);
  }
}

async function analyzeSpeechText(transcript) {
  const apiKey = CONFIG.SPEECH_API_KEY || CONFIG.GEMINI_API_KEY;
  if (!apiKey || apiKey === "YOUR_API_KEY_HERE") throw new Error("config.js に有効な SPEECH_API_KEY を設定してください。");

  const prompt = `あなたはユーザーのストレスや怒りの音声入力を解析し、分類エンジンに渡すための要約を生成する専門AIです。
以下の発話を読み取り、悩み・怒りのテーマと感情を抽出してください。
【重要】
後の分類精度を上げるため、発話内容が以下の「対象カテゴリ」のどれに最も近いかを推測し、そのカテゴリに関連する具体的なキーワード（仕事、上司、お金、時間、健康、勉強、スマホなど）を意図的に含めて要約してください。
対象カテゴリ：対人関係、家族・生活環境、仕事・キャリア、お金・経済、健康・心身、生き方・自己実現、時間、デジタル、勉強、確率・不確実性、習慣・行動、趣味・余暇
  出力形式：「〜に対する怒り。」のような形で、完結した1文の簡潔な日本語のみを返すこと。
文の途中で止めたり、最後の語を省略したりせず、必ず「。」または「！」で終えること。`;
  const userMessage = `以下の発話を解析してください：\n${transcript}`;

  return await generateResponse(prompt, userMessage, {
    model: CONFIG.SPEECH_ANALYSIS_MODEL || CONFIG.SPEECH_ANALYSIS_MODEL,
    apiKey,
    temperature: 0.0,
    maxOutputTokens: 400,
  });
  return /[。！？!?」』]$/.test(analysis) ? analysis : transcript;
}

function shouldAnalyzeAudioFeatures(audioStats) {
  if (!audioStats || !audioStats.toneSampleCount || audioStats.toneSampleCount < 3) return false;
  if (!Number.isFinite(audioStats.maxVolume) || audioStats.maxVolume <= 0) return false;
  return true;
}

async function analyzeAudioFeatures(audioStats) {
  if (!shouldAnalyzeAudioFeatures(audioStats)) return '';

  const apiKey = CONFIG.AUDIO_API_KEY || CONFIG.GEMINI_API_KEY;
  if (!apiKey || apiKey === "YOUR_API_KEY_HERE") throw new Error("config.js に有効な AUDIO_API_KEY を設定してください。");

  const prompt = `あなたは音の大きさ・周波数・抑揚から話者の状態を分析するAIです。
以下の音声特徴量から想定される内容を、日本語で短く説明してください。
出力は必ず次の2項目だけを箇条書きにしてください。
・声のトーン: 数値から想定される声のトーン
・感情: 数値から想定される感情
太字などのMarkdown記法は使わず、** を含めないでください。`;

  const userMessage = `以下の音声特徴量を解析してください:\n${JSON.stringify(audioStats, null, 2)}`;

  const analysis = await generateResponse(prompt, userMessage, {
    model: CONFIG.AUDIO_ANALYSIS_MODEL || CONFIG.SPEECH_ANALYSIS_MODEL,
    apiKey,
    temperature: 0.0,
    maxOutputTokens: 120,
  });
  return analysis.replace(/\*\*/g, '');
}

function normalizeSpeechTranscript(transcript) {
  if (typeof transcript !== 'string') return '';
  return transcript.replace(/\s+/g, '');
}

function isSpeechRecognitionSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

async function requestMicrophonePermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (error) {
    return false;
  }
}

async function listen() {
  return new Promise((resolve, reject) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      reject(new Error("このブラウザは音声認識に対応していません。Chrome または Edge をお試しください。"));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";
    let resolved = false;
    let timeoutId = null;

    recognition.onstart = () => {
      window.startMicVolumeCollection();
    };

    recognition.onresult = (event) => {
      const lastResult = event.results[event.results.length - 1];
      if (lastResult.isFinal) {
        finalTranscript = lastResult[0].transcript;
        cleanup();
        resolve(finalTranscript);
      }
    };

    recognition.onerror = (event) => {
      window.stopMicVolumeCollection();
      cleanup();
      if (event.error === "no-speech" || event.error === "aborted") {
        resolve("");
      } else {
        reject(new Error(`音声認識エラー: ${event.error}`));
      }
    };

    recognition.onend = () => {
      window.stopMicVolumeCollection();
      if (!resolved) {
        cleanup();
        resolve(finalTranscript || "");
      }
    };

    function cleanup() {
      resolved = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }

    timeoutId = setTimeout(() => {
      if (!resolved) {
        try { recognition.stop(); } catch (e) { }
        window.stopMicVolumeCollection();
        cleanup();
        if (finalTranscript) {
          resolve(finalTranscript);
        } else {
          reject(new Error("音声認識がタイムアウトしました。短く話してください。"));
        }
      }
    }, 10000);

    try {
      recognition.start();
    } catch (e) {
      cleanup();
      reject(new Error(`音声認識の開始に失敗: ${e.message}`));
    }
  });
}

function updatePipelineStage(message) {
  const stage = document.getElementById('pipeline-stage');
  if (stage) stage.innerText = message;
}

async function startRecognition() {
  const status = document.getElementById('mic-status') || document.getElementById('status-text');
  const inputText = document.getElementById('input-text');

  if (!status || !inputText) return;
  if (!isSpeechRecognitionSupported()) {
    status.innerText = 'お使いのブラウザは音声認識に対応していません。Chrome または Edge をお試しください。';
    updatePipelineStage('音声認識非対応');
    return;
  }

  const hasMicAccess = await requestMicrophonePermission();
  if (!hasMicAccess) {
    status.innerText = 'マイクのアクセス許可が必要です。ブラウザの設定を確認してください。';
    updatePipelineStage('マイク許可が拒否されました');
    return;
  }

  updatePipelineStage('ステップ 1/4: 音声をテキスト化しています');
  status.innerText = '録音中... 話してください。';

  try {
    const transcript = await listen();
    const normalizedTranscript = normalizeSpeechTranscript(transcript);
    window.stopMicVolumeCollection();
    if (!normalizedTranscript) {
      status.innerText = '音声入力がキャンセルされました。';
      updatePipelineStage('音声入力がキャンセルされました。');
      return;
    }

    stopMicMeter();
    inputText.value = normalizedTranscript;
    inputText.dispatchEvent(new Event('input', { bubbles: true }));
    updatePipelineStage('ステップ 2/4: テキスト解析を行っています');
    status.innerText = '認識完了。解析中...';

    let analysis = '';
    try {
      analysis = await analyzeSpeechText(normalizedTranscript);
      status.innerText = `認識完了: ${normalizedTranscript}`;
    } catch (error) {
      console.warn('音声解析エラー:', error);
      status.innerText = `認識完了: ${normalizedTranscript}`;
    }

    let audioAnalysis = '';
    try {
      const audioStats = typeof window.getMicSessionStats === 'function'
        ? window.getMicSessionStats()
        : null;
      if (shouldAnalyzeAudioFeatures(audioStats)) {
        audioAnalysis = await analyzeAudioFeatures(audioStats);
      }
    } catch (error) {
      console.warn('音響特徴量解析エラー:', error);
    }

    updatePipelineStage('ステップ 3/4: モンスターを生成しています');
    status.innerText = '認識完了。少し待ってから出現します...';
    await sleep(1200);
    await generateMonster(analysis || normalizedTranscript, audioAnalysis);
    updatePipelineStage('ステップ 4/4: モンスター討伐へ');
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
  const controls = document.querySelectorAll('#input-screen button, #input-screen textarea, #input-screen input');
  const disabledStates = Array.from(controls, (control) => control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  getElement('input-screen').setAttribute('aria-busy', 'true');
  activeButton.textContent = useVoice ? '音声入力中…' : 'モンスターを準備中…';
  try {
    if (useVoice) {
      await initMicMeter();
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
  if (typeof disconnectZigSim === 'function') disconnectZigSim();
});

if (document.getElementById('battle-screen') && typeof initializeBattlePage === 'function') {
  initializeBattlePage();
}
