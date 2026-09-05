package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type assistantProcessCancelAfterSaveRepo struct {
	store.Repository
	cancel    context.CancelFunc
	document  store.EditorJSONDocumentRef
	reads     atomic.Int32
	committed atomic.Bool
}

func (r *assistantProcessCancelAfterSaveRepo) CommitEditorJSONDocument(input store.EditorJSONCommitInput) (store.EditorJSONCommit, error) {
	result, err := r.Repository.CommitEditorJSONDocument(input)
	if err == nil && input.Document.ResourceType == store.EntityTypeNode {
		r.document = input.Document
		r.committed.Store(true)
		r.cancel()
	}
	return result, err
}

func (r *assistantProcessCancelAfterSaveRepo) GetEditorJSONSnapshot(document store.EditorJSONDocumentRef) (store.EditorJSONSnapshot, error) {
	if document.ResourceType == store.EntityTypeNode && r.committed.Load() {
		r.reads.Add(1)
	}
	return r.Repository.GetEditorJSONSnapshot(document)
}

func TestAssistantProcessStopAfterCommittedTextRetainsConfirmedSave(t *testing.T) {
	var calls atomic.Int32
	var fixture assistantProcessFixture
	server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch calls.Add(1) {
		case 1:
			assistantProviderComplete(w, assistantProviderCall("create", "create_process_node", fmt.Sprintf(`{"name":"Keep this saved text after Stop","process_step_id":%q}`, fixture.first.ProcessStepID)))
		case 2:
			assistantProviderComplete(w, assistantProviderCall("write", "write_process_node", `{"plain_text":"This text was committed before Stop."}`))
		default:
			t.Error("Stop allowed another provider request")
			assistantProviderComplete(w)
		}
	})
	fixture = seedAssistantProcess(t, repo, "Preserve committed work")
	if _, err := repo.AddCompanyMembership("assistant-user", assistantTestCompany, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	requestID := store.NewUUIDv7String()
	r := assistantContextChatRequest(assistantRequest{RequestID: requestID, ProcessID: fixture.process.LogicGateID, InspectContext: true, Messages: []assistantMessage{{Role: "user", Content: "Carry out this Process using the supplied notes."}}})
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	tracing := &assistantProcessCancelAfterSaveRepo{Repository: repo, cancel: cancel}
	server.repo = tracing
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, r.WithContext(ctx))
	if calls.Load() != 2 || tracing.document.DocumentID == "" || tracing.reads.Load() != 0 {
		t.Fatalf("unexpected work after Stop: calls=%d saved=%+v later_reads=%d body=%s", calls.Load(), tracing.document, tracing.reads.Load(), response.Body.String())
	}
	snapshot, err := repo.GetEditorJSONSnapshot(tracing.document)
	if err != nil || snapshot.Revision != 1 || !strings.Contains(string(snapshot.JSONDocument), "This text was committed before Stop.") {
		t.Fatalf("confirmed text did not survive Stop: %+v, %v", snapshot, err)
	}
	key := assistantTestCompany + ":" + fixture.user.UserID + ":" + requestID
	server.assistant.mu.Lock()
	capture := server.assistant.captures[key]
	var events []assistantTrace
	if capture != nil {
		events = append(events, capture.events...)
	}
	server.assistant.mu.Unlock()
	found := false
	for _, event := range events {
		var data map[string]any
		if json.Unmarshal(event.Data, &data) != nil || event.Kind != "tool" || data["name"] != "write_process_node" {
			continue
		}
		confirmed, ok := data["confirmed_save"].(map[string]any)
		if ok && confirmed["textbox_id"] == tracing.document.DocumentID && data["canonical_read_confirmed"] == false {
			found = true
		}
	}
	if !found {
		t.Fatalf("Stop capture omitted confirmed save identity or incorrectly confirmed canonical read: %+v", events)
	}
}

type assistantProcessFixture struct {
	process     domain.LogicGate
	first, last domain.ProcessStep
	edge        domain.ResourceOperationalRelationship
	sop         store.EditorJSONDocumentRef
	user        domain.User
}

func seedAssistantProcess(t *testing.T, repo *store.MemoryRepo, name string) assistantProcessFixture {
	t.Helper()
	user, err := repo.GetAuthUser("assistant-user")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(assistantTestCompany, name)
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: assistantTestCompany, LogicGateID: process.LogicGateID, Name: "Draft the summary", ActorUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	last, err := repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: assistantTestCompany, LogicGateID: process.LogicGateID, Name: "Record action items", AfterProcessStepID: &first.Step.ProcessStepID, ActorUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	work, err := repo.GetLogicGateWork(assistantTestCompany, process.LogicGateID, user.UserID)
	if err != nil || len(work.Relationships) != 1 {
		t.Fatalf("seed Process connections: %+v, %v", work, err)
	}
	ref := store.EditorJSONDocumentRef{CompanyID: assistantTestCompany, ResourceType: store.EntityTypeLogicGate, ResourceID: process.LogicGateID, DocumentID: store.NewUUIDv7String()}
	if _, err := repo.CommitEditorJSONDocument(store.EditorJSONCommitInput{Document: ref, OperationID: store.NewUUIDv7String(), ClientID: "process-test", ActorUserID: user.UserID, SchemaVersion: store.MangoTiptapSchemaVersion, JSONDocument: assistantProcessTestSOP("Use only meeting facts from the request; write the summary, then record the action items.")}); err != nil {
		t.Fatal(err)
	}
	// Memory storage keeps presentation metadata separate from canonical editor JSON.
	if _, err := repo.UpdateEditorJSONMetadata(store.EditorJSONMetadataInput{Document: store.EditorDocumentRef{CompanyID: ref.CompanyID, ResourceType: ref.ResourceType, ResourceID: ref.ResourceID, DocumentID: ref.DocumentID}, Title: "Meeting SOP"}); err != nil {
		t.Fatal(err)
	}
	return assistantProcessFixture{process: process, first: *first.Step, last: *last.Step, edge: work.Relationships[0], sop: ref, user: user}
}

