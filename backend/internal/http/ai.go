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

type aiSubmission struct {
	CompanyID string `json:"company_id"`
	ChatID    string `json:"chat_id"`
	RunID     string `json:"run_id"`
	Message   string `json:"message"`
}

// Hermes names its own execution and session IDs. Browser IDs belong to Mango.
type hermesRunStatus struct {
	RunID     string  `json:"run_id"`
	SessionID string  `json:"session_id"`
	Status    string  `json:"status"`
	Output    string  `json:"output,omitempty"`
	Error     string  `json:"error,omitempty"`
	UpdatedAt float64 `json:"updated_at"`
}

func aiTerminal(status string) bool {
	switch status {
	case "completed", "failed", "cancelled", "interrupted":
		return true
	}
	return false
}

func (s *Server) aiScope(w http.ResponseWriter, r *http.Request, companyID string) (ActorContext, HermesRoute, bool) {
	actor, ok := authenticatedActor(r)
	if !ok || actor.User.UserID == "" {
		writeError(w, 401, "ai_authentication_required")
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
	writeError(w, 503, "ai_not_configured_for_account")
	return actor, HermesRoute{}, false
}

func aiDecode(w http.ResponseWriter, r *http.Request, out any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		writeError(w, 400, "invalid_ai_request")
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		writeError(w, 400, "invalid_ai_request")
		return false
	}
	return true
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

func writeAIStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, 404, "ai_run_or_chat_unavailable")
	case errors.Is(err, store.ErrConflict):
		writeError(w, 409, "ai_run_active_or_request_conflict")
	case errors.Is(err, store.ErrInvalid):
		writeError(w, 400, "invalid_ai_request")
	default:
		writeError(w, 503, "ai_storage_unavailable")
	}
}

func (s *Server) handleAI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/ai/"), "/")
	if len(parts) == 1 && r.Method == http.MethodPost {
		if parts[0] == "runs" {
			s.createAIRun(w, r)
			return
		}
		if parts[0] == "chats" {
			s.createAIChat(w, r)
			return
		}
	}
	companyID := r.URL.Query().Get("company_id")
	if r.Method == http.MethodPost {
		var body struct {
			CompanyID string `json:"company_id"`
		}
		if !aiDecode(w, r, &body) {
			return
		}
		companyID = body.CompanyID
	}
	_, route, ok := s.aiScope(w, r, companyID)
	if !ok {
		return
	}
	switch {
	case r.Method == http.MethodGet && len(parts) == 1 && parts[0] == "chats":
		s.listAIChats(w, r, route)
	case r.Method == http.MethodGet && len(parts) == 2 && parts[0] == "chats" && validHermesID(parts[1]):
		s.getAIChat(w, r, route, parts[1])
	case len(parts) >= 2 && parts[0] == "runs" && isCanonicalUUID(parts[1]):
		run, err := s.repo.GetAIRun(r.Context(), route.CompanyID, route.UserID, parts[1])
		if err != nil {
			writeAIStoreError(w, err)
			return
		}
		switch {
		case r.Method == http.MethodGet && len(parts) == 2:
			run, err = s.refreshAIRun(r.Context(), route, run)
			if err != nil {
				writeHermesError(w, err)
				return
			}
			writeJSON(w, 200, aiRunResponse(run))
		case r.Method == http.MethodGet && len(parts) == 3 && parts[2] == "events":
			s.streamAIRun(w, r, route, run)
		case r.Method == http.MethodPost && len(parts) == 3 && parts[2] == "cancel":
			s.cancelAIRun(w, r, route, run)
		default:
			writeError(w, 405, "method_not_allowed")
		}
	default:
		writeError(w, 404, "not_found")
	}
}

func aiRunResponse(run store.AIRun) map[string]any {
	out := map[string]any{"run_id": run.RunID, "chat_id": run.ChatID, "status": run.Status, "history": run.History, "created_timestamp": run.CreatedAt, "output": aiRunOutput(run)}
	if message := aiRunError(run); message != "" {
		out["error"] = message
	}
	if run.PendingInput != "" && run.HermesRunID == "" && !aiTerminal(run.Status) {
		out["pending_submission"] = aiSubmission{CompanyID: run.CompanyID, ChatID: run.ChatID, RunID: run.RunID, Message: run.PendingInput}
	}
	return out
}

