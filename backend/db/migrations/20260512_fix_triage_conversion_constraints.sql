alter type information_type add value if not exists 'Attached email';

drop index if exists idx_kanban_cards_unique_logic_gate;
