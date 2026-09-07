package store

import (
	"context"
	"encoding/json"
	"sync"
)

func (r *MemoryRepo) aiMemberLocked(companyID, userID string) error {
	if _, ok := r.memberships[membershipKey(companyID, userID)]; !ok {
		return ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) aiRunLocked(companyID, userID, runID string) (AIRun, error) {
	if err := r.aiMemberLocked(companyID, userID); err != nil {
		return AIRun{}, err
	}
	run, ok := r.aiRuns[aiScopeKey(companyID, userID, runID)]
	if !ok {
		return AIRun{}, ErrNotFound
	}
	return cloneAIRun(run), nil
}

func (r *MemoryRepo) ReserveAIRun(ctx context.Context, input AIRun) (AIRun, error) {
	input, err := normalizeAIRun(input)
	if err != nil {
		return AIRun{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return AIRun{}, err
	}
	if err := r.aiMemberLocked(input.CompanyID, input.UserID); err != nil {
		return AIRun{}, err
	}
	id := aiScopeKey(input.CompanyID, input.UserID, input.RunID)
	if existing, ok := r.aiRuns[id]; ok {
		return cloneAIRun(existing), nil
	}
	for _, existing := range r.aiRuns {
		if existing.CompanyID == input.CompanyID && existing.UserID == input.UserID && !AITerminalStatus(existing.Status) {
			return AIRun{}, ErrConflict
		}
	}
	if input.ChatID != "" {
		if _, ok := r.aiChats[aiScopeKey(input.CompanyID, input.UserID, input.ChatID)]; !ok {
			return AIRun{}, ErrNotFound
		}
	}
	r.aiRuns[id] = cloneAIRun(input)
	return input, nil
}

func (r *MemoryRepo) GetAIRun(ctx context.Context, companyID, userID, runID string) (AIRun, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if err := ctx.Err(); err != nil {
		return AIRun{}, err
	}
	return r.aiRunLocked(companyID, userID, runID)
}

func (r *MemoryRepo) FindAIRun(ctx context.Context, companyID, userID, hermesRunID string) (AIRun, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if err := ctx.Err(); err != nil {
		return AIRun{}, err
	}
	if hermesRunID == "" {
		return AIRun{}, ErrInvalid
	}
	if err := r.aiMemberLocked(companyID, userID); err != nil {
		return AIRun{}, err
	}
	for _, run := range r.aiRuns {
		if run.CompanyID == companyID && run.UserID == userID && run.HermesRunID == hermesRunID {
			return cloneAIRun(run), nil
		}
	}
	return AIRun{}, ErrNotFound
}

func (r *MemoryRepo) ActiveAIRun(ctx context.Context, companyID, userID string) (AIRun, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if err := ctx.Err(); err != nil {
		return AIRun{}, err
	}
	if err := r.aiMemberLocked(companyID, userID); err != nil {
		return AIRun{}, err
	}
	for _, run := range r.aiRuns {
		if run.CompanyID == companyID && run.UserID == userID && !AITerminalStatus(run.Status) {
			return cloneAIRun(run), nil
		}
	}
	return AIRun{}, ErrNotFound
}

func (r *MemoryRepo) BindAIRun(ctx context.Context, companyID, userID, runID, hermesRunID string) (AIRun, error) {
	if hermesRunID == "" || !aiValidText(hermesRunID) {
		return AIRun{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return AIRun{}, err
	}
	run, err := r.aiRunLocked(companyID, userID, runID)
	if err != nil {
		return AIRun{}, err
	}
	if (run.HermesRunID != "" && run.HermesRunID != hermesRunID) || (AITerminalStatus(run.Status) && run.HermesRunID == "") {
		return AIRun{}, ErrConflict
	}
	for _, existing := range r.aiRuns {
		if existing.CompanyID == companyID && existing.UserID == userID && existing.RunID != runID && existing.HermesRunID == hermesRunID {
			return AIRun{}, ErrConflict
		}
	}
	run.HermesRunID, run.PendingInput = hermesRunID, ""
	if run.Status == "pending" {
		run, err = aiRunStatus(run, "running")
		if err != nil {
			return AIRun{}, err
		}
	}
	r.aiRuns[aiScopeKey(companyID, userID, runID)] = cloneAIRun(run)
	return run, nil
}

func (r *MemoryRepo) SetAIRunStatus(ctx context.Context, companyID, userID, runID, status string) (AIRun, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return AIRun{}, err
	}
	run, err := r.aiRunLocked(companyID, userID, runID)
	if err != nil {
		return AIRun{}, err
	}
	run, err = aiRunStatus(run, status)
	if err != nil {
		return AIRun{}, err
	}
	r.aiRuns[aiScopeKey(companyID, userID, runID)] = cloneAIRun(run)
	return run, nil
}

func (r *MemoryRepo) AppendAIHistoryEvent(ctx context.Context, companyID, userID, runID string, event AIHistoryEvent) (AIRun, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return AIRun{}, err
	}
	run, err := r.aiRunLocked(companyID, userID, runID)
	if err != nil {
		return AIRun{}, err
	}
	run, err = appendAIHistory(run, event)
	if err != nil {
		return AIRun{}, err
	}
	r.aiRuns[aiScopeKey(companyID, userID, runID)] = cloneAIRun(run)
	return run, nil
}

func (r *MemoryRepo) AcquireAIStream(ctx context.Context, companyID, userID, runID string) (func(), error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if _, err := r.aiRunLocked(companyID, userID, runID); err != nil {
		return nil, err
	}
	id := aiScopeKey(companyID, userID, runID)
	if r.aiStreams[id] {
		return nil, ErrConflict
	}
	r.aiStreams[id] = true
	var once sync.Once
	return func() { once.Do(func() { r.mu.Lock(); defer r.mu.Unlock(); delete(r.aiStreams, id) }) }, nil
}

func (r *MemoryRepo) AICreateNode(ctx context.Context, requested AIRun, actionKey string, input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	run, err := r.aiRunLocked(requested.CompanyID, requested.UserID, requested.RunID)
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
	if !r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, EntityTypeLogicGate, input.LogicGateID, EntityPermissionEdit) {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	action := aiActionKey{Name: aiCreateNodeAction, Key: actionKey}
	var saved LogicGateNodeAssignmentResult
	if found, err := r.loadAIActionLocked(run, action, &saved); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	} else if found {
		return saved, nil
	}
	if _, exists := r.nodes[key(run.CompanyID, input.NodeID)]; exists {
		return LogicGateNodeAssignmentResult{}, ErrConflict
	}
	snapshot := r.snapshotWorkItemAssignmentEventStateLocked()
	result, err := r.assignNodeToLogicGateStatusLocked(input)
	if err == nil {
		run, err = appendAIHistory(run, aiCommittedNodeEvent(actionKey, result))
	}
	if err == nil {
		err = r.saveAIActionLocked(run, action, result)
	}
	if err != nil {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return LogicGateNodeAssignmentResult{}, err
	}
	r.aiRuns[aiScopeKey(run.CompanyID, run.UserID, run.RunID)] = run
	return result, nil
}

