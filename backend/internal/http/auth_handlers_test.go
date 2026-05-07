package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type recordingCognitoAdmin struct {
	emails      []string
	passwordSet []string
}

func (c *recordingCognitoAdmin) AdminCreateUser(_ context.Context, email string) error {
	c.emails = append(c.emails, email)
	return nil
}

func (c *recordingCognitoAdmin) AdminSetUserPassword(_ context.Context, email, _ string) error {
	c.passwordSet = append(c.passwordSet, email)
	return nil
}

type recordingEmailSender struct {
	passwordResetEmails []string
	passwordResetCodes  []string
	signupEmails        []string
	signupCompanies     []string
}

func (s *recordingEmailSender) SendPasswordResetCode(_ context.Context, email, code string, _ time.Duration) error {
	s.passwordResetEmails = append(s.passwordResetEmails, email)
	s.passwordResetCodes = append(s.passwordResetCodes, code)
	return nil
}

func (s *recordingEmailSender) SendSignupConfirmation(_ context.Context, email, companyName string) error {
	s.signupEmails = append(s.signupEmails, email)
	s.signupCompanies = append(s.signupCompanies, companyName)
	return nil
}

func TestCreateInvitationRejectsExistingMangoUser(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const adminSubject = "admin-subject"
	const existingSubject = "existing-subject"
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	if _, err := repo.UpsertAuthUser(adminSubject, "admin@example.com", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(adminSubject, companyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertAuthUser(existingSubject, "existing@example.com", ""); err != nil {
		t.Fatal(err)
	}
	cognito := &recordingCognitoAdmin{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		CognitoAdmin:  cognito,
	}).Routes()

	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/invitations",
		strings.NewReader(`{"company_id":"`+companyID+`","email":"existing@example.com","role":"company_user"}`),
	)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", adminSubject, "admin@example.com"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d, body=%s", res.Code, http.StatusConflict, strings.TrimSpace(res.Body.String()))
	}
	if len(cognito.emails) != 0 {
		t.Fatalf("cognito invite calls = %v, want none", cognito.emails)
	}
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error != "user_already_exists" {
		t.Fatalf("error = %q, want user_already_exists", payload.Error)
	}
}

