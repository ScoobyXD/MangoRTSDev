package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	errInvalidCommunicationsMailbox     = errors.New("invalid communications mailbox")
	errCommunicationsArchiveUnavailable = errors.New("communications archive folder unavailable")
	mangoEditorAttachmentImageSourceRE  = regexp.MustCompile(`(?i)(\bsrc\s*=\s*)(?:(["'])mango-attachment:([^"']+)["']|mango-attachment:([^\s>/]+))`)
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
		log.Printf("communications_status outcome=not_connected reason=no_personal_connection request_id=%s user_id=%s user_email=%s configured=%t", requestCorrelationID(r), actor.User.UserID, normalizeEmailForCompare(actor.User.Email), s.nylasConfig.IsConfigured())
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"configured": s.nylasConfig.IsConfigured(),
			"connected":  false,
			"status":     "disconnected",
		})
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		log.Printf("communications_status outcome=error reason=invalid_user_id request_id=%s user_id=%s user_email=%s", requestCorrelationID(r), actor.User.UserID, normalizeEmailForCompare(actor.User.Email))
		writeError(w, http.StatusBadRequest, "user_id_required")
		return
	}
	if err != nil {
		log.Printf("communications_status outcome=error reason=repo_error request_id=%s user_id=%s user_email=%s err=%v", requestCorrelationID(r), actor.User.UserID, normalizeEmailForCompare(actor.User.Email), err)
		writeError(w, http.StatusInternalServerError, "failed_to_load_email_connection")
		return
	}
	log.Printf("communications_status outcome=connected request_id=%s user_id=%s user_email=%s configured=%t provider=%s account_email=%s scope=%s status=%s grant=%s", requestCorrelationID(r), actor.User.UserID, normalizeEmailForCompare(actor.User.Email), s.nylasConfig.IsConfigured(), connection.Provider, connection.AccountEmail, connection.Scope, connection.Status, grantIDLogValue(connection.GrantID))
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
	requestedAccountEmail := normalizeEmailForCompare(r.URL.Query().Get("account_email"))
	sharedInboxCompanyID := strings.TrimSpace(r.URL.Query().Get("shared_inbox_company_id"))
	sharedInboxID := strings.TrimSpace(r.URL.Query().Get("shared_inbox_id"))
	sharedInboxParentFolderID := strings.TrimSpace(r.URL.Query().Get("shared_inbox_parent_folder_id"))
	sharedInboxName := strings.TrimSpace(r.URL.Query().Get("shared_inbox_name"))
	sharedInboxCreateRequested := sharedInboxCompanyID != "" || sharedInboxID != "" || sharedInboxParentFolderID != "" || sharedInboxName != ""
	accountEmail := requestedAccountEmail
	if accountEmail == "" {
		accountEmail = normalizeEmailForCompare(actor.User.Email)
	}
	if !strings.Contains(accountEmail, "@") {
		writeError(w, http.StatusBadRequest, "invalid_account_email")
		return
	}
	if sharedInboxCreateRequested {
		if sharedInboxCompanyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if sharedInboxID == "" && sharedInboxName == "" {
			writeError(w, http.StatusBadRequest, "shared_inbox_name_required")
			return
		}
		if requestedAccountEmail == "" {
			writeError(w, http.StatusBadRequest, "shared_inbox_account_email_required")
			return
		}
		if !requireCompanyAccess(w, r, sharedInboxCompanyID) {
			return
		}
		if !actorCanManageCompanyUsers(actor, sharedInboxCompanyID) {
			writeError(w, http.StatusForbidden, "company_manager_required")
			return
		}
		if sharedInboxID != "" {
			if !s.requireCommunicationsSharedInboxAccess(w, r, actor, sharedInboxCompanyID, sharedInboxID, store.EntityPermissionEdit) {
				return
			}
			inbox, err := s.loadCommunicationsSharedInboxFolder(sharedInboxCompanyID, sharedInboxID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "shared_inbox_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox")
				return
			}
			if store.CommunicationsSharedInboxResourceType(inbox) != store.EntityTypeSharedInbox {
				writeError(w, http.StatusBadRequest, "invalid_shared_inbox_target")
				return
			}
		} else if sharedInboxParentFolderID != "" {
			if !s.requireCommunicationsSharedInboxAccess(w, r, actor, sharedInboxCompanyID, sharedInboxParentFolderID, store.EntityPermissionEdit) {
				return
			}
			parent, err := s.loadCommunicationsSharedInboxFolder(sharedInboxCompanyID, sharedInboxParentFolderID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "parent_shared_inbox_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_load_parent_shared_inbox")
				return
			}
			if store.CommunicationsSharedInboxResourceType(parent) != store.EntityTypeSharedInboxFolder {
				writeError(w, http.StatusBadRequest, "invalid_shared_inbox_parent")
				return
			}
		}
	}
	strictEmail := true
	state, err := signNylasOAuthState(s.nylasConfig.StateSecret, nylasOAuthStatePayload{
		UserID:                    actor.User.UserID,
		Email:                     accountEmail,
		UserEmail:                 actor.User.Email,
		Provider:                  provider,
		StrictEmail:               strictEmail,
		SharedInboxCompanyID:      sharedInboxCompanyID,
		SharedInboxID:             sharedInboxID,
		SharedInboxParentFolderID: sharedInboxParentFolderID,
		SharedInboxName:           sharedInboxName,
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
		log.Printf("communications_auth_url outcome=error reason=hosted_auth_url_failed request_id=%s user_id=%s user_email=%s provider=%s requested_account_present=%t login_hint=%s strict_email=%t err=%v", requestCorrelationID(r), actor.User.UserID, normalizeEmailForCompare(actor.User.Email), provider, requestedAccountEmail != "", accountEmail, strictEmail, err)
		writeError(w, http.StatusInternalServerError, "failed_to_create_nylas_auth_url")
		return
	}
	log.Printf("communications_auth_url outcome=created request_id=%s user_id=%s user_email=%s provider=%s requested_account_present=%t login_hint=%s strict_email=%t", requestCorrelationID(r), actor.User.UserID, normalizeEmailForCompare(actor.User.Email), provider, requestedAccountEmail != "", accountEmail, strictEmail)
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
		log.Printf("communications_disconnect outcome=noop reason=no_personal_connection request_id=%s user_id=%s user_email=%s", requestCorrelationID(r), actor.User.UserID, normalizeEmailForCompare(actor.User.Email))
		writeJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
		return
	}
	if err != nil {
		log.Printf("communications_disconnect outcome=error reason=repo_error request_id=%s user_id=%s user_email=%s err=%v", requestCorrelationID(r), actor.User.UserID, normalizeEmailForCompare(actor.User.Email), err)
		writeError(w, http.StatusInternalServerError, "failed_to_load_email_connection")
		return
	}
	if s.nylasClient != nil && strings.TrimSpace(connection.GrantID) != "" {
		if err := s.nylasClient.DeleteGrant(r.Context(), connection.GrantID); err != nil {
			log.Printf("communications_disconnect outcome=warning reason=delete_nylas_grant_failed request_id=%s user_id=%s provider=%s account_email=%s scope=%s grant=%s err=%v", requestCorrelationID(r), actor.User.UserID, connection.Provider, connection.AccountEmail, connection.Scope, grantIDLogValue(connection.GrantID), err)
		}
	}
	if err := s.repo.DeleteUserEmailConnection(actor.User.UserID); err != nil && !errors.Is(err, store.ErrNotFound) {
		log.Printf("communications_disconnect outcome=error reason=delete_repo_failed request_id=%s user_id=%s provider=%s account_email=%s scope=%s grant=%s err=%v", requestCorrelationID(r), actor.User.UserID, connection.Provider, connection.AccountEmail, connection.Scope, grantIDLogValue(connection.GrantID), err)
		writeError(w, http.StatusInternalServerError, "failed_to_delete_email_connection")
		return
	}
	s.commCache.invalidateUser(actor.User.UserID)
	log.Printf("communications_disconnect outcome=success request_id=%s user_id=%s provider=%s account_email=%s scope=%s grant=%s", requestCorrelationID(r), actor.User.UserID, connection.Provider, connection.AccountEmail, connection.Scope, grantIDLogValue(connection.GrantID))
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
		if key != "company_id" && key != "shared_inbox_id" && key != "background" {
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
	if isTruthyQueryValue(r.URL.Query().Get("background")) {
		job, err := s.repo.CreateCommunicationsArchiveJob(store.CommunicationsArchiveJobInput{
			ActorUserID:   actor.User.UserID,
			CompanyID:     companyID,
			SharedInboxID: sharedInboxID,
			Connection:    connection,
			MessageIDs:    messageIDs,
		})
		if err != nil {
			log.Printf("failed to create communications archive job user_id=%s company_id=%s shared_inbox_id=%s: %v", actor.User.UserID, companyID, sharedInboxID, err)
			writeError(w, http.StatusInternalServerError, "failed_to_create_archive_job")
			return
		}
		s.wakeCommunicationsArchiveWorker()
		writeJSON(w, http.StatusAccepted, map[string]any{
			"job_id":       job.JobID,
			"accepted_ids": job.AcceptedMessageIDs,
			"archived_ids": []string{},
			"failed":       []communicationsArchiveBatchFailure{},
		})
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
	s.applyCommunicationsArchiveBatchResult(connection, sharedInboxID, result)
	writeJSON(w, http.StatusOK, map[string]any{
		"archived_ids": result.ArchivedIDs,
		"failed":       result.Failed,
	})
}

func (s *Server) applyCommunicationsArchiveBatchResult(connection domain.UserEmailConnection, sharedInboxID string, result communicationsArchiveBatchResult) {
	if len(result.ArchivedIDs) == 0 {
		return
	}
	now := time.Now().UTC()
	cacheScope := communicationsConnectionCacheScope(connection)
	s.commCache.removeMessagesFromPages(connection.UserID, cacheScope, result.ArchivedIDs, "primary", now)
	for _, message := range result.Messages {
		s.commCache.patchMessagePages(connection.UserID, cacheScope, message, now)
	}
	s.invalidateCommunicationsMessageMutations(connection.UserID, cacheScope, result.ArchivedIDs, true)
	s.rememberRecentCommunicationsArchiveMutation(cacheScope, result.ArchivedIDs, now)
}

func (s *Server) handleCommunicationsThreadByID(w http.ResponseWriter, r *http.Request) {
	threadID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/communications/threads/"), "/")
	if threadID == "" || strings.Contains(threadID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
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
	connection, ok := s.requireCommunicationsConnection(w, r, actor, companyID, sharedInboxID, store.EntityPermissionView)
	if !ok {
		return
	}
	var thread NylasThread
	err := s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
		var err error
		thread, err = s.nylasClient.GetThread(ctx, connection.GrantID, threadID)
		return err
	})
	if err != nil {
		s.writeNylasError(w, r, connection, err)
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"thread": thread})
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
	attachmentID := ""
	if len(parts) == 3 && strings.TrimSpace(parts[1]) == "attachments" {
		action = "attachment"
		attachmentID = strings.TrimSpace(parts[2])
	}
	if messageID == "" || len(parts) > 3 || (len(parts) == 2 && action != "archive" && action != "unarchive") || (len(parts) == 3 && action != "attachment") {
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
		s.archiveCommunicationsMessage(w, r, connection, messageID, sharedInboxID)
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
	if action == "attachment" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		s.downloadCommunicationsAttachment(w, r, connection, messageID, attachmentID)
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
		now := time.Now().UTC()
		cacheScope := communicationsConnectionCacheScope(connection)
		s.commCache.patchMessagePages(connection.UserID, cacheScope, message, now)
		s.commCache.patchMessageMetadata(connection.UserID, cacheScope, messageID, update, message)
		s.invalidateCommunicationsMessageMutations(connection.UserID, cacheScope, []string{messageID}, req.Folders != nil)
		writeJSON(w, http.StatusOK, map[string]any{"message": message})
	case http.MethodDelete:
		if err := s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
			return s.nylasClient.DeleteMessage(ctx, connection.GrantID, messageID)
		}); err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
		now := time.Now().UTC()
		cacheScope := communicationsConnectionCacheScope(connection)
		s.commCache.removeMessagesFromPages(connection.UserID, cacheScope, []string{messageID}, "", now)
		s.invalidateCommunicationsMessageMutations(connection.UserID, cacheScope, []string{messageID}, true)
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) downloadCommunicationsAttachment(w http.ResponseWriter, r *http.Request, connection domain.UserEmailConnection, messageID, attachmentID string) {
	messageID = strings.TrimSpace(messageID)
	attachmentID = strings.TrimSpace(attachmentID)
	if messageID == "" || attachmentID == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	message, err := s.communicationsMessage(r.Context(), connection, messageID)
	if err != nil {
		s.writeNylasError(w, r, connection, err)
		return
	}
	attachment, ok := findNylasAttachmentByID(message.Attachments, attachmentID)
	if !ok {
		writeError(w, http.StatusNotFound, "email_attachment_not_found")
		return
	}

	var content []byte
	if inlineContent := strings.TrimSpace(attachment.Content); inlineContent != "" {
		var err error
		content, err = base64.StdEncoding.DecodeString(inlineContent)
		if err != nil || len(content) > communicationsAttachmentDownloadMaxBytes {
			writeError(w, http.StatusBadRequest, "invalid_email_attachment")
			return
		}
	} else {
		err = s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
			var err error
			content, err = s.nylasClient.DownloadAttachment(ctx, connection.GrantID, messageID, attachmentID)
			return err
		})
		if err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
	}

	contentType := strings.TrimSpace(attachment.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	filename := strings.TrimSpace(attachment.Filename)
	if filename == "" {
		filename = "attachment"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": filename}))
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func (s *Server) archiveCommunicationsMessage(w http.ResponseWriter, r *http.Request, connection domain.UserEmailConnection, messageID, sharedInboxID string) {
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
	now := time.Now().UTC()
	cacheScope := communicationsConnectionCacheScope(connection)
	s.commCache.removeMessagesFromPages(connection.UserID, cacheScope, []string{messageID}, "primary", now)
	s.commCache.patchMessagePages(connection.UserID, cacheScope, archived, now)
	s.invalidateCommunicationsMessageMutations(connection.UserID, cacheScope, []string{messageID}, true)
	s.rememberRecentCommunicationsArchiveMutation(cacheScope, []string{messageID}, now)
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
	now := time.Now().UTC()
	cacheScope := communicationsConnectionCacheScope(connection)
	s.commCache.removeMessagesFromPages(connection.UserID, cacheScope, []string{messageID}, "archive", now)
	s.commCache.patchMessagePages(connection.UserID, cacheScope, restored, now)
	s.invalidateCommunicationsMessageMutations(connection.UserID, cacheScope, []string{messageID}, true)
	writeJSON(w, http.StatusOK, map[string]any{"message": restored})
}

type communicationsArchiveBatchFailure struct {
	MessageID string `json:"message_id"`
	Error     string `json:"error"`
}

type communicationsArchiveBatchResult struct {
	ArchivedIDs []string                            `json:"archived_ids"`
	Failed      []communicationsArchiveBatchFailure `json:"failed"`
	Messages    []NylasMessage
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
						s.markCommunicationsConnectionReauthRequired(connection)
					}
				} else {
					result.ArchivedIDs = append(result.ArchivedIDs, firstNonBlank(archived.ID, messageID))
					result.Messages = append(result.Messages, archived)
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
	cacheScope := communicationsConnectionCacheScope(connection)
	if message, ok := s.commCache.getMessage(connection.UserID, cacheScope, messageID, communicationsMessageCacheTTL, now); ok && message.Folders != nil {
		return message, nil
	}
	if message, ok := s.commCache.getMessageFromPages(connection.UserID, cacheScope, messageID, communicationsMessagesCacheTTL, now); ok && message.Folders != nil {
		return message, nil
	}
	return s.communicationsMessage(ctx, connection, messageID)
}

func (s *Server) invalidateCommunicationsMessageMutations(userID, accountScope string, messageIDs []string, foldersChanged bool) {
	if s.commCache == nil {
		return
	}
	if !foldersChanged {
		return
	}
	s.commCache.invalidateFolders(userID, accountScope)
	for _, messageID := range messageIDs {
		s.commCache.invalidateMessage(userID, accountScope, messageID)
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

type communicationsSendMessageRequest struct {
	NylasSendMessageRequest
	CompanyID string `json:"company_id,omitempty"`
}

func (s *Server) sendCommunicationsMessage(w http.ResponseWriter, r *http.Request, connection domain.UserEmailConnection) {
	var req communicationsSendMessageRequest
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
	cleanCompanyID := strings.TrimSpace(req.CompanyID)
	if cleanCompanyID == "" {
		cleanCompanyID = strings.TrimSpace(r.URL.Query().Get("company_id"))
	}
	sendReq := req.NylasSendMessageRequest
	if rejectDurableInlineFileBytes(w, "communications_send_body", sendReq.Body) {
		return
	}
	sendReq.Body, sendReq.Attachments = prepareCommunicationsInlineImageAttachments(sendReq.Body, sendReq.Attachments)
	attachments, attachmentsOK := s.resolveCommunicationsSendAttachments(w, r, cleanCompanyID, sendReq.Attachments)
	if !attachmentsOK {
		return
	}
	sendReq.Attachments = attachments
	sendReq.TrackingOptions = defaultCommunicationsTrackingOptions()
	if len(sendReq.To) == 0 && len(sendReq.Cc) == 0 && len(sendReq.Bcc) == 0 {
		writeError(w, http.StatusBadRequest, "email_recipients_required")
		return
	}
	if sendReq.Subject == "" && sendReq.Body == "" && len(sendReq.Attachments) == 0 {
		writeError(w, http.StatusBadRequest, "email_content_required")
		return
	}
	var message NylasMessage
	err := s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
		var err error
		message, err = s.nylasClient.SendMessage(ctx, connection.GrantID, sendReq)
		return err
	})
	if err != nil {
		s.writeNylasError(w, r, connection, err)
		return
	}
	message = communicationsSendResponseWithLocalContent(message, sendReq)
	if message.TrackingOptions == nil || !message.TrackingOptions.Opens {
		log.Printf("nylas send response missing open tracking user_id=%s grant_id=%s message_id=%s subject=%q", connection.UserID, connection.GrantID, message.ID, sendReq.Subject)
	}
	now := time.Now().UTC()
	cacheScope := communicationsConnectionCacheScope(connection)
	s.commCache.patchMessagePages(connection.UserID, cacheScope, message, now)
	s.commCache.invalidateMessage(connection.UserID, cacheScope, message.ID)
	writeJSON(w, http.StatusCreated, map[string]any{"message": message})
}

func communicationsSendResponseWithLocalContent(message NylasMessage, sendReq NylasSendMessageRequest) NylasMessage {
	if strings.TrimSpace(message.Body) == "" {
		message.Body = sendReq.Body
	}
	attachments := append([]NylasAttachment(nil), message.Attachments...)
	for index := range attachments {
		attachments[index].Content = ""
	}
	for _, sentAttachment := range sendReq.Attachments {
		matchIndex := -1
		for index, responseAttachment := range attachments {
			contentIDMatches := strings.TrimSpace(sentAttachment.ContentID) != "" && strings.EqualFold(strings.TrimSpace(responseAttachment.ContentID), strings.TrimSpace(sentAttachment.ContentID))
			filenameMatches := strings.TrimSpace(sentAttachment.Filename) != "" && strings.EqualFold(strings.TrimSpace(responseAttachment.Filename), strings.TrimSpace(sentAttachment.Filename))
			if contentIDMatches || filenameMatches {
				matchIndex = index
				break
			}
		}
		if matchIndex < 0 {
			sentAttachment.Content = ""
			attachments = append(attachments, sentAttachment)
			continue
		}
		if strings.TrimSpace(attachments[matchIndex].AttachmentID) == "" {
			attachments[matchIndex].AttachmentID = sentAttachment.AttachmentID
		}
		if strings.TrimSpace(attachments[matchIndex].ContentID) == "" {
			attachments[matchIndex].ContentID = sentAttachment.ContentID
		}
		if strings.TrimSpace(attachments[matchIndex].ContentDisposition) == "" {
			attachments[matchIndex].ContentDisposition = sentAttachment.ContentDisposition
		}
		attachments[matchIndex].IsInline = attachments[matchIndex].IsInline || sentAttachment.IsInline
		attachments[matchIndex].Content = ""
	}
	if len(attachments) > 0 {
		message.Attachments = attachments
	}
	return message
}

func defaultCommunicationsTrackingOptions() *NylasTrackingOptions {
	return &NylasTrackingOptions{Opens: true, Label: "Mango read receipt"}
}

func communicationsConnectionScopeForOAuthState(state nylasOAuthStatePayload) string {
	if strings.TrimSpace(state.SharedInboxCompanyID) != "" {
		return "shared"
	}
	if state.StrictEmail && normalizeEmailForCompare(state.Email) != "" && normalizeEmailForCompare(state.Email) != normalizeEmailForCompare(state.UserEmail) {
		return "shared"
	}
	return "personal"
}

func communicationsConnectionScopeForOAuthGrant(state nylasOAuthStatePayload, accountEmail string) string {
	if strings.TrimSpace(state.SharedInboxCompanyID) != "" {
		return "shared"
	}
	if state.StrictEmail && normalizeEmailForCompare(accountEmail) != "" && normalizeEmailForCompare(accountEmail) != normalizeEmailForCompare(state.UserEmail) {
		return "shared"
	}
	return "personal"
}

func communicationsOAuthStateRequiresEmailMatch(state nylasOAuthStatePayload) bool {
	if state.StrictEmail {
		return true
	}
	return communicationsOAuthStateTargetsPersonalMailbox(state)
}

func communicationsOAuthStateTargetsPersonalMailbox(state nylasOAuthStatePayload) bool {
	if strings.TrimSpace(state.SharedInboxCompanyID) != "" {
		return false
	}
	requestedEmail := normalizeEmailForCompare(state.Email)
	userEmail := normalizeEmailForCompare(state.UserEmail)
	return requestedEmail != "" && userEmail != "" && requestedEmail == userEmail
}

func (s *Server) userCanManageSharedInboxStructure(companyID, userID string) (bool, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return false, nil
	}
	memberships, err := s.repo.ListUserMemberships(userID)
	if err != nil {
		return false, err
	}
	for _, membership := range memberships {
		role := domain.NormalizeRole(membership.Role)
		if role == domain.RoleDevAdmin {
			return true, nil
		}
		if strings.TrimSpace(membership.CompanyID) == companyID && (role == domain.RoleCompanyAdmin || role == domain.RoleCompanyManager) {
			return true, nil
		}
	}
	return false, nil
}

