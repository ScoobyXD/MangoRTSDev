package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func assistantContextChatRequest(request assistantRequest) *http.Request {
	if request.RequestID == "" {
		request.RequestID = store.NewUUIDv7String()
	}
	if request.ReasoningEffort == "" {
		request.ReasoningEffort = "medium"
	}
	body, _ := json.Marshal(request)
	r := httptest.NewRequest(http.MethodPost, "/v1/assistant/chat?company_id="+assistantTestCompany, bytes.NewReader(body))
	r.Header.Set("Authorization", "Bearer assistant-token")
	r.Header.Set("Content-Type", "application/json")
	return r
}

func assistantDeveloperContext(t *testing.T, input any) map[string]any {
	t.Helper()
	items, ok := input.([]any)
	if !ok || len(items) == 0 {
		t.Fatal("provider request has no input")
	}
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if item["role"] != "developer" {
			continue
		}
		content, _ := item["content"].(string)
		start := strings.Index(content, "{")
		var result map[string]any
		if start >= 0 && json.Unmarshal([]byte(content[start:]), &result) == nil {
			return result
		}
	}
	t.Fatal("provider input lacks structured developer context")
	return nil
}

func assistantContextEvents(t *testing.T, body string) []map[string]any {
	t.Helper()
	var contexts []map[string]any
	for _, line := range strings.Split(body, "\n") {
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event); err != nil {
			t.Fatal(err)
		}
		if event["type"] == "context" {
			value, ok := event["context"].(map[string]any)
			if !ok {
				t.Fatal("context event has no context object")
			}
			contexts = append(contexts, value)
		}
	}
	return contexts
}

