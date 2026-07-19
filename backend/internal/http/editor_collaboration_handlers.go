package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

const editorCollaborationRoutePrefix = "/v1/editor-collaboration/"

func (s *Server) handleEditorCollaboration(w http.ResponseWriter, r *http.Request) {
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
	ref, ok := editorCollaborationDocumentFromPath(companyID, r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "editor_document_route_not_found")
		return
	}
	authorized, rejectCode, err := s.authorizeRealtimeEntityScope(actor, companyID, ref.ResourceType, ref.ResourceID, store.EntityPermissionEdit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_check_editor_access")
		return
	}
	if !authorized {
		status := http.StatusForbidden
		if rejectCode == "resource_not_found" {
			status = http.StatusNotFound
		}
		writeError(w, status, rejectCode)
		return
	}
	gate, err := s.repo.GetEditorDataFormat(companyID)
	if err != nil {
		writeEditorJSONStoreError(w, err)
		return
	}
	if gate.EditorFormat != store.EditorFormatLegacyHTML {
		writeError(w, http.StatusConflict, "editor_format_mismatch")
		return
	}

	switch r.Method {
	case http.MethodGet:
		s.handleEditorCollaborationSnapshot(w, r, ref)
	case http.MethodPost:
		s.handleEditorCollaborationOperation(w, r, actor, ref)
	case http.MethodPatch:
		s.handleEditorCollaborationMetadata(w, r, ref)
	case http.MethodDelete:
		s.handleEditorCollaborationDelete(w, r, actor, ref)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func editorCollaborationDocumentFromPath(companyID, path string) (store.EditorDocumentRef, bool) {
	path = strings.TrimPrefix(strings.TrimSpace(path), editorCollaborationRoutePrefix)
	parts := strings.Split(path, "/")
	if len(parts) != 4 || parts[2] != "documents" || !isCanonicalUUID(parts[1]) || !isCanonicalUUID(parts[3]) {
		return store.EditorDocumentRef{}, false
	}
	ref := store.EditorDocumentRef{CompanyID: companyID, ResourceType: parts[0], ResourceID: parts[1], DocumentID: parts[3]}
	if _, err := store.NormalizeEditorDocumentRef(ref); err != nil {
		return store.EditorDocumentRef{}, false
	}
	return ref, true
}

func (s *Server) handleEditorCollaborationSnapshot(w http.ResponseWriter, r *http.Request, ref store.EditorDocumentRef) {
	snapshot, err := s.repo.GetEditorCollaborationSnapshot(ref)
	if err != nil {
		writeEditorCollaborationStoreError(w, err)
		return
	}
	if snapshot.Deleted {
		writeError(w, http.StatusGone, "editor_document_deleted")
		return
	}
	s.recordOperationalMetric("realtime.editor_snapshot_count", "editor", 1, 0)
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, snapshot, snapshot.ETag)
}

func (s *Server) handleEditorCollaborationOperation(w http.ResponseWriter, r *http.Request, actor ActorContext, ref store.EditorDocumentRef) {
	var request struct {
		OperationID  string                `json:"operation_id"`
		ClientID     string                `json:"client_id"`
		BaseRevision int64                 `json:"base_revision"`
		Patch        store.EditorHTMLPatch `json:"patch"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	commit, err := s.repo.CommitEditorCollaborationOperation(store.EditorCollaborationOperationInput{
		Document: ref, OperationID: request.OperationID, ClientID: request.ClientID,
		ActorUserID: strings.TrimSpace(actor.User.UserID), BaseRevision: request.BaseRevision, Patch: request.Patch,
	})
	if err != nil {
		writeEditorCollaborationStoreError(w, err)
		return
	}
	s.wakeRealtimeSpine()
	s.recordOperationalMetric("realtime.editor_operation_committed_count", "editor", 1, 0)
	if commit.Deduplicated {
		s.recordOperationalMetric("realtime.editor_operation_deduplicated_count", "editor", 1, 0)
	}
	writeJSON(w, http.StatusOK, commit)
}

func (s *Server) handleEditorCollaborationMetadata(w http.ResponseWriter, r *http.Request, ref store.EditorDocumentRef) {
	var request struct {
		Title          string                                         `json:"title"`
		Attachments    []store.EditorCollaborationAttachmentReference `json:"attachments"`
		EmailMessageID string                                         `json:"email_message_id"`
		EmailAccent    string                                         `json:"email_accent"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	commit, err := s.repo.UpdateEditorCollaborationMetadata(store.EditorCollaborationMetadataInput{
		Document: ref, Title: request.Title, Attachments: request.Attachments,
		EmailMessageID: request.EmailMessageID, EmailAccent: request.EmailAccent,
	})
	if err != nil {
		writeEditorCollaborationStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, commit)
}
func (s *Server) handleEditorCollaborationDelete(w http.ResponseWriter, r *http.Request, actor ActorContext, ref store.EditorDocumentRef) {
	var request struct {
		OperationID string `json:"operation_id"`
		ClientID    string `json:"client_id"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	commit, err := s.repo.DeleteEditorCollaborationDocument(store.EditorCollaborationDeleteInput{
		Document: ref, OperationID: request.OperationID, ClientID: request.ClientID,
		ActorUserID: strings.TrimSpace(actor.User.UserID),
	})
	if err != nil {
		writeEditorCollaborationStoreError(w, err)
		return
	}
	s.wakeRealtimeSpine()
	writeJSON(w, http.StatusOK, commit)
}

func writeEditorCollaborationStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrEditorDocumentTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "editor_collaboration_document_too_large")
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_editor_operation")
	case errors.Is(err, store.ErrVersionConflict):
		// This is a machine recovery signal for an unknown causal predecessor,
		// never an end-user whole-document merge conflict.
		writeError(w, http.StatusConflict, "collaboration_snapshot_required")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "editor_document_not_found")
	default:
		log.Printf("editor collaboration store failure: %v", err)
		writeError(w, http.StatusInternalServerError, "editor_collaboration_failed")
	}
}
