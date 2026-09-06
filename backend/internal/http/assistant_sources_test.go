package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestAssistantArchiveKeepsPromptSourcesWithoutInspectAndDoesNotSendThemToProvider(t *testing.T) {
	var calls atomic.Int32
	var requests []any
	server, memory := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		for _, auditOnly := range []string{"audit_sources", "tool_sources", "Current context assembly", "backend/internal/http/assistant_sources.go", "Known canonical storage mapping"} {
			if strings.Contains(string(body), auditOnly) {
				t.Errorf("provider received audit-only source metadata: %s", auditOnly)
			}
		}
		var request any
		if err := json.Unmarshal(body, &request); err != nil {
			t.Error(err)
		}
		requests = append(requests, request)
		if calls.Add(1) == 1 {
			assistantProviderComplete(w, assistantProviderCall("source_get_me", "get_me", `{}`))
			return
		}
		assistantProviderComplete(w)
	})
	archive := &assistantArchiveRepo{Repository: memory}
	server.repo = archive
	user, err := memory.GetAuthUser("assistant-user")
	if err != nil {
		t.Fatal(err)
	}
	id := store.NewUUIDv7String()
	response := httptest.NewRecorder()
	before := time.Now()
	server.Routes().ServeHTTP(response, assistantContextChatRequest(assistantRequest{RequestID: id, InspectContext: false,
		Messages: []assistantMessage{{Role: "user", Content: "Read my current profile."}}}))
	events := assistantSavedInspection(t, archive, user.UserID, id, "completed", before, time.Now())
	if response.Code != http.StatusOK || calls.Load() != 2 {
		t.Fatalf("ordinary Send failed: code=%d provider calls=%d body=%s", response.Code, calls.Load(), response.Body.String())
	}
	foundIdentity, foundToolRoute, foundAssembly := false, false, false
	var capturedBodies []any
	for _, event := range events {
		var data struct {
			Sources []assistantInputSource `json:"sources"`
			Body    any                    `json:"body"`
		}
		if err := json.Unmarshal(event.Data, &data); err != nil {
			t.Fatal(err)
		}
		for _, source := range data.Sources {
			foundIdentity = foundIdentity || source.Table == "public.users" && source.Key["user_id"] == user.UserID
			foundToolRoute = foundToolRoute || source.Label == "get_me" && strings.HasPrefix(source.Route, "GET /v1/me?")
			foundAssembly = foundAssembly || source.Symbol == "buildParams" && strings.HasSuffix(source.Path, "/api/openai-responses.js")
		}
		if event.Kind == "provider_request" && event.Status == "prepared" {
			if len(data.Sources) == 0 {
				t.Fatal("archived invocation is missing its source snapshot")
			}
			capturedBodies = append(capturedBodies, data.Body)
		}
	}
	if !foundIdentity || !foundToolRoute || !foundAssembly || !reflect.DeepEqual(capturedBodies, requests) {
		t.Fatalf("archive lost prompt provenance or exact provider bodies: identity=%v tool route=%v provider assembly=%v exact bodies=%v", foundIdentity, foundToolRoute, foundAssembly, reflect.DeepEqual(capturedBodies, requests))
	}
}

func TestAssistantSourcesIdentifyExactProcessDocumentsAndGeneratedToolRoutes(t *testing.T) {
	server, repo := assistantTestServer(t, nil)
	fixture := seedAssistantProcess(t, repo, "Source inspection fixture")
	operations := []assistantInputSource{}
	r := assistantToolRequest(fixture.user, assistantTestCompany, domain.RoleCompanyAdmin)
	r = r.WithContext(context.WithValue(r.Context(), assistantOperationSourcesKey{}, &operations))
	process, err := server.bindAssistantProcess(r, fixture.process.LogicGateID, func(assistantEvent) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	actor, _ := authenticatedActor(r)
	sources := assistantContextSources(actor, process)
	foundSOP, foundStep, foundConnection := false, false, false
	for _, source := range sources {
		if source.Table == "public.logic_gate_textboxes" && source.Key["textbox_id"] == fixture.sop.DocumentID && source.Revision == 1 && source.Key["logic_gate_id"] == fixture.process.LogicGateID {
			foundSOP = true
		}
		if source.Table == "public.process_steps" && source.Key["process_step_id"] == fixture.first.ProcessStepID {
			foundStep = true
		}
		if source.Table == "public.resource_operational_relationships" && source.Key["resource_operational_relationship_id"] == fixture.edge.ResourceOperationalRelationshipID {
			foundConnection = true
		}
	}
	if !foundSOP || !foundStep || !foundConnection {
		t.Fatalf("missing canonical Process sources: SOP=%v Step=%v connection=%v", foundSOP, foundStep, foundConnection)
	}
	create, _ := json.Marshal(map[string]any{"name": "Inspected work", "process_step_id": fixture.first.ProcessStepID})
	if _, err := server.dispatchAssistantProcessTool(r, process, "create_process_node", string(create), func(assistantEvent) error { return nil }); err != nil {
		t.Fatal(err)
	}
	operations = nil
	result, err := server.dispatchAssistantProcessTool(r, process, "write_process_node", `{"plain_text":"Saved exact content."}`, func(assistantEvent) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	var snapshot store.EditorJSONSnapshot
	if err := json.Unmarshal([]byte(result), &snapshot); err != nil {
		t.Fatal(err)
	}
	wantRoute := "/v1/editor-json/node/" + process.nodeID + "/documents/" + snapshot.Document.DocumentID
	foundWrite, foundRead, foundDocument := false, false, false
	for _, source := range operations {
		foundWrite = foundWrite || strings.HasPrefix(source.Route, "POST "+wantRoute+"?")
		foundRead = foundRead || strings.HasPrefix(source.Route, "GET "+wantRoute+"?")
		foundDocument = foundDocument || source.Table == "public.node_textboxes" && source.Key["node_id"] == process.nodeID && source.Key["textbox_id"] == snapshot.Document.DocumentID && source.Revision == snapshot.Revision
	}
	if !foundWrite || !foundRead || !foundDocument {
		t.Fatalf("generated document provenance missing: write=%v canonical read=%v stored document=%v", foundWrite, foundRead, foundDocument)
	}
}

func TestAssistantSourceCatalogTracksBindingAndDoesNotInventMembershipRow(t *testing.T) {
	actor := ActorContext{User: domain.User{UserID: "exact-user"}, CompanyID: "selected-company", IsDevAdmin: true}
	for _, source := range assistantContextSources(actor, nil) {
		if source.Table == "public.company_memberships" {
			if source.Key["user_id"] != actor.User.UserID || source.Key["company_id"] != "" || !strings.Contains(source.Note, "another company membership") {
				t.Fatal("global role was falsely attributed to one selected-company membership")
			}
		}
	}
	chat, bound := assistantToolSources(nil), assistantToolSources(&assistantProcessExecution{})
	contains := func(sources []assistantInputSource, label string) bool {
		for _, source := range sources {
			if source.Label == label {
				return true
			}
		}
		return false
	}
	if !contains(chat, "bind_process") || contains(chat, "create_process_node") || contains(bound, "bind_process") || !contains(bound, "create_process_node") {
		t.Fatal("source catalog does not match the actual mode-specific tools")
	}
}
