package httpapi

import (
	"bytes"
	"compress/gzip"
	"context"
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
	"sort"
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
	Trigger          string
	GrantID          string
	MessageID        string
	ThreadID         string
	OccurredAt       time.Time
	SignalTimestamps []time.Time
	SignalCount      int
	Message          domain.EmailMessageSnapshot
	MessageHydrated  bool
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
				SignalTimestamps:         change.SignalTimestamps,
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
		if err := s.applyCommunicationsWebhookChange(r.Context(), grantContext, change); err != nil {
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
				changes = append(changes, parseNylasWebhookChange(deltaMap))
			}
		}
		return changes, nil
	}
	return []nylasWebhookChange{parseNylasWebhookChange(rootMap)}, nil
}

func parseNylasWebhookChange(payload map[string]any) nylasWebhookChange {
	change := nylasWebhookChange{
		Trigger:          normalizedNylasMailboxTrigger(firstStringValue(payload, "type", "trigger_type", "event")),
		GrantID:          findStringField(payload, "grant_id"),
		MessageID:        findNylasMessageID(payload),
		ThreadID:         findStringField(payload, "thread_id"),
		OccurredAt:       findNylasWebhookTimestamp(payload),
		SignalTimestamps: findNylasWebhookSignalTimestamps(payload),
		SignalCount:      findNylasWebhookSignalCount(payload),
	}
	change.Message, change.MessageHydrated = nylasWebhookMessageSnapshot(payload, change.MessageID, change.ThreadID)
	return change
}

