package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleLogicGateRelationships(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		etag, notModified, err := s.writeWorkspaceEventNotModified(w, r, companyID, "logic-gate-relationships", []store.DomainEventStreamQuery{
			workspaceEventQuery(logicGateRelationshipWorkspaceEventTypes...),
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_read_workspace_version")
			return
		}
		if notModified {
			return
		}
		items, err := s.repo.ListLogicGateRelationships(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_relationships")
			return
		}
		userID := s.entityPermissionActorUserID(r, companyID)
		var logicGates []domain.LogicGate
		if userID != "" {
			logicGates, err = s.repo.ListVisibleLogicGates(companyID, userID)
		} else {
			logicGates, err = s.repo.ListLogicGates(companyID)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gates")
			return
		}
		items = filterLogicGateRelationshipsByVisibleGates(items, visibleLogicGateIDs(logicGates))
		writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{"logic_gate_relationships": items}, etag)
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID    string `json:"company_id"`
		LogicGateIDA string `json:"logic_gate_id_a"`
		LogicGateIDB string `json:"logic_gate_id_b"`
		APosition    string `json:"a_position"`
		BPosition    string `json:"b_position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.LogicGateIDA) == "" || strings.TrimSpace(req.LogicGateIDB) == "" {
		writeError(w, http.StatusBadRequest, "company_id_logic_gate_ids_required")
		return
	}
	validPositions := map[string]bool{"Input": true, "Output": true}
	if !validPositions[req.APosition] || !validPositions[req.BPosition] {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_relationship_position")
		return
	}
	if strings.TrimSpace(req.LogicGateIDA) == strings.TrimSpace(req.LogicGateIDB) {
		writeError(w, http.StatusBadRequest, "self_relationship_not_allowed")
		return
	}
	if !isLegalLogicGateRelationshipPositionPair(req.APosition, req.BPosition) {
		writeError(w, http.StatusBadRequest, "illegal_logic_gate_relationship_pair")
		return
	}
	if !s.requireEntityView(w, r, req.CompanyID, store.EntityTypeLogicGate, req.LogicGateIDA, "logic_gate_not_found") {
		return
	}
	if !s.requireEntityView(w, r, req.CompanyID, store.EntityTypeLogicGate, req.LogicGateIDB, "logic_gate_not_found") {
		return
	}
	item, err := s.repo.CreateLogicGateRelationship(req.CompanyID, req.LogicGateIDA, req.LogicGateIDB, req.APosition, req.BPosition)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_logic_gate_relationship")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "logic_gate_relationship_created", map[string]any{
		"logic_gate_relationship_id": item.LogicGateRelationshipID,
		"logic_gate_id_a":            item.LogicGateIDA,
		"logic_gate_id_b":            item.LogicGateIDB,
		"logic_gate_relationship":    item,
	})
	writeJSON(w, http.StatusCreated, item)
}

func isLegalLogicGateRelationshipPositionPair(aPosition, bPosition string) bool {
	return (aPosition == "Input" && bPosition == "Output") ||
		(aPosition == "Output" && bPosition == "Input")
}

func (s *Server) handleLogicGateRelationshipByID(w http.ResponseWriter, r *http.Request) {
	relationshipID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/logic-gate-relationships/"))
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
	relationships, err := s.repo.ListLogicGateRelationships(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_relationship")
		return
	}
	found := false
	for _, relationship := range relationships {
		if relationship.LogicGateRelationshipID != relationshipID {
			continue
		}
		found = true
		if !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, relationship.LogicGateIDA, "logic_gate_relationship_not_found") {
			return
		}
		if !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, relationship.LogicGateIDB, "logic_gate_relationship_not_found") {
			return
		}
		break
	}
	if !found {
		writeError(w, http.StatusNotFound, "logic_gate_relationship_not_found")
		return
	}
	if err := s.repo.DeleteLogicGateRelationship(companyID, relationshipID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_relationship_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_logic_gate_relationship")
		return
	}
	s.publishWorkspaceEvent(companyID, "logic_gate_relationship_deleted", map[string]any{"logic_gate_relationship_id": relationshipID})
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
