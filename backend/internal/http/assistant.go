package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type assistantSubmission struct {
	CompanyID      string `json:"company_id"`
	ConversationID string `json:"conversation_id"`
	RequestID      string `json:"request_id"`
	Message        string `json:"message"`
}

type assistantRunStatus struct {
	RunID          string `json:"run_id"`
	SessionID      string `json:"session_id"`
	ConversationID string `json:"conversation_id"`
	Status         string `json:"status"`
	Output         string `json:"output,omitempty"`
	Error          string `json:"error,omitempty"`
}

func assistantTerminal(status string) bool {
	switch status {
	case "completed", "failed", "cancelled", "interrupted":
		return true
	}
	return false
}

func (s *Server) assistantScope(w http.ResponseWriter, r *http.Request, companyID string) (ActorContext, HermesRoute, bool) {
	actor, ok := authenticatedActor(r)
	if !ok || actor.User.UserID == "" {
		writeError(w, 401, "assistant_authentication_required")
		return actor, HermesRoute{}, false
	}
	if !isCanonicalUUID(companyID) {
		writeError(w, 400, "invalid_company_id")
		return actor, HermesRoute{}, false
	}
	memberships, err := s.freshUserMemberships(r.Context(), actor.User.UserID)
	if err != nil {
		writeError(w, 503, "company_access_unavailable")
		return actor, HermesRoute{}, false
	}
	member := false
	for _, membership := range memberships {
		if membership.CompanyID == companyID {
			member = true
			break
		}
	}
	if !member {
		writeError(w, 403, "company_access_denied")
		return actor, HermesRoute{}, false
	}
	for _, route := range s.hermesRoutes {
		if route.CompanyID == companyID && route.UserID == actor.User.UserID {
			return actor, route, true
		}
	}
	writeError(w, 503, "assistant_not_configured_for_account")
	return actor, HermesRoute{}, false
}

func assistantDecode(w http.ResponseWriter, r *http.Request, out any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		writeError(w, 400, "invalid_assistant_request")
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		writeError(w, 400, "invalid_assistant_request")
		return false
	}
	return true
}

func (s *Server) handleAssistant(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/assistant/"), "/")
	if len(parts) == 1 && parts[0] == "runs" && r.Method == http.MethodPost {
		s.createAssistantRun(w, r)
		return
	}
	companyID := r.URL.Query().Get("company_id")
	if r.Method == http.MethodPost {
		var body struct {
			CompanyID string `json:"company_id"`
		}
		if !assistantDecode(w, r, &body) {
			return
		}
		companyID = body.CompanyID
	}
	_, route, ok := s.assistantScope(w, r, companyID)
	if !ok {
		return
	}
	switch {
	case r.Method == http.MethodGet && len(parts) == 1 && parts[0] == "conversations":
		s.listAssistantConversations(w, r, route)
	case r.Method == http.MethodGet && len(parts) == 2 && parts[0] == "conversations" && validHermesID(parts[1]):
		s.getAssistantConversation(w, r, route, parts[1])
	case len(parts) >= 2 && parts[0] == "runs" && validHermesID(parts[1]):
		run, err := s.repo.FindAssistantRun(r.Context(), route.CompanyID, route.UserID, parts[1])
		if err != nil {
			writeAssistantStoreError(w, err)
			return
		}
		if r.Method == http.MethodGet && len(parts) == 2 {
			status, err := s.refreshAssistantRun(r.Context(), route, run)
			if err != nil {
				writeHermesError(w, err)
				return
			}
			writeJSON(w, 200, status)
		} else if r.Method == http.MethodGet && len(parts) == 3 && parts[2] == "events" {
			s.streamAssistantRun(w, r, route, run)
		} else if r.Method == http.MethodPost && len(parts) == 3 && parts[2] == "cancel" {
			s.cancelAssistantRun(w, r, route, run)
		} else {
			writeError(w, 405, "method_not_allowed")
		}
	default:
		writeError(w, 404, "not_found")
	}
}

func validHermesID(id string) bool {
	if len(id) == 0 || len(id) > 160 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func writeAssistantStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, 404, "assistant_run_or_conversation_unavailable")
	case errors.Is(err, store.ErrConflict):
		writeError(w, 409, "assistant_run_active_or_request_conflict")
	case errors.Is(err, store.ErrInvalid):
		writeError(w, 400, "invalid_assistant_request")
	default:
		writeError(w, 503, "assistant_storage_unavailable")
	}
}

