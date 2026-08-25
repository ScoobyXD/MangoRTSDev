package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

type companyExplorerRecycleScope struct {
	FolderIDs      map[string]bool
	FolderKinds    map[string]string
	NodeIDs        map[string]bool
	LogicGateIDs   map[string]bool
	ProjectIDs     map[string]bool
	KanbanBoardIDs map[string]bool
}

type companyExplorerRecycleRootScope struct {
	Target CompanyExplorerDeleteTargetInput
	Scope  companyExplorerRecycleScope
}

func newCompanyExplorerRecycleScope() companyExplorerRecycleScope {
	return companyExplorerRecycleScope{
		FolderIDs:      map[string]bool{},
		FolderKinds:    map[string]string{},
		NodeIDs:        map[string]bool{},
		LogicGateIDs:   map[string]bool{},
		ProjectIDs:     map[string]bool{},
		KanbanBoardIDs: map[string]bool{},
	}
}

func (scope companyExplorerRecycleScope) mergeInto(target *companyExplorerRecycleScope) {
	for id := range scope.FolderIDs {
		target.FolderIDs[id] = true
		if kind := strings.TrimSpace(scope.FolderKinds[id]); kind != "" {
			target.FolderKinds[id] = kind
		}
	}
	for id := range scope.NodeIDs {
		target.NodeIDs[id] = true
	}
	for id := range scope.LogicGateIDs {
		target.LogicGateIDs[id] = true
	}
	for id := range scope.ProjectIDs {
		target.ProjectIDs[id] = true
	}
	for id := range scope.KanbanBoardIDs {
		target.KanbanBoardIDs[id] = true
	}
}

func (scope companyExplorerRecycleScope) addLogicGateBoards() {
	for logicGateID := range scope.LogicGateIDs {
		scope.KanbanBoardIDs[LogicGateKanbanBoardID(logicGateID)] = true
	}
}

func (scope companyExplorerRecycleScope) hasAnyRows() bool {
	return len(scope.FolderIDs)+len(scope.NodeIDs)+len(scope.LogicGateIDs)+len(scope.ProjectIDs)+len(scope.KanbanBoardIDs) > 0
}

