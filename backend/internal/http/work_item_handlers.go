package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"sort"
	"strings"
)

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

func (s *Server) handleWorkItemMyWorkMatrixSubresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/work-items/my-work-matrix/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) != 3 || parts[0] != "nodes" || strings.TrimSpace(parts[1]) == "" || parts[2] != "move" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	s.handleWorkItemMyWorkMatrixNodeMove(w, r, strings.TrimSpace(parts[1]))
}

func (s *Server) handleWorkItemMyWorkMatrixNodeMove(w http.ResponseWriter, r *http.Request, nodeID string) {
	timedWriter, timings := startTimedRequest(w)
	w = timedWriter
	defer func() {
		timings.log(r, timedWriter.status)
	}()
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if nodeID == "" || !isCanonicalUUID(nodeID) {
		writeError(w, http.StatusBadRequest, "invalid_node_id")
		return
	}

	var fields map[string]json.RawMessage
	stop := timings.observeAccounted("request.decode")
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	stop()

	stop = timings.observeAccounted("request.validate")
	companyID, present, ok := parseRequiredStringJSONField(fields, "company_id")
	if !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_company_id")
		return
	}
	if !present {
		stop()
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	targetRole, targetRolePresent, ok := parseRequiredStringJSONField(fields, "target_gvic_role")
	if !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_target_gvic_role")
		return
	}
	if !targetRolePresent {
		targetRole, targetRolePresent, ok = parseRequiredStringJSONField(fields, "gvic_role")
		if !ok {
			stop()
			writeError(w, http.StatusBadRequest, "invalid_gvic_role")
			return
		}
	}
	if !targetRolePresent {
		stop()
		writeError(w, http.StatusBadRequest, "target_gvic_role_required")
		return
	}
	normalizedRole, roleOK := store.NormalizeGVICRole(targetRole)
	if !roleOK {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_target_gvic_role")
		return
	}

	targetUserID := ""
	if userID, set, ok := parseOptionalStringField(fields, "target_user_id"); !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_target_user_id")
		return
	} else if set && userID != nil {
		targetUserID = strings.TrimSpace(*userID)
	}
	logicGateID := ""
	if value, set, ok := parseOptionalStringField(fields, "logic_gate_id"); !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_id")
		return
	} else if set && value != nil {
		logicGateID = strings.TrimSpace(*value)
	}
	fromLogicGateID := ""
	if value, set, ok := parseOptionalStringField(fields, "from_logic_gate_id"); !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_from_logic_gate_id")
		return
	} else if set && value != nil {
		fromLogicGateID = strings.TrimSpace(*value)
	}

	moveInput := store.LogicGateNodeAssignmentMoveInput{
		CompanyID:       companyID,
		LogicGateID:     logicGateID,
		FromLogicGateID: fromLogicGateID,
		NodeID:          nodeID,
		MutationOrigin:  store.MutationOriginMatrix,
	}
	mutatePlacement := false
	if logicGateID != "" {
		if !parseLogicGateWorkAssignmentMoveFields(w, fields, &moveInput, &mutatePlacement) {
			stop()
			return
		}
	} else {
		if priority, set, ok := parseOptionalPriorityField(fields); !ok {
			stop()
			writeError(w, http.StatusBadRequest, "invalid_priority")
			return
		} else if set {
			moveInput.Priority = priority
			moveInput.PrioritySet = true
			mutatePlacement = true
		}
	}
	stop()

	stop = timings.observeAccounted("request.auth")
	actor, ok := authenticatedActor(r)
	if !ok {
		stop()
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	actorUserID := strings.TrimSpace(actor.User.UserID)
	if targetUserID == "" {
		targetUserID = actorUserID
	}
	stop()

	stop = timings.observeAccounted("request.access_check")
	if actorRoleForCompany(actor, companyID) == "" {
		stop()
		writeError(w, http.StatusForbidden, "company_access_denied")
		return
	}
	if targetUserID == "" || !isCanonicalUUID(targetUserID) {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_target_user_id")
		return
	}
	if targetUserID != actorUserID && !actorCanManageCompany(actor, companyID) {
		stop()
		writeError(w, http.StatusForbidden, "company_admin_required")
		return
	}
	if _, err := s.repo.GetCompanyUser(companyID, targetUserID); errors.Is(err, store.ErrNotFound) {
		stop()
		writeError(w, http.StatusNotFound, "target_user_not_found")
		return
	} else if errors.Is(err, store.ErrInvalid) {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_target_user_id")
		return
	} else if err != nil {
		stop()
		writeError(w, http.StatusInternalServerError, "failed_to_load_target_user")
		return
	}
	if !s.requireEntityEdit(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") {
		stop()
		return
	}
	if logicGateID != "" && !s.requireKanbanLogicGateEffectiveAccess(w, companyID, actorUserID, logicGateID, store.EntityPermissionEdit) {
		stop()
		return
	}
	if fromLogicGateID != "" && fromLogicGateID != logicGateID && !s.requireKanbanLogicGateEffectiveAccess(w, companyID, actorUserID, fromLogicGateID, store.EntityPermissionEdit) {
		stop()
		return
	}
	stop()

	beforeRows, err := s.repo.ListGVICMatrixProjectionRowsForResources(companyID, []string{nodeID}, nil)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_my_work_move")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_my_work_projection")
		return
	}

	actorUserID, idempotencyKey := workItemAssignmentRequestEventMetadata(r)
	var node domain.Node
	var card *domain.KanbanCard
	if logicGateID != "" {
		moveInput.ActorUserID = actorUserID
		moveInput.IdempotencyKey = idempotencyKey
		moveInput.TimingRecorder = timings
		stop = timings.observeAccounted("source.logic_gate_move")
		moveResult, err := s.repo.MoveLogicGateNodeAssignment(moveInput)
		stop()
		if !writeLogicGateWorkMutationError(w, err, "failed_to_move_my_work_node") {
			return
		}
		node = moveResult.Node
		cardValue := moveResult.Card
		card = &cardValue
		s.projectCommittedWorkspaceDerivedEventsWithTiming(moveResult.Events, timings)
		s.publishCommittedWorkspaceEventsWithTiming(moveResult.Events, timings)
		s.projectCommittedNotificationEventsWithTiming(moveResult.Events, timings)
	} else if mutatePlacement {
		updateInput := store.UpdateNodeInput{CompanyID: companyID, NodeID: nodeID, Priority: moveInput.Priority, PrioritySet: moveInput.PrioritySet, ActorUserID: actorUserID}
		stop = timings.observeAccounted("source.node_update")
		updatedNode, event, err := s.repo.UpdateNodeAndWorkspaceEvent(updateInput)
		stop()
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
			return
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_node_update")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_update_my_work_node")
			return
		}
		node = updatedNode
		s.publishCommittedWorkspaceEvent(event)
		s.projectCommittedNotificationEvents([]domain.DomainEvent{event})
	} else {
		node, err = s.repo.GetNode(companyID, nodeID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_my_work_node")
			return
		}
	}

	stop = timings.observeAccounted("source.gvic_role_update")
	_, err = s.repo.AddResourceGVICAssignments(store.ResourceGVICAssignmentCommandInput{
		CompanyID:    companyID,
		ResourceType: store.EntityTypeNode,
		ResourceID:   nodeID,
		Assignments: []store.ResourceGVICAssignmentInput{{
			Role:          normalizedRole,
			PrincipalType: store.EntityPermissionSubjectUser,
			PrincipalID:   targetUserID,
		}},
		ActorUserID:    actorUserID,
		IdempotencyKey: idempotencyKey,
	})
	stop()
	if errors.Is(err, store.ErrPrincipalNotInCompany) {
		writeError(w, http.StatusBadRequest, "target_user_not_in_company")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "node_not_found")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_my_work_gvic_role")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_update_my_work_gvic_role")
		return
	}

	afterRows, err := s.repo.ListGVICMatrixProjectionRowsForResources(companyID, []string{nodeID}, nil)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_my_work_move")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_my_work_projection")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"company_id":                 companyID,
		"node":                       node,
		"card":                       card,
		"gvic_projection_rows":       afterRows,
		"removed_projection_row_ids": removedGVICMatrixProjectionRowIDs(beforeRows, afterRows),
	})
}

