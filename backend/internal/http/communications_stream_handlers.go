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
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type communicationsWebhookGrantContext struct {
	connection     domain.UserEmailConnection
	cacheScope     string
	sharedInboxIDs []string
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
	receiptKey, receiptFirstSeenAt, duplicate := s.nylasWebhooks.remember(body, time.Now().UTC())
	if duplicate {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	grantContexts := map[string]communicationsWebhookGrantContext{}
	missingGrants := map[string]struct{}{}
	processedChanges := map[string]struct{}{}
	for _, change := range changes {
		grantID := strings.TrimSpace(change.GrantID)
		if change.Trigger == "" || grantID == "" {
			continue
		}
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
			var err error
			grantContext, err = s.loadCommunicationsWebhookGrantContext(grantID)
			if errors.Is(err, store.ErrNotFound) {
				missingGrants[grantID] = struct{}{}
				continue
			}
			if err != nil {
				s.nylasWebhooks.forget(receiptKey)
				writeError(w, http.StatusInternalServerError, "failed_to_load_email_connection")
				return
			}
			grantContexts[grantID] = grantContext
		}
		if change.Trigger == "message.opened" && strings.TrimSpace(change.MessageID) == "" {
			log.Printf("nylas message.opened webhook missing message_id grant_id=%s", grantID)
		}
		if change.Trigger == "message.opened" && strings.TrimSpace(change.MessageID) != "" {
			signalAt := change.OccurredAt.UTC()
			if signalAt.IsZero() {
				signalAt = receiptFirstSeenAt
			}
			status, err := s.repo.UpsertCommunicationsMessageReadStatus(store.CommunicationsMessageReadStatusInput{
				ScopeType:                communicationsMessageReadStatusScopeTypeForConnection(grantContext.connection),
				UserID:                   grantContext.connection.UserID,
				PersonalAccountEmail:     communicationsMessageReadStatusPersonalAccountEmailForConnection(grantContext.connection),
				CompanyID:                grantContext.connection.CompanyID,
				CompanyEmailConnectionID: grantContext.connection.CompanyEmailConnectionID,
				SharedInboxID:            firstNonEmptyString(grantContext.sharedInboxIDs...),
				MessageID:                change.MessageID,
				ThreadID:                 change.ThreadID,
				Status:                   "likely_read",
				SignalTimestamp:          signalAt,
				SignalCount:              change.SignalCount,
			})
			if err != nil {
				log.Printf("failed to store nylas message.opened read status user_id=%s scope=%s company_id=%s company_email_connection_id=%s grant_id=%s message_id=%s: %v", grantContext.connection.UserID, communicationsMessageReadStatusScopeTypeForConnection(grantContext.connection), grantContext.connection.CompanyID, grantContext.connection.CompanyEmailConnectionID, grantID, change.MessageID, err)
				s.nylasWebhooks.forget(receiptKey)
				writeError(w, http.StatusInternalServerError, "failed_to_store_message_read_status")
				return
			}
			log.Printf("stored nylas message.opened read status user_id=%s scope=%s company_id=%s company_email_connection_id=%s grant_id=%s message_id=%s status=%s signal_count=%d last_signal=%s", grantContext.connection.UserID, status.ScopeType, status.CompanyID, status.CompanyEmailConnectionID, grantID, status.MessageID, status.Status, status.SignalCount, status.LastSignalTimestamp.Format(time.RFC3339))
		}
		if err := s.applyCommunicationsWebhookChange(grantContext, change); err != nil {
			log.Printf("failed to deliver communications webhook change grant_id=%s trigger=%s message_id=%s: %v", grantID, change.Trigger, change.MessageID, err)
			s.nylasWebhooks.forget(receiptKey)
			writeError(w, http.StatusInternalServerError, "failed_to_deliver_email_change")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) loadCommunicationsWebhookGrantContext(grantID string) (communicationsWebhookGrantContext, error) {
	grantID = strings.TrimSpace(grantID)
	if grantID == "" {
		return communicationsWebhookGrantContext{}, store.ErrInvalid
	}
	connection, err := s.repo.GetUserEmailConnectionByGrantID(grantID)
	if err == nil {
		connection.Scope = firstNonBlank(connection.Scope, "personal")
		return communicationsWebhookGrantContext{
			connection: connection,
			cacheScope: communicationsConnectionCacheScope(connection),
		}, nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return communicationsWebhookGrantContext{}, err
	}

	companyConnection, err := s.repo.GetCompanyEmailConnectionByGrantID(grantID)
	if errors.Is(err, store.ErrNotFound) {
		return communicationsWebhookGrantContext{}, store.ErrNotFound
	}
	if err != nil {
		return communicationsWebhookGrantContext{}, err
	}
	sharedInboxIDs, err := s.communicationsSharedInboxIDsForCompanyEmailConnection(companyConnection)
	if err != nil {
		return communicationsWebhookGrantContext{}, err
	}
	connection = userConnectionForCompanyEmailConnection(companyConnection, companyConnection.ConnectedByUserID)
	return communicationsWebhookGrantContext{
		connection:     connection,
		cacheScope:     communicationsConnectionCacheScope(connection),
		sharedInboxIDs: sharedInboxIDs,
	}, nil
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
					Trigger:     normalizedNylasMailboxTrigger(firstStringValue(deltaMap, "type", "trigger_type", "event")),
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
		Trigger:     normalizedNylasMailboxTrigger(firstStringValue(rootMap, "type", "trigger_type", "event")),
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
		strings.TrimSpace(change.Trigger),
		strings.TrimSpace(change.MessageID),
	}, communicationsCacheKeySeparator)
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

func (s *Server) applyNylasWebhookCacheInvalidation(userID, accountScope string, change nylasWebhookChange) {
	switch change.Trigger {
	case "folder.created", "folder.updated", "folder.deleted":
		s.commCache.invalidateFolders(userID, accountScope)
	case "message.created", "message.updated", "message.deleted":
		// Folder payloads own provider unread and mailbox counts. A message
		// arriving, moving, changing read state, or being deleted can change
		// those counts even when Nylas does not emit a companion folder event.
		s.commCache.invalidateFolders(userID, accountScope)
		s.commCache.invalidateMessagePages(userID, accountScope)
		s.commCache.invalidateMessage(userID, accountScope, change.MessageID)
	case "message.opened":
		// Read-receipt status is enriched from the store on every response; the
		// cached provider body and list payload remain valid.
	}
}

func (s *Server) applyNylasWebhookCacheInvalidationForAccountScope(accountScope string, change nylasWebhookChange) {
	switch change.Trigger {
	case "folder.created", "folder.updated", "folder.deleted":
		s.commCache.invalidateFoldersForAccountScope(accountScope)
	case "message.created", "message.updated", "message.deleted":
		s.commCache.invalidateFoldersForAccountScope(accountScope)
		s.commCache.invalidateMessagePagesForAccountScope(accountScope)
		s.commCache.invalidateMessageForAccountScope(accountScope, change.MessageID)
	case "message.opened":
	}
}

func (s *Server) applyCommunicationsWebhookChange(grantContext communicationsWebhookGrantContext, change nylasWebhookChange) error {
	if communicationsMessageReadStatusScopeTypeForConnection(grantContext.connection) != "shared" {
		s.applyNylasWebhookCacheInvalidation(grantContext.connection.UserID, grantContext.cacheScope, change)
		return s.publishPersonalMailboxWebhookHint(grantContext.connection.UserID, grantContext.connection.AccountEmail, change)
	}
	s.applyNylasWebhookCacheInvalidationForAccountScope(grantContext.cacheScope, change)
	if len(grantContext.sharedInboxIDs) == 0 {
		log.Printf("skipping shared communications webhook delivery without linked shared inbox company_id=%s company_email_connection_id=%s trigger=%s message_id=%s", grantContext.connection.CompanyID, grantContext.connection.CompanyEmailConnectionID, change.Trigger, change.MessageID)
		return nil
	}
	for _, sharedInboxID := range grantContext.sharedInboxIDs {
		sharedInboxID = strings.TrimSpace(sharedInboxID)
		if sharedInboxID == "" {
			continue
		}
		if err := s.publishSharedMailboxWebhookHint(grantContext.connection.CompanyID, sharedInboxID, change); err != nil {
			return fmt.Errorf("publish shared mailbox %s webhook hint: %w", sharedInboxID, err)
		}
	}
	return nil
}

func (s *Server) publishPersonalMailboxWebhookHint(userID, accountEmail string, change nylasWebhookChange) error {
	userID = strings.TrimSpace(userID)
	accountEmail = normalizeEmailForCompare(accountEmail)
	if userID == "" || !isRealtimeAccountEmail(accountEmail) {
		return store.ErrInvalid
	}
	memberships, err := s.repo.ListUserMemberships(userID)
	if err != nil {
		return fmt.Errorf("load personal mailbox memberships: %w", err)
	}
	scope := realtimePersonalMailboxScope(userID, accountEmail)
	publishedCompanies := map[string]struct{}{}
	for _, membership := range memberships {
		companyID := strings.TrimSpace(membership.CompanyID)
		if companyID == "" {
			continue
		}
		if _, published := publishedCompanies[companyID]; published {
			continue
		}
		publishedCompanies[companyID] = struct{}{}
		s.publishRealtimeMessage(companyID, scope, realtimeMailboxWebhookMessage(companyID, scope, "", change))
	}
	return nil
}

func (s *Server) publishSharedMailboxWebhookHint(companyID, sharedInboxID string, change nylasWebhookChange) error {
	companyID = strings.TrimSpace(companyID)
	sharedInboxID = strings.TrimSpace(sharedInboxID)
	if companyID == "" || sharedInboxID == "" {
		return store.ErrInvalid
	}
	scope := realtimeSharedMailboxScope(sharedInboxID)
	_, err := s.publishRealtimeMessageToCurrentEntityAudienceResult(
		companyID,
		scope,
		store.EntityTypeSharedInbox,
		sharedInboxID,
		store.EntityPermissionView,
		realtimeMailboxWebhookMessage(companyID, scope, sharedInboxID, change),
	)
	return err
}

func realtimeMailboxWebhookMessage(companyID, scope, sharedInboxID string, change nylasWebhookChange) realtimeMailboxChangedMessage {
	trigger := change.Trigger
	eventType := realtimeMessageMailboxMessageChanged
	messageID := strings.TrimSpace(change.MessageID)
	threadID := strings.TrimSpace(change.ThreadID)
	if strings.HasPrefix(trigger, "folder.") {
		eventType = realtimeMessageMailboxFolderChanged
		messageID = ""
		threadID = ""
	}
	var occurredAt *time.Time
	if !change.OccurredAt.IsZero() {
		value := change.OccurredAt.UTC()
		occurredAt = &value
	}
	return realtimeMailboxChangedMessage{
		Type:          eventType,
		CompanyID:     strings.TrimSpace(companyID),
		Scope:         strings.TrimSpace(scope),
		Trigger:       trigger,
		MessageID:     messageID,
		ThreadID:      threadID,
		SharedInboxID: strings.TrimSpace(sharedInboxID),
		OccurredAt:    occurredAt,
	}
}

func (s *Server) communicationsSharedInboxIDsForCompanyEmailConnection(connection domain.CompanyEmailConnection) ([]string, error) {
	companyID := strings.TrimSpace(connection.CompanyID)
	connectionID := strings.TrimSpace(connection.CompanyEmailConnectionID)
	accountEmail := normalizeEmailForCompare(connection.AccountEmail)
	if companyID == "" || connectionID == "" {
		return nil, store.ErrInvalid
	}
	items, err := s.repo.ListCommunicationsSharedInboxFolders(companyID)
	if err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	ids := make([]string, 0)
	for _, item := range items {
		if store.CommunicationsSharedInboxResourceType(item) != store.EntityTypeSharedInbox {
			continue
		}
		matchesConnection := strings.TrimSpace(item.CompanyEmailConnectionID) == connectionID
		if !matchesConnection && accountEmail != "" && item.AccountEmail != nil {
			matchesConnection = normalizeEmailForCompare(*item.AccountEmail) == accountEmail
		}
		if !matchesConnection {
			continue
		}
		sharedInboxID := firstNonBlank(item.SharedInboxID, item.FolderID)
		if sharedInboxID == "" {
			continue
		}
		if _, ok := seen[sharedInboxID]; ok {
			continue
		}
		seen[sharedInboxID] = struct{}{}
		ids = append(ids, sharedInboxID)
	}
	return ids, nil
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
	object := nylasWebhookObject(value)
	if messageData, ok := object["message_data"].(map[string]any); ok {
		if count := intValue(messageData["count"]); count > 0 {
			return count
		}
	}
	if count := intValue(object["count"]); count > 0 {
		return count
	}
	for _, key := range []string{"signal_count", "open_count", "count"} {
		if count := findIntField(value, key); count > 0 {
			return count
		}
	}
	return 0
}

func findNylasWebhookTimestamp(value any) time.Time {
	object := nylasWebhookObject(value)
	if messageData, ok := object["message_data"].(map[string]any); ok {
		if ts := timeValue(messageData["timestamp"]); !ts.IsZero() {
			return ts
		}
		if recents, ok := messageData["recents"].([]any); ok {
			for _, recent := range recents {
				if recentMap, ok := recent.(map[string]any); ok {
					if ts := timeValue(recentMap["timestamp"]); !ts.IsZero() {
						return ts
					}
				}
			}
		}
	}
	if ts := timeValue(object["timestamp"]); !ts.IsZero() {
		return ts
	}
	for _, key := range []string{"time", "timestamp", "created_at", "created_timestamp"} {
		if ts := findTimeField(value, key); !ts.IsZero() {
			return ts
		}
	}
	return time.Time{}
}

func nylasWebhookObject(value any) map[string]any {
	root, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	if data, ok := root["data"].(map[string]any); ok {
		if object, ok := data["object"].(map[string]any); ok {
			return object
		}
	}
	if object, ok := root["object"].(map[string]any); ok {
		return object
	}
	return root
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
