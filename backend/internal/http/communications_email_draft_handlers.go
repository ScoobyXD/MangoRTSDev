package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"

	"strings"
	"time"
)

type communicationsEmailDraftRequest struct {
	CompanyID              string          `json:"company_id"`
	DraftID                string          `json:"draft_id"`
	SharedInboxID          string          `json:"shared_inbox_id"`
	AccountEmail           string          `json:"account_email"`
	SenderAccountEmail     string          `json:"sender_account_email"`
	Kind                   string          `json:"kind"`
	SourceMessageID        string          `json:"source_message_id"`
	ReplyToMessageID       string          `json:"reply_to_message_id"`
	ToRecipients           string          `json:"to_recipients"`
	CcRecipients           string          `json:"cc_recipients"`
	BccRecipients          string          `json:"bcc_recipients"`
	Subject                string          `json:"subject"`
	BodyEditorHTML         string          `json:"body_editor_html"`
	ReplyToMessage         json.RawMessage `json:"reply_to_message"`
	ScheduledSendTimestamp string          `json:"scheduled_send_timestamp"`
}

type communicationsEmailSignatureRequest struct {
	CompanyID      string `json:"company_id"`
	SharedInboxID  string `json:"shared_inbox_id"`
	AccountEmail   string `json:"account_email"`
	Name           string `json:"name"`
	BodyEditorHTML string `json:"body_editor_html"`
	IsDefault      *bool  `json:"is_default"`
}

type communicationsEmailDraftResponse struct {
	CompanyID              string                      `json:"company_id"`
	DraftID                string                      `json:"draft_id"`
	ScopeType              string                      `json:"scope_type"`
	PersonalUserID         string                      `json:"personal_user_id,omitempty"`
	PersonalAccountEmail   string                      `json:"personal_account_email,omitempty"`
	SharedInboxID          string                      `json:"shared_inbox_id,omitempty"`
	Kind                   string                      `json:"kind"`
	SourceMessageID        string                      `json:"source_message_id,omitempty"`
	CreatedByUserID        string                      `json:"created_by_user_id,omitempty"`
	UpdatedByUserID        string                      `json:"updated_by_user_id,omitempty"`
	AccountEmail           string                      `json:"account_email,omitempty"`
	ToRecipients           string                      `json:"to_recipients"`
	CcRecipients           string                      `json:"cc_recipients"`
	BccRecipients          string                      `json:"bcc_recipients"`
	Subject                string                      `json:"subject"`
	BodyEditorHTML         string                      `json:"body_editor_html"`
	ReplyToMessage         json.RawMessage             `json:"reply_to_message,omitempty"`
	ScheduledSendTimestamp *time.Time                  `json:"scheduled_send_timestamp,omitempty"`
	CreatedTimestamp       time.Time                   `json:"created_timestamp"`
	UpdatedTimestamp       time.Time                   `json:"updated_timestamp"`
	Attachments            []domain.ResourceAttachment `json:"attachments"`
}

func (s *Server) handleCommunicationsEmailDrafts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleCommunicationsEmailDraftList(w, r)
	case http.MethodPost:
		s.handleCommunicationsEmailDraftUpsert(w, r, "")
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleCommunicationsEmailDraftByID(w http.ResponseWriter, r *http.Request) {
	draftID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/communications/drafts/"), "/")
	if draftID == "" || strings.Contains(draftID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleCommunicationsEmailDraftGet(w, r, draftID)
	case http.MethodPut:
		s.handleCommunicationsEmailDraftUpsert(w, r, draftID)
	case http.MethodDelete:
		s.handleCommunicationsEmailDraftDelete(w, r, draftID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleCommunicationsEmailDraftList(w http.ResponseWriter, r *http.Request) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !requireCompanyAccess(w, r, companyID) {
		return
	}
	sharedInboxID := r.URL.Query().Get("shared_inbox_id")
	accountEmail := r.URL.Query().Get("account_email")
	scope, ok := s.resolveCommunicationsEmailDraftScope(w, actor, companyID, sharedInboxID, accountEmail, store.EntityPermissionEdit)
	if !ok {
		return
	}
	listInput := scope.draftListInput(companyID)
	listInput.ParticipantUserID = actor.User.UserID
	drafts, err := s.repo.ListCommunicationsEmailDrafts(listInput)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_email_draft_scope")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_email_drafts")
		return
	}
	responses := make([]communicationsEmailDraftResponse, 0, len(drafts))
	for _, draft := range drafts {
		responses = append(responses, communicationsEmailDraftSummaryResponse(draft))
	}
	writeJSON(w, http.StatusOK, map[string]any{"drafts": responses})
}

