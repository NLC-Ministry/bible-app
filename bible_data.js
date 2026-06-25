// Bible Data: 66 Books of the Chinese Union Version (CUV)
const BIBLE_BOOKS = [
  // Old Testament (39 books)
  { id: 1, name: "創世記", abbrev: "創", eng: "Genesis", chapters: 50, section: "old" },
  { id: 2, name: "出埃及記", abbrev: "出", eng: "Exodus", chapters: 40, section: "old" },
  { id: 3, name: "利未記", abbrev: "利", eng: "Leviticus", chapters: 27, section: "old" },
  { id: 4, name: "民數記", abbrev: "民", eng: "Numbers", chapters: 36, section: "old" },
  { id: 5, name: "申命記", abbrev: "申", eng: "Deuteronomy", chapters: 34, section: "old" },
  { id: 6, name: "約書亞記", abbrev: "書", eng: "Joshua", chapters: 24, section: "old" },
  { id: 7, name: "士師記", abbrev: "士", eng: "Judges", chapters: 21, section: "old" },
  { id: 8, name: "路得記", abbrev: "得", eng: "Ruth", chapters: 4, section: "old" },
  { id: 9, name: "撒母耳記上", abbrev: "撒上", eng: "1 Samuel", chapters: 31, section: "old" },
  { id: 10, name: "撒母耳記下", abbrev: "撒下", eng: "2 Samuel", chapters: 24, section: "old" },
  { id: 11, name: "列王紀上", abbrev: "王上", eng: "1 Kings", chapters: 22, section: "old" },
  { id: 12, name: "列王紀下", abbrev: "王下", eng: "2 Kings", chapters: 25, section: "old" },
  { id: 13, name: "歷代志上", abbrev: "代上", eng: "1 Chronicles", chapters: 29, section: "old" },
  { id: 14, name: "歷代志下", abbrev: "代下", eng: "2 Chronicles", chapters: 36, section: "old" },
  { id: 15, name: "以斯拉記", abbrev: "拉", eng: "Ezra", chapters: 10, section: "old" },
  { id: 16, name: "尼希米記", abbrev: "尼", eng: "Nehemiah", chapters: 13, section: "old" },
  { id: 17, name: "以斯帖記", abbrev: "帖", eng: "Esther", chapters: 10, section: "old" },
  { id: 18, name: "約伯記", abbrev: "伯", eng: "Job", chapters: 42, section: "old" },
  { id: 19, name: "詩篇", abbrev: "詩", eng: "Psalms", chapters: 150, section: "old" },
  { id: 20, name: "箴言", abbrev: "箴", eng: "Proverbs", chapters: 31, section: "old" },
  { id: 21, name: "傳道書", abbrev: "傳", eng: "Ecclesiastes", chapters: 12, section: "old" },
  { id: 22, name: "雅歌", abbrev: "歌", eng: "Song of Solomon", chapters: 8, section: "old" },
  { id: 23, name: "以賽亞書", abbrev: "賽", eng: "Isaiah", chapters: 66, section: "old" },
  { id: 24, name: "耶利米書", abbrev: "耶", eng: "Jeremiah", chapters: 52, section: "old" },
  { id: 25, name: "耶利米哀歌", abbrev: "哀", eng: "Lamentations", chapters: 5, section: "old" },
  { id: 26, name: "以西結書", abbrev: "結", eng: "Ezekiel", chapters: 48, section: "old" },
  { id: 27, name: "但以理書", abbrev: "但", eng: "Daniel", chapters: 12, section: "old" },
  { id: 28, name: "何西阿書", abbrev: "何", eng: "Hosea", chapters: 14, section: "old" },
  { id: 29, name: "約珥書", abbrev: "珥", eng: "Joel", chapters: 3, section: "old" },
  { id: 30, name: "阿摩司書", abbrev: "摩", eng: "Amos", chapters: 9, section: "old" },
  { id: 31, name: "俄巴底亞書", abbrev: "俄", eng: "Obadiah", chapters: 1, section: "old" },
  { id: 32, name: "約拿書", abbrev: "拿", eng: "Jonah", chapters: 4, section: "old" },
  { id: 33, name: "彌迦書", abbrev: "彌", eng: "Micah", chapters: 7, section: "old" },
  { id: 34, name: "那鴻書", abbrev: "鴻", eng: "Nahum", chapters: 3, section: "old" },
  { id: 35, name: "哈巴谷書", abbrev: "哈", eng: "Habakkuk", chapters: 3, section: "old" },
  { id: 36, name: "西番雅書", abbrev: "番", eng: "Zephaniah", chapters: 3, section: "old" },
  { id: 37, name: "哈該書", abbrev: "該", eng: "Haggai", chapters: 2, section: "old" },
  { id: 38, name: "撒迦利亞書", abbrev: "亞", eng: "Zechariah", chapters: 14, section: "old" },
  { id: 39, name: "瑪拉基書", abbrev: "瑪", eng: "Malachi", chapters: 4, section: "old" },

  // New Testament (27 books)
  { id: 40, name: "馬太福音", abbrev: "太", eng: "Matthew", chapters: 28, section: "new" },
  { id: 41, name: "馬可福音", abbrev: "可", eng: "Mark", chapters: 16, section: "new" },
  { id: 42, name: "路加福音", abbrev: "路", eng: "Luke", chapters: 24, section: "new" },
  { id: 43, name: "約翰福音", abbrev: "約", eng: "John", chapters: 21, section: "new" },
  { id: 44, name: "使徒行傳", abbrev: "徒", eng: "Acts", chapters: 28, section: "new" },
  { id: 45, name: "羅馬書", abbrev: "羅", eng: "Romans", chapters: 16, section: "new" },
  { id: 46, name: "哥林多前書", abbrev: "林前", eng: "1 Corinthians", chapters: 16, section: "new" },
  { id: 47, name: "哥林多後書", abbrev: "林後", eng: "2 Corinthians", chapters: 13, section: "new" },
  { id: 48, name: "加拉太書", abbrev: "加", eng: "Galatians", chapters: 6, section: "new" },
  { id: 49, name: "以弗所書", abbrev: "弗", eng: "Ephesians", chapters: 6, section: "new" },
  { id: 50, name: "腓立比書", abbrev: "腓", eng: "Philippians", chapters: 4, section: "new" },
  { id: 51, name: "歌羅西書", abbrev: "歌", eng: "Colossians", chapters: 4, section: "new" },
  { id: 52, name: "帖撒羅尼迦前書", abbrev: "帖前", eng: "1 Thessalonians", chapters: 5, section: "new" },
  { id: 53, name: "帖撒羅尼迦後書", abbrev: "帖後", eng: "2 Thessalonians", chapters: 3, section: "new" },
  { id: 54, name: "提摩太前書", abbrev: "提前", eng: "1 Timothy", chapters: 6, section: "new" },
  { id: 55, name: "提摩太後書", abbrev: "提後", eng: "2 Timothy", chapters: 4, section: "new" },
  { id: 56, name: "提多書", abbrev: "多", eng: "Titus", chapters: 3, section: "new" },
  { id: 57, name: "腓利門書", abbrev: "門", eng: "Philemon", chapters: 1, section: "new" },
  { id: 58, name: "希伯來書", abbrev: "希", eng: "Hebrews", chapters: 13, section: "new" },
  { id: 59, name: "雅各書", abbrev: "雅", eng: "James", chapters: 5, section: "new" },
  { id: 60, name: "彼得前書", abbrev: "彼前", eng: "1 Peter", chapters: 5, section: "new" },
  { id: 61, name: "彼得後書", abbrev: "彼後", eng: "2 Peter", chapters: 3, section: "new" },
  { id: 62, name: "約翰一書", abbrev: "約一", eng: "1 John", chapters: 5, section: "new" },
  { id: 63, name: "約翰二書", abbrev: "約二", eng: "2 John", chapters: 1, section: "new" },
  { id: 64, name: "約翰三書", abbrev: "約三", eng: "3 John", chapters: 1, section: "new" },
  { id: 65, name: "猶大書", abbrev: "猶", eng: "Jude", chapters: 1, section: "new" },
  { id: 66, name: "啟示錄", abbrev: "啟", eng: "Revelation", chapters: 22, section: "new" }
];

