package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleNodeRelationships(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		etag, notModified, err := s.writeWorkspaceEventNotModified(w, r, companyID, "node-relationships", []store.DomainEventStreamQuery{
			workspaceEventQuery(nodeRelationshipWorkspaceEventTypes...),
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_read_workspace_version")
			return
		}
		if notModified {
			return
		}
		items, err := s.repo.ListNodeRelationships(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_node_relationships")
			return
		}
		writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{"relationships": items}, etag)
		return
	}

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID string `json:"company_id"`
		NodeIDA   string `json:"node_id_a"`
		NodeIDB   string `json:"node_id_b"`
		APosition string `json:"a_position"`
		BPosition string `json:"b_position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.NodeIDA) == "" || strings.TrimSpace(req.NodeIDB) == "" {
		writeError(w, http.StatusBadRequest, "company_id_node_ids_required")
		return
	}
	validPositions := map[string]bool{"Parent": true, "Child": true, "Peer": true}
	if !validPositions[req.APosition] || !validPositions[req.BPosition] {
		writeError(w, http.StatusBadRequest, "invalid_relationship_position")
		return
	}
	if strings.TrimSpace(req.NodeIDA) == strings.TrimSpace(req.NodeIDB) {
		writeError(w, http.StatusBadRequest, "self_relationship_not_allowed")
		return
	}
	if !isLegalNodeRelationshipPositionPair(req.APosition, req.BPosition) {
		writeError(w, http.StatusBadRequest, "illegal_relationship_pair")
		return
	}

	item, err := s.repo.CreateNodeRelationship(req.CompanyID, req.NodeIDA, req.NodeIDB, req.APosition, req.BPosition)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "node_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_node_relationship")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "relationship_created", map[string]any{"node_relationship_id": item.NodeRelationshipID, "node_id_a": item.NodeIDA, "node_id_b": item.NodeIDB, "relationship": item})
	writeJSON(w, http.StatusCreated, item)
}

func isLegalNodeRelationshipPositionPair(aPosition, bPosition string) bool {
	return (aPosition == "Parent" && bPosition == "Child") ||
		(aPosition == "Child" && bPosition == "Parent") ||
		(aPosition == "Peer" && bPosition == "Peer")
}

func (s *Server) handleNodeRelationshipByID(w http.ResponseWriter, r *http.Request) {
	relationshipID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/node-relationships/"))
	if relationshipID == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if strings.Contains(relationshipID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if err := s.repo.DeleteNodeRelationship(companyID, relationshipID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "relationship_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_node_relationship")
		return
	}
	s.publishWorkspaceEvent(companyID, "relationship_deleted", map[string]any{"node_relationship_id": relationshipID})
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
