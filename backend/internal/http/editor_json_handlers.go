package httpapi

import (
	"encoding/json"
	"errors"
	"html"
	"log"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
)

const editorJSONRoutePrefix = "/v1/editor-json/"

type mangoTiptapMentionOccurrence struct {
	UserID string
	Label  string
	Kind   string
}

func mangoTiptapMentionOccurrences(raw json.RawMessage) []mangoTiptapMentionOccurrence {
	var envelope struct {
		Document any `json:"document"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil
	}
	result := make([]mangoTiptapMentionOccurrence, 0)
	var visit func(any)
	visit = func(value any) {
		node, ok := value.(map[string]any)
		if !ok {
			return
		}
		if node["type"] == "mention" {
			attrs, _ := node["attrs"].(map[string]any)
			userID, _ := attrs["userId"].(string)
			label, _ := attrs["label"].(string)
			kind, _ := attrs["kind"].(string)
			userID = strings.TrimSpace(userID)
			label = strings.TrimSpace(label)
			kind = strings.TrimSpace(kind)
			if kind == "normal" {
				kind = "regular"
			}
			if userID != "" && label != "" && (kind == "regular" || kind == "urgent") {
				result = append(result, mangoTiptapMentionOccurrence{UserID: userID, Label: label, Kind: kind})
			}
		}
		if content, ok := node["content"].([]any); ok {
			for _, child := range content {
				visit(child)
			}
		}
	}
	visit(envelope.Document)
	return result
}

func mangoTiptapAddedMentionNotificationHTML(before, after json.RawMessage) string {
	remaining := map[string]int{}
	for _, mention := range mangoTiptapMentionOccurrences(before) {
		remaining[mention.Kind+"\x00"+mention.UserID]++
	}
	added := make([]mangoTiptapMentionOccurrence, 0)
	for _, mention := range mangoTiptapMentionOccurrences(after) {
		key := mention.Kind + "\x00" + mention.UserID
		if remaining[key] > 0 {
			remaining[key]--
			continue
		}
		added = append(added, mention)
	}
	var output strings.Builder
	for _, mention := range added {
		if output.Len() > 0 {
			output.WriteByte(' ')
		}
		output.WriteString(`<span data-mango-mention="true" data-mango-mention-user-id="`)
		output.WriteString(html.EscapeString(mention.UserID))
		output.WriteString(`" data-mango-mention-kind="`)
		output.WriteString(html.EscapeString(mention.Kind))
		output.WriteString(`">`)
		output.WriteString(html.EscapeString(mention.Label))
		output.WriteString(`</span>`)
	}
	return output.String()
}

func (s *Server) handleEditorDataFormat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if !requireCompanyAccess(w, r, companyID) {
		return
	}
	gate, err := s.repo.GetEditorDataFormat(companyID)
	if err != nil {
		writeEditorJSONStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, gate)
}

func editorJSONDocumentFromPath(companyID, path string) (store.EditorJSONDocumentRef, bool, bool) {
	path = strings.TrimPrefix(strings.TrimSpace(path), editorJSONRoutePrefix)
	parts := strings.Split(path, "/")
	versions := len(parts) == 5 && parts[4] == "versions"
	if (len(parts) != 4 && !versions) || parts[2] != "documents" {
		return store.EditorJSONDocumentRef{}, false, false
	}
	ref := store.EditorJSONDocumentRef{
		CompanyID: companyID, ResourceType: parts[0],
		ResourceID: parts[1], DocumentID: parts[3],
	}
	if _, err := store.NormalizeEditorJSONDocumentRef(ref); err != nil {
		return store.EditorJSONDocumentRef{}, false, false
	}
	return ref, versions, true
}

func (s *Server) authorizeEditorJSON(w http.ResponseWriter, r *http.Request, actor ActorContext, ref store.EditorJSONDocumentRef) bool {
	switch ref.ResourceType {
	case store.EntityTypeNode, store.EntityTypeLogicGate, store.EntityTypeProject:
		if !isCanonicalUUID(ref.ResourceID) {
			writeError(w, http.StatusNotFound, "editor_document_route_not_found")
			return false
		}
		authorized, rejectCode, err := s.authorizeRealtimeEntityScope(
			actor, ref.CompanyID, ref.ResourceType, ref.ResourceID, store.EntityPermissionEdit,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_check_editor_access")
			return false
		}
		if !authorized {
			status := http.StatusForbidden
			if rejectCode == "resource_not_found" {
				status = http.StatusNotFound
			}
			writeError(w, status, rejectCode)
			return false
		}
		return true
	default:
		writeError(w, http.StatusNotFound, "editor_document_route_not_found")
		return false
	}
}

func (s *Server) authorizeEditorJSONRealtime(actor ActorContext, ref store.EditorJSONDocumentRef) (bool, string, error) {
	if actorRoleForCompany(actor, ref.CompanyID) == "" {
		return false, "company_access_denied", nil
	}
	switch ref.ResourceType {
	case store.EntityTypeNode, store.EntityTypeLogicGate, store.EntityTypeProject:
		return s.authorizeRealtimeEntityScope(actor, ref.CompanyID, ref.ResourceType, ref.ResourceID, store.EntityPermissionEdit)
	default:
		return false, "unsupported_scope", nil
	}
}