func aiRunOutput(run store.AIRun) string {
	for i := len(run.History) - 1; i >= 0; i-- {
		var data struct {
			Output string `json:"output"`
		}
		if json.Unmarshal(run.History[i].Data, &data) == nil && data.Output != "" {
			return data.Output
		}
	}
	return ""
}
func aiRunError(run store.AIRun) string {
	if run.Status == "failed" || run.Status == "interrupted" {
		return "The AI could not finish this reply. Its saved history remains available."
	}
	return ""
}

func (s *Server) createAIChat(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CompanyID string `json:"company_id"`
		ChatID    string `json:"chat_id"`
		Name      string `json:"name"`
	}
	if !aiDecode(w, r, &body) {
		return
	}
	_, route, ok := s.aiScope(w, r, body.CompanyID)
	if !ok {
		return
	}
	if !isCanonicalUUID(body.ChatID) || len(body.Name) > 200 || strings.ContainsRune(body.Name, '\x00') {
		writeError(w, 400, "invalid_ai_chat")
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		body.Name = "New chat"
	}
	chat, err := s.repo.UpsertAIChat(r.Context(), store.AIChat{CompanyID: route.CompanyID, UserID: route.UserID, ChatID: body.ChatID, Name: body.Name})
	if err != nil {
		writeAIStoreError(w, err)
		return
	}
	writeJSON(w, 201, chat)
}

func (s *Server) createAIRun(w http.ResponseWriter, r *http.Request) {
	var body aiSubmission
	if !aiDecode(w, r, &body) {
		return
	}
	_, route, ok := s.aiScope(w, r, body.CompanyID)
	if !ok {
		return
	}
	if !isCanonicalUUID(body.RunID) || strings.TrimSpace(body.Message) == "" || len(body.Message) > 32000 || strings.ContainsRune(body.Message, '\x00') || body.ChatID != "" && !validHermesID(body.ChatID) {
		writeError(w, 400, "invalid_ai_request")
		return
	}
	// Resolve an existing ID before interpreting replacement text or chat. The first submission wins.
	run, err := s.repo.GetAIRun(r.Context(), route.CompanyID, route.UserID, body.RunID)
	if errors.Is(err, store.ErrNotFound) {
		active, activeErr := s.repo.ActiveAIRun(r.Context(), route.CompanyID, route.UserID)
		if activeErr == nil && active.HermesRunID != "" {
			if active, err = s.refreshAIRun(r.Context(), route, active); err != nil {
				writeHermesError(w, err)
				return
			}
		} else if activeErr != nil && !errors.Is(activeErr, store.ErrNotFound) {
			writeAIStoreError(w, activeErr)
			return
		}
		if activeErr == nil && !aiTerminal(active.Status) {
			writeAIStoreError(w, store.ErrConflict)
			return
		}
		if body.ChatID == "" {
			body.ChatID = body.RunID
			name := []rune(strings.TrimSpace(body.Message))
			if len(name) > 80 {
				name = name[:80]
			}
			_, err = s.repo.UpsertAIChat(r.Context(), store.AIChat{CompanyID: route.CompanyID, UserID: route.UserID, ChatID: body.ChatID, Name: string(name)})
		} else {
			_, err = s.repo.GetAIChat(r.Context(), route.CompanyID, route.UserID, body.ChatID)
		}
		if err != nil {
			writeAIStoreError(w, err)
			return
		}
		run, err = s.repo.ReserveAIRun(r.Context(), store.AIRun{CompanyID: route.CompanyID, UserID: route.UserID, RunID: body.RunID, ChatID: body.ChatID, PendingInput: body.Message})
	}
	if err != nil {
		writeAIStoreError(w, err)
		return
	}
	if aiTerminal(run.Status) {
		writeJSON(w, 202, aiRunResponse(run))
		return
	}
	if run.HermesRunID == "" {
		run, err = s.admitAIRun(r.Context(), route, run)
		if errors.Is(err, errAIRunExpired) {
			writeError(w, 409, "ai_request_expired_check_saved_chat")
			return
		}
		if err != nil {
			writeHermesError(w, err)
			return
		}
	}
	if run.Status == "stopping" {
		s.cancelAIRun(w, r, route, run)
		return
	}
	writeJSON(w, 202, aiRunResponse(run))
}

