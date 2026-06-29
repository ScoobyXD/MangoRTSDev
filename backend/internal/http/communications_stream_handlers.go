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
	"log"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type communicationsEventEnvelope struct {
	UserID        string    `json:"user_id"`
	Type          string    `json:"type"`
	Trigger       string    `json:"trigger,omitempty"`
	Action        string    `json:"action,omitempty"`
	MessageID     string    `json:"message_id,omitempty"`
	SharedInboxID string    `json:"shared_inbox_id,omitempty"`
	TS            time.Time `json:"ts"`
}

type communicationsEventMetadata struct {
	Action        string
	SharedInboxID string
}

type communicationsWebhookGrantContext struct {
	userID     string
	cacheScope string
}

type nylasWebhookChange struct {
	Trigger     string
	GrantID     string
	MessageID   string
	ThreadID    string
	OccurredAt  time.Time
	SignalCount int
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
	receiptKey, duplicate := s.nylasWebhooks.remember(body, time.Now().UTC())
	if duplicate {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	grantContexts := map[string]communicationsWebhookGrantContext{}
	missingGrants := map[string]struct{}{}
	processedChanges := map[string]struct{}{}
	for _, change := range changes {
		grantID := strings.TrimSpace(change.GrantID)
		if !isCommunicationsMailboxTrigger(change.Trigger) || grantID == "" {
			continue
		}
		normalizedTrigger := normalizedNylasMailboxTrigger(change.Trigger)
		changeKey := nylasWebhookChangeKey(grantID, change)
		if _, processed := processedChanges[changeKey]; processed {
			continue
		}
		processedChanges[changeKey] = struct{}{}
		if _, missing := missingGrants[grantID]; missing {
			continue
		}
		grantContext, ok := grantContexts[grantID]
		if !ok {
			connection, err := s.repo.GetUserEmailConnectionByGrantID(grantID)
			if errors.Is(err, store.ErrNotFound) {
				missingGrants[grantID] = struct{}{}
				continue
			}
			if err != nil {
				s.nylasWebhooks.forget(receiptKey)
				writeError(w, http.StatusInternalServerError, "failed_to_load_email_connection")
				return
			}
			grantContext = communicationsWebhookGrantContext{
				userID:     connection.UserID,
				cacheScope: communicationsConnectionCacheScope(connection),
			}
			grantContexts[grantID] = grantContext
		}
		if normalizedTrigger == "message.opened" && strings.TrimSpace(change.MessageID) == "" {
			log.Printf("nylas message.opened webhook missing message_id grant_id=%s", grantID)
		}
		if normalizedTrigger == "message.opened" && strings.TrimSpace(change.MessageID) != "" {
			signalAt := change.OccurredAt.UTC()
			if signalAt.IsZero() {
				signalAt = time.Now().UTC()
			}
			status, err := s.repo.UpsertCommunicationsMessageReadStatus(store.CommunicationsMessageReadStatusInput{
				UserID:          grantContext.userID,
				MessageID:       change.MessageID,
				ThreadID:        change.ThreadID,
				Status:          "likely_read",
				SignalTimestamp: signalAt,
				SignalCount:     change.SignalCount,
			})
			if err != nil {
				log.Printf("failed to store nylas message.opened read status user_id=%s grant_id=%s message_id=%s: %v", grantContext.userID, grantID, change.MessageID, err)
				s.nylasWebhooks.forget(receiptKey)
				writeError(w, http.StatusInternalServerError, "failed_to_store_message_read_status")
				return
			}
			log.Printf("stored nylas message.opened read status user_id=%s grant_id=%s message_id=%s status=%s signal_count=%d last_signal=%s", grantContext.userID, grantID, status.MessageID, status.Status, status.SignalCount, status.LastSignalTimestamp.Format(time.RFC3339))
		}
		s.applyNylasWebhookCacheInvalidation(grantContext.userID, change)
		trigger := change.Trigger
		meta := communicationsEventMetadata{}
		if normalizedTrigger == "message.updated" && s.consumeRecentCommunicationsArchiveMutation(grantContext.cacheScope, change.MessageID, time.Now().UTC()) {
			trigger = "message.archived"
			meta.Action = "archive"
		}
		s.publishCommunicationsEventWithMeta(grantContext.userID, "mailbox_changed", trigger, change.MessageID, meta)
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
					Trigger:     firstStringValue(deltaMap, "type", "trigger_type", "event"),
					GrantID:     findStringField(deltaMap, "grant_id"),
					MessageID:   findNylasMessageID(deltaMap),
					ThreadID:    findStringField(deltaMap, "thread_id"),
					OccurredAt:  findNylasWebhookTimestamp(deltaMap),
					SignalCount: findNylasWebhookSignalCount(deltaMap),
				})
			}
		}
		return changes, nil
	}
	return []nylasWebhookChange{{
		Trigger:     firstStringValue(rootMap, "type", "trigger_type", "event"),
		GrantID:     findStringField(rootMap, "grant_id"),
		MessageID:   findNylasMessageID(rootMap),
		ThreadID:    findStringField(rootMap, "thread_id"),
		OccurredAt:  findNylasWebhookTimestamp(rootMap),
		SignalCount: findNylasWebhookSignalCount(rootMap),
	}}, nil
}

