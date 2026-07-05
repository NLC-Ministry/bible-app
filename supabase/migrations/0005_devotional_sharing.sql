-- Migration: 0005_devotional_sharing.sql
-- Description: Allow members in the same pastoral zone and small group to read each other's devotional notes (golden verses).

CREATE POLICY devotional_notes_select_group ON public.devotional_notes
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
