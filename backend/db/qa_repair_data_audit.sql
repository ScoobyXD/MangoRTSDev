-- Read-only QA repair evidence: counts only, no application row values.
WITH checks AS (
SELECT jsonb_build_object(
 'node_versions_missing', (SELECT count(*) FROM nodes n WHERE NOT EXISTS (SELECT 1 FROM node_view_versions v WHERE v.company_id=n.company_id AND v.node_id=n.node_id)),
 'process_versions_missing', (SELECT count(*) FROM logic_gates n WHERE NOT EXISTS (SELECT 1 FROM logic_gate_work_versions v WHERE v.company_id=n.company_id AND v.logic_gate_id=n.logic_gate_id)),
 'blank_user_names', (SELECT count(*) FROM users WHERE btrim(display_name)=''),
 'legacy_notification_roles', (SELECT count(*) FROM notifications WHERE role IN ('generated','verified','verifier','accountable_old')),
 'legacy_notification_types', (SELECT count(*) FROM notifications WHERE notification_type IN ('cvi_inbox.changed','cvi_inbox.RCVI_updated')),
 'completed_nodes_without_timestamp', (SELECT count(*) FROM nodes WHERE lower(btrim(status)) IN ('done','complete','completed') AND completion_transition_timestamp IS NULL),
 'active_nodes_with_completion_timestamp', (SELECT count(*) FROM nodes WHERE lower(btrim(status)) NOT IN ('done','complete','completed') AND completion_transition_timestamp IS NOT NULL),
 'recycled_huddle_nodes_missing_date', (SELECT count(*) FROM recycle_bin_items i CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(restore_payload->'huddle_nodes')='array' THEN restore_payload->'huddle_nodes' ELSE '[]'::jsonb END) n WHERE nullif(n->>'huddle_date','') IS NULL AND nullif(n->>'created_timestamp','') IS NOT NULL),
 'legacy_recycled_raci_roles', (SELECT count(*) FROM recycle_bin_items i CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(restore_payload->'resource_gvic_assignments')='array' THEN restore_payload->'resource_gvic_assignments' ELSE '[]'::jsonb END) n WHERE n->>'role' IN ('generated','verified','verifier')),
 'legacy_recycled_source_payloads', (SELECT count(*) FROM recycle_bin_items WHERE restore_payload ? 'action_item_sources'),
 'legacy_recycled_scorecard_payloads', (SELECT count(*) FROM recycle_bin_items WHERE restore_payload ? 'qd_ratings'),
 'invalid_empty_node_documents', (SELECT count(*) FROM node_textboxes WHERE body_json->>'format'='mango-tiptap-json' AND body_json->>'schema_version'='1' AND body_json->'document'->>'type'='doc' AND body_json->'document'->'content'='[]'::jsonb AND jsonb_typeof(body_json->'annotations')='array'),
 'invalid_empty_node_history_documents', (SELECT count(*) FROM node_textboxes_history WHERE body_json->>'format'='mango-tiptap-json' AND body_json->>'schema_version'='1' AND body_json->'document'->>'type'='doc' AND body_json->'document'->'content'='[]'::jsonb AND jsonb_typeof(body_json->'annotations')='array'),
 'action_items_missing_source_field', (SELECT count(*) FROM entities e JOIN entity_types t USING(company_id,entity_type_id) WHERE t.system_key='action_item' AND NOT EXISTS (SELECT 1 FROM entity_fields f JOIN entity_field_types ft USING(company_id,entity_field_type_id) WHERE f.company_id=e.company_id AND f.entity_id=e.entity_id AND ft.system_key='source')),
 'action_items_missing_assigned_by_field', (SELECT count(*) FROM entities e JOIN entity_types t USING(company_id,entity_type_id) WHERE t.system_key='action_item' AND NOT EXISTS (SELECT 1 FROM entity_fields f JOIN entity_field_types ft USING(company_id,entity_field_type_id) WHERE f.company_id=e.company_id AND f.entity_id=e.entity_id AND ft.system_key='assigned_by'))
) AS definition
)
SELECT jsonb_build_array(jsonb_build_object('object_kind','qa_repair_data_checks','object_identity','qa.counts_only','definition',definition))::text FROM checks;