func (s *Server) refreshAssistantRun(ctx context.Context, route HermesRoute, run store.AssistantRun) (assistantRunStatus, error) {
	var status assistantRunStatus
	err := s.hermesJSON(ctx, route, http.MethodGet, "/v1/runs/"+url.PathEscape(run.RunID), "", nil, &status)
	if err != nil {
		var upstream hermesHTTPError
		if !errors.As(err, &upstream) || upstream.status != 404 {
			return status, err
		}
		// Native terminal records expire. Never recreate their runs or reopen action authority.
		if err = s.repo.CancelAssistantRun(ctx, route.CompanyID, route.UserID, run.RequestID); err != nil {
			return status, err
		}
		status = assistantRunStatus{RunID: run.RunID, SessionID: run.ConversationID, Status: "interrupted", Error: "The saved run is no longer available. Its conversation remains saved."}
	}
	if status.RunID != run.RunID || status.SessionID != run.ConversationID {
		return status, errors.New("Hermes run identity mismatch")
	}
	status.ConversationID = run.ConversationID
	if status.Error != "" {
		status.Error = "The assistant could not finish this reply. Check the Hermes service provider configuration."
	}
	if assistantTerminal(status.Status) {
		if err = s.repo.SettleAssistantRun(ctx, route.CompanyID, route.UserID, run.RequestID); err != nil {
			return status, err
		}
	}
	return status, nil
}

func (s *Server) createAssistantRun(w http.ResponseWriter, r *http.Request) {
	var body assistantSubmission
	if !assistantDecode(w, r, &body) {
		return
	}
	body.Message = strings.TrimSpace(body.Message)
	_, route, ok := s.assistantScope(w, r, body.CompanyID)
	if !ok {
		return
	}
	if !isCanonicalUUID(body.RequestID) || strings.TrimSpace(body.Message) == "" || len(body.Message) > 32000 || (body.ConversationID != "" && !validHermesID(body.ConversationID)) {
		writeError(w, 400, "invalid_assistant_request")
		return
	}
	// Refresh the one pending run on explicit interaction; no idle polling worker.
	active, err := s.repo.ActiveAssistantRun(r.Context(), route.CompanyID, route.UserID)
	if err == nil && active.RunID != "" {
		if _, err = s.refreshAssistantRun(r.Context(), route, active); err != nil {
			writeHermesError(w, err)
			return
		}
	} else if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeAssistantStoreError(w, err)
		return
	}
	if body.ConversationID == "" {
		body.ConversationID = body.RequestID
	}
	// Do not let caller-supplied session IDs silently create or fork arbitrary sessions.
	if body.ConversationID != body.RequestID {
		var session struct {
			ID string `json:"id"`
		}
		if err = s.hermesJSON(r.Context(), route, http.MethodGet, "/api/sessions/"+url.PathEscape(body.ConversationID), "", nil, &session); err != nil {
			writeHermesError(w, err)
			return
		}
		if session.ID != body.ConversationID {
			writeError(w, 502, "assistant_conversation_unavailable")
			return
		}
	}
	var capabilities struct {
		Features struct {
			RunsIdempotency struct {
				Durable bool `json:"durable"`
			} `json:"runs_idempotency"`
		} `json:"features"`
	}
	if err = s.hermesJSON(r.Context(), route, http.MethodGet, "/v1/capabilities", "", nil, &capabilities); err != nil {
		writeHermesError(w, err)
		return
	}
	if !capabilities.Features.RunsIdempotency.Durable {
		writeError(w, 503, "assistant_durable_storage_required")
		return
	}
	run, err := s.repo.ReserveAssistantRun(r.Context(), store.AssistantRun{CompanyID: route.CompanyID, UserID: route.UserID, RequestID: body.RequestID, ConversationID: body.ConversationID, Message: body.Message})
	if err != nil {
		writeAssistantStoreError(w, err)
		return
	}
	if run.RunID == "" {
		// Upstream deduplication expires after 24 hours. An uncertain old admission
		// must be closed, never resubmitted as a potentially second execution.
		if time.Since(run.CreatedAt) > 23*time.Hour {
			if err = s.repo.CancelAssistantRun(r.Context(), route.CompanyID, route.UserID, run.RequestID); err != nil {
				writeAssistantStoreError(w, err)
				return
			}
			if err = s.repo.SettleAssistantRun(r.Context(), route.CompanyID, route.UserID, run.RequestID); err != nil {
				writeAssistantStoreError(w, err)
				return
			}
			writeError(w, 409, "assistant_request_expired_check_saved_conversation")
			return
		}
		var accepted struct {
			RunID string `json:"run_id"`
		}
		err = s.hermesJSON(r.Context(), route, http.MethodPost, "/v1/runs", run.RequestID, map[string]any{"input": body.Message, "session_id": run.ConversationID}, &accepted)
		if err != nil {
			writeHermesError(w, err)
			return
		}
		if !validHermesID(accepted.RunID) {
			writeError(w, 502, "assistant_invalid_service_response")
			return
		}
		// Persist even if the browser has gone away after native admission.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 10*time.Second)
		defer cancel()
		run, err = s.repo.BindAssistantRun(ctx, route.CompanyID, route.UserID, run.RequestID, accepted.RunID)
		if err != nil {
			writeAssistantStoreError(w, err)
			return
		}
	}
	if run.Cancelled {
		s.cancelAssistantRun(w, r, route, run)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"run_id": run.RunID, "conversation_id": run.ConversationID, "status": "started"})
}

