-- Remove the generic browser-replication queue and obsolete replay cursors.
-- Retained notification, Node chat, and mounted-board scopes publish compact
-- post-commit hints directly; canonical HTTP reads remain the recovery path.
drop table if exists event_rows cascade;

drop table if exists notification_domain_event_projection_checkpoints cascade;

drop index if exists idx_domain_events_pending;
alter table if exists domain_events
  drop column if exists published_timestamp;

drop table if exists company_projection_sequences cascade;
drop function if exists mangorts_trg_bump_logic_gate_work_from_projection_sequence();