func nylasWebhookMessageSnapshot(payload any, messageID, threadID string) (domain.EmailMessageSnapshot, bool) {
	object := nylasWebhookObject(payload)
	raw, err := json.Marshal(object)
	if err != nil {
		return domain.EmailMessageSnapshot{ID: strings.TrimSpace(messageID), ThreadID: strings.TrimSpace(threadID)}, false
	}
	var message NylasMessage
	if err := json.Unmarshal(raw, &message); err != nil {
		return domain.EmailMessageSnapshot{ID: strings.TrimSpace(messageID), ThreadID: strings.TrimSpace(threadID)}, false
	}
	message.ID = firstNonBlank(message.ID, messageID)
	message.ThreadID = firstNonBlank(message.ThreadID, threadID)
	_, hasSubject := object["subject"]
	_, hasSnippet := object["snippet"]
	_, hasBody := object["body"]
	_, hasDate := object["date"]
	_, hasFrom := object["from"]
	hydrated := hasSubject && hasSnippet && hasBody && hasDate && hasFrom
	return emailMessageSnapshotFromNylas(message), hydrated
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

func (s *Server) applyCommunicationsWebhookChange(ctx context.Context, grantContext communicationsWebhookGrantContext, change nylasWebhookChange) error {
	if err := s.propagateCommunicationsEmailCollaborationMessage(ctx, grantContext, change); err != nil {
		return err
	}
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

func (s *Server) propagateCommunicationsEmailCollaborationMessage(ctx context.Context, grantContext communicationsWebhookGrantContext, change nylasWebhookChange) error {
	if change.Trigger != "message.created" || strings.TrimSpace(change.MessageID) == "" {
		return nil
	}
	message := change.Message
	message.ID = firstNonBlank(message.ID, change.MessageID)
	message.ThreadID = firstNonBlank(message.ThreadID, change.ThreadID)
	inputs, err := s.communicationsEmailCollaborationWebhookInputs(grantContext, message)
	if err != nil {
		return fmt.Errorf("resolve email collaboration companies: %w", err)
	}
	participantsByCompany, err := s.updateCommunicationsEmailCollaborationWebhookInputs(inputs)
	if err != nil {
		return fmt.Errorf("match email collaboration thread: %w", err)
	}
	if len(participantsByCompany) == 0 {
		return nil
	}
	if !change.MessageHydrated {
		if s.nylasClient == nil {
			return errors.New("nylas client required to hydrate collaborated email")
		}
		var providerMessage NylasMessage
		if err := s.withCommunicationsNylasGate(ctx, grantContext.connection, func(ctx context.Context) error {
			var err error
			providerMessage, err = s.nylasClient.GetMessage(ctx, grantContext.connection.GrantID, change.MessageID)
			return err
		}); err != nil {
			return fmt.Errorf("hydrate collaborated email message: %w", err)
		}
		providerMessage.ID = firstNonBlank(providerMessage.ID, change.MessageID)
		providerMessage.ThreadID = firstNonBlank(providerMessage.ThreadID, change.ThreadID)
		message = emailMessageSnapshotFromNylas(providerMessage)
		if message.Date == 0 && !change.OccurredAt.IsZero() {
			message.Date = change.OccurredAt.UTC().Unix()
		}
		inputs, err = s.communicationsEmailCollaborationWebhookInputs(grantContext, message)
		if err != nil {
			return fmt.Errorf("resolve email collaboration companies: %w", err)
		}
		participantsByCompany, err = s.updateCommunicationsEmailCollaborationWebhookInputs(inputs)
		if err != nil {
			return fmt.Errorf("update email collaboration snapshot: %w", err)
		}
	}
	s.publishCommunicationsEmailCollaborationWebhookHints(grantContext, change, participantsByCompany)
	return nil
}

func (s *Server) communicationsEmailCollaborationWebhookInputs(grantContext communicationsWebhookGrantContext, message domain.EmailMessageSnapshot) ([]store.CommunicationsEmailCollaborationMessageInput, error) {
	connection := grantContext.connection
	if communicationsMessageReadStatusScopeTypeForConnection(connection) != "shared" {
		memberships, err := s.repo.ListUserMemberships(connection.UserID)
		if err != nil {
			return nil, err
		}
		inputs := make([]store.CommunicationsEmailCollaborationMessageInput, 0, len(memberships))
		seenCompanies := map[string]struct{}{}
		for _, membership := range memberships {
			companyID := strings.TrimSpace(membership.CompanyID)
			if companyID == "" {
				continue
			}
			if _, seen := seenCompanies[companyID]; seen {
				continue
			}
			seenCompanies[companyID] = struct{}{}
			inputs = append(inputs, store.CommunicationsEmailCollaborationMessageInput{
				CompanyID: companyID, PersonalUserID: connection.UserID,
				PersonalAccountEmail: connection.AccountEmail, Message: message,
			})
		}
		return inputs, nil
	}
	inputs := make([]store.CommunicationsEmailCollaborationMessageInput, 0, len(grantContext.sharedInboxIDs))
	for _, sharedInboxID := range grantContext.sharedInboxIDs {
		if sharedInboxID = strings.TrimSpace(sharedInboxID); sharedInboxID != "" {
			inputs = append(inputs, store.CommunicationsEmailCollaborationMessageInput{
				CompanyID: connection.CompanyID, SharedInboxID: sharedInboxID, Message: message,
			})
		}
	}
	return inputs, nil
}

func (s *Server) updateCommunicationsEmailCollaborationWebhookInputs(inputs []store.CommunicationsEmailCollaborationMessageInput) (map[string][]string, error) {
	participantsByCompany := map[string]map[string]struct{}{}
	for _, input := range inputs {
		userIDs, err := s.repo.UpdateCommunicationsEmailCollaborationMessage(input)
		if err != nil {
			return nil, err
		}
		companyID := strings.TrimSpace(input.CompanyID)
		for _, userID := range userIDs {
			if userID = strings.TrimSpace(userID); userID != "" {
				participants := participantsByCompany[companyID]
				if participants == nil {
					participants = map[string]struct{}{}
					participantsByCompany[companyID] = participants
				}
				participants[userID] = struct{}{}
			}
		}
	}
	out := make(map[string][]string, len(participantsByCompany))
	for companyID, participants := range participantsByCompany {
		userIDs := make([]string, 0, len(participants))
		for userID := range participants {
			userIDs = append(userIDs, userID)
		}
		out[companyID] = userIDs
	}
	return out, nil
}

func (s *Server) publishCommunicationsEmailCollaborationWebhookHints(grantContext communicationsWebhookGrantContext, change nylasWebhookChange, participantsByCompany map[string][]string) {
	personalSource := communicationsMessageReadStatusScopeTypeForConnection(grantContext.connection) != "shared"
	sourceUserID := strings.TrimSpace(grantContext.connection.UserID)
	for companyID, participantUserIDs := range participantsByCompany {
		for _, userID := range participantUserIDs {
			userID = strings.TrimSpace(userID)
			if userID == "" || (personalSource && userID == sourceUserID) {
				continue
			}
			connections, err := s.repo.ListUserEmailConnections(userID)
			if err != nil {
				log.Printf("skipping email collaboration realtime hint company_id=%s user_id=%s: %v", companyID, userID, err)
				continue
			}
			publishedScopes := map[string]struct{}{}
			for _, connection := range connections {
				if strings.TrimSpace(connection.Status) != "connected" || strings.TrimSpace(connection.GrantID) == "" {
					continue
				}
				accountEmail := normalizeEmailForCompare(connection.AccountEmail)
				scope := realtimePersonalMailboxScope(userID, accountEmail)
				if scope == "" {
					continue
				}
				if _, published := publishedScopes[scope]; published {
					continue
				}
				publishedScopes[scope] = struct{}{}
				s.publishRealtimeMessage(companyID, scope, realtimeMailboxWebhookMessage(companyID, scope, "", change))
			}
		}
	}
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
	if timestamps := findNylasWebhookSignalTimestamps(value); len(timestamps) > 0 {
		return timestamps[len(timestamps)-1]
	}
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

func findNylasWebhookSignalTimestamps(value any) []time.Time {
	object := nylasWebhookObject(value)
	timestamps := make([]time.Time, 0, 50)
	seen := map[int64]struct{}{}
	appendRecents := func(raw any) {
		recents, ok := raw.([]any)
		if !ok {
			return
		}
		for _, recent := range recents {
			recentMap, ok := recent.(map[string]any)
			if !ok {
				continue
			}
			timestamp := timeValue(recentMap["timestamp"]).UTC()
			if timestamp.IsZero() {
				continue
			}
			key := timestamp.UnixNano()
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			timestamps = append(timestamps, timestamp)
		}
	}
	appendRecents(object["recents"])
	if messageData, ok := object["message_data"].(map[string]any); ok {
		appendRecents(messageData["recents"])
	}
	sort.Slice(timestamps, func(i, j int) bool { return timestamps[i].Before(timestamps[j]) })
	if len(timestamps) > 50 {
		timestamps = timestamps[len(timestamps)-50:]
	}
	return timestamps
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
