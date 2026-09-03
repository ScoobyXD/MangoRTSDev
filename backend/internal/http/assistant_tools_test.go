package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func assistantToolRequest(user domain.User, companyID, role string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/v1/assistant/chat?company_id="+companyID, nil)
	actor := ActorContext{User: user, CompanyID: companyID, CompanyRole: role,
		Memberships: []domain.CompanyMembership{{CompanyID: companyID, UserID: user.UserID, Role: role}}}
	return r.WithContext(context.WithValue(r.Context(), actorContextKey{}, actor))
}

func assistantTestArguments(t *testing.T, name string, args map[string]any) string {
	t.Helper()
	if args == nil {
		args = map[string]any{}
	}
	for _, tool := range assistantTools() {
		if tool.OfFunction.Name != name {
			continue
		}
		for key, raw := range tool.OfFunction.Parameters["properties"].(map[string]any) {
			if _, exists := args[key]; !exists {
				if _, nullable := raw.(map[string]any)["type"].([]string); nullable {
					args[key] = nil
				}
			}
		}
	}
	raw, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestAssistantToolsBrowserFreeProcessNodeTextboxFolderCRUD(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "01818181-8181-4181-8181-818181818181"
	repo.EnsureCompany(companyID, "Assistant CRUD")
	user := mustRealtimeAuthUser(t, repo, companyID, "assistant-admin", domain.RoleCompanyAdmin)
	server := newRealtimeAuthServerForTest(repo, "assistant-token", user)
	defer server.Close()
	request := assistantToolRequest(user, companyID, domain.RoleCompanyAdmin)
	call := func(name string, args map[string]any) map[string]any {
		t.Helper()
		output, err := server.dispatchAssistantTool(request, name, assistantTestArguments(t, name, args))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		var result map[string]any
		if err := json.Unmarshal([]byte(output), &result); err != nil {
			t.Fatalf("%s result: %v", name, err)
		}
		return result
	}
	process := call("create_process", map[string]any{"name": "First process"})
	processID := process["logic_gate_id"].(string)
	call("update_process", map[string]any{"process_id": processID, "name": "Renamed process"})
	call("get_process", map[string]any{"process_id": processID})
	listed := call("list_processes", nil)
	if len(listed["logic_gates"].([]any)) != 1 {
		t.Fatalf("unexpected process list: %v", listed)
	}
	node := call("create_node", map[string]any{"name": "First node"})
	nodeID := node["node_id"].(string)
	call("update_node", map[string]any{"node_id": nodeID, "name": "Renamed node", "due_date": "2026-09-04", "priority": 3})
	call("move_node_to_process", map[string]any{"node_id": nodeID, "process_id": processID, "status": "in_progress"})
	work := call("get_process_nodes", map[string]any{"process_id": processID})
	encoded, _ := json.Marshal(work)
	if !strings.Contains(string(encoded), nodeID) {
		t.Fatalf("assigned node missing from process: %s", encoded)
	}
	second := call("create_process", map[string]any{"name": "Second process"})
	secondID := second["logic_gate_id"].(string)
	if _, err := repo.SetLogicGateNodeAssignmentIssue(store.LogicGateNodeAssignmentIssueInput{CompanyID: companyID, LogicGateID: processID, NodeID: nodeID, IsIssue: true}); err != nil {
		t.Fatal(err)
	}
	step, err := repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: companyID, LogicGateID: processID, Name: "Prepare", ActorUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: processID, NodeID: nodeID, ProcessStepID: &step.Step.ProcessStepID, ProcessStepIDSet: true, ActorUserID: user.UserID}); err != nil {
		t.Fatal(err)
	}
	beforeMove, err := repo.GetNode(companyID, nodeID)
	if err != nil || beforeMove.Status == nil {
		t.Fatalf("initial Node: %+v, %v", beforeMove, err)
	}
	call("move_node_to_process", map[string]any{"node_id": nodeID, "process_id": secondID})
	assignments, err := repo.ListNodeLogicGateAssignments(companyID, nodeID)
	if err != nil || len(assignments) != 1 || assignments[0].LogicGateID != secondID || !assignments[0].IsIssue || assignments[0].ProcessStepID != nil {
		t.Fatalf("move lost the canonical assignment's state: %+v, %v", assignments, err)
	}
	afterMove, err := repo.GetNode(companyID, nodeID)
	if err != nil || afterMove.Status == nil || *afterMove.Status != *beforeMove.Status {
		t.Fatalf("move changed the Node's status: %+v, %v", afterMove, err)
	}
	if _, err := server.dispatchAssistantTool(request, "move_node_to_process", assistantTestArguments(t, "move_node_to_process", map[string]any{"node_id": nodeID, "process_id": processID, "from_process_id": secondID})); err == nil {
		t.Fatal("obsolete model-selected source hint was accepted")
	}
	call("get_node", map[string]any{"node_id": nodeID})

	for _, owner := range []struct{ kind, id string }{{"node", nodeID}, {"logic_gate", processID}} {
		created := call("save_textbox", map[string]any{"resource_type": owner.kind, "resource_id": owner.id, "base_revision": 0, "plain_text": "Complete first line\nComplete second line"})
		textboxID := created["textbox_id"].(string)
		if owner.kind == "node" {
			// Seed the same display metadata as a textbox already created in the
			// app. MemoryRepo keeps that metadata separate from editor content.
			if _, err := repo.UpdateEditorJSONMetadata(store.EditorJSONMetadataInput{Document: store.EditorDocumentRef{CompanyID: companyID, ResourceType: owner.kind, ResourceID: owner.id, DocumentID: textboxID}, Title: "Existing textbox"}); err != nil {
				t.Fatal(err)
			}
			details := call("get_node", map[string]any{"node_id": nodeID})
			encoded, _ := json.Marshal(details)
			if !strings.Contains(string(encoded), textboxID) {
				t.Fatalf("get_node omitted an existing textbox ID: %s", encoded)
			}
		}
		read := call("get_textbox", map[string]any{"resource_type": owner.kind, "resource_id": owner.id, "textbox_id": textboxID})
		if read["revision"] != float64(1) {
			t.Fatalf("textbox revision: %v", read)
		}
		call("save_textbox", map[string]any{"resource_type": owner.kind, "resource_id": owner.id, "textbox_id": textboxID, "base_revision": 1, "plain_text": "Replaced completely"})
		_, staleErr := server.dispatchAssistantTool(request, "save_textbox", assistantTestArguments(t, "save_textbox", map[string]any{"resource_type": owner.kind, "resource_id": owner.id, "textbox_id": textboxID, "base_revision": 1, "plain_text": "Stale replacement"}))
		if staleErr == nil {
			t.Fatal("MemoryRepo's existing stale revision guard was bypassed")
		}
		read = call("get_textbox", map[string]any{"resource_type": owner.kind, "resource_id": owner.id, "textbox_id": textboxID})
		encoded, _ := json.Marshal(read)
		if read["revision"] != float64(2) || !strings.Contains(string(encoded), "Replaced completely") || strings.Contains(string(encoded), "Complete first line") {
			t.Fatalf("replacement not saved atomically: %s", encoded)
		}
		call("delete_textbox", map[string]any{"resource_type": owner.kind, "resource_id": owner.id, "textbox_id": textboxID, "base_revision": 2})
	}
	folder := call("create_folder", map[string]any{"name": "First folder"})
	folderID := folder["entity_id"].(string)
	parent := call("create_folder", map[string]any{"name": "Parent folder"})
	parentID := parent["entity_id"].(string)
	call("rename_folder", map[string]any{"folder_id": folderID, "name": "Renamed folder"})
	call("move_folder", map[string]any{"folder_id": folderID, "parent_folder_id": parentID})
	call("list_explorer", map[string]any{"parent_folder_id": parentID})
	call("list_explorer", map[string]any{"query": "Renamed"})
	call("move_folder", map[string]any{"folder_id": folderID})
	call("get_me", nil)
	call("delete_folder", map[string]any{"folder_id": folderID, "confirmation_display_name": user.DisplayName})
	call("delete_node", map[string]any{"node_id": nodeID, "confirmation_display_name": user.DisplayName})
	call("delete_process", map[string]any{"process_id": processID, "confirmation_display_name": user.DisplayName})
	if _, err := repo.GetNodeDetails(companyID, nodeID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("node not deleted: %v", err)
	}
}

