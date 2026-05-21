package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type entityPermissionUpdateRequest struct {
	CompanyID   string                        `json:"company_id"`
	Permissions []store.EntityPermissionInput `json:"permissions"`
}

func (s *Server) entityPermissionActorUserID(r *http.Request, companyID string) string {
	actor, ok := authenticatedActor(r)
	if !ok || actorCanManageCompany(actor, companyID) {
		return ""
	}
	return strings.TrimSpace(actor.User.UserID)
}

func (s *Server) requireEntityAccess(w http.ResponseWriter, r *http.Request, companyID, entityType, entityID, accessLevel, notFoundCode string) bool {
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
	if actorCanManageCompany(actor, companyID) {
		return true
	}
	accessLevel, ok = store.NormalizeEntityPermission(accessLevel)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_entity_permission_check")
		return false
	}
	allowed, err := s.repo.UserCanAccessEntity(companyID, entityType, entityID, actor.User.UserID, accessLevel)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_entity_permission_check")
		return false
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, notFoundCode)
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_check_entity_permission")
		return false
	}
	if !allowed {
		if accessLevel == store.EntityPermissionView {
			writeError(w, http.StatusNotFound, notFoundCode)
		} else {
			writeError(w, http.StatusForbidden, "entity_access_denied")
		}
		return false
	}
	return true
}

func (s *Server) requireEntityView(w http.ResponseWriter, r *http.Request, companyID, entityType, entityID, notFoundCode string) bool {
	userID := s.entityPermissionActorUserID(r, companyID)
	if userID == "" {
		return true
	}
	allowed, err := s.repo.UserCanAccessEntity(companyID, entityType, entityID, userID, store.EntityPermissionView)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_entity_permission_check")
		return false
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, notFoundCode)
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_check_entity_permission")
		return false
	}
	if !allowed {
		writeError(w, http.StatusNotFound, notFoundCode)
		return false
	}
	return true
}

func (s *Server) requireEntityEdit(w http.ResponseWriter, r *http.Request, companyID, entityType, entityID, notFoundCode string) bool {
	return s.requireEntityAccess(w, r, companyID, entityType, entityID, store.EntityPermissionEdit, notFoundCode)
}

func (s *Server) requireEntityAdmin(w http.ResponseWriter, r *http.Request, companyID, entityType, entityID, notFoundCode string) bool {
	return s.requireEntityAccess(w, r, companyID, entityType, entityID, store.EntityPermissionAdmin, notFoundCode)
}

func (s *Server) filterVisibleNodes(r *http.Request, companyID string, nodes []domain.Node) ([]domain.Node, error) {
	userID := s.entityPermissionActorUserID(r, companyID)
	if userID == "" {
		return nodes, nil
	}
	out := make([]domain.Node, 0, len(nodes))
	for _, node := range nodes {
		allowed, err := s.repo.UserCanViewEntity(companyID, store.EntityTypeNode, node.NodeID, userID)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if allowed {
			out = append(out, node)
		}
	}
	return out, nil
}

func (s *Server) filterVisibleLogicGates(r *http.Request, companyID string, logicGates []domain.LogicGate) ([]domain.LogicGate, error) {
	userID := s.entityPermissionActorUserID(r, companyID)
	if userID == "" {
		return logicGates, nil
	}
	out := make([]domain.LogicGate, 0, len(logicGates))
	for _, logicGate := range logicGates {
		allowed, err := s.repo.UserCanViewEntity(companyID, store.EntityTypeLogicGate, logicGate.LogicGateID, userID)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if allowed {
			out = append(out, logicGate)
		}
	}
	return out, nil
}

func (s *Server) filterVisibleWorkItemLogicGates(r *http.Request, companyID string, items []store.WorkItemLogicGateInboxItem) ([]store.WorkItemLogicGateInboxItem, error) {
	userID := s.entityPermissionActorUserID(r, companyID)
	if userID == "" {
		return items, nil
	}
	out := make([]store.WorkItemLogicGateInboxItem, 0, len(items))
	for _, item := range items {
		allowed, err := s.repo.UserCanViewEntity(companyID, store.EntityTypeLogicGate, item.LogicGateID, userID)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if allowed {
			out = append(out, item)
		}
	}
	return out, nil
}

func visibleNodeIDs(nodes []domain.Node) map[string]bool {
	ids := make(map[string]bool, len(nodes))
	for _, node := range nodes {
		ids[node.NodeID] = true
	}
	return ids
}

func visibleLogicGateIDs(logicGates []domain.LogicGate) map[string]bool {
	ids := make(map[string]bool, len(logicGates))
	for _, logicGate := range logicGates {
		ids[logicGate.LogicGateID] = true
	}
	return ids
}

