-- Phase 2 cleanup for the GVIC/node-name/review contract.
--
-- Keep legacy projection table shape for now because active projection rebuild
-- code still writes those tables, but remove stale payload values and old names
-- from runtime state.

alter table nodes
  drop column if exists status_color,
  drop column if exists assignee_user_id;

do $$
begin
  if to_regclass('public.projection_versions') is not null then
    update projection_versions
    set projection = 'gvic_matrix'
    where projection = 'racio_matrix';
  end if;
end
$$;

delete from resource_gvic_effective_assignments
where role in ('responsible', 'accountable')
   or source_principal_type = 'assignee';

delete from resource_gvic_assignments
where role in ('responsible', 'accountable');

do $$
begin
  if to_regclass('public.racio_matrix_projection_table') is not null then
    update racio_matrix_projection_table
    set status_color = null,
        assignee_user_id = null,
        assignee_display_name = null,
        assignee_email = null
    where status_color is not null
       or assignee_user_id is not null
       or assignee_display_name is not null
       or assignee_email is not null;
  end if;
end
$$;

do $$
begin
  if to_regclass('public.kanban_board_projection') is not null then
    update kanban_board_projection
    set assignee_user_id = null
    where assignee_user_id is not null;
  end if;
end
$$;

do $$
begin
  if to_regclass('public.project_management_timeline_projection') is not null then
    update project_management_timeline_projection
    set status_color = null,
        assignee_user_id = null,
        assignee_display_name = null,
        assignee_email = null
    where status_color is not null
       or assignee_user_id is not null
       or assignee_display_name is not null
       or assignee_email is not null;
  end if;
end
$$;
