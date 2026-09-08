# QA migration readiness audit — 2026-09-08

QA deployment is blocked before maintenance: the migration ledger is incomplete and includes two historical operator markers. Do not run the 156 missing filenames as a batch, infer a baseline, skip old files with an anchor, translate operator markers, or reset QA under the current release authorization.

## Observed result

One existing ECS task ran with the exact override `["-mode","audit"]` and exited `0` at 2026-09-08 05:06:06 UTC. The audit reported `transaction_read_only=true`. Database credentials remained in ECS; no secret value was retrieved. No schema, data, cleanup, service-count, or routing writes were performed. A final ECS read confirmed the backend remained desired/running `1/1` on `mangorts-qa-backend:20`.

| Field | Observed value |
| --- | --- |
| Account / region | `686458136219` / `us-west-1` |
| Task | `6a27586d9f1a459e972e64c2619c2df9` |
| Task definition | `mangorts-qa-database-migration:19` |
| Migration image commit | `302c9afc723f3fec16c4fc69f0935bbbe3fe73e5` |
| CloudWatch group | `/ecs/mangorts-qa/database-migration` |
| CloudWatch stream | `ecs/database-migration/6a27586d9f1a459e972e64c2619c2df9` |
| PostgreSQL | `17.7` / `170007` |
| Public tables | `90` |
| Repository migration files | `251` |
| Ledger rows | `97` |
| Missing repository filenames | `156` |
| Unknown recorded filenames | `2` |
| Filtered inventory objects | `2090` |
| Actual schema inventory SHA-256 | `21d4afb03de8da9ecfefaec031e2daf2fb331fc3d655cf7f378c30b6ea042f52` |
| Repository schema SHA-256 | `9cfaa9c7845a0273b402d98f64f81bafe31155e19eb17544e9af744c2c2c1f2c` |

The complete log was read through its final empty page and stable forward token. The current worktree's repository fingerprint matches the audit image exactly; `backend/db` has no file differences from the image commit to `af2bbea9abf33ffbaf569d87b1f1974a7495775e`. These are historical ledger discrepancies, not differences introduced by the deployment coordinator.

The old audit emits a catalog fingerprint, not individual table definitions. It does **not** prove full schema parity, data backfills, or whether `public.ai_runs` is legacy or current Hermes storage. Hermes identity remains unknown until the new read-only plan or a designated read-only catalog export is reviewed.

## Meaning of the two operator records

- `operator/20260805_retire_map_position_storage.sql` comes from [scripts/retire_map_position_storage.sql](../../scripts/retire_map_position_storage.sql), introduced by `efd376adb`. The script drops only `node_map_positions` and `logic_gate_map_positions`, then records this marker in the same transaction. It lives outside the normal migration directory, so a filename-only repository audit reports it as unknown.
- `operator/20260805_retire_node_legacy_storage.sql` comes from [20260805_retire_node_legacy_storage.sql](../../backend/db/migrations/20260805_retire_node_legacy_storage.sql). It was introduced in `backend/db/operator_migrations` by `48f32afa7` and moved into the normal migration directory by `66bf51635`; its inserted operator marker remained unchanged. The current ledger has this operator marker but lacks the bare filename. The shipped SQL has all five approval literals set to `true`, checks that the old tables still exist, and drops `node_information`, `node_projection_table`, and `node_projection_seen_snapshots`. Replaying it is not a ledger repair.

These source identities explain the markers. They do not establish the present physical catalog or authorize deleting, renaming, or replacing ledger evidence. No marker translation or compatibility path was added.

## Historical gaps and the new release boundary

Exactly six migration files were added between the last observed QA application revision `a30cd0157f51389827924724fa7ad3aa1fef589b` and the audit image. All six are absent from the ledger:

- `20260904_process_step_map_layouts.sql`
- `20260905_attachment_pending_deletion_index.sql`
- `20260905_process_map_permission_query_plans.sql`
- `20260905_process_step_sop_bodies.sql`
- `20260906_user_mailbox_access.sql`
- `20260907_hermes_action_receipts.sql`

The other 150 missing files already existed in the deployed application's repository history. They include destructive storage retirements, permission cutovers, canonical reconciliation, and data-layout changes. Recent recorded files include `20260903_process_steps.sql` and `20260904_auth_claim_issue_watermark.sql`, while `20260902_process_map_nested_layout_capacity.sql` remains absent. Therefore ledger order is not a trustworthy physical-schema boundary.

There is **no proven safe migration anchor**. Starting after `20260904_auth_claim_issue_watermark.sql` would select the six additions but silently bypass 150 unresolved historical rows; it cannot establish backfills or current schema correctness. The six-file list is a code-history comparison only, not permission to run an anchored migration.

## Required human prerequisite

