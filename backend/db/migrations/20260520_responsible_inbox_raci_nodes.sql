-- Responsible Inbox node visibility is driven by Logic Gate Responsible RACI,
-- not by the node person-in-charge. My Nodes remains assignee-based.

alter table work_item_inbox_entries
  drop constraint if exists work_item_inbox_entries_shape_chk;

alter table work_item_inbox_entries
  add constraint work_item_inbox_entries_shape_chk check (
    (
      entry_kind = 'node'
      and role = 'assignee'
      and node_id is not null
      and assignee_user_id = user_id
    )
    or (
      entry_kind = 'node'
      and role = 'responsible'
      and node_id is not null
      and logic_gate_id is not null
    )
    or (
      entry_kind = 'logic_gate'
      and role in ('responsible', 'accountable', 'consulted', 'informed')
      and logic_gate_id is not null
      and node_id is null
    )
  );

drop index if exists idx_work_item_inbox_entries_node_user;
drop index if exists idx_work_item_inbox_entries_node_read;

create unique index if not exists idx_work_item_inbox_entries_node_user_role
  on work_item_inbox_entries(company_id, user_id, node_id, role)
  where entry_kind = 'node';

create index if not exists idx_work_item_inbox_entries_node_read
  on work_item_inbox_entries(company_id, user_id, role, node_created_timestamp, node_id)
  where entry_kind = 'node';

create or replace function rebuild_work_item_inbox_entries_for_node(p_company_id uuid, p_node_id uuid)
returns void as $$
begin
  delete from work_item_inbox_entries entry
  where entry.company_id = p_company_id
    and entry.entry_kind = 'node'
    and entry.node_id = p_node_id;

  with node_read_model as (
    select
      n.company_id,
      n.node_id,
      assignment.logic_gate_id,
      assignment.assignment_id,
      assignment.status_key,
      assignment.column_id,
      column_row.title as column_title,
      column_row.item_color as column_color,
      assignment.compatibility_board_id,
      assignment.compatibility_card_id,
      assignment.is_issue,
      assignment.position,
      n.title as node_title,
      coalesce(
        case
          when assignment.is_issue then 'Issue'
          else column_row.title
        end,
        nullif(n.status, '')
      ) as status,
      coalesce(
        case
          when assignment.is_issue then '#ffd400'
          else column_row.item_color
        end,
        nullif(n.status_color, '')
      ) as status_color,
      n.due_date,
      n.priority,
      n.assignee_user_id,
      nullif(assignee.display_name, '') as assignee_display_name,
      nullif(assignee.email, '') as assignee_email,
      coalesce(node_logic_gates.logic_gate_ids_json, '[]'::jsonb) as logic_gate_ids,
      n.created_timestamp as node_created_timestamp,
      coalesce(assignment.version, 1) as source_version,
      greatest(
        n.created_timestamp,
        coalesce(assignment.updated_timestamp, n.created_timestamp),
        coalesce(column_row.updated_timestamp, n.created_timestamp),
        coalesce(assignee.updated_timestamp, n.created_timestamp)
      ) as source_updated_timestamp
    from nodes n
    left join lateral (
      select assignment_row.*
      from node_logic_gate_assignments assignment_row
      where assignment_row.company_id = n.company_id
        and assignment_row.node_id = n.node_id
      order by assignment_row.updated_timestamp desc, assignment_row.created_timestamp desc, assignment_row.assignment_id desc
      limit 1
    ) assignment on true
    left join kanban_columns column_row
      on column_row.company_id = assignment.company_id
     and column_row.board_id = assignment.compatibility_board_id
     and column_row.column_id = assignment.column_id
    left join company_memberships assignee_membership
      on assignee_membership.company_id = n.company_id
     and assignee_membership.user_id = n.assignee_user_id
    left join users assignee
      on assignee.user_id = assignee_membership.user_id
    left join lateral (
      select coalesce(jsonb_agg(gate.logic_gate_id order by gate.logic_gate_id), '[]'::jsonb) as logic_gate_ids_json
      from (
        select distinct assignment_row.logic_gate_id::text as logic_gate_id
        from node_logic_gate_assignments assignment_row
        where assignment_row.company_id = n.company_id
          and assignment_row.node_id = n.node_id
      ) gate
    ) node_logic_gates on true
    where n.company_id = p_company_id
      and n.node_id = p_node_id
  ),
  node_recipients as (
    select
      md5(n.company_id::text || ':node:' || n.node_id::text || ':assignee:' || n.assignee_user_id::text)::uuid as entry_id,
      n.company_id,
      n.assignee_user_id as user_id,
      'assignee'::text as role,
      n.node_id,
      n.logic_gate_id,
      n.assignment_id,
      n.status_key,
      n.column_id,
      n.column_title,
      n.column_color,
      n.compatibility_board_id,
      n.compatibility_card_id,
      n.is_issue,
      n.position,
      n.node_title,
      n.status,
      n.status_color,
      n.due_date,
      n.priority,
      n.assignee_user_id,
      n.assignee_display_name,
      n.assignee_email,
      n.logic_gate_ids,
      n.node_created_timestamp,
      n.source_version,
      n.source_updated_timestamp
    from node_read_model n
    where n.assignee_user_id is not null
    union all
    select
      md5(n.company_id::text || ':node:' || n.node_id::text || ':responsible:' || raci.user_id::text)::uuid as entry_id,
      n.company_id,
      raci.user_id,
      'responsible',
      n.node_id,
      n.logic_gate_id,
      n.assignment_id,
      n.status_key,
      n.column_id,
      n.column_title,
      n.column_color,
      n.compatibility_board_id,
      n.compatibility_card_id,
      n.is_issue,
      n.position,
      n.node_title,
      n.status,
      n.status_color,
      n.due_date,
      n.priority,
      n.assignee_user_id,
      n.assignee_display_name,
      n.assignee_email,
      n.logic_gate_ids,
      n.node_created_timestamp,
      n.source_version,
      n.source_updated_timestamp
    from node_read_model n
    join logic_gate_raci_assignments raci
      on raci.company_id = n.company_id
     and raci.logic_gate_id = n.logic_gate_id
     and raci.role = 'responsible'
    join company_memberships responsible_membership
      on responsible_membership.company_id = raci.company_id
     and responsible_membership.user_id = raci.user_id
    where n.logic_gate_id is not null
  )
  insert into work_item_inbox_entries (
    entry_id,
    company_id,
    user_id,
    entry_kind,
    role,
    node_id,
    logic_gate_id,
    assignment_id,
    status_key,
    column_id,
    column_title,
    column_color,
    compatibility_board_id,
    compatibility_card_id,
    is_issue,
    position,
    node_title,
    status,
    status_color,
    due_date,
    priority,
    assignee_user_id,
    assignee_display_name,
    assignee_email,
    logic_gate_ids,
    node_created_timestamp,
    source_version,
    source_updated_timestamp,
    projected_timestamp
  )
  select
    entry_id,
    company_id,
    user_id,
    'node',
    role,
    node_id,
    logic_gate_id,
    assignment_id,
    status_key,
    column_id,
    column_title,
    column_color,
    compatibility_board_id,
    compatibility_card_id,
    is_issue,
    position,
    node_title,
    status,
    status_color,
    due_date,
    priority,
    assignee_user_id,
    assignee_display_name,
    assignee_email,
    logic_gate_ids,
    node_created_timestamp,
    source_version,
    source_updated_timestamp,
    now()
  from node_recipients
  on conflict (company_id, entry_id)
  do update set
    user_id = excluded.user_id,
    logic_gate_id = excluded.logic_gate_id,
    assignment_id = excluded.assignment_id,
    status_key = excluded.status_key,
    column_id = excluded.column_id,
    column_title = excluded.column_title,
    column_color = excluded.column_color,
    compatibility_board_id = excluded.compatibility_board_id,
    compatibility_card_id = excluded.compatibility_card_id,
    is_issue = excluded.is_issue,
    position = excluded.position,
    node_title = excluded.node_title,
    status = excluded.status,
    status_color = excluded.status_color,
    due_date = excluded.due_date,
    priority = excluded.priority,
    assignee_user_id = excluded.assignee_user_id,
    assignee_display_name = excluded.assignee_display_name,
    assignee_email = excluded.assignee_email,
    logic_gate_ids = excluded.logic_gate_ids,
    node_created_timestamp = excluded.node_created_timestamp,
    source_version = excluded.source_version,
    source_updated_timestamp = excluded.source_updated_timestamp,
    projected_timestamp = excluded.projected_timestamp;
