package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type attachmentUploadResponse struct {
	Attachment         domain.Attachment         `json:"attachment"`
	ResourceAttachment domain.ResourceAttachment `json:"resource_attachment"`
}

type attachmentResourceLinkRequest struct {
	CompanyID        string `json:"company_id"`
	AttachmentID     string `json:"attachment_id"`
	InformationID    string `json:"information_id"`
	MessageID        string `json:"message_id"`
	EditorSurface    string `json:"editor_surface"`
	RelationshipKind string `json:"relationship_kind"`
}

func (s *Server) handleAttachments(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/attachments" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	// Browser bytes no longer pass through Mango API. Server-side integrations
	// retain AttachmentObjectStorage.PutObject and use it directly.
	writeError(w, http.StatusGone, "attachment_browser_upload_moved")
}

func (s *Server) handleAttachmentByID(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/attachments/"), "/")
	if s.handleAttachmentDirectUploadRoute(w, r, trimmed) {
		return
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	attachmentID := strings.TrimSpace(parts[0])
	if len(parts) == 1 && r.Method == http.MethodGet {
		s.handleAttachmentMetadata(w, r, attachmentID)
		return
	}
	if len(parts) == 2 && parts[1] == "content" && r.Method == http.MethodGet {
		s.handleAttachmentContent(w, r, attachmentID)
		return
	}
	writeError(w, http.StatusNotFound, "not_found")
}

func (s *Server) handleAttachmentMetadata(w http.ResponseWriter, r *http.Request, attachmentID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	attachment, err := s.repo.GetAttachment(companyID, attachmentID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_attachment")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_attachment")
		return
	}
	if !s.canReadAttachmentThroughLinks(w, r, companyID, attachment.ResourceLinks) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"attachment": attachment})
}

func (s *Server) handleAttachmentContent(w http.ResponseWriter, r *http.Request, attachmentID string) {
	if s.attachmentStorage == nil {
		writeError(w, http.StatusServiceUnavailable, "attachment_storage_unavailable")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	variantType := store.NormalizeAttachmentVariantType(r.URL.Query().Get("variant"))
	if variantType == "" || variantType == store.AttachmentVariantEmailSend {
		writeError(w, http.StatusBadRequest, "invalid_attachment_variant")
		return
	}
	content, err := s.repo.ReadAttachmentContent(r.Context(), companyID, attachmentID, variantType)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_attachment")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_attachment")
		return
	}
	if !s.canReadAttachmentThroughLinks(w, r, companyID, content.ResourceLinks) {
		return
	}
	if writeAttachmentContentNotModified(w, r, content) {
		return
	}
	output, err := s.attachmentStorage.GetObject(r.Context(), AttachmentGetObjectInput{Key: content.StorageKey})
	if errors.Is(err, ErrAttachmentObjectNotFound) && content.ServedVariant != store.AttachmentVariantOriginal {
		content = attachmentOriginalContentRead(content)
		if writeAttachmentContentNotModified(w, r, content) {
			return
		}
		output, err = s.attachmentStorage.GetObject(r.Context(), AttachmentGetObjectInput{Key: content.StorageKey})
	}
	if err != nil {
		writeAttachmentStorageError(w, err)
		return
	}
	defer output.Body.Close()
	if output.ContentLength != content.ByteSize {
		writeError(w, http.StatusBadGateway, "attachment_content_length_mismatch")
		return
	}
	contentType := strings.TrimSpace(output.ContentType)
	if contentType == "" {
		contentType = content.MimeType
	}
	if contentType == "" {
		contentType = content.OriginalMimeType
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	setAttachmentContentCacheHeaders(w, content)
	if content.ByteSize >= 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(content.ByteSize, 10))
	}
	if content.OriginalFilename != "" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": content.OriginalFilename}))
	}
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, output.Body); err != nil {
		log.Printf("attachment_content_stream status=failed attachment_id=%s variant=%s", content.AttachmentID, content.ServedVariant)
		return
	}
}

