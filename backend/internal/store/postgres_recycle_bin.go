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

func (r *PostgresRepo) ListRecycleBinItems(companyID string) ([]domain.RecycleBinItem, error) {
	companyID = strings.TrimSpace(companyID)
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
       deleted_timestamp
from recycle_bin_items
where company_id=$1::uuid
order by deleted_timestamp desc, recycle_bin_item_id desc`, companyID)
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
		if err := rows.Scan(
			&item.CompanyID,
			&item.RecycleBinItemID,
			&item.ObjectKind,
			&item.ObjectID,
			&item.ObjectLabel,
			&item.ObjectFolderKind,
			&item.DeletedByUserID,
			&item.DeletedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) PermanentlyDeleteRecycleBinItems(companyID string, itemIDs []string) error {
	companyID = strings.TrimSpace(companyID)
	itemIDs = normalizeRecycleBinItemIDs(itemIDs)
	if companyID == "" || len(itemIDs) == 0 || len(itemIDs) > RecycleBinBatchMaxItems {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `
delete from recycle_bin_items
where company_id=$1::uuid
  and recycle_bin_item_id = any(string_to_array($2, ',')::uuid[])`, companyID, strings.Join(itemIDs, ","))
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

func (r *PostgresRepo) RestoreRecycleBinItems(companyID string, itemIDs []string) (RecycleBinRestoreResult, error) {
	companyID = strings.TrimSpace(companyID)
	itemIDs = normalizeRecycleBinItemIDs(itemIDs)
	if companyID == "" || len(itemIDs) == 0 || len(itemIDs) > RecycleBinBatchMaxItems {
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
  and recycle_bin_item_id = any(string_to_array($2, ',')::uuid[])
order by deleted_timestamp asc, recycle_bin_item_id asc`, companyID, strings.Join(itemIDs, ","))
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
	if _, err := tx.ExecContext(ctx, `
delete from recycle_bin_items
where company_id=$1::uuid
  and recycle_bin_item_id = any(string_to_array($2, ',')::uuid[])`, companyID, strings.Join(itemIDs, ",")); err != nil {
		return RecycleBinRestoreResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return RecycleBinRestoreResult{}, err
	}
	return RecycleBinRestoreResult{Items: items, Targets: targets}, nil
}

var recycleSnapshotTables = map[string]bool{
	"company_explorer_folders":                           true,
	"nodes":                                              true,
	"logic_gates":                                        true,
	"projects":                                           true,
	"node_information":                                   true,
	"node_projection_table":                              true,
	"node_content_changes":                               true,
	"node_content_change_seen":                           true,
	"node_projection_seen_snapshots":                     true,
	"node_map_positions":                                 true,
	"node_account_assignments":                           true,
	"node_relationships":                                 true,
	"logic_gate_information":                             true,
	"logic_gate_projection_table":                        true,
	"logic_gate_map_positions":                           true,
	"logic_gate_relationships":                           true,
	"logic_gate_raci_assignments":                        true,
	"user_logic_gate_shortcuts":                          true,
	"project_information":                                true,
	"project_projection_table":                           true,
	"project_relationships":                              true,
	"project_relationship_projection":                    true,
	"node_logic_gate_assignments":                        true,
	"kanban_board_projection":                            true,
	"racio_matrix_projection_table":                      true,
	"project_management_timeline_items":                  true,
	"project_management_timeline_projection":             true,
	"resource_raci_assignments":                          true,
	"entity_access_permissions":                          true,
	"resource_access_grants":                             true,
	"resource_permissions":                               true,
	"company_explorer_folder_items":                      true,
	"communications_shared_inbox_raci_assignments":       true,
	"communications_shared_inbox_raci_group_assignments": true,
	"company_explorer_folder_shares":                     true,
	"communications_email_nodes":                         true,
}

