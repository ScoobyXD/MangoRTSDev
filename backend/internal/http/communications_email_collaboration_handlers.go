package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type communicationsEmailCollaborationRequest struct {
	CompanyID     string                      `json:"company_id"`
	SharedInboxID string                      `json:"shared_inbox_id"`
	AccountEmail  string                      `json:"account_email"`
	Message       domain.EmailMessageSnapshot `json:"message"`
}

func (s *Server) handleCommunicationsEmailCollaborations(w http.ResponseWriter, r *http.Request) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if actorRoleForCompany(actor, companyID) == "" {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return
		}
		messageID := strings.TrimSpace(r.URL.Query().Get("message_id"))
		threadID := strings.TrimSpace(r.URL.Query().Get("thread_id"))
		if messageID == "" && threadID == "" {
			items, err := s.repo.ListCommunicationsEmailCollaborations(companyID, actor.User.UserID)
			if err != nil {
				s.writeEmailCollaborationStoreError(w, err, "failed_to_list_email_collaborations")
				return
			}
			writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"collaborations": items})
			return
		}
		scope, ok := s.resolveCommunicationsEmailScope(w, actor, companyID, r.URL.Query().Get("shared_inbox_id"), r.URL.Query().Get("account_email"), store.EntityPermissionView)
		if !ok {
			return
		}
		item, err := s.repo.ResolveCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationResolveInput{
			CompanyID: companyID, ParticipantUserID: actor.User.UserID,
			PersonalUserID: scope.personalUserID, PersonalAccountEmail: scope.personalAccountEmail,
			SharedInboxID: scope.sharedInboxID, MessageID: messageID, ThreadID: threadID,
		})
		if err != nil {
			s.writeEmailCollaborationStoreError(w, err, "failed_to_resolve_email_collaboration")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"collaboration": item})
	case http.MethodPost:
		var req communicationsEmailCollaborationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		if req.CompanyID == "" || strings.TrimSpace(req.Message.ID) == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_message_required")
			return
		}
		scope, ok := s.resolveCommunicationsEmailScope(w, actor, req.CompanyID, req.SharedInboxID, req.AccountEmail, store.EntityPermissionEdit)
		if !ok {
			return
		}
		// Creation is a durable sharing boundary: the browser identifies the
		// provider message, but it is never authoritative for the content that
		// will be exposed to future collaboration participants.
		if s.nylasClient == nil || !s.nylasConfig.IsConfigured() {
			writeError(w, http.StatusServiceUnavailable, "nylas_not_configured")
			return
		}
		connection, ok := s.resolveEmailCollaborationCreationSourceConnection(w, actor.User.UserID, req.CompanyID, scope)
		if !ok {
			return
		}
		requestedMessageID := strings.TrimSpace(req.Message.ID)
		requestedThreadID := strings.TrimSpace(req.Message.ThreadID)
		var providerMessage NylasMessage
		if err := s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
			var fetchErr error
			providerMessage, fetchErr = s.nylasClient.GetMessage(ctx, connection.GrantID, requestedMessageID)
			return fetchErr
		}); err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
		if strings.TrimSpace(providerMessage.ID) != requestedMessageID ||
			(requestedThreadID != "" && strings.TrimSpace(providerMessage.ThreadID) != requestedThreadID) {
			writeError(w, http.StatusConflict, "email_provider_message_mismatch")
			return
		}
		providerSnapshot := emailMessageSnapshotFromNylas(providerMessage)
		result, err := s.repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
			CompanyID: req.CompanyID, PersonalUserID: scope.personalUserID,
			PersonalAccountEmail: scope.personalAccountEmail, SharedInboxID: scope.sharedInboxID,
			AccountEmail: scope.accountEmail, CreatedByUserID: actor.User.UserID, Message: providerSnapshot,
		})
		if err != nil {
			scopeType := "personal"
			if strings.TrimSpace(scope.sharedInboxID) != "" {
				scopeType = "shared"
			}
			stage := store.EmailCollaborationEnsureErrorStage(err)
			if stage == "" {
				stage = "unknown"
			}
			log.Printf(
				"email_collaboration_create outcome=error request_id=%s company_id=%s actor_user_id=%s scope=%s stage=%s sqlstate=%s error_category=%s",
				requestCorrelationID(r), req.CompanyID, actor.User.UserID, scopeType, stage, store.EmailCollaborationEnsureErrorSQLState(err), store.EmailCollaborationEnsureErrorCategory(err),
			)
			s.writeEmailCollaborationStoreError(w, err, "failed_to_create_email_collaboration")
			return
		}
		status := http.StatusOK
		if result.Created {
			status = http.StatusCreated
			s.publishWorkspaceEvent(req.CompanyID, "node_created", map[string]any{"node_id": result.Collaboration.NodeID, "email_collaboration_id": result.Collaboration.CollaborationID})
		}
		writeJSON(w, status, result)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) resolveEmailCollaborationCreationSourceConnection(w http.ResponseWriter, actorUserID, companyID string, scope resolvedCommunicationsEmailScope) (domain.UserEmailConnection, bool) {
	if strings.TrimSpace(scope.sharedInboxID) == "" {
		connection, ok := s.resolveActorPersonalEmailConnection(w, scope.personalUserID, scope.personalAccountEmail)
		if !ok {
			return domain.UserEmailConnection{}, false
		}
		return requireConnectedEmailStatus(w, connection)
	}

	connection, err := s.repo.GetCompanyEmailConnectionByAccountEmail(companyID, scope.accountEmail)
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
	return requireConnectedCompanyEmailStatus(w, connection, actorUserID)
}

