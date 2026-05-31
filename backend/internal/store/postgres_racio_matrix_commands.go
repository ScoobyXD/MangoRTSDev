package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) CreateRacioMatrixNode(input RacioMatrixNodeCreateInput) (RacioMatrixNodeCreateResult, error) {
	input, err := NormalizeRacioMatrixNodeCreateInput(input)
	if err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}
	defer tx.Rollback()

	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	result := RacioMatrixNodeCreateResult{}
	logicGateID := input.LogicGateID
	if input.CreateLogicGateHeader != "" {
		logicGate, folderItem, err := createRacioMatrixLogicGateTx(ctx, tx, input)
		if err != nil {
			return RacioMatrixNodeCreateResult{}, err
		}
		logicGateID = logicGate.LogicGateID
		result.LogicGate = &logicGate
		result.FolderItems = append(result.FolderItems, folderItem)
		events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{
			folderItemAssignedWorkspaceEventInput(folderItem, meta),
			logicGateCreatedWorkspaceEventInput(logicGate, meta),
		})
		if err != nil {
			return RacioMatrixNodeCreateResult{}, err
		}
		result.Events = append(result.Events, events...)
	}

	if logicGateID != "" {
		assignmentResult, err := r.assignNodeToLogicGateStatusTx(ctx, tx, LogicGateNodeAssignmentInput{
			CompanyID:           input.CompanyID,
			LogicGateID:         logicGateID,
			NodeID:              input.NodeID,
			Status:              input.Status,
			ColumnID:            input.ColumnID,
			NodeTitle:           input.Title,
			CreateNodeTitle:     input.Title,
			DescriptionSnapshot: input.DescriptionSnapshot,
			Position:            input.Position,
			Priority:            input.Priority,
			PrioritySet:         input.PrioritySet,
			IsIssue:             input.IsIssue,
			IsIssueSet:          input.IsIssueSet,
			AssigneePolicy:      input.AssigneePolicy,
			ActorUserID:         input.ActorUserID,
			IdempotencyKey:      input.IdempotencyKey,
		})
		if err != nil {
			return RacioMatrixNodeCreateResult{}, err
		}
		assignment := assignmentResult.Assignment
		card := assignmentResult.Card
		result.Node = assignmentResult.Node
		result.Assignment = &assignment
		result.Card = &card
		result.Events = append(result.Events, assignmentResult.Events...)
		result.RacioProjectionRows = assignmentResult.RacioProjectionRows
		if result.LogicGate != nil {
			rows, err := postgresRacioProjectionRowsForResourcesTx(ctx, tx, input.CompanyID, []string{input.NodeID}, []string{logicGateID})
			if err != nil {
				return RacioMatrixNodeCreateResult{}, err
			}
			result.RacioProjectionRows = rows
		}
		if err := tx.Commit(); err != nil {
			return RacioMatrixNodeCreateResult{}, err
		}
		return result, nil
	}

	node, err := r.createNodeWithAssigneeIDTx(ctx, tx, input.CompanyID, input.NodeID, input.Title, input.ActorUserID)
	if err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}
	folderItem, err := postgresCompanyExplorerFolderItemForEntityTx(ctx, tx, input.CompanyID, "node", node.NodeID)
	if err == nil {
		result.FolderItems = append(result.FolderItems, folderItem)
	} else if !errors.Is(err, ErrNotFound) {
		return RacioMatrixNodeCreateResult{}, err
	}
	rows, err := postgresRacioProjectionRowsForResourcesTx(ctx, tx, input.CompanyID, []string{node.NodeID}, nil)
	if err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}
	event, err := r.appendDomainEventTx(ctx, tx, nodeCreatedWorkspaceEventInputWithMetadata(node, meta))
	if err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}
	result.Node = node
	result.RacioProjectionRows = rows
	result.Events = append(result.Events, event)
	if err := tx.Commit(); err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}
	return result, nil
}

