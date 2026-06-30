delete from saved_view_preferences
where surface = 'logic_gate_kanban';

with ranked as (
  select
    company_id,
    saved_view_id,
    row_number() over (
      partition by company_id, surface, principal, principal_id
      order by updated_timestamp desc, created_timestamp desc, saved_view_id desc
    ) as rank
  from saved_views
  where surface = 'logic_gate_kanban'
    and principal = 'user'
)
delete from saved_views view
using ranked
where view.company_id = ranked.company_id
  and view.saved_view_id = ranked.saved_view_id
  and ranked.rank > 1;

create unique index if not exists idx_saved_views_logic_gate_kanban_user_single
  on saved_views(company_id, surface, principal, principal_id)
  where surface = 'logic_gate_kanban' and principal = 'user';

alter table saved_view_preferences
  drop constraint if exists saved_view_preferences_surface_chk;

alter table saved_view_preferences
  add constraint saved_view_preferences_surface_chk
  check (surface in ('my_work', 'updates'));