func assistantProcessTestSOP(text string) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{"format": store.MangoTiptapFormat, "schema_version": store.MangoTiptapSchemaVersion, "document": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}}}}})
	return raw
}

func assistantProcessChatRequest(processID string) *http.Request {
	body, _ := json.Marshal(assistantRequest{RequestID: store.NewUUIDv7String(), ProcessID: processID, ReasoningEffort: "medium", Messages: []assistantMessage{{Role: "user", Content: "Carry out the selected Process. Meeting facts: Alice will prepare Friday's report."}}})
	r := httptest.NewRequest(http.MethodPost, "/v1/assistant/chat?company_id="+assistantTestCompany, bytes.NewReader(body))
	r.Header.Set("Authorization", "Bearer assistant-token")
	r.Header.Set("Content-Type", "application/json")
	return r
}

// Provider message content may contain a serialized context object. Collect
// string values without depending on its private context field names.
func assistantProcessInputText(value any) string {
	switch value := value.(type) {
	case string:
		return value
	case []any:
		var text strings.Builder
		for _, item := range value {
			text.WriteString(assistantProcessInputText(item))
			text.WriteByte('\n')
		}
		return text.String()
	case map[string]any:
		var text strings.Builder
		for _, item := range value {
			text.WriteString(assistantProcessInputText(item))
			text.WriteByte('\n')
		}
		return text.String()
	default:
		return ""
	}
}

