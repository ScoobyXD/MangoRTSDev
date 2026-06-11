create table if not exists recycle_bin_items (
  company_id uuid not null,
  recycle_bin_item_id uuid not null,
  object_kind text not null,
  object_id text not null,
  object_label text not null,
  object_folder_kind text,
  restore_payload jsonb not null,
  deleted_by_user_id uuid,
  deleted_timestamp timestamptz not null default now(),
  constraint recycle_bin_items_kind_chk check (object_kind in ('folder', 'node', 'logic_gate', 'project', 'kanban')),
  constraint recycle_bin_items_object_id_nonblank_chk check (btrim(object_id) <> ''),
  constraint recycle_bin_items_object_label_nonblank_chk check (btrim(object_label) <> ''),
  constraint recycle_bin_items_folder_kind_chk check (
    object_folder_kind is null
    or object_folder_kind in ('node', 'logic_gate', 'project', 'communications')
  ),
  primary key (company_id, recycle_bin_item_id),
  foreign key (company_id) references companies(company_id) on delete cascade,
  foreign key (deleted_by_user_id) references users(user_id) on delete set null
);

create index if not exists idx_recycle_bin_items_company_deleted
  on recycle_bin_items(company_id, deleted_timestamp desc, recycle_bin_item_id desc);
