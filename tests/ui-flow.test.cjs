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
    elements.set(id, {
      tagName: tag.toUpperCase(), value: '', textContent: '', innerText: '',
      disabled: /\bdisabled\b/.test(match[0]), style: {}, attributes: {}, listeners: {},
      setAttribute(k, v) { this.attributes[k] = String(v); },
      removeAttribute(k) { delete this.attributes[k]; },
      addEventListener(k, fn) { this.listeners[k] = fn; },
      dispatchEvent(e) { this.listeners[e.type]?.(e); },
      focus() { this.focused = true; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 230, height: 285 }; },
    });
  }
  const timers = [];
  const state = new Map(saved ? [['metsuBattleData', JSON.stringify(saved)]] : []);
  const document = {
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: (selector) => selector.includes('#input-screen')
      ? [...elements.values()].filter(e => ['BUTTON', 'TEXTAREA', 'INPUT'].includes(e.tagName)) : [],
    body: { style: {}, appendChild() { } },
    createElement: () => ({ style: {}, remove() { } }),
  };
  const context = vm.createContext({
    document, console, navigator: {}, location: { hostname: 'localhost' },
    sessionStorage: { getItem: k => state.get(k) || null, setItem: (k, v) => state.set(k, v), removeItem: k => state.delete(k) },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() { },
    setInterval() { return 1; }, clearInterval() { }, Event: class { constructor(type) { this.type = type; } },
    alert() { throw Error('Unexpected alert'); },
    fetch() { throw Error('Unexpected network request'); },
  });
  context.window = { location: { href: page }, addEventListener() { } };
  for (const [, source] of markup.matchAll(/<script src="([^"]+)"/g)) {
    // Initialize explicitly below, after all modules are loaded.
    let code = fs.readFileSync(path.join(root, source), 'utf8');
    if (source === 'script.js') code = code.replace('  initializeBattlePage();', '  /* initialized by test */');
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

test('index page exposes the mic diagnostic panel at load time', () => {
  const markup = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(markup, /<details class="mic-settings" open>/);
  assert.match(markup, /id="mic-tone-frequency"/);
  assert.match(markup, /id="mic-intonation-value"/);
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
  assert.equal(a.run('hp'), initialHp - 18);
  assert.equal(a.elements.get('attack-count').textContent, '01');
  a.elements.get('attack-button').listeners.click({ type: 'click' });
  assert.equal(a.run('hp'), initialHp - 36);
  assert.equal(a.elements.get('attack-count').textContent, '02');
  assert.equal(a.elements.get('hp-bar').attributes['aria-valuenow'], String(initialHp - 36));
  a.run('hp = 1; attackMonster(); attackMonster(); attackMonster();');
  assert.equal(a.run('hp'), 0);
  assert.equal(a.run('monsterQueueIndex'), 0);
  for (const fn of a.timers.splice(0)) await fn();
  assert.equal(a.run('monsterQueueIndex'), 1);
  assert.ok(a.run('hp') > 0);
  a.run('hp = 1; attackMonster();');
  assert.equal(a.context.window.location.href, 'result.html');
  const result = app('result.html', { rawText: 'old' });
  result.elements.get('replay-btn').listeners.click();
  assert.equal(result.context.window.location.href, 'index.html');
  assert.equal(result.state.has('metsuBattleData'), false);
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
  assert.equal(r.elements.get('result-attack-count').innerText, '3 回');
  assert.equal(r.elements.has('result-source-text'), false);
});

test('direct battle access without input returns home', async () => {
  const a = app('battle.html');
  await a.run('initializeBattlePage()');
  assert.equal(a.context.window.location.href, 'index.html');
});
