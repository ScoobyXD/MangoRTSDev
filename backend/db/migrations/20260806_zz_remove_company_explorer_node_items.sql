-- Remove the retired Company Explorer Node placement projection.
-- Nodes and their business relationships remain authoritative and untouched.
begin;

do $$
declare
  server_num integer := current_setting('server_version_num')::integer;
begin
  raise notice 'server_version=%, server_version_num=%',
    current_setting('server_version'), server_num;

  if server_num < 170000 or server_num >= 190000 then
    raise exception 'STOP: Company Explorer Node placement cleanup supports PostgreSQL 17.x and 18.x; connected server_version_num=%',
      server_num;
  end if;

  if to_regclass('public.company_explorer_items') is null
     or to_regclass('public.company_explorer_folders') is null then
    raise exception 'STOP: Company Explorer tables are missing';
  end if;
end
$$;

delete from company_explorer_items
where target_type = 'node';

do $$
begin
  if exists (
    select 1
    from company_explorer_folders nodes_folder
    where nodes_folder.folder_id = (
      md5(nodes_folder.company_id::text || ':company_explorer_default_folder:unfiled_nodes')::uuid
    )
      and (
        exists (
          select 1
          from company_explorer_folders child
          where child.company_id = nodes_folder.company_id
            and child.parent_folder_id = nodes_folder.folder_id
        )
        or exists (
          select 1
          from company_explorer_items item
          where item.company_id = nodes_folder.company_id
            and item.parent_folder_id = nodes_folder.folder_id
        )
      )
  ) then
    raise exception 'STOP: a deterministic Unfiled/Nodes folder contains supported organization; no changes were committed';
  end if;
end
$$;

delete from company_explorer_folders nodes_folder
where nodes_folder.folder_id = (
  md5(nodes_folder.company_id::text || ':company_explorer_default_folder:unfiled_nodes')::uuid
);

alter table company_explorer_items
  drop constraint if exists company_explorer_items_target_type_chk;

alter table company_explorer_items
  add constraint company_explorer_items_target_type_chk
  check (target_type in ('project', 'logic_gate'));

commit;