func TestAssistantToolsRejectScopeInjectionAndRecheckPermissions(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID, otherCompanyID := "02818181-8181-4181-8181-818181818181", "03818181-8181-4181-8181-818181818181"
	repo.EnsureCompany(companyID, "Selected")
	repo.EnsureCompany(otherCompanyID, "Other")
	admin := mustRealtimeAuthUser(t, repo, companyID, "assistant-scope-admin", domain.RoleCompanyAdmin)
	member := mustRealtimeAuthUser(t, repo, companyID, "assistant-scope-member", domain.RoleCompanyUser)
	server := newRealtimeAuthServerForTest(repo, "assistant-token", admin)
	defer server.Close()
	privateNode, _ := repo.CreateNode(companyID, "Private")
	otherNode, _ := repo.CreateNode(otherCompanyID, "Other company")
	_, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: companyID, EntityType: store.EntityTypeNode, EntityID: privateNode.NodeID, DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true, ActorUserID: admin.UserID})
	if err != nil {
		t.Fatal(err)
	}
	request := assistantToolRequest(member, companyID, domain.RoleCompanyAdmin) // deliberately stale role
	staleActor, _ := authenticatedActor(request)
	staleActor.IsDevAdmin = true
	request = request.WithContext(context.WithValue(request.Context(), actorContextKey{}, staleActor))
	for _, test := range []struct{ name, args string }{
		{"create_node", `{"name":"Injected","company_id":"` + otherCompanyID + `"}`},
		{"create_node", `{"name":"Injected","user_id":"` + admin.UserID + `"}`},
		{"create_node", `{"name":"Injected","url":"https://example.invalid"}`},
		{"create_node", `{"name":42}`},
		{"get_node", `{"node_id":"../me"}`},
		{"get_node", `{"node_id":"` + privateNode.NodeID + `"}`},
		{"get_node", `{"node_id":"` + otherNode.NodeID + `"}`},
		{"update_node", assistantTestArguments(t, "update_node", map[string]any{"node_id": privateNode.NodeID, "name": "Unauthorized"})},
		{"save_textbox", assistantTestArguments(t, "save_textbox", map[string]any{"resource_type": "node", "resource_id": privateNode.NodeID, "textbox_id": "../other", "base_revision": 0, "plain_text": "bad"})},
		{"execute_code", `{}`},
	} {
		if _, err := server.dispatchAssistantTool(request, test.name, test.args); err == nil {
			t.Fatalf("accepted invalid/unauthorized %s: %s", test.name, test.args)
		}
	}
	if _, err := server.dispatchAssistantTool(httptest.NewRequest(http.MethodPost, "/", nil), "get_me", `{}`); err == nil {
		t.Fatal("unauthenticated dispatch accepted")
	}
	adminRequest := assistantToolRequest(admin, companyID, domain.RoleCompanyAdmin)
	if _, err := server.dispatchAssistantTool(adminRequest, "delete_node", assistantTestArguments(t, "delete_node", map[string]any{"node_id": privateNode.NodeID, "confirmation_display_name": "wrong name"})); err == nil {
		t.Fatal("deletion skipped display-name confirmation")
	}
	cancelled, cancel := context.WithCancel(adminRequest.Context())
	cancel()
	if _, err := server.dispatchAssistantTool(adminRequest.WithContext(cancelled), "create_node", `{"name":"Cancelled creation"}`); err == nil {
		t.Fatal("cancelled request dispatched")
	}
	nodes, _ := repo.ListNodes(companyID)
	if len(nodes) != 1 || nodes[0].Title != "Private" {
		t.Fatalf("denied calls changed resources: %v", nodes)
	}
}

