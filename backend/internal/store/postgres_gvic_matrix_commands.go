package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) CreateRACIMatrixNode(input RACIMatrixNodeCreateInput) (RACIMatrixNodeCreateResult, error) {
	ctx := ContextWithTimingRecorder(context.Background(), input.TimingRecorder)
	stop := observeTiming(ctx, "repo.CreateRACIMatrixNode.normalize_input")
	input, err := NormalizeRACIMatrixNodeCreateInput(input)
	stop()
	if err != nil {
		return RACIMatrixNodeCreateResult{}, err
	}

	defer observeTiming(ctx, "repo.CreateRACIMatrixNode.transaction")()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return RACIMatrixNodeCreateResult{}, err
	}
	defer tx.Rollback()

	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	result := RACIMatrixNodeCreateResult{}
	logicGateID := input.LogicGateID
	deferCompanyExplorerFolderItems := input.MutationOrigin == MutationOriginMatrix || input.MutationOrigin == MutationOriginKanban
	if input.CreateLogicGateHeader != "" {
		stop := observeTiming(ctx, "repo.CreateRACIMatrixNode.logic_gate_writes")
		logicGate, _, err := createRACIMatrixLogicGateTx(ctx, tx, input, !deferCompanyExplorerFolderItems)
		stop()
		if err != nil {
			return RACIMatrixNodeCreateResult{}, err
		}
		logicGateID = logicGate.LogicGateID
		result.LogicGate = &logicGate
		eventInputs := []DomainEventInput{logicGateCreatedWorkspaceEventInput(logicGate, meta)}
		stop = observeTiming(ctx, "repo.CreateRACIMatrixNode.domain_event_append")
		events, err := r.appendDomainEventsTx(ctx, tx, eventInputs)
		stop()
		if err != nil {
			return RACIMatrixNodeCreateResult{}, err
		}
		result.Events = append(result.Events, events...)
	}

	if logicGateID != "" {
		stop := observeTiming(ctx, "repo.CreateRACIMatrixNode.assignment_writes")
		assignmentResult, err := r.assignNodeToLogicGateStatusTx(ctx, tx, LogicGateNodeAssignmentInput{
			CompanyID:           input.CompanyID,
			LogicGateID:         logicGateID,
			NodeID:              input.NodeID,
			Status:              input.Status,
			ProcessStepID:input.ProcessStepID,
 ProcessStepIDSet:input.ProcessStepIDSet,
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
			return RACIMatrixNodeCreateResult{}, err
		}
		assignment := assignmentResult.Assignment
		result.Node = assignmentResult.Node
		result.Assignment = &assignment
		result.Events = append(result.Events, assignmentResult.Events...)
		stop = observeTiming(ctx, "repo.CreateRACIMatrixNode.commit")
		if err := tx.Commit(); err != nil {
			stop()
			return RACIMatrixNodeCreateResult{}, err
		}
		stop()
		return result, nil
	}

	stop = observeTiming(ctx, "repo.CreateRACIMatrixNode.node_writes")
	var node domain.Node
	if deferCompanyExplorerFolderItems {
		node, err = r.createNodeWithIDProjectionAndFolderTx(ctx, tx, input.CompanyID, input.NodeID, input.Title, true, false)
	} else {
		node, err = r.createNodeWithIDTx(ctx, tx, input.CompanyID, input.NodeID, input.Title)
	}
	stop()
	if err != nil {
		return RACIMatrixNodeCreateResult{}, err
	}
	eventInputs := []DomainEventInput{nodeCreatedWorkspaceEventInputWithMetadata(node, meta)}
	stop = observeTiming(ctx, "repo.CreateRACIMatrixNode.domain_event_append")
	events, err := r.appendDomainEventsTx(ctx, tx, eventInputs)
	stop()
	if err != nil {
		return RACIMatrixNodeCreateResult{}, err
	}
	result.Node = node
	result.Events = append(result.Events, events...)
	stop = observeTiming(ctx, "repo.CreateRACIMatrixNode.commit")
	if err := tx.Commit(); err != nil {
		stop()
		return RACIMatrixNodeCreateResult{}, err
	}
	stop()
	return result, nil
}

func createRACIMatrixLogicGateTx(ctx context.Context, tx *sql.Tx, input RACIMatrixNodeCreateInput, syncFolderItem bool) (domain.LogicGate, domain.CompanyExplorerFolderItem, error) {
	created := domain.LogicGate{
		CompanyID:     input.CompanyID,
		LogicGateID:   newUUIDv7String(),
		Header:        input.CreateLogicGateHeader,
		DefaultAccess: ResourceDefaultAccessEdit,
	}
	stop := observeTiming(ctx, "repo.createRACIMatrixLogicGateTx.logic_gate_insert")
	if err := tx.QueryRowContext(ctx,
		`insert into logic_gates (company_id, logic_gate_id, header, created_timestamp)
		 values ($1, $2, $3, now())
		 returning company_id, logic_gate_id, header, created_timestamp`,
		created.CompanyID, created.LogicGateID, created.Header,
	).Scan(&created.CompanyID, &created.LogicGateID, &created.Header, &created.CreatedTimestamp); err != nil {
		stop()
		return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, err
	}
	stop()
	if input.ActorUserID != "" && input.CreatorLogicGateRACIRole != "" {
		var creatorInCompany bool
		if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where company_id=$1::uuid and user_id::text=$2
)`, input.CompanyID, input.ActorUserID).Scan(&creatorInCompany); err != nil {
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, err
		}
		if !creatorInCompany {
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, ErrPrincipalNotInCompany
		}
		policy, err := customizeNewPostgresResourceRACIForCreatorTx(ctx, tx,
			resourceRACIKey{companyID: input.CompanyID, resourceType: EntityTypeLogicGate, resourceID: created.LogicGateID}, input.CreatorLogicGateRACIRole, input.ActorUserID)
		if err != nil {
			return domain.LogicGate{}, domain.CompanyExplorerFolderItem{}, err
		}
		created.RACIAssignments = logicGateRACIAssignmentsFromResources(policy.RACIAssignments)
		created.EffectiveAccess = EntityPermissionEdit
	}
	var folderItem domain.CompanyExplorerFolderItem
	if syncFolderItem {
		stop = observeTiming(ctx, "repo.createRACIMatrixLogicGateTx.folder_item_writes")
		stop()
	}
	return created, folderItem, nil
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