end;
$$ language plpgsql;

create or replace function rebuild_work_item_inbox_entries_for_logic_gate_nodes(p_company_id uuid, p_logic_gate_id uuid)
returns void as $$
declare
  source_row record;
begin
  for source_row in
    select node_id
    from node_logic_gate_assignments
    where company_id = p_company_id
      and logic_gate_id = p_logic_gate_id
  loop
    perform rebuild_work_item_inbox_entries_for_node(p_company_id, source_row.node_id);
  end loop;
end;
$$ language plpgsql;

create or replace function rebuild_work_item_inbox_entries_for_membership(p_company_id uuid, p_user_id uuid)
returns void as $$
declare
  source_row record;
begin
  for source_row in
    select node_id
    from nodes
    where company_id = p_company_id
      and assignee_user_id = p_user_id
  loop
    perform rebuild_work_item_inbox_entries_for_node(p_company_id, source_row.node_id);
  end loop;

  for source_row in
    select distinct logic_gate_id
    from logic_gate_raci_assignments
    where company_id = p_company_id
      and user_id = p_user_id
  loop
    perform rebuild_work_item_inbox_entries_for_logic_gate(p_company_id, source_row.logic_gate_id);
    perform rebuild_work_item_inbox_entries_for_logic_gate_nodes(p_company_id, source_row.logic_gate_id);
  end loop;
end;
$$ language plpgsql;

create or replace function trg_rebuild_work_item_inbox_entries_raci()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform rebuild_work_item_inbox_entries_for_logic_gate(old.company_id, old.logic_gate_id);
    perform rebuild_work_item_inbox_entries_for_logic_gate_nodes(old.company_id, old.logic_gate_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and (old.company_id is distinct from new.company_id or old.logic_gate_id is distinct from new.logic_gate_id) then
    perform rebuild_work_item_inbox_entries_for_logic_gate(old.company_id, old.logic_gate_id);
    perform rebuild_work_item_inbox_entries_for_logic_gate_nodes(old.company_id, old.logic_gate_id);
  end if;

  perform rebuild_work_item_inbox_entries_for_logic_gate(new.company_id, new.logic_gate_id);
  perform rebuild_work_item_inbox_entries_for_logic_gate_nodes(new.company_id, new.logic_gate_id);
  return new;
end;
$$ language plpgsql;

do $$
declare
  company_row record;
begin
  for company_row in
    select company_id
    from companies
  loop
    perform rebuild_work_item_inbox_entries_for_company(company_row.company_id);
  end loop;
end;
$$;
