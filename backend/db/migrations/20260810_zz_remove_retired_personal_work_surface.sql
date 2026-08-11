-- Remove the retired personal work surface and its disposable database state.
-- Canonical RACI assignments, Nodes, Logic Gates, Projects, and their typed
-- relationships remain unchanged.
begin;

do $$
declare
  server_num integer := current_setting('server_version_num')::integer;
begin
  raise notice 'server_version=%, server_version_num=%',
    current_setting('server_version'), server_num;

  if server_num < 170000 or server_num >= 190000 then
    raise exception 'STOP: retired personal work surface cleanup supports PostgreSQL 17.x and 18.x; connected server_version_num=%',
      server_num;
  end if;

  if to_regclass('public.saved_views') is null then
    raise exception 'STOP: saved_views is missing';
  end if;
end
$$;

delete from saved_views
where surface = 'my_work';

alter table saved_views
  drop constraint if exists saved_views_surface_chk;

alter table saved_views
  add constraint saved_views_surface_chk
  check (surface in ('updates', 'logic_gate_kanban'));

drop function if exists mangorts_v2_step1_preflight_report();
drop table if exists gvic_matrix_projection_table;
drop table if exists racio_matrix_projection_table;

do $$
declare
  legacy_table record;
begin
  for legacy_table in
    select quote_ident(schemaname) as schema_name, quote_ident(tablename) as table_name
    from pg_tables
    where schemaname = 'public'
      and tablename like 'gvic_matrix_projection_table_legacy_20260621%'
  loop
    execute format('drop table %s.%s', legacy_table.schema_name, legacy_table.table_name);
  end loop;
end
$$;

commit;
