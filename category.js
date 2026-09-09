// category.js
// ==== 完全ルールベース(オフライン無料)の分類ロジック ====
//
// 判定は2段階:
//   1. 主判定(keywords): 具体的で誤検出の少ないキーワード
//   2. フォールバック判定(fallbackKeywords): 主判定が0点だった場合のみ使う、
//      口語的・感情的な言い回し
//
// 精度設計:
//   - 最長一致(maximal munch): 短い単語が長いフレーズの一部でしかない場合の誤加点を防ぐ
//   - 否定検出: 「お金の心配は特にない」のように、一致した単語の直後で
//     明確に否定されている場合は、その一致を無効化する
//
// パフォーマンス設計:
//   主判定用・フォールバック用それぞれで1つのトライ木にまとめ、
//   分類のたびにテキストを走査してすべてのカテゴリのスコアを同時に計算する。

const categories = [
  {
    key: 'human', label: '対人関係の悩み', monster: 'human',
    keywords: [
      { word: '職場の人間関係', weight: 4 },
      { word: '人間関係', weight: 3 },
      { word: '信頼関係', weight: 2 }, { word: '人付き合い', weight: 2 },
      { word: 'コミュニケーション', weight: 2 }, { word: '対人', weight: 2 },
      { word: '裏切り', weight: 2 }, { word: 'いじめ', weight: 2 },
      { word: '喧嘩', weight: 1 }, { word: 'ケンカ', weight: 1 },
      { word: '上司', weight: 1 }, { word: '部下', weight: 1 },
      { word: '先輩', weight: 1 }, { word: '後輩', weight: 1 },
      { word: '同僚', weight: 1 }, { word: '友人', weight: 1 },
      { word: '友達', weight: 1 }, { word: '仲間', weight: 1 },
      { word: '孤独', weight: 1 }, { word: '恋愛', weight: 1 },
      { word: '恋人', weight: 1 }, { word: '相談', weight: 1 },
      { word: '嫉妬', weight: 1 }, { word: '陰口', weight: 1 },
      { word: '無視される', weight: 2 }, { word: 'ぼっち', weight: 1 },
    ],
    fallbackKeywords: [
      { word: '誰にも分かってもらえない', weight: 1 }, { word: '話を聞いてもらえない', weight: 1 },
      { word: '距離を感じる', weight: 1 }, { word: '気まずい', weight: 1 },
      { word: 'うざい', weight: 1 }, { word: 'めんどくさい人', weight: 1 },
      { word: '嫌われ', weight: 1 }, { word: '合わない人', weight: 1 },
    ]
  },
  {
    key: 'family', label: '家族・生活環境の悩み', monster: 'family',
    keywords: [
      { word: '家庭環境', weight: 3 }, { word: '家族', weight: 2 },
      { word: '家庭', weight: 2 }, { word: '両親', weight: 2 },
      { word: '介護', weight: 2 }, { word: '毒親', weight: 2 },
      { word: '嫁姑', weight: 2 }, { word: '嫁', weight: 1 },
      { word: '姑', weight: 1 }, { word: '父親', weight: 1 },
      { word: '母親', weight: 1 }, { word: '父', weight: 1 },
      { word: '母', weight: 1 }, { word: '子ども', weight: 1 },
      { word: '子供', weight: 1 }, { word: '育児', weight: 2 },
      { word: '家事', weight: 1 }, { word: '同居', weight: 1 },
      { word: '住宅', weight: 1 }, { word: '住まい', weight: 1 },
      { word: '引っ越し', weight: 1 }, { word: '夫婦', weight: 1 },
      { word: '夫', weight: 1 }, { word: '妻', weight: 1 },
      { word: '親子', weight: 1 }, { word: '義理', weight: 1 },
      { word: '兄弟', weight: 1 }, { word: '姉妹', weight: 1 },
      { word: '離婚', weight: 2 }, { word: '不仲', weight: 1 },
    ],
    fallbackKeywords: [
      { word: '実家', weight: 1 }, { word: '帰省', weight: 1 },
      { word: '家にいたくない', weight: 1 }, { word: '家がしんどい', weight: 1 },
      { word: '家族に言えない', weight: 1 },
    ]
  },
  {
    key: 'career', label: '仕事・キャリアの悩み', monster: 'career',
    keywords: [
      { word: 'キャリア', weight: 2 }, { word: '転職', weight: 2 },
      { word: '労働時間', weight: 2 }, { word: '働き方', weight: 2 },
      { word: '給与交渉', weight: 2 }, { word: 'パワハラ', weight: 2 },
      { word: 'ブラック企業', weight: 2 }, { word: '仕事', weight: 1 },
      { word: '職場', weight: 1 }, { word: '昇進', weight: 1 },
      { word: '昇格', weight: 1 }, { word: '退職', weight: 1 },
      { word: 'やりがい', weight: 1 }, { word: '残業', weight: 1 },
      { word: '異動', weight: 1 }, { word: '部署', weight: 1 },
      { word: '職業', weight: 1 }, { word: '就職', weight: 1 },
      { word: '上長', weight: 1 }, { word: '評価', weight: 1 },
      { word: '人事', weight: 1 }, { word: '副業', weight: 1 },
      { word: '独立', weight: 1 }, { word: '起業', weight: 1 },
      { word: 'クビ', weight: 2 }, { word: '解雇', weight: 2 },
      { word: '面接', weight: 1 }, { word: '離職', weight: 1 },
    ],
    fallbackKeywords: [
      { word: '仕事に行きたくない', weight: 1 }, { word: '会社行きたくない', weight: 1 },
      { word: '働きたくない', weight: 1 }, { word: '月曜日が憂鬱', weight: 1 },
      { word: '会社を辞めたい', weight: 1 }, { word: 'ノルマ', weight: 1 },
    ]
  },
  {
    key: 'money', label: 'お金・経済の悩み', monster: 'money',
    keywords: [
      { word: '経済的な不安', weight: 3 }, { word: '生活費', weight: 2 },
      { word: '借金', weight: 2 }, { word: 'ローン', weight: 2 },
      { word: '節約', weight: 1 }, { word: 'お金', weight: 1 },{ word: 'おかね', weight: 1 },
      { word: '収入', weight: 1 }, { word: '貯金', weight: 1 },
      { word: '投資', weight: 1 }, { word: '家計', weight: 1 },
      { word: '支払い', weight: 1 }, { word: '支出', weight: 1 },
      { word: '借入', weight: 1 }, { word: '資産', weight: 1 },
      { word: '財務', weight: 1 }, { word: '返済', weight: 1 },
      { word: '給料', weight: 1 }, { word: '年収', weight: 1 },
      { word: '税金', weight: 1 }, { word: '保険料', weight: 1 },
      { word: '物価', weight: 1 }, { word: '副収入', weight: 1 },
      { word: '奨学金', weight: 2 }, { word: '養育費', weight: 2 },
    ],
    fallbackKeywords: [
      { word: 'お金がない', weight: 1 },{ word: 'おかねがない', weight: 1 }, { word: '金欠', weight: 1 },
      { word: '生活が苦しい', weight: 1 }, { word: 'おかねの余裕がない', weight: 1 },{ word: 'お金の余裕がない', weight: 1 },
      { word: '節約できない', weight: 1 }, { word: '買えない', weight: 1 },
    ]
  },
  {
    key: 'health', label: '健康・心身の悩み', monster: 'health',
    keywords: [
      { word: 'メンタルヘルス', weight: 3 }, { word: '体調不良', weight: 2 },
      { word: '精神', weight: 1 }, { word: 'ストレス', weight: 2 },
      { word: 'うつ', weight: 2 }, { word: '不眠', weight: 2 },
      { word: '体調', weight: 1 },
      { word: '睡眠', weight: 1 }, { word: '病気', weight: 1 },
      { word: '疲れ', weight: 1 }, { word: '痛い', weight: 2 }, { word: '不安', weight: 1 },
      { word: '心身', weight: 1 }, { word: '運動', weight: 1 },
      { word: 'ダイエット', weight: 1 }, { word: '休息', weight: 1 },
      { word: '疲労', weight: 1 }, { word: '頭痛', weight: 1 },
      { word: '腰痛', weight: 1 }, { word: '通院', weight: 1 },
      { word: '薬', weight: 1 }, { word: 'パニック', weight: 2 },
      { word: '過労', weight: 2 }, { word: '倦怠感', weight: 1 },
    ],
    fallbackKeywords: [
      { word: '健康', weight: 1 }, { word: 'しんどい', weight: 1 }, { word: 'つらい', weight: 1 },
      { word: 'だるい', weight: 1 }, { word: '眠れない', weight: 1 },
      { word: '食欲がない', weight: 1 }, { word: '気分が沈む', weight: 1 },
      { word: '限界', weight: 1 },
    ]
  },
  {
    key: 'self', label: '生き方・自己実現の悩み', monster: 'self',
    keywords: [
      { word: '自己実現', weight: 3 }, { word: '存在意義', weight: 2 },
      { word: 'アイデンティティ', weight: 2 }, { word: '自分らしさ', weight: 2 },
      { word: '生きがい', weight: 2 }, { word: '生き方', weight: 1 },
      { word: '夢', weight: 1 }, { word: '目標', weight: 1 },
      { word: '価値観', weight: 1 }, { word: '人生', weight: 1 },
      { word: 'モチベーション', weight: 1 }, { word: '使命', weight: 1 },
      { word: '方向性', weight: 1 }, { word: '将来像', weight: 1 },
      { word: '自己成長', weight: 1 }, { word: '自己肯定感', weight: 2 },
      { word: '虚無感', weight: 2 }, { word: '燃え尽き', weight: 2 },
    ],
    fallbackKeywords: [
      { word: '何がしたいか分からない', weight: 1 }, { word: 'このままでいいのか', weight: 1 },
      { word: '自信がない', weight: 1 }, { word: '空しい', weight: 1 },
      { word: '虚しい', weight: 1 }, { word: '何のために生きて', weight: 1 },
    ]
  },
  {
    key: 'time', label: '時間の悩み', monster: 'time',
    keywords: [
      { word: 'タイムマネジメント', weight: 3 }, { word: '時間管理', weight: 2 },
      { word: '時間がない', weight: 2 }, { word: '時間の浪費', weight: 2 },
      { word: '先延ばし', weight: 2 }, { word: '締め切り', weight: 2 },
      { word: '時間', weight: 1 }, { word: '期限', weight: 1 },
      { word: '予定', weight: 1 }, { word: 'スケジュール', weight: 1 },
      { word: '遅刻', weight: 1 }, { word: '忙しい', weight: 1 },
      { word: '余裕', weight: 1 }, { word: '時間配分', weight: 1 },
    ],
    fallbackKeywords: [
      { word: '時間が足りない', weight: 1 }, { word: '焦る', weight: 1 },
      { word: 'ギリギリ', weight: 1 }, { word: '間に合わない', weight: 1 },
    ]
  },
  {
    key: 'digital', label: 'デジタルの悩み', monster: 'digital',
    keywords: [
      { word: '通知疲れ', weight: 3 }, { word: 'スマホ依存', weight: 3 },
      { word: 'SNS疲れ', weight: 3 }, { word: 'デジタル', weight: 1 },
      { word: 'スマホ', weight: 1 }, { word: 'SNS', weight: 1 },
      { word: 'ネット', weight: 1 }, { word: 'インターネット', weight: 1 },
      { word: 'アプリ', weight: 1 }, { word: 'パソコン', weight: 1 },
      { word: '通信', weight: 1 }, { word: '画面', weight: 1 },
      { word: '機器', weight: 1 }, { word: 'オンライン', weight: 1 },
      { word: 'セキュリティ', weight: 1 }, { word: 'パスワード', weight: 1 },
      { word: '依存', weight: 1 }, { word: '炎上', weight: 2 },
    ],
    fallbackKeywords: [
      { word: 'スマホが手放せない', weight: 1 }, { word: 'つい見てしまう', weight: 1 },
      { word: '既読無視', weight: 1 }, { word: 'バズ', weight: 1 },
    ]
  },
  {
    key: 'study', label: '勉強関係の悩み', monster: 'study',
    keywords: [
      { word: '試験対策', weight: 2 }, { word: '勉強法', weight: 2 },
      { word: '勉強', weight: 1 }, { word: 'テスト', weight: 1 },
      { word: '授業', weight: 1 }, { word: '試験', weight: 1 },
      { word: '学校', weight: 1 }, { word: '宿題', weight: 1 },
      { word: '課題', weight: 1 }, { word: '受験', weight: 1 },
      { word: '成績', weight: 1 }, { word: 'レポート', weight: 1 },
      { word: '学習', weight: 1 }, { word: '塾', weight: 1 },
      { word: '進級', weight: 1 }, { word: '留年', weight: 1 },
      { word: '論文', weight: 1 }, { word: '卒論', weight: 1 },
      { word: '単位', weight: 1 }, { word: '偏差値', weight: 1 },
    ],
    fallbackKeywords: [
      { word: '勉強したくない', weight: 1 }, { word: '集中できない', weight: 1 },
      { word: '頭に入らない', weight: 1 }, { word: '成績が上がらない', weight: 1 },
    ]
  },
  {
    key: 'probability', label: '確率・不確実性の悩み', monster: 'probability',
    keywords: [
      { word: '不確実', weight: 2 }, { word: '確率', weight: 1 },
      { word: '可能性', weight: 1 }, { word: '予想', weight: 1 },
      { word: '見込み', weight: 1 }, { word: '成否', weight: 1 },
      { word: 'かもしれない', weight: 1 }, { word: 'たぶん', weight: 1 },
      { word: 'ありえる', weight: 1 }, { word: 'パーセント', weight: 1 },
      { word: '予測', weight: 1 }, { word: '賭け', weight: 1 },
      { word: 'リスク', weight: 1 }, { word: '運', weight: 1 },
    ],
    fallbackKeywords: [
      { word: 'うまくいくか不安', weight: 1 }, { word: '先が読めない', weight: 1 },
      { word: 'どうなるか分からない', weight: 1 },
    ]
  },
  {
    key: 'habit', label: '習慣・行動の悩み', monster: 'habit',
    keywords: [
      { word: '三日坊主', weight: 3 }, { word: '習慣化', weight: 2 },
      { word: '生活習慣', weight: 2 }, { word: '行動改善', weight: 2 },
      { word: '習慣', weight: 1 }, { word: '行動', weight: 1 },
      { word: 'ルーティン', weight: 1 }, { word: '続けられない', weight: 2 },
      { word: 'やめたい', weight: 1 }, { word: '改善', weight: 1 },
      { word: '毎日', weight: 1 }, { word: '日常', weight: 1 },
      { word: 'クセ', weight: 1 }, { word: 'お酒', weight: 1 }, { word: '飲酒', weight: 1 },
      { word: '喫煙', weight: 1 }, { word: '暴飲暴食', weight: 2 },
    ],
    fallbackKeywords: [
      { word: 'また同じことをしてしまう', weight: 1 }, { word: '自己嫌悪', weight: 1 },
      { word: '三日で挫折', weight: 1 }, { word: 'ついやってしまう', weight: 1 },
    ]
  },
  {
    key: 'leisure', label: '趣味・余暇の悩み', monster: 'leisure',
    keywords: [
      { word: '趣味', weight: 1 }, { word: '遊び', weight: 1 },
      { word: '旅行', weight: 1 }, { word: '休日', weight: 1 },
      { word: '余暇', weight: 1 }, { word: '映画', weight: 1 },
      { word: '音楽', weight: 1 }, { word: 'ゲーム', weight: 1 },
      { word: 'アウトドア', weight: 1 }, { word: '散歩', weight: 1 },
      { word: 'スポーツ', weight: 1 }, { word: 'リラックス', weight: 1 },
      { word: '休み', weight: 1 }, { word: '娯楽', weight: 1 },
    ],
    fallbackKeywords: [
      { word: '何もしたくない', weight: 1 }, { word: '楽しいことがない', weight: 1 },
      { word: '暇すぎる', weight: 1 }, { word: 'つまらない', weight: 1 },
    ]
  }
];

