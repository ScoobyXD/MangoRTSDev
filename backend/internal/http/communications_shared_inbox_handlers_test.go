package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestCommunicationsSharedInboxRoutesManageFoldersAndAccess(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-shared-inbox-route-test"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	user, err := repo.UpsertAuthUser("subject-shared-route", "shared@example.com", "Shared User")
	if err != nil {
		t.Fatalf("UpsertAuthUser error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership error = %v", err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: "shared@example.com",
		GrantID:      "grant-shared-route",
		Status:       "connected",
	}); err != nil {
		t.Fatalf("UpsertUserEmailConnection error = %v", err)
	}

	createBody, _ := json.Marshal(map[string]string{
		"company_id":    companyID,
		"name":          "Business",
		"account_email": "SHARED@example.com",
	})
	createReq := httptest.NewRequest(http.MethodPost, "/v1/communications/shared-inboxes", bytes.NewReader(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("POST shared inbox status = %d, want %d body=%s", createRec.Code, http.StatusCreated, createRec.Body.String())
	}
	var created struct {
		FolderID     string `json:"folder_id"`
		FolderKind   string `json:"folder_kind"`
		AccountEmail string `json:"account_email"`
	}
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode created shared inbox: %v", err)
	}
	if created.FolderID == "" || created.FolderKind != "communications" || created.AccountEmail != "shared@example.com" {
		t.Fatalf("created shared inbox = %+v", created)
	}

	accessBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"assignments": []map[string]string{
			{"user_id": user.UserID},
		},
	})
	accessReq := httptest.NewRequest(http.MethodPut, "/v1/communications/shared-inboxes/"+created.FolderID+"/access", bytes.NewReader(accessBody))
	accessReq.Header.Set("Content-Type", "application/json")
	accessRec := httptest.NewRecorder()
	handler.ServeHTTP(accessRec, accessReq)
	if accessRec.Code != http.StatusOK {
		t.Fatalf("PUT shared inbox access status = %d, want %d body=%s", accessRec.Code, http.StatusOK, accessRec.Body.String())
	}
	var accessPayload struct {
		AccessGrants []struct {
			EntityID    string `json:"entity_id"`
			SubjectID   string `json:"subject_id"`
			AccessLevel string `json:"access_level"`
		} `json:"access_grants"`
	}
	if err := json.NewDecoder(accessRec.Body).Decode(&accessPayload); err != nil {
		t.Fatalf("decode access payload: %v", err)
	}
	if len(accessPayload.AccessGrants) != 1 || accessPayload.AccessGrants[0].EntityID != created.FolderID || accessPayload.AccessGrants[0].AccessLevel != store.EntityPermissionEdit || accessPayload.AccessGrants[0].SubjectID != user.UserID {
		t.Fatalf("access grants = %+v", accessPayload.AccessGrants)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/communications/shared-inboxes?company_id="+companyID, nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET shared inboxes status = %d, want %d body=%s", listRec.Code, http.StatusOK, listRec.Body.String())
	}
	var listPayload struct {
		SharedInboxes []struct {
			FolderID     string `json:"folder_id"`
			AccountEmail string `json:"account_email"`
		} `json:"shared_inboxes"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode list payload: %v", err)
	}
	if len(listPayload.SharedInboxes) != 1 || listPayload.SharedInboxes[0].FolderID != created.FolderID || listPayload.SharedInboxes[0].AccountEmail != "shared@example.com" {
		t.Fatalf("shared inbox list = %+v", listPayload.SharedInboxes)
	}
}

func TestCommunicationsSharedInboxListFiltersToGrantedFoldersAndAncestors(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-shared-inbox-filter-test"

	currentUser, err := repo.UpsertAuthUser("subject-shared-current", "current@example.com", "Current User")
	if err != nil {
		t.Fatalf("UpsertAuthUser current error = %v", err)
	}
	otherUser, err := repo.UpsertAuthUser("subject-shared-other", "other@example.com", "Other User")
	if err != nil {
		t.Fatalf("UpsertAuthUser other error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(currentUser.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership current error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(otherUser.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership other error = %v", err)
	}

	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Business")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder parent error = %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "communications", "Client Facing")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder child error = %v", err)
	}
	unrelated, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Supply Chain")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder unrelated error = %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedTriageFolder,
		EntityID:   child.FolderID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: currentUser.UserID, AccessLevel: store.EntityPermissionEdit},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions child error = %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedTriageFolder,
		EntityID:   unrelated.FolderID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: otherUser.UserID, AccessLevel: store.EntityPermissionEdit},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions unrelated error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/shared-inboxes?company_id="+companyID, nil)
	req = req.WithContext(context.WithValue(req.Context(), actorContextKey{}, ActorContext{
		User: currentUser,
		Memberships: []domain.CompanyMembership{
			{CompanyID: companyID, UserID: currentUser.UserID, Role: domain.RoleCompanyUser},
		},
	}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET shared inboxes status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload struct {
		SharedInboxes []struct {
			FolderID string `json:"folder_id"`
			Name     string `json:"name"`
		} `json:"shared_inboxes"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode shared inboxes: %v", err)
	}
	seen := map[string]bool{}
	for _, folder := range payload.SharedInboxes {
		seen[folder.FolderID] = true
	}
	if !seen[parent.FolderID] || !seen[child.FolderID] || seen[unrelated.FolderID] {
		t.Fatalf("shared inbox folders = %+v, want granted child and ancestor only", payload.SharedInboxes)
	}
}

type sharedInboxListErrorRepo struct {
	store.Repository
	err error
}

func (r sharedInboxListErrorRepo) ListCompanyExplorerFolders(companyID, folderKind string) ([]domain.CompanyExplorerFolder, error) {
	return nil, r.err
}

func TestCommunicationsSharedInboxListReportsStorageUnavailable(t *testing.T) {
	t.Parallel()

	repo := sharedInboxListErrorRepo{Repository: store.NewMemoryRepo(), err: store.ErrSharedInboxStorageUnavailable}
	handler := NewServer(repo).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/shared-inboxes?company_id=11111111-1111-1111-1111-111111111111", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET shared inboxes status = %d, want %d body=%s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode error payload: %v", err)
	}
	if payload.Error != "shared_inbox_storage_unavailable" {
		t.Fatalf("error = %q, want shared_inbox_storage_unavailable", payload.Error)
	}
}

func TestCommunicationsSharedInboxAccessReportsStorageUnavailable(t *testing.T) {
	t.Parallel()

	repo := sharedInboxListErrorRepo{Repository: store.NewMemoryRepo(), err: store.ErrSharedInboxStorageUnavailable}
	handler := NewServer(repo).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/shared-inboxes/folder-1/access?company_id=11111111-1111-1111-1111-111111111111", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET shared inbox access status = %d, want %d body=%s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode error payload: %v", err)
	}
	if payload.Error != "shared_inbox_storage_unavailable" {
		t.Fatalf("error = %q, want shared_inbox_storage_unavailable", payload.Error)
	}
}
