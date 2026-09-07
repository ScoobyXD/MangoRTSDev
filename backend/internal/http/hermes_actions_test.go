package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func mangoToolRequest(t *testing.T, f *aiFixture, action string, args any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"run_id": "run_test", "session_id": aiTestRunID, "tool_call_id": "call_" + action, "action": action, "arguments": args})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/internal/hermes/actions", bytes.NewReader(raw))
	r.Header.Set("Authorization", "Bearer "+f.route.CallbackKey)
	w := httptest.NewRecorder()
	f.s.Routes().ServeHTTP(w, r)
	return w
}

func TestMangoToolsUseCurrentActorMailboxAccess(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit: %d %s", w.Code, w.Body)
	}
	node, err := f.repo.CreateNode(f.route.CompanyID, "Work with attached email")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.repo.AddNodeInformation(f.route.CompanyID, node.NodeID, "Text box", "Keep work", store.NewUUIDv7String()); err != nil {
		t.Fatal(err)
	}
	thread, err := f.repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: f.route.CompanyID, PersonalUserID: f.user.UserID, PersonalAccountEmail: f.user.Email,
		AccountEmail: f.user.Email, Provider: "google", ProviderThreadID: "actor-thread", SelectedMessageID: "actor-message",
		Messages: []domain.EmailMessageSnapshot{{ID: "actor-message", ThreadID: "actor-thread", Subject: "Permitted email"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]string{"email_message_id": thread.Messages[0].EmailMessageID, "link_scope": "message"})
	if _, err := f.repo.AddNodeInformationWithActor(store.NodeInformationInput{
		CompanyID: f.route.CompanyID, NodeID: node.NodeID, Type: "Attached email", Information: string(payload),
		InformationID: store.NewUUIDv7String(), ActorUserID: f.user.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	for _, enabled := range []bool{true, false} {
		f.s.repo = f.repo
		if enabled {
			f.s.repo = legacyMailboxTestRepository{Repository: f.repo}
		}
		w := mangoToolRequest(t, f, "mango_get_node", map[string]any{"node_id": node.NodeID})
		var details domain.NodeDetails
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &details) != nil {
			t.Fatalf("mailbox enabled=%t: %d %s", enabled, w.Code, w.Body)
		}
		if strings.Contains(w.Body.String(), "Attached email") != enabled || !strings.Contains(w.Body.String(), "Keep work") {
			t.Errorf("mailbox enabled=%t returned incorrect information: %s", enabled, w.Body)
		}
	}
}

func TestMangoToolsUseCurrentActorDisplayName(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit: %d %s", w.Code, w.Body)
	}
	node, err := f.repo.CreateNode(f.route.CompanyID, "Original")
	if err != nil {
		t.Fatal(err)
	}
	const currentName = "Updated actor name"
	if _, err := f.repo.UpsertAuthUser(f.user.CognitoSubject, f.user.Email, currentName); err != nil {
		t.Fatal(err)
	}
	w := mangoToolRequest(t, f, "mango_update_node", map[string]any{"node_id": node.NodeID, "name": "Renamed"})
	if w.Code != 200 {
		t.Fatalf("rename: %d %s", w.Code, w.Body)
	}
	events, err := f.repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: f.route.CompanyID, StreamType: "workspace", StreamID: f.route.CompanyID, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.Type != "node_updated" || event.Payload["node_id"] != node.NodeID {
			continue
		}
		if event.ActorUserID == nil || *event.ActorUserID != f.user.UserID || event.Payload["actor_display_name"] != currentName {
			t.Fatalf("Node event lost current actor: %+v", event)
		}
		return
	}
	t.Fatal("Node update event missing")
}