func (s *Server) handleCommunicationsEmailDraftGet(w http.ResponseWriter, r *http.Request, draftID string) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !requireCompanyAccess(w, r, companyID) {
		return
	}
	sharedInboxID := r.URL.Query().Get("shared_inbox_id")
	accountEmail := r.URL.Query().Get("account_email")
	scope, ok := s.resolveCommunicationsEmailDraftScope(w, actor, companyID, sharedInboxID, accountEmail, store.EntityPermissionEdit)
	if !ok {
		return
	}
	getInput := scope.draftGetInput(companyID, draftID)
	getInput.ParticipantUserID = actor.User.UserID
	draft, err := s.repo.GetCommunicationsEmailDraft(getInput)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_email_draft")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "email_draft_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_email_draft")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"draft": s.communicationsEmailDraftResponse(draft)})
}

func (s *Server) handleCommunicationsEmailDraftUpsert(w http.ResponseWriter, r *http.Request, pathDraftID string) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req communicationsEmailDraftRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if rejectDurableInlineFileBytes(w, "communications_email_draft", req.BodyEditorHTML) {
		return
	}
	companyID := strings.TrimSpace(req.CompanyID)
	draftID := strings.TrimSpace(firstNonBlank(pathDraftID, req.DraftID))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if draftID == "" {
		writeError(w, http.StatusBadRequest, "draft_id_required")
		return
	}
	scope, ok := s.resolveCommunicationsEmailDraftScope(w, actor, companyID, req.SharedInboxID, req.AccountEmail, store.EntityPermissionEdit)
	if !ok {
		return
	}
	scheduledAt, ok := parseCommunicationsOptionalTimestamp(w, req.ScheduledSendTimestamp)
	if !ok {
		return
	}
	replyToJSON := "{}"
	if len(req.ReplyToMessage) > 0 && string(req.ReplyToMessage) != "null" {
		if !json.Valid(req.ReplyToMessage) {
			writeError(w, http.StatusBadRequest, "invalid_reply_to_message")
			return
		}
		replyToJSON = string(req.ReplyToMessage)
	}
	sourceMessageID := strings.TrimSpace(req.SourceMessageID)
	draft, err := s.repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID:              companyID,
		DraftID:                draftID,
		PersonalUserID:         scope.personalUserID,
		PersonalAccountEmail:   scope.personalAccountEmail,
		SharedInboxID:          scope.sharedInboxID,
		CreatedByUserID:        actor.User.UserID,
		UpdatedByUserID:        actor.User.UserID,
		Kind:                   firstNonBlank(req.Kind, communicationsEmailDraftKindFromID(draftID)),
		SourceMessageID:        sourceMessageID,
		AccountEmail:           firstNonBlank(req.SenderAccountEmail, scope.accountEmail),
		ToRecipients:           req.ToRecipients,
		CcRecipients:           req.CcRecipients,
		BccRecipients:          req.BccRecipients,
		Subject:                req.Subject,
		BodyEditorHTML:         req.BodyEditorHTML,
		ReplyToMessageJSON:     replyToJSON,
		ScheduledSendTimestamp: scheduledAt,
	})
	if errors.Is(err, store.ErrEmailReplySourceNotIngested) {
		writeError(w, http.StatusConflict, "email_reply_source_not_ingested")
		return
	}
	if errors.Is(err, store.ErrEmailDraftSourceNotFound) {
		writeError(w, http.StatusConflict, "email_draft_source_not_found")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_email_draft")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "email_draft_not_found")
		return
	}
	if errors.Is(err, store.ErrAlreadyExists) {
		writeError(w, http.StatusNotFound, "email_draft_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_save_email_draft")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"draft": s.communicationsEmailDraftResponse(draft)})
}