type assistantUncertainNodeRepo struct {
	store.Repository
	calls  int
	cancel context.CancelFunc
}

func (repo *assistantUncertainNodeRepo) CreateNodeWithWorkspaceEvent(companyID, name string) (domain.Node, domain.DomainEvent, error) {
	repo.calls++
	node, event, err := repo.Repository.CreateNodeWithWorkspaceEvent(companyID, name)
	if err != nil {
		return node, event, err
	}
	if repo.cancel != nil {
		repo.cancel()
		return node, event, nil
	}
	return node, event, errors.New("sensitive database/provider diagnostic")
}

func TestAssistantToolsNeverRepeatAnUncertainCommittedWrite(t *testing.T) {
	for _, cancelled := range []bool{false, true} {
		t.Run(map[bool]string{false: "failed response after commit", true: "cancelled after commit"}[cancelled], func(t *testing.T) {
			memory := store.NewMemoryRepo()
			companyID := "05818181-8181-4181-8181-818181818181"
			memory.EnsureCompany(companyID, "Uncertain writes")
			user := mustRealtimeAuthUser(t, memory, companyID, "uncertain-tool-admin", domain.RoleCompanyAdmin)
			repo := &assistantUncertainNodeRepo{Repository: memory}
			server := NewServerWithOptions(repo, explicitLocalRealtimeTestOptions(ServerOptions{}))
			defer server.Close()
			request := assistantToolRequest(user, companyID, domain.RoleCompanyAdmin)
			if cancelled {
				ctx, cancel := context.WithCancel(request.Context())
				defer cancel()
				request = request.WithContext(ctx)
				repo.cancel = cancel
			}
			_, err := server.dispatchAssistantTool(request, "create_node", `{"name":"Only once"}`)
			if err == nil || strings.Contains(err.Error(), "sensitive") || repo.calls != 1 {
				t.Fatalf("uncertain write calls=%d error=%v", repo.calls, err)
			}
			nodes, _ := memory.ListNodes(companyID)
			if len(nodes) != 1 || nodes[0].Title != "Only once" {
				t.Fatalf("committed result changed by cancellation/retry: %v", nodes)
			}
		})
	}
}

