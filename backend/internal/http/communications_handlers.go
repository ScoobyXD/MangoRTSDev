package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var errInvalidCommunicationsMailbox = errors.New("invalid communications mailbox")

func (s *Server) handleCommunicationsStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	connection, err := s.repo.GetUserEmailConnection(actor.User.UserID)
	if errors.Is(err, store.ErrNotFound) {
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"configured": s.nylasConfig.IsConfigured(),
			"connected":  false,
			"status":     "disconnected",
		})
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "user_id_required")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_email_connection")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"configured": s.nylasConfig.IsConfigured(),
		"connected":  connection.Status == "connected",
		"connection": emailConnectionResponse(connection),
		"status":     connection.Status,
	})
}

func (s *Server) handleCommunicationsAuthURL(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if !s.nylasConfig.IsConfigured() {
		writeError(w, http.StatusServiceUnavailable, "nylas_not_configured")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if strings.TrimSpace(actor.User.Email) == "" {
		writeError(w, http.StatusBadRequest, "authenticated_email_required")
		return
	}
	provider := normalizeCommunicationsProvider(r.URL.Query().Get("provider"))
	if provider == "" {
		writeError(w, http.StatusBadRequest, "invalid_email_provider")
		return
	}
	state, err := signNylasOAuthState(s.nylasConfig.StateSecret, nylasOAuthStatePayload{
		UserID:   actor.User.UserID,
		Email:    actor.User.Email,
		Provider: provider,
	}, time.Now())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_nylas_state")
		return
	}
	authURL, err := s.nylasConfig.HostedAuthURL(provider, state)
	if errors.Is(err, errInvalidNylasProvider) {
		writeError(w, http.StatusBadRequest, "invalid_email_provider")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_nylas_auth_url")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"auth_url": authURL})
}

func (s *Server) handleCommunicationsDisconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	connection, err := s.repo.GetUserEmailConnection(actor.User.UserID)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_email_connection")
		return
	}
	if s.nylasClient != nil && strings.TrimSpace(connection.GrantID) != "" {
		if err := s.nylasClient.DeleteGrant(r.Context(), connection.GrantID); err != nil {
			log.Printf("failed to delete nylas grant user_id=%s provider=%s: %v", actor.User.UserID, connection.Provider, err)
		}
	}
	if err := s.repo.DeleteUserEmailConnection(actor.User.UserID); err != nil && !errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_email_connection")
		return
	}
	s.commCache.invalidateUser(actor.User.UserID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
}

func (s *Server) handleCommunicationsFolders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	connection, ok := s.requireConnectedEmail(w, r)
	if !ok {
		return
	}
	folders, err := s.communicationsFolders(r.Context(), connection)
	if err != nil {
		s.writeNylasError(w, r, connection, err)
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"folders": folders})
}

