package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
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
	case len(parts) == 2 && parts[1] == "step-map":
		s.handleProcessStepMap(w, r, logicGateID)
	case len(parts) == 2 && parts[1] == "steps":
		s.handleProcessSteps(w, r, logicGateID, "")
	case len(parts) == 3 && parts[1] == "steps":
		s.handleProcessSteps(w, r, logicGateID, parts[2])
	case len(parts) == 2 && parts[1] == "step-relationships":
		s.handleProcessStepRelationships(w, r, logicGateID, "")
	case len(parts) == 3 && parts[1] == "step-relationships":
		s.handleProcessStepRelationships(w, r, logicGateID, parts[2])
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
	flags, actorUserID, ok := s.requireLogicGateWorkReadAccess(w, r, companyID, logicGateID)
	if !ok {
		return
	}
	etag, err := s.logicGateWorkETag(r, companyID, logicGateID, actorUserID, flags)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_read_logic_gate_work_version")
		return
	}
	if writeNotModifiedWithETag(w, r, etag) {
		return
	}
	work, err := s.repo.GetLogicGateWork(companyID, logicGateID, actorUserID)
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
	work.Permissions.CanEdit = flags.CanEdit
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, work, etag)
}

func (s *Server) logicGateWorkETag(_ *http.Request, companyID, logicGateID, actorUserID string, flags domain.EffectiveAccessFlags) (string, error) {
	version, err := s.repo.CurrentLogicGateWorkVersion(companyID, logicGateID)
	if err != nil {
		return "", err
	}
	permissionKey := strconv.FormatBool(flags.CanEdit)
	fingerprints, err := s.repo.ResourcePolicyFingerprints(companyID, store.EntityTypeLogicGate, logicGateID, actorUserID)
	if err != nil {
		return "", err
	}
	return strongETagFromString(
		"process-work:v1:" + strings.TrimSpace(companyID) + ":" + strings.TrimSpace(logicGateID) + ":" +
			strings.TrimSpace(actorUserID) + ":" + permissionKey + ":" +
			fingerprints.RACI + ":" + fingerprints.Permission + ":" + strconv.FormatInt(version, 10),
	), nil
}

func (s *Server) requireLogicGateWorkReadAccess(w http.ResponseWriter, r *http.Request, companyID, logicGateID string) (domain.EffectiveAccessFlags, string, bool) {
	actor, ok := authenticatedActor(r)
	if !ok {
		if s.authValidator == nil {
			return domain.EffectiveAccessFlags{CanEdit: true}, "", true
		}
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return domain.EffectiveAccessFlags{}, "", false
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return domain.EffectiveAccessFlags{}, "", false
	}
	actorUserID := strings.TrimSpace(actor.User.UserID)
	if actorCanManageCompany(actor, companyID) {
		return domain.EffectiveAccessFlags{CanEdit: true}, actorUserID, true
	}
	flags, err := s.repo.LogicGateWorkAccessFlags(companyID, actorUserID, logicGateID)
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return domain.EffectiveAccessFlags{}, actorUserID, false
	}
	if err != nil {
		log.Printf("failed to check logic gate work access company_id=%s logic_gate_id=%s user_id=%s: %v", companyID, logicGateID, actorUserID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_check_logic_gate_access")
		return domain.EffectiveAccessFlags{}, actorUserID, false
	}
	if !flags.CanEdit {
		writeAccessResourceNotFound(w)
		return domain.EffectiveAccessFlags{}, actorUserID, false
	}
	return flags, actorUserID, true
}