1. Preserve this ledger evidence and obtain a fresh exact QA catalog export through the designated database-enforced read-only path, or review the new ECS read-only plan without retrieving its credentials.
2. Compare the existing physical catalog against a reviewed same-commit canonical catalog with the existing `schema_inventory.sql` and `compare_schema_inventory.py` workflow; classify the 150 historical gaps and both operator records separately from the six release additions.
3. For each historical gap, verify its required data changes as well as surviving schema effects; mark it as already represented, truly pending, superseded, or unresolved only from evidence.
4. Review and explicitly approve any exact live history reconciliation or data/schema repair that this classification requires before execution; do not approve a blanket baseline or replay.
5. Rerun read-only planning and require a clean, understood ledger plus the known one-time migration prerequisites and Hermes native-identity checks before the coordinated release enters maintenance.

The existing [schema audit runbook](mangorts-schema-audit.md) supplies the comparison tools. Its hosted process is for fresh empty QA bootstrap and it explicitly says the old one-migration reconciliation shortcut is invalid after later migrations. The existing `20260825_canonical_schema_reconciliation.sql` targets an earlier empty-QA schema transition; it does not reconcile this history. The fresh bootstrap/reset and DEV-to-QA copy procedures are not authorized remedies for this running populated QA instance. No existing general safe live-ledger reconciliation command was found.

## Complete missing filename list

