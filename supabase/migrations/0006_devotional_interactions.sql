-- Migration: 0006_devotional_interactions.sql
-- Description: Create tables for devotional note likes and comment replies with RLS policies.

-- 1. Devotional Note Likes Table
CREATE TABLE public.devotional_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID NOT NULL REFERENCES public.devotional_notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(note_id, user_id)
);

CREATE INDEX idx_devotional_likes_note ON public.devotional_likes(note_id);
ALTER TABLE public.devotional_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY devotional_likes_select_group ON public.devotional_likes
  FOR SELECT TO authenticated
  USING (
    user_id = public.current_profile_id() OR
    (SELECT role FROM public.profiles WHERE id = public.current_profile_id()) IN ('admin', 'senior_pastor') OR
    EXISTS (
      SELECT 1 FROM public.profiles p1
      JOIN public.profiles p2 ON p1.pastoral_zone = p2.pastoral_zone AND p1.small_group = p2.small_group
      WHERE p1.id = user_id AND p2.id = public.current_profile_id()
    )
  );

CREATE POLICY devotional_likes_manage_own ON public.devotional_likes
  FOR ALL TO authenticated
  USING (user_id = public.current_profile_id())
  WITH CHECK (user_id = public.current_profile_id());


-- 2. Devotional Note Comments Table
CREATE TABLE public.devotional_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID NOT NULL REFERENCES public.devotional_notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX idx_devotional_comments_note ON public.devotional_comments(note_id);
ALTER TABLE public.devotional_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY devotional_comments_select_group ON public.devotional_comments
  FOR SELECT TO authenticated
  USING (
    user_id = public.current_profile_id() OR
    (SELECT role FROM public.profiles WHERE id = public.current_profile_id()) IN ('admin', 'senior_pastor') OR
    EXISTS (
      SELECT 1 FROM public.profiles p1
      JOIN public.profiles p2 ON p1.pastoral_zone = p2.pastoral_zone AND p1.small_group = p2.small_group
      WHERE p1.id = user_id AND p2.id = public.current_profile_id()
    )
  );

CREATE POLICY devotional_comments_manage_own ON public.devotional_comments
  FOR ALL TO authenticated
  USING (user_id = public.current_profile_id())
  WITH CHECK (user_id = public.current_profile_id());

-- Grant access
GRANT SELECT, INSERT, DELETE ON public.devotional_likes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devotional_comments TO authenticated;
