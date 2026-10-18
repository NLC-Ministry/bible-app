// CSV 儲存格跳脫（#553）：所有匯出共用這一支。
// 除了把 " 變成 ""，儲存格以 = + - @ Tab 換行開頭時前面加 '：會友把名字設成 =HYPERLINK(...)
// 之類，管理員用 Excel／Google 試算表打開匯出檔時才不會被當成公式執行（CSV 公式注入）。
// 真正的數字（含負數、百分比）和單獨一個「-」維持原樣，報表數字不會變成文字。
const FORMULA_PREFIX_RE = /^[=+\-@\t\r\n]/;
const NUMERIC_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?%?$/;

export function neutralizeCsvFormula(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  const text = String(value);
  if (!FORMULA_PREFIX_RE.test(text) || text === "-" || NUMERIC_RE.test(text)) return text;
  return `'${text}`;
}

// 一個加了雙引號、可以直接用逗號串起來的儲存格
export function csvCell(value) {
  return `"${neutralizeCsvFormula(value).replace(/"/g, '""')}"`;
}
