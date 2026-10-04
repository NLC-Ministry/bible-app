import { describe, it, expect, vi, afterEach } from "vitest";
import { compressScreenshot } from "../IssueReportBlocks.ts";

// Fake canvas: `supportsWebp=false` mimics WebKit (iOS), which silently
// returns PNG when asked to encode image/webp (#444).
function installCanvas({ supportsWebp }: { supportsWebp: boolean }) {
  const calls: { fillStyle?: string; filled: boolean; types: string[] } = { filled: false, types: [] };
  const ctx = {
    fillStyle: "",
    fillRect: vi.fn(() => { calls.filled = true; calls.fillStyle = ctx.fillStyle; }),
    drawImage: vi.fn()
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: (type: string) => {
      calls.types.push(type);
      const out = type === "image/webp" && !supportsWebp ? "image/png" : type;
      return `data:${out};base64,AAAA`;
    }
  };
  (globalThis as any).document = { createElement: () => canvas };
  (globalThis as any).createImageBitmap = vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() }));
  return calls;
}

const png = { type: "image/png" } as unknown as File;

afterEach(() => {
  delete (globalThis as any).document;
  delete (globalThis as any).createImageBitmap;
});

describe("compressScreenshot", () => {
  it("encodes WebP when the browser supports it", async () => {
    installCanvas({ supportsWebp: true });
    const shot = await compressScreenshot(png);
    expect(shot?.mime).toBe("image/webp");
    expect(shot?.base64).toBe("AAAA");
  });

  it("falls back to JPEG when the browser cannot encode WebP (iOS WebKit)", async () => {
    const calls = installCanvas({ supportsWebp: false });
    const shot = await compressScreenshot(png);
    expect(shot).not.toBeNull();
    expect(shot?.mime).toBe("image/jpeg");
    expect(shot?.base64).toBe("AAAA");
    expect(calls.types).toContain("image/jpeg");
  });

  it("paints a white background so transparent PNGs don't turn black as JPEG", async () => {
    const calls = installCanvas({ supportsWebp: false });
    await compressScreenshot(png);
    expect(calls.filled).toBe(true);
    expect(calls.fillStyle).toBe("#ffffff");
  });

  it("rejects unsupported file types", async () => {
    installCanvas({ supportsWebp: true });
    expect(await compressScreenshot({ type: "image/gif" } as unknown as File)).toBeNull();
  });
});