func TestAssistantToolsAttachmentLifecycleVerifiesBytesAndPinsCompany(t *testing.T) {
	fixture := newAttachmentDirectUploadTestFixture(t)
	request := assistantToolRequest(fixture.allowed, fixture.companyID, domain.RoleCompanyUser)
	call := func(name string, args map[string]any) string {
		t.Helper()
		output, err := fixture.server.dispatchAssistantTool(request, name, assistantTestArguments(t, name, args))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		return output
	}
	createArgs := map[string]any{"resource_type": "node", "resource_id": fixture.node.NodeID, "filename": "actual.txt", "size_bytes": 5, "sha256": directUploadTestSHA256Hex("bytes"), "content_type": "text/plain"}
	var prepared attachmentUploadIntentResponse
	if err := json.Unmarshal([]byte(call("create_attachment_upload", createArgs)), &prepared); err != nil {
		t.Fatal(err)
	}
	attachments, _ := fixture.repo.ListResourceAttachments(fixture.companyID, "node", fixture.node.NodeID)
	if len(attachments) != 0 {
		t.Fatal("preparation falsely created a completed attachment")
	}
	call("get_attachment_upload", map[string]any{"upload_intent_id": prepared.UploadIntentID})
	if _, err := fixture.server.dispatchAssistantTool(request, "complete_attachment_upload", assistantTestArguments(t, "complete_attachment_upload", map[string]any{"upload_intent_id": prepared.UploadIntentID})); err == nil {
		t.Fatal("completion without file bytes succeeded")
	}
	if len(fixture.storage.headInputs) != 1 {
		t.Fatalf("failed completion retried verification: %d", len(fixture.storage.headInputs))
	}
	// Another intent represents a client that has completed the real byte PUT.
	if err := json.Unmarshal([]byte(call("create_attachment_upload", createArgs)), &prepared); err != nil {
		t.Fatal(err)
	}
	intent, err := fixture.repo.GetAttachmentUploadIntent(fixture.companyID, fixture.allowed.UserID, prepared.UploadIntentID)
	if err != nil {
		t.Fatal(err)
	}
	fixture.storage.setHead(intent.StorageKey, AttachmentHeadObjectOutput{ContentLength: 5, ChecksumAlgorithm: "SHA256", ChecksumValue: directUploadTestChecksumBase64("bytes"), ChecksumType: "FULL_OBJECT", ServerSideEncryption: attachmentSSEValue()})
	call("complete_attachment_upload", map[string]any{"upload_intent_id": prepared.UploadIntentID})
	listed := call("list_attachments", map[string]any{"resource_type": "node", "resource_id": fixture.node.NodeID})
	if !strings.Contains(listed, prepared.AttachmentID) {
		t.Fatalf("verified attachment missing: %s", listed)
	}
	call("link_attachment", map[string]any{"resource_type": "node", "resource_id": fixture.node.NodeID, "attachment_id": prepared.AttachmentID})
	otherID := "04818181-8181-4181-8181-818181818181"
	fixture.repo.EnsureCompany(otherID, "Other selected company")
	if _, err := fixture.repo.AddCompanyMembership(fixture.allowed.CognitoSubject, otherID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	otherRequest := assistantToolRequest(fixture.allowed, otherID, domain.RoleCompanyUser)
	actor, _ := authenticatedActor(otherRequest)
	actor.Memberships = append(actor.Memberships, domain.CompanyMembership{CompanyID: fixture.companyID, UserID: fixture.allowed.UserID, Role: domain.RoleCompanyUser})
	otherRequest = otherRequest.WithContext(context.WithValue(otherRequest.Context(), actorContextKey{}, actor))
	for _, name := range []string{"get_attachment_upload", "complete_attachment_upload"} {
		if _, err := fixture.server.dispatchAssistantTool(otherRequest, name, assistantTestArguments(t, name, map[string]any{"upload_intent_id": prepared.UploadIntentID})); err == nil {
			t.Fatalf("%s crossed selected company through secondary membership", name)
		}
	}
}

func TestAssistantToolsCatalogAndResponseBound(t *testing.T) {
	tools := assistantTools()
	if len(tools) != 25 {
		t.Fatalf("tool count=%d", len(tools))
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		fn := tool.OfFunction
		if seen[fn.Name] || !fn.Strict.Value || fn.Parameters["additionalProperties"] != false {
			t.Fatalf("invalid tool definition %s", fn.Name)
		}
		seen[fn.Name] = true
	}
	result := &assistantToolResponse{header: make(http.Header)}
	_, _ = result.Write([]byte(strings.Repeat("a", assistantToolResultLimit+1)))
	_, _ = result.Write([]byte("more"))
	if !result.overflow || result.body.Len() != assistantToolResultLimit {
		t.Fatalf("unbounded captured response: %d", result.body.Len())
	}
}