func TestAssistantProcessCanDiscussMissingSOPOrSteps(t *testing.T) {
	for _, scenario := range []struct {
		name     string
		hasSOP   bool
		hasSteps bool
	}{{"no_sop", false, true}, {"no_steps", true, false}, {"neither", false, false}} {
		t.Run(scenario.name, func(t *testing.T) {
			captured := make(chan map[string]any, 1)
			server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					http.Error(w, "invalid request", 500)
					return
				}
				captured <- body
				assistantProviderEvent(w, map[string]any{"type": "response.output_text.delta", "delta": "Yes, I can see this Process."})
				assistantProviderComplete(w)
			})
			inspect := scenario.name == "neither"
			if inspect {
				if _, err := repo.AddCompanyMembership("assistant-user", assistantTestCompany, domain.RoleDevAdmin); err != nil {
					t.Fatal(err)
				}
			}
			process, err := repo.CreateLogicGate(assistantTestCompany, "A Process to discuss")
			if err != nil {
				t.Fatal(err)
			}
			if scenario.hasSteps {
				if _, err := repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: assistantTestCompany, LogicGateID: process.LogicGateID, Name: "Prepare"}); err != nil {
					t.Fatal(err)
				}
			}
			if scenario.hasSOP {
				// Canonical content must be readable without a separate metadata write.
				if _, err := repo.CommitEditorJSONDocument(store.EditorJSONCommitInput{
					Document:    store.EditorJSONDocumentRef{CompanyID: assistantTestCompany, ResourceType: store.EntityTypeLogicGate, ResourceID: process.LogicGateID, DocumentID: store.NewUUIDv7String()},
					OperationID: store.NewUUIDv7String(), ClientID: "process-discussion-test", SchemaVersion: store.MangoTiptapSchemaVersion, JSONDocument: assistantProcessTestSOP("Discuss the supplied meeting notes."),
				}); err != nil {
					t.Fatal(err)
				}
			}
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, assistantContextChatRequest(assistantRequest{ProcessID: process.LogicGateID, InspectContext: inspect, Messages: []assistantMessage{{Role: "user", Content: "Do you see this Process?"}}}))
			if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"type":"done"`) || strings.Contains(response.Body.String(), `"type":"error"`) {
				t.Fatalf("discussion was rejected: %d %s", response.Code, response.Body.String())
			}
			if inspect {
				contexts := assistantContextEvents(t, response.Body.String())
				if len(contexts) != 1 {
					t.Fatalf("incomplete Process inspection events=%d, want 1", len(contexts))
				}
				if tools, ok := contexts[0]["tools"].([]any); !ok || len(tools) != 1 || tools[0].(map[string]any)["name"] != "read" {
					t.Fatalf("incomplete Process inspection must show only the native skill read tool, got %#v", contexts[0]["tools"])
				}
			}
			select {
			case body := <-captured:
				tools, _ := body["tools"].([]any)
				if len(tools) != 1 || tools[0].(map[string]any)["name"] != "read" {
					t.Fatalf("incomplete Process exposed mutation tools: %+v", tools)
				}
				definition := assistantDeveloperContext(t, body["input"])
				selected, _ := definition["process"].(map[string]any)
				if selected["logic_gate_id"] != process.LogicGateID || selected["header"] != process.Header {
					t.Fatalf("provider cannot see the selected Process: %+v", selected)
				}
				if reason, _ := definition["execution_blocked_reason"].(string); reason == "" {
					t.Fatal("incomplete Process lacks an execution-only explanation")
				}
				steps, _ := definition["steps"].([]any)
				sop, _ := definition["sop"].([]any)
				if (len(steps) > 0) != scenario.hasSteps || (len(sop) > 0) != scenario.hasSOP {
					t.Fatalf("available Process data was lost: Steps=%d SOPs=%d", len(steps), len(sop))
				}
			default:
				t.Fatal("discussion never reached the provider")
			}
			nodes, err := repo.ListNodes(assistantTestCompany)
			if err != nil || len(nodes) != 0 {
				t.Fatalf("discussion created work: Nodes=%+v err=%v", nodes, err)
			}
		})
	}
}

func TestAssistantProcessFollowupReloadsCanonicalSOPWithoutCreatingWork(t *testing.T) {
	captured := make(chan map[string]any, 1)
	server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "invalid request", 500)
			return
		}
		captured <- body
		assistantProviderComplete(w)
	})
	process, err := repo.CreateLogicGate(assistantTestCompany, "Follow-up Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: assistantTestCompany, LogicGateID: process.LogicGateID, Name: "Discuss notes"}); err != nil {
		t.Fatal(err)
	}
	ref := store.EditorJSONDocumentRef{CompanyID: assistantTestCompany, ResourceType: store.EntityTypeLogicGate, ResourceID: process.LogicGateID, DocumentID: store.NewUUIDv7String()}
	messages := []assistantMessage{{Role: "user", Content: "Do you see this Process?"}}
	for turn, sopText := range []string{"", "The first saved SOP discusses Monday's notes.", "The updated SOP discusses Friday's notes."} {
		if turn > 0 {
			// No UpdateEditorJSONMetadata call: the saved document is authoritative.
			if _, err := repo.CommitEditorJSONDocument(store.EditorJSONCommitInput{
				Document: ref, OperationID: store.NewUUIDv7String(), ClientID: "human-editor", BaseRevision: int64(turn - 1), SchemaVersion: store.MangoTiptapSchemaVersion, JSONDocument: assistantProcessTestSOP(sopText),
			}); err != nil {
				t.Fatal(err)
			}
			messages = append(messages, assistantMessage{Role: "assistant", Content: "Yes, I can see the Process."}, assistantMessage{Role: "user", Content: "I changed the SOP. Can you see my change?"})
		}
		response := httptest.NewRecorder()
		server.Routes().ServeHTTP(response, assistantContextChatRequest(assistantRequest{ProcessID: process.LogicGateID, Messages: messages}))
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"type":"done"`) || strings.Contains(response.Body.String(), `"type":"error"`) {
			t.Fatalf("discussion turn %d failed: %d %s", turn, response.Code, response.Body.String())
		}
		var body map[string]any
		select {
		case body = <-captured:
		default:
			t.Fatalf("turn %d did not reach the provider", turn)
		}
		definition := assistantDeveloperContext(t, body["input"])
		selected, _ := definition["process"].(map[string]any)
		if selected["logic_gate_id"] != process.LogicGateID || selected["header"] != process.Header {
			t.Fatalf("follow-up lost the selected Process: %+v", selected)
		}
		instructions := assistantProcessInputText(body["input"])
		if !strings.Contains(instructions, "does not authorize execution") {
			t.Error("the model is not told that selecting a Process alone does not authorize execution")
		}
		sop, _ := definition["sop"].([]any)
		if turn == 0 {
			if len(sop) != 0 {
				t.Fatal("unsaved SOP content was invented")
			}
			continue
		}
		if len(sop) != 1 {
			t.Fatalf("turn %d omitted the canonical SOP saved without metadata", turn)
		}
		saved := sop[0].(map[string]any)
		if saved["textbox_id"] != ref.DocumentID || saved["revision"] != float64(turn) || !strings.Contains(assistantProcessInputText(saved["document"]), sopText) {
			t.Fatalf("turn %d read stale or wrong SOP: %+v", turn, saved)
		}
		if turn == 2 && strings.Contains(assistantProcessInputText(saved["document"]), "Monday's notes") {
			t.Fatal("follow-up kept the previous SOP content")
		}
		if reason, _ := definition["execution_blocked_reason"].(string); reason != "" {
			t.Fatalf("saved SOP did not clear readiness: %s", reason)
		}
	}
	nodes, err := repo.ListNodes(assistantTestCompany)
	if err != nil || len(nodes) != 0 {
		t.Fatalf("discussion or follow-up created work: Nodes=%+v err=%v", nodes, err)
	}
}

