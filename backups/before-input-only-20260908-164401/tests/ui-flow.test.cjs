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
    body: { style: {}, appendChild() {} },
    createElement: () => ({ style: {}, remove() {} }),
  };
  const context = vm.createContext({
    document, console, navigator: {}, location: { hostname: 'localhost' },
    sessionStorage: { getItem: k => state.get(k) || null, setItem: (k,v) => state.set(k,v), removeItem: k => state.delete(k) },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    setInterval() { return 1; }, clearInterval() {}, Event: class { constructor(type) { this.type = type; } },
    alert() { throw Error('Unexpected alert'); },
    fetch() { throw Error('Unexpected network request'); },
  });
  context.window = { location: { href: page }, addEventListener() {} };
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

test('unknown categories use a nonempty fallback image', async () => {
  const a = app('index.html');
  assert.equal(await a.run("generateMonsterImage('normal', 'ex')"), 'assets/monster-fallback.svg');
  assert.equal(await a.run("generateMonsterImage('missing')"), 'assets/monster-fallback.svg');
  assert.ok(fs.statSync(path.join(root, 'assets/monster-fallback.svg')).size > 0);
});

test('lobby preview follows input and resets when cleared', () => {
  const a = app('index.html');
  a.elements.get('input-text').value = '勉強も課題もテストも多すぎる';
  a.run('refreshInputFeedback()');
  assert.equal(a.elements.get('preview-monster').src, 'assets/study.png');
  assert.equal(a.elements.get('preview-heading').textContent, 'TARGET PREVIEW');
  a.elements.get('input-text').value = '';
  a.run('refreshInputFeedback()');
  assert.equal(a.elements.get('preview-monster').src, 'assets/human.png');
  assert.equal(a.elements.get('preview-heading').textContent, 'MONSTER ARCHIVE');
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

test('unsupported voice input leaves text entry available', async () => {
  const a = app('index.html');
  await a.run('runInputAction(true)');
  assert.ok(a.elements.get('mic-status').innerText.length);
  assert.equal(a.elements.get('generate-btn').disabled, false);
  assert.equal(a.elements.get('mic-calibrate-btn').disabled, true);
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

test('direct battle access without input returns home', async () => {
  const a = app('battle.html');
  await a.run('initializeBattlePage()');
  assert.equal(a.context.window.location.href, 'index.html');
});
