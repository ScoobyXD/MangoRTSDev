package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) GetWorkspaceDerivedDomainEventCheckpoint(companyID string) (NotificationDomainEventCheckpoint, bool, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return NotificationDomainEventCheckpoint{}, false, ErrInvalid
	}
	var checkpoint NotificationDomainEventCheckpoint
	err := r.db.QueryRowContext(context.Background(), `
select company_id::text, checkpoint_timestamp, checkpoint_event_id::text
from workspace_derived_domain_event_projection_checkpoints
where company_id=$1::uuid`, companyID).Scan(&checkpoint.CompanyID, &checkpoint.CreatedTimestamp, &checkpoint.EventID)
	if errors.Is(err, sql.ErrNoRows) {
		return NotificationDomainEventCheckpoint{}, false, nil
	}
	if err != nil {
		if isPostgresUndefinedTable(err, "workspace_derived_domain_event_projection_checkpoints") {
			return NotificationDomainEventCheckpoint{}, false, nil
		}
		return NotificationDomainEventCheckpoint{}, false, err
	}
	return checkpoint, true, nil
}

func (r *PostgresRepo) SaveWorkspaceDerivedDomainEventCheckpoint(checkpoint NotificationDomainEventCheckpoint) error {
	checkpoint.CompanyID = strings.TrimSpace(checkpoint.CompanyID)
	checkpoint.EventID = strings.TrimSpace(checkpoint.EventID)
	if checkpoint.CompanyID == "" {
		return ErrInvalid
	}
	_, err := r.db.ExecContext(context.Background(), `
insert into workspace_derived_domain_event_projection_checkpoints (
  company_id, checkpoint_timestamp, checkpoint_event_id, updated_timestamp
) values ($1::uuid, $2, nullif($3, '')::uuid, now())
on conflict (company_id) do update set
  checkpoint_timestamp=excluded.checkpoint_timestamp,
  checkpoint_event_id=excluded.checkpoint_event_id,
  updated_timestamp=now()
where excluded.checkpoint_timestamp > workspace_derived_domain_event_projection_checkpoints.checkpoint_timestamp
   or (
     excluded.checkpoint_timestamp = workspace_derived_domain_event_projection_checkpoints.checkpoint_timestamp
     and excluded.checkpoint_event_id::text > workspace_derived_domain_event_projection_checkpoints.checkpoint_event_id::text
   )`,
		checkpoint.CompanyID, checkpoint.CreatedTimestamp, checkpoint.EventID)
	return err
}

func (r *PostgresRepo) ProjectWorkspaceDerivedDomainEvent(event domain.DomainEvent) ([]domain.DomainEvent, error) {
	switch strings.TrimSpace(event.Type) {
	case WorkspaceDerivedProjectionRequestedEventType:
		return r.projectWorkspaceDerivedProjectionRequested(event)
	case WorkspaceDeferredFolderItemAssignEventType:
		task := workspaceDerivedPayloadCopy(event.Payload)
		task["kind"] = WorkspaceDerivedTaskCompanyExplorerFolderItemAssign
		return r.projectWorkspaceDerivedTasks(event, []map[string]any{task})
	case WorkspaceDeferredNodeMapPositionUpsertEventType:
		task := workspaceDerivedPayloadCopy(event.Payload)
		task["kind"] = WorkspaceDerivedTaskNodeMapPositionUpsert
		return r.projectWorkspaceDerivedTasks(event, []map[string]any{task})
	case WorkspaceDeferredLogicMapPositionUpsertEventType:
		task := workspaceDerivedPayloadCopy(event.Payload)
		task["kind"] = WorkspaceDerivedTaskLogicGateMapPositionUpsert
		return r.projectWorkspaceDerivedTasks(event, []map[string]any{task})
	default:
		return nil, nil
	}
}

func (r *PostgresRepo) projectWorkspaceDerivedProjectionRequested(event domain.DomainEvent) ([]domain.DomainEvent, error) {
	return r.projectWorkspaceDerivedTasks(event, workspaceDerivedPayloadTasks(event.Payload))
}

