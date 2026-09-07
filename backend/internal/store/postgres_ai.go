package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

const aiRunColumns = `r.company_id::text,r.user_id::text,r.run_id::text,coalesce(r.hermes_run_id,''),coalesce(r.chat_id,''),r.status,coalesce(r.pending_input,''),r.history,r.created_timestamp`

func scanAIRun(row interface{ Scan(...any) error }) (AIRun, error) {
	var run AIRun
	var history []byte
	err := row.Scan(&run.CompanyID, &run.UserID, &run.RunID, &run.HermesRunID, &run.ChatID, &run.Status, &run.PendingInput, &history, &run.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return AIRun{}, ErrNotFound
	}
	if err != nil {
		return AIRun{}, err
	}
	if err := json.Unmarshal(history, &run.History); err != nil {
		return AIRun{}, err
	}
	return run, nil
}

// Scope membership serializes admission and transcript imports, and prevents
// membership removal from crossing an admitted write. Run locks also gate Stop.
func lockAIMemberTx(ctx context.Context, tx *sql.Tx, companyID, userID string) error {
	var id string
	err := tx.QueryRowContext(ctx, `select user_id::text from company_memberships where company_id=$1::uuid and user_id=$2::uuid for update`, companyID, userID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func aiStoreError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrConflict
	}
	return err
}

func lockAIRunTx(ctx context.Context, tx *sql.Tx, companyID, userID, runID string) (AIRun, error) {
	if cleanUUIDText(runID) == "" {
		return AIRun{}, ErrNotFound
	}
	if err := lockAIMemberTx(ctx, tx, companyID, userID); err != nil {
		return AIRun{}, err
	}
	return scanAIRun(tx.QueryRowContext(ctx, `select `+aiRunColumns+` from ai_runs r where r.company_id=$1::uuid and r.user_id=$2::uuid and r.run_id=$3::uuid for update`, companyID, userID, runID))
}

func saveAIRunStateTx(ctx context.Context, tx *sql.Tx, run AIRun) error {
	history, err := json.Marshal(run.History)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `update ai_runs set hermes_run_id=nullif($4,''),status=$5,pending_input=nullif($6,''),history=$7::jsonb where company_id=$1::uuid and user_id=$2::uuid and run_id=$3::uuid`, run.CompanyID, run.UserID, run.RunID, run.HermesRunID, run.Status, run.PendingInput, string(history))
	return aiStoreError(err)
}

