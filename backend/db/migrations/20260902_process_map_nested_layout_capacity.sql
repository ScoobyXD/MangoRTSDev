-- Raise only the permitted rectangle dimensions for nested Process Map layout.
-- Run before deploying the larger automatic defaults. Saved geometry, trace
-- routes, revisions, timestamps, integer column types, and world bounds stay put.

begin;

do $$
declare
  server_number integer := current_setting('server_version_num')::integer;
begin
  raise notice 'Process Map capacity migration PostgreSQL server_version=% server_version_num=%',
    current_setting('server_version'), server_number;
  if server_number < 170000 or server_number >= 190000 then
    raise exception 'STOP: Process Map capacity migration supports PostgreSQL 17.x and 18.x';
  end if;
end $$;

alter table public.process_map_placements
  drop constraint process_map_placements_geometry_chk,
  add constraint process_map_placements_geometry_chk check (
    grid_x >= -1000000000 and grid_y >= -1000000000
    and grid_width > 0 and grid_width <= 250000000
    and grid_height > 0 and grid_height <= 250000000
    and grid_x::bigint + grid_width <= 1000000000
    and grid_y::bigint + grid_height <= 1000000000
  );

commit;