func TestAssistantProcessExecutesSavedNodeWithAutomaticContext(t *testing.T) {
	var calls atomic.Int32
	var fixture assistantProcessFixture
	var textboxes []string
	var initialStatus string
	var repo *store.MemoryRepo
	server, memory := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "bad request", 500)
			return
		}
		n := calls.Add(1)
		if n == 1 {
			context := assistantProcessInputText(body["input"])
			for _, want := range []string{assistantTestCompany, fixture.user.UserID, fixture.user.DisplayName, domain.RoleCompanyAdmin, fixture.process.LogicGateID, fixture.process.Header, fixture.first.ProcessStepID, fixture.first.Name, fixture.last.ProcessStepID, fixture.last.Name, fixture.edge.ResourceOperationalRelationshipID, fmt.Sprintf(`"position":%d`, fixture.first.Position), fmt.Sprintf(`"position":%d`, fixture.last.Position), "process_step", "Use only meeting facts from the request", store.MangoTiptapFormat, "Alice will prepare Friday's report"} {
				if !strings.Contains(context, want) {
					t.Errorf("automatic context omits %q", want)
				}
			}
			wantTools := map[string][]string{"create_process_node": {"name", "process_step_id"}, "write_process_node": {"plain_text"}, "move_process_node_to_step": {"process_step_id"}, "list_chat_users": {"query"}, "send_process_node_chat": {"textbox_id", "message", "mentioned_user_ids", "urgent_user_ids"}}
			tools, _ := body["tools"].([]any)
			if len(tools) != len(wantTools)+1 {
				t.Errorf("Process mode exposed %d tools", len(tools))
			}
			for _, raw := range tools {
				tool, _ := raw.(map[string]any)
				name, _ := tool["name"].(string)
				if name == "read" {
					continue // The native skill reader is checked by the Pi runtime isolation tests.
				}
				keys, allowed := wantTools[name]
				params, _ := tool["parameters"].(map[string]any)
				properties, _ := params["properties"].(map[string]any)
				if !allowed || len(properties) != len(keys) {
					t.Errorf("unexpected Process tool arguments: %+v", tool)
				}
				for _, key := range keys {
					if _, ok := properties[key]; !ok {
						t.Errorf("%s omits %s", name, key)
					}
				}
			}
		}
		// Inspect actual dispatcher outputs, not model-invented identifiers.
		if inputs, ok := body["input"].([]any); ok {
			for _, raw := range inputs {
				item, _ := raw.(map[string]any)
				if item["type"] != "function_call_output" {
					continue
				}
				output, _ := item["output"].(string)
				var result store.EditorJSONSnapshot
				if json.Unmarshal([]byte(output), &result) == nil && result.Document.ResourceType == store.EntityTypeNode && result.Document.DocumentID != "" {
					seen := false
					for _, id := range textboxes {
						seen = seen || id == result.Document.DocumentID
					}
					if !seen {
						textboxes = append(textboxes, result.Document.DocumentID)
					}
				}
			}
		}
		switch n {
		case 1:
			assistantProviderComplete(w, assistantProviderCall("create", "create_process_node", fmt.Sprintf(`{"name":"Friday meeting work","process_step_id":%q}`, fixture.first.ProcessStepID)))
		case 2:
			nodes, err := repo.ListNodes(assistantTestCompany)
			if err != nil || len(nodes) != 1 {
				t.Errorf("created Node not persisted: %+v, %v", nodes, err)
				http.Error(w, "missing Node", 500)
				return
			}
			assignments, err := repo.ListNodeLogicGateAssignments(assistantTestCompany, nodes[0].NodeID)
			if err != nil || len(assignments) != 1 || assignments[0].LogicGateID != fixture.process.LogicGateID || assignments[0].ProcessStepID == nil || *assignments[0].ProcessStepID != fixture.first.ProcessStepID {
				t.Errorf("Node was not created in its first Step atomically: %+v, %v", assignments, err)
			}
			node, err := repo.GetNode(assistantTestCompany, nodes[0].NodeID)
			if err != nil || node.Status == nil {
				t.Errorf("missing initial status: %+v, %v", node, err)
			} else {
				initialStatus = *node.Status
			}
			assistantProviderComplete(w, assistantProviderCall("summary", "write_process_node", `{"plain_text":"Meeting summary: Alice will prepare Friday's report."}`))
		case 3:
			assistantProviderComplete(w, assistantProviderCall("move", "move_process_node_to_step", fmt.Sprintf(`{"process_step_id":%q}`, fixture.last.ProcessStepID)))
		case 4:
			assistantProviderComplete(w, assistantProviderCall("actions", "write_process_node", `{"plain_text":"Action item: Alice prepares the report by Friday."}`))
		default:
			assistantProviderComplete(w)
		}
	})
	repo = memory
	fixture = seedAssistantProcess(t, repo, "Prepare the Friday meeting summary")
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, assistantProcessChatRequest(fixture.process.LogicGateID))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"type":"done"`) || strings.Contains(response.Body.String(), `"type":"error"`) || calls.Load() != 5 {
		t.Fatalf("Process execution: calls=%d status=%d body=%s", calls.Load(), response.Code, response.Body.String())
	}
	nodes, err := repo.ListNodes(assistantTestCompany)
	if err != nil || len(nodes) != 1 {
		t.Fatalf("saved Nodes: %+v, %v", nodes, err)
	}
	nodeID := nodes[0].NodeID
	assignments, err := repo.ListNodeLogicGateAssignments(assistantTestCompany, nodeID)
	if err != nil || len(assignments) != 1 || assignments[0].ProcessStepID == nil || *assignments[0].ProcessStepID != fixture.last.ProcessStepID {
		t.Fatalf("final Step: %+v, %v", assignments, err)
	}
	node, err := repo.GetNode(assistantTestCompany, nodeID)
	if err != nil || node.Status == nil || *node.Status != initialStatus {
		t.Fatalf("Step movement changed status: %+v, %v", node, err)
	}
	if len(textboxes) != 2 {
		t.Fatalf("writes did not return two distinct textbox identities: %v", textboxes)
	}
	for i, text := range []string{"Meeting summary: Alice will prepare Friday's report.", "Action item: Alice prepares the report by Friday."} {
		snapshot, err := repo.GetEditorJSONSnapshot(store.EditorJSONDocumentRef{CompanyID: assistantTestCompany, ResourceType: store.EntityTypeNode, ResourceID: nodeID, DocumentID: textboxes[i]})
		if err != nil || snapshot.Revision != 1 || !strings.Contains(string(snapshot.JSONDocument), text) {
			t.Errorf("saved textbox %d: %+v, %v", i, snapshot, err)
		}
	}
	foundNodeEvent := false
	for _, line := range strings.Split(response.Body.String(), "\n") {
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var event map[string]any
		if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event) == nil && event["type"] == "node" && event["node_id"] == nodeID && event["process_id"] == fixture.process.LogicGateID {
			foundNodeEvent = true
		}
	}
	if !foundNodeEvent {
		t.Errorf("stream omitted the persisted Node/Process identity: %s", response.Body.String())
	}
}

func TestAssistantProcessRejectsToolsAndTargetsOutsideItsWork(t *testing.T) {
	for _, scenario := range []string{"generic_tool", "write_before_create", "move_before_create", "unknown_create_step", "foreign_create_step", "second_create", "unknown_move_step", "foreign_move_step", "injected_node"} {
		t.Run(scenario, func(t *testing.T) {
			var calls atomic.Int32
			var selected, other assistantProcessFixture
			afterCreate := scenario == "second_create" || scenario == "unknown_move_step" || scenario == "foreign_move_step" || scenario == "injected_node"
			server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				n := calls.Add(1)
				if n == 1 && afterCreate {
					assistantProviderComplete(w, assistantProviderCall("create", "create_process_node", fmt.Sprintf(`{"name":"Only one Node","process_step_id":%q}`, selected.first.ProcessStepID)))
					return
				}
				name, args := "write_process_node", `{"plain_text":"Must not be written"}`
				switch scenario {
				case "generic_tool":
					name, args = "create_process", `{"name":"Forbidden Process"}`
				case "move_before_create":
					name, args = "move_process_node_to_step", fmt.Sprintf(`{"process_step_id":%q}`, selected.last.ProcessStepID)
				case "unknown_create_step":
					name, args = "create_process_node", fmt.Sprintf(`{"name":"Invalid Step","process_step_id":%q}`, store.NewUUIDv7String())
				case "foreign_create_step":
					name, args = "create_process_node", fmt.Sprintf(`{"name":"Wrong Process","process_step_id":%q}`, other.first.ProcessStepID)
				case "second_create":
					name, args = "create_process_node", fmt.Sprintf(`{"name":"Forbidden second Node","process_step_id":%q}`, selected.first.ProcessStepID)
				case "unknown_move_step":
					name, args = "move_process_node_to_step", fmt.Sprintf(`{"process_step_id":%q}`, store.NewUUIDv7String())
				case "foreign_move_step":
					name, args = "move_process_node_to_step", fmt.Sprintf(`{"process_step_id":%q}`, other.first.ProcessStepID)
				case "injected_node":
					args = fmt.Sprintf(`{"plain_text":"Must not be written","node_id":%q}`, store.NewUUIDv7String())
				}
				assistantProviderComplete(w, assistantProviderCall(fmt.Sprint(n), name, args))
			})
			selected = seedAssistantProcess(t, repo, "Selected Process")
			other = seedAssistantProcess(t, repo, "Other Process")
			res := httptest.NewRecorder()
			server.Routes().ServeHTTP(res, assistantProcessChatRequest(selected.process.LogicGateID))
			wantCalls, wantNodes := int32(1), 0
			if afterCreate {
				wantCalls, wantNodes = 2, 1
			}
			nodes, err := repo.ListNodes(assistantTestCompany)
			if err != nil || calls.Load() != wantCalls || len(nodes) != wantNodes || !strings.Contains(res.Body.String(), `"type":"error"`) || strings.Contains(res.Body.String(), `"type":"done"`) {
				t.Fatalf("scope rejection: calls=%d Nodes=%+v err=%v body=%s", calls.Load(), nodes, err, res.Body.String())
			}
			processes, _ := repo.ListLogicGates(assistantTestCompany)
			if len(processes) != 2 {
				t.Errorf("rejected tool changed Process list: %+v", processes)
			}
			if wantNodes == 1 {
				assignments, err := repo.ListNodeLogicGateAssignments(assistantTestCompany, nodes[0].NodeID)
				if err != nil || len(assignments) != 1 || assignments[0].LogicGateID != selected.process.LogicGateID || assignments[0].ProcessStepID == nil || *assignments[0].ProcessStepID != selected.first.ProcessStepID {
					t.Errorf("rejected tool changed placement: %+v, %v", assignments, err)
				}
			}
		})
	}
}

func TestAssistantProcessDoesNotSendUnauthorizedContextToProvider(t *testing.T) {
	var calls atomic.Int32
	server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1); assistantProviderComplete(w) })
	fixture := seedAssistantProcess(t, repo, "Private acquisition procedure")
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: assistantTestCompany, EntityType: store.EntityTypeLogicGate, EntityID: fixture.process.LogicGateID, DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true, ActorUserID: fixture.user.UserID}); err != nil {
		t.Fatal(err)
	}
	member := mustRealtimeAuthUser(t, repo, assistantTestCompany, "process-unauthorized-member", domain.RoleCompanyUser)
	memberServer := newRealtimeAuthServerForTest(repo, "assistant-token", member)
	t.Cleanup(memberServer.Close)
	memberServer.assistant = server.assistant
	res := httptest.NewRecorder()
	memberServer.Routes().ServeHTTP(res, assistantProcessChatRequest(fixture.process.LogicGateID))
	if calls.Load() != 0 || strings.Contains(res.Body.String(), fixture.process.Header) || strings.Contains(res.Body.String(), "Use only meeting facts") || strings.Contains(res.Body.String(), `"type":"done"`) {
		t.Fatalf("unauthorized context leaked: calls=%d status=%d body=%s", calls.Load(), res.Code, res.Body.String())
	}
	if res.Code == http.StatusOK && !strings.Contains(res.Body.String(), `"type":"error"`) {
		t.Errorf("unauthorized request had no failure: %s", res.Body.String())
	}
	nodes, _ := repo.ListNodes(assistantTestCompany)
	if len(nodes) != 0 {
		t.Errorf("unauthorized execution created Nodes: %+v", nodes)
	}
}

func TestAssistantProcessStopsWhenDefinitionChangesBeforeAnAction(t *testing.T) {
	for _, scenario := range []string{"renamed_step", "deleted_step", "changed_sop", "deleted_connection"} {
		t.Run(scenario, func(t *testing.T) {
			var calls atomic.Int32
			var fixture assistantProcessFixture
			var repo *store.MemoryRepo
			server, memory := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var err error
				switch scenario {
				case "renamed_step":
					name := "Changed while the model was thinking"
					_, err = repo.UpdateProcessStep(store.ProcessStepUpdateInput{CompanyID: assistantTestCompany, LogicGateID: fixture.process.LogicGateID, ProcessStepID: fixture.last.ProcessStepID, Name: &name, ActorUserID: fixture.user.UserID})
				case "deleted_step":
					_, err = repo.DeleteProcessStep(store.ProcessStepDeleteInput{CompanyID: assistantTestCompany, LogicGateID: fixture.process.LogicGateID, ProcessStepID: fixture.first.ProcessStepID, ActorUserID: fixture.user.UserID})
				case "changed_sop":
					_, err = repo.CommitEditorJSONDocument(store.EditorJSONCommitInput{Document: fixture.sop, OperationID: store.NewUUIDv7String(), ClientID: "human-editor", ActorUserID: fixture.user.UserID, BaseRevision: 1, SchemaVersion: store.MangoTiptapSchemaVersion, JSONDocument: assistantProcessTestSOP("The human changed the procedure.")})
				case "deleted_connection":
					_, err = repo.DeleteProcessStepRelationship(store.ProcessStepRelationshipDeleteInput{CompanyID: assistantTestCompany, LogicGateID: fixture.process.LogicGateID, RelationshipID: fixture.edge.ResourceOperationalRelationshipID, ActorUserID: fixture.user.UserID})
				}
				if err != nil {
					t.Errorf("human change failed: %v", err)
					http.Error(w, "seed change failed", 500)
					return
				}
				assistantProviderComplete(w, assistantProviderCall("stale_create", "create_process_node", fmt.Sprintf(`{"name":"Stale procedure work","process_step_id":%q}`, fixture.first.ProcessStepID)))
			})
			repo = memory
			fixture = seedAssistantProcess(t, repo, "Live editable procedure")
			res := httptest.NewRecorder()
			server.Routes().ServeHTTP(res, assistantProcessChatRequest(fixture.process.LogicGateID))
			nodes, _ := repo.ListNodes(assistantTestCompany)
			if calls.Load() != 1 || len(nodes) != 0 || !strings.Contains(res.Body.String(), `"type":"error"`) || strings.Contains(res.Body.String(), `"type":"done"`) {
				t.Fatalf("stale definition executed: calls=%d Nodes=%+v body=%s", calls.Load(), nodes, res.Body.String())
			}
		})
	}
}

func TestAssistantProcessPreservesHumanStepAndProcessMoves(t *testing.T) {
	for _, away := range []bool{false, true} {
		t.Run(fmt.Sprintf("other_process_%t", away), func(t *testing.T) {
			var calls atomic.Int32
			var selected, other assistantProcessFixture
			var repo *store.MemoryRepo
			var humanAssignment domain.NodeLogicGateAssignment
			server, memory := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) == 1 {
					assistantProviderComplete(w, assistantProviderCall("create", "create_process_node", fmt.Sprintf(`{"name":"Human will move this Node","process_step_id":%q}`, selected.first.ProcessStepID)))
					return
				}
				nodes, err := repo.ListNodes(assistantTestCompany)
				if err != nil || len(nodes) != 1 {
					t.Errorf("created Node unavailable: %+v, %v", nodes, err)
					http.Error(w, "missing Node", 500)
					return
				}
				processID, stepID := selected.process.LogicGateID, selected.last.ProcessStepID
				if away {
					processID, stepID = other.process.LogicGateID, other.first.ProcessStepID
				}
				moved, err := repo.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{CompanyID: assistantTestCompany, LogicGateID: processID, NodeID: nodes[0].NodeID, ProcessStepID: &stepID, ProcessStepIDSet: true, ActorUserID: selected.user.UserID})
				if err != nil {
					t.Errorf("human move failed: %v", err)
					http.Error(w, "human move failed", 500)
					return
				}
				humanAssignment = moved.Assignment
				assistantProviderComplete(w, assistantProviderCall("stale_move", "move_process_node_to_step", fmt.Sprintf(`{"process_step_id":%q}`, selected.first.ProcessStepID)))
			})
			repo = memory
			selected = seedAssistantProcess(t, repo, "Selected Process")
			other = seedAssistantProcess(t, repo, "Human destination")
			res := httptest.NewRecorder()
			server.Routes().ServeHTTP(res, assistantProcessChatRequest(selected.process.LogicGateID))
			if calls.Load() != 2 || !strings.Contains(res.Body.String(), `"type":"error"`) || strings.Contains(res.Body.String(), `"type":"done"`) {
				t.Fatalf("human move was ignored: calls=%d body=%s", calls.Load(), res.Body.String())
			}
			assignments, err := repo.ListNodeLogicGateAssignments(assistantTestCompany, humanAssignment.NodeID)
			if err != nil || len(assignments) != 1 || assignments[0].LogicGateID != humanAssignment.LogicGateID || assignments[0].ProcessStepID == nil || humanAssignment.ProcessStepID == nil || *assignments[0].ProcessStepID != *humanAssignment.ProcessStepID || assignments[0].Version != humanAssignment.Version {
				t.Fatalf("AI overwrote human placement: %+v want %+v, err=%v", assignments, humanAssignment, err)
			}
		})
	}
}

func TestAssistantProcessCanWriteIdenticalTextInDifferentSteps(t *testing.T) {
	const text = "No discrepancies were found in this Step."
	var calls atomic.Int32
	var fixture assistantProcessFixture
	var saved []store.EditorJSONSnapshot
	server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		switch n {
		case 1:
			assistantProviderComplete(w, assistantProviderCall("create", "create_process_node", fmt.Sprintf(`{"name":"Repeated Step findings","process_step_id":%q}`, fixture.first.ProcessStepID)))
		case 2, 4:
			assistantProviderComplete(w, assistantProviderCall(fmt.Sprintf("write_%d", n), "write_process_node", fmt.Sprintf(`{"plain_text":%q}`, text)))
		case 3:
			assistantProviderComplete(w, assistantProviderCall("move", "move_process_node_to_step", fmt.Sprintf(`{"process_step_id":%q}`, fixture.last.ProcessStepID)))
		default:
			var body struct {
				Input []struct {
					Type   string `json:"type"`
					Output string `json:"output"`
				} `json:"input"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
				http.Error(w, "bad provider request", 500)
				return
			}
			for _, item := range body.Input {
				var snapshot store.EditorJSONSnapshot
				if item.Type == "function_call_output" && json.Unmarshal([]byte(item.Output), &snapshot) == nil && snapshot.Document.ResourceType == store.EntityTypeNode {
					saved = append(saved, snapshot)
				}
			}
			assistantProviderComplete(w)
		}
	})
	fixture = seedAssistantProcess(t, repo, "Write a finding in each Step")
	res := httptest.NewRecorder()
	server.Routes().ServeHTTP(res, assistantProcessChatRequest(fixture.process.LogicGateID))
	if calls.Load() != 5 || !strings.Contains(res.Body.String(), `"type":"done"`) || strings.Contains(res.Body.String(), `"type":"error"`) {
		t.Fatalf("legitimate repeated text was blocked: calls=%d body=%s", calls.Load(), res.Body.String())
	}
	if len(saved) != 2 || saved[0].Document.DocumentID == saved[1].Document.DocumentID || saved[0].Document.ResourceID != saved[1].Document.ResourceID {
		t.Fatalf("expected two distinct textboxes in the same Node: %+v", saved)
	}
	for _, output := range saved {
		snapshot, err := repo.GetEditorJSONSnapshot(output.Document)
		if err != nil || snapshot.Revision != 1 || !strings.Contains(string(snapshot.JSONDocument), text) {
			t.Errorf("Step finding was not independently saved: %+v, %v", snapshot, err)
		}
	}
}

