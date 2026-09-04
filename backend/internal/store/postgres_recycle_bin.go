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
	FolderIDs    map[string]bool
	FolderKinds  map[string]string
	NodeIDs      map[string]bool
	LogicGateIDs map[string]bool
	ProjectIDs   map[string]bool
}

type companyExplorerRecycleRootScope struct {
	Target CompanyExplorerDeleteTargetInput
	Scope  companyExplorerRecycleScope
}

func newCompanyExplorerRecycleScope() companyExplorerRecycleScope {
	return companyExplorerRecycleScope{
		FolderIDs:    map[string]bool{},
		FolderKinds:  map[string]string{},
		NodeIDs:      map[string]bool{},
		LogicGateIDs: map[string]bool{},
		ProjectIDs:   map[string]bool{},
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
}

func (scope companyExplorerRecycleScope) hasAnyRows() bool {
	return len(scope.FolderIDs)+len(scope.NodeIDs)+len(scope.LogicGateIDs)+len(scope.ProjectIDs) > 0
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
	if err := lockPostgresCompanyExplorerMutationTx(ctx, tx, companyID, "", true); err != nil {
		return RecycleBinRestoreResult{}, err
	}

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
	if err := postgresRestoreProcessMapCleanupChildrenTx(ctx, tx, mergedPayload[processMapCleanupChildRecyclePayloadKey]); err != nil {
		return RecycleBinRestoreResult{}, err
	}
	if err := reconcileRestoredProjectTextboxColorsTx(ctx, tx, mergedPayload["project_textboxes"]); err != nil {
		return RecycleBinRestoreResult{}, err
	}
	processMapEvents, err := reconcileRestoredAutomaticProcessMapPlacementsTx(
		ctx,
		tx,
		companyID,
		deletedByUserID,
		mergedPayload["company_explorer_folders"],
		mergedPayload["logic_gates"],
	)
	if err != nil {
		return RecycleBinRestoreResult{}, err
	}
	eventInputs := companyExplorerTargetWorkspaceEventInputs(companyID, targets, true)
	eventInputs = append(eventInputs, processMapEvents...)
	events, err := r.appendDomainEventsTx(ctx, tx, eventInputs)
	if err != nil {
		return RecycleBinRestoreResult{}, err
	}
	boardIDs, err := recyclePayloadUUIDs(mergedPayload["huddle_logic_gates"], "huddle_logic_gate_id")
	if err != nil {
		return RecycleBinRestoreResult{}, err
	}
	restoredNodeIDs, err := recyclePayloadUUIDs(mergedPayload["huddle_nodes"], "huddle_node_id")
	if err != nil {
		return RecycleBinRestoreResult{}, err
	}
	boardSet := stringSet(boardIDs)
	if len(restoredNodeIDs) > 0 {
		rows, queryErr := tx.QueryContext(ctx, `
select distinct huddle_logic_gate_id::text
from huddle_nodes
where company_id=$1::uuid and huddle_node_id::text=any($2::text[])
order by huddle_logic_gate_id::text`, companyID, restoredNodeIDs)
		if queryErr != nil {
			return RecycleBinRestoreResult{}, queryErr
		}
		for rows.Next() {
			var boardID string
			if scanErr := rows.Scan(&boardID); scanErr != nil {
				rows.Close()
				return RecycleBinRestoreResult{}, scanErr
			}
			boardSet[boardID] = true
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			rows.Close()
			return RecycleBinRestoreResult{}, rowsErr
		}
		rows.Close()
	}
	boardIDs = sortedMapKeys(boardSet)
	if len(boardIDs) > 0 {
		nodeIDs, nodeErr := postgresHuddleNodeIDsForBoardsTx(ctx, tx, companyID, boardIDs)
		if nodeErr != nil {
			return RecycleBinRestoreResult{}, nodeErr
		}
		if err := r.enqueueHuddleActionItemsRealtimeTx(ctx, tx, companyID, boardIDs, nodeIDs); err != nil {
			return RecycleBinRestoreResult{}, err
		}
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

func recyclePayloadUUIDs(rows json.RawMessage, fieldName string) ([]string, error) {
	if len(rows) == 0 || string(rows) == "null" {
		return nil, nil
	}
	var records []map[string]json.RawMessage
	if err := json.Unmarshal(rows, &records); err != nil {
		return nil, err
	}
	seen := make(map[string]bool, len(records))
	for _, record := range records {
		var value string
		if err := json.Unmarshal(record[fieldName], &value); err != nil {
			return nil, err
		}
		value = strings.TrimSpace(value)
		if value != "" {
			seen[value] = true
		}
	}
	return sortedMapKeys(seen), nil
}

func reconcileRestoredAutomaticProcessMapPlacementsTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, actorUserID string,
	folderRows, logicGateRows json.RawMessage,
) ([]DomainEventInput, error) {
	folderIDs, err := recyclePayloadUUIDs(folderRows, "folder_id")
	if err != nil {
		return nil, err
	}
	logicGateIDs, err := recyclePayloadUUIDs(logicGateRows, "logic_gate_id")
	if err != nil {
		return nil, err
	}

	type sourcePlacement struct {
		resourceType string
		resourceID   string
		parentID     string
	}
	placements := make([]sourcePlacement, 0, len(folderIDs)+len(logicGateIDs))
	if len(folderIDs) > 0 {
		rows, err := tx.QueryContext(ctx, `
with recursive selected(folder_id) as (
  select unnest(string_to_array($2, ',')::uuid[])
), ordered(folder_id,parent_folder_id,position,depth,path) as (
  select folder.folder_id,folder.parent_folder_id,folder.position,0,array[folder.folder_id]
  from company_explorer_folders folder
  join selected on selected.folder_id=folder.folder_id
  where folder.company_id=$1::uuid
    and (folder.parent_folder_id is null or not exists (
      select 1 from selected parent where parent.folder_id=folder.parent_folder_id
    ))
  union all
  select child.folder_id,child.parent_folder_id,child.position,parent.depth+1,parent.path||child.folder_id
  from company_explorer_folders child
  join selected on selected.folder_id=child.folder_id
  join ordered parent on parent.folder_id=child.parent_folder_id
  where child.company_id=$1::uuid and not child.folder_id=any(parent.path)
)
select folder_id::text,coalesce(parent_folder_id::text,'')
from ordered
order by depth,position,folder_id`, companyID, strings.Join(folderIDs, ","))
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var placement sourcePlacement
			placement.resourceType = domain.ProcessMapResourceTypeFolder
			if err := rows.Scan(&placement.resourceID, &placement.parentID); err != nil {
				rows.Close()
				return nil, err
			}
			placements = append(placements, placement)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	if len(logicGateIDs) > 0 {
		rows, err := tx.QueryContext(ctx, `
select item.target_id::text,item.parent_folder_id::text
from company_explorer_items item
where item.company_id=$1::uuid and item.target_type='logic_gate'
  and item.target_id=any(string_to_array($2, ',')::uuid[])
order by item.position,item.target_id`, companyID, strings.Join(logicGateIDs, ","))
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var placement sourcePlacement
			placement.resourceType = domain.ProcessMapResourceTypeProcess
			if err := rows.Scan(&placement.resourceID, &placement.parentID); err != nil {
				rows.Close()
				return nil, err
			}
			placements = append(placements, placement)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}

	events := make([]DomainEventInput, 0, len(placements))
	for _, placement := range placements {
		changed, err := postgresSyncAutomaticProcessMapPlacementTx(
			ctx,
			tx,
			companyID,
			placement.resourceType,
			placement.resourceID,
			placement.parentID,
			actorUserID,
		)
		if err != nil {
			return nil, err
		}
		if changed {
			events = append(events, processMapEventInput(
				companyID,
				actorUserID,
				ProcessMapPlacementSavedEvent,
				processMapResourceEventPayload(placement.resourceType, placement.resourceID),
			))
		}
	}
	return events, nil
}

var recycleSnapshotTables = map[string]bool{
	"company_explorer_folders":  true,
	"nodes":                     true,
	"logic_gates":               true,
	"scorecards":                true,
	"projects":                  true,
	"huddle_logic_gates":        true,
	"huddle_nodes":              true,
	"huddle_node_textboxes":     true,
	"huddle_node_textbox_chats": true,
	"kpis":                      true,

	"huddle_logic_gate_relationships":      true,
	"entity_relationships":                 true,
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

	"project_relationships":                  true,
	"project_relationship_projection":        true,
	"node_logic_gate_assignments":            true,
	"process_steps":                          true,
	"process_step_map_layouts":               true,
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

const processMapCleanupChildRecyclePayloadKey = "process_map_cleanup_child_reparents"

var recycleRestoreTableOrder = []string{
	"company_explorer_folders",
	"nodes",
	"logic_gates",
	"process_steps",
	"scorecards",
	"resource_operational_relationships",
	"process_step_map_layouts",
	"process_map_placements",
	"process_map_traces",
	"projects",
	"huddle_logic_gates",
	"huddle_nodes",
	"huddle_node_textboxes",
	"huddle_node_textbox_chats",
	"kpis",
	"huddle_logic_gate_relationships",
	"entity_relationships",
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
	"company_explorer_items",
	"resource_gvic_settings",
	"resource_permission_settings",
	"resource_gvic_assignments",
	"resource_permissions",
	"email_drafts",
	"attachments",
	"attachment_relationships",
	"node_logic_gate_assignments",
	"node_relationships",
	"project_relationships",
	"project_relationship_projection",
	"project_management_timeline_items",
	"project_management_timeline_projection",
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

func postgresRestoreProcessMapCleanupChildrenTx(ctx context.Context, tx *sql.Tx, rows json.RawMessage) error {
	if len(rows) == 0 || string(rows) == "null" || string(rows) == "[]" {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
with cleanup as (
  select *
  from jsonb_to_recordset($1::jsonb) item(
    company_id uuid,
    resource_type text,
    resource_id uuid,
    placement_incarnation_token uuid,
    original_parent_folder_id uuid,
    cleanup_parent_folder_id uuid,
    cleanup_revision bigint,
    created_timestamp timestamptz,
    grid_x integer,
    grid_y integer,
    grid_width integer,
    grid_height integer
  )
)
update process_map_placements placement
set map_parent_folder_id=cleanup.original_parent_folder_id,
    revision=placement.revision+1,
    updated_timestamp=statement_timestamp()
from cleanup
where placement.company_id=cleanup.company_id
  and placement.resource_type=cleanup.resource_type
  and placement.resource_id=cleanup.resource_id
  and placement.placement_incarnation_token=cleanup.placement_incarnation_token
  and placement.map_parent_folder_id is not distinct from cleanup.cleanup_parent_folder_id
  and placement.revision=cleanup.cleanup_revision
  and placement.created_timestamp=cleanup.created_timestamp
  and placement.grid_x=cleanup.grid_x and placement.grid_y=cleanup.grid_y
  and placement.grid_width=cleanup.grid_width and placement.grid_height=cleanup.grid_height
  and exists (
    select 1 from process_map_placements restored_parent
    where restored_parent.company_id=cleanup.company_id
      and restored_parent.resource_type='company_explorer_folder'
      and restored_parent.resource_id=cleanup.original_parent_folder_id
  )`, string(rows))
	return err
}

func postgresRestoreProcessMapPlacementsTx(ctx context.Context, tx *sql.Tx, rows json.RawMessage) error {
	var pending []domain.ProcessMapPlacement
	if err := json.Unmarshal(rows, &pending); err != nil {
		return err
	}
	sort.Slice(pending, func(i, j int) bool {
		if pending[i].ResourceType != pending[j].ResourceType {
			return pending[i].ResourceType < pending[j].ResourceType
		}
		return pending[i].ResourceID < pending[j].ResourceID
	})
	for len(pending) > 0 {
		progress := false
		next := make([]domain.ProcessMapPlacement, 0, len(pending))
		for _, placement := range pending {
			var parentID any
			if placement.MapParentFolderID != nil {
				parentID = *placement.MapParentFolderID
			}
			result, err := tx.ExecContext(ctx, `
insert into process_map_placements(
  company_id,resource_type,resource_id,map_parent_folder_id,
  grid_x,grid_y,grid_width,grid_height,revision,created_timestamp,updated_timestamp
)
select $1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11
where (
    ($2='company_explorer_folder' and exists (
      select 1 from company_explorer_folders folder
      where folder.company_id=$1::uuid and folder.folder_id=$3::uuid
    ))
    or ($2='logic_gate' and exists (
      select 1 from logic_gates process
      where process.company_id=$1::uuid and process.logic_gate_id=$3::uuid
    ))
  )
  and ($4::uuid is null or exists (
    select 1 from process_map_placements parent
    where parent.company_id=$1::uuid
      and parent.resource_type='company_explorer_folder' and parent.resource_id=$4::uuid
  ))
on conflict do nothing`, placement.CompanyID, placement.ResourceType, placement.ResourceID, parentID,
				placement.GridX, placement.GridY, placement.GridWidth, placement.GridHeight, placement.Revision,
				placement.CreatedTimestamp, placement.UpdatedTimestamp)
			if err != nil {
				return err
			}
			affected, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if affected == 1 {
				progress = true
				continue
			}
			var exists bool
			if err := tx.QueryRowContext(ctx, `
select exists (
  select 1 from process_map_placements
  where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid
)`, placement.CompanyID, placement.ResourceType, placement.ResourceID).Scan(&exists); err != nil {
				return err
			}
			if exists {
				progress = true
				continue
			}
			next = append(next, placement)
		}
		if !progress {
			break
		}
		pending = next
	}
	return nil
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
set deleted_timestamp=restored.deleted_timestamp
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
    or
    (restored_row.source_resource_type='process_step' and exists (
      select 1 from process_steps step
      where step.company_id=restored_row.company_id and step.process_step_id=restored_row.source_resource_id
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
    or
    (restored_row.target_resource_type='process_step' and exists (
      select 1 from process_steps step
      where step.company_id=restored_row.company_id and step.process_step_id=restored_row.target_resource_id
    ))
  )
on conflict do nothing`, columnList, strings.Join(qualifiedColumns, ", "))
		_, err := tx.ExecContext(ctx, query, string(rows))
		return err
	}
	if tableName == "process_map_placements" {
		return postgresRestoreProcessMapPlacementsTx(ctx, tx, rows)
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
	if tableName == "node_logic_gate_assignments" {
		selected := make([]string, len(columns))
		for index, column := range columns {
			if column == `"process_step_id"` {
				selected[index] = `case when exists (
  select 1 from process_steps step
  where step.company_id=restored_row.company_id
    and step.logic_gate_id=restored_row.logic_gate_id
    and step.process_step_id=restored_row.process_step_id
) then restored_row.process_step_id else null end`
			} else {
				selected[index] = "restored_row." + column
			}
		}
		selectColumns = strings.Join(selected, ", ")
	}
	if tableName == "scorecards" {
		selected := make([]string, len(columns))
		for index, column := range columns {
			if column == `"rated_by_user_id"` {
				selected[index] = `case when exists (
  select 1 from users where users.user_id=restored_row."rated_by_user_id"
) then restored_row."rated_by_user_id" else null end`
			} else {
				selected[index] = "restored_row." + column
			}
		}
		selectColumns = strings.Join(selected, ", ")
	}
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
	restoredRowFilter := ""
	if tableName == "entity_relationships" {
		restoredRowFilter = `where exists (
  select 1 from entities entity
  where entity.company_id=restored_row.company_id and entity.entity_id=restored_row.entity_id
)`
	}
	query := fmt.Sprintf(`
insert into %s (%s) overriding system value
select %s
from jsonb_populate_recordset(null::%s, coalesce($1::jsonb, '[]'::jsonb)) restored_row
%s
on conflict do nothing`, tableName, columnList, selectColumns, tableName, restoredRowFilter)
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
			if !recycleSnapshotTables[tableName] && tableName != processMapCleanupChildRecyclePayloadKey {
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

func postgresSnapshotProcessMapCleanupChildrenTx(ctx context.Context, tx *sql.Tx, companyID, candidateFolderIDCSV, deletedFolderIDCSV, deletedLogicGateIDCSV string) (json.RawMessage, error) {
	var raw []byte
	err := tx.QueryRowContext(ctx, `
with recursive deleted_folders(folder_id) as (
  select unnest(coalesce(string_to_array(nullif($3,''),',')::uuid[],'{}'::uuid[]))
), candidate_folders(folder_id) as (
  select unnest(coalesce(string_to_array(nullif($2,''),',')::uuid[],'{}'::uuid[]))
), candidate as (
  select child.company_id,child.resource_type,child.resource_id,child.placement_incarnation_token,
         child.map_parent_folder_id original_parent_folder_id,
         child.revision+1 cleanup_revision,child.created_timestamp,
         child.grid_x,child.grid_y,child.grid_width,child.grid_height
  from process_map_placements child
  join candidate_folders candidate_parent on candidate_parent.folder_id=child.map_parent_folder_id
  where child.company_id=$1::uuid
    and not (child.resource_type='company_explorer_folder'
      and child.resource_id=any(coalesce(string_to_array(nullif($3,''),',')::uuid[],'{}'::uuid[])))
    and not (child.resource_type='logic_gate'
      and child.resource_id=any(coalesce(string_to_array(nullif($4,''),',')::uuid[],'{}'::uuid[])))
), climb as (
  select candidate.*,parent.map_parent_folder_id cleanup_parent_folder_id,1 depth
  from candidate
  join process_map_placements parent
    on parent.company_id=candidate.company_id
   and parent.resource_type='company_explorer_folder'
   and parent.resource_id=candidate.original_parent_folder_id
  union all
  select climb.company_id,climb.resource_type,climb.resource_id,climb.placement_incarnation_token,
         climb.original_parent_folder_id,climb.cleanup_revision,climb.created_timestamp,
         climb.grid_x,climb.grid_y,climb.grid_width,climb.grid_height,
         parent.map_parent_folder_id,climb.depth+1
  from climb
  join deleted_folders deleted on deleted.folder_id=climb.cleanup_parent_folder_id
  join process_map_placements parent
    on parent.company_id=climb.company_id
   and parent.resource_type='company_explorer_folder'
   and parent.resource_id=climb.cleanup_parent_folder_id
), terminal as (
  select climb.*
  from climb
  where climb.cleanup_parent_folder_id is null
     or not exists(select 1 from deleted_folders deleted where deleted.folder_id=climb.cleanup_parent_folder_id)
)
select coalesce(jsonb_agg(jsonb_build_object(
  'company_id',company_id,
  'resource_type',resource_type,
  'resource_id',resource_id,
  'placement_incarnation_token',placement_incarnation_token,
  'original_parent_folder_id',original_parent_folder_id,
  'cleanup_parent_folder_id',cleanup_parent_folder_id,
  'cleanup_revision',cleanup_revision,
  'created_timestamp',created_timestamp,
  'grid_x',grid_x,'grid_y',grid_y,'grid_width',grid_width,'grid_height',grid_height
) order by resource_type,resource_id),'[]'::jsonb)
from terminal`, companyID, candidateFolderIDCSV, deletedFolderIDCSV, deletedLogicGateIDCSV).Scan(&raw)
	return raw, err
}

func postgresSnapshotRecyclePayloadWithCacheTx(ctx context.Context, tx *sql.Tx, cache *recycleSnapshotCache, companyID string, scope companyExplorerRecycleScope) (json.RawMessage, error) {
	return postgresSnapshotRecyclePayloadWithCleanupScopeTx(ctx, tx, cache, companyID, scope, scope)
}

func postgresSnapshotRecyclePayloadWithCleanupScopeTx(ctx context.Context, tx *sql.Tx, cache *recycleSnapshotCache, companyID string, scope, cleanupScope companyExplorerRecycleScope) (json.RawMessage, error) {
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
	folderIDCSV := strings.Join(folderIDs, ",")
	nodeIDCSV := strings.Join(nodeIDs, ",")
	logicGateIDCSV := strings.Join(logicGateIDs, ",")
	projectIDCSV := strings.Join(projectIDs, ",")
	cleanupFolderIDCSV := strings.Join(sortedMapKeys(cleanupScope.FolderIDs), ",")
	cleanupLogicGateIDCSV := strings.Join(sortedMapKeys(cleanupScope.LogicGateIDs), ",")
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
		for _, tableName := range []string{"logic_gates", "process_steps", "process_step_map_layouts", "scorecards", "logic_gate_textboxes", "logic_gate_textboxes_history"} {
			if err := addTable(tableName, `company_id=$1::uuid and logic_gate_id = any(string_to_array($2, ',')::uuid[])`, companyID, logicGateIDCSV); err != nil {
				return nil, err
			}
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
		cleanupChildren, err := postgresSnapshotProcessMapCleanupChildrenTx(ctx, tx, companyID, folderIDCSV, cleanupFolderIDCSV, cleanupLogicGateIDCSV)
		if err != nil {
			return nil, err
		}
		if len(cleanupChildren) > 0 && string(cleanupChildren) != "[]" {
			payload[processMapCleanupChildRecyclePayloadKey] = cleanupChildren
		}

		relationshipWhere := `company_id=$1::uuid and (` +
			`(source_resource_type='company_explorer_folder' and source_resource_id = any(` + folderIDArray + `)) or ` +
			`(target_resource_type='company_explorer_folder' and target_resource_id = any(` + folderIDArray + `)) or ` +
			`(source_resource_type='logic_gate' and source_resource_id = any(` + logicGateIDArray + `)) or ` +
			`(target_resource_type='logic_gate' and target_resource_id = any(` + logicGateIDArray + `)) or ` +
			`(source_resource_type='process_step' and source_resource_id in (select process_step_id from process_steps where company_id=$1::uuid and logic_gate_id = any(` + logicGateIDArray + `))) or ` +
			`(target_resource_type='process_step' and target_resource_id in (select process_step_id from process_steps where company_id=$1::uuid and logic_gate_id = any(` + logicGateIDArray + `))))`
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
			if err := addTable("project_management_timeline_items", assignmentWhere, assignmentArgs...); err != nil {
				return nil, err
			}
			if err := addTable("project_management_timeline_projection", assignmentWhere, assignmentArgs...); err != nil {
				return nil, err
			}
		}
	}
	if len(folderIDs) > 0 || len(nodeIDs) > 0 || len(logicGateIDs) > 0 || len(projectIDs) > 0 {
		itemWhere, itemArgs := recycleFolderItemsWhere(companyID, folderIDs, nodeIDs, logicGateIDs, projectIDs)
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

func recycleFolderItemsWhere(companyID string, folderIDs, nodeIDs, logicGateIDs, projectIDs []string) (string, []any) {
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
	cleanupScope := newCompanyExplorerRecycleScope()
	for _, root := range roots {
		root.Scope.mergeInto(&cleanupScope)
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
		payload, err := postgresSnapshotRecyclePayloadWithCleanupScopeTx(ctx, tx, snapshotCache, companyID, root.Scope, cleanupScope)
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
		before := len(scope.FolderIDs) + len(scope.NodeIDs) + len(scope.LogicGateIDs) + len(scope.ProjectIDs)
		if err := postgresAddFolderScopeItemsTx(ctx, tx, companyID, scope); err != nil {
			return err
		}
		if err := postgresAddLogicGateScopeItemsTx(ctx, tx, companyID, scope); err != nil {
			return err
		}
		after := len(scope.FolderIDs) + len(scope.NodeIDs) + len(scope.LogicGateIDs) + len(scope.ProjectIDs)
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
	default:
		return "", ErrInvalid
	}
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return label, err
}
