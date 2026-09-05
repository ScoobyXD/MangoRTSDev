package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type communicationsEmailDraftRequest struct {
	CompanyID               string          `json:"company_id"`
	DraftID                 string          `json:"draft_id"`
	SharedInboxID           string          `json:"shared_inbox_id"`
	SharedResourceType      string          `json:"shared_resource_type"`
	SharedResourceID        string          `json:"shared_resource_id"`
	SeedFromPersonalDraftID string          `json:"seed_from_personal_draft_id"`
	AccountEmail            string          `json:"account_email"`
	Kind                    string          `json:"kind"`
	SourceMessageID         string          `json:"source_message_id"`
	ToRecipients            string          `json:"to_recipients"`
	CcRecipients            string          `json:"cc_recipients"`
	BccRecipients           string          `json:"bcc_recipients"`
	Subject                 string          `json:"subject"`
	BodyEditorHTML          string          `json:"body_editor_html"`
	ReplyToMessage          json.RawMessage `json:"reply_to_message"`
	ScheduledSendTimestamp  string          `json:"scheduled_send_timestamp"`
	ExpectedRevision        int64           `json:"expected_revision"`
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
	SharedResourceType     string                      `json:"shared_resource_type,omitempty"`
	SharedResourceID       string                      `json:"shared_resource_id,omitempty"`
	Revision               int64                       `json:"revision"`
	CanSend                bool                        `json:"can_send"`
	Kind                   string                      `json:"kind"`
	SourceMessageID        string                      `json:"source_message_id,omitempty"`
	SourceThreadID         string                      `json:"source_thread_id,omitempty"`
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

type communicationsSharedDraftOwnerRequest struct {
	resourceType string
	resourceID   string
}

func parseCommunicationsSharedDraftOwner(w http.ResponseWriter, resourceType, resourceID string) (communicationsSharedDraftOwnerRequest, bool) {
	resourceType, resourceID = strings.ToLower(strings.TrimSpace(resourceType)), strings.TrimSpace(resourceID)
	if (resourceType == "") != (resourceID == "") || (resourceType != "" && resourceType != store.EntityTypeNode && resourceType != store.EntityTypeProject) ||
		(resourceID != "" && !validAttachmentUUIDText(resourceID)) {
		writeError(w, http.StatusBadRequest, "invalid_shared_email_draft_owner")
		return communicationsSharedDraftOwnerRequest{}, false
	}
	return communicationsSharedDraftOwnerRequest{resourceType: resourceType, resourceID: resourceID}, true
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
	owner, ok := parseCommunicationsSharedDraftOwner(w, r.URL.Query().Get("shared_resource_type"), r.URL.Query().Get("shared_resource_id"))
	if !ok {
		return
	}
	resourceSharedOnly := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("resource_shared")), "true")
	if resourceSharedOnly && owner.resourceID != "" {
		writeError(w, http.StatusBadRequest, "invalid_email_draft_scope")
		return
	}
	kind := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("kind")))
	if kind != "" && kind != "reply" {
		writeError(w, http.StatusBadRequest, "invalid_email_draft_kind")
		return
	}
	sourceMessageIDs := r.URL.Query()["source_message_id"]
	if len(sourceMessageIDs) > store.CommunicationsEmailDraftSourceFilterMax {
		writeError(w, http.StatusBadRequest, "email_draft_source_filter_limit_exceeded")
		return
	}
	for index := range sourceMessageIDs {
		sourceMessageIDs[index] = strings.TrimSpace(sourceMessageIDs[index])
		if !validAttachmentUUIDText(sourceMessageIDs[index]) {
			writeError(w, http.StatusBadRequest, "invalid_email_draft_source_message_id")
			return
		}
	}
	sourceThreadIDs := r.URL.Query()["source_thread_id"]
	if len(sourceThreadIDs) > store.CommunicationsEmailDraftSourceFilterMax {
		writeError(w, http.StatusBadRequest, "email_draft_source_thread_filter_limit_exceeded")
		return
	}
	for index := range sourceThreadIDs {
		sourceThreadIDs[index] = strings.TrimSpace(sourceThreadIDs[index])
		if !validAttachmentUUIDText(sourceThreadIDs[index]) {
			writeError(w, http.StatusBadRequest, "invalid_email_draft_source_thread_id")
			return
		}
	}
	var listInput store.CommunicationsEmailDraftListInput
	if owner.resourceID != "" {
		listInput = store.CommunicationsEmailDraftListInput{CompanyID: companyID, SharedResourceType: owner.resourceType, SharedResourceID: owner.resourceID}
	} else {
		scope, resolved := s.resolveCommunicationsEmailDraftScope(w, actor, companyID, r.URL.Query().Get("shared_inbox_id"), r.URL.Query().Get("account_email"), store.EntityPermissionEdit)
		if !resolved {
			return
		}
		listInput = scope.draftListInput(companyID)
		listInput.ResourceSharedOnly = resourceSharedOnly
	}
	listInput.ParticipantUserID = actor.User.UserID
	listInput.Kind = kind
	listInput.SourceMessageIDs = sourceMessageIDs
	listInput.SourceThreadIDs = sourceThreadIDs
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
	owner, ok := parseCommunicationsSharedDraftOwner(w, r.URL.Query().Get("shared_resource_type"), r.URL.Query().Get("shared_resource_id"))
	if !ok {
		return
	}
	var getInput store.CommunicationsEmailDraftGetInput
	if owner.resourceID != "" {
		getInput = store.CommunicationsEmailDraftGetInput{CompanyID: companyID, DraftID: draftID, SharedResourceType: owner.resourceType, SharedResourceID: owner.resourceID}
	} else {
		scope, resolved := s.resolveCommunicationsEmailDraftScope(w, actor, companyID, r.URL.Query().Get("shared_inbox_id"), r.URL.Query().Get("account_email"), store.EntityPermissionEdit)
		if !resolved {
			return
		}
		getInput = scope.draftGetInput(companyID, draftID)
	}
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
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	owner, ok := parseCommunicationsSharedDraftOwner(w, req.SharedResourceType, req.SharedResourceID)
	if !ok {
		return
	}
	var scope resolvedCommunicationsEmailScope
	if owner.resourceID == "" {
		var resolved bool
		scope, resolved = s.resolveCommunicationsEmailDraftScope(w, actor, companyID, req.SharedInboxID, req.AccountEmail, store.EntityPermissionEdit)
		if !resolved {
			return
		}
	}
	scheduledAt, ok := parseCommunicationsOptionalTimestamp(w, req.ScheduledSendTimestamp)
	if !ok {
		return
	}
	requestedKind := strings.ToLower(strings.TrimSpace(req.Kind))
	if owner.resourceID != "" && (requestedKind != "reply" || scheduledAt != nil) {
		writeError(w, http.StatusBadRequest, "invalid_shared_email_draft")
		return
	}
	seedFromPersonalDraftID := strings.TrimSpace(req.SeedFromPersonalDraftID)
	if seedFromPersonalDraftID != "" && (owner.resourceID == "" || strings.TrimSpace(pathDraftID) != "" || requestedKind != "reply") {
		writeError(w, http.StatusBadRequest, "invalid_shared_email_draft_seed")
		return
	}
	replyToJSON := "{}"
	if len(req.ReplyToMessage) > 0 && string(req.ReplyToMessage) != "null" {
		if requestedKind == "reply" {
			writeError(w, http.StatusBadRequest, "email_reply_target_not_allowed")
			return
		}
		if !json.Valid(req.ReplyToMessage) {
			writeError(w, http.StatusBadRequest, "invalid_reply_to_message")
			return
		}
		replyToJSON = string(req.ReplyToMessage)
	}
	sourceMessageID := strings.TrimSpace(req.SourceMessageID)
	input := store.CommunicationsEmailDraftInput{
		CompanyID:               companyID,
		PersonalUserID:          scope.personalUserID,
		PersonalAccountEmail:    scope.personalAccountEmail,
		SharedInboxID:           firstNonBlank(scope.sharedInboxID, strings.TrimSpace(req.SharedInboxID)),
		SharedResourceType:      owner.resourceType,
		SharedResourceID:        owner.resourceID,
		SeedFromPersonalDraftID: seedFromPersonalDraftID,
		CreatedByUserID:         actor.User.UserID,
		UpdatedByUserID:         actor.User.UserID,
		Kind:                    requestedKind,
		SourceMessageID:         sourceMessageID,
		AccountEmail:            scope.accountEmail,
		ToRecipients:            req.ToRecipients,
		CcRecipients:            req.CcRecipients,
		BccRecipients:           req.BccRecipients,
		Subject:                 req.Subject,
		BodyEditorHTML:          req.BodyEditorHTML,
		ReplyToMessageJSON:      replyToJSON,
		ScheduledSendTimestamp:  scheduledAt,
		ExpectedRevision:        req.ExpectedRevision,
	}
	if strings.TrimSpace(pathDraftID) == "" && requestedKind == "reply" {
		if strings.TrimSpace(req.DraftID) != "" {
			writeError(w, http.StatusBadRequest, "email_reply_draft_id_not_allowed")
			return
		}
		draft, created, err := s.repo.EnsureCommunicationsEmailReplyDraft(input)
		if errors.Is(err, store.ErrEmailReplySourceNotIngested) {
			writeError(w, http.StatusConflict, "email_reply_source_not_ingested")
			return
		}
		if errors.Is(err, store.ErrEmailDraftSourceNotFound) {
			writeError(w, http.StatusConflict, "email_draft_source_not_found")
			return
		}
		if errors.Is(err, store.ErrEmailDraftIdentityConflict) {
			writeError(w, http.StatusConflict, "email_draft_source_kind_conflict")
			return
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_email_reply_draft")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusConflict, "email_draft_connection_not_available")
			return
		}
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "email_reply_draft_creation_conflict")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_ensure_email_reply_draft")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"draft": s.communicationsEmailDraftResponseWithAttachments(draft, owner.resourceID == "" || !created || seedFromPersonalDraftID != ""), "created": created})
		return
	}

	draftID := strings.TrimSpace(firstNonBlank(pathDraftID, req.DraftID))
	if draftID == "" {
		writeError(w, http.StatusBadRequest, "draft_id_required")
		return
	}
	input.DraftID = draftID
	input.ExistingOnly = strings.TrimSpace(pathDraftID) != "" && requestedKind == "reply"
	if owner.resourceID != "" && (strings.TrimSpace(pathDraftID) == "" || req.ExpectedRevision < 1) {
		writeError(w, http.StatusBadRequest, "expected_revision_required")
		return
	}
	draft, err := s.repo.UpsertCommunicationsEmailDraft(input)
	if errors.Is(err, store.ErrVersionConflict) {
		writeError(w, http.StatusConflict, "email_draft_revision_conflict")
		return
	}
	if errors.Is(err, store.ErrEmailReplySourceNotIngested) {
		writeError(w, http.StatusConflict, "email_reply_source_not_ingested")
		return
	}
	if errors.Is(err, store.ErrEmailDraftSourceNotFound) {
		writeError(w, http.StatusConflict, "email_draft_source_not_found")
		return
	}
	if errors.Is(err, store.ErrEmailDraftIdentityConflict) {
		writeError(w, http.StatusConflict, "email_draft_source_kind_conflict")
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
	writeJSON(w, http.StatusOK, map[string]any{"draft": s.communicationsEmailDraftResponseWithAttachments(draft, owner.resourceID == "")})
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
	owner, ok := parseCommunicationsSharedDraftOwner(w, r.URL.Query().Get("shared_resource_type"), r.URL.Query().Get("shared_resource_id"))
	if !ok {
		return
	}
	var scope resolvedCommunicationsEmailScope
	expectedRevision := int64(0)
	if owner.resourceID != "" {
		parsed, err := parseOptionalExpectedRevision(r)
		if err != nil || parsed == nil || *parsed < 1 {
			writeError(w, http.StatusBadRequest, "expected_revision_required")
			return
		}
		expectedRevision = *parsed
	} else {
		var resolved bool
		scope, resolved = s.resolveCommunicationsEmailDraftScope(w, actor, companyID, r.URL.Query().Get("shared_inbox_id"), r.URL.Query().Get("account_email"), store.EntityPermissionEdit)
		if !resolved {
			return
		}
	}
	deleteInput := store.CommunicationsEmailDraftDeleteInput{
		CompanyID:            companyID,
		DraftID:              draftID,
		ParticipantUserID:    actor.User.UserID,
		UpdatedByUserID:      actor.User.UserID,
		PersonalUserID:       scope.personalUserID,
		PersonalAccountEmail: scope.personalAccountEmail,
		SharedInboxID:        scope.sharedInboxID,
		SharedResourceType:   owner.resourceType,
		SharedResourceID:     owner.resourceID,
		ExpectedRevision:     expectedRevision,
	}
	if err := s.repo.SoftDeleteCommunicationsEmailDraft(deleteInput); errors.Is(err, store.ErrVersionConflict) {
		writeError(w, http.StatusConflict, "email_draft_revision_conflict")
		return
	} else if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "email_draft_not_found")
		return
	} else if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_email_draft")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_email_draft")
		return
	}
	s.wakeAttachmentDeletionCleanup()
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
	return s.communicationsEmailDraftResponseWithAttachments(draft, true)
}