func (s *Server) canReadAttachmentThroughLinks(w http.ResponseWriter, r *http.Request, companyID string, links []domain.ResourceAttachment) bool {
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

func attachmentOriginalContentRead(content store.AttachmentContentRead) store.AttachmentContentRead {
	content.ServedVariant = store.AttachmentVariantOriginal
	content.MimeType = content.OriginalMimeType
	content.ByteSize = content.OriginalByteSize
	content.SHA256 = content.OriginalSHA256
	content.GenerationVersion = 0
	content.StorageBucket = content.OriginalStorageBucket
	content.StorageKey = content.OriginalStorageKey
	content.CreatedTimestamp = content.OriginalCreatedTimestamp
	content.UpdatedTimestamp = content.OriginalUpdatedTimestamp
	return content
}

func attachmentContentETag(content store.AttachmentContentRead) string {
	return strongETagFromString(strings.Join([]string{
		content.AttachmentID,
		content.ServedVariant,
		content.SHA256,
		strconv.FormatInt(content.ByteSize, 10),
		strconv.Itoa(content.GenerationVersion),
		content.StorageKey,
		content.UpdatedTimestamp.UTC().Format(time.RFC3339Nano),
	}, "\n"))
}

func setAttachmentContentCacheHeaders(w http.ResponseWriter, content store.AttachmentContentRead) {
	w.Header().Set("ETag", attachmentContentETag(content))
	w.Header().Set("Last-Modified", content.UpdatedTimestamp.UTC().Truncate(time.Second).Format(http.TimeFormat))
	w.Header().Set("Cache-Control", "private, max-age=0, no-cache, must-revalidate")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Add("Vary", "Authorization")
	w.Header().Add("Vary", "X-Mango-Company-ID")
}

func writeAttachmentContentNotModified(w http.ResponseWriter, r *http.Request, content store.AttachmentContentRead) bool {
	setAttachmentContentCacheHeaders(w, content)
	if requestETagMatches(r, attachmentContentETag(content)) {
		w.WriteHeader(http.StatusNotModified)
		return true
	}
	if strings.TrimSpace(r.Header.Get("If-None-Match")) != "" {
		return false
	}
	modifiedSince, err := http.ParseTime(strings.TrimSpace(r.Header.Get("If-Modified-Since")))
	if err == nil && !content.UpdatedTimestamp.UTC().Truncate(time.Second).After(modifiedSince.UTC()) {
		w.WriteHeader(http.StatusNotModified)
		return true
	}
	return false
}

func (s *Server) handleResourceAttachments(w http.ResponseWriter, r *http.Request, resourceType, resourceID string, parts []string) {
	if len(parts) == 3 && parts[2] == "attachments" {
		switch r.Method {
		case http.MethodGet:
			s.handleResourceAttachmentList(w, r, resourceType, resourceID)
		case http.MethodPost:
			s.handleResourceAttachmentLink(w, r, resourceType, resourceID)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		}
		return
	}
	if len(parts) == 4 && parts[2] == "attachments" && r.Method == http.MethodDelete {
		s.handleResourceAttachmentUnlink(w, r, resourceType, resourceID, parts[3])
		return
	}
	writeError(w, http.StatusNotFound, "not_found")
}

func (s *Server) handleResourceAttachmentList(w http.ResponseWriter, r *http.Request, resourceType, resourceID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireAttachmentResourceView(w, r, companyID, resourceType, resourceID) {
		return
	}
	items, err := s.repo.ListResourceAttachments(companyID, resourceType, resourceID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_attachment_resource")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_resource_attachments")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"company_id": companyID, "resource_type": resourceType, "resource_id": resourceID, "attachments": items})
}

