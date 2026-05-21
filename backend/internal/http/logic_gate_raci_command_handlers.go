package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleLogicGateRaciCommand(w http.ResponseWriter, r *http.Request, logicGateID, operation string) {
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

	assignments, ok := parseLogicGateRaciCommandAssignments(fields)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_raci_assignments")
		return
	}

	actorUserID, idempotencyKey := workItemAssignmentRequestEventMetadata(r)
	input := store.LogicGateRaciAssignmentCommandInput{
		CompanyID:      companyID,
		LogicGateID:    logicGateID,
		Assignments:    assignments,
		ActorUserID:    actorUserID,
		IdempotencyKey: idempotencyKey,
	}
	var result store.LogicGateRaciAssignmentCommandResult
	var err error
	switch operation {
	case store.LogicGateRaciCommandAdd:
		result, err = s.repo.AddLogicGateRaciAssignments(input)
	case store.LogicGateRaciCommandRemove:
		result, err = s.repo.RemoveLogicGateRaciAssignments(input)
	default:
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_raci_assignments")
		return
	}
	if errors.Is(err, store.ErrAssigneeNotInCompany) {
		writeError(w, http.StatusBadRequest, "raci_user_not_in_company")
		return
	}
	if errors.Is(err, store.ErrRaciStorageUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "logic_gate_raci_storage_unavailable")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_update_logic_gate_raci")
		return
	}

	s.publishCommittedWorkspaceEvents(result.Events)
	s.recordLogicGateRaciCommandNotifications(r, result)
	writeJSON(w, http.StatusOK, result)
}

func parseLogicGateRaciCommandAssignments(fields map[string]json.RawMessage) ([]store.LogicGateRaciAssignmentInput, bool) {
	if raw, set := fields["assignments"]; set {
		if strings.TrimSpace(string(raw)) == "" || strings.TrimSpace(string(raw)) == "null" {
			return nil, false
		}
		var assignments []store.LogicGateRaciAssignmentInput
		if err := json.Unmarshal(raw, &assignments); err != nil {
			return nil, false
		}
		return assignments, true
	}
	role, rolePresent, roleOK := parseRequiredStringJSONField(fields, "role")
	userID, userPresent, userOK := parseRequiredStringJSONField(fields, "user_id")
	if !roleOK || !userOK || !rolePresent || !userPresent {
		return nil, false
	}
	return []store.LogicGateRaciAssignmentInput{{Role: role, UserID: userID}}, true
}

func (s *Server) recordLogicGateRaciCommandNotifications(r *http.Request, result store.LogicGateRaciAssignmentCommandResult) {
	if !result.Changed {
		return
	}
	newlyAssignedUserIDs := newlyAssignedLogicGateRaciUserIDs(result.BeforeAssignments, result.RaciAssignments)
	if len(newlyAssignedUserIDs) == 0 {
		return
	}
	actorUserID, actorLabel := notificationActorPayload(r)
	logicGateTitle := ""
	if logicGate, err := s.repo.GetLogicGate(result.CompanyID, result.LogicGateID); err == nil {
		logicGateTitle = logicGate.Header
	}
	s.recordNotificationEvent(store.NotificationEventInput{
		CompanyID:      result.CompanyID,
		ActorUserID:    actorUserID,
		Type:           domain.NotificationEventLogicGateRaciUpdated,
		EntityType:     "logic_gate",
		EntityID:       result.LogicGateID,
		IdempotencyKey: "logic-gate-raci:" + result.CompanyID + ":" + result.LogicGateID + ":" + logicGateRaciFingerprint(result.RaciAssignments),
		Payload: map[string]any{
			"assignment_user_ids": newlyAssignedUserIDs,
			"actor_display_name":  actorLabel,
			"logic_gate_title":    logicGateTitle,
		},
	})
}
