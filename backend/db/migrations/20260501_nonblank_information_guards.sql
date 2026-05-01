-- Prevent new blank editor/information rows without requiring an immediate cleanup
-- of old accidental blanks. NOT VALID means existing rows are left alone, but
-- every new insert/update still has to satisfy the check.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'node_information_nonblank_chk'
      and conrelid = 'node_information'::regclass
  ) then
    alter table node_information
      add constraint node_information_nonblank_chk
      check (btrim(information) <> '') not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'node_projection_table_nonblank_chk'
      and conrelid = 'node_projection_table'::regclass
  ) then
    alter table node_projection_table
      add constraint node_projection_table_nonblank_chk
      check (btrim(information) <> '') not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'logic_gate_information_nonblank_chk'
      and conrelid = 'logic_gate_information'::regclass
  ) then
    alter table logic_gate_information
      add constraint logic_gate_information_nonblank_chk
      check (btrim(information) <> '') not valid;
  end if;
end $$;
