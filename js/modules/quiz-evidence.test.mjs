import { describe, expect, it } from "vitest";
import { renderQuizEvidenceHtml } from "./quiz-evidence.mjs";

describe("renderQuizEvidenceHtml (#414)", () => {
  const question = {
    question: "亞伯蘭出哈蘭的時候幾歲？",
    options: ["七十五歲", "八十歲", "一百歲", "<b>九十九歲</b>"],
    correctIndex: 0,
    evidence: [
      { verseRef: "創世記 12:4", quote: "年七十五歲", reason: "經文明寫七十五歲。" },
      { verseRef: "創世記 12:4", quote: "年七十五歲", reason: "不是八十歲。" },
      { verseRef: "創世記 12:4", quote: "年七十五歲", reason: "" },
      { verseRef: "創世記 12:4", quote: "年七十五歲", reason: "不是九十九歲。" }
    ]
  };

  it("lists every option with its quote, marking the answer", () => {
    const html = renderQuizEvidenceHtml(question);
    expect(html).toContain("<summary>經文舉證</summary>");
    expect(html.match(/<li /g)).toHaveLength(4);
    expect(html).toContain('<li class="is-correct">');
    expect(html).toContain("正解・七十五歲");
    expect(html).toContain("錯誤・八十歲");
    expect(html).toContain("「年七十五歲」（創世記 12:4）");
    expect(html.match(/quiz-evidence__reason/g)).toHaveLength(3);
  });

  it("escapes AI text", () => {
    expect(renderQuizEvidenceHtml(question)).toContain("&lt;b&gt;九十九歲&lt;/b&gt;");
  });

  it("renders nothing for questions without matching evidence", () => {
    expect(renderQuizEvidenceHtml({ options: ["甲", "乙"], correctIndex: 0 })).toBe("");
    expect(renderQuizEvidenceHtml({ ...question, evidence: question.evidence.slice(0, 2) })).toBe("");
    expect(renderQuizEvidenceHtml(null)).toBe("");
  });
});
