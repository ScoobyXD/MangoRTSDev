package httpapi

import (
	"bytes"
	"encoding/json"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

type beforeWorkspaceBatchRepo struct {
	store.Repository
	before func()
}

func (r beforeWorkspaceBatchRepo) CreateWorkspaceEntityBatch(input store.WorkspaceEntityBatchInput) (store.WorkspaceEntityBatchResult, error) {
	r.before()
	return r.Repository.CreateWorkspaceEntityBatch(input)
}

func TestWorkspaceEntityBatchRequiresCurrentDestinationFolderAccess(t *testing.T) {
	for _, scenario := range []string{"allowed", "unauthenticated", "hidden", "revoked before transaction"} {
		t.Run(scenario, func(t *testing.T) {
			repo := store.NewMemoryRepo()
			companyID := "batch-destination-access"
			repo.EnsureCompany(companyID, "Batch destination")
			creator, err := repo.UpsertAuthUser("batch-destination-creator", "creator@example.com", "Creator")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repo.AddCompanyMembership("batch-destination-creator", companyID, "company_user"); err != nil {
				t.Fatal(err)
			}
			folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Destination")
			if err != nil {
				t.Fatal(err)
			}
			revoke := func() {
				if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
					CompanyID: companyID, EntityType: store.EntityTypeCompanyExplorerFolder, EntityID: folder.FolderID,
					DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
				}); err != nil {
					t.Fatal(err)
				}
			}
			var repository store.Repository = repo
			if scenario == "hidden" {
				revoke()
			}
			if scenario == "revoked before transaction" {
				repository = beforeWorkspaceBatchRepo{Repository: repo, before: revoke}
			}
			before, err := repo.ListLogicGates(companyID)
			if err != nil {
				t.Fatal(err)
			}
			body, _ := json.Marshal(map[string]any{
				"company_id": companyID, "entity_kind": "logic_gate", "folder_id": folder.FolderID,
				"items": []map[string]any{{"client_id": "new-process", "title": "New Process"}},
			})
			req := httptest.NewRequest(http.MethodPost, "/v1/workspace/entity-batches", bytes.NewReader(body))
			if scenario != "unauthenticated" {
				req = requestWithActorForTest(req, creator, companyID)
			}
			rec := httptest.NewRecorder()
			NewServer(repository).Routes().ServeHTTP(rec, req)
			after, err := repo.ListLogicGates(companyID)
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "allowed" {
				if rec.Code != http.StatusCreated || len(after) != len(before)+1 {
					t.Fatalf("allowed save: status=%d processes=%d body=%s", rec.Code, len(after), rec.Body.String())
				}
			} else {
				wantStatus := http.StatusNotFound
				if scenario == "unauthenticated" {
					wantStatus = http.StatusUnauthorized
				}
				if rec.Code != wantStatus || len(after) != len(before) {
					t.Fatalf("denied save must create nothing: status=%d before=%d after=%d body=%s", rec.Code, len(before), len(after), rec.Body.String())
				}
			}
		})
	}
}
