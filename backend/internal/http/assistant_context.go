package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"miraeopus/backend/internal/store"
)

const assistantTraceLimit = 8 << 20
const assistantTraceTotalLimit = 64 << 20

func assistantUserContext(actor ActorContext, role string) map[string]string {
	return map[string]string{"user_id": actor.User.UserID, "display_name": actor.User.DisplayName, "email": actor.User.Email, "company_id": actor.CompanyID, "company_role": role}
}

// Captures are immutable JSON in memory, never reconstructed from edited files.
// The assistant mutex protects captures and their completion state.
type assistantTrace struct {
	Sequence int             `json:"sequence"`
	Kind     string          `json:"kind"`
	Status   string          `json:"status"`
	Time     string          `json:"time"`
	Data     json.RawMessage `json:"data"`
}
type assistantCapture struct {
	events    []assistantTrace
	startTime time.Time
	bytes     int
	finished  bool
	done      chan struct{}
	inspect   bool
}

var assistantSecretURL = regexp.MustCompile(`(?i)https?://[^\s"<>]*(?:[?&](?:x-amz-signature|x-amz-credential|token|access_token|key|sig|signature)=)[^\s"<>]*`)

// Omit credentials and opaque/private continuation data, with visible markers.
func assistantSanitize(value any, apiKey string) any {
	switch value := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(value))
		for key, item := range value {
			switch strings.ToLower(key) {
			case "authorization", "headers", "api_key", "apikey", "access_token", "refresh_token", "encrypted_content", "thinkingsignature", "textsignature":
				result[key] = "[security omission]"
			default:
				result[key] = assistantSanitize(item, apiKey)
			}
		}
		return result
	case []any:
		result := make([]any, len(value))
		for i, item := range value {
			result[i] = assistantSanitize(item, apiKey)
		}
		return result
	case string:
		if apiKey != "" {
			value = strings.ReplaceAll(value, apiKey, "[credential omitted]")
		}
		return assistantSecretURL.ReplaceAllString(value, "[secret URL omitted]")
	default:
		return value
	}
}

func (s *Server) captureAssistant(r *http.Request, capture *assistantCapture, emit func(assistantEvent) error, kind, status string, data any) error {
	encoded, err := json.Marshal(data)
	if err != nil {
		return err
	}
	var value any
	if err = json.Unmarshal(encoded, &value); err != nil {
		return err
	}
	encoded, err = json.Marshal(assistantSanitize(value, s.assistant.apiKey))
	if err != nil {
		return err
	}
	a := s.assistant
	a.mu.Lock()
	event := assistantTrace{Sequence: len(capture.events) + 1, Kind: kind, Status: status, Time: time.Now().UTC().Format(time.RFC3339Nano), Data: encoded}
	serialized, _ := json.Marshal(event)
	// Reserve a terminal marker: reaching a limit never silently truncates data.
	reserve := 2048
	if kind == "termination" {
		reserve = 0
	}
	if capture.bytes+len(serialized) > assistantTraceLimit-reserve {
		a.mu.Unlock()
		return assistantActionError{errors.New("Inspection reached its memory limit. Further work stopped; retained events and saved changes remain.")}
	}
	capture.events = append(capture.events, event)
	capture.bytes += len(serialized)
	a.mu.Unlock()
	if capture.inspect && emit != nil && r.Context().Err() == nil {
		actor, ok := authenticatedActor(r)
		role, err := s.currentActorRoleForCompanyContext(r.Context(), actor, actor.CompanyID)
		if !ok || err != nil || role == "" {
			return assistantActionError{errors.New("Context inspection is no longer available for this account.")}
		}
		return emit(assistantEvent{Type: "trace", Trace: &event})
	}
	return nil
}

