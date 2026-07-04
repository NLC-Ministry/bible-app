-- Create index on profiles to optimize is_demo queries
CREATE INDEX IF NOT EXISTS idx_profiles_is_demo ON profiles(is_demo);

-- Create indexes on reading_plans to optimize filtering by plan identifiers and users
CREATE INDEX IF NOT EXISTS idx_reading_plans_preset_key ON reading_plans(preset_key);
CREATE INDEX IF NOT EXISTS idx_reading_plans_global_plan_id ON reading_plans(global_plan_id);
CREATE INDEX IF NOT EXISTS idx_reading_plans_name ON reading_plans(name);
CREATE INDEX IF NOT EXISTS idx_reading_plans_user_id ON reading_plans(user_id);

-- Create indexes on reading_logs to optimize filtering by plan and user
CREATE INDEX IF NOT EXISTS idx_reading_logs_plan_id ON reading_logs(plan_id);
CREATE INDEX IF NOT EXISTS idx_reading_logs_user_id ON reading_logs(user_id);

-- Composite index to speed up duplicate checking in logs
CREATE INDEX IF NOT EXISTS idx_reading_logs_composite ON reading_logs(user_id, book, chapter, round);
