alter table saved_views
  drop constraint if exists saved_views_surface_chk;

alter table saved_views
  add constraint saved_views_surface_chk
  check (surface in ('my_work', 'updates', 'logic_gate_kanban'));

create table if not exists saved_view_preferences (
  company_id uuid not null,
  surface text not null,
  user_id uuid not null,
  selected_saved_view_id uuid,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint saved_view_preferences_surface_chk check (surface in ('my_work', 'updates', 'logic_gate_kanban')),
  primary key (company_id, surface, user_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (company_id, user_id) references company_memberships(company_id, user_id) on delete cascade
);

alter table node_logic_gate_assignments
  add column if not exists placed_by_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'node_logic_gate_assignments_placed_by_user_id_fkey'
  ) then
    alter table node_logic_gate_assignments
      add constraint node_logic_gate_assignments_placed_by_user_id_fkey
      foreign key (company_id, placed_by_user_id)
      references company_memberships(company_id, user_id)
      on delete set null;
  end if;
end $$;

alter table kanban_board_projection
  add column if not exists placed_by_user_id uuid;

update kanban_board_projection projection
set placed_by_user_id = assignment.placed_by_user_id
from node_logic_gate_assignments assignment
where projection.company_id = assignment.company_id
  and projection.logic_gate_id = assignment.logic_gate_id
  and projection.node_id = assignment.node_id
  and projection.placed_by_user_id is distinct from assignment.placed_by_user_id;