func (r *PostgresRepo) ListRecycleBinItems(companyID, deletedByUserID string) ([]domain.RecycleBinItem, error) {
	companyID = strings.TrimSpace(companyID)
	deletedByUserID = strings.TrimSpace(deletedByUserID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select company_id::text,
       recycle_bin_item_id::text,
       object_kind,
       object_id,
       object_label,
       coalesce(object_folder_kind, ''),
       coalesce(deleted_by_user_id::text, ''),
       deleted_timestamp,
       restore_payload
from recycle_bin_items
where company_id=$1::uuid
  and (nullif($2::text, '') is null or deleted_by_user_id=nullif($2::text, '')::uuid)
order by deleted_timestamp desc, recycle_bin_item_id desc`, companyID, deletedByUserID)
	if isPostgresUndefinedTable(err, "recycle_bin_items") {
		return []domain.RecycleBinItem{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.RecycleBinItem, 0)
	for rows.Next() {
		var item domain.RecycleBinItem
		var payload []byte
		if err := rows.Scan(
			&item.CompanyID,
			&item.RecycleBinItemID,
			&item.ObjectKind,
			&item.ObjectID,
			&item.ObjectLabel,
			&item.ObjectFolderKind,
			&item.DeletedByUserID,
			&item.DeletedTimestamp,
			&payload,
		); err != nil {
			return nil, err
		}
		item.ContainedItems = recycleContainedItemsFromPayload(item, payload)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) PermanentlyDeleteRecycleBinItems(companyID, deletedByUserID string, itemIDs []string) error {
	companyID = strings.TrimSpace(companyID)
	deletedByUserID = strings.TrimSpace(deletedByUserID)
	itemIDs = normalizeRecycleBinItemIDs(itemIDs)
	if companyID == "" || len(itemIDs) == 0 {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `
delete from recycle_bin_items
where company_id=$1::uuid
  and (nullif($2::text, '') is null or deleted_by_user_id=nullif($2::text, '')::uuid)
  and recycle_bin_item_id = any(string_to_array($3, ',')::uuid[])`, companyID, deletedByUserID, strings.Join(itemIDs, ","))
	if isPostgresUndefinedTable(err, "recycle_bin_items") {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) RestoreRecycleBinItems(companyID, deletedByUserID string, itemIDs []string) (RecycleBinRestoreResult, error) {
	companyID = strings.TrimSpace(companyID)
	deletedByUserID = strings.TrimSpace(deletedByUserID)
	itemIDs = normalizeRecycleBinItemIDs(itemIDs)
	if companyID == "" || deletedByUserID == "" || len(itemIDs) == 0 {
		return RecycleBinRestoreResult{}, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return RecycleBinRestoreResult{}, err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
select company_id::text,
       recycle_bin_item_id::text,
       object_kind,
       object_id,
       object_label,
       coalesce(object_folder_kind, ''),
       coalesce(deleted_by_user_id::text, ''),
       deleted_timestamp,
       restore_payload
from recycle_bin_items
where company_id=$1::uuid
  and deleted_by_user_id=$2::uuid
  and recycle_bin_item_id = any(string_to_array($3, ',')::uuid[])
order by deleted_timestamp asc, recycle_bin_item_id asc
for update`, companyID, deletedByUserID, strings.Join(itemIDs, ","))
	if isPostgresUndefinedTable(err, "recycle_bin_items") {
		return RecycleBinRestoreResult{}, ErrNotFound
	}
	if err != nil {
		return RecycleBinRestoreResult{}, err
	}
	defer rows.Close()

	items := make([]domain.RecycleBinItem, 0)
	payloads := make([][]byte, 0)
	targets := make([]CompanyExplorerDeletedTarget, 0)
	seenTargets := map[string]bool{}
	for rows.Next() {
		var item domain.RecycleBinItem
		var payload []byte
		if err := rows.Scan(
			&item.CompanyID,
			&item.RecycleBinItemID,
			&item.ObjectKind,
			&item.ObjectID,
			&item.ObjectLabel,
			&item.ObjectFolderKind,
			&item.DeletedByUserID,
			&item.DeletedTimestamp,
			&payload,
		); err != nil {
			return RecycleBinRestoreResult{}, err
		}
		items = append(items, item)
		payloads = append(payloads, payload)
		targets = appendCompanyExplorerDeletedTarget(targets, seenTargets, item.ObjectKind, item.ObjectID, item.ObjectFolderKind)
	}
	if err := rows.Err(); err != nil {
		return RecycleBinRestoreResult{}, err
	}
	if len(items) == 0 {
		return RecycleBinRestoreResult{}, ErrNotFound
	}

	mergedPayload, err := mergeRecyclePayloads(payloads)
	if err != nil {
		return RecycleBinRestoreResult{}, err
	}
	for _, tableName := range recycleRestoreTableOrder {
		if err := postgresRestoreRecycleTableTx(ctx, tx, tableName, mergedPayload[tableName]); err != nil {
			return RecycleBinRestoreResult{}, err
		}
	}
	if err := reconcileRestoredProjectTextboxColorsTx(ctx, tx, mergedPayload["project_textboxes"]); err != nil {
		return RecycleBinRestoreResult{}, err
	}
	events, err := r.appendDomainEventsTx(ctx, tx, companyExplorerTargetWorkspaceEventInputs(companyID, targets, true))
	if err != nil {
		return RecycleBinRestoreResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from recycle_bin_items
where company_id=$1::uuid
  and deleted_by_user_id=$2::uuid
  and recycle_bin_item_id = any(string_to_array($3, ',')::uuid[])`, companyID, deletedByUserID, strings.Join(itemIDs, ",")); err != nil {
		return RecycleBinRestoreResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return RecycleBinRestoreResult{}, err
	}
	return RecycleBinRestoreResult{Items: items, Targets: targets, Events: events}, nil
}

var recycleSnapshotTables = map[string]bool{
	"company_explorer_folders": true,
	"nodes":                    true,
	"logic_gates":              true,
	"projects":                 true,
	"huddle_logic_gates":       true,
	"huddle_nodes":             true,
	"kpis":                     true,

	"huddle_logic_gate_relationships":      true,
	"huddle_node_logic_gate_relationships": true,
	"huddle_node_kpi_relationships":        true,

	"huddle_explorer_folders":            true,
	"huddle_explorer_items":              true,
	"node_textboxes":                     true,
	"node_textboxes_history":             true,
	"node_textbox_chats":                 true,
	"logic_gate_textboxes":               true,
	"logic_gate_textboxes_history":       true,
	"project_textboxes":                  true,
	"project_textboxes_history":          true,
	"project_textbox_chats":              true,
	"node_account_assignments":           true,
	"node_relationships":                 true,
	"process_map_placements":             true,
	"resource_operational_relationships": true,
	"process_map_traces":                 true,
	"user_logic_gate_shortcuts":          true,

	"project_relationships":                  true,
	"project_relationship_projection":        true,
	"node_logic_gate_assignments":            true,
	"kanban_board_projection":                true,
	"project_management_timeline_items":      true,
	"project_management_timeline_projection": true,
	"resource_gvic_settings":                 true,
	"resource_permission_settings":           true,
	"resource_gvic_assignments":              true,
	"resource_permissions":                   true,
	"company_explorer_items":                 true,
	"email_relationships":                    true,
	"email_drafts":                           true,
	"attachments":                            true,
	"attachment_relationships":               true,
}

var recycleRestoreTableOrder = []string{
	"company_explorer_folders",
	"nodes",
	"logic_gates",
	"resource_operational_relationships",
	"process_map_placements",
	"process_map_traces",
	"projects",
	"huddle_logic_gates",
	"huddle_nodes",
	"kpis",
	"huddle_logic_gate_relationships",
	"huddle_node_logic_gate_relationships",
	"huddle_node_kpi_relationships",
	"node_textboxes",
	"node_textboxes_history",
	"logic_gate_textboxes",
	"logic_gate_textboxes_history",
	"project_textboxes",
	"project_textboxes_history",
	"email_relationships",
	"node_textbox_chats",
	"project_textbox_chats",
	"huddle_explorer_folders",
	"node_account_assignments",
	"resource_gvic_settings",
	"resource_permission_settings",
	"resource_gvic_assignments",
	"resource_permissions",
	"user_logic_gate_shortcuts",
	"email_drafts",
	"attachments",
	"attachment_relationships",
	"node_logic_gate_assignments",
	"node_relationships",
	"project_relationships",
	"project_relationship_projection",
	"project_management_timeline_items",
	"project_management_timeline_projection",
	"kanban_board_projection",
	"company_explorer_items",
	"huddle_explorer_items",
}

func reconcileRestoredProjectTextboxColorsTx(ctx context.Context, tx *sql.Tx, rows json.RawMessage) error {
	if len(rows) == 0 || string(rows) == "null" || string(rows) == "[]" {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
with restored as (
  select company_id,project_id,textbox_id
  from jsonb_populate_recordset(null::project_textboxes,coalesce($1::jsonb,'[]'::jsonb))
)
update project_textboxes textbox
set color=case when exists (
  select 1 from email_relationships relationship
  where relationship.company_id=textbox.company_id
    and relationship.resource_type='project'
    and relationship.resource_id=textbox.project_id
    and relationship.resource_textbox_id=textbox.textbox_id
) then coalesce(textbox.color,'#0EA5E9') else null end,
updated_timestamp=greatest(textbox.updated_timestamp,clock_timestamp())
from restored
where textbox.company_id=restored.company_id
  and textbox.project_id=restored.project_id
  and textbox.textbox_id=restored.textbox_id`, string(rows))
	return err
}

