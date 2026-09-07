// category.js
// ==== 完全ルールベース(オフライン・無料)の分類ロジック ====
// キーワードは重み付き配列で管理し、複数カテゴリにまたがる相談文にも対応する。
//
// パフォーマンス設計:
// 全カテゴリ・全キーワード(約250語)を1つのトライ木にまとめ、
// 分類のたびにテキストを「1回だけ」走査してすべてのカテゴリのスコアを同時に計算する。
//
// 精度設計(最長一致 / maximal munch):
// 「職場」(career)と「職場の人間関係」(human)のように、短いキーワードが
// より長い・より具体的なキーワードの接頭辞になっているケースがある。
// 各開始位置で見つかったすべての一致を加点すると、「職場の人間関係」という
// 1つのフレーズから career にも誤って加点されてしまう。
// これを避けるため、各開始位置では「一番長く一致した単語」だけを採用する。

const categories = [
  {
    key: 'human', label: '対人関係の悩み', monster: 'human',
<<<<<<< HEAD
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
    ]
  },
  {
    key: 'family', label: '家族・生活環境の悩み', monster: 'human',
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
    ]
  },
  {
    key: 'money', label: 'お金・経済の悩み', monster: 'money',
    keywords: [
      { word: '経済的な不安', weight: 3 }, { word: '生活費', weight: 2 },
      { word: '借金', weight: 2 }, { word: 'ローン', weight: 2 },
      { word: '節約', weight: 1 }, { word: 'お金', weight: 1 },
      { word: '収入', weight: 1 }, { word: '貯金', weight: 1 },
      { word: '投資', weight: 1 }, { word: '家計', weight: 1 },
      { word: '支払い', weight: 1 }, { word: '支出', weight: 1 },
      { word: '借入', weight: 1 }, { word: '資産', weight: 1 },
      { word: '財務', weight: 1 }, { word: '返済', weight: 1 },
      { word: '給料', weight: 1 }, { word: '年収', weight: 1 },
      { word: '税金', weight: 1 }, { word: '保険料', weight: 1 },
      { word: '物価', weight: 1 }, { word: '副収入', weight: 1 },
      { word: '奨学金', weight: 2 }, { word: '養育費', weight: 2 },
    ]
  },
  {
    key: 'health', label: '健康・心身の悩み', monster: 'health',
    keywords: [
      { word: 'メンタルヘルス', weight: 3 }, { word: '体調不良', weight: 2 },
      { word: '精神', weight: 1 }, { word: 'ストレス', weight: 2 },
      { word: 'うつ', weight: 2 }, { word: '不眠', weight: 2 },
      { word: '健康', weight: 1 }, { word: '体調', weight: 1 },
      { word: '睡眠', weight: 1 }, { word: '病気', weight: 1 },
      { word: '疲れ', weight: 1 }, { word: '不安', weight: 1 },
      { word: '心身', weight: 1 }, { word: '運動', weight: 1 },
      { word: 'ダイエット', weight: 1 }, { word: '休息', weight: 1 },
      { word: '疲労', weight: 1 }, { word: '頭痛', weight: 1 },
      { word: '腰痛', weight: 1 }, { word: '通院', weight: 1 },
      { word: '薬', weight: 1 }, { word: 'パニック', weight: 2 },
      { word: '過労', weight: 2 }, { word: '倦怠感', weight: 1 },
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
      { word: 'クセ', weight: 1 }, { word: '飲酒', weight: 1 },
      { word: '喫煙', weight: 1 }, { word: '暴飲暴食', weight: 2 },
    ]
  },
  {
    key: 'leisure', label: '趣味・余暇の悩み', monster: 'normal',
    keywords: [
      { word: '趣味', weight: 1 }, { word: '遊び', weight: 1 },
      { word: '旅行', weight: 1 }, { word: '休日', weight: 1 },
      { word: '余暇', weight: 1 }, { word: '映画', weight: 1 },
      { word: '音楽', weight: 1 }, { word: 'ゲーム', weight: 1 },
      { word: 'アウトドア', weight: 1 }, { word: '散歩', weight: 1 },
      { word: 'スポーツ', weight: 1 }, { word: 'リラックス', weight: 1 },
      { word: '休み', weight: 1 }, { word: '娯楽', weight: 1 },
    ]
=======
    seedText: ['ぼっち', '友ガチャ', '既読スルー', '未読スルー', 'コミュ障', '陰キャ', 'マウント', '距離感', '価値観の違い', '仲直り', '関係悪化', '人間関係疲れ', '友達付き合い', '人付き合いしんどい', '気まずい', '空気読めない', 'ノリ悪い', '仲間外れ', 'ハブられる', '既読無視', 'リア友', 'ネッ友', '界隈', '推し友', '価値観合わない', '本音言えない', '人見知り', '会話続かない', '返信こない', '友達できない'],
    pattern: /人間関係|上司|部下|先輩|後輩|恋愛|恋人|相談|仲間|同僚|孤独|友人|友達|対人|コミュニケーション|職場の人間関係|喧嘩|ケンカ|いじめ|人付き合い|信頼関係|裏切り|ぼっち|友ガチャ|既読スルー|未読スルー|コミュ障|陰キャ|マウント|距離感|価値観の違い|仲直り|関係悪化|人間関係疲れ|友達付き合い|人付き合いしんどい|気まずい|空気読めない|ノリ悪い|仲間外れ|ハブられる|既読無視|リア友|ネッ友|界隈|推し友|価値観合わない|本音言えない|人見知り|会話続かない|返信こない|友達できない/
  },
  {
    key: 'family', label: '家族・生活環境の悩み', monster: 'human',
    seedText: ['親ガチャ', '毒親', '実家暮らし', '家族仲', '親子げんか', '夫婦げんか', 'ワンオペ', '家事分担', '育児疲れ', '介護疲れ', '同居しんどい', '家に帰りたくない', '家庭内別居', '子育て', '生活環境', '家族ガチャ', '親子関係', '反抗期', '思春期', 'きょうだい仲', '家庭事情', '実家問題', '親の介護', '家庭の事情', '家族会議', '里帰り', 'ひとり親', '共働き', '家族に言えない', '家族と合わない'],
    pattern: /家族|家庭|両親|父親|母親|父|母|子ども|子供|育児|家事|同居|住宅|住まい|引っ越し|家庭環境|夫|妻|夫婦|親子|義理|嫁|姑|兄弟|姉妹|親ガチャ|毒親|実家暮らし|家族仲|親子げんか|夫婦げんか|ワンオペ|家事分担|育児疲れ|介護疲れ|同居しんどい|家に帰りたくない|家庭内別居|子育て|生活環境|家族ガチャ|親子関係|反抗期|思春期|きょうだい仲|家庭事情|実家問題|親の介護|家庭の事情|家族会議|里帰り|ひとり親|共働き|家族に言えない|家族と合わない/
  },
  {
    key: 'career', label: '仕事・キャリアの悩み', monster: 'career',
    seedText: ['社畜', 'ブラック企業', 'ホワイト企業', '仕事辞めたい', '転職したい', '就活', 'ガクチカ', '働きたくない', 'やりがい迷子', '出世欲', '窓際族', 'リモートワーク', 'テレワーク', 'キャリア迷子', '職場ガチャ', '会社行きたくない', '仕事できない', '無職', 'フリーター', 'サビ残', 'パワハラ', 'セクハラ', '人手不足', '給料上がらない', '評価されない', '仕事が合わない', '転職活動', '就職氷河期', '働き方迷子', '副業したい'],
    pattern: /仕事|キャリア|転職|職場|昇進|昇格|退職|やりがい|残業|異動|部署|職業|就職|労働時間|働き方|上長|評価|人事|給与交渉|副業|独立|起業|社畜|ブラック企業|ホワイト企業|仕事辞めたい|転職したい|就活|ガクチカ|働きたくない|やりがい迷子|出世欲|窓際族|リモートワーク|テレワーク|キャリア迷子|職場ガチャ|会社行きたくない|仕事できない|無職|フリーター|サビ残|パワハラ|セクハラ|人手不足|給料上がらない|評価されない|仕事が合わない|転職活動|就職氷河期|働き方迷子|副業したい/
  },
  {
    key: 'money', label: 'お金・経済の悩み', monster: 'money',
    seedText: ['金欠', 'カツカツ', '貯金ゼロ', 'お金ない', '散財', '浪費癖', '推し活費', '課金', 'リボ払い', 'キャッシング', '家計簿', '給料安い', '値上げ', 'コスパ', 'タイパより金', '財布ピンチ', 'お金足りない', '生活苦', '金銭感覚', '爆買い', 'サブスク貧乏', '固定費高い', '奨学金返済', '税金高い', '物価高', '円安', '貯金したい', '投資詐欺', '資金繰り', '割り勘'],
    pattern: /お金|収入|借金|貯金|投資|家計|支払い|節約|ローン|支出|生活費|借入|資産|財務|返済|経済的な不安|給料|年収|税金|保険料|物価|金欠|カツカツ|貯金ゼロ|お金ない|散財|浪費癖|推し活費|課金|リボ払い|キャッシング|家計簿|給料安い|値上げ|コスパ|タイパより金|財布ピンチ|お金足りない|生活苦|金銭感覚|爆買い|サブスク貧乏|固定費高い|奨学金返済|税金高い|物価高|円安|貯金したい|投資詐欺|資金繰り|割り勘/
  },
  {
    key: 'health', label: '健康・心身の悩み', monster: 'health',
    seedText: ['メンタルやばい', '病み', 'しんどい', '限界', '体調ガチャ', '寝不足', '過労', '五月病', '燃え尽き', 'メンタル弱い', '不安障害', '自律神経', '食欲不振', 'だるい', '気分が落ちる', 'メンタル崩壊', '病み期', '体バキバキ', '疲労困憊', '寝落ち', '睡眠不足', '体調崩した', '気持ちが沈む', '心が折れる', 'ストレス限界', '鬱っぽい', '自分を責める', '食べ過ぎ', '過呼吸', '医者行く'],
    pattern: /健康|体調|睡眠|精神|ストレス|病気|疲れ|不安|うつ|心身|運動|ダイエット|休息|メンタルヘルス|疲労|体調不良|頭痛|腰痛|不眠|通院|薬|メンタルやばい|病み|しんどい|限界|体調ガチャ|寝不足|過労|五月病|燃え尽き|メンタル弱い|不安障害|自律神経|食欲不振|だるい|気分が落ちる|メンタル崩壊|病み期|体バキバキ|疲労困憊|寝落ち|睡眠不足|体調崩した|気持ちが沈む|心が折れる|ストレス限界|鬱っぽい|自分を責める|食べ過ぎ|過呼吸|医者行く/
  },
  {
    key: 'self', label: '生き方・自己実現の悩み', monster: 'self',
    seedText: ['人生迷子', '自分探し', '何者かになりたい', '自己肯定感', '承認欲求', '意識高い系', '成長したい', '夢がない', '目標迷子', '将来不安', '生きる意味', '自分らしく', '適職探し', 'やりたいこと迷子', 'ポジティブになれない', '自己嫌悪', '劣等感', '他人と比べる', '迷走', '無気力', 'やる気出ない', '才能ない', '普通になりたい', '人生のレール', '価値観迷子', '人生詰んだ', '自分軸', '自己分析', '挫折', '再出発'],
    pattern: /生き方|自己実現|夢|目標|価値観|人生|存在意義|モチベーション|使命|方向性|将来像|自己成長|自分らしさ|生きがい|アイデンティティ|人生迷子|自分探し|何者かになりたい|自己肯定感|承認欲求|意識高い系|成長したい|夢がない|目標迷子|将来不安|生きる意味|自分らしく|適職探し|やりたいこと迷子|ポジティブになれない|自己嫌悪|劣等感|他人と比べる|迷走|無気力|やる気出ない|才能ない|普通になりたい|人生のレール|価値観迷子|人生詰んだ|自分軸|自己分析|挫折|再出発/
  },
  {
    key: 'time', label: '時間の悩み', monster: 'time',
    seedText: ['時間足りない', '秒で終わる', '予定詰めすぎ', 'バタバタ', 'てんてこ舞い', '朝起きられない', '寝坊', '遅刻しそう', '締切ギリギリ', '後回し癖', 'ダラダラ', 'タイパ重視', '時間泥棒', '暇がない', 'スケジュール崩壊', '時間溶ける', '時間に追われる', '寝落ち', '予定パンパン', '朝弱い', '時間配分下手', '締切怖い', '期限ギリ', 'すぐ後回し', '時間が溶ける', '余裕ない', '予定かぶり', 'スケジュール管理', '忙しすぎ', '休む暇ない'],
    pattern: /時間|期限|予定|スケジュール|遅刻|忙しい|余裕|時間がない|時間管理|タイムマネジメント|時間配分|時間の浪費|締め切り|先延ばし|時間足りない|秒で終わる|予定詰めすぎ|バタバタ|てんてこ舞い|朝起きられない|寝坊|遅刻しそう|締切ギリギリ|後回し癖|ダラダラ|タイパ重視|時間泥棒|暇がない|スケジュール崩壊|時間溶ける|時間に追われる|寝落ち|予定パンパン|朝弱い|時間配分下手|締切怖い|期限ギリ|すぐ後回し|時間が溶ける|余裕ない|予定かぶり|スケジュール管理|忙しすぎ|休む暇ない/
  },
  {
    key: 'digital', label: 'デジタルの悩み', monster: 'digital',
    seedText: ['スマホ依存', 'SNS疲れ', 'バズりたい', '炎上', '既読通知', 'Wi-Fi弱い', '通信制限', 'パスワード忘れ', 'アカウント乗っ取り', 'ログインできない', 'ググる', 'ポチる', 'デジタルデトックス', 'ネット民', 'ソシャゲ', 'スマホ見すぎ', 'SNS見る', '通知地獄', 'DM', 'フォロワー', 'いいね', 'リプ', 'アカウント凍結', 'なりすまし', '個人情報', 'パケ死', 'バッテリー切れ', 'アプデ', 'バグ', 'オンライン疲れ'],
    pattern: /デジタル|スマホ|SNS|ネット|インターネット|IT|アプリ|パソコン|操作|通信|画面|機器|オンライン|セキュリティ|パスワード|通知疲れ|依存|スマホ依存|SNS疲れ|バズりたい|炎上|既読通知|Wi-Fi弱い|通信制限|パスワード忘れ|アカウント乗っ取り|ログインできない|ググる|ポチる|デジタルデトックス|ネット民|ソシャゲ|スマホ見すぎ|SNS見る|通知地獄|DM|フォロワー|いいね|リプ|アカウント凍結|なりすまし|個人情報|パケ死|バッテリー切れ|アプデ|バグ|オンライン疲れ/
  },
  {
    key: 'study', label: '勉強関係の悩み', monster: 'study',
    seedText: ['勉強垢', 'ガチ勉', '詰んだ', '赤点', '単位落とす', 'ノー勉', '一夜漬け', '暗記できない', '集中できない', '受験生', '浪人', '学校行きたくない', '課題終わらない', 'テスト前', '成績不振', '勉強嫌い', '勉強つらい', '試験落ちそう', '過去問', '模試', '内申', '偏差値', '塾しんどい', '自習', '勉強時間', '眠くて勉強できない', '追試', '単位', 'レポート地獄', '学歴コンプ'],
    pattern: /勉強|テスト|授業|試験|学校|宿題|課題|受験|成績|レポート|学習|塾|勉強法|試験対策|進級|留年|論文|卒論|勉強垢|ガチ勉|詰んだ|赤点|単位落とす|ノー勉|一夜漬け|暗記できない|集中できない|受験生|浪人|学校行きたくない|課題終わらない|テスト前|成績不振|勉強嫌い|勉強つらい|試験落ちそう|過去問|模試|内申|偏差値|塾しんどい|自習|勉強時間|眠くて勉強できない|追試|単位|レポート地獄|学歴コンプ/
  },
  {
    key: 'probability', label: '確率・不確実性の悩み', monster: 'probability',
    seedText: ['ワンチャン', 'ガチャ運', '運ゲー', '当たるか不安', '五分五分', '未知数', '先行き不透明', '神頼み', '一か八か', '賭けに出る', '可能性低い', '確率低い', '読めない', 'どうなるかわからない', 'ランダム', 'もしも', 'ひょっとして', 'もしかしたら', '可能性ある', '望み薄', '先が見えない', '結果待ち', '当落', '抽選', '宝くじ', '期待値', '確率論', 'リスク高い', '不安定', '運任せ'],
    pattern: /確率|可能性|予想|不確実|見込み|運|成否|かもしれない|かも|たぶん|ありえる|パーセント|予測|賭け|リスク|ワンチャン|ガチャ運|運ゲー|当たるか不安|五分五分|未知数|先行き不透明|神頼み|一か八か|賭けに出る|可能性低い|確率低い|読めない|どうなるかわからない|ランダム|もしも|ひょっとして|もしかしたら|可能性ある|望み薄|先が見えない|結果待ち|当落|抽選|宝くじ|期待値|確率論|リスク高い|不安定|運任せ/
  },
  {
    key: 'habit', label: '習慣・行動の悩み', monster: 'habit',
    seedText: ['三日坊主', 'ズボラ', '先延ばし癖', '自堕落', 'だらしない', '朝活', '筋トレ習慣', '禁煙', '断捨離', 'スマホいじり', '夜更かし癖', '継続できない', 'サボり癖', '悪習慣', '生活リズム崩壊', '習慣続かない', '習慣リセット', 'ルーズ', 'めんどくさがり', '飽き性', '寝る前スマホ', '間食', '暴飲暴食', '運動不足', '掃除できない', '整理整頓', '毎日無理', '自己管理', '習慣にしたい', '続けるコツ'],
    pattern: /習慣|行動|生活|ルーティン|続けられない|やめたい|改善|毎日|日常|生活習慣|クセ|習慣化|行動改善|三日坊主|ズボラ|先延ばし癖|自堕落|だらしない|朝活|筋トレ習慣|禁煙|断捨離|スマホいじり|夜更かし癖|継続できない|サボり癖|悪習慣|生活リズム崩壊|習慣続かない|習慣リセット|ルーズ|めんどくさがり|飽き性|寝る前スマホ|間食|暴飲暴食|運動不足|掃除できない|整理整頓|毎日無理|自己管理|習慣にしたい|続けるコツ/
  },
  {
    key: 'leisure', label: '趣味・余暇の悩み', monster: 'normal',
    seedText: ['推し活', 'オタ活', '沼る', '趣味活', '聖地巡礼', 'イベント遠征', '暇つぶし', '休日難民', '遊びたい', '旅行ロス', 'ゲーム三昧', '映画鑑賞', 'カラオケ', 'キャンプ', 'チルする', '推し', 'オタク', '趣味友', '趣味がない', '休日何する', 'レジャー', 'フェス', 'ライブ', '漫画', 'アニメ', '読書', '写真', 'DIY', 'サウナ', 'まったり'],
    pattern: /趣味|遊び|旅行|休日|余暇|映画|音楽|ゲーム|アウトドア|散歩|スポーツ|リラックス|休み|娯楽|推し活|オタ活|沼る|趣味活|聖地巡礼|イベント遠征|暇つぶし|休日難民|遊びたい|旅行ロス|ゲーム三昧|映画鑑賞|カラオケ|キャンプ|チルする|推し|オタク|趣味友|趣味がない|休日何する|レジャー|フェス|ライブ|漫画|アニメ|読書|写真|DIY|サウナ|まったり/
>>>>>>> c91799d0cef0302551d421f600adc71353a0427f
  }
];

