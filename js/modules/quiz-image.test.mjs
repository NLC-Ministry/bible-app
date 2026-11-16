// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getQuestionImage, getOptionImages, questionImageHtml, installQuizImageViewer, isUploadedQuizImageSrc, quizImagePublicUrl } from "./quiz-image.mjs";
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

// #709：單選／多選的選項可以是圖片（payload.optionImages 和 options 一樣長）
describe("option images (#709)", () => {
  const OPTIONS = ["銅海", "燈臺", "陳設餅桌", "香壇"];
  const IMAGES = OPTIONS.map((_, index) => ({ src: `assets/quiz/option-${index + 1}.webp` }));
  const imageQuestion = (type = "single", optionImages = IMAGES, extra = {}) => normalizeQuestion({
    id: `img-${type}`, type,
    payload: { stem: "哪一張是燈臺？", options: OPTIONS, optionImages, ...extra },
    answerKey: type === "single" ? 1 : [1]
  });
  beforeEach(() => { document.body.innerHTML = ""; });

  describe("getOptionImages", () => {
    it("returns one entry per option, null where an option has no (valid) image", () => {
      expect(getOptionImages({ options: OPTIONS, optionImages: IMAGES })).toEqual(IMAGES.map(image => ({ src: image.src })));
      expect(getOptionImages({ options: OPTIONS, optionImages: [IMAGES[0], null, { src: "https://evil.example/a.webp" }, { src: "javascript:alert(1)" }] }))
        .toEqual([{ src: IMAGES[0].src }, null, null, null]);
    });

    it("pads a short list and ignores extra entries", () => {
      expect(getOptionImages({ options: OPTIONS, optionImages: [IMAGES[0]] })).toEqual([{ src: IMAGES[0].src }, null, null, null]);
      expect(getOptionImages({ options: ["a"], optionImages: IMAGES })).toEqual([{ src: IMAGES[0].src }]);
    });

    it("is null when no option has a valid image", () => {
      expect(getOptionImages({ options: OPTIONS })).toBeNull();
      expect(getOptionImages({ options: OPTIONS, optionImages: "x" })).toBeNull();
      expect(getOptionImages({ options: OPTIONS, optionImages: [null, { src: "/etc/passwd.png" }] })).toBeNull();
      expect(getOptionImages(null)).toBeNull();
    });
  });

  it("renders image cards without the option text, and tapping a card selects it", () => {
    ["single", "multiple"].forEach(type => {
      document.body.innerHTML = renderQuestionFieldsetHtml(imageQuestion(type), 0, { shuffleSeed: "member-1" });
      const fieldset = document.querySelector("fieldset");
      const cards = fieldset.querySelectorAll(".daily-quiz-option-card");
      expect(cards).toHaveLength(4);
      expect(fieldset.querySelector(".daily-quiz-options--images")).not.toBeNull();
      cards.forEach(card => {
        const input = card.querySelector("input");
        expect(input.type).toBe(type === "single" ? "radio" : "checkbox");
        expect(card.querySelector("label img").getAttribute("src")).toBe(IMAGES[Number(input.value)].src);
        // 作答時不顯示選項文字（認圖題才不會洩漏答案）
        expect(card.textContent).not.toContain(OPTIONS[Number(input.value)]);
      });

      let response;
      bindQuestionFieldset(fieldset, type, value => { response = value; });
      const lamp = Array.from(cards).find(card => card.querySelector("input").value === "1");
      lamp.querySelector("label img").click();
      expect(response).toEqual(type === "single" ? 1 : [1]);
      expect(readResponseFromFieldset(fieldset, type)).toEqual(type === "single" ? 1 : [1]);
    });
  });

  it("the zoom button opens the viewer without selecting the option", () => {
    installQuizImageViewer();
    document.body.innerHTML = renderQuestionFieldsetHtml(imageQuestion(), 0);
    const fieldset = document.querySelector("fieldset");
    const card = fieldset.querySelector(".daily-quiz-option-card");
    const value = Number(card.querySelector("input").value);
    card.querySelector("[data-quiz-image-open]").click();
    expect(fieldset.querySelector("input:checked")).toBeNull();
    const viewer = document.querySelector(".quiz-image-viewer");
    expect(viewer.querySelector("img").getAttribute("src")).toBe(IMAGES[value].src);
    viewer.querySelector("[data-quiz-image-close]").click();
  });

  it("an option without an image shows its text inside the card", () => {
    document.body.innerHTML = renderQuestionFieldsetHtml(imageQuestion("single", [IMAGES[0], null, IMAGES[2], IMAGES[3]]), 0);
    const card = Array.from(document.querySelectorAll(".daily-quiz-option-card")).find(item => item.querySelector("input").value === "1");
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector("[data-quiz-image-open]")).toBeNull();
    expect(card.textContent).toContain("燈臺");
  });

  it("keeps the authored order when shuffleOptions is false", () => {
    document.body.innerHTML = renderQuestionFieldsetHtml(imageQuestion("single", IMAGES, { shuffleOptions: false }), 0, { shuffleSeed: "member-2" });
    expect(Array.from(document.querySelectorAll(".daily-quiz-option-card input")).map(input => input.value)).toEqual(["0", "1", "2", "3"]);
  });

  it("questions without option images keep the plain text list", () => {
    document.body.innerHTML = renderQuestionFieldsetHtml(imageQuestion("single", null), 0);
    expect(document.querySelector(".daily-quiz-option-card")).toBeNull();
    expect(document.querySelector(".daily-quiz-options--images")).toBeNull();
  });

  it("the review shows each option's thumbnail with its text", () => {
    const html = renderQuestionReviewHtml(imageQuestion(), { response: 2, result: "wrong" });
    document.body.innerHTML = html;
    const items = document.querySelectorAll(".exam-result__choices li");
    expect(items).toHaveLength(4);
    items.forEach((item, index) => {
      expect(item.querySelector("img").getAttribute("src")).toBe(IMAGES[index].src);
      expect(item.textContent).toContain(OPTIONS[index]);
    });
    expect(items[1].classList.contains("is-right")).toBe(true);
    expect(items[2].classList.contains("is-mine")).toBe(true);
  });
});