func removedGVICMatrixProjectionRowIDs(beforeRows, afterRows []store.GVICMatrixProjectionRow) []string {
	afterIDs := map[string]bool{}
	for _, row := range afterRows {
		if id := strings.TrimSpace(row.ProjectionRowID); id != "" {
			afterIDs[id] = true
		}
	}
	out := make([]string, 0)
	seen := map[string]bool{}
	for _, row := range beforeRows {
		id := strings.TrimSpace(row.ProjectionRowID)
		if id == "" || afterIDs[id] || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

func (s *Server) handleWorkItemLogicGateAssignments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var fields map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID, companyIDSet, ok := parseOptionalStringField(fields, "company_id")
	if !ok || !companyIDSet || companyID == nil || strings.TrimSpace(*companyID) == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	logicGateID, logicGateIDSet, ok := parseOptionalStringField(fields, "logic_gate_id")
	if !ok || !logicGateIDSet || logicGateID == nil || strings.TrimSpace(*logicGateID) == "" {
		writeError(w, http.StatusBadRequest, "logic_gate_id_required")
		return
	}
	nodeID, nodeIDSet, ok := parseOptionalStringField(fields, "node_id")
	if !ok || !nodeIDSet || nodeID == nil || strings.TrimSpace(*nodeID) == "" {
		writeError(w, http.StatusBadRequest, "node_id_required")
		return
	}

	input := store.LogicGateNodeAssignmentInput{
		CompanyID:   strings.TrimSpace(*companyID),
		LogicGateID: strings.TrimSpace(*logicGateID),
		NodeID:      strings.TrimSpace(*nodeID),
	}
	if status, set, ok := parseOptionalStringField(fields, "status"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_status")
		return
	} else if set && status != nil {
		input.Status = *status
	}
	if columnID, set, ok := parseOptionalStringField(fields, "column_id"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_column_id")
		return
	} else if set && columnID != nil {
		input.ColumnID = *columnID
	}
	if nodeTitle, set, ok := parseOptionalStringField(fields, "node_title"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_node_title")
		return
	} else if set && nodeTitle != nil {
		input.NodeTitle = *nodeTitle
	}
	if description, set, ok := parseOptionalStringField(fields, "description_snapshot"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_description_snapshot")
		return
	} else if set && description != nil {
		input.DescriptionSnapshot = *description
	}
	if _, present := fields["assignee_policy"]; present {
		writeError(w, http.StatusBadRequest, "unsupported_assignee_policy")
		return
	}
	if priority, set, ok := parseOptionalPriorityField(fields); !ok {
		writeError(w, http.StatusBadRequest, "invalid_priority")
		return
	} else if set {
		input.Priority = priority
		input.PrioritySet = true
	}
	if position, set, ok := parseOptionalNonNegativeIntField(fields, "position"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_position")
		return
	} else if set {
		input.Position = position
	}
	if isIssue, set, ok := parseOptionalBoolField(fields, "is_issue"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_is_issue")
		return
	} else if set {
		input.IsIssue = isIssue
		input.IsIssueSet = true
	}
	if !s.requireKanbanLogicGateEffectiveAccess(w, input.CompanyID, s.entityPermissionActorUserID(r, input.CompanyID), input.LogicGateID, store.EntityPermissionEdit) {
		return
	}

	input.ActorUserID, input.IdempotencyKey = workItemAssignmentRequestEventMetadata(r)
	result, err := s.kanban.AssignNodeToLogicGateStatus(input)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_assignment")
		return
	}
	if errors.Is(err, store.ErrPriorityRequired) {
		writeError(w, http.StatusBadRequest, "priority_required")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_column_or_node_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_assign_logic_gate_node")
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	s.projectCommittedNotificationEvents(result.Events)
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleWorkItemLogicGateAssignmentMove(w http.ResponseWriter, r *http.Request) {
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
	logicGateID, present, ok := parseRequiredStringJSONField(fields, "logic_gate_id")
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_id")
		return
	}
	if !present {
		writeError(w, http.StatusBadRequest, "logic_gate_id_required")
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

	input := store.LogicGateNodeAssignmentMoveInput{CompanyID: companyID, LogicGateID: logicGateID, NodeID: nodeID}
	if fromLogicGateID, set, ok := parseOptionalStringField(fields, "from_logic_gate_id"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_from_logic_gate_id")
		return
	} else if set && fromLogicGateID != nil {
		input.FromLogicGateID = *fromLogicGateID
	}
	if status, set, ok := parseOptionalStringField(fields, "status"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_status")
		return
	} else if set && status != nil {
		input.Status = *status
	}
	if columnID, set, ok := parseOptionalStringField(fields, "column_id"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_column_id")
		return
	} else if set && columnID != nil {
		input.ColumnID = *columnID
	}
	if _, present := fields["assignee_policy"]; present {
		writeError(w, http.StatusBadRequest, "unsupported_assignee_policy")
		return
	}
	if priority, set, ok := parseOptionalPriorityField(fields); !ok {
		writeError(w, http.StatusBadRequest, "invalid_priority")
		return
	} else if set {
		input.Priority = priority
		input.PrioritySet = true
	}
	if position, set, ok := parseOptionalNonNegativeIntField(fields, "position"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_position")
		return
	} else if set {
		input.Position = position
	}
	userID := s.entityPermissionActorUserID(r, input.CompanyID)
	if !s.requireKanbanLogicGateEffectiveAccess(w, input.CompanyID, userID, input.LogicGateID, store.EntityPermissionEdit) {
		return
	}
	if input.FromLogicGateID != "" && input.FromLogicGateID != input.LogicGateID && !s.requireKanbanLogicGateEffectiveAccess(w, input.CompanyID, userID, input.FromLogicGateID, store.EntityPermissionEdit) {
		return
	}

	input.ActorUserID, input.IdempotencyKey = workItemAssignmentRequestEventMetadata(r)
	result, err := s.kanban.MoveLogicGateNodeAssignment(input)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_assignment_move")
		return
	}
	if errors.Is(err, store.ErrPriorityRequired) {
		writeError(w, http.StatusBadRequest, "priority_required")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_assignment_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_move_logic_gate_assignment")
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	s.projectCommittedNotificationEvents(result.Events)
	writeJSON(w, http.StatusOK, result)
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
	result, err := s.kanban.RemoveLogicGateNodeAssignment(input)
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
	result, err := s.kanban.SetLogicGateNodeAssignmentIssue(input)
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
