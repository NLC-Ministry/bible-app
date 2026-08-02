export function resolveReaderStartIndex(verses, selectedVerseNum = null) {
  if (!Array.isArray(verses) || verses.length === 0) return -1;
  const selected = Number(selectedVerseNum);
  if (selectedVerseNum !== null && selectedVerseNum !== "" && Number.isFinite(selected)) {
    const index = verses.findIndex(item => Number(item.verseNum) === selected);
    if (index >= 0) return index;
  }
  return 0;
}

export function selectPreferredChineseVoice(voices = []) {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const score = voice => {
    const lang = String(voice?.lang || "").toLowerCase();
    const name = String(voice?.name || "").toLowerCase();
    let value = 0;
    if (lang === "zh-tw" || lang === "zh-hant-tw") value += 120;
    else if (lang.includes("hant")) value += 105;
    else if (lang === "zh-hk") value += 90;
    else if (lang.startsWith("zh")) value += 70;
    else return -1000;
    if (/natural|neural|premium|enhanced|online/.test(name)) value += 60;
    if (/google|microsoft|apple/.test(name)) value += 25;
    if (/hsiaochen|yating|meijia|taiwan|taipei/.test(name)) value += 20;
    if (/compact|espeak/.test(name)) value -= 40;
    if (voice?.default) value += 3;
    return value;
  };
  const ranked = [...voices].sort((a, b) => score(b) - score(a));
  return score(ranked[0]) > -1000 ? ranked[0] : null;
}
