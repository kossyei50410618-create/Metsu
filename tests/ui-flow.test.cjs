const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

// Exercise the actual scripts with a small DOM adapter, without network or hardware.
function app(page, saved = null) {
  const markup = fs.readFileSync(path.join(root, page), 'utf8');
  const elements = new Map();
  for (const match of markup.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const [, tag, id] = match;
    const element = {
      tagName: tag.toUpperCase(), value: '', textContent: '', innerText: '',
      disabled: /\bdisabled\b/.test(match[0]), style: {}, attributes: {}, listeners: {},
      setAttribute(k, v) { this.attributes[k] = String(v); },
      removeAttribute(k) { delete this.attributes[k]; },
      addEventListener(k, fn) { this.listeners[k] = fn; },
      dispatchEvent(e) { this.listeners[e.type]?.(e); },
      focus() { this.focused = true; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 230, height: 285 }; },
    };
    element.classList = {
      add(name) {
        const classes = new Set((element.className || '').split(/\s+/).filter(Boolean));
        classes.add(name);
        element.className = [...classes].join(' ');
      },
      remove(name) {
        element.className = (element.className || '')
          .split(/\s+/)
          .filter(className => className && className !== name)
          .join(' ');
      },
      contains(name) {
        return (element.className || '').split(/\s+/).includes(name);
      },
    };
    elements.set(id, element);
  }
  const timers = [];
  const state = new Map(saved ? [['metsuBattleData', JSON.stringify(saved)]] : []);
  const document = {
    addEventListener() { },
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: (selector) => selector.includes('#input-screen')
      ? [...elements.values()].filter(e => ['BUTTON', 'TEXTAREA', 'INPUT'].includes(e.tagName)) : [],
    body: { style: {}, children: [], appendChild(element) { this.children.push(element); } },
    createElement: () => ({
      style: { setProperty(name, value) { this[name] = value; } },
      children: [],
      appendChild(element) { this.children.push(element); },
      setAttribute(name, value) { this[name] = String(value); },
      remove() { },
    }),
    createElementNS: (_namespace, tagName) => ({
      tagName,
      attributes: {},
      children: [],
      classList: { names: [], add(name) { this.names.push(name); } },
      appendChild(element) { this.children.push(element); },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      remove() { },
    }),
  };
  const context = vm.createContext({
    document, console, navigator: {}, location: { hostname: 'localhost' },
    SECRETS: { SPEECH_API_KEY: 'test-only', AUDIO_API_KEY: 'test-only' },
    AbortController,
    sessionStorage: { getItem: k => state.get(k) || null, setItem: (k, v) => state.set(k, v), removeItem: k => state.delete(k) },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() { },
    setInterval() { return 1; }, clearInterval() { }, Event: class { constructor(type) { this.type = type; } },
    alert() { throw Error('Unexpected alert'); },
    fetch() { throw Error('Unexpected network request'); },
  });
  context.window = { location: { href: page }, innerWidth: 1280, innerHeight: 800, addEventListener() { }, removeEventListener() { } };
  for (const [, source] of markup.matchAll(/<script(?: type="module")? src="([^"]+)"/g)) {
    // Audio has its own widget/DOM requirements and is outside this flow adapter.
    if (['audio.js', 'account.js', 'lobby.js'].includes(source)) continue;
    // Initialize explicitly below, after all modules are loaded.
    let code = fs.readFileSync(path.join(root, source), 'utf8');
    if (source === 'script.js') code = code.replace("import { SECRETS } from './api.js';", '').replace('  initializeBattlePage();', '  /* initialized by test */');
    vm.runInContext(code, context, { filename: source });
  }
  return { context, elements, state, timers, run: code => vm.runInContext(code, context) };
}

test('empty input shows inline feedback and does not reuse an old battle', async () => {
  const a = app('index.html', { rawText: 'old input' });
  await a.run('runInputAction(false)');
  assert.equal(a.elements.get('input-text').attributes['aria-invalid'], 'true');
  assert.equal(a.elements.get('input-text').focused, true);
  assert.ok(a.elements.get('input-error').textContent.length);
  assert.equal(a.context.window.location.href, 'index.html');
});

test('text entry reaches battle with a categorized monster', async () => {
  const a = app('index.html');
  a.elements.get('input-text').value = '勉強も課題もテストも多すぎる';
  await a.run('runInputAction(false)');
  assert.equal(a.context.window.location.href, 'battle.html');
  assert.equal(JSON.parse(a.state.get('metsuBattleData')).queue[0].monster, 'study');
  assert.equal(a.elements.get('generate-btn').disabled, false);
});

