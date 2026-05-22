package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleLogicGateWorkV2Subresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v2/logic-gates/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	logicGateID := strings.TrimSpace(parts[0])
	switch {
	case len(parts) == 2 && parts[1] == "view":
		s.handleLogicGateViewV2(w, r, logicGateID)
	case len(parts) == 2 && parts[1] == "work":
		s.handleLogicGateWorkV2(w, r, logicGateID)
	case len(parts) == 2 && parts[1] == "nodes":
		s.handleLogicGateWorkNodeCreateV2(w, r, logicGateID)
	case len(parts) == 3 && parts[1] == "nodes":
		s.handleLogicGateWorkNodeDeleteV2(w, r, logicGateID, strings.TrimSpace(parts[2]))
	case len(parts) == 4 && parts[1] == "nodes" && parts[3] == "state":
		s.handleLogicGateWorkNodeStateV2(w, r, logicGateID, strings.TrimSpace(parts[2]))
	default:
		writeError(w, http.StatusNotFound, "not_found")
	}
}

func (s *Server) handleLogicGateWorkV2(w http.ResponseWriter, r *http.Request, logicGateID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, logicGateID, store.EntityPermissionView) {
		return
	}
	work, err := s.repo.GetLogicGateWork(companyID, logicGateID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_work_request")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return
	}
	if err != nil {
		log.Printf("failed to load v2 logic gate work company_id=%s logic_gate_id=%s: %v", companyID, logicGateID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_work")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, work)
}

func (s *Server) handleLogicGateWorkNodeCreateV2(w http.ResponseWriter, r *http.Request, logicGateID string) {
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
	if !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, logicGateID, store.EntityPermissionEdit) {
		return
	}

	input := store.LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: logicGateID, NodeID: nodeID}
	if !parseLogicGateWorkAssignmentCreateFields(w, fields, &input) {
		return
	}
	input.ActorUserID, input.IdempotencyKey = workItemAssignmentRequestEventMetadata(r)
	result, err := s.repo.AssignNodeToLogicGateStatus(input)
	if !writeLogicGateWorkMutationError(w, err, "failed_to_assign_logic_gate_work_node") {
		return
	}
	s.refreshEffectiveAccessProjection(companyID, "logic_gate_work_node_assigned")
	s.publishCommittedWorkspaceEvents(result.Events)
	writeJSON(w, http.StatusCreated, logicGateWorkAssignmentResultPayload(result))
}

func (s *Server) handleLogicGateWorkNodeStateV2(w http.ResponseWriter, r *http.Request, logicGateID, nodeID string) {
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if nodeID == "" {
		writeError(w, http.StatusNotFound, "node_not_found")
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
	if !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, logicGateID, store.EntityPermissionEdit) {
		return
	}

	input := store.LogicGateNodeAssignmentMoveInput{CompanyID: companyID, LogicGateID: logicGateID, NodeID: nodeID}
	mutateAssignment := false
	if !parseLogicGateWorkAssignmentMoveFields(w, fields, &input, &mutateAssignment) {
		return
	}
	isIssue, issueSet, ok := parseOptionalBoolField(fields, "is_issue")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_is_issue")
		return
	}
	if !mutateAssignment && !issueSet {
		writeError(w, http.StatusBadRequest, "logic_gate_work_state_change_required")
		return
	}

	actorUserID, idempotencyKey := workItemAssignmentRequestEventMetadata(r)
	var result store.LogicGateNodeAssignmentResult
	if mutateAssignment {
		input.ActorUserID = actorUserID
		input.IdempotencyKey = idempotencyKey
		var err error
		result, err = s.repo.MoveLogicGateNodeAssignment(input)
		if !writeLogicGateWorkMutationError(w, err, "failed_to_update_logic_gate_work_node_state") {
			return
		}
		s.refreshEffectiveAccessProjection(companyID, "logic_gate_work_node_moved")
		s.publishCommittedWorkspaceEvents(result.Events)
	}
	if issueSet {
		issueResult, err := s.repo.SetLogicGateNodeAssignmentIssue(store.LogicGateNodeAssignmentIssueInput{
			CompanyID:      companyID,
			LogicGateID:    logicGateID,
			NodeID:         nodeID,
			IsIssue:        isIssue,
			ActorUserID:    actorUserID,
			IdempotencyKey: idempotencyKey,
		})
		if !writeLogicGateWorkMutationError(w, err, "failed_to_update_logic_gate_work_node_issue_state") {
			return
		}
		s.refreshEffectiveAccessProjection(companyID, "logic_gate_work_node_issue_toggled")
		s.publishCommittedWorkspaceEvents(issueResult.Events)
		result = issueResult
	}
	writeJSON(w, http.StatusOK, logicGateWorkAssignmentResultPayload(result))
}

