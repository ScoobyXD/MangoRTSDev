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

const cognitoPasswordResetTTLSeconds = 60 * 60

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
	if r.Method == http.MethodGet {
		if !requireDevAdmin(w, r) {
			return
		}
		limit := store.DefaultCompanyListLimit
		if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
			parsed, err := strconv.Atoi(rawLimit)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid_company_limit")
				return
			}
			limit = parsed
		}
		companies, err := s.repo.ListCompanies(r.URL.Query().Get("query"), limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_companies")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"companies": companies})
		return
	}
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
	if len(parts) < 2 || len(parts) > 3 || strings.TrimSpace(parts[0]) == "" || parts[1] != "users" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	companyID := strings.TrimSpace(parts[0])
	if len(parts) == 2 {
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
		return
	}
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if !requireCompanyManager(w, r, companyID) {
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	userID := strings.TrimSpace(parts[2])
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user_id_required")
		return
	}
	target, err := s.repo.GetCompanyUser(companyID, userID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "user_id_required")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_user_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_company_user")
		return
	}
	if target.UserID == actor.User.UserID {
		writeError(w, http.StatusConflict, "cannot_delete_self")
		return
	}
	if s.cognitoAdmin == nil {
		writeError(w, http.StatusServiceUnavailable, "cognito_admin_not_configured")
		return
	}
	if err := s.cognitoAdmin.AdminDeleteUser(r.Context(), target.CognitoSubject); err != nil {
		log.Printf("failed to delete cognito user email=%s cognito_subject=%s user_id=%s: %v", target.Email, target.CognitoSubject, target.UserID, err)
		writeError(w, http.StatusBadGateway, "failed_to_delete_cognito_user")
		return
	}
	deleted, err := s.repo.DeleteCompanyUser(companyID, userID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_user_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_company_user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "user": deleted})
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

func (s *Server) handleInvitationValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	invitation, err := s.repo.ValidateInvitationToken(req.Token)
	if err != nil {
		writeInvitationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"invitation": invitation})
}

func (s *Server) handleInvitationAccept(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	claims, ok := authenticatedClaims(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req struct {
		Token       string `json:"token"`
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.DisplayName) == "" {
		writeError(w, http.StatusBadRequest, "display_name_required")
		return
	}
	if strings.TrimSpace(req.Token) == "" {
		writeError(w, http.StatusBadRequest, "invitation_token_required")
		return
	}
	if strings.TrimSpace(claims.Email) == "" {
		writeError(w, http.StatusBadRequest, "authenticated_email_required")
		return
	}
	invitation, err := s.repo.AcceptInvitation(req.Token, claims.Subject, claims.Email, req.DisplayName)
	if err != nil {
		if writeInvitationError(w, err) {
			return
		}
		writeError(w, http.StatusInternalServerError, "failed_to_accept_invitation")
		return
	}
	emailStatus := "not_configured"
	if s.emailSender != nil {
		emailStatus = "sent"
		if err := s.emailSender.SendSignupConfirmation(r.Context(), invitation.Email, invitation.CompanyName); err != nil {
			emailStatus = "failed"
			log.Printf("failed to send signup confirmation email=%s company_id=%s: %v", invitation.Email, invitation.CompanyID, err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"invitation":                invitation,
		"confirmation_email_status": emailStatus,
	})
}

func writeInvitationError(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invitation_token_required")
	case errors.Is(err, store.ErrInvitationBadToken):
		writeError(w, http.StatusNotFound, "invitation_bad_token")
	case errors.Is(err, store.ErrInvitationExpired):
		writeError(w, http.StatusGone, "invitation_expired")
	case errors.Is(err, store.ErrInvitationAlreadyAccepted):
		writeError(w, http.StatusConflict, "invitation_already_accepted")
	case errors.Is(err, store.ErrInvitationReplaced):
		writeError(w, http.StatusConflict, "invitation_replaced")
	case errors.Is(err, store.ErrInvitationEmailMismatch):
		writeError(w, http.StatusForbidden, "invitation_email_mismatch")
	default:
		return false
	}
	return true
}

func (s *Server) handlePasswordResetRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	email := strings.TrimSpace(req.Email)
	if email == "" {
		writeError(w, http.StatusBadRequest, "email_required")
		return
	}
	if _, err := s.repo.GetAuthUserByEmail(email); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "password_reset_user_not_found")
		return
	} else if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "email_required")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_lookup_user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":             "reset_user_found",
		"expires_in_seconds": cognitoPasswordResetTTLSeconds,
	})
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
