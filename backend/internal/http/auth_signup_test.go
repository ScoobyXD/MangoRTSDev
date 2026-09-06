package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func signupRequest(handler http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	return res
}

type signupMeResponse struct {
	User        domain.User                `json:"user"`
	Memberships []domain.CompanyMembership `json:"memberships"`
	IsDevAdmin  bool                       `json:"is_dev_admin"`
}

func signupMe(t *testing.T, handler http.Handler, token string) signupMeResponse {
	t.Helper()
	res := signupRequest(handler, http.MethodGet, "/v1/me", token, "")
	if res.Code != http.StatusOK {
		t.Fatalf("me status=%d body=%s", res.Code, res.Body.String())
	}
	var payload signupMeResponse
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestSignupFirstMeCreatesOneCompanyAcrossServers(t *testing.T) {
	repo := store.NewMemoryRepo()
	validator := &tokenClaimsValidator{claims: map[string]auth.Claims{
		"signup-token": {Subject: "new-signup", Email: "new-signup@example.test"},
	}}
	options := ServerOptions{AuthValidator: validator, BootstrapDevAdmin: BootstrapDevAdminConfig{Emails: []string{"operator@example.test"}, CompanyName: "Operator Company"}}
	handlers := []http.Handler{NewServerWithOptions(repo, options).Routes(), NewServerWithOptions(repo, options).Routes()}
	results := make(chan *httptest.ResponseRecorder, len(handlers))
	start := make(chan struct{})
	for _, handler := range handlers {
		go func() { <-start; results <- signupRequest(handler, http.MethodGet, "/v1/me", "signup-token", "") }()
	}
	close(start)
	companyID := ""
	for range handlers {
		res := <-results
		if res.Code != http.StatusOK {
			t.Fatalf("first me status=%d body=%s", res.Code, res.Body.String())
		}
		var payload signupMeResponse
		if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.IsDevAdmin || payload.User.MailboxEnabled || len(payload.Memberships) != 1 || payload.Memberships[0].Role != domain.RoleCompanyAdmin {
			t.Fatalf("first signup user/context = %+v", payload)
		}
		if companyID != "" && companyID != payload.Memberships[0].CompanyID {
			t.Fatal("concurrent first login created different companies")
		}
		companyID = payload.Memberships[0].CompanyID
	}
	for _, handler := range handlers {
		payload := signupMe(t, handler, "signup-token")
		if len(payload.Memberships) != 1 || payload.Memberships[0].CompanyID != companyID {
			t.Fatalf("retry memberships=%+v", payload.Memberships)
		}
	}
	companies, err := repo.ListCompanies("", 10)
	if err != nil || len(companies) != 1 {
		t.Fatalf("signup companies=%+v err=%v", companies, err)
	}
	if res := signupRequest(handlers[0], http.MethodPost, "/v1/companies", "signup-token", `{"name":"Unauthorized second company"}`); res.Code != http.StatusForbidden {
		t.Fatalf("ordinary signup manual company status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestSignupManualCompanyCreationRequiresDevAdmin(t *testing.T) {
	for _, role := range []string{domain.RoleCompanyUser, domain.RoleCompanyManager, domain.RoleCompanyAdmin, domain.RoleDevAdmin} {
		t.Run(role, func(t *testing.T) {
			repo := store.NewMemoryRepo()
			company := repo.EnsureCompany("11111111-1111-1111-1111-111111111111", "Existing")
			user, err := repo.UpsertAuthUser("company-creator", "creator@example.test", "Creator")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, role); err != nil {
				t.Fatal(err)
			}
			validator := &tokenClaimsValidator{claims: map[string]auth.Claims{"token": {Subject: user.CognitoSubject, Email: user.Email}}}
			handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: validator}).Routes()
			res := signupRequest(handler, http.MethodPost, "/v1/companies", "token", `{"name":"Another Company"}`)
			wantStatus, wantCount := http.StatusForbidden, 1
			if role == domain.RoleDevAdmin {
				wantStatus, wantCount = http.StatusCreated, 2
			}
			if res.Code != wantStatus {
				t.Fatalf("create status=%d want=%d body=%s", res.Code, wantStatus, res.Body.String())
			}
			companies, err := repo.ListCompanies("", 10)
			if err != nil || len(companies) != wantCount {
				t.Fatalf("companies=%+v err=%v", companies, err)
			}
		})
	}
}

