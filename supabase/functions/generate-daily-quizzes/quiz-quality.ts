// #414：AI 出題的品質關卡。出題 AI 每個選項都要附經文舉證，這裡用程式比對
// 引文是否真的出現在當日經文、經節是否在當日範圍；再對照另一個 AI 盲審（不給答案）
// 的判定，只留下「恰好一個正確、其餘三個都被經文明確反駁」的題目。
// 獨立成檔是為了讓 vitest 直接測行為（index.ts 本身是 Deno.serve 進入點）。

export type ChapterVerses = { book: string; chapter: number; verses: { verse: number; text: string }[] };
export type VerseIndex = Map<string, Map<number, string>>;
export type OptionEvidence = { verseRef: string; quote: string; reason: string };
export type CandidateQuestion = {
  id: string; question: string; options: string[]; correctIndex: number;
  explanation: string; verseRef: string; evidence: OptionEvidence[];
};
export type ReviewVerdict = "correct" | "incorrect" | "undeterminable";
export type ReviewJudgment = { verdict: ReviewVerdict; verseRef: string; quote: string };
export type QuestionReview = { id: string; judgments: ReviewJudgment[] };

export const CANDIDATE_COUNT = 8;
export const QUIZ_QUESTION_COUNT = 5;
export const MIN_QUOTE_LENGTH = 4;

// 「以上皆是／以上皆非／無法確定」這類選項本身就是模稜兩可的來源。
const BANNED_OPTION = /以上(皆|都|全|各|選項)|皆非|無法(確定|判斷|得知)|不(知道|確定)|(沒有|未|不曾)(提到|提及|記載|說明)/;
// 錯誤選項只因「經文沒提到」而錯，不算被經文反駁（沒提到 ≠ 錯）。
const ABSENCE_REASON = /(沒有|未|並未|不曾)(提到|提及|記載|說到|寫到)/;
const ELLIPSIS = /…+|⋯+|\.{3,}/;
const VERSE_REF = /^(.+?)\s*(\d+)\s*[:：]\s*(\d+)(?:\s*[-–—~～至]\s*(?:(\d+)\s*[:：]\s*)?(\d+))?$/;

const text = (value: unknown) => String(value ?? "").trim();

// 只留文字與數字：標點、空白、全半形差異都不影響比對。
export function normalizeForMatch(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
}

export function formatScripture(chapters: ChapterVerses[]) {
  return chapters.map(chapter =>
    `${chapter.book} ${chapter.chapter} 章\n${chapter.verses.map(verse => `${verse.verse} ${verse.text}`).join("\n")}`
  ).join("\n\n");
}

export function buildVerseIndex(chapters: ChapterVerses[]): VerseIndex {
  const index: VerseIndex = new Map();
  for (const chapter of chapters) {
    const verses = new Map<number, string>();
    for (const verse of chapter.verses) verses.set(Number(verse.verse), normalizeForMatch(verse.text));
    index.set(`${chapter.book}|${chapter.chapter}`, verses);
  }
  return index;
}

// 「書名 章:節」或「書名 章:節-節」；書名必須跟當日經文標題一字不差，且只能在同一章內。
export function parseVerseRef(ref: unknown) {
  const match = text(ref).match(VERSE_REF);
  if (!match) return null;
  const chapter = Number(match[2]);
  const from = Number(match[3]);
  if (match[4] && Number(match[4]) !== chapter) return null;
  const to = match[5] ? Number(match[5]) : from;
  if (!(from >= 1 && to >= from)) return null;
  return { book: match[1].trim(), chapter, from, to };
}

// 經節範圍內的經文（正規化後串起來）；任何一節不在當日經文裡就回 null。
export function versesForRef(ref: unknown, index: VerseIndex) {
  const parsed = parseVerseRef(ref);
  if (!parsed) return null;
  const verses = index.get(`${parsed.book}|${parsed.chapter}`);
  if (!verses) return null;
  let joined = "";
  for (let verse = parsed.from; verse <= parsed.to; verse += 1) {
    if (!verses.has(verse)) return null;
    joined += verses.get(verse);
  }
  return joined;
}

// 引文要逐字出現在所標經節裡；允許用省略號分段，但每段都要找得到。
export function quoteMatchesRef(quote: unknown, ref: unknown, index: VerseIndex) {
  const scope = versesForRef(ref, index);
  if (!scope) return false;
  const pieces = String(quote ?? "").split(ELLIPSIS).map(normalizeForMatch).filter(Boolean);
  if (!pieces.length || pieces.join("").length < MIN_QUOTE_LENGTH) return false;
  return pieces.every(piece => piece.length >= 2 && scope.includes(piece));
}