func (s *Server) handleLogicGateWorkNodeDeleteV2(w http.ResponseWriter, r *http.Request, logicGateID, nodeID string) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if nodeID == "" {
		writeError(w, http.StatusNotFound, "node_not_found")
		return
	}
	if !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, logicGateID, store.EntityPermissionEdit) {
		return
	}
	actorUserID, idempotencyKey := workItemAssignmentRequestEventMetadata(r)
	fallbackStatus := r.URL.Query().Get("fallback_status")
	fallbackStatusColor := r.URL.Query().Get("fallback_status_color")
	result, err := s.repo.RemoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentRemoveInput{
		CompanyID:           companyID,
		LogicGateID:         logicGateID,
		NodeID:              nodeID,
		FallbackStatus:      optionalStringPointer(&fallbackStatus),
		FallbackStatusColor: optionalStringPointer(&fallbackStatusColor),
		ActorUserID:         actorUserID,
		IdempotencyKey:      idempotencyKey,
	})
	if !writeLogicGateWorkRemoveError(w, err) {
		return
	}
	s.refreshEffectiveAccessProjection(companyID, "logic_gate_work_node_removed")
	s.publishCommittedWorkspaceEvents(result.Events)
	payload := logicGateWorkAssignmentRemoveResultPayload(result)
	writeJSON(w, http.StatusOK, payload)
}

func parseLogicGateWorkAssignmentCreateFields(w http.ResponseWriter, fields map[string]json.RawMessage, input *store.LogicGateNodeAssignmentInput) bool {
	if status, set, ok := parseOptionalStringField(fields, "status"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_status")
		return false
	} else if set && status != nil {
		statusKey, valid := store.NormalizeLogicGateWorkStatusKey(*status)
		if !valid {
			writeError(w, http.StatusBadRequest, "invalid_status")
			return false
		}
		if statusKey != "" {
			input.Status = store.LogicGateWorkStatusTitle(statusKey)
		}
	}
	if nodeTitle, set, ok := parseOptionalStringField(fields, "node_title"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_node_title")
		return false
	} else if set && nodeTitle != nil {
		input.NodeTitle = *nodeTitle
	}
	if description, set, ok := parseOptionalStringField(fields, "description_snapshot"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_description_snapshot")
		return false
	} else if set && description != nil {
		input.DescriptionSnapshot = *description
	}
	if assigneePolicy, set, ok := parseOptionalStringField(fields, "assignee_policy"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_assignee_policy")
		return false
	} else if set && assigneePolicy != nil {
		input.AssigneePolicy = *assigneePolicy
	}
	if priority, set, ok := parseOptionalPriorityField(fields); !ok {
		writeError(w, http.StatusBadRequest, "invalid_priority")
		return false
	} else if set {
		input.Priority = priority
		input.PrioritySet = true
	}
	if position, set, ok := parseOptionalNonNegativeIntField(fields, "position"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_position")
		return false
	} else if set {
		input.Position = position
	}
	if isIssue, set, ok := parseOptionalBoolField(fields, "is_issue"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_is_issue")
		return false
	} else if set {
		input.IsIssue = isIssue
		input.IsIssueSet = true
	}
	return true
}

