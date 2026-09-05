package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestAssistantBindingReadsExactLiveDefinitionWithoutMutation(t *testing.T) {
	server, repo := assistantTestServer(t, nil)
	fixture := seedAssistantProcess(t, repo, "Review garden measurements")
	r := assistantToolRequest(fixture.user, assistantTestCompany, domain.RoleCompanyAdmin)
	before, err := repo.GetLogicGateWork(assistantTestCompany, fixture.process.LogicGateID, fixture.user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	var events []assistantEvent
	emit := func(event assistantEvent) error { events = append(events, event); return nil }
	bound, err := server.bindAssistantProcess(r, fixture.process.LogicGateID, emit)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Type != "process" || events[0].ProcessID != fixture.process.LogicGateID || events[0].Name != fixture.process.Header {
		t.Fatalf("binding event did not report exact saved identity: %+v", events)
	}
	if bound.nodeID != "" || bound.stepID != "" || bound.assignmentVersion != 0 {
		t.Fatalf("binding created execution state: %+v", bound)
	}
	definition := bound.definition
	if definition.Process.LogicGateID != fixture.process.LogicGateID {
		t.Fatalf("binding lost the exact Process identity: %+v", definition)
	}
	var context map[string]any
	if json.Unmarshal([]byte(bound.definitionJSON), &context) != nil {
		t.Fatal("binding returned invalid Process context")
	}
	if _, duplicated := context["user"]; duplicated {
		t.Fatal("binding repeated the separately supplied actor context")
	}
	if len(definition.Steps) != 2 || definition.Steps[0].ID != fixture.first.ProcessStepID || definition.Steps[1].ID != fixture.last.ProcessStepID || len(definition.Relationships) != 1 || definition.Relationships[0].ResourceOperationalRelationshipID != fixture.edge.ResourceOperationalRelationshipID {
		t.Fatalf("binding lost saved Steps or connections: %+v", definition)
	}
	if len(definition.SOP) != 1 || definition.SOP[0].TextboxID != fixture.sop.DocumentID || definition.SOP[0].Revision != 1 || !strings.Contains(string(definition.SOP[0].Document), "Use only meeting facts") {
		t.Fatalf("binding lost canonical SOP: %+v", definition.SOP)
	}
	after, err := repo.GetLogicGateWork(assistantTestCompany, fixture.process.LogicGateID, fixture.user.UserID)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("binding mutated Process work: before=%+v after=%+v err=%v", before, after, err)
	}
	const changedSOP = "Inspect the plant records, then write the revised watering plan."
	if _, err := repo.CommitEditorJSONDocument(store.EditorJSONCommitInput{Document: fixture.sop, OperationID: store.NewUUIDv7String(), ClientID: "human-editor", ActorUserID: fixture.user.UserID, BaseRevision: 1, SchemaVersion: store.MangoTiptapSchemaVersion, JSONDocument: assistantProcessTestSOP(changedSOP)}); err != nil {
		t.Fatal(err)
	}
	renamed := "Write the revised watering plan"
	if _, err := repo.UpdateProcessStep(store.ProcessStepUpdateInput{CompanyID: assistantTestCompany, LogicGateID: fixture.process.LogicGateID, ProcessStepID: fixture.last.ProcessStepID, Name: &renamed, ActorUserID: fixture.user.UserID}); err != nil {
		t.Fatal(err)
	}
	refreshed, err := server.bindAssistantProcess(r, fixture.process.LogicGateID, emit)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.definition.SOP[0].Revision != 2 || !strings.Contains(refreshed.definitionJSON, changedSOP) || refreshed.definition.Steps[1].Name != renamed {
		t.Fatalf("new interaction did not read changed live definition: %+v", refreshed.definition)
	}
	if strings.Contains(bound.definitionJSON, changedSOP) || bound.definition.SOP[0].Revision != 1 {
		t.Fatal("fresh binding rewrote the prior interaction snapshot")
	}
	nodes, err := repo.ListNodes(assistantTestCompany)
	if err != nil || len(nodes) != 0 {
		t.Fatalf("discussion binding created Nodes: %+v, %v", nodes, err)
	}
}

