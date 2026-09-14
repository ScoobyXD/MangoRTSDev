package openaiagents

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
)

func TestSessionProtocol(t *testing.T) {
	var eventBodies []map[string]any
	var resultKeys []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-key" || r.Header.Get("OpenAI-Beta") != "agents=v1" {
			t.Error("missing provider authentication or beta header")
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/agents/sessions":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			agent := body["agent"].(map[string]any)
			if agent["model"] != "gpt-5.6-terra" || agent["instructions"] != "Use scoped app tools." || body["input"] != "Review my emails" || body["stream"] != false {
				t.Errorf("incorrect session request: %#v", body)
			}
			if !reflect.DeepEqual(body["environment"], map[string]any{"type": "none"}) {
				t.Errorf("unexpected execution environment: %#v", body["environment"])
			}
			function := agent["tools"].([]any)[0].(map[string]any)
			if function["type"] != "function" || function["name"] != "read_mailbox" {
				t.Errorf("unexpected tools: %#v", agent["tools"])
			}
			w.WriteHeader(http.StatusCreated)
			io.WriteString(w, `{"id":"asess_test","status":"in_progress","agent":{"model":"gpt-5.6-terra"},"required_actions":[]}`)
		case r.Method == http.MethodGet && r.URL.Path == "/v1/agents/sessions/asess_test":
			io.WriteString(w, `{"id":"asess_test","status":"requires_action","agent":{"model":"gpt-5.6-terra"},"required_actions":[{"type":"function_call","turn_id":"turn_test","call_id":"call_test","name":"read_mailbox","arguments":{"after":"mail_100"}}]}`)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/agents/sessions/asess_test/events":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			event := body["events"].([]any)[0].(map[string]any)
			eventBodies = append(eventBodies, event)
			if event["type"] == "agent.session.input.tool_result" {
				resultKeys = append(resultKeys, r.Header.Get("Idempotency-Key"))
			}
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodDelete && r.URL.Path == "/v1/agents/sessions/asess_test":
			io.WriteString(w, `{"id":"asess_test","deleted":true,"object":"agent.session.deleted"}`)
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	c := NewClient("fixture-key", server.Client(), server.URL+"/v1")
	ctx := context.Background()
	tools := []FunctionTool{{Name: "read_mailbox", Description: "Read authorized mail", Parameters: map[string]any{"type": "object"}}}
	session, err := c.CreateSession(ctx, "gpt-5.6-terra", "Use scoped app tools.", "Review my emails", tools)
	if err != nil || session.ID != "asess_test" || session.Agent.Model != "gpt-5.6-terra" || tools[0].Type != "" {
		t.Fatalf("create: %#v, %v; input tools: %#v", session, err, tools)
	}
	session, err = c.RetrieveSession(ctx, session.ID)
	if err != nil || len(session.RequiredActions) != 1 || session.Agent.Model != "gpt-5.6-terra" {
		t.Fatalf("retrieve: %#v, %v", session, err)
	}
	call := session.RequiredActions[0]
	if call.Type != "function_call" || call.TurnID != "turn_test" || call.CallID != "call_test" || string(call.Arguments) != `{"after":"mail_100"}` {
		t.Fatalf("pending action was changed: %#v", call)
	}
	result := ToolResult{TurnID: call.TurnID, CallID: call.CallID, Success: true, Output: `{"messages":[],"has_more":false}`}
	if err := c.SubmitToolResult(ctx, session.ID, result); err != nil {
		t.Fatal(err)
	}
	if err := c.SubmitToolResult(ctx, session.ID, result); err != nil {
		t.Fatal(err)
	}
	if err := c.SubmitToolResult(ctx, session.ID, ToolResult{TurnID: call.TurnID, CallID: "call_denied", Error: "Permission denied"}); err != nil {
		t.Fatal(err)
	}
	if err := c.SendMessage(ctx, session.ID, "Continue with the next step"); err != nil {
		t.Fatal(err)
	}
	if err := c.Cancel(ctx, session.ID); err != nil {
		t.Fatal(err)
	}
	if err := c.DeleteSession(ctx, session.ID); err != nil {
		t.Fatal(err)
	}
	if len(eventBodies) != 5 || eventBodies[0]["output"] != result.Output || eventBodies[0]["success"] != true || eventBodies[0]["error"] != nil {
		t.Fatalf("incorrect successful tool result: %#v", eventBodies)
	}
	if eventBodies[2]["success"] != false || eventBodies[2]["error"] != "Permission denied" || eventBodies[2]["output"] != nil {
		t.Errorf("incorrect failed tool result: %#v", eventBodies[2])
	}
	if resultKeys[0] == "" || resultKeys[0] != resultKeys[1] || resultKeys[0] == resultKeys[2] {
		t.Errorf("tool result keys did not preserve call identity: %#v", resultKeys)
	}
	message := eventBodies[3]["input"].([]any)[0].(map[string]any)
	if len(eventBodies[3]) != 2 || eventBodies[3]["type"] != "agent.session.input.message" || message["role"] != "user" || message["content"].([]any)[0].(map[string]any)["type"] != "input_text" {
		t.Errorf("incorrect follow-up input: %#v", message)
	}
	if !reflect.DeepEqual(eventBodies[4], map[string]any{"type": "agent.session.input.cancel"}) {
		t.Errorf("incorrect cancellation: %#v", eventBodies[4])
	}
}

