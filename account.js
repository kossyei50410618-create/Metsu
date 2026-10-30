// Shared account/session boundary. Guest battles never enter the history outbox.
(function (root) {
  const read = (key, fallback = null) => { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  let user = null;
  let backend = true;
  async function api(path, method = 'GET', body) {
    let response;
    try {
      response = await fetch(`/api/${path}`, { method, credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Metsu-Request': '1' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    } catch { throw new Error('サーバーに接続できません。接続を確認してもう一度お試しください。'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('アカウント機能はMetsuサーバーで利用できます。ゲストで遊ぶこともできます。'); }
    if (!response.ok) throw new Error(data.error || '処理できませんでした。');
    return data;
  }
  function clearPlay() {
    ['metsuBattleData', 'metsuResultData', 'metsuPlaySetup', 'metsuPendingHistory', 'metsuSavedHistory'].forEach(key => sessionStorage.removeItem(key));
  }
  const ready = (async () => {
    if (sessionStorage.getItem('metsuGuest') === 'true') return null;
    try { user = (await api('me')).user; } catch { backend = false; }
    return user;
  })();
  let flushing = null;
  async function flushHistory() {
    if (flushing) return flushing;
    flushing = (async () => {
      await ready;
      if (sessionStorage.getItem('metsuGuest') === 'true') return;
      const current = (await api('me')).user;
      const pending = read('metsuPendingHistory', []);
      if (!current && pending.length) throw new Error('記録を保存するには、同じアカウントでログインし直してください。');
      while (read('metsuPendingHistory', []).length) {
        const item = read('metsuPendingHistory', [])[0];
        if (item.ownerId !== current?.id) throw new Error('別のアカウントの未保存記録があります。元のアカウントでログインしてください。');
        await api('history', 'POST', item);
        sessionStorage.setItem('metsuSavedHistory', JSON.stringify([...read('metsuSavedHistory', []), item.id].slice(-200)));
        // Read again: another monster may have completed while the request ran.
        sessionStorage.setItem('metsuPendingHistory', JSON.stringify(read('metsuPendingHistory', []).filter(x => x.id !== item.id)));
      }
    })();
    try { await flushing; } finally { flushing = null; }
  }
  function recordBattle(result, battle) {
    if (!battle.ownerId || sessionStorage.getItem('metsuGuest') === 'true') return;
    const record = {
      id: `${battle.runId}_${battle.queueIndex || 0}`, runId: battle.runId, ownerId: battle.ownerId,
      startedAt: battle.startedAt, endedAt: new Date().toISOString(),
      category: result.category, monster: result.monsterType, form: result.monsterForm,
      mode: battle.mode || 'bag', stress: battle.stress ?? null,
      elapsedMs: Math.min(86400000, Math.max(0, Math.round(result.elapsedMs))),
      attacks: result.attackCount, damage: result.totalDamageDealt,
    };
    const pending = read('metsuPendingHistory', []);
    if (!pending.some(x => x.id === record.id)) pending.push(record);
    sessionStorage.setItem('metsuPendingHistory', JSON.stringify(pending));
    // Result page retries any request interrupted by navigation.
    flushHistory().catch(() => {});
  }
  root.MetsuAccount = {
    ready, api, read, flushHistory, recordBattle,
    get user() { return user; }, get backend() { return backend; },
    get guest() { return !user || sessionStorage.getItem('metsuGuest') === 'true'; },
    async authenticate(kind, credentials) {
      const next = (await api(kind, 'POST', credentials)).user;
      const pending = read('metsuPendingHistory', []).filter(x => x.ownerId === next.id);
      clearPlay();
      sessionStorage.setItem('metsuPendingHistory', JSON.stringify(pending));
      sessionStorage.removeItem('metsuGuest'); user = next; backend = true;
      return user;
    },
    async leave(guest = false) {
      // Logout must succeed if the server session was authenticated.
      if (user) await api('logout', 'POST', {});
      user = null; clearPlay();
      if (guest) sessionStorage.setItem('metsuGuest', 'true');
      else sessionStorage.removeItem('metsuGuest');
    },
    setup(mode, stress) {
      const setup = { mode, stress: user ? stress : null, ownerId: user?.id || null };
      sessionStorage.setItem('metsuPlaySetup', JSON.stringify(setup));
      return setup;
    },
    newRun() {
      const setup = read('metsuPlaySetup', { mode: 'bag', stress: null, ownerId: null });
      const runId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      return { ...setup, runId, startedAt: new Date().toISOString() };
    },
  };
})(window);