func (s *Server) communicationsEmailDraftResponseWithAttachments(draft domain.CommunicationsEmailDraft, includeAttachments bool) communicationsEmailDraftResponse {
	attachments := []domain.ResourceAttachment{}
	if includeAttachments {
		loaded, err := s.repo.ListResourceAttachments(draft.CompanyID, "email_draft", communicationsEmailDraftResourceID(draft))
		if err == nil {
			attachments = loaded
		}
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
		SharedResourceType:     draft.SharedResourceType,
		SharedResourceID:       draft.SharedResourceID,
		Revision:               draft.Revision,
		CanSend:                draft.CanSend || !isResourceSharedEmailDraft(draft),
		CreatedByUserID:        draft.CreatedByUserID,
		UpdatedByUserID:        draft.UpdatedByUserID,
		Kind:                   draft.Kind,
		SourceMessageID:        draft.SourceMessageID,
		SourceThreadID:         draft.SourceThreadID,
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
		SharedResourceType: draft.SharedResourceType, SharedResourceID: draft.SharedResourceID,
		Revision: draft.Revision, CanSend: draft.CanSend || !isResourceSharedEmailDraft(draft),
		UpdatedByUserID: draft.UpdatedByUserID, Kind: draft.Kind,
		SourceMessageID: draft.SourceMessageID, SourceThreadID: draft.SourceThreadID,
		AccountEmail: draft.AccountEmail,
		ToRecipients: draft.ToRecipients, CcRecipients: draft.CcRecipients,
		BccRecipients: draft.BccRecipients, Subject: draft.Subject,
		ScheduledSendTimestamp: draft.ScheduledSendTimestamp,
		CreatedTimestamp:       draft.CreatedTimestamp, UpdatedTimestamp: draft.UpdatedTimestamp,
		Attachments: []domain.ResourceAttachment{},
	}
}

func isResourceSharedEmailDraft(draft domain.CommunicationsEmailDraft) bool {
	return strings.TrimSpace(draft.SharedResourceType) != "" && strings.TrimSpace(draft.SharedResourceID) != ""
}

func communicationsEmailDraftResourceID(draft domain.CommunicationsEmailDraft) string {
	return strings.TrimSpace(draft.DraftID)
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
