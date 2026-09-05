package store

import "context"

func (r *PostgresRepo) SaveAIRunContext(ctx context.Context, run AIRun) error {
	run, err := normalizeAIRun(run)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `
insert into public.ai_runs (company_id, user_id, ai_runs_id, inspection_json, start_time, finish_time)
values ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5, $6)
on conflict (company_id, user_id, ai_runs_id) do nothing`,
		run.CompanyID, run.UserID, run.AIRunsID, string(run.InspectionJSON), run.StartTime, run.FinishTime)
	return err
}