func (s *Server) cancelAssistantRun(w http.ResponseWriter, r *http.Request, route HermesRoute, run store.AssistantRun) {
	// Close Mango action admission first. A committed action is never rolled back by Stop.
	if err := s.repo.CancelAssistantRun(r.Context(), route.CompanyID, route.UserID, run.RequestID); err != nil {
		writeAssistantStoreError(w, err)
		return
	}
	var status any
	if err := s.hermesJSON(r.Context(), route, http.MethodPost, "/v1/runs/"+run.RunID+"/stop", "", map[string]any{}, &status); err != nil {
		writeHermesError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"run_id": run.RunID, "status": "stopping", "conversation_id": run.ConversationID})
}

func (s *Server) listAssistantConversations(w http.ResponseWriter, r *http.Request, route HermesRoute) {
	var sessions struct {
		Data []struct {
			ID, Title, Preview string
			LastActive         float64 `json:"last_active"`
			StartedAt          float64 `json:"started_at"`
		} `json:"data"`
		HasMore bool `json:"has_more"`
	}
	offset := r.URL.Query().Get("offset")
	if offset == "" {
		offset = "0"
	}
	n, err := strconv.Atoi(offset)
	if err != nil || n < 0 || n > 1000000 {
		writeError(w, 400, "invalid_offset")
		return
	}
	err = s.hermesJSON(r.Context(), route, http.MethodGet, "/api/sessions?limit=50&offset="+strconv.Itoa(n), "", nil, &sessions)
	if err != nil {
		writeHermesError(w, err)
		return
	}
	conversations := []map[string]any{}
	active, activeErr := s.repo.ActiveAssistantRun(r.Context(), route.CompanyID, route.UserID)
	if activeErr != nil && !errors.Is(activeErr, store.ErrNotFound) {
		writeAssistantStoreError(w, activeErr)
		return
	}
	for _, session := range sessions.Data {
		title := session.Title
		if title == "" {
			title = session.Preview
		}
		if title == "" {
			title = "Mango chat"
		}
		updated := session.LastActive
		if updated == 0 {
			updated = session.StartedAt
		}
		conversations = append(conversations, map[string]any{"id": session.ID, "title": title, "updated_at": time.Unix(int64(updated), 0).UTC().Format(time.RFC3339)})
	}
	if activeErr == nil && n == 0 {
		// Pending admissions may not have a native session row yet; put the active conversation first.
		filtered := []map[string]any{{"id": active.ConversationID, "title": "Current conversation", "updated_at": active.CreatedAt.UTC().Format(time.RFC3339)}}
		for _, c := range conversations {
			if c["id"] != active.ConversationID {
				filtered = append(filtered, c)
			}
		}
		conversations = filtered
	}
	writeJSON(w, 200, map[string]any{"conversations": conversations, "has_more": sessions.HasMore, "offset": n, "next_offset": n + 50})
}

