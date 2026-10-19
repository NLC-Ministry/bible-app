// 小測驗題目匯入 parser：把管理員貼上的純文字（或讀出來的檔案內容）轉成
// quiz-question-types.mjs 認得的型別化題目格式。純函式、不碰 DOM，方便測試。
//
// 樣板格式（空行分隔每一題，第一行是 [類型] 標籤）：
//   [單選] 題目文字
//   A. 選項一
//   B. 選項二
//   答案：B
//
//   [是非] 敘述文字
//   答案：對
//
//   [多選] 題目文字
//   A. 選項一
//   B. 選項二
//   答案：A,C
//
//   [配對] 題目文字            -- 每行一組「正確配對」，不用另外寫答案
//   亞伯拉罕｜吾珥
//   摩西｜米甸
//
//   [排序] 題目文字            -- 每行依「正確順序」列出，不用另外寫答案
//   創造天地
//   挪亞洪水

const TYPE_TAG_TO_TYPE = {
  "單選": "single",
  "多選": "multiple",
  "是非": "truefalse",
  "配對": "matching",
  "排序": "ordering"
};

const TRUE_WORDS = new Set(["對", "是", "true", "t", "yes", "y", "正確"]);
const FALSE_WORDS = new Set(["錯", "否", "false", "f", "no", "n", "錯誤"]);

function splitBlocks(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map(block => block.trim())
    .filter(Boolean);
}

function splitLines(block) {
  return block.split("\n").map(line => line.trim()).filter(Boolean);
}

function parseOptionLine(line) {
  const match = line.match(/^([A-Za-z])[.、)]\s*(.+)$/);
  return match ? { letter: match[1].toUpperCase(), text: match[2].trim() } : null;
}

function parseAnswerLine(line) {
  const match = line.match(/^答案[:：]\s*(.+)$/);
  return match ? match[1].trim() : null;
}

function parseSingleOrMultiple(lines, type) {
  const stem = lines[0];
  const options = [];
  let answerRaw = null;
  for (const line of lines.slice(1)) {
    const option = parseOptionLine(line);
    if (option) { options.push(option); continue; }
    const answer = parseAnswerLine(line);
    if (answer) { answerRaw = answer; continue; }
  }
  if (!options.length) throw new Error("找不到選項（格式須為「A. 選項文字」）");
  if (!answerRaw) throw new Error("找不到答案（格式須為「答案：B」）");

  const letters = options.map(option => option.letter);
  if (type === "single") {
    const index = letters.indexOf(answerRaw.toUpperCase());
    if (index === -1) throw new Error(`答案「${answerRaw}」不在選項字母中`);
    return {
      type: "single",
      payload: { stem, options: options.map(option => option.text) },
      answerKey: index
    };
  }
  const answerLetters = answerRaw.split(/[,、，\s]+/).filter(Boolean).map(value => value.toUpperCase());
  const indices = answerLetters.map(letter => {
    const index = letters.indexOf(letter);
    if (index === -1) throw new Error(`答案「${letter}」不在選項字母中`);
    return index;
  });
  if (!indices.length) throw new Error("多選題答案不可為空");
  return {
    type: "multiple",
    payload: { stem, options: options.map(option => option.text) },
    answerKey: indices
  };
}

function parseTrueFalse(lines) {
  const stem = lines[0];
  const answerLine = lines.slice(1).map(parseAnswerLine).find(Boolean);
  if (!answerLine) throw new Error("找不到答案（格式須為「答案：對」或「答案：錯」）");
  const normalized = answerLine.trim().toLowerCase();
  if (TRUE_WORDS.has(normalized)) return { type: "truefalse", payload: { stem }, answerKey: true };
  if (FALSE_WORDS.has(normalized)) return { type: "truefalse", payload: { stem }, answerKey: false };
  throw new Error(`無法辨識是非答案「${answerLine}」`);
}

// mergeRight（雲柱才開，#588）：右邊文字相同的列共用同一個右邊點，變成多對一。
// 小測驗的存題驗證（0185）要求一對一，所以預設不合併。
function parseMatching(lines, questionIndex, { mergeRight = false } = {}) {
  const stem = lines[0];
  const pairLines = lines.slice(1);
  if (!pairLines.length) throw new Error("配對題至少需要一組「左｜右」");
  const left = [];
  const right = [];
  const answerKey = {};
  pairLines.forEach((line, pairIndex) => {
    const parts = line.split(/[｜|]/).map(part => part.trim()).filter(Boolean);
    if (parts.length !== 2) throw new Error(`配對行格式錯誤（須為「左文字｜右文字」）：${line}`);
    const leftId = `q${questionIndex}-L${pairIndex + 1}`;
    left.push({ id: leftId, text: parts[0] });
    let rightItem = mergeRight ? right.find(item => item.text === parts[1]) : null;
    if (!rightItem) {
      rightItem = { id: `q${questionIndex}-R${right.length + 1}`, text: parts[1] };
      right.push(rightItem);
    }
    answerKey[leftId] = rightItem.id;
  });
  return { type: "matching", payload: { stem, left, right }, answerKey };
}

function parseOrdering(lines, questionIndex) {
  const stem = lines[0];
  const itemLines = lines.slice(1);
  if (itemLines.length < 2) throw new Error("排序題至少需要 2 個項目");
  const items = itemLines.map((text, itemIndex) => ({ id: `q${questionIndex}-I${itemIndex + 1}`, text }));
  return { type: "ordering", payload: { stem, items }, answerKey: items.map(item => item.id) };
}

/**
 * @param {string} text 貼上的純文字或讀檔出來的字串
 * @param {{mergeMatchingRight?: boolean}} [options] mergeMatchingRight：配對題右邊文字相同就合併成同一個點（雲柱用）
 * @returns {{questions: Array, errors: Array<{index:number, block:string, message:string}>}}
 */
export function parseQuizImportText(text, { mergeMatchingRight = false } = {}) {
  const blocks = splitBlocks(text);
  const questions = [];
  const errors = [];

  blocks.forEach((block, blockIndex) => {
    const tagMatch = block.match(/^\[(.+?)\]\s*/);
    if (!tagMatch) {
      errors.push({ index: blockIndex, block, message: "找不到題型標籤，例如「[單選]」" });
      return;
    }
    const type = TYPE_TAG_TO_TYPE[tagMatch[1].trim()];
    if (!type) {
      errors.push({ index: blockIndex, block, message: `不認得的題型標籤「${tagMatch[1]}」` });
      return;
    }
    const lines = splitLines(block.slice(tagMatch[0].length));
    if (!lines.length) {
      errors.push({ index: blockIndex, block, message: "缺少題目內容" });
      return;
    }
    try {
      let parsed;
      const questionIndex = questions.length + 1;
      if (type === "single" || type === "multiple") parsed = parseSingleOrMultiple(lines, type);
      else if (type === "truefalse") parsed = parseTrueFalse(lines);
      else if (type === "matching") parsed = parseMatching(lines, questionIndex, { mergeRight: mergeMatchingRight });
      else parsed = parseOrdering(lines, questionIndex);
      questions.push({ id: `imported-${questionIndex}`, ...parsed, explanation: "", verseRef: "" });
    } catch (error) {
      errors.push({ index: blockIndex, block, message: error.message });
    }
  });

  return { questions, errors };
}
