-- Migration 0014: Add is_fixed column to global_plans and reading_plans to support fixed/flexible schedules.
ALTER TABLE public.global_plans ADD COLUMN is_fixed BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.reading_plans ADD COLUMN is_fixed BOOLEAN NOT NULL DEFAULT TRUE;
