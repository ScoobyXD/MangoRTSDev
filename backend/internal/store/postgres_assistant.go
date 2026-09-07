package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

const assistantRunColumns = `r.company_id::text,r.user_id::text,r.request_id,r.conversation_id,r.message,r.run_id,r.cancelled,r.settled,r.created_timestamp,r.payload_hash`

func scanAssistantRun(row interface{ Scan(...any) error }) (AssistantRun, error) {
	var run AssistantRun
	err := row.Scan(&run.CompanyID, &run.UserID, &run.RequestID, &run.ConversationID, &run.Message, &run.RunID, &run.Cancelled, &run.Settled, &run.CreatedAt, &run.PayloadHash)
	if errors.Is(err, sql.ErrNoRows) {
		return AssistantRun{}, ErrNotFound
	}
	return run, err
}

// Hold membership deletion until the scoped command completes. The run row
// then serializes cancellation, settlement and committed action receipts.
func lockAssistantMemberTx(ctx context.Context, tx *sql.Tx, companyID, userID string) error {
	var id string
	err := tx.QueryRowContext(ctx, `select user_id::text from company_memberships where company_id=$1::uuid and user_id=$2::uuid for update`, companyID, userID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func assistantStoreError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrConflict
	}
	return err
}

func (r *PostgresRepo) ReserveAssistantRun(ctx context.Context, input AssistantRun) (AssistantRun, error) {
	input, err := normalizeAssistantRun(input)
	if err != nil {
		return AssistantRun{}, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AssistantRun{}, err
	}
	defer tx.Rollback()
	if err := lockAssistantMemberTx(ctx, tx, input.CompanyID, input.UserID); err != nil {
		return AssistantRun{}, err
	}
	existing, err := scanAssistantRun(tx.QueryRowContext(ctx, `select `+assistantRunColumns+` from ai_runs r where r.company_id=$1::uuid and r.user_id=$2::uuid and r.request_id=$3`, input.CompanyID, input.UserID, input.RequestID))
	if err == nil {
		if existing.PayloadHash != input.PayloadHash {
			return AssistantRun{}, ErrConflict
		}
		return existing, tx.Commit()
	}
	if !errors.Is(err, ErrNotFound) {
		return AssistantRun{}, err
	}
	var active bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from ai_runs where company_id=$1::uuid and user_id=$2::uuid and not settled)`, input.CompanyID, input.UserID).Scan(&active); err != nil {
		return AssistantRun{}, err
	}
	if active {
		return AssistantRun{}, ErrConflict
	}
	_, err = tx.ExecContext(ctx, `insert into ai_runs(company_id,user_id,request_id,conversation_id,message,payload_hash,created_timestamp) values($1::uuid,$2::uuid,$3,$4,$5,$6,$7)`, input.CompanyID, input.UserID, input.RequestID, input.ConversationID, input.Message, input.PayloadHash, input.CreatedAt)
	if err != nil {
		return AssistantRun{}, assistantStoreError(err)
	}
	return input, tx.Commit()
}

func (r *PostgresRepo) GetAssistantRun(ctx context.Context, companyID, userID, requestID string) (AssistantRun, error) {
	return scanAssistantRun(r.db.QueryRowContext(ctx, `select `+assistantRunColumns+` from ai_runs r join company_memberships m using(company_id,user_id) where r.company_id=$1::uuid and r.user_id=$2::uuid and r.request_id=$3`, companyID, userID, requestID))
}

func (r *PostgresRepo) FindAssistantRun(ctx context.Context, companyID, userID, runID string) (AssistantRun, error) {
	if runID == "" {
		return AssistantRun{}, ErrInvalid
	}
	return scanAssistantRun(r.db.QueryRowContext(ctx, `select `+assistantRunColumns+` from ai_runs r join company_memberships m using(company_id,user_id) where r.company_id=$1::uuid and r.user_id=$2::uuid and r.run_id=$3`, companyID, userID, runID))
}

func (r *PostgresRepo) ActiveAssistantRun(ctx context.Context, companyID, userID string) (AssistantRun, error) {
	return scanAssistantRun(r.db.QueryRowContext(ctx, `select `+assistantRunColumns+` from ai_runs r join company_memberships m using(company_id,user_id) where r.company_id=$1::uuid and r.user_id=$2::uuid and not r.settled`, companyID, userID))
}

func (r *PostgresRepo) BindAssistantRun(ctx context.Context, companyID, userID, requestID, runID string) (AssistantRun, error) {
	if runID == "" {
		return AssistantRun{}, ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AssistantRun{}, err
	}
	defer tx.Rollback()
	if err := lockAssistantMemberTx(ctx, tx, companyID, userID); err != nil {
		return AssistantRun{}, err
	}
	run, err := scanAssistantRun(tx.QueryRowContext(ctx, `select `+assistantRunColumns+` from ai_runs r where r.company_id=$1::uuid and r.user_id=$2::uuid and r.request_id=$3 for update`, companyID, userID, requestID))
	if err != nil {
		return AssistantRun{}, err
	}
	if (run.RunID != "" && run.RunID != runID) || (run.Settled && run.RunID == "") {
		return AssistantRun{}, ErrConflict
	}
	if _, err := tx.ExecContext(ctx, `update ai_runs set run_id=$4,message='' where company_id=$1::uuid and user_id=$2::uuid and request_id=$3`, companyID, userID, requestID, runID); err != nil {
		return AssistantRun{}, assistantStoreError(err)
	}
	run.RunID, run.Message = runID, ""
	return run, tx.Commit()
}

func (r *PostgresRepo) SettleAssistantRun(ctx context.Context, companyID, userID, requestID string) error {
	return r.updateAssistantRun(ctx, companyID, userID, requestID, true)
}
func (r *PostgresRepo) CancelAssistantRun(ctx context.Context, companyID, userID, requestID string) error {
	return r.updateAssistantRun(ctx, companyID, userID, requestID, false)
}

func (r *PostgresRepo) updateAssistantRun(ctx context.Context, companyID, userID, requestID string, settle bool) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := lockAssistantMemberTx(ctx, tx, companyID, userID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `update ai_runs set settled=settled or $4,cancelled=cancelled or not $4,message=case when $4 then '' else message end where company_id=$1::uuid and user_id=$2::uuid and request_id=$3`, companyID, userID, requestID, settle)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func (r *PostgresRepo) AssistantCreateNode(ctx context.Context, requested AssistantRun, actionKey string, input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	defer tx.Rollback()
	if err := lockAssistantMemberTx(ctx, tx, requested.CompanyID, requested.UserID); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	run, err := scanAssistantRun(tx.QueryRowContext(ctx, `select `+assistantRunColumns+` from ai_runs r where r.company_id=$1::uuid and r.user_id=$2::uuid and r.request_id=$3 for update`, requested.CompanyID, requested.UserID, requested.RequestID))
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if run.RunID == "" || run.RunID != requested.RunID || run.Cancelled || run.Settled {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	input, err = assistantNodeInput(run, actionKey, input)
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
	return result, tx.Commit()
}

func loadAIActionTx(ctx context.Context, tx *sql.Tx, run AssistantRun, action aiActionKey, outcome any) (bool, error) {
	var receipt []byte
	err := tx.QueryRowContext(ctx, `select outcome from ai_actions where company_id=$1::uuid and user_id=$2::uuid and request_id=$3 and action_name=$4 and action_key=$5`, run.CompanyID, run.UserID, run.RequestID, action.Name, action.Key).Scan(&receipt)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal(receipt, outcome)
}

func saveAIActionTx(ctx context.Context, tx *sql.Tx, run AssistantRun, action aiActionKey, outcome any) error {
	receipt, err := json.Marshal(outcome)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `insert into ai_actions(company_id,user_id,request_id,action_name,action_key,outcome) values($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb)`, run.CompanyID, run.UserID, run.RequestID, action.Name, action.Key, string(receipt))
	return assistantStoreError(err)
}
