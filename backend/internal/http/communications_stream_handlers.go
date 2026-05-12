package httpapi

import (
	"bytes"
	"compress/gzip"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
	"time"
)

type communicationsEventEnvelope struct {
	UserID    string    `json:"user_id"`
	Type      string    `json:"type"`
	Trigger   string    `json:"trigger,omitempty"`
	MessageID string    `json:"message_id,omitempty"`
	TS        time.Time `json:"ts"`
}

type nylasWebhookChange struct {
	Trigger   string
	GrantID   string
	MessageID string
}

func (s *Server) handleCommunicationsStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "stream_unsupported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := s.emailHub.subscribe(actor.User.UserID)
	defer s.emailHub.unsubscribe(actor.User.UserID, ch)

	fmt.Fprintf(w, "event: ready\ndata: {\"user_id\":%q}\n\n", actor.User.UserID)
	flusher.Flush()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			fmt.Fprint(w, "event: ping\ndata: {}\n\n")
			flusher.Flush()
		case payload := <-ch:
			fmt.Fprintf(w, "event: communications\ndata: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

func (s *Server) handleNylasWebhook(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleNylasWebhookChallenge(w, r)
	case http.MethodPost:
		s.handleNylasWebhookNotification(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleNylasWebhookChallenge(w http.ResponseWriter, r *http.Request) {
	challenge := strings.TrimSpace(r.URL.Query().Get("challenge"))
	if challenge == "" {
		writeError(w, http.StatusBadRequest, "nylas_challenge_required")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(challenge)))
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, challenge)
}

func (s *Server) handleNylasWebhookNotification(w http.ResponseWriter, r *http.Request) {
	secret := strings.TrimSpace(s.nylasConfig.WebhookSecret)
	if secret == "" {
		writeError(w, http.StatusServiceUnavailable, "nylas_webhook_secret_not_configured")
		return
	}
	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_webhook_body")
		return
	}
	if !verifyNylasWebhookSignature(rawBody, r.Header.Get("X-Nylas-Signature"), secret) {
		writeError(w, http.StatusUnauthorized, "invalid_nylas_webhook_signature")
		return
	}
	body, err := decodeNylasWebhookBody(rawBody, r.Header.Get("Content-Encoding"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_webhook_body")
		return
	}
	changes, err := parseNylasWebhookChanges(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_webhook_json")
		return
	}
	grantUserIDs := map[string]string{}
	missingGrants := map[string]struct{}{}
	for _, change := range changes {
		grantID := strings.TrimSpace(change.GrantID)
		if !isCommunicationsMailboxTrigger(change.Trigger) || grantID == "" {
			continue
		}
		if _, missing := missingGrants[grantID]; missing {
			continue
		}
		userID, ok := grantUserIDs[grantID]
		if !ok {
			connection, err := s.repo.GetUserEmailConnectionByGrantID(grantID)
			if errors.Is(err, store.ErrNotFound) {
				missingGrants[grantID] = struct{}{}
				continue
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_load_email_connection")
				return
			}
			userID = connection.UserID
			grantUserIDs[grantID] = userID
		}
		s.applyNylasWebhookCacheInvalidation(userID, change)
		if s.emailHub.hasSubscribers(userID) {
			s.publishCommunicationsEvent(userID, "mailbox_changed", change.Trigger, change.MessageID)
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func verifyNylasWebhookSignature(rawBody []byte, signatureHeader, secret string) bool {
	signature := strings.TrimSpace(signatureHeader)
	signature = strings.TrimPrefix(signature, "sha256=")
	if signature == "" || strings.TrimSpace(secret) == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(rawBody)
	expected := fmt.Sprintf("%x", mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(strings.ToLower(signature)))
}

func decodeNylasWebhookBody(rawBody []byte, contentEncoding string) ([]byte, error) {
	if !strings.Contains(strings.ToLower(contentEncoding), "gzip") {
		return rawBody, nil
	}
	reader, err := gzip.NewReader(bytes.NewReader(rawBody))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return io.ReadAll(reader)
}

func parseNylasWebhookChanges(body []byte) ([]nylasWebhookChange, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var root any
	if err := decoder.Decode(&root); err != nil {
		return nil, err
	}
	rootMap, _ := root.(map[string]any)
	if rootMap == nil {
		return nil, nil
	}
	if deltas, ok := rootMap["deltas"].([]any); ok {
		changes := make([]nylasWebhookChange, 0, len(deltas))
		for _, delta := range deltas {
			if deltaMap, ok := delta.(map[string]any); ok {
				changes = append(changes, nylasWebhookChange{
					Trigger:   firstStringValue(deltaMap, "type", "trigger_type", "event"),
					GrantID:   findStringField(deltaMap, "grant_id"),
					MessageID: findNylasMessageID(deltaMap),
				})
			}
		}
		return changes, nil
	}
	return []nylasWebhookChange{{
		Trigger:   firstStringValue(rootMap, "type", "trigger_type", "event"),
		GrantID:   findStringField(rootMap, "grant_id"),
		MessageID: findNylasMessageID(rootMap),
	}}, nil
}

func isCommunicationsMailboxTrigger(trigger string) bool {
	trigger = strings.TrimSpace(strings.ToLower(trigger))
	return strings.HasPrefix(trigger, "message.created") ||
		strings.HasPrefix(trigger, "message.updated") ||
		strings.HasPrefix(trigger, "message.deleted") ||
		strings.HasPrefix(trigger, "folder.created") ||
		strings.HasPrefix(trigger, "folder.updated") ||
		strings.HasPrefix(trigger, "folder.deleted")
}

func (s *Server) applyNylasWebhookCacheInvalidation(userID string, change nylasWebhookChange) {
	trigger := strings.TrimSpace(strings.ToLower(change.Trigger))
	switch {
	case strings.HasPrefix(trigger, "folder."):
		s.commCache.invalidateFolders(userID)
		s.commCache.invalidateMessagePages(userID)
	case strings.HasPrefix(trigger, "message.created"):
		s.commCache.invalidateMessagePages(userID)
	case strings.HasPrefix(trigger, "message.updated"), strings.HasPrefix(trigger, "message.deleted"):
		s.commCache.invalidateMessagePages(userID)
		s.commCache.invalidateMessage(userID, change.MessageID)
	default:
		s.commCache.invalidateUser(userID)
	}
}

func (s *Server) publishCommunicationsEvent(userID, eventType, trigger, messageID string) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	payload, err := json.Marshal(communicationsEventEnvelope{
		UserID:    userID,
		Type:      strings.TrimSpace(eventType),
		Trigger:   strings.TrimSpace(trigger),
		MessageID: strings.TrimSpace(messageID),
		TS:        time.Now().UTC(),
	})
	if err != nil {
		return
	}
	s.emailHub.publish(userID, payload)
}

func firstStringValue(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func findStringField(value any, field string) string {
	switch typed := value.(type) {
	case map[string]any:
		if raw, ok := typed[field].(string); ok && strings.TrimSpace(raw) != "" {
			return strings.TrimSpace(raw)
		}
		for _, child := range typed {
			if found := findStringField(child, field); found != "" {
				return found
			}
		}
	case []any:
		for _, child := range typed {
			if found := findStringField(child, field); found != "" {
				return found
			}
		}
	}
	return ""
}

func findNylasMessageID(value any) string {
	if id := findMessageIDInPreferredShapes(value); id != "" {
		return id
	}
	return ""
}

func findMessageIDInPreferredShapes(value any) string {
	root, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	if id := stringField(root, "message_id"); id != "" {
		return id
	}
	if data, ok := root["data"].(map[string]any); ok {
		if id := stringField(data, "message_id"); id != "" {
			return id
		}
		if object, ok := data["object"].(map[string]any); ok {
			if id := stringField(object, "id"); id != "" {
				return id
			}
		}
		if id := stringField(data, "id"); id != "" {
			return id
		}
	}
	if object, ok := root["object"].(map[string]any); ok {
		if id := stringField(object, "id"); id != "" {
			return id
		}
	}
	return ""
}

func stringField(values map[string]any, key string) string {
	if value, ok := values[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}
