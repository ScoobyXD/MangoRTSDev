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

func TestUserPinsLifecycle(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "44444444-4444-4444-8444-444444444444"
	user := mustCreateUserPinUser(t, repo, "user-pin-lifecycle", companyID, "pins@example.com", domain.RoleCompanyUser)
	node, err := repo.CreateNode(companyID, "Pinned Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Pinned Logic Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	projectResult, err := repo.CreateProject(store.ProjectInput{CompanyID: companyID, Name: "Pinned Project", ActorUserID: user.UserID})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	nodePin := createUserPinForTest(t, handler, user, companyID, domain.RoleCompanyUser, store.EntityTypeNode, node.NodeID)
	logicGatePin := createUserPinForTest(t, handler, user, companyID, domain.RoleCompanyUser, store.EntityTypeLogicGate, logicGate.LogicGateID)
	projectPin := createUserPinForTest(t, handler, user, companyID, domain.RoleCompanyUser, store.EntityTypeProject, projectResult.Project.ProjectID)
	if nodePin.Name != node.Title || logicGatePin.Name != logicGate.Header || projectPin.Name != projectResult.Project.Name {
		t.Fatalf("pin names = node:%q gate:%q project:%q", nodePin.Name, logicGatePin.Name, projectPin.Name)
	}

	duplicateNodePin := createUserPinForTest(t, handler, user, companyID, domain.RoleCompanyUser, store.EntityTypeNode, node.NodeID)
	if duplicateNodePin.PinID != nodePin.PinID {
		t.Fatalf("duplicate pin id = %s, want %s", duplicateNodePin.PinID, nodePin.PinID)
	}

	pins := listUserPinsForTest(t, handler, user, companyID, domain.RoleCompanyUser)
	if len(pins) != 3 {
		t.Fatalf("pin count = %d, pins=%+v", len(pins), pins)
	}

	rootFolder := createUserPinFolderForTest(t, handler, user, companyID, "", "Planning")
	nestedFolder := createUserPinFolderForTest(t, handler, user, companyID, rootFolder.FolderID, "Nested")
	layoutBody := `{"company_id":"` + companyID + `","entries":[` +
		`{"entry_type":"folder","entry_id":"` + rootFolder.FolderID + `","parent_folder_id":"","position":1000},` +
		`{"entry_type":"pin","entry_id":"` + projectPin.PinID + `","parent_folder_id":"` + rootFolder.FolderID + `","position":1000},` +
		`{"entry_type":"folder","entry_id":"` + nestedFolder.FolderID + `","parent_folder_id":"` + rootFolder.FolderID + `","position":2000}]}`
	layoutRec := httptest.NewRecorder()
	layoutReq := httptest.NewRequest(http.MethodPut, "/v1/user-pins/layout", bytes.NewBufferString(layoutBody))
	handler.ServeHTTP(layoutRec, userPinRequestWithActor(layoutReq, user, companyID, domain.RoleCompanyUser))
	if layoutRec.Code != http.StatusOK {
		t.Fatalf("layout status = %d body=%s", layoutRec.Code, layoutRec.Body.String())
	}
	tree := decodeUserPinTreeForTest(t, layoutRec)
	if parentIDForTest(tree.UserPins, projectPin.PinID) != rootFolder.FolderID {
		t.Fatalf("project pin was not moved into root folder: %+v", tree.UserPins)
	}

	groupBody := `{"company_id":"` + companyID + `","dragged_pin_id":"` + nodePin.PinID + `","target_pin_id":"` + logicGatePin.PinID + `"}`
	groupRec := httptest.NewRecorder()
	groupReq := httptest.NewRequest(http.MethodPost, "/v1/user-pin-folders/group", bytes.NewBufferString(groupBody))
	handler.ServeHTTP(groupRec, userPinRequestWithActor(groupReq, user, companyID, domain.RoleCompanyUser))
	if groupRec.Code != http.StatusCreated {
		t.Fatalf("group status = %d body=%s", groupRec.Code, groupRec.Body.String())
	}
	var groupPayload struct {
		GroupedFolder domain.UserPinFolder   `json:"grouped_folder"`
		PinFolders    []domain.UserPinFolder `json:"pin_folders"`
		UserPins      []domain.UserPin       `json:"user_pins"`
	}
	if err := json.NewDecoder(groupRec.Body).Decode(&groupPayload); err != nil {
		t.Fatalf("decode group: %v", err)
	}
	if groupPayload.GroupedFolder.Name != "New Folder" || groupPayload.GroupedFolder.ParentFolderID != nil {
		t.Fatalf("grouped folder = %+v", groupPayload.GroupedFolder)
	}
	if parentIDForTest(groupPayload.UserPins, logicGatePin.PinID) != groupPayload.GroupedFolder.FolderID || parentIDForTest(groupPayload.UserPins, nodePin.PinID) != groupPayload.GroupedFolder.FolderID {
		t.Fatalf("grouped pins = %+v", groupPayload.UserPins)
	}
	if positionForTest(groupPayload.UserPins, logicGatePin.PinID) != 1000 || positionForTest(groupPayload.UserPins, nodePin.PinID) != 2000 {
		t.Fatalf("group order = %+v", groupPayload.UserPins)
	}

	deleteFolderRec := httptest.NewRecorder()
	deleteFolderReq := httptest.NewRequest(http.MethodDelete, "/v1/user-pin-folders/"+rootFolder.FolderID+"?company_id="+companyID, nil)
	handler.ServeHTTP(deleteFolderRec, userPinRequestWithActor(deleteFolderReq, user, companyID, domain.RoleCompanyUser))
	if deleteFolderRec.Code != http.StatusOK {
		t.Fatalf("delete folder status = %d body=%s", deleteFolderRec.Code, deleteFolderRec.Body.String())
	}
	tree = decodeUserPinTreeForTest(t, deleteFolderRec)
	if len(tree.UserPins) != 2 || len(tree.PinFolders) != 1 {
		t.Fatalf("tree after subtree delete = %+v", tree)
	}

	deleteRec := httptest.NewRecorder()
	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/user-pins/"+logicGatePin.PinID+"?company_id="+companyID, nil)
	handler.ServeHTTP(deleteRec, userPinRequestWithActor(deleteReq, user, companyID, domain.RoleCompanyUser))
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("delete status = %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}
	pins = listUserPinsForTest(t, handler, user, companyID, domain.RoleCompanyUser)
	if len(pins) != 1 {
		t.Fatalf("pin count after delete = %d, pins=%+v", len(pins), pins)
	}
}

func TestUserPinsListAfterPermissionRevokedButCreateRequiresView(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "55555555-5555-4555-8555-555555555555"
	owner := mustCreateUserPinUser(t, repo, "user-pin-owner", companyID, "owner@example.com", domain.RoleCompanyUser)
	other := mustCreateUserPinUser(t, repo, "user-pin-other", companyID, "other@example.com", domain.RoleCompanyUser)
	node, err := repo.CreateNode(companyID, "Permission Edge Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	pin := createUserPinForTest(t, handler, owner, companyID, domain.RoleCompanyUser, store.EntityTypeNode, node.NodeID)

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.EntityPermissionNoAccess,
		DefaultAccessSet: true,
		ActorUserID:      owner.UserID,
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	pins := listUserPinsForTest(t, handler, owner, companyID, domain.RoleCompanyUser)
	if len(pins) != 1 || pins[0].PinID != pin.PinID {
		t.Fatalf("owner pins after revoke = %+v", pins)
	}

	createBody := `{"company_id":"` + companyID + `","resource_type":"node","resource_id":"` + node.NodeID + `"}`
	createRec := httptest.NewRecorder()
	createReq := httptest.NewRequest(http.MethodPost, "/v1/user-pins", bytes.NewBufferString(createBody))
	handler.ServeHTTP(createRec, userPinRequestWithActor(createReq, other, companyID, domain.RoleCompanyUser))
	if createRec.Code != http.StatusNotFound {
		t.Fatalf("create without view status = %d body=%s", createRec.Code, createRec.Body.String())
	}
}

func TestUserPinFoldersRejectCyclesAndWrongOwnerIDs(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "56565656-5656-4656-8656-565656565656"
	owner := mustCreateUserPinUser(t, repo, "pin-folder-owner", companyID, "folder-owner@example.com", domain.RoleCompanyUser)
	other := mustCreateUserPinUser(t, repo, "pin-folder-other", companyID, "folder-other@example.com", domain.RoleCompanyUser)
	root := createUserPinFolderForTest(t, handler, owner, companyID, "", "Root")
	child := createUserPinFolderForTest(t, handler, owner, companyID, root.FolderID, "Child")

	cycleBody := `{"company_id":"` + companyID + `","entries":[{"entry_type":"folder","entry_id":"` + root.FolderID + `","parent_folder_id":"` + child.FolderID + `","position":1000}]}`
	cycleRec := httptest.NewRecorder()
	cycleReq := httptest.NewRequest(http.MethodPut, "/v1/user-pins/layout", bytes.NewBufferString(cycleBody))
	handler.ServeHTTP(cycleRec, userPinRequestWithActor(cycleReq, owner, companyID, domain.RoleCompanyUser))
	if cycleRec.Code != http.StatusBadRequest {
		t.Fatalf("cycle status = %d body=%s", cycleRec.Code, cycleRec.Body.String())
	}
	tree := listUserPinTreeForTest(t, handler, owner, companyID, domain.RoleCompanyUser)
	if parentFolderIDForTest(tree.PinFolders, root.FolderID) != "" || parentFolderIDForTest(tree.PinFolders, child.FolderID) != root.FolderID {
		t.Fatalf("cycle rejection changed tree = %+v", tree.PinFolders)
	}

	renameBody := `{"company_id":"` + companyID + `","name":"Stolen"}`
	renameRec := httptest.NewRecorder()
	renameReq := httptest.NewRequest(http.MethodPut, "/v1/user-pin-folders/"+root.FolderID, bytes.NewBufferString(renameBody))
	handler.ServeHTTP(renameRec, userPinRequestWithActor(renameReq, other, companyID, domain.RoleCompanyUser))
	if renameRec.Code != http.StatusNotFound {
		t.Fatalf("wrong-owner rename status = %d body=%s", renameRec.Code, renameRec.Body.String())
	}
}

func createUserPinFolderForTest(t *testing.T, handler http.Handler, user domain.User, companyID, parentFolderID, name string) domain.UserPinFolder {
	t.Helper()
	body, err := json.Marshal(map[string]any{"company_id": companyID, "parent_folder_id": parentFolderID, "name": name})
	if err != nil {
		t.Fatalf("marshal pin folder: %v", err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/user-pin-folders", bytes.NewReader(body))
	handler.ServeHTTP(rec, userPinRequestWithActor(req, user, companyID, domain.RoleCompanyUser))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create pin folder status = %d body=%s", rec.Code, rec.Body.String())
	}
	var folder domain.UserPinFolder
	if err := json.NewDecoder(rec.Body).Decode(&folder); err != nil {
		t.Fatalf("decode pin folder: %v", err)
	}
	return folder
}

func decodeUserPinTreeForTest(t *testing.T, rec *httptest.ResponseRecorder) domain.UserPinTree {
	t.Helper()
	var tree domain.UserPinTree
	if err := json.NewDecoder(rec.Body).Decode(&tree); err != nil {
		t.Fatalf("decode user pin tree: %v", err)
	}
	return tree
}

func parentIDForTest(pins []domain.UserPin, pinID string) string {
	for _, pin := range pins {
		if pin.PinID == pinID && pin.ParentFolderID != nil {
			return *pin.ParentFolderID
		}
	}
	return ""
}

func positionForTest(pins []domain.UserPin, pinID string) int {
	for _, pin := range pins {
		if pin.PinID == pinID {
			return pin.Position
		}
	}
	return 0
}

func parentFolderIDForTest(folders []domain.UserPinFolder, folderID string) string {
	for _, folder := range folders {
		if folder.FolderID == folderID && folder.ParentFolderID != nil {
			return *folder.ParentFolderID
		}
	}
	return ""
}

func createUserPinForTest(t *testing.T, handler http.Handler, user domain.User, companyID, role, resourceType, resourceID string) domain.UserPin {
	t.Helper()
	body := `{"company_id":"` + companyID + `","resource_type":"` + resourceType + `","resource_id":"` + resourceID + `"}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/user-pins", bytes.NewBufferString(body))
	handler.ServeHTTP(rec, userPinRequestWithActor(req, user, companyID, role))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create user pin status = %d body=%s", rec.Code, rec.Body.String())
	}
	var pin domain.UserPin
	if err := json.NewDecoder(rec.Body).Decode(&pin); err != nil {
		t.Fatalf("decode user pin: %v", err)
	}
	return pin
}

func listUserPinsForTest(t *testing.T, handler http.Handler, user domain.User, companyID, role string) []domain.UserPin {
	return listUserPinTreeForTest(t, handler, user, companyID, role).UserPins
}

func listUserPinTreeForTest(t *testing.T, handler http.Handler, user domain.User, companyID, role string) domain.UserPinTree {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/user-pins?company_id="+companyID, nil)
	handler.ServeHTTP(rec, userPinRequestWithActor(req, user, companyID, role))
	if rec.Code != http.StatusOK {
		t.Fatalf("list user pins status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload domain.UserPinTree
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode user pins: %v", err)
	}
	return payload
}

func mustCreateUserPinUser(t *testing.T, repo *store.MemoryRepo, subject, companyID, email, role string) domain.User {
	t.Helper()
	repo.EnsureCompany(companyID, "User Pins Company")
	user, err := repo.UpsertAuthUser(subject, email, subject)
	if err != nil {
		t.Fatalf("UpsertAuthUser %s: %v", subject, err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, role); err != nil {
		t.Fatalf("AddCompanyMembership %s: %v", subject, err)
	}
	return user
}

func userPinRequestWithActor(req *http.Request, user domain.User, companyID, role string) *http.Request {
	actor := ActorContext{
		User: user,
		Memberships: []domain.CompanyMembership{{
			CompanyID: companyID,
			UserID:    user.UserID,
			Role:      role,
		}},
		CompanyID:   companyID,
		CompanyRole: role,
	}
	return req.WithContext(context.WithValue(req.Context(), actorContextKey{}, actor))
}
