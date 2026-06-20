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

func (s *Server) handleCompanyExplorerRoots(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if scope := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope"))); scope != "" && scope != store.CompanyExplorerLazyScopeAll {
		writeError(w, http.StatusBadRequest, "invalid_scope")
		return
	}
	query := store.CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             store.CompanyExplorerLazyScopeAll,
		PermissionUserID: s.entityPermissionActorUserID(r, companyID),
	}
	rows, err := s.repo.ListCompanyExplorerV2RootRows(query)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_query")
		return
	}
	if err != nil {
		log.Printf("company explorer roots: failed company_id=%s: %v", query.CompanyID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_roots")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, rows)
}

func (s *Server) handleCompanyExplorerChildren(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	parentID := strings.TrimSpace(r.URL.Query().Get("parent_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if parentID == "" || (parentID != companyID && !isValidCompanyExplorerResourceID(parentID)) {
		writeError(w, http.StatusBadRequest, "invalid_parent_id")
		return
	}
	if scope := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope"))); scope != "" && scope != store.CompanyExplorerLazyScopeAll {
		writeError(w, http.StatusBadRequest, "invalid_scope")
		return
	}
	query := store.CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             store.CompanyExplorerLazyScopeAll,
		ParentEntityID:   parentID,
		PermissionUserID: s.entityPermissionActorUserID(r, companyID),
	}
	rows, err := s.repo.ListCompanyExplorerV2ChildRows(query)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_child_query")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return
	}
	if err != nil {
		log.Printf("company explorer children: failed company_id=%s parent_id=%s: %v", query.CompanyID, parentID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_children")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, rows)
}

func (s *Server) companyExplorerLazyRowsQuery(w http.ResponseWriter, r *http.Request) (store.CompanyExplorerLazyRowsQuery, bool) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return store.CompanyExplorerLazyRowsQuery{}, false
	}
	scope, ok := store.NormalizeCompanyExplorerLazyScope(r.URL.Query().Get("scope"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_scope")
		return store.CompanyExplorerLazyRowsQuery{}, false
	}
	query := store.CompanyExplorerLazyRowsQuery{
		CompanyID:        companyID,
		Scope:            scope,
		PermissionUserID: s.entityPermissionActorUserID(r, companyID),
	}
	actor, hasActor := authenticatedActor(r)
	if hasActor {
		query.ScopeUserID = strings.TrimSpace(actor.User.UserID)
	}
	return query, true
}

