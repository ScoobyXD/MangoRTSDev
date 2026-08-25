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

func TestCompanyExplorerMutationHTTPAuthorization(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-330000000120"
	otherCompanyID := "11111111-1111-4111-8111-330000000121"
	repo.EnsureCompany(companyID, "Explorer HTTP authorization")
	repo.EnsureCompany(otherCompanyID, "Other Explorer company")

	admin, err := repo.UpsertAuthUser("explorer-http-admin", "explorer-http-admin@example.com", "Explorer HTTP Admin")
	if err != nil {
		t.Fatal(err)
	}
	member, err := repo.UpsertAuthUser("explorer-http-member", "explorer-http-member@example.com", "Explorer HTTP Member")
	if err != nil {
		t.Fatal(err)
	}
	outsider, err := repo.UpsertAuthUser("explorer-http-outsider", "explorer-http-outsider@example.com", "Explorer HTTP Outsider")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(member.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}

	sourceFolder, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Source")
	openFolder, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Open")
	restrictedFolder, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Restricted")
	otherFolder, _ := repo.CreateCompanyExplorerFolder(otherCompanyID, "", "logic_gate", "Other")
	movingFolder, _ := repo.CreateCompanyExplorerFolder(companyID, sourceFolder.FolderID, "logic_gate", "Moving folder")
	gate, err := repo.CreateLogicGate(companyID, "Moving process")
	if err != nil {
		t.Fatal(err)
	}
	placed, err := repo.UpsertCompanyExplorerV2Edge(store.CompanyExplorerV2EdgeInput{
		CompanyID: companyID, ParentEntityID: sourceFolder.FolderID,
		ChildEntityType: store.CompanyExplorerV2EntityLogicGate, ChildResourceID: gate.LogicGateID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}

	setDefaultAccess := func(resourceType, resourceID, access string) {
		t.Helper()
		if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID: companyID, EntityType: resourceType, EntityID: resourceID,
			DefaultAccess: access, DefaultAccessSet: true, ActorUserID: admin.UserID,
		}); err != nil {
			t.Fatalf("SetEntityPermissions(%s/%s, %s): %v", resourceType, resourceID, access, err)
		}
	}
	setDefaultAccess(store.EntityTypeCompanyExplorerFolder, restrictedFolder.FolderID, store.ResourceDefaultAccessNoAccess)

	request := func(method, path string, payload any, user domain.User, role string, memberOfCompany bool) *httptest.ResponseRecorder {
		t.Helper()
		var body bytes.Buffer
		if payload != nil {
			if err := json.NewEncoder(&body).Encode(payload); err != nil {
				t.Fatal(err)
			}
		}
		req := httptest.NewRequest(method, path, &body)
		req.Header.Set("Content-Type", "application/json")
		actor := ActorContext{User: user}
		if memberOfCompany {
			actor.Memberships = []domain.CompanyMembership{{CompanyID: companyID, UserID: user.UserID, Role: role}}
			actor.CompanyID = companyID
			actor.CompanyRole = role
		}
		req = req.WithContext(context.WithValue(req.Context(), actorContextKey{}, actor))
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder
	}

	moveItem := func(edgeID, parentID string, user domain.User, role string, memberOfCompany bool) *httptest.ResponseRecorder {
		return request(http.MethodPut, "/v1/company-explorer/items/"+edgeID, map[string]any{
			"company_id": companyID, "parent_entity_id": parentID,
		}, user, role, memberOfCompany)
	}

	if recorder := moveItem(placed.EdgeID, restrictedFolder.FolderID, member, domain.RoleCompanyUser, true); recorder.Code != http.StatusNotFound {
		t.Fatalf("destination-denied item move status = %d, want 404 body=%s", recorder.Code, recorder.Body.String())
	}
	if recorder := moveItem(placed.EdgeID, otherFolder.FolderID, member, domain.RoleCompanyUser, true); recorder.Code != http.StatusNotFound {
		t.Fatalf("cross-company item move status = %d, want 404 body=%s", recorder.Code, recorder.Body.String())
	}
	if recorder := moveItem(placed.EdgeID, companyID, outsider, domain.RoleCompanyUser, false); recorder.Code != http.StatusForbidden {
		t.Fatalf("nonmember root item move status = %d, want 403 body=%s", recorder.Code, recorder.Body.String())
	}
	rootMove := moveItem(placed.EdgeID, companyID, member, domain.RoleCompanyUser, true)
	if rootMove.Code != http.StatusOK {
		t.Fatalf("authorized root item move status = %d, want 200 body=%s", rootMove.Code, rootMove.Body.String())
	}
	var rootRow store.CompanyExplorerV2Row
	if err := json.NewDecoder(rootMove.Body).Decode(&rootRow); err != nil {
		t.Fatal(err)
	}
	if rootRow.ParentEntityID != "" {
		t.Fatalf("authorized root item move parent = %q, want root", rootRow.ParentEntityID)
	}

	setDefaultAccess(store.EntityTypeLogicGate, gate.LogicGateID, store.ResourceDefaultAccessNoAccess)
	if recorder := moveItem(rootRow.EdgeID, openFolder.FolderID, member, domain.RoleCompanyUser, true); recorder.Code != http.StatusNotFound {
		t.Fatalf("source-denied item move status = %d, want 404 body=%s", recorder.Code, recorder.Body.String())
	}
	deletePath := "/v1/company-explorer/items/" + rootRow.EdgeID + "?company_id=" + companyID
	if recorder := request(http.MethodDelete, deletePath, nil, member, domain.RoleCompanyUser, true); recorder.Code != http.StatusNotFound {
		t.Fatalf("source-denied detach status = %d, want 404 body=%s", recorder.Code, recorder.Body.String())
	}
	setDefaultAccess(store.EntityTypeLogicGate, gate.LogicGateID, store.ResourceDefaultAccessEdit)
	if recorder := request(http.MethodDelete, deletePath, nil, member, domain.RoleCompanyUser, true); recorder.Code != http.StatusOK {
		t.Fatalf("authorized detach status = %d, want 200 body=%s", recorder.Code, recorder.Body.String())
	}

	folderPath := "/v1/company-explorer/folders/" + movingFolder.FolderID
	if recorder := request(http.MethodPut, folderPath, map[string]any{
		"company_id": companyID, "parent_folder_id": restrictedFolder.FolderID,
	}, member, domain.RoleCompanyUser, true); recorder.Code != http.StatusNotFound {
		t.Fatalf("destination-denied folder move status = %d, want 404 body=%s", recorder.Code, recorder.Body.String())
	}
	if recorder := request(http.MethodPut, folderPath, map[string]any{
		"company_id": companyID, "parent_folder_id": otherFolder.FolderID,
	}, member, domain.RoleCompanyUser, true); recorder.Code != http.StatusNotFound {
		t.Fatalf("cross-company folder move status = %d, want 404 body=%s", recorder.Code, recorder.Body.String())
	}
	if recorder := request(http.MethodPut, folderPath, map[string]any{
		"company_id": companyID, "parent_folder_id": "",
	}, member, domain.RoleCompanyUser, true); recorder.Code != http.StatusOK {
		t.Fatalf("authorized root folder move status = %d, want 200 body=%s", recorder.Code, recorder.Body.String())
	}
	setDefaultAccess(store.EntityTypeCompanyExplorerFolder, movingFolder.FolderID, store.ResourceDefaultAccessNoAccess)
	if recorder := request(http.MethodPut, folderPath, map[string]any{
		"company_id": companyID, "name": "Denied rename",
	}, member, domain.RoleCompanyUser, true); recorder.Code != http.StatusNotFound {
		t.Fatalf("source-denied folder rename status = %d, want 404 body=%s", recorder.Code, recorder.Body.String())
	}
	folder, err := repo.GetCompanyExplorerV2Entity(companyID, movingFolder.FolderID, admin.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if folder.Name != "Moving folder" {
		t.Fatalf("denied HTTP rename changed folder name to %q", folder.Name)
	}
	if recorder := request(http.MethodPut, folderPath, map[string]any{
		"company_id": companyID, "name": "No membership",
	}, outsider, domain.RoleCompanyUser, false); recorder.Code != http.StatusForbidden {
		t.Fatalf("nonmember folder rename status = %d, want 403 body=%s", recorder.Code, recorder.Body.String())
	}
}
