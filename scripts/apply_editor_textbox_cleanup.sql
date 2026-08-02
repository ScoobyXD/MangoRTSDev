\set ON_ERROR_STOP on

-- Retired by the V3 database-table cutover.
-- The strict migration 20260802_zz_v3_database_table_cutover.sql now performs
-- all validation, copying, attachment-identity conversion, and table removal in
-- one transaction. Keeping this former cleanup command executable would permit
-- an unsafe partial cutover, so it always aborts without changing data.

do $$
begin
  raise exception 'apply_editor_textbox_cleanup.sql is retired by the V3 database-table cutover; use the reviewed strict V3 migration';
end $$;