func (s *Server) handleCompanyExplorerFolders(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		folderKind := strings.TrimSpace(r.URL.Query().Get("folder_kind"))
		folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if folderKind != "" && !isValidCompanyExplorerFolderKind(folderKind) {
			writeError(w, http.StatusBadRequest, "invalid_folder_kind")
			return
		}
		if folderID != "" && !isValidCompanyExplorerResourceID(folderID) {
			writeError(w, http.StatusBadRequest, "invalid_folder_id")
			return
		}

		userID := s.entityPermissionActorUserID(r, companyID)
		var items []domain.CompanyExplorerFolder
		var err error
		if folderID != "" {
			if folderKind == "" {
				writeError(w, http.StatusBadRequest, "folder_kind_required")
				return
			}
			if userID != "" {
				items, err = s.repo.ListVisibleCompanyExplorerFolderSubtree(companyID, folderID, folderKind, userID)
			} else {
				items, err = s.repo.ListCompanyExplorerFolderSubtree(companyID, folderID, folderKind)
			}
			if err == nil && len(items) == 0 {
				writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
				return
			}
		} else {
			if userID != "" {
				items, err = s.repo.ListVisibleCompanyExplorerFolders(companyID, folderKind, userID)
			} else {
				items, err = s.repo.ListCompanyExplorerFolders(companyID, folderKind)
			}
		}
		if err != nil {
			log.Printf("company explorer folders: failed to list folders company_id=%s folder_kind=%s folder_id=%s: %v", companyID, folderKind, folderID, err)
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
		Name           string `json:"name"`
		Position       int    `json:"position"`
		DefaultAccess  string `json:"default_access"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.ParentFolderID = strings.TrimSpace(req.ParentFolderID)
	req.Name = strings.TrimSpace(req.Name)
	if req.CompanyID == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, "company_id_and_name_required")
		return
	}
	parentEntityID := req.ParentFolderID
	if parentEntityID == "" {
		parentEntityID = req.CompanyID
	}
	actor, _ := authenticatedActor(r)
	item, err := s.repo.CreateCompanyExplorerV2Folder(store.CompanyExplorerV2FolderInput{
		CompanyID:        req.CompanyID,
		ParentEntityID:   parentEntityID,
		Name:             req.Name,
		Position:         req.Position,
		DefaultAccess:    req.DefaultAccess,
		ActorUserID:      strings.TrimSpace(actor.User.UserID),
		PermissionUserID: s.entityPermissionActorUserID(r, req.CompanyID),
	})
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "parent_folder_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_company_explorer_folder")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_created", map[string]any{"folder_id": item.EntityID, "parent_entity_id": item.ParentEntityID, "entity": item})
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleCompanyExplorerFolderByID(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/company-explorer/folders/"), "/")
	parts := strings.Split(trimmed, "/")
	folderID := strings.TrimSpace(parts[0])
	if folderID == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if len(parts) == 2 && parts[1] == "shares" {
		s.handleCompanyExplorerFolderShares(w, r, folderID)
		return
	}
	if len(parts) == 2 && parts[1] == "permissions" {
		s.handleEntityPermissions(w, r, store.EntityTypeCompanyExplorerFolder, folderID, "company_explorer_folder_not_found", "company_explorer_folder_permissions_updated")
		return
	}
	if len(parts) != 1 {
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
		var row store.CompanyExplorerV2Row
		changed := false
		if req.ParentFolderID != nil || req.Position > 0 {
			var parentFolderID *string
			if req.ParentFolderID != nil {
				parent := strings.TrimSpace(*req.ParentFolderID)
				parentFolderID = &parent
			}
			folder, moveErr := s.repo.MoveCompanyExplorerFolder(req.CompanyID, folderID, parentFolderID, req.Position)
			if errors.Is(moveErr, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
				return
			}
			if errors.Is(moveErr, store.ErrInvalid) {
				writeError(w, http.StatusBadRequest, "invalid_company_explorer_folder_move")
				return
			}
			if moveErr != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_move_company_explorer_folder")
				return
			}
			row, moveErr = s.repo.GetCompanyExplorerV2Entity(req.CompanyID, folder.FolderID, s.entityPermissionActorUserID(r, req.CompanyID))
			if moveErr != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_read_company_explorer_folder")
				return
			}
			row.ParentEntityID = ""
			if folder.ParentFolderID != nil {
				row.ParentEntityID = *folder.ParentFolderID
			}
			changed = true
		}
		if req.Name != "" {
			folder, renameErr := s.repo.RenameCompanyExplorerFolder(req.CompanyID, folderID, req.Name)
			if errors.Is(renameErr, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
				return
			}
			if errors.Is(renameErr, store.ErrInvalid) {
				writeError(w, http.StatusConflict, "protected_company_explorer_folder_cannot_be_renamed")
				return
			}
			if renameErr != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_rename_company_explorer_folder")
				return
			}
			row, renameErr = s.repo.GetCompanyExplorerV2Entity(req.CompanyID, folder.FolderID, s.entityPermissionActorUserID(r, req.CompanyID))
			if renameErr != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_read_company_explorer_folder")
				return
			}
			row.ParentEntityID = ""
			if folder.ParentFolderID != nil {
				row.ParentEntityID = *folder.ParentFolderID
			}
			changed = true
		}
		if !changed {
			writeError(w, http.StatusBadRequest, "company_explorer_folder_update_required")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_updated", map[string]any{"folder_id": row.EntityID, "parent_entity_id": row.ParentEntityID, "entity": row})
		writeJSON(w, http.StatusOK, row)
		return
	}

	if r.Method == http.MethodDelete {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		err := s.repo.DeleteCompanyExplorerFolder(companyID, folderID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
			return
		} else if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusConflict, "protected_company_explorer_folder_cannot_be_deleted")
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

func (s *Server) handleCompanyExplorerItems(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID      string `json:"company_id"`
		ParentEntityID string `json:"parent_entity_id"`
		ParentFolderID string `json:"parent_folder_id"`
		TargetType     string `json:"target_type"`
		TargetID       string `json:"target_id"`
		Position       int    `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	parentEntityID := strings.TrimSpace(req.ParentEntityID)
	if parentEntityID == "" {
		parentEntityID = strings.TrimSpace(req.ParentFolderID)
	}
	if parentEntityID == "" {
		parentEntityID = req.CompanyID
	}
	if req.CompanyID == "" || parentEntityID == "" {
		writeError(w, http.StatusBadRequest, "company_id_and_parent_required")
		return
	}
	actor, _ := authenticatedActor(r)
	row, err := s.repo.UpsertCompanyExplorerV2Edge(store.CompanyExplorerV2EdgeInput{
		CompanyID:        req.CompanyID,
		ParentEntityID:   parentEntityID,
		ChildEntityType:  req.TargetType,
		ChildResourceID:  req.TargetID,
		Position:         req.Position,
		ActorUserID:      strings.TrimSpace(actor.User.UserID),
		PermissionUserID: s.entityPermissionActorUserID(r, req.CompanyID),
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_item")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_place_company_explorer_item")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "company_explorer_item_placed", map[string]any{"item_id": row.EdgeID, "parent_entity_id": row.ParentEntityID, "target_type": row.EntityType, "target_id": row.ResourceID, "entity": row})
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handleCompanyExplorerItemByID(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/company-explorer/items/"), "/")
	itemID := strings.TrimSpace(trimmed)
	if itemID == "" || strings.Contains(itemID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var req struct {
			CompanyID      string `json:"company_id"`
			ParentEntityID string `json:"parent_entity_id"`
			ParentFolderID string `json:"parent_folder_id"`
			Position       int    `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		parentEntityID := strings.TrimSpace(req.ParentEntityID)
		if parentEntityID == "" {
			parentEntityID = strings.TrimSpace(req.ParentFolderID)
		}
		if parentEntityID == "" {
			parentEntityID = req.CompanyID
		}
		actor, _ := authenticatedActor(r)
		row, err := s.repo.MoveCompanyExplorerV2Edge(store.CompanyExplorerV2MoveEdgeInput{
			CompanyID:        req.CompanyID,
			EdgeID:           itemID,
			ParentEntityID:   parentEntityID,
			Position:         req.Position,
			ActorUserID:      strings.TrimSpace(actor.User.UserID),
			PermissionUserID: s.entityPermissionActorUserID(r, req.CompanyID),
		})
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_company_explorer_item_move")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeAccessResourceNotFound(w)
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_move_company_explorer_item")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "company_explorer_item_placed", map[string]any{"item_id": row.EdgeID, "parent_entity_id": row.ParentEntityID, "target_type": row.EntityType, "target_id": row.ResourceID, "entity": row})
		writeJSON(w, http.StatusOK, row)
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if err := s.repo.DeleteCompanyExplorerV2Edge(companyID, itemID); errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_company_explorer_item")
			return
		} else if errors.Is(err, store.ErrNotFound) {
			writeAccessResourceNotFound(w)
			return
		} else if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_remove_company_explorer_item")
			return
		}
		s.publishWorkspaceEvent(companyID, "company_explorer_item_removed", map[string]any{"item_id": itemID})
		writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleCommunicationsSharedInboxGVIC(w http.ResponseWriter, r *http.Request, folderID string) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		actor, hasActor, ok := sharedInboxActorForCompany(w, r, companyID)
		if !ok {
			return
		}
		if hasActor && !s.requireCommunicationsSharedInboxAccess(w, r, actor, companyID, folderID, store.EntityPermissionView) {
			return
		}
		folder, err := s.repo.GetCommunicationsSharedInboxFolder(companyID, folderID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "shared_inbox_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox_GVIC")
			return
		}
		if store.CommunicationsSharedInboxResourceType(folder) != store.EntityTypeSharedInbox {
			writeError(w, http.StatusBadRequest, "shared_inbox_GVIC_requires_mailbox")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"company_id":       companyID,
			"folder_id":        folderID,
			"gvic_assignments": folder.GVICAssignments,
		})
		return
	}

	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID   string                                 `json:"company_id"`
		Assignments []store.SharedInboxGVICAssignmentInput `json:"assignments"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if req.CompanyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	actor, hasActor, ok := sharedInboxActorForCompany(w, r, req.CompanyID)
	if !ok {
		return
	}
	if hasActor && !s.requireCommunicationsSharedInboxAccess(w, r, actor, req.CompanyID, folderID, store.EntityPermissionEdit) {
		return
	}
	folder, err := s.repo.GetCommunicationsSharedInboxFolder(req.CompanyID, folderID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "shared_inbox_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox_GVIC")
		return
	}
	if store.CommunicationsSharedInboxResourceType(folder) != store.EntityTypeSharedInbox {
		writeError(w, http.StatusBadRequest, "shared_inbox_GVIC_requires_mailbox")
		return
	}
	assignments, err := s.repo.SetCommunicationsSharedInboxGVICAssignments(store.SharedInboxGVICAssignmentUpdateInput{
		CompanyID:   req.CompanyID,
		FolderID:    folderID,
		Assignments: req.Assignments,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_shared_inbox_gvic_assignments")
		return
	}
	if errors.Is(err, store.ErrPrincipalNotInCompany) {
		writeError(w, http.StatusBadRequest, "shared_inbox_GVIC_user_not_in_company")
		return
	}
	if errors.Is(err, store.ErrGVICStorageUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "shared_inbox_GVIC_storage_unavailable")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "shared_inbox_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_update_shared_inbox_GVIC")
		return
	}
	actorUserID := ""
	actorLabel := ""
	if hasActor {
		actorUserID = strings.TrimSpace(actor.User.UserID)
		actorLabel = strings.TrimSpace(actor.User.DisplayName)
		if actorLabel == "" {
			actorLabel = strings.TrimSpace(actor.User.Email)
		}
	}
	event, projected := s.publishWorkspaceEvent(req.CompanyID, "communications_shared_inbox_gvic_updated", map[string]any{"folder_id": folderID, "shared_inbox_id": folder.SharedInboxID, "folder_kind": "communications", "resource_type": store.EntityTypeSharedInbox, "gvic_assignments": assignments, "actor_user_id": actorUserID, "actor_display_name": actorLabel})
	if projected {
		s.projectCommittedNotificationEvents([]domain.DomainEvent{event})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"company_id":       req.CompanyID,
		"folder_id":        folderID,
		"gvic_assignments": assignments,
	})
}

func (s *Server) filterCommunicationsSharedInboxFoldersForActor(companyID string, actor ActorContext, folders []domain.CompanyExplorerFolder) ([]domain.CompanyExplorerFolder, error) {
	if actorCanManageCompany(actor, companyID) {
		out := append([]domain.CompanyExplorerFolder{}, folders...)
		for index := range out {
			out[index].EffectiveAccess = store.EntityPermissionAdmin
		}
		return out, nil
	}
	groups, err := s.repo.ListCompanyUserGroups(companyID)
	if err != nil {
		return nil, err
	}
	members, err := s.repo.ListCompanyUserGroupMembers(companyID)
	if err != nil {
		return nil, err
	}
	return filterCommunicationsSharedInboxFoldersForUserWithGroups(folders, actor.User.UserID, groups, members), nil
}

func filterCommunicationsSharedInboxFoldersForUser(folders []domain.CompanyExplorerFolder, userID string) []domain.CompanyExplorerFolder {
	return filterCommunicationsSharedInboxFoldersForUserWithGroups(folders, userID, nil, nil)
}

func filterCommunicationsSharedInboxFoldersForUserWithGroups(folders []domain.CompanyExplorerFolder, userID string, groups []domain.CompanyUserGroup, members []domain.CompanyUserGroupMember) []domain.CompanyExplorerFolder {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return []domain.CompanyExplorerFolder{}
	}
	userGroupIDs := sharedInboxAccessGroupIDsForUser(userID, groups, members)
	accessByFolderID := make(map[string]string, len(folders))
	includeFolderIDs := make(map[string]bool, len(folders))
	for _, folder := range folders {
		accessLevel := sharedInboxFolderEffectiveAccess(folder, userID, userGroupIDs)
		if accessLevel == "" {
			accessLevel = store.EntityPermissionNoAccess
		}
		accessByFolderID[folder.FolderID] = accessLevel
		if !store.EntityPermissionSatisfies(accessLevel, store.EntityPermissionView) {
			continue
		}
		includeFolderIDs[folder.FolderID] = true
	}
	out := make([]domain.CompanyExplorerFolder, 0, len(folders))
	for _, folder := range folders {
		if !includeFolderIDs[folder.FolderID] {
			continue
		}
		item := folder
		item.EffectiveAccess = accessByFolderID[folder.FolderID]
		if !store.EntityPermissionSatisfies(item.EffectiveAccess, store.EntityPermissionView) {
			item.EffectiveAccess = store.EntityPermissionNoAccess
		}
		out = append(out, item)
	}
	return out
}

