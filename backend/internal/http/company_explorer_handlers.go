package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleCompanyExplorerFolders(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		folderKind := strings.TrimSpace(r.URL.Query().Get("folder_kind"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if folderKind != "" && !isValidCompanyExplorerFolderKind(folderKind) {
			writeError(w, http.StatusBadRequest, "invalid_folder_kind")
			return
		}
		items, err := s.repo.ListCompanyExplorerFolders(companyID, folderKind)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
			return
		}
		if sets, shouldFilter, err := s.assignmentSetsForRequest(r, companyID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_filter_company_explorer_folders")
			return
		} else if shouldFilter {
			items = filterFoldersByAssignments(items, sets)
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"folders": items})
		return
	}

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID      string `json:"company_id"`
		ParentFolderID string `json:"parent_folder_id"`
		FolderKind     string `json:"folder_kind"`
		Name           string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.ParentFolderID = strings.TrimSpace(req.ParentFolderID)
	req.FolderKind = strings.TrimSpace(req.FolderKind)
	req.Name = strings.TrimSpace(req.Name)
	if req.CompanyID == "" || req.Name == "" || !isValidCompanyExplorerFolderKind(req.FolderKind) {
		writeError(w, http.StatusBadRequest, "company_id_folder_kind_name_required")
		return
	}
	item, err := s.repo.CreateCompanyExplorerFolder(req.CompanyID, req.ParentFolderID, req.FolderKind, req.Name)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "parent_folder_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_company_explorer_folder")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_created", map[string]any{"folder_id": item.FolderID, "folder": item})
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleCompanyExplorerFolderByID(w http.ResponseWriter, r *http.Request) {
	folderID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/company-explorer/folders/"))
	if folderID == "" || strings.Contains(folderID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}

	if r.Method == http.MethodPut {
		var req struct {
			CompanyID      string  `json:"company_id"`
			ParentFolderID *string `json:"parent_folder_id"`
			Name           string  `json:"name"`
			Position       int     `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		req.Name = strings.TrimSpace(req.Name)
		if req.CompanyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		var item domain.CompanyExplorerFolder
		var err error
		changed := false
		if req.ParentFolderID != nil || req.Position > 0 {
			var parentFolderID *string
			if req.ParentFolderID != nil {
				parent := strings.TrimSpace(*req.ParentFolderID)
				parentFolderID = &parent
			}
			item, err = s.repo.MoveCompanyExplorerFolder(req.CompanyID, folderID, parentFolderID, req.Position)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
				return
			}
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusBadRequest, "invalid_company_explorer_folder_move")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_move_company_explorer_folder")
				return
			}
			changed = true
		}
		if req.Name != "" {
			item, err = s.repo.RenameCompanyExplorerFolder(req.CompanyID, folderID, req.Name)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_rename_company_explorer_folder")
				return
			}
			changed = true
		}
		if !changed {
			writeError(w, http.StatusBadRequest, "company_explorer_folder_update_required")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_updated", map[string]any{"folder_id": item.FolderID, "folder": item})
		writeJSON(w, http.StatusOK, item)
		return
	}

	if r.Method == http.MethodDelete {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if err := s.repo.DeleteCompanyExplorerFolder(companyID, folderID); errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
			return
		} else if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_delete_company_explorer_folder")
			return
		}
		s.publishWorkspaceEvent(companyID, "company_explorer_folder_deleted", map[string]any{"folder_id": folderID})
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}

	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func (s *Server) handleCompanyExplorerDeleteBatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	var req struct {
		CompanyID string `json:"company_id"`
		Targets   []struct {
			Kind       string `json:"kind"`
			ID         string `json:"id"`
			FolderKind string `json:"folder_kind"`
		} `json:"targets"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if req.CompanyID == "" || len(req.Targets) == 0 || len(req.Targets) > store.CompanyExplorerFolderItemBatchMaxItems {
		writeError(w, http.StatusBadRequest, "company_delete_targets_required")
		return
	}

	type deleteTarget struct {
		Kind       string `json:"kind"`
		ID         string `json:"id"`
		FolderKind string `json:"folder_kind,omitempty"`
	}
	targets := make([]deleteTarget, 0, len(req.Targets))
	seen := map[string]bool{}
	for _, target := range req.Targets {
		item := deleteTarget{
			Kind:       strings.TrimSpace(target.Kind),
			ID:         strings.TrimSpace(target.ID),
			FolderKind: strings.TrimSpace(target.FolderKind),
		}
		if item.ID == "" {
			writeError(w, http.StatusBadRequest, "invalid_company_explorer_delete_target")
			return
		}
		if item.Kind == "folder" {
			if item.FolderKind != "" && !isValidCompanyExplorerFolderKind(item.FolderKind) {
				writeError(w, http.StatusBadRequest, "invalid_company_explorer_delete_target")
				return
			}
		} else if item.Kind != "node" && item.Kind != "logic_gate" && item.Kind != "kanban" {
			writeError(w, http.StatusBadRequest, "invalid_company_explorer_delete_target")
			return
		}
		key := item.Kind + ":" + item.ID
		if seen[key] {
			continue
		}
		seen[key] = true
		targets = append(targets, item)
	}
	if len(targets) == 0 {
		writeError(w, http.StatusBadRequest, "company_delete_targets_required")
		return
	}
	logicGateBoardIDs := map[string]bool{}
	for _, target := range targets {
		if target.Kind == "logic_gate" {
			logicGateBoardIDs[store.LogicGateKanbanBoardID(target.ID)] = true
		}
	}
	if len(logicGateBoardIDs) > 0 {
		filtered := targets[:0]
		for _, target := range targets {
			if target.Kind == "kanban" && logicGateBoardIDs[target.ID] {
				continue
			}
			filtered = append(filtered, target)
		}
		targets = filtered
	}

	for _, target := range targets {
		switch target.Kind {
		case "folder":
			err := s.repo.DeleteCompanyExplorerFolder(req.CompanyID, target.ID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_delete_company_explorer_folder")
				return
			}
			s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_deleted", map[string]any{"folder_id": target.ID})
		case "node":
			err := s.repo.DeleteNode(req.CompanyID, target.ID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "node_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_delete_node")
				return
			}
			s.publishWorkspaceEvent(req.CompanyID, "node_deleted", map[string]any{"node_id": target.ID})
		case "logic_gate":
			err := s.repo.DeleteLogicGate(req.CompanyID, target.ID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "logic_gate_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_delete_logic_gate")
				return
			}
			s.publishWorkspaceEvent(req.CompanyID, "logic_gate_deleted", map[string]any{"logic_gate_id": target.ID})
		case "kanban":
			err := s.repo.DeleteKanbanBoard(req.CompanyID, target.ID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "kanban_board_not_found")
				return
			}
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusConflict, "attached_kanban_board_cannot_be_deleted")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_delete_kanban_board")
				return
			}
			s.publishWorkspaceEvent(req.CompanyID, "kanban_board_deleted", map[string]any{"board_id": target.ID})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "targets": targets})
}

