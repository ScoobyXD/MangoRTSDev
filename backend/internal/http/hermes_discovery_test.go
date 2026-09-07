package httpapi

import (
	"encoding/json"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestMangoSearchUsesCanonicalMatchesAndVisiblePaths(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit: %d %s", w.Code, w.Body)
	}
	folder, err := f.repo.CreateCompanyExplorerV2Folder(store.CompanyExplorerV2FolderInput{CompanyID: f.route.CompanyID, ParentEntityID: f.route.CompanyID, Name: "Finance"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.repo.UpsertCompanyExplorerV2Edge(store.CompanyExplorerV2EdgeInput{CompanyID: f.route.CompanyID, ParentEntityID: folder.EntityID, ChildEntityType: "logic_gate", ChildResourceID: f.gateID, ActorUserID: f.user.UserID, PermissionUserID: f.user.UserID}); err != nil {
		t.Fatal(err)
	}
	other, err := f.repo.CreateLogicGate(f.route.CompanyID, "Invoices")
	if err != nil {
		t.Fatal(err)
	}
	search := func(query string, types []string) store.CompanyExplorerSearchResults {
		t.Helper()
		w := mangoToolRequest(t, f, "mango_search", map[string]any{"query": query, "resource_types": types})
		var result store.CompanyExplorerSearchResults
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
			t.Fatalf("search: %d %s", w.Code, w.Body)
		}
		return result
	}
	result := search("VoIc", []string{"logic_gate"})
	if len(result.Results) != 2 {
		t.Fatalf("partial name must retain ambiguous matches: %+v", result)
	}
	for _, match := range result.Results {
		if match.ResourceType != "logic_gate" || (match.ResourceID != f.gateID && match.ResourceID != other.LogicGateID) {
			t.Fatalf("canonical identity lost: %+v", match)
		}
		if match.ResourceID == f.gateID {
			path, _ := json.Marshal(match.LocationPath)
			if !strings.Contains(string(path), "Finance") || !strings.Contains(string(path), folder.EntityID) {
				t.Fatalf("visible location missing: %s", path)
			}
		}
	}
	folders := search("fin", []string{"folder"})
	if len(folders.Results) != 1 || folders.Results[0].ResourceID != folder.EntityID {
		t.Fatalf("folder discovery: %+v", folders)
	}
	if _, err := f.repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: f.route.CompanyID, EntityType: store.EntityTypeLogicGate, EntityID: other.LogicGateID, DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true, ActorUserID: f.user.UserID}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.repo.AddCompanyMembership(f.user.CognitoSubject, f.route.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	visible := search("invoice", []string{"logic_gate"})
	if len(visible.Results) != 1 || visible.Results[0].ResourceID != f.gateID {
		t.Fatalf("search exposed denied Process: %+v", visible)
	}
	if hidden := search(other.LogicGateID, []string{"logic_gate"}); len(hidden.Results) != 0 {
		t.Fatalf("ID search exposed denied Process: %+v", hidden)
	}
}

func TestMangoDiscoveryAndProcessWorkflow(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit: %d %s", w.Code, w.Body)
	}
	create := map[string]any{"name": "Supplier onboarding"}
	w := mangoToolRequest(t, f, "mango_create_process", create)
	var process domain.LogicGate
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &process) != nil || process.LogicGateID == "" {
		t.Fatalf("create Process: %d %s", w.Code, w.Body)
	}
	if retry := mangoToolRequest(t, f, "mango_create_process", create); retry.Code != 200 || retry.Body.String() != w.Body.String() {
		t.Fatalf("creation replay: %d %s", retry.Code, retry.Body)
	}
	rename := mangoToolRequest(t, f, "mango_update_process", map[string]any{"logic_gate_id": strings.ToUpper(process.LogicGateID), "name": "Vendor onboarding"})
	if rename.Code != 200 || !strings.Contains(rename.Body.String(), "Vendor onboarding") {
		t.Fatalf("rename: %d %s", rename.Code, rename.Body)
	}
	stepArgs := map[string]any{"logic_gate_id": process.LogicGateID, "name": "Collect documents"}
	w = mangoToolRequest(t, f, "mango_create_step", stepArgs)
	var first store.ProcessStepMutationResult
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &first) != nil || first.Step.ProcessStepID == "" {
		t.Fatalf("create Step: %d %s", w.Code, w.Body)
	}
	if retry := mangoToolRequest(t, f, "mango_create_step", stepArgs); retry.Code != 200 || retry.Body.String() != w.Body.String() {
		t.Fatalf("Step replay: %d %s", retry.Code, retry.Body)
	}
	node := mangoToolRequest(t, f, "mango_create_node", map[string]any{"logic_gate_id": process.LogicGateID, "process_step_id": first.Step.ProcessStepID, "title": "Acme vendor"})
	if node.Code != 200 {
		t.Fatalf("create Node in new Process: %d %s", node.Code, node.Body)
	}
	next := mangoToolRequest(t, f, "mango_create_step", map[string]any{"logic_gate_id": process.LogicGateID, "name": "Approve vendor", "after_process_step_id": first.Step.ProcessStepID})
	if next.Code != 200 || !strings.Contains(next.Body.String(), first.Step.ProcessStepID) {
		t.Fatalf("connected next Step: %d %s", next.Code, next.Body)
	}
	folder, err := f.repo.CreateCompanyExplorerV2Folder(store.CompanyExplorerV2FolderInput{CompanyID: f.route.CompanyID, ParentEntityID: f.route.CompanyID, Name: "Procurement"})
	if err != nil {
		t.Fatal(err)
	}
	moved := mangoToolRequest(t, f, "mango_move_process", map[string]any{"logic_gate_id": process.LogicGateID, "folder_id": folder.EntityID})
	if moved.Code != 200 {
		t.Fatalf("folder placement: %d %s", moved.Code, moved.Body)
	}
	discovered := mangoToolRequest(t, f, "mango_search", map[string]any{"query": "vendor", "resource_types": []string{"logic_gate"}})
	if discovered.Code != 200 || !strings.Contains(discovered.Body.String(), process.LogicGateID) || !strings.Contains(discovered.Body.String(), "Procurement") {
		t.Fatalf("discover renamed/moved Process: %d %s", discovered.Code, discovered.Body)
	}
	ref := map[string]any{"resource_type": "logic_gate", "resource_id": process.LogicGateID, "document_id": "logic-gate-overview"}
	w = mangoToolRequest(t, f, "mango_get_editor", ref)
	var snapshot store.EditorJSONSnapshot
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &snapshot) != nil {
		t.Fatalf("Process editor: %d %s", w.Code, w.Body)
	}
	ref["base_revision"], ref["annotations"] = snapshot.Revision, []any{}
	ref["document"] = json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Check vendor documents."}]}]}}`)
	if written := mangoToolRequest(t, f, "mango_update_editor", ref); written.Code != 200 {
		t.Fatalf("write Process editor: %d %s", written.Code, written.Body)
	}
}