func TestAssistantPiDiscoversBindsAndExecutesThreeAuthoredSteps(t *testing.T) {
	var calls atomic.Int32
	var fixture assistantProcessFixture
	var finalStep domain.ProcessStep
	var skillPath string
	var saved []store.EditorJSONSnapshot
	server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "bad provider request", http.StatusBadRequest)
			return
		}
		switch calls.Add(1) {
		case 1:
			prompt := assistantProcessInputText(body["input"])
			_, catalog, found := strings.Cut(prompt, "<location>")
			if !found {
				t.Error("native skill discovery was absent from the provider request")
			} else {
				skillPath, _, _ = strings.Cut(catalog, "</location>")
			}
			assistantProviderComplete(w, assistantProviderCall("search", "list_processes", fmt.Sprintf(`{"query":%q}`, fixture.process.Header)))
		case 2:
			if !strings.Contains(assistantProcessInputText(body["input"]), fixture.process.LogicGateID) {
				t.Error("search did not return the exact saved Process identity")
			}
			assistantProviderComplete(w, assistantProviderCall("bind", "bind_process", fmt.Sprintf(`{"process_id":%q}`, fixture.process.LogicGateID)))
		case 3:
			tools, _ := body["tools"].([]any)
			if len(tools) != 6 {
				t.Errorf("discovery did not switch to Process tools plus native read: %+v", tools)
			}
			for _, tool := range tools {
				name := tool.(map[string]any)["name"]
				if name != "read" && name != "create_process_node" && name != "write_process_node" && name != "move_process_node_to_step" && name != "list_chat_users" && name != "send_process_node_chat" {
					t.Errorf("bound interaction retained a broad tool: %v", name)
				}
			}
			if !strings.Contains(assistantProcessInputText(body["input"]), finalStep.ProcessStepID) {
				t.Error("bind result omitted the third authored Step")
			}
			assistantProviderComplete(w, assistantProviderCall("skill", "read", fmt.Sprintf(`{"path":%q}`, skillPath)))
		case 4:
			assistantProviderComplete(w, assistantProviderCall("create", "create_process_node", fmt.Sprintf(`{"name":"Written field visit plan","process_step_id":%q}`, fixture.first.ProcessStepID)))
		case 5:
			assistantProviderComplete(w, assistantProviderCall("write_first", "write_process_node", `{"plain_text":"Written summary: north beds need a measurement check. No physical inspection was performed."}`))
		case 6:
			assistantProviderComplete(w, assistantProviderCall("move_second", "move_process_node_to_step", fmt.Sprintf(`{"process_step_id":%q}`, fixture.last.ProcessStepID)))
		case 7:
			assistantProviderComplete(w, assistantProviderCall("write_second", "write_process_node", `{"plain_text":"Draft checklist: measure each bed and record its shade. This is a written plan."}`))
		case 8:
			assistantProviderComplete(w, assistantProviderCall("move_third", "move_process_node_to_step", fmt.Sprintf(`{"process_step_id":%q}`, finalStep.ProcessStepID)))
		case 9:
			assistantProviderComplete(w, assistantProviderCall("write_third", "write_process_node", `{"plain_text":"Draft review questions: which bed needs watering first? No external message was sent."}`))
		default:
			inputs, _ := body["input"].([]any)
			for _, raw := range inputs {
				item, _ := raw.(map[string]any)
				output, _ := item["output"].(string)
				var snapshot store.EditorJSONSnapshot
				if item["type"] == "function_call_output" && json.Unmarshal([]byte(output), &snapshot) == nil && snapshot.Document.ResourceType == store.EntityTypeNode {
					saved = append(saved, snapshot)
				}
			}
			assistantProviderComplete(w)
		}
	})
	fixture = seedAssistantProcess(t, repo, "Plan the north garden visit")
	created, err := repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: assistantTestCompany, LogicGateID: fixture.process.LogicGateID, Name: "Draft review questions", AfterProcessStepID: &fixture.last.ProcessStepID, ActorUserID: fixture.user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	finalStep = *created.Step
	const sop = "Write a field visit summary, then a checklist, then review questions. Work from the supplied measurements. This is a written plan; do not claim a physical visit."
	if _, err := repo.CommitEditorJSONDocument(store.EditorJSONCommitInput{Document: fixture.sop, OperationID: store.NewUUIDv7String(), ClientID: "garden-author", ActorUserID: fixture.user.UserID, BaseRevision: 1, SchemaVersion: store.MangoTiptapSchemaVersion, JSONDocument: assistantProcessTestSOP(sop)}); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, assistantContextChatRequest(assistantRequest{Messages: []assistantMessage{{Role: "user", Content: "Find Plan the north garden visit and carry it out as a written plan. The north beds need a measurement check."}}}))
	if calls.Load() != 10 || !strings.Contains(response.Body.String(), `"type":"done"`) || strings.Contains(response.Body.String(), `"type":"error"`) {
		t.Fatalf("same-interaction discovery/skill/execution failed: calls=%d body=%s", calls.Load(), response.Body.String())
	}
	nodes, err := repo.ListNodes(assistantTestCompany)
	if err != nil || len(nodes) != 1 || len(saved) != 3 {
		t.Fatalf("expected one Node and three canonical documents: nodes=%+v documents=%+v err=%v", nodes, saved, err)
	}
	assignments, err := repo.ListNodeLogicGateAssignments(assistantTestCompany, nodes[0].NodeID)
	if err != nil || len(assignments) != 1 || assignments[0].ProcessStepID == nil || *assignments[0].ProcessStepID != finalStep.ProcessStepID {
		t.Fatalf("Node did not reach its authored final Step: %+v, %v", assignments, err)
	}
	for _, document := range saved {
		actual, err := repo.GetEditorJSONSnapshot(document.Document)
		if err != nil || actual.Document.ResourceID != nodes[0].NodeID || string(actual.JSONDocument) != string(document.JSONDocument) {
			t.Fatalf("provider continuation did not contain actual saved text: %+v, %v", actual, err)
		}
	}
	if !strings.Contains(response.Body.String(), `"type":"process"`) || !strings.Contains(response.Body.String(), `"name":"Plan the north garden visit"`) || !strings.Contains(response.Body.String(), `"node_id":"`+nodes[0].NodeID+`"`) {
		t.Fatalf("discovered binding or saved Node link absent: %s", response.Body.String())
	}
}

