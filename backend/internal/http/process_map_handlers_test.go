package httpapi

import (
	"bytes"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

type processMapHTTPFixture struct {
	repo      *store.MemoryRepo
	handler   http.Handler
	companyID string
	admin     domain.User
	viewer    domain.User
	folder    domain.CompanyExplorerFolder
	processA  domain.LogicGate
	processB  domain.LogicGate
}

func newProcessMapHTTPFixture(t *testing.T) processMapHTTPFixture {
	t.Helper()
	repo := store.NewMemoryRepo()
	companyID := "11111111-2222-4333-8444-555555555555"
	repo.EnsureCompany(companyID, "Process Map HTTP")
	createUser := func(subject, role string) domain.User {
		t.Helper()
		user, err := repo.UpsertAuthUser(subject, subject+"@example.com", subject)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.AddCompanyMembership(subject, companyID, role); err != nil {
			t.Fatal(err)
		}
		return user
	}
	admin := createUser("process-map-admin", domain.RoleCompanyAdmin)
	viewer := createUser("process-map-viewer", domain.RoleCompanyUser)
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Operations")
	if err != nil {
		t.Fatal(err)
	}
	processA, err := repo.CreateLogicGate(companyID, "Receive")
	if err != nil {
		t.Fatal(err)
	}
	processB, err := repo.CreateLogicGate(companyID, "Ship")
	if err != nil {
		t.Fatal(err)
	}
	return processMapHTTPFixture{
		repo: repo, handler: NewServer(repo).Routes(), companyID: companyID,
		admin: admin, viewer: viewer, folder: folder, processA: processA, processB: processB,
	}
}

func (fixture processMapHTTPFixture) request(t *testing.T, actor domain.User, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request = requestWithActorForTest(request, actor, fixture.companyID)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response := httptest.NewRecorder()
	fixture.handler.ServeHTTP(response, request)
	return response
}

func TestProcessMapHTTPExactLayerRestrictedProjectionAndLifecycle(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	companyQuery := url.QueryEscape(fixture.companyID)
	putPlacement := func(resourceType, resourceID, body string) {
		t.Helper()
		response := fixture.request(t, fixture.admin, http.MethodPut,
			"/v1/process-map/placements/"+resourceType+"/"+resourceID+"?company_id="+companyQuery, body, nil)
		if response.Code != http.StatusCreated {
			t.Fatalf("PUT placement status=%d body=%s", response.Code, response.Body.String())
		}
	}
	putPlacement(domain.ProcessMapResourceTypeFolder, fixture.folder.FolderID, `{"map_parent_folder_id":null,"grid_x":0,"grid_y":0}`)
	parentBody := func(x int) string {
		encoded, _ := json.Marshal(map[string]any{"map_parent_folder_id": fixture.folder.FolderID, "grid_x": x, "grid_y": 2})
		return string(encoded)
	}
	putPlacement(domain.ProcessMapResourceTypeProcess, fixture.processA.LogicGateID, parentBody(0))
	putPlacement(domain.ProcessMapResourceTypeProcess, fixture.processB.LogicGateID, parentBody(4))

	relationshipBody, _ := json.Marshal(map[string]any{
		"company_id": fixture.companyID,
		"source":     map[string]any{"resource_type": domain.ProcessMapResourceTypeProcess, "resource_id": fixture.processA.LogicGateID},
		"target":     map[string]any{"resource_type": domain.ProcessMapResourceTypeProcess, "resource_id": fixture.processB.LogicGateID},
		"trace":      map[string]any{"route_points": []map[string]int{{"x": 2, "y": 2}}},
	})
	created := fixture.request(t, fixture.admin, http.MethodPost, "/v1/process-map/operational-relationships", string(relationshipBody), nil)
	if created.Code != http.StatusOK {
		t.Fatalf("POST relationship status=%d body=%s", created.Code, created.Body.String())
	}
	var relationshipWrite struct {
		Relationship domain.ResourceOperationalRelationship `json:"relationship"`
	}
	if err := json.NewDecoder(created.Body).Decode(&relationshipWrite); err != nil {
		t.Fatal(err)
	}

	noAccess := store.ResourceDefaultAccessNoAccess
	if _, _, err := fixture.repo.PutResourcePermissionPolicy(store.ResourcePermissionPolicyUpdateInput{
		CompanyID: fixture.companyID, ResourceType: store.EntityTypeLogicGate, ResourceID: fixture.processB.LogicGateID,
		PermissionMode: store.PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: store.PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatal(err)
	}
	layerPath := "/v1/process-map/layer?company_id=" + companyQuery + "&folder_id=" + url.QueryEscape(fixture.folder.FolderID)
	layer := fixture.request(t, fixture.viewer, http.MethodGet, layerPath, "", nil)
	if layer.Code != http.StatusOK {
		t.Fatalf("GET layer status=%d body=%s", layer.Code, layer.Body.String())
	}
	if strings.Contains(layer.Body.String(), fixture.processB.LogicGateID) || strings.Contains(layer.Body.String(), relationshipWrite.Relationship.ResourceOperationalRelationshipID) {
		t.Fatalf("restricted layer leaked hidden endpoint or trace: %s", layer.Body.String())
	}
	var layerWire struct {
		Placements []map[string]any `json:"placements"`
		Traces     []any            `json:"traces"`
	}
	if err := json.NewDecoder(bytes.NewReader(layer.Body.Bytes())).Decode(&layerWire); err != nil {
		t.Fatal(err)
	}
	if len(layerWire.Placements) != 2 || len(layerWire.Traces) != 0 {
		t.Fatalf("restricted layer = %+v", layerWire)
	}
	restrictedCount := 0
	for _, placement := range layerWire.Placements {
		if restricted, _ := placement["restricted"].(bool); restricted {
			restrictedCount++
			if len(placement) != 3 {
				t.Fatalf("restricted projection leaked fields: %+v", placement)
			}
		}
	}
	if restrictedCount != 1 {
		t.Fatalf("restricted placement count=%d, want 1", restrictedCount)
	}
	if layer.Header().Get("ETag") == "" {
		t.Fatal("layer response omitted ETag")
	}
	notModified := fixture.request(t, fixture.viewer, http.MethodGet, layerPath, "", map[string]string{"If-None-Match": layer.Header().Get("ETag")})
	if notModified.Code != http.StatusNotModified {
		t.Fatalf("authorized If-None-Match status=%d body=%s", notModified.Code, notModified.Body.String())
	}

	deniedMutation := fixture.request(t, fixture.viewer, http.MethodPut,
		"/v1/process-map/placements/"+domain.ProcessMapResourceTypeProcess+"/"+fixture.processB.LogicGateID+"?company_id="+companyQuery,
		parentBody(8), nil)
	if deniedMutation.Code != http.StatusNotFound {
		t.Fatalf("restricted placement mutation status=%d body=%s", deniedMutation.Code, deniedMutation.Body.String())
	}
	unknownField := fixture.request(t, fixture.admin, http.MethodPut,
		"/v1/process-map/placements/"+domain.ProcessMapResourceTypeFolder+"/"+fixture.folder.FolderID+"?company_id="+companyQuery,
		`{"map_parent_folder_id":null,"grid_x":1,"grid_y":1,"viewport":{}}`, nil)
	if unknownField.Code != http.StatusBadRequest {
		t.Fatalf("unknown placement field status=%d body=%s", unknownField.Code, unknownField.Body.String())
	}

	if _, _, err := fixture.repo.PutResourcePermissionPolicy(store.ResourcePermissionPolicyUpdateInput{
		CompanyID: fixture.companyID, ResourceType: store.EntityTypeCompanyExplorerFolder, ResourceID: fixture.folder.FolderID,
		PermissionMode: store.PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: store.PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatal(err)
	}
	deniedConditional := fixture.request(t, fixture.viewer, http.MethodGet, layerPath, "", map[string]string{"If-None-Match": layer.Header().Get("ETag")})
	if deniedConditional.Code != http.StatusNotFound {
		t.Fatalf("revoked Folder If-None-Match status=%d body=%s, want hidden 404 before 304", deniedConditional.Code, deniedConditional.Body.String())
	}

	deleted := fixture.request(t, fixture.admin, http.MethodDelete,
		"/v1/process-map/operational-relationships/"+relationshipWrite.Relationship.ResourceOperationalRelationshipID+"?company_id="+companyQuery, "", nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("DELETE relationship status=%d body=%s", deleted.Code, deleted.Body.String())
	}
	relationships := fixture.request(t, fixture.admin, http.MethodGet,
		"/v1/process-map/operational-relationships?company_id="+companyQuery+"&resource_type="+domain.ProcessMapResourceTypeProcess+"&resource_id="+fixture.processA.LogicGateID+"&direction=both", "", nil)
	if relationships.Code != http.StatusOK || !strings.Contains(relationships.Body.String(), `"resource_operational_relationships":[]`) {
		t.Fatalf("bounded relationship read after delete status=%d body=%s", relationships.Code, relationships.Body.String())
	}
}

func TestProcessMapHTTPReadsOnlyTheRequestedLayer(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	outerID := fixture.folder.FolderID
	inner, err := fixture.repo.CreateCompanyExplorerFolder(fixture.companyID, "", "logic_gate", "Inner")
	if err != nil {
		t.Fatal(err)
	}
	deep, err := fixture.repo.CreateLogicGate(fixture.companyID, "Deep")
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []store.ProcessMapPlacementPutInput{
		{CompanyID: fixture.companyID, ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: fixture.folder.FolderID, GridX: 0, GridY: 0, ActorUserID: fixture.admin.UserID, PermissionUserID: fixture.admin.UserID},
		{CompanyID: fixture.companyID, ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: inner.FolderID, MapParentFolderID: &outerID, GridX: 1, GridY: 1, ActorUserID: fixture.admin.UserID, PermissionUserID: fixture.admin.UserID},
		{CompanyID: fixture.companyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: deep.LogicGateID, MapParentFolderID: &inner.FolderID, GridX: 2, GridY: 2, ActorUserID: fixture.admin.UserID, PermissionUserID: fixture.admin.UserID},
	} {
		if _, err := fixture.repo.PutProcessMapPlacement(input); err != nil {
			t.Fatal(err)
		}
	}
	companyQuery := url.QueryEscape(fixture.companyID)
	root := fixture.request(t, fixture.admin, http.MethodGet, "/v1/process-map/layer?company_id="+companyQuery, "", nil)
	if root.Code != http.StatusOK || strings.Contains(root.Body.String(), inner.FolderID) || strings.Contains(root.Body.String(), deep.LogicGateID) {
		t.Fatalf("root layer included descendants: status=%d body=%s", root.Code, root.Body.String())
	}
	outer := fixture.request(t, fixture.admin, http.MethodGet,
		"/v1/process-map/layer?company_id="+companyQuery+"&folder_id="+url.QueryEscape(fixture.folder.FolderID), "", nil)
	if outer.Code != http.StatusOK || !strings.Contains(outer.Body.String(), inner.FolderID) || strings.Contains(outer.Body.String(), deep.LogicGateID) {
		t.Fatalf("outer layer was not exact: status=%d body=%s", outer.Code, outer.Body.String())
	}
}

func TestProcessMapETagSeparatesViewerAndResponseContract(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	server := NewServer(fixture.repo)
	request := httptest.NewRequest(http.MethodGet, "/same-path?company_id="+url.QueryEscape(fixture.companyID), nil)
	layerETag, err := server.processMapETag(request, fixture.companyID, fixture.viewer.UserID, domain.RoleCompanyUser, "process-map-layer-v1")
	if err != nil {
		t.Fatal(err)
	}
	relationshipETag, err := server.processMapETag(request, fixture.companyID, fixture.viewer.UserID, domain.RoleCompanyUser, "operational-relationships-v1")
	if err != nil {
		t.Fatal(err)
	}
	adminETag, err := server.processMapETag(request, fixture.companyID, fixture.admin.UserID, domain.RoleCompanyAdmin, "process-map-layer-v1")
	if err != nil {
		t.Fatal(err)
	}
	if layerETag == relationshipETag || layerETag == adminETag {
		t.Fatalf("viewer-safe response contracts reused ETag: layer=%s relationship=%s admin=%s", layerETag, relationshipETag, adminETag)
	}
}

func TestProcessMapHTTPRechecksCurrentCompanyMembershipBeforeConditionalRead(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	path := "/v1/process-map/layer?company_id=" + url.QueryEscape(fixture.companyID)
	first := fixture.request(t, fixture.viewer, http.MethodGet, path, "", nil)
	if first.Code != http.StatusOK || first.Header().Get("ETag") == "" {
		t.Fatalf("initial Process Map read status=%d etag=%q body=%s", first.Code, first.Header().Get("ETag"), first.Body.String())
	}
	if _, err := fixture.repo.DeleteCompanyUser(fixture.companyID, fixture.viewer.UserID, false); err != nil {
		t.Fatal(err)
	}
	staleActor := fixture.request(t, fixture.viewer, http.MethodGet, path, "", map[string]string{"If-None-Match": first.Header().Get("ETag")})
	if staleActor.Code != http.StatusForbidden || !strings.Contains(staleActor.Body.String(), "company_access_denied") {
		t.Fatalf("revoked membership conditional read status=%d body=%s, want company denial before 304", staleActor.Code, staleActor.Body.String())
	}
}
