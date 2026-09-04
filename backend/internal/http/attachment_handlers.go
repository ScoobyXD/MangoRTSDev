package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"miraeopus/backend/internal/attachmentcleanup"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"

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
	ExpectedRevision int64  `json:"expected_revision"`
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
	if trimmed == "imports/remote-image" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		s.handleAttachmentRemoteImageImport(w, r)
		return
	}
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
	if variantType == "" {
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
	clearAttachmentDownloadWriteDeadline(w)
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, output.Body); err != nil {
		log.Printf("attachment_content_stream status=failed attachment_id=%s variant=%s", content.AttachmentID, content.ServedVariant)
		return
	}
}

func clearAttachmentDownloadWriteDeadline(w http.ResponseWriter) {
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
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
		s.handleResourceAttachmentDelete(w, r, resourceType, resourceID, parts[3])
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
		writeError(w, http.StatusInternalServerError, "failed_to_list_attachments")
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
		ExpectedRevision: req.ExpectedRevision,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_attachment_link")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "attachment_not_found")
		return
	}
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "email_draft_revision_conflict")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_link_attachment")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"resource_attachment": link})
}

func (s *Server) handleResourceAttachmentDelete(w http.ResponseWriter, r *http.Request, resourceType, resourceID, attachmentID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireAttachmentResourceEdit(w, r, companyID, resourceType, resourceID) {
		return
	}
	if store.NormalizeAttachmentResourceType(resourceType) != store.EntityTypeNode {
		actorUserID := ""
		if actor, ok := authenticatedActor(r); ok {
			actorUserID = strings.TrimSpace(actor.User.UserID)
		}
		expectedRevision, _ := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("expected_revision")), 10, 64)
		err := s.repo.SoftDeleteResourceAttachment(store.ResourceAttachmentDeleteInput{
			CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, AttachmentID: attachmentID,
			ActorUserID: actorUserID, ExpectedRevision: expectedRevision,
		})
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_attachment_link")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "attachment_link_not_found")
			return
		}
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "email_draft_revision_conflict")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_unlink_attachment")
			return
		}
		s.wakeAttachmentDeletionCleanup()
		response := map[string]any{"status": "unlinked"}
		if expectedRevision > 0 {
			response["resource_revision"] = expectedRevision + 1
		}
		writeJSON(w, http.StatusOK, response)
		return
	}
	deletionStorage, ok := s.attachmentStorage.(attachmentDeletionObjectStorage)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "attachment_storage_unavailable")
		return
	}
	plan, err := s.repo.PreparePermanentAttachmentDeletion(r.Context(), companyID, attachmentID, resourceType, resourceID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_attachment")
		return
	}
	if errors.Is(err, store.ErrAttachmentShared) {
		writeError(w, http.StatusConflict, "attachment_linked_to_another_resource")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "attachment_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_prepare_attachment_deletion")
		return
	}
	result := (attachmentcleanup.Service{
		Repository: s.repo,
		Storage:    attachmentDeletionStorage{storage: deletionStorage},
	}).RunItem(r.Context(), attachmentcleanup.WorkItem{
		Kind: attachmentcleanup.WorkOrphanAttachment, CompanyID: companyID,
		AttachmentID: attachmentID, Objects: plan.Objects,
	}, true)
	if result.Err != nil || !result.Finalized {
		s.wakeAttachmentDeletionCleanup()
		if errors.Is(result.Err, ErrAttachmentStorageUnavailable) {
			writeError(w, http.StatusServiceUnavailable, "attachment_storage_unavailable")
			return
		}
		writeError(w, http.StatusBadGateway, "attachment_storage_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}

func isFinalEmailAttachmentResource(resourceType string) bool {
	switch store.NormalizeAttachmentResourceType(resourceType) {
	case "email_message", "email_draft", "email_signature":
		return true
	default:
		return false
	}
}

func (s *Server) getEmailAttachmentResourceAccess(companyID, userID, resourceType, resourceID string) (store.EmailAttachmentResourceAccess, error) {
	return s.repo.GetEmailAttachmentResourceAccess(store.EmailAttachmentResourceAccessInput{
		CompanyID: companyID, UserID: userID, ResourceType: resourceType,
		ResourceID: resourceID, AccessLevel: store.EntityPermissionEdit,
	})
}

func (s *Server) requireFinalEmailAttachmentResourceAccess(w http.ResponseWriter, r *http.Request, companyID, resourceType, resourceID string, mutation bool) bool {
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
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return false
	}
	access, err := s.getEmailAttachmentResourceAccess(companyID, strings.TrimSpace(actor.User.UserID), resourceType, resourceID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_attachment_resource")
		return false
	}
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusInternalServerError, "failed_to_check_attachment_permission")
		return false
	}
	if errors.Is(err, store.ErrNotFound) || !access.Allowed {
		writeAccessResourceNotFound(w)
		return false
	}
	return true
}

func (s *Server) requireAttachmentResourceView(w http.ResponseWriter, r *http.Request, companyID, resourceType, resourceID string) bool {
	resourceType = store.NormalizeAttachmentResourceType(resourceType)
	if isFinalEmailAttachmentResource(resourceType) {
		return s.requireFinalEmailAttachmentResourceAccess(w, r, companyID, resourceType, resourceID, false)
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
	if isFinalEmailAttachmentResource(resourceType) {
		return s.requireFinalEmailAttachmentResourceAccess(w, r, companyID, resourceType, resourceID, true)
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
	if isFinalEmailAttachmentResource(resourceType) {
		actor, ok := authenticatedActor(r)
		if !ok || actorRoleForCompany(actor, companyID) == "" || strings.TrimSpace(actor.User.UserID) == "" {
			return false, nil
		}
		access, err := s.getEmailAttachmentResourceAccess(companyID, actor.User.UserID, resourceType, resourceID)
		if errors.Is(err, store.ErrInvalid) || errors.Is(err, store.ErrNotFound) {
			return false, nil
		}
		return access.Allowed, err
	}
	userID := s.entityPermissionActorUserID(r, companyID)
	if userID == "" {
		return true, nil
	}
	entityType, ok := attachmentPermissionEntityType(resourceType)
	if !ok {
		return false, nil
	}
	return s.repo.UserHasEffectiveAccess(companyID, userID, entityType, resourceID, store.EntityPermissionEdit)
}

func attachmentPermissionEntityType(resourceType string) (string, bool) {
	switch store.NormalizeAttachmentResourceType(resourceType) {
	case "node":
		return store.EntityTypeNode, true
	case "logic_gate":
		return store.EntityTypeLogicGate, true
	case "project":
		return store.EntityTypeProject, true
	case "huddle_logic_gate":
		return store.EntityTypeHuddleLogicGate, true
	case "huddle_node":
		return store.EntityTypeHuddleNode, true
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
