create index if not exists idx_recycle_bin_items_company_user_deleted
  on recycle_bin_items(company_id, deleted_by_user_id, deleted_timestamp desc, recycle_bin_item_id desc)
  where deleted_by_user_id is not null;
