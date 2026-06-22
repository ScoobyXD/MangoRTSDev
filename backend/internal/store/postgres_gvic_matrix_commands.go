package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) CreateGVICMatrixNode(input GVICMatrixNodeCreateInput) (GVICMatrixNodeCreateResult, error) {
	ctx := ContextWithTimingRecorder(context.Background(), input.TimingRecorder)
	stop := observeTiming(ctx, "repo.CreateGVICMatrixNode.normalize_input")
	input, err := NormalizeGVICMatrixNodeCreateInput(input)
	stop()
	if err != nil {
		return GVICMatrixNodeCreateResult{}, err
	}

	defer observeTiming(ctx, "repo.CreateGVICMatrixNode.transaction")()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return GVICMatrixNodeCreateResult{}, err
	}
	defer tx.Rollback()

	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	result := GVICMatrixNodeCreateResult{}
	ownedProjectionDeltas := []ProjectionDelta{}
	logicGateID := input.LogicGateID
	deferCompanyExplorerFolderItems := input.MutationOrigin == MutationOriginMatrix || input.MutationOrigin == MutationOriginKanban
	if input.CreateLogicGateHeader != "" {
		stop := observeTiming(ctx, "repo.CreateGVICMatrixNode.logic_gate_writes")
		logicGate, _, deltas, err := createGVICMatrixLogicGateTx(ctx, tx, input, !deferCompanyExplorerFolderItems)
		stop()
		if err != nil {
			return GVICMatrixNodeCreateResult{}, err
		}
		logicGateID = logicGate.LogicGateID
		result.LogicGate = &logicGate
		result.ProjectionDeltas = append(result.ProjectionDeltas, deltas...)
		ownedProjectionDeltas = append(ownedProjectionDeltas, deltas...)
		eventInputs := []DomainEventInput{logicGateCreatedWorkspaceEventInput(logicGate, meta)}
		stop = observeTiming(ctx, "repo.CreateGVICMatrixNode.domain_event_append")
		events, err := r.appendDomainEventsTx(ctx, tx, eventInputs)
		stop()
		if err != nil {
			return GVICMatrixNodeCreateResult{}, err
		}
		result.Events = append(result.Events, events...)
	}

	if logicGateID != "" {
		stop := observeTiming(ctx, "repo.CreateGVICMatrixNode.assignment_writes")
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
			MutationOrigin:      input.MutationOrigin,
			ActorUserID:         input.ActorUserID,
			IdempotencyKey:      input.IdempotencyKey,
		})
		stop()
		if err != nil {
			return GVICMatrixNodeCreateResult{}, err
		}
		assignment := assignmentResult.Assignment
		card := assignmentResult.Card
		result.Node = assignmentResult.Node
		result.Assignment = &assignment
		result.Card = &card
		result.Events = append(result.Events, assignmentResult.Events...)
		result.ProjectionDeltas = append(result.ProjectionDeltas, assignmentResult.ProjectionDeltas...)
		if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, ownedProjectionDeltas)); err != nil {
			return GVICMatrixNodeCreateResult{}, err
		}
		stop = observeTiming(ctx, "repo.CreateGVICMatrixNode.commit")
		if err := tx.Commit(); err != nil {
			stop()
			return GVICMatrixNodeCreateResult{}, err
		}
		stop()
		return result, nil
	}

	stop = observeTiming(ctx, "repo.CreateGVICMatrixNode.node_writes")
	var node domain.Node
	if deferCompanyExplorerFolderItems {
		node, err = r.createNodeWithIDProjectionAndFolderTx(ctx, tx, input.CompanyID, input.NodeID, input.Title, true, false)
	} else {
		node, err = r.createNodeWithIDTx(ctx, tx, input.CompanyID, input.NodeID, input.Title)
	}
	stop()
	if err != nil {
		return GVICMatrixNodeCreateResult{}, err
	}
	stop = observeTiming(ctx, "repo.CreateGVICMatrixNode.gvic_matrix_projection_delta")
	rows, err := postgresGVICMatrixProjectionRowsForResourcesTx(ctx, tx, input.CompanyID, []string{node.NodeID}, nil)
	stop()
	if err != nil {
		return GVICMatrixNodeCreateResult{}, err
	}
	eventInputs := []DomainEventInput{nodeCreatedWorkspaceEventInputWithMetadata(node, meta)}
	stop = observeTiming(ctx, "repo.CreateGVICMatrixNode.domain_event_append")
	events, err := r.appendDomainEventsTx(ctx, tx, eventInputs)
	stop()
	if err != nil {
		return GVICMatrixNodeCreateResult{}, err
	}
	result.Node = node
	result.ProjectionDeltas = append(result.ProjectionDeltas, diffGVICMatrixProjectionRows(nil, rows)...)
	result.Events = append(result.Events, events...)
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, result.ProjectionDeltas)); err != nil {
		return GVICMatrixNodeCreateResult{}, err
	}
	stop = observeTiming(ctx, "repo.CreateGVICMatrixNode.commit")
	if err := tx.Commit(); err != nil {
		stop()
		return GVICMatrixNodeCreateResult{}, err
	}
	stop()
	return result, nil
}

