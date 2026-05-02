-- Cleanup after the abandoned workspace-context data plane:
-- - remove unused workspace context event/projection tables
-- - rename company-scoped explorer folders away from workspace terminology

drop table if exists workspace_context_projections;
drop table if exists workspace_context_events;

do $$
begin
  if to_regclass('public.company_explorer_folders') is null
     and to_regclass('public.workspace_folders') is not null then
    alter table public.workspace_folders rename to company_explorer_folders;
  end if;

  if to_regclass('public.company_explorer_folder_items') is null
     and to_regclass('public.workspace_folder_items') is not null then
    alter table public.workspace_folder_items rename to company_explorer_folder_items;
  end if;

  if to_regclass('public.company_explorer_folders') is not null
     and to_regclass('public.workspace_folders') is not null then
    insert into public.company_explorer_folders
      (company_id, folder_id, parent_folder_id, folder_kind, name, created_timestamp, updated_timestamp)
    select company_id, folder_id, parent_folder_id, folder_kind, name, created_timestamp, updated_timestamp
    from public.workspace_folders
    on conflict (company_id, folder_id) do nothing;
  end if;

  if to_regclass('public.company_explorer_folder_items') is not null
     and to_regclass('public.workspace_folder_items') is not null then
    insert into public.company_explorer_folder_items
      (company_id, folder_id, item_type, item_id, created_timestamp, updated_timestamp)
    select company_id, folder_id, item_type, item_id, created_timestamp, updated_timestamp
    from public.workspace_folder_items
    on conflict (company_id, item_type, item_id) do update set
      folder_id = excluded.folder_id,
      updated_timestamp = excluded.updated_timestamp;
  end if;

  if to_regclass('public.workspace_folder_items') is not null
     and to_regclass('public.company_explorer_folder_items') is not null then
    drop table public.workspace_folder_items;
  end if;

  if to_regclass('public.workspace_folders') is not null
     and to_regclass('public.company_explorer_folders') is not null then
    drop table public.workspace_folders;
  end if;
end $$;

do $$
begin
  if to_regclass('public.company_explorer_folders') is not null then
    if exists (select 1 from pg_constraint where conrelid = 'public.company_explorer_folders'::regclass and conname = 'workspace_folders_pkey') then
      alter table public.company_explorer_folders rename constraint workspace_folders_pkey to company_explorer_folders_pkey;
    end if;
    if exists (select 1 from pg_constraint where conrelid = 'public.company_explorer_folders'::regclass and conname = 'workspace_folders_kind_chk') then
      alter table public.company_explorer_folders rename constraint workspace_folders_kind_chk to company_explorer_folders_kind_chk;
    end if;
    if exists (select 1 from pg_constraint where conrelid = 'public.company_explorer_folders'::regclass and conname = 'workspace_folders_name_nonblank_chk') then
      alter table public.company_explorer_folders rename constraint workspace_folders_name_nonblank_chk to company_explorer_folders_name_nonblank_chk;
    end if;
    if exists (select 1 from pg_constraint where conrelid = 'public.company_explorer_folders'::regclass and conname = 'workspace_folders_parent_not_self_chk') then
      alter table public.company_explorer_folders rename constraint workspace_folders_parent_not_self_chk to company_explorer_folders_parent_not_self_chk;
    end if;
    if exists (select 1 from pg_constraint where conrelid = 'public.company_explorer_folders'::regclass and conname = 'workspace_folders_company_id_parent_folder_id_fkey') then
      alter table public.company_explorer_folders rename constraint workspace_folders_company_id_parent_folder_id_fkey to company_explorer_folders_company_id_parent_folder_id_fkey;
    end if;
  end if;

  if to_regclass('public.company_explorer_folder_items') is not null then
    if exists (select 1 from pg_constraint where conrelid = 'public.company_explorer_folder_items'::regclass and conname = 'workspace_folder_items_pkey') then
      alter table public.company_explorer_folder_items rename constraint workspace_folder_items_pkey to company_explorer_folder_items_pkey;
    end if;
    if exists (select 1 from pg_constraint where conrelid = 'public.company_explorer_folder_items'::regclass and conname = 'workspace_folder_items_type_chk') then
      alter table public.company_explorer_folder_items rename constraint workspace_folder_items_type_chk to company_explorer_folder_items_type_chk;
    end if;
    if exists (select 1 from pg_constraint where conrelid = 'public.company_explorer_folder_items'::regclass and conname = 'workspace_folder_items_company_id_folder_id_fkey') then
      alter table public.company_explorer_folder_items rename constraint workspace_folder_items_company_id_folder_id_fkey to company_explorer_folder_items_company_id_folder_id_fkey;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.idx_workspace_folders_parent_kind') is not null
     and to_regclass('public.idx_company_explorer_folders_parent_kind') is null then
    alter index public.idx_workspace_folders_parent_kind rename to idx_company_explorer_folders_parent_kind;
  end if;

  if to_regclass('public.idx_workspace_folder_items_folder_type') is not null
     and to_regclass('public.idx_company_explorer_folder_items_folder_type') is null then
    alter index public.idx_workspace_folder_items_folder_type rename to idx_company_explorer_folder_items_folder_type;
  end if;
end $$;
