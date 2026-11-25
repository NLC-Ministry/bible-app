// 經文「照意思找」的測試題庫（#714 第 0 階段）：會友可能輸入的問句 → 應該找得到的經文。
// 主題索引（第 1 階段）和之後的手機語意搜尋（第 2 階段）都用這份題庫自動量測命中率，
// 取代「拿十幾個問句試試看」的人工驗收。
//
// - expect 列的是「找到其中任何一節就算命中」的經文，用 BIBLE_BOOKS 英文書名，格式同主題索引。
// - 問句刻意用口語，很多不含主題名稱；主題索引答不出來的，正是第 2 階段要補的。
// - 狀態：草稿，問句和期望經文都要請牧者審過。新增問句時不要先看主題索引再寫，以免題目遷就答案。
export const BIBLE_SEARCH_EVAL_SET = [
  { query: "憂慮的時候", expect: ["Philippians 4:6", "1 Peter 5:7", "Matthew 6:34"] },
  { query: "晚上一直睡不著", expect: ["Psalms 4:8", "Psalms 127:2"] },
  { query: "明天要考試很怕", expect: ["Isaiah 41:10", "Philippians 4:6", "Joshua 1:9"] },
  { query: "家人過世好難過", expect: ["Matthew 5:4", "Psalms 34:18", "1 Thessalonians 4:13"] },
  { query: "不知道該不該換工作", expect: ["Proverbs 3:5", "Proverbs 16:9", "James 1:5"] },
  { query: "被好朋友背叛", expect: ["Psalms 41:9", "Psalms 55:12", "Ephesians 4:32"] },
  { query: "沒有錢付房租", expect: ["Philippians 4:19", "Matthew 6:33", "Matthew 6:31"] },
  { query: "跟太太吵架", expect: ["Ephesians 4:26", "Colossians 3:19", "Ephesians 5:25"] },
  { query: "覺得自己一無是處", expect: ["Psalms 139:14", "Ephesians 2:10", "Isaiah 43:4"] },
  { query: "怎樣才能得救", expect: ["Romans 10:9", "Acts 16:31", "Ephesians 2:8"] },
  { query: "如何原諒傷害我的人", expect: ["Matthew 6:14", "Ephesians 4:32", "Colossians 3:13"] },
  { query: "生病了求神醫治", expect: ["James 5:14", "Jeremiah 17:14", "Psalms 103:3"] },
  { query: "孩子都不聽話", expect: ["Proverbs 22:6", "Ephesians 6:4", "Ephesians 6:1"] },
  { query: "工作壓力好大", expect: ["Matthew 11:28", "Colossians 3:23", "Philippians 4:6"] },
  { query: "禱告一直沒有回應", expect: ["Psalms 27:14", "Psalms 40:1", "Luke 18:1"] },
  { query: "控制不了脾氣", expect: ["James 1:19", "Proverbs 29:11", "Ephesians 4:26"] },
  { query: "一個人好寂寞", expect: ["Hebrews 13:5", "Psalms 25:16", "Matthew 28:20"] },
  { query: "抵擋不了誘惑", expect: ["1 Corinthians 10:13", "James 4:7", "Matthew 26:41"] },
  { query: "想要更有智慧", expect: ["James 1:5", "Proverbs 2:6", "Proverbs 9:10"] },
  { query: "人死後會去哪裡", expect: ["John 14:2", "John 11:25", "2 Corinthians 5:1"] },
  { query: "對未來沒有盼望", expect: ["Jeremiah 29:11", "Romans 15:13", "Lamentations 3:22"] },
  { query: "想感謝神", expect: ["1 Thessalonians 5:18", "Psalms 107:1", "Psalms 100:4"] },
  { query: "為什麼好人會受苦", expect: ["Romans 8:28", "1 Peter 4:12", "Romans 8:18"] },
  { query: "覺得好軟弱需要力量", expect: ["Philippians 4:13", "Isaiah 40:31", "2 Corinthians 12:9"] },
  { query: "怎樣愛身邊的人", expect: ["John 13:34", "1 Corinthians 13:4", "1 John 4:7"] },
  { query: "神真的愛我嗎", expect: ["John 3:16", "Romans 5:8", "Romans 8:38"] },
  { query: "做錯事很內疚", expect: ["1 John 1:9", "Psalms 103:12", "Romans 8:1"] },
  { query: "很想放棄", expect: ["Galatians 6:9", "2 Corinthians 4:8", "Isaiah 40:31"] }
];