func TestCreateInvitationSendsCognitoForNewMangoUser(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const adminSubject = "admin-subject"
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	if _, err := repo.UpsertAuthUser(adminSubject, "admin@example.com", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(adminSubject, companyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	cognito := &recordingCognitoAdmin{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		CognitoAdmin:  cognito,
	}).Routes()

	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/invitations",
		strings.NewReader(`{"company_id":"`+companyID+`","email":"new@example.com","role":"company_user"}`),
	)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", adminSubject, "admin@example.com"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body=%s", res.Code, http.StatusCreated, strings.TrimSpace(res.Body.String()))
	}
	if len(cognito.emails) != 1 || cognito.emails[0] != "new@example.com" {
		t.Fatalf("cognito invite calls = %v, want [new@example.com]", cognito.emails)
	}
	var payload struct {
		CognitoInviteStatus string `json:"cognito_invite_status"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.CognitoInviteStatus != "sent" {
		t.Fatalf("cognito status = %q, want sent", payload.CognitoInviteStatus)
	}
}

func TestCreateInvitationRejectsCompanyUser(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "company-user-subject"
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	if _, err := repo.UpsertAuthUser(subject, "user@example.com", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	cognito := &recordingCognitoAdmin{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		CognitoAdmin:  cognito,
	}).Routes()

	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/invitations",
		strings.NewReader(`{"company_id":"`+companyID+`","email":"new@example.com","role":"company_user"}`),
	)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, "user@example.com"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d, body=%s", res.Code, http.StatusForbidden, strings.TrimSpace(res.Body.String()))
	}
	if len(cognito.emails) != 0 {
		t.Fatalf("cognito invite calls = %v, want none", cognito.emails)
	}
}

func TestInvitationAcceptRejectsOlderTokenForSameCompanyEmail(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const adminSubject = "admin-subject"
	const inviteeSubject = "invitee-subject"
	const inviteeEmail = "invitee@example.com"
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	if _, err := repo.UpsertAuthUser(adminSubject, "admin@example.com", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(adminSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	adminToken := "Bearer " + testJWT(t, key, "kid", adminSubject, "admin@example.com")

	firstToken := createInvitationForTest(t, handler, adminToken, companyID, inviteeEmail)
	secondToken := createInvitationForTest(t, handler, adminToken, companyID, inviteeEmail)
	if firstToken == secondToken {
		t.Fatal("expected distinct invite tokens")
	}

	inviteeToken := "Bearer " + testJWT(t, key, "kid", inviteeSubject, inviteeEmail)
	firstAcceptReq := httptest.NewRequest(http.MethodPost, "/v1/invitations/accept", strings.NewReader(`{"token":"`+firstToken+`","display_name":"Invitee User"}`))
	firstAcceptReq.Header.Set("Authorization", inviteeToken)
	firstAcceptRes := httptest.NewRecorder()
	handler.ServeHTTP(firstAcceptRes, firstAcceptReq)
	if firstAcceptRes.Code != http.StatusNotFound {
		t.Fatalf("first accept status = %d, want %d, body=%s", firstAcceptRes.Code, http.StatusNotFound, strings.TrimSpace(firstAcceptRes.Body.String()))
	}

	secondAcceptReq := httptest.NewRequest(http.MethodPost, "/v1/invitations/accept", strings.NewReader(`{"token":"`+secondToken+`","display_name":"Invitee User"}`))
	secondAcceptReq.Header.Set("Authorization", inviteeToken)
	secondAcceptRes := httptest.NewRecorder()
	handler.ServeHTTP(secondAcceptRes, secondAcceptReq)
	if secondAcceptRes.Code != http.StatusOK {
		t.Fatalf("second accept status = %d, want %d, body=%s", secondAcceptRes.Code, http.StatusOK, strings.TrimSpace(secondAcceptRes.Body.String()))
	}
}

func TestInvitationAcceptStoresDisplayNameAndSendsConfirmation(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const adminSubject = "admin-subject"
	const inviteeSubject = "invitee-subject"
	const inviteeEmail = "invitee@example.com"
	repo.EnsureCompany(companyID, "Acme Systems")
	if _, err := repo.UpsertAuthUser(adminSubject, "admin@example.com", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(adminSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	emailSender := &recordingEmailSender{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		EmailSender:   emailSender,
	}).Routes()
	adminToken := "Bearer " + testJWT(t, key, "kid", adminSubject, "admin@example.com")
	inviteToken := createInvitationForTest(t, handler, adminToken, companyID, inviteeEmail)

	acceptReq := httptest.NewRequest(http.MethodPost, "/v1/invitations/accept", strings.NewReader(`{"token":"`+inviteToken+`","display_name":"Invitee User"}`))
	acceptReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", inviteeSubject, inviteeEmail))
	acceptRes := httptest.NewRecorder()
	handler.ServeHTTP(acceptRes, acceptReq)
	if acceptRes.Code != http.StatusOK {
		t.Fatalf("accept status = %d, want %d, body=%s", acceptRes.Code, http.StatusOK, strings.TrimSpace(acceptRes.Body.String()))
	}
	user, err := repo.GetAuthUser(inviteeSubject)
	if err != nil {
		t.Fatal(err)
	}
	if user.DisplayName != "Invitee User" {
		t.Fatalf("display name = %q, want Invitee User", user.DisplayName)
	}
	if len(emailSender.signupEmails) != 1 || emailSender.signupEmails[0] != inviteeEmail {
		t.Fatalf("signup emails = %v, want [%s]", emailSender.signupEmails, inviteeEmail)
	}
	if len(emailSender.signupCompanies) != 1 || emailSender.signupCompanies[0] != "Acme Systems" {
		t.Fatalf("signup companies = %v, want [Acme Systems]", emailSender.signupCompanies)
	}
}

func TestPasswordResetUsesFiveMinuteLatestCode(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const email = "reset@example.com"
	if _, err := repo.UpsertAuthUser("reset-subject", email, "Reset User"); err != nil {
		t.Fatal(err)
	}
	cognito := &recordingCognitoAdmin{}
	emailSender := &recordingEmailSender{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		CognitoAdmin:  cognito,
		EmailSender:   emailSender,
	}).Routes()

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/password-resets/request", strings.NewReader(`{"email":"`+email+`"}`))
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("request %d status = %d, want %d, body=%s", i, res.Code, http.StatusOK, strings.TrimSpace(res.Body.String()))
		}
	}
	if len(emailSender.passwordResetCodes) != 2 {
		t.Fatalf("password reset codes = %d, want 2", len(emailSender.passwordResetCodes))
	}

	oldCode := emailSender.passwordResetCodes[0]
	latestCode := emailSender.passwordResetCodes[1]
	oldReq := httptest.NewRequest(http.MethodPost, "/v1/password-resets/confirm", strings.NewReader(`{"email":"`+email+`","code":"`+oldCode+`","new_password":"NewPassword1!"}`))
	oldRes := httptest.NewRecorder()
	handler.ServeHTTP(oldRes, oldReq)
	if oldRes.Code != http.StatusBadRequest {
		t.Fatalf("old code status = %d, want %d, body=%s", oldRes.Code, http.StatusBadRequest, strings.TrimSpace(oldRes.Body.String()))
	}

	latestReq := httptest.NewRequest(http.MethodPost, "/v1/password-resets/confirm", strings.NewReader(`{"email":"`+email+`","code":"`+latestCode+`","new_password":"NewPassword1!"}`))
	latestRes := httptest.NewRecorder()
	handler.ServeHTTP(latestRes, latestReq)
	if latestRes.Code != http.StatusOK {
		t.Fatalf("latest code status = %d, want %d, body=%s", latestRes.Code, http.StatusOK, strings.TrimSpace(latestRes.Body.String()))
	}
	if len(cognito.passwordSet) != 1 || cognito.passwordSet[0] != email {
		t.Fatalf("password set calls = %v, want [%s]", cognito.passwordSet, email)
	}
}

func TestRepositoryCreateInvitationRejectsCompanyUser(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const subject = "company-user-subject"
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreateInvitation(store.CreateInvitationInput{
		CompanyID:       companyID,
		Email:           "new@example.com",
		Role:            domain.RoleCompanyUser,
		InvitedByUserID: user.UserID,
	})
	if !errors.Is(err, store.ErrInvalid) {
		t.Fatalf("CreateInvitation error = %v, want %v", err, store.ErrInvalid)
	}
}

func createInvitationForTest(t *testing.T, handler http.Handler, authHeader, companyID, email string) string {
	t.Helper()
	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/invitations",
		strings.NewReader(`{"company_id":"`+companyID+`","email":"`+email+`","role":"company_user"}`),
	)
	req.Header.Set("Authorization", authHeader)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("create invite status = %d, want %d, body=%s", res.Code, http.StatusCreated, strings.TrimSpace(res.Body.String()))
	}
	var payload struct {
		Invitation struct {
			Token string `json:"token"`
		} `json:"invitation"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Invitation.Token == "" {
		t.Fatal("invite token is empty")
	}
	return payload.Invitation.Token
}
