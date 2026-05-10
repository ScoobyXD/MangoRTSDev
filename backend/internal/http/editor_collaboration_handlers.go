package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

const editorCollaborationMaxDocumentHTMLBytes = 850_000

func (s *Server) handleEditorCollaborationEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	var req struct {
		CompanyID     string `json:"company_id"`
		EventType     string `json:"event_type"`
		EntityKind    string `json:"entity_kind"`
		EntityID      string `json:"entity_id"`
		InformationID string `json:"information_id,omitempty"`
		ClientID      string `json:"client_id"`
		ClientName    string `json:"client_name,omitempty"`
		DocumentHTML  string `json:"document_html,omitempty"`
		Revision      int64  `json:"revision,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.EventType = strings.TrimSpace(req.EventType)
	req.EntityKind = strings.TrimSpace(req.EntityKind)
	req.EntityID = strings.TrimSpace(req.EntityID)
	req.InformationID = strings.TrimSpace(req.InformationID)
	req.ClientID = strings.TrimSpace(req.ClientID)
	req.ClientName = strings.TrimSpace(req.ClientName)

	if req.CompanyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if req.EntityKind != "node" && req.EntityKind != "logic_gate" {
		writeError(w, http.StatusBadRequest, "entity_kind_required")
		return
	}
	if req.EntityID == "" {
		writeError(w, http.StatusBadRequest, "entity_id_required")
		return
	}
	if req.ClientID == "" {
		writeError(w, http.StatusBadRequest, "client_id_required")
		return
	}
	if req.EventType != "presence" && req.EventType != "document_update" && req.EventType != "leave" {
		writeError(w, http.StatusBadRequest, "event_type_required")
		return
	}
	if len(req.DocumentHTML) > editorCollaborationMaxDocumentHTMLBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "editor_document_too_large")
		return
	}

	if req.Revision <= 0 {
		req.Revision = time.Now().UTC().UnixMilli()
	}
	if actor, ok := authenticatedActor(r); ok && req.ClientName == "" {
		req.ClientName = strings.TrimSpace(actor.User.DisplayName)
		if req.ClientName == "" {
			req.ClientName = strings.TrimSpace(actor.User.Email)
		}
	}

	s.publishWorkspaceEvent(req.CompanyID, "editor_collaboration_event", map[string]any{
		"event_type":     req.EventType,
		"entity_kind":    req.EntityKind,
		"entity_id":      req.EntityID,
		"information_id": req.InformationID,
		"client_id":      req.ClientID,
		"client_name":    req.ClientName,
		"document_html":  req.DocumentHTML,
		"revision":       req.Revision,
	})
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":   "published",
		"revision": req.Revision,
	})
}