func TestMangoToolsExecuteCanonicalWorkAndEditorCommands(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit: %d %s", w.Code, w.Body)
	}
	list := mangoToolRequest(t, f, "mango_list_processes", map[string]any{})
	if list.Code != 200 || !strings.Contains(list.Body.String(), f.gateID) {
		t.Fatalf("list processes: %d %s", list.Code, list.Body)
	}
	process := mangoToolRequest(t, f, "mango_get_process", map[string]any{"logic_gate_id": f.gateID})
	if process.Code != 200 || !strings.Contains(process.Body.String(), f.stepID) {
		t.Fatalf("get process: %d %s", process.Code, process.Body)
	}
	created := mangoToolRequest(t, f, "mango_create_node", map[string]any{"logic_gate_id": f.gateID, "process_step_id": f.stepID, "title": "Review invoice"})
	var node struct {
		NodeID string `json:"node_id"`
	}
	if created.Code != 200 || json.Unmarshal(created.Body.Bytes(), &node) != nil || node.NodeID == "" {
		t.Fatalf("create: %d %s", created.Code, created.Body)
	}
	newTextbox := map[string]any{"resource_type": "node", "resource_id": node.NodeID, "document": json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"New Node instructions"}]}]}}`)}
	textbox := mangoToolRequest(t, f, "mango_create_editor", newTextbox)
	var textboxResult struct {
		Document store.EditorJSONDocumentRef `json:"document_ref"`
	}
	if textbox.Code != 200 || json.Unmarshal(textbox.Body.Bytes(), &textboxResult) != nil || !isCanonicalUUID(textboxResult.Document.DocumentID) {
		t.Fatalf("create Node editor: %d %s", textbox.Code, textbox.Body)
	}
	if retry := mangoToolRequest(t, f, "mango_create_editor", newTextbox); retry.Code != 200 || retry.Body.String() != textbox.Body.String() {
		t.Fatalf("retry created another textbox: %d %s", retry.Code, retry.Body)
	}
	textboxRead := mangoToolRequest(t, f, "mango_get_editor", map[string]any{"resource_type": "node", "resource_id": node.NodeID, "document_id": textboxResult.Document.DocumentID})
	if textboxRead.Code != 200 || !strings.Contains(textboxRead.Body.String(), "New Node instructions") {
		t.Fatalf("new Node editor is unreadable: %d %s", textboxRead.Code, textboxRead.Body)
	}
	for _, action := range []string{"mango_list_nodes", "mango_get_node"} {
		args := map[string]any{}
		if action == "mango_get_node" {
			args["node_id"] = node.NodeID
		}
		w := mangoToolRequest(t, f, action, args)
		if w.Code != 200 || !strings.Contains(w.Body.String(), node.NodeID) {
			t.Fatalf("%s: %d %s", action, w.Code, w.Body)
		}
	}
	updated := mangoToolRequest(t, f, "mango_update_node", map[string]any{"node_id": node.NodeID, "name": "Check total", "priority": 3, "due_date": "2026-09-10", "status": "In Progress"})
	if updated.Code != 200 {
		t.Fatalf("update: %d %s", updated.Code, updated.Body)
	}
	next, err := f.repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: f.route.CompanyID, LogicGateID: f.gateID, Name: "Approve", ActorUserID: f.user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	moved := mangoToolRequest(t, f, "mango_move_node", map[string]any{"node_id": node.NodeID, "logic_gate_id": f.gateID, "process_step_id": next.Step.ProcessStepID})
	if moved.Code != 200 {
		t.Fatalf("move: %d %s", moved.Code, moved.Body)
	}
	saved, err := f.repo.GetNode(f.route.CompanyID, node.NodeID)
	if err != nil || saved.Title != "Check total" || saved.Status == nil || *saved.Status != "In Progress" || saved.Priority == nil || *saved.Priority != 3 {
		t.Fatalf("canonical node: %+v %v", saved, err)
	}
	assignments, err := f.repo.ListNodeLogicGateAssignments(f.route.CompanyID, node.NodeID)
	if err != nil || len(assignments) != 1 || assignments[0].ProcessStepID == nil || *assignments[0].ProcessStepID != next.Step.ProcessStepID {
		t.Fatalf("canonical step assignment: %+v %v", assignments, err)
	}
	ref := map[string]any{"resource_type": "process_step", "resource_id": f.stepID, "document_id": f.stepID}
	read := mangoToolRequest(t, f, "mango_get_editor", ref)
	if read.Code != 200 {
		t.Fatalf("read editor: %d %s", read.Code, read.Body)
	}
	var snapshot store.EditorJSONSnapshot
	if err := json.Unmarshal(read.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	ref["base_revision"] = snapshot.Revision
	ref["document"] = json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Verify the invoice total."}]}]}}`)
	written := mangoToolRequest(t, f, "mango_update_editor", ref)
	if written.Code != 200 {
		t.Fatalf("write editor: %d %s", written.Code, written.Body)
	}
	retry := mangoToolRequest(t, f, "mango_update_editor", ref)
	if retry.Code != 200 || retry.Body.String() != written.Body.String() {
		t.Fatalf("editor retry: %d %s / %s", retry.Code, retry.Body, written.Body)
	}
	step, err := f.repo.GetProcessStep(f.route.CompanyID, f.stepID)
	if err != nil || !strings.Contains(string(step.BodyJSON), "Verify the invoice total.") || step.Revision != snapshot.Revision+1 {
		t.Fatalf("canonical Step editor: %+v %v", step, err)
	}
	cleared := mangoToolRequest(t, f, "mango_move_node", map[string]any{"node_id": node.NodeID, "logic_gate_id": f.gateID, "process_step_id": nil})
	if cleared.Code != 200 {
		t.Fatalf("clear Step: %d %s", cleared.Code, cleared.Body)
	}
	assignments, err = f.repo.ListNodeLogicGateAssignments(f.route.CompanyID, node.NodeID)
	if err != nil || len(assignments) != 1 || assignments[0].LogicGateID != f.gateID || assignments[0].ProcessStepID != nil {
		t.Fatalf("cleared Step must retain Process: %+v %v", assignments, err)
	}
}

