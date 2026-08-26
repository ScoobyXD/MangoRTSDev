package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	server    *Server
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
	server := NewServerWithOptions(repo, ServerOptions{EmailWorkerOnly: true, DisableRealtimeSpine: true})
	t.Cleanup(server.Close)
	return processMapHTTPFixture{repo: repo, server: server, handler: server.Routes(), companyID: companyID, admin: admin, viewer: viewer, folder: folder, processA: processA, processB: processB}
}

type processMapRealtimeConnectionCaptureRepo struct {
	store.Repository
	placementPutConnections       []string
	placementDeleteConnections    []string
	relationshipCreateConnections []string
	tracePutConnections           []string
	relationshipDeleteConnections []string
}

type processMapMembershipContextRepo struct {
	store.Repository
	sawContextError error
}

type processMapAccessContextRepo struct {
	store.Repository
	sawContextValue any
}

type processMapAccessContextKey struct{}

func (r *processMapMembershipContextRepo) ListUserMembershipsContext(ctx context.Context, userID string) ([]domain.CompanyMembership, error) {
	r.sawContextError = ctx.Err()
	return nil, ctx.Err()
}

func (r *processMapAccessContextRepo) UserHasEffectiveAccessContext(ctx context.Context, companyID, userID, resourceType, resourceID, accessLevel string) (bool, error) {
	r.sawContextValue = ctx.Value(processMapAccessContextKey{})
	return r.Repository.UserHasEffectiveAccessContext(ctx, companyID, userID, resourceType, resourceID, accessLevel)
}

func (r *processMapRealtimeConnectionCaptureRepo) PutProcessMapPlacement(ctx context.Context, input store.ProcessMapPlacementPutInput) (store.ProcessMapMutationEnvelope, error) {
	r.placementPutConnections = append(r.placementPutConnections, input.RealtimeConnectionID)
	return r.Repository.PutProcessMapPlacement(ctx, input)
}

func (r *processMapRealtimeConnectionCaptureRepo) DeleteProcessMapPlacement(ctx context.Context, input store.ProcessMapPlacementDeleteInput) (store.ProcessMapMutationEnvelope, error) {
	r.placementDeleteConnections = append(r.placementDeleteConnections, input.RealtimeConnectionID)
	return r.Repository.DeleteProcessMapPlacement(ctx, input)
}

func (r *processMapRealtimeConnectionCaptureRepo) CreateResourceOperationalRelationship(ctx context.Context, input store.ResourceOperationalRelationshipCreateInput) (store.ProcessMapMutationEnvelope, error) {
	r.relationshipCreateConnections = append(r.relationshipCreateConnections, input.RealtimeConnectionID)
	return r.Repository.CreateResourceOperationalRelationship(ctx, input)
}

func (r *processMapRealtimeConnectionCaptureRepo) PutProcessMapTrace(ctx context.Context, input store.ProcessMapTracePutInput) (store.ProcessMapMutationEnvelope, error) {
	r.tracePutConnections = append(r.tracePutConnections, input.RealtimeConnectionID)
	return r.Repository.PutProcessMapTrace(ctx, input)
}

func (r *processMapRealtimeConnectionCaptureRepo) DeleteResourceOperationalRelationship(ctx context.Context, input store.ResourceOperationalRelationshipDeleteInput) (store.ProcessMapMutationEnvelope, error) {
	r.relationshipDeleteConnections = append(r.relationshipDeleteConnections, input.RealtimeConnectionID)
	return r.Repository.DeleteResourceOperationalRelationship(ctx, input)
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

func (fixture processMapHTTPFixture) putPlacement(t *testing.T, actor domain.User, process domain.LogicGate, x, y, width, height int) map[string]any {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"map_parent_folder_id": nil, "grid_x": x, "grid_y": y, "grid_width": width, "grid_height": height,
	})
	response := fixture.request(t, actor, http.MethodPut,
		"/v1/process-map/placements/logic_gate/"+url.PathEscape(process.LogicGateID)+"?company_id="+url.QueryEscape(fixture.companyID), string(body), nil)
	if response.Code != http.StatusCreated {
		t.Fatalf("PUT placement status=%d body=%s", response.Code, response.Body.String())
	}
	var envelope map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	return envelope
}

