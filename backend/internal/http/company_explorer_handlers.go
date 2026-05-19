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
			log.Printf("company explorer folders: failed to list folders company_id=%s folder_kind=%s: %v", companyID, folderKind, err)
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
			return
		}
		if folderKind == "communications" {
			if actor, ok := authenticatedActor(r); ok && !actorCanManageCompany(actor, companyID) {
				items = filterCommunicationsSharedInboxFoldersForUser(items, actor.User.UserID)
			}
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
		AccountEmail   string `json:"account_email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.ParentFolderID = strings.TrimSpace(req.ParentFolderID)
	req.FolderKind = strings.TrimSpace(req.FolderKind)
	req.Name = strings.TrimSpace(req.Name)
	req.AccountEmail = strings.ToLower(strings.TrimSpace(req.AccountEmail))
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
	if req.AccountEmail != "" {
		item, err = s.repo.SetCommunicationsSharedInboxAccountEmail(req.CompanyID, item.FolderID, req.AccountEmail)
		if err != nil {
			_ = s.repo.DeleteCompanyExplorerFolder(req.CompanyID, item.FolderID)
			if errors.Is(err, store.ErrEmailAccountUnavailable) {
				writeError(w, http.StatusBadRequest, "shared_inbox_email_account_not_connected")
				return
			}
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusBadRequest, "invalid_shared_inbox_account_email")
				return
			}
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "shared_inbox_not_found")
				return
			}
			writeError(w, http.StatusInternalServerError, "failed_to_assign_shared_inbox_account_email")
			return
		}
	}
	s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_created", map[string]any{"folder_id": item.FolderID, "folder_kind": item.FolderKind, "folder": item})
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
	if len(parts) == 2 && parts[1] == "raci" {
		s.handleCommunicationsSharedInboxRaci(w, r, folderID)
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
			AccountEmail   *string `json:"account_email"`
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
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusConflict, "protected_company_explorer_folder_cannot_be_renamed")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_rename_company_explorer_folder")
				return
			}
			changed = true
		}
		if req.AccountEmail != nil {
			accountEmail := strings.ToLower(strings.TrimSpace(*req.AccountEmail))
			item, err = s.repo.SetCommunicationsSharedInboxAccountEmail(req.CompanyID, folderID, accountEmail)
			if errors.Is(err, store.ErrEmailAccountUnavailable) {
				writeError(w, http.StatusBadRequest, "shared_inbox_email_account_not_connected")
				return
			}
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "shared_inbox_not_found")
				return
			}
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusBadRequest, "invalid_shared_inbox_account_email")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_update_shared_inbox_account_email")
				return
			}
			changed = true
		}
		if !changed {
			writeError(w, http.StatusBadRequest, "company_explorer_folder_update_required")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_updated", map[string]any{"folder_id": item.FolderID, "folder_kind": item.FolderKind, "folder": item})
		writeJSON(w, http.StatusOK, item)
		return
	}

	if r.Method == http.MethodDelete {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		result, err := s.repo.DeleteCompanyExplorerTargets(companyID, []store.CompanyExplorerDeleteTargetInput{{Kind: "folder", ID: folderID}})
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
		s.publishCompanyExplorerDeletedTargets(companyID, result.Targets)
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}

	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func (s *Server) handleCommunicationsSharedInboxRaci(w http.ResponseWriter, r *http.Request, folderID string) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		folders, err := s.repo.ListCompanyExplorerFolders(companyID, "communications")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox_raci")
			return
		}
		for _, folder := range folders {
			if folder.FolderID != folderID {
				continue
			}
			writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
				"company_id":       companyID,
				"folder_id":        folderID,
				"raci_assignments": folder.RaciAssignments,
			})
			return
		}
		writeError(w, http.StatusNotFound, "shared_inbox_not_found")
		return
	}

	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID   string                                 `json:"company_id"`
		Assignments []store.SharedInboxRaciAssignmentInput `json:"assignments"`
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
	assignments, err := s.repo.SetCommunicationsSharedInboxRaciAssignments(store.SharedInboxRaciAssignmentUpdateInput{
		CompanyID:   req.CompanyID,
		FolderID:    folderID,
		Assignments: req.Assignments,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_shared_inbox_raci_assignments")
		return
	}
	if errors.Is(err, store.ErrAssigneeNotInCompany) {
		writeError(w, http.StatusBadRequest, "shared_inbox_raci_user_not_in_company")
		return
	}
	if errors.Is(err, store.ErrRaciStorageUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "shared_inbox_raci_storage_unavailable")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "shared_inbox_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_update_shared_inbox_raci")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "communications_shared_inbox_raci_updated", map[string]any{"folder_id": folderID, "folder_kind": "communications", "raci_assignments": assignments})
	writeJSON(w, http.StatusOK, map[string]any{
		"company_id":       req.CompanyID,
		"folder_id":        folderID,
		"raci_assignments": assignments,
	})
}

func filterCommunicationsSharedInboxFoldersForUser(folders []domain.CompanyExplorerFolder, userID string) []domain.CompanyExplorerFolder {
	if !communicationsSharedInboxHasRaciAssignments(folders) {
		return folders
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return []domain.CompanyExplorerFolder{}
	}

	byID := make(map[string]domain.CompanyExplorerFolder, len(folders))
	childrenByParent := make(map[string][]domain.CompanyExplorerFolder)
	for _, folder := range folders {
		folderID := strings.TrimSpace(folder.FolderID)
		if folderID == "" {
			continue
		}
		byID[folderID] = folder
		parentID := ""
		if folder.ParentFolderID != nil {
			parentID = strings.TrimSpace(*folder.ParentFolderID)
		}
		childrenByParent[parentID] = append(childrenByParent[parentID], folder)
	}

	included := make(map[string]bool, len(folders))
	var includeAncestors func(string)
	includeAncestors = func(folderID string) {
		seen := make(map[string]bool)
		for folderID != "" && !seen[folderID] {
			seen[folderID] = true
			folder, ok := byID[folderID]
			if !ok {
				return
			}
			included[folderID] = true
			if folder.ParentFolderID == nil {
				return
			}
			folderID = strings.TrimSpace(*folder.ParentFolderID)
		}
	}
	var includeDescendants func(string)
	includeDescendants = func(folderID string) {
		for _, child := range childrenByParent[folderID] {
			childID := strings.TrimSpace(child.FolderID)
			if childID == "" || included[childID] {
				continue
			}
			included[childID] = true
			includeDescendants(childID)
		}
	}

	for _, folder := range folders {
		if !sharedInboxFolderHasAssignmentForUser(folder, userID) {
			continue
		}
		folderID := strings.TrimSpace(folder.FolderID)
		includeAncestors(folderID)
		includeDescendants(folderID)
	}

	filtered := make([]domain.CompanyExplorerFolder, 0, len(included))
	for _, folder := range folders {
		if included[strings.TrimSpace(folder.FolderID)] {
			filtered = append(filtered, folder)
		}
	}
	return filtered
}

func communicationsSharedInboxHasRaciAssignments(folders []domain.CompanyExplorerFolder) bool {
	for _, folder := range folders {
		if len(folder.RaciAssignments) > 0 {
			return true
		}
	}
	return false
}

func sharedInboxFolderHasAssignmentForUser(folder domain.CompanyExplorerFolder, userID string) bool {
	for _, assignment := range folder.RaciAssignments {
		if strings.TrimSpace(assignment.UserID) == userID {
			return true
		}
	}
	return false
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
	if err := s.cognitoAdmin.AdminCreateUser(r.Context(), email); err != nil {
		log.Printf("failed to create cognito invitation user email=%s: %v", email, err)
		return "failed"
	}
	return "sent"
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

	targets := make([]store.CompanyExplorerDeleteTargetInput, 0, len(req.Targets))
	seen := map[string]bool{}
	for _, target := range req.Targets {
		item := store.CompanyExplorerDeleteTargetInput{
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

	result, err := s.repo.DeleteCompanyExplorerTargets(req.CompanyID, targets)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_explorer_delete_target_not_found")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusConflict, "company_explorer_delete_target_invalid")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_company_explorer_targets")
		return
	}

	s.publishCompanyExplorerDeletedTargets(req.CompanyID, result.Targets)
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "targets": result.Targets})
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
		case "kanban":
			s.publishWorkspaceEvent(companyID, "kanban_board_deleted", map[string]any{"board_id": target.ID})
		}
	}
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
		s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_item_assigned", map[string]any{"folder_id": item.FolderID, "item_type": item.ItemType, "item_id": item.ItemID, "folder_item": item})
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
		s.publishWorkspaceEvent(req.CompanyID, "company_explorer_folder_item_assigned", map[string]any{"folder_id": item.FolderID, "item_type": item.ItemType, "item_id": item.ItemID, "folder_item": item})
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
	return value == "node" || value == "logic_gate" || value == "communications"
}

func isValidCompanyExplorerItemType(value string) bool {
	return value == "node" || value == "logic_gate"
}