func TestAssistantPiDiscoveryDiscussionAndClarificationDoNotCreateWork(t *testing.T) {
	for _, ambiguous := range []bool{false, true} {
		t.Run(fmt.Sprintf("ambiguous_%t", ambiguous), func(t *testing.T) {
			var calls atomic.Int32
			var fixture assistantProcessFixture
			server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				switch calls.Add(1) {
				case 1:
					assistantProviderComplete(w, assistantProviderCall("search", "list_processes", `{"query":"Review sample notes"}`))
				case 2:
					if !ambiguous {
						assistantProviderComplete(w, assistantProviderCall("bind", "bind_process", fmt.Sprintf(`{"process_id":%q}`, fixture.process.LogicGateID)))
						return
					}
					assistantProviderEvent(w, map[string]any{"type": "response.output_text.delta", "delta": "Do you mean the garden or library Process?"})
					assistantProviderComplete(w)
				default:
					assistantProviderEvent(w, map[string]any{"type": "response.output_text.delta", "delta": "The saved SOP asks for a summary followed by action items."})
					assistantProviderComplete(w)
				}
			})
			fixture = seedAssistantProcess(t, repo, "Review sample notes for the garden")
			if ambiguous {
				seedAssistantProcess(t, repo, "Review sample notes for the library")
			}
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, assistantContextChatRequest(assistantRequest{Messages: []assistantMessage{{Role: "user", Content: "What does Review sample notes say to do?"}}}))
			wantCalls := int32(3)
			if ambiguous {
				wantCalls = 2
			}
			nodes, err := repo.ListNodes(assistantTestCompany)
			if calls.Load() != wantCalls || err != nil || len(nodes) != 0 || !strings.Contains(response.Body.String(), `"type":"done"`) || strings.Contains(response.Body.String(), `"type":"error"`) {
				t.Fatalf("discussion mutated or failed: calls=%d nodes=%+v err=%v body=%s", calls.Load(), nodes, err, response.Body.String())
			}
			if strings.Contains(response.Body.String(), `"type":"process"`) == ambiguous {
				t.Fatalf("binding did not follow actual model selection: %s", response.Body.String())
			}
		})
	}
}

func TestAssistantPiBindingRejectsBroadToolFromSameModelBatch(t *testing.T) {
	var calls atomic.Int32
	var fixture assistantProcessFixture
	server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		assistantProviderComplete(w,
			assistantProviderCall("bind", "bind_process", fmt.Sprintf(`{"process_id":%q}`, fixture.process.LogicGateID)),
			assistantProviderCall("broad_write", "create_process", `{"name":"This Process must not exist"}`),
		)
	})
	fixture = seedAssistantProcess(t, repo, "Discuss a saved definition")
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, assistantContextChatRequest(assistantRequest{Messages: []assistantMessage{{Role: "user", Content: "Explain the saved definition."}}}))
	processes, err := repo.ListLogicGates(assistantTestCompany)
	if calls.Load() != 1 || err != nil || len(processes) != 1 || !strings.Contains(response.Body.String(), `"type":"error"`) || strings.Contains(response.Body.String(), `"type":"done"`) {
		t.Fatalf("a tool from the old catalog executed after binding: calls=%d processes=%+v err=%v body=%s", calls.Load(), processes, err, response.Body.String())
	}
}