func TestPaginationAndTurnOutcomes(t *testing.T) {
	var pages []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/agents/sessions/asess_test/items":
			if r.URL.Query().Get("order") != "asc" || r.URL.Query().Get("limit") != "10" {
				t.Errorf("incorrect item pagination: %s", r.URL.RawQuery)
			}
			pages = append(pages, r.URL.Query().Get("after"))
			if r.URL.Query().Get("after") == "" {
				io.WriteString(w, `{"data":[{"id":"item_first","type":"message","role":"user","turn_id":"turn_test","status":"completed","content":[{"type":"input_text","text":"Start"}]}],"has_more":true,"last_id":"item_first"}`)
			} else {
				io.WriteString(w, `{"data":[{"id":"item_last","type":"message","role":"assistant","turn_id":"turn_test","status":"completed","phase":"final_answer","content":[{"type":"output_text","text":"Done"}]}],"has_more":false,"last_id":"item_last"}`)
			}
		case "/agents/sessions/asess_test/turns":
			if r.URL.Query().Get("order") != "desc" || r.URL.Query().Get("after") != "turn_next" {
				t.Errorf("incorrect turn pagination: %s", r.URL.RawQuery)
			}
			io.WriteString(w, `{"data":[{"id":"turn_test","status":"cancelled","subagent_id":null,"error":null},{"id":"turn_failed","status":"failed","subagent_id":null,"error":{"code":"usage_limit_exceeded","message":"private provider text"}}],"has_more":false,"last_id":"turn_failed"}`)
		default:
			t.Errorf("unexpected request: %s", r.URL)
		}
	}))
	defer server.Close()
	c := NewClient("fixture-key", server.Client(), server.URL)
	first, err := c.ListItems(context.Background(), "asess_test", "")
	if err != nil || len(first.Data) != 1 || !first.HasMore || first.LastID != "item_first" {
		t.Fatalf("first page: %#v; error: %v", first, err)
	}
	last, err := c.ListItems(context.Background(), "asess_test", first.LastID)
	if err != nil || len(last.Data) != 1 || last.HasMore || last.Data[0].Role != "ai" || last.Data[0].Content[0].Text != "Done" || !reflect.DeepEqual(pages, []string{"", "item_first"}) {
		t.Fatalf("last page: %#v; pages: %#v; error: %v", last, pages, err)
	}
	turns, err := c.ListTurns(context.Background(), "asess_test", "turn_next")
	if err != nil || len(turns.Data) != 2 || !turns.Data[0].Terminal() || turns.Data[0].Status != "cancelled" {
		t.Fatalf("turns: %#v, %v", turns, err)
	}
	turn := turns.Data[1]
	if !turn.Terminal() || turn.Error == nil || turn.Error.Code != "usage_limit_exceeded" || strings.Contains(turn.Error.Message, "private") {
		t.Fatalf("turn: %#v, %v", turn, err)
	}
	if (Turn{Status: "waiting"}).Terminal() || (Turn{Status: "idle"}).Terminal() {
		t.Error("waiting/idle were treated as completed")
	}
}