func postgresRestoreRecycleTableTx(ctx context.Context, tx *sql.Tx, tableName string, rows json.RawMessage) error {
	if !recycleSnapshotTables[tableName] || len(rows) == 0 || string(rows) == "null" {
		return nil
	}
	if exists, err := postgresTableExistsTx(ctx, tx, tableName); err != nil {
		return err
	} else if !exists {
		return nil
	}
	columns, err := postgresRecycleRestorableColumnsTx(ctx, tx, tableName)
	if err != nil {
		return err
	}
	if len(columns) == 0 {
		return nil
	}
	columnList := strings.Join(columns, ", ")
	if tableName == "email_relationships" {
		if _, err := tx.ExecContext(ctx, `
with restored as (
  select company_id,email_thread_id,email_message_id,resource_type,resource_id,
         resource_textbox_id,created_timestamp
  from jsonb_populate_recordset(null::email_relationships,coalesce($1::jsonb,'[]'::jsonb))
)
insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,
  resource_type,resource_id,resource_textbox_id,created_timestamp
)
select exact.company_id,gen_random_uuid(),exact.email_thread_id,exact.email_message_id,
       exact.resource_type,exact.resource_id,null,coalesce(exact.created_timestamp,clock_timestamp())
from restored exact
where exact.resource_type in ('node','project')
  and exact.resource_textbox_id is not null
  and not exists (
    select 1 from restored wide
    where wide.company_id=exact.company_id
      and wide.email_thread_id=exact.email_thread_id
      and wide.resource_type=exact.resource_type
      and wide.resource_id=exact.resource_id
      and wide.resource_textbox_id is null
  )
  and not exists (
    select 1 from email_relationships wide
    where wide.company_id=exact.company_id
      and wide.email_thread_id=exact.email_thread_id
      and wide.resource_type=exact.resource_type
      and wide.resource_id=exact.resource_id
      and wide.resource_textbox_id is null
  )
on conflict do nothing`, string(rows)); err != nil {
			return err
		}
	}
	if tableName == "attachments" {
		if _, err := tx.ExecContext(ctx, `
update attachments existing
set deleted_timestamp=restored.deleted_timestamp,
    updated_timestamp=greatest(existing.updated_timestamp,clock_timestamp())
from jsonb_populate_recordset(null::attachments,coalesce($1::jsonb,'[]'::jsonb)) restored
where existing.company_id=restored.company_id
  and existing.attachment_id=restored.attachment_id`, string(rows)); err != nil {
			return err
		}
	}
	if tableName == "attachment_relationships" {
		if _, err := tx.ExecContext(ctx, `
update attachment_relationships existing
set deleted_timestamp=restored.deleted_timestamp
from jsonb_populate_recordset(null::attachment_relationships,coalesce($1::jsonb,'[]'::jsonb)) restored
where existing.company_id=restored.company_id
  and existing.attachment_relationship_id=restored.attachment_relationship_id`, string(rows)); err != nil {
			return err
		}
	}
	qualifiedColumns := make([]string, len(columns))
	for index, column := range columns {
		qualifiedColumns[index] = "restored_row." + column
	}
	if tableName == "resource_operational_relationships" {
		query := fmt.Sprintf(`
insert into resource_operational_relationships (%s) overriding system value
select %s
from jsonb_populate_recordset(null::resource_operational_relationships, coalesce($1::jsonb, '[]'::jsonb)) restored_row
where (
    (restored_row.source_resource_type='company_explorer_folder' and exists (
      select 1 from company_explorer_folders folder
      where folder.company_id=restored_row.company_id and folder.folder_id=restored_row.source_resource_id
    ))
    or
    (restored_row.source_resource_type='logic_gate' and exists (
      select 1 from logic_gates process
      where process.company_id=restored_row.company_id and process.logic_gate_id=restored_row.source_resource_id
    ))
  )
  and (
    (restored_row.target_resource_type='company_explorer_folder' and exists (
      select 1 from company_explorer_folders folder
      where folder.company_id=restored_row.company_id and folder.folder_id=restored_row.target_resource_id
    ))
    or
    (restored_row.target_resource_type='logic_gate' and exists (
      select 1 from logic_gates process
      where process.company_id=restored_row.company_id and process.logic_gate_id=restored_row.target_resource_id
    ))
  )
on conflict do nothing`, columnList, strings.Join(qualifiedColumns, ", "))
		_, err := tx.ExecContext(ctx, query, string(rows))
		return err
	}
	if tableName == "process_map_placements" {
		query := fmt.Sprintf(`
insert into process_map_placements (%s) overriding system value
select %s
from jsonb_populate_recordset(null::process_map_placements, coalesce($1::jsonb, '[]'::jsonb)) restored_row
where (
    (restored_row.resource_type='company_explorer_folder' and exists (
      select 1 from company_explorer_folders folder
      where folder.company_id=restored_row.company_id and folder.folder_id=restored_row.resource_id
    ))
    or
    (restored_row.resource_type='logic_gate' and exists (
      select 1 from logic_gates process
      where process.company_id=restored_row.company_id and process.logic_gate_id=restored_row.resource_id
    ))
  )
  and (
    restored_row.map_parent_folder_id is null
    or exists (
      select 1 from company_explorer_folders parent_folder
      where parent_folder.company_id=restored_row.company_id
        and parent_folder.folder_id=restored_row.map_parent_folder_id
    )
  )
on conflict do nothing`, columnList, strings.Join(qualifiedColumns, ", "))
		_, err := tx.ExecContext(ctx, query, string(rows))
		return err
	}
	if tableName == "process_map_traces" {
		query := fmt.Sprintf(`
insert into process_map_traces (%s) overriding system value
select %s
from jsonb_populate_recordset(null::process_map_traces, coalesce($1::jsonb, '[]'::jsonb)) restored_row
where exists (
  select 1
  from resource_operational_relationships relationship
  where relationship.company_id=restored_row.company_id
    and relationship.resource_operational_relationship_id=restored_row.resource_operational_relationship_id
)
on conflict do nothing`, columnList, strings.Join(qualifiedColumns, ", "))
		_, err := tx.ExecContext(ctx, query, string(rows))
		return err
	}
	selectColumns := columnList
	if tableName == "email_drafts" {
		selected := make([]string, len(columns))
		for index, column := range columns {
			switch column {
			case `"revision"`:
				selected[index] = `greatest(restored_row."revision" + 1, 2)`
			case `"updated_timestamp"`:
				selected[index] = `clock_timestamp()`
			default:
				selected[index] = "restored_row." + column
			}
		}
		selectColumns = strings.Join(selected, ", ")
	}
	query := fmt.Sprintf(`
insert into %s (%s) overriding system value
select %s
from jsonb_populate_recordset(null::%s, coalesce($1::jsonb, '[]'::jsonb)) restored_row
on conflict do nothing`, tableName, columnList, selectColumns, tableName)
	if _, err := tx.ExecContext(ctx, query, string(rows)); err != nil {
		return err
	}
	return nil
}