// Fallback offline verses (Genesis 1 & Matthew 1) to ensure instant usability when offline or API fails
const BIBLE_FALLBACK = {
  "Genesis_1": {
    reference: "創世記 1章",
    verses: [
      { verse: 1, text: "起初，神創造天地。" },
      { verse: 2, text: "地是空虛混沌，淵面黑暗；神的靈運行在水面上。" },
      { verse: 3, text: "神說：「要有光」，就有了光。" },
      { verse: 4, text: "神看光是好的，就把光暗分開了。" },
      { verse: 5, text: "神稱光為「晝」，稱暗為「夜」。有晚上，有早晨，這是頭一日。" },
      { verse: 6, text: "神說：「諸水之間要有空氣，將水分為上下。」" },
      { verse: 7, text: "神就造出空氣，將空氣以下的水、空氣以上的水分開了。事就這樣成了。" },
      { verse: 8, text: "神稱空氣為「天」。有晚上，有早晨，是第二日。" },
      { verse: 9, text: "神說：「天下的水要聚在一處，使旱地露出來。」事就這樣成了。" },
      { verse: 10, text: "神稱旱地為「地」，稱水的聚處為「海」。神看著是好的。" }
    ]
  },
  "Matthew_1": {
    reference: "馬太福音 1章",
    verses: [
      { verse: 1, text: "亞伯拉罕的後裔，大衛的子孫，耶穌基督的家譜：" },
      { verse: 2, text: "亞伯拉罕生以撒；以撒生雅各；雅各生猶大和他的弟兄；" },
      { verse: 3, text: "猶大從他瑪氏生法勒斯和謝拉；法勒斯生希士崙；希士崙生亞蘭；" },
      { verse: 4, text: "亞蘭生亞米拿達；亞米拿達生拿順；拿順生撒門；" },
      { verse: 5, text: "撒門從喇合氏生波阿斯；波阿斯從路得氏生俄備得；俄備得生耶西；" },
      { verse: 6, text: "耶西生大衛王。大衛從烏利亞的妻子生所羅門；" },
      { verse: 7, text: "所羅門生羅波安；羅波安生亞比雅；亞比雅生亞撒；" },
      { verse: 8, text: "亞撒生約沙法；約沙法生約蘭；約蘭生烏西雅；" },
      { verse: 9, text: "烏西雅生約坦；約坦生亞哈斯；亞哈斯生希西家；" },
      { verse: 10, text: "希西家生瑪拿西；瑪拿西生亞門；亞門生約西亞；" }
    ]
  }
};

