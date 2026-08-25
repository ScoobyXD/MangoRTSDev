package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestHierarchyPathRoutesReturnTypedComputedPaths(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "11111111-1111-4111-8111-660000000201"
	admin := mustCreateUserPinUser(t, repo, "hierarchy-route-admin", companyID, "hierarchy-route-admin@example.com", domain.RoleCompanyAdmin)

	gate, err := repo.CreateLogicGate(companyID, "Route Process")
	if err != nil {
		t.Fatal(err)
	}
	companyPath := "/v1/company-explorer/location-path?company_id=" + url.QueryEscape(companyID) + "&resource_type=logic_gate&resource_id=" + url.QueryEscape(gate.LogicGateID)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, userPinRequestWithActor(httptest.NewRequest(http.MethodGet, companyPath, nil), admin, companyID, domain.RoleCompanyAdmin))
	if recorder.Code != http.StatusOK {
		t.Fatalf("Company path status = %d, body=%s", recorder.Code, recorder.Body.String())
	}
	var companyPayload store.ExplorerHierarchyPath
	if err := json.Unmarshal(recorder.Body.Bytes(), &companyPayload); err != nil {
		t.Fatal(err)
	}
	if companyPayload.Kind != store.ExplorerHierarchyKindCompanyExplorer || companyPayload.Status != store.ExplorerHierarchyStatusResolved || len(companyPayload.Segments) == 0 {
		t.Fatalf("Company path payload = %+v", companyPayload)
	}
	for _, segment := range companyPayload.Segments {
		if segment.Name == gate.Header {
			t.Fatalf("Process title %q was duplicated inside its hierarchy path", gate.Header)
		}
	}

	huddleGate, err := repo.ConvertLogicGateToHuddle(companyID, gate.LogicGateID, admin.UserID)
	if err != nil {
		t.Fatal(err)
	}
	huddlePath := "/v1/huddle-explorer/location-path?company_id=" + url.QueryEscape(companyID) + "&resource_type=huddle_logic_gate&resource_id=" + url.QueryEscape(huddleGate.HuddleLogicGateID)
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, userPinRequestWithActor(httptest.NewRequest(http.MethodGet, huddlePath, nil), admin, companyID, domain.RoleCompanyAdmin))
	if recorder.Code != http.StatusOK {
		t.Fatalf("Huddle path status = %d, body=%s", recorder.Code, recorder.Body.String())
	}
	var huddlePayload store.ExplorerHierarchyPath
	if err := json.Unmarshal(recorder.Body.Bytes(), &huddlePayload); err != nil {
		t.Fatal(err)
	}
	if huddlePayload.Kind != store.ExplorerHierarchyKindHuddleExplorer || huddlePayload.Status != store.ExplorerHierarchyStatusResolved || len(huddlePayload.Segments) != 0 {
		t.Fatalf("Huddle root path payload = %+v", huddlePayload)
	}
}

func TestHierarchyPathRoutesRejectUnsupportedTypesAndHiddenResources(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "11111111-1111-4111-8111-660000000202"
	admin := mustCreateUserPinUser(t, repo, "hierarchy-route-access-admin", companyID, "hierarchy-route-access-admin@example.com", domain.RoleCompanyAdmin)
	viewer := mustCreateUserPinUser(t, repo, "hierarchy-route-access-viewer", companyID, "hierarchy-route-access-viewer@example.com", domain.RoleCompanyUser)
	gate, err := repo.CreateLogicGate(companyID, "Hidden Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: store.EntityTypeLogicGate, EntityID: gate.LogicGateID,
		DefaultAccess: store.EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	path := "/v1/company-explorer/location-path?company_id=" + url.QueryEscape(companyID) + "&resource_type=logic_gate&resource_id=" + url.QueryEscape(gate.LogicGateID)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, userPinRequestWithActor(httptest.NewRequest(http.MethodGet, path, nil), viewer, companyID, domain.RoleCompanyUser))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("Hidden resource status = %d, want 404 body=%s", recorder.Code, recorder.Body.String())
	}

	invalidPath := "/v1/company-explorer/location-path?company_id=" + url.QueryEscape(companyID) + "&resource_type=kpi&resource_id=" + url.QueryEscape(gate.LogicGateID)
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, userPinRequestWithActor(httptest.NewRequest(http.MethodGet, invalidPath, nil), admin, companyID, domain.RoleCompanyAdmin))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("Unsupported type status = %d, want 400 body=%s", recorder.Code, recorder.Body.String())
	}
}