```text
20260527_zz_admin_effective_access_priority.sql
20260530_racio_projection_resource_permissions.sql
20260601_kanban_board_projection.sql
20260601_workspace_derived_projection_checkpoints.sql
20260602_drop_legacy_kanban_tables.sql
20260602_projection_sequence_scopes.sql
20260603_event_rows.sql
20260606_project_management_timeline_projection.sql
20260608_accounts.sql
20260610_projects.sql
20260611_communications_message_read_statuses.sql
20260611_company_explorer_folder_permissions.sql
20260611_recycle_bin.sql
20260612_project_multi_assignments.sql
20260614_company_explorer_folder_scope.sql
20260615_aa_user_email_connection_scope.sql
20260615_logic_gate_resource_raci_assignments.sql
20260615_user_email_connections_per_account.sql
20260615_z_ensure_user_email_connections_per_account.sql
20260615_zz_shared_triage_dedicated_folders.sql
20260616_shared_inbox_split.sql
20260617_company_explorer_v2_tables.sql
20260618_gvic_node_phase1.sql
20260618_z_gvic_node_phase2_cleanup.sql
20260619_company_explorer_single_tree_subscriptions.sql
20260619_notifications_gvic_roles.sql
20260619_project_health_critical_path.sql
20260620_company_explorer_final_cutover.sql
20260620_saved_views.sql
20260620_z_company_explorer_access_helper_cutover.sql
20260621_zz_gvic_matrix_projection_clean_leaf_paths.sql
20260622_gvic_logic_gate_pointer_access.sql
20260622_logic_gate_requested_by.sql
20260624_company_email_connections.sql
20260624_gvic_logic_gate_snapshot_nodes.sql
20260624_pins.sql
20260624_user_email_connections_personal_only.sql
20260626_company_explorer_no_node_items.sql
20260626_company_manager_role.sql
20260626_hard_resource_permissions_cutover.sql
20260626_recycle_bin_user_scope.sql
20260629_communications_archive_jobs.sql
20260629_logic_gate_kanban_grouping_preferences.sql
20260629_require_user_display_name.sql
20260630_communications_message_read_receipt_summaries.sql
20260630_fix_logic_gate_assignment_membership_fks.sql
20260630_logic_gate_kanban_saved_view_singleton.sql
20260630_resource_permission_group_subjects.sql
20260630_saved_view_settings.sql
20260630_zz_drop_saved_view_preferences.sql
20260701_resource_permissions_ignore_gvic.sql
20260701_resource_policy_pointers.sql
20260702_resource_policy_access_helper_no_gvic.sql
20260707_editor_save_versions.sql
20260707_repair_missing_canonical_schema_objects.sql
20260707_zz_align_prod_to_dev_schema.sql
20260709_mango_attachments.sql
20260709_project_relationship_email_origin.sql
20260709_zz_email_drafts_signatures.sql
20260710_browser_attachment_uploads.sql
20260711_logic_gate_work_fast_path.sql
20260712_attachment_variant_generation_metadata.sql
20260712_node_view_fast_path.sql
20260712_realtime_simplification.sql
20260713_00_exact_account_communications_read_receipts.sql
20260713_drop_legacy_communications_message_read_statuses.sql
20260713_email_thread_collaboration.sql
20260714_communications_message_read_receipt_signals.sql
20260714_editor_text_projection_revisions.sql
20260715_unified_realtime_collaboration.sql
20260715_zz_edit_or_no_access.sql
20260716_restore_rich_html_collaboration.sql
20260718_tiptap_json_foundation.sql
20260719_persist_node_email_threads.sql
20260719_zz_tiptap_annotation_positions.sql
20260721_entity_fields.sql
20260721_notification_priority_context.sql
20260722_editor_entity_search_indexes.sql
20260722_node_timeline_verification_events.sql
20260722_zz_full_descendant_policy_snapshots.sql
20260723_project_logic_gates_many_projects.sql
20260726_node_v2_phase1_foundation.sql
20260727_node_v2_phase2_product.sql
20260727_zz_node_v2_phase3_engineering.sql
20260727_zzz_remove_tiptap_json_size_limit.sql
20260727_zzzz_editor_owner_text_limit.sql
20260728_durable_email_thread_download_jobs.sql
20260728_editor_owner_yjs_deltas.sql
20260728_zz_retire_yjs_storage.sql
20260729_project_saved_versions.sql
20260801_editor_textbox_storage_foundation.sql
20260801_z_retire_legacy_editor_storage.sql
20260802_retire_node_v2_and_legacy_editor.sql
20260804_attachment_step1_expansion.sql
20260804_zzz_project_final_runtime_storage.sql
20260804_zzzzzz_node_final_storage_cutover.sql
20260805_logic_gate_final_runtime_storage.sql
20260805_retire_node_legacy_storage.sql
20260805_zz_remove_map_runtime_contracts.sql
20260805_zzz_v2_gvic_permissions_step1.sql
20260805_zzza_v2_gvic_permissions_step1_resolvers.sql
20260805_zzzb_v2_gvic_permissions_step1_preflight_report.sql
20260805_zzzc_v2_gvic_permissions_step2_cutover.sql
20260805_zzzd_repair_empty_node_textbox_documents.sql
20260805_zzzz_pinned_folders.sql
20260805_zzzzz_remove_node_unread_highlights.sql
20260806_node_delete_policy_cascade.sql
20260806_zz_remove_company_explorer_node_items.sql
20260806_zzz_email_ingestion_engine.sql
20260806_zzz_raci_roles.sql
20260807_node_project_assignment_timeline.sql
20260808_node_priority_not_assigned.sql
20260809_zzz_email_sqs_delivery.sql
20260809_zzzz_email_sqs_delivery_finalize.sql
20260810_zz_remove_retired_personal_work_surface.sql
20260810_zzzz_raci_tabs.sql
20260811_huddles_kpis.sql
20260811_z_huddle_explorer_logic_gates_only.sql
20260811_zz_huddle_logic_gate_relationships.sql
20260811_zz_targeted_raci_tabs.sql
20260811_zzz_email_draft_scope.sql
20260813_email_draft_identity.sql
20260814_project_email_relationships.sql
20260816_remove_node_email_drafts.sql
20260818_project_email_textbox_parity.sql
20260819_shared_email_drafts.sql
20260824_process_map.sql
20260825_canonical_schema_reconciliation.sql
20260825_qd_ratings.sql
20260825_v3_process_map_global_canvas.sql
20260825_z_qd_cost_rating.sql
20260826_process_map_geometry_compaction.sql
20260826_z_scorecards.sql
20260826_zz_process_map_automatic_placement.sql
20260826_zzz_process_map_read_invalidation.sql
20260827_entities.sql
20260828_action_items.sql
20260828_entity_relationships.sql
20260828_huddle_node_workspace.sql
20260828_z_huddle_logic_gate_attachments.sql
20260828_zz_huddle_logic_gate_action_item_relationships.sql
20260828_zzz_my_work_person_in_charge_index.sql
20260829_action_item_delegation_source.sql
20260829_my_work_node_completion_transition.sql
20260829_z_action_item_source_entity_field.sql
20260830_my_work_action_item_preferences.sql
20260830_z_huddle_action_item_preferences.sql
20260831_huddle_node_dates_and_action_item_views.sql
20260831_z_retire_raci_tabs.sql
20260902_process_map_nested_layout_capacity.sql
20260904_process_step_map_layouts.sql
20260905_attachment_pending_deletion_index.sql
20260905_process_map_permission_query_plans.sql
20260905_process_step_sop_bodies.sql
20260906_user_mailbox_access.sql
20260907_hermes_action_receipts.sql
```

## Complete recorded filename list

The old audit logs counts and missing/unknown filenames, rather than each recorded row. The list below is derived from all 251 SQL filenames in the exact audit-image commit minus the 156 logged missing names, plus the two logged operator names. The derived 97 entries match the audit's ledger-row count exactly; no applied SQL content or checksum is inferred.