test('positive utterances select the small S sprite form', async () => {
  const a = app('index.html');
  assert.equal(a.run("getMonsterFormFromText('ありがとうで心が軽くなりました')"), 's');
  assert.equal(await a.run("generateMonsterImage('normal', getMonsterFormFromText('ありがとうで心が軽くなりました'))"), 'assets/normal_s.png');
});

test('unknown categories use the normal sprite image instead of fallback and keep fallback only for real missing monsters', async () => {
  const a = app('index.html');
  assert.equal(await a.run("generateMonsterImage('normal', 'ex')"), 'assets/normal_ex.png');
  assert.equal(await a.run("generateMonsterImage('missing')"), 'assets/monster-fallback.svg');
  assert.ok(fs.statSync(path.join(root, 'assets/monster-fallback.svg')).size > 0);
});

test('typing and voice transcript updates do not classify or reveal a monster', () => {
  const a = app('index.html');
  a.run('classifyCategory = () => { throw new Error("Premature classification"); }; classifyCategoryWithVectors = classifyCategory;');
  a.elements.get('input-text').value = '勉強も課題もテストも多すぎる';
  a.elements.get('input-text').listeners.input();
  assert.equal(a.elements.get('character-count').textContent, `${Array.from(a.elements.get('input-text').value).length} 文字`);
  a.run("document.getElementById('input-text').dispatchEvent(new Event('input', { bubbles: true }));");
  assert.equal(a.elements.has('preview-monster'), false);
  assert.equal(a.elements.has('preview-heading'), false);
  assert.equal(a.state.has('metsuBattleData'), false);
  a.elements.get('input-text').value = '';
  a.run('refreshInputFeedback()');
  assert.equal(a.elements.get('character-count').textContent, '0 文字');
});

test('failed generation restores controls with a retry message', async () => {
  const a = app('index.html');
  a.elements.get('input-text').value = 'test';
  a.run('generateMonster = async () => { throw new Error("storage unavailable"); }');
  await a.run('runInputAction(false)');
  assert.ok(a.elements.get('input-error').textContent.length);
  assert.equal(a.elements.get('generate-btn').disabled, false);
  assert.equal(a.elements.get('input-text').disabled, false);
});

test('rate-limit errors do not retry repeatedly', async () => {
  const a = app('index.html');
  a.run(`
    attemptCount = 0;
    fetch = async () => {
      attemptCount += 1;
      return {
        ok: false,
        status: 429,
        async text() { return 'rate limit'; },
      };
    };
  `);
  await assert.rejects(
    () => a.run('generateResponse("prompt", "message")'),
    /rate limit|429/
  );
  assert.equal(a.run('attemptCount'), 1);
});

test('text analysis uses the same-origin proxy without browser credentials', async () => {
  const a = app('index.html');
  a.run(`
    sentRequest = null;
    fetch = async (url, options) => {
      sentRequest = { url, options };
      return { ok: true, json: async () => ({ text: '仕事に対する怒り。' }) };
    };
  `);
  assert.equal(await a.run('analyzeSpeechText("仕事がつらい")'), '仕事に対する怒り。');
  const sent = a.run('sentRequest');
  assert.equal(sent.url, '/api/analyze');
  assert.equal(sent.options.headers['X-Metsu-Request'], '1');
  assert.deepEqual(JSON.parse(sent.options.body), { kind: 'speech', input: '仕事がつらい' });
});

test('slang and colloquial variants participate in category rules', () => {
  const a = app('index.html');
  const result = a.run('classifyCategory("空気読めないやつがウザくてしんどい")');
  assert.equal(result.key, 'human');
});

test('money distress wording stays in the money category instead of slipping into health', () => {
  const a = app('index.html');
  const result = a.run('classifyCategory("お金や経済的な不安・不足に対する怒りやストレス")');
  assert.equal(result.key, 'money');
});

test('unsupported voice input leaves text entry available', async () => {
  const a = app('index.html');
  await a.run('runInputAction(true)');
  assert.ok(a.elements.get('mic-status').innerText.length);
  assert.equal(a.elements.get('generate-btn').disabled, false);
  assert.equal(a.elements.get('mic-calibrate-btn').disabled, true);
});

test('mic diagnostics remain available inside a collapsed disclosure', () => {
  const markup = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(markup, /<details class="mic-settings">/);
  assert.match(markup, /id="mic-tone-frequency"/);
  assert.match(markup, /id="mic-intonation-value"/);
});

