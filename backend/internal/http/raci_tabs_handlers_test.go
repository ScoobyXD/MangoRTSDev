package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestRACITabsHTTPUsesAuthenticatedUserScopeAndLazyBranches(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "89898989-8989-4989-8989-898989898989"
	alice := mustCreateUserPinUser(t, repo, "raci-http-alice", companyID, "raci-alice@example.com", domain.RoleCompanyUser)
	bob := mustCreateUserPinUser(t, repo, "raci-http-bob", companyID, "raci-bob@example.com", domain.RoleCompanyUser)
	gate, err := repo.CreateLogicGate(companyID, "Alice Gate")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddLogicGateRACIAssignments(store.LogicGateRACIAssignmentCommandInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID,
		Assignments: []store.LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, UserID: alice.UserID}},
	}); err != nil {
		t.Fatal(err)
	}

	alicePage := getRACITabPageForTest(t, handler, alice, companyID, "/v1/raci-tabs?company_id="+companyID+"&role=responsible&limit=50")
	if len(alicePage.Rows) != 1 || alicePage.Rows[0].Item == nil || alicePage.Rows[0].Item.LogicGateID != gate.LogicGateID {
		t.Fatalf("alice rows = %+v", alicePage.Rows)
	}
	bobPage := getRACITabPageForTest(t, handler, bob, companyID, "/v1/raci-tabs?company_id="+companyID+"&role=responsible&user_id="+url.QueryEscape(alice.UserID))
	if len(bobPage.Rows) != 0 {
		t.Fatalf("request user_id escaped authenticated scope: %+v", bobPage.Rows)
	}

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/v1/raci-tabs?company_id="+companyID+"&role=responsible", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d body=%s", unauthorized.Code, unauthorized.Body.String())
	}
	invalidCursor := httptest.NewRecorder()
	invalidCursorRequest := httptest.NewRequest(http.MethodGet, "/v1/raci-tabs?company_id="+companyID+"&role=responsible&cursor=bad", nil)
	handler.ServeHTTP(invalidCursor, userPinRequestWithActor(invalidCursorRequest, alice, companyID, domain.RoleCompanyUser))
	if invalidCursor.Code != http.StatusBadRequest {
		t.Fatalf("invalid cursor status = %d body=%s", invalidCursor.Code, invalidCursor.Body.String())
	}
}

func TestRACITabFolderHTTPLayoutLifecycleAndOwnerBoundary(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "90909090-9090-4090-8090-909090909090"
	owner := mustCreateUserPinUser(t, repo, "raci-folder-owner", companyID, "raci-folder-owner@example.com", domain.RoleCompanyUser)
	other := mustCreateUserPinUser(t, repo, "raci-folder-other", companyID, "raci-folder-other@example.com", domain.RoleCompanyUser)
	gate, err := repo.CreateLogicGate(companyID, "Move Me")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddLogicGateRACIAssignments(store.LogicGateRACIAssignmentCommandInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID,
		Assignments: []store.LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, UserID: owner.UserID}},
	}); err != nil {
		t.Fatal(err)
	}
	root := createRACITabFolderForTest(t, handler, owner, companyID, "responsible", "", "Planning")
	child := createRACITabFolderForTest(t, handler, owner, companyID, "responsible", root.FolderID, "This Week")

	layoutBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "role": "responsible",
		"entries": []map[string]any{{"entry_type": "item", "entry_id": gate.LogicGateID, "parent_folder_id": child.FolderID, "position": 1000}},
	})
	layout := httptest.NewRecorder()
	layoutRequest := httptest.NewRequest(http.MethodPut, "/v1/raci-tabs/layout", bytes.NewReader(layoutBody))
	handler.ServeHTTP(layout, userPinRequestWithActor(layoutRequest, owner, companyID, domain.RoleCompanyUser))
	if layout.Code != http.StatusOK {
		t.Fatalf("layout status = %d body=%s", layout.Code, layout.Body.String())
	}
	childPage := getRACITabPageForTest(t, handler, owner, companyID, "/v1/raci-tabs?company_id="+companyID+"&role=responsible&parent_folder_id="+child.FolderID)
	if len(childPage.Rows) != 1 || childPage.Rows[0].Item == nil || childPage.Rows[0].Item.LogicGateID != gate.LogicGateID {
		t.Fatalf("child rows = %+v", childPage.Rows)
	}

	cycleBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "role": "responsible",
		"entries": []map[string]any{{"entry_type": "folder", "entry_id": root.FolderID, "parent_folder_id": child.FolderID, "position": 1000}},
	})
	cycle := httptest.NewRecorder()
	cycleRequest := httptest.NewRequest(http.MethodPut, "/v1/raci-tabs/layout", bytes.NewReader(cycleBody))
	handler.ServeHTTP(cycle, userPinRequestWithActor(cycleRequest, owner, companyID, domain.RoleCompanyUser))
	if cycle.Code != http.StatusBadRequest {
		t.Fatalf("cycle status = %d body=%s", cycle.Code, cycle.Body.String())
	}

	wrongOwnerBody := []byte(`{"company_id":"` + companyID + `","name":"Stolen"}`)
	wrongOwner := httptest.NewRecorder()
	wrongOwnerRequest := httptest.NewRequest(http.MethodPut, "/v1/raci-tab-folders/"+root.FolderID, bytes.NewReader(wrongOwnerBody))
	handler.ServeHTTP(wrongOwner, userPinRequestWithActor(wrongOwnerRequest, other, companyID, domain.RoleCompanyUser))
	if wrongOwner.Code != http.StatusNotFound {
		t.Fatalf("wrong-owner status = %d body=%s", wrongOwner.Code, wrongOwner.Body.String())
	}

	deleted := httptest.NewRecorder()
	deleteRequest := httptest.NewRequest(http.MethodDelete, "/v1/raci-tab-folders/"+root.FolderID+"?company_id="+companyID, nil)
	handler.ServeHTTP(deleted, userPinRequestWithActor(deleteRequest, owner, companyID, domain.RoleCompanyUser))
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete status = %d body=%s", deleted.Code, deleted.Body.String())
	}
	rootPage := getRACITabPageForTest(t, handler, owner, companyID, "/v1/raci-tabs?company_id="+companyID+"&role=responsible")
	if len(rootPage.Rows) != 1 || rootPage.Rows[0].Item == nil || rootPage.Rows[0].Item.LogicGateID != gate.LogicGateID || rootPage.Rows[0].Item.FolderID != nil {
		t.Fatalf("delete did not preserve item at role root: %+v", rootPage.Rows)
	}
}

func createRACITabFolderForTest(t *testing.T, handler http.Handler, user domain.User, companyID, role, parentFolderID, name string) domain.RACITabFolder {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"company_id": companyID, "role": role, "parent_folder_id": parentFolderID, "name": name})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/raci-tab-folders", bytes.NewReader(body))
	handler.ServeHTTP(recorder, userPinRequestWithActor(request, user, companyID, domain.RoleCompanyUser))
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create RACI folder status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var folder domain.RACITabFolder
	if err := json.NewDecoder(recorder.Body).Decode(&folder); err != nil {
		t.Fatal(err)
	}
	return folder
}

func getRACITabPageForTest(t *testing.T, handler http.Handler, user domain.User, companyID, path string) domain.RACITabPage {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	handler.ServeHTTP(recorder, userPinRequestWithActor(request, user, companyID, domain.RoleCompanyUser))
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET %s status = %d body=%s", path, recorder.Code, recorder.Body.String())
	}
	var page domain.RACITabPage
	if err := json.NewDecoder(recorder.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	return page
}
