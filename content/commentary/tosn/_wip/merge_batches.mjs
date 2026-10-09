// 把 lev_zh/batch*.json（ref → 譯文；"title:ref" → 標題）併進 content/commentary/tosn/leviticus.json。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const target = "content/commentary/tosn/leviticus.json";
const file = JSON.parse(readFileSync(target, "utf8"));
const byRef = new Map(file.notes.map(note => [note.ref, note]));
let applied = 0;
for (const name of readdirSync(dir).filter(n => /^batch\d+\.json$/.test(n)).sort()) {
  const batch = JSON.parse(readFileSync(join(dir, name), "utf8"));
  for (const [key, value] of Object.entries(batch)) {
    const isTitle = key.startsWith("title:");
    const ref = isTitle ? key.slice(6) : key;
    const note = byRef.get(ref);
    if (!note) throw new Error(`${name}: 找不到 ${ref}`);
    if (isTitle) note.title = value; else { note.zh = value; applied += 1; }
  }
}
writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
const left = file.notes.filter(note => !String(note.zh || "").trim());
console.log(`已套用 ${applied} 則；剩 ${left.length} 則未翻${left.length ? `（下一則 #${file.notes.indexOf(left[0])} ${left[0].ref}）` : ""}`);
