// category.js
const categories = [
  { key: 'human', label: '対人関係の悩み', monster: 'human', seedText: '人間関係の悩み、上司、友達...', pattern: /人間関係|上司|友達|先輩|恋愛|相談|仲間|同僚|孤独|友人|対人|コミュニケーション|職場の人間関係/ },
  { key: 'family', label: '家族・生活環境の悩み', monster: 'human', seedText: '家族の悩み、家庭、親...', pattern: /家族|家庭|親|父|母|子ども|子供|育児|家事|同居|住宅|住まい|引っ越し|家庭環境|夫|妻|夫婦|親子/ },
  { key: 'career', label: '仕事・キャリアの悩み', monster: 'career', seedText: '仕事の悩み、キャリア、転職...', pattern: /仕事|キャリア|転職|職場|昇進|退職|やりがい|残業|異動|部署|職業|就職|労働時間|働き方/ },
  { key: 'money', label: 'お金・経済の悩み', monster: 'money', seedText: 'お金の悩み、収入、借金...', pattern: /お金|収入|借金|貯金|投資|家計|支払い|節約|ローン|支出|生活費|借入|資産|財務|返済|経済的な不安/ },
  { key: 'health', label: '健康・心身の悩み', monster: 'health', seedText: '健康の悩み、体調、睡眠...', pattern: /健康|体調|睡眠|精神|ストレス|病気|疲れ|不安|うつ|心身|運動|ダイエット|休息|メンタルヘルス|疲労|体調不良/ },
  { key: 'self', label: '生き方・自己実現の悩み', monster: 'self', seedText: '生き方、自己実現、夢...', pattern: /生き方|自己実現|夢|目標|価値観|人生|存在意義|モチベーション|使命|方向性|将来像|自己成長/ },
  { key: 'time', label: '時間の悩み', monster: 'time', seedText: '時間の悩み、期限、予定...', pattern: /時間|期限|予定|スケジュール|遅刻|忙しい|余裕|時間がない|時間管理|タイムマネジメント|時間配分|時間の浪費/ },
  { key: 'digital', label: 'デジタルの悩み', monster: 'digital', seedText: 'デジタルの悩み、スマホ...', pattern: /デジタル|スマホ|SNS|ネット|インターネット|IT|アプリ|パソコン|操作|通信|画面|機器|オンライン|セキュリティ/ },
  { key: 'study', label: '勉強関係の悩み', monster: 'study', seedText: '勉強の悩み、テスト、授業...', pattern: /勉強|テスト|授業|試験|学校|宿題|課題|受験|成績|レポート|学習|塾|勉強法|試験対策/ },
  { key: 'probability', label: '確率・不確実性の悩み', monster: 'probability', seedText: '確率、可能性、予想...', pattern: /確率|可能性|予想|不確実|見込み|運|成否|かもしれない|かも|たぶん|ありえる|パーセント|予測/ },
  { key: 'habit', label: '習慣・行動の悩み', monster: 'habit', seedText: '習慣、行動、生活...', pattern: /習慣|行動|生活|ルーティン|続けられない|やめたい|改善|毎日|日常|生活習慣|クセ|習慣化|行動改善/ },
  { key: 'leisure', label: '趣味・余暇の悩み', monster: 'normal', seedText: '趣味、遊び、旅行...', pattern: /趣味|遊び|旅行|休日|余暇|映画|音楽|ゲーム|アウトドア|散歩|スポーツ|リラックス|休み|娯楽/ }
];

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeText(text) {
  return String(text ?? '').trim().toLowerCase()
    .replace(/[！!？?。.,、・()\[\]「」『』\s]+/g, ' ')
    .replace(/ー+/g, ' ')
    .replace(/\s+/g, ' ');
}

function classifyCategoryByRules(text) {
  const normalized = normalizeText(text);
  let bestCategory = { key: 'unknown', label: 'その他', monster: 'normal' };
  let bestScore = 0;

  for (const category of categories) {
    let score = 0;
    if (category.pattern && category.pattern.test(normalized)) score += 5;
    if (normalized.includes(category.key)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }
  return bestScore < 2 ? { key: 'unknown', label: 'その他', monster: 'normal' } : bestCategory;
}

async function getEmbedding(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.EMBEDDING_MODEL}:embedContent?key=${CONFIG.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: { parts: [{ text: text }] } }),
  });
  if (!response.ok) throw new Error(`Embedding API エラー: ${await response.text()}`);
  return (await response.json()).embedding.values;
}

async function getEmbeddings(texts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.EMBEDDING_MODEL}:batchEmbedContents?key=${CONFIG.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${CONFIG.EMBEDDING_MODEL}`,
        content: { parts: [{ text: text }] },
      })),
    }),
  });
  if (!response.ok) throw new Error(`Batch Embedding API エラー: ${await response.text()}`);
  return (await response.json()).embeddings.map((e) => e.values);
}

function classifyCategory(text) {
  return classifyCategoryByRules(text);
}

let categoryEmbeddings = null;
async function initCategoryEmbeddings() {
  if (!CONFIG.GEMINI_API_KEY || CONFIG.GEMINI_API_KEY === "YOUR_API_KEY_HERE") {
    throw new Error('config.js に有効な GEMINI_API_KEY を設定してください。');
  }
  if (categoryEmbeddings) return categoryEmbeddings;
  const seeds = categories.map((category) => category.seedText);
  categoryEmbeddings = await getEmbeddings(seeds);
  return categoryEmbeddings;
}

async function classifyCategoryWithVectors(text) {
  const localCategory = classifyCategory(text);
  if (localCategory.key !== 'unknown') return localCategory;

  try {
    const categoryVectors = await initCategoryEmbeddings();
    const textVector = await getEmbedding(text);
    let bestCategory = { key: 'unknown', label: 'その他', monster: 'normal' };
    let bestScore = -Infinity;

    for (let i = 0; i < categories.length; i++) {
      const score = cosineSimilarity(textVector, categoryVectors[i]);
      if (score > bestScore) {
        bestScore = score;
        bestCategory = categories[i];
      }
    }
    return bestScore < 0.4 ? { key: 'unknown', label: 'その他', monster: 'normal' } : bestCategory;
  } catch (error) {
    console.warn('Embedding分類エラー:', error);
    return classifyCategory(text);
  }
}