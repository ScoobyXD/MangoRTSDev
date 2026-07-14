package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) requireAccountCompanyAccess(w http.ResponseWriter, r *http.Request, companyID string) (ActorContext, bool) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return ActorContext{}, false
	}
	actor, ok := authenticatedActor(r)
	if !ok || actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return ActorContext{}, false
	}
	return actor, true
}

func (s *Server) handleAccounts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		items, err := s.repo.ListAccounts(companyID)
		if err != nil {
			writeAccountError(w, err, "failed_to_list_accounts")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"accounts": items})
	case http.MethodPost:
		var req struct {
			CompanyID string  `json:"company_id"`
			AccountID string  `json:"account_id"`
			Name      string  `json:"name"`
			FolderID  *string `json:"folder_id"`
			Position  int     `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		actor, ok := s.requireAccountCompanyAccess(w, r, req.CompanyID)
		if !ok {
			return
		}
		result, err := s.repo.CreateAccount(store.AccountInput{
			CompanyID:   req.CompanyID,
			AccountID:   req.AccountID,
			Name:        req.Name,
			FolderID:    req.FolderID,
			Position:    req.Position,
			ActorUserID: actor.User.UserID,
		})
		if err != nil {
			writeAccountError(w, err, "failed_to_create_account")
			return
		}
		writeJSON(w, http.StatusCreated, result.Account)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleAccountByID(w http.ResponseWriter, r *http.Request) {
	accountID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/accounts/"), "/")
	if accountID == "" {
		writeError(w, http.StatusNotFound, "account_not_found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var fields map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		companyIDValue, companyIDSet, ok := parseOptionalStringField(fields, "company_id")
		if !ok || !companyIDSet || companyIDValue == nil || strings.TrimSpace(*companyIDValue) == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		actor, authorized := s.requireAccountCompanyAccess(w, r, *companyIDValue)
		if !authorized {
			return
		}
		input := store.AccountInput{CompanyID: *companyIDValue, AccountID: accountID, ActorUserID: actor.User.UserID}
		if name, set, ok := parseOptionalStringField(fields, "name"); !ok {
			writeError(w, http.StatusBadRequest, "invalid_name")
			return
		} else if set && name != nil {
			input.Name = *name
		}
		if folderID, set, ok := parseOptionalStringField(fields, "folder_id"); !ok {
			writeError(w, http.StatusBadRequest, "invalid_folder_id")
			return
		} else if set {
			input.FolderID = folderID
			input.FolderIDSet = true
		}
		if positionRaw, ok := fields["position"]; ok {
			var position int
			if err := json.Unmarshal(positionRaw, &position); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_position")
				return
			}
			input.Position = position
			input.PositionSet = true
		}
		result, err := s.repo.UpdateAccount(input)
		if err != nil {
			writeAccountError(w, err, "failed_to_update_account")
			return
		}
		writeJSON(w, http.StatusOK, result.Account)
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		actor, ok := s.requireAccountCompanyAccess(w, r, companyID)
		if !ok {
			return
		}
		result, err := s.repo.DeleteAccount(companyID, accountID, actor.User.UserID)
		if err != nil {
			writeAccountError(w, err, "failed_to_delete_account")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted_account_id": result.DeletedAccountID})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleAccountFolders(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		items, err := s.repo.ListAccountFolders(companyID)
		if err != nil {
			writeAccountError(w, err, "failed_to_list_account_folders")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"folders": items})
	case http.MethodPost:
		var req struct {
			CompanyID      string  `json:"company_id"`
			FolderID       string  `json:"folder_id"`
			ParentFolderID *string `json:"parent_folder_id"`
			Name           string  `json:"name"`
			Position       int     `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if _, ok := s.requireAccountCompanyAccess(w, r, req.CompanyID); !ok {
			return
		}
		item, err := s.repo.CreateAccountFolder(store.AccountFolderInput{
			CompanyID:      req.CompanyID,
			FolderID:       req.FolderID,
			ParentFolderID: req.ParentFolderID,
			Name:           req.Name,
			Position:       req.Position,
		})
		if err != nil {
			writeAccountError(w, err, "failed_to_create_account_folder")
			return
		}
		writeJSON(w, http.StatusCreated, item)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleAccountFolderByID(w http.ResponseWriter, r *http.Request) {
	folderID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/account-folders/"), "/")
	if folderID == "" {
		writeError(w, http.StatusNotFound, "account_folder_not_found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var fields map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		companyIDValue, companyIDSet, ok := parseOptionalStringField(fields, "company_id")
		if !ok || !companyIDSet || companyIDValue == nil || strings.TrimSpace(*companyIDValue) == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if _, authorized := s.requireAccountCompanyAccess(w, r, *companyIDValue); !authorized {
			return
		}
		input := store.AccountFolderInput{CompanyID: *companyIDValue, FolderID: folderID}
		if name, set, ok := parseOptionalStringField(fields, "name"); !ok {
			writeError(w, http.StatusBadRequest, "invalid_name")
			return
		} else if set && name != nil {
			input.Name = *name
		}
		if parentFolderID, set, ok := parseOptionalStringField(fields, "parent_folder_id"); !ok {
			writeError(w, http.StatusBadRequest, "invalid_parent_folder_id")
			return
		} else if set {
			input.ParentFolderID = parentFolderID
			input.ParentFolderIDSet = true
		}
		if positionRaw, ok := fields["position"]; ok {
			var position int
			if err := json.Unmarshal(positionRaw, &position); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_position")
				return
			}
			input.Position = position
			input.PositionSet = true
		}
		item, err := s.repo.UpdateAccountFolder(input)
		if err != nil {
			writeAccountError(w, err, "failed_to_update_account_folder")
			return
		}
		writeJSON(w, http.StatusOK, item)
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		if err := s.repo.DeleteAccountFolder(companyID, folderID); err != nil {
			writeAccountError(w, err, "failed_to_delete_account_folder")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted_folder_id": folderID})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleNodeAccounts(w http.ResponseWriter, r *http.Request, nodeID string) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if !s.requireEntityView(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") {
			return
		}
		assignments, err := s.repo.ListNodeAccountAssignments(companyID, nodeID)
		if err != nil {
			writeAccountError(w, err, "failed_to_list_node_account_assignments")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"assignments": assignments})
	case http.MethodPut:
		var req struct {
			CompanyID  string   `json:"company_id"`
			AccountIDs []string `json:"account_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
			return
		}
		actorUserID := ""
		if actor, ok := authenticatedActor(r); ok {
			actorUserID = actor.User.UserID
		}
		result, err := s.repo.SetNodeAccountAssignments(store.NodeAccountAssignmentUpdateInput{
			CompanyID:   req.CompanyID,
			NodeID:      nodeID,
			AccountIDs:  req.AccountIDs,
			ActorUserID: actorUserID,
		})
		if err != nil {
			writeAccountError(w, err, "failed_to_set_node_account_assignments")
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		writeJSON(w, http.StatusOK, map[string]any{"node": result.Node, "assignments": result.Assignments})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func writeAccountError(w http.ResponseWriter, err error, fallback string) {
	if errors.Is(err, store.ErrProtectedEmailCollaborationResource) {
		writeError(w, http.StatusConflict, "email_collaboration_node_managed")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_account_request")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "account_not_found")
		return
	}
	if errors.Is(err, store.ErrAlreadyExists) {
		writeError(w, http.StatusConflict, "account_already_exists")
		return
	}
	writeError(w, http.StatusInternalServerError, fallback)
}