func TestAcceptInvitationExistingAccountCannotResetPassword(t *testing.T) {
	repo := store.NewMemoryRepo()
	company := repo.EnsureCompany("11111111-1111-1111-1111-111111111111", "Invited Company")
	home := repo.EnsureCompany("22222222-2222-2222-2222-222222222222", "Existing Company")
	admin, err := repo.UpsertAuthUser("invite-admin", "admin@example.test", "Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("existing-invitee", "existing@example.test", "Original Name")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, home.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	invitation, err := repo.CreateInvitation(store.CreateInvitationInput{CompanyID: company.CompanyID, Email: user.Email, Role: domain.RoleCompanyUser, InvitedByUserID: admin.UserID})
	if err != nil {
		t.Fatal(err)
	}
	cognito := &recordingCognitoAdmin{}
	validator := &tokenClaimsValidator{claims: map[string]auth.Claims{"existing-token": {Subject: user.CognitoSubject, Email: user.Email}}}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: validator, CognitoAdmin: cognito}).Routes()
	validate := signupRequest(handler, http.MethodPost, "/v1/invitations/validate", "", `{"token":"`+invitation.Token+`"}`)
	if validate.Code != http.StatusOK || !strings.Contains(validate.Body.String(), `"account_exists":true`) {
		t.Fatalf("validate status=%d body=%s", validate.Code, validate.Body.String())
	}
	reset := signupRequest(handler, http.MethodPost, "/v1/invitations/accept", "", `{"token":"`+invitation.Token+`","email":"`+user.Email+`","password":"Replacement123!"}`)
	if reset.Code != http.StatusConflict || !strings.Contains(reset.Body.String(), "existing_account_sign_in_required") {
		t.Fatalf("password accept status=%d body=%s", reset.Code, reset.Body.String())
	}
	if len(cognito.acceptedEmails) != 0 || len(cognito.acceptedPasses) != 0 {
		t.Fatal("invitation token attempted to reset existing account password")
	}
	if _, err := repo.ValidateInvitationToken(invitation.Token); err != nil {
		t.Fatalf("rejected reset consumed invitation: %v", err)
	}
	accept := signupRequest(handler, http.MethodPost, "/v1/invitations/accept", "existing-token", `{"token":"`+invitation.Token+`","display_name":"Overwrite Attempt"}`)
	if accept.Code != http.StatusOK {
		t.Fatalf("authenticated accept status=%d body=%s", accept.Code, accept.Body.String())
	}
	payload := signupMe(t, handler, "existing-token")
	if payload.User.DisplayName != "Original Name" || payload.User.UserID != user.UserID || len(payload.Memberships) != 2 || payload.IsDevAdmin {
		t.Fatalf("accepted existing account=%+v", payload)
	}
	if len(cognito.acceptedEmails) != 0 {
		t.Fatal("authenticated acceptance changed Cognito password")
	}
	companies, err := repo.ListCompanies("", 10)
	if err != nil || len(companies) != 2 {
		t.Fatalf("acceptance created extra company: %+v err=%v", companies, err)
	}
}

func TestAcceptInvitationRejectsExistingCognitoAccountWithoutMangoUser(t *testing.T) {
	repo := store.NewMemoryRepo()
	company := repo.EnsureCompany("11111111-1111-1111-1111-111111111111", "Invited Company")
	admin, err := repo.UpsertAuthUser("invite-admin", "admin@example.test", "Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	invitation, err := repo.CreateInvitation(store.CreateInvitationInput{CompanyID: company.CompanyID, Email: "cognito-only@example.test", Role: domain.RoleCompanyUser, InvitedByUserID: admin.UserID})
	if err != nil {
		t.Fatal(err)
	}
	cognito := &recordingCognitoAdmin{acceptErr: auth.ErrCognitoAccountExists}
	handler := NewServerWithOptions(repo, ServerOptions{CognitoAdmin: cognito}).Routes()
	res := signupRequest(handler, http.MethodPost, "/v1/invitations/accept", "", `{"token":"`+invitation.Token+`","email":"`+invitation.Email+`","password":"Replacement123!"}`)
	if res.Code != http.StatusConflict || !strings.Contains(res.Body.String(), "existing_account_sign_in_required") {
		t.Fatalf("Cognito-only accept status=%d body=%s", res.Code, res.Body.String())
	}
	if _, err := repo.GetAuthUserByEmail(invitation.Email); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("rejected acceptance created Mango user: %v", err)
	}
	if _, err := repo.ValidateInvitationToken(invitation.Token); err != nil {
		t.Fatalf("rejected acceptance consumed invitation: %v", err)
	}
}

