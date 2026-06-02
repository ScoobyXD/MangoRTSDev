-- Retire legacy Kanban storage. The board API now reads synthesized board and
-- column shapes plus kanban_board_projection rows sourced from
-- node_logic_gate_assignments.

drop trigger if exists trg_sync_node_logic_gate_assignment_from_kanban_card on kanban_cards;
drop function if exists sync_node_logic_gate_assignment_from_kanban_card();

do $$
declare
  legacy_fk_name text;
begin
  if to_regclass('node_logic_gate_assignments') is not null
     and to_regclass('kanban_columns') is not null then
    select constraint_name
    into legacy_fk_name
    from information_schema.table_constraints
    where table_schema = current_schema()
      and table_name = 'node_logic_gate_assignments'
      and constraint_type = 'FOREIGN KEY'
      and constraint_name in (
        select con.conname
        from pg_constraint con
        where con.conrelid = 'node_logic_gate_assignments'::regclass
          and con.confrelid = 'kanban_columns'::regclass
      )
    limit 1;

    if legacy_fk_name is not null then
      execute format('alter table node_logic_gate_assignments drop constraint %I', legacy_fk_name);
    end if;
  end if;
end $$;

alter table if exists node_logic_gate_assignments
  alter column column_id type text using column_id::text;

update node_logic_gate_assignments
set column_id = case
    when lower(replace(replace(trim(status_key), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then 'in_progress'
    when lower(replace(replace(trim(status_key), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v') then 'verify'
    when lower(replace(replace(trim(status_key), '_', ' '), '-', ' ')) in ('done', 'd') then 'done'
    else 'pending'
  end,
  status_key = case
    when lower(replace(replace(trim(status_key), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then 'in_progress'
    when lower(replace(replace(trim(status_key), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v') then 'verify'
    when lower(replace(replace(trim(status_key), '_', ' '), '-', ' ')) in ('done', 'd') then 'done'
    else 'pending'
  end
where btrim(coalesce(status_key, '')) <> '';

alter table if exists kanban_board_projection
  alter column column_id type text using column_id::text;

update kanban_board_projection
set column_id = case
    when lower(replace(replace(trim(status), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then 'in_progress'
    when lower(replace(replace(trim(status), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v') then 'verify'
    when lower(replace(replace(trim(status), '_', ' '), '-', ' ')) in ('done', 'd') then 'done'
    else 'pending'
  end,
  status = case
    when lower(replace(replace(trim(status), '_', ' '), '-', ' ')) in ('in progress', 'inprogress', 'ip') then 'in_progress'
    when lower(replace(replace(trim(status), '_', ' '), '-', ' ')) in ('verify', 'verification', 'v') then 'verify'
    when lower(replace(replace(trim(status), '_', ' '), '-', ' ')) in ('done', 'd') then 'done'
    else 'pending'
  end
where btrim(coalesce(status, '')) <> '';

drop table if exists kanban_cards cascade;
drop table if exists kanban_columns cascade;
drop table if exists kanban_boards cascade;
