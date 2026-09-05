package httpapi

import (
	"bytes"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestWorkspaceEntityBatchAuthoredProcessHTTP(t *testing.T) {
	for _, scenario := range []string{"saved and retry", "empty and retry", "malformed layout", "foreign rectangle", "hidden folder", "revoked folder"} {
		t.Run(scenario, func(t *testing.T) {
			repo := store.NewMemoryRepo()
			companyID := "66666666-6666-4666-8666-666666666491"
			repo.EnsureCompany(companyID, "Authoring HTTP")
			actor := mustLogicGateWorkHTTPUser(t, repo, companyID, "author")
			folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "folder", "Destination")
			if err != nil {
				t.Fatal(err)
			}
			gateID, stepID := "66666666-6666-4666-8666-666666666492", "66666666-6666-4666-8666-666666666493"
			rectangle := map[string]any{"process_step_id": stepID, "x": 80, "y": 90, "width": 200, "height": 100}
			definition := map[string]any{
				"logic_gate_id": gateID,
				"steps":         []map[string]any{{"process_step_id": stepID, "name": "Prepare"}},
				"relationships": []any{},
				"layout":        map[string]any{"steps": []any{rectangle}, "routes": []any{}},
			}
			if scenario == "empty and retry" {
				definition["steps"] = []any{}
				definition["layout"] = map[string]any{"steps": []any{}, "routes": []any{}}
			}
			if scenario == "malformed layout" {
				rectangle["width"] = -1
			}
			if scenario == "foreign rectangle" {
				rectangle["process_step_id"] = "66666666-6666-4666-8666-666666666494"
			}
			revoke := func() {
				if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: companyID, EntityType: store.EntityTypeCompanyExplorerFolder, EntityID: folder.FolderID, DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true}); err != nil {
					t.Fatal(err)
				}
			}
			var repository store.Repository = repo
			if scenario == "hidden folder" {
				revoke()
			}
			if scenario == "revoked folder" {
				repository = beforeWorkspaceBatchRepo{Repository: repo, before: revoke}
			}
			server := NewServer(repository)
			defer server.Close()
			body, _ := json.Marshal(map[string]any{"company_id": companyID, "entity_kind": "logic_gate", "folder_id": folder.FolderID, "mutation_origin": "company_explorer", "items": []map[string]any{{"client_id": "draft", "title": "Authored Process"}}, "process_definition": definition})
			send := func() *httptest.ResponseRecorder {
				req := requestWithActorForTest(httptest.NewRequest(http.MethodPost, "/v1/workspace/entity-batches", bytes.NewReader(body)), actor, companyID)
				rec := httptest.NewRecorder()
				server.Routes().ServeHTTP(rec, req)
				return rec
			}
			rec := send()
			wantStatus := http.StatusCreated
			if scenario == "malformed layout" || scenario == "foreign rectangle" {
				wantStatus = http.StatusBadRequest
			}
			if scenario == "hidden folder" || scenario == "revoked folder" {
				wantStatus = http.StatusNotFound
			}
			if rec.Code != wantStatus {
				t.Fatalf("save: %d %s, want %d", rec.Code, rec.Body, wantStatus)
			}
			if wantStatus == http.StatusCreated {
				var saved store.WorkspaceEntityBatchResult
				if err := json.Unmarshal(rec.Body.Bytes(), &saved); err != nil || len(saved.LogicGates) != 1 || saved.LogicGates[0].LogicGateID != gateID || saved.StepMap == nil || saved.StepMap.Revision <= 0 {
					t.Fatalf("save result: %+v %v", saved, err)
				}
				if rec := send(); rec.Code != http.StatusConflict {
					t.Fatalf("retry: %d %s", rec.Code, rec.Body)
				}
				work, err := repo.GetLogicGateWork(companyID, gateID, actor.UserID)
				if err != nil || len(work.Nodes) != 0 {
					t.Fatalf("authored save created runtime work: %+v %v", work, err)
				}
			}
			gates, err := repo.ListLogicGates(companyID)
			wantCount := 0
			if wantStatus == http.StatusCreated {
				wantCount = 1
			}
			if err != nil || len(gates) != wantCount {
				t.Fatalf("failed/repeated save leaked Process: %+v %v", gates, err)
			}
		})
	}
}

