package store

import (
	"context"
	"encoding/json"
	"sort"
	"time"
)

func aiCopy(v AIAgentAction) AIAgentAction {
	v.Arguments = append(json.RawMessage(nil), v.Arguments...)
	v.Output = append(json.RawMessage(nil), v.Output...)
	return v
}
func (r *MemoryRepo) aiSession(c, u, id string) (AIAgentSession, error) {
	s, ok := r.aiAgentSessions[id]
	if !ok || s.CompanyID != c || s.UserID != u {
		return s, ErrNotFound
	}
	return s, nil
}
func (r *MemoryRepo) CreateAIAgentSession(_ context.Context, s AIAgentSession) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.aiAgentSessions == nil {
		r.aiAgentSessions = map[string]AIAgentSession{}
	}
	if _, ok := r.aiAgentSessions[s.ID]; ok {
		return ErrAlreadyExists
	}
	s.CreatedAt = time.Now().UTC()
	s.Skills = append(json.RawMessage(nil), s.Skills...)
	r.aiAgentSessions[s.ID] = s
	return nil
}
func (r *MemoryRepo) ListAIAgentSessions(_ context.Context, c, u string) ([]AIAgentSession, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := []AIAgentSession{}
	for _, s := range r.aiAgentSessions {
		if s.CompanyID == c && s.UserID == u {
			s.Skills = append(json.RawMessage(nil), s.Skills...)
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}
func (r *MemoryRepo) GetAIAgentSession(_ context.Context, c, u, id string) (AIAgentSession, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, err := r.aiSession(c, u, id)
	s.Skills = append(json.RawMessage(nil), s.Skills...)
	return s, err
}
func (r *MemoryRepo) StopAIAgentSession(_ context.Context, c, u, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, err := r.aiSession(c, u, id)
	if err != nil {
		return err
	}
	s.Stopped = true
	r.aiAgentSessions[id] = s
	return nil
}
func (r *MemoryRepo) AwaitAIAgentTurn(_ context.Context, c, u, id, after string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, err := r.aiSession(c, u, id)
	if err != nil {
		return err
	}
	s.AwaitingTurnAfter = after
	r.aiAgentSessions[id] = s
	return nil
}
func (r *MemoryRepo) DeleteAIAgentSession(_ context.Context, c, u, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.aiSession(c, u, id); err != nil {
		return err
	}
	delete(r.aiAgentSessions, id)
	delete(r.aiAgentActions, id)
	return nil
}
func (r *MemoryRepo) PutAIAgentAction(_ context.Context, c, u string, a AIAgentAction) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.aiSession(c, u, a.SessionID); err != nil {
		return err
	}
	if r.aiAgentActions == nil {
		r.aiAgentActions = map[string]map[string]AIAgentAction{}
	}
	if r.aiAgentActions[a.SessionID] == nil {
		r.aiAgentActions[a.SessionID] = map[string]AIAgentAction{}
	}
	key := a.TurnID + "/" + a.CallID
	if _, ok := r.aiAgentActions[a.SessionID][key]; !ok {
		a.State = "pending"
		r.aiAgentActions[a.SessionID][key] = aiCopy(a)
	}
	return nil
}
func (r *MemoryRepo) ListAIAgentActions(_ context.Context, c, u, id string) ([]AIAgentAction, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, err := r.aiSession(c, u, id); err != nil {
		return nil, err
	}
	out := []AIAgentAction{}
	for _, a := range r.aiAgentActions[id] {
		if !a.Consequential {
			a.Output = nil
		}
		out = append(out, aiCopy(a))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CallID < out[j].CallID })
	return out, nil
}
func (r *MemoryRepo) GetAIAgentAction(_ context.Context, c, u, id, turn, call string) (AIAgentAction, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, err := r.aiSession(c, u, id); err != nil {
		return AIAgentAction{}, err
	}
	a, ok := r.aiAgentActions[id][turn+"/"+call]
	if !ok {
		return a, ErrNotFound
	}
	return aiCopy(a), nil
}
func (r *MemoryRepo) ClaimAIAgentAction(_ context.Context, c, u, id, turn, call string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, err := r.aiSession(c, u, id)
	if err != nil {
		return false, err
	}
	key := turn + "/" + call
	a, ok := r.aiAgentActions[id][key]
	if !ok || s.Stopped || a.State != "pending" {
		return false, nil
	}
	a.State = "executing"
	r.aiAgentActions[id][key] = a
	return true, nil
}
func (r *MemoryRepo) FinishAIAgentAction(_ context.Context, c, u string, a AIAgentAction) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.aiSession(c, u, a.SessionID); err != nil {
		return err
	}
	key := a.TurnID + "/" + a.CallID
	stored := r.aiAgentActions[a.SessionID][key]
	if stored.State != "executing" {
		return ErrConflict
	}
	stored.State, stored.Output, stored.Error = a.State, a.Output, a.Error
	r.aiAgentActions[a.SessionID][key] = aiCopy(stored)
	return nil
}
