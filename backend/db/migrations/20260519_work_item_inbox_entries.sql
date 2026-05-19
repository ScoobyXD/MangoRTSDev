-- Rebuildable read model for work-item inbox endpoints.
-- Source of truth remains nodes, node_logic_gate_assignments, logic_gates,
-- logic_gate_raci_assignments, users, and company_memberships.
create table if not exists work_item_inbox_entries (
  entry_id uuid not null,
  company_id uuid not null,
  user_id uuid not null,
  entry_kind text not null,
  role text not null,
  node_id uuid,
  logic_gate_id uuid,
  assignment_id uuid,
  status_key text,
  column_id uuid,
  column_title text,
  column_color text,
  compatibility_board_id text,
  compatibility_card_id uuid,
  is_issue boolean,
  position integer,
  node_title text,
  status text,
  status_color text,
  due_date date,
  priority smallint,
  assignee_user_id uuid,
  assignee_display_name text,
  assignee_email text,
  logic_gate_ids jsonb not null default '[]'::jsonb,
  node_created_timestamp timestamptz,
  logic_gate_header text,
  logic_gate_created_timestamp timestamptz,
  raci_created_timestamp timestamptz,
  raci_user_display_name text,
  raci_user_email text,
  source_version bigint not null default 1,
  source_updated_timestamp timestamptz not null default now(),
  projected_timestamp timestamptz not null default now(),
  constraint work_item_inbox_entries_kind_chk check (entry_kind in ('node', 'logic_gate')),
  constraint work_item_inbox_entries_role_chk check (role in ('assignee', 'responsible', 'accountable', 'consulted', 'informed')),
  constraint work_item_inbox_entries_shape_chk check (
    (
      entry_kind = 'node'
      and role = 'assignee'
      and node_id is not null
      and assignee_user_id = user_id
    )
    or (
      entry_kind = 'logic_gate'
      and role in ('responsible', 'accountable', 'consulted', 'informed')
      and logic_gate_id is not null
      and node_id is null
    )
  ),
  constraint work_item_inbox_entries_logic_gate_ids_array_chk check (jsonb_typeof(logic_gate_ids) = 'array'),
  primary key (company_id, entry_id),
  foreign key (user_id) references users (user_id) on delete cascade
);

create unique index if not exists idx_work_item_inbox_entries_node_user
  on work_item_inbox_entries(company_id, user_id, node_id)
  where entry_kind = 'node';

create unique index if not exists idx_work_item_inbox_entries_logic_gate_user_role
  on work_item_inbox_entries(company_id, logic_gate_id, user_id, role)
  where entry_kind = 'logic_gate';

create index if not exists idx_work_item_inbox_entries_node_read
  on work_item_inbox_entries(company_id, user_id, node_created_timestamp, node_id)
  where entry_kind = 'node';

create index if not exists idx_work_item_inbox_entries_logic_gate_read
  on work_item_inbox_entries(company_id, user_id, lower(logic_gate_header), logic_gate_id)
  where entry_kind = 'logic_gate';

create index if not exists idx_work_item_inbox_entries_logic_gate_assignments
  on work_item_inbox_entries(
    company_id,
    logic_gate_id,
    role,
    lower(coalesce(nullif(raci_user_display_name, ''), nullif(raci_user_email, ''), user_id::text)),
    user_id
  )
  where entry_kind = 'logic_gate';

create or replace function rebuild_work_item_inbox_entries_for_node(p_company_id uuid, p_node_id uuid)
returns void as $$
begin
  delete from work_item_inbox_entries entry
  where entry.company_id = p_company_id
    and entry.entry_kind = 'node'
    and entry.node_id = p_node_id;

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
    md5(n.company_id::text || ':node:' || n.node_id::text || ':assignee:' || n.assignee_user_id::text)::uuid,
    n.company_id,
    n.assignee_user_id,
    'node',
    'assignee',
    n.node_id,
    assignment.logic_gate_id,
    assignment.assignment_id,
    assignment.status_key,
    assignment.column_id,
    column_row.title,
    column_row.item_color,
    assignment.compatibility_board_id,
    assignment.compatibility_card_id,
    assignment.is_issue,
    assignment.position,
    n.title,
    coalesce(
      case
        when assignment.is_issue then 'Issue'
        else column_row.title
      end,
      nullif(n.status, '')
    ),
    coalesce(
      case
        when assignment.is_issue then '#ffd400'
        else column_row.item_color
      end,
      nullif(n.status_color, '')
    ),
    n.due_date,
    n.priority,
    n.assignee_user_id,
    nullif(assignee.display_name, ''),
    nullif(assignee.email, ''),
    coalesce(node_logic_gates.logic_gate_ids_json, '[]'::jsonb),
    n.created_timestamp,
    coalesce(assignment.version, 1),
    greatest(
      n.created_timestamp,
      coalesce(assignment.updated_timestamp, n.created_timestamp),
      coalesce(column_row.updated_timestamp, n.created_timestamp),
      coalesce(assignee.updated_timestamp, n.created_timestamp)
    ),
    now()
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
    and n.assignee_user_id is not null
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

