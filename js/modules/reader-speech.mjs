export function resolveReaderStartIndex(verses, selectedVerseNum = null) {
  if (!Array.isArray(verses) || verses.length === 0) return -1;
  const selected = Number(selectedVerseNum);
  if (selectedVerseNum !== null && selectedVerseNum !== "" && Number.isFinite(selected)) {
    const index = verses.findIndex(item => Number(item.verseNum) === selected);
    if (index >= 0) return index;
  }
  return 0;
}

export function selectPreferredVoice(voices = [], targetLang = "zh-TW", options = {}) {
  if (!Array.isArray(voices) || voices.length === 0) return null;

  const { preferredVoiceURI = "", preferredGender = "auto" } = options;

  // 1. If explicit voiceURI is requested, match it first
  if (preferredVoiceURI) {
    const matched = voices.find(v => v.voiceURI === preferredVoiceURI || v.name === preferredVoiceURI);
    if (matched) return matched;
  }

  const isEnglish = String(targetLang || "").toLowerCase().startsWith("en");

  const score = voice => {
    const lang = String(voice?.lang || "").toLowerCase();
    const name = String(voice?.name || "").toLowerCase();
    let value = 0;

    if (isEnglish) {
      if (lang === "en-us" || lang === "en-gb") value += 120;
      else if (lang.startsWith("en")) value += 90;
      else return -1000;

      if (/natural|neural|online/.test(name)) value += 80;
      if (/samantha|ava|andrew|daniel|karen|victoria|alex|google/.test(name)) value += 40;
      if (/premium|enhanced/.test(name)) value += 30;
      if (/compact|espeak|robotic/.test(name)) value -= 80;
    } else {
      if (lang === "zh-tw" || lang === "zh-hant-tw") value += 120;
      else if (lang.includes("hant")) value += 105;
      else if (lang === "zh-hk") value += 90;
      else if (lang.startsWith("zh")) value += 70;
      else return -1000;

      // Gender affinity matching if specified
      if (preferredGender === "female") {
        if (/female|hsiaochen|mei-jia|yating|ting-ting|sin-ji|xiaoxiao|xiaoyi|hanhan/.test(name)) value += 150;
        if (/male|yunjhe|yun-lin|yunfeng|yunhao|kangkang/.test(name)) value -= 100;
      } else if (preferredGender === "male") {
        if (/male|yunjhe|yun-lin|yunfeng|yunhao|kangkang|daniel|david/.test(name)) value += 150;
        if (/female|hsiaochen|mei-jia|yating|ting-ting|sin-ji|xiaoxiao|xiaoyi/.test(name)) value -= 100;
      }

      if (/natural|neural|online/.test(name)) value += 80;
      if (/hsiaochen|yunjhe|ting-ting|mei-jia|sin-ji|yating|google/.test(name)) value += 40;
      if (/premium|enhanced/.test(name)) value += 30;
      if (/compact|espeak|robotic/.test(name)) value -= 80;
    }

    if (voice?.default) value += 5;
    return value;
  };

  const ranked = [...voices].sort((a, b) => score(b) - score(a));
  return score(ranked[0]) > -1000 ? ranked[0] : null;
}

export function selectPreferredChineseVoice(voices = [], options = {}) {
  return selectPreferredVoice(voices, "zh-TW", options);
}

export function getReaderSpeechRate(targetLang = "zh-TW", customRate = null) {
  if (customRate !== null && customRate !== undefined && Number.isFinite(Number(customRate))) {
    return Math.max(0.5, Math.min(2.0, Number(customRate)));
  }
  const lang = String(targetLang || "").toLowerCase();
  return lang.startsWith("en") ? 0.88 : 0.82;
}
