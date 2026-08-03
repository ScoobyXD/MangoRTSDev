-- Read-only inventory and reconciliation for the additive V3 chat phase.
-- Requires the expansion component from the operator-controlled Step 2.

begin transaction read only;

select migration_state, migration_reason, count(*) as source_rows
from v3_node_textbox_chat_source_v1
group by migration_state, migration_reason
order by migration_state, migration_reason;

select
  count(*) as legacy_chat_rows,
  count(*) filter (where migration_state = 'already_copied') as exactly_copied_rows,
  count(*) filter (where migration_state = 'ready_to_copy') as delta_rows,
  count(*) filter (where migration_state = 'discarded_deleted_host') as deleted_host_rows,
  count(*) filter (where migration_state = 'needs_human_mapping') as review_rows,
  count(*) filter (where parent_detached) as detached_parent_rows,
  (select count(*) from node_textbox_chats) as permanent_chat_rows
from v3_node_textbox_chat_source_v1;

-- Full exception identities are returned without chat bodies. A clean copy has
-- no target_conflict rows. Review rows remain in legacy storage for a human
-- decision and block application cutover, but do not block safe snapshot rows.
select
  company_id,
  node_id,
  chat_id,
  textbox_id,
  migration_state,
  migration_reason,
  requested_parent_chat_id,
  parent_detached,
  legacy_selection_message_id
from v3_node_textbox_chat_source_v1
where migration_state in ('ready_to_copy', 'needs_human_mapping')
order by migration_state, company_id, node_id, chat_id;

select
  run_id,
  status,
  summary,
  started_timestamp,
  completed_timestamp
from v3_migration_runs
where phase = 'node_textbox_chats'
order by started_timestamp desc, run_id desc;

commit;
