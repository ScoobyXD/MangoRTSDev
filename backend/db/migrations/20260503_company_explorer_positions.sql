-- Company Explorer row order is API-backed so UI users and headless agents can
-- reorder folders/items with the same sparse-position contract used by Kanban.

alter table company_explorer_folders
  add column if not exists position integer;

with ranked as (
  select company_id, folder_id,
         row_number() over (
           partition by company_id, folder_kind, parent_folder_id
           order by created_timestamp asc, folder_id asc
         ) * 1000 as next_position
  from company_explorer_folders
)
update company_explorer_folders folders
set position = ranked.next_position
from ranked
where folders.company_id = ranked.company_id
  and folders.folder_id = ranked.folder_id
  and folders.position is null;

alter table company_explorer_folders
  alter column position set default 1000,
  alter column position set not null;

drop index if exists idx_company_explorer_folders_parent_kind;
create index if not exists idx_company_explorer_folders_parent_kind
  on company_explorer_folders(company_id, folder_kind, parent_folder_id, position, created_timestamp);

alter table company_explorer_folder_items
  add column if not exists position integer;

with ranked as (
  select company_id, item_type, item_id,
         row_number() over (
           partition by company_id, folder_id, item_type
           order by created_timestamp asc, item_id asc
         ) * 1000 as next_position
  from company_explorer_folder_items
)
update company_explorer_folder_items items
set position = ranked.next_position
from ranked
where items.company_id = ranked.company_id
  and items.item_type = ranked.item_type
  and items.item_id = ranked.item_id
  and items.position is null;

alter table company_explorer_folder_items
  alter column position set default 1000,
  alter column position set not null;

drop index if exists idx_company_explorer_folder_items_folder_type;
create index if not exists idx_company_explorer_folder_items_folder_type
  on company_explorer_folder_items(company_id, folder_id, item_type, position, created_timestamp);