func TestMangoNewToolsRejectInvalidArguments(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit: %d %s", w.Code, w.Body)
	}
	for _, test := range []struct {
		action string
		args   map[string]any
	}{
		{"mango_search", map[string]any{"query": " "}},
		{"mango_search", map[string]any{"query": "invoice", "limit": 101}},
		{"mango_search", map[string]any{"query": "invoice", "resource_types": []string{"process"}}},
		{"mango_search", map[string]any{"query": "invoice", "company_id": f.route.CompanyID}},
		{"mango_create_process", map[string]any{"name": " "}},
		{"mango_create_process", map[string]any{"name": "New", "user_id": f.user.UserID}},
		{"mango_create_step", map[string]any{"logic_gate_id": f.gateID, "name": "Next", "after_process_step_id": "Review"}},
		{"mango_update_process", map[string]any{"logic_gate_id": "Invoices", "name": "New"}},
		{"mango_move_process", map[string]any{"logic_gate_id": f.gateID}},
		{"mango_move_process", map[string]any{"logic_gate_id": f.gateID, "folder_id": ""}},
	} {
		if w := mangoToolRequest(t, f, test.action, test.args); w.Code != 400 {
			t.Errorf("%s invalid input accepted: %d %s", test.action, w.Code, w.Body)
		}
	}
}
