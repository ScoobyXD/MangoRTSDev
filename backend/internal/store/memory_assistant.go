package store

import (
	"context"
	"sync"
)

func (r *MemoryRepo) AcquireAssistantStream(ctx context.Context, companyID, userID, requestID string) (func(), error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if _, err := r.assistantRunLocked(companyID, userID, requestID); err != nil {
		return nil, err
	}
	id := assistantRunKey(companyID, userID, requestID)
	if r.assistantStreams[id] {
		return nil, ErrConflict
	}
	r.assistantStreams[id] = true
	var once sync.Once
	return func() { once.Do(func() { r.mu.Lock(); defer r.mu.Unlock(); delete(r.assistantStreams, id) }) }, nil
}

func assistantRunKey(companyID, userID, requestID string) string {
	return companyID + "\x00" + userID + "\x00" + requestID
}

func (r *MemoryRepo) ReserveAssistantRun(ctx context.Context, input AssistantRun) (AssistantRun, error) {
	input, err := normalizeAssistantRun(input)
	if err != nil {
		return AssistantRun{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return AssistantRun{}, err
	}
	if _, ok := r.memberships[membershipKey(input.CompanyID, input.UserID)]; !ok {
		return AssistantRun{}, ErrNotFound
	}
	id := assistantRunKey(input.CompanyID, input.UserID, input.RequestID)
	if existing, ok := r.assistantRuns[id]; ok {
		if existing.PayloadHash != input.PayloadHash {
			return AssistantRun{}, ErrConflict
		}
		return existing, nil
	}
	for _, existing := range r.assistantRuns {
		if existing.CompanyID == input.CompanyID && existing.UserID == input.UserID && !existing.Settled {
			return AssistantRun{}, ErrConflict
		}
	}
	r.assistantRuns[id] = input
	return input, nil
}

func (r *MemoryRepo) GetAssistantRun(ctx context.Context, companyID, userID, requestID string) (AssistantRun, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if err := ctx.Err(); err != nil {
		return AssistantRun{}, err
	}
	return r.assistantRunLocked(companyID, userID, requestID)
}

func (r *MemoryRepo) assistantRunLocked(companyID, userID, requestID string) (AssistantRun, error) {
	if _, ok := r.memberships[membershipKey(companyID, userID)]; !ok {
		return AssistantRun{}, ErrNotFound
	}
	run, ok := r.assistantRuns[assistantRunKey(companyID, userID, requestID)]
	if !ok {
		return AssistantRun{}, ErrNotFound
	}
	return run, nil
}

func (r *MemoryRepo) FindAssistantRun(ctx context.Context, companyID, userID, runID string) (AssistantRun, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if err := ctx.Err(); err != nil {
		return AssistantRun{}, err
	}
	if runID == "" {
		return AssistantRun{}, ErrInvalid
	}
	for _, run := range r.assistantRuns {
		if run.CompanyID == companyID && run.UserID == userID && run.RunID == runID {
			return r.assistantRunLocked(companyID, userID, run.RequestID)
		}
	}
	return AssistantRun{}, ErrNotFound
}

func (r *MemoryRepo) ActiveAssistantRun(ctx context.Context, companyID, userID string) (AssistantRun, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if err := ctx.Err(); err != nil {
		return AssistantRun{}, err
	}
	for _, run := range r.assistantRuns {
		if run.CompanyID == companyID && run.UserID == userID && !run.Settled {
			return r.assistantRunLocked(companyID, userID, run.RequestID)
		}
	}
	return AssistantRun{}, ErrNotFound
}

func (r *MemoryRepo) BindAssistantRun(ctx context.Context, companyID, userID, requestID, runID string) (AssistantRun, error) {
	if runID == "" {
		return AssistantRun{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return AssistantRun{}, err
	}
	run, err := r.assistantRunLocked(companyID, userID, requestID)
	if err != nil {
		return AssistantRun{}, err
	}
	if (run.RunID != "" && run.RunID != runID) || (run.Settled && run.RunID == "") {
		return AssistantRun{}, ErrConflict
	}
	for _, existing := range r.assistantRuns {
		if existing.CompanyID == companyID && existing.UserID == userID && existing.RequestID != requestID && existing.RunID == runID {
			return AssistantRun{}, ErrConflict
		}
	}
	run.RunID, run.Message = runID, ""
	r.assistantRuns[assistantRunKey(companyID, userID, requestID)] = run
	return run, nil
}

func (r *MemoryRepo) SettleAssistantRun(ctx context.Context, companyID, userID, requestID string) error {
	return r.updateAssistantRun(ctx, companyID, userID, requestID, true)
}
func (r *MemoryRepo) CancelAssistantRun(ctx context.Context, companyID, userID, requestID string) error {
	return r.updateAssistantRun(ctx, companyID, userID, requestID, false)
}

func (r *MemoryRepo) updateAssistantRun(ctx context.Context, companyID, userID, requestID string, settle bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	run, err := r.assistantRunLocked(companyID, userID, requestID)
	if err != nil {
		return err
	}
	if settle {
		run.Settled, run.Message = true, ""
	} else {
		run.Cancelled = true
	}
	r.assistantRuns[assistantRunKey(companyID, userID, requestID)] = run
	return nil
}

func (r *MemoryRepo) AssistantCreateNode(ctx context.Context, requested AssistantRun, actionKey string, input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	run, err := r.assistantRunLocked(requested.CompanyID, requested.UserID, requested.RequestID)
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
	if !r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, EntityTypeLogicGate, input.LogicGateID, EntityPermissionEdit) {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	id := assistantRunKey(run.CompanyID, run.UserID, run.RequestID)
	if saved, ok := r.assistantNodeActions[id][actionKey]; ok {
		saved.Events = nil
		return saved, nil
	}
	if _, exists := r.nodes[key(run.CompanyID, input.NodeID)]; exists {
		return LogicGateNodeAssignmentResult{}, ErrConflict
	}
	snapshot := r.snapshotWorkItemAssignmentEventStateLocked()
	result, err := r.assignNodeToLogicGateStatusLocked(input)
	if err != nil {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return LogicGateNodeAssignmentResult{}, err
	}
	if r.assistantNodeActions[id] == nil {
		r.assistantNodeActions[id] = map[string]LogicGateNodeAssignmentResult{}
	}
	r.assistantNodeActions[id][actionKey] = result
	return result, nil
}

func (r *MemoryRepo) deleteAssistantMemberDataLocked(companyID, userID string) {
	for id, run := range r.assistantRuns {
		if run.UserID == userID && (companyID == "" || run.CompanyID == companyID) {
			delete(r.assistantRuns, id)
			delete(r.assistantNodeActions, id)
		}
	}
}