func (r *PostgresRepo) projectWorkspaceDerivedTasks(event domain.DomainEvent, tasks []map[string]any) ([]domain.DomainEvent, error) {
	if len(tasks) == 0 {
		return nil, nil
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	projected := make([]domain.DomainEvent, 0, len(tasks))
	for index, task := range tasks {
		var eventInput *DomainEventInput
		switch workspaceDerivedPayloadString(task, "kind") {
		case WorkspaceDerivedTaskCompanyExplorerFolderItemAssign:
			eventInput, err = r.projectDeferredCompanyExplorerFolderItemTx(ctx, tx, event, task, index)
		case WorkspaceDerivedTaskNodeMapPositionUpsert:
			eventInput, err = r.projectDeferredNodeMapPositionTx(ctx, tx, event, task, index)
		case WorkspaceDerivedTaskLogicGateMapPositionUpsert:
			eventInput, err = r.projectDeferredLogicGateMapPositionTx(ctx, tx, event, task, index)
		default:
			err = ErrInvalid
		}
		if err != nil {
			return nil, err
		}
		if eventInput == nil {
			continue
		}
		appended, err := r.appendDomainEventTx(ctx, tx, *eventInput)
		if err != nil {
			return nil, err
		}
		projected = append(projected, appended)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return projected, nil
}

func (r *PostgresRepo) projectDeferredCompanyExplorerFolderItemTx(ctx context.Context, tx *sql.Tx, event domain.DomainEvent, payload map[string]any, index int) (*DomainEventInput, error) {
	companyID := strings.TrimSpace(event.CompanyID)
	itemType := workspaceDerivedPayloadString(payload, "item_type")
	itemID := workspaceDerivedPayloadString(payload, "item_id")
	folderID := workspaceDerivedPayloadString(payload, "folder_id")
	systemFolderKey := workspaceDerivedPayloadString(payload, "system_folder_key")
	position := workspaceDerivedPayloadInt(payload, "position")
	if companyID == "" || itemType == "" || itemID == "" {
		return nil, ErrInvalid
	}
	if itemType != "node" && itemType != "logic_gate" {
		return nil, ErrInvalid
	}
	if folderID == "" && systemFolderKey == "" {
		switch itemType {
		case "node":
			systemFolderKey = CompanyExplorerSystemActiveNodesKey
		case "logic_gate":
			systemFolderKey = CompanyExplorerSystemActiveLogicGatesKey
		default:
			return nil, ErrInvalid
		}
	}

	if folderID == "" {
		folder, err := ensureCompanyExplorerSystemFolderSQL(ctx, tx, companyID, systemFolderKey)
		if err != nil {
			return nil, err
		}
		folderID = folder.FolderID
	}
	item, inserted, err := insertMissingCompanyExplorerFolderItemSQL(ctx, tx, companyID, folderID, itemType, itemID, position)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if !inserted {
		return nil, nil
	}
	meta := workItemAssignmentEventMetadataFromValues(workspaceDerivedEventActor(event), "")
	eventInput := folderItemAssignedWorkspaceEventInput(item, meta)
	eventInput.IdempotencyKey = workspaceDerivedTaskIdempotencyKey(event, index, "folder-item")
	return &eventInput, nil
}

func (r *PostgresRepo) projectDeferredNodeMapPositionTx(ctx context.Context, tx *sql.Tx, event domain.DomainEvent, payload map[string]any, index int) (*DomainEventInput, error) {
	companyID := strings.TrimSpace(event.CompanyID)
	nodeID := workspaceDerivedPayloadString(payload, "node_id")
	x, xOK := workspaceDerivedPayloadFloat(payload, "x")
	y, yOK := workspaceDerivedPayloadFloat(payload, "y")
	if companyID == "" || nodeID == "" || !xOK || !yOK {
		return nil, ErrInvalid
	}

	var position domain.NodeMapPosition
	err := tx.QueryRowContext(ctx, `
insert into node_map_positions (company_id, node_id, x, y, updated_timestamp)
select $1::uuid, $2::uuid, $3, $4, now()
where exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)
on conflict (company_id, node_id) do nothing
returning company_id::text, node_id::text, x, y, updated_timestamp`,
		companyID, nodeID, x, y,
	).Scan(&position.CompanyID, &position.NodeID, &position.X, &position.Y, &position.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	eventInput := workspaceDomainEventInput(companyID, "node_map_positions_updated", map[string]any{"positions": []domain.NodeMapPosition{position}})
	eventInput.ActorUserID = workspaceDerivedEventActor(event)
	eventInput.IdempotencyKey = workspaceDerivedTaskIdempotencyKey(event, index, "node-map-position")
	return &eventInput, nil
}

func (r *PostgresRepo) projectDeferredLogicGateMapPositionTx(ctx context.Context, tx *sql.Tx, event domain.DomainEvent, payload map[string]any, index int) (*DomainEventInput, error) {
	companyID := strings.TrimSpace(event.CompanyID)
	logicGateID := workspaceDerivedPayloadString(payload, "logic_gate_id")
	x, xOK := workspaceDerivedPayloadFloat(payload, "x")
	y, yOK := workspaceDerivedPayloadFloat(payload, "y")
	if companyID == "" || logicGateID == "" || !xOK || !yOK {
		return nil, ErrInvalid
	}

	var position domain.LogicGateMapPosition
	err := tx.QueryRowContext(ctx, `
insert into logic_gate_map_positions (company_id, logic_gate_id, x, y, updated_timestamp)
select $1::uuid, $2::uuid, $3, $4, now()
where exists(select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid)
on conflict (company_id, logic_gate_id) do nothing
returning company_id::text, logic_gate_id::text, x, y, updated_timestamp`,
		companyID, logicGateID, x, y,
	).Scan(&position.CompanyID, &position.LogicGateID, &position.X, &position.Y, &position.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	eventInput := workspaceDomainEventInput(companyID, "logic_gate_map_positions_updated", map[string]any{"positions": []domain.LogicGateMapPosition{position}})
	eventInput.ActorUserID = workspaceDerivedEventActor(event)
	eventInput.IdempotencyKey = workspaceDerivedTaskIdempotencyKey(event, index, "logic-gate-map-position")
	return &eventInput, nil
}

func workspaceDerivedEventActor(event domain.DomainEvent) string {
	if event.ActorUserID == nil {
		return ""
	}
	return strings.TrimSpace(*event.ActorUserID)
}

func workspaceDerivedEventIdempotencyKey(event domain.DomainEvent, suffix string) string {
	return fmt.Sprintf("workspace-derived:%s:%s", strings.TrimSpace(event.EventID), suffix)
}

func workspaceDerivedTaskIdempotencyKey(event domain.DomainEvent, index int, suffix string) string {
	if index <= 0 {
		return workspaceDerivedEventIdempotencyKey(event, suffix)
	}
	return workspaceDerivedEventIdempotencyKey(event, fmt.Sprintf("%s-%d", suffix, index))
}

func insertMissingCompanyExplorerFolderItemSQL(ctx context.Context, tx *sql.Tx, companyID, folderID, itemType, itemID string, position int) (domain.CompanyExplorerFolderItem, bool, error) {
	var err error
	var folderKind string
	if err := tx.QueryRowContext(ctx,
		`select folder_kind
		 from company_explorer_folders
		 where company_id=$1 and folder_id=$2`,
		companyID, folderID,
	).Scan(&folderKind); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolderItem{}, false, ErrNotFound
		}
		return domain.CompanyExplorerFolderItem{}, false, err
	}
	var exists bool
	var existsQuery string
	if itemType == "node" {
		existsQuery = `select exists(select 1 from nodes where company_id=$1 and node_id=$2)`
	} else if itemType == "logic_gate" {
		existsQuery = `select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`
	} else {
		return domain.CompanyExplorerFolderItem{}, false, ErrNotFound
	}
	if err := tx.QueryRowContext(ctx, existsQuery, companyID, itemID).Scan(&exists); err != nil {
		return domain.CompanyExplorerFolderItem{}, false, err
	}
	if !exists {
		return domain.CompanyExplorerFolderItem{}, false, ErrNotFound
	}
	if position <= 0 {
		position, err = nextCompanyExplorerSQLRowPosition(ctx, tx, companyID, folderKind, folderID)
		if err != nil {
			return domain.CompanyExplorerFolderItem{}, false, err
		}
	}

	var item domain.CompanyExplorerFolderItem
	if err := tx.QueryRowContext(ctx,
		`insert into company_explorer_folder_items
		 (company_id, folder_id, item_type, item_id, position, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, $5, now(), now())
		 on conflict (company_id, item_type, item_id) do nothing
		 returning company_id, folder_id, item_type, item_id, position, created_timestamp, updated_timestamp`,
		companyID, folderID, itemType, itemID, position,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&item.ItemType,
		&item.ItemID,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CompanyExplorerFolderItem{}, false, nil
		}
		return domain.CompanyExplorerFolderItem{}, false, err
	}
	return item, true, nil
}

func workspaceDerivedPayloadCopy(payload map[string]any) map[string]any {
	copied := make(map[string]any, len(payload)+1)
	for key, value := range payload {
		copied[key] = value
	}
	return copied
}

func workspaceDerivedPayloadTasks(payload map[string]any) []map[string]any {
	if payload == nil {
		return nil
	}
	switch tasks := payload["tasks"].(type) {
	case []map[string]any:
		out := make([]map[string]any, 0, len(tasks))
		for _, task := range tasks {
			if len(task) > 0 {
				out = append(out, task)
			}
		}
		return out
	case []WorkspaceDerivedProjectionTask:
		out := make([]map[string]any, 0, len(tasks))
		for _, task := range tasks {
			if len(task) > 0 {
				out = append(out, map[string]any(task))
			}
		}
		return out
	case []any:
		out := make([]map[string]any, 0, len(tasks))
		for _, raw := range tasks {
			switch task := raw.(type) {
			case map[string]any:
				if len(task) > 0 {
					out = append(out, task)
				}
			case WorkspaceDerivedProjectionTask:
				if len(task) > 0 {
					out = append(out, map[string]any(task))
				}
			}
		}
		return out
	default:
		return nil
	}
}

func workspaceDerivedPayloadString(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	value, ok := payload[key]
	if !ok || value == nil {
		return ""
	}
	switch value := value.(type) {
	case string:
		return strings.TrimSpace(value)
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func workspaceDerivedPayloadInt(payload map[string]any, key string) int {
	if payload == nil {
		return 0
	}
	switch value := payload[key].(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	default:
		return 0
	}
}

func workspaceDerivedPayloadFloat(payload map[string]any, key string) (float64, bool) {
	if payload == nil {
		return 0, false
	}
	switch value := payload[key].(type) {
	case float64:
		return value, true
	case float32:
		return float64(value), true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	default:
		return 0, false
	}
}
