package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"miraeopus/backend/internal/domain"
)

const (
	assistantTimeout          = 90 * time.Second
	assistantMaxSteps         = 16
	assistantMaxOutputBytes   = 32000
	assistantRequestRetention = 15 * time.Minute
)

// AssistantConfig is server-only. APIKey and Model enable chat; DeepgramAPIKey enables dictation.
type AssistantConfig struct {
	APIKey         string
	Model          string
	DeepgramAPIKey string
}

type mangoAssistant struct {
	apiKey      string
	runtimePath string
	nodePath    string
	baseURL     string
	captures    map[string]*assistantCapture
	results     map[string]*assistantResult
	shutdown    context.Context
	stop        context.CancelFunc
	model       string
	mu          sync.Mutex
	active      map[string]bool
	requests    map[string]time.Time
}

func newMangoAssistant(config AssistantConfig) *mangoAssistant {
	if strings.TrimSpace(config.APIKey) == "" || strings.TrimSpace(config.Model) == "" {
		return nil
	}
	runtimePath, nodePath := assistantRuntimePaths()
	shutdown, stop := context.WithCancel(context.Background())
	return &mangoAssistant{
		apiKey: config.APIKey, runtimePath: runtimePath, nodePath: nodePath,
		model: strings.TrimSpace(config.Model), active: make(map[string]bool),
		requests: make(map[string]time.Time), captures: make(map[string]*assistantCapture), results: make(map[string]*assistantResult),
		shutdown: shutdown, stop: stop,
	}
}

type assistantMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type assistantRequest struct {
	RequestID       string             `json:"request_id"`
	ProcessID       string             `json:"process_id,omitempty"`
	InspectContext  bool               `json:"inspect_context,omitempty"`
	ReasoningEffort string             `json:"reasoning_effort"`
	Messages        []assistantMessage `json:"messages"`
}

type assistantEvent struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	Name      string          `json:"name,omitempty"`
	Status    string          `json:"status,omitempty"`
	Message   string          `json:"message,omitempty"`
	NodeID    string          `json:"node_id,omitempty"`
	ProcessID string          `json:"process_id,omitempty"`
	Trace     *assistantTrace `json:"trace,omitempty"`
}

// Only messages authored by the fixed Mango dispatcher may reach the browser.
type assistantActionError struct{ error }

func (s *Server) requireAssistantActor(w http.ResponseWriter, r *http.Request) (ActorContext, bool) {
	actor, ok := authenticatedActor(r)
	if !ok || actor.User.UserID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return actor, false
	}
	if !isUUIDText(actor.CompanyID) {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return actor, false
	}
	role, err := s.currentActorRoleForCompanyContext(r.Context(), actor, actor.CompanyID)
	if err != nil || role == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return actor, false
	}
	actor.CompanyRole = role
	return actor, true
}

func (s *Server) handleAssistantStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := s.requireAssistantActor(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]bool{"available": s.assistant != nil && s.assistant.available(), "can_inspect_context": actor.CompanyRole == domain.RoleDevAdmin})
}