/**
 * Fetches verses for a given book and chapter.
 * @param {string} bookEngName - The English name of the book (e.g. "Genesis").
 * @param {number} chapter - The chapter number.
 * @returns {Promise<{reference: string, verses: Array<{verse: number, text: string}>}>}
 */
async function fetchBibleChapter(bookEngName, chapter) {
  const fallbackKey = `${bookEngName}_${chapter}`;
  
  try {
    // API request URL (using bible-api.com)
    // Note: CUV translation is supported
    const response = await fetch(`https://bible-api.com/${encodeURIComponent(bookEngName)}+${chapter}?translation=cuv`);
    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }
    const data = await response.json();
    
    // Format response to match our expected format
    return {
      reference: data.reference,
      verses: data.verses.map(v => ({
        verse: v.verse,
        text: v.text.trim()
      }))
    };
  } catch (error) {
    console.warn(`Failed to fetch Bible text from API. Falling back to local offline text. Error:`, error);
    if (BIBLE_FALLBACK[fallbackKey]) {
      return BIBLE_FALLBACK[fallbackKey];
    }
    
    // Generic fallback if no specific offline text is available
    return {
      reference: `${bookEngName} ${chapter}章 (離線模式)`,
      verses: [
        { 
          verse: 1, 
          text: `[系統提示] 目前無法載入此章節內容。請確認您的網路連線是否正常。以下提供本地試閱創世記第一章。` 
        },
        ...BIBLE_FALLBACK["Genesis_1"].verses
      ]
    };
  }
}