func createGVICMatrixLogicGateTx(ctx context.Context, tx *sql.Tx, input GVICMatrixNodeCreateInput, syncFolderItem bool) (domain.LogicGate, domain.CompanyExplorerFolderItem, []ProjectionDelta, error) {
	created := domain.LogicGate{
		CompanyID:     input.CompanyID,
		LogicGateID:   newUUIDv7String(),
		Header:        input.CreateLogicGateHeader,
		DefaultAccess: ResourceDefaultAccessEdit,
	}
	stop := observeTiming(ctx, "repo.createGVICMatrixLogicGateTx.logic_gate_insert")
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
		var creatorInCompany bool
		if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where company_id=$1::uuid and user_id::text=$2
)`, input.CompanyID, input.ActorUserID).Scan(&creatorInCompany); err != nil {
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, nil, err
		}
		if !creatorInCompany {
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, nil, ErrPrincipalNotInCompany
		}
		stop := observeTiming(ctx, "repo.createGVICMatrixLogicGateTx.gvic_assignment_writes")
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
			input.CompanyID, created.LogicGateID, input.CreatorLogicGateGVICRole, input.ActorUserID,
		); err != nil {
			stop()
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, nil, err
		}
		stop()
		stop = observeTiming(ctx, "repo.createGVICMatrixLogicGateTx.gvic_projection_sync")
		gvicDeltas, err := syncResourceGVICEffectiveAssignmentsTx(ctx, tx, input.CompanyID, []resourceGVICKey{{companyID: input.CompanyID, resourceType: EntityTypeLogicGate, resourceID: created.LogicGateID}})
		if err != nil {
			stop()
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, nil, err
		}
		deltas, err := syncPostgresGVICMatrixProjectionForLogicGateAssignmentsDeltasTx(ctx, tx, input.CompanyID, created.LogicGateID, nil, nil)
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
		created.GVICAssignments = logicGateGVICAssignmentsFromResources(assignments)
		created.EffectiveAccess = EntityPermissionEdit
	}
	var folderItem domain.CompanyExplorerFolderItem
	if syncFolderItem {
		stop = observeTiming(ctx, "repo.createGVICMatrixLogicGateTx.folder_item_writes")
		stop()
	}
	return created, folderItem, projectionDeltas, nil
}

func postgresCompanyExplorerFolderItemForEntityTx(ctx context.Context, tx *sql.Tx, companyID, itemType, itemID string) (domain.CompanyExplorerFolderItem, error) {
	var item domain.CompanyExplorerFolderItem
	if err := tx.QueryRowContext(ctx, `
select company_id, folder_id, item_type, item_id, position, created_timestamp, updated_timestamp
from (
  select company_id::text, coalesce(parent_folder_id::text, '') as folder_id, target_type as item_type, target_id::text as item_id, position, created_timestamp, updated_timestamp
  from company_explorer_items
  where company_id=$1::uuid and target_type=$2 and target_id=$3::uuid
) item`,
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