create or replace function rebuild_work_item_inbox_entries_for_logic_gate(p_company_id uuid, p_logic_gate_id uuid)
returns void as $$
begin
  delete from work_item_inbox_entries entry
  where entry.company_id = p_company_id
    and entry.entry_kind = 'logic_gate'
    and entry.logic_gate_id = p_logic_gate_id;

  insert into work_item_inbox_entries (
    entry_id,
    company_id,
    user_id,
    entry_kind,
    role,
    logic_gate_id,
    logic_gate_header,
    logic_gate_created_timestamp,
    raci_created_timestamp,
    raci_user_display_name,
    raci_user_email,
    source_updated_timestamp,
    projected_timestamp
  )
  select
    md5(logic_gate.company_id::text || ':logic_gate:' || logic_gate.logic_gate_id::text || ':' || assignment.role || ':' || assignment.user_id::text)::uuid,
    logic_gate.company_id,
    assignment.user_id,
    'logic_gate',
    assignment.role,
    logic_gate.logic_gate_id,
    logic_gate.header,
    logic_gate.created_timestamp,
    assignment.created_timestamp,
    nullif(app_user.display_name, ''),
    nullif(app_user.email, ''),
    greatest(logic_gate.created_timestamp, assignment.created_timestamp, app_user.updated_timestamp),
    now()
  from logic_gates logic_gate
  join logic_gate_raci_assignments assignment
    on assignment.company_id = logic_gate.company_id
   and assignment.logic_gate_id = logic_gate.logic_gate_id
  join company_memberships membership
    on membership.company_id = assignment.company_id
   and membership.user_id = assignment.user_id
  join users app_user
    on app_user.user_id = assignment.user_id
  where logic_gate.company_id = p_company_id
    and logic_gate.logic_gate_id = p_logic_gate_id
  on conflict (company_id, entry_id)
  do update set
    user_id = excluded.user_id,
    role = excluded.role,
    logic_gate_header = excluded.logic_gate_header,
    logic_gate_created_timestamp = excluded.logic_gate_created_timestamp,
    raci_created_timestamp = excluded.raci_created_timestamp,
    raci_user_display_name = excluded.raci_user_display_name,
    raci_user_email = excluded.raci_user_email,
    source_updated_timestamp = excluded.source_updated_timestamp,
    projected_timestamp = excluded.projected_timestamp;
end;
$$ language plpgsql;

create or replace function rebuild_work_item_inbox_entries_for_company(p_company_id uuid)
returns void as $$
declare
  source_row record;
begin
  delete from work_item_inbox_entries entry
  where entry.company_id = p_company_id;

  for source_row in
    select node_id
    from nodes
    where company_id = p_company_id
  loop
    perform rebuild_work_item_inbox_entries_for_node(p_company_id, source_row.node_id);
  end loop;

  for source_row in
    select logic_gate_id
    from logic_gates
    where company_id = p_company_id
  loop
    perform rebuild_work_item_inbox_entries_for_logic_gate(p_company_id, source_row.logic_gate_id);
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
  end loop;
end;
$$ language plpgsql;

create or replace function rebuild_work_item_inbox_entries_for_user(p_user_id uuid)
returns void as $$
declare
  source_row record;
begin
  for source_row in
    select company_id
    from company_memberships
    where user_id = p_user_id
  loop
    perform rebuild_work_item_inbox_entries_for_membership(source_row.company_id, p_user_id);
  end loop;
end;
$$ language plpgsql;

create or replace function rebuild_work_item_inbox_entries_for_column(p_company_id uuid, p_board_id text, p_column_id uuid)
returns void as $$
declare
  source_row record;
begin
  for source_row in
    select node_id
    from node_logic_gate_assignments
    where company_id = p_company_id
      and compatibility_board_id = p_board_id
      and column_id = p_column_id
  loop
    perform rebuild_work_item_inbox_entries_for_node(p_company_id, source_row.node_id);
  end loop;
end;
$$ language plpgsql;

