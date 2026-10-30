const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const scrypt = promisify(crypto.scrypt);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const MODES = ['punch', 'shake', 'bag'];
const MONSTERS = ['normal', 'study', 'human', 'career', 'money', 'health', 'self', 'time', 'digital', 'probability', 'habit', 'family', 'leisure'];
const PUBLIC_FILES = new Set(['index.html', 'battle.html', 'result.html', 'style.css', 'flow.css',
  'audio.js', 'mic.js', 'category.js', 'monster.js', 'motion.js', 'gestures.js',
  'battle.js', 'script.js', 'ui.js', 'result.js', 'account.js', 'lobby.js']);

function createApp({ database = path.join(__dirname, 'data', 'metsu.sqlite'), secureCookies = false, publicOrigin = '' } = {}) {
  if (database !== ':memory:') fs.mkdirSync(path.dirname(database), { recursive: true });
  const db = new Database(database);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS battles (
      id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
      category TEXT NOT NULL, monster TEXT NOT NULL, form TEXT NOT NULL, mode TEXT NOT NULL,
      stress INTEGER, elapsed_ms INTEGER NOT NULL, attacks INTEGER NOT NULL, damage INTEGER NOT NULL,
      PRIMARY KEY(user_id, id)
    );
    CREATE INDEX IF NOT EXISTS battles_user_date ON battles(user_id, ended_at DESC);
  `);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      let validOrigin = true;
      if (req.get('origin')) {
        try {
          const origin = new URL(req.get('origin'));
          validOrigin = publicOrigin ? origin.origin === new URL(publicOrigin).origin : origin.host === req.get('host');
        } catch { validOrigin = false; }
      }
      if (!validOrigin || req.get('X-Metsu-Request') !== '1' || !req.is('application/json')) {
        return res.status(403).json({ error: 'この操作は許可されていません。ページを開き直してください。' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  function session(req) {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('metsu_session='))?.slice(14);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare(`SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE token_hash = ? AND expires_at > ?`).get(hash(token), Date.now()) || null;
  }
  function revoke(req) {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('metsu_session='))?.slice(14);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
  }
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/' };
  function signIn(req, res, user) {
    revoke(req);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    const token = crypto.randomBytes(32).toString('hex');
    const lifetime = 7 * 24 * 60 * 60 * 1000;
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(token), user.id, Date.now() + lifetime);
    res.cookie('metsu_session', token, { ...cookieOptions, maxAge: lifetime });
    res.json({ user: { id: user.id, username: user.username } });
  }
  const attempts = new Map();
  function rateLimit(req, res, next) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const key = req.ip;
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    attempts.set(key, entry);
    if (++entry.count > 30) return res.status(429).json({ error: '試行回数が多いため、15分後にお試しください。' });
    next();
  }
  const credentials = req => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().normalize('NFKC').toLowerCase() : '';
    const password = req.body?.password;
    if (!/^[\p{L}\p{N}_-]{3,32}$/u.test(username) || typeof password !== 'string' || password.length < 10 || password.length > 128) return null;
    return { username, password };
  };
  app.get('/api/me', (req, res) => res.json({ user: session(req) }));
  app.post('/api/register', rateLimit, async (req, res) => {
    const input = credentials(req);
    if (!input) return res.status(400).json({ error: 'ユーザー名は3〜32文字（文字・数字・_・-）、パスワードは10〜128文字で入力してください。' });
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = await scrypt(input.password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const user = { id: crypto.randomUUID(), username: input.username };
    try {
      db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run(user.id, user.username, salt, derived.toString('hex'), new Date().toISOString());
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'このユーザー名は利用できません。別の名前をお試しください。' });
      throw error;
    }
    signIn(req, res, user);
  });
  app.post('/api/login', rateLimit, async (req, res) => {
    const input = credentials(req);
    if (!input) return res.status(401).json({ error: 'ユーザー名またはパスワードが違います。' });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(input.username);
    const derived = await scrypt(input.password, user?.salt || '0'.repeat(32), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    if (!user || !crypto.timingSafeEqual(derived, Buffer.from(user.password_hash, 'hex'))) return res.status(401).json({ error: 'ユーザー名またはパスワードが違います。' });
    signIn(req, res, user);
  });
  app.post('/api/logout', (req, res) => {
    revoke(req); res.clearCookie('metsu_session', cookieOptions); res.json({ ok: true });
  });
  app.use('/api/history', (req, res, next) => {
    req.user = session(req);
    if (!req.user) return res.status(401).json({ error: 'ログインが必要です。' });
    next();
  });
  app.get('/api/history', (req, res) => {
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return res.status(400).json({ error: '無効なページです。' });
    const rows = db.prepare('SELECT * FROM battles WHERE user_id = ? ORDER BY ended_at DESC, id DESC LIMIT 100 OFFSET ?').all(req.user.id, offset);
    const stats = db.prepare('SELECT COUNT(*) AS monsters, COUNT(DISTINCT run_id) AS games, COALESCE(SUM(elapsed_ms), 0) AS elapsed_ms FROM battles WHERE user_id = ?').get(req.user.id);
    // One self-report per run, even when that run contains several monsters.
    const trend = db.prepare(`SELECT run_id, MIN(started_at) AS started_at, MAX(stress) AS stress
      FROM battles WHERE user_id = ? GROUP BY run_id ORDER BY started_at DESC LIMIT 1000`).all(req.user.id);
    res.json({ rows, stats, trend, nextOffset: offset + rows.length < stats.monsters ? offset + rows.length : null });
  });
  app.post('/api/history', (req, res) => {
    const b = req.body;
    const id = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{8,90}$/.test(x);
    const integer = (x, max) => Number.isSafeInteger(x) && x >= 0 && x <= max;
    const started = Date.parse(b?.startedAt), ended = Date.parse(b?.endedAt);
    if (!b || b.ownerId !== req.user.id || !id(b.id) || !id(b.runId) || !MODES.includes(b.mode) || !MONSTERS.includes(b.monster) ||
        !['normal', 's', 'ex'].includes(b.form) || typeof b.category !== 'string' || b.category.length < 1 || b.category.length > 80 ||
        !(b.stress === null || (Number.isInteger(b.stress) && b.stress >= 1 && b.stress <= 5)) ||
        !integer(b.elapsedMs, 86400000) || !integer(b.attacks, 1000000) || !integer(b.damage, 10000000) ||
        !Number.isFinite(started) || !Number.isFinite(ended) || ended < started || ended > Date.now() + 300000) {
      return res.status(400).json({ error: '記録の内容を確認できませんでした。' });
    }
    db.prepare(`INSERT INTO battles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, id) DO NOTHING`).run(b.id, req.user.id, b.runId, new Date(started).toISOString(), new Date(ended).toISOString(),
      b.category, b.monster, b.form, b.mode, b.stress, b.elapsedMs, b.attacks, b.damage);
    res.json({ ok: true });
  });
  app.delete('/api/history', (req, res) => {
    db.prepare('DELETE FROM battles WHERE user_id = ?').run(req.user.id); res.json({ ok: true });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'APIが見つかりません。' }));
  // Explicit public allowlist: database, sources, private api.js and tests are never served.
  app.get('/api.js', (_req, res) => res.type('js').send('export const SECRETS = { SPEECH_API_KEY: "", AUDIO_API_KEY: "" };'));
  app.use('/assets', express.static(path.join(__dirname, 'assets'), { dotfiles: 'deny', index: false }));
  app.use((req, res) => {
    const file = req.path === '/' ? 'index.html' : req.path.slice(1);
    if (req.method !== 'GET' || !PUBLIC_FILES.has(file)) return res.sendStatus(404);
    res.sendFile(path.join(__dirname, file));
  });
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'リクエストの形式が正しくありません。' });
    console.error('Metsu server error:', err.code || err.name);
    res.status(500).json({ error: '処理できませんでした。しばらくしてからお試しください。' });
  });
  return { app, db };
}

if (require.main === module) {
  const { app, db } = createApp({ database: process.env.METSU_DB || path.join(__dirname, 'data', 'metsu.sqlite'),
    secureCookies: process.env.SECURE_COOKIES === 'true', publicOrigin: process.env.PUBLIC_ORIGIN || '' });
  const port = Number(process.env.PORT || 5501);
  const server = app.listen(port, process.env.HOST || '127.0.0.1');
  server.on('listening', () => console.log(`Metsu: http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(`Cannot start Metsu: ${error.code}`); db.close(); process.exitCode = 1; });
  const close = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
module.exports = { createApp };
