-- Migration 0075: Per-verse reading notes
--
-- Reader can select a verse and write a personal note/reflection in a
-- full-screen editor. One running note per (user, verse) — reopening the
-- editor on an already-annotated verse edits it in place rather than
-- creating a new entry, matching devotional_notes' one-per-day model.
-- Synced to Supabase (not localStorage-only) because this is reflective
-- content a member would be upset to lose on a cache clear or device
-- switch — unlike the highlight color markers in js/modules/bible.js,
-- which stay local-only by design.

CREATE TABLE public.verse_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(user_id, book, chapter, verse)
);

CREATE INDEX idx_verse_notes_user_chapter ON public.verse_notes(user_id, book, chapter);

CREATE TRIGGER trg_verse_notes_updated_at
  BEFORE UPDATE ON public.verse_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.verse_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY verse_notes_manage_own ON public.verse_notes
  FOR ALL TO authenticated
  USING (user_id = public.current_profile_id())
  WITH CHECK (user_id = public.current_profile_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.verse_notes TO authenticated;
