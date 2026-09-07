package httpapi

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

// Each private credential identifies exactly one company/user Hermes home.
func (s *Server) hermesCallbackScope(w http.ResponseWriter, r *http.Request) (HermesRoute, ActorContext, bool) {
	key, bearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	var route HermesRoute
	if bearer {
		for _, candidate := range s.hermesRoutes {
			if candidate.CallbackKey != "" && subtle.ConstantTimeCompare([]byte(key), []byte(candidate.CallbackKey)) == 1 {
				route = candidate
				break
			}
		}
	}
	if route.UserID == "" {
		writeError(w, 401, "unauthorized")
		return route, ActorContext{}, false
	}
	memberships, err := s.freshUserMemberships(r.Context(), route.UserID)
	if err != nil {
		writeError(w, 503, "company_access_unavailable")
		return route, ActorContext{}, false
	}
	actor := ActorContext{User: domain.User{UserID: route.UserID}, Memberships: normalizeMembershipRoles(memberships), CompanyID: route.CompanyID}
	actor.CompanyRole = actorRoleForCompany(actor, route.CompanyID)
	if actor.CompanyRole == "" {
		writeError(w, 403, "company_access_denied")
		return route, actor, false
	}
	return route, actor, true
}

type hermesHistoryCallback struct {
	RunID         string          `json:"run_id"`
	SessionID     string          `json:"session_id"`
	EventID       string          `json:"event_id"`
	Type          string          `json:"type"`
	CreatedAt     time.Time       `json:"created_at"`
	Data          json.RawMessage `json:"data"`
	ChatName      string          `json:"chat_name"`
	ChatCreatedAt time.Time       `json:"chat_created_at"`
	Messages      []struct {
		MessageID  int64     `json:"message_id"`
		Role       string    `json:"role"`
		Content    string    `json:"content"`
		CreatedAt  time.Time `json:"created_at"`
		CurrentRun bool      `json:"current_run"`
	} `json:"messages"`
	MessagesComplete bool    `json:"messages_complete"`
	MessageIDs       []int64 `json:"message_ids"`
}