func nylasWebhookChangeKey(grantID string, change nylasWebhookChange) string {
	return strings.Join([]string{
		strings.TrimSpace(grantID),
		normalizedNylasMailboxTrigger(change.Trigger),
		strings.TrimSpace(change.MessageID),
	}, communicationsCacheKeySeparator)
}

func isCommunicationsMailboxTrigger(trigger string) bool {
	return normalizedNylasMailboxTrigger(trigger) != ""
}

func normalizedNylasMailboxTrigger(trigger string) string {
	trigger = strings.TrimSpace(strings.ToLower(trigger))
	switch {
	case strings.HasPrefix(trigger, "message.created"):
		return "message.created"
	case strings.HasPrefix(trigger, "message.updated"):
		return "message.updated"
	case strings.HasPrefix(trigger, "message.deleted"):
		return "message.deleted"
	case strings.HasPrefix(trigger, "message.opened"):
		return "message.opened"
	case strings.HasPrefix(trigger, "folder.created"):
		return "folder.created"
	case strings.HasPrefix(trigger, "folder.updated"):
		return "folder.updated"
	case strings.HasPrefix(trigger, "folder.deleted"):
		return "folder.deleted"
	default:
		return ""
	}
}

func (s *Server) applyNylasWebhookCacheInvalidation(userID string, change nylasWebhookChange) {
	trigger := strings.TrimSpace(strings.ToLower(change.Trigger))
	switch {
	case strings.HasPrefix(trigger, "folder."):
		s.commCache.invalidateFolders(userID)
	case strings.HasPrefix(trigger, "message.created"):
		s.commCache.invalidateMessagePages(userID)
		s.commCache.invalidateMessage(userID, "", change.MessageID)
	case strings.HasPrefix(trigger, "message.opened"):
		s.commCache.invalidateMessage(userID, "", change.MessageID)
	case strings.HasPrefix(trigger, "message.updated"), strings.HasPrefix(trigger, "message.deleted"):
		s.commCache.invalidateMessage(userID, "", change.MessageID)
		s.commCache.invalidateMessagePages(userID)
	default:
		s.commCache.invalidateUser(userID)
	}
}

func (s *Server) publishCommunicationsEvent(userID, eventType, trigger, messageID string) {
	s.publishCommunicationsEventWithMeta(userID, eventType, trigger, messageID, communicationsEventMetadata{})
}

