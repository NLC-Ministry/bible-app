import { describe, it, expect } from "vitest";
import { validateVerseSource } from "./verse-validator.mjs";

describe("validateVerseSource (Security First Input Validation)", () => {
  // 1. 正常成功流程 (Normal Success Flows)
  describe("Normal Success Flows", () => {
    it("should accept a standard valid verse source and return it", () => {
      const result = validateVerseSource("約翰福音 3:16");
      expect(result).toBe("約翰福音 3:16");
    });

    it("should trim surrounding whitespace from a valid verse source", () => {
      const result = validateVerseSource("  創世記 1:1  ");
      expect(result).toBe("創世記 1:1");
    });

    it("should accept a verse source at maximum allowed length (512 characters)", () => {
      const longSource = "A".repeat(512);
      const result = validateVerseSource(longSource);
      expect(result).toBe(longSource);
      expect(result.length).toBe(512);
    });
  });

  // 2. 輸入髒資料時的異常攔截防禦測試 (Abnormal Dirty Input Interception Defense Tests)
  describe("Abnormal Interception Defense", () => {
    it("should reject null or undefined inputs", () => {
      expect(() => validateVerseSource(null)).toThrow("Verse source cannot be null or undefined");
      expect(() => validateVerseSource(undefined)).toThrow("Verse source cannot be null or undefined");
    });

    it("should reject non-string types", () => {
      expect(() => validateVerseSource(123)).toThrow("Verse source must be a string");
      expect(() => validateVerseSource(true)).toThrow("Verse source must be a string");
      expect(() => validateVerseSource({ source: "創世記 1:1" })).toThrow("Verse source must be a string");
      expect(() => validateVerseSource(["創世記 1:1"])).toThrow("Verse source must be a string");
    });

    it("should reject empty strings", () => {
      expect(() => validateVerseSource("")).toThrow("Verse source cannot be empty or only whitespace");
    });

    it("should reject only-whitespace strings", () => {
      expect(() => validateVerseSource("   ")).toThrow("Verse source cannot be empty or only whitespace");
      expect(() => validateVerseSource("\t\n")).toThrow("Verse source cannot be empty or only whitespace");
    });

    it("should reject strings exceeding 512 characters", () => {
      const tooLongSource = "A".repeat(513);
      expect(() => validateVerseSource(tooLongSource)).toThrow("Verse source cannot exceed 512 characters");
    });
  });
});
