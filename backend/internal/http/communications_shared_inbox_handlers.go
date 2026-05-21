package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleCommunicationsSharedInboxes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		actor, hasActor, ok := sharedInboxActorForCompany(w, r, companyID)
		if !ok {
			return
		}
		items, err := s.repo.ListCompanyExplorerFolders(companyID, "communications")
		if err != nil {
			log.Printf("communications shared inboxes: failed to list company_id=%s: %v", companyID, err)
			if errors.Is(err, store.ErrSharedInboxStorageUnavailable) || errors.Is(err, store.ErrRaciStorageUnavailable) {
				writeError(w, http.StatusServiceUnavailable, "shared_inbox_storage_unavailable")
				return
			}
			writeError(w, http.StatusInternalServerError, "failed_to_list_shared_inboxes")
			return
		}
		if hasActor {
			items, err = s.filterCommunicationsSharedInboxFoldersForActor(companyID, actor, items)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_filter_shared_inboxes")
				return
			}
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"shared_inboxes": items,
			"folders":        items,
		})
	case http.MethodPost:
		s.createCommunicationsSharedInbox(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleCommunicationsSharedInboxByID(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/communications/shared-inboxes/"), "/")
	parts := strings.Split(trimmed, "/")
	folderID := strings.TrimSpace(parts[0])
	if folderID == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if len(parts) == 2 && parts[1] == "access" {
		s.handleCommunicationsSharedInboxAccess(w, r, folderID)
		return
	}
	if len(parts) == 2 && parts[1] == "raci" {
		s.handleCommunicationsSharedInboxRaci(w, r, folderID)
		return
	}
	if len(parts) != 1 {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}

	switch r.Method {
	case http.MethodPut:
		s.updateCommunicationsSharedInbox(w, r, folderID)
	case http.MethodDelete:
		s.deleteCommunicationsSharedInbox(w, r, folderID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) createCommunicationsSharedInbox(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CompanyID      string `json:"company_id"`
		ParentFolderID string `json:"parent_folder_id"`
		Name           string `json:"name"`
		AccountEmail   string `json:"account_email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.ParentFolderID = strings.TrimSpace(req.ParentFolderID)
	req.Name = strings.TrimSpace(req.Name)
	req.AccountEmail = strings.ToLower(strings.TrimSpace(req.AccountEmail))
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "shared_inbox_name_required")
		return
	}
	actor, hasActor, ok := sharedInboxActorForCompany(w, r, req.CompanyID)
	if !ok {
		return
	}
	if hasActor && req.ParentFolderID != "" && !s.requireCommunicationsSharedInboxAccess(w, r, actor, req.CompanyID, req.ParentFolderID, store.EntityPermissionEdit) {
		return
	}

	item, err := s.repo.CreateCompanyExplorerFolder(req.CompanyID, req.ParentFolderID, "communications", req.Name)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "parent_shared_inbox_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_shared_inbox")
		return
	}
	if hasActor && !actorCanManageCompany(actor, req.CompanyID) {
		grants, grantErr := s.repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID:  req.CompanyID,
			EntityType: store.EntityTypeSharedTriageFolder,
			EntityID:   item.FolderID,
			Permissions: []store.EntityPermissionInput{{
				SubjectType: store.EntityPermissionSubjectUser,
				SubjectID:   actor.User.UserID,
				AccessLevel: store.EntityPermissionAdmin,
				Permission:  store.EntityPermissionAdmin,
			}},
		})
		if grantErr != nil {
			_ = s.repo.DeleteCompanyExplorerFolder(req.CompanyID, item.FolderID)
			writeError(w, http.StatusInternalServerError, "failed_to_initialize_shared_inbox_access")
			return
		}
		item.AccessGrants = grants
		item.EffectiveAccess = store.EntityPermissionAdmin
	}
	if req.AccountEmail != "" {
		item, err = s.repo.SetCommunicationsSharedInboxAccountEmail(req.CompanyID, item.FolderID, req.AccountEmail)
		if err != nil {
			_ = s.repo.DeleteCompanyExplorerFolder(req.CompanyID, item.FolderID)
			if writeSharedInboxAccountEmailError(w, err) {
				return
			}
			writeError(w, http.StatusInternalServerError, "failed_to_assign_shared_inbox_account_email")
			return
		}
	}
	s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_created", map[string]any{"folder_id": item.FolderID, "folder_kind": item.FolderKind, "folder": item})
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) updateCommunicationsSharedInbox(w http.ResponseWriter, r *http.Request, folderID string) {
	var req struct {
		CompanyID      string  `json:"company_id"`
		ParentFolderID *string `json:"parent_folder_id"`
		Name           string  `json:"name"`
		AccountEmail   *string `json:"account_email"`
		Position       int     `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.Name = strings.TrimSpace(req.Name)
	actor, hasActor, ok := sharedInboxActorForCompany(w, r, req.CompanyID)
	if !ok {
		return
	}
	if hasActor && !s.requireCommunicationsSharedInboxAccess(w, r, actor, req.CompanyID, folderID, store.EntityPermissionEdit) {
		return
	}
	item, err := s.loadCommunicationsSharedInboxFolder(req.CompanyID, folderID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "shared_inbox_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox")
		return
	}

	changed := false
	if req.ParentFolderID != nil || req.Position > 0 {
		var parentFolderID *string
		if req.ParentFolderID != nil {
			parent := strings.TrimSpace(*req.ParentFolderID)
			parentFolderID = &parent
		}
		item, err = s.repo.MoveCompanyExplorerFolder(req.CompanyID, folderID, parentFolderID, req.Position)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "shared_inbox_not_found")
			return
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_shared_inbox_move")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_move_shared_inbox")
			return
		}
		changed = true
	}
	if req.Name != "" {
		item, err = s.repo.RenameCompanyExplorerFolder(req.CompanyID, folderID, req.Name)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "shared_inbox_not_found")
			return
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusConflict, "protected_shared_inbox_cannot_be_renamed")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_rename_shared_inbox")
			return
		}
		changed = true
	}
	if req.AccountEmail != nil {
		accountEmail := strings.ToLower(strings.TrimSpace(*req.AccountEmail))
		item, err = s.repo.SetCommunicationsSharedInboxAccountEmail(req.CompanyID, folderID, accountEmail)
		if writeSharedInboxAccountEmailError(w, err) {
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_update_shared_inbox_account_email")
			return
		}
		changed = true
	}
	if !changed {
		writeError(w, http.StatusBadRequest, "shared_inbox_update_required")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_updated", map[string]any{"folder_id": item.FolderID, "folder_kind": item.FolderKind, "folder": item})
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteCommunicationsSharedInbox(w http.ResponseWriter, r *http.Request, folderID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	actor, hasActor, ok := sharedInboxActorForCompany(w, r, companyID)
	if !ok {
		return
	}
	if hasActor && !s.requireCommunicationsSharedInboxAccess(w, r, actor, companyID, folderID, store.EntityPermissionAdmin) {
		return
	}
	if _, err := s.loadCommunicationsSharedInboxFolder(companyID, folderID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "shared_inbox_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox")
		return
	}
	result, err := s.repo.DeleteCompanyExplorerTargets(companyID, []store.CompanyExplorerDeleteTargetInput{{Kind: "folder", ID: folderID}})
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "shared_inbox_not_found")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusConflict, "protected_shared_inbox_cannot_be_deleted")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_shared_inbox")
		return
	}
	s.publishCompanyExplorerDeletedTargets(companyID, result.Targets)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleCommunicationsSharedInboxAccess(w http.ResponseWriter, r *http.Request, folderID string) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		actor, hasActor, ok := sharedInboxActorForCompany(w, r, companyID)
		if !ok {
			return
		}
		if hasActor && !s.requireCommunicationsSharedInboxAccess(w, r, actor, companyID, folderID, store.EntityPermissionView) {
			return
		}
		folder, err := s.loadCommunicationsSharedInboxFolder(companyID, folderID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "shared_inbox_not_found")
			return
		}
		if errors.Is(err, store.ErrSharedInboxStorageUnavailable) || errors.Is(err, store.ErrRaciStorageUnavailable) {
			writeError(w, http.StatusServiceUnavailable, "shared_inbox_storage_unavailable")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox_access")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"company_id":       companyID,
			"folder_id":        folderID,
			"access_grants":    folder.AccessGrants,
			"permissions":      folder.AccessGrants,
			"raci_assignments": folder.RaciAssignments,
		})
	case http.MethodPut:
		var req struct {
			CompanyID   string                                 `json:"company_id"`
			Permissions []store.EntityPermissionInput          `json:"permissions"`
			Assignments []store.SharedInboxRaciAssignmentInput `json:"assignments"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		if !requireCompanyManager(w, r, req.CompanyID) {
			return
		}
		permissions := req.Permissions
		if len(permissions) == 0 && len(req.Assignments) > 0 {
			permissions = sharedInboxRaciAssignmentsToAccessPermissions(req.Assignments)
		}
		grants, err := s.repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID:   req.CompanyID,
			EntityType:  store.EntityTypeSharedTriageFolder,
			EntityID:    folderID,
			Permissions: permissions,
		})
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_shared_inbox_access_grants")
			return
		}
		if errors.Is(err, store.ErrAssigneeNotInCompany) {
			writeError(w, http.StatusBadRequest, "shared_inbox_access_user_not_in_company")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "shared_inbox_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_update_shared_inbox_access")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "shared_triage_access_updated", map[string]any{"folder_id": folderID, "folder_kind": "communications", "access_grants": grants, "permissions": grants})
		writeJSON(w, http.StatusOK, map[string]any{
			"company_id":    req.CompanyID,
			"folder_id":     folderID,
			"access_grants": grants,
			"permissions":   grants,
		})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func sharedInboxRaciAssignmentsToAccessPermissions(assignments []store.SharedInboxRaciAssignmentInput) []store.EntityPermissionInput {
	permissions := make([]store.EntityPermissionInput, 0, len(assignments))
	seen := map[string]bool{}
	for _, assignment := range assignments {
		userID := strings.TrimSpace(assignment.UserID)
		if userID == "" {
			continue
		}
		accessLevel := store.EntityPermissionView
		role := strings.TrimSpace(assignment.Role)
		if role == "" || role == domain.LogicGateRaciRoleResponsible || role == domain.LogicGateRaciRoleAccountable {
			accessLevel = store.EntityPermissionEdit
		}
		key := store.EntityPermissionSubjectUser + ":" + userID
		if seen[key] && accessLevel == store.EntityPermissionView {
			continue
		}
		seen[key] = true
		permissions = append(permissions, store.EntityPermissionInput{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   userID,
			Permission:  accessLevel,
			AccessLevel: accessLevel,
		})
	}
	return permissions
}

func (s *Server) requireCommunicationsSharedInboxAccess(w http.ResponseWriter, r *http.Request, actor ActorContext, companyID, folderID, accessLevel string) bool {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return false
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return false
	}
	if actorCanManageCompany(actor, companyID) {
		return true
	}
	accessLevel, ok := store.NormalizeEntityPermission(accessLevel)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_shared_inbox_access_level")
		return false
	}
	allowed, err := s.repo.UserCanAccessEntity(companyID, store.EntityTypeSharedTriageFolder, folderID, actor.User.UserID, accessLevel)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_shared_inbox_access_check")
		return false
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "shared_inbox_not_found")
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_check_shared_inbox_access")
		return false
	}
	if !allowed {
		if accessLevel == store.EntityPermissionView {
			writeError(w, http.StatusNotFound, "shared_inbox_not_found")
		} else {
			writeError(w, http.StatusForbidden, "shared_inbox_access_denied")
		}
		return false
	}
	return true
}
func sharedInboxActorForCompany(w http.ResponseWriter, r *http.Request, companyID string) (ActorContext, bool, bool) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return ActorContext{}, false, false
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		return ActorContext{}, false, true
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return ActorContext{}, true, false
	}
	return actor, true, true
}

func (s *Server) loadCommunicationsSharedInboxFolder(companyID, folderID string) (domain.CompanyExplorerFolder, error) {
	folders, err := s.repo.ListCompanyExplorerFolders(companyID, "communications")
	if err != nil {
		return domain.CompanyExplorerFolder{}, err
	}
	for _, folder := range folders {
		if folder.FolderID == folderID {
			return folder, nil
		}
	}
	return domain.CompanyExplorerFolder{}, store.ErrNotFound
}

func writeSharedInboxAccountEmailError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, store.ErrEmailAccountUnavailable) {
		writeError(w, http.StatusBadRequest, "shared_inbox_email_account_not_connected")
		return true
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "shared_inbox_not_found")
		return true
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_shared_inbox_account_email")
		return true
	}
	if errors.Is(err, store.ErrSharedInboxStorageUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "shared_inbox_storage_unavailable")
		return true
	}
	return false
}
