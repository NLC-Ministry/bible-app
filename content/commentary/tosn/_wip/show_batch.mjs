// 印出利未記第 from～to 則注釋（英文）與對應和合本經文，供翻譯用。
import { readFileSync } from "node:fs";
const [from, to] = process.argv.slice(2).map(Number);
const file = JSON.parse(readFileSync("content/commentary/tosn/leviticus.json", "utf8"));
const cunp = new Map(readFileSync(process.env.CUNP, "utf8").split("\n").map(line => {
  const i = line.indexOf(" ");
  return [line.slice(0, i), line.slice(i + 1)];
}));
file.notes.slice(from, to).forEach((note, k) => {
  const idx = from + k;
  const verses = [];
  if (!note.cross_chapter) {
    const end = Math.min(note.verse_end, note.verse_start + 2);
    for (let v = note.verse_start; v <= end; v++) verses.push(`${note.chapter}:${v} ${cunp.get(`${note.chapter}:${v}`)}`);
  }
  console.log(`#${idx} ${note.ref} [${note.range}]${note.title ? ` title=${note.title}` : ""}`);
  if (verses.length) console.log(`  和合本: ${verses.join(" ／ ")}`);
  console.log(`  EN: ${note.en}`);
  console.log("");
});
