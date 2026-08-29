-- Human-gated retirement sentinel. This migration intentionally performs no
-- destructive work. Deploy the shortcut-free application, stop old instances,
-- then run scripts/retire_unused_operational_tables_preflight.sql with a
-- database-enforced read-only credential before running the approved operator.
-- The operator takes the migration advisory lock, drops the exact four approved
-- tables, and records this filename atomically so the normal runner skips it.
do $$
declare
  tables_still_present text;
begin
  select string_agg(target.name, ', ' order by target.name)
  into tables_still_present
  from (values
    ('user_logic_gate_shortcuts'),
    ('workspace_derived_domain_event_projection_checkpoints'),
    ('process_map_actual_size_layout_recovery_placements'),
    ('process_map_actual_size_layout_recovery_runs')
  ) target(name)
  where to_regclass('public.' || target.name) is not null;

  if tables_still_present is not null then
    raise exception 'STOP: human-gated retirement is required for: %. Run scripts/retire_unused_operational_tables_preflight.sql and scripts/retire_unused_operational_tables.sql; this migration never drops tables',
      tables_still_present;
  end if;
end;
$$;