func createRacioMatrixLogicGateTx(ctx context.Context, tx *sql.Tx, input RacioMatrixNodeCreateInput) (domain.LogicGate, domain.CompanyExplorerFolderItem, error) {
	created := domain.LogicGate{
		CompanyID:     input.CompanyID,
		LogicGateID:   newUUIDv7String(),
		Header:        input.CreateLogicGateHeader,
		DefaultAccess: ResourceDefaultAccessEdit,
	}
	if err := tx.QueryRowContext(ctx,
		`insert into logic_gates (company_id, logic_gate_id, header, created_timestamp)
		 values ($1, $2, $3, now())
		 returning company_id, logic_gate_id, header, created_timestamp`,
		created.CompanyID, created.LogicGateID, created.Header,
	).Scan(&created.CompanyID, &created.LogicGateID, &created.Header, &created.CreatedTimestamp); err != nil {
		return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, err
	}
	if err := ensureLogicGateKanbanBoardSQL(ctx, tx, input.CompanyID, created.LogicGateID, created.Header); err != nil {
		return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, err
	}
	if input.ActorUserID != "" && input.CreatorLogicGateRaciRole != "" {
		assignee, err := loadPostgresNodeAssigneeReadModel(ctx, tx, input.CompanyID, input.ActorUserID)
		if err != nil {
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, err
		}
		assignment := domain.LogicGateRaciAssignment{
			CompanyID:   input.CompanyID,
			LogicGateID: created.LogicGateID,
			Role:        input.CreatorLogicGateRaciRole,
			UserID:      assignee.UserID,
		}
		if err := tx.QueryRowContext(ctx, `
insert into logic_gate_raci_assignments
  (company_id, logic_gate_id, role, user_id, created_timestamp)
values ($1, $2, $3, $4, now())
on conflict (company_id, logic_gate_id, role, user_id) do update set
  created_timestamp=logic_gate_raci_assignments.created_timestamp
returning company_id, logic_gate_id, role::text, user_id::text, created_timestamp`,
			input.CompanyID, created.LogicGateID, input.CreatorLogicGateRaciRole, assignee.UserID,
		).Scan(&assignment.CompanyID, &assignment.LogicGateID, &assignment.Role, &assignment.UserID, &assignment.CreatedTimestamp); err != nil {
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, err
		}
		if assignee.Name != nil {
			assignment.UserDisplayName = strings.TrimSpace(*assignee.Name)
		}
		if assignee.Email != nil {
			assignment.UserEmail = strings.TrimSpace(*assignee.Email)
		}
		created.RaciAssignments = []domain.LogicGateRaciAssignment{assignment}
		if err := syncPostgresRacioProjectionForLogicGateAssignmentsTx(ctx, tx, input.CompanyID, created.LogicGateID, nil, created.RaciAssignments); err != nil {
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, err
		}
		created.EffectiveAccess = EntityPermissionEdit
	}
	activeFolder, err := ensureCompanyExplorerSystemFolderSQL(ctx, tx, input.CompanyID, CompanyExplorerSystemActiveLogicGatesKey)
	if err != nil {
		return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, err
	}
	folderItem, _, err := assignCompanyExplorerFolderItemSQL(ctx, tx, input.CompanyID, activeFolder.FolderID, "logic_gate", created.LogicGateID, 0)
	if err != nil {
		return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, err
	}
	return created, folderItem, nil
}

func postgresCompanyExplorerFolderItemForEntityTx(ctx context.Context, tx *sql.Tx, companyID, itemType, itemID string) (domain.CompanyExplorerFolderItem, error) {
	var item domain.CompanyExplorerFolderItem
	if err := tx.QueryRowContext(ctx, `
select company_id, folder_id, item_type, item_id, position, created_timestamp, updated_timestamp
from company_explorer_folder_items
where company_id=$1 and item_type=$2 and item_id=$3`,
		companyID, itemType, itemID,
	).Scan(
		&item.CompanyID,
		&item.FolderID,
		&item.ItemType,
		&item.ItemID,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyExplorerFolderItem{}, ErrNotFound
	} else if err != nil {
		return domain.CompanyExplorerFolderItem{}, err
	}
	return item, nil
}