func requireCommittedProcessMapEnvelope(t *testing.T, envelope map[string]any) {
	t.Helper()
	for _, field := range []string{"placements", "traces", "deleted_trace_ids", "process_map_read_version"} {
		if _, ok := envelope[field]; !ok {
			t.Fatalf("mutation envelope missing %q: %+v", field, envelope)
		}
	}
}

func TestProcessMapHTTPRelationshipAuthorizationPropagatesRequestContext(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	repo := &processMapAccessContextRepo{Repository: fixture.repo}
	server := NewServerWithOptions(repo, ServerOptions{EmailWorkerOnly: true, DisableRealtimeSpine: true})
	t.Cleanup(server.Close)

	ctx := context.WithValue(context.Background(), processMapAccessContextKey{}, "request-context")
	path := "/v1/process-map/operational-relationships?company_id=" + url.QueryEscape(fixture.companyID) +
		"&resource_type=logic_gate&resource_id=" + url.QueryEscape(fixture.processA.LogicGateID) + "&direction=both"
	request := httptest.NewRequest(http.MethodGet, path, nil).WithContext(ctx)
	request = requestWithActorForTest(request, fixture.admin, fixture.companyID)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("relationship GET status=%d body=%s", response.Code, response.Body.String())
	}
	if repo.sawContextValue != "request-context" {
		t.Fatalf("effective-access authorization context value = %v, want request context", repo.sawContextValue)
	}
}

