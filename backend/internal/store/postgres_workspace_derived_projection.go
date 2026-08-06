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
	position := workspaceDerivedPayloadInt(payload, "position")
	if companyID == "" || itemType == "" || itemID == "" {
		return nil, ErrInvalid
	}
	if itemType != EntityTypeLogicGate {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return nil, nil
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
	eventInput := workspaceDomainEventInput(companyID, "company_explorer_item_placed", map[string]any{
		"parent_entity_id": item.FolderID,
		"target_type":      item.ItemType,
		"target_id":        item.ItemID,
		"folder_item":      item,
	})
	eventInput.ActorUserID = workspaceDerivedEventActor(event)
	eventInput.IdempotencyKey = workspaceDerivedTaskIdempotencyKey(event, index, "folder-item")
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
	var folderExists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid)`,
		companyID, folderID,
	).Scan(&folderExists); err != nil {
		return domain.CompanyExplorerFolderItem{}, false, err
	}
	if !folderExists {
		return domain.CompanyExplorerFolderItem{}, false, ErrNotFound
	}
	var exists bool
	if itemType != EntityTypeLogicGate {
		return domain.CompanyExplorerFolderItem{}, false, ErrNotFound
	}
	existsQuery := `select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`
	if err := tx.QueryRowContext(ctx, existsQuery, companyID, itemID).Scan(&exists); err != nil {
		return domain.CompanyExplorerFolderItem{}, false, err
	}
	if !exists {
		return domain.CompanyExplorerFolderItem{}, false, ErrNotFound
	}
	if position <= 0 {
		position, err = nextCompanyExplorerSQLRowPosition(ctx, tx, companyID, itemType, folderID)
		if err != nil {
			return domain.CompanyExplorerFolderItem{}, false, err
		}
	}

	var item domain.CompanyExplorerFolderItem
	if err := tx.QueryRowContext(ctx,
		`insert into company_explorer_items
		 (company_id, item_id, parent_folder_id, target_type, target_id, position, created_timestamp, updated_timestamp)
		 values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, now(), now())
		 on conflict (company_id, target_type, target_id) do nothing
		 returning company_id::text, coalesce(parent_folder_id::text, '') as folder_id, target_type, target_id::text, position, created_timestamp, updated_timestamp`,
		companyID, newUUIDv7String(), folderID, itemType, itemID, position,
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