func TestMangoToolsRejectForgedScopeAndDelete(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit: %d %s", w.Code, w.Body)
	}
	for _, test := range []struct {
		action string
		args   map[string]any
	}{
		{"mango_list_processes", map[string]any{"company_id": f.route.CompanyID}},
		{"mango_list_nodes", map[string]any{"user_id": f.user.UserID}},
		{"mango_get_node", map[string]any{"node_id": "../../nodes"}},
		{"mango_update_node", map[string]any{"node_id": f.gateID, "name": "Changed", "actor_user_id": f.user.UserID}},
		{"mango_move_node", map[string]any{"node_id": f.gateID, "logic_gate_id": f.gateID}},
		{"mango_create_editor", map[string]any{"resource_type": "node", "resource_id": f.gateID, "document_id": f.gateID, "document": map[string]any{}}},
		{"mango_get_editor", map[string]any{"resource_type": "process_step", "resource_id": f.stepID, "document_id": f.gateID}},
		{"mango_delete_node", map[string]any{"node_id": f.gateID}},
	} {
		w := mangoToolRequest(t, f, test.action, test.args)
		if w.Code != 400 {
			t.Errorf("%s accepted invalid arguments: %d %s", test.action, w.Code, w.Body)
		}
	}
	otherCompany := "97979797-9797-4797-8797-979797979797"
	f.repo.EnsureCompany(otherCompany, "Other company")
	otherNode, err := f.repo.CreateNode(otherCompany, "Private Node")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		action string
		args   map[string]any
	}{
		{"mango_get_node", map[string]any{"node_id": otherNode.NodeID}},
		{"mango_update_node", map[string]any{"node_id": otherNode.NodeID, "name": "Forged edit"}},
		{"mango_create_editor", map[string]any{"resource_type": "node", "resource_id": otherNode.NodeID, "document": json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]}}`)}},
	} {
		w := mangoToolRequest(t, f, test.action, test.args)
		if w.Code != 404 && w.Code != 403 {
			t.Errorf("%s reached another company's Node: %d %s", test.action, w.Code, w.Body)
		}
	}
}