create or replace function trg_rebuild_work_item_inbox_entries_node()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform rebuild_work_item_inbox_entries_for_node(old.company_id, old.node_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and (old.company_id is distinct from new.company_id or old.node_id is distinct from new.node_id) then
    perform rebuild_work_item_inbox_entries_for_node(old.company_id, old.node_id);
  end if;

  perform rebuild_work_item_inbox_entries_for_node(new.company_id, new.node_id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rebuild_work_item_inbox_entries_node on nodes;
create trigger trg_rebuild_work_item_inbox_entries_node
after insert or update or delete on nodes
for each row execute function trg_rebuild_work_item_inbox_entries_node();

create or replace function trg_rebuild_work_item_inbox_entries_assignment()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform rebuild_work_item_inbox_entries_for_node(old.company_id, old.node_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and (old.company_id is distinct from new.company_id or old.node_id is distinct from new.node_id) then
    perform rebuild_work_item_inbox_entries_for_node(old.company_id, old.node_id);
  end if;

  perform rebuild_work_item_inbox_entries_for_node(new.company_id, new.node_id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rebuild_work_item_inbox_entries_assignment on node_logic_gate_assignments;
create trigger trg_rebuild_work_item_inbox_entries_assignment
after insert or update or delete on node_logic_gate_assignments
for each row execute function trg_rebuild_work_item_inbox_entries_assignment();

create or replace function trg_rebuild_work_item_inbox_entries_logic_gate()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform rebuild_work_item_inbox_entries_for_logic_gate(old.company_id, old.logic_gate_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and (old.company_id is distinct from new.company_id or old.logic_gate_id is distinct from new.logic_gate_id) then
    perform rebuild_work_item_inbox_entries_for_logic_gate(old.company_id, old.logic_gate_id);
  end if;

  perform rebuild_work_item_inbox_entries_for_logic_gate(new.company_id, new.logic_gate_id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rebuild_work_item_inbox_entries_logic_gate on logic_gates;
create trigger trg_rebuild_work_item_inbox_entries_logic_gate
after insert or update or delete on logic_gates
for each row execute function trg_rebuild_work_item_inbox_entries_logic_gate();

create or replace function trg_rebuild_work_item_inbox_entries_raci()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform rebuild_work_item_inbox_entries_for_logic_gate(old.company_id, old.logic_gate_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and (old.company_id is distinct from new.company_id or old.logic_gate_id is distinct from new.logic_gate_id) then
    perform rebuild_work_item_inbox_entries_for_logic_gate(old.company_id, old.logic_gate_id);
  end if;

  perform rebuild_work_item_inbox_entries_for_logic_gate(new.company_id, new.logic_gate_id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rebuild_work_item_inbox_entries_raci on logic_gate_raci_assignments;
create trigger trg_rebuild_work_item_inbox_entries_raci
after insert or update or delete on logic_gate_raci_assignments
for each row execute function trg_rebuild_work_item_inbox_entries_raci();

create or replace function trg_rebuild_work_item_inbox_entries_membership()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform rebuild_work_item_inbox_entries_for_membership(old.company_id, old.user_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and (old.company_id is distinct from new.company_id or old.user_id is distinct from new.user_id) then
    perform rebuild_work_item_inbox_entries_for_membership(old.company_id, old.user_id);
  end if;

  perform rebuild_work_item_inbox_entries_for_membership(new.company_id, new.user_id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rebuild_work_item_inbox_entries_membership on company_memberships;
create trigger trg_rebuild_work_item_inbox_entries_membership
after insert or update or delete on company_memberships
for each row execute function trg_rebuild_work_item_inbox_entries_membership();

create or replace function trg_rebuild_work_item_inbox_entries_user()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    delete from work_item_inbox_entries entry
    where entry.user_id = old.user_id
       or entry.assignee_user_id = old.user_id;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform rebuild_work_item_inbox_entries_for_user(old.user_id);
  end if;

  perform rebuild_work_item_inbox_entries_for_user(new.user_id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rebuild_work_item_inbox_entries_user on users;
create trigger trg_rebuild_work_item_inbox_entries_user
after update or delete on users
for each row execute function trg_rebuild_work_item_inbox_entries_user();

create or replace function trg_rebuild_work_item_inbox_entries_column()
returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform rebuild_work_item_inbox_entries_for_column(old.company_id, old.board_id, old.column_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and (old.company_id is distinct from new.company_id or old.board_id is distinct from new.board_id or old.column_id is distinct from new.column_id) then
    perform rebuild_work_item_inbox_entries_for_column(old.company_id, old.board_id, old.column_id);
  end if;

  perform rebuild_work_item_inbox_entries_for_column(new.company_id, new.board_id, new.column_id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rebuild_work_item_inbox_entries_column on kanban_columns;
create trigger trg_rebuild_work_item_inbox_entries_column
after update or delete on kanban_columns
for each row execute function trg_rebuild_work_item_inbox_entries_column();

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
end $$;
