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
)

type recordingCognitoAdmin struct {
	emails  []string
	deleted []string
}

func (c *recordingCognitoAdmin) AdminCreateUser(_ context.Context, email string) error {
	c.emails = append(c.emails, email)
	return nil
}

func (c *recordingCognitoAdmin) AdminDeleteUser(_ context.Context, username string) error {
	c.deleted = append(c.deleted, username)
	return nil
}

type recordingEmailSender struct {
	signupEmails    []string
	signupCompanies []string
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
	if _, err := repo.AddCompanyMembership(existingSubject, companyID, domain.RoleCompanyUser); err != nil {
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

func TestCreateInvitationForExistingMangoUserSkipsCognitoCreate(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const adminSubject = "admin-subject"
	const existingSubject = "existing-subject"
	const existingEmail = "existing@example.com"
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	if _, err := repo.UpsertAuthUser(adminSubject, "admin@example.com", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(adminSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	existingUser, err := repo.UpsertAuthUser(existingSubject, existingEmail, "Existing User")
	if err != nil {
		t.Fatal(err)
	}
	cognito := &recordingCognitoAdmin{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		CognitoAdmin:  cognito,
	}).Routes()

	inviteReq := httptest.NewRequest(
		http.MethodPost,
		"/v1/invitations",
		strings.NewReader(`{"company_id":"`+companyID+`","email":"`+existingEmail+`","role":"company_user"}`),
	)
	inviteReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", adminSubject, "admin@example.com"))
	inviteRes := httptest.NewRecorder()
	handler.ServeHTTP(inviteRes, inviteReq)
	if inviteRes.Code != http.StatusCreated {
		t.Fatalf("invite status = %d, want %d, body=%s", inviteRes.Code, http.StatusCreated, strings.TrimSpace(inviteRes.Body.String()))
	}
	if len(cognito.emails) != 0 {
		t.Fatalf("cognito invite calls = %v, want none for existing Mango user", cognito.emails)
	}
	var invitePayload struct {
		CognitoInviteStatus string `json:"cognito_invite_status"`
		Invitation          struct {
			Token string `json:"token"`
		} `json:"invitation"`
	}
	if err := json.NewDecoder(inviteRes.Body).Decode(&invitePayload); err != nil {
		t.Fatal(err)
	}
	if invitePayload.CognitoInviteStatus != "existing_mango_user" {
		t.Fatalf("cognito status = %q, want existing_mango_user", invitePayload.CognitoInviteStatus)
	}

	acceptReq := httptest.NewRequest(http.MethodPost, "/v1/invitations/accept", strings.NewReader(`{"token":"`+invitePayload.Invitation.Token+`","display_name":"Existing User"}`))
	acceptReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", existingSubject, existingEmail))
	acceptRes := httptest.NewRecorder()
	handler.ServeHTTP(acceptRes, acceptReq)
	if acceptRes.Code != http.StatusOK {
		t.Fatalf("accept status = %d, want %d, body=%s", acceptRes.Code, http.StatusOK, strings.TrimSpace(acceptRes.Body.String()))
	}
	if _, err := repo.GetCompanyUser(companyID, existingUser.UserID); err != nil {
		t.Fatalf("existing user membership was not created: %v", err)
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

func TestListCompaniesRequiresDevAdminAndSearchesNameOrID(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const devCompanyID = "11111111-1111-1111-1111-111111111111"
	const alphaCompanyID = "22222222-2222-2222-2222-222222222222"
	const betaCompanyID = "33333333-3333-3333-3333-333333333333"
	const devSubject = "dev-admin-subject"
	const companyAdminSubject = "company-admin-subject"
	repo.EnsureCompany(devCompanyID, "MangoRTS Dev")
	repo.EnsureCompany(alphaCompanyID, "Alpha Systems")
	repo.EnsureCompany(betaCompanyID, "Beta Manufacturing")
	if _, err := repo.UpsertAuthUser(devSubject, "dev@example.com", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(devSubject, devCompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertAuthUser(companyAdminSubject, "admin@example.com", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(companyAdminSubject, alphaCompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/companies?query=beta&limit=10", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", devSubject, "dev@example.com"))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("dev admin list status = %d, want %d, body=%s", res.Code, http.StatusOK, strings.TrimSpace(res.Body.String()))
	}
	var payload struct {
		Companies []domain.Company `json:"companies"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Companies) != 1 || payload.Companies[0].CompanyID != betaCompanyID {
		t.Fatalf("companies = %+v, want only beta company", payload.Companies)
	}

	idReq := httptest.NewRequest(http.MethodGet, "/v1/companies?query=2222&limit=10", nil)
	idReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", devSubject, "dev@example.com"))
	idRes := httptest.NewRecorder()
	handler.ServeHTTP(idRes, idReq)
	if idRes.Code != http.StatusOK {
		t.Fatalf("dev admin id search status = %d, want %d, body=%s", idRes.Code, http.StatusOK, strings.TrimSpace(idRes.Body.String()))
	}
	payload.Companies = nil
	if err := json.NewDecoder(idRes.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Companies) != 1 || payload.Companies[0].CompanyID != alphaCompanyID {
		t.Fatalf("companies = %+v, want only alpha company", payload.Companies)
	}

	forbiddenReq := httptest.NewRequest(http.MethodGet, "/v1/companies?limit=10", nil)
	forbiddenReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", companyAdminSubject, "admin@example.com"))
	forbiddenRes := httptest.NewRecorder()
	handler.ServeHTTP(forbiddenRes, forbiddenReq)
	if forbiddenRes.Code != http.StatusForbidden {
		t.Fatalf("company admin list status = %d, want %d, body=%s", forbiddenRes.Code, http.StatusForbidden, strings.TrimSpace(forbiddenRes.Body.String()))
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
	if firstAcceptRes.Code != http.StatusConflict {
		t.Fatalf("first accept status = %d, want %d, body=%s", firstAcceptRes.Code, http.StatusConflict, strings.TrimSpace(firstAcceptRes.Body.String()))
	}
	var firstAcceptPayload struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(firstAcceptRes.Body).Decode(&firstAcceptPayload); err != nil {
		t.Fatal(err)
	}
	if firstAcceptPayload.Error != "invitation_replaced" {
		t.Fatalf("first accept error = %q, want invitation_replaced", firstAcceptPayload.Error)
	}
	if _, err := repo.GetAuthUser(inviteeSubject); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("invitee user after rejected old token error = %v, want ErrNotFound", err)
	}

	secondAcceptReq := httptest.NewRequest(http.MethodPost, "/v1/invitations/accept", strings.NewReader(`{"token":"`+secondToken+`","display_name":"Invitee User"}`))
	secondAcceptReq.Header.Set("Authorization", inviteeToken)
	secondAcceptRes := httptest.NewRecorder()
	handler.ServeHTTP(secondAcceptRes, secondAcceptReq)
	if secondAcceptRes.Code != http.StatusOK {
		t.Fatalf("second accept status = %d, want %d, body=%s", secondAcceptRes.Code, http.StatusOK, strings.TrimSpace(secondAcceptRes.Body.String()))
	}
}

func TestInvitationValidateRejectsBadTokenWithoutAuth(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()

	req := httptest.NewRequest(http.MethodPost, "/v1/invitations/validate", strings.NewReader(`{"token":"not-a-real-token"}`))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("validate status = %d, want %d, body=%s", res.Code, http.StatusNotFound, strings.TrimSpace(res.Body.String()))
	}
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error != "invitation_bad_token" {
		t.Fatalf("validate error = %q, want invitation_bad_token", payload.Error)
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

func TestCompanyExplorerFolderShareExistingMember(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const adminSubject = "admin-subject"
	const memberSubject = "member-subject"
	const memberEmail = "member@example.com"
	repo.EnsureCompany(companyID, "Acme Systems")
	if _, err := repo.UpsertAuthUser(adminSubject, "admin@example.com", "Admin User"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(adminSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	member, err := repo.UpsertAuthUser(memberSubject, memberEmail, "Member User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(memberSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Shared Work")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	adminToken := "Bearer " + testJWT(t, key, "kid", adminSubject, "admin@example.com")

	shareReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders/"+folder.FolderID+"/shares", strings.NewReader(`{"company_id":"`+companyID+`","email":"`+memberEmail+`"}`))
	shareReq.Header.Set("Authorization", adminToken)
	shareReq.Header.Set("Content-Type", "application/json")
	shareRes := httptest.NewRecorder()
	handler.ServeHTTP(shareRes, shareReq)
	if shareRes.Code != http.StatusCreated {
		t.Fatalf("share status = %d, want %d, body=%s", shareRes.Code, http.StatusCreated, strings.TrimSpace(shareRes.Body.String()))
	}
	var sharePayload struct {
		Share               domain.CompanyExplorerFolderShare `json:"share"`
		Invitation          *domain.Invitation                `json:"invitation"`
		CognitoInviteStatus string                            `json:"cognito_invite_status"`
	}
	if err := json.NewDecoder(shareRes.Body).Decode(&sharePayload); err != nil {
		t.Fatal(err)
	}
	if sharePayload.Invitation != nil {
		t.Fatalf("invitation = %+v, want nil for existing company member", sharePayload.Invitation)
	}
	if sharePayload.CognitoInviteStatus != "not_needed" {
		t.Fatalf("cognito status = %q, want not_needed", sharePayload.CognitoInviteStatus)
	}
	if sharePayload.Share.Status != "active" || sharePayload.Share.UserID == nil || *sharePayload.Share.UserID != member.UserID {
		t.Fatalf("share = %+v, want active member share", sharePayload.Share)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/folders/"+folder.FolderID+"/shares?company_id="+companyID, nil)
	listReq.Header.Set("Authorization", adminToken)
	listRes := httptest.NewRecorder()
	handler.ServeHTTP(listRes, listReq)
	if listRes.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d, body=%s", listRes.Code, http.StatusOK, strings.TrimSpace(listRes.Body.String()))
	}
	var listPayload struct {
		Shares []domain.CompanyExplorerFolderShare `json:"shares"`
	}
	if err := json.NewDecoder(listRes.Body).Decode(&listPayload); err != nil {
		t.Fatal(err)
	}
	if len(listPayload.Shares) != 1 || listPayload.Shares[0].Email != memberEmail {
		t.Fatalf("shares = %+v, want member share", listPayload.Shares)
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/company-explorer/folders/"+folder.FolderID+"/shares?company_id="+companyID+"&email="+memberEmail, nil)
	deleteReq.Header.Set("Authorization", adminToken)
	deleteRes := httptest.NewRecorder()
	handler.ServeHTTP(deleteRes, deleteReq)
	if deleteRes.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want %d, body=%s", deleteRes.Code, http.StatusOK, strings.TrimSpace(deleteRes.Body.String()))
	}
	shares, err := repo.ListCompanyExplorerFolderShares(companyID, folder.FolderID)
	if err != nil {
		t.Fatal(err)
	}
	if len(shares) != 0 {
		t.Fatalf("shares after delete = %+v, want none", shares)
	}
}

func TestCompanyExplorerFolderSharePendingActivatesOnInviteAccept(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const adminSubject = "admin-subject"
	const inviteeSubject = "folder-share-invitee"
	const inviteeEmail = "folder-share@example.com"
	repo.EnsureCompany(companyID, "Acme Systems")
	if _, err := repo.UpsertAuthUser(adminSubject, "admin@example.com", "Admin User"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(adminSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Shared Work")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	adminToken := "Bearer " + testJWT(t, key, "kid", adminSubject, "admin@example.com")

	shareReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders/"+folder.FolderID+"/shares", strings.NewReader(`{"company_id":"`+companyID+`","email":"`+inviteeEmail+`"}`))
	shareReq.Header.Set("Authorization", adminToken)
	shareReq.Header.Set("Content-Type", "application/json")
	shareRes := httptest.NewRecorder()
	handler.ServeHTTP(shareRes, shareReq)
	if shareRes.Code != http.StatusCreated {
		t.Fatalf("share status = %d, want %d, body=%s", shareRes.Code, http.StatusCreated, strings.TrimSpace(shareRes.Body.String()))
	}
	var sharePayload struct {
		Share               domain.CompanyExplorerFolderShare `json:"share"`
		Invitation          *domain.Invitation                `json:"invitation"`
		CognitoInviteStatus string                            `json:"cognito_invite_status"`
	}
	if err := json.NewDecoder(shareRes.Body).Decode(&sharePayload); err != nil {
		t.Fatal(err)
	}
	if sharePayload.Share.Status != "pending" || sharePayload.Share.UserID != nil {
		t.Fatalf("share = %+v, want pending external invite", sharePayload.Share)
	}
	if sharePayload.Invitation == nil || sharePayload.Invitation.Token == "" {
		t.Fatalf("invitation = %+v, want token", sharePayload.Invitation)
	}
	if sharePayload.CognitoInviteStatus != "not_configured" {
		t.Fatalf("cognito status = %q, want not_configured", sharePayload.CognitoInviteStatus)
	}

	acceptReq := httptest.NewRequest(http.MethodPost, "/v1/invitations/accept", strings.NewReader(`{"token":"`+sharePayload.Invitation.Token+`","display_name":"Folder Share User"}`))
	acceptReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", inviteeSubject, inviteeEmail))
	acceptReq.Header.Set("Content-Type", "application/json")
	acceptRes := httptest.NewRecorder()
	handler.ServeHTTP(acceptRes, acceptReq)
	if acceptRes.Code != http.StatusOK {
		t.Fatalf("accept status = %d, want %d, body=%s", acceptRes.Code, http.StatusOK, strings.TrimSpace(acceptRes.Body.String()))
	}
	user, err := repo.GetAuthUser(inviteeSubject)
	if err != nil {
		t.Fatal(err)
	}
	shares, err := repo.ListCompanyExplorerFolderShares(companyID, folder.FolderID)
	if err != nil {
		t.Fatal(err)
	}
	if len(shares) != 1 || shares[0].Status != "active" || shares[0].UserID == nil || *shares[0].UserID != user.UserID {
		t.Fatalf("shares after accept = %+v, want active share for accepted user %s", shares, user.UserID)
	}
}

func TestPasswordResetRequestChecksMangoUser(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const email = "reset@example.com"
	if _, err := repo.UpsertAuthUser("reset-subject", email, "Reset User"); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()

	req := httptest.NewRequest(http.MethodPost, "/v1/password-resets/request", strings.NewReader(`{"email":"`+email+`"}`))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("known user status = %d, want %d, body=%s", res.Code, http.StatusOK, strings.TrimSpace(res.Body.String()))
	}
	var okPayload struct {
		Status           string `json:"status"`
		ExpiresInSeconds int    `json:"expires_in_seconds"`
	}
	if err := json.NewDecoder(res.Body).Decode(&okPayload); err != nil {
		t.Fatal(err)
	}
	if okPayload.Status != "reset_user_found" || okPayload.ExpiresInSeconds != 3600 {
		t.Fatalf("password reset payload = %+v, want Cognito one-hour eligibility", okPayload)
	}

	missingReq := httptest.NewRequest(http.MethodPost, "/v1/password-resets/request", strings.NewReader(`{"email":"missing@example.com"}`))
	missingRes := httptest.NewRecorder()
	handler.ServeHTTP(missingRes, missingReq)
	if missingRes.Code != http.StatusNotFound {
		t.Fatalf("missing user status = %d, want %d, body=%s", missingRes.Code, http.StatusNotFound, strings.TrimSpace(missingRes.Body.String()))
	}
	var missingPayload struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(missingRes.Body).Decode(&missingPayload); err != nil {
		t.Fatal(err)
	}
	if missingPayload.Error != "password_reset_user_not_found" {
		t.Fatalf("missing user error = %q, want password_reset_user_not_found", missingPayload.Error)
	}
}

func TestDeleteCompanyUserDeletesCognitoAndAllowsReinvite(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const adminSubject = "admin-subject"
	const targetSubject = "target-subject"
	const targetEmail = "target@example.com"
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	admin, err := repo.UpsertAuthUser(adminSubject, "admin@example.com", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(adminSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	invitation, err := repo.CreateInvitation(store.CreateInvitationInput{
		CompanyID:       companyID,
		Email:           targetEmail,
		Role:            domain.RoleCompanyUser,
		InvitedByUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AcceptInvitation(invitation.Token, targetSubject, targetEmail, "Target User"); err != nil {
		t.Fatal(err)
	}
	target, err := repo.GetAuthUser(targetSubject)
	if err != nil {
		t.Fatal(err)
	}
	cognito := &recordingCognitoAdmin{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		CognitoAdmin:  cognito,
	}).Routes()

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/companies/"+companyID+"/users/"+target.UserID, nil)
	deleteReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", adminSubject, "admin@example.com"))
	deleteRes := httptest.NewRecorder()
	handler.ServeHTTP(deleteRes, deleteReq)
	if deleteRes.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want %d, body=%s", deleteRes.Code, http.StatusOK, strings.TrimSpace(deleteRes.Body.String()))
	}
	if len(cognito.deleted) != 1 || cognito.deleted[0] != targetSubject {
		t.Fatalf("cognito deletes = %v, want [%s]", cognito.deleted, targetSubject)
	}
	if _, err := repo.GetAuthUser(targetSubject); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("target user after delete error = %v, want ErrNotFound", err)
	}

	inviteReq := httptest.NewRequest(
		http.MethodPost,
		"/v1/invitations",
		strings.NewReader(`{"company_id":"`+companyID+`","email":"`+targetEmail+`","role":"company_user"}`),
	)
	inviteReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", adminSubject, "admin@example.com"))
	inviteRes := httptest.NewRecorder()
	handler.ServeHTTP(inviteRes, inviteReq)
	if inviteRes.Code != http.StatusCreated {
		t.Fatalf("reinvite status = %d, want %d, body=%s", inviteRes.Code, http.StatusCreated, strings.TrimSpace(inviteRes.Body.String()))
	}
	if len(cognito.emails) != 1 || cognito.emails[0] != targetEmail {
		t.Fatalf("cognito invites = %v, want [%s]", cognito.emails, targetEmail)
	}
}

func TestDeleteCompanyUserWithRemainingMembershipKeepsIdentity(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const otherCompanyID = "22222222-2222-2222-2222-222222222222"
	const adminSubject = "admin-subject"
	const targetSubject = "target-subject"
	const targetEmail = "target@example.com"
	repo.EnsureCompany(companyID, "MangoRTS Dev")
	repo.EnsureCompany(otherCompanyID, "Second Company")
	if _, err := repo.UpsertAuthUser(adminSubject, "admin@example.com", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(adminSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	target, err := repo.UpsertAuthUser(targetSubject, targetEmail, "Target User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(targetSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(targetSubject, otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/companies/"+companyID+"/users/"+target.UserID, nil)
	deleteReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", adminSubject, "admin@example.com"))
	deleteRes := httptest.NewRecorder()
	handler.ServeHTTP(deleteRes, deleteReq)
	if deleteRes.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want %d, body=%s", deleteRes.Code, http.StatusOK, strings.TrimSpace(deleteRes.Body.String()))
	}
	var payload struct {
		CognitoUserDeleted bool `json:"cognito_user_deleted"`
	}
	if err := json.NewDecoder(deleteRes.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.CognitoUserDeleted {
		t.Fatal("cognito_user_deleted = true, want false for user with remaining company membership")
	}
	if _, err := repo.GetCompanyUser(companyID, target.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("removed company membership error = %v, want ErrNotFound", err)
	}
	if _, err := repo.GetCompanyUser(otherCompanyID, target.UserID); err != nil {
		t.Fatalf("other company membership was not preserved: %v", err)
	}
	if _, err := repo.GetAuthUser(targetSubject); err != nil {
		t.Fatalf("target identity was not preserved: %v", err)
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
