-- Source table for node-to-Logic-Gate work assignment.
-- Kanban cards remain compatibility/projection rows for the existing board UI.
create table if not exists node_logic_gate_assignments (
  assignment_id uuid not null,
  company_id uuid not null,
  node_id uuid not null,
  logic_gate_id uuid not null,
  status_key text not null,
  column_id uuid not null,
  is_issue boolean not null default false,
  position integer not null,
  compatibility_board_id text not null,
  compatibility_card_id uuid not null,
  version bigint not null default 1,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint node_logic_gate_assignments_status_key_chk check (btrim(status_key) <> ''),
  constraint node_logic_gate_assignments_version_positive_chk check (version > 0),
  primary key (company_id, assignment_id),
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade,
  foreign key (company_id, logic_gate_id) references logic_gates (company_id, logic_gate_id) on delete cascade,
  foreign key (company_id, compatibility_board_id, column_id) references kanban_columns (company_id, board_id, column_id)
);

create unique index if not exists idx_node_logic_gate_assignments_one_active_node
  on node_logic_gate_assignments(company_id, node_id);

create index if not exists idx_node_logic_gate_assignments_logic_gate_position
  on node_logic_gate_assignments(company_id, logic_gate_id, column_id, position, updated_timestamp desc);

create unique index if not exists idx_node_logic_gate_assignments_compat_card
  on node_logic_gate_assignments(company_id, compatibility_board_id, compatibility_card_id);

with ranked_logic_gate_cards as (
  select
    card.company_id,
    card.board_id,
    card.card_id,
    card.column_id,
    card.node_id,
    card.logic_gate_id,
    card.is_issue,
    card.position,
    card.created_timestamp,
    card.updated_timestamp,
    regexp_replace(lower(btrim(translate(column_row.title, '_-', '  '))), '[[:space:]]+', ' ', 'g') as status_key,
    row_number() over (
      partition by card.company_id, card.node_id
      order by card.updated_timestamp desc, card.created_timestamp desc, card.card_id desc
    ) as rn
  from kanban_cards card
  join kanban_columns column_row
    on column_row.company_id = card.company_id
   and column_row.board_id = card.board_id
   and column_row.column_id = card.column_id
  where card.logic_gate_id is not null
)
insert into node_logic_gate_assignments (
  assignment_id,
  company_id,
  node_id,
  logic_gate_id,
  status_key,
  column_id,
  is_issue,
  position,
  compatibility_board_id,
  compatibility_card_id,
  version,
  created_timestamp,
  updated_timestamp
)
select
  md5(card.company_id::text || ':' || card.node_id::text || ':' || card.logic_gate_id::text)::uuid,
  card.company_id,
  card.node_id,
  card.logic_gate_id,
  coalesce(nullif(card.status_key, ''), 'unknown'),
  card.column_id,
  card.is_issue,
  card.position,
  card.board_id,
  card.card_id,
  1,
  card.created_timestamp,
  card.updated_timestamp
from ranked_logic_gate_cards card
where card.rn = 1
on conflict (company_id, node_id)
do update set
  logic_gate_id = excluded.logic_gate_id,
  status_key = excluded.status_key,
  column_id = excluded.column_id,
  is_issue = excluded.is_issue,
  position = excluded.position,
  compatibility_board_id = excluded.compatibility_board_id,
  compatibility_card_id = excluded.compatibility_card_id,
  updated_timestamp = excluded.updated_timestamp;

create or replace function sync_node_logic_gate_assignment_from_kanban_card()
returns trigger as $$
declare
  next_status_key text;
  next_assignment_id uuid;
