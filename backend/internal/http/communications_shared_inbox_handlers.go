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
		var items []domain.CompanyExplorerFolder
		var err error
		if hasActor && !actorCanManageCompany(actor, companyID) {
			items, err = s.repo.ListVisibleCommunicationsSharedInboxFolders(companyID, actor.User.UserID)
		} else {
			items, err = s.repo.ListCommunicationsSharedInboxFolders(companyID)
			if hasActor && actorCanManageCompany(actor, companyID) {
				for index := range items {
					items[index].EffectiveAccess = store.EntityPermissionEdit
				}
			}
		}
		if err != nil {
			log.Printf("communications shared inboxes: failed to list company_id=%s: %v", companyID, err)
			if errors.Is(err, store.ErrSharedInboxStorageUnavailable) || errors.Is(err, store.ErrGVICStorageUnavailable) {
				writeError(w, http.StatusServiceUnavailable, "shared_inbox_storage_unavailable")
				return
			}
			writeError(w, http.StatusInternalServerError, "failed_to_list_shared_inboxes")
			return
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
	if !hasActor {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !actorCanManageCompanyUsers(actor, req.CompanyID) {
		writeError(w, http.StatusForbidden, "company_manager_required")
		return
	}
	if req.ParentFolderID != "" && !s.requireCommunicationsSharedInboxAccess(w, r, actor, req.CompanyID, req.ParentFolderID, store.EntityPermissionEdit) {
		return
	}

	item, err := s.repo.CreateCommunicationsSharedInboxFolder(req.CompanyID, req.ParentFolderID, req.Name, req.AccountEmail)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "parent_shared_inbox_not_found")
		return
	}
	if writeSharedInboxAccountEmailError(w, err) {
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_shared_inbox")
		return
	}
	resourceType := store.CommunicationsSharedInboxResourceType(item)
	s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_created", map[string]any{"folder_id": item.FolderID, "shared_inbox_id": item.SharedInboxID, "folder_kind": item.FolderKind, "resource_type": resourceType, "folder": item})
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
	if !hasActor {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !s.requireCommunicationsSharedInboxAccess(w, r, actor, req.CompanyID, folderID, store.EntityPermissionEdit) {
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
		item, err = s.repo.MoveCommunicationsSharedInboxFolder(req.CompanyID, folderID, parentFolderID, req.Position)
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
		item, err = s.repo.RenameCommunicationsSharedInboxFolder(req.CompanyID, folderID, req.Name)
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
		if !actorCanManageCompanyUsers(actor, req.CompanyID) {
			writeError(w, http.StatusForbidden, "company_manager_required")
			return
		}
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
	resourceType := store.CommunicationsSharedInboxResourceType(item)
	s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_updated", map[string]any{"folder_id": item.FolderID, "shared_inbox_id": item.SharedInboxID, "folder_kind": item.FolderKind, "resource_type": resourceType, "folder": item})
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteCommunicationsSharedInbox(w http.ResponseWriter, r *http.Request, folderID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	actor, hasActor, ok := sharedInboxActorForCompany(w, r, companyID)
	if !ok {
		return
	}
	if !hasActor {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !s.requireCommunicationsSharedInboxAccess(w, r, actor, companyID, folderID, store.EntityPermissionEdit) {
		return
	}
	item, err := s.loadCommunicationsSharedInboxFolder(companyID, folderID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "shared_inbox_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox")
		return
	}
	removeOnly := isTruthyQueryValue(r.URL.Query().Get("remove_only")) || isTruthyQueryValue(r.URL.Query().Get("keep_connection"))
	if removeOnly {
		err = s.repo.RemoveCommunicationsSharedInboxFolder(companyID, folderID)
	} else {
		err = s.repo.DeleteCommunicationsSharedInboxFolder(companyID, folderID)
	}
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
	resourceType := store.CommunicationsSharedInboxResourceType(item)
	s.publishWorkspaceEvent(companyID, "company_explorer_folder_deleted", map[string]any{"folder_id": folderID, "shared_inbox_id": item.SharedInboxID, "folder_kind": "communications", "resource_type": resourceType})
	status := "deleted"
	if removeOnly {
		status = "removed"
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": status})
}

func (s *Server) handleCommunicationsSharedInboxAccess(w http.ResponseWriter, r *http.Request, folderID string) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		actor, hasActor, ok := sharedInboxActorForCompany(w, r, companyID)
		if !ok {
			return
		}
		if hasActor && !s.requireCommunicationsSharedInboxAccess(w, r, actor, companyID, folderID, store.EntityPermissionEdit) {
			return
		}
		folder, err := s.loadCommunicationsSharedInboxFolder(companyID, folderID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "shared_inbox_not_found")
			return
		}
		if errors.Is(err, store.ErrSharedInboxStorageUnavailable) || errors.Is(err, store.ErrGVICStorageUnavailable) {
			writeError(w, http.StatusServiceUnavailable, "shared_inbox_storage_unavailable")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox_access")
			return
		}
		if hasActor && !actorCanManageCompanyUsers(actor, companyID) {
			writeError(w, http.StatusForbidden, "company_manager_required")
			return
		}
		canEditPermissions := false
		resourceType := store.CommunicationsSharedInboxResourceType(folder)
		if hasActor {
			if actorCanManageCompany(actor, companyID) {
				canEditPermissions = true
			} else if actorRoleForCompany(actor, companyID) == domain.RoleCompanyManager {
				allowed, accessErr := s.repo.UserHasEffectiveAccess(companyID, actor.User.UserID, resourceType, folderID, store.EntityPermissionEdit)
				if errors.Is(accessErr, store.ErrInvalid) {
					writeError(w, http.StatusBadRequest, "invalid_shared_inbox_access_check")
					return
				}
				if accessErr != nil {
					writeError(w, http.StatusInternalServerError, "failed_to_check_shared_inbox_access")
					return
				}
				canEditPermissions = allowed
			}
		}
		overrideUserIDs := make([]string, 0, len(folder.AccessGrants))
		for _, grant := range folder.AccessGrants {
			if grant.SubjectType == store.EntityPermissionSubjectUser && strings.TrimSpace(grant.SubjectID) != "" {
				overrideUserIDs = append(overrideUserIDs, grant.SubjectID)
			}
		}
		effectiveAccess, err := s.entityEffectiveAccessByUser(companyID, resourceType, folderID)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_shared_inbox_access_grants")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_shared_inbox_effective_access")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"company_id":                   companyID,
			"folder_id":                    folderID,
			"default_access":               folder.DefaultAccess,
			"override_user_ids":            overrideUserIDs,
			"access_grants":                folder.AccessGrants,
			"permissions":                  folder.AccessGrants,
			"effective_access":             effectiveAccess,
			"gvic_assignments":             folder.GVICAssignments,
			"can_edit_permissions":         canEditPermissions,
			"can_edit_manager_permissions": actorCanManageCompany(actor, companyID),
		})
	case http.MethodPut:
		var req struct {
			CompanyID       string                        `json:"company_id"`
			DefaultAccess   *string                       `json:"default_access"`
			OverrideUserIDs []string                      `json:"override_user_ids"`
			Permissions     []store.EntityPermissionInput `json:"permissions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		actor, hasActor, ok := sharedInboxActorForCompany(w, r, req.CompanyID)
		if !ok {
			return
		}
		if !hasActor {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if !actorCanManageCompanyUsers(actor, req.CompanyID) {
			writeError(w, http.StatusForbidden, "company_manager_required")
			return
		}
		if !s.requireCommunicationsSharedInboxAccess(w, r, actor, req.CompanyID, folderID, store.EntityPermissionEdit) {
			return
		}
		folder, err := s.loadCommunicationsSharedInboxFolder(req.CompanyID, folderID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "shared_inbox_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox_access")
			return
		}
		defaultAccess := ""
		defaultAccessSet := false
		if req.DefaultAccess != nil {
			defaultAccess = strings.TrimSpace(*req.DefaultAccess)
			defaultAccessSet = true
		}
		grants, err := s.repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID:        req.CompanyID,
			EntityType:       store.CommunicationsSharedInboxResourceType(folder),
			EntityID:         folderID,
			DefaultAccess:    defaultAccess,
			DefaultAccessSet: defaultAccessSet,
			OverrideUserIDs:  req.OverrideUserIDs,
			Permissions:      req.Permissions,
			ActorUserID:      actor.User.UserID,
		})
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_shared_inbox_access_grants")
			return
		}
		if errors.Is(err, store.ErrPrincipalNotInCompany) {
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
		storedDefaultAccess := defaultAccess
		if folder, loadErr := s.loadCommunicationsSharedInboxFolder(req.CompanyID, folderID); loadErr == nil {
			storedDefaultAccess = folder.DefaultAccess
		}
		actorUserID, actorLabel := notificationActorPayload(r)
		resourceType := store.CommunicationsSharedInboxResourceType(folder)
		event, projected := s.publishWorkspaceEvent(req.CompanyID, "shared_triage_access_updated", map[string]any{"folder_id": folderID, "shared_inbox_id": folder.SharedInboxID, "folder_kind": "communications", "resource_type": resourceType, "default_access": storedDefaultAccess, "access_grants": grants, "permissions": grants, "actor_user_id": actorUserID, "actor_display_name": actorLabel})
		if projected {
			s.projectCommittedNotificationEvents([]domain.DomainEvent{event})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"company_id":        req.CompanyID,
			"folder_id":         folderID,
			"default_access":    storedDefaultAccess,
			"access_grants":     grants,
			"permissions":       grants,
			"override_user_ids": req.OverrideUserIDs,
		})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
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
	if !ok || store.EntityPermissionRank(accessLevel) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_shared_inbox_access_level")
		return false
	}
	folder, err := s.loadCommunicationsSharedInboxFolder(companyID, folderID)
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox")
		return false
	}
	resourceType := store.CommunicationsSharedInboxResourceType(folder)
	allowed, err := s.repo.UserHasEffectiveAccess(companyID, actor.User.UserID, resourceType, folderID, accessLevel)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_shared_inbox_access_check")
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_check_shared_inbox_access")
		return false
	}
	if allowed {
		return true
	}
	if accessLevel != store.EntityPermissionEdit {
		canView, err := s.repo.UserHasEffectiveAccess(companyID, actor.User.UserID, resourceType, folderID, store.EntityPermissionEdit)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_shared_inbox_access_check")
			return false
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_check_shared_inbox_access")
			return false
		}
		if canView {
			writeAccessActionDenied(w)
			return false
		}
	}
	writeAccessResourceNotFound(w)
	return false
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
	return s.repo.GetCommunicationsSharedInboxFolder(companyID, folderID)
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