func filterNodeRelationshipsByVisibleNodes(items []domain.NodeRelationship, ids map[string]bool) []domain.NodeRelationship {
	out := make([]domain.NodeRelationship, 0, len(items))
	for _, item := range items {
		if ids[item.NodeIDA] && ids[item.NodeIDB] {
			out = append(out, item)
		}
	}
	return out
}

func filterNodeMapPositionsByVisibleNodes(items []domain.NodeMapPosition, ids map[string]bool) []domain.NodeMapPosition {
	out := make([]domain.NodeMapPosition, 0, len(items))
	for _, item := range items {
		if ids[item.NodeID] {
			out = append(out, item)
		}
	}
	return out
}

func (s *Server) filterVisibleNodeMapPositions(r *http.Request, companyID string, items []domain.NodeMapPosition) ([]domain.NodeMapPosition, error) {
	userID := s.entityPermissionActorUserID(r, companyID)
	if userID == "" {
		return items, nil
	}
	out := make([]domain.NodeMapPosition, 0, len(items))
	for _, item := range items {
		allowed, err := s.repo.UserCanViewEntity(companyID, store.EntityTypeNode, item.NodeID, userID)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if allowed {
			out = append(out, item)
		}
	}
	return out, nil
}

func filterLogicGateRelationshipsByVisibleGates(items []domain.LogicGateRelationship, ids map[string]bool) []domain.LogicGateRelationship {
	out := make([]domain.LogicGateRelationship, 0, len(items))
	for _, item := range items {
		if ids[item.LogicGateIDA] && ids[item.LogicGateIDB] {
			out = append(out, item)
		}
	}
	return out
}

func filterLogicGateMapPositionsByVisibleGates(items []domain.LogicGateMapPosition, ids map[string]bool) []domain.LogicGateMapPosition {
	out := make([]domain.LogicGateMapPosition, 0, len(items))
	for _, item := range items {
		if ids[item.LogicGateID] {
			out = append(out, item)
		}
	}
	return out
}

func (s *Server) filterVisibleLogicGateMapPositions(r *http.Request, companyID string, items []domain.LogicGateMapPosition) ([]domain.LogicGateMapPosition, error) {
	userID := s.entityPermissionActorUserID(r, companyID)
	if userID == "" {
		return items, nil
	}
	out := make([]domain.LogicGateMapPosition, 0, len(items))
	for _, item := range items {
		allowed, err := s.repo.UserCanViewEntity(companyID, store.EntityTypeLogicGate, item.LogicGateID, userID)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if allowed {
			out = append(out, item)
		}
	}
	return out, nil
}

func filterCompanyExplorerItemsForVisibleEntities(items []domain.CompanyExplorerFolderItem, nodeIDs map[string]bool, logicGateIDs map[string]bool) []domain.CompanyExplorerFolderItem {
	out := make([]domain.CompanyExplorerFolderItem, 0, len(items))
	for _, item := range items {
		switch item.ItemType {
		case "node":
			if nodeIDs[item.ItemID] {
				out = append(out, item)
			}
		case "logic_gate":
			if logicGateIDs[item.ItemID] {
				out = append(out, item)
			}
		default:
			out = append(out, item)
		}
	}
	return out
}

func (s *Server) filterVisibleCompanyExplorerFolderItems(r *http.Request, companyID string, items []domain.CompanyExplorerFolderItem) ([]domain.CompanyExplorerFolderItem, error) {
	userID := s.entityPermissionActorUserID(r, companyID)
	if userID == "" {
		return items, nil
	}
	out := make([]domain.CompanyExplorerFolderItem, 0, len(items))
	for _, item := range items {
		entityType, ok := companyExplorerEntityType(item.ItemType)
		if !ok {
			out = append(out, item)
			continue
		}
		allowed, err := s.repo.UserCanViewEntity(companyID, entityType, item.ItemID, userID)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if allowed {
			out = append(out, item)
		}
	}
	return out, nil
}

func companyExplorerEntityType(itemType string) (string, bool) {
	switch strings.TrimSpace(itemType) {
	case "node":
		return store.EntityTypeNode, true
	case "logic_gate":
		return store.EntityTypeLogicGate, true
	default:
		return "", false
	}
}

func companyExplorerEntityNotFoundCode(itemType string) string {
	switch strings.TrimSpace(itemType) {
	case "node":
		return "node_not_found"
	case "logic_gate":
		return "logic_gate_not_found"
	default:
		return "company_explorer_folder_or_item_not_found"
	}
}

func logicGateIDFromKanbanBoardID(boardID string) string {
	boardID = strings.TrimSpace(boardID)
	if !store.IsLogicGateKanbanBoardID(boardID) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(boardID, "logic-gate:"))
}