func (s *Server) handleCommunicationsEmailDraftDelete(w http.ResponseWriter, r *http.Request, draftID string) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !requireCompanyAccess(w, r, companyID) {
		return
	}
	sharedInboxID := r.URL.Query().Get("shared_inbox_id")
	accountEmail := r.URL.Query().Get("account_email")
	scope, ok := s.resolveCommunicationsEmailDraftScope(w, actor, companyID, sharedInboxID, accountEmail, store.EntityPermissionEdit)
	if !ok {
		return
	}
	deleteInput := store.CommunicationsEmailDraftDeleteInput{
		CompanyID:            companyID,
		DraftID:              draftID,
		ParticipantUserID:    actor.User.UserID,
		UpdatedByUserID:      actor.User.UserID,
		PersonalUserID:       scope.personalUserID,
		PersonalAccountEmail: scope.personalAccountEmail,
		SharedInboxID:        scope.sharedInboxID,
	}
	if err := s.repo.SoftDeleteCommunicationsEmailDraft(deleteInput); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "email_draft_not_found")
		return
	} else if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_email_draft")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_email_draft")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}

func (s *Server) handleCommunicationsEmailSignature(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleCommunicationsEmailSignatureGet(w, r)
	case http.MethodPut, http.MethodPost:
		s.handleCommunicationsEmailSignatureUpsert(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleCommunicationsEmailSignatureGet(w http.ResponseWriter, r *http.Request) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	scope, ok := s.resolveCommunicationsEmailScope(w, actor, companyID, r.URL.Query().Get("shared_inbox_id"), r.URL.Query().Get("account_email"), store.EntityPermissionEdit)
	if !ok {
		return
	}
	signature, err := s.repo.GetCommunicationsEmailSignature(scope.signatureScopeInput(companyID))
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"signature": nil})
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_email_signature")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_email_signature")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"signature": signature})
}

func (s *Server) handleCommunicationsEmailSignatureUpsert(w http.ResponseWriter, r *http.Request) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req communicationsEmailSignatureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if rejectDurableInlineFileBytes(w, "communications_email_signature", req.BodyEditorHTML) {
		return
	}
	companyID := strings.TrimSpace(req.CompanyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	scope, ok := s.resolveCommunicationsEmailScope(w, actor, companyID, req.SharedInboxID, req.AccountEmail, store.EntityPermissionEdit)
	if !ok {
		return
	}
	isDefault := true
	if req.IsDefault != nil {
		isDefault = *req.IsDefault
	}
	signature, err := s.repo.UpsertCommunicationsEmailSignature(store.CommunicationsEmailSignatureInput{
		CompanyID:            companyID,
		PersonalUserID:       scope.personalUserID,
		PersonalAccountEmail: scope.personalAccountEmail,
		SharedInboxID:        scope.sharedInboxID,
		Name:                 req.Name,
		BodyEditorHTML:       req.BodyEditorHTML,
		IsDefault:            isDefault,
		CreatedByUserID:      actor.User.UserID,
		UpdatedByUserID:      actor.User.UserID,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_email_signature")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusConflict, "email_signature_connection_not_available")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_save_email_signature")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"signature": signature})
}

type resolvedCommunicationsEmailScope struct {
	personalUserID       string
	personalAccountEmail string
	sharedInboxID        string
	accountEmail         string
}

func (scope resolvedCommunicationsEmailScope) signatureScopeInput(companyID string) store.CommunicationsEmailSignatureScopeInput {
	return store.CommunicationsEmailSignatureScopeInput{
		CompanyID:            companyID,
		PersonalUserID:       scope.personalUserID,
		PersonalAccountEmail: scope.personalAccountEmail,
		SharedInboxID:        scope.sharedInboxID,
	}
}

