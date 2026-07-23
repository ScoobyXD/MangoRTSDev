package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type nodeTimelineCompanyRequest struct {
	CompanyID string `json:"company_id"`
}

func (s *Server) handleNodeTimelineEvents(w http.ResponseWriter, r *http.Request, nodeID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireEntityView(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") {
		return
	}
	items, err := s.repo.ListNodeTimelineEvents(companyID, nodeID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "node_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_node_timeline_events")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"timeline_events": items})
}

func (s *Server) handleNodeVerificationRequests(w http.ResponseWriter, r *http.Request, nodeID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var request nodeTimelineCompanyRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	request.CompanyID = strings.TrimSpace(request.CompanyID)
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(r.Header.Get("X-Idempotency-Key"))
	}
	if request.CompanyID == "" || idempotencyKey == "" {
		writeError(w, http.StatusBadRequest, "company_id_and_idempotency_key_required")
		return
	}
	if !s.requireEntityEdit(w, r, request.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	result, err := s.repo.CreateNodeVerificationRequest(store.NodeVerificationRequestInput{
		CompanyID: request.CompanyID, NodeID: nodeID, ActorUserID: actor.User.UserID, IdempotencyKey: idempotencyKey,
	})
	if errors.Is(err, store.ErrNoVerificationRecipients) {
		writeError(w, http.StatusConflict, "verification_recipients_required")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "node_not_found")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_verification_request")
		return
	}
	if err != nil {
		log.Printf("node_verification_request status=failed company_id=%s node_id=%s actor_user_id=%s err=%v", request.CompanyID, nodeID, actor.User.UserID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_create_verification_request")
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	s.projectCommittedNotificationEvents(result.Events)
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) handleNodeVerificationCompletion(w http.ResponseWriter, r *http.Request, nodeID, eventID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var request nodeTimelineCompanyRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	request.CompanyID = strings.TrimSpace(request.CompanyID)
	if request.CompanyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireEntityView(w, r, request.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	item, err := s.repo.CompleteNodeVerificationRequest(store.NodeVerificationCompletionInput{
		CompanyID: request.CompanyID, NodeID: nodeID, EventID: eventID, UserID: actor.User.UserID,
	})
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "verification_request_not_found")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_verification_completion")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_complete_verification_request")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"timeline_event": item})
}
