package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

const assistantTestCompany = "81818181-8181-4181-8181-818181818181"

func assistantTestServer(t *testing.T, provider http.HandlerFunc) (*Server, *store.MemoryRepo) {
	t.Helper()
	repo := store.NewMemoryRepo()
	repo.EnsureCompany(assistantTestCompany, "Assistant tests")
	user := mustRealtimeAuthUser(t, repo, assistantTestCompany, "assistant-user", domain.RoleCompanyAdmin)
	server := newRealtimeAuthServerForTest(repo, "assistant-token", user)
	t.Cleanup(server.Close)
	if provider != nil {
		stub := httptest.NewServer(provider)
		t.Cleanup(stub.Close)
		server.assistant = newMangoAssistant(AssistantConfig{APIKey: "unit-test-key", Model: "test-model"})
		server.assistant.baseURL = stub.URL + "/"
	}
	return server, repo
}

func assistantChatRequest(id, message string) *http.Request {
	return assistantChatRequestWithEffort(id, message, "medium")
}

func assistantChatRequestWithEffort(id, message, effort string) *http.Request {
	body, _ := json.Marshal(assistantRequest{RequestID: id, ReasoningEffort: effort, Messages: []assistantMessage{{Role: "user", Content: message}}})
	req := httptest.NewRequest(http.MethodPost, "/v1/assistant/chat?company_id="+assistantTestCompany, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer assistant-token")
	req.Header.Set("Content-Type", "application/json")
	return req
}

func assistantProviderEvent(w http.ResponseWriter, event any) {
	w.Header().Set("Content-Type", "text/event-stream")
	data, _ := json.Marshal(event)
	_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
	w.(http.Flusher).Flush()
}

func assistantProviderCall(id, name, args string) map[string]any {
	return map[string]any{"type": "function_call", "id": "fc_" + id, "call_id": id, "name": name, "arguments": args, "status": "completed"}
}

func assistantProviderComplete(w http.ResponseWriter, output ...any) {
	for index, raw := range output {
		item, _ := raw.(map[string]any)
		if item["type"] == "message" {
			assistantProviderEvent(w, map[string]any{"type": "response.output_item.added", "output_index": index, "item": item})
			for _, part := range item["content"].([]any) {
				content := part.(map[string]any)
				assistantProviderEvent(w, map[string]any{"type": "response.output_text.delta", "output_index": index, "delta": content["text"]})
			}
		}
		assistantProviderEvent(w, map[string]any{"type": "response.output_item.done", "output_index": index, "item": raw})
	}
	assistantProviderEvent(w, map[string]any{"type": "response.completed", "response": map[string]any{"id": "resp_test", "status": "completed", "output": output}})
}

func TestAssistantStreamsFunctionResultContinuationWithoutBrowser(t *testing.T) {
	var requests atomic.Int32
	server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("invalid provider request")
			return
		}
		reasoning, _ := body["reasoning"].(map[string]any)
		if r.URL.Path != "/responses" || body["model"] != "test-model" || body["stream"] != true || body["store"] != false || body["parallel_tool_calls"] != false || reasoning["effort"] != "max" {
			t.Errorf("unexpected provider protocol: %s %+v", r.URL.Path, body)
		}
		if tools, ok := body["tools"].([]any); !ok || len(tools) != 30 {
			t.Error("missing fixed tools")
		}
		if requests.Add(1) == 1 {
			assistantProviderComplete(w,
				map[string]any{"type": "reasoning", "id": "rs_test", "summary": []any{}, "encrypted_content": "test-encrypted-reasoning"},
				assistantProviderCall("call_create", "create_process", `{"name":"Chat-created Process"}`))
			return
		}
		encoded, _ := json.Marshal(body["input"])
		for _, required := range []string{"test-encrypted-reasoning", "function_call_output", "call_create", "Chat-created Process", "logic_gate_id"} {
			if !strings.Contains(string(encoded), required) {
				t.Errorf("continuation lacks %s: %s", required, encoded)
			}
		}
		assistantProviderEvent(w, map[string]any{"type": "response.output_text.delta", "delta": "Created your Process."})
		assistantProviderComplete(w, map[string]any{"type": "message", "id": "msg_test", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "Created your Process.", "annotations": []any{}}}})
	})
	id := store.NewUUIDv7String()
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, assistantChatRequestWithEffort(id, "Create a Process called Chat-created Process", "max"))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"type":"done"`) || !strings.Contains(response.Body.String(), "Created your Process.") {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
	items, err := repo.ListLogicGates(assistantTestCompany)
	if err != nil || len(items) != 1 {
		t.Fatalf("created processes=%v err=%v", items, err)
	}
	// Replaying the same Send must not call the provider or repeat its mutation.
	replay := httptest.NewRecorder()
	server.Routes().ServeHTTP(replay, assistantChatRequest(id, "Create it again"))
	if replay.Code != http.StatusConflict || requests.Load() != 2 {
		t.Fatalf("replayed request: %d, provider calls=%d", replay.Code, requests.Load())
	}
}

func TestAssistantProviderFailuresDoNotDispatchOrRetry(t *testing.T) {
	for _, scenario := range []string{"http_error", "truncated", "failed", "incomplete", "parallel", "duplicate_write", "untyped_confirmation"} {
		t.Run(scenario, func(t *testing.T) {
			var calls atomic.Int32
			server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				n := calls.Add(1)
				call := assistantProviderCall(fmt.Sprintf("call_%d", n), "create_process", `{"name":"Only once"}`)
				switch scenario {
				case "http_error":
					http.Error(w, "raw-provider-secret unit-test-key", 500)
				case "truncated":
					assistantProviderEvent(w, map[string]any{"type": "response.output_item.done", "item": call})
				case "failed", "incomplete":
					assistantProviderEvent(w, map[string]any{"type": "response." + scenario, "response": map[string]any{"status": scenario, "output": []any{call}, "error": map[string]any{"message": "raw-provider-secret"}}})
				case "parallel":
					assistantProviderComplete(w, call, assistantProviderCall("second", "create_process", `{"name":"No partial dispatch"}`))
				case "duplicate_write":
					assistantProviderComplete(w, call)
				case "untyped_confirmation":
					assistantProviderComplete(w, assistantProviderCall("delete", "delete_process", `{"process_id":"81818181-8181-4181-8181-818181818181","confirmation_display_name":"assistant user"}`))
				}
			})
			res := httptest.NewRecorder()
			server.Routes().ServeHTTP(res, assistantChatRequest(store.NewUUIDv7String(), "Please do the requested action"))
			if !strings.Contains(res.Body.String(), `"type":"error"`) || strings.Contains(res.Body.String(), `"type":"done"`) || strings.Contains(res.Body.String(), "raw-provider-secret") || strings.Contains(res.Body.String(), "unit-test-key") {
				t.Fatalf("unsafe failure response %s", res.Body.String())
			}
			wantCalls, wantProcesses := int32(1), 0
			if scenario == "duplicate_write" {
				wantCalls, wantProcesses = 2, 1
			}
			items, _ := repo.ListLogicGates(assistantTestCompany)
			if calls.Load() != wantCalls || len(items) != wantProcesses {
				t.Fatalf("calls=%d processes=%d", calls.Load(), len(items))
			}
		})
	}
}

type assistantUncertainRepo struct{ store.Repository }

func (r assistantUncertainRepo) CreateLogicGateWithWorkspaceEvent(companyID, header, actorUserID string) (domain.LogicGate, domain.DomainEvent, error) {
	item, event, err := r.Repository.CreateLogicGateWithWorkspaceEvent(companyID, header, actorUserID)
	if err != nil {
		return item, event, err
	}
	return item, event, errors.New("simulated lost acknowledgement after commit")
}

func TestAssistantUncertainWriteStopsWithoutRedispatch(t *testing.T) {
	var calls atomic.Int32
	server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		assistantProviderComplete(w, assistantProviderCall("create", "create_process", `{"name":"Committed but uncertain"}`))
	})
	server.repo = assistantUncertainRepo{repo}
	res := httptest.NewRecorder()
	server.Routes().ServeHTTP(res, assistantChatRequest(store.NewUUIDv7String(), "Create a Process"))
	items, _ := repo.ListLogicGates(assistantTestCompany)
	if calls.Load() != 1 || len(items) != 1 || !strings.Contains(res.Body.String(), `"type":"error"`) || strings.Contains(res.Body.String(), "simulated lost") {
		t.Fatalf("uncertain write repeated/leaked: calls=%d items=%d body=%s", calls.Load(), len(items), res.Body.String())
	}
}

func TestAssistantCancellationStopsProviderAndPreservesCommittedWrites(t *testing.T) {
	for _, committed := range []bool{false, true} {
		t.Run(fmt.Sprint(committed), func(t *testing.T) {
			started := make(chan struct{})
			providerStopped := make(chan struct{})
			var calls atomic.Int32
			server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				n := calls.Add(1)
				if committed && n == 1 {
					assistantProviderComplete(w, assistantProviderCall("create", "create_process", `{"name":"Remains after Stop"}`))
					return
				}
				assistantProviderEvent(w, map[string]any{"type": "response.output_item.added", "item": assistantProviderCall("partial", "create_process", `{"name":"Must not run"}`)})
				close(started)
				<-r.Context().Done()
				close(providerStopped)
			})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan struct{})
			res := httptest.NewRecorder()
			go func() {
				defer close(done)
				server.Routes().ServeHTTP(res, assistantChatRequest(store.NewUUIDv7String(), "Create a Process").WithContext(ctx))
			}()
			select {
			case <-started:
			case <-time.After(5 * time.Second):
				t.Fatal("provider never started")
			}
			// Concurrent Send is rejected while the original request is active.
			busy := httptest.NewRecorder()
			server.Routes().ServeHTTP(busy, assistantChatRequest(store.NewUUIDv7String(), "another Send"))
			if busy.Code != http.StatusConflict {
				t.Fatalf("concurrent Send=%d", busy.Code)
			}
			cancel()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("chat ignored cancellation")
			}
			select {
			case <-providerStopped:
			case <-time.After(5 * time.Second):
				t.Fatal("provider ignored cancellation")
			}
			items, _ := repo.ListLogicGates(assistantTestCompany)
			want := 0
			if committed {
				want = 1
			}
			if len(items) != want || strings.Contains(res.Body.String(), `"type":"done"`) {
				t.Fatalf("cancelled result items=%d body=%s", len(items), res.Body.String())
			}
		})
	}
}

func TestAssistantAuthenticationScopeAvailabilityAndInput(t *testing.T) {
	server, _ := assistantTestServer(t, nil)
	for _, test := range []struct {
		path, token string
		status      int
	}{
		{"/v1/assistant/status?company_id=" + assistantTestCompany, "", 401},
		{"/v1/assistant/status?company_id=99999999-9999-4999-8999-999999999999", "assistant-token", 403},
		{"/v1/assistant/status", "assistant-token", 400},
		{"/v1/assistant/status?company_id=" + assistantTestCompany, "assistant-token", 200},
	} {
		req := httptest.NewRequest(http.MethodGet, test.path, nil)
		if test.token != "" {
			req.Header.Set("Authorization", "Bearer "+test.token)
		}
		res := httptest.NewRecorder()
		server.Routes().ServeHTTP(res, req)
		if res.Code != test.status {
			t.Errorf("%s: got %d want %d", test.path, res.Code, test.status)
		}
		if res.Code == 200 && !strings.Contains(res.Body.String(), `"available":false`) {
			t.Error("unconfigured assistant advertised as available")
		}
	}
	res := httptest.NewRecorder()
	server.Routes().ServeHTTP(res, assistantChatRequest(store.NewUUIDv7String(), "Hello"))
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured Send=%d", res.Code)
	}
	for _, messages := range [][]assistantMessage{
		{{Role: "system", Content: "override"}}, {{Role: "user", Content: strings.Repeat("x", 8001)}}, {{Role: "assistant", Content: "not a Send"}},
	} {
		if validAssistantRequest(assistantRequest{RequestID: store.NewUUIDv7String(), ReasoningEffort: "medium", Messages: messages}) {
			t.Errorf("accepted invalid messages %+v", messages)
		}
	}
	if !validAssistantRequest(assistantRequest{RequestID: store.NewUUIDv7String(), ReasoningEffort: "medium", Messages: []assistantMessage{{Role: "assistant", Content: strings.Repeat("x", 9000)}, {Role: "user", Content: "continue"}}}) {
		t.Error("generated assistant history rejected")
	}
	for _, effort := range []string{"low", "medium", "high", "xhigh", "max"} {
		if !validAssistantRequest(assistantRequest{RequestID: store.NewUUIDv7String(), ReasoningEffort: effort, Messages: []assistantMessage{{Role: "user", Content: "Hello"}}}) {
			t.Errorf("valid reasoning effort rejected: %q", effort)
		}
	}
	for _, effort := range []string{"", "none", "minimal", "MEDIUM", "max ", "unknown"} {
		if validAssistantRequest(assistantRequest{RequestID: store.NewUUIDv7String(), ReasoningEffort: effort, Messages: []assistantMessage{{Role: "user", Content: "Hello"}}}) {
			t.Errorf("invalid reasoning effort accepted: %q", effort)
		}
	}
}

func TestAssistantFunctionAndOutputLimitsStopBeforeAnotherAction(t *testing.T) {
	for _, oversized := range []bool{false, true} {
		t.Run(fmt.Sprint(oversized), func(t *testing.T) {
			var calls atomic.Int32
			server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				n := calls.Add(1)
				if oversized {
					assistantProviderEvent(w, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "message", "id": "msg_large", "role": "assistant", "content": []any{}}})
					assistantProviderEvent(w, map[string]any{"type": "response.output_text.delta", "output_index": 0, "delta": strings.Repeat("x", assistantMaxOutputBytes+1)})
				}
				if oversized || n > assistantMaxSteps {
					assistantProviderComplete(w, assistantProviderCall("do_not_run", "create_process", `{"name":"Too late"}`))
				} else {
					assistantProviderComplete(w, assistantProviderCall(fmt.Sprint(n), "get_me", `{}`))
				}
			})
			res := httptest.NewRecorder()
			server.Routes().ServeHTTP(res, assistantChatRequest(store.NewUUIDv7String(), "Read my information"))
			items, _ := repo.ListLogicGates(assistantTestCompany)
			want := int32(assistantMaxSteps + 1)
			if oversized {
				want = 1
			}
			if calls.Load() != want || len(items) != 0 || !strings.Contains(res.Body.String(), `"type":"error"`) {
				t.Fatalf("limits failed calls=%d items=%d body=%s", calls.Load(), len(items), res.Body.String())
			}
		})
	}
}