func TestProcessMapHTTPSceneTilePrivacyETagAndCutover(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	fixture.putPlacement(t, fixture.admin, fixture.processA, 0, 0, 10, 8)
	fixture.putPlacement(t, fixture.admin, fixture.processB, 100, 20, 90, 70)
	relationshipBody, _ := json.Marshal(map[string]any{
		"company_id": fixture.companyID,
		"source":     map[string]any{"resource_type": domain.ProcessMapResourceTypeProcess, "resource_id": fixture.processA.LogicGateID},
		"target":     map[string]any{"resource_type": domain.ProcessMapResourceTypeProcess, "resource_id": fixture.processB.LogicGateID},
		"trace":      map[string]any{"route_points": []map[string]int{{"x": 50, "y": 4}}},
	})
	created := fixture.request(t, fixture.admin, http.MethodPost, "/v1/process-map/operational-relationships", string(relationshipBody), nil)
	if created.Code != http.StatusCreated {
		t.Fatalf("POST relationship status=%d body=%s", created.Code, created.Body.String())
	}
	var relationshipWrite store.ProcessMapMutationEnvelope
	if err := json.NewDecoder(created.Body).Decode(&relationshipWrite); err != nil {
		t.Fatal(err)
	}
	if relationshipWrite.Relationship == nil {
		t.Fatal("relationship envelope omitted relationship")
	}

	noAccess := store.ResourceDefaultAccessNoAccess
	if _, _, err := fixture.repo.PutResourcePermissionPolicy(store.ResourcePermissionPolicyUpdateInput{
		CompanyID: fixture.companyID, ResourceType: store.EntityTypeLogicGate, ResourceID: fixture.processB.LogicGateID,
		PermissionMode: store.PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: store.PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatal(err)
	}

	companyQuery := url.QueryEscape(fixture.companyID)
	scenePath := "/v1/process-map/scene?company_id=" + companyQuery
	scene := fixture.request(t, fixture.viewer, http.MethodGet, scenePath, "", nil)
	if scene.Code != http.StatusOK {
		t.Fatalf("GET scene status=%d body=%s", scene.Code, scene.Body.String())
	}
	var sceneWire domain.ProcessMapScene
	if err := json.Unmarshal(scene.Body.Bytes(), &sceneWire); err != nil {
		t.Fatal(err)
	}
	if sceneWire.Bounds == nil || *sceneWire.Bounds != (domain.ProcessMapBounds{MinX: 0, MinY: 0, MaxX: 104, MaxY: 23}) {
		t.Fatalf("permission-safe scene = %+v", sceneWire)
	}
	etag := scene.Header().Get("ETag")
	if etag == "" {
		t.Fatal("scene response omitted ETag")
	}
	if cached := fixture.request(t, fixture.viewer, http.MethodGet, scenePath, "", map[string]string{"If-None-Match": etag}); cached.Code != http.StatusNotModified || cached.Body.Len() != 0 {
		t.Fatalf("scene revalidation status=%d body=%s", cached.Code, cached.Body.String())
	}

	tile := fixture.request(t, fixture.viewer, http.MethodGet, "/v1/process-map/tiles/0/0/0?company_id="+companyQuery, "", nil)
	if tile.Code != http.StatusOK {
		t.Fatalf("GET tile status=%d body=%s", tile.Code, tile.Body.String())
	}
	if bytes.Contains(tile.Body.Bytes(), []byte(fixture.processB.LogicGateID)) || bytes.Contains(tile.Body.Bytes(), []byte(relationshipWrite.Relationship.ResourceOperationalRelationshipID)) {
		t.Fatalf("tile leaked hidden identity or trace: %s", tile.Body.String())
	}
	var tileWire struct {
		Placements []map[string]any `json:"placements"`
		Traces     []map[string]any `json:"traces"`
	}
	if err := json.Unmarshal(tile.Body.Bytes(), &tileWire); err != nil {
		t.Fatal(err)
	}
	if len(tileWire.Placements) != 2 || len(tileWire.Traces) != 0 {
		t.Fatalf("permission-safe tile = %+v", tileWire)
	}
	restricted := 0
	for _, placement := range tileWire.Placements {
		if value, _ := placement["restricted"].(bool); value {
			restricted++
			if len(placement) != 3 {
				t.Fatalf("restricted placeholder leaked fields: %+v", placement)
			}
		}
	}
	if restricted != 1 {
		t.Fatalf("restricted placeholders=%d, want 1", restricted)
	}
	if obsolete := fixture.request(t, fixture.admin, http.MethodGet, "/v1/process-map/layer?company_id="+companyQuery, "", nil); obsolete.Code != http.StatusNotFound {
		t.Fatalf("obsolete exact-layer route status=%d body=%s", obsolete.Code, obsolete.Body.String())
	}
}

func TestProcessMapHTTPAuthorizationPropagatesRequestCancellation(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	repo := &processMapMembershipContextRepo{Repository: fixture.repo}
	server := NewServerWithOptions(repo, ServerOptions{EmailWorkerOnly: true, DisableRealtimeSpine: true})
	t.Cleanup(server.Close)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest(http.MethodGet, "/v1/process-map/scene?company_id="+url.QueryEscape(fixture.companyID), nil).WithContext(ctx)
	request = requestWithActorForTest(request, fixture.admin, fixture.companyID)
	server.Routes().ServeHTTP(httptest.NewRecorder(), request)
	if !errors.Is(repo.sawContextError, context.Canceled) {
		t.Fatalf("membership lookup context error = %v, want context.Canceled", repo.sawContextError)
	}
}

func TestProcessMapHTTPRootPlacementDimensionsAndMutationEnvelopes(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	first := fixture.putPlacement(t, fixture.admin, fixture.processA, -20, -10, 12, 8)
	requireCommittedProcessMapEnvelope(t, first)
	placements, _ := first["placements"].([]any)
	if len(placements) != 1 {
		t.Fatalf("root Process envelope = %+v", first)
	}
	placement, _ := placements[0].(map[string]any)
	if placement["grid_width"] != float64(12) || placement["grid_height"] != float64(8) {
		t.Fatalf("saved dimensions = %+v", placement)
	}
	second := fixture.putPlacement(t, fixture.admin, fixture.processB, 20, -10, 14, 9)
	requireCommittedProcessMapEnvelope(t, second)

	bad := fixture.request(t, fixture.admin, http.MethodPut,
		"/v1/process-map/placements/logic_gate/"+fixture.processA.LogicGateID+"?company_id="+url.QueryEscape(fixture.companyID),
		`{"map_parent_folder_id":null,"grid_x":0,"grid_y":0,"grid_width":0,"grid_height":5}`, nil)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("zero dimension status=%d body=%s", bad.Code, bad.Body.String())
	}
	unknown := fixture.request(t, fixture.admin, http.MethodPut,
		"/v1/process-map/placements/logic_gate/"+fixture.processA.LogicGateID+"?company_id="+url.QueryEscape(fixture.companyID),
		`{"map_parent_folder_id":null,"grid_x":0,"grid_y":0,"grid_width":12,"grid_height":8,"compatibility":true}`, nil)
	if unknown.Code != http.StatusBadRequest {
		t.Fatalf("unknown placement field status=%d body=%s", unknown.Code, unknown.Body.String())
	}

	relationshipBody, _ := json.Marshal(map[string]any{
		"company_id": fixture.companyID,
		"source":     map[string]any{"resource_type": domain.ProcessMapResourceTypeProcess, "resource_id": fixture.processA.LogicGateID},
		"target":     map[string]any{"resource_type": domain.ProcessMapResourceTypeProcess, "resource_id": fixture.processB.LogicGateID},
		"trace":      map[string]any{"route_points": []map[string]int{{"x": 0, "y": -6}}},
	})
	created := fixture.request(t, fixture.admin, http.MethodPost, "/v1/process-map/operational-relationships", string(relationshipBody), nil)
	if created.Code != http.StatusCreated {
		t.Fatalf("relationship status=%d body=%s", created.Code, created.Body.String())
	}
	var envelope map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	requireCommittedProcessMapEnvelope(t, envelope)
	relationship, _ := envelope["relationship"].(map[string]any)
	relationshipID, _ := relationship["resource_operational_relationship_id"].(string)
	if relationshipID == "" || envelope["created"] != true || envelope["changed"] != true {
		t.Fatalf("relationship envelope = %+v", envelope)
	}

	trace := fixture.request(t, fixture.admin, http.MethodPut,
		"/v1/process-map/operational-relationships/"+url.PathEscape(relationshipID)+"/trace?company_id="+url.QueryEscape(fixture.companyID),
		`{"route_points":[{"x":0,"y":-6},{"x":10,"y":-6}]}`, nil)
	if trace.Code != http.StatusOK {
		t.Fatalf("trace status=%d body=%s", trace.Code, trace.Body.String())
	}
	if err := json.Unmarshal(trace.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	requireCommittedProcessMapEnvelope(t, envelope)
	if traces, _ := envelope["traces"].([]any); len(traces) != 1 {
		t.Fatalf("trace envelope = %+v", envelope)
	}
	placementDeleted := fixture.request(t, fixture.admin, http.MethodDelete,
		"/v1/process-map/placements/logic_gate/"+url.PathEscape(fixture.processA.LogicGateID)+"?company_id="+url.QueryEscape(fixture.companyID), "", nil)
	if placementDeleted.Code != http.StatusOK {
		t.Fatalf("placement delete status=%d body=%s", placementDeleted.Code, placementDeleted.Body.String())
	}
	if err := json.Unmarshal(placementDeleted.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	requireCommittedProcessMapEnvelope(t, envelope)
	deletedTraceIDs, _ := envelope["deleted_trace_ids"].([]any)
	if len(deletedTraceIDs) != 1 || deletedTraceIDs[0] != relationshipID {
		t.Fatalf("placement delete trace tombstones = %+v, want %s", deletedTraceIDs, relationshipID)
	}
	deleted := fixture.request(t, fixture.admin, http.MethodDelete,
		"/v1/process-map/operational-relationships/"+url.PathEscape(relationshipID)+"?company_id="+url.QueryEscape(fixture.companyID), "", nil)
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete status=%d body=%s", deleted.Code, deleted.Body.String())
	}
	if err := json.Unmarshal(deleted.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	requireCommittedProcessMapEnvelope(t, envelope)
}

func TestProcessMapHTTPPassesOnlyOwnedRealtimeConnectionToEveryMutation(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	ctx := context.Background()
	processC, err := fixture.repo.CreateLogicGate(fixture.companyID, "Archive")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		process domain.LogicGate
		x       int
	}{
		{fixture.processA, 0}, {fixture.processB, 30}, {processC, 60},
	} {
		if _, err := fixture.repo.PutProcessMapPlacement(ctx, store.ProcessMapPlacementPutInput{
			CompanyID: fixture.companyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: item.process.LogicGateID,
			GridX: item.x, GridY: 0, GridWidth: 12, GridHeight: 8,
			ActorUserID: fixture.admin.UserID, PermissionUserID: fixture.admin.UserID,
		}); err != nil {
			t.Fatal(err)
		}
	}
	capture := &processMapRealtimeConnectionCaptureRepo{Repository: fixture.repo}
	fixture.server.repo = capture
	ownedConnectionID := "owned-process-map-connection"
	foreignConnectionID := "other-users-process-map-connection"
	fixture.server.realtimeRegistry.addConnection(&realtimeConnection{id: ownedConnectionID, companyID: fixture.companyID, userID: fixture.admin.UserID})
	fixture.server.realtimeRegistry.addConnection(&realtimeConnection{id: foreignConnectionID, companyID: fixture.companyID, userID: fixture.viewer.UserID})
	companyQuery := url.QueryEscape(fixture.companyID)
	headers := map[string]string{processMapRealtimeConnectionIDHeader: ownedConnectionID}
	placementBody := `{"map_parent_folder_id":null,"grid_x":1,"grid_y":2,"grid_width":12,"grid_height":8}`
	placementPut := fixture.request(t, fixture.admin, http.MethodPut,
		"/v1/process-map/placements/logic_gate/"+fixture.processA.LogicGateID+"?company_id="+companyQuery, placementBody, headers)
	if placementPut.Code != http.StatusOK {
		t.Fatalf("placement PUT status=%d body=%s", placementPut.Code, placementPut.Body.String())
	}
	placementDelete := fixture.request(t, fixture.admin, http.MethodDelete,
		"/v1/process-map/placements/logic_gate/"+processC.LogicGateID+"?company_id="+companyQuery, "", headers)
	if placementDelete.Code != http.StatusOK {
		t.Fatalf("placement DELETE status=%d body=%s", placementDelete.Code, placementDelete.Body.String())
	}
	relationshipBody, _ := json.Marshal(map[string]any{
		"company_id": fixture.companyID,
		"source":     map[string]any{"resource_type": domain.ProcessMapResourceTypeProcess, "resource_id": fixture.processA.LogicGateID},
		"target":     map[string]any{"resource_type": domain.ProcessMapResourceTypeProcess, "resource_id": fixture.processB.LogicGateID},
	})
	created := fixture.request(t, fixture.admin, http.MethodPost, "/v1/process-map/operational-relationships", string(relationshipBody), headers)
	if created.Code != http.StatusCreated {
		t.Fatalf("relationship POST status=%d body=%s", created.Code, created.Body.String())
	}
	var envelope store.ProcessMapMutationEnvelope
	if err := json.NewDecoder(created.Body).Decode(&envelope); err != nil || envelope.Relationship == nil {
		t.Fatalf("relationship envelope=%+v err=%v", envelope, err)
	}
	relationshipPath := "/v1/process-map/operational-relationships/" + envelope.Relationship.ResourceOperationalRelationshipID
	tracePut := fixture.request(t, fixture.admin, http.MethodPut, relationshipPath+"/trace?company_id="+companyQuery,
		`{"route_points":[{"x":15,"y":4}]}`, headers)
	if tracePut.Code != http.StatusOK {
		t.Fatalf("trace PUT status=%d body=%s", tracePut.Code, tracePut.Body.String())
	}
	deleted := fixture.request(t, fixture.admin, http.MethodDelete, relationshipPath+"?company_id="+companyQuery, "", headers)
	if deleted.Code != http.StatusOK {
		t.Fatalf("relationship DELETE status=%d body=%s", deleted.Code, deleted.Body.String())
	}
	for name, got := range map[string][]string{
		"placement PUT": capture.placementPutConnections, "placement DELETE": capture.placementDeleteConnections,
		"relationship POST": capture.relationshipCreateConnections, "trace PUT": capture.tracePutConnections,
		"relationship DELETE": capture.relationshipDeleteConnections,
	} {
		if len(got) != 1 || got[0] != ownedConnectionID {
			t.Fatalf("%s realtime connections=%v, want [%s]", name, got, ownedConnectionID)
		}
	}
	spoofed := fixture.request(t, fixture.admin, http.MethodPut,
		"/v1/process-map/placements/logic_gate/"+fixture.processA.LogicGateID+"?company_id="+companyQuery,
		placementBody, map[string]string{processMapRealtimeConnectionIDHeader: foreignConnectionID})
	if spoofed.Code != http.StatusOK {
		t.Fatalf("spoofed optional connection status=%d body=%s", spoofed.Code, spoofed.Body.String())
	}
	if got := capture.placementPutConnections[len(capture.placementPutConnections)-1]; got != "" {
		t.Fatalf("foreign user's connection reached repository as %q", got)
	}
}

func TestProcessMapHTTPAcceptsSignedRealtimeConnectionCorrelationAcrossServers(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	const sharedSecret = "shared-process-map-realtime-secret"
	options := ServerOptions{EmailWorkerOnly: true, DisableRealtimeSpine: true, RealtimeTicketSecret: sharedSecret}
	issuer := NewServerWithOptions(fixture.repo, options)
	t.Cleanup(issuer.Close)
	receiver := NewServerWithOptions(fixture.repo, options)
	t.Cleanup(receiver.Close)
	wrongSecretServer := NewServerWithOptions(fixture.repo, ServerOptions{EmailWorkerOnly: true, DisableRealtimeSpine: true, RealtimeTicketSecret: "different-secret"})
	t.Cleanup(wrongSecretServer.Close)
	capture := &processMapRealtimeConnectionCaptureRepo{Repository: fixture.repo}
	receiver.repo = capture
	connectionID := "connection-on-another-api-task"
	issuer.realtimeRegistry.addConnection(&realtimeConnection{id: connectionID, companyID: fixture.companyID, userID: fixture.admin.UserID})
	correlation := issuer.realtimeTickets.mintRealtimeConnectionCorrelation(fixture.companyID, fixture.admin.UserID, connectionID)
	request := httptest.NewRequest(http.MethodPut,
		"/v1/process-map/placements/company_explorer_folder/"+fixture.folder.FolderID+"?company_id="+url.QueryEscape(fixture.companyID),
		strings.NewReader(`{"map_parent_folder_id":null,"grid_x":0,"grid_y":0,"grid_width":100,"grid_height":80}`))
	request = requestWithActorForTest(request, fixture.admin, fixture.companyID)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(processMapRealtimeConnectionIDHeader, correlation)
	response := httptest.NewRecorder()
	receiver.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("cross-server placement status=%d body=%s", response.Code, response.Body.String())
	}
	if got := capture.placementPutConnections; len(got) != 1 || got[0] != connectionID {
		t.Fatalf("cross-server mutation connections=%v", got)
	}
	wrongSecret := wrongSecretServer.realtimeTickets.mintRealtimeConnectionCorrelation(fixture.companyID, fixture.admin.UserID, connectionID)
	for name, probe := range map[string]struct{ token, companyID, userID string }{
		"wrong user":    {correlation, fixture.companyID, fixture.viewer.UserID},
		"wrong company": {correlation, "other-company", fixture.admin.UserID},
		"wrong secret":  {wrongSecret, fixture.companyID, fixture.admin.UserID},
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPut, "/", nil)
			request.Header.Set(processMapRealtimeConnectionIDHeader, probe.token)
			if got := receiver.processMapMutationRealtimeConnectionID(request, probe.companyID, probe.userID); got != "" {
				t.Fatalf("rejected correlation returned %q", got)
			}
		})
	}
}