func (s *Server) requireKanbanBoardView(w http.ResponseWriter, r *http.Request, companyID, boardID, logicGateID string) bool {
	if strings.TrimSpace(logicGateID) == "" {
		logicGateID = logicGateIDFromKanbanBoardID(boardID)
	}
	if strings.TrimSpace(logicGateID) == "" {
		return true
	}
	return s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found")
}

func (s *Server) filterVisibleKanbanBoards(r *http.Request, companyID string, items []domain.KanbanBoard) ([]domain.KanbanBoard, error) {
	userID := s.entityPermissionActorUserID(r, companyID)
	if userID == "" {
		return items, nil
	}
	out := make([]domain.KanbanBoard, 0, len(items))
	for _, item := range items {
		logicGateID := logicGateIDFromKanbanBoardID(item.BoardID)
		if item.LogicGateID != nil && strings.TrimSpace(*item.LogicGateID) != "" {
			logicGateID = strings.TrimSpace(*item.LogicGateID)
		}
		if logicGateID == "" {
			out = append(out, item)
			continue
		}
		allowed, err := s.repo.UserCanViewEntity(companyID, store.EntityTypeLogicGate, logicGateID, userID)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if allowed {
			out = append(out, item)
		}
	}
	return out, nil
}

func (s *Server) filterVisibleKanbanCards(r *http.Request, companyID string, items []domain.KanbanCard) ([]domain.KanbanCard, error) {
	userID := s.entityPermissionActorUserID(r, companyID)
	if userID == "" {
		return items, nil
	}
	out := make([]domain.KanbanCard, 0, len(items))
	for _, item := range items {
		nodeAllowed, err := s.repo.UserCanViewEntity(companyID, store.EntityTypeNode, item.NodeID, userID)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !nodeAllowed {
			continue
		}
		if item.LogicGateID != nil && strings.TrimSpace(*item.LogicGateID) != "" {
			gateAllowed, err := s.repo.UserCanViewEntity(companyID, store.EntityTypeLogicGate, *item.LogicGateID, userID)
			if errors.Is(err, store.ErrNotFound) {
				continue
			}
			if err != nil {
				return nil, err
			}
			if !gateAllowed {
				continue
			}
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *Server) requireKanbanCardView(w http.ResponseWriter, r *http.Request, companyID, boardID, cardID string) bool {
	userID := s.entityPermissionActorUserID(r, companyID)
	if userID == "" {
		return true
	}
	cards, err := s.repo.ListKanbanCards(companyID, boardID, store.KanbanCardQuery{Limit: store.KanbanMaxCardsLimit})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_kanban_card_query")
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_kanban_card")
		return false
	}
	for _, card := range cards {
		if card.CardID != cardID {
			continue
		}
		if !s.requireEntityView(w, r, companyID, store.EntityTypeNode, card.NodeID, "kanban_card_not_found") {
			return false
		}
		if card.LogicGateID != nil && strings.TrimSpace(*card.LogicGateID) != "" {
			if !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, *card.LogicGateID, "kanban_card_not_found") {
				return false
			}
		}
		return true
	}
	writeError(w, http.StatusNotFound, "kanban_card_not_found")
	return false
}

func (s *Server) handleEntityPermissions(w http.ResponseWriter, r *http.Request, entityType, entityID, notFoundCode, eventType string) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireEntityView(w, r, companyID, entityType, entityID, notFoundCode) {
			return
		}
		permissions, err := s.repo.ListEntityPermissions(companyID, entityType, entityID)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_entity_permissions")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, notFoundCode)
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_entity_permissions")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"company_id":  companyID,
			"entity_type": entityType,
			"entity_id":   entityID,
			"permissions": permissions,
		})
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req entityPermissionUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if !requireCompanyManager(w, r, req.CompanyID) {
		return
	}
	permissions, err := s.repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:   req.CompanyID,
		EntityType:  entityType,
		EntityID:    entityID,
		Permissions: req.Permissions,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_entity_permissions")
		return
	}
	if errors.Is(err, store.ErrAssigneeNotInCompany) {
		writeError(w, http.StatusBadRequest, "permission_user_not_in_company")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, notFoundCode)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_update_entity_permissions")
		return
	}
	payload := map[string]any{
		"entity_type": entityType,
		"entity_id":   entityID,
		"permissions": permissions,
	}
	if entityType == store.EntityTypeNode {
		payload["node_id"] = entityID
	} else if entityType == store.EntityTypeLogicGate {
		payload["logic_gate_id"] = entityID
	}
	s.publishWorkspaceEvent(req.CompanyID, eventType, payload)
	writeJSON(w, http.StatusOK, map[string]any{
		"company_id":  req.CompanyID,
		"entity_type": entityType,
		"entity_id":   entityID,
		"permissions": permissions,
	})
}
