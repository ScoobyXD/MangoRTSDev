package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) CreateRacioMatrixNode(input RacioMatrixNodeCreateInput) (RacioMatrixNodeCreateResult, error) {
	ctx := ContextWithTimingRecorder(context.Background(), input.TimingRecorder)
	stop := observeTiming(ctx, "repo.CreateRacioMatrixNode.normalize_input")
	input, err := NormalizeRacioMatrixNodeCreateInput(input)
	stop()
	if err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}

	defer observeTiming(ctx, "repo.CreateRacioMatrixNode.transaction")()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}
	defer tx.Rollback()

	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	result := RacioMatrixNodeCreateResult{}
	ownedProjectionDeltas := []ProjectionDelta{}
	logicGateID := input.LogicGateID
	deferCompanyExplorerFolderItems := input.MutationOrigin == MutationOriginMatrix || input.MutationOrigin == MutationOriginKanban
	if input.CreateLogicGateHeader != "" {
		stop := observeTiming(ctx, "repo.CreateRacioMatrixNode.logic_gate_writes")
		logicGate, folderItem, deltas, err := createRacioMatrixLogicGateTx(ctx, tx, input, !deferCompanyExplorerFolderItems)
		stop()
		if err != nil {
			return RacioMatrixNodeCreateResult{}, err
		}
		logicGateID = logicGate.LogicGateID
		result.LogicGate = &logicGate
		result.ProjectionDeltas = append(result.ProjectionDeltas, deltas...)
		ownedProjectionDeltas = append(ownedProjectionDeltas, deltas...)
		eventInputs := []DomainEventInput{logicGateCreatedWorkspaceEventInput(logicGate, meta)}
		if deferCompanyExplorerFolderItems {
			eventInputs = append([]DomainEventInput{
				DeferredCompanyExplorerFolderItemAssignEventInput(input.CompanyID, "", CompanyExplorerSystemActiveLogicGatesKey, "logic_gate", logicGate.LogicGateID, 0, input.ActorUserID),
			}, eventInputs...)
		} else {
			result.FolderItems = append(result.FolderItems, folderItem)
			eventInputs = append([]DomainEventInput{folderItemAssignedWorkspaceEventInput(folderItem, meta)}, eventInputs...)
		}
		stop = observeTiming(ctx, "repo.CreateRacioMatrixNode.domain_event_append")
		events, err := r.appendDomainEventsTx(ctx, tx, eventInputs)
		stop()
		if err != nil {
			return RacioMatrixNodeCreateResult{}, err
		}
		result.Events = append(result.Events, events...)
	}

	if logicGateID != "" {
		stop := observeTiming(ctx, "repo.CreateRacioMatrixNode.assignment_writes")
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
			MutationOrigin:      input.MutationOrigin,
			ActorUserID:         input.ActorUserID,
			IdempotencyKey:      input.IdempotencyKey,
		})
		stop()
		if err != nil {
			return RacioMatrixNodeCreateResult{}, err
		}
		assignment := assignmentResult.Assignment
		card := assignmentResult.Card
		result.Node = assignmentResult.Node
		result.Assignment = &assignment
		result.Card = &card
		result.Events = append(result.Events, assignmentResult.Events...)
		result.ProjectionDeltas = append(result.ProjectionDeltas, assignmentResult.ProjectionDeltas...)
		if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, ownedProjectionDeltas)); err != nil {
			return RacioMatrixNodeCreateResult{}, err
		}
		stop = observeTiming(ctx, "repo.CreateRacioMatrixNode.commit")
		if err := tx.Commit(); err != nil {
			stop()
			return RacioMatrixNodeCreateResult{}, err
		}
		stop()
		return result, nil
	}

	stop = observeTiming(ctx, "repo.CreateRacioMatrixNode.node_writes")
	var node domain.Node
	if deferCompanyExplorerFolderItems {
		node, err = r.createNodeWithAssigneeIDProjectionAndFolderTx(ctx, tx, input.CompanyID, input.NodeID, input.Title, input.ActorUserID, true, false)
	} else {
		node, err = r.createNodeWithAssigneeIDTx(ctx, tx, input.CompanyID, input.NodeID, input.Title, input.ActorUserID)
	}
	stop()
	if err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}
	if !deferCompanyExplorerFolderItems {
		stop = observeTiming(ctx, "repo.CreateRacioMatrixNode.folder_item_read")
		folderItem, err := postgresCompanyExplorerFolderItemForEntityTx(ctx, tx, input.CompanyID, "node", node.NodeID)
		stop()
		if err == nil {
			result.FolderItems = append(result.FolderItems, folderItem)
		} else if !errors.Is(err, ErrNotFound) {
			return RacioMatrixNodeCreateResult{}, err
		}
	}
	stop = observeTiming(ctx, "repo.CreateRacioMatrixNode.racio_projection_delta")
	rows, err := postgresRacioProjectionRowsForResourcesTx(ctx, tx, input.CompanyID, []string{node.NodeID}, nil)
	stop()
	if err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}
	eventInputs := []DomainEventInput{nodeCreatedWorkspaceEventInputWithMetadata(node, meta)}
	if deferCompanyExplorerFolderItems {
		eventInputs = append([]DomainEventInput{
			DeferredCompanyExplorerFolderItemAssignEventInput(input.CompanyID, "", CompanyExplorerSystemActiveNodesKey, "node", node.NodeID, 0, input.ActorUserID),
		}, eventInputs...)
	}
	stop = observeTiming(ctx, "repo.CreateRacioMatrixNode.domain_event_append")
	events, err := r.appendDomainEventsTx(ctx, tx, eventInputs)
	stop()
	if err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}
	result.Node = node
	result.ProjectionDeltas = append(result.ProjectionDeltas, diffRacioProjectionRows(nil, rows)...)
	result.Events = append(result.Events, events...)
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, result.ProjectionDeltas)); err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}
	stop = observeTiming(ctx, "repo.CreateRacioMatrixNode.commit")
	if err := tx.Commit(); err != nil {
		stop()
		return RacioMatrixNodeCreateResult{}, err
	}
	stop()
	return result, nil
}