func (s *Server) handleResourceAttachmentLink(w http.ResponseWriter, r *http.Request, resourceType, resourceID string) {
	var req attachmentResourceLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if req.CompanyID == "" || strings.TrimSpace(req.AttachmentID) == "" {
		writeError(w, http.StatusBadRequest, "attachment_resource_context_required")
		return
	}
	if !s.requireAttachmentResourceEdit(w, r, req.CompanyID, resourceType, resourceID) {
		return
	}
	// Linking must not be usable to exfiltrate an attachment from a resource
	// the actor cannot read, even when the actor can edit the destination.
	if !s.canReadAttachmentThroughResourceLink(w, r, req.CompanyID, strings.TrimSpace(req.AttachmentID)) {
		return
	}
	actorUserID := ""
	if actor, ok := authenticatedActor(r); ok {
		actorUserID = strings.TrimSpace(actor.User.UserID)
	}
	link, err := s.repo.LinkResourceAttachment(store.ResourceAttachmentInput{
		CompanyID:        req.CompanyID,
		ResourceType:     resourceType,
		ResourceID:       resourceID,
		AttachmentID:     req.AttachmentID,
		InformationID:    req.InformationID,
		MessageID:        req.MessageID,
		EditorSurface:    req.EditorSurface,
		RelationshipKind: req.RelationshipKind,
		CreatedByUserID:  actorUserID,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_attachment_link")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "attachment_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_link_attachment")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"resource_attachment": link})
}

func (s *Server) handleResourceAttachmentUnlink(w http.ResponseWriter, r *http.Request, resourceType, resourceID, attachmentID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireAttachmentResourceEdit(w, r, companyID, resourceType, resourceID) {
		return
	}
	err := s.repo.SoftDeleteResourceAttachment(store.ResourceAttachmentDeleteInput{
		CompanyID:    companyID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		AttachmentID: attachmentID,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_attachment_link")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "attachment_link_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_unlink_attachment")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "unlinked"})
}

func (s *Server) requireAttachmentResourceView(w http.ResponseWriter, r *http.Request, companyID, resourceType, resourceID string) bool {
	resourceType = store.NormalizeAttachmentResourceType(resourceType)
	if handled, allowed := s.requireEmailCollaborationNodeAttachmentAccess(w, r, companyID, resourceType, resourceID); handled {
		return allowed
	}
	switch resourceType {
	case "email_draft", "email_message":
		return s.requireEmailScopedAttachmentResourceAccess(w, r, companyID, resourceType, resourceID, false)
	case "email_signature":
		return s.requireEmailSignatureAttachmentResourceAccess(w, r, companyID, resourceID, store.EntityPermissionEdit)
	case "attached_email":
		return s.requireAttachedEmailAttachmentResourceAccess(w, r, companyID, resourceID, store.EntityPermissionEdit)
	}
	entityType, ok := attachmentPermissionEntityType(resourceType)
	if !ok {
		writeError(w, http.StatusBadRequest, "unsupported_attachment_resource_type")
		return false
	}
	return s.requireEntityView(w, r, companyID, entityType, resourceID, "resource_not_found")
}

func (s *Server) requireAttachmentResourceEdit(w http.ResponseWriter, r *http.Request, companyID, resourceType, resourceID string) bool {
	resourceType = store.NormalizeAttachmentResourceType(resourceType)
	if handled, allowed := s.requireEmailCollaborationNodeAttachmentAccess(w, r, companyID, resourceType, resourceID); handled {
		return allowed
	}
	switch resourceType {
	case "email_draft", "email_message":
		return s.requireEmailScopedAttachmentResourceAccess(w, r, companyID, resourceType, resourceID, true)
	case "email_signature":
		return s.requireEmailSignatureAttachmentResourceAccess(w, r, companyID, resourceID, store.EntityPermissionEdit)
	case "attached_email":
		return s.requireAttachedEmailAttachmentResourceAccess(w, r, companyID, resourceID, store.EntityPermissionEdit)
	}
	entityType, ok := attachmentPermissionEntityType(resourceType)
	if !ok {
		writeError(w, http.StatusBadRequest, "unsupported_attachment_resource_type")
		return false
	}
	return s.requireEntityEdit(w, r, companyID, entityType, resourceID, "resource_not_found")
}

func (s *Server) canReadAttachmentThroughResourceLink(w http.ResponseWriter, r *http.Request, companyID, attachmentID string) bool {
	links, err := s.repo.ListAttachmentResourceLinks(companyID, attachmentID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_attachment")
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
	return s.canReadAttachmentThroughLinks(w, r, companyID, links)
}

func (s *Server) canViewAttachmentResource(r *http.Request, companyID, resourceType, resourceID string) (bool, error) {
	resourceType = store.NormalizeAttachmentResourceType(resourceType)
	if resourceType == "email_draft" {
		actor, ok := authenticatedActor(r)
		if !ok || actorRoleForCompany(actor, companyID) == "" {
			return false, nil
		}
		return s.canViewEmailDraftAttachmentResource(actor, companyID, resourceID)
	}
	if handled, allowed, err := s.canAccessEmailCollaborationNodeAttachment(r, companyID, resourceType, resourceID); handled {
		return allowed, err
	}
	userID := s.entityPermissionActorUserID(r, companyID)
	if userID == "" {
		return true, nil
	}
	switch resourceType {
	case "email_message":
		return s.canViewEmailMessageAttachmentResource(companyID, userID, resourceID)
	case "email_signature":
		return s.canViewEmailSignatureAttachmentResource(companyID, userID, resourceID)
	case "attached_email":
		nodeID, ok := parseAttachedEmailAttachmentResourceID(resourceID)
		if !ok {
			return false, nil
		}
		return s.repo.UserHasEffectiveAccess(companyID, userID, store.EntityTypeNode, nodeID, store.EntityPermissionEdit)
	}
	entityType, ok := attachmentPermissionEntityType(resourceType)
	if !ok {
		return false, nil
	}
	return s.repo.UserHasEffectiveAccess(companyID, userID, entityType, resourceID, store.EntityPermissionEdit)
}

type emailScopedAttachmentResource struct {
	scope           string
	userID          string
	accountEmail    string
	sharedInboxID   string
	collaborationID string
	itemID          string
}

func (s *Server) requireEmailScopedAttachmentResourceAccess(w http.ResponseWriter, r *http.Request, companyID, resourceType, resourceID string, mutation bool) bool {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return false
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return false
	}
	resourceType = store.NormalizeAttachmentResourceType(resourceType)
	parsed, ok := parseEmailScopedAttachmentResourceID(resourceType, resourceID)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_attachment_resource")
		return false
	}
	if parsed.scope == "collaboration" {
		if actorRoleForCompany(actor, companyID) == "" {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return false
		}
		draft, authorized, err := s.accessibleEmailCollaborationDraft(companyID, strings.TrimSpace(actor.User.UserID), parsed)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_check_email_collaboration_draft")
			return false
		}
		if !authorized {
			writeAccessResourceNotFound(w)
			return false
		}
		if mutation && draft.SendState == "sending" {
			writeError(w, http.StatusConflict, "email_draft_send_in_progress")
			return false
		}
		return true
	}
	if resourceType == "email_draft" && mutation && parsed.scope == "personal" && parsed.accountEmail == "" {
		// Accountless personal draft IDs are read-only compatibility for links
		// created before mailbox scope became immutable.
		writeError(w, http.StatusBadRequest, "invalid_attachment_resource")
		return false
	}
	if parsed.scope == "personal" {
		if actorRoleForCompany(actor, companyID) == "" {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return false
		}
		if strings.TrimSpace(actor.User.UserID) != parsed.userID && (resourceType != "email_message" || !actorCanManageCompany(actor, companyID)) {
			writeAccessResourceNotFound(w)
			return false
		}
		if resourceType == "email_draft" {
			draftFound, err := s.emailDraftAttachmentResourceExists(companyID, parsed)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_check_email_draft")
				return false
			}
			if !draftFound {
				writeAccessResourceNotFound(w)
				return false
			}
		}
		return true
	}
	folder, ok := s.findVisibleSharedInboxFolder(w, actor, companyID, parsed.sharedInboxID, store.EntityPermissionEdit)
	if !ok {
		return false
	}
	if store.CommunicationsSharedInboxResourceType(folder) != store.EntityTypeSharedInbox {
		writeError(w, http.StatusConflict, "shared_inbox_not_mailbox")
		return false
	}
	if resourceType == "email_draft" {
		draftFound, err := s.emailDraftAttachmentResourceExists(companyID, parsed)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_check_email_draft")
			return false
		}
		if !draftFound {
			writeAccessResourceNotFound(w)
			return false
		}
	}
	return true
}

