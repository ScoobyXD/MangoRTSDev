package store

import (
	"context"
	"database/sql"
	"errors"
)

// The existing command and its shared AI receipt use the same transaction.
// Locking the admission also serializes Stop and retries across Go processes.
func postgresAIMutation[T any](r *PostgresRepo, ctx context.Context, requested AIRun, action aiActionKey, authorize func(*sql.Tx) error, command func(*sql.Tx) (T, error)) (T, error) {
	var result T
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	run, err := lockAIRunTx(ctx, tx, requested.CompanyID, requested.UserID, requested.RunID)
	if err != nil {
		return result, err
	}
	if !aiMutationRunMatches(run, requested, action) {
		return result, ErrNotFound
	}
	if err := authorize(tx); err != nil {
		return result, err
	}
	if found, err := loadAIActionTx(ctx, tx, run, action, &result); err != nil {
		return result, err
	} else if found {
		return result, tx.Commit()
	}
	result, err = command(tx)
	if err != nil {
		return result, err
	}
	if err := saveAIActionTx(ctx, tx, run, action, result); err != nil {
		return result, err
	}
	run, err = appendAIHistory(run, aiMutationEvent(action))
	if err != nil {
		return result, err
	}
	if err := saveAIRunStateTx(ctx, tx, run); err != nil {
		return result, err
	}
	return result, tx.Commit()
}

func aiRequireEditTx(ctx context.Context, tx *sql.Tx, run AIRun, resourceType, resourceID string) error {
	var allowed bool
	err := tx.QueryRowContext(ctx, `select mangorts_user_can_access_resource($1::uuid,$2,$3::uuid,$4::uuid,'edit')`, run.CompanyID, resourceType, resourceID, run.UserID).Scan(&allowed)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) AIUpdateNode(ctx context.Context, run AIRun, actionKey string, input UpdateNodeInput) (AINodeUpdateResult, error) {
	input.CompanyID, input.ActorUserID = run.CompanyID, run.UserID
	return postgresAIMutation(r, ctx, run, aiActionKey{"mango_update_node", actionKey}, func(tx *sql.Tx) error {
		return aiRequireEditTx(ctx, tx, run, EntityTypeNode, input.NodeID)
	}, func(tx *sql.Tx) (AINodeUpdateResult, error) {
		node, event, err := r.updateNodeAndWorkspaceEventTx(ctx, tx, input)
		return AINodeUpdateResult{Node: node, Event: event}, err
	})
}

func (r *PostgresRepo) AIMoveNode(ctx context.Context, run AIRun, actionKey string, input LogicGateNodeAssignmentMoveInput) (LogicGateNodeAssignmentResult, error) {
	input.CompanyID, input.ActorUserID = run.CompanyID, run.UserID
	input.IdempotencyKey = "ai:" + run.RunID + ":mango_move_node:" + actionKey
	input, err := NormalizeLogicGateNodeAssignmentMoveInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return postgresAIMutation(r, ctx, run, aiActionKey{"mango_move_node", actionKey}, func(tx *sql.Tx) error {
		if err := lockProcessStepsTx(ctx, tx, run.CompanyID, input.LogicGateID); err != nil {
			return err
		}
		var nodeID string
		if err := tx.QueryRowContext(ctx, `select node_id::text from nodes where company_id=$1::uuid and node_id=$2::uuid for update`, run.CompanyID, input.NodeID).Scan(&nodeID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if err := aiRequireEditTx(ctx, tx, run, EntityTypeNode, input.NodeID); err != nil {
			return err
		}
		if err := aiRequireEditTx(ctx, tx, run, EntityTypeLogicGate, input.LogicGateID); err != nil {
			return err
		}
		// The current assignment chooses the source permission; caller hints do not.
		previous, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, run.CompanyID, input.NodeID, "")
		if err != nil {
			return err
		}
		return aiRequireEditTx(ctx, tx, run, EntityTypeLogicGate, previous.LogicGateID)
	}, func(tx *sql.Tx) (LogicGateNodeAssignmentResult, error) {
		return r.moveLogicGateNodeAssignmentTx(ctx, tx, input)
	})
}

func (r *PostgresRepo) AICommitEditor(ctx context.Context, run AIRun, actionKey string, input EditorJSONCommitInput) (EditorJSONCommit, error) {
	input, err := aiEditorInput(run, actionKey, input)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	return postgresAIMutation(r, ctx, run, aiActionKey{"mango_update_editor", actionKey}, func(tx *sql.Tx) error {
		resourceType, resourceID := input.Document.ResourceType, input.Document.ResourceID
		if resourceType == EntityTypeProcessStep {
			if err := tx.QueryRowContext(ctx, `select logic_gate_id::text from process_steps where company_id=$1::uuid and process_step_id=$2::uuid`, run.CompanyID, resourceID).Scan(&resourceID); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return ErrNotFound
				}
				return err
			}
			resourceType = EntityTypeLogicGate
		}
		return aiRequireEditTx(ctx, tx, run, resourceType, resourceID)
	}, func(tx *sql.Tx) (EditorJSONCommit, error) {
		return commitPostgresEditorTextboxDocumentTx(r, ctx, tx, input)
	})
}

func (r *PostgresRepo) AICreateEditor(ctx context.Context, run AIRun, actionKey string, input EditorJSONCommitInput) (AIEditorCreateResult, error) {
	input, err := aiNewEditorInput(run, actionKey, input)
	if err != nil {
		return AIEditorCreateResult{}, err
	}
	return postgresAIMutation(r, ctx, run, aiActionKey{"mango_create_editor", actionKey}, func(tx *sql.Tx) error {
		return aiRequireEditTx(ctx, tx, run, input.Document.ResourceType, input.Document.ResourceID)
	}, func(tx *sql.Tx) (AIEditorCreateResult, error) {
		commit, err := commitPostgresEditorTextboxDocumentTx(r, ctx, tx, input)
		return AIEditorCreateResult{Document: input.Document, Commit: commit}, err
	})
}
