// scripts/lib/color-contrast.mjs
//
// Minimal WCAG 2.1 contrast-ratio math, plus a small resolver for the
// specific CSS custom-property syntax actually used in index.css: hex
// literals, rgb()/rgba(), var(--x) references, and
// color-mix(in srgb, A P%, B) where B is either another color or the literal
// "transparent". This is NOT a general CSS color parser — it only needs to
// understand what this project's tokens actually use.

/** @param {number} c 0-255 */
function srgbChannelToLinear(c) {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/** @param {{r:number,g:number,b:number}} rgb */
export function relativeLuminance({ r, g, b }) {
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
}

/** WCAG contrast ratio between two opaque {r,g,b} colors. */
export function contrastRatio(rgbA, rgbB) {
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Alpha-composite a foreground color over an opaque backdrop. */
function compositeOver(fg, backdrop) {
  const a = fg.a ?? 1;
  if (a >= 1) return { r: fg.r, g: fg.g, b: fg.b };
  return {
    r: fg.r * a + backdrop.r * (1 - a),
    g: fg.g * a + backdrop.g * (1 - a),
    b: fg.b * a + backdrop.b * (1 - a),
  };
}

function parseHex(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255, a: 1 };
}

function parseRgbFunc(value) {
  const match = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/i);
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] !== undefined ? Number(match[4]) : 1,
  };
}

/**
 * Resolve a raw CSS color value (possibly referencing other custom
 * properties, possibly a color-mix() expression) down to an opaque
 * {r,g,b} against a known backdrop.
 * @param {string} rawValue
 * @param {Record<string,string>} vars - flat map of --token-name -> raw value, for one theme
 * @param {{r:number,g:number,b:number}} backdrop - what this ends up composited over
 * @param {Set<string>} [seen] - cycle guard
 */
export function resolveColor(rawValue, vars, backdrop, seen = new Set()) {
  const value = rawValue.trim();

  const varMatch = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (varMatch) {
    const name = varMatch[1];
    if (seen.has(name)) throw new Error(`Cyclic var() reference: ${name}`);
    const next = vars[name];
    if (next === undefined) throw new Error(`Unknown CSS var referenced: ${name}`);
    return resolveColor(next, vars, backdrop, new Set([...seen, name]));
  }

  const mixMatch = value.match(/^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*(.+?)\s*\)$/i);
  if (mixMatch) {
    const [, aExpr, pctStr, bExpr] = mixMatch;
    const pct = Number(pctStr) / 100;
    const aRgb = resolveColor(aExpr, vars, backdrop, seen);
    if (bExpr.trim().toLowerCase() === "transparent") {
      // color-mix(in srgb, X P%, transparent) == X at P% opacity, then
      // composited over the backdrop.
      return compositeOver({ ...aRgb, a: pct }, backdrop);
    }
    const bRgb = resolveColor(bExpr, vars, backdrop, seen);
    return {
      r: aRgb.r * pct + bRgb.r * (1 - pct),
      g: aRgb.g * pct + bRgb.g * (1 - pct),
      b: aRgb.b * pct + bRgb.b * (1 - pct),
    };
  }

  if (value.startsWith("#")) return compositeOver(parseHex(value), backdrop);

  const rgbFunc = parseRgbFunc(value);
  if (rgbFunc) return compositeOver(rgbFunc, backdrop);

  const named = { white: "#FFFFFF", black: "#000000", transparent: "rgba(0,0,0,0)" }[value.toLowerCase()];
  if (named) return resolveColor(named, vars, backdrop, seen);

  throw new Error(`Cannot resolve CSS color value: "${rawValue}"`);
}

/**
 * Parse `--name: value;` declarations out of one CSS rule body (already the
 * text between a rule's `{` and `}`) into a flat { "--name": "value" } map.
 * Only picks up simple custom-property declarations, not nested rules.
 */
export function parseCssVarBlock(body) {
  const vars = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = re.exec(body))) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}
