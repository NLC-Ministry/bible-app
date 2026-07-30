import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "index.css"), "utf8");
const utils = readFileSync(join(root, "js", "utils.js"), "utf8");

describe("badge vector rendering quality", () => {
  it("keeps vector SVGs and defers wall image decoding", () => {
    expect(utils).toContain("CAMPAIGN_MEDAL_FILENAMES");
    expect(utils).toContain('loading="lazy" decoding="async"');
    expect(utils).toContain("assets/badges/complete/${filename}");
  });

  it("renders only the selected detail SVG at its final size", () => {
    expect(html).toMatch(/id="detail-medal-image"[^>]+width="200" height="240"/);
    expect(utils).toContain("medalImage.src = campaignMedalPath");
    expect(utils).toContain('medalImage.fetchPriority = "high"');
    expect(utils).toContain('shield.style.setProperty("--campaign-medal-frame", "none", "important")');
    expect(css).toContain("#" + "badge-detail-hero .campaign-medal-image");
    expect(css).toMatch(/campaign-medal-image[\s\S]+width: 130%/);
  });

  it("keeps list labels legible without larger image downloads", () => {
    expect(css).toContain("width: min(6.5rem, 100%)");
    expect(utils).not.toContain("width: 4.5rem; height: auto; aspect-ratio: 200/240");
  });

  it("avoids a second rasterizing shadow filter on campaign shells", () => {
    expect(css).toMatch(
      /\.honor-badge-hex-shell:has\(\[class\*="campaign-medal-stage-"\]\)\s*\{[^}]*filter:\s*none/
    );
  });
});