begin
  if tg_op = 'DELETE' then
    if old.logic_gate_id is not null then
      delete from node_logic_gate_assignments assignment
      where assignment.company_id = old.company_id
        and assignment.node_id = old.node_id
        and assignment.compatibility_board_id = old.board_id
        and assignment.compatibility_card_id = old.card_id;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.logic_gate_id is not null
     and (
       new.logic_gate_id is null
       or old.company_id is distinct from new.company_id
       or old.node_id is distinct from new.node_id
       or old.board_id is distinct from new.board_id
       or old.card_id is distinct from new.card_id
     ) then
    delete from node_logic_gate_assignments assignment
    where assignment.company_id = old.company_id
      and assignment.node_id = old.node_id
      and assignment.compatibility_board_id = old.board_id
      and assignment.compatibility_card_id = old.card_id;
  end if;

  if new.logic_gate_id is not null then
    select regexp_replace(lower(btrim(translate(column_row.title, '_-', '  '))), '[[:space:]]+', ' ', 'g')
    into next_status_key
    from kanban_columns column_row
    where column_row.company_id = new.company_id
      and column_row.board_id = new.board_id
      and column_row.column_id = new.column_id;

    next_status_key := coalesce(nullif(next_status_key, ''), 'unknown');

    select assignment.assignment_id
    into next_assignment_id
    from node_logic_gate_assignments assignment
    where assignment.company_id = new.company_id
      and assignment.node_id = new.node_id;

    next_assignment_id := coalesce(
      next_assignment_id,
      md5(new.company_id::text || ':' || new.node_id::text || ':' || new.logic_gate_id::text)::uuid
    );

    insert into node_logic_gate_assignments (
      assignment_id,
      company_id,
      node_id,
      logic_gate_id,
      status_key,
      column_id,
      is_issue,
      position,
      compatibility_board_id,
      compatibility_card_id,
      version,
      created_timestamp,
      updated_timestamp
    ) values (
      next_assignment_id,
      new.company_id,
      new.node_id,
      new.logic_gate_id,
      next_status_key,
      new.column_id,
      new.is_issue,
      new.position,
      new.board_id,
      new.card_id,
      1,
      new.created_timestamp,
      new.updated_timestamp
    )
    on conflict (company_id, node_id)
    do update set
      logic_gate_id = excluded.logic_gate_id,
      status_key = excluded.status_key,
      column_id = excluded.column_id,
      is_issue = excluded.is_issue,
      position = excluded.position,
      compatibility_board_id = excluded.compatibility_board_id,
      compatibility_card_id = excluded.compatibility_card_id,
      version = case
        when node_logic_gate_assignments.logic_gate_id is distinct from excluded.logic_gate_id
          or node_logic_gate_assignments.status_key is distinct from excluded.status_key
          or node_logic_gate_assignments.column_id is distinct from excluded.column_id
          or node_logic_gate_assignments.is_issue is distinct from excluded.is_issue
          or node_logic_gate_assignments.position is distinct from excluded.position
          or node_logic_gate_assignments.compatibility_board_id is distinct from excluded.compatibility_board_id
          or node_logic_gate_assignments.compatibility_card_id is distinct from excluded.compatibility_card_id
        then node_logic_gate_assignments.version + 1
        else node_logic_gate_assignments.version
      end,
      updated_timestamp = case
        when node_logic_gate_assignments.logic_gate_id is distinct from excluded.logic_gate_id
          or node_logic_gate_assignments.status_key is distinct from excluded.status_key
          or node_logic_gate_assignments.column_id is distinct from excluded.column_id
          or node_logic_gate_assignments.is_issue is distinct from excluded.is_issue
          or node_logic_gate_assignments.position is distinct from excluded.position
          or node_logic_gate_assignments.compatibility_board_id is distinct from excluded.compatibility_board_id
          or node_logic_gate_assignments.compatibility_card_id is distinct from excluded.compatibility_card_id
        then now()
        else node_logic_gate_assignments.updated_timestamp
      end;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_node_logic_gate_assignment_from_kanban_card on kanban_cards;
create trigger trg_sync_node_logic_gate_assignment_from_kanban_card
after insert or update or delete on kanban_cards
for each row execute function sync_node_logic_gate_assignment_from_kanban_card();