func (r *MemoryRepo) loadAIActionLocked(run AIRun, action aiActionKey, result any) (bool, error) {
	receipt, found := r.aiActions[aiScopeKey(run.CompanyID, run.UserID, run.RunID)][action]
	if !found {
		return false, nil
	}
	return true, json.Unmarshal(receipt, result)
}

func (r *MemoryRepo) saveAIActionLocked(run AIRun, action aiActionKey, result any) error {
	id := aiScopeKey(run.CompanyID, run.UserID, run.RunID)
	if _, exists := r.aiActions[id][action]; exists {
		return ErrConflict
	}
	receipt, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if r.aiActions[id] == nil {
		r.aiActions[id] = map[aiActionKey][]byte{}
	}
	r.aiActions[id][action] = receipt
	return nil
}

func (r *MemoryRepo) deleteAIMemberDataLocked(companyID, userID string) {
	for id, run := range r.aiRuns {
		if run.UserID == userID && (companyID == "" || run.CompanyID == companyID) {
			delete(r.aiRuns, id)
			delete(r.aiActions, id)
		}
	}
	for id, chat := range r.aiChats {
		if chat.UserID == userID && (companyID == "" || chat.CompanyID == companyID) {
			delete(r.aiChats, id)
		}
	}
	for id, message := range r.aiMessages {
		if message.UserID == userID && (companyID == "" || message.CompanyID == companyID) {
			delete(r.aiMessages, id)
		}
	}
}
