package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/url"
	"strings"
)

// This handler is the authority boundary. Plugin middleware is only context
// plumbing; its absence or failure cannot grant permission to a Mango command.
func (s *Server) handleHermesAction(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		writeError(w, 405, "method_not_allowed")
		return
	}
	route, actor, ok := s.hermesCallbackScope(w, r)
	if !ok {
		return
	}
	var body struct {
		RunID      string          `json:"run_id"`
		SessionID  string          `json:"session_id"`
		ToolCallID string          `json:"tool_call_id"`
		Action     string          `json:"action"`
		Arguments  json.RawMessage `json:"arguments"`
	}
	if !aiDecode(w, r, &body) {
		return
	}
	if !validHermesID(body.RunID) || !validHermesID(body.SessionID) || !validHermesID(body.ToolCallID) {
		writeError(w, 400, "invalid_ai_action")
		return
	}
	user, err := s.repo.GetAuthUserByIDContext(r.Context(), route.UserID)
	if err != nil {
		writeAIStoreError(w, err)
		return
	}
	actor.User = user
	r = r.WithContext(context.WithValue(r.Context(), actorContextKey{}, actor))
	var native hermesRunStatus
	if err := s.hermesJSON(r.Context(), route, http.MethodGet, "/v1/runs/"+body.RunID, "", nil, &native); err != nil {
		writeHermesError(w, err)
		return
	}
	if native.RunID != body.RunID || native.SessionID != body.SessionID || native.Status != "running" {
		writeError(w, 409, "ai_run_not_accepting_actions")
		return
	}
	run, err := s.repo.FindAIRun(r.Context(), route.CompanyID, route.UserID, body.RunID)
	if errors.Is(err, store.ErrNotFound) {
		// A native tool can start before POST /runs returns. Resolve the saved
		// submission's exact idempotency key; matching a chat alone is not proof.
		run, err = s.repo.ActiveAIRun(r.Context(), route.CompanyID, route.UserID)
		if err == nil && run.HermesRunID == "" && run.ChatID == body.SessionID && run.Status == "pending" {
			run, err = s.admitAIRun(r.Context(), route, run)
		} else {
			err = store.ErrNotFound
		}
	}
	if err != nil {
		writeAIStoreError(w, err)
		return
	}
	if run.HermesRunID != body.RunID || run.ChatID != body.SessionID || run.Status != "running" {
		writeError(w, 409, "ai_run_not_accepting_actions")
		return
	}
	switch body.Action {
	case "mango_search":
		s.handleHermesSearch(w, r, route.CompanyID, body.Arguments)
	case "mango_create_process", "mango_update_process", "mango_move_process", "mango_create_step":
		s.handleHermesProcessAction(w, r, run, body.Action, body.Arguments)
	case "mango_create_node_chat":
		s.handleHermesCreateNodeChat(w, r, run, body.Arguments)
	case "mango_list_nodes":
		var args struct{}
		if !decodeHermesArguments(body.Arguments, &args) {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		nodes, err := s.repo.ListVisibleNodes(route.CompanyID, route.UserID)
		if err != nil {
			writeAIStoreError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"nodes": nodes})
	case "mango_get_node":
		var args struct {
			NodeID string `json:"node_id"`
		}
		if !decodeHermesArguments(body.Arguments, &args) || !isCanonicalUUID(args.NodeID) {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		read := hermesReadRequest(r, route.CompanyID, "/v1/nodes/"+strings.ToLower(args.NodeID))
		query := read.URL.Query()
		query.Set("include_information", "true")
		read.URL.RawQuery = query.Encode()
		s.handleNodeSubresource(w, read)
	case "mango_list_processes":
		var args struct{}
		if !decodeHermesArguments(body.Arguments, &args) {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		processes, err := s.repo.ListVisibleLogicGates(route.CompanyID, route.UserID)
		if err != nil {
			writeError(w, 503, "processes_unavailable")
			return
		}
		out := []map[string]string{}
		for _, process := range processes {
			out = append(out, map[string]string{"logic_gate_id": process.LogicGateID, "header": process.Header})
		}
		writeJSON(w, 200, map[string]any{"processes": out})
	case "mango_get_process":
		var args struct {
			LogicGateID string `json:"logic_gate_id"`
		}
		if !decodeHermesArguments(body.Arguments, &args) || !isCanonicalUUID(args.LogicGateID) {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		args.LogicGateID = strings.ToLower(args.LogicGateID)
		flags, actorID, ok := s.requireLogicGateWorkReadAccess(w, r, route.CompanyID, args.LogicGateID)
		if !ok {
			return
		}
		work, err := s.repo.GetLogicGateWork(route.CompanyID, args.LogicGateID, actorID)
		if err != nil {
			writeAIStoreError(w, err)
			return
		}
		work.Permissions.CanEdit = flags.CanEdit
		writeJSON(w, 200, work)
	case "mango_create_node":
		var args struct {
			LogicGateID   string `json:"logic_gate_id"`
			ProcessStepID string `json:"process_step_id"`
			Title         string `json:"title"`
		}
		if !decodeHermesArguments(body.Arguments, &args) || !isCanonicalUUID(args.LogicGateID) || !isCanonicalUUID(args.ProcessStepID) {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		args.LogicGateID = strings.ToLower(args.LogicGateID)
		args.ProcessStepID = strings.ToLower(args.ProcessStepID)
		args.Title = strings.TrimSpace(args.Title)
		if args.Title == "" || len(args.Title) > 500 {
			writeError(w, 400, "invalid_node_title")
			return
		}
		if !s.requireLogicGateWorkEffectiveAccess(w, r, route.CompanyID, args.LogicGateID, store.EntityPermissionEdit) {
			return
		}
		actionKey := hermesArgumentKey(args)
		result, err := s.repo.AICreateNode(r.Context(), run, actionKey, store.LogicGateNodeAssignmentInput{
			CompanyID: route.CompanyID, ActorUserID: route.UserID, LogicGateID: args.LogicGateID, ProcessStepID: &args.ProcessStepID, ProcessStepIDSet: true,
			NodeID: store.NewUUIDv7String(), CreateNodeTitle: args.Title,
		})
		if err != nil {
			writeAIStoreError(w, err)
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		s.projectCommittedNotificationEvents(result.Events)
		writeJSON(w, 200, map[string]any{"node_id": result.Node.NodeID, "title": result.Node.Title, "logic_gate_id": result.Assignment.LogicGateID, "process_step_id": result.Assignment.ProcessStepID})
	case "mango_update_node":
		var args struct {
			NodeID   string          `json:"node_id"`
			Name     *string         `json:"name"`
			Status   *string         `json:"status"`
			DueDate  json.RawMessage `json:"due_date"`
			Priority json.RawMessage `json:"priority"`
		}
		if !decodeHermesArguments(body.Arguments, &args) || !isCanonicalUUID(args.NodeID) {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		input := store.UpdateNodeInput{CompanyID: route.CompanyID, NodeID: strings.ToLower(args.NodeID), ActorUserID: route.UserID}
		if args.Name != nil {
			input.Title, input.TitleSet = strings.TrimSpace(*args.Name), true
			if input.Title == "" || len(input.Title) > 500 {
				writeError(w, 400, "invalid_name")
				return
			}
		}
		if args.Status != nil {
			status := strings.TrimSpace(*args.Status)
			input.Status, input.StatusSet = &status, true
		}
		if len(args.DueDate) > 0 {
			date, _, valid := parseOptionalStringField(map[string]json.RawMessage{"due_date": args.DueDate}, "due_date")
			if !valid {
				writeError(w, 400, "invalid_due_date")
				return
			}
			normalized, valid := normalizeNodeDueDate(*date)
			if !valid {
				writeError(w, 400, "invalid_due_date")
				return
			}
			input.DueDate, input.DueDateSet = &normalized, true
		}
		if len(args.Priority) > 0 {
			priority, _, valid := parseOptionalPriorityField(map[string]json.RawMessage{"priority": args.Priority})
			if !valid {
				writeError(w, 400, "invalid_priority")
				return
			}
			input.Priority, input.PrioritySet = priority, true
		}
		if !input.TitleSet && !input.StatusSet && !input.DueDateSet && !input.PrioritySet {
			writeError(w, 400, "node_update_required")
			return
		}
		if !s.requireEntityEdit(w, r, route.CompanyID, store.EntityTypeNode, input.NodeID, "node_not_found") {
			return
		}
		actionKey := hermesArgumentKey(input)
		_, input.ActorDisplayName = nodeChangeActorPayload(r)
		result, err := s.repo.AIUpdateNode(r.Context(), run, actionKey, input)
		if err != nil {
			writeAIStoreError(w, err)
			return
		}
		s.publishCommittedWorkspaceEvent(result.Event)
		s.projectCommittedNotificationEvents([]domain.DomainEvent{result.Event})
		writeJSON(w, 200, result.Node)
	case "mango_move_node":
		var args struct {
			NodeID        string          `json:"node_id"`
			LogicGateID   string          `json:"logic_gate_id"`
			ProcessStepID json.RawMessage `json:"process_step_id"`
			Position      int             `json:"position"`
		}
		if !decodeHermesArguments(body.Arguments, &args) || !isCanonicalUUID(args.NodeID) || !isCanonicalUUID(args.LogicGateID) || len(args.ProcessStepID) == 0 || args.Position < 0 {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		stepID, _, valid := parseOptionalStringField(map[string]json.RawMessage{"process_step_id": args.ProcessStepID}, "process_step_id")
		if !valid || (*stepID != "" && !isCanonicalUUID(*stepID)) {
			writeError(w, 400, "invalid_process_step_id")
			return
		}
		*stepID = strings.ToLower(*stepID)
		input := store.LogicGateNodeAssignmentMoveInput{CompanyID: route.CompanyID, ActorUserID: route.UserID, LogicGateID: strings.ToLower(args.LogicGateID), NodeID: strings.ToLower(args.NodeID), ProcessStepID: stepID, ProcessStepIDSet: true, Position: args.Position}
		if !s.requireLogicGateWorkEffectiveAccess(w, r, route.CompanyID, input.LogicGateID, store.EntityPermissionEdit) || !s.requireEntityEdit(w, r, route.CompanyID, store.EntityTypeNode, input.NodeID, "node_not_found") || !s.requireLogicGateWorkExistingSourceEditAccess(w, r, route.CompanyID, input.LogicGateID, input.NodeID) {
			return
		}
		result, err := s.repo.AIMoveNode(r.Context(), run, hermesArgumentKey(input), input)
		if err != nil {
			writeAIStoreError(w, err)
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		s.projectCommittedNotificationEvents(result.Events)
		writeJSON(w, 200, logicGateWorkAssignmentResultPayload(result))
	case "mango_create_editor":
		var args struct {
			ResourceType string                       `json:"resource_type"`
			ResourceID   string                       `json:"resource_id"`
			Document     map[string]any               `json:"document"`
			Annotations  []store.EditorJSONAnnotation `json:"annotations"`
		}
		if !decodeHermesArguments(body.Arguments, &args) || !isCanonicalUUID(args.ResourceID) || (args.ResourceType != store.EntityTypeNode && args.ResourceType != store.EntityTypeProject) {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		args.ResourceID = strings.ToLower(args.ResourceID)
		if !s.requireEntityEdit(w, r, route.CompanyID, args.ResourceType, args.ResourceID, "resource_not_found") {
			return
		}
		// Normalize document contents before deduplication. The command allocates
		// the real new textbox ID, which never comes from model arguments.
		annotations, err := store.NormalizeEditorJSONAnnotations(args.Annotations)
		if err != nil {
			writeEditorJSONStoreError(w, err)
			return
		}
		args.Annotations = annotations
		document, _ := json.Marshal(args.Document)
		input := store.EditorJSONCommitInput{Document: store.EditorJSONDocumentRef{CompanyID: route.CompanyID, ResourceType: args.ResourceType, ResourceID: args.ResourceID}, SchemaVersion: store.MangoTiptapSchemaVersion, JSONDocument: document, Annotations: annotations}
		result, err := s.repo.AICreateEditor(r.Context(), run, hermesArgumentKey(args), input)
		if err != nil {
			writeEditorJSONStoreError(w, err)
			return
		}
		s.afterEditorJSONCommit(r, result.Document, nil, result.Commit)
		writeJSON(w, 200, map[string]any{"document_ref": result.Document, "revision": result.Commit.Revision, "operation_id": result.Commit.OperationID, "committed_at": result.Commit.CommittedAt})
	case "mango_get_editor", "mango_update_editor":
		var args struct {
			ResourceType string                       `json:"resource_type"`
			ResourceID   string                       `json:"resource_id"`
			DocumentID   string                       `json:"document_id"`
			BaseRevision *int64                       `json:"base_revision"`
			Document     json.RawMessage              `json:"document"`
			Annotations  []store.EditorJSONAnnotation `json:"annotations"`
		}
		if !decodeHermesArguments(body.Arguments, &args) || !isCanonicalUUID(args.ResourceID) {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		switch args.ResourceType {
		case store.EntityTypeNode, store.EntityTypeLogicGate, store.EntityTypeProcessStep, store.EntityTypeProject:
		default:
			writeError(w, 400, "invalid_editor_resource_type")
			return
		}
		ref, err := store.NormalizeEditorJSONDocumentRef(store.EditorJSONDocumentRef{CompanyID: route.CompanyID, ResourceType: args.ResourceType, ResourceID: strings.ToLower(args.ResourceID), DocumentID: args.DocumentID})
		if err != nil {
			writeError(w, 400, "invalid_editor_document")
			return
		}
		if body.Action == "mango_get_editor" {
			if args.BaseRevision != nil || len(args.Document) > 0 || args.Annotations != nil {
				writeError(w, 400, "invalid_action_arguments")
				return
			}
			s.handleEditorJSON(w, hermesReadRequest(r, route.CompanyID, editorJSONRoutePrefix+ref.ResourceType+"/"+ref.ResourceID+"/documents/"+url.PathEscape(ref.DocumentID)))
			return
		}
		if args.BaseRevision == nil || *args.BaseRevision < 0 || len(args.Document) == 0 {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		if !s.authorizeEditorJSON(w, r, actor, ref) {
			return
		}
		before, err := s.repo.GetEditorJSONSnapshot(ref)
		if err != nil {
			writeEditorJSONStoreError(w, err)
			return
		}
		input, err := store.NormalizeEditorJSONCommit(store.EditorJSONCommitInput{Document: ref, OperationID: "ai", ClientID: "ai", ActorUserID: route.UserID, BaseRevision: *args.BaseRevision, SchemaVersion: store.MangoTiptapSchemaVersion, JSONDocument: args.Document, Annotations: args.Annotations})
		if err != nil {
			writeEditorJSONStoreError(w, err)
			return
		}
		commit, err := s.repo.AICommitEditor(r.Context(), run, hermesArgumentKey(input), input)
		if err != nil {
			writeEditorJSONStoreError(w, err)
			return
		}
		s.afterEditorJSONCommit(r, ref, before.JSONDocument, commit)
		writeJSON(w, 200, map[string]any{"operation_id": commit.OperationID, "revision": commit.Revision, "committed_at": commit.CommittedAt})
	default:
		writeError(w, 400, "unsupported_ai_action")
	}
}

func decodeHermesArguments(raw json.RawMessage, out any) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return false
	}
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	return d.Decode(out) == nil && d.Decode(new(any)) == io.EOF
}

func hermesArgumentKey(args any) string {
	encoded, _ := json.Marshal(args)
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

func hermesReadRequest(r *http.Request, companyID, path string) *http.Request {
	read := r.Clone(r.Context())
	read.Method = http.MethodGet
	read.URL = &url.URL{Path: path, RawQuery: url.Values{"company_id": {companyID}}.Encode()}
	read.Body = http.NoBody
	return read
}
