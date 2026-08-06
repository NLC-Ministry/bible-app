-- Migration 0063: Include group_leader in plan management permissions & scope checking

DO $$
DECLARE
  target_signature REGPROCEDURE;
  original_definition TEXT;
  updated_definition TEXT;
BEGIN
  FOREACH target_signature IN ARRAY ARRAY[
    'public.get_reading_team_registration_overview(uuid)'::REGPROCEDURE,
    'public.get_unjoined_plan_members(uuid,text,uuid)'::REGPROCEDURE,
    'public.send_plan_join_invitation(uuid,uuid,text,uuid)'::REGPROCEDURE
  ] LOOP
    SELECT pg_get_functiondef(target_signature::OID) INTO original_definition;
    
    -- Allow group_leader in role_code authorization check
    updated_definition := REPLACE(
      original_definition,
      'actor_profile.role_code NOT IN (''admin'', ''senior_pastor'', ''great_zone_leader'', ''zone_leader'')',
      'actor_profile.role_code NOT IN (''admin'', ''senior_pastor'', ''great_zone_leader'', ''zone_leader'', ''group_leader'')'
    );
    
    -- Also handle legacy role checks if present
    updated_definition := REPLACE(
      updated_definition,
      'actor_profile.role NOT IN (''admin'', ''senior_pastor'', ''great_zone_leader'', ''zone_leader'')',
      'actor_profile.role NOT IN (''admin'', ''senior_pastor'', ''great_zone_leader'', ''zone_leader'', ''group_leader'')'
    );

    IF updated_definition <> original_definition THEN
      EXECUTE updated_definition;
    END IF;
  END LOOP;
END;
$$;
