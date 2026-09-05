-- Keep the existing permission rules; use one exact indexed parent lookup.
BEGIN;
SELECT current_setting('server_version') AS connected_postgresql_version,
       CASE WHEN current_setting('server_version_num')::integer >= 170000
                  AND current_setting('server_version_num')::integer < 190000
            THEN 'READY' ELSE 'STOP: PostgreSQL 17 or 18 required' END AS preflight;
DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 170000
     OR current_setting('server_version_num')::integer >= 190000 THEN
    RAISE EXCEPTION 'STOP: PostgreSQL 17 or 18 required';
  END IF;
END;
$$;
SET LOCAL lock_timeout = '10s';

ALTER FUNCTION public.mangorts_v2_policy_parent(uuid,text,uuid) ROWS 1;

CREATE OR REPLACE FUNCTION public.mangorts_v2_resolve_permission_policy(p_company_id uuid, p_resource_type text, p_resource_id uuid) RETURNS TABLE(source_resource_type text, source_resource_id uuid, source_customized_sequence bigint, reset_resource_type text, reset_resource_id uuid, reset_sequence bigint, overwritten_resource_type text, overwritten_resource_id uuid, overwritten_sequence bigint, parent_link_fingerprint text)
    LANGUAGE sql STABLE ROWS 1
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with recursive path as (
    select 0 as depth,
           setting.resource_type,
           setting.resource_id,
           setting.permission_mode as stored_mode,
           setting.customized_sequence,
           setting.parent_link_sequence,
           setting.descendant_reset_sequence,
           array[setting.resource_type || ':' || setting.resource_id::text]::text[] as visited
    from resource_permission_settings setting
    where setting.company_id=p_company_id
      and setting.resource_type=p_resource_type
      and setting.resource_id=p_resource_id
    union all
    select child.depth+1,
           parent_setting.resource_type,
           parent_setting.resource_id,
           parent_setting.permission_mode,
           parent_setting.customized_sequence,
           parent_setting.parent_link_sequence,
           parent_setting.descendant_reset_sequence,
           child.visited || (parent_setting.resource_type || ':' || parent_setting.resource_id::text)
    from path child
    cross join lateral mangorts_v2_policy_parent(p_company_id,child.resource_type,child.resource_id) parent
    cross join lateral (
      select parent_setting.* from resource_permission_settings parent_setting
      where parent_setting.company_id=p_company_id
        and parent_setting.resource_type=parent.parent_resource_type
        and parent_setting.resource_id=parent.parent_resource_id
      limit 1
    ) parent_setting
    where not (parent_setting.resource_type || ':' || parent_setting.resource_id::text)=any(child.visited)
  ),
  eligible_resets as (
    select ancestor.*
    from path ancestor
    where ancestor.depth>0
      and ancestor.descendant_reset_sequence>0
      and not exists (
        select 1 from path edge
        where edge.depth<ancestor.depth
          and edge.parent_link_sequence>ancestor.descendant_reset_sequence
      )
  ),
  active_sources as (
    select candidate.*
    from path candidate
    where candidate.stored_mode='customized'
      and not exists (
        select 1 from eligible_resets reset
        where reset.depth>candidate.depth
          and reset.descendant_reset_sequence>=candidate.customized_sequence
      )
  ),
  selected_source as (
    select * from active_sources order by depth limit 1
  ),
  selected_reset as (
    select * from eligible_resets order by descendant_reset_sequence desc,depth limit 1
  ),
  target as (
    select * from path where depth=0
  ),
  target_overwrite as (
    select reset.*
    from eligible_resets reset,target
    where target.stored_mode='customized'
      and reset.descendant_reset_sequence>=target.customized_sequence
    order by reset.descendant_reset_sequence desc,reset.depth
    limit 1
  )
  select source.resource_type,
         source.resource_id,
         source.customized_sequence,
         reset.resource_type,
         reset.resource_id,
         reset.descendant_reset_sequence,
         overwritten.resource_type,
         overwritten.resource_id,
         overwritten.descendant_reset_sequence,
         coalesce((
           select md5(string_agg(
             node.depth::text || ':' || node.resource_type || ':' || node.resource_id::text || ':' || node.parent_link_sequence::text,
             '|' order by node.depth
           ))
           from path node
         ),md5(''))
  from selected_source source
  left join selected_reset reset on true
  left join target_overwrite overwritten on true;
$$;

COMMIT;
