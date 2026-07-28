-- Apply the safe organization cleanup to environments where the earlier
-- legacy cleanup migration has already been recorded as applied.
DELETE FROM public.small_groups AS small_group
WHERE NOT EXISTS (
  SELECT 1
  FROM public.profiles AS profile
  WHERE profile.small_group_id = small_group.id
);

DELETE FROM public.pastoral_zones AS pastoral_zone
WHERE NOT EXISTS (
  SELECT 1
  FROM public.profiles AS profile
  WHERE profile.pastoral_zone_id = pastoral_zone.id
)
AND NOT EXISTS (
  SELECT 1
  FROM public.small_groups AS small_group
  WHERE small_group.pastoral_zone_id = pastoral_zone.id
);

DELETE FROM public.great_regions AS great_region
WHERE NOT EXISTS (
  SELECT 1
  FROM public.profiles AS profile
  WHERE profile.great_region_id = great_region.id
)
AND NOT EXISTS (
  SELECT 1
  FROM public.pastoral_zones AS pastoral_zone
  WHERE pastoral_zone.great_region_id = great_region.id
);
