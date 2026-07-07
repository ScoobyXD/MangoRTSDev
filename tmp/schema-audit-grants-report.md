# Schema Inventory Diff

- Status: FAIL
- Expected inventory: `canonical-schema` (1743 compared objects)
- Actual inventory: `prod` (1810 compared objects)
- Missing in actual: 550
- Extra in actual: 617
- Different definitions: 16
- Grants compared: yes
- schema_migrations compared: no

## Missing In Actual

- `grant` `function:public.enforce_node_logic_gate_assignment_priority():postgres:EXECUTE`
- `grant` `function:public.mangorts_access_level_rank(p_access_level text):postgres:EXECUTE`
- `grant` `function:public.mangorts_try_uuid(p_value text):postgres:EXECUTE`
- `grant` `function:public.mangorts_user_can_access_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text):postgres:EXECUTE`
- `grant` `function:public.mangorts_user_can_view_entity(p_company_id uuid, p_entity_type text, p_entity_id uuid, p_user_id uuid):postgres:EXECUTE`
- `grant` `function:public.trg_update_workspace_read_versions():postgres:EXECUTE`
- `grant` `function:public.workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb):postgres:EXECUTE`
- `grant` `function:public.workspace_static_read_version_keys():postgres:EXECUTE`
- `grant` `relation:public.account_folders:postgres:DELETE`
- `grant` `relation:public.account_folders:postgres:INSERT`
- `grant` `relation:public.account_folders:postgres:MAINTAIN`
- `grant` `relation:public.account_folders:postgres:REFERENCES`
- `grant` `relation:public.account_folders:postgres:SELECT`
- `grant` `relation:public.account_folders:postgres:TRIGGER`
- `grant` `relation:public.account_folders:postgres:TRUNCATE`
- `grant` `relation:public.account_folders:postgres:UPDATE`
- `grant` `relation:public.accounts:postgres:DELETE`
- `grant` `relation:public.accounts:postgres:INSERT`
- `grant` `relation:public.accounts:postgres:MAINTAIN`
- `grant` `relation:public.accounts:postgres:REFERENCES`
- `grant` `relation:public.accounts:postgres:SELECT`
- `grant` `relation:public.accounts:postgres:TRIGGER`
- `grant` `relation:public.accounts:postgres:TRUNCATE`
- `grant` `relation:public.accounts:postgres:UPDATE`
- `grant` `relation:public.auth_external_identity_deletions:postgres:DELETE`
- `grant` `relation:public.auth_external_identity_deletions:postgres:INSERT`
- `grant` `relation:public.auth_external_identity_deletions:postgres:MAINTAIN`
- `grant` `relation:public.auth_external_identity_deletions:postgres:REFERENCES`
- `grant` `relation:public.auth_external_identity_deletions:postgres:SELECT`
- `grant` `relation:public.auth_external_identity_deletions:postgres:TRIGGER`
- `grant` `relation:public.auth_external_identity_deletions:postgres:TRUNCATE`
- `grant` `relation:public.auth_external_identity_deletions:postgres:UPDATE`
- `grant` `relation:public.communications_email_node_attachments:postgres:DELETE`
- `grant` `relation:public.communications_email_node_attachments:postgres:INSERT`
- `grant` `relation:public.communications_email_node_attachments:postgres:MAINTAIN`
- `grant` `relation:public.communications_email_node_attachments:postgres:REFERENCES`
- `grant` `relation:public.communications_email_node_attachments:postgres:SELECT`
- `grant` `relation:public.communications_email_node_attachments:postgres:TRIGGER`
- `grant` `relation:public.communications_email_node_attachments:postgres:TRUNCATE`
- `grant` `relation:public.communications_email_node_attachments:postgres:UPDATE`
- `grant` `relation:public.communications_email_nodes:postgres:DELETE`
- `grant` `relation:public.communications_email_nodes:postgres:INSERT`
- `grant` `relation:public.communications_email_nodes:postgres:MAINTAIN`
- `grant` `relation:public.communications_email_nodes:postgres:REFERENCES`
- `grant` `relation:public.communications_email_nodes:postgres:SELECT`
- `grant` `relation:public.communications_email_nodes:postgres:TRIGGER`
- `grant` `relation:public.communications_email_nodes:postgres:TRUNCATE`
- `grant` `relation:public.communications_email_nodes:postgres:UPDATE`
- `grant` `relation:public.communications_message_read_receipt_summaries:postgres:DELETE`
- `grant` `relation:public.communications_message_read_receipt_summaries:postgres:INSERT`
- `grant` `relation:public.communications_message_read_receipt_summaries:postgres:MAINTAIN`
- `grant` `relation:public.communications_message_read_receipt_summaries:postgres:REFERENCES`
- `grant` `relation:public.communications_message_read_receipt_summaries:postgres:SELECT`
- `grant` `relation:public.communications_message_read_receipt_summaries:postgres:TRIGGER`
- `grant` `relation:public.communications_message_read_receipt_summaries:postgres:TRUNCATE`
- `grant` `relation:public.communications_message_read_receipt_summaries:postgres:UPDATE`
- `grant` `relation:public.communications_message_read_statuses:postgres:DELETE`
- `grant` `relation:public.communications_message_read_statuses:postgres:INSERT`
- `grant` `relation:public.communications_message_read_statuses:postgres:MAINTAIN`
- `grant` `relation:public.communications_message_read_statuses:postgres:REFERENCES`
- `grant` `relation:public.communications_message_read_statuses:postgres:SELECT`
- `grant` `relation:public.communications_message_read_statuses:postgres:TRIGGER`
- `grant` `relation:public.communications_message_read_statuses:postgres:TRUNCATE`
- `grant` `relation:public.communications_message_read_statuses:postgres:UPDATE`
- `grant` `relation:public.communications_triage_items:postgres:DELETE`
- `grant` `relation:public.communications_triage_items:postgres:INSERT`
- `grant` `relation:public.communications_triage_items:postgres:MAINTAIN`
- `grant` `relation:public.communications_triage_items:postgres:REFERENCES`
- `grant` `relation:public.communications_triage_items:postgres:SELECT`
- `grant` `relation:public.communications_triage_items:postgres:TRIGGER`
- `grant` `relation:public.communications_triage_items:postgres:TRUNCATE`
- `grant` `relation:public.communications_triage_items:postgres:UPDATE`
- `grant` `relation:public.companies:postgres:DELETE`
- `grant` `relation:public.companies:postgres:INSERT`
- `grant` `relation:public.companies:postgres:MAINTAIN`
- `grant` `relation:public.companies:postgres:REFERENCES`
- `grant` `relation:public.companies:postgres:SELECT`
- `grant` `relation:public.companies:postgres:TRIGGER`
- `grant` `relation:public.companies:postgres:TRUNCATE`
- `grant` `relation:public.companies:postgres:UPDATE`
- `grant` `relation:public.company_email_connections:postgres:DELETE`
- `grant` `relation:public.company_email_connections:postgres:INSERT`
- `grant` `relation:public.company_email_connections:postgres:MAINTAIN`
- `grant` `relation:public.company_email_connections:postgres:REFERENCES`
- `grant` `relation:public.company_email_connections:postgres:SELECT`
- `grant` `relation:public.company_email_connections:postgres:TRIGGER`
- `grant` `relation:public.company_email_connections:postgres:TRUNCATE`
- `grant` `relation:public.company_email_connections:postgres:UPDATE`
- `grant` `relation:public.company_explorer_final_backfill_verification:postgres:DELETE`
- `grant` `relation:public.company_explorer_final_backfill_verification:postgres:INSERT`
- `grant` `relation:public.company_explorer_final_backfill_verification:postgres:MAINTAIN`
- `grant` `relation:public.company_explorer_final_backfill_verification:postgres:REFERENCES`
- `grant` `relation:public.company_explorer_final_backfill_verification:postgres:SELECT`
- `grant` `relation:public.company_explorer_final_backfill_verification:postgres:TRIGGER`
- `grant` `relation:public.company_explorer_final_backfill_verification:postgres:TRUNCATE`
- `grant` `relation:public.company_explorer_final_backfill_verification:postgres:UPDATE`
- `grant` `relation:public.company_explorer_folders:postgres:DELETE`
- `grant` `relation:public.company_explorer_folders:postgres:INSERT`
- `grant` `relation:public.company_explorer_folders:postgres:MAINTAIN`
- `grant` `relation:public.company_explorer_folders:postgres:REFERENCES`
- `grant` `relation:public.company_explorer_folders:postgres:SELECT`
- `grant` `relation:public.company_explorer_folders:postgres:TRIGGER`
- `grant` `relation:public.company_explorer_folders:postgres:TRUNCATE`
- `grant` `relation:public.company_explorer_folders:postgres:UPDATE`
- `grant` `relation:public.company_explorer_items:postgres:DELETE`
- `grant` `relation:public.company_explorer_items:postgres:INSERT`
- `grant` `relation:public.company_explorer_items:postgres:MAINTAIN`
- `grant` `relation:public.company_explorer_items:postgres:REFERENCES`
- `grant` `relation:public.company_explorer_items:postgres:SELECT`
- `grant` `relation:public.company_explorer_items:postgres:TRIGGER`
- `grant` `relation:public.company_explorer_items:postgres:TRUNCATE`
- `grant` `relation:public.company_explorer_items:postgres:UPDATE`
- `grant` `relation:public.company_memberships:postgres:DELETE`
- `grant` `relation:public.company_memberships:postgres:INSERT`
- `grant` `relation:public.company_memberships:postgres:MAINTAIN`
- `grant` `relation:public.company_memberships:postgres:REFERENCES`
- `grant` `relation:public.company_memberships:postgres:SELECT`
- `grant` `relation:public.company_memberships:postgres:TRIGGER`
- `grant` `relation:public.company_memberships:postgres:TRUNCATE`
- `grant` `relation:public.company_memberships:postgres:UPDATE`
- `grant` `relation:public.company_projection_sequences:postgres:DELETE`
- `grant` `relation:public.company_projection_sequences:postgres:INSERT`
- `grant` `relation:public.company_projection_sequences:postgres:MAINTAIN`
- `grant` `relation:public.company_projection_sequences:postgres:REFERENCES`
- `grant` `relation:public.company_projection_sequences:postgres:SELECT`
- `grant` `relation:public.company_projection_sequences:postgres:TRIGGER`
- `grant` `relation:public.company_projection_sequences:postgres:TRUNCATE`
- `grant` `relation:public.company_projection_sequences:postgres:UPDATE`
- `grant` `relation:public.company_user_group_closure:postgres:DELETE`
- `grant` `relation:public.company_user_group_closure:postgres:INSERT`
- `grant` `relation:public.company_user_group_closure:postgres:MAINTAIN`
- `grant` `relation:public.company_user_group_closure:postgres:REFERENCES`
- `grant` `relation:public.company_user_group_closure:postgres:SELECT`
- `grant` `relation:public.company_user_group_closure:postgres:TRIGGER`
- `grant` `relation:public.company_user_group_closure:postgres:TRUNCATE`
- `grant` `relation:public.company_user_group_closure:postgres:UPDATE`
- `grant` `relation:public.company_user_group_members:postgres:DELETE`
- `grant` `relation:public.company_user_group_members:postgres:INSERT`
- `grant` `relation:public.company_user_group_members:postgres:MAINTAIN`
- `grant` `relation:public.company_user_group_members:postgres:REFERENCES`
- `grant` `relation:public.company_user_group_members:postgres:SELECT`
- `grant` `relation:public.company_user_group_members:postgres:TRIGGER`
- `grant` `relation:public.company_user_group_members:postgres:TRUNCATE`
- `grant` `relation:public.company_user_group_members:postgres:UPDATE`
- `grant` `relation:public.company_user_groups:postgres:DELETE`
- `grant` `relation:public.company_user_groups:postgres:INSERT`
- `grant` `relation:public.company_user_groups:postgres:MAINTAIN`
- `grant` `relation:public.company_user_groups:postgres:REFERENCES`
- `grant` `relation:public.company_user_groups:postgres:SELECT`
- `grant` `relation:public.company_user_groups:postgres:TRIGGER`
- `grant` `relation:public.company_user_groups:postgres:TRUNCATE`
- `grant` `relation:public.company_user_groups:postgres:UPDATE`
- `grant` `relation:public.domain_events:postgres:DELETE`
- `grant` `relation:public.domain_events:postgres:INSERT`
- `grant` `relation:public.domain_events:postgres:MAINTAIN`
- `grant` `relation:public.domain_events:postgres:REFERENCES`
- `grant` `relation:public.domain_events:postgres:SELECT`
- `grant` `relation:public.domain_events:postgres:TRIGGER`
- `grant` `relation:public.domain_events:postgres:TRUNCATE`
- `grant` `relation:public.domain_events:postgres:UPDATE`
- `grant` `relation:public.event_rows:postgres:DELETE`
- `grant` `relation:public.event_rows:postgres:INSERT`
- `grant` `relation:public.event_rows:postgres:MAINTAIN`
- `grant` `relation:public.event_rows:postgres:REFERENCES`
- `grant` `relation:public.event_rows:postgres:SELECT`
- `grant` `relation:public.event_rows:postgres:TRIGGER`
- `grant` `relation:public.event_rows:postgres:TRUNCATE`
- `grant` `relation:public.event_rows:postgres:UPDATE`
- `grant` `relation:public.gvic_matrix_projection_table:postgres:DELETE`
- `grant` `relation:public.gvic_matrix_projection_table:postgres:INSERT`
- `grant` `relation:public.gvic_matrix_projection_table:postgres:MAINTAIN`
- `grant` `relation:public.gvic_matrix_projection_table:postgres:REFERENCES`
- `grant` `relation:public.gvic_matrix_projection_table:postgres:SELECT`
- `grant` `relation:public.gvic_matrix_projection_table:postgres:TRIGGER`
- `grant` `relation:public.gvic_matrix_projection_table:postgres:TRUNCATE`
- `grant` `relation:public.gvic_matrix_projection_table:postgres:UPDATE`
- `grant` `relation:public.invitations:postgres:DELETE`
- `grant` `relation:public.invitations:postgres:INSERT`
- `grant` `relation:public.invitations:postgres:MAINTAIN`
- `grant` `relation:public.invitations:postgres:REFERENCES`
- `grant` `relation:public.invitations:postgres:SELECT`
- `grant` `relation:public.invitations:postgres:TRIGGER`
- `grant` `relation:public.invitations:postgres:TRUNCATE`
- `grant` `relation:public.invitations:postgres:UPDATE`
- `grant` `relation:public.kanban_board_projection:postgres:DELETE`
- `grant` `relation:public.kanban_board_projection:postgres:INSERT`
- `grant` `relation:public.kanban_board_projection:postgres:MAINTAIN`
- `grant` `relation:public.kanban_board_projection:postgres:REFERENCES`
- `grant` `relation:public.kanban_board_projection:postgres:SELECT`
- `grant` `relation:public.kanban_board_projection:postgres:TRIGGER`
- `grant` `relation:public.kanban_board_projection:postgres:TRUNCATE`
- `grant` `relation:public.kanban_board_projection:postgres:UPDATE`
- `grant` `relation:public.logic_gate_information:postgres:DELETE`
- `grant` `relation:public.logic_gate_information:postgres:INSERT`
- `grant` `relation:public.logic_gate_information:postgres:MAINTAIN`
- `grant` `relation:public.logic_gate_information:postgres:REFERENCES`
- `grant` `relation:public.logic_gate_information:postgres:SELECT`
- `grant` `relation:public.logic_gate_information:postgres:TRIGGER`
- `grant` `relation:public.logic_gate_information:postgres:TRUNCATE`
- `grant` `relation:public.logic_gate_information:postgres:UPDATE`
- ... 350 more

