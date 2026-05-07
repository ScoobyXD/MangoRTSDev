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

func TestCreateInvitationSkipsCognitoForExistingMangoUser(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const adminSubject = "admin-subject"
	const existingSubject = "existing-subject"
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	if _, err := repo.UpsertAuthUser(adminSubject, "admin@example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(adminSubject, companyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertAuthUser(existingSubject, "existing@example.com"); err != nil {
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

	if res.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body=%s", res.Code, http.StatusCreated, strings.TrimSpace(res.Body.String()))
	}
	if len(cognito.emails) != 0 {
		t.Fatalf("cognito invite calls = %v, want none", cognito.emails)
	}
	var payload struct {
		CognitoInviteStatus string `json:"cognito_invite_status"`
		Invitation          struct {
			Token string `json:"token"`
		} `json:"invitation"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.CognitoInviteStatus != "existing_mango_user" {
		t.Fatalf("cognito status = %q, want existing_mango_user", payload.CognitoInviteStatus)
	}
	if payload.Invitation.Token == "" {
		t.Fatal("invite token is empty")
	}
}

func TestCreateInvitationSendsCognitoForNewMangoUser(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const adminSubject = "admin-subject"
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	if _, err := repo.UpsertAuthUser(adminSubject, "admin@example.com"); err != nil {
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