var errAIRunExpired = errors.New("AI pending run expired")

func (s *Server) admitAIRun(ctx context.Context, route HermesRoute, run store.AIRun) (store.AIRun, error) {
	if time.Since(run.CreatedAt) > 23*time.Hour {
		closed, err := s.repo.SetAIRunStatus(ctx, route.CompanyID, route.UserID, run.RunID, "interrupted")
		if err != nil {
			return run, err
		}
		return closed, errAIRunExpired
	}
	var capabilities struct {
		Features struct {
			RunsIdempotency struct {
				Durable bool `json:"durable"`
			} `json:"runs_idempotency"`
		} `json:"features"`
	}
	if err := s.hermesJSON(ctx, route, http.MethodGet, "/v1/capabilities", "", nil, &capabilities); err != nil {
		return run, err
	}
	if !capabilities.Features.RunsIdempotency.Durable {
		return run, errAINotDurable
	}
	var accepted struct {
		RunID string `json:"run_id"`
	}
	err := s.hermesJSON(ctx, route, http.MethodPost, "/v1/runs", run.RunID, map[string]any{"input": run.PendingInput, "session_id": run.ChatID}, &accepted)
	if err != nil {
		return run, err
	}
	if !validHermesID(accepted.RunID) {
		return run, errors.New("invalid Hermes execution ID")
	}
	bindContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	return s.repo.BindAIRun(bindContext, route.CompanyID, route.UserID, run.RunID, accepted.RunID)
}

var errAINotDurable = errors.New("Hermes durable storage required")

func (s *Server) refreshAIRun(ctx context.Context, route HermesRoute, run store.AIRun) (store.AIRun, error) {
	if run.HermesRunID == "" || aiTerminal(run.Status) {
		return run, nil
	}
	var native hermesRunStatus
	err := s.hermesJSON(ctx, route, http.MethodGet, "/v1/runs/"+url.PathEscape(run.HermesRunID), "", nil, &native)
	if err != nil {
		var upstream hermesHTTPError
		if errors.As(err, &upstream) && upstream.status == 404 {
			return s.repo.SetAIRunStatus(ctx, route.CompanyID, route.UserID, run.RunID, "interrupted")
		}
		return run, err
	}
	if native.RunID != run.HermesRunID || native.SessionID != run.ChatID {
		return run, errors.New("Hermes run identity mismatch")
	}
	if native.Status == "queued" {
		return run, nil
	}
	if aiTerminal(native.Status) {
		// Keep a final status snapshot before native retention expires. Polling is recovery; hooks record the execution steps.
		if native.Output != "" {
			data, _ := json.Marshal(map[string]string{"output": native.Output})
			at := run.CreatedAt
			if native.UpdatedAt > 0 {
				at = time.UnixMicro(int64(native.UpdatedAt * 1e6))
			}
			event := store.AIHistoryEvent{ID: "native.final_output", Type: "message.completed", CreatedAt: at, Data: data}
			found := false
			for _, saved := range run.History {
				if saved.ID == event.ID {
					found = true
					break
				}
			}
			if !found {
				updated, appendErr := s.repo.AppendAIHistoryEvent(ctx, route.CompanyID, route.UserID, run.RunID, event)
				if appendErr != nil {
					return run, appendErr
				}
				run = updated
			}
		}
	}
	return s.repo.SetAIRunStatus(ctx, route.CompanyID, route.UserID, run.RunID, native.Status)
}

func (s *Server) cancelAIRun(w http.ResponseWriter, r *http.Request, route HermesRoute, run store.AIRun) {
	if aiTerminal(run.Status) {
		writeJSON(w, 200, aiRunResponse(run))
		return
	}
	run, err := s.repo.SetAIRunStatus(r.Context(), route.CompanyID, route.UserID, run.RunID, "stopping")
	if err != nil {
		writeAIStoreError(w, err)
		return
	}
	if aiTerminal(run.Status) {
		writeJSON(w, 200, aiRunResponse(run))
		return
	}
	if run.HermesRunID == "" {
		run, err = s.admitAIRun(r.Context(), route, run)
		if errors.Is(err, errAIRunExpired) {
			writeJSON(w, 200, aiRunResponse(run))
			return
		}
		if err != nil {
			writeHermesError(w, err)
			return
		}
	}
	var native any
	if err = s.hermesJSON(r.Context(), route, http.MethodPost, "/v1/runs/"+run.HermesRunID+"/stop", "", map[string]any{}, &native); err != nil {
		writeHermesError(w, err)
		return
	}
	writeJSON(w, 200, aiRunResponse(run))
}