func (s *Server) handleAssistantChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), assistantTimeout)
	defer cancel()
	r = r.WithContext(ctx)
	actor, ok := s.requireAssistantActor(w, r)
	if !ok {
		return
	}
	if s.assistant == nil || !s.assistant.available() {
		writeError(w, http.StatusServiceUnavailable, "assistant_unavailable")
		return
	}
	var request assistantRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256000))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_assistant_request")
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF || !validAssistantRequest(request) {
		writeError(w, http.StatusBadRequest, "invalid_assistant_request")
		return
	}
	if request.InspectContext && actor.CompanyRole != domain.RoleDevAdmin {
		writeError(w, http.StatusForbidden, "assistant_context_inspection_denied")
		return
	}
	owner := actor.CompanyID + ":" + actor.User.UserID
	if !s.assistant.begin(owner, request.RequestID) {
		writeError(w, http.StatusConflict, "assistant_request_already_started_or_busy")
		return
	}
	var runErr error
	defer func() {
		// Also finalize admitted Sends that lose the connection before Pi starts.
		s.finishAssistantCapture(r, request, nil, runErr)
		s.assistant.finish(owner)
	}()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	// Bound a slow browser as well as provider work; existing wrappers expose Unwrap.
	_ = controller.SetWriteDeadline(time.Now().Add(assistantTimeout))
	if _, err := io.WriteString(w, ": connected\n\n"); err != nil {
		runErr = err
		return
	}
	if err := controller.Flush(); err != nil {
		runErr = err
		return
	}
	emit := func(event assistantEvent) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		data, _ := json.Marshal(event)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
			return err
		}
		return controller.Flush()
	}
	runErr = s.runAssistant(r, request, emit)
	if runErr != nil {
		// Never expose or log SDK errors: they may contain credentials, prompts or provider internals.
		message := "Chat stopped. Check Mango before repeating an action; completed changes may remain."
		var actionError assistantActionError
		if errors.As(runErr, &actionError) {
			message = actionError.Error()
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			message = "Chat reached its time limit. Completed changes may remain."
		}
		// A timeout still deserves a terminal event while the browser is connected.
		if !errors.Is(r.Context().Err(), context.Canceled) {
			data, _ := json.Marshal(assistantEvent{Type: "error", Message: message})
			_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
			_ = controller.Flush()
		}
		return
	}
	_ = emit(assistantEvent{Type: "done"})
}

func validAssistantRequest(request assistantRequest) bool {
	if request.ProcessID != "" && !isCanonicalUUID(request.ProcessID) {
		return false
	}
	if !isUUIDText(request.RequestID) || !validAssistantReasoningEffort(request.ReasoningEffort) || len(request.Messages) == 0 || len(request.Messages) > 24 {
		return false
	}
	total := 0
	for _, message := range request.Messages {
		size := utf8.RuneCountInString(message.Content)
		limit := 8000
		if message.Role == "assistant" {
			limit = assistantMaxOutputBytes
		}
		if (message.Role != "user" && message.Role != "assistant") || strings.TrimSpace(message.Content) == "" || size > limit {
			return false
		}
		total += size
	}
	return total <= 48000 && request.Messages[len(request.Messages)-1].Role == "user"
}

func validAssistantReasoningEffort(effort string) bool {
	switch effort {
	case "low", "medium", "high", "xhigh", "max":
		return true
	default:
		return false
	}
}

// These short-lived receipts prevent in-process double sends, including after a lost
// reply. They deliberately do not promise exactly-once execution across restarts.
func (a *mangoAssistant) begin(owner, id string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	for key, expiry := range a.requests {
		if now.After(expiry) {
			delete(a.requests, key)
			delete(a.captures, key)
			delete(a.results, key)
		}
	}
	key := owner + ":" + id
	if a.active[owner] || !a.requests[key].IsZero() || len(a.requests) >= 2048 {
		return false
	}
	// Browser turns keep earlier traces; the server keeps only this actor's
	// current interaction for Stop recovery, reserving 8 MiB before admission.
	for previous := range a.captures {
		if strings.HasPrefix(previous, owner+":") {
			delete(a.captures, previous)
		}
	}
	if len(a.captures) >= assistantTraceTotalLimit/assistantTraceLimit {
		return false
	}
	a.captures[key] = &assistantCapture{events: []assistantTrace{}, startTime: now.UTC(), done: make(chan struct{})}
	if a.results == nil {
		a.results = make(map[string]*assistantResult)
	}
	a.results[key] = &assistantResult{done: make(chan struct{})}
	a.active[owner] = true
	a.requests[key] = now.Add(assistantRequestRetention)
	return true
}

func (a *mangoAssistant) finish(owner string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.active, owner)
}
