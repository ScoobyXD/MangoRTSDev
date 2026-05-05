alter table kanban_cards
  add column if not exists description_snapshot text not null default '',
  add column if not exists status text not null default '',
  add column if not exists work_type text not null default '',
  add column if not exists assigned_to text not null default '',
  add column if not exists assigned_by text not null default '',
  add column if not exists created_by text not null default '',
  add column if not exists updated_by text not null default '',
  add column if not exists last_activity text not null default '',
  add column if not exists status_entered_timestamp timestamptz not null default now();

-- Existing cards predate explicit metadata. Use the current column title as their
-- first status so status-age calculations have a concrete starting point.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'kanban_cards'
      and column_name = 'item_type'
  ) then
    update kanban_cards card
    set status = column_ref.title,
        status_entered_timestamp = least(card.updated_timestamp, now()),
        work_type = case when card.item_type = 'logic_gate' then 'Logic Gate' else 'Node' end
    from kanban_columns column_ref
    where card.company_id = column_ref.company_id
      and card.board_id = column_ref.board_id
      and card.column_id = column_ref.column_id
      and card.status = '';
  else
    update kanban_cards card
    set status = column_ref.title,
        status_entered_timestamp = least(card.updated_timestamp, now()),
        work_type = 'Node'
    from kanban_columns column_ref
    where card.company_id = column_ref.company_id
      and card.board_id = column_ref.board_id
      and card.column_id = column_ref.column_id
      and card.status = '';
  end if;
end $$;

create index if not exists idx_kanban_cards_status_position
  on kanban_cards(company_id, board_id, status, position);

create index if not exists idx_kanban_cards_assigned_to_position
  on kanban_cards(company_id, board_id, assigned_to, position);

create index if not exists idx_kanban_cards_work_type_position
  on kanban_cards(company_id, board_id, work_type, position);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'kanban_cards'
      and column_name = 'item_type'
  ) then
    execute 'create index if not exists idx_kanban_cards_item_type_position
      on kanban_cards(company_id, board_id, item_type, position)';
  end if;
end $$;

create index if not exists idx_kanban_cards_status_entered
  on kanban_cards(company_id, board_id, status_entered_timestamp);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'kanban_cards'
      and column_name = 'title_snapshot'
  ) then
    execute 'create index if not exists idx_kanban_cards_title_prefix
      on kanban_cards(company_id, board_id, lower(title_snapshot) text_pattern_ops)';
  end if;
end $$;