export function assignCandidateIds(value: unknown): CandidateQuestion[] {
  const list = Array.isArray((value as any)?.questions) ? (value as any).questions : [];
  return list.map((question: any, index: number) => ({ ...question, id: `c${index + 1}` }));
}

// 給審題員的版本：拿掉正解、解說與舉證，只留題目與選項。
export function toBlindReviewItems(candidates: CandidateQuestion[]) {
  return candidates.map(question => ({ id: question.id, question: text(question.question), options: (question.options || []).map(text) }));
}

// #466：錯誤選項引用的就是正解那段經文（或其中一段）時，是「經文明說是甲，所以不是乙」，
// 理由裡就算寫了「沒有提到乙」也不是靠經文沉默來判錯。
function sharesAnswerQuote(quote: unknown, answerQuote: string) {
  const own = normalizeForMatch(quote);
  if (!own || !answerQuote) return false;
  return own.includes(answerQuote) || answerQuote.includes(own);
}

export function checkCandidateEvidence(question: CandidateQuestion, index: VerseIndex): string[] {
  const problems: string[] = [];
  const options = Array.isArray(question?.options) ? question.options.map(text) : [];
  if (options.length !== 4 || options.some(option => !option)) return ["invalid_options"];
  if (!Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3) return ["invalid_correct_index"];
  if (!text(question.question) || !text(question.explanation)) problems.push("empty_question_field");
  if (new Set(options.map(normalizeForMatch)).size !== options.length) problems.push("duplicate_options");
  options.forEach((option, i) => { if (BANNED_OPTION.test(option)) problems.push(`ambiguous_option:${i}`); });
  if (!versesForRef(question.verseRef, index)) problems.push("verse_ref_out_of_range");
  const evidence = Array.isArray(question.evidence) ? question.evidence : [];
  if (evidence.length !== 4) return [...problems, "evidence_missing"];
  const answerQuote = normalizeForMatch(evidence[question.correctIndex]?.quote);
  evidence.forEach((item, i) => {
    if (!quoteMatchesRef(item?.quote, item?.verseRef, index)) problems.push(`quote_not_found:${i}`);
    if (!text(item?.reason)) problems.push(`reason_missing:${i}`);
    else if (i !== question.correctIndex && ABSENCE_REASON.test(text(item.reason)) && !sharesAnswerQuote(item?.quote, answerQuote)) {
      problems.push(`absence_refutation:${i}`);
    }
  });
  return problems;
}

export function checkReview(question: CandidateQuestion, review: QuestionReview | undefined, index: VerseIndex): string[] {
  const judgments = Array.isArray(review?.judgments) ? review.judgments : [];
  if (judgments.length !== 4) return ["review_missing"];
  const problems: string[] = [];
  judgments.forEach((judgment, i) => {
    const expected = i === question.correctIndex ? "correct" : "incorrect";
    if (judgment?.verdict !== expected) { problems.push(`review_disagrees:${i}:${judgment?.verdict || "none"}`); return; }
    if (!quoteMatchesRef(judgment.quote, judgment.verseRef, index)) problems.push(`review_quote_not_found:${i}`);
  });
  return problems;
}

function toStoredQuestion(question: CandidateQuestion, position: number): CandidateQuestion {
  return {
    id: `q${position + 1}`,
    question: text(question.question),
    options: question.options.map(text),
    correctIndex: question.correctIndex,
    explanation: text(question.explanation),
    verseRef: text(question.verseRef),
    evidence: question.evidence.map(item => ({ verseRef: text(item.verseRef), quote: text(item.quote), reason: text(item.reason) }))
  };
}

// 依候選順序取前 count 題同時通過舉證比對與盲審的題目。
export function selectQuestions(candidates: CandidateQuestion[], reviews: QuestionReview[], index: VerseIndex, count = QUIZ_QUESTION_COUNT) {
  const reviewById = new Map((Array.isArray(reviews) ? reviews : []).map(review => [text(review?.id), review]));
  const accepted: CandidateQuestion[] = [];
  const rejected: { id: string; problems: string[] }[] = [];
  for (const candidate of candidates) {
    const evidenceProblems = checkCandidateEvidence(candidate, index);
    const problems = evidenceProblems.length ? evidenceProblems : checkReview(candidate, reviewById.get(candidate.id), index);
    if (problems.length) rejected.push({ id: candidate.id, problems });
    else accepted.push(candidate);
  }
  return { questions: accepted.slice(0, count).map(toStoredQuestion), acceptedCount: accepted.length, rejected };
}