func (r *PostgresRepo) ReserveAIRun(ctx context.Context, input AIRun) (AIRun, error) {
	input, err := normalizeAIRun(input)
	if err != nil {
		return AIRun{}, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AIRun{}, err
	}
	defer tx.Rollback()
	if err := lockAIMemberTx(ctx, tx, input.CompanyID, input.UserID); err != nil {
		return AIRun{}, err
	}
	existing, err := scanAIRun(tx.QueryRowContext(ctx, `select `+aiRunColumns+` from ai_runs r where r.company_id=$1::uuid and r.user_id=$2::uuid and r.run_id=$3::uuid`, input.CompanyID, input.UserID, input.RunID))
	if err == nil {
		return existing, tx.Commit()
	}
	if !errors.Is(err, ErrNotFound) {
		return AIRun{}, err
	}
	var active bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from ai_runs where company_id=$1::uuid and user_id=$2::uuid and status in ('pending','running','stopping'))`, input.CompanyID, input.UserID).Scan(&active); err != nil {
		return AIRun{}, err
	}
	if active {
		return AIRun{}, ErrConflict
	}
	if input.ChatID != "" {
		if _, err := aiChatTx(ctx, tx, input.CompanyID, input.UserID, input.ChatID); err != nil {
			return AIRun{}, err
		}
	}
	history, err := json.Marshal(input.History)
	if err != nil {
		return AIRun{}, err
	}
	_, err = tx.ExecContext(ctx, `insert into ai_runs(company_id,user_id,run_id,chat_id,status,pending_input,history,created_timestamp) values($1::uuid,$2::uuid,$3::uuid,nullif($4,''),'pending',$5,$6::jsonb,$7)`, input.CompanyID, input.UserID, input.RunID, input.ChatID, input.PendingInput, string(history), input.CreatedAt)
	if err != nil {
		return AIRun{}, aiStoreError(err)
	}
	return input, tx.Commit()
}

func (r *PostgresRepo) GetAIRun(ctx context.Context, companyID, userID, runID string) (AIRun, error) {
	if cleanUUIDText(runID) == "" {
		return AIRun{}, ErrNotFound
	}
	return scanAIRun(r.db.QueryRowContext(ctx, `select `+aiRunColumns+` from ai_runs r join company_memberships m using(company_id,user_id) where r.company_id=$1::uuid and r.user_id=$2::uuid and r.run_id=$3::uuid`, companyID, userID, runID))
}

func (r *PostgresRepo) FindAIRun(ctx context.Context, companyID, userID, hermesRunID string) (AIRun, error) {
	if hermesRunID == "" {
		return AIRun{}, ErrInvalid
	}
	return scanAIRun(r.db.QueryRowContext(ctx, `select `+aiRunColumns+` from ai_runs r join company_memberships m using(company_id,user_id) where r.company_id=$1::uuid and r.user_id=$2::uuid and r.hermes_run_id=$3`, companyID, userID, hermesRunID))
}

func (r *PostgresRepo) ActiveAIRun(ctx context.Context, companyID, userID string) (AIRun, error) {
	return scanAIRun(r.db.QueryRowContext(ctx, `select `+aiRunColumns+` from ai_runs r join company_memberships m using(company_id,user_id) where r.company_id=$1::uuid and r.user_id=$2::uuid and r.status in ('pending','running','stopping')`, companyID, userID))
}

func (r *PostgresRepo) updateAIRun(ctx context.Context, companyID, userID, runID string, update func(AIRun) (AIRun, error)) (AIRun, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AIRun{}, err
	}
	defer tx.Rollback()
	run, err := lockAIRunTx(ctx, tx, companyID, userID, runID)
	if err != nil {
		return AIRun{}, err
	}
	run, err = update(run)
	if err != nil {
		return AIRun{}, err
	}
	if err := saveAIRunStateTx(ctx, tx, run); err != nil {
		return AIRun{}, err
	}
	return run, tx.Commit()
}

func (r *PostgresRepo) BindAIRun(ctx context.Context, companyID, userID, runID, hermesRunID string) (AIRun, error) {
	if hermesRunID == "" || !aiValidText(hermesRunID) {
		return AIRun{}, ErrInvalid
	}
	return r.updateAIRun(ctx, companyID, userID, runID, func(run AIRun) (AIRun, error) {
		if (run.HermesRunID != "" && run.HermesRunID != hermesRunID) || (AITerminalStatus(run.Status) && run.HermesRunID == "") {
			return AIRun{}, ErrConflict
		}
		run.HermesRunID, run.PendingInput = hermesRunID, ""
		if run.Status == "pending" {
			return aiRunStatus(run, "running")
		}
		return run, nil
	})
}

func (r *PostgresRepo) SetAIRunStatus(ctx context.Context, companyID, userID, runID, status string) (AIRun, error) {
	return r.updateAIRun(ctx, companyID, userID, runID, func(run AIRun) (AIRun, error) { return aiRunStatus(run, status) })
}

func (r *PostgresRepo) AppendAIHistoryEvent(ctx context.Context, companyID, userID, runID string, event AIHistoryEvent) (AIRun, error) {
	return r.updateAIRun(ctx, companyID, userID, runID, func(run AIRun) (AIRun, error) { return appendAIHistory(run, event) })
}

func (r *PostgresRepo) AICreateNode(ctx context.Context, requested AIRun, actionKey string, input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	defer tx.Rollback()
	run, err := lockAIRunTx(ctx, tx, requested.CompanyID, requested.UserID, requested.RunID)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if run.HermesRunID == "" || run.HermesRunID != requested.HermesRunID || run.Status != "running" {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	input, err = aiNodeInput(run, actionKey, input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	var allowed bool
	if err := tx.QueryRowContext(ctx, `select mangorts_user_can_access_resource($1::uuid,'logic_gate',$2::uuid,$3::uuid,'edit')`, run.CompanyID, input.LogicGateID, run.UserID).Scan(&allowed); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if !allowed {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	action := aiActionKey{Name: aiCreateNodeAction, Key: actionKey}
	var saved LogicGateNodeAssignmentResult
	if found, err := loadAIActionTx(ctx, tx, run, action, &saved); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	} else if found {
		return saved, tx.Commit()
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)`, run.CompanyID, input.NodeID).Scan(&exists); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if exists {
		return LogicGateNodeAssignmentResult{}, ErrConflict
	}
	result, err := r.assignNodeToLogicGateStatusTx(ctx, tx, input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if err := saveAIActionTx(ctx, tx, run, action, result); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	run, err = appendAIHistory(run, aiCommittedNodeEvent(actionKey, result))
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if err := saveAIRunStateTx(ctx, tx, run); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return result, tx.Commit()
}

func loadAIActionTx(ctx context.Context, tx *sql.Tx, run AIRun, action aiActionKey, result any) (bool, error) {
	var receipt []byte
	err := tx.QueryRowContext(ctx, `select result from ai_actions where company_id=$1::uuid and user_id=$2::uuid and run_id=$3::uuid and action_name=$4 and action_key=$5`, run.CompanyID, run.UserID, run.RunID, action.Name, action.Key).Scan(&receipt)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal(receipt, result)
}

func saveAIActionTx(ctx context.Context, tx *sql.Tx, run AIRun, action aiActionKey, result any) error {
	receipt, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `insert into ai_actions(company_id,user_id,run_id,action_name,action_key,result) values($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb)`, run.CompanyID, run.UserID, run.RunID, action.Name, action.Key, string(receipt))
	return aiStoreError(err)
}