func TestProviderErrorsAndRedirectsDoNotExposePrivateData(t *testing.T) {
	var redirected atomic.Bool
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Store(true) }))
	defer destination.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/redirect") {
			http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/invalid") {
			io.WriteString(w, `{"id": "private`)
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"error":{"message":"private fixture-key"}}`)
	}))
	defer server.Close()
	c := NewClient("fixture-key", server.Client(), server.URL)
	for _, id := range []string{"redirect", "invalid", "denied"} {
		_, err := c.RetrieveSession(context.Background(), id)
		if err == nil || strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "fixture-key") {
			t.Fatalf("unsafe or missing %s error: %v", id, err)
		}
		if id == "denied" {
			var apiErr *APIError
			if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusUnauthorized {
				t.Fatalf("missing safe status code: %v", err)
			}
		}
	}
	if redirected.Load() {
		t.Error("authenticated request followed a redirect")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.RetrieveSession(ctx, "asess_test"); !errors.Is(err, context.Canceled) {
		t.Errorf("caller cancellation was lost: %v", err)
	}
}

func TestProviderRejectionDiagnostics(t *testing.T) {
	const requestID = "req_0123456789abcdef0123456789abcdef"
	for _, tc := range []struct {
		name, body, requestID, want string
		status                      int
	}{
		{"missing scopes", `{"error":{"message":"You have insufficient permissions. Missing scopes: api.agents.read, api.agents.write, api.responses.write. Check private fixture-key."}}`, requestID, "OpenAI reports missing permissions: api.agents.read, api.agents.write, api.responses.write; check both the key and its project role; OpenAI request ID: " + requestID, 403},
		{"verification", `{"error":{"message":"Your organization must be verified to use this model. private fixture-key"}}`, requestID, "OpenAI requires organization verification for this request; check OpenAI organization settings; OpenAI request ID: " + requestID, 403},
		{"region", `{"error":{"code":"unsupported_country_region_territory","message":"private fixture-key"}}`, "", "OpenAI rejected the request's country or region", 403},
		{"model", `{"error":{"code":"model_not_found","message":"private fixture-key"}}`, "", "OpenAI could not access the configured model; check its name and project access", 404},
		{"billing", `{"error":{"code":"project_spend_limit_exceeded","message":"private fixture-key"}}`, "", "OpenAI billing or usage restriction: project_spend_limit_exceeded", 429},
		{"unknown", `{"error":{"code":"private-fixture-key","message":"private fixture-key"}}`, requestID, "OpenAI denied this Agents API request (HTTP 403); OpenAI request ID: " + requestID, 403},
		{"unknown scopes", `{"error":{"message":"Missing scopes: private.fixture_key"}}`, "", "OpenAI denied this Agents API request (HTTP 403)", 403},
		{"unsafe request ID", `{}`, "req_private-fixture-key", "OpenAI denied this Agents API request (HTTP 403)", 403},
		{"invalid JSON", `<html>private fixture-key</html>`, requestID, "OpenAI denied this Agents API request (HTTP 403); OpenAI request ID: " + requestID, 403},
		{"oversized", strings.Repeat(" ", 64<<10) + `{"error":{"code":"model_not_found"}}`, "", "OpenAI denied this Agents API request (HTTP 403)", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("X-Request-Id", tc.requestID)
				w.WriteHeader(tc.status)
				io.WriteString(w, tc.body)
			}))
			defer server.Close()
			client := NewClient("fixture-key", server.Client(), server.URL)
			_, err := client.CreateSession(context.Background(), "gpt-5.6-luna", "instructions", "private", nil)
			var apiErr *APIError
			if !errors.As(err, &apiErr) || apiErr.StatusCode != tc.status || err.Error() != tc.want {
				t.Fatalf("got %v, want %q (HTTP %d)", err, tc.want, tc.status)
			}
			if strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "fixture-key") {
				t.Fatalf("provider rejection exposed private data: %v", err)
			}
		})
	}
}

func TestInvalidInputMakesNoProviderRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("invalid input reached provider") }))
	defer server.Close()
	c := NewClient("fixture-key", server.Client(), server.URL)
	if _, err := c.CreateSession(context.Background(), "gpt-5.6-luna", "instructions", " ", nil); err == nil {
		t.Error("empty initial input accepted")
	}
	if _, err := c.CreateSession(context.Background(), " ", "instructions", "request", nil); err == nil {
		t.Error("empty model accepted")
	}
	if _, err := c.CreateSession(context.Background(), "gpt-5.6-luna", "instructions", "request", []FunctionTool{{Type: "shell"}}); err == nil {
		t.Error("non-application tool accepted")
	}
	for _, id := range []string{"", "..", "../other", "asess_test%2Fother", "asess_test?x=y"} {
		if _, err := c.RetrieveSession(context.Background(), id); err == nil {
			t.Errorf("unsafe provider ID accepted: %q", id)
		}
	}
	if _, err := NewClient("", server.Client(), server.URL).RetrieveSession(context.Background(), "asess_test"); err == nil {
		t.Error("missing backend key accepted")
	}
}