func TestAssistantOrdinaryChatInjectsCurrentUserWithoutInspection(t *testing.T) {
	for _, role := range []string{domain.RoleCompanyUser, domain.RoleCompanyAdmin, domain.RoleDevAdmin} {
		t.Run(role, func(t *testing.T) {
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
			user, err := repo.GetAuthUser("assistant-user")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repo.AddCompanyMembership(user.CognitoSubject, assistantTestCompany, role); err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, assistantContextChatRequest(assistantRequest{Messages: []assistantMessage{{Role: "user", Content: "Who am I?"}}}))
			if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"type":"done"`) {
				t.Fatalf("ordinary chat failed: %d %s", response.Code, response.Body.String())
			}
			select {
			case body := <-captured:
				want := map[string]any{"user_id": user.UserID, "display_name": user.DisplayName, "email": user.Email, "company_id": assistantTestCompany, "company_role": role}
				if got := assistantDeveloperContext(t, body["input"]); !reflect.DeepEqual(got, want) {
					t.Fatalf("automatic user context = %#v, want %#v", got, want)
				}
			default:
				t.Fatal("ordinary request never reached the provider")
			}
			if len(assistantContextEvents(t, response.Body.String())) != 0 {
				t.Fatal("context inspection was emitted without opting in")
			}
		})
	}
}

func TestAssistantContextInspectionRequiresFreshDeveloperRole(t *testing.T) {
	for _, role := range []string{domain.RoleCompanyUser, domain.RoleCompanyAdmin, domain.RoleDevAdmin} {
		t.Run(role, func(t *testing.T) {
			var providerCalls atomic.Int32
			server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				providerCalls.Add(1)
				assistantProviderComplete(w)
			})
			user, err := repo.GetAuthUser("assistant-user")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repo.AddCompanyMembership(user.CognitoSubject, assistantTestCompany, domain.RoleDevAdmin); err != nil {
				t.Fatal(err)
			}
			// Keep stale developer privileges in the request after a possible demotion.
			stale := ActorContext{User: user, CompanyID: assistantTestCompany, CompanyRole: domain.RoleDevAdmin, IsDevAdmin: true,
				Memberships: []domain.CompanyMembership{{CompanyID: assistantTestCompany, UserID: user.UserID, Role: domain.RoleDevAdmin}}}
			if _, err := repo.AddCompanyMembership(user.CognitoSubject, assistantTestCompany, role); err != nil {
				t.Fatal(err)
			}
			request := assistantContextChatRequest(assistantRequest{InspectContext: true, Messages: []assistantMessage{{Role: "user", Content: "Show my context."}}})
			request = request.WithContext(context.WithValue(request.Context(), actorContextKey{}, stale))
			status := httptest.NewRecorder()
			statusRequest := httptest.NewRequest(http.MethodGet, "/v1/assistant/status", nil).WithContext(request.Context())
			server.handleAssistantStatus(status, statusRequest)
			var availability map[string]bool
			if status.Code != http.StatusOK || json.Unmarshal(status.Body.Bytes(), &availability) != nil || availability["can_inspect_context"] != (role == domain.RoleDevAdmin) {
				t.Fatalf("stale status privileges: %d %s", status.Code, status.Body.String())
			}
			response := httptest.NewRecorder()
			server.handleAssistantChat(response, request)
			if role == domain.RoleDevAdmin {
				if response.Code != http.StatusOK || providerCalls.Load() != 1 || len(assistantContextEvents(t, response.Body.String())) != 1 {
					t.Fatalf("current developer inspection failed: %d %s", response.Code, response.Body.String())
				}
			} else if response.Code != http.StatusForbidden || providerCalls.Load() != 0 || len(assistantContextEvents(t, response.Body.String())) != 0 {
				t.Fatalf("stale developer inspection allowed: calls=%d status=%d %s", providerCalls.Load(), response.Code, response.Body.String())
			}
		})
	}
}

func TestAssistantContextInspectionMatchesProviderInputWithoutEncryptedReasoning(t *testing.T) {
	var calls atomic.Int32
	captured := make(chan map[string]any, 2)
	server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "invalid request", 500)
			return
		}
		captured <- body
		if calls.Add(1) == 1 {
			assistantProviderComplete(w,
				map[string]any{"type": "reasoning", "id": "rs_context_test", "summary": []any{}, "encrypted_content": "private-encrypted-reasoning"},
				map[string]any{"type": "message", "id": "msg_context_test", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "I will read your current membership.", "annotations": []any{}}}},
				assistantProviderCall("context_get_me", "get_me", `{}`))
			return
		}
		assistantProviderComplete(w)
	})
	if _, err := repo.AddCompanyMembership("assistant-user", assistantTestCompany, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, assistantContextChatRequest(assistantRequest{InspectContext: true, ReasoningEffort: "max", Messages: []assistantMessage{{Role: "user", Content: "Read my membership."}}}))
	if response.Code != http.StatusOK || calls.Load() != 2 || !strings.Contains(response.Body.String(), `"type":"done"`) {
		t.Fatalf("inspection continuation failed: calls=%d %d %s", calls.Load(), response.Code, response.Body.String())
	}
	first, second := <-captured, <-captured
	contexts := assistantContextEvents(t, response.Body.String())
	if len(contexts) != 2 {
		t.Fatalf("inspection events=%d, want 2", len(contexts))
	}
	for _, field := range []string{"model", "instructions", "tools", "input"} {
		if !reflect.DeepEqual(contexts[0][field], first[field]) {
			t.Errorf("first inspection %s differs from the provider request", field)
		}
	}
	reasoning, _ := first["reasoning"].(map[string]any)
	if contexts[0]["reasoning_effort"] != reasoning["effort"] || contexts[0]["step"] != float64(1) || contexts[0]["omitted_reasoning_items"] != float64(0) {
		t.Errorf("first inspection metadata: %+v", contexts[0])
	}
	for _, field := range []string{"model", "instructions", "tools", "reasoning_effort"} {
		if _, exists := contexts[1][field]; exists {
			t.Errorf("continuation repeats first-call %s", field)
		}
	}
	initialInput := first["input"].([]any)
	continuedInput := second["input"].([]any)
	wantNew := []any{}
	kinds := map[string]bool{}
	for _, raw := range continuedInput[len(initialInput):] {
		item := raw.(map[string]any)
		if item["type"] == "reasoning" {
			if item["encrypted_content"] != "private-encrypted-reasoning" {
				t.Error("provider continuation lost its encrypted reasoning")
			}
			continue
		}
		kind, _ := item["type"].(string)
		kinds[kind] = true
		wantNew = append(wantNew, raw)
	}
	if !reflect.DeepEqual(contexts[1]["input"], wantNew) || contexts[1]["step"] != float64(2) || contexts[1]["omitted_reasoning_items"] != float64(1) {
		t.Errorf("continuation inspection differs from new readable provider input: %+v", contexts[1])
	}
	for _, kind := range []string{"message", "function_call", "function_call_output"} {
		if !kinds[kind] {
			t.Errorf("continuation lacks %s", kind)
		}
	}
	for _, secret := range []string{"private-encrypted-reasoning", "unit-test-key"} {
		if strings.Contains(response.Body.String(), secret) {
			t.Errorf("inspection exposed %s", secret)
		}
	}
}

func TestAssistantContextInspectionStopsAfterDeveloperRoleIsRevoked(t *testing.T) {
	var calls atomic.Int32
	var repo *store.MemoryRepo
	server, memory := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if _, err := repo.AddCompanyMembership("assistant-user", assistantTestCompany, domain.RoleCompanyAdmin); err != nil {
			t.Error(err)
			http.Error(w, "demotion failed", 500)
			return
		}
		assistantProviderComplete(w, assistantProviderCall("revoked_get_me", "get_me", `{}`))
	})
	repo = memory
	if _, err := repo.AddCompanyMembership("assistant-user", assistantTestCompany, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, assistantContextChatRequest(assistantRequest{InspectContext: true, Messages: []assistantMessage{{Role: "user", Content: "Inspect and read my membership."}}}))
	if calls.Load() != 1 || len(assistantContextEvents(t, response.Body.String())) != 1 || !strings.Contains(response.Body.String(), `"type":"error"`) || strings.Contains(response.Body.String(), `"type":"done"`) {
		t.Fatalf("revoked inspection continued: calls=%d response=%d %s", calls.Load(), response.Code, response.Body.String())
	}
}
