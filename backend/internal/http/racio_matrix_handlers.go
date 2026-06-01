package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleRacioMatrixNodesV2(w http.ResponseWriter, r *http.Request) {
	timedWriter, timings := startTimedRequest(w)
	w = timedWriter
	defer func() {
		timings.log(r, timedWriter.status)
	}()
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var fields map[string]json.RawMessage
	stop := timings.observe("request_decode_validation")
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
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
	stop()
	stop = timings.observe("auth_access")
	actor, ok := authenticatedActor(r)
	if !ok {
		stop()
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if actorRoleForCompany(actor, companyID) == "" {
		stop()
		writeError(w, http.StatusForbidden, "company_access_denied")
		return
	}
	stop()

	input := store.RacioMatrixNodeCreateInput{CompanyID: companyID, ActorUserID: strings.TrimSpace(actor.User.UserID)}
	stop = timings.observe("request_decode_validation")
	if nodeID, set, ok := parseOptionalStringField(fields, "node_id"); !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_node_id")
		return
	} else if set && nodeID != nil {
		input.NodeID = *nodeID
		if input.NodeID != "" && !isCanonicalUUID(input.NodeID) {
			stop()
			writeError(w, http.StatusBadRequest, "invalid_node_id")
			return
		}
	}
	if title, set, ok := parseOptionalStringField(fields, "title"); !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_title")
		return
	} else if set && title != nil {
		input.Title = *title
	}
	if input.Title == "" {
		if title, set, ok := parseOptionalStringField(fields, "node_title"); !ok {
			stop()
			writeError(w, http.StatusBadRequest, "invalid_node_title")
			return
		} else if set && title != nil {
			input.Title = *title
		}
	}
	if input.Title == "" {
		if title, set, ok := parseOptionalStringField(fields, "create_node_title"); !ok {
			stop()
			writeError(w, http.StatusBadRequest, "invalid_create_node_title")
			return
		} else if set && title != nil {
			input.Title = *title
		}
	}
	if strings.TrimSpace(input.Title) == "" {
		stop()
		writeError(w, http.StatusBadRequest, "title_required")
		return
	}
	if logicGateID, set, ok := parseOptionalStringField(fields, "logic_gate_id"); !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_id")
		return
	} else if set && logicGateID != nil {
		input.LogicGateID = *logicGateID
	}
	if header, set, ok := parseOptionalStringField(fields, "create_logic_gate_header"); !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_create_logic_gate_header")
		return
	} else if set && header != nil {
		input.CreateLogicGateHeader = *header
	}
	if input.CreateLogicGateHeader == "" {
		if header, set, ok := parseOptionalStringField(fields, "logic_gate_header"); !ok {
			stop()
			writeError(w, http.StatusBadRequest, "invalid_logic_gate_header")
			return
		} else if set && header != nil {
			input.CreateLogicGateHeader = *header
		}
	}
	if role, set, ok := parseOptionalStringField(fields, "creator_logic_gate_raci_role"); !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_creator_logic_gate_raci_role")
		return
	} else if set && role != nil {
		input.CreatorLogicGateRaciRole = *role
	}
	stop()
	stop = timings.observe("auth_access")
	if input.LogicGateID != "" && !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, input.LogicGateID, store.EntityPermissionEdit) {
		stop()
		return
	}
	stop()
	stop = timings.observe("request_decode_validation")
	if !parseRacioMatrixNodeCreateMutationFields(w, fields, &input) {
		stop()
		return
	}
	stop()

	input.IdempotencyKey = r.Header.Get("Idempotency-Key")
	input.TimingRecorder = timings
	stop = timings.observe("repository_transaction")
	result, err := s.repo.CreateRacioMatrixNode(input)
	stop()
	if !writeRacioMatrixNodeCreateError(w, err) {
		return
	}
	stop = timings.observe("domain_event_publish")
	s.publishCommittedWorkspaceEvents(result.Events)
	stop()
	stop = timings.observe("notification_projection")
	s.projectCommittedNotificationEvents(result.Events)
	stop()
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) handleRacioMatrixNodeByIDV2(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v2/racio-matrix/nodes/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || parts[1] != "move" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	s.handleRacioMatrixNodeMoveV2(w, r, strings.TrimSpace(parts[0]))
}

