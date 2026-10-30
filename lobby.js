(async function () {
  const account = window.MetsuAccount;
  const $ = id => document.getElementById(id);
  const names = { punch: '手で動かす · パンチ', shake: '手で動かす · シェイク', bag: 'パンチングバッグ' };
  let authKind = 'login', trend = [], nextOffset = null, busy = false;
  function show(screen) {
    ['welcome-screen', 'dashboard-screen', 'input-screen'].forEach(id => { $(id).hidden = id !== screen; });
    $('input-navigation').hidden = screen !== 'input-screen';
    $('account-status').textContent = '';
  }
  function node(tag, text, className) {
    const el = document.createElement(tag); if (text !== undefined) el.textContent = text;
    if (className) el.className = className; return el;
  }
  function duration(ms) {
    return ms < 60000 ? `${Math.round(ms / 1000)}秒` : `${Math.floor(ms / 60000)}分${Math.floor(ms / 1000) % 60}秒`;
  }
  function drawTrend() {
    const days = Number($('history-range').value), cutoff = Date.now() - days * 86400000;
    const groups = new Map();
    for (const item of trend) {
      if (item.stress === null || (days && Date.parse(item.started_at) < cutoff)) continue;
      const date = new Date(item.started_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const group = groups.get(key) || { sum: 0, count: 0 };
      group.sum += item.stress; group.count++; groups.set(key, group);
    }
    const entries = [...groups].sort(([a], [b]) => a.localeCompare(b));
    $('stress-trend').replaceChildren();
    if (!entries.length) { $('stress-insight').textContent = 'まだ記録がありません。プレイを終えると、ここで振り返れます。'; return; }
    const peak = entries.reduce((best, item) => item[1].sum / item[1].count > best[1].sum / best[1].count ? item : best);
    $('stress-insight').textContent = `自己評価が最も高かった日：${peak[0]}（平均 ${(peak[1].sum / peak[1].count).toFixed(1)} / 5）`;
    for (const [date, value] of entries) {
      const mean = value.sum / value.count;
      const column = node('div', undefined, 'trend-column');
      column.setAttribute('aria-label', `${date}: 平均${mean.toFixed(1)}、${value.count}プレイ`);
      const bar = node('div', undefined, 'trend-bar'); bar.style.height = `${mean * 20}%`;
      const track = node('div', undefined, 'trend-track'); track.append(bar);
      column.append(node('span', mean.toFixed(1)), track, node('small', date.slice(5).replace('-', '/')));
      $('stress-trend').append(column);
    }
  }
  function appendHistory(rows) {
    for (const row of rows) {
      const item = node('li', undefined, 'history-item');
      const img = document.createElement('img');
      // API constrains monster/form to allowlisted asset names.
      img.src = `assets/${row.monster}${row.form === 'normal' ? '' : '_' + row.form}.png`;
      img.alt = `${row.category}のモンスター`; img.width = 56; img.height = 70; img.loading = 'lazy';
      const content = node('div');
      content.append(node('strong', row.category), node('span', new Date(row.ended_at).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })),
        node('small', `${names[row.mode]} · ${duration(row.elapsed_ms)} · ${row.form.toUpperCase()}`));
      item.append(img, content); $('history-list').append(item);
    }
  }
  async function history(more = false) {
    if (!account.user || busy) return;
    busy = true; $('history-status').textContent = '記録を読み込んでいます…';
    $('more-history').disabled = true;
    try {
      await account.flushHistory();
      const data = await account.api(`history?offset=${more ? nextOffset || 0 : 0}`);
      if (!more) $('history-list').replaceChildren();
      appendHistory(data.rows);
      nextOffset = data.nextOffset; $('more-history').hidden = nextOffset === null;
      $('history-games').textContent = data.stats.games;
      $('history-monsters').textContent = data.stats.monsters;
      $('history-time').textContent = duration(data.stats.elapsed_ms);
      trend = data.trend; drawTrend();
      $('history-status').textContent = data.stats.monsters ? '' : '最初のモンスターを倒して、記録をはじめよう。';
    } catch (error) { $('history-status').textContent = error.message; }
    finally { busy = false; $('more-history').disabled = false; }
  }
  function dashboard() {
    if (account.guest) {
      sessionStorage.removeItem('metsuBattleData');
      sessionStorage.removeItem('metsuResultData');
    }
    show('dashboard-screen');
    $('identity-label').textContent = account.user ? `${account.user.username} さん` : 'ゲストモード';
    $('leave-btn').textContent = account.user ? 'ログアウト' : '入口に戻る';
    $('history-panel').hidden = !account.user;
    $('stress-control').hidden = !account.user;
    if (account.user) history();
  }
  async function action(button, fn, target = 'account-status') {
    button.disabled = true;
    try { await fn(); } catch (error) { $(target).textContent = error.message; }
    finally { button.disabled = false; }
  }
  $('guest-btn').addEventListener('click', event => action(event.currentTarget, async () => { await account.leave(true); dashboard(); }));
  for (const kind of ['login', 'register']) $('show-' + kind).addEventListener('click', () => {
    authKind = kind; $('auth-form').hidden = false; $('auth-error').textContent = '';
    $('auth-title').textContent = $('auth-submit').textContent = kind === 'login' ? 'ログイン' : 'アカウントを作成';
    $('password').autocomplete = kind === 'login' ? 'current-password' : 'new-password';
    $('password').value = ''; $('username').focus();
  });
  $('auth-form').addEventListener('submit', event => {
    event.preventDefault(); $('auth-error').textContent = '';
    action($('auth-submit'), async () => {
      await account.authenticate(authKind, { username: $('username').value, password: $('password').value });
      $('password').value = ''; dashboard();
    }, 'auth-error');
  });
  $('leave-btn').addEventListener('click', event => action(event.currentTarget, async () => {
    if (account.read('metsuPendingHistory', []).length && !window.confirm('未保存の記録は破棄されます。ログアウトしますか？')) return;
    await account.leave(); $('history-list').replaceChildren(); $('stress-trend').replaceChildren(); show('welcome-screen');
  }));
  $('refresh-history').addEventListener('click', () => history());
  $('more-history').addEventListener('click', () => history(true));
  $('history-range').addEventListener('change', drawTrend);
  $('delete-history').addEventListener('click', () => { $('delete-confirm').hidden = false; });
  $('cancel-delete').addEventListener('click', () => { $('delete-confirm').hidden = true; });
  $('confirm-delete').addEventListener('click', event => action(event.currentTarget, async () => {
    await account.flushHistory(); await account.api('history', 'DELETE', {});
    $('delete-confirm').hidden = true; await history();
  }, 'history-status'));
  document.querySelectorAll('input[name="play-style"]').forEach(el => el.addEventListener('change', () => {
    const bag = document.querySelector('input[name="play-style"]:checked').value === 'bag';
    $('hand-modes').hidden = bag;
    $('mode-help').textContent = bag ? 'スマホをバッグに確実に固定し、静止してから始めてください。これまでと同じ揺れ・傾きの判定を使います。タップでも遊べます。' : 'スマホをしっかり持ち、周囲に物や人がいない場所で軽く動かしてください。タップでも遊べます。';
  }));
  $('stress-level').addEventListener('input', () => { $('stress-value').textContent = `${$('stress-level').value} / 5`; });
  $('choose-mode').addEventListener('click', event => {
    const style = document.querySelector('input[name="play-style"]:checked').value;
    const mode = style === 'bag' ? 'bag' : document.querySelector('input[name="hand-mode"]:checked').value;
    // iOS needs the request inside a user gesture. Refusal never blocks play.
    let permission = Promise.resolve();
    if (window.isSecureContext && typeof window.DeviceMotionEvent?.requestPermission === 'function') {
      try { permission = window.DeviceMotionEvent.requestPermission(); } catch { /* tap fallback */ }
    }
    action(event.currentTarget, async () => {
      $('mode-status').textContent = '準備しています…';
      await permission.catch(() => {});
      account.setup(mode, Number($('stress-level').value));
      $('selected-mode-label').textContent = names[mode]; show('input-screen');
      $('mode-status').textContent = ''; $('input-text').focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 'mode-status');
  });
  $('back-to-modes').addEventListener('click', () => { if (typeof stopMicMeter === 'function') stopMicMeter(); dashboard(); });
  await account.ready;
  if (account.user || sessionStorage.getItem('metsuGuest') === 'true') dashboard();
  else {
    show('welcome-screen');
    if (!account.backend) $('account-status').textContent = 'アカウントサーバーに接続できません。ゲストで遊べます。';
  }
})();
