package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func sharedInboxRequestWithActor(req *http.Request, user domain.User, companyID, role string) *http.Request {
	return req.WithContext(context.WithValue(req.Context(), actorContextKey{}, ActorContext{
		User: user,
		Memberships: []domain.CompanyMembership{{
			CompanyID: companyID,
			UserID:    user.UserID,
			Role:      role,
		}},
		CompanyID:   companyID,
		CompanyRole: role,
	}))
}

func TestCommunicationsSharedInboxRoutesManageFoldersAndAccess(t *testing.T) {
	t.Parallel()

	backing := store.NewMemoryRepo()
	repo := backing
	server := NewServer(repo)
	companyID := "company-shared-inbox-route-test"
	repo.EnsureCompany(companyID, "Shared Inbox Route Company")
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
		Scope:        "shared",
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
		"company_id":      companyID,
		"permission_mode": store.PolicyModeCustomized,
		"default_access":  store.ResourceDefaultAccessNoAccess,
		"permissions": []map[string]string{
			{"subject_type": store.EntityPermissionSubjectUser, "subject_id": user.UserID, "access_level": store.EntityPermissionEdit},
		},
	})
	accessReq := httptest.NewRequest(http.MethodPut, "/v1/resources/shared_inbox/"+created.FolderID+"/permissions", bytes.NewReader(accessBody))
	accessReq.Header.Set("Content-Type", "application/json")
	accessRec := httptest.NewRecorder()
	handler.ServeHTTP(accessRec, accessReq)
	if accessRec.Code != http.StatusOK {
		t.Fatalf("PUT shared inbox access status = %d, want %d body=%s", accessRec.Code, http.StatusOK, accessRec.Body.String())
	}
	var accessPayload struct {
		Permissions []struct {
			EntityID    string `json:"entity_id"`
			SubjectID   string `json:"subject_id"`
			AccessLevel string `json:"access_level"`
		} `json:"permissions"`
	}
	if err := json.NewDecoder(accessRec.Body).Decode(&accessPayload); err != nil {
		t.Fatalf("decode access payload: %v", err)
	}
	if len(accessPayload.Permissions) != 1 || accessPayload.Permissions[0].EntityID != created.FolderID || accessPayload.Permissions[0].AccessLevel != store.EntityPermissionEdit || accessPayload.Permissions[0].SubjectID != user.UserID {
		t.Fatalf("permissions = %+v", accessPayload.Permissions)
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

func TestCommunicationsSharedInboxDeleteRemovesConnectionAndRemoveKeepsConnection(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-shared-inbox-delete-connection"
	repo.EnsureCompany(companyID, "Shared Inbox Delete Connection")
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	user, err := repo.UpsertAuthUser("subject-shared-delete-connection", "shared-delete@example.com", "Shared Delete")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: "shared-delete@example.com",
		Scope:        "shared",
		GrantID:      "grant-shared-delete",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}

	removed, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Remove Only", "shared-delete@example.com")
	if err != nil {
		t.Fatal(err)
	}
	removeReq := httptest.NewRequest(http.MethodDelete, "/v1/communications/shared-inboxes/"+removed.FolderID+"?company_id="+companyID+"&remove_only=true", nil)
	removeRec := httptest.NewRecorder()
	handler.ServeHTTP(removeRec, removeReq)
	if removeRec.Code != http.StatusOK {
		t.Fatalf("remove-only status = %d, want 200 body=%s", removeRec.Code, removeRec.Body.String())
	}
	if _, err := repo.GetCommunicationsSharedInboxFolder(companyID, removed.FolderID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("removed shared inbox error = %v, want ErrNotFound", err)
	}
	if _, err := repo.GetCompanyEmailConnectionByAccountEmail(companyID, "shared-delete@example.com"); err != nil {
		t.Fatalf("company connection after remove-only = %v, want kept", err)
	}

	deleted, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Delete Everywhere", "shared-delete@example.com")
	if err != nil {
		t.Fatal(err)
	}
	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/communications/shared-inboxes/"+deleted.FolderID+"?company_id="+companyID, nil)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want 200 body=%s", deleteRec.Code, deleteRec.Body.String())
	}
	if _, err := repo.GetCommunicationsSharedInboxFolder(companyID, deleted.FolderID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleted shared inbox error = %v, want ErrNotFound", err)
	}
	if _, err := repo.GetCompanyEmailConnectionByAccountEmail(companyID, "shared-delete@example.com"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("company connection after delete = %v, want ErrNotFound", err)
	}
}