const UNKNOWN_CATEGORY = { key: 'unknown', label: 'その他', monster: 'normal' };

// ==== チューニングパラメータ ====
const MIN_SCORE_THRESHOLD = 1;      // これ未満なら unknown
const MULTI_CATEGORY_RATIO = 0.6;   // 2位が1位のこの割合以上なら「複合カテゴリ」とみなす

// キーワード直後、この文字数以内に否定表現があれば、その一致を無効化する
const NEGATION_LOOKAHEAD = 10;
const NEGATION_PATTERNS = [
  'ではない', 'じゃない', 'はない', 'がない', 'は特にない', 'は特にありません',
  'ではありません', 'じゃありません', 'はありません', 'は無い', 'はなかった',
  'ではなかった', 'じゃなかった', 'はしていない', 'とは無縁',
];

function normalizeText(text) {
  return String(text ?? '').trim().toLowerCase()
    .replace(/[！!？?。.,、・()\[\]「」『』\s]+/g, ' ')
    .replace(/ー+/g, ' ')
    .replace(/\s+/g, ' ');
}

// 一致した単語の直後(endIndexから数文字以内)に否定表現があるかどうか
function isNegatedAt(normalizedText, endIndex) {
  const window = normalizedText.slice(endIndex, endIndex + NEGATION_LOOKAHEAD);
  return NEGATION_PATTERNS.some((pattern) => window.includes(pattern));
}

