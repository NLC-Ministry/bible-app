-- Archive the pastoral sharing wall by default while preserving all existing content.
CREATE TABLE IF NOT EXISTS public.app_feature_settings (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

INSERT INTO public.app_feature_settings (key, enabled, description)
VALUES (
  'pastoral_sharing_wall',
  FALSE,
  'Controls whether the pastoral devotional sharing wall is visible and writable.'
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.app_feature_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_feature_settings_read_authenticated ON public.app_feature_settings;
CREATE POLICY app_feature_settings_read_authenticated
  ON public.app_feature_settings
  FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS app_feature_settings_manage_admin ON public.app_feature_settings;
CREATE POLICY app_feature_settings_manage_admin
  ON public.app_feature_settings
  FOR ALL
  TO authenticated
  USING ((SELECT my_role FROM public.get_my_profile()) = 'admin')
  WITH CHECK ((SELECT my_role FROM public.get_my_profile()) = 'admin');

DROP TRIGGER IF EXISTS set_app_feature_settings_updated_at ON public.app_feature_settings;
CREATE TRIGGER set_app_feature_settings_updated_at
  BEFORE UPDATE ON public.app_feature_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.app_feature_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.app_feature_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.is_feature_enabled(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled FROM public.app_feature_settings WHERE key = p_key),
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_feature_enabled(TEXT) TO authenticated;

DROP POLICY IF EXISTS devotional_notes_manage_own ON public.devotional_notes;
CREATE POLICY devotional_notes_manage_own
  ON public.devotional_notes
  FOR ALL TO authenticated
  USING (public.is_feature_enabled('pastoral_sharing_wall') AND user_id = public.current_profile_id())
  WITH CHECK (public.is_feature_enabled('pastoral_sharing_wall') AND user_id = public.current_profile_id());

DROP POLICY IF EXISTS devotional_notes_select_group ON public.devotional_notes;
CREATE POLICY devotional_notes_select_group
  ON public.devotional_notes
  FOR SELECT TO authenticated
  USING (
    public.is_feature_enabled('pastoral_sharing_wall')
    AND (
      user_id = public.current_profile_id()
      OR (SELECT role FROM public.profiles WHERE id = public.current_profile_id()) = 'admin'
      OR EXISTS (
        SELECT 1
        FROM public.profiles p1
        JOIN public.profiles p2
          ON p1.pastoral_zone = p2.pastoral_zone
         AND p1.small_group = p2.small_group
        WHERE p1.id = user_id
          AND p2.id = public.current_profile_id()
      )
    )
  );

DROP POLICY IF EXISTS devotional_likes_manage_own ON public.devotional_likes;
CREATE POLICY devotional_likes_manage_own
  ON public.devotional_likes
  FOR ALL TO authenticated
  USING (public.is_feature_enabled('pastoral_sharing_wall') AND user_id = public.current_profile_id())
  WITH CHECK (public.is_feature_enabled('pastoral_sharing_wall') AND user_id = public.current_profile_id());

DROP POLICY IF EXISTS devotional_likes_select_group ON public.devotional_likes;
CREATE POLICY devotional_likes_select_group
  ON public.devotional_likes
  FOR SELECT TO authenticated
  USING (
    public.is_feature_enabled('pastoral_sharing_wall')
    AND (
      user_id = public.current_profile_id()
      OR (SELECT role FROM public.profiles WHERE id = public.current_profile_id()) = 'admin'
      OR EXISTS (
        SELECT 1
        FROM public.profiles p1
        JOIN public.profiles p2
          ON p1.pastoral_zone = p2.pastoral_zone
         AND p1.small_group = p2.small_group
        WHERE p1.id = user_id
          AND p2.id = public.current_profile_id()
      )
    )
  );

DROP POLICY IF EXISTS devotional_comments_manage_own ON public.devotional_comments;
CREATE POLICY devotional_comments_manage_own
  ON public.devotional_comments
  FOR ALL TO authenticated
  USING (public.is_feature_enabled('pastoral_sharing_wall') AND user_id = public.current_profile_id())
  WITH CHECK (public.is_feature_enabled('pastoral_sharing_wall') AND user_id = public.current_profile_id());

DROP POLICY IF EXISTS devotional_comments_select_group ON public.devotional_comments;
CREATE POLICY devotional_comments_select_group
  ON public.devotional_comments
  FOR SELECT TO authenticated
  USING (
    public.is_feature_enabled('pastoral_sharing_wall')
    AND (
      user_id = public.current_profile_id()
      OR (SELECT role FROM public.profiles WHERE id = public.current_profile_id()) = 'admin'
      OR EXISTS (
        SELECT 1
        FROM public.profiles p1
        JOIN public.profiles p2
          ON p1.pastoral_zone = p2.pastoral_zone
         AND p1.small_group = p2.small_group
        WHERE p1.id = user_id
          AND p2.id = public.current_profile_id()
      )
    )
  );
