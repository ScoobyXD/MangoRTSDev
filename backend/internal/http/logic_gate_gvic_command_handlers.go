package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleLogicGateRACICommand(w http.ResponseWriter, r *http.Request, logicGateID, operation string) {
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
	if !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
		return
	}

	assignments, ok := parseLogicGateRACICommandAssignments(fields)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_gvic_assignments")
		return
	}

	actorUserID, idempotencyKey := workItemAssignmentRequestEventMetadata(r)
	input := store.LogicGateRACIAssignmentCommandInput{
		CompanyID:      companyID,
		LogicGateID:    logicGateID,
		Assignments:    assignments,
		ActorUserID:    actorUserID,
		IdempotencyKey: idempotencyKey,
	}
	var result store.LogicGateRACIAssignmentCommandResult
	var err error
	switch operation {
	case store.LogicGateRACICommandAdd:
		result, err = s.repo.AddLogicGateRACIAssignments(input)
	case store.LogicGateRACICommandRemove:
		result, err = s.repo.RemoveLogicGateRACIAssignments(input)
	default:
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_gvic_assignments")
		return
	}
	if errors.Is(err, store.ErrPrincipalNotInCompany) {
		writeError(w, http.StatusBadRequest, "gvic_principal_not_in_company")
		return
	}
	if errors.Is(err, store.ErrRACIStorageUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "logic_gate_RACI_storage_unavailable")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_update_logic_gate_RACI")
		return
	}

	s.publishCommittedWorkspaceEvents(result.Events)
	s.projectCommittedNotificationEvents(result.Events)
	writeJSON(w, http.StatusOK, result)
}

func parseLogicGateRACICommandAssignments(fields map[string]json.RawMessage) ([]store.LogicGateRACIAssignmentInput, bool) {
	if raw, set := fields["assignments"]; set {
		if strings.TrimSpace(string(raw)) == "" || strings.TrimSpace(string(raw)) == "null" {
			return nil, false
		}
		var assignments []store.LogicGateRACIAssignmentInput
		if err := json.Unmarshal(raw, &assignments); err != nil {
			return nil, false
		}
		return assignments, true
	}
	role, rolePresent, roleOK := parseRequiredStringJSONField(fields, "role")
	userID, userPresent, userOK := parseRequiredStringJSONField(fields, "user_id")
	principalType, principalTypePresent, principalTypeOK := parseRequiredStringJSONField(fields, "principal_type")
	principalID, principalIDPresent, principalIDOK := parseRequiredStringJSONField(fields, "principal_id")
	if !roleOK || !rolePresent || !userOK || !principalTypeOK || !principalIDOK {
		return nil, false
	}
	if principalTypePresent || principalIDPresent {
		if !principalTypePresent || !principalIDPresent {
			return nil, false
		}
		return []store.LogicGateRACIAssignmentInput{{Role: role, PrincipalType: principalType, PrincipalID: principalID, UserID: userID}}, true
	}
	if !userPresent {
		return nil, false
	}
	return []store.LogicGateRACIAssignmentInput{{Role: role, UserID: userID}}, true
}
