package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestCommunicationsEmailDraftPersonalScopePreventsIDORAcrossUsersAndAccounts(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	const ownerDraftA = "personal-owner-a"
	const ownerDraftB = "personal-owner-b"

	fixture.expectStatus(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "draft_id": ownerDraftA, "account_email": "owner-a@example.com", "subject": "owner A",
	}, fixture.owner, domain.RoleCompanyUser, http.StatusOK)
	fixture.expectStatus(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "draft_id": ownerDraftB, "account_email": "owner-b@example.com", "subject": "owner B",
	}, fixture.owner, domain.RoleCompanyUser, http.StatusOK)

	ownerAList := fixture.request(t, http.MethodGet, fixture.draftListPath("owner-a@example.com", ""), nil, fixture.owner, domain.RoleCompanyUser)
	assertHTTPDraftIDs(t, ownerAList, ownerDraftA)
	ownerBList := fixture.request(t, http.MethodGet, fixture.draftListPath("owner-b@example.com", ""), nil, fixture.owner, domain.RoleCompanyUser)
	assertHTTPDraftIDs(t, ownerBList, ownerDraftB)
	managerList := fixture.request(t, http.MethodGet, fixture.draftListPath("manager@example.com", ""), nil, fixture.manager, domain.RoleCompanyManager)
	assertHTTPDraftIDs(t, managerList)

	fixture.expectStatus(t, http.MethodGet, fixture.draftByIDPath(ownerDraftA, "manager@example.com", ""), nil, fixture.manager, domain.RoleCompanyManager, http.StatusNotFound)
	fixture.expectStatus(t, http.MethodPut, "/v1/communications/drafts/"+ownerDraftA, map[string]any{
		"company_id": fixture.companyID, "account_email": "manager@example.com", "subject": "manager takeover",
	}, fixture.manager, domain.RoleCompanyManager, http.StatusNotFound)
	fixture.expectStatus(t, http.MethodDelete, fixture.draftByIDPath(ownerDraftA, "manager@example.com", ""), nil, fixture.manager, domain.RoleCompanyManager, http.StatusNotFound)
	fixture.expectStatus(t, http.MethodDelete, fixture.draftByIDPath(ownerDraftA, "owner-b@example.com", ""), nil, fixture.owner, domain.RoleCompanyUser, http.StatusNotFound)

	ownerGet := fixture.request(t, http.MethodGet, fixture.draftByIDPath(ownerDraftA, "owner-a@example.com", ""), nil, fixture.owner, domain.RoleCompanyUser)
	if ownerGet.Code != http.StatusOK {
		t.Fatalf("owner GET status=%d body=%s", ownerGet.Code, ownerGet.Body.String())
	}
	if draft := decodeHTTPDraft(t, ownerGet); draft.Subject != "owner A" || draft.PersonalUserID != fixture.owner.UserID || draft.PersonalAccountEmail != "owner-a@example.com" {
		t.Fatalf("owner draft after IDOR attempts = %+v", draft)
	}

	fixture.expectStatus(t, http.MethodPut, "/v1/communications/drafts/"+ownerDraftA, map[string]any{
		"company_id": fixture.companyID, "account_email": "owner-a@example.com", "subject": "owner updated",
	}, fixture.owner, domain.RoleCompanyUser, http.StatusOK)
	fixture.expectStatus(t, http.MethodDelete, fixture.draftByIDPath(ownerDraftA, "owner-a@example.com", ""), nil, fixture.owner, domain.RoleCompanyUser, http.StatusOK)
	fixture.expectStatus(t, http.MethodGet, fixture.draftByIDPath(ownerDraftA, "owner-a@example.com", ""), nil, fixture.owner, domain.RoleCompanyUser, http.StatusNotFound)
	fixture.expectStatus(t, http.MethodGet, "/v1/communications/drafts?company_id="+url.QueryEscape(fixture.companyID), nil, fixture.owner, domain.RoleCompanyUser, http.StatusBadRequest)
}