func (scope resolvedCommunicationsEmailScope) draftListInput(companyID string) store.CommunicationsEmailDraftListInput {
	return store.CommunicationsEmailDraftListInput{
		CompanyID:            companyID,
		PersonalUserID:       scope.personalUserID,
		PersonalAccountEmail: scope.personalAccountEmail,
		SharedInboxID:        scope.sharedInboxID,
	}
}

func (scope resolvedCommunicationsEmailScope) draftGetInput(companyID, draftID string) store.CommunicationsEmailDraftGetInput {
	return store.CommunicationsEmailDraftGetInput{
		CompanyID:            companyID,
		DraftID:              draftID,
		PersonalUserID:       scope.personalUserID,
		PersonalAccountEmail: scope.personalAccountEmail,
		SharedInboxID:        scope.sharedInboxID,
	}
}

func (s *Server) resolveCommunicationsEmailDraftScope(w http.ResponseWriter, actor ActorContext, companyID, sharedInboxID, requestedAccountEmail, accessLevel string) (resolvedCommunicationsEmailScope, bool) {
	if strings.TrimSpace(sharedInboxID) == "" && normalizeEmailForCompare(requestedAccountEmail) == "" {
		writeError(w, http.StatusBadRequest, "email_account_required")
		return resolvedCommunicationsEmailScope{}, false
	}
	return s.resolveCommunicationsEmailScope(w, actor, companyID, sharedInboxID, requestedAccountEmail, accessLevel)
}

func (s *Server) resolveCommunicationsEmailScope(w http.ResponseWriter, actor ActorContext, companyID, sharedInboxID, requestedAccountEmail, accessLevel string) (resolvedCommunicationsEmailScope, bool) {
	companyID = strings.TrimSpace(companyID)
	sharedInboxID = strings.TrimSpace(sharedInboxID)
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return resolvedCommunicationsEmailScope{}, false
	}
	if sharedInboxID != "" {
		folder, ok := s.findVisibleSharedInboxFolder(w, actor, companyID, sharedInboxID, accessLevel)
		if !ok {
			return resolvedCommunicationsEmailScope{}, false
		}
		if store.CommunicationsSharedInboxResourceType(folder) != store.EntityTypeSharedInbox {
			writeError(w, http.StatusConflict, "shared_inbox_not_mailbox")
			return resolvedCommunicationsEmailScope{}, false
		}
		accountEmail := ""
		if folder.AccountEmail != nil {
			accountEmail = normalizeEmailForCompare(*folder.AccountEmail)
		}
		return resolvedCommunicationsEmailScope{
			sharedInboxID: sharedInboxID,
			accountEmail:  accountEmail,
		}, true
	}
	connection, ok := s.resolveActorPersonalEmailConnection(w, actor.User.UserID, requestedAccountEmail)
	if !ok {
		return resolvedCommunicationsEmailScope{}, false
	}
	return resolvedCommunicationsEmailScope{
		personalUserID:       actor.User.UserID,
		personalAccountEmail: normalizeEmailForCompare(connection.AccountEmail),
		accountEmail:         normalizeEmailForCompare(connection.AccountEmail),
	}, true
}

func (s *Server) resolveActorPersonalEmailConnection(w http.ResponseWriter, userID, requestedAccountEmail string) (domain.UserEmailConnection, bool) {
	connections, err := s.repo.ListUserEmailConnections(userID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusConflict, "nylas_not_connected")
		return domain.UserEmailConnection{}, false
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "user_id_required")
		return domain.UserEmailConnection{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_email_connection")
		return domain.UserEmailConnection{}, false
	}
	requested := normalizeEmailForCompare(requestedAccountEmail)
	for _, connection := range connections {
		if requested != "" && normalizeEmailForCompare(connection.AccountEmail) == requested {
			return connection, true
		}
	}
	if requested != "" {
		writeError(w, http.StatusConflict, "email_account_not_connected")
		return domain.UserEmailConnection{}, false
	}
	if len(connections) == 0 {
		writeError(w, http.StatusConflict, "nylas_not_connected")
		return domain.UserEmailConnection{}, false
	}
	return connections[0], true
}