// The human mutation happens after the assistant's normal precheck but before
// its store command. Only the command's transactional check can close this race.
type assistantProcessRaceRepo struct {
	store.Repository
	action            string
	targetProcessID   string
	targetStepID      string
	actorID           string
	raced             bool
	raceErr           error
	humanAssignment   domain.NodeLogicGateAssignment
	attemptedDocument store.EditorJSONDocumentRef
}

func (r *assistantProcessRaceRepo) moveAsHuman(nodeID string) error {
	r.raced = true
	result, err := r.Repository.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{
		CompanyID: assistantTestCompany, LogicGateID: r.targetProcessID, NodeID: nodeID,
		ProcessStepID: &r.targetStepID, ProcessStepIDSet: true, ActorUserID: r.actorID,
	})
	r.raceErr, r.humanAssignment = err, result.Assignment
	return err
}

func (r *assistantProcessRaceRepo) MoveLogicGateNodeAssignment(input store.LogicGateNodeAssignmentMoveInput) (store.LogicGateNodeAssignmentResult, error) {
	if r.action == "move" && !r.raced {
		if err := r.moveAsHuman(input.NodeID); err != nil {
			return store.LogicGateNodeAssignmentResult{}, err
		}
	}
	return r.Repository.MoveLogicGateNodeAssignment(input)
}