## Extra In Actual

- `column` `public.communications_email_archive_job_items.archive_job_id`
- `column` `public.communications_email_archive_job_items.archived_timestamp`
- `column` `public.communications_email_archive_job_items.attempt_count`
- `column` `public.communications_email_archive_job_items.available_at`
- `column` `public.communications_email_archive_job_items.created_timestamp`
- `column` `public.communications_email_archive_job_items.failed_timestamp`
- `column` `public.communications_email_archive_job_items.job_item_id`
- `column` `public.communications_email_archive_job_items.last_error`
- `column` `public.communications_email_archive_job_items.message_id`
- `column` `public.communications_email_archive_job_items.processing_started_at`
- `column` `public.communications_email_archive_job_items.status`
- `column` `public.communications_email_archive_job_items.updated_timestamp`
- `column` `public.communications_email_archive_jobs.account_email`
- `column` `public.communications_email_archive_jobs.actor_user_id`
- `column` `public.communications_email_archive_jobs.archive_job_id`
- `column` `public.communications_email_archive_jobs.company_email_connection_id`
- `column` `public.communications_email_archive_jobs.company_id`
- `column` `public.communications_email_archive_jobs.completed_timestamp`
- `column` `public.communications_email_archive_jobs.connection_scope`
- `column` `public.communications_email_archive_jobs.created_timestamp`
- `column` `public.communications_email_archive_jobs.grant_id`
- `column` `public.communications_email_archive_jobs.provider`
- `column` `public.communications_email_archive_jobs.requested_count`
- `column` `public.communications_email_archive_jobs.shared_inbox_id`
- `column` `public.communications_email_archive_jobs.status`
- `column` `public.communications_email_archive_jobs.updated_timestamp`
- `constraint` `public.communications_email_archive_job_items.communications_email_archive_job__archive_job_id_message_id_key`
- `constraint` `public.communications_email_archive_job_items.communications_email_archive_job_items_archive_job_id_fkey`
- `constraint` `public.communications_email_archive_job_items.communications_email_archive_job_items_message_chk`
- `constraint` `public.communications_email_archive_job_items.communications_email_archive_job_items_pkey`
- `constraint` `public.communications_email_archive_job_items.communications_email_archive_job_items_status_chk`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_j_company_email_connection_id_fkey`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jo_company_id_shared_inbox_id_fkey`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_account_email_chk`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_actor_user_id_fkey`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_company_id_fkey`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_grant_id_chk`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_pkey`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_provider_chk`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_scope_chk`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_shared_scope_chk`
- `constraint` `public.communications_email_archive_jobs.communications_email_archive_jobs_status_chk`
- `grant` `function:public.enforce_node_logic_gate_assignment_priority():mangorts_app:EXECUTE`
- `grant` `function:public.mangorts_access_level_rank(p_access_level text):mangorts_app:EXECUTE`
- `grant` `function:public.mangorts_try_uuid(p_value text):mangorts_app:EXECUTE`
- `grant` `function:public.mangorts_user_can_access_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text):mangorts_app:EXECUTE`
- `grant` `function:public.mangorts_user_can_view_entity(p_company_id uuid, p_entity_type text, p_entity_id uuid, p_user_id uuid):mangorts_app:EXECUTE`
- `grant` `function:public.trg_update_workspace_read_versions():mangorts_app:EXECUTE`
- `grant` `function:public.workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb):mangorts_app:EXECUTE`
- `grant` `function:public.workspace_static_read_version_keys():mangorts_app:EXECUTE`
- `grant` `relation:public.account_folders:mangorts_app:DELETE`
- `grant` `relation:public.account_folders:mangorts_app:INSERT`
- `grant` `relation:public.account_folders:mangorts_app:MAINTAIN`
- `grant` `relation:public.account_folders:mangorts_app:REFERENCES`
- `grant` `relation:public.account_folders:mangorts_app:SELECT`
- `grant` `relation:public.account_folders:mangorts_app:TRIGGER`
- `grant` `relation:public.account_folders:mangorts_app:TRUNCATE`
- `grant` `relation:public.account_folders:mangorts_app:UPDATE`
- `grant` `relation:public.accounts:mangorts_app:DELETE`
- `grant` `relation:public.accounts:mangorts_app:INSERT`
- `grant` `relation:public.accounts:mangorts_app:MAINTAIN`
- `grant` `relation:public.accounts:mangorts_app:REFERENCES`
- `grant` `relation:public.accounts:mangorts_app:SELECT`
- `grant` `relation:public.accounts:mangorts_app:TRIGGER`
- `grant` `relation:public.accounts:mangorts_app:TRUNCATE`
- `grant` `relation:public.accounts:mangorts_app:UPDATE`
- `grant` `relation:public.auth_external_identity_deletions:mangorts_app:DELETE`
- `grant` `relation:public.auth_external_identity_deletions:mangorts_app:INSERT`
- `grant` `relation:public.auth_external_identity_deletions:mangorts_app:MAINTAIN`
- `grant` `relation:public.auth_external_identity_deletions:mangorts_app:REFERENCES`
- `grant` `relation:public.auth_external_identity_deletions:mangorts_app:SELECT`
- `grant` `relation:public.auth_external_identity_deletions:mangorts_app:TRIGGER`
- `grant` `relation:public.auth_external_identity_deletions:mangorts_app:TRUNCATE`
- `grant` `relation:public.auth_external_identity_deletions:mangorts_app:UPDATE`
- `grant` `relation:public.communications_email_archive_job_items:mangorts_app:DELETE`
- `grant` `relation:public.communications_email_archive_job_items:mangorts_app:INSERT`
- `grant` `relation:public.communications_email_archive_job_items:mangorts_app:MAINTAIN`
- `grant` `relation:public.communications_email_archive_job_items:mangorts_app:REFERENCES`
- `grant` `relation:public.communications_email_archive_job_items:mangorts_app:SELECT`
- `grant` `relation:public.communications_email_archive_job_items:mangorts_app:TRIGGER`
- `grant` `relation:public.communications_email_archive_job_items:mangorts_app:TRUNCATE`
- `grant` `relation:public.communications_email_archive_job_items:mangorts_app:UPDATE`
- `grant` `relation:public.communications_email_archive_jobs:mangorts_app:DELETE`
- `grant` `relation:public.communications_email_archive_jobs:mangorts_app:INSERT`
- `grant` `relation:public.communications_email_archive_jobs:mangorts_app:MAINTAIN`
- `grant` `relation:public.communications_email_archive_jobs:mangorts_app:REFERENCES`
- `grant` `relation:public.communications_email_archive_jobs:mangorts_app:SELECT`
- `grant` `relation:public.communications_email_archive_jobs:mangorts_app:TRIGGER`
- `grant` `relation:public.communications_email_archive_jobs:mangorts_app:TRUNCATE`
- `grant` `relation:public.communications_email_archive_jobs:mangorts_app:UPDATE`
- `grant` `relation:public.communications_email_node_attachments:mangorts_app:DELETE`
- `grant` `relation:public.communications_email_node_attachments:mangorts_app:INSERT`
- `grant` `relation:public.communications_email_node_attachments:mangorts_app:MAINTAIN`
- `grant` `relation:public.communications_email_node_attachments:mangorts_app:REFERENCES`
- `grant` `relation:public.communications_email_node_attachments:mangorts_app:SELECT`
- `grant` `relation:public.communications_email_node_attachments:mangorts_app:TRIGGER`
- `grant` `relation:public.communications_email_node_attachments:mangorts_app:TRUNCATE`
- `grant` `relation:public.communications_email_node_attachments:mangorts_app:UPDATE`
- `grant` `relation:public.communications_email_nodes:mangorts_app:DELETE`
- `grant` `relation:public.communications_email_nodes:mangorts_app:INSERT`
- `grant` `relation:public.communications_email_nodes:mangorts_app:MAINTAIN`
- `grant` `relation:public.communications_email_nodes:mangorts_app:REFERENCES`
- `grant` `relation:public.communications_email_nodes:mangorts_app:SELECT`
- `grant` `relation:public.communications_email_nodes:mangorts_app:TRIGGER`
- `grant` `relation:public.communications_email_nodes:mangorts_app:TRUNCATE`
- `grant` `relation:public.communications_email_nodes:mangorts_app:UPDATE`
- `grant` `relation:public.communications_message_read_receipt_summaries:mangorts_app:DELETE`
- `grant` `relation:public.communications_message_read_receipt_summaries:mangorts_app:INSERT`
- `grant` `relation:public.communications_message_read_receipt_summaries:mangorts_app:MAINTAIN`
- `grant` `relation:public.communications_message_read_receipt_summaries:mangorts_app:REFERENCES`
- `grant` `relation:public.communications_message_read_receipt_summaries:mangorts_app:SELECT`
- `grant` `relation:public.communications_message_read_receipt_summaries:mangorts_app:TRIGGER`
- `grant` `relation:public.communications_message_read_receipt_summaries:mangorts_app:TRUNCATE`
- `grant` `relation:public.communications_message_read_receipt_summaries:mangorts_app:UPDATE`
- `grant` `relation:public.communications_message_read_statuses:mangorts_app:DELETE`
- `grant` `relation:public.communications_message_read_statuses:mangorts_app:INSERT`
- `grant` `relation:public.communications_message_read_statuses:mangorts_app:MAINTAIN`
- `grant` `relation:public.communications_message_read_statuses:mangorts_app:REFERENCES`
- `grant` `relation:public.communications_message_read_statuses:mangorts_app:SELECT`
- `grant` `relation:public.communications_message_read_statuses:mangorts_app:TRIGGER`
- `grant` `relation:public.communications_message_read_statuses:mangorts_app:TRUNCATE`
- `grant` `relation:public.communications_message_read_statuses:mangorts_app:UPDATE`
- `grant` `relation:public.communications_triage_items:mangorts_app:DELETE`
- `grant` `relation:public.communications_triage_items:mangorts_app:INSERT`
- `grant` `relation:public.communications_triage_items:mangorts_app:MAINTAIN`
- `grant` `relation:public.communications_triage_items:mangorts_app:REFERENCES`
- `grant` `relation:public.communications_triage_items:mangorts_app:SELECT`
- `grant` `relation:public.communications_triage_items:mangorts_app:TRIGGER`
- `grant` `relation:public.communications_triage_items:mangorts_app:TRUNCATE`
- `grant` `relation:public.communications_triage_items:mangorts_app:UPDATE`
- `grant` `relation:public.companies:mangorts_app:DELETE`
- `grant` `relation:public.companies:mangorts_app:INSERT`
- `grant` `relation:public.companies:mangorts_app:MAINTAIN`
- `grant` `relation:public.companies:mangorts_app:REFERENCES`
- `grant` `relation:public.companies:mangorts_app:SELECT`
- `grant` `relation:public.companies:mangorts_app:TRIGGER`
- `grant` `relation:public.companies:mangorts_app:TRUNCATE`
- `grant` `relation:public.companies:mangorts_app:UPDATE`
- `grant` `relation:public.company_email_connections:mangorts_app:DELETE`
- `grant` `relation:public.company_email_connections:mangorts_app:INSERT`
- `grant` `relation:public.company_email_connections:mangorts_app:MAINTAIN`
- `grant` `relation:public.company_email_connections:mangorts_app:REFERENCES`
- `grant` `relation:public.company_email_connections:mangorts_app:SELECT`
- `grant` `relation:public.company_email_connections:mangorts_app:TRIGGER`
- `grant` `relation:public.company_email_connections:mangorts_app:TRUNCATE`
- `grant` `relation:public.company_email_connections:mangorts_app:UPDATE`
- `grant` `relation:public.company_explorer_final_backfill_verification:mangorts_app:DELETE`
- `grant` `relation:public.company_explorer_final_backfill_verification:mangorts_app:INSERT`
- `grant` `relation:public.company_explorer_final_backfill_verification:mangorts_app:MAINTAIN`
- `grant` `relation:public.company_explorer_final_backfill_verification:mangorts_app:REFERENCES`
- `grant` `relation:public.company_explorer_final_backfill_verification:mangorts_app:SELECT`
- `grant` `relation:public.company_explorer_final_backfill_verification:mangorts_app:TRIGGER`
- `grant` `relation:public.company_explorer_final_backfill_verification:mangorts_app:TRUNCATE`
- `grant` `relation:public.company_explorer_final_backfill_verification:mangorts_app:UPDATE`
- `grant` `relation:public.company_explorer_folders:mangorts_app:DELETE`
- `grant` `relation:public.company_explorer_folders:mangorts_app:INSERT`
- `grant` `relation:public.company_explorer_folders:mangorts_app:MAINTAIN`
- `grant` `relation:public.company_explorer_folders:mangorts_app:REFERENCES`
- `grant` `relation:public.company_explorer_folders:mangorts_app:SELECT`
- `grant` `relation:public.company_explorer_folders:mangorts_app:TRIGGER`
- `grant` `relation:public.company_explorer_folders:mangorts_app:TRUNCATE`
- `grant` `relation:public.company_explorer_folders:mangorts_app:UPDATE`
- `grant` `relation:public.company_explorer_items:mangorts_app:DELETE`
- `grant` `relation:public.company_explorer_items:mangorts_app:INSERT`
- `grant` `relation:public.company_explorer_items:mangorts_app:MAINTAIN`
- `grant` `relation:public.company_explorer_items:mangorts_app:REFERENCES`
- `grant` `relation:public.company_explorer_items:mangorts_app:SELECT`
- `grant` `relation:public.company_explorer_items:mangorts_app:TRIGGER`
- `grant` `relation:public.company_explorer_items:mangorts_app:TRUNCATE`
- `grant` `relation:public.company_explorer_items:mangorts_app:UPDATE`
- `grant` `relation:public.company_memberships:mangorts_app:DELETE`
- `grant` `relation:public.company_memberships:mangorts_app:INSERT`
- `grant` `relation:public.company_memberships:mangorts_app:MAINTAIN`
- `grant` `relation:public.company_memberships:mangorts_app:REFERENCES`
- `grant` `relation:public.company_memberships:mangorts_app:SELECT`
- `grant` `relation:public.company_memberships:mangorts_app:TRIGGER`
- `grant` `relation:public.company_memberships:mangorts_app:TRUNCATE`
- `grant` `relation:public.company_memberships:mangorts_app:UPDATE`
- `grant` `relation:public.company_projection_sequences:mangorts_app:DELETE`
- `grant` `relation:public.company_projection_sequences:mangorts_app:INSERT`
- `grant` `relation:public.company_projection_sequences:mangorts_app:MAINTAIN`
- `grant` `relation:public.company_projection_sequences:mangorts_app:REFERENCES`
- `grant` `relation:public.company_projection_sequences:mangorts_app:SELECT`
- `grant` `relation:public.company_projection_sequences:mangorts_app:TRIGGER`
- `grant` `relation:public.company_projection_sequences:mangorts_app:TRUNCATE`
- `grant` `relation:public.company_projection_sequences:mangorts_app:UPDATE`
- `grant` `relation:public.company_user_group_closure:mangorts_app:DELETE`
- `grant` `relation:public.company_user_group_closure:mangorts_app:INSERT`
- `grant` `relation:public.company_user_group_closure:mangorts_app:MAINTAIN`
- `grant` `relation:public.company_user_group_closure:mangorts_app:REFERENCES`
- `grant` `relation:public.company_user_group_closure:mangorts_app:SELECT`
- `grant` `relation:public.company_user_group_closure:mangorts_app:TRIGGER`
- `grant` `relation:public.company_user_group_closure:mangorts_app:TRUNCATE`
- `grant` `relation:public.company_user_group_closure:mangorts_app:UPDATE`
- `grant` `relation:public.company_user_group_members:mangorts_app:DELETE`
- `grant` `relation:public.company_user_group_members:mangorts_app:INSERT`
- `grant` `relation:public.company_user_group_members:mangorts_app:MAINTAIN`
- `grant` `relation:public.company_user_group_members:mangorts_app:REFERENCES`
- `grant` `relation:public.company_user_group_members:mangorts_app:SELECT`
- `grant` `relation:public.company_user_group_members:mangorts_app:TRIGGER`
- ... 417 more