func grantIDLogValue(grantID string) string {
	grantID = strings.TrimSpace(grantID)
	if grantID == "" {
		return "empty"
	}
	if len(grantID) <= 8 {
		return "present"
	}
	return "present_suffix_" + grantID[len(grantID)-8:]
}

func (s *Server) deleteNylasOAuthGrantBestEffort(ctx context.Context, requestID, cleanupReason string, grant NylasGrant) {
	if s.nylasClient == nil || strings.TrimSpace(grant.GrantID) == "" {
		return
	}
	if err := s.nylasClient.DeleteGrant(ctx, grant.GrantID); err != nil {
		log.Printf("nylas_oauth_callback outcome=warning reason=delete_grant_failed cleanup_reason=%s request_id=%s grant=%s err=%v", cleanupReason, requestID, grantIDLogValue(grant.GrantID), err)
	}
}

func (s *Server) handleNylasOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if !s.nylasConfig.IsConfigured() || s.nylasClient == nil {
		log.Printf("nylas_oauth_callback outcome=redirect reason=nylas_not_configured request_id=%s configured=%t client_present=%t", requestCorrelationID(r), s.nylasConfig.IsConfigured(), s.nylasClient != nil)
		s.redirectCommunications(w, r, "nylas_not_configured")
		return
	}
	if oauthError := strings.TrimSpace(r.URL.Query().Get("error")); oauthError != "" {
		log.Printf("nylas_oauth_callback outcome=redirect reason=provider_error request_id=%s oauth_error=%s", requestCorrelationID(r), oauthError)
		s.redirectCommunications(w, r, "nylas_oauth_"+oauthError)
		return
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" {
		log.Printf("nylas_oauth_callback outcome=redirect reason=missing_code request_id=%s state_present=%t", requestCorrelationID(r), strings.TrimSpace(r.URL.Query().Get("state")) != "")
		s.redirectCommunications(w, r, "nylas_code_required")
		return
	}
	state, err := parseNylasOAuthState(s.nylasConfig.StateSecret, r.URL.Query().Get("state"), time.Now())
	if errors.Is(err, errExpiredNylasState) {
		log.Printf("nylas_oauth_callback outcome=redirect reason=state_expired request_id=%s", requestCorrelationID(r))
		s.redirectCommunications(w, r, "nylas_state_expired")
		return
	}
	if err != nil {
		log.Printf("nylas_oauth_callback outcome=redirect reason=state_invalid request_id=%s err=%v", requestCorrelationID(r), err)
		s.redirectCommunications(w, r, "nylas_state_invalid")
		return
	}
	log.Printf("nylas_oauth_callback outcome=state_valid request_id=%s user_id=%s provider=%s requested_email=%s strict_email=%t scope=%s", requestCorrelationID(r), state.UserID, state.Provider, state.Email, state.StrictEmail, communicationsConnectionScopeForOAuthState(state))
	grant, err := s.nylasClient.ExchangeCode(r.Context(), code, s.nylasConfig.RedirectURI)
	if err != nil {
		log.Printf("nylas_oauth_callback outcome=redirect reason=token_exchange_failed request_id=%s user_id=%s provider=%s requested_email=%s strict_email=%t err=%v", requestCorrelationID(r), state.UserID, state.Provider, state.Email, state.StrictEmail, err)
		s.redirectCommunications(w, r, "nylas_token_exchange_failed")
		return
	}
	log.Printf("nylas_oauth_callback outcome=grant_received request_id=%s user_id=%s state_provider=%s grant_provider=%s requested_email=%s grant_email=%s strict_email=%t grant=%s", requestCorrelationID(r), state.UserID, state.Provider, grant.Provider, state.Email, normalizeEmailForCompare(grant.Email), state.StrictEmail, grantIDLogValue(grant.GrantID))
	if communicationsOAuthStateRequiresEmailMatch(state) && normalizeEmailForCompare(grant.Email) != normalizeEmailForCompare(state.Email) {
		s.deleteNylasOAuthGrantBestEffort(r.Context(), requestCorrelationID(r), "email_mismatch", grant)
		log.Printf("nylas_oauth_callback outcome=redirect reason=email_mismatch request_id=%s user_id=%s provider=%s requested_email=%s grant_email=%s strict_email=%t grant=%s", requestCorrelationID(r), state.UserID, state.Provider, state.Email, normalizeEmailForCompare(grant.Email), state.StrictEmail, grantIDLogValue(grant.GrantID))
		s.redirectCommunications(w, r, "nylas_email_mismatch")
		return
	}
	provider := normalizeCommunicationsProvider(grant.Provider)
	if provider == "" {
		provider = state.Provider
	}
	connectionScope := communicationsConnectionScopeForOAuthGrant(state, grant.Email)
	var connection domain.UserEmailConnection
	var companyConnection domain.CompanyEmailConnection
	sharedInboxCompanyID := strings.TrimSpace(state.SharedInboxCompanyID)
	if connectionScope == "shared" && sharedInboxCompanyID != "" {
		allowed, roleErr := s.userCanManageSharedInboxStructure(sharedInboxCompanyID, state.UserID)
		if roleErr != nil {
			s.deleteNylasOAuthGrantBestEffort(r.Context(), requestCorrelationID(r), "shared_inbox_role_check_failed", grant)
			log.Printf("nylas_oauth_callback outcome=redirect reason=shared_inbox_role_check_failed request_id=%s user_id=%s company_id=%s provider=%s account_email=%s scope=%s grant=%s err=%v", requestCorrelationID(r), state.UserID, sharedInboxCompanyID, provider, normalizeEmailForCompare(grant.Email), connectionScope, grantIDLogValue(grant.GrantID), roleErr)
			s.redirectCommunications(w, r, "shared_inbox_create_failed")
			return
		}
		if !allowed {
			s.deleteNylasOAuthGrantBestEffort(r.Context(), requestCorrelationID(r), "company_manager_required", grant)
			log.Printf("nylas_oauth_callback outcome=redirect reason=company_manager_required request_id=%s user_id=%s company_id=%s provider=%s account_email=%s scope=%s grant=%s", requestCorrelationID(r), state.UserID, sharedInboxCompanyID, provider, normalizeEmailForCompare(grant.Email), connectionScope, grantIDLogValue(grant.GrantID))
			s.redirectCommunications(w, r, "company_manager_required")
			return
		}
		companyConnection, err = s.repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
			CompanyID:         sharedInboxCompanyID,
			Provider:          provider,
			AccountEmail:      grant.Email,
			GrantID:           grant.GrantID,
			Status:            "connected",
			ConnectedByUserID: state.UserID,
		})
		connection = userConnectionForCompanyEmailConnection(companyConnection, state.UserID)
	} else {
		connectionInput := store.UserEmailConnectionInput{
			UserID:       state.UserID,
			Provider:     provider,
			AccountEmail: grant.Email,
			Scope:        connectionScope,
			GrantID:      grant.GrantID,
			Status:       "connected",
		}
		connection, err = s.repo.UpsertUserEmailConnection(connectionInput)
		if errors.Is(err, store.ErrNotFound) && communicationsOAuthStateTargetsPersonalMailbox(state) && normalizeEmailForCompare(grant.Email) == normalizeEmailForCompare(state.Email) {
			if recoveredUser, lookupErr := s.repo.GetAuthUserByEmail(state.Email); lookupErr == nil && strings.TrimSpace(recoveredUser.UserID) != "" {
				log.Printf("nylas_oauth_callback outcome=recovering reason=state_user_not_found_by_email request_id=%s original_user_id=%s recovered_user_id=%s provider=%s account_email=%s scope=%s grant=%s", requestCorrelationID(r), state.UserID, recoveredUser.UserID, provider, normalizeEmailForCompare(grant.Email), connectionScope, grantIDLogValue(grant.GrantID))
				connectionInput.UserID = recoveredUser.UserID
				connection, err = s.repo.UpsertUserEmailConnection(connectionInput)
			} else if lookupErr != nil && !errors.Is(lookupErr, store.ErrNotFound) {
				log.Printf("nylas_oauth_callback outcome=warning reason=recover_user_by_email_failed request_id=%s original_user_id=%s provider=%s account_email=%s grant=%s err=%v", requestCorrelationID(r), state.UserID, provider, normalizeEmailForCompare(grant.Email), grantIDLogValue(grant.GrantID), lookupErr)
			}
		}
	}
	if errors.Is(err, store.ErrNotFound) {
		s.deleteNylasOAuthGrantBestEffort(r.Context(), requestCorrelationID(r), "mango_user_not_found", grant)
		log.Printf("nylas_oauth_callback outcome=redirect reason=mango_user_not_found request_id=%s user_id=%s provider=%s account_email=%s scope=%s grant=%s", requestCorrelationID(r), state.UserID, provider, normalizeEmailForCompare(grant.Email), connectionScope, grantIDLogValue(grant.GrantID))
		s.redirectCommunications(w, r, "mango_user_not_found")
		return
	}
	if err != nil {
		s.deleteNylasOAuthGrantBestEffort(r.Context(), requestCorrelationID(r), "connection_store_failed", grant)
		log.Printf("nylas_oauth_callback outcome=redirect reason=connection_store_failed request_id=%s user_id=%s provider=%s account_email=%s scope=%s grant=%s err=%v", requestCorrelationID(r), state.UserID, provider, normalizeEmailForCompare(grant.Email), connectionScope, grantIDLogValue(grant.GrantID), err)
		s.redirectCommunications(w, r, "nylas_connection_store_failed")
		return
	}
	s.commCache.invalidateUser(state.UserID)
	createdSharedInboxID := ""
	if connectionScope == "shared" && sharedInboxCompanyID != "" {
		var item domain.CompanyExplorerFolder
		var createErr error
		if strings.TrimSpace(state.SharedInboxID) != "" {
			item, createErr = s.repo.SetCommunicationsSharedInboxAccountEmail(sharedInboxCompanyID, state.SharedInboxID, grant.Email)
		} else {
			item, createErr = s.repo.CreateCommunicationsSharedInboxFolder(sharedInboxCompanyID, state.SharedInboxParentFolderID, state.SharedInboxName, grant.Email)
		}
		if createErr != nil {
			if strings.TrimSpace(companyConnection.CompanyEmailConnectionID) != "" {
				_, _ = s.repo.UpdateCompanyEmailConnectionStatus(sharedInboxCompanyID, companyConnection.CompanyEmailConnectionID, "disconnected")
			}
			s.deleteNylasOAuthGrantBestEffort(r.Context(), requestCorrelationID(r), "shared_inbox_create_failed", grant)
			log.Printf("nylas_oauth_callback outcome=redirect reason=shared_inbox_create_failed request_id=%s user_id=%s company_id=%s shared_inbox_id=%s parent_folder_id=%s provider=%s account_email=%s scope=%s grant=%s err=%v", requestCorrelationID(r), state.UserID, sharedInboxCompanyID, state.SharedInboxID, state.SharedInboxParentFolderID, provider, normalizeEmailForCompare(grant.Email), connectionScope, grantIDLogValue(grant.GrantID), createErr)
			s.redirectCommunications(w, r, "shared_inbox_create_failed")
			return
		}
		createdSharedInboxID = item.FolderID
		eventName := "company_explorer_folder_created"
		if strings.TrimSpace(state.SharedInboxID) != "" {
			eventName = "company_explorer_folder_updated"
		}
		s.publishWorkspaceEvent(sharedInboxCompanyID, eventName, map[string]any{"folder_id": item.FolderID, "shared_inbox_id": item.SharedInboxID, "folder_kind": item.FolderKind, "resource_type": store.EntityTypeSharedInbox, "folder": item})
	}
	log.Printf("nylas_oauth_callback outcome=success request_id=%s user_id=%s provider=%s account_email=%s scope=%s strict_email=%t grant=%s", requestCorrelationID(r), state.UserID, provider, normalizeEmailForCompare(grant.Email), connectionScope, state.StrictEmail, grantIDLogValue(grant.GrantID))
	s.redirectCommunicationsSuccess(w, r, connection, createdSharedInboxID)
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
		writeError(w, http.StatusConflict, "nylas_reauth_required")
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
	if store.CommunicationsSharedInboxResourceType(folder) != store.EntityTypeSharedInbox {
		writeError(w, http.StatusConflict, "shared_inbox_not_mailbox")
		return domain.UserEmailConnection{}, false
	}
	if folder.AccountEmail == nil || strings.TrimSpace(*folder.AccountEmail) == "" {
		writeError(w, http.StatusConflict, "shared_inbox_email_not_assigned")
		return domain.UserEmailConnection{}, false
	}
	var connection domain.CompanyEmailConnection
	var err error
	if strings.TrimSpace(folder.CompanyEmailConnectionID) != "" {
		connection, err = s.repo.GetCompanyEmailConnectionByID(companyID, folder.CompanyEmailConnectionID)
	} else {
		connection, err = s.repo.GetCompanyEmailConnectionByAccountEmail(companyID, *folder.AccountEmail)
	}
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
	return requireConnectedCompanyEmailStatus(w, connection, actor.User.UserID)
}