func (s *Server) communicationsEmailDraftResponse(draft domain.CommunicationsEmailDraft) communicationsEmailDraftResponse {
	attachments, err := s.repo.ListResourceAttachments(draft.CompanyID, "email_draft", communicationsEmailDraftResourceID(draft))
	if err != nil {
		attachments = []domain.ResourceAttachment{}
	}
	replyToMessage := json.RawMessage(draft.ReplyToMessageJSON)
	if len(replyToMessage) == 0 || !json.Valid(replyToMessage) || string(replyToMessage) == "{}" {
		replyToMessage = nil
	}
	return communicationsEmailDraftResponse{
		CompanyID:              draft.CompanyID,
		DraftID:                draft.DraftID,
		ScopeType:              draft.ScopeType,
		PersonalUserID:         draft.PersonalUserID,
		PersonalAccountEmail:   draft.PersonalAccountEmail,
		SharedInboxID:          draft.SharedInboxID,
		CreatedByUserID:        draft.CreatedByUserID,
		UpdatedByUserID:        draft.UpdatedByUserID,
		Kind:                   draft.Kind,
		SourceMessageID:        draft.SourceMessageID,
		AccountEmail:           draft.AccountEmail,
		ToRecipients:           draft.ToRecipients,
		CcRecipients:           draft.CcRecipients,
		BccRecipients:          draft.BccRecipients,
		Subject:                draft.Subject,
		BodyEditorHTML:         draft.BodyEditorHTML,
		ReplyToMessage:         replyToMessage,
		ScheduledSendTimestamp: draft.ScheduledSendTimestamp,
		CreatedTimestamp:       draft.CreatedTimestamp,
		UpdatedTimestamp:       draft.UpdatedTimestamp,
		Attachments:            attachments,
	}
}

func communicationsEmailDraftSummaryResponse(draft domain.CommunicationsEmailDraft) communicationsEmailDraftResponse {
	return communicationsEmailDraftResponse{
		CompanyID: draft.CompanyID, DraftID: draft.DraftID, ScopeType: draft.ScopeType,
		PersonalUserID: draft.PersonalUserID, PersonalAccountEmail: draft.PersonalAccountEmail,
		SharedInboxID: draft.SharedInboxID, CreatedByUserID: draft.CreatedByUserID,
		UpdatedByUserID: draft.UpdatedByUserID, Kind: draft.Kind,
		SourceMessageID: draft.SourceMessageID, AccountEmail: draft.AccountEmail,
		ToRecipients: draft.ToRecipients, CcRecipients: draft.CcRecipients,
		BccRecipients: draft.BccRecipients, Subject: draft.Subject,
		ScheduledSendTimestamp: draft.ScheduledSendTimestamp,
		CreatedTimestamp:       draft.CreatedTimestamp, UpdatedTimestamp: draft.UpdatedTimestamp,
		Attachments: []domain.ResourceAttachment{},
	}
}

func communicationsEmailDraftResourceID(draft domain.CommunicationsEmailDraft) string {
	return strings.TrimSpace(draft.DraftID)
}
func communicationsEmailDraftKindFromID(draftID string) string {
	if strings.HasPrefix(strings.TrimSpace(draftID), "draft:reply:") {
		return "reply"
	}
	if strings.HasPrefix(strings.TrimSpace(draftID), "draft:forward:") {
		return "forward"
	}
	return "compose"
}

func parseCommunicationsOptionalTimestamp(w http.ResponseWriter, value string) (*time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, true
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04"} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			parsed = parsed.UTC()
			return &parsed, true
		}
	}
	writeError(w, http.StatusBadRequest, "invalid_scheduled_send_timestamp")
	return nil, false
}
