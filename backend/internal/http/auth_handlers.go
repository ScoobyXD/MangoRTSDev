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

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"user":         actor.User,
		"memberships":  actor.Memberships,
		"is_dev_admin": actor.IsDevAdmin,
	})
}

func (s *Server) handleCompanies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if !requireDevAdmin(w, r) {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	company, err := s.repo.CreateCompany(strings.TrimSpace(req.Name))
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "company_name_required")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_company")
		return
	}
	writeJSON(w, http.StatusCreated, company)
}

func (s *Server) handleCompanySubresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/companies/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || parts[1] != "users" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	companyID := strings.TrimSpace(parts[0])
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if !requireCompanyAccess(w, r, companyID) {
		return
	}
	users, err := s.repo.ListCompanyUsers(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_users")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"users": users})
}

func (s *Server) handleInvitations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req struct {
		CompanyID string `json:"company_id"`
		Email     string `json:"email"`
		Role      string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if !requireCompanyManager(w, r, req.CompanyID) {
		return
	}
	invitation, err := s.repo.CreateInvitation(store.CreateInvitationInput{
		CompanyID:       req.CompanyID,
		Email:           req.Email,
		Role:            req.Role,
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

	cognitoStatus := "not_configured"
	if s.cognitoAdmin != nil {
		cognitoStatus = "sent"
		if err := s.cognitoAdmin.AdminCreateUser(r.Context(), invitation.Email); err != nil {
			log.Printf("failed to create cognito invitation user email=%s: %v", invitation.Email, err)
			writeError(w, http.StatusBadGateway, "failed_to_create_cognito_user")
			return
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"invitation":            invitation,
		"cognito_invite_status": cognitoStatus,
	})
}

func (s *Server) handleInvitationAccept(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	email := actor.User.Email
	if email == "" {
		email = actor.Claims.Email
	}
	invitation, err := s.repo.AcceptInvitation(req.Token, actor.Claims.Subject, email)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusForbidden, "invitation_email_mismatch")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "invitation_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_accept_invitation")
		return
	}
	writeJSON(w, http.StatusOK, invitation)
}

func (s *Server) handleResourceAssignments(w http.ResponseWriter, r *http.Request) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		userID := strings.TrimSpace(r.URL.Query().Get("user_id"))
		if !actorCanManageCompany(actor, companyID) {
			userID = actor.User.UserID
		}
		items, err := s.repo.ListResourceAssignments(store.ResourceAssignmentQuery{
			CompanyID:    companyID,
			ResourceType: strings.TrimSpace(r.URL.Query().Get("resource_type")),
			ResourceID:   strings.TrimSpace(r.URL.Query().Get("resource_id")),
			UserID:       userID,
		})
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_resource_assignment_query")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_resource_assignments")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"assignments": items})
		return
	}
	if r.Method == http.MethodPost {
		var req struct {
			CompanyID    string `json:"company_id"`
			ResourceType string `json:"resource_type"`
			ResourceID   string `json:"resource_id"`
			UserID       string `json:"user_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		if !requireCompanyManager(w, r, req.CompanyID) {
			return
		}
		item, err := s.repo.AssignResource(store.ResourceAssignmentInput{
			CompanyID:        req.CompanyID,
			ResourceType:     req.ResourceType,
			ResourceID:       req.ResourceID,
			UserID:           req.UserID,
			AssignedByUserID: actor.User.UserID,
		})
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_resource_assignment")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "assigned_user_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_assign_resource")
			return
		}
		writeJSON(w, http.StatusCreated, item)
		return
	}
	if r.Method == http.MethodDelete {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if !requireCompanyManager(w, r, companyID) {
			return
		}
		err := s.repo.UnassignResource(
			companyID,
			r.URL.Query().Get("resource_type"),
			r.URL.Query().Get("resource_id"),
			r.URL.Query().Get("user_id"),
		)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_resource_assignment")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "resource_assignment_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_unassign_resource")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "unassigned"})
		return
	}
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func requireDevAdmin(w http.ResponseWriter, r *http.Request) bool {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return false
	}
	if !actor.IsDevAdmin {
		writeError(w, http.StatusForbidden, "dev_admin_required")
		return false
	}
	return true
}

func requireCompanyManager(w http.ResponseWriter, r *http.Request, companyID string) bool {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return false
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return false
	}
	if !actorCanManageCompany(actor, companyID) {
		writeError(w, http.StatusForbidden, "company_admin_required")
		return false
	}
	return true
}

func requireCompanyAccess(w http.ResponseWriter, r *http.Request, companyID string) bool {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return false
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return false
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return false
	}
	return true
}

func actorCanManageCompany(actor ActorContext, companyID string) bool {
	if actor.IsDevAdmin {
		return true
	}
	return actorRoleForCompany(actor, companyID) == domain.RoleCompanyAdmin
}
