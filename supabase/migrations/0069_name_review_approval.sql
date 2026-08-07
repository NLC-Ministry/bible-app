-- Migration 0069: Admin review/approval for suspicious profile names
--
-- The client blocks a member from entering reading plans when their name
-- looks incomplete or auto-generated (placeholder, digits, emoji, gibberish
-- English — see js/utils.js getProfileNameFlags). An admin may look at a
-- flagged name and decide it is actually fine (e.g. a legitimate short
-- romanized name that trips the heuristic). This column lets the block be
-- lifted for that exact name without disabling the heuristic entirely.
--
-- Any *self-service* name change (the save_profile Edge Function action,
-- which is the only path a non-admin can use to change their own name)
-- must reset this back to false, so a fresh self-edited name goes through
-- review again rather than silently inheriting a stale approval.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS name_review_approved BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.name_review_approved IS
  'Admin override: true when an admin has manually approved a name that the automated getProfileNameFlags() heuristic flags as suspicious. Reset to false whenever the member self-edits their name via save_profile.';