func TestAssistantBindingRejectsInvalidOrUnauthorizedIdentity(t *testing.T) {
	server, repo := assistantTestServer(t, nil)
	fixture := seedAssistantProcess(t, repo, "Private research procedure")
	member := mustRealtimeAuthUser(t, repo, assistantTestCompany, "binding-member", domain.RoleCompanyUser)
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: assistantTestCompany, EntityType: store.EntityTypeLogicGate, EntityID: fixture.process.LogicGateID, DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true, ActorUserID: fixture.user.UserID}); err != nil {
		t.Fatal(err)
	}
	const otherCompany = "92929292-9292-4292-8292-929292929292"
	repo.EnsureCompany(otherCompany, "Other company")
	foreign, err := repo.CreateLogicGate(otherCompany, "Foreign private procedure")
	if err != nil {
		t.Fatal(err)
	}
	adminRequest := assistantToolRequest(fixture.user, assistantTestCompany, domain.RoleCompanyAdmin)
	staleRequest := assistantToolRequest(member, assistantTestCompany, domain.RoleCompanyAdmin)
	staleActor, _ := authenticatedActor(staleRequest)
	staleActor.IsDevAdmin = true
	staleRequest = staleRequest.WithContext(context.WithValue(staleRequest.Context(), actorContextKey{}, staleActor))
	cancelled, cancel := context.WithCancel(adminRequest.Context())
	cancel()
	for _, scenario := range []struct {
		name, id string
		request  *http.Request
	}{
		{"invalid_name", fixture.process.Header, adminRequest},
		{"missing", store.NewUUIDv7String(), adminRequest},
		{"permission_denied", fixture.process.LogicGateID, assistantToolRequest(member, assistantTestCompany, domain.RoleCompanyUser)},
		{"stale_admin_role", fixture.process.LogicGateID, staleRequest},
		{"cross_company", foreign.LogicGateID, adminRequest},
		{"unauthenticated", fixture.process.LogicGateID, httptest.NewRequest(http.MethodPost, "/v1/assistant/chat", nil)},
		{"cancelled", fixture.process.LogicGateID, adminRequest.WithContext(cancelled)},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			emitted := false
			bound, err := server.bindAssistantProcess(scenario.request, scenario.id, func(assistantEvent) error { emitted = true; return nil })
			if err == nil || bound != nil || emitted {
				t.Fatalf("invalid binding succeeded: bound=%+v emitted=%t err=%v", bound, emitted, err)
			}
			if strings.Contains(err.Error(), fixture.process.Header) || strings.Contains(err.Error(), foreign.Header) {
				t.Fatalf("denial disclosed protected Process content: %v", err)
			}
		})
	}
	nodes, err := repo.ListNodes(assistantTestCompany)
	if err != nil || len(nodes) != 0 {
		t.Fatalf("rejected binding created Nodes: %+v, %v", nodes, err)
	}
}

func TestAssistantBindingRejectsUnretainedEventAndInvalidArguments(t *testing.T) {
	server, repo := assistantTestServer(t, nil)
	fixture := seedAssistantProcess(t, repo, "A Process to inspect")
	captureErr := errors.New("interaction capture unavailable")
	bound, err := server.bindAssistantProcess(assistantToolRequest(fixture.user, assistantTestCompany, domain.RoleCompanyAdmin), fixture.process.LogicGateID, func(assistantEvent) error { return captureErr })
	if !errors.Is(err, captureErr) || bound != nil {
		t.Fatalf("binding ignored failed retention: bound=%+v err=%v", bound, err)
	}
	for _, arguments := range []string{`{}`, `{"process_id":null}`, `{"process_id":"a saved name"}`, fmt.Sprintf(`{"process_id":%q,"company_id":%q}`, fixture.process.LogicGateID, assistantTestCompany)} {
		if _, err := assistantArgumentsForTools(assistantBindingTools(), "bind_process", arguments); err == nil {
			t.Fatalf("binding accepted invalid arguments: %s", arguments)
		}
	}
	if _, err := assistantArgumentsForTools(assistantBindingTools(), "bind_process", fmt.Sprintf(`{"process_id":%q}`, fixture.process.LogicGateID)); err != nil {
		t.Fatalf("binding rejected exact saved identity: %v", err)
	}
}

