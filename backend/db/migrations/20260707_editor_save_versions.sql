alter table node_information
  add column if not exists save_batch_id uuid,
  add column if not exists save_kind text not null default 'legacy',
  add column if not exists saved_by_user_id uuid,
  add column if not exists saved_by_display_name text not null default '',
  add column if not exists source_information_id uuid;

alter table logic_gate_information
  add column if not exists save_batch_id uuid,
  add column if not exists save_kind text not null default 'legacy',
  add column if not exists saved_by_user_id uuid,
  add column if not exists saved_by_display_name text not null default '',
  add column if not exists source_information_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'node_information_save_kind_chk'
      and conrelid = 'node_information'::regclass
  ) then
    alter table node_information
      add constraint node_information_save_kind_chk
      check (save_kind in ('legacy', 'manual', 'auto'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'logic_gate_information_save_kind_chk'
      and conrelid = 'logic_gate_information'::regclass
  ) then
    alter table logic_gate_information
      add constraint logic_gate_information_save_kind_chk
      check (save_kind in ('legacy', 'manual', 'auto'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'node_information_saved_by_user_fk'
      and conrelid = 'node_information'::regclass
  ) then
    alter table node_information
      add constraint node_information_saved_by_user_fk
      foreign key (saved_by_user_id)
      references users (user_id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'logic_gate_information_saved_by_user_fk'
      and conrelid = 'logic_gate_information'::regclass
  ) then
    alter table logic_gate_information
      add constraint logic_gate_information_saved_by_user_fk
      foreign key (saved_by_user_id)
      references users (user_id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_node_information_save_batch
  on node_information(company_id, node_id, save_batch_id, created_timestamp desc)
  where save_batch_id is not null;

create index if not exists idx_logic_gate_information_save_batch
  on logic_gate_information(company_id, logic_gate_id, save_batch_id, created_timestamp desc)
  where save_batch_id is not null;