func (s *Server) handleCompanyExplorerFolderItems(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
		itemType := strings.TrimSpace(r.URL.Query().Get("item_type"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if itemType != "" && !isValidCompanyExplorerItemType(itemType) {
			writeError(w, http.StatusBadRequest, "invalid_item_type")
			return
		}
		items, err := s.repo.ListCompanyExplorerFolderItems(companyID, folderID, itemType)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
			return
		}
		if sets, shouldFilter, err := s.assignmentSetsForRequest(r, companyID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_filter_company_explorer_folder_items")
			return
		} else if shouldFilter {
			items = filterFolderItemsByAssignments(items, sets)
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"folder_items": items})
		return
	}

	if r.Method == http.MethodPost {
		var req struct {
			CompanyID string `json:"company_id"`
			FolderID  string `json:"folder_id"`
			ItemType  string `json:"item_type"`
			ItemID    string `json:"item_id"`
			Position  int    `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		req.FolderID = strings.TrimSpace(req.FolderID)
		req.ItemType = strings.TrimSpace(req.ItemType)
		req.ItemID = strings.TrimSpace(req.ItemID)
		if req.CompanyID == "" || req.FolderID == "" || req.ItemID == "" || !isValidCompanyExplorerItemType(req.ItemType) {
			writeError(w, http.StatusBadRequest, "company_folder_item_required")
			return
		}
		item, deletedRelationshipIDs, err := s.repo.AssignCompanyExplorerFolderItem(req.CompanyID, req.FolderID, req.ItemType, req.ItemID, req.Position)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "company_explorer_folder_or_item_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_assign_company_explorer_folder_item")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_item_assigned", map[string]any{"folder_item": item})
		for _, relationshipID := range deletedRelationshipIDs {
			if req.ItemType == "node" {
				s.publishWorkspaceEvent(req.CompanyID, "relationship_deleted", map[string]any{"node_relationship_id": relationshipID})
			} else if req.ItemType == "logic_gate" {
				s.publishWorkspaceEvent(req.CompanyID, "logic_gate_relationship_deleted", map[string]any{"logic_gate_relationship_id": relationshipID})
			}
		}
		writeJSON(w, http.StatusOK, item)
		return
	}

	if r.Method == http.MethodDelete {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		itemType := strings.TrimSpace(r.URL.Query().Get("item_type"))
		itemID := strings.TrimSpace(r.URL.Query().Get("item_id"))
		if companyID == "" || itemID == "" || !isValidCompanyExplorerItemType(itemType) {
			writeError(w, http.StatusBadRequest, "company_item_required")
			return
		}
		if err := s.repo.RemoveCompanyExplorerFolderItem(companyID, itemType, itemID); errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "company_explorer_folder_item_not_found")
			return
		} else if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_remove_company_explorer_folder_item")
			return
		}
		s.publishWorkspaceEvent(companyID, "company_explorer_folder_item_removed", map[string]any{"item_type": itemType, "item_id": itemID})
		writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
		return
	}

	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func (s *Server) handleCompanyExplorerFolderItemsBatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	var req struct {
		CompanyID   string                                           `json:"company_id"`
		Assignments []store.CompanyExplorerFolderItemAssignmentInput `json:"assignments"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if req.CompanyID == "" || len(req.Assignments) == 0 || len(req.Assignments) > store.CompanyExplorerFolderItemBatchMaxItems {
		writeError(w, http.StatusBadRequest, "company_assignments_required")
		return
	}
	for index := range req.Assignments {
		req.Assignments[index].FolderID = strings.TrimSpace(req.Assignments[index].FolderID)
		req.Assignments[index].ItemType = strings.TrimSpace(req.Assignments[index].ItemType)
		req.Assignments[index].ItemID = strings.TrimSpace(req.Assignments[index].ItemID)
		if req.Assignments[index].FolderID == "" || req.Assignments[index].ItemID == "" || !isValidCompanyExplorerItemType(req.Assignments[index].ItemType) {
			writeError(w, http.StatusBadRequest, "invalid_company_explorer_assignment")
			return
		}
	}

	items, deleted, err := s.repo.AssignCompanyExplorerFolderItems(req.CompanyID, req.Assignments)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_explorer_folder_or_item_not_found")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_folder_item_batch")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_assign_company_explorer_folder_items")
		return
	}
	for _, item := range items {
		s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_item_assigned", map[string]any{"folder_item": item})
	}
	for _, result := range deleted {
		for _, relationshipID := range result.RelationshipIDs {
			if result.ItemType == "node" {
				s.publishWorkspaceEvent(req.CompanyID, "relationship_deleted", map[string]any{"node_relationship_id": relationshipID})
			} else if result.ItemType == "logic_gate" {
				s.publishWorkspaceEvent(req.CompanyID, "logic_gate_relationship_deleted", map[string]any{"logic_gate_relationship_id": relationshipID})
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"folder_items": items, "deleted_relationships": deleted})
}

func isValidCompanyExplorerFolderKind(value string) bool {
	return value == "node" || value == "logic_gate"
}

func isValidCompanyExplorerItemType(value string) bool {
	return isValidCompanyExplorerFolderKind(value) || value == "kanban"
}