func (s *Server) handleCommunicationsMessages(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.requireConnectedEmail(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		query, valid := parseNylasMessageQuery(w, r)
		if !valid {
			return
		}
		query, err := s.applyCommunicationsMailboxQuery(r.Context(), connection, query)
		if err != nil {
			if errors.Is(err, errInvalidCommunicationsMailbox) {
				writeError(w, http.StatusBadRequest, "invalid_email_mailbox")
				return
			}
			s.writeNylasError(w, r, connection, err)
			return
		}
		page, err := s.communicationsMessagePage(r.Context(), connection, query)
		if err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, page)
	case http.MethodPost:
		s.sendCommunicationsMessage(w, r, connection)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleCommunicationsMessageByID(w http.ResponseWriter, r *http.Request) {
	messageID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/communications/messages/"), "/")
	if messageID == "" || strings.Contains(messageID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	connection, ok := s.requireConnectedEmail(w, r)
	if !ok {
		return
	}
	if messageID == "send" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		s.sendCommunicationsMessage(w, r, connection)
		return
	}

	switch r.Method {
	case http.MethodGet:
		message, err := s.communicationsMessage(r.Context(), connection, messageID)
		if err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"message": message})
	case http.MethodPut:
		var req struct {
			Unread  *bool    `json:"unread"`
			Starred *bool    `json:"starred"`
			Folders []string `json:"folders"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		update := NylasMessageUpdate{
			Unread:  req.Unread,
			Starred: req.Starred,
			Folders: cleanStringList(req.Folders),
		}
		if update.Unread == nil && update.Starred == nil && req.Folders == nil {
			writeError(w, http.StatusBadRequest, "email_message_update_required")
			return
		}
		var message NylasMessage
		err := s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
			var err error
			message, err = s.nylasClient.UpdateMessage(ctx, connection.GrantID, messageID, update)
			return err
		})
		if err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
		s.commCache.invalidateUser(connection.UserID)
		s.publishCommunicationsEvent(connection.UserID, "mailbox_changed", "message.updated", message.ID)
		writeJSON(w, http.StatusOK, map[string]any{"message": message})
	case http.MethodDelete:
		if err := s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
			return s.nylasClient.DeleteMessage(ctx, connection.GrantID, messageID)
		}); err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
		s.commCache.invalidateUser(connection.UserID)
		s.publishCommunicationsEvent(connection.UserID, "mailbox_changed", "message.deleted", messageID)
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) sendCommunicationsMessage(w http.ResponseWriter, r *http.Request, connection domain.UserEmailConnection) {
	var req NylasSendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.Subject = strings.TrimSpace(req.Subject)
	req.Body = strings.TrimSpace(req.Body)
	req.ReplyToMessageID = strings.TrimSpace(req.ReplyToMessageID)
	req.To = cleanEmailAddresses(req.To)
	req.Cc = cleanEmailAddresses(req.Cc)
	req.Bcc = cleanEmailAddresses(req.Bcc)
	if len(req.To) == 0 && len(req.Cc) == 0 && len(req.Bcc) == 0 {
		writeError(w, http.StatusBadRequest, "email_recipients_required")
		return
	}
	if req.Subject == "" && req.Body == "" {
		writeError(w, http.StatusBadRequest, "email_content_required")
		return
	}
	var message NylasMessage
	err := s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
		var err error
		message, err = s.nylasClient.SendMessage(ctx, connection.GrantID, req)
		return err
	})
	if err != nil {
		s.writeNylasError(w, r, connection, err)
		return
	}
	s.commCache.invalidateUser(connection.UserID)
	s.publishCommunicationsEvent(connection.UserID, "mailbox_changed", "message.created", message.ID)
	writeJSON(w, http.StatusCreated, map[string]any{"message": message})
}

func (s *Server) handleNylasOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if !s.nylasConfig.IsConfigured() || s.nylasClient == nil {
		s.redirectCommunications(w, r, "nylas_not_configured")
		return
	}
	if oauthError := strings.TrimSpace(r.URL.Query().Get("error")); oauthError != "" {
		s.redirectCommunications(w, r, "nylas_oauth_"+oauthError)
		return
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" {
		s.redirectCommunications(w, r, "nylas_code_required")
		return
	}
	state, err := parseNylasOAuthState(s.nylasConfig.StateSecret, r.URL.Query().Get("state"), time.Now())
	if errors.Is(err, errExpiredNylasState) {
		s.redirectCommunications(w, r, "nylas_state_expired")
		return
	}
	if err != nil {
		s.redirectCommunications(w, r, "nylas_state_invalid")
		return
	}
	grant, err := s.nylasClient.ExchangeCode(r.Context(), code, s.nylasConfig.RedirectURI)
	if err != nil {
		log.Printf("nylas token exchange failed user_id=%s provider=%s: %v", state.UserID, state.Provider, err)
		s.redirectCommunications(w, r, "nylas_token_exchange_failed")
		return
	}
	if normalizeEmailForCompare(grant.Email) != state.Email {
		if strings.TrimSpace(grant.GrantID) != "" {
			_ = s.nylasClient.DeleteGrant(r.Context(), grant.GrantID)
		}
		s.redirectCommunications(w, r, "nylas_email_mismatch")
		return
	}
	provider := normalizeCommunicationsProvider(grant.Provider)
	if provider == "" {
		provider = state.Provider
	}
	_, err = s.repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       state.UserID,
		Provider:     provider,
		AccountEmail: grant.Email,
		GrantID:      grant.GrantID,
		Status:       "connected",
	})
	if errors.Is(err, store.ErrNotFound) {
		s.redirectCommunications(w, r, "mango_user_not_found")
		return
	}
	if err != nil {
		log.Printf("failed to store nylas grant user_id=%s provider=%s: %v", state.UserID, provider, err)
		s.redirectCommunications(w, r, "nylas_connection_store_failed")
		return
	}
	s.commCache.invalidateUser(state.UserID)
	s.redirectCommunicationsSuccess(w, r)
}

func (s *Server) requireConnectedEmail(w http.ResponseWriter, r *http.Request) (domain.UserEmailConnection, bool) {
	if !s.nylasConfig.IsConfigured() || s.nylasClient == nil {
		writeError(w, http.StatusServiceUnavailable, "nylas_not_configured")
		return domain.UserEmailConnection{}, false
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return domain.UserEmailConnection{}, false
	}
	connection, err := s.repo.GetUserEmailConnection(actor.User.UserID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusConflict, "nylas_not_connected")
		return domain.UserEmailConnection{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_email_connection")
		return domain.UserEmailConnection{}, false
	}
	if connection.Status == "reauth_required" {
		writeError(w, http.StatusUnauthorized, "nylas_reauth_required")
		return domain.UserEmailConnection{}, false
	}
	if connection.Status != "connected" || strings.TrimSpace(connection.GrantID) == "" {
		writeError(w, http.StatusConflict, "nylas_not_connected")
		return domain.UserEmailConnection{}, false
	}
	return connection, true
}

func (s *Server) writeNylasError(w http.ResponseWriter, r *http.Request, connection domain.UserEmailConnection, err error) {
	var apiErr NylasAPIError
	if errors.As(err, &apiErr) {
		log.Printf("nylas API error user_id=%s provider=%s path=%s status=%d code=%s message=%s", connection.UserID, connection.Provider, r.URL.Path, apiErr.StatusCode, apiErr.Code, apiErr.Message)
		if apiErr.StatusCode == http.StatusUnauthorized || apiErr.StatusCode == http.StatusForbidden {
			_, _ = s.repo.UpdateUserEmailConnectionStatus(connection.UserID, "reauth_required")
			writeError(w, http.StatusUnauthorized, "nylas_reauth_required")
			return
		}
		if apiErr.StatusCode == http.StatusNotFound {
			writeError(w, http.StatusNotFound, "nylas_resource_not_found")
			return
		}
		if apiErr.StatusCode == http.StatusTooManyRequests {
			if strings.TrimSpace(apiErr.RetryAfter) != "" {
				w.Header().Set("Retry-After", strings.TrimSpace(apiErr.RetryAfter))
			}
			writeError(w, http.StatusTooManyRequests, "nylas_rate_limited")
			return
		}
		if apiErr.StatusCode >= 400 && apiErr.StatusCode < 500 {
			writeError(w, http.StatusBadGateway, "nylas_request_rejected")
			return
		}
	}
	log.Printf("nylas proxy error user_id=%s provider=%s path=%s: %v", connection.UserID, connection.Provider, r.URL.Path, err)
	writeError(w, http.StatusBadGateway, "nylas_request_failed")
}

const (
	communicationsNylasDefaultMessageLimit = 20
	communicationsNylasMaxMessageLimit     = 20
	communicationsNylasMinRequestInterval  = 250 * time.Millisecond
)

func (s *Server) communicationsFolders(ctx context.Context, connection domain.UserEmailConnection) ([]NylasFolder, error) {
	now := time.Now().UTC()
	if folders, ok := s.commCache.getFolders(connection.UserID, communicationsFoldersCacheTTL, now); ok {
		return folders, nil
	}
	var folders []NylasFolder
	err := s.withCommunicationsNylasGate(ctx, connection, func(ctx context.Context) error {
		if cached, ok := s.commCache.getFolders(connection.UserID, communicationsFoldersCacheTTL, time.Now().UTC()); ok {
			folders = cached
			return nil
		}
		var err error
		folders, err = s.nylasClient.ListFolders(ctx, connection.GrantID)
		return err
	})
	if err != nil {
		if shouldServeStaleCommunicationsCache(err) {
			if cached, ok := s.commCache.getFolders(connection.UserID, communicationsFoldersCacheTTL+communicationsMaxStaleTTL, now); ok {
				return cached, nil
			}
		}
		return nil, err
	}
	s.commCache.setFolders(connection.UserID, folders, now)
	return folders, nil
}

func (s *Server) communicationsMessagePage(ctx context.Context, connection domain.UserEmailConnection, query NylasMessageQuery) (NylasMessagePage, error) {
	now := time.Now().UTC()
	if page, ok := s.commCache.getMessagePage(connection.UserID, query, communicationsMessagesCacheTTL, now); ok {
		return page, nil
	}
	var page NylasMessagePage
	err := s.withCommunicationsNylasGate(ctx, connection, func(ctx context.Context) error {
		if cached, ok := s.commCache.getMessagePage(connection.UserID, query, communicationsMessagesCacheTTL, time.Now().UTC()); ok {
			page = cached
			return nil
		}
		var err error
		page, err = s.nylasClient.ListMessages(ctx, connection.GrantID, query)
		return err
	})
	if err != nil {
		if shouldServeStaleCommunicationsCache(err) {
			if cached, ok := s.commCache.getMessagePage(connection.UserID, query, communicationsMessagesCacheTTL+communicationsMaxStaleTTL, now); ok {
				return cached, nil
			}
		}
		return NylasMessagePage{}, err
	}
	s.commCache.setMessagePage(connection.UserID, query, page, now)
	return page, nil
}

func (s *Server) communicationsMessage(ctx context.Context, connection domain.UserEmailConnection, messageID string) (NylasMessage, error) {
	now := time.Now().UTC()
	if message, ok := s.commCache.getMessage(connection.UserID, messageID, communicationsMessageCacheTTL, now); ok {
		return message, nil
	}
	var message NylasMessage
	err := s.withCommunicationsNylasGate(ctx, connection, func(ctx context.Context) error {
		if cached, ok := s.commCache.getMessage(connection.UserID, messageID, communicationsMessageCacheTTL, time.Now().UTC()); ok {
			message = cached
			return nil
		}
		var err error
		message, err = s.nylasClient.GetMessage(ctx, connection.GrantID, messageID)
		return err
	})
	if err != nil {
		if shouldServeStaleCommunicationsCache(err) {
			if cached, ok := s.commCache.getMessage(connection.UserID, messageID, communicationsMessageCacheTTL+communicationsMaxStaleTTL, now); ok {
				return cached, nil
			}
		}
		return NylasMessage{}, err
	}
	s.commCache.setMessage(connection.UserID, message, now)
	return message, nil
}

func shouldServeStaleCommunicationsCache(err error) bool {
	var apiErr NylasAPIError
	return errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusTooManyRequests
}

func parseNylasMessageQuery(w http.ResponseWriter, r *http.Request) (NylasMessageQuery, bool) {
	for key := range r.URL.Query() {
		if key != "limit" && key != "page_token" && key != "folder_id" && key != "q" && key != "mailbox" && key != "unread" {
			writeError(w, http.StatusBadRequest, "unsupported_email_query_param")
			return NylasMessageQuery{}, false
		}
	}
	limit := communicationsNylasDefaultMessageLimit
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "invalid_limit")
			return NylasMessageQuery{}, false
		}
		limit = parsed
	}
	if limit > communicationsNylasMaxMessageLimit {
		limit = communicationsNylasMaxMessageLimit
	}
	query := NylasMessageQuery{
		Limit:     limit,
		PageToken: strings.TrimSpace(r.URL.Query().Get("page_token")),
		FolderID:  strings.TrimSpace(r.URL.Query().Get("folder_id")),
		Query:     strings.TrimSpace(r.URL.Query().Get("q")),
		Mailbox:   normalizeCommunicationsMailbox(r.URL.Query().Get("mailbox")),
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("mailbox")); raw != "" && query.Mailbox == "" {
		writeError(w, http.StatusBadRequest, "invalid_email_mailbox")
		return NylasMessageQuery{}, false
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("unread")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_unread")
			return NylasMessageQuery{}, false
		}
		query.Unread = &parsed
	}
	return query, true
}

func (s *Server) applyCommunicationsMailboxQuery(ctx context.Context, connection domain.UserEmailConnection, query NylasMessageQuery) (NylasMessageQuery, error) {
	switch query.Mailbox {
	case "", "all":
		return query, nil
	case "primary":
		if connection.Provider == "google" {
			query.SearchQueryNative = gmailPrimarySearch(query.Query, query.Unread)
			query.Query = ""
			query.Unread = nil
			query.FolderID = ""
			return query, nil
		}
		return s.applySystemFolderMailbox(ctx, connection, query, "inbox")
	case "sent":
		if strings.TrimSpace(query.FolderID) != "" {
			return query, nil
		}
		if connection.Provider == "google" {
			query.FolderID = "SENT"
			return query, nil
		}
		return s.applySystemFolderMailbox(ctx, connection, query, "sent")
	default:
		return NylasMessageQuery{}, errInvalidCommunicationsMailbox
	}
}

func (s *Server) applySystemFolderMailbox(ctx context.Context, connection domain.UserEmailConnection, query NylasMessageQuery, system string) (NylasMessageQuery, error) {
	if strings.TrimSpace(query.FolderID) != "" {
		return query, nil
	}
	folders, err := s.communicationsFolders(ctx, connection)
	if err != nil {
		return NylasMessageQuery{}, err
	}
	folderID := findNylasSystemFolderID(folders, system)
	if folderID == "" {
		return query, nil
	}
	query.FolderID = folderID
	return query, nil
}

func gmailPrimarySearch(userQuery string, unread *bool) string {
	parts := []string{"category:primary", "in:inbox"}
	if trimmed := strings.TrimSpace(userQuery); trimmed != "" {
		parts = append(parts, trimmed)
	}
	if unread != nil && *unread {
		parts = append(parts, "is:unread")
	}
	return strings.Join(parts, " ")
}

func findNylasSystemFolderID(folders []NylasFolder, system string) string {
	normalized := strings.TrimSpace(strings.ToLower(system))
	for _, folder := range folders {
		systemFolder := strings.ToLower(strings.TrimSpace(folder.SystemFolder))
		name := strings.ToLower(strings.TrimSpace(firstNonBlank(folder.Name, folder.DisplayName)))
		if systemFolder == normalized || name == normalized {
			return strings.TrimSpace(folder.ID)
		}
		for _, attribute := range folder.Attributes {
			if strings.Trim(strings.ToLower(strings.TrimSpace(attribute)), "\\") == normalized {
				return strings.TrimSpace(folder.ID)
			}
		}
	}
	return ""
}

func normalizeCommunicationsMailbox(mailbox string) string {
	switch strings.TrimSpace(strings.ToLower(mailbox)) {
	case "", "primary", "primary_inbox", "primary inbox":
		return "primary"
	case "sent", "sent_mail", "sent mail":
		return "sent"
	case "all", "all_mail", "all mail":
		return "all"
	default:
		return ""
	}
}

func emailConnectionResponse(connection domain.UserEmailConnection) map[string]any {
	return map[string]any{
		"user_id":           connection.UserID,
		"provider":          connection.Provider,
		"account_email":     connection.AccountEmail,
		"status":            connection.Status,
		"created_timestamp": connection.CreatedTimestamp,
		"updated_timestamp": connection.UpdatedTimestamp,
	}
}

func cleanEmailAddresses(items []NylasEmailAddress) []NylasEmailAddress {
	cleaned := make([]NylasEmailAddress, 0, len(items))
	for _, item := range items {
		email := normalizeEmailForCompare(item.Email)
		if email == "" {
			continue
		}
		cleaned = append(cleaned, NylasEmailAddress{
			Name:  strings.TrimSpace(item.Name),
			Email: email,
		})
	}
	return cleaned
}

func cleanStringList(items []string) []string {
	if items == nil {
		return nil
	}
	cleaned := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		value := strings.TrimSpace(item)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		cleaned = append(cleaned, value)
	}
	return cleaned
}

func normalizeEmailForCompare(email string) string {
	return strings.TrimSpace(strings.ToLower(email))
}

func (s *Server) redirectCommunicationsSuccess(w http.ResponseWriter, r *http.Request) {
	target := s.communicationsRedirectURL()
	query := target.Query()
	query.Set("nylas", "connected")
	target.RawQuery = query.Encode()
	http.Redirect(w, r, target.String(), http.StatusFound)
}

func (s *Server) redirectCommunications(w http.ResponseWriter, r *http.Request, code string) {
	target := s.communicationsRedirectURL()
	query := target.Query()
	query.Set("nylas_error", strings.TrimSpace(code))
	target.RawQuery = query.Encode()
	http.Redirect(w, r, target.String(), http.StatusFound)
}

func (s *Server) communicationsRedirectURL() *url.URL {
	raw := strings.TrimSpace(s.nylasConfig.FrontendRedirectURL)
	if raw == "" {
		raw = "/communications"
	}
	target, err := url.Parse(raw)
	if err != nil {
		return &url.URL{Path: "/communications"}
	}
	return target
}