test('voice recognition starts synchronously and remains usable when acoustic capture fails', async () => {
  const a = app('index.html');
  a.run(`
    let recognition;
    navigator.mediaDevices = { getUserMedia() { throw Error('Duplicate capture'); } };
    window.SpeechRecognition = class {
      constructor() { recognition = this; }
      start() { this.started = true; this.onstart(); }
      stop() {}
    };
  `);
  const pending = a.run('runInputAction(true)');
  assert.equal(a.run('recognition.started'), true);
  a.run("recognition.onerror({ error: 'not-allowed' });");
  await pending;
  assert.match(a.elements.get('mic-status').innerText, /許可/);
  assert.equal(a.elements.get('voice-btn').disabled, false);
});

test('empty recognition and browser abort are not reported as user cancellation', async () => {
  for (const reason of ['no-speech', 'aborted', 'network', 'audio-capture']) {
    const a = app('index.html');
    a.context.reason = reason;
    a.run(`window.SpeechRecognition = class {
      start() { this.onstart(); this.onerror({ error: reason }); }
      stop() {}
    };`);
    await a.run('runInputAction(true)');
    assert.doesNotMatch(a.elements.get('pipeline-stage').innerText, /キャンセル/);
    assert.ok(a.elements.get('mic-status').innerText.length);
    assert.equal(a.elements.get('input-text').disabled, false);
  }
});

test('recognized words reach generation even without diagnostic volume', async () => {
  const a = app('index.html');
  a.run(`
    CONFIG.CONFIRM_MODE = 'never';
    analyzeSpeechText = async () => '';
    sleep = async () => {};
    let generated = false;
    generateMonster = async () => { generated = true; };
    window.SpeechRecognition = class {
      start() {
        this.onstart();
        const result = [{ transcript: '仕事がつらい', confidence: 0.95 }];
        result.isFinal = true;
        this.onresult({ resultIndex: 0, results: [result] });
        this.onend();
      }
      stop() {}
    };
  `);
  await a.run('runInputAction(true)');
  assert.equal(a.elements.get('input-text').value, '仕事がつらい');
  assert.equal(a.run('generated'), true);
});

test('battle auto-checks motion permission and denial keeps tap attacks available', async () => {
  const a = app('battle.html', { rawText: 'test', queue: [{ key: 'normal', monster: 'normal' }] });
  a.run(`
    let permissionChecks = 0;
    window.isSecureContext = true;
    window.DeviceMotionEvent = { requestPermission() {
      permissionChecks++;
      return Promise.resolve('denied');
    } };
  `);
  await a.run('initializeBattlePage()');
  assert.equal(a.run('permissionChecks'), 1);
  assert.equal(a.run('motionReader.running'), false);
  assert.equal(a.elements.has('sensor-start-btn'), false);
  assert.equal(a.elements.get('attack-ready').hidden, true);
  const hp = a.run('hp');
  a.elements.get('monster').listeners.click({ type: 'click' });
  assert.ok(a.run('hp') < hp);
});

