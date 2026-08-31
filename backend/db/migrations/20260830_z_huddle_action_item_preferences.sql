alter table saved_views
  drop constraint if exists saved_views_surface_chk;

alter table saved_views
  add constraint saved_views_surface_chk
  check (surface in (
    'updates',
    'logic_gate_kanban',
    'my_work_action_items_mine',
    'my_work_action_items_delegated',
    'huddle_logic_gate_action_items',
    'huddle_node_action_items'
  ));

drop index if exists idx_saved_views_my_work_action_items_user_single;

create unique index if not exists idx_saved_views_action_items_user_single
  on saved_views(company_id, surface, principal, principal_id)
  where surface in (
    'my_work_action_items_mine',
    'my_work_action_items_delegated',
    'huddle_logic_gate_action_items',
    'huddle_node_action_items'
  ) and principal = 'user';
