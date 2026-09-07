package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

func nodeForLogicGateAssignmentResultTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) (domain.Node, error) {
	return scanNode(tx.QueryRowContext(ctx, `select `+nodeSelectColumns+` from nodes n `+nodeStatusJoin+` where n.company_id=$1::uuid and n.node_id=$2::uuid`, companyID, nodeID))
}
func nextLogicGateAssignmentPositionTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) (int, error) {
	var position int
	err := tx.QueryRowContext(ctx, `select coalesce(max(position),0)+1000 from node_logic_gate_assignments where company_id=$1::uuid and logic_gate_id=$2::uuid`, companyID, logicGateID).Scan(&position)
	return position, err
}
func (r *PostgresRepo) AssignNodeToLogicGateStatus(input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	ctx := ContextWithTimingRecorder(context.Background(), input.TimingRecorder)
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	defer tx.Rollback()
	result, err := r.assignNodeToLogicGateStatusTx(ctx, tx, input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return result, nil
}
func (r *PostgresRepo) assignNodeToLogicGateStatusTx(ctx context.Context, tx *sql.Tx, input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error) {
	if input.Status != "" {
		if status, ok := NormalizeLogicGateWorkStatusKey(input.Status); !ok || status == "" {
			return LogicGateNodeAssignmentResult{}, ErrInvalid
		}
	}
	if err := lockProcessStepsTx(ctx, tx, input.CompanyID, input.LogicGateID); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	var nodeID string
	err := tx.QueryRowContext(ctx, `select node_id::text from nodes where company_id=$1::uuid and node_id=$2::uuid for update`, input.CompanyID, input.NodeID).Scan(&nodeID)
	created := false
	if errors.Is(err, sql.ErrNoRows) {
		if input.CreateNodeTitle == "" {
			return LogicGateNodeAssignmentResult{}, ErrNotFound
		}
		_, err = r.createNodeWithIDWithoutProjectionTx(ctx, tx, input.CompanyID, input.NodeID, input.CreateNodeTitle)
		created = true
	}
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	previous, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, "")
	hadPrevious := err == nil
	if err != nil && !errors.Is(err, ErrNotFound) {
		return LogicGateNodeAssignmentResult{}, err
	}
	stepID := processStepIDForMove(previous.ProcessStepID, previous.LogicGateID, input.LogicGateID, input.ProcessStepID, input.ProcessStepIDSet)
	if err = validateProcessStepTx(ctx, tx, input.CompanyID, input.LogicGateID, stepID); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	var status string
	if err = tx.QueryRowContext(ctx, `select coalesce(status,'Pending') from nodes where company_id=$1::uuid and node_id=$2::uuid`, input.CompanyID, input.NodeID).Scan(&status); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	previousStatus := status
	if input.Status != "" {
		status = LogicGateWorkStatusTitle(input.Status)
	}
	normalizedStatus, err := normalizeNodeStatusForAssignment(&status, true)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	status = *normalizedStatus
	if _, err = tx.ExecContext(ctx, `update nodes set status=$3,priority=case when $4 then $5::smallint else priority end where company_id=$1::uuid and node_id=$2::uuid`, input.CompanyID, input.NodeID, status, input.PrioritySet, input.Priority); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	position := input.Position
	if position <= 0 {
		position, err = nextLogicGateAssignmentPositionTx(ctx, tx, input.CompanyID, input.LogicGateID)
		if err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}
	issue := previous.IsIssue
	if input.IsIssueSet {
		issue = input.IsIssue
	}
	placedBy := previous.PlacedByUserID
	if !hadPrevious || previous.LogicGateID != input.LogicGateID {
		placedBy = input.ActorUserID
	}
	requestedBy := previous.RequestedByUserID
	if !hadPrevious || previous.LogicGateID != input.LogicGateID || previousStatus != status {
		requestedBy = input.ActorUserID
	}
	assignment, err := upsertNodeLogicGateAssignmentSQL(ctx, tx, nodeLogicGateAssignmentSQLInput{AssignmentID: previous.AssignmentID, CompanyID: input.CompanyID, NodeID: input.NodeID, LogicGateID: input.LogicGateID, ProcessStepID: stepID, IsIssue: issue, Position: position, RequestedByUserID: requestedByUserIDForLogicGateStatus(status, requestedBy, input.ActorUserID), PlacedByUserID: placedBy})
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if err = syncNodeLogicGateAssignmentProjectionDependenciesTx(ctx, tx, NodeLogicGateAssignmentProjectionDependencyInput{CompanyID: input.CompanyID, AssignmentID: assignment.AssignmentID, NodeID: input.NodeID}); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	node, err := nodeForLogicGateAssignmentResultTx(ctx, tx, input.CompanyID, input.NodeID)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result := LogicGateNodeAssignmentResult{Node: node, Assignment: assignment}
	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	inputs := logicGateAssignmentSavedWorkspaceEventInputs(result, meta)
	if hadPrevious {
		inputs = logicGateAssignmentMovedWorkspaceEventInputs(result, previous, meta)
	}
	if created {
		inputs = append([]DomainEventInput{nodeCreatedWorkspaceEventInputWithMetadata(node, meta)}, inputs...)
	}
	events, err := r.appendDomainEventsTx(ctx, tx, inputs)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	if hadPrevious && previous.LogicGateID != input.LogicGateID {
		if _, err = insertLogicGateTransferTimelineEventTx(ctx, tx, input.CompanyID, input.NodeID, input.ActorUserID, previous.LogicGateID, input.LogicGateID); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}
	return result, nil
}
func (r *PostgresRepo) MoveLogicGateNodeAssignment(input LogicGateNodeAssignmentMoveInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentMoveInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	ctx := ContextWithTimingRecorder(context.Background(), input.TimingRecorder)
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	defer tx.Rollback()
	result, err := r.moveLogicGateNodeAssignmentTx(ctx, tx, input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return result, tx.Commit()
}

func (r *PostgresRepo) moveLogicGateNodeAssignmentTx(ctx context.Context, tx *sql.Tx, input LogicGateNodeAssignmentMoveInput) (LogicGateNodeAssignmentResult, error) {
	if err := lockProcessStepsTx(ctx, tx, input.CompanyID, input.LogicGateID); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	var nodeID string
	if err := tx.QueryRowContext(ctx, `select node_id::text from nodes where company_id=$1::uuid and node_id=$2::uuid for update`, input.CompanyID, input.NodeID).Scan(&nodeID); errors.Is(err, sql.ErrNoRows) {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	} else if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	previous, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, "")
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	position := input.Position
	if position <= 0 && previous.LogicGateID == input.LogicGateID {
		position = previous.Position
	}
	result, err := r.assignNodeToLogicGateStatusTx(ctx, tx, LogicGateNodeAssignmentInput{CompanyID: input.CompanyID, LogicGateID: input.LogicGateID, NodeID: input.NodeID, Status: input.Status, ProcessStepID: input.ProcessStepID, ProcessStepIDSet: input.ProcessStepIDSet, Position: position, Priority: input.Priority, PrioritySet: input.PrioritySet, ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey})
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return result, nil
}
func (r *PostgresRepo) RemoveLogicGateNodeAssignment(input LogicGateNodeAssignmentRemoveInput) (LogicGateNodeAssignmentRemoveResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentRemoveInput(input)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	defer tx.Rollback()
	var nodeID string
	if err := tx.QueryRowContext(ctx, `select node_id::text from nodes where company_id=$1::uuid and node_id=$2::uuid for update`, input.CompanyID, input.NodeID).Scan(&nodeID); errors.Is(err, sql.ErrNoRows) {
		return LogicGateNodeAssignmentRemoveResult{}, ErrNotFound
	} else if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	assignment, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, input.LogicGateID)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `delete from node_logic_gate_assignments where company_id=$1::uuid and node_id=$2::uuid and assignment_id=$3::uuid`, input.CompanyID, input.NodeID, assignment.AssignmentID); err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	if input.FallbackStatus != nil {
		if _, err = tx.ExecContext(ctx, `update nodes set status=$3 where company_id=$1::uuid and node_id=$2::uuid`, input.CompanyID, input.NodeID, *input.FallbackStatus); err != nil {
			return LogicGateNodeAssignmentRemoveResult{}, err
		}
	}
	if err = syncNodeLogicGateAssignmentProjectionDependenciesTx(ctx, tx, NodeLogicGateAssignmentProjectionDependencyInput{CompanyID: input.CompanyID, AssignmentID: assignment.AssignmentID, NodeID: input.NodeID}); err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	node, err := nodeForLogicGateAssignmentResultTx(ctx, tx, input.CompanyID, input.NodeID)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	result := LogicGateNodeAssignmentRemoveResult{Node: node, Assignment: assignment}
	events, err := r.appendDomainEventsTx(ctx, tx, logicGateAssignmentRemovedWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	result.Events = events
	if err = tx.Commit(); err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	return result, nil
}
func (r *PostgresRepo) SetLogicGateNodeAssignmentIssue(input LogicGateNodeAssignmentIssueInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentIssueInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	defer tx.Rollback()
	assignment, err := scanNodeLogicGateAssignment(tx.QueryRowContext(ctx, `update node_logic_gate_assignments set is_issue=$4,version=version+1,updated_timestamp=now() where company_id=$1::uuid and node_id=$2::uuid and ($3='' or logic_gate_id::text=$3) returning `+nodeLogicGateAssignmentSelectColumns, input.CompanyID, input.NodeID, input.LogicGateID, input.IsIssue))
	if errors.Is(err, sql.ErrNoRows) {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if err = syncNodeLogicGateAssignmentProjectionDependenciesTx(ctx, tx, NodeLogicGateAssignmentProjectionDependencyInput{CompanyID: input.CompanyID, AssignmentID: assignment.AssignmentID, NodeID: input.NodeID}); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	node, err := nodeForLogicGateAssignmentResultTx(ctx, tx, input.CompanyID, input.NodeID)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result := LogicGateNodeAssignmentResult{Node: node, Assignment: assignment}
	events, err := r.appendDomainEventsTx(ctx, tx, logicGateAssignmentIssueWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	if err = tx.Commit(); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return result, nil
}