test('battle HP, repeated clicks, queue transition and replay work', async () => {
  const a = app('battle.html', {
    rawText: '勉強と仕事', category: { key: 'study', label: '勉強', monster: 'study' },
    queue: [{ key: 'study', label: '勉強', monster: 'study' }, { key: 'career', label: '仕事', monster: 'career' }],
    queueIndex: 0, monsterForm: 'normal',
  });
  await a.run('initializeBattlePage()');
  const initialHp = a.run('hp');
  a.elements.get('monster').listeners.click({ type: 'click' });
  assert.equal(a.run('hp'), initialHp - 14);
  assert.equal(a.run('attackCount'), 1);
  a.elements.get('monster').listeners.click({ type: 'click' });
  assert.equal(a.run('hp'), initialHp - 28);
  assert.equal(a.run('attackCount'), 2);
  assert.equal(a.elements.get('hp-bar').attributes['aria-valuenow'], String(initialHp - 28));
  a.run('hp = 1; attackMonster(); attackMonster(); attackMonster();');
  assert.equal(a.run('hp'), 0);
  assert.equal(a.run('monsterQueueIndex'), 0);
  assert.equal(a.elements.get('monster').attributes['data-state'], 'defeated');
  assert.equal(a.context.document.body.children.some(element => element.className === 'defeat-effects-layer'), false);
  assert.equal(a.context.document.body.children.some(element => element.className === 'image-shard'), false);
  assert.equal(a.elements.get('monster').classList.contains('monster-dissolving'), false);
  for (let step = 0; step < 4 && a.run('monsterQueueIndex') === 0; step++) {
    for (const fn of a.timers.splice(0)) await fn();
  }
  assert.equal(a.run('monsterQueueIndex'), 1);
  assert.ok(a.run('hp') > 0);
  assert.equal(a.elements.get('monster').attributes['data-state'], undefined);
  assert.equal(a.elements.get('monster').attributes['aria-hidden'], undefined);
  assert.equal(a.elements.get('monster').classList.contains('monster-dissolving'), false);
  assert.equal(a.elements.get('monster').disabled, false);
  assert.equal(a.elements.get('monster-img').src, 'assets/career.png');
  a.run('hp = 1; attackMonster();');
  assert.ok(a.context.document.body.children.some(element => element.className === 'defeat-effects-layer'));
  assert.notEqual(a.context.window.location.href, 'result.html');
  for (let step = 0; step < 4 && a.context.window.location.href !== 'result.html'; step++) {
    for (const fn of a.timers.splice(0)) await fn();
  }
  assert.equal(a.context.window.location.href, 'result.html');
  const result = app('result.html', { rawText: 'old' });
  result.elements.get('replay-btn').listeners.click();
  assert.equal(result.context.window.location.href, 'index.html');
  assert.equal(result.state.has('metsuBattleData'), false);
});

test('defeating a monster scatters image shards across the viewport', async () => {
  const a = app('battle.html', {
    rawText: '勉強', category: { key: 'study', label: '勉強', monster: 'study' },
    queue: [{ key: 'study', label: '勉強', monster: 'study' }],
    queueIndex: 0, monsterForm: 'normal',
  });
  a.elements.get('monster-img').src = 'assets/study.png';
  a.run("getElement = id => document.getElementById(id); const effectsLayer = playDefeatCelebration(); playMonsterDissolve(() => {}, effectsLayer)");

  const effectsLayer = a.context.document.body.children.find(element => element.className === 'defeat-effects-layer');
  const shards = effectsLayer.children.filter(element => element.className === 'image-shard');
  assert.equal(shards.length, 18 * 24);
  assert.ok(shards.every(shard => shard.style.backgroundImage.includes('assets/study.png')));
  assert.ok(shards.some(shard => parseFloat(shard.style['--scatter-x']) < 0));
  assert.ok(shards.some(shard => parseFloat(shard.style['--scatter-x']) > 0));
  assert.ok(shards.some(shard => parseFloat(shard.style['--scatter-y']) < 0));
  assert.ok(shards.some(shard => parseFloat(shard.style['--scatter-y']) > 0));
  const targetX = shards.map(shard => parseFloat(shard.style.left) + parseFloat(shard.style['--scatter-x']));
  const targetY = shards.map(shard => parseFloat(shard.style.top) + parseFloat(shard.style['--scatter-y']));
  assert.ok(Math.min(...targetX) < 128);
  assert.ok(Math.max(...targetX) > 1152);
  assert.ok(Math.min(...targetY) < 80);
  assert.ok(Math.max(...targetY) > 720);
});

test('defeat celebration displays a victory banner and bursts of colorful sparks', () => {
  const a = app('battle.html');
  a.run("getElement = id => document.getElementById(id); playDefeatCelebration()");

  const effectsLayer = a.context.document.body.children.find(element => element.className === 'defeat-effects-layer');
  const banner = effectsLayer.children.find(element => element.className === 'defeat-banner');
  const title = banner.children.find(element => element.tagName === undefined && element.textContent === 'FINISH');
  const subtitle = banner.children.find(element => element.textContent === 'MISSION COMPLETE');
  const sparks = effectsLayer.children.filter(element => element.className === 'victory-spark');
  assert.ok(effectsLayer.children.some(element => element.className === 'defeat-celebration'));
  const crackOverlay = effectsLayer.children.find(element => element.classList?.names.includes('screen-crack-overlay'));
  assert.ok(crackOverlay);
  assert.ok(crackOverlay.children.length >= 32);
  assert.ok(crackOverlay.children.every(path => path.attributes.d.startsWith('M ')));
  assert.equal(title.textContent, 'FINISH');
  assert.equal(subtitle.textContent, 'MISSION COMPLETE');
  assert.equal(sparks.length, 48);
  assert.ok(sparks.every(spark => ['var(--cyan)', 'var(--purple)', 'var(--monster-accent)'].includes(spark.style['--spark-color'])));
  assert.ok(sparks.some(spark => parseFloat(spark.style['--spark-x']) < 0));
  assert.ok(sparks.some(spark => parseFloat(spark.style['--spark-x']) > 0));
});

