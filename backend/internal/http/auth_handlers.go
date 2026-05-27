package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/url"
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
	s.authCache.clear()
	writeJSON(w, http.StatusCreated, company)
}

func (s *Server) handleCompanySubresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/companies/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 || len(parts) > 4 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	companyID := strings.TrimSpace(parts[0])
	switch parts[1] {
	case "users":
		s.handleCompanyUsersSubresource(w, r, companyID, parts[2:])
	case "onboarding":
		s.handleCompanyOnboardingSubresource(w, r, companyID, parts[2:])
	case "user-groups":
		s.handleCompanyUserGroupsSubresource(w, r, companyID, parts[2:])
	default:
		writeError(w, http.StatusNotFound, "not_found")
	}
}

func (s *Server) handleCompanyOnboardingSubresource(w http.ResponseWriter, r *http.Request, companyID string, parts []string) {
	if len(parts) != 0 {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if !requireCompanyManager(w, r, companyID) {
		return
	}
	items, err := s.repo.ListCompanyUserOnboarding(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_onboarding")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"onboarding": items})
}

func (s *Server) handleCompanyUsersSubresource(w http.ResponseWriter, r *http.Request, companyID string, parts []string) {
	if len(parts) == 0 {
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
	if len(parts) != 1 {
		writeError(w, http.StatusNotFound, "not_found")
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
	userID := strings.TrimSpace(parts[0])
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
	result, err := s.repo.DeleteCompanyUser(companyID, userID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_user_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_company_user")
		return
	}
	s.authCache.invalidateSubject(result.User.CognitoSubject)
	s.authCache.invalidateUser(result.User.UserID)
	s.authCache.invalidateCompany(companyID)
	cognitoDeleted := false
	if result.DeleteExternalIdentity {
		if s.cognitoAdmin == nil {
			log.Printf("queued cognito user deletion because cognito admin is not configured email=%s cognito_subject=%s user_id=%s", result.User.Email, result.User.CognitoSubject, result.User.UserID)
		} else if err := s.cognitoAdmin.AdminDeleteUser(r.Context(), result.User.CognitoSubject); err != nil {
			log.Printf("queued cognito user deletion after delete failure email=%s cognito_subject=%s user_id=%s: %v", result.User.Email, result.User.CognitoSubject, result.User.UserID, err)
		} else {
			cognitoDeleted = true
			if err := s.repo.CompleteExternalIdentityDeletion(result.User.CognitoSubject); err != nil {
				log.Printf("failed to mark cognito deletion complete email=%s cognito_subject=%s user_id=%s: %v", result.User.Email, result.User.CognitoSubject, result.User.UserID, err)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":                            "deleted",
		"user":                              result.User,
		"cognito_user_deleted":              cognitoDeleted,
		"external_identity_deletion_queued": result.DeleteExternalIdentity && !cognitoDeleted,
	})
}

func (s *Server) handleCompanyUserGroupsSubresource(w http.ResponseWriter, r *http.Request, companyID string, parts []string) {
	if len(parts) == 0 {
		switch r.Method {
		case http.MethodGet:
			if !requireCompanyAccess(w, r, companyID) {
				return
			}
			groups, err := s.repo.ListCompanyUserGroups(companyID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_user_groups")
				return
			}
			members, err := s.repo.ListCompanyUserGroupMembers(companyID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_user_group_members")
				return
			}
			writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"groups": groups, "members": members})
			return
		case http.MethodPost:
			if !requireCompanyManager(w, r, companyID) {
				return
			}
			var req struct {
				Name          string `json:"name"`
				ParentGroupID string `json:"parent_group_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_json")
				return
			}
			group, err := s.repo.CreateCompanyUserGroup(companyID, req.ParentGroupID, req.Name)
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusBadRequest, "invalid_user_group")
				return
			}
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "user_group_parent_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_create_user_group")
				return
			}
			writeJSON(w, http.StatusCreated, group)
			return
		default:
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
	}

	if len(parts) == 2 && parts[1] == "members" {
		if r.Method != http.MethodPut {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		if !requireCompanyManager(w, r, companyID) {
			return
		}
		var req struct {
			UserIDs []string `json:"user_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		members, err := s.repo.SetCompanyUserGroupMembers(companyID, strings.TrimSpace(parts[0]), req.UserIDs)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_user_group_members")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "user_group_not_found")
			return
		}
		if errors.Is(err, store.ErrAssigneeNotInCompany) {
			writeError(w, http.StatusBadRequest, "user_group_member_not_in_company")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_update_user_group_members")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"members": members})
		return
	}

	if len(parts) != 1 {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	groupID := strings.TrimSpace(parts[0])
	if groupID == "" {
		writeError(w, http.StatusBadRequest, "user_group_id_required")
		return
	}
	if !requireCompanyManager(w, r, companyID) {
		return
	}
	switch r.Method {
	case http.MethodPut:
		var fields map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		name := ""
		if raw, ok := fields["name"]; ok {
			if err := json.Unmarshal(raw, &name); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_user_group_name")
				return
			}
		}
		parentGroupID, _, ok := parseOptionalStringField(fields, "parent_group_id")
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_parent_group_id")
			return
		}
		position := 0
		if raw, ok := fields["position"]; ok && strings.TrimSpace(string(raw)) != "null" {
			if err := json.Unmarshal(raw, &position); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_user_group_position")
				return
			}
		}
		group, err := s.repo.UpdateCompanyUserGroup(companyID, groupID, parentGroupID, name, position)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_user_group")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "user_group_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_update_user_group")
			return
		}
		writeJSON(w, http.StatusOK, group)
		return
	case http.MethodDelete:
		err := s.repo.DeleteCompanyUserGroup(companyID, groupID)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_user_group")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "user_group_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_delete_user_group")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
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
	inviteToken := invitation.Token

	_, existingUserErr := s.repo.GetAuthUserByEmail(invitation.Email)
	existingMangoUser := existingUserErr == nil
	if existingUserErr != nil && !errors.Is(existingUserErr, store.ErrNotFound) {
		writeError(w, http.StatusInternalServerError, "failed_to_lookup_user")
		return
	}

	cognitoStatus := "not_configured"
	temporaryPassword := ""
	if s.cognitoAdmin != nil {
		if existingMangoUser {
			cognitoStatus = "existing_mango_user"
		} else {
			result, err := s.cognitoAdmin.AdminCreateUser(r.Context(), invitation.Email)
			if err != nil {
				log.Printf("failed to create cognito invitation user email=%s: %v", invitation.Email, err)
				updated, updateErr := s.repo.UpdateInvitationDeliveryStatus(store.InvitationDeliveryStatusInput{
					InvitationID:  invitation.InvitationID,
					CognitoStatus: "failed",
					CognitoError:  compactErrorDetail(err),
				})
				if updateErr != nil {
					log.Printf("failed to persist cognito invite failure invitation_id=%s email=%s: %v", invitation.InvitationID, invitation.Email, updateErr)
				} else {
					invitation = updated
					invitation.Token = inviteToken
				}
				writeError(w, http.StatusBadGateway, "failed_to_create_cognito_user")
				return
			}
			cognitoStatus = firstNonBlank(result.Status, "created")
			temporaryPassword = result.TemporaryPassword
		}
	}
	if updated, err := s.repo.UpdateInvitationDeliveryStatus(store.InvitationDeliveryStatusInput{
		InvitationID:  invitation.InvitationID,
		CognitoStatus: cognitoStatus,
	}); err != nil {
		log.Printf("failed to persist cognito invite status invitation_id=%s email=%s status=%s: %v", invitation.InvitationID, invitation.Email, cognitoStatus, err)
	} else {
		invitation = updated
		invitation.Token = inviteToken
	}

	inviteEmailStatus := "not_configured"
	inviteEmailError := ""
	acceptURL := s.invitationAcceptURL(r, inviteToken)
	if s.emailSender != nil {
		inviteEmailStatus = "sent"
		if err := s.emailSender.SendInvitation(r.Context(), auth.InvitationEmailInput{
			Email:             invitation.Email,
			CompanyName:       invitation.CompanyName,
			AcceptURL:         acceptURL,
			TemporaryPassword: temporaryPassword,
			ExpiresAt:         invitation.ExpiresTimestamp,
		}); err != nil {
			inviteEmailStatus = "failed"
			inviteEmailError = compactErrorDetail(err)
			log.Printf("failed to send invitation email=%s company_id=%s invitation_id=%s: %v", invitation.Email, invitation.CompanyID, invitation.InvitationID, err)
		}
	}
	if updated, err := s.repo.UpdateInvitationDeliveryStatus(store.InvitationDeliveryStatusInput{
		InvitationID:      invitation.InvitationID,
		InviteEmailStatus: inviteEmailStatus,
		InviteEmailError:  inviteEmailError,
	}); err != nil {
		log.Printf("failed to persist invite email status invitation_id=%s email=%s status=%s: %v", invitation.InvitationID, invitation.Email, inviteEmailStatus, err)
	} else {
		invitation = updated
		invitation.Token = inviteToken
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"invitation":            invitation,
		"cognito_invite_status": cognitoStatus,
		"cognito_user_status":   cognitoStatus,
		"invite_email_status":   inviteEmailStatus,
		"invite_email_error":    inviteEmailError,
		"delivery_ok":           inviteEmailStatus == "sent",
		"accept_url":            acceptURL,
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
	s.authCache.invalidateSubject(claims.Subject)
	s.authCache.invalidateCompany(invitation.CompanyID)
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

func compactErrorDetail(err error) string {
	if err == nil {
		return ""
	}
	detail := strings.TrimSpace(err.Error())
	if len(detail) <= 500 {
		return detail
	}
	return detail[:500]
}

func (s *Server) invitationAcceptURL(r *http.Request, token string) string {
	base := strings.TrimSpace(s.appBaseURL)
	if base == "" {
		base = frontendOriginFromURL(s.nylasConfig.FrontendRedirectURL)
	}
	if base == "" {
		base = requestOrigin(r)
	}
	if base == "" {
		base = "/"
	}
	target, err := url.Parse(base)
	if err != nil {
		target = &url.URL{Path: "/"}
	}
	if target.Scheme == "" && target.Host == "" && !strings.HasPrefix(target.Path, "/") {
		target.Path = "/" + target.Path
	}
	target.Path = "/accept-invite"
	query := target.Query()
	query.Set("token", strings.TrimSpace(token))
	target.RawQuery = query.Encode()
	target.Fragment = ""
	return target.String()
}

func frontendOriginFromURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func requestOrigin(r *http.Request) string {
	if r == nil {
		return ""
	}
	if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" {
		return origin
	}
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(r.Host)
	}
	if host == "" {
		return ""
	}
	scheme := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if scheme == "" {
		if r.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	return scheme + "://" + host
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
