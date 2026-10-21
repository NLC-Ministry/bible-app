// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getQuestionImage, questionImageHtml, installQuizImageViewer, isUploadedQuizImageSrc, quizImagePublicUrl } from "./quiz-image.mjs";
import { normalizeQuestion, renderQuestionFieldsetHtml, bindQuestionFieldset, readResponseFromFieldset } from "./quiz-question-types.mjs";
import { renderQuestionReviewHtml } from "./quiz-review.mjs";

// #449：題目可附圖（payload.image），不是新題型
const IMAGE = { src: "assets/quiz/lightning-2026-10-07.webp", alt: "祭司獻燔祭的七個場景" };
const orderingQuestion = () => normalizeQuestion({
  id: "lq", type: "ordering",
  payload: {
    stem: "請依利未記 1:3–9，把祭司獻燔祭的步驟依序排列（填圖片編號）",
    image: IMAGE,
    items: ["2", "4", "6", "1", "7", "5", "3"].map((text, index) => ({ id: `I${index + 1}`, text }))
  },
  answerKey: ["I1", "I2", "I3", "I4", "I5", "I6", "I7"]
});

describe("getQuestionImage", () => {
  it("accepts a same-site assets/ image and defaults the alt text", () => {
    expect(getQuestionImage({ image: IMAGE })).toEqual(IMAGE);
    expect(getQuestionImage({ image: { src: "assets/quiz/a.png" } })).toEqual({ src: "assets/quiz/a.png", alt: "題目附圖" });
  });

  it("rejects missing, external, script and path-traversal sources", () => {
    expect(getQuestionImage({ stem: "x" })).toBeNull();
    expect(getQuestionImage(null)).toBeNull();
    for (const src of ["https://evil.example/a.webp", "javascript:alert(1)", "/assets/quiz/a.webp", "assets/../index.html", "assets/quiz/a.svg", 'assets/a".webp']) {
      expect(getQuestionImage({ image: { src } }), src).toBeNull();
    }
  });

  // #585：後台上傳的圖放在本站 Supabase 的公開 bucket quiz-images
  describe("uploaded images (#585)", () => {
    const ORIGIN = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
    const UUID = "3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f";
    const uploaded = (ext = "webp", origin = ORIGIN) => `${origin}/storage/v1/object/public/quiz-images/${UUID}.${ext}`;
    let previous;
    beforeEach(() => {
      previous = globalThis.SUPABASE_CONFIG;
      globalThis.SUPABASE_CONFIG = { url: `${ORIGIN}/` };
    });
    afterEach(() => { globalThis.SUPABASE_CONFIG = previous; });

    it("accepts this project's quiz-images public URL", () => {
      for (const ext of ["webp", "png", "jpg", "jpeg"]) {
        expect(getQuestionImage({ image: { src: uploaded(ext) } }), ext).toEqual({ src: uploaded(ext), alt: "題目附圖" });
      }
      expect(isUploadedQuizImageSrc(uploaded())).toBe(true);
    });

    it("rejects other projects, other buckets, non-uuid names and query strings", () => {
      for (const src of [
        uploaded("webp", "https://bbbbbbbbbbbbbbbbbbbb.supabase.co"),
        uploaded("webp", "http://aaaaaaaaaaaaaaaaaaaa.supabase.co"),
        `${ORIGIN}/storage/v1/object/public/issue-report-shots/${UUID}.webp`,
        `${ORIGIN}/storage/v1/object/public/quiz-images/../${UUID}.webp`,
        `${ORIGIN}/storage/v1/object/public/quiz-images/photo.webp`,
        `${uploaded()}?x=1`,
        uploaded("svg")
      ]) {
        expect(getQuestionImage({ image: { src } }), src).toBeNull();
      }
    });

    it("rejects uploaded URLs when the app has no Supabase config", () => {
      globalThis.SUPABASE_CONFIG = undefined;
      expect(getQuestionImage({ image: { src: uploaded() } })).toBeNull();
    });

    it("builds the public URL from a stored path", () => {
      expect(quizImagePublicUrl(`${UUID}.webp`)).toBe(uploaded());
      expect(quizImagePublicUrl("../x.webp")).toBe("");
    });
  });

  it("escapes the alt text", () => {
    const html = questionImageHtml({ image: { src: "assets/quiz/a.webp", alt: '"><script>' } });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("question image in the shared renderers", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("shows the image under the stem while answering, and ordering still works", () => {
    document.body.innerHTML = renderQuestionFieldsetHtml(orderingQuestion(), 0);
    const fieldset = document.querySelector("fieldset");
    const img = fieldset.querySelector(".quiz-question-image img");
    expect(img.getAttribute("src")).toBe(IMAGE.src);
    expect(img.getAttribute("alt")).toBe(IMAGE.alt);
    expect(fieldset.querySelector("legend").nextElementSibling.classList.contains("quiz-question-image")).toBe(true);

    let response;
    bindQuestionFieldset(fieldset, "ordering", value => { response = value; });
    const chip = fieldset.querySelector('[data-order-pool] [data-item-id="I1"]');
    chip.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    chip.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(response).toEqual(["I1"]);
    expect(readResponseFromFieldset(fieldset, "ordering")).toEqual(["I1"]);
  });

  it("questions without an image render no figure", () => {
    const question = normalizeQuestion({ id: "q", type: "truefalse", payload: { stem: "對嗎？" }, answerKey: true });
    expect(renderQuestionFieldsetHtml(question, 0)).not.toContain("quiz-question-image");
  });

  it("shows the image in the review too", () => {
    const html = renderQuestionReviewHtml(orderingQuestion(), { response: ["I1", "I2", "I3", "I4", "I5", "I6", "I7"], result: "correct" });
    expect(html).toContain(`src="${IMAGE.src}"`);
  });

  it("tapping the image opens a full-screen viewer that closes again", () => {
    installQuizImageViewer();
    installQuizImageViewer();
    document.body.innerHTML = renderQuestionFieldsetHtml(orderingQuestion(), 0);
    document.querySelector("[data-quiz-image-open]").click();
    const viewers = document.querySelectorAll(".quiz-image-viewer");
    expect(viewers).toHaveLength(1);
    expect(viewers[0].querySelector("img").getAttribute("src")).toBe(IMAGE.src);
    viewers[0].querySelector("[data-quiz-image-close]").click();
    expect(document.querySelector(".quiz-image-viewer")).toBeNull();
  });
});