func parseLogicGateWorkAssignmentMoveFields(w http.ResponseWriter, fields map[string]json.RawMessage, input *store.LogicGateNodeAssignmentMoveInput, changed *bool) bool {
	if status, set, ok := parseOptionalStringField(fields, "status"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_status")
		return false
	} else if set && status != nil {
		statusKey, valid := store.NormalizeLogicGateWorkStatusKey(*status)
		if !valid {
			writeError(w, http.StatusBadRequest, "invalid_status")
			return false
		}
		if statusKey != "" {
			input.Status = store.LogicGateWorkStatusTitle(statusKey)
			*changed = true
		}
	}
	if assigneePolicy, set, ok := parseOptionalStringField(fields, "assignee_policy"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_assignee_policy")
		return false
	} else if set && assigneePolicy != nil && strings.TrimSpace(*assigneePolicy) != "" {
		input.AssigneePolicy = *assigneePolicy
		input.AssigneePolicySet = true
		*changed = true
	}
	if priority, set, ok := parseOptionalPriorityField(fields); !ok {
		writeError(w, http.StatusBadRequest, "invalid_priority")
		return false
	} else if set {
		input.Priority = priority
		input.PrioritySet = true
		*changed = true
	}
	if position, set, ok := parseOptionalNonNegativeIntField(fields, "position"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_position")
		return false
	} else if set {
		input.Position = position
		if position > 0 {
			*changed = true
		}
	}
	return true
}

func (s *Server) requireLogicGateWorkEffectiveAccess(w http.ResponseWriter, r *http.Request, companyID, logicGateID, accessLevel string) bool {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return false
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return false
	}
	hasAccess, err := s.repo.UserHasEffectiveAccess(companyID, actor.User.UserID, store.EntityTypeLogicGate, logicGateID, accessLevel)
	if err != nil {
		log.Printf("failed to check v2 logic gate work access company_id=%s logic_gate_id=%s user_id=%s access=%s: %v", companyID, logicGateID, actor.User.UserID, accessLevel, err)
		writeError(w, http.StatusInternalServerError, "failed_to_check_logic_gate_access")
		return false
	}
	if hasAccess {
		return true
	}
	if accessLevel == store.EntityPermissionEdit || accessLevel == store.EntityPermissionAdmin {
		canView, err := s.repo.UserHasEffectiveAccess(companyID, actor.User.UserID, store.EntityTypeLogicGate, logicGateID, store.EntityPermissionView)
		if err != nil {
			log.Printf("failed to check v2 logic gate work view fallback company_id=%s logic_gate_id=%s user_id=%s: %v", companyID, logicGateID, actor.User.UserID, err)
			writeError(w, http.StatusInternalServerError, "failed_to_check_logic_gate_access")
			return false
		}
		if canView {
			writeAccessActionDenied(w)
			return false
		}
	}
	writeAccessResourceNotFound(w)
	return false
}

func writeLogicGateWorkMutationError(w http.ResponseWriter, err error, fallback string) bool {
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_work_assignment")
		return false
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_work_assignment_not_found")
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, fallback)
		return false
	}
	return true
}

func writeLogicGateWorkRemoveError(w http.ResponseWriter, err error) bool {
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_work_assignment")
		return false
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_work_assignment_not_found")
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_remove_logic_gate_work_node")
		return false
	}
	return true
}

func logicGateWorkAssignmentResultPayload(result store.LogicGateNodeAssignmentResult) map[string]any {
	assignment := canonicalLogicGateWorkAssignment(result.Assignment)
	return map[string]any{
		"assignment": assignment,
		"node":       result.Node,
		"card":       result.Card,
	}
}

func logicGateWorkAssignmentRemoveResultPayload(result store.LogicGateNodeAssignmentRemoveResult) map[string]any {
	assignment := canonicalLogicGateWorkAssignment(result.Assignment)
	return map[string]any{
		"assignment": assignment,
		"node":       result.Node,
		"card":       result.Card,
	}
}

func canonicalLogicGateWorkAssignment(assignment domain.NodeLogicGateAssignment) domain.NodeLogicGateAssignment {
	if statusKey, ok := store.NormalizeLogicGateWorkStatusKey(assignment.StatusKey); ok && statusKey != "" {
		assignment.StatusKey = statusKey
	}
	return assignment
}