func (s *Server) canViewEmailMessageAttachmentResource(companyID, userID, resourceID string) (bool, error) {
	parsed, ok := parseEmailScopedAttachmentResourceID("email_message", resourceID)
	if !ok {
		return false, nil
	}
	if parsed.scope == "collaboration" {
		return s.canAccessEmailCollaborationDraft(companyID, userID, parsed)
	}
	if parsed.scope == "personal" {
		return userID == parsed.userID, nil
	}
	return s.repo.UserHasEffectiveAccess(companyID, userID, store.EntityTypeSharedInbox, parsed.sharedInboxID, store.EntityPermissionEdit)
}

func (s *Server) canViewEmailDraftAttachmentResource(actor ActorContext, companyID, resourceID string) (bool, error) {
	parsed, ok := parseEmailScopedAttachmentResourceID("email_draft", resourceID)
	if !ok {
		return false, nil
	}
	if parsed.scope == "collaboration" {
		// Collaboration drafts are participant-private; generic company-admin
		// resource access must not expose their attachment bytes.
		return s.canAccessEmailCollaborationDraft(companyID, strings.TrimSpace(actor.User.UserID), parsed)
	}
	if parsed.scope == "personal" {
		if strings.TrimSpace(actor.User.UserID) != parsed.userID {
			return false, nil
		}
		return s.emailDraftAttachmentResourceExists(companyID, parsed)
	}

	folder, err := s.loadCommunicationsSharedInboxFolder(companyID, parsed.sharedInboxID)
	if errors.Is(err, store.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if store.CommunicationsSharedInboxResourceType(folder) != store.EntityTypeSharedInbox {
		return false, nil
	}
	draftFound, err := s.emailDraftAttachmentResourceExists(companyID, parsed)
	if err != nil || !draftFound {
		return false, err
	}
	if actorCanManageCompany(actor, companyID) {
		return true, nil
	}
	return s.repo.UserHasEffectiveAccess(companyID, actor.User.UserID, store.EntityTypeSharedInbox, parsed.sharedInboxID, store.EntityPermissionEdit)
}

func (s *Server) emailDraftAttachmentResourceExists(companyID string, parsed emailScopedAttachmentResource) (bool, error) {
	if parsed.scope == "shared" {
		return s.communicationsEmailDraftExists(store.CommunicationsEmailDraftGetInput{
			CompanyID: companyID, DraftID: parsed.itemID, SharedInboxID: parsed.sharedInboxID,
		})
	}

	connections, err := s.repo.ListUserEmailConnections(strings.TrimSpace(parsed.userID))
	if errors.Is(err, store.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	accountEmails := make(map[string]struct{}, len(connections))
	for _, connection := range connections {
		accountEmail := normalizeEmailForCompare(connection.AccountEmail)
		if accountEmail != "" {
			accountEmails[accountEmail] = struct{}{}
		}
	}
	if parsed.accountEmail != "" {
		if _, ok := accountEmails[parsed.accountEmail]; !ok {
			return false, nil
		}
		return s.communicationsEmailDraftExists(store.CommunicationsEmailDraftGetInput{
			CompanyID: companyID, DraftID: parsed.itemID, PersonalUserID: parsed.userID, PersonalAccountEmail: parsed.accountEmail,
		})
	}

	// Accountless personal IDs are legacy read compatibility only. Resolve them
	// against the owner's current accounts and still require one exact live draft.
	for accountEmail := range accountEmails {
		found, err := s.communicationsEmailDraftExists(store.CommunicationsEmailDraftGetInput{
			CompanyID: companyID, DraftID: parsed.itemID, PersonalUserID: parsed.userID, PersonalAccountEmail: accountEmail,
		})
		if err != nil {
			return false, err
		}
		if found {
			return true, nil
		}
	}
	return false, nil
}

func (s *Server) communicationsEmailDraftExists(input store.CommunicationsEmailDraftGetInput) (bool, error) {
	_, err := s.repo.GetCommunicationsEmailDraft(input)
	if errors.Is(err, store.ErrInvalid) || errors.Is(err, store.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *Server) requireEmailSignatureAttachmentResourceAccess(w http.ResponseWriter, r *http.Request, companyID, resourceID, accessLevel string) bool {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return false
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return false
	}
	parsed, ok := parseEmailSignatureAttachmentResourceID(resourceID)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_attachment_resource")
		return false
	}
	if parsed.scope == "personal" {
		if actorRoleForCompany(actor, companyID) == "" {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return false
		}
		if strings.TrimSpace(actor.User.UserID) != parsed.userID {
			writeAccessResourceNotFound(w)
			return false
		}
		return true
	}
	return s.requireCommunicationsSharedInboxAccess(w, r, actor, companyID, parsed.sharedInboxID, accessLevel)
}

func (s *Server) canViewEmailSignatureAttachmentResource(companyID, userID, resourceID string) (bool, error) {
	parsed, ok := parseEmailSignatureAttachmentResourceID(resourceID)
	if !ok {
		return false, nil
	}
	if parsed.scope == "personal" {
		return userID == parsed.userID, nil
	}
	return s.repo.UserHasEffectiveAccess(companyID, userID, store.EntityTypeSharedInbox, parsed.sharedInboxID, store.EntityPermissionEdit)
}

func (s *Server) requireAttachedEmailAttachmentResourceAccess(w http.ResponseWriter, r *http.Request, companyID, resourceID, accessLevel string) bool {
	nodeID, ok := parseAttachedEmailAttachmentResourceID(resourceID)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_attachment_resource")
		return false
	}
	if accessLevel == store.EntityPermissionEdit {
		return s.requireEntityView(w, r, companyID, store.EntityTypeNode, nodeID, "resource_not_found")
	}
	return s.requireEntityEdit(w, r, companyID, store.EntityTypeNode, nodeID, "resource_not_found")
}