func createRacioMatrixLogicGateTx(ctx context.Context, tx *sql.Tx, input RacioMatrixNodeCreateInput, syncFolderItem bool) (domain.LogicGate, domain.CompanyExplorerFolderItem, []ProjectionDelta, error) {
	created := domain.LogicGate{
		CompanyID:     input.CompanyID,
		LogicGateID:   newUUIDv7String(),
		Header:        input.CreateLogicGateHeader,
		DefaultAccess: ResourceDefaultAccessEdit,
	}
	stop := observeTiming(ctx, "repo.createRacioMatrixLogicGateTx.logic_gate_insert")
	if err := tx.QueryRowContext(ctx,
		`insert into logic_gates (company_id, logic_gate_id, header, created_timestamp)
		 values ($1, $2, $3, now())
		 returning company_id, logic_gate_id, header, created_timestamp`,
		created.CompanyID, created.LogicGateID, created.Header,
	).Scan(&created.CompanyID, &created.LogicGateID, &created.Header, &created.CreatedTimestamp); err != nil {
		stop()
		return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, nil, err
	}
	stop()
	projectionDeltas := []ProjectionDelta{}
	if input.ActorUserID != "" && input.CreatorLogicGateGVICRole != "" {
		assignee, err := loadPostgresNodeAssigneeReadModel(ctx, tx, input.CompanyID, input.ActorUserID)
		if err != nil {
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, nil, err
		}
		stop := observeTiming(ctx, "repo.createRacioMatrixLogicGateTx.gvic_assignment_writes")
		if _, err := tx.ExecContext(ctx, `
insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, 'logic_gate', $2::uuid, $3, 'user', $4::uuid, now(), now())
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id)
do update set updated_timestamp=resource_gvic_assignments.updated_timestamp`,
			input.CompanyID, created.LogicGateID, input.CreatorLogicGateGVICRole, assignee.UserID,
		); err != nil {
			stop()
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, nil, err
		}
		stop()
		stop = observeTiming(ctx, "repo.createRacioMatrixLogicGateTx.gvic_projection_sync")
		gvicDeltas, err := syncResourceGVICEffectiveAssignmentsTx(ctx, tx, input.CompanyID, []resourceGVICKey{{companyID: input.CompanyID, resourceType: EntityTypeLogicGate, resourceID: created.LogicGateID}})
		if err != nil {
			stop()
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, nil, err
		}
		deltas, err := syncPostgresRacioProjectionForLogicGateAssignmentsDeltasTx(ctx, tx, input.CompanyID, created.LogicGateID, nil, nil)
		if err != nil {
			stop()
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, nil, err
		}
		stop()
		projectionDeltas = append(projectionDeltas, gvicDeltas...)
		projectionDeltas = append(projectionDeltas, deltas...)
		assignments, err := postgresResourceGVICAssignmentsForResource(ctx, tx, resourceGVICKey{companyID: input.CompanyID, resourceType: EntityTypeLogicGate, resourceID: created.LogicGateID})
		if err != nil {
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, nil, err
		}
		created.GVICAssignments = assignments
		created.EffectiveAccess = EntityPermissionEdit
	}
	var folderItem domain.CompanyExplorerFolderItem
	if syncFolderItem {
		stop = observeTiming(ctx, "repo.createRacioMatrixLogicGateTx.folder_item_writes")
		activeFolder, err := ensureCompanyExplorerSystemFolderSQL(ctx, tx, input.CompanyID, CompanyExplorerSystemActiveLogicGatesKey)
		if err != nil {
			stop()
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, nil, err
		}
		folderItem, _, err = assignCompanyExplorerFolderItemSQL(ctx, tx, input.CompanyID, activeFolder.FolderID, "logic_gate", created.LogicGateID, 0)
		if err != nil {
			stop()
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, nil, err
		}
		stop()
	}
	return created, folderItem, projectionDeltas, nil
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
