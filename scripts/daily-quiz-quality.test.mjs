import { describe, expect, it } from "vitest";
import {
  assignCandidateIds, buildVerseIndex, checkCandidateEvidence, checkReview, formatScripture, normalizeForMatch,
  parseVerseRef, quoteMatchesRef, selectQuestions, toBlindReviewItems
} from "../supabase/functions/generate-daily-quizzes/quiz-quality.ts";

// #414：AI 出題的舉證比對與盲審篩選。
const chapters = [{
  book: "創世記", chapter: 12, verses: [
    { verse: 1, text: "耶和華對亞伯蘭說：「你要離開本地、本族、父家，往我所要指示你的地去。" },
    { verse: 4, text: "亞伯蘭就照著耶和華的吩咐去了；羅得也和他同去。亞伯蘭出哈蘭的時候年七十五歲。" },
    { verse: 5, text: "亞伯蘭將他妻子撒萊和姪兒羅得，連他們在哈蘭所積蓄的財物、所得的人口，都帶往迦南地去。他們就到了迦南地。" }
  ]
}];
const index = buildVerseIndex(chapters);

function goodQuestion(overrides = {}) {
  return {
    id: "c1",
    question: "亞伯蘭出哈蘭的時候幾歲？",
    options: ["七十五歲", "八十歲", "一百歲", "九十九歲"],
    correctIndex: 0,
    explanation: "經文記載亞伯蘭出哈蘭時七十五歲。",
    verseRef: "創世記 12:4",
    evidence: [
      { verseRef: "創世記 12:4", quote: "亞伯蘭出哈蘭的時候年七十五歲", reason: "經文明寫七十五歲。" },
      { verseRef: "創世記 12:4", quote: "年七十五歲", reason: "經文寫七十五歲，不是八十歲。" },
      { verseRef: "創世記 12:4", quote: "年七十五歲", reason: "經文寫七十五歲，不是一百歲。" },
      { verseRef: "創世記 12:4", quote: "年七十五歲", reason: "經文寫七十五歲，不是九十九歲。" }
    ],
    ...overrides
  };
}

function agreeingReview(question) {
  return {
    id: question.id,
    judgments: question.options.map((_, i) => ({
      verdict: i === question.correctIndex ? "correct" : "incorrect",
      verseRef: "創世記 12:4", quote: "出哈蘭的時候年七十五歲"
    }))
  };
}

