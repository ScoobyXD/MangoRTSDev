-- Multi-block node editor support.
--
-- Text boxes are now independent projection rows keyed by information_id.
-- Block chat messages and attached email references are lightweight JSON
-- projections so UI clients and future headless agents share the same hot
-- read model.

alter type information_type add value if not exists 'Text block chat';
alter type information_type add value if not exists 'Attached email';

drop index if exists idx_node_projection_table_one_text_box;

create index if not exists idx_node_projection_table_node_type_created
  on node_projection_table(company_id, node_id, type, created_timestamp, information_id);