test('phone samples require stillness before a calibrated attack and recalibrate for the next monster', () => {
  const a = app('battle.html');
  a.run(`
    let testNow = 0; Date.now = () => testNow;
    const hitPowers = []; attackMonster = power => hitPowers.push(power);
    const normalizer = window.MetsuMotion.createNormalizer();
    const still = { accelerationIncludingGravity: {x:0,y:0,z:9.80665},
      acceleration: {x:0,y:0,z:0}, rotationRate: {alpha:0,beta:0,gamma:0} };
    const hit = { accelerationIncludingGravity: {x:9.80665,y:0,z:9.80665},
      acceleration: {x:9.80665,y:0,z:0}, rotationRate: {alpha:0,beta:90,gamma:0} };
    startSensorAttackDetection();
    handleSensorSample(normalizer.read(hit));
  `);
  assert.equal(a.run('hitPowers.length'), 0);
  assert.equal(a.run('sensorAttackEnabled'), false);
  a.run(`handleSensorSample(normalizer.read(still));
    testNow=100; handleSensorSample(normalizer.read(still));
    testNow=1600; handleSensorSample(normalizer.read(still));`);
  assert.equal(a.run('sensorAttackEnabled'), true);
  assert.equal(a.elements.get('attack-ready').hidden, false);
  a.run('testNow=1700; handleSensorSample(normalizer.read(hit));');
  assert.equal(a.run('hitPowers.length'), 1);
  assert.equal(a.run('hitPowers[0]'), 1.25);
  a.run('stopSensorAttackDetection(); handleSensorSample(normalizer.read(hit));');
  assert.equal(a.run('hitPowers.length'), 1);
  a.run('startSensorAttackDetection(); handleSensorSample(normalizer.read(hit));');
  assert.equal(a.run('sensorAttackEnabled'), false);
  assert.equal(a.run('hitPowers.length'), 1);
});

test('result page renders stored battle result details', () => {
  const r = app('result.html');
  r.state.set('metsuResultData', JSON.stringify({
    category: '勉強',
    elapsedMs: 1234,
    attackCount: 3,
    totalDamageDealt: 54,
    maxSingleDamage: 20,
    maxVolume: 0.8,
    avgTone: 220,
    avgToneLabel: '中',
    monsterForm: 's',
    rawText: 'テスト結果',
    analysisText: 'テスト結果の解析',
  }));
  r.run('renderResultScreen()');
  assert.equal(r.elements.get('reset-msg').innerText, '『勉強』を討伐した！');
  assert.equal(r.elements.get('result-time').innerText, '1.23秒');
  assert.equal(r.elements.get('result-total-damage').innerText, '54');
  assert.equal(r.elements.get('result-avg-damage').innerText, '18');
  assert.equal(r.elements.has('result-source-text'), false);
  assert.equal(r.elements.get('result-text-analysis').innerText, 'テスト結果の解析');
});

function installMicrophone(a) {
  a.run(`
    let recognition, stoppedTracks = 0, closedContexts = 0;
    let frameId = 0;
    requestAnimationFrame = () => ++frameId;
    cancelAnimationFrame = () => {};
    navigator.mediaDevices = { getUserMedia: async () => ({
      getTracks: () => [{ stop() { stoppedTracks++; } }]
    }) };
    window.AudioContext = class {
      state = 'suspended'; sampleRate = 48000;
      async resume() { this.state = 'running'; }
      async close() { this.state = 'closed'; closedContexts++; }
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() { return { getFloatTimeDomainData(data) {
        for (let i = 0; i < data.length; i++) data[i] = 0.15 * Math.sin(2 * Math.PI * 200 * i / 48000);
      } }; }
    };
    window.SpeechRecognition = class {
      constructor() { recognition = this; }
      start() { this.onstart(); }
      stop() {}
    };
    CONFIG.CONFIRM_MODE = 'never';
    sleep = async () => {};
  `);
}

