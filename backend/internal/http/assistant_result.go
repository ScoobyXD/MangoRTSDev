package httpapi

import (
	"context"
	"net/http"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type assistantResultProcess struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// A request receipt retains only saved resource links, never prompts or traces.
type assistantResult struct {
	Finished bool                    `json:"finished"`
	Process  *assistantResultProcess `json:"process,omitempty"`
	NodeID   string                  `json:"node_id,omitempty"`
	done     chan struct{}
}

func (a *mangoAssistant) recordAssistantResult(key string, event assistantEvent) {
	a.mu.Lock()
	defer a.mu.Unlock()
	result := a.results[key]
	if result == nil || result.Finished {
		return
	}
	switch event.Type {
	case "process":
		result.Process = &assistantResultProcess{ID: event.ProcessID, Name: event.Name}
	case "node":
		result.NodeID = event.NodeID
	}
}

func (a *mangoAssistant) finishAssistantResult(key string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if result := a.results[key]; result != nil && !result.Finished {
		result.Finished = true
		close(result.done)
	}
}

func (s *Server) handleAssistantResult(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if r.Context().Err() != nil {
		return
	}
	actor, ok := s.requireAssistantActor(w, r)
	if !ok {
		return
	}
	id := r.URL.Query().Get("request_id")
	if !isUUIDText(id) {
		writeError(w, http.StatusBadRequest, "invalid_assistant_request")
		return
	}
	if s.assistant == nil {
		writeError(w, http.StatusNotFound, "assistant_result_unavailable")
		return
	}
	a := s.assistant
	key := actor.CompanyID + ":" + actor.User.UserID + ":" + id
	a.mu.Lock()
	result := a.results[key]
	if time.Now().After(a.requests[key]) {
		result = nil
	}
	a.mu.Unlock()
	if result == nil {
		writeError(w, http.StatusNotFound, "assistant_result_unavailable")
		return
	}
	select {
	case <-result.done:
	case <-time.After(5 * time.Second):
	case <-r.Context().Done():
		return
	}
	if r.Context().Err() != nil {
		return
	}
	actor, ok = s.requireAssistantActor(w, r)
	if !ok {
		return
	}
	// Permission helpers must use the role reloaded after waiting, not cached claims.
	actor.IsDevAdmin = actor.CompanyRole == domain.RoleDevAdmin
	actor.Memberships = []domain.CompanyMembership{{CompanyID: actor.CompanyID, UserID: actor.User.UserID, Role: actor.CompanyRole}}
	r = r.Clone(context.WithValue(r.Context(), actorContextKey{}, actor))
	a.mu.Lock()
	if time.Now().After(a.requests[key]) || a.results[key] != result {
		a.mu.Unlock()
		writeError(w, http.StatusNotFound, "assistant_result_unavailable")
		return
	}
	snapshot := assistantResult{Finished: result.Finished, NodeID: result.NodeID}
	if result.Process != nil {
		process := *result.Process
		snapshot.Process = &process
	}
	a.mu.Unlock()
	if snapshot.Process != nil {
		access := &assistantToolResponse{header: make(http.Header)}
		if !s.requireEntityView(access, r, actor.CompanyID, store.EntityTypeLogicGate, snapshot.Process.ID, "logic_gate_not_found") {
			snapshot.Process = nil
		} else if current, err := s.repo.GetLogicGate(actor.CompanyID, snapshot.Process.ID); err != nil {
			snapshot.Process = nil
		} else {
			snapshot.Process.Name = current.Header
		}
	}
	if snapshot.NodeID != "" {
		access := &assistantToolResponse{header: make(http.Header)}
		if !s.requireEntityView(access, r, actor.CompanyID, store.EntityTypeNode, snapshot.NodeID, "node_not_found") {
			snapshot.NodeID = ""
		} else if _, err := s.repo.GetNode(actor.CompanyID, snapshot.NodeID); err != nil {
			snapshot.NodeID = ""
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, snapshot)
}