func (s *Server) publishCommunicationsEventWithMeta(userID, eventType, trigger, messageID string, meta communicationsEventMetadata) {
	userID = strings.TrimSpace(userID)
	if userID == "" || s == nil || s.realtimeRegistry == nil {
		return
	}
	scope := realtimeCommunicationsScope(userID)
	if scope == "" {
		return
	}
	envelope := communicationsEventEnvelope{
		UserID:        userID,
		Type:          strings.TrimSpace(eventType),
		Trigger:       strings.TrimSpace(trigger),
		Action:        strings.TrimSpace(meta.Action),
		MessageID:     strings.TrimSpace(messageID),
		SharedInboxID: strings.TrimSpace(meta.SharedInboxID),
		TS:            time.Now().UTC(),
	}
	memberships, err := s.repo.ListUserMemberships(userID)
	if err != nil {
		log.Printf("failed to load communications realtime memberships user_id=%s: %v", userID, err)
		return
	}
	if len(memberships) == 0 {
		s.recordOperationalMetric("realtime.publish_skipped_no_subscribers_count", realtimeScopeType(scope), 1, 0)
	}
	for _, membership := range memberships {
		companyID := strings.TrimSpace(membership.CompanyID)
		if companyID == "" {
			continue
		}
		if !s.realtimeRegistry.hasSubscribers(companyID, scope) {
			s.recordOperationalMetric("realtime.publish_skipped_no_subscribers_count", realtimeScopeType(scope), 1, 0)
			continue
		}
		payload, err := json.Marshal(realtimeCommunicationsEventMessage{
			Type:      realtimeMessageCommunicationsEvent,
			CompanyID: companyID,
			Scope:     scope,
			Event:     envelope,
		})
		if err != nil {
			continue
		}
		published := s.realtimeRegistry.publish(companyID, scope, payload)
		if published == 0 {
			s.recordOperationalMetric("realtime.publish_skipped_no_subscribers_count", realtimeScopeType(scope), 1, 0)
			continue
		}
		s.recordOperationalMetric("realtime.communications_events_published", realtimeScopeType(scope), int64(published), 0)
	}
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

func findNylasWebhookSignalCount(value any) int {
	for _, key := range []string{"signal_count", "open_count", "count"} {
		if count := findIntField(value, key); count > 0 {
			return count
		}
	}
	return 0
}

func findNylasWebhookTimestamp(value any) time.Time {
	for _, key := range []string{"time", "timestamp", "created_at", "created_timestamp"} {
		if ts := findTimeField(value, key); !ts.IsZero() {
			return ts
		}
	}
	return time.Time{}
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
			if id := stringField(object, "message_id"); id != "" {
				return id
			}
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

func findIntField(value any, field string) int {
	switch typed := value.(type) {
	case map[string]any:
		if count := intValue(typed[field]); count > 0 {
			return count
		}
		for _, child := range typed {
			if found := findIntField(child, field); found > 0 {
				return found
			}
		}
	case []any:
		for _, child := range typed {
			if found := findIntField(child, field); found > 0 {
				return found
			}
		}
	}
	return 0
}

func intValue(value any) int {
	switch typed := value.(type) {
	case json.Number:
		if parsed, err := typed.Int64(); err == nil && parsed > 0 {
			return int(parsed)
		}
	case float64:
		if typed > 0 {
			return int(typed)
		}
	case int:
		if typed > 0 {
			return typed
		}
	}
	return 0
}

func findTimeField(value any, field string) time.Time {
	switch typed := value.(type) {
	case map[string]any:
		if ts := timeValue(typed[field]); !ts.IsZero() {
			return ts
		}
		for _, child := range typed {
			if found := findTimeField(child, field); !found.IsZero() {
				return found
			}
		}
	case []any:
		for _, child := range typed {
			if found := findTimeField(child, field); !found.IsZero() {
				return found
			}
		}
	}
	return time.Time{}
}

func timeValue(value any) time.Time {
	switch typed := value.(type) {
	case string:
		return parseNylasWebhookTime(typed)
	case json.Number:
		if parsed, err := typed.Int64(); err == nil {
			return unixWebhookTime(parsed)
		}
	case float64:
		return unixWebhookTime(int64(typed))
	}
	return time.Time{}
}

func parseNylasWebhookTime(value string) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC()
		}
	}
	if parsed, err := strconv.ParseInt(value, 10, 64); err == nil {
		return unixWebhookTime(parsed)
	}
	return time.Time{}
}

func unixWebhookTime(value int64) time.Time {
	if value <= 0 {
		return time.Time{}
	}
	if value > 1_000_000_000_000 {
		return time.UnixMilli(value).UTC()
	}
	return time.Unix(value, 0).UTC()
}

func stringField(values map[string]any, key string) string {
	if value, ok := values[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}
