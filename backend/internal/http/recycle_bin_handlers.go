package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleRecycleBin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if !requireCompanyAccess(w, r, companyID) {
		return
	}
	deletedByUserID, ok := requireAuthenticatedActorUserID(w, r)
	if !ok {
		return
	}
	items, err := s.repo.ListRecycleBinItems(companyID, deletedByUserID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_recycle_bin")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleRecycleBinRestore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID string   `json:"company_id"`
		ItemIDs   []string `json:"item_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if !requireCompanyAccess(w, r, req.CompanyID) {
		return
	}
	deletedByUserID, ok := requireAuthenticatedActorUserID(w, r)
	if !ok {
		return
	}
	result, err := s.repo.RestoreRecycleBinItems(req.CompanyID, deletedByUserID, req.ItemIDs)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "recycle_bin_item_ids_required")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "recycle_bin_item_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_restore_recycle_bin_items")
		return
	}
	s.publishCompanyExplorerRestoredTargets(req.CompanyID, result.Targets)
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleRecycleBinPermanentDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID string   `json:"company_id"`
		ItemIDs   []string `json:"item_ids"`
	}
	if r.Method == http.MethodDelete && r.Body == nil {
		req.CompanyID = strings.TrimSpace(r.URL.Query().Get("company_id"))
		req.ItemIDs = r.URL.Query()["item_id"]
	} else if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if !requireCompanyAccess(w, r, req.CompanyID) {
		return
	}
	deletedByUserID, ok := requireAuthenticatedActorUserID(w, r)
	if !ok {
		return
	}
	if err := s.repo.PermanentlyDeleteRecycleBinItems(req.CompanyID, deletedByUserID, req.ItemIDs); errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "recycle_bin_item_ids_required")
		return
	} else if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "recycle_bin_item_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_recycle_bin_items")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func requireAuthenticatedActorUserID(w http.ResponseWriter, r *http.Request) (string, bool) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return "", false
	}
	userID := strings.TrimSpace(actor.User.UserID)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return "", false
	}
	return userID, true
}

func (s *Server) publishCompanyExplorerRestoredTargets(companyID string, targets []store.CompanyExplorerDeletedTarget) {
	for _, target := range targets {
		switch target.Kind {
		case "folder":
			s.publishWorkspaceEvent(companyID, "company_explorer_folder_created", map[string]any{"folder_id": target.ID, "folder_kind": target.FolderKind})
		case "node":
			s.publishWorkspaceEvent(companyID, "node_created", map[string]any{"node_id": target.ID})
		case "logic_gate":
			s.publishWorkspaceEvent(companyID, "logic_gate_created", map[string]any{"logic_gate_id": target.ID})
		case "project":
			s.publishWorkspaceEvent(companyID, "project_created", map[string]any{"project_id": target.ID})
		case "kanban":
			s.publishWorkspaceEvent(companyID, "kanban_board_saved", map[string]any{"board_id": target.ID})
		}
	}
}