func (s *Server) handleCommunicationsEmailCollaborationByID(w http.ResponseWriter, r *http.Request) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/communications/email-collaborations/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	collaborationID := strings.TrimSpace(parts[0])
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if r.Method == http.MethodPost && len(parts) == 4 && parts[1] == "drafts" && parts[3] == "send" {
		s.handleCommunicationsEmailCollaborationDraftSend(w, r, actor, companyID, collaborationID, strings.TrimSpace(parts[2]))
		return
	}
	if len(parts) == 2 && parts[1] == "participants" {
		// Participation is a permanent side effect of an accepted chat mention,
		// never a standalone grant operation.
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return
	}
	item, err := s.repo.GetCommunicationsEmailCollaboration(companyID, collaborationID, actor.User.UserID)
	if err != nil {
		s.writeEmailCollaborationStoreError(w, err, "failed_to_load_email_collaboration")
		return
	}
	if len(parts) == 1 {
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"collaboration": item})
		return
	}
	if len(parts) == 2 && parts[1] == "thread" {
		providerMessages, historyComplete := s.loadCommunicationsEmailCollaborationThread(r.Context(), item, actor.User.UserID)
		if historyComplete {
			writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
				"collaboration_id": item.CollaborationID,
				"thread_id":        item.ProviderThreadID,
				"messages":         providerMessages,
				"history_complete": true,
			})
			return
		}
		// The durable latest snapshot remains available when the immutable
		// source mailbox or provider cannot currently serve the full history.
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"collaboration_id": item.CollaborationID,
			"thread_id":        item.ProviderThreadID,
			"messages":         []domain.EmailMessageSnapshot{item.Message},
			"history_complete": false,
		})
		return
	}
	writeError(w, http.StatusNotFound, "not_found")
}

func (s *Server) writeEmailCollaborationStoreError(w http.ResponseWriter, err error, internalCode string) {
	switch {
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_email_collaboration")
	case errors.Is(err, store.ErrPrincipalNotInCompany):
		writeError(w, http.StatusBadRequest, "email_collaboration_principal_not_in_company")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "email_collaboration_not_found")
	case store.IsEmailCollaborationStorageNotReady(err):
		writeError(w, http.StatusServiceUnavailable, "email_collaboration_storage_not_ready")
	default:
		writeError(w, http.StatusInternalServerError, internalCode)
	}
}