test('measured microphone waveform reaches both AI requests and survives battle to guest result', async () => {
  const a = app('index.html');
  installMicrophone(a);
  a.run(`
    const aiCalls = [];
    fetch = async (_url, options) => {
      const body = JSON.parse(options.body); aiCalls.push(body);
      return { ok: true, json: async () => ({ text: body.kind === 'speech'
        ? '仕事に対する怒り。' : '・声のトーン: 落ち着いた声\\n・感情: 不満の可能性' }) };
    };
  `);
  const pending = a.run('runInputAction(true)');
  // Let getUserMedia and AudioContext.resume settle while recognition is active.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(a.run('micAudioContext.state'), 'running');
  a.run(`
    updateMicMeter(); updateMicMeter(); updateMicMeter();
    const result = [{ transcript: '仕事がつらい', confidence: 0.95 }];
    result.isFinal = true;
    recognition.onresult({ resultIndex: 0, results: [result] });
    recognition.onend();
  `);
  await pending;
  assert.equal(a.run('aiCalls.length'), 2);
  const acoustic = JSON.parse(a.run("aiCalls.find(call => call.kind === 'audio').input"));
  assert.ok(acoustic.maxVolume > 0);
  assert.ok(acoustic.avgTone >= 80 && acoustic.avgTone <= 1000);
  assert.ok(acoustic.toneSampleCount >= 3);
  assert.equal(typeof acoustic.intonation, 'number');
  assert.equal(a.run('stoppedTracks'), 1);
  assert.equal(a.run('closedContexts'), 1);
  const saved = JSON.parse(a.state.get('metsuBattleData'));
  assert.equal(saved.analysisStatus, 'success');
  assert.equal(saved.audioAnalysisStatus, 'success');
  const battle = app('battle.html', saved);
  battle.run('finalizeBattleResult()');
  const r = app('result.html');
  r.state.set('metsuResultData', battle.state.get('metsuResultData'));
  r.run(`window.MetsuAccount = { read: () => null }; renderResultScreen();`);
  assert.equal(r.elements.get('audio-analysis-panel').hidden, false);
  assert.match(r.elements.get('result-audio-analysis').innerText, /声のトーン/);
  assert.equal(r.elements.get('result-text-analysis').innerText, '仕事に対する怒り。');
  assert.equal(r.state.has('metsuResultData'), false);
});

test('microphone permission granted after stopping releases tracks without opening an audio context', async () => {
  const a = app('index.html');
  installMicrophone(a);
  a.run(`let grantMic; navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { grantMic = resolve; });`);
  const pending = a.run('initMicMeter()');
  a.run(`stopMicMeter(); grantMic({ getTracks: () => [{ stop() { stoppedTracks++; } }] });`);
  assert.equal(await pending, false);
  assert.equal(a.run('stoppedTracks'), 1);
  assert.equal(a.run('micAudioContext'), null);
});

test('result explains failed AI and unavailable voice measurements instead of hiding them', () => {
  const r = app('result.html');
  r.state.set('metsuResultData', JSON.stringify({ inputMode: 'voice', analysisStatus: 'failed',
    analysisText: 'raw fallback', audioAnalysisStatus: 'unavailable' }));
  r.run('renderResultScreen()');
  assert.equal(r.elements.get('audio-analysis-panel').hidden, false);
  assert.match(r.elements.get('result-text-analysis').innerText, /利用できなかった/);
  assert.match(r.elements.get('result-audio-analysis').innerText, /十分に測定できません/);
});

test('selected hand modes route samples through their own detector instead of the bag algorithm', () => {
  for (const mode of ['punch', 'shake']) {
    const a = app('battle.html', { rawText: 'test', mode });
    a.run(`
      let gestureTime = 0; Date.now = () => gestureTime;
      const gestureHits = []; attackMonster = power => gestureHits.push(power);
      const handSample = x => ({ accel: { x, y: 0, z: 1 }, gravity: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 0 } });
      startSensorAttackDetection();
      for (gestureTime = 0; gestureTime <= 800; gestureTime += 100) handleSensorSample(handSample(0));
      gestureTime = 900; handleSensorSample(handSample(1));
    `);
    if (mode === 'shake') {
      assert.equal(a.run('gestureHits.length'), 0);
      a.run('gestureTime = 1100; handleSensorSample(handSample(-1));');
    }
    assert.equal(a.run('gestureHits.length'), 1);
    assert.equal(a.elements.get('attack-ready').hidden, false);
  }
});

test('direct battle access without input returns home', async () => {
  const a = app('battle.html');
  await a.run('initializeBattlePage()');
  assert.equal(a.context.window.location.href, 'index.html');
});
