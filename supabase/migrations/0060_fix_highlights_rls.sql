-- Migration: Fix highlights RLS — restrict all operations to own rows only
-- Run this in Supabase SQL Editor

-- Drop overly-permissive policies
DROP POLICY IF EXISTS "Allow public read highlights" ON public.highlights;
DROP POLICY IF EXISTS "Allow public insert highlights" ON public.highlights;
DROP POLICY IF EXISTS "Allow public delete highlights" ON public.highlights;

-- SELECT: users can only read their own highlights
CREATE POLICY "Users can read own highlights"
  ON public.highlights FOR SELECT
  USING (user_id = auth.uid()::text);

-- INSERT: users can only insert their own highlights
CREATE POLICY "Users can insert own highlights"
  ON public.highlights FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

-- UPDATE: users can only update their own highlights (was missing)
CREATE POLICY "Users can update own highlights"
  ON public.highlights FOR UPDATE
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- DELETE: users can only delete their own highlights
CREATE POLICY "Users can delete own highlights"
  ON public.highlights FOR DELETE
  USING (user_id = auth.uid()::text);
