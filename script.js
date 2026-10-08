// 役割を分けるため、共通補助キーではなく専用キーを保持する
import { SECRETS } from './api.js';

const CONFIG = {   //api.keyから値読み取る
  SPEECH_API_KEY: SECRETS.SPEECH_API_KEY,
  AUDIO_API_KEY: SECRETS.AUDIO_API_KEY,

  // 文字起こし後のテキスト解析に使うモデル
  SPEECH_ANALYSIS_MODEL: "gemini-3.1-flash-lite",

  // 音響特徴量（音の大きさ・周波数・抑揚）に使うモデル
  AUDIO_ANALYSIS_MODEL: "gemini-3.5-flash-lite",
  JUDGE_MODEL: "gemini-3.5-flash-lite",

  // 各種しきい値
  STATE_CONFIDENCE_THRESHOLD: 0.7,
  PATTERN_CONFIDENCE_THRESHOLD: 0.7,
  SAFETY_CONFIDENCE_THRESHOLD: 0.82,

  // 【追加】音声認識の精度向上用の設定
  CONFIRM_MODE: 'uncertain',  // 認識結果の確認画面: 'always'=毎回 / 'uncertain'=自信が低いときだけ / 'never'=出さない
  CONFIRM_CONFIDENCE: 0.8,    // これ未満（または信頼度不明）のとき確認画面を出す
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
// ・学習辞書: 確認画面でユーザーが直した内容を localStorage に保存して自動で使う
// ==============================
const LEARNED_DICT_KEY = 'speechLearnedCorrections';

function loadLearnedDict() {
  try {
    return JSON.parse(localStorage.getItem(LEARNED_DICT_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveLearnedDict(dict) {
  try {
    // 肥大化を防ぐため新しい200件までに制限
    const entries = Object.entries(dict).slice(-200);
    localStorage.setItem(LEARNED_DICT_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (e) { /* 保存できなくても動作は続ける */ }
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

// 「認識結果 → ユーザーが直した文」の差分から、置き換えペアを学習する
function learnCorrection(original, confirmed) {
  const a = normalizeSpeechTranscript(original);
  const b = normalizeSpeechTranscript(confirmed);
  if (!a || !b || a === b) return;

  // 先頭と末尾の共通部分を除き、違う部分だけを取り出す
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;

  const wrong = a.slice(p, a.length - q);
  const right = b.slice(p, b.length - q);

  // 短すぎる（誤爆しやすい）／長すぎる（文全体の書き換え）ものは学習しない
  if (wrong.length < 2 || wrong.length > 10 || right.length < 1 || right.length > 10) return;

  const dict = loadLearnedDict();
  delete dict[wrong]; // 新しいものを末尾に
  dict[wrong] = right;
  saveLearnedDict(dict);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetToInputScreen(event) {
  event?.preventDefault();
  sessionStorage.removeItem('metsuBattleData');
  window.location.href = 'index.html';
}

async function generateResponse(prompt, userMessage, options = {}) {
  const {
    model = CONFIG.SPEECH_ANALYSIS_MODEL,
    temperature = 0.7,
    maxOutputTokens = 800,
    apiKey = CONFIG.SPEECH_API_KEY,   // 【修正】未定義の GEMINI_API_KEY をやめる
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
  const apiKey = CONFIG.SPEECH_API_KEY;
  if (!apiKey || apiKey === "YOUR_API_KEY_HERE") throw new Error("config.js に有効な SPEECH_API_KEY を設定してください。");

  const prompt = `あなたはユーザーのストレスや怒りの音声入力を解析し、分類エンジンに渡すための要約を生成する専門AIです。
以下の発話を読み取り、悩み・怒りのテーマと感情を抽出してください。
【重要】
後の分類精度を上げるため、発話内容が以下の「対象カテゴリ」のどれに最も近いかを推測し、そのカテゴリに関連する具体的なキーワード（仕事、上司、お金、時間、健康、勉強、スマホなど）を意図的に含めて要約してください。
対象カテゴリ：対人関係、家族・生活環境、仕事・キャリア、お金・経済、健康・心身、生き方・自己実現、時間、デジタル、勉強、確率・不確実性、習慣・行動、趣味・余暇
  出力形式：「〜に対する怒り。」のような形で、完結した1文の簡潔な日本語のみを返すこと。
文の途中で止めたり、最後の語を省略したりせず、必ず「。」または「！」で終えること。`;
  const userMessage = `以下の発話を解析してください：\n${transcript}`;

  // 【修正】到達しないコードを直し、analysis を正しく受け取る
  const analysis = await generateResponse(prompt, userMessage, {
    model: CONFIG.SPEECH_ANALYSIS_MODEL,
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

  const apiKey = CONFIG.AUDIO_API_KEY;
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

async function requestMicrophonePermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
  try {
    // 【修正】mic.js と同じノイズ抑制設定で権限を取得する
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: window.MIC_AUDIO_CONSTRAINTS || true,
    });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (error) {
    return false;
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
      if (event.error === "no-speech" || event.error === "aborted") {
        finish();
      } else {
        fail(new Error(`音声認識エラー: ${event.error}`));
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

// 確認画面に出す「もしかして」候補（最大 MAX_ALTERNATIVES 件）を作る
function buildAlternatives(segments, best) {
  const list = [best];
  const maxAlt = Math.max(...segments.map((c) => c.length));
  for (let k = 0; k < maxAlt; k++) {
    const joined = segments.map((c) => (c[k] || c[0]).text).join('');
    const text = normalizeSpeechTranscript(removeFillers(applyCorrectionDict(joined)));
    if (text && !list.includes(text)) list.push(text);
  }
  return list.slice(0, CONFIG.MAX_ALTERNATIVES);
}

// ==============================
// 認識結果の確認画面
// 候補をタップして選ぶ／入力欄で直接直す／やり直す
// 戻り値: 確定した文字列 ／ やり直しなら null
// ==============================
function confirmTranscript(anchor, options) {
  return new Promise((resolve) => {
    if (!anchor) { resolve(options[0]); return; }

    const panel = document.createElement('div');
    panel.id = 'transcript-confirm';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', '認識結果の確認');
    panel.style.cssText = 'margin:12px 0;padding:12px;border:1px solid #888;border-radius:8px;';

    const label = document.createElement('p');
    label.textContent = 'こう聞こえました。違う場合は候補を選ぶか、直接直してください。';
    label.style.margin = '0 0 8px';
    panel.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = options[0];
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:8px;margin-bottom:8px;';
    input.setAttribute('aria-label', '認識結果（編集できます）');

    if (options.length > 1) {
      const chips = document.createElement('div');
      chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;';
      options.forEach((opt) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = opt;
        chip.style.cssText = 'padding:6px 10px;border-radius:16px;cursor:pointer;';
        chip.addEventListener('click', () => { input.value = opt; input.focus(); });
        chips.appendChild(chip);
      });
      panel.appendChild(chips);
    }
    panel.appendChild(input);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = 'この内容で決定';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.textContent = 'やり直す';
    actions.append(okBtn, retryBtn);
    panel.appendChild(actions);

    function done(value) {
      panel.remove();
      resolve(value);
    }
    okBtn.addEventListener('click', () => done(input.value.trim() || null));
    retryBtn.addEventListener('click', () => done(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim() || null); }
    });

    anchor.insertAdjacentElement('afterend', panel);
    input.focus();
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
    const recognized = await listen(true, (heard) => {
      status.innerText = `録音中... 「${heard}」`;
    });
    window.stopMicVolumeCollection();

    // 音響特徴量はマイクを止める前に取得しておく
    const audioStats = typeof window.getMicSessionStats === 'function'
      ? window.getMicSessionStats()
      : null;

    const segments = recognized.segments.filter((cands) => cands.length > 0 && cands[0].text);
    if (segments.length === 0) {
      status.innerText = '音声が聞き取れませんでした。もう一度お話しください。';
      updatePipelineStage('音声入力がキャンセルされました。');
      return;
    }

    // 【追加】声が小さすぎる／雑音だけの場合は、誤認識を避けるため聞き返す
    if (
      audioStats &&
      Number.isFinite(audioStats.maxVolume) &&
      audioStats.maxVolume < CONFIG.MIN_SPEECH_VOLUME
    ) {
      status.innerText = '声がよく聞き取れませんでした。マイクに近づいて、もう少し大きな声でお話しください。';
      updatePipelineStage('音声入力がキャンセルされました。');
      return;
    }

    // 誤認識の補正（辞書＋候補の選び直し）
    updatePipelineStage('ステップ 1.5/4: 認識結果を確認しています');
    const result = correctTranscript(segments);
    let normalizedTranscript = normalizeSpeechTranscript(removeFillers(result.text));

    if (!normalizedTranscript) {
      status.innerText = '音声が聞き取れませんでした。もう一度お話しください。';
      updatePipelineStage('音声入力がキャンセルされました。');
      return;
    }

    // 【追加】自信が低い（または信頼度不明）ときは、確認画面で選ぶ／直す
    const needConfirm =
      CONFIG.CONFIRM_MODE === 'always' ||
      (CONFIG.CONFIRM_MODE === 'uncertain' &&
        (result.confidence === null || result.confidence < CONFIG.CONFIRM_CONFIDENCE));

    if (needConfirm) {
      updatePipelineStage('ステップ 1.8/4: 認識結果を確認してください');
      status.innerText = '聞き取り結果を確認してください。';
      const options = buildAlternatives(segments, normalizedTranscript);
      const confirmed = await confirmTranscript(status, options);

      if (confirmed === null) {
        status.innerText = 'やり直す場合は、もう一度音声ボタンを押してください。';
        updatePipelineStage('音声入力がキャンセルされました。');
        return;
      }

      // 直した内容を学習して、次回以降の補正に使う
      learnCorrection(normalizedTranscript, confirmed);
      normalizedTranscript = normalizeSpeechTranscript(confirmed);
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