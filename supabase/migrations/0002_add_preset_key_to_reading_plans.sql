-- =====================================================
-- Migration: 0002_add_preset_key_to_reading_plans.sql
-- Add preset_key column + backfill existing rows.
-- Run this in Supabase SQL Editor for existing deployments.
-- =====================================================

-- ── Step 1: Add missing columns (safe, idempotent) ─────────────────────────
ALTER TABLE public.reading_plans ADD COLUMN IF NOT EXISTS preset_key     TEXT;
ALTER TABLE public.reading_plans ADD COLUMN IF NOT EXISTS level          TEXT    DEFAULT 'normal';
ALTER TABLE public.reading_plans ADD COLUMN IF NOT EXISTS current_round  INTEGER DEFAULT 1;
ALTER TABLE public.reading_plans ADD COLUMN IF NOT EXISTS was_downgraded BOOLEAN DEFAULT FALSE;

-- ── Step 2: Backfill preset_key using exact name matching ──────────────────
UPDATE public.reading_plans
  SET preset_key = 'q1'
  WHERE name = '第一季速讀：2026年7月~9月' AND preset_key IS NULL;

UPDATE public.reading_plans
  SET preset_key = 'q2'
  WHERE name = '第二季速讀：2026年10月~12月' AND preset_key IS NULL;

UPDATE public.reading_plans
  SET preset_key = 'q3'
  WHERE name = '第三季速讀：2027年1月~3月' AND preset_key IS NULL;

UPDATE public.reading_plans
  SET preset_key = 'q4'
  WHERE name = '第四季速讀：2027年4月~6月' AND preset_key IS NULL;

-- ── Step 3: Verify results ─────────────────────────────────────────────────
SELECT
  id,
  name,
  preset_key,
  level,
  current_round,
  was_downgraded,
  created_at
FROM public.reading_plans
ORDER BY created_at DESC;
