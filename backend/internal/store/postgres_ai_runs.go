package store

import "context"

func (r *PostgresRepo) SaveAIRunContext(ctx context.Context, run AIRun) error {
	run, err := normalizeAIRun(run)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `
insert into public."AI_runs" (company_id, user_id, "AI_runs_id", start_time, finish_time, inspection_json)
values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb)
on conflict (company_id, user_id, "AI_runs_id") do nothing`,
		run.CompanyID, run.UserID, run.AIRunsID, run.StartTime, run.FinishTime, string(run.InspectionJSON))
	return err
}
