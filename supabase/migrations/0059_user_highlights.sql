-- Migration: Add user text highlights table for reader persistence
-- Description: Creates public.highlights table, configures RLS, and grants permissions.

-- 1. Create highlights table
CREATE TABLE IF NOT EXISTS public.highlights (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  chapter_id text NOT NULL,
  selected_text text NOT NULL,
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  color text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;

-- Create policies to allow public reads and inserts/deletes
CREATE POLICY "Allow public read highlights"
  ON public.highlights FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert highlights"
  ON public.highlights FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public delete highlights"
  ON public.highlights FOR DELETE
  USING (true);

-- Grant table permissions to client roles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.highlights TO anon, authenticated;