func sharedInboxFolderEffectiveAccess(folder domain.CompanyExplorerFolder, userID string, userGroupIDs map[string]bool) string {
	bestSubjectRank := -1
	bestAccessRank := -1
	bestAccess := ""
	for _, grant := range folder.AccessGrants {
		subjectRank := 0
		switch strings.TrimSpace(grant.SubjectType) {
		case store.EntityPermissionSubjectUser:
			if strings.TrimSpace(grant.SubjectID) != userID {
				continue
			}
			subjectRank = 2
		case store.EntityPermissionSubjectGroup:
			if !userGroupIDs[strings.TrimSpace(grant.SubjectID)] {
				continue
			}
			subjectRank = 1
		default:
			continue
		}
		accessLevel := grant.AccessLevel
		if strings.TrimSpace(accessLevel) == "" {
			accessLevel = grant.Permission
		}
		accessLevel, ok := store.NormalizeEntityPermission(accessLevel)
		if !ok {
			continue
		}
		accessRank := store.EntityPermissionRank(accessLevel)
		if bestAccess == "" || subjectRank > bestSubjectRank || (subjectRank == bestSubjectRank && accessRank > bestAccessRank) {
			bestSubjectRank = subjectRank
			bestAccessRank = accessRank
			bestAccess = accessLevel
		}
	}
	return bestAccess
}

