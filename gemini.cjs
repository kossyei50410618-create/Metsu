// Only imported by the server. Never serve this file to browsers.
function installGemini(app, { apiKey = '', audioKey = '', model = 'gemini-3.1-flash-lite', fetchImpl = fetch, prompts } = {}) {
  let active = 0, count = 0, windowEnd = 0;
  app.post('/api/analyze', async (req, res) => {
    const { kind, input } = req.body || {};
    if (!['speech', 'audio'].includes(kind) || typeof input !== 'string' || !input.trim() || input.length > 4000 ||
        Object.keys(req.body).some(k => !['kind', 'input'].includes(k))) {
      return res.status(400).json({ error: '解析する内容を確認してください。' });
    }
    const key = kind === 'audio' ? audioKey || apiKey : apiKey;
    if (!key) return res.status(503).json({ error: 'AI解析が設定されていません。' });
    // Global limits also cover guests and tunnels, without trusting forwarded IPs.
    const now = Date.now();
    if (now >= windowEnd) { count = 0; windowEnd = now + 60000; }
    if (active >= 2 || count >= 20) return res.status(429).json({ error: '解析が混み合っています。しばらくしてからお試しください。' });
    count++; active++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const upstream = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: prompts[kind] }] },
          contents: [{ role: 'user', parts: [{ text: input }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 400 } }),
      });
      if (!upstream.ok) {
        console.warn('Gemini request failed, HTTP status:', upstream.status);
        return res.status(upstream.status === 429 ? 429 : 502).json({ error: 'AI解析を利用できません。時間をおいて再試行してください。' });
      }
      const data = await upstream.json();
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('').trim();
      if (!text || candidate.finishReason === 'MAX_TOKENS') return res.status(502).json({ error: 'AI解析を完了できませんでした。' });
      return res.json({ text });
    } catch {
      return res.status(controller.signal.aborted ? 504 : 502).json({ error: 'AI解析に接続できませんでした。' });
    } finally { clearTimeout(timeout); active--; }
  });
}
module.exports = { installGemini };