func (r *assistantProcessRaceRepo) CommitEditorJSONDocument(input store.EditorJSONCommitInput) (store.EditorJSONCommit, error) {
	if r.action == "write" && !r.raced && input.Document.ResourceType == store.EntityTypeNode {
		r.attemptedDocument = input.Document
		if err := r.moveAsHuman(input.Document.ResourceID); err != nil {
			return store.EditorJSONCommit{}, err
		}
	}
	return r.Repository.CommitEditorJSONDocument(input)
}

func TestAssistantProcessRejectsHumanMoveBetweenPrecheckAndMutation(t *testing.T) {
	for _, action := range []string{"move", "write"} {
		t.Run(action, func(t *testing.T) {
			var calls atomic.Int32
			var selected assistantProcessFixture
			server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				switch calls.Add(1) {
				case 1:
					assistantProviderComplete(w, assistantProviderCall("create", "create_process_node", fmt.Sprintf(`{"name":"Concurrent human movement","process_step_id":%q}`, selected.first.ProcessStepID)))
				case 2:
					if action == "move" {
						assistantProviderComplete(w, assistantProviderCall("move", "move_process_node_to_step", fmt.Sprintf(`{"process_step_id":%q}`, selected.last.ProcessStepID)))
					} else {
						assistantProviderComplete(w, assistantProviderCall("write", "write_process_node", `{"plain_text":"This stale text must not be saved."}`))
					}
				default:
					assistantProviderComplete(w)
				}
			})
			selected = seedAssistantProcess(t, repo, "Original AI Process")
			destination := seedAssistantProcess(t, repo, "Human destination Process")
			tracing := &assistantProcessRaceRepo{Repository: repo, action: action, targetProcessID: destination.process.LogicGateID, targetStepID: destination.first.ProcessStepID, actorID: selected.user.UserID}
			server.repo = tracing
			res := httptest.NewRecorder()
			server.Routes().ServeHTTP(res, assistantProcessChatRequest(selected.process.LogicGateID))
			if !tracing.raced || tracing.raceErr != nil {
				t.Fatalf("test never completed its boundary mutation: raced=%t err=%v body=%s", tracing.raced, tracing.raceErr, res.Body.String())
			}
			if calls.Load() != 2 || !strings.Contains(res.Body.String(), `"type":"error"`) || strings.Contains(res.Body.String(), `"type":"done"`) {
				t.Errorf("stale AI action continued after the human move: calls=%d body=%s", calls.Load(), res.Body.String())
			}
			assignments, err := repo.ListNodeLogicGateAssignments(assistantTestCompany, tracing.humanAssignment.NodeID)
			if err != nil || len(assignments) != 1 || assignments[0].LogicGateID != destination.process.LogicGateID || assignments[0].ProcessStepID == nil || *assignments[0].ProcessStepID != destination.first.ProcessStepID || assignments[0].Version != tracing.humanAssignment.Version {
				t.Errorf("AI changed the human's saved placement: %+v, err=%v", assignments, err)
			}
			if action == "write" {
				snapshot, err := repo.GetEditorJSONSnapshot(tracing.attemptedDocument)
				if err != nil || snapshot.Revision != 0 || strings.Contains(string(snapshot.JSONDocument), "This stale text") {
					t.Errorf("rejected write left saved textbox content: %+v, err=%v", snapshot, err)
				}
			}
		})
	}
}