// Save the existing sanitized events once, after the terminal outcome. This is
// diagnostic storage only: a failed save must never retry or fail business work.
func (s *Server) finishAssistantCapture(r *http.Request, request assistantRequest, emit func(assistantEvent) error, runErr error) {
	actor, ok := authenticatedActor(r)
	if !ok {
		return
	}
	a := s.assistant
	key := actor.CompanyID + ":" + actor.User.UserID + ":" + request.RequestID
	a.mu.Lock()
	capture := a.captures[key]
	if capture == nil || capture.finished {
		a.mu.Unlock()
		return
	}
	capture.inspect = request.InspectContext
	a.mu.Unlock()
	status, message := "completed", "Foreground interaction completed."
	if runErr != nil {
		status, message = "failed", "Chat stopped. Check saved work before repeating an action."
		var actionError assistantActionError
		if errors.As(runErr, &actionError) {
			message = actionError.Error()
		}
	}
	if r.Context().Err() != nil {
		status, message = "stopped", "Cancellation or deadline stopped further work. An entered action may have committed."
	}
	_ = s.captureAssistant(r, capture, emit, "termination", status, map[string]any{"message": message})
	finishTime := time.Now().UTC()
	a.finishAssistantResult(key)
	a.mu.Lock()
	capture.finished = true
	close(capture.done)
	a.mu.Unlock()
	inspection, err := json.Marshal(capture.events)
	if err == nil {
		// Stop cancels provider/tools, but cannot cancel the final archive attempt.
		// This synchronous, bounded save runs no model or business action.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
		defer cancel()
		err = s.repo.SaveAIRunContext(ctx, store.AIRun{
			CompanyID: actor.CompanyID, UserID: actor.User.UserID, AIRunsID: request.RequestID,
			StartTime: capture.startTime, FinishTime: finishTime, InspectionJSON: inspection,
		})
	}
	if err != nil {
		// Database errors can contain inspection data; log no body or raw error.
		log.Printf("assistant_inspection_archive status=failed")
	}
	a.mu.Lock()
	if !capture.inspect {
		delete(a.captures, key)
	}
	a.mu.Unlock()
}

// One bounded recovery read preserves an already entered action's outcome after
// Stop. Only the same actor/company with current company access can read it.
func (s *Server) handleAssistantTrace(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if r.Context().Err() != nil {
		return
	}
	actor, ok := s.requireAssistantActor(w, r)
	if !ok {
		return
	}
	id := r.URL.Query().Get("request_id")
	if !isUUIDText(id) {
		writeError(w, http.StatusBadRequest, "invalid_assistant_request")
		return
	}
	if s.assistant == nil {
		writeError(w, http.StatusNotFound, "assistant_trace_unavailable")
		return
	}
	a := s.assistant
	key := actor.CompanyID + ":" + actor.User.UserID + ":" + id
	a.mu.Lock()
	capture := a.captures[key]
	if time.Now().After(a.requests[key]) || (capture != nil && !capture.inspect) {
		capture = nil
	}
	a.mu.Unlock()
	if capture == nil {
		writeError(w, http.StatusNotFound, "assistant_trace_unavailable")
		return
	}
	select {
	case <-capture.done:
	case <-time.After(5 * time.Second):
	case <-r.Context().Done():
		return
	}
	if r.Context().Err() != nil {
		return
	}
	_, ok = s.requireAssistantActor(w, r)
	if !ok {
		return
	}
	if r.Context().Err() != nil {
		return
	}
	a.mu.Lock()
	if time.Now().After(a.requests[key]) || a.captures[key] != capture {
		a.mu.Unlock()
		writeError(w, http.StatusNotFound, "assistant_trace_unavailable")
		return
	}
	snapshot := map[string]any{"events": append([]assistantTrace{}, capture.events...), "finished": capture.finished}
	if result := a.results[key]; result != nil {
		if result.Process != nil {
			snapshot["process"] = *result.Process
		}
		if result.NodeID != "" {
			snapshot["node_id"] = result.NodeID
		}
	}
	a.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, snapshot)
}
