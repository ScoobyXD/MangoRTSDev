package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
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

func (s *Server) handleCompanyExplorerSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	queryText := strings.TrimSpace(r.URL.Query().Get("q"))
	if queryText == "" {
		queryText = strings.TrimSpace(r.URL.Query().Get("query"))
	}
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if queryText == "" {
		writeError(w, http.StatusBadRequest, "query_required")
		return
	}
	limit := 0
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, err := strconv.Atoi(rawLimit)
		if err != nil || parsedLimit <= 0 {
			writeError(w, http.StatusBadRequest, "invalid_limit")
			return
		}
		limit = parsedLimit
	}
	resourceTypes := make([]string, 0)
	for _, key := range []string{"resource_types", "resource_type", "types"} {
		for _, rawValue := range r.URL.Query()[key] {
			for _, value := range strings.Split(rawValue, ",") {
				if clean := strings.TrimSpace(value); clean != "" {
					resourceTypes = append(resourceTypes, clean)
				}
			}
		}
	}
	results, err := s.repo.SearchCompanyExplorer(store.CompanyExplorerSearchQuery{
		CompanyID:        companyID,
		Query:            queryText,
		PermissionUserID: s.entityPermissionActorUserID(r, companyID),
		Limit:            limit,
		ResourceTypes:    resourceTypes,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_search_query")
		return
	}
	if err != nil {
		log.Printf("company explorer search: failed company_id=%s query=%q: %v", companyID, queryText, err)
		writeError(w, http.StatusInternalServerError, "failed_to_search_company_explorer")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, results)
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
		Items          []struct {
			EdgeID         string `json:"edge_id"`
			ParentEntityID string `json:"parent_entity_id"`
			ParentFolderID string `json:"parent_folder_id"`
			TargetType     string `json:"target_type"`
			TargetID       string `json:"target_id"`
			Position       int    `json:"position"`
		} `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	actor, _ := authenticatedActor(r)
	actorUserID := strings.TrimSpace(actor.User.UserID)
	permissionUserID := s.entityPermissionActorUserID(r, req.CompanyID)
	if len(req.Items) > 0 {
		if req.CompanyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		rows := make([]store.CompanyExplorerV2Row, 0, len(req.Items))
		for _, item := range req.Items {
			parentEntityID := strings.TrimSpace(item.ParentEntityID)
			if parentEntityID == "" {
				parentEntityID = strings.TrimSpace(item.ParentFolderID)
			}
			if parentEntityID == "" {
				parentEntityID = strings.TrimSpace(req.ParentEntityID)
			}
			if parentEntityID == "" {
				parentEntityID = strings.TrimSpace(req.ParentFolderID)
			}
			if parentEntityID == "" {
				parentEntityID = req.CompanyID
			}
			edgeID := strings.TrimSpace(item.EdgeID)
			var row store.CompanyExplorerV2Row
			var err error
			if edgeID != "" {
				row, err = s.repo.MoveCompanyExplorerV2Edge(store.CompanyExplorerV2MoveEdgeInput{
					CompanyID:        req.CompanyID,
					EdgeID:           edgeID,
					ParentEntityID:   parentEntityID,
					Position:         item.Position,
					ActorUserID:      actorUserID,
					PermissionUserID: permissionUserID,
				})
			} else {
				row, err = s.repo.UpsertCompanyExplorerV2Edge(store.CompanyExplorerV2EdgeInput{
					CompanyID:        req.CompanyID,
					ParentEntityID:   parentEntityID,
					ChildEntityType:  item.TargetType,
					ChildResourceID:  item.TargetID,
					Position:         item.Position,
					ActorUserID:      actorUserID,
					PermissionUserID: permissionUserID,
				})
			}
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
			rows = append(rows, row)
			s.publishWorkspaceEvent(req.CompanyID, "company_explorer_item_placed", map[string]any{"item_id": row.EdgeID, "parent_entity_id": row.ParentEntityID, "target_type": row.EntityType, "target_id": row.ResourceID, "entity": row})
		}
		writeJSON(w, http.StatusOK, map[string]any{"rows": rows})
		return
	}
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
	row, err := s.repo.UpsertCompanyExplorerV2Edge(store.CompanyExplorerV2EdgeInput{
		CompanyID:        req.CompanyID,
		ParentEntityID:   parentEntityID,
		ChildEntityType:  req.TargetType,
		ChildResourceID:  req.TargetID,
		Position:         req.Position,
		ActorUserID:      actorUserID,
		PermissionUserID: permissionUserID,
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

func (s *Server) handleCompanyExplorerDeleteTargets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID               string `json:"company_id"`
		ConfirmationDisplayName string `json:"confirmation_display_name"`
		Targets                 []struct {
			Kind       string `json:"kind"`
			ID         string `json:"id"`
			FolderKind string `json:"folder_kind"`
			EdgeID     string `json:"edge_id"`
		} `json:"targets"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if req.CompanyID == "" || len(req.Targets) == 0 {
		writeError(w, http.StatusBadRequest, "company_id_and_targets_required")
		return
	}
	if !requireCompanyAccess(w, r, req.CompanyID) {
		return
	}
	actor, ok := requireActorDisplayNameConfirmation(w, r, req.ConfirmationDisplayName)
	if !ok {
		return
	}
	deletedByUserID := actor.User.UserID

	deleteTargets := make([]store.CompanyExplorerDeleteTargetInput, 0, len(req.Targets))
	for _, target := range req.Targets {
		kind := strings.TrimSpace(target.Kind)
		id := strings.TrimSpace(target.ID)
		if kind == "" || id == "" {
			continue
		}
		deleteTargets = append(deleteTargets, store.CompanyExplorerDeleteTargetInput{
			Kind:       kind,
			ID:         id,
			FolderKind: strings.TrimSpace(target.FolderKind),
		})
	}
	if len(deleteTargets) == 0 {
		writeError(w, http.StatusBadRequest, "company_explorer_delete_targets_required")
		return
	}

	result := store.CompanyExplorerDeleteResult{Targets: []store.CompanyExplorerDeletedTarget{}}
	var err error
	result, err = s.repo.DeleteCompanyExplorerTargets(req.CompanyID, deleteTargets, deletedByUserID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_delete_target")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_explorer_delete_target_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_company_explorer_targets")
		return
	}

	s.publishCompanyExplorerDeletedTargets(req.CompanyID, result.Targets)
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "targets": result.Targets})
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

	targetEmail, targetUserID, err := s.resolveCompanyExplorerFolderShareTarget(req.CompanyID, req.UserID, req.Email)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_folder_share_target")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_explorer_folder_share_user_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_resolve_company_explorer_folder_share_target")
		return
	}
	if targetUserID == "" {
		writeError(w, http.StatusNotFound, "company_explorer_folder_share_user_not_found")
		return
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
		"invitation":            nil,
		"cognito_invite_status": "not_needed",
	})
}

func (s *Server) resolveCompanyExplorerFolderShareTarget(companyID, userID, email string) (string, string, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	email = normalizeEmailForCompare(email)
	if companyID == "" {
		return "", "", store.ErrInvalid
	}
	if userID != "" {
		user, err := s.repo.GetCompanyUser(companyID, userID)
		if errors.Is(err, store.ErrNotFound) {
			return "", "", store.ErrNotFound
		}
		if err != nil {
			return "", "", err
		}
		return user.Email, user.UserID, nil
	}
	if email == "" {
		return "", "", store.ErrInvalid
	}
	user, err := s.repo.GetAuthUserByEmail(email)
	if errors.Is(err, store.ErrNotFound) {
		return "", "", store.ErrNotFound
	}
	if err != nil {
		return "", "", err
	}
	companyUser, err := s.repo.GetCompanyUser(companyID, user.UserID)
	if errors.Is(err, store.ErrNotFound) {
		return "", "", store.ErrNotFound
	}
	if err != nil {
		return "", "", err
	}
	return companyUser.Email, companyUser.UserID, nil
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
