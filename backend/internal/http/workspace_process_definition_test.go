package httpapi

import (
	"bytes"
	"encoding/json"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
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
