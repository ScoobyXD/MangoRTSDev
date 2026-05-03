-- Prevent board placement rows from blocking node/logic-gate deletes.
-- These indexes keep API delete cleanup bounded by company + item id even when a
-- company has many boards and cards.
create index if not exists idx_kanban_cards_node_cleanup
  on kanban_cards(company_id, node_id)
  where node_id is not null;

create index if not exists idx_kanban_cards_logic_gate_cleanup
  on kanban_cards(company_id, logic_gate_id)
  where logic_gate_id is not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'kanban_cards_company_id_node_id_fkey'
  ) then
    alter table kanban_cards
      drop constraint kanban_cards_company_id_node_id_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'kanban_cards_node_fk'
  ) then
    alter table kanban_cards
      add constraint kanban_cards_node_fk
      foreign key (company_id, node_id)
      references nodes (company_id, node_id)
      on delete cascade;
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'kanban_cards_company_id_logic_gate_id_fkey'
  ) then
    alter table kanban_cards
      drop constraint kanban_cards_company_id_logic_gate_id_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'kanban_cards_logic_gate_fk'
  ) then
    alter table kanban_cards
      add constraint kanban_cards_logic_gate_fk
      foreign key (company_id, logic_gate_id)
      references logic_gates (company_id, logic_gate_id)
      on delete cascade;
  end if;
end $$;