// ==== トライ木の構築(モジュール読み込み時に1回だけ実行) ====
function buildKeywordTrie(categoryList, keywordsField) {
  const root = { children: new Map(), matches: null };

  categoryList.forEach((category, categoryIndex) => {
    const list = category[keywordsField] || [];
    list.forEach(({ word, weight }) => {
      if (!word) return;
      let node = root;
      for (const ch of word) {
        let next = node.children.get(ch);
        if (!next) {
          next = { children: new Map(), matches: null };
          node.children.set(ch, next);
        }
        node = next;
      }
      if (!node.matches) node.matches = [];
      node.matches.push({ categoryIndex, weight });
    });
  });

  return root;
}

const PRIMARY_TRIE = buildKeywordTrie(categories, 'keywords');
const FALLBACK_TRIE = buildKeywordTrie(categories, 'fallbackKeywords');

/**
 * テキストを1回だけ走査し、全カテゴリのスコアを同時に計算する。
 *
 * 【最長一致】各開始位置では一番長く一致した単語だけを採用する。
 * 【否定検出】一致した単語の直後に否定表現があれば、その一致は加点しない。
 */
function computeCategoryScores(trie, normalizedText) {
  const scores = new Array(categories.length).fill(0);
  const length = normalizedText.length;

  for (let start = 0; start < length; start++) {
    let node = trie;
    let lastMatch = null;
    let lastMatchEnd = -1;

    for (let i = start; i < length; i++) {
      const next = node.children.get(normalizedText[i]);
      if (!next) break;
      node = next;
      if (node.matches) {
        lastMatch = node.matches;
        lastMatchEnd = i + 1;
      }
    }

    if (lastMatch && !isNegatedAt(normalizedText, lastMatchEnd)) {
      for (const { categoryIndex, weight } of lastMatch) {
        scores[categoryIndex] += weight;
      }
    }
  }

  return scores;
}

