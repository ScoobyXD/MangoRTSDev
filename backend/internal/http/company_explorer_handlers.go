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

func isValidCompanyExplorerFolderKind(value string) bool {
	return value == "node" || value == "logic_gate"
}

func isValidCompanyExplorerItemType(value string) bool {
	return isValidCompanyExplorerFolderKind(value) || value == "kanban"
}