func TestCommunicationsEmailDraftSharedInboxScopeRemainsCreatorOwnedAndImmutable(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	const sharedDraftA = "shared-a-draft"
	const sharedDraftB = "shared-b-draft"

	created := fixture.request(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "draft_id": sharedDraftA, "shared_inbox_id": fixture.sharedA.FolderID,
		"account_email": "spoofed@example.com", "subject": "shared A",
	}, fixture.owner, domain.RoleCompanyUser)
	if created.Code != http.StatusOK {
		t.Fatalf("create shared A status=%d body=%s", created.Code, created.Body.String())
	}
	if draft := decodeHTTPDraft(t, created); draft.AccountEmail != "shared-a@example.com" || draft.SharedInboxID != fixture.sharedA.FolderID {
		t.Fatalf("created shared scope = %+v", draft)
	}
	fixture.expectStatus(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "draft_id": sharedDraftB, "shared_inbox_id": fixture.sharedB.FolderID, "subject": "shared B",
	}, fixture.owner, domain.RoleCompanyUser, http.StatusOK)

	assertHTTPDraftIDs(t, fixture.request(t, http.MethodGet, fixture.draftListPath("", fixture.sharedA.FolderID), nil, fixture.owner, domain.RoleCompanyUser), sharedDraftA)
	assertHTTPDraftIDs(t, fixture.request(t, http.MethodGet, fixture.draftListPath("", fixture.sharedB.FolderID), nil, fixture.owner, domain.RoleCompanyUser), sharedDraftB)
	fixture.expectStatus(t, http.MethodGet, fixture.draftListPath("", fixture.sharedA.FolderID), nil, fixture.attacker, domain.RoleCompanyUser, http.StatusNotFound)

	fixture.expectStatus(t, http.MethodGet, fixture.draftByIDPath(sharedDraftA, "", fixture.sharedA.FolderID), nil, fixture.viewer, domain.RoleCompanyUser, http.StatusNotFound)
	fixture.expectStatus(t, http.MethodPut, "/v1/communications/drafts/"+sharedDraftA, map[string]any{
		"company_id": fixture.companyID, "shared_inbox_id": fixture.sharedA.FolderID, "subject": "member updated",
	}, fixture.viewer, domain.RoleCompanyUser, http.StatusNotFound)

	fixture.expectStatus(t, http.MethodGet, fixture.draftByIDPath(sharedDraftA, "", fixture.sharedB.FolderID), nil, fixture.owner, domain.RoleCompanyUser, http.StatusNotFound)
	fixture.expectStatus(t, http.MethodPut, "/v1/communications/drafts/"+sharedDraftA, map[string]any{
		"company_id": fixture.companyID, "shared_inbox_id": fixture.sharedB.FolderID, "subject": "cross-inbox takeover",
	}, fixture.owner, domain.RoleCompanyUser, http.StatusNotFound)
	fixture.expectStatus(t, http.MethodDelete, fixture.draftByIDPath(sharedDraftA, "", fixture.sharedB.FolderID), nil, fixture.owner, domain.RoleCompanyUser, http.StatusNotFound)

	unchanged := fixture.request(t, http.MethodGet, fixture.draftByIDPath(sharedDraftA, "", fixture.sharedA.FolderID), nil, fixture.owner, domain.RoleCompanyUser)
	if unchanged.Code != http.StatusOK || decodeHTTPDraft(t, unchanged).Subject != "shared A" {
		t.Fatalf("shared A after IDOR attempts status=%d body=%s", unchanged.Code, unchanged.Body.String())
	}
	updated := fixture.request(t, http.MethodPut, "/v1/communications/drafts/"+sharedDraftA, map[string]any{
		"company_id": fixture.companyID, "shared_inbox_id": fixture.sharedA.FolderID, "account_email": "another-spoof@example.com", "subject": "editor updated",
	}, fixture.editor, domain.RoleCompanyUser)
	if updated.Code != http.StatusNotFound {
		t.Fatalf("non-owner update status=%d body=%s", updated.Code, updated.Body.String())
	}
	fixture.expectStatus(t, http.MethodDelete, fixture.draftByIDPath(sharedDraftA, "", fixture.sharedA.FolderID), nil, fixture.editor, domain.RoleCompanyUser, http.StatusNotFound)
	fixture.expectStatus(t, http.MethodDelete, fixture.draftByIDPath(sharedDraftA, "", fixture.sharedA.FolderID), nil, fixture.owner, domain.RoleCompanyUser, http.StatusOK)
}

type communicationsEmailDraftScopeHTTPFixture struct {
	repo      *store.MemoryRepo
	handler   http.Handler
	companyID string
	owner     domain.User
	attacker  domain.User
	manager   domain.User
	viewer    domain.User
	editor    domain.User
	sharedA   domain.CompanyExplorerFolder
	sharedB   domain.CompanyExplorerFolder
}