func postgresRecycleRestorableColumnsTx(ctx context.Context, tx *sql.Tx, tableName string) ([]string, error) {
	if !recycleSnapshotTables[tableName] {
		return nil, ErrInvalid
	}
	rows, err := tx.QueryContext(ctx, `
select attname
from pg_attribute
where attrelid=to_regclass($1)
  and attnum > 0
  and not attisdropped
  and attgenerated = ''
order by attnum`, "public."+tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns := make([]string, 0)
	for rows.Next() {
		var columnName string
		if err := rows.Scan(&columnName); err != nil {
			return nil, err
		}
		columns = append(columns, quotePostgresIdentifier(columnName))
	}
	return columns, rows.Err()
}

func quotePostgresIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func postgresTableExistsTx(ctx context.Context, tx *sql.Tx, tableName string) (bool, error) {
	if !recycleSnapshotTables[tableName] && tableName != "recycle_bin_items" {
		return false, ErrInvalid
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, `select to_regclass($1) is not null`, "public."+tableName).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}

func mergeRecyclePayloads(payloads [][]byte) (map[string]json.RawMessage, error) {
	merged := map[string][]json.RawMessage{}
	for _, payload := range payloads {
		var record map[string][]json.RawMessage
		if err := json.Unmarshal(payload, &record); err != nil {
			return nil, err
		}
		for tableName, rows := range record {
			if !recycleSnapshotTables[tableName] {
				continue
			}
			merged[tableName] = append(merged[tableName], rows...)
		}
	}
	out := make(map[string]json.RawMessage, len(merged))
	for tableName, rows := range merged {
		encoded, err := json.Marshal(rows)
		if err != nil {
			return nil, err
		}
		out[tableName] = encoded
	}
	return out, nil
}

func postgresSnapshotRecyclePayloadTx(ctx context.Context, tx *sql.Tx, companyID string, scope companyExplorerRecycleScope) (json.RawMessage, error) {
	return postgresSnapshotRecyclePayloadWithCacheTx(ctx, tx, nil, companyID, scope)
}

func postgresSnapshotRecyclePayloadWithCacheTx(ctx context.Context, tx *sql.Tx, cache *recycleSnapshotCache, companyID string, scope companyExplorerRecycleScope) (json.RawMessage, error) {
	payload := map[string]json.RawMessage{}
	addTable := func(tableName, whereClause string, args ...any) error {
		rows, err := postgresSnapshotRowsWithCacheTx(ctx, tx, cache, tableName, whereClause, args...)
		if err != nil {
			return err
		}
		if len(rows) == 0 || string(rows) == "[]" {
			return nil
		}
		payload[tableName] = rows
		return nil
	}

	folderIDs := sortedMapKeys(scope.FolderIDs)
	nodeIDs := sortedMapKeys(scope.NodeIDs)
	logicGateIDs := sortedMapKeys(scope.LogicGateIDs)
	projectIDs := sortedMapKeys(scope.ProjectIDs)
	boardIDs := sortedMapKeys(scope.KanbanBoardIDs)
	folderIDCSV := strings.Join(folderIDs, ",")
	nodeIDCSV := strings.Join(nodeIDs, ",")
	logicGateIDCSV := strings.Join(logicGateIDs, ",")
	projectIDCSV := strings.Join(projectIDs, ",")

	if len(folderIDs) > 0 {
		if err := addTable("company_explorer_folders", `company_id=$1::uuid and folder_id = any(string_to_array($2, ',')::uuid[])`, companyID, folderIDCSV); err != nil {
			return nil, err
		}
	}
	if len(nodeIDs) > 0 {
		for _, tableName := range []string{"nodes", "node_textboxes", "node_textboxes_history", "node_textbox_chats", "node_account_assignments"} {
			if err := addTable(tableName, `company_id=$1::uuid and node_id = any(string_to_array($2, ',')::uuid[])`, companyID, nodeIDCSV); err != nil {
				return nil, err
			}
		}
		if err := addTable("node_relationships", `company_id=$1::uuid and (node_id_a = any(string_to_array($2, ',')::uuid[]) or node_id_b = any(string_to_array($2, ',')::uuid[]))`, companyID, nodeIDCSV); err != nil {
			return nil, err
		}
	}
	if len(logicGateIDs) > 0 {
		for _, tableName := range []string{"logic_gates", "logic_gate_textboxes", "logic_gate_textboxes_history"} {
			if err := addTable(tableName, `company_id=$1::uuid and logic_gate_id = any(string_to_array($2, ',')::uuid[])`, companyID, logicGateIDCSV); err != nil {
				return nil, err
			}
		}
		if err := addTable("user_logic_gate_shortcuts", `company_id=$1::uuid and logic_gate_id = any(string_to_array($2, ',')::uuid[])`, companyID, logicGateIDCSV); err != nil {
			return nil, err
		}
		for _, tableName := range []string{"kpis", "huddle_logic_gate_relationships", "huddle_node_logic_gate_relationships", "huddle_node_kpi_relationships"} {
			if err := addTable(tableName, `company_id=$1::uuid and logic_gate_id = any(string_to_array($2, ',')::uuid[])`, companyID, logicGateIDCSV); err != nil {
				return nil, err
			}
		}
	}
	if len(folderIDs) > 0 || len(logicGateIDs) > 0 {
		folderIDArray := `coalesce(string_to_array(nullif($2, ''), ',')::uuid[], '{}'::uuid[])`
		logicGateIDArray := `coalesce(string_to_array(nullif($3, ''), ',')::uuid[], '{}'::uuid[])`
		placementWhere := `company_id=$1::uuid and (` +
			`(resource_type='company_explorer_folder' and resource_id = any(` + folderIDArray + `)) or ` +
			`(resource_type='logic_gate' and resource_id = any(` + logicGateIDArray + `)) or ` +
			`map_parent_folder_id = any(` + folderIDArray + `))`
		if err := addTable("process_map_placements", placementWhere, companyID, folderIDCSV, logicGateIDCSV); err != nil {
			return nil, err
		}

		relationshipWhere := `company_id=$1::uuid and (` +
			`(source_resource_type='company_explorer_folder' and source_resource_id = any(` + folderIDArray + `)) or ` +
			`(target_resource_type='company_explorer_folder' and target_resource_id = any(` + folderIDArray + `)) or ` +
			`(source_resource_type='logic_gate' and source_resource_id = any(` + logicGateIDArray + `)) or ` +
			`(target_resource_type='logic_gate' and target_resource_id = any(` + logicGateIDArray + `)))`
		if err := addTable("resource_operational_relationships", relationshipWhere, companyID, folderIDCSV, logicGateIDCSV); err != nil {
			return nil, err
		}

		traceWhere := `company_id=$1::uuid and resource_operational_relationship_id in (` +
			`select relationship.resource_operational_relationship_id from resource_operational_relationships relationship ` +
			`where relationship.company_id=$1::uuid and (` +
			`(relationship.source_resource_type='company_explorer_folder' and relationship.source_resource_id = any(` + folderIDArray + `)) or ` +
			`(relationship.target_resource_type='company_explorer_folder' and relationship.target_resource_id = any(` + folderIDArray + `)) or ` +
			`(relationship.source_resource_type='logic_gate' and relationship.source_resource_id = any(` + logicGateIDArray + `)) or ` +
			`(relationship.target_resource_type='logic_gate' and relationship.target_resource_id = any(` + logicGateIDArray + `)) or ` +
			`exists (select 1 from process_map_placements placement where placement.company_id=$1::uuid ` +
			`and placement.map_parent_folder_id = any(` + folderIDArray + `) and (` +
			`(relationship.source_resource_type=placement.resource_type and relationship.source_resource_id=placement.resource_id) or ` +
			`(relationship.target_resource_type=placement.resource_type and relationship.target_resource_id=placement.resource_id)))))`
		if err := addTable("process_map_traces", traceWhere, companyID, folderIDCSV, logicGateIDCSV); err != nil {
			return nil, err
		}
	}
	if len(projectIDs) > 0 {
		for _, tableName := range []string{"projects", "project_textboxes", "project_textboxes_history", "project_textbox_chats"} {
			if err := addTable(tableName, `company_id=$1::uuid and project_id = any(string_to_array($2, ',')::uuid[])`, companyID, projectIDCSV); err != nil {
				return nil, err
			}
		}
	}
	if len(nodeIDs) > 0 || len(logicGateIDs) > 0 {
		assignmentWhere, assignmentArgs := recycleResourceWhere(companyID, nodeIDs, logicGateIDs, nil, "node_id", "logic_gate_id", "")
		if assignmentWhere != "" {
			if err := addTable("node_logic_gate_assignments", assignmentWhere, assignmentArgs...); err != nil {
				return nil, err
			}
			if err := addTable("kanban_board_projection", assignmentWhere, assignmentArgs...); err != nil {
				return nil, err
			}
			if err := addTable("project_management_timeline_items", assignmentWhere, assignmentArgs...); err != nil {
				return nil, err
			}
			if err := addTable("project_management_timeline_projection", assignmentWhere, assignmentArgs...); err != nil {
				return nil, err
			}
		}
	}
	if len(folderIDs) > 0 || len(nodeIDs) > 0 || len(logicGateIDs) > 0 || len(projectIDs) > 0 {
		itemWhere, itemArgs := recycleFolderItemsWhere(companyID, folderIDs, nodeIDs, logicGateIDs, projectIDs, boardIDs)
		if itemWhere != "" {
			if err := addTable("company_explorer_items", itemWhere, itemArgs...); err != nil {
				return nil, err
			}
		}
	}
	if len(nodeIDs) > 0 || len(logicGateIDs) > 0 || len(projectIDs) > 0 {
		relationshipWhere, relationshipArgs := recycleProjectRelationshipWhere(companyID, nodeIDs, logicGateIDs, projectIDs, false)
		if relationshipWhere != "" {
			if err := addTable("project_relationships", relationshipWhere, relationshipArgs...); err != nil {
				return nil, err
			}
		}
		projectionWhere, projectionArgs := recycleProjectRelationshipWhere(companyID, nodeIDs, logicGateIDs, projectIDs, true)
		if projectionWhere != "" {
			if err := addTable("project_relationship_projection", projectionWhere, projectionArgs...); err != nil {
				return nil, err
			}
		}
	}
	if len(nodeIDs) > 0 || len(projectIDs) > 0 {
		draftWhere, draftArgs := recycleTypedResourceWhere(companyID, nodeIDs, nil, projectIDs, "shared_resource_type", "shared_resource_id")
		draftWhere += " and deleted_timestamp is null"
		if err := addTable("email_drafts", draftWhere, draftArgs...); err != nil {
			return nil, err
		}
		attachmentRelationshipWhere := `company_id=$1::uuid and (
  ($2<>'' and ((resource_type='node' and resource_id=any(string_to_array($2,',')::text[]))
    or (resource_type='node_chat_message' and resource_id in (
      select chat_id::text from node_textbox_chats where company_id=$1::uuid
        and node_id=any(string_to_array($2,',')::uuid[])))))
  or ($3<>'' and ((resource_type='project' and resource_id=any(string_to_array($3,',')::text[]))
    or (resource_type='project_chat_message' and resource_id in (
      select chat_id::text from project_textbox_chats where company_id=$1::uuid
        and project_id=any(string_to_array($3,',')::uuid[])))))
  or (resource_type='email_draft' and resource_id in (
    select draft_id from email_drafts where company_id=$1::uuid and deleted_timestamp is null
      and (($2<>'' and shared_resource_type='node' and shared_resource_id=any(string_to_array($2,',')::uuid[]))
        or ($3<>'' and shared_resource_type='project' and shared_resource_id=any(string_to_array($3,',')::uuid[])))))
)`
		attachmentArgs := []any{companyID, nodeIDCSV, projectIDCSV}
		if err := addTable("attachment_relationships", attachmentRelationshipWhere, attachmentArgs...); err != nil {
			return nil, err
		}
		if err := addTable("attachments", `company_id=$1::uuid and attachment_id in (
  select attachment_id from attachment_relationships where `+attachmentRelationshipWhere+`
)`, attachmentArgs...); err != nil {
			return nil, err
		}
	}
	if len(nodeIDs) > 0 || len(logicGateIDs) > 0 || len(projectIDs) > 0 {
		emailWhere, emailArgs := recycleTypedResourceWhere(companyID, nodeIDs, logicGateIDs, projectIDs, "resource_type", "resource_id")
		if emailWhere != "" {
			if err := addTable("email_relationships", emailWhere, emailArgs...); err != nil {
				return nil, err
			}
		}
	}
	accessNodeIDs := nodeIDs
	accessLogicGateIDs := logicGateIDs
	accessProjectIDs := projectIDs
	accessFolderIDs := communicationsFolderIDs(scope)
	explorerFolderIDs := companyExplorerPolicyFolderIDs(scope)
	if len(accessNodeIDs) > 0 || len(accessLogicGateIDs) > 0 || len(accessProjectIDs) > 0 || len(accessFolderIDs) > 0 || len(explorerFolderIDs) > 0 {
		accessWhere, accessArgs := recycleTypedResourceWhere(companyID, accessNodeIDs, accessLogicGateIDs, accessProjectIDs, "resource_type", "resource_id")
		if accessWhere != "" {
			for _, tableName := range []string{"resource_gvic_settings", "resource_permission_settings", "resource_gvic_assignments", "resource_permissions"} {
				if err := addTable(tableName, accessWhere, accessArgs...); err != nil {
					return nil, err
				}
			}
		}
		if len(explorerFolderIDs) > 0 {
			folderAccessWhere, folderAccessArgs := recycleSingleTypedResourceWhere(companyID, EntityTypeCompanyExplorerFolder, explorerFolderIDs, "resource_type", "resource_id")
			for _, tableName := range []string{"resource_gvic_settings", "resource_permission_settings", "resource_gvic_assignments", "resource_permissions"} {
				if err := addTable(tableName, folderAccessWhere, folderAccessArgs...); err != nil {
					return nil, err
				}
			}
		}
		if len(accessFolderIDs) > 0 {
			for _, resourceType := range []string{EntityTypeSharedInboxFolder, EntityTypeSharedInbox} {
				folderAccessWhere, folderAccessArgs := recycleSingleTypedResourceWhere(companyID, resourceType, accessFolderIDs, "resource_type", "resource_id")
				for _, tableName := range []string{"resource_gvic_settings", "resource_permission_settings", "resource_gvic_assignments", "resource_permissions"} {
					if err := addTable(tableName, folderAccessWhere, folderAccessArgs...); err != nil {
						return nil, err
					}
				}
			}
		}

	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

func postgresSnapshotRowsTx(ctx context.Context, tx *sql.Tx, tableName, whereClause string, args ...any) (json.RawMessage, error) {
	return postgresSnapshotRowsWithCacheTx(ctx, tx, nil, tableName, whereClause, args...)
}

func postgresSnapshotRowsWithCacheTx(ctx context.Context, tx *sql.Tx, cache *recycleSnapshotCache, tableName, whereClause string, args ...any) (json.RawMessage, error) {
	if !recycleSnapshotTables[tableName] {
		return nil, ErrInvalid
	}
	exists, err := postgresRecycleSnapshotTableExistsTx(ctx, tx, cache, tableName)
	if err != nil {
		return nil, err
	}
	if !exists {
		return json.RawMessage("[]"), nil
	}
	shapeKey := recycleSnapshotShapeKey(tableName, whereClause)
	if cache != nil {
		if cache.shapeBad[shapeKey] {
			return json.RawMessage("[]"), nil
		}
		if cache.shapeOK[shapeKey] {
			rows, err := postgresSnapshotRowsQueryTx(ctx, tx, tableName, whereClause, args...)
			if err != nil {
				return nil, fmt.Errorf("snapshot recycle table %s: %w", tableName, err)
			}
			return rows, nil
		}
	}
	const savepoint = "mangorts_recycle_snapshot"
	if _, err := tx.ExecContext(ctx, `savepoint `+savepoint); err != nil {
		return nil, fmt.Errorf("create recycle snapshot savepoint: %w", err)
	}
	raw, err := postgresSnapshotRowsQueryTx(ctx, tx, tableName, whereClause, args...)
	if err != nil {
		if isRecycleSnapshotShapeError(err) {
			if rollbackErr := rollbackAndReleaseRecycleSnapshotSavepointTx(ctx, tx, savepoint); rollbackErr != nil {
				return nil, rollbackErr
			}
			if cache != nil {
				cache.shapeBad[shapeKey] = true
			}
			return json.RawMessage("[]"), nil
		}
		_, _ = tx.ExecContext(ctx, `rollback to savepoint `+savepoint)
		return nil, fmt.Errorf("snapshot recycle table %s: %w", tableName, err)
	}
	if _, err := tx.ExecContext(ctx, `release savepoint `+savepoint); err != nil {
		return nil, fmt.Errorf("release recycle snapshot savepoint: %w", err)
	}
	if cache != nil {
		cache.shapeOK[shapeKey] = true
	}
	return raw, nil
}

func postgresSnapshotRowsQueryTx(ctx context.Context, tx *sql.Tx, tableName, whereClause string, args ...any) (json.RawMessage, error) {
	lockClause := ""
	if tableName == "email_drafts" {
		lockClause = " order by draft_id for update"
	}
	query := fmt.Sprintf(`
select coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
from (
  select *
  from %s
  where %s%s
) row_data`, tableName, whereClause, lockClause)
	var raw []byte
	if err := tx.QueryRowContext(ctx, query, args...).Scan(&raw); err != nil {
		return nil, err
	}
	return raw, nil
}

type recycleSnapshotCache struct {
	tableExists map[string]bool
	shapeOK     map[string]bool
	shapeBad    map[string]bool
}

func newRecycleSnapshotCache() *recycleSnapshotCache {
	return &recycleSnapshotCache{
		tableExists: map[string]bool{},
		shapeOK:     map[string]bool{},
		shapeBad:    map[string]bool{},
	}
}

func postgresRecycleSnapshotTableExistsTx(ctx context.Context, tx *sql.Tx, cache *recycleSnapshotCache, tableName string) (bool, error) {
	if cache == nil {
		return postgresTableExistsTx(ctx, tx, tableName)
	}
	if exists, ok := cache.tableExists[tableName]; ok {
		return exists, nil
	}
	exists, err := postgresTableExistsTx(ctx, tx, tableName)
	if err != nil {
		return false, err
	}
	cache.tableExists[tableName] = exists
	return exists, nil
}

func recycleSnapshotShapeKey(tableName, whereClause string) string {
	return tableName + "\x00" + whereClause
}

func isRecycleSnapshotShapeError(err error) bool {
	return isPostgresUndefinedTable(err, "") || isPostgresUndefinedColumn(err, "")
}

func rollbackAndReleaseRecycleSnapshotSavepointTx(ctx context.Context, tx *sql.Tx, savepoint string) error {
	if _, err := tx.ExecContext(ctx, `rollback to savepoint `+savepoint); err != nil {
		return fmt.Errorf("rollback recycle snapshot savepoint: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `release savepoint `+savepoint); err != nil {
		return fmt.Errorf("release recycle snapshot savepoint after rollback: %w", err)
	}
	return nil
}

func recycleResourceWhere(companyID string, nodeIDs, logicGateIDs, projectIDs []string, nodeColumn, logicGateColumn, projectColumn string) (string, []any) {
	clauses := []string{}
	args := []any{companyID}
	if len(nodeIDs) > 0 && nodeColumn != "" {
		args = append(args, strings.Join(nodeIDs, ","))
		clauses = append(clauses, fmt.Sprintf("%s = any(string_to_array($%d, ',')::uuid[])", nodeColumn, len(args)))
	}
	if len(logicGateIDs) > 0 && logicGateColumn != "" {
		args = append(args, strings.Join(logicGateIDs, ","))
		clauses = append(clauses, fmt.Sprintf("%s = any(string_to_array($%d, ',')::uuid[])", logicGateColumn, len(args)))
	}
	if len(projectIDs) > 0 && projectColumn != "" {
		args = append(args, strings.Join(projectIDs, ","))
		clauses = append(clauses, fmt.Sprintf("%s = any(string_to_array($%d, ',')::uuid[])", projectColumn, len(args)))
	}
	if len(clauses) == 0 {
		return "", nil
	}
	return "company_id=$1::uuid and (" + strings.Join(clauses, " or ") + ")", args
}

func recycleSingleTypedResourceWhere(companyID, resourceType string, ids []string, typeColumn, idColumn string) (string, []any) {
	return fmt.Sprintf("company_id=$1::uuid and %s=$2 and %s = any(string_to_array($3, ',')::uuid[])", typeColumn, idColumn), []any{companyID, resourceType, strings.Join(ids, ",")}
}

func recycleTypedResourceWhere(companyID string, nodeIDs, logicGateIDs, projectIDs []string, typeColumn, idColumn string) (string, []any) {
	clauses := []string{}
	args := []any{companyID}
	add := func(resourceType string, ids []string) {
		if len(ids) == 0 {
			return
		}
		args = append(args, resourceType, strings.Join(ids, ","))
		typeArg := len(args) - 1
		idsArg := len(args)
		clauses = append(clauses, fmt.Sprintf("(%s=$%d and %s = any(string_to_array($%d, ',')::uuid[]))", typeColumn, typeArg, idColumn, idsArg))
	}
	add(EntityTypeNode, nodeIDs)
	add(EntityTypeLogicGate, logicGateIDs)
	add(EntityTypeProject, projectIDs)
	if len(clauses) == 0 {
		return "", nil
	}
	return "company_id=$1::uuid and (" + strings.Join(clauses, " or ") + ")", args
}

func recycleProjectRelationshipWhere(companyID string, nodeIDs, logicGateIDs, projectIDs []string, projection bool) (string, []any) {
	clauses := []string{}
	args := []any{companyID}
	if len(projectIDs) > 0 {
		args = append(args, strings.Join(projectIDs, ","))
		clauses = append(clauses, fmt.Sprintf("project_id = any(string_to_array($%d, ',')::uuid[])", len(args)))
	}
	if len(nodeIDs) > 0 {
		args = append(args, EntityTypeNode, strings.Join(nodeIDs, ","))
		clauses = append(clauses, fmt.Sprintf("(resource_type=$%d and resource_id = any(string_to_array($%d, ',')::uuid[]))", len(args)-1, len(args)))
		if projection {
			clauses = append(clauses, fmt.Sprintf("node_id = any(string_to_array($%d, ',')::uuid[])", len(args)))
		}
	}
	if len(logicGateIDs) > 0 {
		args = append(args, EntityTypeLogicGate, strings.Join(logicGateIDs, ","))
		clauses = append(clauses, fmt.Sprintf("(resource_type=$%d and resource_id = any(string_to_array($%d, ',')::uuid[]))", len(args)-1, len(args)))
		if projection {
			clauses = append(clauses, fmt.Sprintf("logic_gate_id = any(string_to_array($%d, ',')::uuid[])", len(args)))
		}
	}
	if len(clauses) == 0 {
		return "", nil
	}
	return "company_id=$1::uuid and (" + strings.Join(clauses, " or ") + ")", args
}

func recycleRACIMatrixProjectionWhere(companyID string, nodeIDs, logicGateIDs []string) (string, []any) {
	clauses := []string{}
	args := []any{companyID}
	if len(nodeIDs) > 0 {
		args = append(args, EntityTypeNode, strings.Join(nodeIDs, ","))
		clauses = append(clauses, fmt.Sprintf("(resource_type=$%d and resource_id = any(string_to_array($%d, ',')::uuid[]))", len(args)-1, len(args)))
	}
	if len(logicGateIDs) > 0 {
		args = append(args, EntityTypeLogicGate, strings.Join(logicGateIDs, ","))
		clauses = append(clauses, fmt.Sprintf("(resource_type=$%d and resource_id = any(string_to_array($%d, ',')::uuid[]))", len(args)-1, len(args)))
		clauses = append(clauses, fmt.Sprintf("logic_gate_id = any(string_to_array($%d, ',')::uuid[])", len(args)))
	}
	if len(clauses) == 0 {
		return "", nil
	}
	return "company_id=$1::uuid and (" + strings.Join(clauses, " or ") + ")", args
}

func recycleFolderItemsWhere(companyID string, folderIDs, nodeIDs, logicGateIDs, projectIDs, boardIDs []string) (string, []any) {
	clauses := []string{}
	args := []any{companyID}
	if len(folderIDs) > 0 {
		args = append(args, strings.Join(folderIDs, ","))
		clauses = append(clauses, fmt.Sprintf("parent_folder_id = any(string_to_array($%d, ',')::uuid[])", len(args)))
	}
	addItem := func(itemType string, ids []string) {
		if len(ids) == 0 {
			return
		}
		args = append(args, itemType, strings.Join(ids, ","))
		clauses = append(clauses, fmt.Sprintf("(target_type=$%d and target_id = any(string_to_array($%d, ',')::uuid[]))", len(args)-1, len(args)))
	}
	addItem(EntityTypeNode, nodeIDs)
	addItem(EntityTypeLogicGate, logicGateIDs)
	addItem(EntityTypeProject, projectIDs)
	if len(clauses) == 0 {
		return "", nil
	}
	return "company_id=$1::uuid and (" + strings.Join(clauses, " or ") + ")", args
}

func communicationsFolderIDs(scope companyExplorerRecycleScope) []string {
	out := make([]string, 0)
	for folderID := range scope.FolderIDs {
		if scope.FolderKinds[folderID] == "communications" {
			out = append(out, folderID)
		}
	}
	sort.Strings(out)
	return out
}

func sortedMapKeys(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		if strings.TrimSpace(value) != "" {
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}

func postgresCreateRecycleBinItemsTx(ctx context.Context, tx *sql.Tx, companyID, deletedByUserID string, roots []companyExplorerRecycleRootScope) error {
	if len(roots) == 0 {
		return nil
	}
	if exists, err := postgresTableExistsTx(ctx, tx, "recycle_bin_items"); err != nil {
		return err
	} else if !exists {
		return nil
	}
	snapshotCache := newRecycleSnapshotCache()
	seen := map[string]bool{}
	for _, root := range roots {
		if !root.Scope.hasAnyRows() {
			continue
		}
		key := root.Target.Kind + ":" + root.Target.ID
		if seen[key] {
			continue
		}
		seen[key] = true
		payload, err := postgresSnapshotRecyclePayloadWithCacheTx(ctx, tx, snapshotCache, companyID, root.Scope)
		if err != nil {
			return err
		}
		label, err := postgresRecycleTargetLabelTx(ctx, tx, companyID, root.Target)
		if err != nil {
			return err
		}
		if strings.TrimSpace(label) == "" {
			label = root.Target.ID
		}
		folderKind := ""
		if root.Target.Kind == "folder" {
			folderKind = root.Scope.FolderKinds[root.Target.ID]
		}
		if _, err := tx.ExecContext(ctx, `
insert into recycle_bin_items (
  company_id,
  recycle_bin_item_id,
  object_kind,
  object_id,
  object_label,
  object_folder_kind,
  restore_payload,
  deleted_by_user_id
) values ($1::uuid, $2::uuid, $3, $4, $5, nullif($6, ''), $7::jsonb, nullif($8, '')::uuid)`,
			companyID, newUUIDv7String(), root.Target.Kind, root.Target.ID, label, folderKind, string(payload), deletedByUserID,
		); err != nil {
			return err
		}
	}
	return nil
}

func postgresExpandCompanyExplorerRecycleScopeTx(ctx context.Context, tx *sql.Tx, companyID string, scope *companyExplorerRecycleScope) error {
	if scope == nil {
		return nil
	}
	changed := true
	for changed {
		before := len(scope.FolderIDs) + len(scope.NodeIDs) + len(scope.LogicGateIDs) + len(scope.ProjectIDs) + len(scope.KanbanBoardIDs)
		if err := postgresAddFolderScopeItemsTx(ctx, tx, companyID, scope); err != nil {
			return err
		}
		if err := postgresAddLogicGateScopeItemsTx(ctx, tx, companyID, scope); err != nil {
			return err
		}
		after := len(scope.FolderIDs) + len(scope.NodeIDs) + len(scope.LogicGateIDs) + len(scope.ProjectIDs) + len(scope.KanbanBoardIDs)
		changed = after > before
	}
	return nil
}

func postgresAddFolderScopeItemsTx(ctx context.Context, tx *sql.Tx, companyID string, scope *companyExplorerRecycleScope) error {
	if scope == nil || len(scope.FolderIDs) == 0 {
		return nil
	}
	rows, err := tx.QueryContext(ctx, `
select target_type, target_id::text
from company_explorer_items
where company_id=$1::uuid
  and parent_folder_id = any(string_to_array($2, ',')::uuid[])`,
		companyID, strings.Join(sortedMapKeys(scope.FolderIDs), ","),
	)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var itemType string
		var itemID string
		if err := rows.Scan(&itemType, &itemID); err != nil {
			return err
		}
		switch itemType {
		case EntityTypeLogicGate:
			scope.LogicGateIDs[itemID] = true
		case EntityTypeProject:
			scope.ProjectIDs[itemID] = true
		case "kanban":
			scope.KanbanBoardIDs[itemID] = true
		}
	}
	return rows.Err()
}

func postgresAddLogicGateScopeItemsTx(ctx context.Context, tx *sql.Tx, companyID string, scope *companyExplorerRecycleScope) error {
	if scope == nil || len(scope.LogicGateIDs) == 0 {
		return nil
	}
	rows, err := tx.QueryContext(ctx, `
select node_id::text
from node_logic_gate_assignments
where company_id=$1::uuid
  and logic_gate_id = any(string_to_array($2, ',')::uuid[])`,
		companyID, strings.Join(sortedMapKeys(scope.LogicGateIDs), ","),
	)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var nodeID string
		if err := rows.Scan(&nodeID); err != nil {
			return err
		}
		scope.NodeIDs[nodeID] = true
	}
	return rows.Err()
}

func postgresRecycleTargetLabelTx(ctx context.Context, tx *sql.Tx, companyID string, target CompanyExplorerDeleteTargetInput) (string, error) {
	var label string
	var err error
	switch target.Kind {
	case "folder":
		err = tx.QueryRowContext(ctx, `select name from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid`, companyID, target.ID).Scan(&label)
	case "node":
		err = tx.QueryRowContext(ctx, `select name from nodes where company_id=$1::uuid and node_id=$2::uuid`, companyID, target.ID).Scan(&label)
	case "logic_gate":
		err = tx.QueryRowContext(ctx, `select header from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid`, companyID, target.ID).Scan(&label)
	case "project":
		err = tx.QueryRowContext(ctx, `select name from projects where company_id=$1::uuid and project_id=$2::uuid`, companyID, target.ID).Scan(&label)
	case "kanban":
		label = "Kanban board"
		return label, nil
	default:
		return "", ErrInvalid
	}
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return label, err
}