var recycleRestoreTableOrder = []string{
	"nodes",
	"logic_gates",
	"projects",
	"company_explorer_folders",
	"node_information",
	"node_projection_table",
	"logic_gate_information",
	"logic_gate_projection_table",
	"project_information",
	"project_projection_table",
	"node_map_positions",
	"logic_gate_map_positions",
	"node_content_changes",
	"node_content_change_seen",
	"node_projection_seen_snapshots",
	"node_account_assignments",
	"logic_gate_raci_assignments",
	"resource_raci_assignments",
	"entity_access_permissions",
	"resource_access_grants",
	"resource_permissions",
	"communications_shared_inbox_raci_assignments",
	"communications_shared_inbox_raci_group_assignments",
	"company_explorer_folder_shares",
	"user_logic_gate_shortcuts",
	"communications_email_nodes",
	"node_logic_gate_assignments",
	"node_relationships",
	"logic_gate_relationships",
	"project_relationships",
	"project_relationship_projection",
	"project_management_timeline_items",
	"project_management_timeline_projection",
	"kanban_board_projection",
	"racio_matrix_projection_table",
	"company_explorer_folder_items",
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
	query := fmt.Sprintf(`
insert into %s
select *
from jsonb_populate_recordset(null::%s, coalesce($1::jsonb, '[]'::jsonb))
on conflict do nothing`, tableName, tableName)
	if _, err := tx.ExecContext(ctx, query, string(rows)); err != nil {
		return err
	}
	return nil
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
	payload := map[string]json.RawMessage{}
	addTable := func(tableName, whereClause string, args ...any) error {
		rows, err := postgresSnapshotRowsTx(ctx, tx, tableName, whereClause, args...)
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
		if err := addTable("communications_shared_inbox_raci_assignments", `company_id=$1::uuid and folder_id = any(string_to_array($2, ',')::uuid[])`, companyID, folderIDCSV); err != nil {
			return nil, err
		}
		if err := addTable("communications_shared_inbox_raci_group_assignments", `company_id=$1::uuid and folder_id = any(string_to_array($2, ',')::uuid[])`, companyID, folderIDCSV); err != nil {
			return nil, err
		}
		if err := addTable("company_explorer_folder_shares", `company_id=$1::uuid and folder_id = any(string_to_array($2, ',')::uuid[])`, companyID, folderIDCSV); err != nil {
			return nil, err
		}
	}
	if len(nodeIDs) > 0 {
		for _, tableName := range []string{"nodes", "node_information", "node_projection_table", "node_projection_seen_snapshots", "node_map_positions", "node_account_assignments"} {
			if err := addTable(tableName, `company_id=$1::uuid and node_id = any(string_to_array($2, ',')::uuid[])`, companyID, nodeIDCSV); err != nil {
				return nil, err
			}
		}
		if err := addTable("node_content_changes", `company_id=$1::uuid and node_id = any(string_to_array($2, ',')::uuid[])`, companyID, nodeIDCSV); err != nil {
			return nil, err
		}
		if err := addTable("node_content_change_seen", `company_id=$1::uuid and change_id in (select change_id from node_content_changes where company_id=$1::uuid and node_id = any(string_to_array($2, ',')::uuid[]))`, companyID, nodeIDCSV); err != nil {
			return nil, err
		}
		if err := addTable("node_relationships", `company_id=$1::uuid and (node_id_a = any(string_to_array($2, ',')::uuid[]) or node_id_b = any(string_to_array($2, ',')::uuid[]))`, companyID, nodeIDCSV); err != nil {
			return nil, err
		}
	}
	if len(logicGateIDs) > 0 {
		for _, tableName := range []string{"logic_gates", "logic_gate_information", "logic_gate_projection_table", "logic_gate_map_positions", "logic_gate_raci_assignments"} {
			if err := addTable(tableName, `company_id=$1::uuid and logic_gate_id = any(string_to_array($2, ',')::uuid[])`, companyID, logicGateIDCSV); err != nil {
				return nil, err
			}
		}
		if err := addTable("logic_gate_relationships", `company_id=$1::uuid and (logic_gate_id_a = any(string_to_array($2, ',')::uuid[]) or logic_gate_id_b = any(string_to_array($2, ',')::uuid[]))`, companyID, logicGateIDCSV); err != nil {
			return nil, err
		}
		if err := addTable("user_logic_gate_shortcuts", `company_id=$1::uuid and logic_gate_id = any(string_to_array($2, ',')::uuid[])`, companyID, logicGateIDCSV); err != nil {
			return nil, err
		}
	}
	if len(projectIDs) > 0 {
		for _, tableName := range []string{"projects", "project_information", "project_projection_table"} {
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
	if len(folderIDs) > 0 || len(nodeIDs) > 0 || len(logicGateIDs) > 0 || len(projectIDs) > 0 || len(boardIDs) > 0 {
		itemWhere, itemArgs := recycleFolderItemsWhere(companyID, folderIDs, nodeIDs, logicGateIDs, projectIDs, boardIDs)
		if itemWhere != "" {
			if err := addTable("company_explorer_folder_items", itemWhere, itemArgs...); err != nil {
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
	if len(nodeIDs) > 0 || len(logicGateIDs) > 0 {
		emailWhere, emailArgs := recycleResourceWhere(companyID, nodeIDs, logicGateIDs, nil, "node_id", "logic_gate_id", "")
		if emailWhere != "" {
			if err := addTable("communications_email_nodes", emailWhere, emailArgs...); err != nil {
				return nil, err
			}
		}
		racioWhere, racioArgs := recycleRacioProjectionWhere(companyID, nodeIDs, logicGateIDs)
		if racioWhere != "" {
			if err := addTable("racio_matrix_projection_table", racioWhere, racioArgs...); err != nil {
				return nil, err
			}
		}
	}
	accessNodeIDs := nodeIDs
	accessLogicGateIDs := logicGateIDs
	accessProjectIDs := projectIDs
	accessFolderIDs := communicationsFolderIDs(scope)
	if len(accessNodeIDs) > 0 || len(accessLogicGateIDs) > 0 || len(accessProjectIDs) > 0 || len(accessFolderIDs) > 0 {
		accessWhere, accessArgs := recycleTypedResourceWhere(companyID, accessNodeIDs, accessLogicGateIDs, accessProjectIDs, "resource_type", "resource_id")
		if accessWhere != "" {
			for _, tableName := range []string{"resource_raci_assignments", "resource_access_grants"} {
				if err := addTable(tableName, accessWhere, accessArgs...); err != nil {
					return nil, err
				}
			}
		}
		if len(accessFolderIDs) > 0 {
			folderAccessWhere, folderAccessArgs := recycleSingleTypedResourceWhere(companyID, "shared_triage_folder", accessFolderIDs, "resource_type", "resource_id")
			for _, tableName := range []string{"resource_raci_assignments", "resource_access_grants"} {
				if err := addTable(tableName, folderAccessWhere, folderAccessArgs...); err != nil {
					return nil, err
				}
			}
		}
		entityWhere, entityArgs := recycleTypedResourceWhere(companyID, accessNodeIDs, accessLogicGateIDs, accessProjectIDs, "entity_type", "entity_id")
		if entityWhere != "" {
			if err := addTable("entity_access_permissions", entityWhere, entityArgs...); err != nil {
				return nil, err
			}
		}
		permissionWhere, permissionArgs := recycleTypedResourceWhere(companyID, accessNodeIDs, accessLogicGateIDs, accessProjectIDs, "resource_type", "resource_id")
		if permissionWhere != "" {
			if err := addTable("resource_permissions", permissionWhere, permissionArgs...); err != nil {
				return nil, err
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
	if !recycleSnapshotTables[tableName] {
		return nil, ErrInvalid
	}
	exists, err := postgresTableExistsTx(ctx, tx, tableName)
	if err != nil {
		return nil, err
	}
	if !exists {
		return json.RawMessage("[]"), nil
	}
	query := fmt.Sprintf(`
select coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
from (
  select *
  from %s
  where %s
) row_data`, tableName, whereClause)
	var raw []byte
	if err := tx.QueryRowContext(ctx, query, args...).Scan(&raw); err != nil {
		return nil, err
	}
	return raw, nil
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

func recycleRacioProjectionWhere(companyID string, nodeIDs, logicGateIDs []string) (string, []any) {
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
		clauses = append(clauses, fmt.Sprintf("folder_id = any(string_to_array($%d, ',')::uuid[])", len(args)))
	}
	addItem := func(itemType string, ids []string) {
		if len(ids) == 0 {
			return
		}
		args = append(args, itemType, strings.Join(ids, ","))
		clauses = append(clauses, fmt.Sprintf("(item_type=$%d and item_id = any(string_to_array($%d, ',')))", len(args)-1, len(args)))
	}
	addItem(EntityTypeNode, nodeIDs)
	addItem(EntityTypeLogicGate, logicGateIDs)
	addItem(EntityTypeProject, projectIDs)
	addItem("kanban", boardIDs)
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

func postgresCreateRecycleBinItemsTx(ctx context.Context, tx *sql.Tx, companyID string, roots []companyExplorerRecycleRootScope) error {
	if len(roots) == 0 {
		return nil
	}
	if exists, err := postgresTableExistsTx(ctx, tx, "recycle_bin_items"); err != nil {
		return err
	} else if !exists {
		return nil
	}
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
		payload, err := postgresSnapshotRecyclePayloadTx(ctx, tx, companyID, root.Scope)
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
  restore_payload
) values ($1::uuid, $2::uuid, $3, $4, $5, nullif($6, ''), $7::jsonb)`,
			companyID, newUUIDv7String(), root.Target.Kind, root.Target.ID, label, folderKind, string(payload),
		); err != nil {
			return err
		}
	}
	return nil
}

func postgresAddFolderScopeItemsTx(ctx context.Context, tx *sql.Tx, companyID string, scope *companyExplorerRecycleScope) error {
	if scope == nil || len(scope.FolderIDs) == 0 {
		return nil
	}
	rows, err := tx.QueryContext(ctx, `
select item_type, item_id
from company_explorer_folder_items
where company_id=$1::uuid
  and folder_id = any(string_to_array($2, ',')::uuid[])`,
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
		case EntityTypeNode:
			scope.NodeIDs[itemID] = true
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

func postgresRecycleTargetLabelTx(ctx context.Context, tx *sql.Tx, companyID string, target CompanyExplorerDeleteTargetInput) (string, error) {
	var label string
	var err error
	switch target.Kind {
	case "folder":
		err = tx.QueryRowContext(ctx, `select name from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid`, companyID, target.ID).Scan(&label)
	case "node":
		err = tx.QueryRowContext(ctx, `select title from nodes where company_id=$1::uuid and node_id=$2::uuid`, companyID, target.ID).Scan(&label)
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
