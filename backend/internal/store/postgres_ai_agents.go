package store

import (
	"context"
	"database/sql"
	"errors"
)

func (r *PostgresRepo) CreateAIAgentSession(ctx context.Context, s AIAgentSession) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO ai_agent_sessions(session_id,company_id,user_id,prompt,instructions,skills) VALUES($1,$2,$3,$4,$5,$6)`, s.ID, s.CompanyID, s.UserID, s.Prompt, s.Instructions, s.Skills)
	return err
}
func (r *PostgresRepo) ListAIAgentSessions(ctx context.Context, c, u string) ([]AIAgentSession, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT session_id,prompt,instructions,skills,stopped,awaiting_turn_after,created_at FROM ai_agent_sessions WHERE company_id=$1 AND user_id=$2 ORDER BY created_at DESC`, c, u)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AIAgentSession{}
	for rows.Next() {
		s := AIAgentSession{CompanyID: c, UserID: u}
		if err = rows.Scan(&s.ID, &s.Prompt, &s.Instructions, &s.Skills, &s.Stopped, &s.AwaitingTurnAfter, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
func (r *PostgresRepo) GetAIAgentSession(ctx context.Context, c, u, id string) (AIAgentSession, error) {
	s := AIAgentSession{ID: id, CompanyID: c, UserID: u}
	err := r.db.QueryRowContext(ctx, `SELECT prompt,instructions,skills,stopped,awaiting_turn_after,created_at FROM ai_agent_sessions WHERE company_id=$1 AND user_id=$2 AND session_id=$3`, c, u, id).Scan(&s.Prompt, &s.Instructions, &s.Skills, &s.Stopped, &s.AwaitingTurnAfter, &s.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return s, err
}
func (r *PostgresRepo) StopAIAgentSession(ctx context.Context, c, u, id string) error {
	result, err := r.db.ExecContext(ctx, `UPDATE ai_agent_sessions SET stopped=true WHERE company_id=$1 AND user_id=$2 AND session_id=$3`, c, u, id)
	return aiAffected(result, err)
}
func (r *PostgresRepo) AwaitAIAgentTurn(ctx context.Context, c, u, id, after string) error {
	result, err := r.db.ExecContext(ctx, `UPDATE ai_agent_sessions SET awaiting_turn_after=$4 WHERE company_id=$1 AND user_id=$2 AND session_id=$3`, c, u, id, after)
	return aiAffected(result, err)
}
func (r *PostgresRepo) DeleteAIAgentSession(ctx context.Context, c, u, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM ai_agent_sessions WHERE company_id=$1 AND user_id=$2 AND session_id=$3`, c, u, id)
	return aiAffected(result, err)
}
func (r *PostgresRepo) PutAIAgentAction(ctx context.Context, c, u string, a AIAgentAction) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO ai_agent_tool_calls(session_id,turn_id,call_id,name,arguments,consequential) SELECT session_id,$4,$5,$6,$7,$8 FROM ai_agent_sessions WHERE company_id=$1 AND user_id=$2 AND session_id=$3 ON CONFLICT DO NOTHING`, c, u, a.SessionID, a.TurnID, a.CallID, a.Name, a.Arguments, a.Consequential)
	return err
}
func (r *PostgresRepo) ListAIAgentActions(ctx context.Context, c, u, id string) ([]AIAgentAction, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT a.turn_id,a.call_id,a.name,a.arguments,a.state,CASE WHEN a.consequential THEN a.output ELSE NULL END,a.error,a.consequential FROM ai_agent_tool_calls a JOIN ai_agent_sessions s USING(session_id) WHERE s.company_id=$1 AND s.user_id=$2 AND s.session_id=$3 ORDER BY a.created_at,a.call_id`, c, u, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AIAgentAction{}
	for rows.Next() {
		a := AIAgentAction{SessionID: id}
		if err = rows.Scan(&a.TurnID, &a.CallID, &a.Name, &a.Arguments, &a.State, &a.Output, &a.Error, &a.Consequential); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
func (r *PostgresRepo) GetAIAgentAction(ctx context.Context, c, u, id, turn, call string) (AIAgentAction, error) {
	a := AIAgentAction{SessionID: id, TurnID: turn, CallID: call}
	err := r.db.QueryRowContext(ctx, `SELECT a.name,a.arguments,a.state,a.output,a.error,a.consequential FROM ai_agent_tool_calls a JOIN ai_agent_sessions s USING(session_id) WHERE s.company_id=$1 AND s.user_id=$2 AND s.session_id=$3 AND a.turn_id=$4 AND a.call_id=$5`, c, u, id, turn, call).Scan(&a.Name, &a.Arguments, &a.State, &a.Output, &a.Error, &a.Consequential)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return a, err
}
func (r *PostgresRepo) ClaimAIAgentAction(ctx context.Context, c, u, id, turn, call string) (bool, error) {
	result, err := r.db.ExecContext(ctx, `UPDATE ai_agent_tool_calls a SET state='executing' FROM ai_agent_sessions s WHERE a.session_id=s.session_id AND s.company_id=$1 AND s.user_id=$2 AND s.session_id=$3 AND a.turn_id=$4 AND a.call_id=$5 AND a.state='pending' AND NOT s.stopped`, c, u, id, turn, call)
	if err != nil {
		return false, err
	}
	n, err := result.RowsAffected()
	return n == 1, err
}
func (r *PostgresRepo) FinishAIAgentAction(ctx context.Context, c, u string, a AIAgentAction) error {
	result, err := r.db.ExecContext(ctx, `UPDATE ai_agent_tool_calls a SET state=$6,output=$7,error=$8 FROM ai_agent_sessions s WHERE a.session_id=s.session_id AND s.company_id=$1 AND s.user_id=$2 AND s.session_id=$3 AND a.turn_id=$4 AND a.call_id=$5 AND a.state='executing'`, c, u, a.SessionID, a.TurnID, a.CallID, a.State, a.Output, a.Error)
	return aiAffected(result, err)
}
func aiAffected(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}