function rankCategories(trie, normalizedText) {
  const scores = computeCategoryScores(trie, normalizedText);
  return categories
    .map((category, index) => ({ category, score: scores[index] }))
    .sort((a, b) => b.score - a.score);
}

// 1位・2位のスコアから、最終的なカテゴリ判定(複合カテゴリ判定込み)を組み立てる共通処理
function pickResultFromRanked(ranked, tier) {
  const top = ranked[0];
  const second = ranked[1];
  const isMulti =
    second &&
    second.score >= MIN_SCORE_THRESHOLD &&
    second.score >= top.score * MULTI_CATEGORY_RATIO;

  return {
    ...top.category,
    secondary: isMulti ? second.category : null,
    scores: ranked,
    tier,
  };
}

/**
 * ルールベース分類(2段階 + 否定検出)。
 * 1. 主判定(keywords)でスコアを計算し、1点以上あればそれを採用する。
 * 2. 主判定が0点(＝一致するキーワードなし、または全て否定文脈)の場合のみ、
 *    フォールバック判定(fallbackKeywords)を試す。
 * 3. どちらも0点なら unknown を返す。
 */
function classifyCategoryByRules(text) {
  const normalized = normalizeText(text);

  const primaryRanked = rankCategories(PRIMARY_TRIE, normalized);
  if (primaryRanked[0].score >= MIN_SCORE_THRESHOLD) {
    return pickResultFromRanked(primaryRanked, 'primary');
  }

  const fallbackRanked = rankCategories(FALLBACK_TRIE, normalized);
  if (fallbackRanked[0].score >= MIN_SCORE_THRESHOLD) {
    return pickResultFromRanked(fallbackRanked, 'fallback');
  }

  return { ...UNKNOWN_CATEGORY, secondary: null, scores: primaryRanked, tier: 'unknown' };
}

function classifyCategory(text) {
  return classifyCategoryByRules(text);
}

// 互換性のために元の関数名を維持(monster.js 等の呼び出し元を変更しなくて済むように)。
async function classifyCategoryWithVectors(text) {
  return classifyCategoryByRules(text);
}
