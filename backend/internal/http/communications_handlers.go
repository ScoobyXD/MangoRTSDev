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
	"sync"
	"time"
)

var (
	errInvalidCommunicationsMailbox     = errors.New("invalid communications mailbox")
	errCommunicationsArchiveUnavailable = errors.New("communications archive folder unavailable")
)

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
	accountEmail := normalizeEmailForCompare(r.URL.Query().Get("account_email"))
	if accountEmail == "" {
		accountEmail = normalizeEmailForCompare(actor.User.Email)
	}
	if !strings.Contains(accountEmail, "@") {
		writeError(w, http.StatusBadRequest, "invalid_account_email")
		return
	}
	state, err := signNylasOAuthState(s.nylasConfig.StateSecret, nylasOAuthStatePayload{
		UserID:   actor.User.UserID,
		Email:    accountEmail,
		Provider: provider,
	}, time.Now())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_nylas_state")
		return
	}
	authURL, err := s.nylasConfig.HostedAuthURL(provider, state, accountEmail)
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
	for key := range r.URL.Query() {
		if key != "company_id" && key != "shared_inbox_id" {
			writeError(w, http.StatusBadRequest, "unsupported_email_query_param")
			return
		}
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	sharedInboxID := strings.TrimSpace(r.URL.Query().Get("shared_inbox_id"))
	if strings.TrimSpace(companyID) != "" && !requireCompanyAccess(w, r, companyID) {
		return
	}
	connection, ok := s.requireCommunicationsConnection(w, r, actor, companyID, sharedInboxID, store.EntityPermissionView)
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
	switch r.Method {
	case http.MethodGet:
		actor, ok := authenticatedActor(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		query, valid := parseNylasMessageQuery(w, r)
		if !valid {
			return
		}
		if strings.TrimSpace(query.CompanyID) != "" && !requireCompanyAccess(w, r, query.CompanyID) {
			return
		}
		connection, ok := s.requireCommunicationsConnection(w, r, actor, query.CompanyID, query.SharedInboxID, store.EntityPermissionView)
		if !ok {
			return
		}
		query, err := s.applyCommunicationsMailboxQuery(r.Context(), connection, query)
		if err != nil {
			if errors.Is(err, errInvalidCommunicationsMailbox) {
				writeError(w, http.StatusBadRequest, "invalid_email_mailbox")
				return
			}
			if errors.Is(err, errCommunicationsArchiveUnavailable) {
				writeError(w, http.StatusConflict, "archive_folder_unavailable")
				return
			}
			s.writeNylasError(w, r, connection, err)
			return
		}
		if query.Refresh {
			s.commCache.invalidateMessagePages(connection.UserID)
		}
		page, err := s.communicationsMessagePage(r.Context(), connection, query)
		if err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, page)
	case http.MethodPost:
		connection, ok := s.requireCommunicationsSendConnection(w, r)
		if !ok {
			return
		}
		s.sendCommunicationsMessage(w, r, connection)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleCommunicationsMessagesArchiveBatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	for key := range r.URL.Query() {
		if key != "company_id" && key != "shared_inbox_id" {
			writeError(w, http.StatusBadRequest, "unsupported_email_query_param")
			return
		}
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	sharedInboxID := strings.TrimSpace(r.URL.Query().Get("shared_inbox_id"))
	if companyID != "" && !requireCompanyAccess(w, r, companyID) {
		return
	}
	requiredSharedInboxAccess := store.EntityPermissionView
	if sharedInboxID != "" {
		requiredSharedInboxAccess = store.EntityPermissionEdit
	}
	connection, ok := s.requireCommunicationsConnection(w, r, actor, companyID, sharedInboxID, requiredSharedInboxAccess)
	if !ok {
		return
	}

	var req struct {
		MessageIDs []string `json:"message_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	messageIDs := cleanStringList(req.MessageIDs)
	if len(messageIDs) == 0 {
		writeError(w, http.StatusBadRequest, "email_message_ids_required")
		return
	}

	archiveFolderID := ""
	if connection.Provider != "google" {
		emailFolders, err := s.communicationsFolders(r.Context(), connection)
		if err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
		archiveFolderID = findNylasArchiveFolderID(emailFolders)
		if archiveFolderID == "" {
			writeError(w, http.StatusConflict, "archive_folder_unavailable")
			return
		}
	}

	result := s.archiveCommunicationsMessagesBatch(r.Context(), connection, messageIDs, archiveFolderID)
	if result.retryAfter != "" {
		w.Header().Set("Retry-After", result.retryAfter)
	}
	if len(result.ArchivedIDs) > 0 {
		s.invalidateCommunicationsMessageMutations(connection.UserID, result.ArchivedIDs, true)
		for _, messageID := range result.ArchivedIDs {
			s.publishCommunicationsEvent(connection.UserID, "mailbox_changed", "message.updated", messageID)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"archived_ids": result.ArchivedIDs,
		"failed":       result.Failed,
	})
}

func (s *Server) handleCommunicationsMessageByID(w http.ResponseWriter, r *http.Request) {
	suffix := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/communications/messages/"), "/")
	parts := strings.Split(suffix, "/")
	messageID := ""
	action := ""
	if len(parts) >= 1 {
		messageID = strings.TrimSpace(parts[0])
	}
	if len(parts) == 2 {
		action = strings.TrimSpace(parts[1])
	}
	if messageID == "" || len(parts) > 2 || (len(parts) == 2 && action != "archive" && action != "unarchive") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if messageID == "send" {
		if action != "" {
			writeError(w, http.StatusNotFound, "not_found")
			return
		}
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		connection, ok := s.requireCommunicationsSendConnection(w, r)
		if !ok {
			return
		}
		s.sendCommunicationsMessage(w, r, connection)
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	sharedInboxID := strings.TrimSpace(r.URL.Query().Get("shared_inbox_id"))
	if companyID != "" && !requireCompanyAccess(w, r, companyID) {
		return
	}
	requiredSharedInboxAccess := store.EntityPermissionView
	if sharedInboxID != "" && (action == "archive" || action == "unarchive" || r.Method == http.MethodPut || r.Method == http.MethodDelete) {
		requiredSharedInboxAccess = store.EntityPermissionEdit
	}
	connection, ok := s.requireCommunicationsConnection(w, r, actor, companyID, sharedInboxID, requiredSharedInboxAccess)
	if !ok {
		return
	}
	if action == "archive" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		s.archiveCommunicationsMessage(w, r, connection, messageID)
		return
	}
	if action == "unarchive" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		s.unarchiveCommunicationsMessage(w, r, connection, messageID)
		return
	}

	switch r.Method {
	case http.MethodGet:
		message, err := s.communicationsMessage(r.Context(), connection, messageID)
		if err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
		if companyID != "" {
			message = s.enrichCommunicationsMessagePlacements(connection.UserID, companyID, message)
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

func (s *Server) archiveCommunicationsMessage(w http.ResponseWriter, r *http.Request, connection domain.UserEmailConnection, messageID string) {
	archiveFolderID := ""
	if connection.Provider != "google" {
		emailFolders, err := s.communicationsFolders(r.Context(), connection)
		if err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
		archiveFolderID = findNylasArchiveFolderID(emailFolders)
		if archiveFolderID == "" {
			writeError(w, http.StatusConflict, "archive_folder_unavailable")
			return
		}
	}

	archived, err := s.archiveCommunicationsMessageByID(r.Context(), connection, messageID, archiveFolderID)
	if err != nil {
		s.writeNylasError(w, r, connection, err)
		return
	}
	s.invalidateCommunicationsMessageMutations(connection.UserID, []string{messageID}, true)
	s.publishCommunicationsEvent(connection.UserID, "mailbox_changed", "message.updated", archived.ID)
	writeJSON(w, http.StatusOK, map[string]any{"message": archived})
}

func (s *Server) unarchiveCommunicationsMessage(w http.ResponseWriter, r *http.Request, connection domain.UserEmailConnection, messageID string) {
	inboxFolderID := ""
	if connection.Provider != "google" {
		emailFolders, err := s.communicationsFolders(r.Context(), connection)
		if err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
		inboxFolderID = findNylasSystemFolderID(emailFolders, "inbox")
		if inboxFolderID == "" {
			writeError(w, http.StatusConflict, "inbox_folder_unavailable")
			return
		}
	}

	restored, err := s.unarchiveCommunicationsMessageByID(r.Context(), connection, messageID, inboxFolderID)
	if err != nil {
		s.writeNylasError(w, r, connection, err)
		return
	}
	s.invalidateCommunicationsMessageMutations(connection.UserID, []string{messageID}, true)
	s.publishCommunicationsEvent(connection.UserID, "mailbox_changed", "message.updated", restored.ID)
	writeJSON(w, http.StatusOK, map[string]any{"message": restored})
}

type communicationsArchiveBatchFailure struct {
	MessageID string `json:"message_id"`
	Error     string `json:"error"`
}

type communicationsArchiveBatchResult struct {
	ArchivedIDs []string                            `json:"archived_ids"`
	Failed      []communicationsArchiveBatchFailure `json:"failed"`
	retryAfter  string
}

func (s *Server) archiveCommunicationsMessagesBatch(ctx context.Context, connection domain.UserEmailConnection, messageIDs []string, archiveFolderID string) communicationsArchiveBatchResult {
	workers := communicationsArchiveBatchConcurrency
	if workers <= 0 || workers > len(messageIDs) {
		workers = len(messageIDs)
	}
	jobs := make(chan string)
	var mu sync.Mutex
	result := communicationsArchiveBatchResult{
		ArchivedIDs: make([]string, 0, len(messageIDs)),
		Failed:      []communicationsArchiveBatchFailure{},
	}
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for messageID := range jobs {
				archived, err := s.archiveCommunicationsMessageByID(ctx, connection, messageID, archiveFolderID)
				mu.Lock()
				if err != nil {
					result.Failed = append(result.Failed, communicationsArchiveBatchFailure{
						MessageID: messageID,
						Error:     communicationsMutationErrorCode(err),
					})
					if result.retryAfter == "" {
						var apiErr NylasAPIError
						if errors.As(err, &apiErr) {
							result.retryAfter = strings.TrimSpace(apiErr.RetryAfter)
						}
					}
					var apiErr NylasAPIError
					if errors.As(err, &apiErr) && (apiErr.StatusCode == http.StatusUnauthorized || apiErr.StatusCode == http.StatusForbidden) {
						_, _ = s.repo.UpdateUserEmailConnectionStatus(connection.UserID, "reauth_required")
					}
				} else {
					result.ArchivedIDs = append(result.ArchivedIDs, firstNonBlank(archived.ID, messageID))
				}
				mu.Unlock()
			}
		}()
	}
	for _, messageID := range messageIDs {
		select {
		case <-ctx.Done():
			mu.Lock()
			result.Failed = append(result.Failed, communicationsArchiveBatchFailure{
				MessageID: messageID,
				Error:     communicationsMutationErrorCode(ctx.Err()),
			})
			mu.Unlock()
		case jobs <- messageID:
		}
	}
	close(jobs)
	wg.Wait()
	return result
}

func (s *Server) archiveCommunicationsMessageByID(ctx context.Context, connection domain.UserEmailConnection, messageID, archiveFolderID string) (NylasMessage, error) {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return NylasMessage{}, store.ErrInvalid
	}
	folders := []string{strings.TrimSpace(archiveFolderID)}
	if connection.Provider == "google" {
		message, err := s.communicationsMessageForFolderMutation(ctx, connection, messageID)
		if err != nil {
			return NylasMessage{}, err
		}
		folders = archiveMessageFolderIDs(connection.Provider, message.Folders, "")
	} else if folders[0] == "" {
		emailFolders, err := s.communicationsFolders(ctx, connection)
		if err != nil {
			return NylasMessage{}, err
		}
		folderID := findNylasArchiveFolderID(emailFolders)
		if folderID == "" {
			return NylasMessage{}, errCommunicationsArchiveUnavailable
		}
		folders = []string{folderID}
	}

	var archived NylasMessage
	err := s.withCommunicationsNylasGate(ctx, connection, func(ctx context.Context) error {
		var err error
		archived, err = s.nylasClient.UpdateMessage(ctx, connection.GrantID, messageID, NylasMessageUpdate{Folders: folders})
		return err
	})
	if archived.ID == "" {
		archived.ID = messageID
	}
	return archived, err
}

func (s *Server) unarchiveCommunicationsMessageByID(ctx context.Context, connection domain.UserEmailConnection, messageID, inboxFolderID string) (NylasMessage, error) {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return NylasMessage{}, store.ErrInvalid
	}
	cleanInboxFolderID := strings.TrimSpace(inboxFolderID)
	if cleanInboxFolderID == "" {
		cleanInboxFolderID = "INBOX"
	}
	folders := []string{cleanInboxFolderID}
	if connection.Provider == "google" {
		message, err := s.communicationsMessageForFolderMutation(ctx, connection, messageID)
		if err != nil {
			return NylasMessage{}, err
		}
		folders = unarchiveMessageFolderIDs(connection.Provider, message.Folders, cleanInboxFolderID)
	} else if strings.TrimSpace(inboxFolderID) == "" {
		emailFolders, err := s.communicationsFolders(ctx, connection)
		if err != nil {
			return NylasMessage{}, err
		}
		folderID := findNylasSystemFolderID(emailFolders, "inbox")
		if folderID == "" {
			return NylasMessage{}, errors.New("inbox_folder_unavailable")
		}
		folders = []string{folderID}
	}

	var restored NylasMessage
	err := s.withCommunicationsNylasGate(ctx, connection, func(ctx context.Context) error {
		var err error
		restored, err = s.nylasClient.UpdateMessage(ctx, connection.GrantID, messageID, NylasMessageUpdate{Folders: folders})
		return err
	})
	if restored.ID == "" {
		restored.ID = messageID
	}
	return restored, err
}

func (s *Server) communicationsMessageForFolderMutation(ctx context.Context, connection domain.UserEmailConnection, messageID string) (NylasMessage, error) {
	now := time.Now().UTC()
	if message, ok := s.commCache.getMessage(connection.UserID, messageID, communicationsMessageCacheTTL, now); ok && message.Folders != nil {
		return message, nil
	}
	if message, ok := s.commCache.getMessageFromPages(connection.UserID, messageID, communicationsMessagesCacheTTL, now); ok && message.Folders != nil {
		return message, nil
	}
	return s.communicationsMessage(ctx, connection, messageID)
}

func (s *Server) invalidateCommunicationsMessageMutations(userID string, messageIDs []string, foldersChanged bool) {
	if s.commCache == nil {
		return
	}
	if foldersChanged {
		s.commCache.invalidateFolders(userID)
	}
	s.commCache.invalidateMessagePages(userID)
	for _, messageID := range messageIDs {
		s.commCache.invalidateMessage(userID, messageID)
	}
}

func communicationsMutationErrorCode(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "request_cancelled"
	}
	if errors.Is(err, errCommunicationsArchiveUnavailable) {
		return "archive_folder_unavailable"
	}
	var apiErr NylasAPIError
	if errors.As(err, &apiErr) {
		switch apiErr.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return "nylas_reauth_required"
		case http.StatusNotFound:
			return "nylas_resource_not_found"
		case http.StatusTooManyRequests:
			return "nylas_rate_limited"
		default:
			if apiErr.Code != "" {
				return "nylas_" + strings.TrimSpace(apiErr.Code)
			}
			return "nylas_request_failed"
		}
	}
	return "archive_failed"
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

func (s *Server) requireCommunicationsSendConnection(w http.ResponseWriter, r *http.Request) (domain.UserEmailConnection, bool) {
	if !s.nylasConfig.IsConfigured() || s.nylasClient == nil {
		writeError(w, http.StatusServiceUnavailable, "nylas_not_configured")
		return domain.UserEmailConnection{}, false
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return domain.UserEmailConnection{}, false
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	sharedInboxID := strings.TrimSpace(r.URL.Query().Get("shared_inbox_id"))
	return s.requireCommunicationsConnection(w, r, actor, companyID, sharedInboxID, store.EntityPermissionEdit)
}

func (s *Server) requireCommunicationsConnection(w http.ResponseWriter, r *http.Request, actor ActorContext, companyID, sharedInboxID, sharedInboxAccessLevel string) (domain.UserEmailConnection, bool) {
	if !s.nylasConfig.IsConfigured() || s.nylasClient == nil {
		writeError(w, http.StatusServiceUnavailable, "nylas_not_configured")
		return domain.UserEmailConnection{}, false
	}
	companyID = strings.TrimSpace(companyID)
	sharedInboxID = strings.TrimSpace(sharedInboxID)
	if sharedInboxID == "" {
		connection, err := s.repo.GetUserEmailConnection(actor.User.UserID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusConflict, "nylas_not_connected")
			return domain.UserEmailConnection{}, false
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_email_connection")
			return domain.UserEmailConnection{}, false
		}
		return requireConnectedEmailStatus(w, connection)
	}
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return domain.UserEmailConnection{}, false
	}
	folder, ok := s.findVisibleSharedInboxFolder(w, actor, companyID, sharedInboxID, sharedInboxAccessLevel)
	if !ok {
		return domain.UserEmailConnection{}, false
	}
	if folder.AccountEmail == nil || strings.TrimSpace(*folder.AccountEmail) == "" {
		writeError(w, http.StatusConflict, "shared_inbox_email_not_assigned")
		return domain.UserEmailConnection{}, false
	}
	connection, err := s.repo.GetCompanyEmailConnectionByAccountEmail(companyID, *folder.AccountEmail)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusConflict, "shared_inbox_email_account_not_connected")
		return domain.UserEmailConnection{}, false
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_shared_inbox_account_email")
		return domain.UserEmailConnection{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox_email_connection")
		return domain.UserEmailConnection{}, false
	}
	return requireConnectedEmailStatus(w, connection)
}

func requireConnectedEmailStatus(w http.ResponseWriter, connection domain.UserEmailConnection) (domain.UserEmailConnection, bool) {
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

func (s *Server) findVisibleSharedInboxFolder(w http.ResponseWriter, actor ActorContext, companyID, folderID, accessLevel string) (domain.CompanyExplorerFolder, bool) {
	folder, err := s.loadCommunicationsSharedInboxFolder(companyID, folderID)
	if err != nil {
		if errors.Is(err, store.ErrSharedInboxStorageUnavailable) || errors.Is(err, store.ErrRaciStorageUnavailable) {
			writeError(w, http.StatusServiceUnavailable, "shared_inbox_storage_unavailable")
			return domain.CompanyExplorerFolder{}, false
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "shared_inbox_not_found")
			return domain.CompanyExplorerFolder{}, false
		}
		writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox")
		return domain.CompanyExplorerFolder{}, false
	}
	if !s.requireCommunicationsSharedInboxAccess(w, nil, actor, companyID, folderID, accessLevel) {
		return domain.CompanyExplorerFolder{}, false
	}
	return folder, true
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
	communicationsNylasMinRequestInterval  = 50 * time.Millisecond
	communicationsNylasMaxInFlightPerGrant = 4
	communicationsArchiveBatchConcurrency  = 4
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
		return s.enrichCommunicationsMessagePagePlacements(connection.UserID, query.CompanyID, page), nil
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
	return s.enrichCommunicationsMessagePagePlacements(connection.UserID, query.CompanyID, page), nil
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

func (s *Server) enrichCommunicationsMessagePagePlacements(userID, companyID string, page NylasMessagePage) NylasMessagePage {
	page = cloneNylasMessagePage(page)
	page.Messages = s.enrichCommunicationsMessagesPlacements(userID, companyID, page.Messages)
	return page
}

func (s *Server) enrichCommunicationsMessagePlacements(userID, companyID string, message NylasMessage) NylasMessage {
	messages := s.enrichCommunicationsMessagesPlacements(userID, companyID, []NylasMessage{message})
	if len(messages) == 0 {
		return message
	}
	return messages[0]
}

func (s *Server) enrichCommunicationsMessagesPlacements(userID, companyID string, messages []NylasMessage) []NylasMessage {
	companyID = strings.TrimSpace(companyID)
	if s == nil || s.repo == nil || strings.TrimSpace(userID) == "" || companyID == "" || len(messages) == 0 {
		return messages
	}
	messageIDs := make([]string, 0, len(messages))
	for _, message := range messages {
		if strings.TrimSpace(message.ID) != "" {
			messageIDs = append(messageIDs, message.ID)
		}
	}
	messageIDs = cleanStringList(messageIDs)
	if len(messageIDs) == 0 {
		return messages
	}
	placements, err := s.repo.ListCommunicationsEmailPlacements(userID, companyID, messageIDs)
	if err != nil {
		log.Printf("failed to load communications email placements user_id=%s company_id=%s message_count=%d: %v", userID, companyID, len(messageIDs), err)
		return messages
	}
	logicGateIDsByMessage := make(map[string][]string, len(messageIDs))
	seenByMessage := make(map[string]map[string]bool, len(messageIDs))
	for _, placement := range placements {
		messageID := strings.TrimSpace(placement.MessageID)
		logicGateID := strings.TrimSpace(placement.LogicGateID)
		if messageID == "" || logicGateID == "" {
			continue
		}
		seen := seenByMessage[messageID]
		if seen == nil {
			seen = map[string]bool{}
			seenByMessage[messageID] = seen
		}
		if seen[logicGateID] {
			continue
		}
		seen[logicGateID] = true
		logicGateIDsByMessage[messageID] = append(logicGateIDsByMessage[messageID], logicGateID)
	}
	for i := range messages {
		logicGateIDs := logicGateIDsByMessage[messages[i].ID]
		if len(logicGateIDs) == 0 {
			messages[i].LogicGateIDs = nil
			messages[i].LogicGateCount = 0
			continue
		}
		messages[i].LogicGateIDs = logicGateIDs
		messages[i].LogicGateCount = len(logicGateIDs)
	}
	return messages
}

func parseNylasMessageQuery(w http.ResponseWriter, r *http.Request) (NylasMessageQuery, bool) {
	for key := range r.URL.Query() {
		if key != "limit" && key != "page_token" && key != "folder_id" && key != "q" && key != "mailbox" && key != "unread" && key != "company_id" && key != "shared_inbox_id" && key != "refresh" {
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
		Limit:         limit,
		PageToken:     strings.TrimSpace(r.URL.Query().Get("page_token")),
		FolderID:      strings.TrimSpace(r.URL.Query().Get("folder_id")),
		Query:         strings.TrimSpace(r.URL.Query().Get("q")),
		Mailbox:       normalizeCommunicationsMailbox(r.URL.Query().Get("mailbox")),
		CompanyID:     strings.TrimSpace(r.URL.Query().Get("company_id")),
		SharedInboxID: strings.TrimSpace(r.URL.Query().Get("shared_inbox_id")),
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
	if raw := strings.TrimSpace(r.URL.Query().Get("refresh")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_refresh")
			return NylasMessageQuery{}, false
		}
		query.Refresh = parsed
	}
	return query, true
}

func (s *Server) applyCommunicationsMailboxQuery(ctx context.Context, connection domain.UserEmailConnection, query NylasMessageQuery) (NylasMessageQuery, error) {
	switch query.Mailbox {
	case "", "all":
		if connection.Provider == "google" {
			query.SearchQueryNative = gmailAllSearch(query.Query, query.Unread)
			query.Query = ""
			query.Unread = nil
		}
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
	case "starred":
		starred := true
		query.Starred = &starred
		if connection.Provider == "google" {
			query.SearchQueryNative = gmailUserSearch(query.Query, query.Unread)
			query.Query = ""
			query.Unread = nil
		}
		return query, nil
	case "archive":
		if connection.Provider == "google" {
			query.SearchQueryNative = gmailArchiveSearch(query.Query, query.Unread)
			query.Query = ""
			query.Unread = nil
			query.FolderID = ""
			return query, nil
		}
		return s.applyRequiredSystemFolderMailbox(ctx, connection, query, "archive")
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

func (s *Server) applyRequiredSystemFolderMailbox(ctx context.Context, connection domain.UserEmailConnection, query NylasMessageQuery, system string) (NylasMessageQuery, error) {
	if strings.TrimSpace(query.FolderID) != "" {
		return query, nil
	}
	folders, err := s.communicationsFolders(ctx, connection)
	if err != nil {
		return NylasMessageQuery{}, err
	}
	folderID := findNylasSystemFolderID(folders, system)
	if folderID == "" && system == "archive" {
		folderID = findNylasArchiveFolderID(folders)
	}
	if folderID == "" {
		return NylasMessageQuery{}, errCommunicationsArchiveUnavailable
	}
	query.FolderID = folderID
	return query, nil
}

func gmailAllSearch(userQuery string, unread *bool) string {
	return gmailSearch([]string{"in:anywhere"}, userQuery, unread)
}

func gmailUserSearch(userQuery string, unread *bool) string {
	return gmailSearch(nil, userQuery, unread)
}

func gmailPrimarySearch(userQuery string, unread *bool) string {
	return gmailSearch([]string{"in:inbox", "-category:social", "-category:promotions"}, userQuery, unread)
}

func gmailArchiveSearch(userQuery string, unread *bool) string {
	return gmailSearch([]string{"in:anywhere", "-in:inbox", "-in:trash", "-in:spam", "-in:sent", "-in:drafts"}, userQuery, unread)
}

func gmailSearch(base []string, userQuery string, unread *bool) string {
	parts := append([]string{}, base...)
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

func findNylasArchiveFolderID(folders []NylasFolder) string {
	if folderID := findNylasSystemFolderID(folders, "archive"); folderID != "" {
		return folderID
	}
	for _, folder := range folders {
		name := normalizeNylasFolderToken(firstNonBlank(folder.Name, folder.DisplayName))
		if name == "archive" || name == "archives" || name == "archived" {
			return strings.TrimSpace(folder.ID)
		}
		for _, attribute := range folder.Attributes {
			value := normalizeNylasFolderToken(attribute)
			if value == "archive" || value == "archives" || value == "archived" {
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
	case "star", "starred":
		return "starred"
	case "archive", "archives", "archived":
		return "archive"
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

func archiveMessageFolderIDs(provider string, currentFolders []string, inboxFolderID string) []string {
	if strings.TrimSpace(strings.ToLower(provider)) != "google" {
		return cleanStringList(currentFolders)
	}
	inboxToken := normalizeNylasFolderToken(inboxFolderID)
	archivedFolders := make([]string, 0, len(currentFolders))
	seen := map[string]bool{}
	for _, folder := range currentFolders {
		clean := strings.TrimSpace(folder)
		if clean == "" {
			continue
		}
		token := normalizeNylasFolderToken(clean)
		if token == "inbox" || (inboxToken != "" && token == inboxToken) {
			continue
		}
		if isGmailSystemFolderToken(token) {
			continue
		}
		if seen[clean] {
			continue
		}
		seen[clean] = true
		archivedFolders = append(archivedFolders, clean)
	}
	return archivedFolders
}

func unarchiveMessageFolderIDs(provider string, currentFolders []string, inboxFolderID string) []string {
	cleanInboxFolderID := strings.TrimSpace(inboxFolderID)
	if cleanInboxFolderID == "" {
		cleanInboxFolderID = "INBOX"
	}
	if strings.TrimSpace(strings.ToLower(provider)) != "google" {
		folders := cleanStringList(currentFolders)
		inboxToken := normalizeNylasFolderToken(cleanInboxFolderID)
		for _, folder := range folders {
			if normalizeNylasFolderToken(folder) == inboxToken {
				return folders
			}
		}
		return append(folders, cleanInboxFolderID)
	}
	folders := archiveMessageFolderIDs(provider, currentFolders, cleanInboxFolderID)
	inboxToken := normalizeNylasFolderToken(cleanInboxFolderID)
	for _, folder := range folders {
		if normalizeNylasFolderToken(folder) == inboxToken {
			return folders
		}
	}
	return append(folders, cleanInboxFolderID)
}

func isGmailSystemFolderToken(token string) bool {
	if strings.HasPrefix(token, "category_") || strings.HasPrefix(token, "category:") {
		return true
	}
	switch token {
	case "all", "all_mail", "all mail", "chat", "draft", "drafts", "important", "inbox", "muted", "sent", "snoozed", "spam", "trash", "unread":
		return true
	default:
		return false
	}
}

func normalizeNylasFolderToken(value string) string {
	return strings.Trim(strings.ToLower(strings.TrimSpace(value)), "\\")
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
		raw = "/home"
	}
	target, err := url.Parse(raw)
	if err != nil {
		return &url.URL{Path: "/home"}
	}
	return target
}
