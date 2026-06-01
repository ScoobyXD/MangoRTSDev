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
	case WorkspaceDeferredFolderItemAssignEventType:
		return r.projectDeferredCompanyExplorerFolderItem(event)
	case WorkspaceDeferredNodeMapPositionUpsertEventType:
		return r.projectDeferredNodeMapPosition(event)
	case WorkspaceDeferredLogicMapPositionUpsertEventType:
		return r.projectDeferredLogicGateMapPosition(event)
	default:
		return nil, nil
	}
}

func (r *PostgresRepo) projectDeferredCompanyExplorerFolderItem(event domain.DomainEvent) ([]domain.DomainEvent, error) {
	companyID := strings.TrimSpace(event.CompanyID)
	itemType := workspaceDerivedPayloadString(event.Payload, "item_type")
	itemID := workspaceDerivedPayloadString(event.Payload, "item_id")
	folderID := workspaceDerivedPayloadString(event.Payload, "folder_id")
	systemFolderKey := workspaceDerivedPayloadString(event.Payload, "system_folder_key")
	position := workspaceDerivedPayloadInt(event.Payload, "position")
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

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if folderID == "" {
		folder, err := ensureCompanyExplorerSystemFolderSQL(ctx, tx, companyID, systemFolderKey)
		if err != nil {
			return nil, err
		}
		folderID = folder.FolderID
	}
	item, _, err := assignCompanyExplorerFolderItemSQL(ctx, tx, companyID, folderID, itemType, itemID, position)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	meta := workItemAssignmentEventMetadataFromValues(workspaceDerivedEventActor(event), "")
	eventInput := folderItemAssignedWorkspaceEventInput(item, meta)
	eventInput.IdempotencyKey = workspaceDerivedEventIdempotencyKey(event, "folder-item")
	projected, err := r.appendDomainEventTx(ctx, tx, eventInput)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return []domain.DomainEvent{projected}, nil
}

func (r *PostgresRepo) projectDeferredNodeMapPosition(event domain.DomainEvent) ([]domain.DomainEvent, error) {
	companyID := strings.TrimSpace(event.CompanyID)
	nodeID := workspaceDerivedPayloadString(event.Payload, "node_id")
	x, xOK := workspaceDerivedPayloadFloat(event.Payload, "x")
	y, yOK := workspaceDerivedPayloadFloat(event.Payload, "y")
	if companyID == "" || nodeID == "" || !xOK || !yOK {
		return nil, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var position domain.NodeMapPosition
	err = tx.QueryRowContext(ctx, `
insert into node_map_positions (company_id, node_id, x, y, updated_timestamp)
select $1::uuid, $2::uuid, $3, $4, now()
where exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)
on conflict (company_id, node_id) do nothing
returning company_id::text, node_id::text, x, y, updated_timestamp`,
		companyID, nodeID, x, y,
	).Scan(&position.CompanyID, &position.NodeID, &position.X, &position.Y, &position.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	eventInput := workspaceDomainEventInput(companyID, "node_map_positions_updated", map[string]any{"positions": []domain.NodeMapPosition{position}})
	eventInput.ActorUserID = workspaceDerivedEventActor(event)
	eventInput.IdempotencyKey = workspaceDerivedEventIdempotencyKey(event, "node-map-position")
	projected, err := r.appendDomainEventTx(ctx, tx, eventInput)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return []domain.DomainEvent{projected}, nil
}

func (r *PostgresRepo) projectDeferredLogicGateMapPosition(event domain.DomainEvent) ([]domain.DomainEvent, error) {
	companyID := strings.TrimSpace(event.CompanyID)
	logicGateID := workspaceDerivedPayloadString(event.Payload, "logic_gate_id")
	x, xOK := workspaceDerivedPayloadFloat(event.Payload, "x")
	y, yOK := workspaceDerivedPayloadFloat(event.Payload, "y")
	if companyID == "" || logicGateID == "" || !xOK || !yOK {
		return nil, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var position domain.LogicGateMapPosition
	err = tx.QueryRowContext(ctx, `
insert into logic_gate_map_positions (company_id, logic_gate_id, x, y, updated_timestamp)
select $1::uuid, $2::uuid, $3, $4, now()
where exists(select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid)
on conflict (company_id, logic_gate_id) do nothing
returning company_id::text, logic_gate_id::text, x, y, updated_timestamp`,
		companyID, logicGateID, x, y,
	).Scan(&position.CompanyID, &position.LogicGateID, &position.X, &position.Y, &position.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	eventInput := workspaceDomainEventInput(companyID, "logic_gate_map_positions_updated", map[string]any{"positions": []domain.LogicGateMapPosition{position}})
	eventInput.ActorUserID = workspaceDerivedEventActor(event)
	eventInput.IdempotencyKey = workspaceDerivedEventIdempotencyKey(event, "logic-gate-map-position")
	projected, err := r.appendDomainEventTx(ctx, tx, eventInput)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return []domain.DomainEvent{projected}, nil
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