func requireConnectedEmailStatus(w http.ResponseWriter, connection domain.UserEmailConnection) (domain.UserEmailConnection, bool) {
	if connection.Status == "reauth_required" {
		writeError(w, http.StatusConflict, "nylas_reauth_required")
		return domain.UserEmailConnection{}, false
	}
	if connection.Status != "connected" || strings.TrimSpace(connection.GrantID) == "" {
		writeError(w, http.StatusConflict, "nylas_not_connected")
		return domain.UserEmailConnection{}, false
	}
	return connection, true
}

func userConnectionForCompanyEmailConnection(connection domain.CompanyEmailConnection, actorUserID string) domain.UserEmailConnection {
	return domain.UserEmailConnection{
		UserID:                   strings.TrimSpace(actorUserID),
		Provider:                 connection.Provider,
		AccountEmail:             connection.AccountEmail,
		Scope:                    "shared",
		CompanyID:                connection.CompanyID,
		CompanyEmailConnectionID: connection.CompanyEmailConnectionID,
		GrantID:                  connection.GrantID,
		Status:                   connection.Status,
		CreatedTimestamp:         connection.CreatedTimestamp,
		UpdatedTimestamp:         connection.UpdatedTimestamp,
	}
}

func communicationsMessageReadStatusScopeTypeForConnection(connection domain.UserEmailConnection) string {
	if strings.TrimSpace(connection.Scope) == "shared" || strings.TrimSpace(connection.CompanyEmailConnectionID) != "" {
		return "shared"
	}
	return "personal"
}