describe("daily quiz quality gate", () => {
  it("parses verse references within one chapter only", () => {
    expect(parseVerseRef("創世記 12:4")).toEqual({ book: "創世記", chapter: 12, from: 4, to: 4 });
    expect(parseVerseRef("創世記12：4-5")).toEqual({ book: "創世記", chapter: 12, from: 4, to: 5 });
    expect(parseVerseRef("創世記 12:4-13:1")).toBeNull();
    expect(parseVerseRef("創世記 12:5-4")).toBeNull();
    expect(parseVerseRef("創世記十二章")).toBeNull();
  });

  it("matches quotes verbatim inside the cited verses, ignoring punctuation", () => {
    expect(normalizeForMatch("「你要離開本地、本族」")).toBe("你要離開本地本族");
    expect(quoteMatchesRef("你要離開本地，本族，父家", "創世記 12:1", index)).toBe(true);
    expect(quoteMatchesRef("羅得也和他同去……年七十五歲", "創世記 12:4", index)).toBe(true);
    expect(quoteMatchesRef("年七十五歲。亞伯蘭將他妻子撒萊", "創世記 12:4-5", index)).toBe(true);
    // 引文在經文裡，但標錯節。
    expect(quoteMatchesRef("年七十五歲", "創世記 12:5", index)).toBe(false);
    // 改寫過的引文、太短的引文、不在當日範圍的經節。
    expect(quoteMatchesRef("亞伯蘭七十五歲離開哈蘭", "創世記 12:4", index)).toBe(false);
    expect(quoteMatchesRef("羅得", "創世記 12:4", index)).toBe(false);
    expect(quoteMatchesRef("年七十五歲", "創世記 12:2", index)).toBe(false);
    expect(quoteMatchesRef("年七十五歲", "創世記 13:4", index)).toBe(false);
    expect(quoteMatchesRef("年七十五歲", "創 12:4", index)).toBe(false);
  });

  it("formats scripture with chapter headings and verse numbers", () => {
    expect(formatScripture(chapters)).toMatch(/^創世記 12 章\n1 耶和華對亞伯蘭說/);
  });

  it("accepts a question whose every option is proven by quoted scripture", () => {
    expect(checkCandidateEvidence(goodQuestion(), index)).toEqual([]);
  });

  it("rejects quotes that are not in the cited verses", () => {
    const question = goodQuestion();
    question.evidence[2] = { verseRef: "創世記 12:4", quote: "亞伯蘭當時一百歲", reason: "經文寫七十五歲。" };
    expect(checkCandidateEvidence(question, index)).toEqual(["quote_not_found:2"]);
  });

  it("rejects wrong options refuted only by scripture being silent", () => {
    const question = goodQuestion();
    question.evidence[1] = { verseRef: "創世記 12:5", quote: "他們就到了迦南地", reason: "經文沒有提到八十歲。" };
    expect(checkCandidateEvidence(question, index)).toEqual(["absence_refutation:1"]);
  });

  it("#466: a wrong option refuted by the answer's own verse passes even if the reason says 沒有提到", () => {
    const question = goodQuestion();
    question.evidence[1] = { ...question.evidence[1], reason: "經文明說七十五歲，沒有提到八十歲。" };
    question.evidence[2] = { verseRef: "創世記 12:4", quote: "亞伯蘭出哈蘭的時候年七十五歲", reason: "經文明說七十五歲，所以不是一百歲。" };
    expect(checkCandidateEvidence(question, index)).toEqual([]);
  });

  it("rejects ambiguous and duplicate options", () => {
    expect(checkCandidateEvidence(goodQuestion({ options: ["七十五歲", "八十歲", "一百歲", "以上皆非"] }), index))
      .toEqual(["ambiguous_option:3"]);
    expect(checkCandidateEvidence(goodQuestion({ options: ["七十五歲", "八十歲", "八十 歲", "九十九歲"] }), index))
      .toEqual(["duplicate_options"]);
  });

  it("rejects missing evidence and out-of-range verse references", () => {
    expect(checkCandidateEvidence(goodQuestion({ evidence: [] }), index)).toEqual(["evidence_missing"]);
    expect(checkCandidateEvidence(goodQuestion({ verseRef: "創世記 13:1" }), index)).toEqual(["verse_ref_out_of_range"]);
  });

  it("requires the blind reviewer to find exactly the intended answer", () => {
    const question = goodQuestion();
    expect(checkReview(question, agreeingReview(question), index)).toEqual([]);

    const undeterminable = agreeingReview(question);
    undeterminable.judgments[3] = { verdict: "undeterminable", verseRef: "", quote: "" };
    expect(checkReview(question, undeterminable, index)).toEqual(["review_disagrees:3:undeterminable"]);

    const twoCorrect = agreeingReview(question);
    twoCorrect.judgments[1] = { ...twoCorrect.judgments[1], verdict: "correct" };
    expect(checkReview(question, twoCorrect, index)).toEqual(["review_disagrees:1:correct"]);

    const badQuote = agreeingReview(question);
    badQuote.judgments[0] = { ...badQuote.judgments[0], quote: "亞伯蘭很年輕" };
    expect(checkReview(question, badQuote, index)).toEqual(["review_quote_not_found:0"]);

    expect(checkReview(question, undefined, index)).toEqual(["review_missing"]);
  });

  it("hides the answer and evidence from the blind reviewer", () => {
    const [item] = toBlindReviewItems(assignCandidateIds({ questions: [goodQuestion({ id: "anything" })] }));
    expect(item).toEqual({ id: "c1", question: "亞伯蘭出哈蘭的時候幾歲？", options: ["七十五歲", "八十歲", "一百歲", "九十九歲"] });
  });

  it("keeps the first five passing candidates and renumbers them", () => {
    const candidates = assignCandidateIds({ questions: Array.from({ length: 8 }, () => goodQuestion()) });
    candidates[1].evidence = [];
    const reviews = candidates.map(agreeingReview);
    reviews[2].judgments[0] = { verdict: "undeterminable", verseRef: "", quote: "" };
    const result = selectQuestions(candidates, reviews, index);
    expect(result.acceptedCount).toBe(6);
    expect(result.rejected.map(item => item.id)).toEqual(["c2", "c3"]);
    expect(result.questions.map(question => question.id)).toEqual(["q1", "q2", "q3", "q4", "q5"]);
    expect(result.questions[0].evidence).toHaveLength(4);
  });

  it("returns fewer than five when not enough candidates pass", () => {
    const candidates = assignCandidateIds({ questions: Array.from({ length: 8 }, () => goodQuestion()) });
    const reviews = candidates.map(agreeingReview).slice(0, 4);
    const result = selectQuestions(candidates, reviews, index);
    expect(result.questions).toHaveLength(4);
    expect(result.rejected.every(item => item.problems.includes("review_missing"))).toBe(true);
  });
});