func (s *Server) getAssistantConversation(w http.ResponseWriter, r *http.Request, route HermesRoute, id string) {
	offset := r.URL.Query().Get("offset")
	if offset == "" {
		offset = "0"
	}
	n, parseErr := strconv.Atoi(offset)
	if parseErr != nil || n < 0 || n > 1000000 {
		writeError(w, 400, "invalid_offset")
		return
	}
	var messages struct {
		Data []struct {
			ID      any    `json:"id"`
			Role    string `json:"role"`
			Content any    `json:"content"`
		} `json:"data"`
	}
	active, err := s.repo.ActiveAssistantRun(r.Context(), route.CompanyID, route.UserID)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeAssistantStoreError(w, err)
		return
	}
	content := []map[string]string{}
	if err = s.hermesJSON(r.Context(), route, http.MethodGet, "/api/sessions/"+url.PathEscape(id)+"/messages?limit=500&order=latest&offset="+strconv.Itoa(n), "", nil, &messages); err != nil {
		var upstream hermesHTTPError
		if !(active.ConversationID == id && active.RunID == "" && !active.Settled && errors.As(err, &upstream) && upstream.status == 404) {
			writeHermesError(w, err)
			return
		}
	}
	for _, message := range messages.Data {
		if message.Role == "user" || message.Role == "assistant" {
			if text, ok := message.Content.(string); ok && text != "" {
				content = append(content, map[string]string{"id": fmt.Sprint(message.ID), "role": message.Role, "content": text})
			}
		}
	}
	result := map[string]any{"id": id, "messages": content, "has_older_messages": len(messages.Data) == 500, "next_message_offset": n + 500}
	if active.ConversationID == id && !active.Settled {
		if active.RunID != "" {
			result["active_run_id"] = active.RunID
		} else {
			result["pending_submission"] = map[string]string{"request_id": active.RequestID, "conversation_id": id, "message": active.Message}
		}
	}
	writeJSON(w, 200, result)
}

func (s *Server) streamAssistantRun(w http.ResponseWriter, r *http.Request, route HermesRoute, run store.AssistantRun) {
	status, err := s.refreshAssistantRun(r.Context(), route, run)
	if err != nil {
		writeHermesError(w, err)
		return
	}
	controller := http.NewResponseController(w)
	_ = controller.SetWriteDeadline(time.Time{})
	emit := func(event map[string]any) bool {
		encoded, _ := json.Marshal(event)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", encoded); err != nil {
			return false
		}
		return controller.Flush() == nil
	}
	if assistantTerminal(status.Status) {
		w.Header().Set("Content-Type", "text/event-stream")
		emit(map[string]any{"event": "run." + status.Status, "run_id": run.RunID, "output": status.Output, "error": status.Error})
		return
	}
	release, err := s.repo.AcquireAssistantStream(r.Context(), route.CompanyID, route.UserID, run.RequestID)
	if errors.Is(err, store.ErrConflict) {
		writeError(w, 409, "assistant_response_open_elsewhere")
		return
	}
	if err != nil {
		writeAssistantStoreError(w, err)
		return
	}
	defer release()
	resp, err := s.hermesRequest(r.Context(), route, http.MethodGet, "/v1/runs/"+run.RunID+"/events", "", nil)
	if err != nil {
		writeHermesError(w, err)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	_ = controller.Flush()
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, ":") {
			if _, err = io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			if controller.Flush() != nil {
				return
			}
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		var source map[string]json.RawMessage
		if json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &source) != nil {
			continue
		}
		var event, runID string
		_ = json.Unmarshal(source["event"], &event)
		_ = json.Unmarshal(source["run_id"], &runID)
		if runID != run.RunID {
			continue
		}
		out := map[string]any{"event": event, "run_id": runID}
		switch event {
		case "message.delta":
			var delta string
			_ = json.Unmarshal(source["delta"], &delta)
			out["delta"] = delta
		case "run.completed":
			var output string
			_ = json.Unmarshal(source["output"], &output)
			out["output"] = output
		case "run.failed", "run.interrupted":
			out["error"] = "The assistant could not finish this reply. Check the Hermes service provider configuration."
		case "run.cancelled", "run.started":
		default:
			continue
		}
		if !emit(out) {
			return
		}
	}
	// Native streams are consumptive. Clients recover via GET status/transcript after EOF.
}