func requireConnectedCompanyEmailStatus(w http.ResponseWriter, connection domain.CompanyEmailConnection, actorUserID string) (domain.UserEmailConnection, bool) {
	return requireConnectedEmailStatus(w, userConnectionForCompanyEmailConnection(connection, actorUserID))
}

func (s *Server) findVisibleSharedInboxFolder(w http.ResponseWriter, actor ActorContext, companyID, folderID, accessLevel string) (domain.CompanyExplorerFolder, bool) {
	folder, err := s.loadCommunicationsSharedInboxFolder(companyID, folderID)
	if err != nil {
		if errors.Is(err, store.ErrSharedInboxStorageUnavailable) || errors.Is(err, store.ErrGVICStorageUnavailable) {
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
			s.markCommunicationsConnectionReauthRequired(connection)
			writeError(w, http.StatusConflict, "nylas_reauth_required")
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

func (s *Server) markCommunicationsConnectionReauthRequired(connection domain.UserEmailConnection) {
	if strings.TrimSpace(connection.Scope) == "shared" {
		companyID := strings.TrimSpace(connection.CompanyID)
		connectionID := strings.TrimSpace(connection.CompanyEmailConnectionID)
		if companyID != "" && connectionID != "" {
			_, _ = s.repo.UpdateCompanyEmailConnectionStatus(companyID, connectionID, "reauth_required")
		}
		return
	}
	_, _ = s.repo.UpdateUserEmailConnectionStatus(connection.UserID, connection.AccountEmail, "reauth_required")
}

const (
	communicationsNylasDefaultMessageLimit   = 12
	communicationsNylasMaxMessageLimit       = 12
	communicationsNylasMinRequestInterval    = 200 * time.Millisecond
	communicationsNylasMaxInFlightPerGrant   = 2
	communicationsArchiveBatchConcurrency    = 4
	communicationsAttachmentMaxTotalBytes    = 24_000_000
	communicationsAttachmentDownloadMaxBytes = 32_000_000
)

func communicationsConnectionCacheScope(connection domain.UserEmailConnection) string {
	if grantID := strings.TrimSpace(connection.GrantID); grantID != "" {
		return "grant:" + grantID
	}
	if accountEmail := normalizeEmailForCompare(connection.AccountEmail); accountEmail != "" {
		return "account:" + accountEmail
	}
	if provider := strings.TrimSpace(connection.Provider); provider != "" {
		return "provider:" + provider
	}
	return "default"
}

func findNylasAttachmentByID(attachments []NylasAttachment, attachmentID string) (NylasAttachment, bool) {
	attachmentID = strings.TrimSpace(attachmentID)
	if attachmentID == "" {
		return NylasAttachment{}, false
	}
	for _, attachment := range attachments {
		if strings.TrimSpace(attachment.ID) == attachmentID || strings.TrimSpace(attachment.AttachmentID) == attachmentID {
			return attachment, true
		}
	}
	return NylasAttachment{}, false
}

func (s *Server) communicationsFolders(ctx context.Context, connection domain.UserEmailConnection) ([]NylasFolder, error) {
	now := time.Now().UTC()
	cacheScope := communicationsConnectionCacheScope(connection)
	if folders, ok := s.commCache.getFolders(connection.UserID, cacheScope, communicationsFoldersCacheTTL, now); ok {
		return folders, nil
	}
	var folders []NylasFolder
	err := s.withCommunicationsNylasGate(ctx, connection, func(ctx context.Context) error {
		if cached, ok := s.commCache.getFolders(connection.UserID, cacheScope, communicationsFoldersCacheTTL, time.Now().UTC()); ok {
			folders = cached
			return nil
		}
		var err error
		folders, err = s.nylasClient.ListFolders(ctx, connection.GrantID)
		return err
	})
	if err != nil {
		if shouldServeStaleCommunicationsCache(err) {
			if cached, ok := s.commCache.getFolders(connection.UserID, cacheScope, communicationsFoldersCacheTTL+communicationsMaxStaleTTL, now); ok {
				return cached, nil
			}
		}
		return nil, err
	}
	s.commCache.setFolders(connection.UserID, cacheScope, folders, now)
	return folders, nil
}

func (s *Server) communicationsMessagePage(ctx context.Context, connection domain.UserEmailConnection, query NylasMessageQuery) (NylasMessagePage, error) {
	now := time.Now().UTC()
	cacheScope := communicationsConnectionCacheScope(connection)
	cacheQuery := query
	cacheQuery.Refresh = false
	if !query.Refresh {
		if page, ok := s.commCache.getMessagePage(connection.UserID, cacheScope, cacheQuery, communicationsMessagesCacheTTL, now); ok {
			return s.enrichCommunicationsMessagePageForConnection(connection, query.CompanyID, page), nil
		}
	}
	flightKey := communicationsMessagePageCacheKey(connection.UserID, cacheScope, cacheQuery) + communicationsCacheKeySeparator + strconv.FormatBool(query.Refresh)
	resultChannel := s.communicationsMessagePageFlights.DoChan(flightKey, func() (any, error) {
		flightNow := time.Now().UTC()
		if !query.Refresh {
			if cached, ok := s.commCache.getMessagePage(connection.UserID, cacheScope, cacheQuery, communicationsMessagesCacheTTL, flightNow); ok {
				return cached, nil
			}
		}
		var page NylasMessagePage
		err := s.withCommunicationsNylasGate(ctx, connection, func(ctx context.Context) error {
			var err error
			page, err = s.nylasClient.ListMessages(ctx, connection.GrantID, query)
			return err
		})
		if err != nil {
			if shouldServeStaleCommunicationsCache(err) {
				if cached, ok := s.commCache.getMessagePage(connection.UserID, cacheScope, cacheQuery, communicationsMessagesCacheTTL+communicationsMaxStaleTTL, flightNow); ok {
					return cached, nil
				}
			}
			return NylasMessagePage{}, err
		}
		s.commCache.setMessagePage(connection.UserID, cacheScope, cacheQuery, page, time.Now().UTC())
		return page, nil
	})
	select {
	case <-ctx.Done():
		return NylasMessagePage{}, ctx.Err()
	case result := <-resultChannel:
		if result.Err != nil {
			return NylasMessagePage{}, result.Err
		}
		page, ok := result.Val.(NylasMessagePage)
		if !ok {
			return NylasMessagePage{}, errors.New("invalid communications message page flight result")
		}
		return s.enrichCommunicationsMessagePageForConnection(connection, query.CompanyID, page), nil
	}
}

func (s *Server) communicationsMessage(ctx context.Context, connection domain.UserEmailConnection, messageID string) (NylasMessage, error) {
	now := time.Now().UTC()
	cacheScope := communicationsConnectionCacheScope(connection)
	if message, ok := s.commCache.getMessage(connection.UserID, cacheScope, messageID, communicationsMessageCacheTTL, now); ok {
		if !messageNeedsRawMIMEAttachmentRecovery(message) {
			return s.enrichCommunicationsMessageReadStatus(connection, message), nil
		}
	}
	flightKey := communicationsMessageCacheKey(connection.UserID, cacheScope, messageID)
	resultChannel := s.communicationsMessageFlights.DoChan(flightKey, func() (any, error) {
		flightNow := time.Now().UTC()
		if cached, ok := s.commCache.getMessage(connection.UserID, cacheScope, messageID, communicationsMessageCacheTTL, flightNow); ok {
			if messageNeedsRawMIMEAttachmentRecovery(cached) {
				_ = s.withCommunicationsNylasGate(ctx, connection, func(ctx context.Context) error {
					cached = s.recoverCommunicationsMessageRawMIMEAttachments(ctx, connection, cacheScope, cached, time.Now().UTC())
					return nil
				})
			}
			return cached, nil
		}
		var message NylasMessage
		err := s.withCommunicationsNylasGate(ctx, connection, func(ctx context.Context) error {
			var err error
			message, err = s.nylasClient.GetMessage(ctx, connection.GrantID, messageID)
			if err != nil {
				return err
			}
			message = s.attachRawMIMEAttachmentsIfMissing(ctx, connection, message)
			return nil
		})
		if err != nil {
			if shouldServeStaleCommunicationsCache(err) {
				if cached, ok := s.commCache.getMessage(connection.UserID, cacheScope, messageID, communicationsMessageCacheTTL+communicationsMaxStaleTTL, flightNow); ok {
					return cached, nil
				}
			}
			return NylasMessage{}, err
		}
		s.commCache.setMessage(connection.UserID, cacheScope, message, time.Now().UTC())
		return message, nil
	})
	select {
	case <-ctx.Done():
		return NylasMessage{}, ctx.Err()
	case result := <-resultChannel:
		if result.Err != nil {
			return NylasMessage{}, result.Err
		}
		message, ok := result.Val.(NylasMessage)
		if !ok {
			return NylasMessage{}, errors.New("invalid communications message flight result")
		}
		return s.enrichCommunicationsMessageReadStatus(connection, message), nil
	}
}

func (s *Server) recoverCommunicationsMessageRawMIMEAttachments(ctx context.Context, connection domain.UserEmailConnection, cacheScope string, message NylasMessage, now time.Time) NylasMessage {
	if !messageNeedsRawMIMEAttachmentRecovery(message) {
		return message
	}
	recovered := s.attachRawMIMEAttachmentsIfMissing(ctx, connection, message)
	if len(recovered.Attachments) != len(message.Attachments) || !messageNeedsRawMIMEAttachmentRecovery(recovered) {
		s.commCache.setMessage(connection.UserID, cacheScope, recovered, now)
	}
	return recovered
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

func (s *Server) enrichCommunicationsMessagePage(userID, companyID string, page NylasMessagePage) NylasMessagePage {
	page = cloneNylasMessagePage(page)
	page.Messages = s.enrichCommunicationsMessagesPlacements(userID, companyID, page.Messages)
	return page
}

func (s *Server) enrichCommunicationsMessagePageForConnection(connection domain.UserEmailConnection, companyID string, page NylasMessagePage) NylasMessagePage {
	page = cloneNylasMessagePage(page)
	page.Messages = s.enrichCommunicationsMessagesReadStatuses(connection, page.Messages)
	page.Messages = s.enrichCommunicationsMessagesPlacements(connection.UserID, companyID, page.Messages)
	return page
}

func (s *Server) enrichCommunicationsMessageReadStatus(connection domain.UserEmailConnection, message NylasMessage) NylasMessage {
	messages := s.enrichCommunicationsMessagesReadStatuses(connection, []NylasMessage{message})
	if len(messages) == 0 {
		return message
	}
	return messages[0]
}

func (s *Server) enrichCommunicationsMessagesReadStatuses(connection domain.UserEmailConnection, messages []NylasMessage) []NylasMessage {
	if s == nil || s.repo == nil || len(messages) == 0 {
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
	statuses, err := s.repo.ListCommunicationsMessageReadStatuses(store.CommunicationsMessageReadStatusListInput{
		ScopeType:                communicationsMessageReadStatusScopeTypeForConnection(connection),
		UserID:                   connection.UserID,
		CompanyID:                connection.CompanyID,
		CompanyEmailConnectionID: connection.CompanyEmailConnectionID,
		MessageIDs:               messageIDs,
	})
	if err != nil {
		log.Printf("failed to load communications message read statuses user_id=%s scope=%s company_id=%s company_email_connection_id=%s message_count=%d: %v", connection.UserID, communicationsMessageReadStatusScopeTypeForConnection(connection), connection.CompanyID, connection.CompanyEmailConnectionID, len(messageIDs), err)
		return messages
	}
	readStatusByMessageID := make(map[string]domain.CommunicationsMessageReadStatus, len(statuses))
	for _, status := range statuses {
		messageID := strings.TrimSpace(status.MessageID)
		if messageID != "" {
			readStatusByMessageID[messageID] = status
		}
	}
	for i := range messages {
		status, ok := readStatusByMessageID[strings.TrimSpace(messages[i].ID)]
		if !ok {
			messages[i].ReadStatus = nil
			continue
		}
		messages[i].ReadStatus = &status
	}
	return messages
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
		if key != "limit" && key != "page_token" && key != "folder_id" && key != "thread_id" && key != "q" && key != "mailbox" && key != "unread" && key != "company_id" && key != "shared_inbox_id" && key != "refresh" {
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
		ThreadID:      strings.TrimSpace(r.URL.Query().Get("thread_id")),
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
			query.SearchQueryNative = gmailStarredSearch(query.Query, query.Unread)
			query.Query = ""
			query.Unread = nil
			query.Starred = nil
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
	case "spam":
		if connection.Provider == "google" {
			query.SearchQueryNative = gmailSpamSearch(query.Query, query.Unread)
			query.Query = ""
			query.Unread = nil
			query.FolderID = ""
			return query, nil
		}
		return s.applySpamFolderMailbox(ctx, connection, query)
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

func (s *Server) applySpamFolderMailbox(ctx context.Context, connection domain.UserEmailConnection, query NylasMessageQuery) (NylasMessageQuery, error) {
	if strings.TrimSpace(query.FolderID) != "" {
		return query, nil
	}
	folders, err := s.communicationsFolders(ctx, connection)
	if err != nil {
		return NylasMessageQuery{}, err
	}
	folderID := findNylasSystemFolderID(folders, "spam")
	if folderID == "" {
		folderID = findNylasSystemFolderID(folders, "junk")
	}
	if folderID == "" {
		return NylasMessageQuery{}, errInvalidCommunicationsMailbox
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

func gmailStarredSearch(userQuery string, unread *bool) string {
	return gmailSearch([]string{"is:starred"}, userQuery, unread)
}

func gmailPrimarySearch(userQuery string, unread *bool) string {
	return gmailSearch([]string{"in:inbox", "-category:social", "-category:promotions"}, userQuery, unread)
}

func gmailArchiveSearch(userQuery string, unread *bool) string {
	return gmailSearch([]string{"in:anywhere", "-in:inbox", "-in:trash", "-in:spam", "-in:sent", "-in:drafts"}, userQuery, unread)
}

func gmailSpamSearch(userQuery string, unread *bool) string {
	return gmailSearch([]string{"in:spam"}, userQuery, unread)
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
	case "spam", "junk":
		return "spam"
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
		"scope":             connection.Scope,
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

type communicationsInlineImageReference struct {
	AttachmentID string
	ContentID    string
}

func prepareCommunicationsInlineImageAttachments(body string, items []NylasAttachment) (string, []NylasAttachment) {
	references := make([]communicationsInlineImageReference, 0)
	seenAttachmentIDs := make(map[string]struct{})
	rewrittenBody := mangoEditorAttachmentImageSourceRE.ReplaceAllStringFunc(body, func(match string) string {
		parts := mangoEditorAttachmentImageSourceRE.FindStringSubmatch(match)
		if len(parts) != 5 {
			return match
		}
		encodedAttachmentID := parts[3]
		if encodedAttachmentID == "" {
			encodedAttachmentID = parts[4]
		}
		attachmentID, err := url.PathUnescape(strings.TrimSpace(encodedAttachmentID))
		if err != nil {
			attachmentID = strings.TrimSpace(encodedAttachmentID)
		}
		attachmentID = strings.TrimSpace(attachmentID)
		if attachmentID == "" {
			return match
		}
		contentID := communicationsInlineImageContentID(attachmentID)
		if _, exists := seenAttachmentIDs[attachmentID]; !exists {
			seenAttachmentIDs[attachmentID] = struct{}{}
			references = append(references, communicationsInlineImageReference{AttachmentID: attachmentID, ContentID: contentID})
		}
		if parts[2] != "" {
			return parts[1] + parts[2] + "cid:" + contentID + parts[2]
		}
		return parts[1] + `"cid:` + contentID + `"`
	})
	if len(references) == 0 {
		return body, items
	}

	prepared := append([]NylasAttachment(nil), items...)
	itemIndexByAttachmentID := make(map[string]int, len(prepared))
	for index, item := range prepared {
		attachmentID := strings.TrimSpace(item.AttachmentID)
		if attachmentID == "" {
			attachmentID = strings.TrimSpace(item.ID)
		}
		if attachmentID != "" {
			itemIndexByAttachmentID[attachmentID] = index
		}
	}
	for _, reference := range references {
		if index, exists := itemIndexByAttachmentID[reference.AttachmentID]; exists {
			prepared[index].ContentID = reference.ContentID
			prepared[index].ContentDisposition = "inline"
			prepared[index].IsInline = true
			continue
		}
		itemIndexByAttachmentID[reference.AttachmentID] = len(prepared)
		prepared = append(prepared, NylasAttachment{
			AttachmentID:       reference.AttachmentID,
			ContentID:          reference.ContentID,
			ContentDisposition: "inline",
			IsInline:           true,
		})
	}
	return rewrittenBody, prepared
}

func communicationsInlineImageContentID(attachmentID string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(attachmentID)))
	return "mango" + hex.EncodeToString(digest[:12])
}

func (s *Server) resolveCommunicationsSendAttachments(w http.ResponseWriter, r *http.Request, companyID string, items []NylasAttachment) ([]NylasAttachment, bool) {
	if len(items) == 0 {
		return nil, true
	}
	if s.attachmentStorage == nil {
		writeError(w, http.StatusServiceUnavailable, "attachment_storage_unavailable")
		return nil, false
	}
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return nil, false
	}
	cleaned := make([]NylasAttachment, 0, len(items))
	var totalDecodedBytes int64
	for _, item := range items {
		attachmentID := strings.TrimSpace(item.AttachmentID)
		if attachmentID == "" {
			attachmentID = strings.TrimSpace(item.ID)
		}
		if strings.TrimSpace(item.Filename) == "" && attachmentID == "" {
			continue
		}
		if attachmentID == "" || strings.TrimSpace(item.Content) != "" {
			writeError(w, http.StatusBadRequest, "invalid_email_attachment")
			return nil, false
		}
		if !s.canSendAttachmentThroughResourceLink(w, r, companyID, attachmentID) {
			return nil, false
		}
		attachment, err := s.repo.GetAttachment(companyID, attachmentID)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_email_attachment")
			return nil, false
		}
		if errors.Is(err, store.ErrNotFound) {
			writeAccessResourceNotFound(w)
			return nil, false
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_attachment")
			return nil, false
		}
		variant, err := s.repo.GetAttachmentVariant(r.Context(), companyID, attachment.AttachmentID, store.AttachmentVariantOriginal)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_email_attachment")
			return nil, false
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "attachment_variant_not_found")
			return nil, false
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_attachment_variant")
			return nil, false
		}
		output, err := s.attachmentStorage.GetObject(r.Context(), AttachmentGetObjectInput{Key: variant.StorageKey})
		if err != nil {
			writeAttachmentStorageError(w, err)
			return nil, false
		}
		content, readErr := io.ReadAll(output.Body)
		_ = output.Body.Close()
		if readErr != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_read_attachment")
			return nil, false
		}
		totalDecodedBytes += int64(len(content))
		if totalDecodedBytes > communicationsAttachmentMaxTotalBytes {
			writeError(w, http.StatusBadRequest, "invalid_email_attachment")
			return nil, false
		}
		contentType := strings.TrimSpace(item.ContentType)
		if contentType == "" {
			contentType = strings.TrimSpace(output.ContentType)
		}
		if contentType == "" {
			contentType = strings.TrimSpace(variant.MimeType)
		}
		if contentType == "" {
			contentType = strings.TrimSpace(attachment.MimeType)
		}
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		filename := strings.TrimSpace(item.Filename)
		if filename == "" {
			filename = "attachment"
		}
		if filename == "attachment" && strings.TrimSpace(attachment.OriginalFilename) != "" {
			filename = attachment.OriginalFilename
		}
		cleaned = append(cleaned, NylasAttachment{
			ID:                 attachment.AttachmentID,
			AttachmentID:       attachment.AttachmentID,
			Filename:           filename,
			ContentType:        contentType,
			Content:            base64.StdEncoding.EncodeToString(content),
			ContentID:          strings.TrimSpace(item.ContentID),
			ContentDisposition: strings.TrimSpace(item.ContentDisposition),
			IsInline:           item.IsInline,
			Size:               int64(len(content)),
		})
	}
	return cleaned, true
}

func (s *Server) canSendAttachmentThroughResourceLink(w http.ResponseWriter, r *http.Request, companyID, attachmentID string) bool {
	links, err := s.repo.ListAttachmentResourceLinks(companyID, attachmentID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_email_attachment")
		return false
	}
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_attachment_links")
		return false
	}
	for _, link := range links {
		allowed, err := s.canViewAttachmentResource(r, companyID, link.ResourceType, link.ResourceID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_check_attachment_permission")
			return false
		}
		if allowed {
			return true
		}
	}
	writeAccessResourceNotFound(w)
	return false
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

func (s *Server) redirectCommunicationsSuccess(w http.ResponseWriter, r *http.Request, connection domain.UserEmailConnection, sharedInboxID string) {
	target := s.communicationsRedirectURL()
	query := target.Query()
	query.Set("nylas", "connected")
	if strings.TrimSpace(connection.Scope) != "" {
		query.Set("nylas_scope", strings.TrimSpace(connection.Scope))
	}
	if strings.TrimSpace(connection.AccountEmail) != "" {
		query.Set("nylas_account_email", normalizeEmailForCompare(connection.AccountEmail))
	}
	if strings.TrimSpace(sharedInboxID) != "" {
		query.Set("nylas_shared_inbox_id", strings.TrimSpace(sharedInboxID))
	}
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
