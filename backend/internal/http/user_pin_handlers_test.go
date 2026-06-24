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

	reorderBody := `{"company_id":"` + companyID + `","pin_ids":["` + projectPin.PinID + `","` + nodePin.PinID + `","` + logicGatePin.PinID + `"]}`
	reorderRec := httptest.NewRecorder()
	reorderReq := httptest.NewRequest(http.MethodPut, "/v1/user-pins/order", bytes.NewBufferString(reorderBody))
	handler.ServeHTTP(reorderRec, userPinRequestWithActor(reorderReq, user, companyID, domain.RoleCompanyUser))
	if reorderRec.Code != http.StatusOK {
		t.Fatalf("reorder status = %d body=%s", reorderRec.Code, reorderRec.Body.String())
	}
	var reorderPayload struct {
		UserPins []domain.UserPin `json:"user_pins"`
	}
	if err := json.NewDecoder(reorderRec.Body).Decode(&reorderPayload); err != nil {
		t.Fatalf("decode reorder: %v", err)
	}
	if len(reorderPayload.UserPins) != 3 || reorderPayload.UserPins[0].PinID != projectPin.PinID || reorderPayload.UserPins[1].PinID != nodePin.PinID {
		t.Fatalf("reordered pins = %+v", reorderPayload.UserPins)
	}

	deleteRec := httptest.NewRecorder()
	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/user-pins/"+logicGatePin.PinID+"?company_id="+companyID, nil)
	handler.ServeHTTP(deleteRec, userPinRequestWithActor(deleteReq, user, companyID, domain.RoleCompanyUser))
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("delete status = %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}
	pins = listUserPinsForTest(t, handler, user, companyID, domain.RoleCompanyUser)
	if len(pins) != 2 {
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
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/user-pins?company_id="+companyID, nil)
	handler.ServeHTTP(rec, userPinRequestWithActor(req, user, companyID, role))
	if rec.Code != http.StatusOK {
		t.Fatalf("list user pins status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		UserPins []domain.UserPin `json:"user_pins"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode user pins: %v", err)
	}
	return payload.UserPins
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