func parseEmailScopedAttachmentResourceID(resourceType, resourceID string) (emailScopedAttachmentResource, bool) {
	resourceType = store.NormalizeAttachmentResourceType(resourceType)
	parts := strings.Split(strings.TrimSpace(resourceID), ":")
	if len(parts) < 3 {
		return emailScopedAttachmentResource{}, false
	}
	scope := strings.TrimSpace(parts[0])
	switch scope {
	case "personal":
		partCount := 3
		itemIndex := 2
		if resourceType == "email_draft" {
			if len(parts) == 4 {
				partCount = 4
				itemIndex = 3
			}
		} else if resourceType != "email_message" {
			return emailScopedAttachmentResource{}, false
		}
		if len(parts) != partCount {
			return emailScopedAttachmentResource{}, false
		}
		userID, ok := unescapeEmailAttachmentResourcePart(parts[1])
		if !ok {
			return emailScopedAttachmentResource{}, false
		}
		accountEmail := ""
		if resourceType == "email_draft" && len(parts) == 4 {
			accountEmail, ok = unescapeEmailAttachmentResourcePart(parts[2])
			accountEmail = normalizeEmailForCompare(accountEmail)
			if !ok || accountEmail == "" {
				return emailScopedAttachmentResource{}, false
			}
		}
		itemID, ok := unescapeEmailAttachmentResourcePart(parts[itemIndex])
		if !ok {
			return emailScopedAttachmentResource{}, false
		}
		return emailScopedAttachmentResource{scope: scope, userID: userID, accountEmail: accountEmail, itemID: itemID}, true
	case "shared":
		if (resourceType != "email_draft" && resourceType != "email_message") || len(parts) != 3 {
			return emailScopedAttachmentResource{}, false
		}
		sharedInboxID, ok := unescapeEmailAttachmentResourcePart(parts[1])
		if !ok {
			return emailScopedAttachmentResource{}, false
		}
		itemID, ok := unescapeEmailAttachmentResourcePart(parts[2])
		if !ok {
			return emailScopedAttachmentResource{}, false
		}
		return emailScopedAttachmentResource{scope: scope, sharedInboxID: sharedInboxID, itemID: itemID}, true
	case "collaboration":
		if resourceType != "email_draft" || len(parts) != 3 {
			return emailScopedAttachmentResource{}, false
		}
		collaborationID, ok := unescapeEmailAttachmentResourcePart(parts[1])
		if !ok {
			return emailScopedAttachmentResource{}, false
		}
		itemID, ok := unescapeEmailAttachmentResourcePart(parts[2])
		if !ok {
			return emailScopedAttachmentResource{}, false
		}
		return emailScopedAttachmentResource{scope: scope, collaborationID: collaborationID, itemID: itemID}, true
	default:
		return emailScopedAttachmentResource{}, false
	}
}