func TestWorkspaceEntityBatchAuthoredProcessHTTPConnectedSteps(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID, gateID := "66666666-6666-4666-8666-666666666500", "66666666-6666-4666-8666-666666666501"
	repo.EnsureCompany(companyID, "Connected authoring HTTP")
	actor := mustLogicGateWorkHTTPUser(t, repo, companyID, "author")
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "folder", "Orders")
	if err != nil {
		t.Fatal(err)
	}
	steps := []store.WorkspaceProcessDefinitionStep{
		{ProcessStepID: "66666666-6666-4666-8666-666666666502", Name: "Receive"},
		{ProcessStepID: "66666666-6666-4666-8666-666666666503", Name: "Check"},
		{ProcessStepID: "66666666-6666-4666-8666-666666666504", Name: "Approve"},
		{ProcessStepID: "66666666-6666-4666-8666-666666666505", Name: "Pack"},
		{ProcessStepID: "66666666-6666-4666-8666-666666666506", Name: "Ship"},
	}
	edgeIDs := []string{"66666666-6666-4666-8666-666666666511", "66666666-6666-4666-8666-666666666512", "66666666-6666-4666-8666-666666666513", "66666666-6666-4666-8666-666666666514"}
	edges := make([]store.WorkspaceProcessDefinitionRelationship, len(edgeIDs))
	for index, id := range edgeIDs {
		edges[index] = store.WorkspaceProcessDefinitionRelationship{ResourceOperationalRelationshipID: id, Source: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: steps[index].ProcessStepID}, Target: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: steps[index+1].ProcessStepID}}
	}
	layout := store.WorkspaceProcessDefinitionLayout{
		Steps: []domain.ProcessStepMapRectangle{
			{ProcessStepID: steps[0].ProcessStepID, X: -144, Y: -80, Width: 112, Height: 56},
			{ProcessStepID: steps[1].ProcessStepID, X: 64, Y: -80, Width: 112, Height: 56},
			{ProcessStepID: steps[2].ProcessStepID, X: 288, Y: 64, Width: 112, Height: 56},
			{ProcessStepID: steps[3].ProcessStepID, X: 480, Y: 192, Width: 128, Height: 64},
			{ProcessStepID: steps[4].ProcessStepID, X: 736, Y: 192, Width: 112, Height: 56},
		},
		Routes: []domain.ProcessStepMapRoute{{ResourceOperationalRelationshipID: edgeIDs[0], Points: []domain.ProcessMapRoutePoint{{X: -16, Y: -52}, {X: -16, Y: -160}, {X: 48, Y: -160}, {X: 48, Y: -52}}}},
	}
	body, err := json.Marshal(map[string]any{
		"company_id": companyID, "entity_kind": "logic_gate", "folder_id": folder.FolderID, "mutation_origin": "company_explorer",
		"items": []map[string]any{{"client_id": gateID, "title": "Five Step Process"}}, "relationships": []any{},
		"process_definition": store.WorkspaceProcessDefinitionInput{LogicGateID: gateID, Steps: steps, Relationships: edges, Layout: &layout},
	})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()
	send := func() *httptest.ResponseRecorder {
		req := requestWithActorForTest(httptest.NewRequest(http.MethodPost, "/v1/workspace/entity-batches", bytes.NewReader(body)), actor, companyID)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	rec := send()
	if rec.Code != http.StatusCreated {
		t.Fatalf("save five connected Steps: %d %s", rec.Code, rec.Body)
	}
	var saved store.WorkspaceEntityBatchResult
	if err := json.Unmarshal(rec.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if len(saved.LogicGates) != 1 || saved.LogicGates[0].LogicGateID != gateID || saved.LogicGates[0].Header != "Five Step Process" || len(saved.EntityMappings) != 1 || saved.EntityMappings[0] != (store.WorkspaceEntityBatchEntityMapping{ClientID: gateID, EntityID: gateID}) || len(saved.FolderItems) != 1 || saved.FolderItems[0].FolderID != folder.FolderID || saved.FolderItems[0].ItemID != gateID {
		t.Fatalf("save changed Process identity or destination: %+v", saved)
	}
	read := func(path string, result any) {
		t.Helper()
		req := requestWithActorForTest(httptest.NewRequest(http.MethodGet, path+"?company_id="+companyID, nil), actor, companyID)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("read %s: %d %s", path, rec.Code, rec.Body)
		}
		if err := json.Unmarshal(rec.Body.Bytes(), result); err != nil {
			t.Fatal(err)
		}
	}
	var work domain.LogicGateWorkView
	var reloaded domain.ProcessStepMapLayout
	read("/v2/logic-gates/"+gateID+"/work", &work)
	read("/v2/logic-gates/"+gateID+"/step-map", &reloaded)
	if len(work.Nodes) != 0 || len(work.Steps) != len(steps) || !reflect.DeepEqual(saved.ProcessSteps, work.Steps) {
		t.Fatalf("Step save/reload lost records or created runtime work: %+v", work)
	}
	for index, want := range steps {
		got := work.Steps[index]
		if got.CompanyID != companyID || got.LogicGateID != gateID || got.ProcessStepID != want.ProcessStepID || got.Name != want.Name || got.Position != (index+1)*1000 {
			t.Fatalf("Step %d identity, owner, name or order changed: %+v", index, got)
		}
	}
	wantEdges := make(map[string]store.WorkspaceProcessDefinitionRelationship, len(edges))
	for _, edge := range edges {
		wantEdges[edge.ResourceOperationalRelationshipID] = edge
	}
	for _, actual := range [][]domain.ResourceOperationalRelationship{saved.StepRelationships, work.Relationships} {
		if len(actual) != len(edges) {
			t.Fatalf("expected four directed edges: %+v", actual)
		}
		for _, got := range actual {
			want, ok := wantEdges[got.ResourceOperationalRelationshipID]
			if !ok || got.CompanyID != companyID || got.Source != want.Source || got.Target != want.Target {
				t.Fatalf("connection identity or endpoints changed: %+v", got)
			}
		}
	}
	if saved.StepMap == nil || reloaded.Revision <= 0 || !reflect.DeepEqual(reloaded, *saved.StepMap) || !reflect.DeepEqual(reloaded.Steps, layout.Steps) || !reflect.DeepEqual(reloaded.Routes, layout.Routes) {
		t.Fatalf("authored geometry or route changed: %+v", reloaded)
	}
	if rec := send(); rec.Code != http.StatusConflict {
		t.Fatalf("retry must reject the existing creation identities: %d %s", rec.Code, rec.Body)
	}
	var afterRetry domain.LogicGateWorkView
	var layoutAfterRetry domain.ProcessStepMapLayout
	read("/v2/logic-gates/"+gateID+"/work", &afterRetry)
	read("/v2/logic-gates/"+gateID+"/step-map", &layoutAfterRetry)
	if !reflect.DeepEqual(afterRetry, work) || !reflect.DeepEqual(layoutAfterRetry, reloaded) {
		t.Fatalf("retry changed saved definition or geometry: work=%+v layout=%+v", afterRetry, layoutAfterRetry)
	}
	gates, err := repo.ListLogicGates(companyID)
	if err != nil || len(gates) != 1 {
		t.Fatalf("retry created another Process: %+v %v", gates, err)
	}
}
