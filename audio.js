// audio.js — Metsu サウンドエンジン
// Web Audio API でBGMと効果音をその場で合成します(音声ファイル不要)。
// 公開API: window.MetsuAudio  { hit, defeat, summon, victory, setTension, click, startBgm, stopBgm }
(function () {
  'use strict';

  // ==============================
  // 設定(音量・ミュートは localStorage に保存)
  // ==============================
  const STORE_KEY = 'metsuAudioSettings';
  const settings = { muted: false, bgm: 0.6, sfx: 0.8 };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) { }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { }
  }

  let ctx = null;
  let master, bgmIn, bgmBus, sfxBus, punchBus, echoIn, noiseBuf;
  let micHold = false;      // 音声入力中はBGM・効果音を止める(マイクが拾わないように)
  let tension = 0;          // 0:通常 1:HP50%未満 2:HP25%未満
  let autoSuspended = false;
  let lockedAtDown = false;
  const pending = [];       // 音声ロック解除待ちの処理

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const rand = (a, b) => a + Math.random() * (b - a);

  // ==============================
  // AudioContext 初期化
  // ==============================
  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 20;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;

    master = ctx.createGain();
    bgmIn = ctx.createGain();   // ダッキング(一時的に小さくする)用
    bgmBus = ctx.createGain();  // BGM音量
    sfxBus = ctx.createGain();  // 効果音音量
    bgmIn.connect(bgmBus);
    bgmBus.connect(master);
    sfxBus.connect(master);
    // 打撃音用: 軽く歪ませて「ガツン」と太くする
    punchBus = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh(2.4 * (i / 512 - 1)) / Math.tanh(2.4);
    punchBus.curve = curve;
    punchBus.oversample = '2x';
    punchBus.connect(sfxBus);
    master.connect(comp);
    comp.connect(ctx.destination);

    // BGM用のエコー(アルペジオに奥行きを出す)
    echoIn = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.36;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2400;
    echoIn.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(wet);
    wet.connect(bgmIn);

    // ノイズ素材(爆発・スネア・ハイハットなどで使い回す)
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    applyVolumes();
    ctx.onstatechange = onState;
    return ctx;
  }

  function applyVolumes() {
    if (!ctx) return;
    const now = ctx.currentTime;
    master.gain.setTargetAtTime(settings.muted ? 0 : 1, now, 0.05);
    bgmBus.gain.setTargetAtTime(settings.bgm * 0.32, now, 0.05);
    sfxBus.gain.setTargetAtTime(settings.sfx * 1.7, now, 0.05);
  }

  function isRunning() { return !!ctx && ctx.state === 'running'; }
  function canPlay() { return isRunning() && !settings.muted && !micHold; }

  // 音が出せる状態になったら実行する(古すぎる効果音は捨てる)
  function whenRunning(fn, persist) {
    if (isRunning()) { fn(); return; }
    pending.push({ fn, persist: !!persist, ts: Date.now() });
  }
  function flushPending() {
    while (pending.length) {
      const item = pending.shift();
      if (item.persist || Date.now() - item.ts < 8000) {
        try { item.fn(); } catch (e) { console.warn('[audio]', e); }
      }
    }
  }
  function onState() {
    updateWidget();
    if (isRunning()) flushPending();
  }

  function tryUnlock() {
    const c = ensureCtx();
    if (!c || c.state === 'running' || document.hidden) return;
    c.resume().then(onState).catch(() => { });
  }

  // ==============================
  // 合成ヘルパー
  // ==============================
  function tone(type, freq, t, dur, o) {
    o = o || {};
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + dur);
    if (o.detune) osc.detune.value = o.detune;

    const peak = o.gain != null ? o.gain : 0.2;
    const atk = o.attack != null ? o.attack : 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    if (o.sustain) {
      const rel = Math.min(o.release != null ? o.release : 0.3, dur - atk);
      g.gain.setValueAtTime(peak, t + dur - rel);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lp, t);
      if (o.lpTo) f.frequency.exponentialRampToValueAtTime(o.lpTo, t + dur * 0.7);
      osc.connect(f);
      f.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(o.dest || sfxBus);
    if (o.echo) g.connect(echoIn);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(t, dur, o) {
    o = o || {};
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.f0 || 2000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    f.Q.value = o.q || 0.7;
    const g = ctx.createGain();
    const peak = o.gain != null ? o.gain : 0.3;
    const atk = o.attack != null ? o.attack : 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(o.dest || sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  // 効果音の間だけBGMを一瞬へこませる(攻撃のインパクトが際立つ)
  function duckBgm(level, seconds) {
    if (!ctx || micHold) return;
    const now = ctx.currentTime;
    bgmIn.gain.cancelScheduledValues(now);
    bgmIn.gain.setTargetAtTime(level, now, 0.015);
    bgmIn.gain.setTargetAtTime(1, now + seconds, 0.25);
  }

  // ==============================
  // 効果音
  // ==============================
  function click() {
    if (!canPlay()) return;
    const t = ctx.currentTime;
    tone('square', 1320, t, 0.04, { gain: 0.07, lp: 3200 });
    tone('sine', 1980, t + 0.03, 0.07, { gain: 0.14 });
  }

  // 「討伐開始」ボタン: 力がたまっていくチャージ音
  function charge() {
    if (!canPlay()) return;
    const t = ctx.currentTime;
    tone('sawtooth', 160, t, 0.75, { gain: 0.16, to: 1400, lp: 1800, attack: 0.1 });
    tone('sine', 80, t, 0.75, { gain: 0.35, to: 400, attack: 0.1 });
    noise(t, 0.7, { type: 'bandpass', f0: 400, f1: 4000, q: 1.2, gain: 0.18, attack: 0.3 });
    tone('sine', 1760, t + 0.7, 0.2, { gain: 0.18, echo: true });
  }

  // センサー攻撃可能になった合図
  function ready() {
    if (!canPlay()) return;
    const t = ctx.currentTime;
    tone('triangle', 1320, t, 0.12, { gain: 0.2 });
    tone('triangle', 1760, t + 0.1, 0.18, { gain: 0.2 });
  }

  // モンスター出現
  function summonNow() {
    if (!canPlay()) return;
    const t = ctx.currentTime + 0.02;
    // 地鳴りのような上昇ドローン
    tone('sine', 60, t, 1.2, { gain: 0.5, to: 200, attack: 0.5 });
    tone('sawtooth', 55, t, 1.2, { gain: 0.12, to: 150, lp: 600, attack: 0.5 });
    // せり上がる風のスウィープ
    noise(t, 1.1, { type: 'bandpass', f0: 300, f1: 3200, q: 1.3, gain: 0.3, attack: 0.9 });
    // 出現の衝撃とうなり声
    const hit = t + 1.1;
    tone('sine', 110, hit, 0.5, { gain: 0.9, to: 36 });
    noise(hit, 0.35, { type: 'lowpass', f0: 2500, f1: 150, gain: 0.5 });
    tone('sawtooth', 70, hit, 0.8, { gain: 0.22, to: 42, lp: 500, attack: 0.05 });
    // きらめくアルペジオ
    [57, 60, 64, 69, 72, 76].forEach((m, i) => {
      tone('triangle', mtof(m), t + 0.7 + i * 0.07, 0.35, { gain: 0.1, echo: true });
    });
    duckBgm(0.35, 1.6);
  }
  function summon() { whenRunning(summonNow); }

  // 攻撃ヒット: 「ドン!」と殴る重い打撃音（無効化）
  function hit(power, finishing) {
    // 打撃音を鳴らさないため、すぐに処理を終了します
    return;
  }

  // 撃破: 特大の「ドォン」＋ガラスが砕ける音＋重いスティンガー
  function defeat(hasNext) {
    if (!canPlay()) return;
    const t = ctx.currentTime + 0.03;

    // 爆発
    noise(t, 1.3, { type: 'lowpass', f0: 5000, f1: 80, gain: 0.8 });
    tone('sine', 130, t, 1.1, { gain: 1.0, to: 28, dest: punchBus });
    tone('sine', 190, t, 0.3, { gain: 0.9, to: 50, dest: punchBus });
    noise(t, 0.06, { type: 'highpass', f0: 1800, gain: 0.6, dest: punchBus });
    noise(t + 0.02, 0.18, { type: 'highpass', f0: 3500, gain: 0.35 });

    // 画面が割れる音(鋭い破片のノイズ)
    for (let i = 0; i < 10; i++) {
      noise(t + 0.08 + Math.random() * 0.55, 0.05, { type: 'highpass', f0: rand(5000, 9000), gain: 0.12 });
    }

    // 重く歪んだパワーコード(Em)のスティンガー
    const len = hasNext ? 0.7 : 1.4;
    [40, 47, 52, 59].forEach((m) => {
      [-9, 9].forEach((dt) => tone('sawtooth', mtof(m), t + 0.1, len, {
        gain: 0.09, lp: 2200, lpTo: 400, attack: 0.01, detune: dt, dest: punchBus,
      }));
    });

    duckBgm(0.12, 1.4);
    if (!hasNext) stopBgm(1.6);   // 最後の敵なら BGM をフェードアウトして結果画面へ
  }

  // 結果画面: 映画の予告編のような重厚なインパクト音(ランクで厚みが変わる)
  function victoryNow(rank) {
    if (!canPlay()) return;
    const t = ctx.currentTime + 0.05;
    const k = { S: 1.15, A: 1, B: 0.9, C: 0.8 }[rank] || 0.9;
    const hitAt = t + 0.5;

    // 0) 溜め: 上がっていくライザー
    noise(t, 0.5, { type: 'bandpass', f0: 300, f1: 5000, q: 1.4, gain: 0.3, attack: 0.45 });
    tone('sawtooth', 80, t, 0.5, { gain: 0.1, to: 320, lp: 1500, attack: 0.4 });

    // 1) 衝撃: 「ズドン」という超低音と爆風
    tone('sine', 120, hitAt, 1.3, { gain: 1.1 * k, to: 26, dest: punchBus });
    tone('sine', 180, hitAt, 0.3, { gain: 0.9 * k, to: 45, dest: punchBus });
    noise(hitAt, 1.0, { type: 'lowpass', f0: 3200, f1: 100, gain: 0.6 * k, dest: punchBus });
    noise(hitAt, 0.04, { type: 'highpass', f0: 1800, gain: 0.55 * k, dest: punchBus });
    noise(hitAt, 0.5, { type: 'bandpass', f0: 6000, f1: 900, q: 0.8, gain: 0.2 * k });   // 空気を切り裂くスウッシュ

    // 2) 重く歪んだ「ブワーム」(Em のパワーコード。ゆっくりフィルターが閉じる)
    [40, 47, 52, 59, 64].forEach((m) => {
      [-10, 10].forEach((dt) => tone('sawtooth', mtof(m), hitAt, 2.2, {
        gain: 0.085 * k, lp: 2400, lpTo: 380, attack: 0.02, detune: dt, dest: punchBus,
      }));
    });

    // 3) 追撃の低音(予告編のようなリズム)
    tone('sine', 95, hitAt + 0.5, 0.6, { gain: 0.6 * k, to: 34, dest: punchBus });
    noise(hitAt + 0.5, 0.35, { type: 'lowpass', f0: 1800, f1: 120, gain: 0.3 * k, dest: punchBus });

    // Sランク: さらに分厚く(高音の和音と最後の特大の一撃)
    if (rank === 'S') {
      [71, 76, 83].forEach((m) => tone('sawtooth', mtof(m), hitAt + 0.05, 2.4, {
        gain: 0.04, lp: 3200, lpTo: 900, attack: 0.15, detune: 6,
      }));
      tone('sine', 100, hitAt + 1.1, 0.9, { gain: 0.9, to: 28, dest: punchBus });
      noise(hitAt + 1.1, 0.8, { type: 'lowpass', f0: 3000, f1: 100, gain: 0.5, dest: punchBus });
    }
  }
  function victory(rank) {
    whenRunning(() => victoryNow(rank));
    whenRunning(() => setTimeout(() => startBgm('result'), 3000), true);
  }

  // HPが減るほどBGMが激しくなる(percent: 残りHPの割合 0〜100)
  function setTension(percent) {
    tension = percent < 25 ? 2 : percent < 50 ? 1 : 0;
  }

  // ==============================
  // BGM(16ステップ・シーケンサー)
  // chords の r はベース音の MIDI 番号、iv は和音構成音
  // arp / lead / bass などは 16分音符 x16 のパターン(null=休符)
  // ==============================
  const THEMES = {
    // ロビー: 夜のサイバーシティのような、落ち着いたクールなグルーヴ
    lobby: {
      bpm: 88,
      chords: [{ r: 45, iv: [0, 3, 7] }, { r: 41, iv: [0, 4, 7] }, { r: 48, iv: [0, 4, 7] }, { r: 43, iv: [0, 4, 7] }],
      pad: 0.045, padLp: 900, padAtk: 1.0, padOct: 24,
      bass: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], bassType: 'sawtooth', bassGain: 0.18, bassLp: 900, bassLpTo: 200, bassLen: 2.2,
      kick: [0, 8], kickGain: 0.32, hat: [4, 12], hatGain: 0.05,
      arp: [0, null, 1, null, 2, null, 3, null, 4, null, 3, null, 2, null, 1, null],
      arpType: 'sawtooth', arpOct: 36, arpGain: 0.045, arpLp: 1500, arpLen: 1.6, arpEcho: true,
    },
    // バトル: 重低音ベースとサイドチェイン、オフビートのスタブで駆け抜けるダークなビート
    battle: {
      bpm: 140, rush: 1.08, pump: true, crashEvery: 4,
      chords: [{ r: 40, iv: [0, 3, 7] }, { r: 36, iv: [0, 4, 7] }, { r: 43, iv: [0, 4, 7] }, { r: 38, iv: [0, 4, 7] }],
      pad: 0.035, padLp: 900, padAtk: 0.05, padOct: 24,
      bass: [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 2, 0], bassType: 'sawtooth', bassGain: 0.24, bassLp: 1800, bassLpTo: 250, bassLen: 1.3,
      kick: [0, 4, 8, 12], kickGain: 0.8, clap: [4, 12],
      hat: [2, 6, 10, 14], hatGhost: [3, 11], hatGain: 0.08,
      stab: [2, 6, 10, 14],
      arp: [0, null, null, 2, null, null, 1, null, 0, null, null, 2, null, 3, null, null],
      arpType: 'sawtooth', arpOct: 36, arpGain: 0.035, arpLp: 1800, arpLen: 1.2, arpEcho: true,
      lead: [0, 2, 1, 2, 0, 2, 3, 2, 0, 2, 1, 2, 4, 3, 2, 1],
    },
    // 結果: 余韻に浸るクールなグルーヴ
    result: {
      bpm: 96,
      chords: [{ r: 45, iv: [0, 3, 7] }, { r: 41, iv: [0, 4, 7] }, { r: 48, iv: [0, 4, 7] }, { r: 43, iv: [0, 4, 7] }],
      pad: 0.05, padLp: 1100, padAtk: 1.0, padOct: 24,
      bass: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], bassType: 'sawtooth', bassGain: 0.18, bassLp: 900, bassLpTo: 200, bassLen: 2.2,
      kick: [0, 8], kickGain: 0.35, hat: [4, 12], hatGain: 0.05,
      arp: [0, null, 1, null, 2, null, 4, null, 3, null, 2, null, 1, null, 2, null],
      arpType: 'sawtooth', arpOct: 36, arpGain: 0.04, arpLp: 1800, arpLen: 1.6, arpEcho: true,
    },
  };

  const bgm = { name: null, step: 0, next: 0, timer: null, out: null, pump: null };

  function startBgm(name) {
    if (!ensureCtx() || !THEMES[name]) return;
    if (bgm.name === name && bgm.timer) return;
    stopBgm(0.4);
    bgm.name = name;
    bgm.out = ctx.createGain();
    bgm.out.gain.setValueAtTime(0.0001, ctx.currentTime);
    bgm.out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.5);
    bgm.out.connect(bgmIn);
    // 和音・シンセ類はここを通し、キックに合わせて「ズンッ」と引っ込める(サイドチェイン風)
    bgm.pump = ctx.createGain();
    bgm.pump.connect(bgm.out);
    bgm.step = 0;
    bgm.next = ctx.currentTime + 0.1;
    bgm.timer = setInterval(tick, 25);
  }

  function stopBgm(fade) {
    if (bgm.timer) { clearInterval(bgm.timer); bgm.timer = null; }
    if (bgm.out && ctx) {
      const out = bgm.out;
      const now = ctx.currentTime;
      const f = Math.max(0.05, fade || 0.5);
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), now);
      out.gain.exponentialRampToValueAtTime(0.0001, now + f);
      setTimeout(() => { try { out.disconnect(); } catch (e) { } }, (f + 4) * 1000);
    }
    bgm.out = null;
    bgm.pump = null;
    bgm.name = null;
  }

  function tick() {
    if (!ctx || !bgm.name || ctx.state !== 'running') {
      if (ctx && bgm.name) bgm.next = Math.max(bgm.next, ctx.currentTime); // 停止中に溜まらないように
      return;
    }
    const th = THEMES[bgm.name];
    const bpm = th.bpm * (tension >= 2 && th.rush ? th.rush : 1);
    const spb = 60 / bpm / 4; // 16分音符の長さ
    if (bgm.next < ctx.currentTime - 0.5) bgm.next = ctx.currentTime + 0.05;
    while (bgm.next < ctx.currentTime + 0.15) {
      playStep(th, bgm.step, bgm.next, spb, bgm.out, bgm.pump);
      bgm.next += spb;
      bgm.step += 1;
    }
  }

  function playStep(th, s, t, spb, out, mel) {
    const pos = s % 16;
    const bar = Math.floor(s / 16);
    const ch = th.chords[bar % th.chords.length];
    const tones = ch.iv.concat(ch.iv.map((x) => x + 12));

    // 4小節ごとにクラッシュで景色を変える
    if (th.crashEvery && pos === 0 && bar % th.crashEvery === 0) {
      noise(t, 0.9, { type: 'highpass', f0: 5500, f1: 3000, gain: 0.1, attack: 0.005, dest: out });
    }

    if (th.pad && pos === 0) {
      ch.iv.forEach((iv) => {
        const f = mtof(ch.r + th.padOct + iv);
        [-7, 7].forEach((dt) => tone('sawtooth', f, t, spb * 16 * 1.02, {
          gain: th.pad, lp: th.padLp, attack: th.padAtk, sustain: true, release: 0.5, detune: dt, dest: mel,
        }));
      });
    }

    // ベース: フィルターが閉じていく「ウォン」という唸り
    if (th.bass && th.bass[pos]) {
      const m = ch.r + (th.bass[pos] === 2 ? 12 : 0);
      tone(th.bassType, mtof(m), t, spb * th.bassLen, { gain: th.bassGain, lp: th.bassLp, lpTo: th.bassLpTo, dest: out });
    }

    // キック: 低音の本体＋アタックのクリック
    if (th.kick && th.kick.indexOf(pos) >= 0) {
      tone('sine', 165, t, 0.2, { gain: th.kickGain || 0.75, to: 44, dest: out });
      noise(t, 0.02, { type: 'highpass', f0: 2500, gain: 0.12 * (th.kickGain || 0.75), dest: out });
      if (th.pump) {
        mel.gain.cancelScheduledValues(t);
        mel.gain.setValueAtTime(0.35, t);
        mel.gain.linearRampToValueAtTime(1, t + spb * 3.2);
      }
      if (tension >= 2 && th.pump && pos % 8 === 0) tone('sine', 165, t + spb * 2, 0.14, { gain: 0.4, to: 44, dest: out });
    }

    // クラップ(2拍・4拍)
    if (th.clap && th.clap.indexOf(pos) >= 0) {
      [0, 0.012, 0.024].forEach((d) => noise(t + d, 0.05, { type: 'bandpass', f0: 1400, q: 0.8, gain: 0.2, dest: out }));
      noise(t + 0.03, 0.16, { type: 'bandpass', f0: 1200, q: 0.8, gain: 0.22, dest: out });
      tone('triangle', 200, t, 0.1, { gain: 0.12, to: 130, dest: out });
    }

    if (th.hat) {
      const gain = th.hatGain || 0.08;
      const accent = tension >= 2 ? true : tension >= 1 ? pos % 2 === 0 : th.hat.indexOf(pos) >= 0;
      const ghost = !accent && th.hatGhost && th.hatGhost.indexOf(pos) >= 0;
      if (accent || ghost) {
        const open = th.clap && (pos === 6 || pos === 14);
        noise(t, open ? 0.12 : 0.04, {
          type: 'highpass', f0: 7000, gain: ghost || (tension >= 2 && pos % 2) ? gain * 0.5 : gain, dest: out,
        });
      }
    }

    // オフビートのシンセスタブ(ベースの上でキレを出す)
    if (th.stab && th.stab.indexOf(pos) >= 0) {
      ch.iv.forEach((iv) => {
        const f = mtof(ch.r + 36 + iv);
        [-8, 8].forEach((dt) => tone('sawtooth', f, t, spb * 1.6, {
          gain: 0.03, lp: 2600, lpTo: 900, detune: dt, attack: 0.002, dest: mel,
        }));
      });
    }

    const ai = th.arp ? th.arp[pos] : null;
    if (ai != null) {
      tone(th.arpType, mtof(ch.r + th.arpOct + tones[ai % tones.length]), t, spb * th.arpLen, {
        gain: th.arpGain, lp: th.arpLp, dest: mel, echo: th.arpEcho,
      });
    }

    // HPが減ったら高音のリードが加わる
    if (th.lead && tension >= 1) {
      const li = th.lead[pos];
      tone('square', mtof(ch.r + 36 + tones[li % tones.length]), t, spb * 0.9, {
        gain: tension >= 2 ? 0.055 : 0.04, lp: 3000, dest: mel, echo: true,
      });
    }
  }

  // ==============================
  // 画面右下のサウンド設定ウィジェット
  // ==============================
  let widget = null;

  function buildWidget() {
    const style = document.createElement('style');
    style.textContent = `
#metsu-audio{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:9999;display:flex;flex-direction:row-reverse;align-items:center;gap:10px;font:12px/1.3 system-ui,"Hiragino Sans","Yu Gothic",sans-serif;color:#dff6ff}
#metsu-audio .ma-toggle{width:46px;height:46px;border-radius:50%;border:1px solid rgba(120,220,255,.55);background:rgba(8,11,25,.88);color:inherit;font-size:19px;cursor:pointer;box-shadow:0 0 14px rgba(80,200,255,.25)}
#metsu-audio .ma-toggle:focus-visible{outline:2px solid #7ee8ff;outline-offset:2px}
#metsu-audio.locked .ma-toggle{animation:ma-pulse 1.4s ease-in-out infinite}
#metsu-audio .ma-hint{display:none;padding:6px 10px;border-radius:10px;background:rgba(8,11,25,.9);border:1px solid rgba(120,220,255,.35)}
#metsu-audio.locked .ma-hint{display:block}
#metsu-audio .ma-panel{display:none;flex-direction:column;gap:8px;padding:10px 14px;border-radius:12px;background:rgba(8,11,25,.92);border:1px solid rgba(120,220,255,.3)}
#metsu-audio:hover:not(.locked) .ma-panel,#metsu-audio:focus-within:not(.locked) .ma-panel{display:flex}
#metsu-audio label{display:flex;align-items:center;gap:8px;justify-content:space-between}
#metsu-audio input[type=range]{width:110px;accent-color:#5fd8ff}
@keyframes ma-pulse{0%,100%{box-shadow:0 0 0 0 rgba(95,216,255,.55)}50%{box-shadow:0 0 0 10px rgba(95,216,255,0)}}
@media (prefers-reduced-motion:reduce){#metsu-audio.locked .ma-toggle{animation:none}}`;
    document.head.appendChild(style);

    widget = document.createElement('div');
    widget.id = 'metsu-audio';
    widget.innerHTML = `
<button type="button" class="ma-toggle" aria-label="サウンドのオン/オフ" aria-pressed="false">🔊</button>
<span class="ma-hint" role="status">タップで音を出す</span>
<div class="ma-panel">
  <label>BGM <input type="range" id="metsu-bgm-vol" min="0" max="1" step="0.05" aria-label="BGM音量"></label>
  <label>効果音 <input type="range" id="metsu-sfx-vol" min="0" max="1" step="0.05" aria-label="効果音の音量"></label>
</div>`;
    document.body.appendChild(widget);

    const toggle = widget.querySelector('.ma-toggle');
    const bgmSlider = widget.querySelector('#metsu-bgm-vol');
    const sfxSlider = widget.querySelector('#metsu-sfx-vol');
    bgmSlider.value = settings.bgm;
    sfxSlider.value = settings.sfx;

    const markLocked = () => { lockedAtDown = !isRunning(); };
    toggle.addEventListener('pointerdown', markLocked);
    toggle.addEventListener('keydown', markLocked);
    toggle.addEventListener('click', () => {
      if (lockedAtDown) { lockedAtDown = false; tryUnlock(); return; } // 初回タップは音を有効にするだけ
      settings.muted = !settings.muted;
      saveSettings();
      applyVolumes();
      updateWidget();
    });
    bgmSlider.addEventListener('input', () => { settings.bgm = Number(bgmSlider.value); saveSettings(); applyVolumes(); });
    sfxSlider.addEventListener('input', () => { settings.sfx = Number(sfxSlider.value); saveSettings(); applyVolumes(); });
    sfxSlider.addEventListener('change', click);
    updateWidget();
  }

  function updateWidget() {
    if (!widget) return;
    const locked = !isRunning() && !document.hidden;
    widget.classList.toggle('locked', locked);
    const toggle = widget.querySelector('.ma-toggle');
    toggle.textContent = locked ? '🔈' : settings.muted ? '🔇' : '🔊';
    toggle.setAttribute('aria-pressed', String(!settings.muted));
  }

  // ==============================
  // 音声入力(マイク)中はBGMを止める
  // ==============================
  function setMicHold(on) {
    micHold = on;
    if (!ctx) return;
    const now = ctx.currentTime;
    bgmIn.gain.cancelScheduledValues(now);
    bgmIn.gain.setTargetAtTime(on ? 0 : 1, now, 0.1);
  }

  // ==============================
  // 初期化
  // ==============================
  function init() {
    buildWidget();
    ensureCtx();

    const cls = document.body.classList;
    if (cls.contains('lobby-page')) whenRunning(() => startBgm('lobby'), true);
    if (cls.contains('battle-page')) whenRunning(() => startBgm('battle'), true);
    if (cls.contains('result-page')) {
      // result.js から victory() が呼ばれなかった場合の保険
      setTimeout(() => { if (!resultPlayed) victory('B'); }, 800);
    }

    if (ctx) ctx.resume().then(onState).catch(() => { });
    ['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, tryUnlock, { passive: true }));

    // タブが非表示の間は止める
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden && ctx.state === 'running') { autoSuspended = true; ctx.suspend(); }
      else if (!document.hidden && autoSuspended) { autoSuspended = false; ctx.resume(); }
      updateWidget();
    });

    // ボタン操作のクリック音
    document.addEventListener('click', (e) => {
      const el = e.target.closest && e.target.closest('button, a.button, a.back-link, a.brand, summary');
      if (!el || el.closest('#metsu-audio') || el.id === 'monster' || el.id === 'voice-btn') return;
      if (el.id === 'generate-btn') charge(); else click();
    }, true);

    // 音声入力・マイク確認中はBGMと効果音を止める(マイクに音が入らないように)
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('voice-btn', () => setMicHold(true));
    on('mic-start-btn', () => setMicHold(true));
    on('mic-stop-btn', () => setMicHold(false));
    const inputScreen = document.getElementById('input-screen');
    if (inputScreen) {
      new MutationObserver(() => { if (!inputScreen.hasAttribute('aria-busy')) setMicHold(false); })
        .observe(inputScreen, { attributes: true, attributeFilter: ['aria-busy'] });
    }

    // センサーが「攻撃可能」になったら合図の音
    const attackReady = document.getElementById('attack-ready');
    if (attackReady) {
      new MutationObserver(() => { if (attackReady.innerText.indexOf('攻撃可能') >= 0) ready(); })
        .observe(attackReady, { childList: true, characterData: true, subtree: true });
    }
  }

  let resultPlayed = false;
  const victoryOnce = victory;

  window.MetsuAudio = {
    hit, defeat, summon, click, charge, ready, setTension, startBgm, stopBgm,
    victory: (rank) => { resultPlayed = true; victoryOnce(rank); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();