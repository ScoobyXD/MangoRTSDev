package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
)

func parsePositiveLimit(raw string, fallback int, maximum int) (int, bool) {
	value := fallback
	if strings.TrimSpace(raw) != "" {
		parsed, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || parsed <= 0 {
			return 0, false
		}
		value = parsed
	}
	if value > maximum {
		value = maximum
	}
	return value, true
}

func parseOptionalBoolField(fields map[string]json.RawMessage, key string) (bool, bool, bool) {
	raw, ok := fields[key]
	if !ok {
		return false, false, true
	}
	if strings.TrimSpace(string(raw)) == "null" {
		return false, true, true
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, true, false
	}
	return value, true, true
}

func parseOptionalNonNegativeIntField(fields map[string]json.RawMessage, key string) (int, bool, bool) {
	raw, ok := fields[key]
	if !ok {
		return 0, false, true
	}
	if strings.TrimSpace(string(raw)) == "null" {
		return 0, true, true
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, true, false
	}
	return value, true, value >= 0
}

func parseRequiredStringJSONField(fields map[string]json.RawMessage, key string) (string, bool, bool) {
	value, set, ok := parseOptionalStringField(fields, key)
	if !ok {
		return "", true, false
	}
	if !set || value == nil || strings.TrimSpace(*value) == "" {
		return "", false, true
	}
	return strings.TrimSpace(*value), true, true
}

func parseRequiredBoolJSONField(fields map[string]json.RawMessage, key string) (bool, bool, bool) {
	raw, set := fields[key]
	if !set || strings.TrimSpace(string(raw)) == "null" {
		return false, false, true
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, true, false
	}
	return value, true, true
}

func workItemAssignmentRequestEventMetadata(r *http.Request) (string, string) {
	actorUserID := ""
	if actor, ok := authenticatedActor(r); ok {
		actorUserID = strings.TrimSpace(actor.User.UserID)
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(r.Header.Get("X-Idempotency-Key"))
	}
	return actorUserID, idempotencyKey
}
func optionalStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func (s *Server) handleWorkItemLogicGateAssignmentRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var fields map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID, present, ok := parseRequiredStringJSONField(fields, "company_id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_company_id")
		return
	}
	if !present {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	nodeID, present, ok := parseRequiredStringJSONField(fields, "node_id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_node_id")
		return
	}
	if !present {
		writeError(w, http.StatusBadRequest, "node_id_required")
		return
	}

	input := store.LogicGateNodeAssignmentRemoveInput{CompanyID: companyID, NodeID: nodeID}
	if logicGateID, set, ok := parseOptionalStringField(fields, "logic_gate_id"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_id")
		return
	} else if set && logicGateID != nil {
		input.LogicGateID = *logicGateID
	}
	if fallbackStatus, set, ok := parseOptionalStringField(fields, "fallback_status"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_fallback_status")
		return
	} else if set {
		input.FallbackStatus = optionalStringPointer(fallbackStatus)
	}
	if _, present := fields["fallback_status_color"]; present {
		writeError(w, http.StatusBadRequest, "unsupported_fallback_status_color")
		return
	}
	userID := s.entityPermissionActorUserID(r, input.CompanyID)
	if input.LogicGateID == "" && userID != "" {
		writeError(w, http.StatusBadRequest, "logic_gate_id_required")
		return
	}
	if input.LogicGateID != "" && !s.requireKanbanLogicGateEffectiveAccess(w, input.CompanyID, userID, input.LogicGateID, store.EntityPermissionEdit) {
		return
	}

	input.ActorUserID, input.IdempotencyKey = workItemAssignmentRequestEventMetadata(r)
	result, err := s.repo.RemoveLogicGateNodeAssignment(input)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_assignment_remove")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_assignment_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_remove_logic_gate_assignment")
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	s.projectCommittedNotificationEvents(result.Events)
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleWorkItemLogicGateAssignmentIssue(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var fields map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID, present, ok := parseRequiredStringJSONField(fields, "company_id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_company_id")
		return
	}
	if !present {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	nodeID, present, ok := parseRequiredStringJSONField(fields, "node_id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_node_id")
		return
	}
	if !present {
		writeError(w, http.StatusBadRequest, "node_id_required")
		return
	}
	isIssue, present, ok := parseRequiredBoolJSONField(fields, "is_issue")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_is_issue")
		return
	}
	if !present {
		writeError(w, http.StatusBadRequest, "is_issue_required")
		return
	}

	input := store.LogicGateNodeAssignmentIssueInput{CompanyID: companyID, NodeID: nodeID, IsIssue: isIssue}
	if logicGateID, set, ok := parseOptionalStringField(fields, "logic_gate_id"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_id")
		return
	} else if set && logicGateID != nil {
		input.LogicGateID = *logicGateID
	}
	userID := s.entityPermissionActorUserID(r, input.CompanyID)
	if input.LogicGateID == "" && userID != "" {
		writeError(w, http.StatusBadRequest, "logic_gate_id_required")
		return
	}
	if input.LogicGateID != "" && !s.requireKanbanLogicGateEffectiveAccess(w, input.CompanyID, userID, input.LogicGateID, store.EntityPermissionEdit) {
		return
	}

	input.ActorUserID, input.IdempotencyKey = workItemAssignmentRequestEventMetadata(r)
	result, err := s.repo.SetLogicGateNodeAssignmentIssue(input)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_assignment_issue")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_assignment_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_update_logic_gate_assignment_issue")
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	s.projectCommittedNotificationEvents(result.Events)
	writeJSON(w, http.StatusOK, result)
}
