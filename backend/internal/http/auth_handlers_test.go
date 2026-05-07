package httpapi

import (
	"context"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type recordingCognitoAdmin struct {
	emails []string
}

func (c *recordingCognitoAdmin) AdminCreateUser(_ context.Context, email string) error {
	c.emails = append(c.emails, email)
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
	firstAcceptReq := httptest.NewRequest(http.MethodPost, "/v1/invitations/accept", strings.NewReader(`{"token":"`+firstToken+`"}`))
	firstAcceptReq.Header.Set("Authorization", inviteeToken)
	firstAcceptRes := httptest.NewRecorder()
	handler.ServeHTTP(firstAcceptRes, firstAcceptReq)
	if firstAcceptRes.Code != http.StatusNotFound {
		t.Fatalf("first accept status = %d, want %d, body=%s", firstAcceptRes.Code, http.StatusNotFound, strings.TrimSpace(firstAcceptRes.Body.String()))
	}

	secondAcceptReq := httptest.NewRequest(http.MethodPost, "/v1/invitations/accept", strings.NewReader(`{"token":"`+secondToken+`"}`))
	secondAcceptReq.Header.Set("Authorization", inviteeToken)
	secondAcceptRes := httptest.NewRecorder()
	handler.ServeHTTP(secondAcceptRes, secondAcceptReq)
	if secondAcceptRes.Code != http.StatusOK {
		t.Fatalf("second accept status = %d, want %d, body=%s", secondAcceptRes.Code, http.StatusOK, strings.TrimSpace(secondAcceptRes.Body.String()))
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