func unescapeEmailAttachmentResourcePart(value string) (string, bool) {
	decoded, err := url.QueryUnescape(value)
	if err != nil {
		return "", false
	}
	decoded = strings.TrimSpace(decoded)
	return decoded, decoded != ""
}

func parseEmailSignatureAttachmentResourceID(resourceID string) (emailScopedAttachmentResource, bool) {
	parts := strings.Split(strings.TrimSpace(resourceID), ":")
	if len(parts) != 2 && len(parts) != 3 {
		return emailScopedAttachmentResource{}, false
	}
	scope := strings.TrimSpace(parts[0])
	switch scope {
	case "shared":
		if len(parts) != 2 {
			return emailScopedAttachmentResource{}, false
		}
		sharedInboxID, err := url.QueryUnescape(parts[1])
		if err != nil || strings.TrimSpace(sharedInboxID) == "" {
			return emailScopedAttachmentResource{}, false
		}
		return emailScopedAttachmentResource{scope: scope, sharedInboxID: strings.TrimSpace(sharedInboxID)}, true
	case "personal":
		if len(parts) != 3 {
			return emailScopedAttachmentResource{}, false
		}
		userID, err := url.QueryUnescape(parts[1])
		if err != nil || strings.TrimSpace(userID) == "" {
			return emailScopedAttachmentResource{}, false
		}
		accountEmail, err := url.QueryUnescape(parts[2])
		if err != nil || strings.TrimSpace(accountEmail) == "" {
			return emailScopedAttachmentResource{}, false
		}
		return emailScopedAttachmentResource{scope: scope, userID: strings.TrimSpace(userID), itemID: normalizeEmailForCompare(accountEmail)}, true
	default:
		return emailScopedAttachmentResource{}, false
	}
}

