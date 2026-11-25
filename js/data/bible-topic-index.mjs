// 經文主題索引（#714 第 1 階段）：會友在經文搜尋框輸入「憂慮的時候」這類問句時，
// 比對主題名稱與同義詞，列出「相關主題」標籤，點了再列出經文。
//
// - 只存章節位置，不存經文：顯示時用會友目前選的版本讀經文（避開譯本版權）。
// - refs 用 BIBLE_BOOKS 的英文書名：「Book 章:節」或「Book 章:節-節」，同一章內。
// - terms 是會友可能輸入的詞；單一個字（例如「愛」）只在整個問句就是那個字時才算命中。
// - 刻意不收「自殺／想死／離婚」這類敏感詞：搜到時該不該加關懷聯絡方式要另外討論（見 #714）。
//
// 狀態：草稿。主題、同義詞、經文都還要請牧者審過；審完把 BIBLE_TOPIC_INDEX_STATUS 改成 "reviewed"，
// 再到 Vercel 正式站把 TOPIC_SEARCH_ENABLED 打開。
export const BIBLE_TOPIC_INDEX_STATUS = "draft";

export const BIBLE_TOPICS = [
  {
    id: "anxiety",
    name: "憂慮",
    en: "Anxiety",
    terms: ["憂慮", "擔心", "掛慮", "焦慮", "煩惱", "不安", "緊張", "睡不著", "失眠", "anxiety", "anxious", "worry", "worried"],
    refs: ["Philippians 4:6-7", "1 Peter 5:7", "Matthew 6:34", "Matthew 6:25-27", "Psalms 55:22", "Psalms 94:19", "Psalms 4:8", "John 14:27"]
  },
  {
    id: "fear",
    name: "懼怕",
    en: "Fear",
    terms: ["懼怕", "害怕", "恐懼", "驚慌", "膽怯", "好怕", "很怕", "fear", "afraid", "scared"],
    refs: ["Isaiah 41:10", "Joshua 1:9", "Psalms 23:4", "Psalms 27:1", "Psalms 56:3", "2 Timothy 1:7", "1 John 4:18", "Psalms 46:1-2"]
  },
  {
    id: "peace",
    name: "平安",
    en: "Peace",
    terms: ["平安", "安寧", "安穩", "心安", "平靜", "peace"],
    refs: ["John 14:27", "John 16:33", "Philippians 4:7", "Isaiah 26:3", "Numbers 6:24-26", "Colossians 3:15", "Romans 5:1"]
  },
  {
    id: "grief",
    name: "悲傷",
    en: "Grief",
    terms: ["悲傷", "傷心", "難過", "哀傷", "哭泣", "失去", "喪親", "過世", "去世", "安慰", "grief", "sad", "mourn", "comfort"],
    refs: ["Matthew 5:4", "Psalms 34:18", "Psalms 147:3", "2 Corinthians 1:3-4", "Revelation 21:4", "John 11:25-26", "1 Thessalonians 4:13-14"]
  },
  {
    id: "discouragement",
    name: "沮喪",
    en: "Discouragement",
    terms: ["沮喪", "憂鬱", "灰心", "低落", "絕望", "失望", "心累", "提不起勁", "depression", "depressed", "discouraged", "despair"],
    refs: ["Psalms 42:11", "Psalms 34:17-18", "Psalms 40:1-2", "2 Corinthians 4:8-9", "Lamentations 3:22-23", "Isaiah 40:31", "Matthew 11:28-30"]
  },
  {
    id: "weariness",
    name: "疲倦",
    en: "Weariness",
    terms: ["疲倦", "疲累", "好累", "很累", "疲憊", "重擔", "壓力", "勞苦", "休息", "安息", "tired", "weary", "rest", "stress"],
    refs: ["Matthew 11:28-30", "Isaiah 40:29-31", "Psalms 23:1-3", "Exodus 33:14", "Galatians 6:9", "2 Corinthians 4:16"]
  },
  {
    id: "forgiveness",
    name: "饒恕",
    en: "Forgiveness",
    terms: ["饒恕", "原諒", "赦免", "寬恕", "赦罪", "認罪", "forgive", "forgiveness"],
    refs: ["Ephesians 4:32", "Colossians 3:13", "Matthew 6:14-15", "Matthew 18:21-22", "1 John 1:9", "Psalms 103:12"]
  },
  {
    id: "love",
    name: "愛",
    en: "Love",
    terms: ["愛", "神的愛", "彼此相愛", "愛人", "愛心", "被愛", "love"],
    refs: ["John 3:16", "1 Corinthians 13:4-7", "Romans 8:38-39", "Romans 5:8", "1 John 4:7-8", "1 John 4:19", "John 13:34-35"]
  },
  {
    id: "faith",
    name: "信心",
    en: "Faith",
    terms: ["信心", "相信", "信靠", "倚靠", "懷疑", "faith", "trust", "doubt"],
    refs: ["Hebrews 11:1", "Hebrews 11:6", "Proverbs 3:5-6", "Mark 9:23-24", "Mark 11:22-24", "Romans 10:17", "James 1:5-6"]
  },
  {
    id: "hope",
    name: "盼望",
    en: "Hope",
    terms: ["盼望", "希望", "指望", "未來", "前途", "hope", "future"],
    refs: ["Jeremiah 29:11", "Romans 15:13", "Romans 5:3-5", "Romans 8:28", "Hebrews 6:19", "Lamentations 3:24-26", "Psalms 42:5"]
  },
  {
    id: "prayer",
    name: "禱告",
    en: "Prayer",
    terms: ["禱告", "祈禱", "祈求", "代禱", "求告", "prayer", "pray"],
    refs: ["Philippians 4:6", "1 Thessalonians 5:16-18", "Matthew 7:7-8", "Jeremiah 33:3", "Matthew 6:6", "James 5:16", "1 John 5:14-15", "Matthew 6:9-13"]
  },
  {
    id: "thanksgiving",
    name: "感恩",
    en: "Thanksgiving",
    terms: ["感恩", "感謝", "謝恩", "稱謝", "thanks", "thankful", "grateful", "thanksgiving"],
    refs: ["1 Thessalonians 5:18", "Psalms 100:4", "Psalms 107:1", "Psalms 103:2", "Colossians 3:17", "Ephesians 5:20"]
  },
  {
    id: "joy",
    name: "喜樂",
    en: "Joy",
    terms: ["喜樂", "快樂", "開心", "歡喜", "joy", "happy"],
    refs: ["Philippians 4:4", "Nehemiah 8:10", "Psalms 16:11", "John 15:11", "Psalms 30:5", "James 1:2-3", "Romans 15:13"]
  },
  {
    id: "temptation",
    name: "試探",
    en: "Temptation",
    terms: ["試探", "誘惑", "情慾", "慾望", "色情", "上癮", "temptation", "tempted", "lust"],
    refs: ["1 Corinthians 10:13", "James 1:12-15", "Matthew 26:41", "Hebrews 4:15-16", "James 4:7", "Psalms 119:9-11"]
  },
  {
    id: "suffering",
    name: "苦難",
    en: "Suffering",
    terms: ["苦難", "試煉", "患難", "痛苦", "受苦", "困難", "逆境", "挫折", "suffering", "trial", "trouble", "hardship"],
    refs: ["Romans 8:28", "Romans 8:18", "James 1:2-4", "Romans 5:3-5", "2 Corinthians 12:9-10", "1 Peter 4:12-13", "John 16:33", "Psalms 46:1"]
  },
  {
    id: "healing",
    name: "醫治",
    en: "Healing",
    terms: ["醫治", "生病", "疾病", "病痛", "痊癒", "癌症", "開刀", "手術", "住院", "healing", "sick", "illness"],
    refs: ["James 5:14-15", "Jeremiah 17:14", "Psalms 103:2-3", "Psalms 41:3", "Isaiah 53:5", "Exodus 15:26", "2 Corinthians 4:16"]
  },
  {
    id: "marriage",
    name: "婚姻",
    en: "Marriage",
    terms: ["婚姻", "夫妻", "結婚", "丈夫", "妻子", "太太", "老公", "老婆", "配偶", "marriage", "husband", "wife"],
    refs: ["Genesis 2:24", "Ephesians 5:25", "Ephesians 5:33", "Colossians 3:18-19", "Ecclesiastes 4:9-12", "Hebrews 13:4", "Matthew 19:6", "1 Corinthians 13:4-7"]
  },
  {
    id: "family",
    name: "家庭",
    en: "Family",
    terms: ["家庭", "家人", "父母", "孩子", "兒女", "小孩", "教養", "孝順", "管教", "family", "parents", "children"],
    refs: ["Ephesians 6:1-4", "Proverbs 22:6", "Exodus 20:12", "Deuteronomy 6:6-7", "Colossians 3:20-21", "Joshua 24:15", "Psalms 127:3"]
  },
  {
    id: "work",
    name: "工作",
    en: "Work",
    terms: ["工作", "上班", "職場", "事業", "老闆", "同事", "失業", "找工作", "work", "job", "career"],
    refs: ["Colossians 3:23-24", "Proverbs 16:3", "Ecclesiastes 9:10", "Psalms 90:17", "Proverbs 22:29", "2 Thessalonians 3:10", "Matthew 6:33"]
  },
  {
    id: "provision",
    name: "供應",
    en: "Provision",
    terms: ["供應", "錢", "金錢", "財務", "經濟", "缺乏", "貧窮", "債務", "奉獻", "十一奉獻", "money", "provision", "debt", "giving"],
    refs: ["Philippians 4:19", "Matthew 6:33", "Psalms 23:1", "Hebrews 13:5", "Luke 12:15", "1 Timothy 6:10", "Proverbs 3:9-10", "Malachi 3:10"]
  },
  {
    id: "guidance",
    name: "帶領",
    en: "Guidance",
    terms: ["帶領", "引導", "方向", "選擇", "決定", "旨意", "迷惘", "迷失", "guidance", "decision", "direction", "will of god"],
    refs: ["Proverbs 3:5-6", "Proverbs 16:9", "Psalms 32:8", "Psalms 119:105", "Isaiah 30:21", "Romans 12:2", "James 1:5"]
  },
  {
    id: "wisdom",
    name: "智慧",
    en: "Wisdom",
    terms: ["智慧", "聰明", "知識", "wisdom", "wise"],
    refs: ["James 1:5", "Proverbs 1:7", "Proverbs 9:10", "Proverbs 2:6", "James 3:17", "Colossians 3:16"]
  },
  {
    id: "loneliness",
    name: "孤單",
    en: "Loneliness",
    terms: ["孤單", "寂寞", "孤獨", "一個人", "被拋棄", "被排擠", "沒人懂", "lonely", "alone", "loneliness"],
    refs: ["Deuteronomy 31:6", "Hebrews 13:5", "Psalms 27:10", "Matthew 28:20", "Psalms 25:16", "Psalms 68:6", "Isaiah 41:10"]
  },
  {
    id: "salvation",
    name: "救恩",
    en: "Salvation",
    terms: ["救恩", "得救", "救贖", "信主", "重生", "salvation", "saved"],
    refs: ["John 3:16", "Romans 10:9-10", "Ephesians 2:8-9", "Romans 6:23", "Romans 3:23", "Acts 4:12", "John 14:6", "2 Corinthians 5:17"]
  },
  {
    id: "anger",
    name: "憤怒",
    en: "Anger",
    terms: ["憤怒", "生氣", "發怒", "脾氣", "怒氣", "anger", "angry"],
    refs: ["James 1:19-20", "Ephesians 4:26-27", "Ephesians 4:31-32", "Proverbs 15:1", "Proverbs 29:11", "Psalms 37:8"]
  },
  {
    id: "humility",
    name: "謙卑",
    en: "Humility",
    terms: ["謙卑", "謙虛", "驕傲", "自大", "humility", "humble", "pride"],
    refs: ["Philippians 2:3-4", "James 4:6", "1 Peter 5:5-6", "Proverbs 16:18", "Micah 6:8", "Matthew 23:12"]
  },
  {
    id: "strength",
    name: "力量",
    en: "Strength",
    terms: ["力量", "剛強", "軟弱", "無力", "堅強", "strength", "weak"],
    refs: ["Philippians 4:13", "Isaiah 40:31", "2 Corinthians 12:9", "Psalms 46:1", "Psalms 73:26", "Nehemiah 8:10", "Isaiah 41:10"]
  },
  {
    id: "patience",
    name: "等候",
    en: "Waiting",
    terms: ["等候", "等待", "忍耐", "耐心", "patience", "wait"],
    refs: ["Psalms 27:14", "Psalms 37:7", "Isaiah 40:31", "Psalms 40:1", "Romans 12:12", "James 5:7-8", "Galatians 6:9", "Lamentations 3:25-26"]
  },
  {
    id: "relationships",
    name: "人際關係",
    en: "Relationships",
    terms: ["人際關係", "人際", "朋友", "友誼", "衝突", "和好", "吵架", "背叛", "friend", "friendship", "conflict"],
    refs: ["Romans 12:18", "Matthew 5:23-24", "Proverbs 17:17", "Proverbs 18:24", "Proverbs 27:17", "John 15:13", "Ecclesiastes 4:9-10", "Psalms 41:9"]
  },
  {
    id: "eternal-life",
    name: "永生",
    en: "Eternal life",
    terms: ["永生", "復活", "死亡", "死後", "天堂", "天家", "eternal life", "heaven", "resurrection", "death"],
    refs: ["John 11:25-26", "John 14:2-3", "1 Corinthians 15:55-57", "1 Thessalonians 4:16-17", "Revelation 21:4", "Philippians 1:21", "2 Corinthians 5:1"]
  }
];