// Keep provider reasoning, prompts, credentials and raw tool payloads outside
// Mango's history. The native plugin emits only these observed fields.
func validHermesHistoryData(kind string, raw json.RawMessage) bool {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return false
	}
	allowed := map[string]string{}
	switch kind {
	case "run.started":
		allowed["model"] = "text"
	case "model.started":
		allowed["model"], allowed["call"] = "text", "number"
	case "model.completed":
		allowed["call"], allowed["duration_seconds"] = "number", "number"
	case "model.failed", "messages.saved", "history.recovered":
	case "tool.started", "tool.completed":
		allowed["tool_name"], allowed["tool_call_id"] = "text", "text"
		if kind == "tool.completed" {
			allowed["succeeded"] = "bool"
		}
	case "message.completed":
		allowed["output"] = "text"
	case "run.finished":
		allowed["completed"], allowed["failed"], allowed["interrupted"], allowed["output"] = "bool", "bool", "bool", "text"
	default:
		return false
	}
	for key, value := range fields {
		switch allowed[key] {
		case "text":
			var text string
			if json.Unmarshal(value, &text) != nil || bytes.Equal(value, []byte("null")) || strings.ContainsRune(text, '\x00') {
				return false
			}
		case "bool":
			var flag bool
			if json.Unmarshal(value, &flag) != nil || bytes.Equal(value, []byte("null")) {
				return false
			}
		case "number":
			var number float64
			if json.Unmarshal(value, &number) != nil || bytes.Equal(value, []byte("null")) || number < 0 {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func (s *Server) historyAIRun(ctx context.Context, route HermesRoute, nativeID, chatID string) (store.AIRun, error) {
	run, err := s.repo.FindAIRun(ctx, route.CompanyID, route.UserID, nativeID)
	if errors.Is(err, store.ErrNotFound) {
		// Session identity cannot prove which submission started a run. Wait
		// for normal admission/retry to resolve its exact idempotency key.
		active, activeErr := s.repo.ActiveAIRun(ctx, route.CompanyID, route.UserID)
		if activeErr == nil && active.HermesRunID == "" && active.ChatID == chatID {
			return run, errAIHistoryAwaitingAdmission
		}
		if activeErr != nil && !errors.Is(activeErr, store.ErrNotFound) {
			return run, activeErr
		}
		return run, errAIHistoryUnbound
	}
	if err == nil && run.ChatID != chatID {
		err = store.ErrNotFound
	}
	return run, err
}

var errAIHistoryAwaitingAdmission = errors.New("AI history awaits exact admission")
var errAIHistoryUnbound = errors.New("AI history has no admitted run")

func (s *Server) handleHermesHistory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		writeError(w, 405, "method_not_allowed")
		return
	}
	route, _, ok := s.hermesCallbackScope(w, r)
	if !ok {
		return
	}
	var body hermesHistoryCallback
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	d.DisallowUnknownFields()
	if d.Decode(&body) != nil || d.Decode(new(any)) != io.EOF || !validHermesID(body.RunID) || !validHermesID(body.SessionID) || !strings.HasPrefix(body.EventID, body.RunID+":") || len(body.EventID) > 512 || strings.ContainsRune(body.EventID, '\x00') || body.CreatedAt.IsZero() || !validHermesHistoryData(body.Type, body.Data) {
		writeError(w, 400, "invalid_ai_history")
		return
	}
	if body.Type != "messages.saved" && (len(body.Messages) > 0 || body.MessagesComplete || len(body.MessageIDs) > 0 || body.ChatName != "" || !body.ChatCreatedAt.IsZero()) {
		writeError(w, 400, "invalid_ai_history")
		return
	}
	run, err := s.historyAIRun(r.Context(), route, body.RunID, body.SessionID)
	if errors.Is(err, errAIHistoryAwaitingAdmission) {
		writeError(w, 503, "ai_history_awaiting_admission")
		return
	}
	if errors.Is(err, errAIHistoryUnbound) {
		writeError(w, 410, "ai_history_run_unbound")
		return
	}
	if err != nil {
		writeAIStoreError(w, err)
		return
	}
	if body.Type == "history.recovered" && !store.AITerminalStatus(run.Status) {
		writeError(w, 409, "ai_history_recovery_requires_terminal_run")
		return
	}
	for _, saved := range run.History {
		if saved.ID == body.EventID {
			// The durable FIFO may replay after losing an acknowledgement. All
			// transcript effects finished before this event was appended.
			run, err = s.repo.AppendAIHistoryEvent(r.Context(), route.CompanyID, route.UserID, run.RunID, store.AIHistoryEvent{ID: body.EventID, Type: body.Type, CreatedAt: body.CreatedAt, Data: body.Data})
			if err != nil {
				writeAIStoreError(w, err)
				return
			}
			s.acknowledgeHermesHistory(w, r, route, run, body.Type)
			return
		}
	}
	if body.Type == "messages.saved" {
		if body.ChatName != "" || !body.ChatCreatedAt.IsZero() {
			chat, getErr := s.repo.GetAIChat(r.Context(), route.CompanyID, route.UserID, run.ChatID)
			if getErr != nil {
				writeAIStoreError(w, getErr)
				return
			}
			if body.ChatName != "" {
				chat.Name = body.ChatName
			}
			if !body.ChatCreatedAt.IsZero() {
				chat.CreatedAt = body.ChatCreatedAt
			}
			if _, err = s.repo.UpsertAIChat(r.Context(), chat); err != nil {
				writeAIStoreError(w, err)
				return
			}
		}
		messages := make([]store.AIMessage, 0, len(body.Messages))
		for _, item := range body.Messages {
			role := item.Role
			if role == "assistant" {
				role = "ai"
			} else if role != "user" {
				writeError(w, 400, "invalid_ai_message_role")
				return
			}
			message := store.AIMessage{CompanyID: route.CompanyID, UserID: route.UserID, MessageID: item.MessageID, ChatID: run.ChatID, Role: role, Content: item.Content, CreatedAt: item.CreatedAt}
			if item.CurrentRun {
				message.RunID = run.RunID
			}
			messages = append(messages, message)
		}
		if err = s.repo.ImportAIMessages(r.Context(), route.CompanyID, route.UserID, messages); err != nil {
			writeAIStoreError(w, err)
			return
		}
		if body.MessagesComplete {
			if err = s.repo.PruneAIMessages(r.Context(), route.CompanyID, route.UserID, run.ChatID, body.MessageIDs); err != nil {
				writeAIStoreError(w, err)
				return
			}
		}
	}
	run, err = s.repo.AppendAIHistoryEvent(r.Context(), route.CompanyID, route.UserID, run.RunID, store.AIHistoryEvent{ID: body.EventID, Type: body.Type, CreatedAt: body.CreatedAt, Data: body.Data})
	if err != nil {
		writeAIStoreError(w, err)
		return
	}
	s.acknowledgeHermesHistory(w, r, route, run, body.Type)
}

func (s *Server) acknowledgeHermesHistory(w http.ResponseWriter, r *http.Request, route HermesRoute, run store.AIRun, kind string) {
	if kind == "run.finished" {
		// Native session-end precedes executor completion. The existing durable
		// delivery retry confirms terminal status even without a browser.
		updated, err := s.refreshAIRun(r.Context(), route, run)
		if err != nil {
			writeHermesError(w, err)
			return
		}
		if !store.AITerminalStatus(updated.Status) {
			writeError(w, 503, "ai_history_execution_pending")
			return
		}
	}
	writeJSON(w, 200, map[string]bool{"saved": true})
}