func parseAttachedEmailAttachmentResourceID(resourceID string) (string, bool) {
	parts := strings.Split(strings.TrimSpace(resourceID), ":")
	if len(parts) != 4 || parts[0] != "node" || parts[2] != "message" {
		return "", false
	}
	nodeID, err := url.QueryUnescape(parts[1])
	if err != nil {
		return "", false
	}
	messageID, err := url.QueryUnescape(parts[3])
	if err != nil {
		return "", false
	}
	nodeID = strings.TrimSpace(nodeID)
	messageID = strings.TrimSpace(messageID)
	if nodeID == "" || messageID == "" {
		return "", false
	}
	return nodeID, true
}

func attachmentPermissionEntityType(resourceType string) (string, bool) {
	switch store.NormalizeAttachmentResourceType(resourceType) {
	case "node":
		return store.EntityTypeNode, true
	case "logic_gate":
		return store.EntityTypeLogicGate, true
	case "project":
		return store.EntityTypeProject, true
	case "shared_inbox":
		return store.EntityTypeSharedInbox, true
	case "company_explorer_folder":
		return store.EntityTypeCompanyExplorerFolder, true
	case "shared_inbox_folder":
		return store.EntityTypeSharedInboxFolder, true
	default:
		return "", false
	}
}

func attachmentOriginalObjectKey(companyID, attachmentID string) string {
	return "companies/" + strings.TrimSpace(companyID) + "/attachments/" + strings.TrimSpace(attachmentID) + "/original"
}

