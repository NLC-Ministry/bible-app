import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("supabase/migrations/0075_verse_notes.sql");
const edge = read("supabase/functions/nlc-data/index.ts");
const db = read("js/db.js");
const bible = read("js/modules/bible.js");
const html = read("index.html");
const css = read("index.css");

describe("verse notes (per-verse reading annotations)", () => {
  it("creates a Supabase-synced table scoped to the writer, not localStorage-only", () => {
    expect(migration).toContain("CREATE TABLE public.verse_notes");
    expect(migration).toContain("user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE");
    expect(migration).toContain("UNIQUE(user_id, book, chapter, verse)");
    expect(migration).toContain("ALTER TABLE public.verse_notes ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("USING (user_id = public.current_profile_id())");
    expect(migration).toContain("WITH CHECK (user_id = public.current_profile_id())");
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.verse_notes TO authenticated");
  });

  it("registers verse_notes in nlc-data's table allowlists and forces every action to the caller's own rows", () => {
    expect(edge).toMatch(/READ_TABLES = new Set\(\[[\s\S]*"verse_notes"[\s\S]*?\]\)/);
    expect(edge).toMatch(/OWN_WRITE_TABLES = new Set\(\[[\s\S]*"verse_notes"[\s\S]*?\]\)/);
    expect(edge).toMatch(/writeProtected = \[[\s\S]*"verse_notes"[\s\S]*?\]/);
    // verse_notes must NOT be in USER_TABLES: that set grants admin/pastor
    // visibility via getVisibleProfileIds, which is correct for reading_logs
    // but wrong for a private reflection a member writes on a verse.
    expect(edge).toMatch(/USER_TABLES = new Set\(\[[^\]]*\]\)/);
    const userTablesMatch = edge.match(/const USER_TABLES = new Set\(\[([^\]]*)\]\)/);
    expect(userTablesMatch).toBeTruthy();
    expect(userTablesMatch[1]).not.toContain("verse_notes");
    expect(edge).toContain('if (table === "verse_notes") return { query: query.eq("user_id", profile.id) };');
  });

  it("provides dual Supabase/localStorage read-write-delete functions in db.js", () => {
    expect(db).toContain("async getVerseNotesForChapter(bookName, chapter)");
    expect(db).toContain("async saveVerseNote(bookName, chapter, verse, content)");
    expect(db).toContain("async deleteVerseNote(bookName, chapter, verse)");
    expect(db).toContain('.from("verse_notes")');
    expect(db).toContain('onConflict: "user_id,book,chapter,verse"');
    // Saving blank content deletes the row instead of storing an empty note.
    expect(db).toContain("await this.deleteVerseNote(bookName, chapter, verse)");
  });

  it("adds a 筆記 tile to the verse selection bar that opens a full-screen editor", () => {
    expect(bible).toContain('data-action="note"');
    expect(bible).toContain('barDiv.querySelector(\'[data-action="note"]\')');
    expect(bible).toContain("function openVerseNoteEditor(options)");
    expect(bible).toContain("function closeVerseNoteEditor()");
    expect(bible).toContain('id="verse-note-editor-textarea"');
    expect(bible).toContain("db.saveVerseNote(bookName, chapter, verse, content)");
    expect(bible).toContain("db.deleteVerseNote(bookName, chapter, verse)");
  });

  it("shows the selected verse text in the editor and reuses the app's proven overlay shell for a discoverable close button", () => {
    // Reuses .full-page-overlay / .overlay-header / .overlay-back-btn — the
    // same battle-tested shell as the bible-nav and search overlays — instead
    // of a bespoke icon-only close button, which was too easy to miss/lose
    // (e.g. under the on-screen keyboard) on real mobile devices.
    expect(bible).toContain('class="full-page-overlay verse-note-editor-overlay"');
    expect(bible).toContain('class="overlay-back-btn" id="verse-note-editor-close"');
    expect(bible).toContain("verseText: verseText || \"\"");
    expect(bible).toContain('class="verse-note-editor-verse-text">${escapeHTML(verseText || "")}');
    expect(bible).toContain("const verseText = v.text;");
    expect(bible).not.toContain("autofocus");
    expect(css).toContain(".verse-note-editor-quote {");
    expect(css).toContain(".verse-note-editor-verse-text {");
  });

  it("marks an annotated verse with a badge in its top-right corner", () => {
    expect(bible).toContain("function setVerseNoteBadge(verseDiv, hasNote)");
    expect(bible).toContain('badge.className = "verse-note-badge"');
    expect(css).toContain(".verse-note-badge {");
    expect(css).toContain("position: absolute;");
    expect(css).toContain("top: 0.2rem;");
    expect(css).toContain("right: 0.35rem;");
    expect(css).toMatch(/\.bible-verse \{\s*\n\s*position: relative;/);
  });

  it("loads notes per-chapter with a race-guard token so a fast chapter switch cannot apply stale badges", () => {
    expect(bible).toContain("let verseNotesLoadToken = 0;");
    expect(bible).toContain("async function loadVerseNotesForChapter(bookName, chapter)");
    expect(bible).toContain("const requestToken = ++verseNotesLoadToken;");
    expect(bible).toContain("if (requestToken !== verseNotesLoadToken) return;");
    expect(bible).toContain("loadVerseNotesForChapter(book.name, chapter);");
  });

  it("mounts the editor overlay root in index.html and layers it above the reader chrome", () => {
    expect(html).toContain('id="verse-note-editor-root"');
    expect(css).toMatch(/\.verse-note-editor-overlay \{\s*\n\s*z-index: var\(--z-modal\);/);
  });
});
