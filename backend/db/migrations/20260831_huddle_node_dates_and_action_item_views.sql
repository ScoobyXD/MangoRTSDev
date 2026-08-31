alter table huddle_nodes
  add column if not exists huddle_date date;

update huddle_nodes
set huddle_date=(created_timestamp at time zone 'America/Los_Angeles')::date
where huddle_date is null;

update recycle_bin_items item
set restore_payload=jsonb_set(
  item.restore_payload,
  '{huddle_nodes}',
  (
    select jsonb_agg(
      case
        when node ? 'huddle_date' and nullif(node->>'huddle_date','') is not null then node
        when nullif(node->>'created_timestamp','') is not null then jsonb_set(
          node,
          '{huddle_date}',
          to_jsonb(((node->>'created_timestamp')::timestamptz at time zone 'America/Los_Angeles')::date),
          true
        )
        else node
      end
      order by ordinal
    )
    from jsonb_array_elements(item.restore_payload->'huddle_nodes') with ordinality as restored(node,ordinal)
  ),
  false
)
where jsonb_typeof(item.restore_payload->'huddle_nodes')='array'
  and exists (
    select 1
    from jsonb_array_elements(item.restore_payload->'huddle_nodes') as restored(node)
    where (not node ? 'huddle_date' or nullif(node->>'huddle_date','') is null)
      and nullif(node->>'created_timestamp','') is not null
  );

alter table huddle_nodes
  alter column huddle_date set default ((statement_timestamp() at time zone 'America/Los_Angeles')::date),
  alter column huddle_date set not null;

delete from saved_views
where surface='huddle_node_action_items';

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
    'huddle_node_created_action_items',
    'huddle_node_due_action_items'
  ));

drop index if exists idx_saved_views_action_items_user_single;

create unique index idx_saved_views_action_items_user_single
  on saved_views(company_id,surface,principal,principal_id)
  where surface in (
    'my_work_action_items_mine',
    'my_work_action_items_delegated',
    'huddle_logic_gate_action_items',
    'huddle_node_created_action_items',
    'huddle_node_due_action_items'
  ) and principal='user';
