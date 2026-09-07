// category.js
const categories = [
  {
    key: 'human', label: '対人関係の悩み', monster: 'human',
    pattern: /人間関係|上司|部下|先輩|後輩|恋愛|恋人|相談|仲間|同僚|孤独|友人|友達|対人|コミュニケーション|職場の人間関係|喧嘩|ケンカ|いじめ|人付き合い|信頼関係|裏切り/
  },
  {
    key: 'family', label: '家族・生活環境の悩み', monster: 'human',
    pattern: /家族|家庭|両親|父親|母親|父|母|子ども|子供|育児|家事|同居|住宅|住まい|引っ越し|家庭環境|夫|妻|夫婦|親子|義理|嫁|姑|兄弟|姉妹/
  },
  {
    key: 'career', label: '仕事・キャリアの悩み', monster: 'career',
    pattern: /仕事|キャリア|転職|職場|昇進|昇格|退職|やりがい|残業|異動|部署|職業|就職|労働時間|働き方|上長|評価|人事|給与交渉|副業|独立|起業/
  },
  {
    key: 'money', label: 'お金・経済の悩み', monster: 'money',
    pattern: /お金|収入|借金|貯金|投資|家計|支払い|節約|ローン|支出|生活費|借入|資産|財務|返済|経済的な不安|給料|年収|税金|保険料|物価/
  },
  {
    key: 'health', label: '健康・心身の悩み', monster: 'health',
    pattern: /健康|体調|睡眠|精神|ストレス|病気|疲れ|不安|うつ|心身|運動|ダイエット|休息|メンタルヘルス|疲労|体調不良|頭痛|腰痛|不眠|通院|薬/
  },
  {
    key: 'self', label: '生き方・自己実現の悩み', monster: 'self',
    pattern: /生き方|自己実現|夢|目標|価値観|人生|存在意義|モチベーション|使命|方向性|将来像|自己成長|自分らしさ|生きがい|アイデンティティ/
  },
  {
    key: 'time', label: '時間の悩み', monster: 'time',
    pattern: /時間|期限|予定|スケジュール|遅刻|忙しい|余裕|時間がない|時間管理|タイムマネジメント|時間配分|時間の浪費|締め切り|先延ばし/
  },
  {
    key: 'digital', label: 'デジタルの悩み', monster: 'digital',
    pattern: /デジタル|スマホ|SNS|ネット|インターネット|IT|アプリ|パソコン|操作|通信|画面|機器|オンライン|セキュリティ|パスワード|通知疲れ|依存/
  },
  {
    key: 'study', label: '勉強関係の悩み', monster: 'study',
    pattern: /勉強|テスト|授業|試験|学校|宿題|課題|受験|成績|レポート|学習|塾|勉強法|試験対策|進級|留年|論文|卒論/
  },
  {
    key: 'probability', label: '確率・不確実性の悩み', monster: 'probability',
    pattern: /確率|可能性|予想|不確実|見込み|運|成否|かもしれない|かも|たぶん|ありえる|パーセント|予測|賭け|リスク/
  },
  {
    key: 'habit', label: '習慣・行動の悩み', monster: 'habit',
    pattern: /習慣|行動|生活|ルーティン|続けられない|やめたい|改善|毎日|日常|生活習慣|クセ|習慣化|行動改善|三日坊主/
  },
  {
    key: 'leisure', label: '趣味・余暇の悩み', monster: 'normal',
    pattern: /趣味|遊び|旅行|休日|余暇|映画|音楽|ゲーム|アウトドア|散歩|スポーツ|リラックス|休み|娯楽/
  }
];

const UNKNOWN_CATEGORY = { key: 'unknown', label: 'その他', monster: 'normal' };

// スコアリング方針: 単純な「当たった/当たらない」の二値ではなく、
// マッチしたキーワードの「延べ数」でスコアを付ける。
// 複数キーワードが引っかかるほど確信度が高いとみなす。
const MIN_SCORE_THRESHOLD = 1; // これ未満なら unknown

function normalizeText(text) {
  return String(text ?? '').trim().toLowerCase()
    .replace(/[！!？?。.,、・()\[\]「」『』\s]+/g, ' ')
    .replace(/ー+/g, ' ')
    .replace(/\s+/g, ' ');
}

// 正規表現をグローバルフラグ付きで再生成し、マッチ数をカウントする
function countMatches(pattern, text) {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  const matches = text.match(globalPattern);
  return matches ? matches.length : 0;
}

// 全カテゴリのスコアを計算し、降順にソートして返す
function scoreAllCategoriesByRules(text) {
  const normalized = normalizeText(text);
  return categories
    .map((category) => ({
      category,
      score: category.pattern ? countMatches(category.pattern, normalized) : 0,
    }))
    .sort((a, b) => b.score - a.score);
}

function classifyCategoryByRules(text) {
  const ranked = scoreAllCategoriesByRules(text);
  const top = ranked[0];
  return (!top || top.score < MIN_SCORE_THRESHOLD) ? UNKNOWN_CATEGORY : top.category;
}

function classifyCategory(text) {
  return classifyCategoryByRules(text);
}

// 互換性のために元の関数名を維持(monster.js等の呼び出し元を変更しなくて済むように)。
// 中身は完全に同期処理だが、既存の `await classifyCategoryWithVectors(...)` という
// 呼び出し方でも問題なく動くよう async 関数のままにしている。
async function classifyCategoryWithVectors(text) {
  return classifyCategoryByRules(text);
}