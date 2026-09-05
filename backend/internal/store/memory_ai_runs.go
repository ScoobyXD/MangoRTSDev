package store

import (
	"context"
	"slices"
)

func (r *MemoryRepo) SaveAIRunContext(ctx context.Context, run AIRun) error {
	run, err := normalizeAIRun(run)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, exists := r.companies[run.CompanyID]; !exists || !r.userIDExistsLocked(run.UserID) {
		return ErrNotFound
	}
	key := run.CompanyID + ":" + run.UserID + ":" + run.AIRunsID
	if _, exists := r.aiRuns[key]; exists {
		return nil
	}
	run.InspectionJSON = slices.Clone(run.InspectionJSON)
	r.aiRuns[key] = run
	return nil
}