func newCommunicationsEmailDraftScopeHTTPFixture(t *testing.T) communicationsEmailDraftScopeHTTPFixture {
	t.Helper()
	repo := store.NewMemoryRepo()
	const companyID = "67676767-6767-4767-8767-676767676767"
	repo.EnsureCompany(companyID, "Draft Scope HTTP")
	createUser := func(subject, email, role string) domain.User {
		user, err := repo.UpsertAuthUser(subject, email, subject)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.AddCompanyMembership(subject, companyID, role); err != nil {
			t.Fatal(err)
		}
		return user
	}
	owner := createUser("draft-http-owner", "owner@example.com", domain.RoleCompanyUser)
	attacker := createUser("draft-http-attacker", "attacker@example.com", domain.RoleCompanyUser)
	manager := createUser("draft-http-manager", "manager@example.com", domain.RoleCompanyManager)
	viewer := createUser("draft-http-viewer", "viewer@example.com", domain.RoleCompanyUser)
	editor := createUser("draft-http-editor", "editor@example.com", domain.RoleCompanyUser)
	for index, input := range []store.UserEmailConnectionInput{
		{UserID: owner.UserID, Provider: "google", AccountEmail: "owner-a@example.com", GrantID: "owner-a", Status: "connected"},
		{UserID: owner.UserID, Provider: "google", AccountEmail: "owner-b@example.com", GrantID: "owner-b", Status: "connected"},
		{UserID: attacker.UserID, Provider: "google", AccountEmail: "attacker@example.com", GrantID: "attacker", Status: "connected"},
		{UserID: manager.UserID, Provider: "google", AccountEmail: "manager@example.com", GrantID: "manager", Status: "connected"},
	} {
		if _, err := repo.UpsertUserEmailConnection(input); err != nil {
			t.Fatalf("UpsertUserEmailConnection[%d]: %v", index, err)
		}
	}
	for index, email := range []string{"shared-a@example.com", "shared-b@example.com"} {
		if _, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
			CompanyID: companyID, Provider: "google", AccountEmail: email, GrantID: "shared-grant-" + email, Status: "connected", ConnectedByUserID: owner.UserID,
		}); err != nil {
			t.Fatalf("UpsertCompanyEmailConnection[%d]: %v", index, err)
		}
	}
	sharedA, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Shared A", "shared-a@example.com")
	if err != nil {
		t.Fatal(err)
	}
	sharedB, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Shared B", "shared-b@example.com")
	if err != nil {
		t.Fatal(err)
	}
	setPermissions := func(folder domain.CompanyExplorerFolder, permissions []store.EntityPermissionInput) {
		if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID: companyID, EntityType: store.EntityTypeSharedInbox, EntityID: folder.FolderID,
			DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true, Permissions: permissions,
		}); err != nil {
			t.Fatal(err)
		}
	}
	setPermissions(sharedA, []store.EntityPermissionInput{
		{SubjectType: store.EntityPermissionSubjectUser, SubjectID: owner.UserID, AccessLevel: store.EntityPermissionEdit},
		{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionEdit},
		{SubjectType: store.EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: store.EntityPermissionEdit},
	})
	setPermissions(sharedB, []store.EntityPermissionInput{
		{SubjectType: store.EntityPermissionSubjectUser, SubjectID: owner.UserID, AccessLevel: store.EntityPermissionEdit},
	})
	return communicationsEmailDraftScopeHTTPFixture{
		repo: repo, handler: NewServer(repo).Routes(), companyID: companyID,
		owner: owner, attacker: attacker, manager: manager, viewer: viewer, editor: editor, sharedA: sharedA, sharedB: sharedB,
	}
}

func (fixture communicationsEmailDraftScopeHTTPFixture) request(t *testing.T, method, path string, body any, user domain.User, role string) *httptest.ResponseRecorder {
	t.Helper()
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), actorContextKey{}, ActorContext{
		User:        user,
		Memberships: []domain.CompanyMembership{{CompanyID: fixture.companyID, UserID: user.UserID, Role: role}},
		CompanyID:   fixture.companyID, CompanyRole: role,
	}))
	recorder := httptest.NewRecorder()
	fixture.handler.ServeHTTP(recorder, req)
	return recorder
}

func (fixture communicationsEmailDraftScopeHTTPFixture) expectStatus(t *testing.T, method, path string, body any, user domain.User, role string, want int) {
	t.Helper()
	recorder := fixture.request(t, method, path, body, user, role)
	if recorder.Code != want {
		t.Fatalf("%s %s status=%d body=%s, want %d", method, path, recorder.Code, recorder.Body.String(), want)
	}
}

func (fixture communicationsEmailDraftScopeHTTPFixture) draftListPath(accountEmail, sharedInboxID string) string {
	values := url.Values{"company_id": {fixture.companyID}}
	if accountEmail != "" {
		values.Set("account_email", accountEmail)
	}
	if sharedInboxID != "" {
		values.Set("shared_inbox_id", sharedInboxID)
	}
	return "/v1/communications/drafts?" + values.Encode()
}

func (fixture communicationsEmailDraftScopeHTTPFixture) draftByIDPath(draftID, accountEmail, sharedInboxID string) string {
	return "/v1/communications/drafts/" + url.PathEscape(draftID) + "?" + fixture.draftListPath(accountEmail, sharedInboxID)[len("/v1/communications/drafts?"):]
}

func assertHTTPDraftIDs(t *testing.T, recorder *httptest.ResponseRecorder, want ...string) {
	t.Helper()
	if recorder.Code != http.StatusOK {
		t.Fatalf("draft list status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var envelope struct {
		Drafts []communicationsEmailDraftResponse `json:"drafts"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Drafts) != len(want) {
		t.Fatalf("draft count=%d drafts=%+v want=%v", len(envelope.Drafts), envelope.Drafts, want)
	}
	for index := range want {
		if envelope.Drafts[index].DraftID != want[index] {
			t.Fatalf("draft[%d].DraftID=%q, want %q", index, envelope.Drafts[index].DraftID, want[index])
		}
	}
}

func decodeHTTPDraft(t *testing.T, recorder *httptest.ResponseRecorder) communicationsEmailDraftResponse {
	t.Helper()
	var envelope struct {
		Draft communicationsEmailDraftResponse `json:"draft"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Draft
}