func writeAttachmentStorageError(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrAttachmentObjectNotFound) {
		writeError(w, http.StatusNotFound, "attachment_content_not_found")
		return
	}
	if errors.Is(err, ErrAttachmentStorageUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "attachment_storage_unavailable")
		return
	}
	writeError(w, http.StatusBadGateway, "attachment_storage_failed")
}

func (s *Server) canAccessEmailCollaborationDraft(companyID, userID string, parsed emailScopedAttachmentResource) (bool, error) {
	_, allowed, err := s.accessibleEmailCollaborationDraft(companyID, userID, parsed)
	return allowed, err
}

func (s *Server) accessibleEmailCollaborationDraft(companyID, userID string, parsed emailScopedAttachmentResource) (domain.CommunicationsEmailDraft, bool, error) {
	if parsed.scope != "collaboration" || parsed.collaborationID == "" || parsed.itemID == "" || strings.TrimSpace(userID) == "" {
		return domain.CommunicationsEmailDraft{}, false, nil
	}
	_, err := s.repo.GetCommunicationsEmailCollaboration(companyID, parsed.collaborationID, userID)
	if errors.Is(err, store.ErrNotFound) {
		return domain.CommunicationsEmailDraft{}, false, nil
	}
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	input := store.CommunicationsEmailDraftGetInput{
		CompanyID:         companyID,
		DraftID:           parsed.itemID,
		ParticipantUserID: userID,
	}
	draft, err := s.repo.GetCommunicationsEmailDraft(input)
	if errors.Is(err, store.ErrNotFound) {
		return domain.CommunicationsEmailDraft{}, false, nil
	}
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	return draft, draft.IsShared && draft.CollaborationID == parsed.collaborationID, nil
}

func emailCollaborationAttachmentNodeID(resourceType, resourceID string) (string, bool) {
	switch store.NormalizeAttachmentResourceType(resourceType) {
	case "node":
		nodeID := strings.TrimSpace(resourceID)
		return nodeID, nodeID != ""
	case "attached_email":
		return parseAttachedEmailAttachmentResourceID(resourceID)
	default:
		return "", false
	}
}

func (s *Server) canAccessEmailCollaborationNodeAttachment(r *http.Request, companyID, resourceType, resourceID string) (bool, bool, error) {
	nodeID, ok := emailCollaborationAttachmentNodeID(resourceType, resourceID)
	if !ok {
		return false, false, nil
	}
	collaboration, err := s.repo.GetCommunicationsEmailCollaborationByNode(companyID, nodeID)
	if errors.Is(err, store.ErrNotFound) || errors.Is(err, store.ErrInvalid) {
		return false, false, nil
	}
	if err != nil {
		return true, false, err
	}
	actor, ok := authenticatedActor(r)
	if !ok || actorRoleForCompany(actor, companyID) == "" {
		return true, false, nil
	}
	_, err = s.repo.GetCommunicationsEmailCollaboration(companyID, collaboration.CollaborationID, strings.TrimSpace(actor.User.UserID))
	if errors.Is(err, store.ErrNotFound) {
		return true, false, nil
	}
	if err != nil {
		return true, false, err
	}
	return true, true, nil
}

func (s *Server) requireEmailCollaborationNodeAttachmentAccess(w http.ResponseWriter, r *http.Request, companyID, resourceType, resourceID string) (bool, bool) {
	handled, allowed, err := s.canAccessEmailCollaborationNodeAttachment(r, companyID, resourceType, resourceID)
	if !handled {
		return false, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_check_email_collaboration_attachment")
		return true, false
	}
	if !allowed {
		writeAccessResourceNotFound(w)
		return true, false
	}
	return true, true
}