func (s *Server) handleRacioMatrixNodeMoveV2(w http.ResponseWriter, r *http.Request, nodeID string) {
	timedWriter, timings := startTimedRequest(w)
	w = timedWriter
	defer func() {
		timings.log(r, timedWriter.status)
	}()
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var fields map[string]json.RawMessage
	stop := timings.observe("request_decode_validation")
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
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
	logicGateID, present, ok := parseRequiredStringJSONField(fields, "to_logic_gate_id")
	if !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_to_logic_gate_id")
		return
	}
	if !present {
		logicGateID, present, ok = parseRequiredStringJSONField(fields, "logic_gate_id")
		if !ok {
			stop()
			writeError(w, http.StatusBadRequest, "invalid_logic_gate_id")
			return
		}
	}
	if !present {
		stop()
		writeError(w, http.StatusBadRequest, "logic_gate_id_required")
		return
	}
	input := store.LogicGateNodeAssignmentMoveInput{CompanyID: companyID, LogicGateID: logicGateID, NodeID: nodeID}
	if fromLogicGateID, set, ok := parseOptionalStringField(fields, "from_logic_gate_id"); !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_from_logic_gate_id")
		return
	} else if set && fromLogicGateID != nil {
		input.FromLogicGateID = *fromLogicGateID
	}
	mutateAssignment := false
	if !parseLogicGateWorkAssignmentMoveFields(w, fields, &input, &mutateAssignment) {
		stop()
		return
	}
	if !mutateAssignment && input.FromLogicGateID == input.LogicGateID {
		stop()
		writeError(w, http.StatusBadRequest, "logic_gate_work_state_change_required")
		return
	}
	stop()
	userID := s.entityPermissionActorUserID(r, input.CompanyID)
	stop = timings.observe("auth_access")
	if !s.requireKanbanLogicGateEffectiveAccess(w, input.CompanyID, userID, input.LogicGateID, store.EntityPermissionEdit) {
		stop()
		return
	}
	if input.FromLogicGateID != "" && input.FromLogicGateID != input.LogicGateID && !s.requireKanbanLogicGateEffectiveAccess(w, input.CompanyID, userID, input.FromLogicGateID, store.EntityPermissionEdit) {
		stop()
		return
	}
	stop()

	input.ActorUserID, input.IdempotencyKey = workItemAssignmentRequestEventMetadata(r)
	input.TimingRecorder = timings
	stop = timings.observe("repository_transaction")
	result, err := s.repo.MoveLogicGateNodeAssignment(input)
	stop()
	if !writeLogicGateWorkMutationError(w, err, "failed_to_move_racio_matrix_node") {
		return
	}
	stop = timings.observe("domain_event_publish")
	s.publishCommittedWorkspaceEvents(result.Events)
	stop()
	stop = timings.observe("notification_projection")
	s.projectCommittedNotificationEvents(result.Events)
	stop()
	writeJSON(w, http.StatusOK, logicGateWorkAssignmentResultPayload(result))
}

func parseRacioMatrixNodeCreateMutationFields(w http.ResponseWriter, fields map[string]json.RawMessage, input *store.RacioMatrixNodeCreateInput) bool {
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
	if columnID, set, ok := parseOptionalStringField(fields, "column_id"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_column_id")
		return false
	} else if set && columnID != nil {
		input.ColumnID = *columnID
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

func writeRacioMatrixNodeCreateError(w http.ResponseWriter, err error) bool {
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_racio_matrix_node")
		return false
	}
	if errors.Is(err, store.ErrPriorityRequired) {
		writeError(w, http.StatusBadRequest, "priority_required")
		return false
	}
	if errors.Is(err, store.ErrAssigneeNotInCompany) {
		writeError(w, http.StatusBadRequest, "assignee_user_not_in_company")
		return false
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "racio_matrix_reference_not_found")
		return false
	}
	if err != nil {
		log.Printf("failed to create racio matrix node: %v", err)
		writeError(w, http.StatusInternalServerError, "failed_to_create_racio_matrix_node")
		return false
	}
	return true
}
