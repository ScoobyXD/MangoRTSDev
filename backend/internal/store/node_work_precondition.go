package store

import (
	"context"
	"database/sql"
	"errors"

	"miraeopus/backend/internal/domain"
)

func (expected NodeWorkPrecondition) matches(status string, assignment domain.NodeLogicGateAssignment) bool {
	return assignment.LogicGateID == expected.LogicGateID &&
		assignment.ProcessStepID != nil && *assignment.ProcessStepID == expected.ProcessStepID &&
		status == expected.Status && assignment.Version == expected.AssignmentVersion
}

// The caller keeps the existing repository mutex through its mutation.
func (r *MemoryRepo) requireNodeWorkPreconditionLocked(companyID, nodeID string, expected *NodeWorkPrecondition) error {
	if expected == nil {
		return nil
	}
	node, exists := r.nodes[key(companyID, nodeID)]
	assignment, assigned := r.nodeLogicGateAssignmentLocked(companyID, nodeID, "")
	if !exists || !assigned || !expected.matches(nodeWorkStatus(node), assignment) {
		return ErrVersionConflict
	}
	return nil
}

// Lock the Node first, then its exact assignment. Transfers and status changes
// lock the Node; assignment-only changes must also wait until this write commits.
func requireNodeWorkPreconditionTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string, expected *NodeWorkPrecondition) error {
	if expected == nil {
		return nil
	}
	var status string
	err := tx.QueryRowContext(ctx, `select coalesce(status,'Pending') from nodes where company_id=$1::uuid and node_id=$2::uuid for update`, companyID, nodeID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrVersionConflict
	}
	if err != nil {
		return err
	}
	assignment, err := scanNodeLogicGateAssignment(tx.QueryRowContext(ctx, `select `+nodeLogicGateAssignmentSelectColumns+` from node_logic_gate_assignments where company_id=$1::uuid and node_id=$2::uuid for update`, companyID, nodeID))
	if errors.Is(err, sql.ErrNoRows) {
		return ErrVersionConflict
	}
	if err != nil {
		return err
	}
	if !expected.matches(status, assignment) {
		return ErrVersionConflict
	}
	return nil
}