func TestProcessMapETagSeparatesViewerAndResponseContract(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	request := httptest.NewRequest(http.MethodGet, "/same-path?company_id="+url.QueryEscape(fixture.companyID), nil)
	contracts := []struct{ userID, role, contract string }{
		{fixture.viewer.UserID, domain.RoleCompanyUser, "process-map-scene-v3"},
		{fixture.viewer.UserID, domain.RoleCompanyUser, processMapTileETagContract},
		{fixture.viewer.UserID, domain.RoleCompanyUser, "operational-relationships-v1"},
		{fixture.admin.UserID, domain.RoleCompanyAdmin, "process-map-scene-v3"},
	}
	seen := map[string]bool{}
	for _, item := range contracts {
		etag, err := fixture.server.processMapETag(request, fixture.companyID, item.userID, item.role, item.contract)
		if err != nil {
			t.Fatal(err)
		}
		if seen[etag] {
			t.Fatalf("viewer or response contract reused ETag %s", etag)
		}
		seen[etag] = true
	}
}

func TestProcessMapHTTPTileRejectsPreviousRepresentationETag(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	path := "/v1/process-map/tiles/22/0/0?company_id=" + url.QueryEscape(fixture.companyID)
	request := httptest.NewRequest(http.MethodGet, path, nil)
	legacyETag, err := fixture.server.processMapETag(request, fixture.companyID, fixture.viewer.UserID, domain.RoleCompanyUser, "process-map-tile-v3")
	if err != nil {
		t.Fatal(err)
	}

	fresh := fixture.request(t, fixture.viewer, http.MethodGet, path, "", map[string]string{"If-None-Match": legacyETag})
	if fresh.Code != http.StatusOK {
		t.Fatalf("legacy tile validator status=%d body=%s", fresh.Code, fresh.Body.String())
	}
	currentETag := fresh.Header().Get("ETag")
	if currentETag == "" || currentETag == legacyETag {
		t.Fatalf("current tile ETag=%q, legacy=%q", currentETag, legacyETag)
	}
	current := fixture.request(t, fixture.viewer, http.MethodGet, path, "", map[string]string{"If-None-Match": currentETag})
	if current.Code != http.StatusNotModified || current.Body.Len() != 0 {
		t.Fatalf("current tile validator status=%d body=%s", current.Code, current.Body.String())
	}
}