func (s *Server) handleLogicGateWorkNodeCreateV2(w http.ResponseWriter, r *http.Request, logicGateID string) {
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
	nodeID, present, ok := parseRequiredStringJSONField(fields, "node_id")
	if !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_node_id")
		return
	}
	if !present {
		title, titleSet, valid := parseOptionalStringField(fields, "create_node_title")
		if !valid || !titleSet || title == nil || strings.TrimSpace(*title) == "" {
			stop()
			writeError(w, http.StatusBadRequest, "create_node_title_required")
			return
		}
		nodeID = store.NewUUIDv7String()
	}
	if !isCanonicalUUID(nodeID) {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_node_id")
		return
	}
	stop()
	stop = timings.observeAccounted("request.auth")
	authenticatedActor(r)
	stop()
	stop = timings.observeAccounted("request.access_check")
	if !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, logicGateID, store.EntityPermissionEdit) {
		stop()
		return
	}
	if !s.requireLogicGateWorkExistingSourceEditAccess(w, r, companyID, logicGateID, nodeID) {
		stop()
		return
	}
	if _, err := s.repo.GetNode(companyID, nodeID); err == nil {
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") {
			stop()
			return
		}
	} else if !errors.Is(err, store.ErrNotFound) {
		stop()
		writeError(w, http.StatusInternalServerError, "failed_to_read_node")
		return
	}
	stop()

	input := store.LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: logicGateID, NodeID: nodeID, MutationOrigin: store.MutationOriginKanban}
	stop = timings.observeAccounted("request.validate")
	if !parseLogicGateWorkAssignmentCreateFields(w, fields, &input) {
		stop()
		return
	}
	stop()
	input.ActorUserID, input.IdempotencyKey = workItemAssignmentRequestEventMetadata(r)
	input.TimingRecorder = timings
	stop = timings.observeAccounted("source.transaction")
	result, err := s.repo.AssignNodeToLogicGateStatus(input)
	stop()
	if !writeLogicGateWorkMutationError(w, err, "failed_to_assign_logic_gate_work_node") {
		return
	}
	s.publishCommittedWorkspaceEventsWithTiming(result.Events, timings)
	s.projectCommittedNotificationEventsWithTiming(result.Events, timings)
	writeJSON(w, http.StatusCreated, logicGateWorkAssignmentResultPayload(result))
}

func (s *Server) handleLogicGateWorkNodeStateV2(w http.ResponseWriter, r *http.Request, logicGateID, nodeID string) {
	timedWriter, timings := startTimedRequest(w)
	w = timedWriter
	defer func() {
		timings.log(r, timedWriter.status)
	}()
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if nodeID == "" {
		writeError(w, http.StatusNotFound, "node_not_found")
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
	stop()
	stop = timings.observeAccounted("request.auth")
	authenticatedActor(r)
	stop()
	stop = timings.observeAccounted("request.access_check")
	if !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, logicGateID, store.EntityPermissionEdit) {
		stop()
		return
	}
	stop()

	input := store.LogicGateNodeAssignmentMoveInput{CompanyID: companyID, LogicGateID: logicGateID, NodeID: nodeID, MutationOrigin: store.MutationOriginKanban}
	if !s.requireEntityEdit(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") || !s.requireLogicGateWorkExistingSourceEditAccess(w, r, companyID, logicGateID, nodeID) {
		return
	}
	mutateAssignment := false
	stop = timings.observeAccounted("request.validate")
	if !parseLogicGateWorkAssignmentMoveFields(w, fields, &input, &mutateAssignment) {
		stop()
		return
	}
	isIssue, issueSet, ok := parseOptionalBoolField(fields, "is_issue")
	if !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_is_issue")
		return
	}
	if !mutateAssignment && !issueSet {
		stop()
		writeError(w, http.StatusBadRequest, "logic_gate_work_state_change_required")
		return
	}
	stop()

	actorUserID, idempotencyKey := workItemAssignmentRequestEventMetadata(r)
	var result store.LogicGateNodeAssignmentResult
	if mutateAssignment {
		input.ActorUserID = actorUserID
		input.IdempotencyKey = idempotencyKey
		input.TimingRecorder = timings
		var err error
		stop = timings.observeAccounted("source.transaction")
		result, err = s.repo.MoveLogicGateNodeAssignment(input)
		stop()
		if !writeLogicGateWorkMutationError(w, err, "failed_to_update_logic_gate_work_node_state") {
			return
		}
		s.publishCommittedWorkspaceEventsWithTiming(result.Events, timings)
		s.projectCommittedNotificationEventsWithTiming(result.Events, timings)
	}
	if issueSet {
		stop = timings.observeAccounted("source.transaction")
		issueResult, err := s.repo.SetLogicGateNodeAssignmentIssue(store.LogicGateNodeAssignmentIssueInput{
			CompanyID:      companyID,
			LogicGateID:    logicGateID,
			NodeID:         nodeID,
			IsIssue:        isIssue,
			ActorUserID:    actorUserID,
			IdempotencyKey: idempotencyKey,
		})
		stop()
		if !writeLogicGateWorkMutationError(w, err, "failed_to_update_logic_gate_work_node_issue_state") {
			return
		}
		s.publishCommittedWorkspaceEventsWithTiming(issueResult.Events, timings)
		s.projectCommittedNotificationEventsWithTiming(issueResult.Events, timings)
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
	if !s.requireEntityEdit(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") {
		return
	}
	actorUserID, idempotencyKey := workItemAssignmentRequestEventMetadata(r)
	fallbackStatus := r.URL.Query().Get("fallback_status")
	if _, present := r.URL.Query()["fallback_status_color"]; present {
		writeError(w, http.StatusBadRequest, "unsupported_fallback_status_color")
		return
	}
	result, err := s.repo.RemoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentRemoveInput{
		CompanyID:      companyID,
		LogicGateID:    logicGateID,
		NodeID:         nodeID,
		FallbackStatus: optionalStringPointer(&fallbackStatus),
		ActorUserID:    actorUserID,
		IdempotencyKey: idempotencyKey,
	})
	if !writeLogicGateWorkRemoveError(w, err) {
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	s.projectCommittedNotificationEvents(result.Events)
	payload := logicGateWorkAssignmentRemoveResultPayload(result)
	writeJSON(w, http.StatusOK, payload)
}

