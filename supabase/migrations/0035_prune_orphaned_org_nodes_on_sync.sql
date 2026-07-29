-- Keep the local organization hierarchy free of nodes that are no longer
-- referenced by any projected Member Hub profile.
--
-- The grace period prevents a session from deleting a node that another
-- concurrent session has just upserted but has not linked to its profile yet.
CREATE OR REPLACE FUNCTION public.prune_orphaned_church_org_nodes(
  p_grace_period INTERVAL DEFAULT INTERVAL '15 minutes'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $prune_orphaned_church_org_nodes$
DECLARE
  removed_small_groups INTEGER := 0;
  removed_pastoral_zones INTEGER := 0;
  removed_great_regions INTEGER := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.small_groups AS small_group
  WHERE small_group.updated_at < NOW() - p_grace_period
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.small_group_id = small_group.id
    );
  GET DIAGNOSTICS removed_small_groups = ROW_COUNT;

  DELETE FROM public.pastoral_zones AS pastoral_zone
  WHERE pastoral_zone.updated_at < NOW() - p_grace_period
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.pastoral_zone_id = pastoral_zone.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.small_groups AS small_group
      WHERE small_group.pastoral_zone_id = pastoral_zone.id
    );
  GET DIAGNOSTICS removed_pastoral_zones = ROW_COUNT;

  DELETE FROM public.great_regions AS great_region
  WHERE great_region.updated_at < NOW() - p_grace_period
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.great_region_id = great_region.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.pastoral_zones AS pastoral_zone
      WHERE pastoral_zone.great_region_id = great_region.id
    );
  GET DIAGNOSTICS removed_great_regions = ROW_COUNT;

  RETURN JSONB_BUILD_OBJECT(
    'smallGroups', removed_small_groups,
    'pastoralZones', removed_pastoral_zones,
    'greatRegions', removed_great_regions
  );
END;
$prune_orphaned_church_org_nodes$;

REVOKE ALL ON FUNCTION public.prune_orphaned_church_org_nodes(INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_orphaned_church_org_nodes(INTERVAL) TO service_role;

-- Clean up existing orphaned rows once when this migration is deployed.
DELETE FROM public.small_groups AS small_group
WHERE small_group.updated_at < NOW() - INTERVAL '15 minutes'
AND NOT EXISTS (
  SELECT 1 FROM public.profiles AS profile
  WHERE profile.small_group_id = small_group.id
);

DELETE FROM public.pastoral_zones AS pastoral_zone
WHERE pastoral_zone.updated_at < NOW() - INTERVAL '15 minutes'
AND NOT EXISTS (
  SELECT 1 FROM public.profiles AS profile
  WHERE profile.pastoral_zone_id = pastoral_zone.id
)
AND NOT EXISTS (
  SELECT 1 FROM public.small_groups AS small_group
  WHERE small_group.pastoral_zone_id = pastoral_zone.id
);

DELETE FROM public.great_regions AS great_region
WHERE great_region.updated_at < NOW() - INTERVAL '15 minutes'
AND NOT EXISTS (
  SELECT 1 FROM public.profiles AS profile
  WHERE profile.great_region_id = great_region.id
)
AND NOT EXISTS (
  SELECT 1 FROM public.pastoral_zones AS pastoral_zone
  WHERE pastoral_zone.great_region_id = great_region.id
);
