-- Kanban cards are now node-only. Keep the hot card row small so UI reads and
-- headless agent reads do not carry unused logic-gate/filter metadata.

delete from kanban_cards
where node_id is null;

drop index if exists idx_kanban_cards_unique_logic_gate;
drop index if exists idx_kanban_cards_unique_node;
drop index if exists idx_kanban_cards_status_position;
drop index if exists idx_kanban_cards_assigned_to_position;
drop index if exists idx_kanban_cards_work_type_position;
drop index if exists idx_kanban_cards_item_type_position;
drop index if exists idx_kanban_cards_status_entered;
drop index if exists idx_kanban_cards_title_prefix;

alter table kanban_cards
  drop constraint if exists kanban_cards_title_snapshot_nonblank_chk,
  drop constraint if exists kanban_cards_item_type_chk,
  drop constraint if exists kanban_cards_one_item_chk,
  drop constraint if exists kanban_cards_node_title_nonblank_chk;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'kanban_cards' and column_name = 'title_snapshot'
  ) and not exists (
    select 1 from information_schema.columns
    where table_name = 'kanban_cards' and column_name = 'node_title'
  ) then
    alter table kanban_cards rename column title_snapshot to node_title;
  end if;
end $$;

alter table kanban_cards
  add column if not exists node_title text,
  add column if not exists description_snapshot text not null default '';

update kanban_cards
set node_title = coalesce(nullif(btrim(node_title), ''), node_id::text)
where node_title is null or btrim(node_title) = '';

alter table kanban_cards
  alter column node_id set not null,
  alter column node_title set not null,
  add constraint kanban_cards_node_title_nonblank_chk check (btrim(node_title) <> ''),
  drop column if exists item_type,
  drop column if exists logic_gate_id,
  drop column if exists status,
  drop column if exists work_type,
  drop column if exists assigned_to,
  drop column if exists assigned_by,
  drop column if exists created_by,
  drop column if exists updated_by,
  drop column if exists last_activity,
  drop column if exists status_entered_timestamp,
  drop column if exists title_snapshot;

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'kanban_cards'::regclass
    and contype = 'f'
    and pg_get_constraintdef(oid) like 'FOREIGN KEY (company_id, node_id)%';

  if constraint_name is not null then
    execute format('alter table kanban_cards drop constraint %I', constraint_name);
  end if;
end $$;

alter table kanban_cards
  add constraint kanban_cards_company_id_node_id_fkey
  foreign key (company_id, node_id) references nodes (company_id, node_id) on delete cascade;

create unique index if not exists idx_kanban_cards_unique_node
  on kanban_cards(company_id, board_id, node_id);