```text
20260424_node_relationship_guards.sql
20260501_company_explorer_folders.sql
20260501_kanban_board_tables.sql
20260501_logic_gate_projection_table.sql
20260501_logic_gate_relationship_guards.sql
20260501_nonblank_information_guards.sql
20260502_company_explorer_cleanup.sql
20260502_kanban_column_width.sql
20260502_map_layout_positions.sql
20260503_company_explorer_positions.sql
20260503_item_delete_cleanup.sql
20260503_kanban_query_metadata.sql
20260503_z_kanban_column_height_and_query_cleanup.sql
20260503_zzz_kanban_column_item_color.sql
20260503_zzzz_kanban_node_only_cards.sql
20260503_zzzzz_kanban_saved_boards.sql
20260504_company_explorer_kanban_items.sql
20260504_company_explorer_move_relationship_cleanup.sql
20260504_editor_text_projection_canonical.sql
20260505_auth_identity_and_memberships.sql
20260505_company_explorer_kanban_folder_items_compat.sql
20260506_logic_gate_arena.sql
20260507_auth_accounts_mvp.sql
20260507_company_explorer_default_folder_seeds.sql
20260507_kanban_column_resize_limits.sql
20260507_latest_invitation_token.sql
20260507_lowercase_auth_emails.sql
20260507_nodes_status_and_user_display_names.sql
20260507_password_reset_codes.sql
20260507_remove_company_viewer.sql
20260507_remove_custom_resets_and_resource_assignments.sql
20260508_company_explorer_system_folders.sql
20260508_nylas_user_email_connections.sql
20260509_auth_external_identity_deletions.sql
20260509_mango_kanban_column_color_default.sql
20260510_company_explorer_folder_shares.sql
20260511_node_editor_blocks_and_email.sql
20260512_communications_shared_inbox_folders.sql
20260512_communications_triage_logic_gates.sql
20260512_drop_operations.sql
20260512_fix_triage_conversion_constraints.sql
20260512_logic_gate_arena_default_column_repair.sql
20260514_logic_gate_raci_assignments.sql
20260515_communications_shared_inbox_raci_assignments.sql
20260517_notifications.sql
20260518_communications_shared_inbox_account_email.sql
20260518_notification_type_unread_index.sql
20260518_remove_kanban_from_company_explorer.sql
20260519_domain_events_outbox.sql
20260519_hot_path_read_discipline.sql
20260519_node_logic_gate_assignments.sql
20260519_work_item_inbox_entries.sql
20260519_workspace_read_versions.sql
20260520_responsible_inbox_raci_nodes.sql
20260520_user_groups_entity_permissions.sql
20260521_node_content_changes.sql
20260521_resource_access_grants.sql
20260521_shared_inbox_raci_group_assignments.sql
20260521_z_node_logic_gate_default_full_access.sql
20260521_zz_shared_triage_default_edit_access.sql
20260521_zzz_admin_role_default_resource_access.sql
20260521_zzzz_resource_access_no_access.sql
20260521_zzzzz_assignment_edit_access.sql
20260521_zzzzzz_hot_read_visibility_versions.sql
20260521_zzzzzzz_node_content_changes_actor_display_name.sql
20260522_effective_resource_access.sql
20260522_notification_other_role.sql
20260523_drop_logic_gate_raci_access_trigger.sql
20260523_drop_node_assignee_access_trigger.sql
20260523_notification_domain_event_projection_checkpoints.sql
20260523_remove_notification_source_anchor.sql
20260523_zz_notification_information_id.sql
20260523_zzz_node_logic_gate_default_company_edit_access.sql
20260524_active_logic_gates_system_folder.sql
20260524_effective_resource_access_single_row.sql
20260524_node_logic_gate_assignment_priority_guard.sql
20260524_node_projection_seen_snapshots.sql
20260524_resource_raci_assignments.sql
20260524_zz_backfill_legacy_entity_access_permissions.sql
20260526_logic_gate_verify_status.sql
20260527_email_node_attachments.sql
20260527_invitation_onboarding_status.sql
20260529_resource_access_defaults.sql
20260602_racio_projection_sequences.sql
20260612_z_drop_project_scalar_assignments.sql
20260621_gvic_matrix_flat_my_work_projection.sql
20260621_z_gvic_matrix_projection_rebuild_relationship_rows.sql
20260810_node_textbox_metadata.sql
20260826_zzzy_process_map_actual_size_square_layout.sql
20260826_zzzz_process_map_tidy_initial_layout.sql
20260826_zzzzz_process_map_rectangular_layout.sql
20260826_zzzzzz_process_map_square_layout.sql
20260828_zz_retire_unused_operational_tables.sql
20260903_process_steps.sql
20260904_auth_claim_issue_watermark.sql
operator/20260805_retire_map_position_storage.sql
operator/20260805_retire_node_legacy_storage.sql
```