func TestCommunicationsSharedInboxCreateRequiresManagerOrAdmin(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-shared-inbox-create-manager-required"
	repo.EnsureCompany(companyID, "Shared Inbox Create Manager Required")

	member, err := repo.UpsertAuthUser("subject-shared-create-member", "shared-create-member@example.com", "Shared Create Member")
	if err != nil {
		t.Fatalf("UpsertAuthUser member error = %v", err)
	}
	manager, err := repo.UpsertAuthUser("subject-shared-create-manager", "shared-create-manager@example.com", "Shared Create Manager")
	if err != nil {
		t.Fatalf("UpsertAuthUser manager error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(member.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership member error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(manager.CognitoSubject, companyID, domain.RoleCompanyManager); err != nil {
		t.Fatalf("AddCompanyMembership manager error = %v", err)
	}

	memberBody, _ := json.Marshal(map[string]string{"company_id": companyID, "name": "Member Folder"})
	memberReq := httptest.NewRequest(http.MethodPost, "/v1/communications/shared-inboxes", bytes.NewReader(memberBody))
	memberReq.Header.Set("Content-Type", "application/json")
	memberReq = sharedInboxRequestWithActor(memberReq, member, companyID, domain.RoleCompanyUser)
	memberRec := httptest.NewRecorder()
	handler.ServeHTTP(memberRec, memberReq)
	if memberRec.Code != http.StatusForbidden {
		t.Fatalf("POST shared inbox as member status = %d, want %d body=%s", memberRec.Code, http.StatusForbidden, memberRec.Body.String())
	}

	managerBody, _ := json.Marshal(map[string]string{"company_id": companyID, "name": "Manager Folder"})
	managerReq := httptest.NewRequest(http.MethodPost, "/v1/communications/shared-inboxes", bytes.NewReader(managerBody))
	managerReq.Header.Set("Content-Type", "application/json")
	managerReq = sharedInboxRequestWithActor(managerReq, manager, companyID, domain.RoleCompanyManager)
	managerRec := httptest.NewRecorder()
	handler.ServeHTTP(managerRec, managerReq)
	if managerRec.Code != http.StatusCreated {
		t.Fatalf("POST shared inbox as manager status = %d, want %d body=%s", managerRec.Code, http.StatusCreated, managerRec.Body.String())
	}
}

func TestCommunicationsSharedInboxAccountEmailRequiresManagerOrAdmin(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-shared-inbox-email-manager-required"
	repo.EnsureCompany(companyID, "Shared Inbox Email Manager Required")

	member, err := repo.UpsertAuthUser("subject-shared-email-member", "shared-email-member@example.com", "Shared Email Member")
	if err != nil {
		t.Fatalf("UpsertAuthUser member error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(member.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership member error = %v", err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder error = %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"company_id":    companyID,
		"account_email": "support@example.com",
	})
	req := httptest.NewRequest(http.MethodPut, "/v1/communications/shared-inboxes/"+folder.FolderID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = sharedInboxRequestWithActor(req, member, companyID, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("PUT shared inbox account email as member status = %d, want %d body=%s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	reloaded, err := repo.GetCommunicationsSharedInboxFolder(companyID, folder.FolderID)
	if err != nil {
		t.Fatalf("GetCommunicationsSharedInboxFolder error = %v", err)
	}
	if reloaded.AccountEmail != nil && *reloaded.AccountEmail != "" {
		t.Fatalf("account email = %v, want unchanged empty email", *reloaded.AccountEmail)
	}
}

func TestCommunicationsSharedInboxAccessRouteDoesNotConvertGVICAssignmentsToPermissions(t *testing.T) {
	t.Parallel()

	backing := store.NewMemoryRepo()
	repo := backing
	server := NewServer(repo)
	companyID := "company-shared-inbox-access-no-GVIC-compat"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)
	repo.EnsureCompany(companyID, "Shared Inbox No GVIC Compat")

	user, err := repo.UpsertAuthUser("subject-shared-access-no-GVIC-compat", "no-GVIC-compat@example.com", "No GVIC Compat")
	if err != nil {
		t.Fatalf("UpsertAuthUser error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership error = %v", err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Access", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder error = %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeSharedInboxFolder,
		EntityID:         folder.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions default error = %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"assignments": []map[string]string{
			{"role": domain.GVICRoleResponsible, "user_id": user.UserID},
		},
	})
	req := httptest.NewRequest(http.MethodPut, "/v1/communications/shared-inboxes/"+folder.FolderID+"/access", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("PUT removed shared inbox access route status = %d, want %d body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
	allowed, err := repo.UserHasEffectiveAccess(companyID, user.UserID, store.EntityTypeSharedInboxFolder, folder.FolderID, store.EntityPermissionEdit)
	if err != nil {
		t.Fatalf("UserHasEffectiveAccess: %v", err)
	}
	if allowed {
		t.Fatal("assignments-only access update created effective access, want no derived compatibility")
	}
}

func TestCommunicationsSharedInboxManagerCanManageAccess(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-shared-inbox-manager"
	repo.EnsureCompany(companyID, "Shared Inbox Manager")
	handler := server.Routes()

	managerUser, err := repo.UpsertAuthUser("subject-shared-resource-manager", "resource-manager@example.com", "Resource Manager")
	if err != nil {
		t.Fatalf("UpsertAuthUser manager error = %v", err)
	}
	targetUser, err := repo.UpsertAuthUser("subject-shared-resource-target", "resource-target@example.com", "Resource Target")
	if err != nil {
		t.Fatalf("UpsertAuthUser target error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(managerUser.CognitoSubject, companyID, domain.RoleCompanyManager); err != nil {
		t.Fatalf("AddCompanyMembership manager error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(targetUser.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership target error = %v", err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Resource Admin", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder error = %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeSharedInboxFolder,
		EntityID:         folder.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   managerUser.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions manager error = %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"company_id":      companyID,
		"permission_mode": store.PolicyModeCustomized,
		"default_access":  store.ResourceDefaultAccessNoAccess,
		"permissions": []map[string]string{
			{"subject_type": store.EntityPermissionSubjectUser, "subject_id": targetUser.UserID, "access_level": store.EntityPermissionEdit},
		},
	})
	req := httptest.NewRequest(http.MethodPut, "/v1/resources/shared_inbox_folder/"+folder.FolderID+"/permissions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), actorContextKey{}, ActorContext{
		User: managerUser,
		Memberships: []domain.CompanyMembership{
			{CompanyID: companyID, UserID: managerUser.UserID, Role: domain.RoleCompanyManager},
		},
	}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT shared inbox access as manager status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	allowed, err := repo.UserHasEffectiveAccess(companyID, targetUser.UserID, store.EntityTypeSharedInboxFolder, folder.FolderID, store.EntityPermissionEdit)
	if err != nil {
		t.Fatalf("UserHasEffectiveAccess target: %v", err)
	}
	if !allowed {
		t.Fatal("manager access update did not grant target view access")
	}
}

func TestCommunicationsSharedInboxListFiltersToGrantedFoldersOnly(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-shared-inbox-filter-test"
	repo.EnsureCompany(companyID, "Shared Inbox Filter Company")

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

	parent, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Business", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder parent error = %v", err)
	}
	child, err := repo.CreateCommunicationsSharedInboxFolder(companyID, parent.FolderID, "Client Facing", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder child error = %v", err)
	}
	unrelated, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Supply Chain", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder unrelated error = %v", err)
	}
	for _, folder := range []domain.CompanyExplorerFolder{parent, child, unrelated} {
		if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID:        companyID,
			EntityType:       store.EntityTypeSharedInboxFolder,
			EntityID:         folder.FolderID,
			DefaultAccess:    store.ResourceDefaultAccessNoAccess,
			DefaultAccessSet: true,
		}); err != nil {
			t.Fatalf("SetEntityPermissions default %s error = %v", folder.FolderID, err)
		}
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeSharedInboxFolder,
		EntityID:         child.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   currentUser.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions child error = %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeSharedInboxFolder,
		EntityID:         unrelated.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   otherUser.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
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
	if seen[parent.FolderID] || !seen[child.FolderID] || seen[unrelated.FolderID] {
		t.Fatalf("shared inbox folders = %+v, want granted folders only", payload.SharedInboxes)
	}
}

type sharedInboxListErrorRepo struct {
	store.Repository
	err error
}

func (r sharedInboxListErrorRepo) ListCommunicationsSharedInboxFolders(companyID string) ([]domain.CompanyExplorerFolder, error) {
	return nil, r.err
}

func (r sharedInboxListErrorRepo) ListVisibleCommunicationsSharedInboxFolders(companyID, userID string) ([]domain.CompanyExplorerFolder, error) {
	return nil, r.err
}

func (r sharedInboxListErrorRepo) GetCommunicationsSharedInboxFolder(companyID, folderID string) (domain.CompanyExplorerFolder, error) {
	return domain.CompanyExplorerFolder{}, r.err
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

func TestCommunicationsSharedInboxLegacyAccessRouteIsRemoved(t *testing.T) {
	t.Parallel()

	repo := sharedInboxListErrorRepo{Repository: store.NewMemoryRepo(), err: store.ErrSharedInboxStorageUnavailable}
	handler := NewServer(repo).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/shared-inboxes/folder-1/access?company_id=11111111-1111-1111-1111-111111111111", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET removed shared inbox access route status = %d, want %d body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}