func aiOffset(w http.ResponseWriter, r *http.Request) (int, bool) {
	text := r.URL.Query().Get("offset")
	if text == "" {
		return 0, true
	}
	n, err := strconv.Atoi(text)
	if err != nil || n < 0 || n > 1000000 {
		writeError(w, 400, "invalid_offset")
		return 0, false
	}
	return n, true
}
func (s *Server) listAIChats(w http.ResponseWriter, r *http.Request, route HermesRoute) {
	n, ok := aiOffset(w, r)
	if !ok {
		return
	}
	chats, err := s.repo.ListAIChats(r.Context(), route.CompanyID, route.UserID, 51, n)
	if err != nil {
		writeAIStoreError(w, err)
		return
	}
	more := len(chats) > 50
	if more {
		chats = chats[:50]
	}
	if chats == nil {
		chats = []store.AIChat{}
	}
	writeJSON(w, 200, map[string]any{"chats": chats, "has_more": more, "offset": n, "next_offset": n + 50})
}
func (s *Server) getAIChat(w http.ResponseWriter, r *http.Request, route HermesRoute, id string) {
	n, ok := aiOffset(w, r)
	if !ok {
		return
	}
	chat, err := s.repo.GetAIChat(r.Context(), route.CompanyID, route.UserID, id)
	if err != nil {
		writeAIStoreError(w, err)
		return
	}
	messages, err := s.repo.ListAIMessages(r.Context(), route.CompanyID, route.UserID, id, 500, n)
	if err != nil {
		writeAIStoreError(w, err)
		return
	}
	if messages == nil {
		messages = []store.AIMessage{}
	}
	result := map[string]any{"chat_id": id, "name": chat.Name, "messages": messages, "has_older_messages": len(messages) == 500, "next_message_offset": n + 500}
	active, err := s.repo.ActiveAIRun(r.Context(), route.CompanyID, route.UserID)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeAIStoreError(w, err)
		return
	}
	if active.ChatID == id {
		result["active_run_id"] = active.RunID
		if active.HermesRunID == "" {
			result["pending_submission"] = aiSubmission{CompanyID: active.CompanyID, ChatID: id, RunID: active.RunID, Message: active.PendingInput}
		}
	}
	writeJSON(w, 200, result)
}

func (s *Server) streamAIRun(w http.ResponseWriter, r *http.Request, route HermesRoute, run store.AIRun) {
	status, err := s.refreshAIRun(r.Context(), route, run)
	if err != nil {
		writeHermesError(w, err)
		return
	}
	run = status
	controller := http.NewResponseController(w)
	_ = controller.SetWriteDeadline(time.Time{})
	emit := func(event map[string]any) bool {
		encoded, _ := json.Marshal(event)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", encoded); err != nil {
			return false
		}
		return controller.Flush() == nil
	}
	if aiTerminal(status.Status) {
		w.Header().Set("Content-Type", "text/event-stream")
		emit(map[string]any{"event": "run." + status.Status, "run_id": run.RunID, "output": aiRunOutput(status), "error": aiRunError(status)})
		return
	}
	if run.HermesRunID == "" {
		writeError(w, 409, "ai_run_pending")
		return
	}
	release, err := s.repo.AcquireAIStream(r.Context(), route.CompanyID, route.UserID, run.RunID)
	if errors.Is(err, store.ErrConflict) {
		writeError(w, 409, "ai_response_open_elsewhere")
		return
	}
	if err != nil {
		writeAIStoreError(w, err)
		return
	}
	defer release()
	resp, err := s.hermesRequest(r.Context(), route, http.MethodGet, "/v1/runs/"+run.HermesRunID+"/events", "", nil)
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
		if runID != run.HermesRunID {
			continue
		}
		out := map[string]any{"event": event, "run_id": run.RunID}
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
			out["error"] = "The AI could not finish this reply. Check the Hermes service provider configuration."
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