func sharedInboxAccessGroupIDsForUser(userID string, groups []domain.CompanyUserGroup, members []domain.CompanyUserGroupMember) map[string]bool {
	parentByGroup := make(map[string]string, len(groups))
	for _, group := range groups {
		if group.ParentGroupID != nil {
			parentByGroup[group.GroupID] = strings.TrimSpace(*group.ParentGroupID)
		}
	}
	ids := map[string]bool{}
	for _, member := range members {
		if strings.TrimSpace(member.UserID) != userID {
			continue
		}
		for groupID, seen := strings.TrimSpace(member.GroupID), map[string]bool{}; groupID != "" && !seen[groupID]; groupID = parentByGroup[groupID] {
			seen[groupID] = true
			ids[groupID] = true
		}
	}
	return ids
}

func (s *Server) handleCompanyExplorerFolderShares(w http.ResponseWriter, r *http.Request, folderID string) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if !requireCompanyAccess(w, r, companyID) {
			return
		}
		shares, err := s.repo.ListCompanyExplorerFolderShares(companyID, folderID)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "company_id_folder_id_required")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_shares")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"shares": shares})
	case http.MethodPost:
		s.inviteCompanyExplorerFolderShare(w, r, folderID)
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		email := normalizeEmailForCompare(r.URL.Query().Get("email"))
		if !requireCompanyManager(w, r, companyID) {
			return
		}
		if email == "" {
			writeError(w, http.StatusBadRequest, "email_required")
			return
		}
		err := s.repo.DeleteCompanyExplorerFolderShare(companyID, folderID, email)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "company_id_folder_email_required")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "company_explorer_folder_share_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_delete_company_explorer_folder_share")
			return
		}
		s.publishWorkspaceEvent(companyID, "company_explorer_folder_share_deleted", map[string]any{"folder_id": folderID, "email": email})
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) inviteCompanyExplorerFolderShare(w http.ResponseWriter, r *http.Request, folderID string) {
	var req struct {
		CompanyID string `json:"company_id"`
		Email     string `json:"email"`
		UserID    string `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.Email = normalizeEmailForCompare(req.Email)
	req.UserID = strings.TrimSpace(req.UserID)
	if !requireCompanyManager(w, r, req.CompanyID) {
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if req.Email == "" && req.UserID == "" {
		writeError(w, http.StatusBadRequest, "email_or_user_id_required")
		return
	}
	if _, err := s.repo.ListCompanyExplorerFolderShares(req.CompanyID, folderID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_company_explorer_folder")
		return
	}

	targetEmail, targetUserID, existingMangoUser, err := s.resolveCompanyExplorerFolderShareTarget(req.CompanyID, req.UserID, req.Email)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_folder_share_target")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_resolve_company_explorer_folder_share_target")
		return
	}

	var invitation *domain.Invitation
	cognitoStatus := "not_needed"
	if targetUserID == "" {
		created, err := s.repo.CreateInvitation(store.CreateInvitationInput{
			CompanyID:       req.CompanyID,
			Email:           targetEmail,
			Role:            domain.RoleCompanyUser,
			InvitedByUserID: actor.User.UserID,
		})
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_invitation")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "company_not_found")
			return
		}
		if errors.Is(err, store.ErrAlreadyExists) {
			writeError(w, http.StatusConflict, "user_already_exists")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_create_invitation")
			return
		}
		invitation = &created
		cognitoStatus = s.sendCognitoInvitation(r, created.Email, existingMangoUser)
		if cognitoStatus == "failed" {
			writeError(w, http.StatusBadGateway, "failed_to_create_cognito_user")
			return
		}
	}

	share, err := s.repo.UpsertCompanyExplorerFolderShare(store.CompanyExplorerFolderShareInput{
		CompanyID:       req.CompanyID,
		FolderID:        folderID,
		Email:           targetEmail,
		UserID:          targetUserID,
		InvitedByUserID: actor.User.UserID,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_folder_share")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_explorer_folder_or_user_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_company_explorer_folder_share")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_share_upserted", map[string]any{"folder_id": folderID, "share": share})
	writeJSON(w, http.StatusCreated, map[string]any{
		"share":                 share,
		"invitation":            invitation,
		"cognito_invite_status": cognitoStatus,
	})
}

func (s *Server) resolveCompanyExplorerFolderShareTarget(companyID, userID, email string) (string, string, bool, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	email = normalizeEmailForCompare(email)
	if companyID == "" {
		return "", "", false, store.ErrInvalid
	}
	if userID != "" {
		user, err := s.repo.GetCompanyUser(companyID, userID)
		if errors.Is(err, store.ErrNotFound) {
			return "", "", false, store.ErrInvalid
		}
		if err != nil {
			return "", "", false, err
		}
		return user.Email, user.UserID, true, nil
	}
	if email == "" {
		return "", "", false, store.ErrInvalid
	}
	user, err := s.repo.GetAuthUserByEmail(email)
	if errors.Is(err, store.ErrNotFound) {
		return email, "", false, nil
	}
	if err != nil {
		return "", "", false, err
	}
	companyUser, err := s.repo.GetCompanyUser(companyID, user.UserID)
	if errors.Is(err, store.ErrNotFound) {
		return email, "", true, nil
	}
	if err != nil {
		return "", "", false, err
	}
	return companyUser.Email, companyUser.UserID, true, nil
}

func (s *Server) sendCognitoInvitation(r *http.Request, email string, existingMangoUser bool) string {
	if existingMangoUser {
		return "existing_mango_user"
	}
	if s.cognitoAdmin == nil {
		return "not_configured"
	}
	result, err := s.cognitoAdmin.AdminCreateUser(r.Context(), email)
	if err != nil {
		log.Printf("failed to create cognito invitation user email=%s: %v", email, err)
		return "failed"
	}
	return firstNonBlank(result.Status, "created")
}

func (s *Server) publishCompanyExplorerDeletedTargets(companyID string, targets []store.CompanyExplorerDeletedTarget) {
	for _, target := range targets {
		switch target.Kind {
		case "folder":
			s.publishWorkspaceEvent(companyID, "company_explorer_folder_deleted", map[string]any{"folder_id": target.ID, "folder_kind": target.FolderKind})
		case "node":
			s.publishWorkspaceEvent(companyID, "node_deleted", map[string]any{"node_id": target.ID})
		case "logic_gate":
			s.publishWorkspaceEvent(companyID, "logic_gate_deleted", map[string]any{"logic_gate_id": target.ID})
		case "project":
			s.publishWorkspaceEvent(companyID, "project_deleted", map[string]any{"project_id": target.ID})
		case "kanban":
			s.publishWorkspaceEvent(companyID, "kanban_board_deleted", map[string]any{"board_id": target.ID})
		}
	}
}

func isValidCompanyExplorerFolderKind(value string) bool {
	return value == "node" || value == "logic_gate" || value == "project"
}

func isValidCompanyExplorerItemType(value string) bool {
	return value == "node" || value == "logic_gate" || value == "project"
}

func companyExplorerItemTypeForFolderKind(folderKind string) string {
	switch strings.TrimSpace(folderKind) {
	case "node":
		return "node"
	case "logic_gate":
		return "logic_gate"
	case "project":
		return "project"
	default:
		return ""
	}
}

func isValidCompanyExplorerResourceID(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != 36 {
		return false
	}
	for index, char := range value {
		switch index {
		case 8, 13, 18, 23:
			if char != '-' {
				return false
			}
		default:
			if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F') {
				continue
			}
			return false
		}
	}
	return true
}