func (s *Server) handleEditorJSON(w http.ResponseWriter, r *http.Request) {
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
	ref, versions, ok := editorJSONDocumentFromPath(companyID, r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "editor_document_route_not_found")
		return
	}
	if !s.authorizeEditorJSON(w, r, actor, ref) {
		return
	}
	gate, err := s.repo.GetEditorDataFormat(companyID)
	if err != nil {
		writeEditorJSONStoreError(w, err)
		return
	}
	if gate.EditorFormat != store.EditorFormatTiptapJSON ||
		gate.MigrationState != store.EditorMigrationReady ||
		gate.ExpectedDocumentCount != gate.ConvertedDocumentCount {
		writeError(w, http.StatusConflict, "editor_format_mismatch")
		return
	}
	if versions {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		items, err := s.repo.ListEditorJSONVersions(ref, limit)
		if err != nil {
			writeEditorJSONStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"versions": items})
		return
	}

	switch r.Method {
	case http.MethodGet:
		snapshot, err := s.repo.GetEditorJSONSnapshot(ref)
		if err != nil {
			writeEditorJSONStoreError(w, err)
			return
		}
		if snapshot.Deleted {
			writeError(w, http.StatusGone, "editor_document_deleted")
			return
		}
		writeJSON(w, http.StatusOK, snapshot)
	case http.MethodPost:
		var request struct {
			OperationID   string                       `json:"operation_id"`
			ClientID      string                       `json:"client_id"`
			BaseRevision  int64                        `json:"base_revision"`
			SchemaVersion int                          `json:"schema_version"`
			Document      json.RawMessage              `json:"document"`
			Annotations   []store.EditorJSONAnnotation `json:"annotations"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		beforeCommit, err := s.repo.GetEditorJSONSnapshot(ref)
		if err != nil {
			writeEditorJSONStoreError(w, err)
			return
		}
		commit, err := s.repo.CommitEditorJSONDocument(store.EditorJSONCommitInput{
			Document: ref, OperationID: request.OperationID, ClientID: request.ClientID,
			ActorUserID: actor.User.UserID, BaseRevision: request.BaseRevision,
			SchemaVersion: request.SchemaVersion, JSONDocument: request.Document,
			Annotations: request.Annotations,
		})
		if err != nil {
			writeEditorJSONStoreError(w, err)
			return
		}
		if ref.ResourceType == store.EntityTypeNode || ref.ResourceType == store.EntityTypeProject || ref.ResourceType == store.EntityTypeLogicGate {
			addedMentions := mangoTiptapAddedMentionNotificationHTML(beforeCommit.JSONDocument, commit.JSONDocument)
			if addedMentions != "" {
				s.recordMentionNotificationsWithIdempotencyScope(
					r, ref.CompanyID, ref.ResourceType, ref.ResourceID, ref.DocumentID, "Text box", addedMentions, "editor-json:"+commit.OperationID,
				)
			}
		}
		s.wakeRealtimeSpine()
		writeJSON(w, http.StatusOK, commit)
	case http.MethodPatch:
		if ref.ResourceType != store.EntityTypeNode && ref.ResourceType != store.EntityTypeLogicGate && ref.ResourceType != store.EntityTypeProject {
			writeError(w, http.StatusMethodNotAllowed, "editor_metadata_not_supported")
			return
		}
		var request struct {
			Title       string                                         `json:"title"`
			Attachments []store.EditorCollaborationAttachmentReference `json:"attachments"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		commit, err := s.repo.UpdateEditorJSONMetadata(store.EditorCollaborationMetadataInput{
			Document: store.EditorDocumentRef{
				CompanyID: ref.CompanyID, ResourceType: ref.ResourceType,
				ResourceID: ref.ResourceID, DocumentID: ref.DocumentID,
			},
			Title: request.Title, Attachments: request.Attachments,
		})
		if err != nil {
			writeEditorJSONStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, commit)
	case http.MethodDelete:
		var request struct {
			OperationID  string `json:"operation_id"`
			ClientID     string `json:"client_id"`
			BaseRevision int64  `json:"base_revision"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		commit, err := s.repo.DeleteEditorJSONDocument(store.EditorJSONDeleteInput{
			Document: ref, OperationID: request.OperationID, ClientID: request.ClientID,
			ActorUserID: actor.User.UserID, BaseRevision: request.BaseRevision,
		})
		if err != nil {
			writeEditorJSONStoreError(w, err)
			return
		}

		s.wakeRealtimeSpine()
		writeJSON(w, http.StatusOK, commit)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func writeEditorJSONStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_editor_json_document")
	case errors.Is(err, store.ErrVersionConflict):
		writeError(w, http.StatusConflict, "editor_json_revision_conflict")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "editor_document_not_found")
	default:
		log.Printf("editor JSON store failure: %v", err)
		writeError(w, http.StatusInternalServerError, "editor_json_failed")
	}
}
