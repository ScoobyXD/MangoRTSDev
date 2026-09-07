package httpapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
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
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		writeError(w, 401, "unauthorized")
		return
	}
	key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	var route HermesRoute
	for _, candidate := range s.hermesRoutes {
		if candidate.CallbackKey != "" && subtle.ConstantTimeCompare([]byte(key), []byte(candidate.CallbackKey)) == 1 {
			route = candidate
			break
		}
	}
	if route.UserID == "" {
		writeError(w, 401, "unauthorized")
		return
	}
	var body struct {
		RunID      string          `json:"run_id"`
		SessionID  string          `json:"session_id"`
		ToolCallID string          `json:"tool_call_id"`
		Action     string          `json:"action"`
		Arguments  json.RawMessage `json:"arguments"`
	}
	if !assistantDecode(w, r, &body) {
		return
	}
	if !validHermesID(body.RunID) || !validHermesID(body.SessionID) || !validHermesID(body.ToolCallID) {
		writeError(w, 400, "invalid_assistant_action")
		return
	}
	memberships, err := s.freshUserMemberships(r.Context(), route.UserID)
	if err != nil {
		writeError(w, 503, "company_access_unavailable")
		return
	}
	actor := ActorContext{User: domain.User{UserID: route.UserID}, Memberships: normalizeMembershipRoles(memberships), CompanyID: route.CompanyID}
	actor.CompanyRole = actorRoleForCompany(actor, route.CompanyID)
	if actor.CompanyRole == "" {
		writeError(w, 403, "company_access_denied")
		return
	}
	r = r.WithContext(context.WithValue(r.Context(), actorContextKey{}, actor))
	var native assistantRunStatus
	if err = s.hermesJSON(r.Context(), route, http.MethodGet, "/v1/runs/"+body.RunID, "", nil, &native); err != nil {
		writeHermesError(w, err)
		return
	}
	if native.RunID != body.RunID || native.SessionID != body.SessionID || native.Status != "running" {
		writeError(w, 409, "assistant_run_not_accepting_actions")
		return
	}
	run, err := s.repo.FindAssistantRun(r.Context(), route.CompanyID, route.UserID, body.RunID)
	if errors.Is(err, store.ErrNotFound) {
		// A native tool can start before POST /runs has returned its run ID. Bind
		// only the sole admitted scope/session, after verifying native ownership.
		run, err = s.repo.ActiveAssistantRun(r.Context(), route.CompanyID, route.UserID)
		if err == nil && run.RunID == "" && run.ConversationID == body.SessionID && !run.Cancelled {
			run, err = s.repo.BindAssistantRun(r.Context(), route.CompanyID, route.UserID, run.RequestID, body.RunID)
		} else {
			err = store.ErrNotFound
		}
	}
	if err != nil {
		writeAssistantStoreError(w, err)
		return
	}
	if run.ConversationID != body.SessionID || run.Cancelled || run.Settled {
		writeError(w, 409, "assistant_run_not_accepting_actions")
		return
	}
	switch body.Action {
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
			writeAssistantStoreError(w, err)
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
		encoded, _ := json.Marshal(args)
		sum := sha256.Sum256(encoded)
		actionKey := hex.EncodeToString(sum[:])
		result, err := s.repo.AssistantCreateNode(r.Context(), run, actionKey, store.LogicGateNodeAssignmentInput{
			CompanyID: route.CompanyID, ActorUserID: route.UserID, LogicGateID: args.LogicGateID, ProcessStepID: &args.ProcessStepID, ProcessStepIDSet: true,
			NodeID: store.NewUUIDv7String(), CreateNodeTitle: args.Title,
		})
		if err != nil {
			writeAssistantStoreError(w, err)
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		s.projectCommittedNotificationEvents(result.Events)
		writeJSON(w, 200, map[string]any{"node_id": result.Node.NodeID, "title": result.Node.Title, "logic_gate_id": result.Assignment.LogicGateID, "process_step_id": result.Assignment.ProcessStepID})
	default:
		writeError(w, 400, "unsupported_assistant_action")
	}
}

func decodeHermesArguments(raw json.RawMessage, out any) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return false
	}
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	return d.Decode(out) == nil
}