func TestAcceptInvitationReturnsPasswordPolicyError(t *testing.T) {
	repo := store.NewMemoryRepo()
	company := repo.EnsureCompany("11111111-1111-1111-1111-111111111111", "Invited Company")
	admin, err := repo.UpsertAuthUser("invite-admin", "admin@example.test", "Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	invitation, err := repo.CreateInvitation(store.CreateInvitationInput{CompanyID: company.CompanyID, Email: "weak-password@example.test", Role: domain.RoleCompanyUser, InvitedByUserID: admin.UserID})
	if err != nil {
		t.Fatal(err)
	}
	const policyMessage = "Password did not conform with policy: Password must have uppercase characters"
	cognito := &recordingCognitoAdmin{acceptErr: &auth.CognitoInvalidPasswordError{Message: policyMessage}}
	handler := NewServerWithOptions(repo, ServerOptions{CognitoAdmin: cognito}).Routes()
	res := signupRequest(handler, http.MethodPost, "/v1/invitations/accept", "", `{"token":"`+invitation.Token+`","email":"`+invitation.Email+`","password":"weak"}`)
	var payload struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if res.Code != http.StatusBadRequest || payload.Error != "invalid_signup_password" || payload.Message != policyMessage {
		t.Fatalf("weak password status=%d response=%+v", res.Code, payload)
	}
	if _, err := repo.GetAuthUserByEmail(invitation.Email); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("rejected password created Mango user: %v", err)
	}
	if _, err := repo.ValidateInvitationToken(invitation.Token); err != nil {
		t.Fatalf("rejected password consumed invitation: %v", err)
	}
}

func TestAcceptInvitationBeforeFirstMeUsesInvitedCompanyOnly(t *testing.T) {
	repo := store.NewMemoryRepo()
	company := repo.EnsureCompany("11111111-1111-1111-1111-111111111111", "Invited Company")
	admin, err := repo.UpsertAuthUser("invite-admin", "admin@example.test", "Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	invitation, err := repo.CreateInvitation(store.CreateInvitationInput{CompanyID: company.CompanyID, Email: "new-invitee@example.test", Role: domain.RoleCompanyUser, InvitedByUserID: admin.UserID})
	if err != nil {
		t.Fatal(err)
	}
	validator := &tokenClaimsValidator{claims: map[string]auth.Claims{"new-token": {Subject: "new-invitee", Email: invitation.Email}}}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: validator}).Routes()
	validate := signupRequest(handler, http.MethodPost, "/v1/invitations/validate", "", `{"token":"`+invitation.Token+`"}`)
	if validate.Code != http.StatusOK || !strings.Contains(validate.Body.String(), `"account_exists":false`) {
		t.Fatalf("validate status=%d body=%s", validate.Code, validate.Body.String())
	}
	accept := signupRequest(handler, http.MethodPost, "/v1/invitations/accept", "new-token", `{"token":"`+invitation.Token+`"}`)
	if accept.Code != http.StatusOK {
		t.Fatalf("accept without name status=%d body=%s", accept.Code, accept.Body.String())
	}
	payload := signupMe(t, handler, "new-token")
	if len(payload.Memberships) != 1 || payload.Memberships[0].CompanyID != company.CompanyID || payload.Memberships[0].Role != domain.RoleCompanyUser || payload.User.MailboxEnabled || payload.User.DisplayName != invitation.Email {
		t.Fatalf("invited first login=%+v", payload)
	}
	companies, err := repo.ListCompanies("", 10)
	if err != nil || len(companies) != 1 {
		t.Fatalf("invited signup companies=%+v err=%v", companies, err)
	}
}

func TestDeleteCompanyUserProtectsFinalMembershipAndDevAdmin(t *testing.T) {
	for _, test := range []struct {
		name, targetRole string
		wantStatus       int
		wantError        string
	}{
		{"last membership", domain.RoleCompanyUser, http.StatusConflict, "last_company_membership"},
		{"developer account", domain.RoleDevAdmin, http.StatusForbidden, "dev_admin_required"},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo := store.NewMemoryRepo()
			company := repo.EnsureCompany("11111111-1111-1111-1111-111111111111", "Company")
			actor, err := repo.UpsertAuthUser("company-admin", "admin@example.test", "Administrator")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repo.AddCompanyMembership(actor.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
				t.Fatal(err)
			}
			target, err := repo.UpsertAuthUser("target-user", "target@example.test", "Target")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repo.AddCompanyMembership(target.CognitoSubject, company.CompanyID, test.targetRole); err != nil {
				t.Fatal(err)
			}
			cognito := &recordingCognitoAdmin{}
			validator := &tokenClaimsValidator{claims: map[string]auth.Claims{"admin-token": {Subject: actor.CognitoSubject, Email: actor.Email}}}
			handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: validator, CognitoAdmin: cognito}).Routes()
			res := signupRequest(handler, http.MethodDelete, "/v1/companies/"+company.CompanyID+"/users/"+target.UserID, "admin-token", "")
			if res.Code != test.wantStatus || !strings.Contains(res.Body.String(), test.wantError) {
				t.Fatalf("delete status=%d body=%s", res.Code, res.Body.String())
			}
			if len(cognito.deleted) != 0 {
				t.Fatalf("rejected removal deleted Cognito user: %v", cognito.deleted)
			}
			if _, err := repo.GetAuthUser(target.CognitoSubject); err != nil {
				t.Fatalf("rejected removal deleted identity: %v", err)
			}
			if _, err := repo.GetCompanyUser(company.CompanyID, target.UserID); err != nil {
				t.Fatalf("rejected removal deleted membership: %v", err)
			}
		})
	}
}