const UNKNOWN_CATEGORY = { key: 'unknown', label: 'その他', monster: 'normal' };

// ==== チューニングパラメータ ====
const MIN_SCORE_THRESHOLD = 1;      // これ未満なら unknown
const MULTI_CATEGORY_RATIO = 0.6;   // 2位が1位のこの割合以上なら「複合カテゴリ」とみなす

function normalizeText(text) {
  return String(text ?? '').trim().toLowerCase()
    .replace(/[！!？?。.,、・()\[\]「」『』\s]+/g, ' ')
    .replace(/ー+/g, ' ')
    .replace(/\s+/g, ' ');
}

// ==== トライ木の構築(モジュール読み込み時に1回だけ実行) ====
function buildKeywordTrie(categoryList) {
  const root = { children: new Map(), matches: null };

  categoryList.forEach((category, categoryIndex) => {
    category.keywords.forEach(({ word, weight }) => {
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

const KEYWORD_TRIE = buildKeywordTrie(categories);

/**
 * テキストを1回だけ走査し、全カテゴリのスコアを同時に計算する。
 *
 * 【最長一致(maximal munch)】
 * 各開始位置では、トライ木を辿れるだけ深く辿り、
 * 「一致した単語」のうち一番長いものだけを採用する(= lastMatchで上書きしていく)。
 * 例:「職場の人間関係」というテキストに対して、
 *   - 「職場」(career, weight1) は "職場の人間関係" の接頭辞に過ぎない
 *   - 「職場の人間関係」(human, weight4) が最長一致
 * なので、この開始位置では human の+4だけを採用し、career の+1は捨てる。
 * これにより、長い具体的なフレーズの一部でしかない短い単語による
 * 無関係カテゴリへの誤加点を防ぐ。
 */
function computeCategoryScores(normalizedText) {
  const scores = new Array(categories.length).fill(0);
  const length = normalizedText.length;

  for (let start = 0; start < length; start++) {
    let node = KEYWORD_TRIE;
    let lastMatch = null; // この開始位置でこれまでに見つかった最長一致

    for (let i = start; i < length; i++) {
      const next = node.children.get(normalizedText[i]);
      if (!next) break; // これ以上長い単語には一致しないので打ち切り
      node = next;
      if (node.matches) {
        lastMatch = node.matches; // より長い一致が見つかるたびに上書き
      }
    }

    if (lastMatch) {
      for (const { categoryIndex, weight } of lastMatch) {
        scores[categoryIndex] += weight;
      }
    }
  }

  return scores;
}

// 全カテゴリのスコアを計算し、降順にソートして返す
function scoreAllCategoriesByRules(text) {
  const normalized = normalizeText(text);
  const scores = computeCategoryScores(normalized);
  return categories
    .map((category, index) => ({ category, score: scores[index] }))
    .sort((a, b) => b.score - a.score);
}

/**
 * ルールベース分類。
 * 1位のカテゴリと僅差の2位がいる場合は、「複合カテゴリ」として
 * primary/secondary の両方を返す(secondary は該当なしなら null)。
 * 戻り値は primary カテゴリのプロパティ(key/label/monster)をそのまま持つので、
 * 既存コードが `result.key` のように使っても壊れない。
 */
function classifyCategoryByRules(text) {
  const ranked = scoreAllCategoriesByRules(text);
  const top = ranked[0];

  if (!top || top.score < MIN_SCORE_THRESHOLD) {
    return { ...UNKNOWN_CATEGORY, secondary: null, scores: ranked };
  }

  const second = ranked[1];
  const isMulti =
    second &&
    second.score >= MIN_SCORE_THRESHOLD &&
    second.score >= top.score * MULTI_CATEGORY_RATIO;

  return {
    ...top.category,
    secondary: isMulti ? second.category : null,
    scores: ranked, // デバッグ・チューニング用に全カテゴリのスコアも持たせておく
  };
}

function classifyCategory(text) {
  return classifyCategoryByRules(text);
}

// 互換性のために元の関数名を維持(monster.js等の呼び出し元を変更しなくて済むように)。
async function classifyCategoryWithVectors(text) {
  return classifyCategoryByRules(text);
}