## Different Definitions

### `column` `public.projects.created_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 7,
  "relation": "projects",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "created_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 6,
  "relation": "projects",
  "schema": "public",
  "storage": "p"
}
```

### `column` `public.projects.default_access`

Expected:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 6,
  "relation": "projects",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "default_access",
  "data_type": "text",
  "default": "'edit'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "projects",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.projects.health`

Expected:

```json
{
  "collation": null,
  "column": "health",
  "data_type": "text",
  "default": "'On Track'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 5,
  "relation": "projects",
  "schema": "public",
  "storage": "x"
}
```

Actual:

```json
{
  "collation": null,
  "column": "health",
  "data_type": "text",
  "default": "'On Track'::text",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "projects",
  "schema": "public",
  "storage": "x"
}
```

### `column` `public.projects.updated_timestamp`

Expected:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 8,
  "relation": "projects",
  "schema": "public",
  "storage": "p"
}
```

Actual:

```json
{
  "collation": null,
  "column": "updated_timestamp",
  "data_type": "timestamp with time zone",
  "default": "now()",
  "generated": "",
  "identity": "",
  "not_null": true,
  "ordinal_position": 7,
  "relation": "projects",
  "schema": "public",
  "storage": "p"
}
```

### `function` `public.mangorts_user_can_access_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text)`

Expected:

```json
{
  "arguments": "p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text",
  "definition": "CREATE OR REPLACE FUNCTION public.mangorts_user_can_access_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text)\n RETURNS boolean\n LANGUAGE sql\n STABLE\nAS $function$\r\n  with recursive normalized_resource(resource_type) as (\r\n    select case lower(btrim(coalesce(p_resource_type, '')))\r\n      when 'shared_triage_folder' then 'shared_inbox_folder'\r\n      when 'communications_folder' then 'shared_inbox_folder'\r\n      else lower(btrim(coalesce(p_resource_type, '')))\r\n    end\r\n  ),\r\n  requested(required_rank) as (\r\n    select mangorts_access_level_rank(p_access_level)\r\n  ),\r\n  role_admin_actor(allowed) as (\r\n    select exists (\r\n      select 1\r\n      from company_memberships membership\r\n      where membership.user_id = p_user_id\r\n        and (\r\n          membership.role = 'dev_admin'\r\n          or (membership.company_id = p_company_id and membership.role = 'company_admin')\r\n        )\r\n    )\r\n  ),\r\n  normalized_resource_row(default_access) as (\r\n    select coalesce(node.default_access, 'edit')\r\n    from nodes node, normalized_resource normalized\r\n    where normalized.resource_type='node'\r\n      and node.company_id=p_company_id\r\n      and node.node_id=p_resource_id\r\n    union all\r\n    select coalesce(gate.default_access, 'edit')\r\n    from logic_gates gate, normalized_resource normalized\r\n    where normalized.resource_type='logic_gate'\r\n      and gate.company_id=p_company_id\r\n      and gate.logic_gate_id=p_resource_id\r\n    union all\r\n    select coalesce(project.default_access, 'edit')\r\n    from projects project, normalized_resource normalized\r\n    where normalized.resource_type='project'\r\n      and project.company_id=p_company_id\r\n      and project.project_id=p_resource_id\r\n    union all\r\n    select coalesce(folder.default_access, 'edit')\r\n    from company_explorer_folders folder, normalized_resource normalized\r\n    where normalized.resource_type='company_explorer_folder'\r\n      and folder.company_id=p_company_id\r\n      and folder.folder_id=p_resource_id\r\n    union all\r\n    select coalesce(folder.default_access, 'edit')\r\n    from shared_inbox_folders folder, normalized_resource normalized\r\n    where normalized.resource_type='shared_inbox_folder'\r\n      and folder.company_id=p_company_id\r\n      and folder.folder_id=p_resource_id\r\n    union all\r\n    select coalesce(inbox.default_access, 'edit')\r\n    from shared_inboxes inbox, normalized_resource normalized\r\n    where normalized.resource_type='shared_inbox'\r\n      and inbox.company_id=p_company_id\r\n      and inbox.shared_inbox_id=p_resource_id\r\n  ),\r\n  group_tree(company_id, ancestor_group_id, descendant_group_id, depth) as (\r\n    select user_group.company_id,\r\n           user_group.group_id,\r\n           user_group.group_id,\r\n           0\r\n    from company_user_groups user_group\r\n    where user_group.company_id=p_company_id\r\n    union all\r\n    select parent.company_id,\r\n           parent.ancestor_group_id,\r\n           child.group_id,\r\n           parent.depth + 1\r\n    from group_tree parent\r\n    join company_user_groups child\r\n      on child.company_id=parent.company_id\r\n     and child.parent_group_id=parent.descendant_group_id\r\n    where parent.depth < 100\r\n  ),\r\n  direct_sequence(policy_sequence) as (\r\n    select coalesce((\r\n      select revision.policy_sequence\r\n      from resource_permission_policy_revisions revision, normalized_resource normalized\r\n      where revision.company_id=p_company_id\r\n        and revision.resource_type=normalized.resource_type\r\n        and revision.resource_id=p_resource_id\r\n    ), 0)\r\n  ),\r\n  node_logic_gate_ancestors(logic_gate_id) as (\r\n    select assignment.logic_gate_id\r\n    from node_logic_gate_assignments assignment, normalized_resource normalized\r\n    where normalized.resource_type='node'\r\n      and assignment.company_id=p_company_id\r\n      and assignment.node_id=p_resource_id\r\n  ),\r\n  folder_seeds(folder_id) as (\r\n    select folder.parent_folder_id\r\n    from company_explorer_folders folder, normalized_resource normalized\r\n    where normalized.resource_type='company_explorer_folder'\r\n      and folder.company_id=p_company_id\r\n      and folder.folder_id=p_resource_id\r\n      and folder.parent_folder_id is not null\r\n    union\r\n    select item.parent_folder_id\r\n    from company_explorer_items item, normalized_resource normalized\r\n    where normalized.resource_type in ('project', 'logic_gate')\n      and item.company_id=p_company_id\r\n      and item.target_type=normalized.resource_type\r\n      and item.target_id=p_resource_id\r\n    union\r\n    select item.parent_folder_id\r\n    from company_explorer_items item\r\n    join node_logic_gate_ancestors gate\r\n      on item.target_type='logic_gate'\r\n     and item.target_id=gate.logic_gate_id\r\n    where item.company_id=p_company_id\r\n  ),\r\n  folder_ancestors(folder_id, path) as (\r\n    select folder_id, array[folder_id]\r\n    from folder_seeds\r\n    union all\r\n    select parent.parent_folder_id, folder_ancestors.path || parent.parent_folder_id\r\n    from folder_ancestors\r\n    join company_explorer_folders parent\r\n      on parent.company_id=p_company_id\r\n     and parent.folder_id=folder_ancestors.folder_id\r\n    where parent.parent_folder_id is not null\r\n      and not parent.parent_folder_id = any(folder_ancestors.path)\r\n  ),\r\n  resource_policy_ancestors(resource_type, resource_id) as (\r\n    select 'logic_gate'::text, logic_gate_id\r\n    from node_logic_gate_ancestors\r\n    union\r\n    select 'company_explorer_folder'::text, folder_id\r\n    from folder_ancestors\r\n  ),\r\n  latest_default_application(access_level) as (\r\n    select app.access_level\r\n    from resource_permission_subtree_applications app\r\n    join resource_policy_ancestors ancestor\r\n      on ancestor.resource_type=app.ancestor_resource_type\r\n     and ancestor.resource_id=app.ancestor_resource_id\r\n    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence\r\n    where app.company_id=p_company_id\r\n      and app.rule_key='__default__'\r\n    order by app.policy_sequence desc, app.application_id desc\r\n    limit 1\r\n  ),\r\n  resolved_default(default_access) as (\r\n    select coalesce(\r\n      (select access_level from latest_default_application),\r\n      (select default_access from normalized_resource_row limit 1)\r\n    )\r\n  ),\r\n  direct_permission_rows as (\r\n    select access.subject_type,\r\n           access.subject_id,\r\n           access.access_level,\r\n           access.subject_type || ':' || access.subject_id::text as rule_key\r\n    from resource_permissions access\r\n    join normalized_resource normalized\r\n      on normalized.resource_type=access.resource_type\r\n    where access.company_id=p_company_id\r\n      and access.resource_id=p_resource_id\r\n  ),\r\n  application_permission_rows as (\r\n    select distinct on (app.rule_key)\r\n           app.rule_key,\r\n           app.subject_type,\r\n           app.subject_id,\r\n           app.access_level,\r\n           app.deleted\r\n    from resource_permission_subtree_applications app\r\n    join resource_policy_ancestors ancestor\r\n      on ancestor.resource_type=app.ancestor_resource_type\r\n     and ancestor.resource_id=app.ancestor_resource_id\r\n    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence\r\n    where app.company_id=p_company_id\r\n      and app.rule_key<>'__default__'\r\n    order by app.rule_key, app.policy_sequence desc, app.application_id desc\r\n  ),\r\n  resolved_permission_rows as (\r\n    select direct.subject_type, direct.subject_id, direct.access_level\r\n    from direct_permission_rows direct\r\n    where not exists (\r\n      select 1\r\n      from application_permission_rows app\r\n      where app.rule_key=direct.rule_key\r\n    )\r\n    union all\r\n    select app.subject_type, app.subject_id, app.access_level\r\n    from application_permission_rows app\r\n    where not app.deleted\r\n  ),\r\n  permission_access(access_level) as (\r\n    select candidate.access_level\r\n    from (\r\n      select access.access_level, 0 as source_rank, 0 as group_depth, mangorts_access_level_rank(access.access_level) as access_rank\r\n      from resolved_permission_rows access\r\n      where access.subject_type='user'\r\n        and access.subject_id=p_user_id\r\n      union all\r\n      select access.access_level, 1 as source_rank, min(closure.depth) as group_depth, mangorts_access_level_rank(access.access_level) as access_rank\r\n      from resolved_permission_rows access\r\n      join group_tree closure\r\n        on closure.company_id=p_company_id\r\n       and closure.ancestor_group_id=access.subject_id\r\n      join company_user_group_members member\r\n        on member.company_id=closure.company_id\r\n       and member.group_id=closure.descendant_group_id\r\n       and member.user_id=p_user_id\r\n      where access.subject_type='group'\r\n      group by access.access_level\r\n      union all\r\n      select default_access, 2 as source_rank, 0 as group_depth, mangorts_access_level_rank(default_access) as access_rank\r\n      from resolved_default\r\n    ) candidate\r\n    order by candidate.source_rank asc, candidate.group_depth asc, candidate.access_rank asc\r\n    limit 1\r\n  )\r\n  select case\r\n    when requested.required_rank = 0 then false\r\n    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox') then false\r\n    when (select allowed from role_admin_actor) then true\r\n    when not exists (select 1 from permission_access) then false\r\n    when (select mangorts_access_level_rank(access_level) from permission_access limit 1) = 0 then false\r\n    when exists (\r\n        select 1\r\n        from company_memberships membership\r\n        where membership.company_id = p_company_id\r\n          and membership.user_id = p_user_id\r\n      )\r\n      and (select mangorts_access_level_rank(access_level) from permission_access limit 1) >= requested.required_rank then true\r\n    else false\r\n  end\r\n  from requested, normalized_resource;\r\n$function$\n",
  "identity_arguments": "p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text",
  "kind": "function",
  "language": "sql",
  "name": "mangorts_user_can_access_resource",
  "parallel": "u",
  "result_type": "boolean",
  "schema": "public",
  "security_definer": false,
  "strict": false,
  "volatility": "stable"
}
```

Actual:

```json
{
  "arguments": "p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text",
  "definition": "CREATE OR REPLACE FUNCTION public.mangorts_user_can_access_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text)\n RETURNS boolean\n LANGUAGE sql\n STABLE\nAS $function$\r\n  with recursive normalized_resource(resource_type) as (\r\n    select case lower(btrim(coalesce(p_resource_type, '')))\r\n      when 'shared_triage_folder' then 'shared_inbox_folder'\r\n      when 'communications_folder' then 'shared_inbox_folder'\r\n      else lower(btrim(coalesce(p_resource_type, '')))\r\n    end\r\n  ),\r\n  requested(required_rank) as (\r\n    select mangorts_access_level_rank(p_access_level)\r\n  ),\r\n  role_admin_actor(allowed) as (\r\n    select exists (\r\n      select 1\r\n      from company_memberships membership\r\n      where membership.user_id = p_user_id\r\n        and (\r\n          membership.role = 'dev_admin'\r\n          or (membership.company_id = p_company_id and membership.role = 'company_admin')\r\n        )\r\n    )\r\n  ),\r\n  normalized_resource_row(default_access) as (\r\n    select coalesce(node.default_access, 'edit')\r\n    from nodes node, normalized_resource normalized\r\n    where normalized.resource_type='node'\r\n      and node.company_id=p_company_id\r\n      and node.node_id=p_resource_id\r\n    union all\r\n    select coalesce(gate.default_access, 'edit')\r\n    from logic_gates gate, normalized_resource normalized\r\n    where normalized.resource_type='logic_gate'\r\n      and gate.company_id=p_company_id\r\n      and gate.logic_gate_id=p_resource_id\r\n    union all\r\n    select coalesce(project.default_access, 'edit')\r\n    from projects project, normalized_resource normalized\r\n    where normalized.resource_type='project'\r\n      and project.company_id=p_company_id\r\n      and project.project_id=p_resource_id\r\n    union all\r\n    select coalesce(folder.default_access, 'edit')\r\n    from company_explorer_folders folder, normalized_resource normalized\r\n    where normalized.resource_type='company_explorer_folder'\r\n      and folder.company_id=p_company_id\r\n      and folder.folder_id=p_resource_id\r\n    union all\r\n    select coalesce(folder.default_access, 'edit')\r\n    from shared_inbox_folders folder, normalized_resource normalized\r\n    where normalized.resource_type='shared_inbox_folder'\r\n      and folder.company_id=p_company_id\r\n      and folder.folder_id=p_resource_id\r\n    union all\r\n    select coalesce(inbox.default_access, 'edit')\r\n    from shared_inboxes inbox, normalized_resource normalized\r\n    where normalized.resource_type='shared_inbox'\r\n      and inbox.company_id=p_company_id\r\n      and inbox.shared_inbox_id=p_resource_id\r\n  ),\r\n  group_tree(company_id, ancestor_group_id, descendant_group_id, depth) as (\r\n    select user_group.company_id,\r\n           user_group.group_id,\r\n           user_group.group_id,\r\n           0\r\n    from company_user_groups user_group\r\n    where user_group.company_id=p_company_id\r\n    union all\r\n    select parent.company_id,\r\n           parent.ancestor_group_id,\r\n           child.group_id,\r\n           parent.depth + 1\r\n    from group_tree parent\r\n    join company_user_groups child\r\n      on child.company_id=parent.company_id\r\n     and child.parent_group_id=parent.descendant_group_id\r\n    where parent.depth < 100\r\n  ),\r\n  direct_sequence(policy_sequence) as (\r\n    select coalesce((\r\n      select revision.policy_sequence\r\n      from resource_permission_policy_revisions revision, normalized_resource normalized\r\n      where revision.company_id=p_company_id\r\n        and revision.resource_type=normalized.resource_type\r\n        and revision.resource_id=p_resource_id\r\n    ), 0)\r\n  ),\r\n  node_logic_gate_ancestors(logic_gate_id) as (\r\n    select assignment.logic_gate_id\r\n    from node_logic_gate_assignments assignment, normalized_resource normalized\r\n    where normalized.resource_type='node'\r\n      and assignment.company_id=p_company_id\r\n      and assignment.node_id=p_resource_id\r\n  ),\r\n  folder_seeds(folder_id) as (\r\n    select folder.parent_folder_id\r\n    from company_explorer_folders folder, normalized_resource normalized\r\n    where normalized.resource_type='company_explorer_folder'\r\n      and folder.company_id=p_company_id\r\n      and folder.folder_id=p_resource_id\r\n      and folder.parent_folder_id is not null\r\n    union\r\n    select item.parent_folder_id\r\n    from company_explorer_items item, normalized_resource normalized\r\n    where normalized.resource_type in ('project', 'logic_gate')\r\n      and item.company_id=p_company_id\r\n      and item.target_type=normalized.resource_type\r\n      and item.target_id=p_resource_id\r\n    union\r\n    select item.parent_folder_id\r\n    from company_explorer_items item\r\n    join node_logic_gate_ancestors gate\r\n      on item.target_type='logic_gate'\r\n     and item.target_id=gate.logic_gate_id\r\n    where item.company_id=p_company_id\r\n  ),\r\n  folder_ancestors(folder_id, path) as (\r\n    select folder_id, array[folder_id]\r\n    from folder_seeds\r\n    union all\r\n    select parent.parent_folder_id, folder_ancestors.path || parent.parent_folder_id\r\n    from folder_ancestors\r\n    join company_explorer_folders parent\r\n      on parent.company_id=p_company_id\r\n     and parent.folder_id=folder_ancestors.folder_id\r\n    where parent.parent_folder_id is not null\r\n      and not parent.parent_folder_id = any(folder_ancestors.path)\r\n  ),\r\n  resource_policy_ancestors(resource_type, resource_id) as (\r\n    select 'logic_gate'::text, logic_gate_id\r\n    from node_logic_gate_ancestors\r\n    union\r\n    select 'company_explorer_folder'::text, folder_id\r\n    from folder_ancestors\r\n  ),\r\n  latest_default_application(access_level) as (\r\n    select app.access_level\r\n    from resource_permission_subtree_applications app\r\n    join resource_policy_ancestors ancestor\r\n      on ancestor.resource_type=app.ancestor_resource_type\r\n     and ancestor.resource_id=app.ancestor_resource_id\r\n    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence\r\n    where app.company_id=p_company_id\r\n      and app.rule_key='__default__'\r\n    order by app.policy_sequence desc, app.application_id desc\r\n    limit 1\r\n  ),\r\n  resolved_default(default_access) as (\r\n    select coalesce(\r\n      (select access_level from latest_default_application),\r\n      (select default_access from normalized_resource_row limit 1)\r\n    )\r\n  ),\r\n  direct_permission_rows as (\r\n    select access.subject_type,\r\n           access.subject_id,\r\n           access.access_level,\r\n           access.subject_type || ':' || access.subject_id::text as rule_key\r\n    from resource_permissions access\r\n    join normalized_resource normalized\r\n      on normalized.resource_type=access.resource_type\r\n    where access.company_id=p_company_id\r\n      and access.resource_id=p_resource_id\r\n  ),\r\n  application_permission_rows as (\r\n    select distinct on (app.rule_key)\r\n           app.rule_key,\r\n           app.subject_type,\r\n           app.subject_id,\r\n           app.access_level,\r\n           app.deleted\r\n    from resource_permission_subtree_applications app\r\n    join resource_policy_ancestors ancestor\r\n      on ancestor.resource_type=app.ancestor_resource_type\r\n     and ancestor.resource_id=app.ancestor_resource_id\r\n    join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence\r\n    where app.company_id=p_company_id\r\n      and app.rule_key<>'__default__'\r\n    order by app.rule_key, app.policy_sequence desc, app.application_id desc\r\n  ),\r\n  resolved_permission_rows as (\r\n    select direct.subject_type, direct.subject_id, direct.access_level\r\n    from direct_permission_rows direct\r\n    where not exists (\r\n      select 1\r\n      from application_permission_rows app\r\n      where app.rule_key=direct.rule_key\r\n    )\r\n    union all\r\n    select app.subject_type, app.subject_id, app.access_level\r\n    from application_permission_rows app\r\n    where not app.deleted\r\n  ),\r\n  permission_access(access_level) as (\r\n    select candidate.access_level\r\n    from (\r\n      select access.access_level, 0 as source_rank, 0 as group_depth, mangorts_access_level_rank(access.access_level) as access_rank\r\n      from resolved_permission_rows access\r\n      where access.subject_type='user'\r\n        and access.subject_id=p_user_id\r\n      union all\r\n      select access.access_level, 1 as source_rank, min(closure.depth) as group_depth, mangorts_access_level_rank(access.access_level) as access_rank\r\n      from resolved_permission_rows access\r\n      join group_tree closure\r\n        on closure.company_id=p_company_id\r\n       and closure.ancestor_group_id=access.subject_id\r\n      join company_user_group_members member\r\n        on member.company_id=closure.company_id\r\n       and member.group_id=closure.descendant_group_id\r\n       and member.user_id=p_user_id\r\n      where access.subject_type='group'\r\n      group by access.access_level\r\n      union all\r\n      select default_access, 2 as source_rank, 0 as group_depth, mangorts_access_level_rank(default_access) as access_rank\r\n      from resolved_default\r\n    ) candidate\r\n    order by candidate.source_rank asc, candidate.group_depth asc, candidate.access_rank asc\r\n    limit 1\r\n  )\r\n  select case\r\n    when requested.required_rank = 0 then false\r\n    when normalized_resource.resource_type not in ('node', 'logic_gate', 'project', 'company_explorer_folder', 'shared_inbox_folder', 'shared_inbox') then false\r\n    when (select allowed from role_admin_actor) then true\r\n    when not exists (select 1 from permission_access) then false\r\n    when (select mangorts_access_level_rank(access_level) from permission_access limit 1) = 0 then false\r\n    when exists (\r\n        select 1\r\n        from company_memberships membership\r\n        where membership.company_id = p_company_id\r\n          and membership.user_id = p_user_id\r\n      )\r\n      and (select mangorts_access_level_rank(access_level) from permission_access limit 1) >= requested.required_rank then true\r\n    else false\r\n  end\r\n  from requested, normalized_resource;\r\n$function$\n",
  "identity_arguments": "p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text",
  "kind": "function",
  "language": "sql",
  "name": "mangorts_user_can_access_resource",
  "parallel": "u",
  "result_type": "boolean",
  "schema": "public",
  "security_definer": false,
  "strict": false,
  "volatility": "stable"
}
```

### `grant` `function:public.enforce_node_logic_gate_assignment_priority():PUBLIC:EXECUTE`

Expected:

```json
{
  "grantee": "PUBLIC",
  "grantor": "postgres",
  "is_grantable": false,
  "object": "public.enforce_node_logic_gate_assignment_priority()",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

Actual:

```json
{
  "grantee": "PUBLIC",
  "grantor": "mangorts_app",
  "is_grantable": false,
  "object": "public.enforce_node_logic_gate_assignment_priority()",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

### `grant` `function:public.mangorts_access_level_rank(p_access_level text):PUBLIC:EXECUTE`

Expected:

```json
{
  "grantee": "PUBLIC",
  "grantor": "postgres",
  "is_grantable": false,
  "object": "public.mangorts_access_level_rank(p_access_level text)",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

Actual:

```json
{
  "grantee": "PUBLIC",
  "grantor": "mangorts_app",
  "is_grantable": false,
  "object": "public.mangorts_access_level_rank(p_access_level text)",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

### `grant` `function:public.mangorts_try_uuid(p_value text):PUBLIC:EXECUTE`

Expected:

```json
{
  "grantee": "PUBLIC",
  "grantor": "postgres",
  "is_grantable": false,
  "object": "public.mangorts_try_uuid(p_value text)",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

Actual:

```json
{
  "grantee": "PUBLIC",
  "grantor": "mangorts_app",
  "is_grantable": false,
  "object": "public.mangorts_try_uuid(p_value text)",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

### `grant` `function:public.mangorts_user_can_access_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text):PUBLIC:EXECUTE`

Expected:

```json
{
  "grantee": "PUBLIC",
  "grantor": "postgres",
  "is_grantable": false,
  "object": "public.mangorts_user_can_access_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text)",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

Actual:

```json
{
  "grantee": "PUBLIC",
  "grantor": "mangorts_app",
  "is_grantable": false,
  "object": "public.mangorts_user_can_access_resource(p_company_id uuid, p_resource_type text, p_resource_id uuid, p_user_id uuid, p_access_level text)",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

### `grant` `function:public.mangorts_user_can_view_entity(p_company_id uuid, p_entity_type text, p_entity_id uuid, p_user_id uuid):PUBLIC:EXECUTE`

Expected:

```json
{
  "grantee": "PUBLIC",
  "grantor": "postgres",
  "is_grantable": false,
  "object": "public.mangorts_user_can_view_entity(p_company_id uuid, p_entity_type text, p_entity_id uuid, p_user_id uuid)",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

Actual:

```json
{
  "grantee": "PUBLIC",
  "grantor": "mangorts_app",
  "is_grantable": false,
  "object": "public.mangorts_user_can_view_entity(p_company_id uuid, p_entity_type text, p_entity_id uuid, p_user_id uuid)",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

### `grant` `function:public.trg_update_workspace_read_versions():PUBLIC:EXECUTE`

Expected:

```json
{
  "grantee": "PUBLIC",
  "grantor": "postgres",
  "is_grantable": false,
  "object": "public.trg_update_workspace_read_versions()",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

Actual:

```json
{
  "grantee": "PUBLIC",
  "grantor": "mangorts_app",
  "is_grantable": false,
  "object": "public.trg_update_workspace_read_versions()",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

### `grant` `function:public.workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb):PUBLIC:EXECUTE`

Expected:

```json
{
  "grantee": "PUBLIC",
  "grantor": "postgres",
  "is_grantable": false,
  "object": "public.workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb)",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

Actual:

```json
{
  "grantee": "PUBLIC",
  "grantor": "mangorts_app",
  "is_grantable": false,
  "object": "public.workspace_read_version_keys_for_domain_event(p_event_type text, p_payload jsonb)",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

### `grant` `function:public.workspace_static_read_version_keys():PUBLIC:EXECUTE`

Expected:

```json
{
  "grantee": "PUBLIC",
  "grantor": "postgres",
  "is_grantable": false,
  "object": "public.workspace_static_read_version_keys()",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

Actual:

```json
{
  "grantee": "PUBLIC",
  "grantor": "mangorts_app",
  "is_grantable": false,
  "object": "public.workspace_static_read_version_keys()",
  "object_type": "function",
  "privilege_type": "EXECUTE"
}
```

### `grant` `type:public.information_type:PUBLIC:USAGE`

Expected:

```json
{
  "grantee": "PUBLIC",
  "grantor": "postgres",
  "is_grantable": false,
  "object": "public.information_type",
  "object_type": "type",
  "privilege_type": "USAGE"
}
```

Actual:

```json
{
  "grantee": "PUBLIC",
  "grantor": "mangorts_app",
  "is_grantable": false,
  "object": "public.information_type",
  "object_type": "type",
  "privilege_type": "USAGE"
}
```

### `grant` `type:public.logic_gate_relationship_position:PUBLIC:USAGE`

Expected:

```json
{
  "grantee": "PUBLIC",
  "grantor": "postgres",
  "is_grantable": false,
  "object": "public.logic_gate_relationship_position",
  "object_type": "type",
  "privilege_type": "USAGE"
}
```

Actual:

```json
{
  "grantee": "PUBLIC",
  "grantor": "mangorts_app",
  "is_grantable": false,
  "object": "public.logic_gate_relationship_position",
  "object_type": "type",
  "privilege_type": "USAGE"
}
```

### `grant` `type:public.node_relationship_position:PUBLIC:USAGE`

Expected:

```json
{
  "grantee": "PUBLIC",
  "grantor": "postgres",
  "is_grantable": false,
  "object": "public.node_relationship_position",
  "object_type": "type",
  "privilege_type": "USAGE"
}
```

Actual:

```json
{
  "grantee": "PUBLIC",
  "grantor": "mangorts_app",
  "is_grantable": false,
  "object": "public.node_relationship_position",
  "object_type": "type",
  "privilege_type": "USAGE"
}
```