func TestProcessMapHTTPRechecksCurrentCompanyMembershipBeforeConditionalRead(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	path := "/v1/process-map/scene?company_id=" + url.QueryEscape(fixture.companyID)
	first := fixture.request(t, fixture.viewer, http.MethodGet, path, "", nil)
	if first.Code != http.StatusOK || first.Header().Get("ETag") == "" {
		t.Fatalf("initial read status=%d etag=%q body=%s", first.Code, first.Header().Get("ETag"), first.Body.String())
	}
	if _, err := fixture.repo.DeleteCompanyUser(fixture.companyID, fixture.viewer.UserID, false); err != nil {
		t.Fatal(err)
	}
	stale := fixture.request(t, fixture.viewer, http.MethodGet, path, "", map[string]string{"If-None-Match": first.Header().Get("ETag")})
	if stale.Code != http.StatusForbidden || !strings.Contains(stale.Body.String(), "company_access_denied") {
		t.Fatalf("revoked conditional read status=%d body=%s", stale.Code, stale.Body.String())
	}
}

func TestProcessMapTilePathIsStrict(t *testing.T) {
	for _, item := range []struct {
		path    string
		z, x, y int
		ok      bool
	}{
		{path: "/v1/process-map/tiles/0/0/0", ok: true},
		{path: "/v1/process-map/tiles/4/-2/7", z: 4, x: -2, y: 7, ok: true},
		{path: "/v1/process-map/tiles/4/2", ok: false},
		{path: "/v1/process-map/tiles/4/2/7/extra", ok: false},
		{path: "/v1/process-map/tiles/not-a-number/2/7", ok: false},
	} {
		z, x, y, ok := processMapTilePath(item.path)
		if z != item.z || x != item.x || y != item.y || ok != item.ok {
			t.Fatalf("processMapTilePath(%q) = %d/%d/%d/%t", item.path, z, x, y, ok)
		}
	}
}