func parseLogicGateWorkAssignmentCreateFields(w http.ResponseWriter, fields map[string]json.RawMessage, input *store.LogicGateNodeAssignmentInput) bool {
	if stepID, set, ok := parseOptionalStringField(fields, "process_step_id"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_process_step_id")
		return false
	} else if set {
		input.ProcessStepID = stepID
		input.ProcessStepIDSet = true
	}

	if origin, set, ok := parseOptionalStringField(fields, "mutation_origin"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_mutation_origin")
		return false
	} else if set && origin != nil {
		input.MutationOrigin = store.NormalizeMutationOrigin(*origin)
	}
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
	if createNodeTitle, set, ok := parseOptionalStringField(fields, "create_node_title"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_create_node_title")
		return false
	} else if set && createNodeTitle != nil {
		input.CreateNodeTitle = *createNodeTitle
	}
	if description, set, ok := parseOptionalStringField(fields, "description_snapshot"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_description_snapshot")
		return false
	} else if set && description != nil {
		input.DescriptionSnapshot = *description
	}
	if _, present := fields["assignee_policy"]; present {
		writeError(w, http.StatusBadRequest, "unsupported_assignee_policy")
		return false
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
	if origin, set, ok := parseOptionalStringField(fields, "mutation_origin"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_mutation_origin")
		return false
	} else if set && origin != nil {
		input.MutationOrigin = store.NormalizeMutationOrigin(*origin)
	}
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
	if stepID, set, ok := parseOptionalStringField(fields, "process_step_id"); !ok {
		writeError(w, http.StatusBadRequest, "invalid_process_step_id")
		return false
	} else if set {
		input.ProcessStepID = stepID
		input.ProcessStepIDSet = true
		*changed = true
	}

	if _, present := fields["assignee_policy"]; present {
		writeError(w, http.StatusBadRequest, "unsupported_assignee_policy")
		return false
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
	if actorCanManageCompany(actor, companyID) {
		return true
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
	writeAccessResourceNotFound(w)
	return false
}

func (s *Server) requireLogicGateWorkExistingSourceEditAccess(w http.ResponseWriter, r *http.Request, companyID, targetLogicGateID, nodeID string) bool {
	assignments, err := s.repo.ListNodeLogicGateAssignments(companyID, nodeID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_work_assignment")
		return false
	}
	if err != nil {
		log.Printf("failed to list existing node logic gate assignments company_id=%s node_id=%s: %v", companyID, nodeID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_check_logic_gate_access")
		return false
	}
	userID := s.entityPermissionActorUserID(r, companyID)
	for _, assignment := range assignments {
		sourceLogicGateID := strings.TrimSpace(assignment.LogicGateID)
		if sourceLogicGateID == "" || sourceLogicGateID == targetLogicGateID {
			continue
		}
		if !s.requireKanbanLogicGateEffectiveAccess(w, companyID, userID, sourceLogicGateID, store.EntityPermissionEdit) {
			return false
		}
	}
	return true
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
		log.Printf("%s: %v", fallback, err)
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
	return map[string]any{"assignment": result.Assignment, "node": result.Node, "gvic_projection_rows": result.RACIMatrixProjectionRows}
}
func logicGateWorkAssignmentRemoveResultPayload(result store.LogicGateNodeAssignmentRemoveResult) map[string]any {
	return map[string]any{"assignment": result.Assignment, "node": result.Node, "gvic_projection_rows": result.RACIMatrixProjectionRows}
}
