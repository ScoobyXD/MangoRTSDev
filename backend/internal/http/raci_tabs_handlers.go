package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
)

type raciTabFolderRequest struct {
	CompanyID      string  `json:"company_id"`
	Role           string  `json:"role"`
	ParentFolderID *string `json:"parent_folder_id"`
	Name           string  `json:"name"`
}

type raciTabLayoutRequest struct {
	CompanyID string `json:"company_id"`
	Role      string `json:"role"`
	Entries   []struct {
		EntryType      string  `json:"entry_type"`
		EntryID        string  `json:"entry_id"`
		ParentFolderID *string `json:"parent_folder_id"`
		Position       int     `json:"position"`
	} `json:"entries"`
}

func (s *Server) handleRACITabs(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/raci-tabs" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	actor, ok := s.requireRACITabCompanyAccess(w, r, companyID)
	if !ok {
		return
	}
	role, roleOK := store.NormalizeRACITabRole(r.URL.Query().Get("role"))
	if !roleOK {
		writeError(w, http.StatusBadRequest, "invalid_raci_tab_role")
		return
	}
	offset := 0
	if cursor := strings.TrimSpace(r.URL.Query().Get("cursor")); cursor != "" {
		parsed, err := strconv.Atoi(cursor)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, "invalid_raci_tab_cursor")
			return
		}
		offset = parsed
	}
	limit := 0
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "invalid_raci_tab_limit")
			return
		}
		limit = parsed
	}
	page, err := s.repo.ListRACITabBranch(store.RACITabBranchInput{
		CompanyID:      companyID,
		UserID:         actor.User.UserID,
		Role:           role,
		ParentFolderID: strings.TrimSpace(r.URL.Query().Get("parent_folder_id")),
		Offset:         offset,
		Limit:          limit,
	})
	if err != nil {
		writeRACITabStoreError(w, err, "failed_to_list_raci_tab")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, page)
}

func (s *Server) handleRACITabLogicGateCounts(w http.ResponseWriter, r *http.Request) {
	prefix := "/v1/raci-tabs/logic-gates/"
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, prefix), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "counts" {
		writeError(w, http.StatusNotFound, "raci_tab_item_not_found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	actor, ok := s.requireRACITabCompanyAccess(w, r, companyID)
	if !ok {
		return
	}
	counts, err := s.repo.GetRACITabLogicGateCounts(store.RACITabLogicGateCountsInput{
		CompanyID:   companyID,
		UserID:      actor.User.UserID,
		LogicGateID: parts[0],
	})
	if err != nil {
		writeRACITabStoreError(w, err, "failed_to_read_raci_tab_counts")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, counts)
}

func (s *Server) handleRACITabFolders(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/raci-tab-folders" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req raciTabFolderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID := strings.TrimSpace(req.CompanyID)
	actor, ok := s.requireRACITabCompanyAccess(w, r, companyID)
	if !ok {
		return
	}
	parentFolderID := ""
	if req.ParentFolderID != nil {
		parentFolderID = strings.TrimSpace(*req.ParentFolderID)
	}
	folder, err := s.repo.CreateRACITabFolder(store.RACITabFolderCreateInput{
		CompanyID:      companyID,
		UserID:         actor.User.UserID,
		Role:           req.Role,
		ParentFolderID: parentFolderID,
		Name:           req.Name,
	})
	if err != nil {
		writeRACITabStoreError(w, err, "failed_to_create_raci_tab_folder")
		return
	}
	writeJSON(w, http.StatusCreated, folder)
}

func (s *Server) handleRACITabFolderByID(w http.ResponseWriter, r *http.Request) {
	folderID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/raci-tab-folders/"), "/")
	if folderID == "" || strings.Contains(folderID, "/") {
		writeError(w, http.StatusNotFound, "raci_tab_folder_not_found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var req raciTabFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		companyID := strings.TrimSpace(req.CompanyID)
		actor, ok := s.requireRACITabCompanyAccess(w, r, companyID)
		if !ok {
			return
		}
		folder, err := s.repo.RenameRACITabFolder(store.RACITabFolderRenameInput{
			CompanyID: companyID,
			UserID:    actor.User.UserID,
			FolderID:  folderID,
			Name:      req.Name,
		})
		if err != nil {
			writeRACITabStoreError(w, err, "failed_to_rename_raci_tab_folder")
			return
		}
		writeJSON(w, http.StatusOK, folder)
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		actor, ok := s.requireRACITabCompanyAccess(w, r, companyID)
		if !ok {
			return
		}
		if err := s.repo.DeleteRACITabFolder(store.RACITabFolderDeleteInput{
			CompanyID: companyID,
			UserID:    actor.User.UserID,
			FolderID:  folderID,
		}); err != nil {
			writeRACITabStoreError(w, err, "failed_to_delete_raci_tab_folder")
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleRACITabLayout(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/raci-tabs/layout" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req raciTabLayoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID := strings.TrimSpace(req.CompanyID)
	actor, ok := s.requireRACITabCompanyAccess(w, r, companyID)
	if !ok {
		return
	}
	entries := make([]store.RACITabLayoutEntry, 0, len(req.Entries))
	for _, entry := range req.Entries {
		parentFolderID := ""
		if entry.ParentFolderID != nil {
			parentFolderID = strings.TrimSpace(*entry.ParentFolderID)
		}
		entries = append(entries, store.RACITabLayoutEntry{
			EntryType:      entry.EntryType,
			EntryID:        entry.EntryID,
			ParentFolderID: parentFolderID,
			Position:       entry.Position,
		})
	}
	if err := s.repo.ApplyRACITabLayout(store.RACITabLayoutInput{
		CompanyID: companyID,
		UserID:    actor.User.UserID,
		Role:      req.Role,
		Entries:   entries,
	}); err != nil {
		writeRACITabStoreError(w, err, "failed_to_update_raci_tab_layout")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (s *Server) requireRACITabCompanyAccess(w http.ResponseWriter, r *http.Request, companyID string) (ActorContext, bool) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return ActorContext{}, false
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return ActorContext{}, false
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return ActorContext{}, false
	}
	return actor, true
}

func writeRACITabStoreError(w http.ResponseWriter, err error, fallback string) {
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_raci_tab")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "raci_tab_not_found")
		return
	}
	if errors.Is(err, store.ErrAlreadyExists) {
		writeError(w, http.StatusConflict, "raci_tab_already_exists")
		return
	}
	writeError(w, http.StatusInternalServerError, fallback)
}