func TestAssistantBoundProcessCommandsUseDifferentAuthoredDefinitions(t *testing.T) {
	for _, scenario := range []struct{ name, first, last, sop string }{
		{"Plan an orchard visit", "Summarize tree records", "Write the visit checklist", "Use the supplied tree records to write a visit checklist."},
		{"Compare library notes", "List book observations", "Draft questions for the librarian", "Compare the supplied reading notes and draft questions without contacting anyone."},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			server, repo := assistantTestServer(t, nil)
			fixture := seedAssistantProcess(t, repo, scenario.name)
			for id, name := range map[string]string{fixture.first.ProcessStepID: scenario.first, fixture.last.ProcessStepID: scenario.last} {
				if _, err := repo.UpdateProcessStep(store.ProcessStepUpdateInput{CompanyID: assistantTestCompany, LogicGateID: fixture.process.LogicGateID, ProcessStepID: id, Name: &name, ActorUserID: fixture.user.UserID}); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := repo.CommitEditorJSONDocument(store.EditorJSONCommitInput{Document: fixture.sop, OperationID: store.NewUUIDv7String(), ClientID: "authored-definition", ActorUserID: fixture.user.UserID, BaseRevision: 1, SchemaVersion: store.MangoTiptapSchemaVersion, JSONDocument: assistantProcessTestSOP(scenario.sop)}); err != nil {
				t.Fatal(err)
			}
			r := assistantToolRequest(fixture.user, assistantTestCompany, domain.RoleCompanyAdmin)
			var events []assistantEvent
			emit := func(event assistantEvent) error { events = append(events, event); return nil }
			bound, err := server.bindAssistantProcess(r, fixture.process.LogicGateID, emit)
			if err != nil {
				t.Fatal(err)
			}
			if bound.definition.Steps[0].Name != scenario.first || bound.definition.Steps[1].Name != scenario.last || !strings.Contains(bound.definitionJSON, scenario.sop) {
				t.Fatalf("binding did not use authored content: %+v", bound.definition)
			}
			if _, err := server.dispatchAssistantProcessTool(r, bound, "create_process_node", fmt.Sprintf(`{"name":%q,"process_step_id":%q}`, scenario.name, fixture.first.ProcessStepID), emit); err != nil {
				t.Fatal(err)
			}
			var documents []store.EditorJSONSnapshot
			for i, text := range []string{scenario.first + ": written notes for this test.", scenario.last + ": written plan only; no external action performed."} {
				if i == 1 {
					if _, err := server.dispatchAssistantProcessTool(r, bound, "move_process_node_to_step", fmt.Sprintf(`{"process_step_id":%q}`, fixture.last.ProcessStepID), emit); err != nil {
						t.Fatal(err)
					}
				}
				result, err := server.dispatchAssistantProcessTool(r, bound, "write_process_node", fmt.Sprintf(`{"plain_text":%q}`, text), emit)
				if err != nil {
					t.Fatal(err)
				}
				var snapshot store.EditorJSONSnapshot
				if err := json.Unmarshal([]byte(result), &snapshot); err != nil || snapshot.Document.ResourceID != bound.nodeID || snapshot.Revision != 1 || !strings.Contains(string(snapshot.JSONDocument), text) {
					t.Fatalf("tool did not return actual saved text: %s, %v", result, err)
				}
				documents = append(documents, snapshot)
			}
			if documents[0].Document.DocumentID == documents[1].Document.DocumentID {
				t.Fatal("second Step overwrote the first textbox")
			}
			nodes, err := repo.ListNodes(assistantTestCompany)
			if err != nil || len(nodes) != 1 || nodes[0].NodeID != bound.nodeID || nodes[0].Status == nil || *nodes[0].Status != "In Progress" {
				t.Fatalf("expected one saved active Node: %+v, %v", nodes, err)
			}
			assignments, err := repo.ListNodeLogicGateAssignments(assistantTestCompany, bound.nodeID)
			if err != nil || len(assignments) != 1 || assignments[0].LogicGateID != fixture.process.LogicGateID || assignments[0].ProcessStepID == nil || *assignments[0].ProcessStepID != fixture.last.ProcessStepID || assignments[0].Version != bound.assignmentVersion {
				t.Fatalf("saved placement did not match bound Process: %+v, %v", assignments, err)
			}
			if len(events) != 2 || events[1].Type != "node" || events[1].NodeID != bound.nodeID || events[1].ProcessID != fixture.process.LogicGateID {
				t.Fatalf("Node event omitted actual saved link: %+v", events)
			}
		})
	}
}
