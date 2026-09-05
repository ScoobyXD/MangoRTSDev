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
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func assistantTraceFixture(t *testing.T) (*Server, *store.MemoryRepo, domain.User, string, *assistantCapture) {
	t.Helper()
	server, repo := assistantTestServer(t, nil)
	user := mustRealtimeAuthUser(t, repo, assistantTestCompany, "assistant-user", domain.RoleDevAdmin)
	server.assistant = &mangoAssistant{apiKey: "trace-fixture-key", active: map[string]bool{}, requests: map[string]time.Time{}, captures: map[string]*assistantCapture{}}
	id := store.NewUUIDv7String()
	owner := assistantTestCompany + ":" + user.UserID
	if !server.assistant.begin(owner, id) {
		t.Fatal("capture admission failed")
	}
	capture := server.assistant.captures[owner+":"+id]
	capture.inspect = true
	return server, repo, user, id, capture
}

func assistantTraceRequest(user domain.User, companyID, id string) *http.Request {
	return requestWithActorForTest(httptest.NewRequest(http.MethodGet, "/v1/assistant/trace?company_id="+companyID+"&request_id="+id, nil), user, companyID)
}

func TestAssistantTraceRecoveryRequiresFreshRoleExactActorAndCompany(t *testing.T) {
	for _, scenario := range []string{"finished", "demoted", "other actor", "other company", "not inspected", "expired", "unknown request", "invalid request"} {
		t.Run(scenario, func(t *testing.T) {
			server, repo, user, id, capture := assistantTraceFixture(t)
			capture.events = []assistantTrace{{Sequence: 1, Kind: "tool", Status: "saved", Time: time.Now().UTC().Format(time.RFC3339Nano), Data: json.RawMessage(`{"saved":"canonical result"}`)}}
			process := assistantResultProcess{ID: store.NewUUIDv7String(), Name: "Exact saved Process"}
			nodeID := store.NewUUIDv7String()
			key := assistantTestCompany + ":" + user.UserID + ":" + id
			server.assistant.recordAssistantResult(key, assistantEvent{Type: "process", ProcessID: process.ID, Name: process.Name})
			server.assistant.recordAssistantResult(key, assistantEvent{Type: "node", ProcessID: process.ID, NodeID: nodeID})
			server.assistant.finishAssistantResult(key)
			capture.finished = true
			close(capture.done)
			companyID := assistantTestCompany
			request := assistantTraceRequest(user, companyID, id)
			want := http.StatusNotFound
			switch scenario {
			case "finished":
				want = http.StatusOK
			case "demoted":
				if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
					t.Fatal(err)
				}
				want = http.StatusForbidden
			case "other actor":
				other := mustRealtimeAuthUser(t, repo, companyID, "different-trace-developer", domain.RoleDevAdmin)
				request = assistantTraceRequest(other, companyID, id)
			case "other company":
				companyID = store.NewUUIDv7String()
				repo.EnsureCompany(companyID, "Other company")
				if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleDevAdmin); err != nil {
					t.Fatal(err)
				}
				request = assistantTraceRequest(user, companyID, id)
			case "not inspected":
				capture.inspect = false
			case "expired":
				server.assistant.requests[assistantTestCompany+":"+user.UserID+":"+id] = time.Now().Add(-time.Second)
			case "unknown request":
				request = assistantTraceRequest(user, companyID, store.NewUUIDv7String())
			case "invalid request":
				request = assistantTraceRequest(user, companyID, "not-a-request-id")
				want = http.StatusBadRequest
			}
			response := httptest.NewRecorder()
			server.handleAssistantTrace(response, request)
			if response.Code != want {
				t.Fatalf("status=%d want=%d body=%s", response.Code, want, response.Body.String())
			}
			if want != http.StatusOK {
				if strings.Contains(response.Body.String(), "canonical result") || strings.Contains(response.Body.String(), nodeID) {
					t.Fatal("unauthorized capture data leaked")
				}
				return
			}
			var snapshot struct {
				Events   []assistantTrace       `json:"events"`
				Finished bool                   `json:"finished"`
				Process  assistantResultProcess `json:"process"`
				NodeID   string                 `json:"node_id"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil {
				t.Fatal(err)
			}
			if !snapshot.Finished || !reflect.DeepEqual(snapshot.Events, capture.events) || snapshot.Process != process || snapshot.NodeID != nodeID {
				t.Fatalf("recovery changed saved state: %+v", snapshot)
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("private trace response may be cached")
			}
		})
	}
}

type assistantTraceDemotionRepo struct {
	store.Repository
	memory *store.MemoryRepo
	calls  atomic.Int32
}

func (repo *assistantTraceDemotionRepo) ListUserMembershipsContext(ctx context.Context, id string) ([]domain.CompanyMembership, error) {
	items, err := repo.Repository.ListUserMembershipsContext(ctx, id)
	if repo.calls.Add(1) == 1 && err == nil {
		_, err = repo.memory.AddCompanyMembership("assistant-user", assistantTestCompany, domain.RoleCompanyAdmin)
	}
	return items, err
}

func TestAssistantTraceRecoveryRechecksRoleAfterWaiting(t *testing.T) {
	server, repo, user, id, capture := assistantTraceFixture(t)
	capture.finished = true
	close(capture.done)
	wrapper := &assistantTraceDemotionRepo{Repository: repo, memory: repo}
	server.repo = wrapper
	response := httptest.NewRecorder()
	server.handleAssistantTrace(response, assistantTraceRequest(user, assistantTestCompany, id))
	if response.Code != http.StatusForbidden || wrapper.calls.Load() != 2 {
		t.Fatalf("recovery did not reauthorize after wait: status=%d reads=%d", response.Code, wrapper.calls.Load())
	}
}

type assistantTraceRetentionRepo struct {
	store.Repository
	calls     atomic.Int32
	onRecheck func()
}

func (repo *assistantTraceRetentionRepo) ListUserMembershipsContext(ctx context.Context, id string) ([]domain.CompanyMembership, error) {
	items, err := repo.Repository.ListUserMembershipsContext(ctx, id)
	if repo.calls.Add(1) == 2 && err == nil {
		repo.onRecheck()
	}
	return items, err
}

func TestAssistantTraceRecoveryRechecksRetentionAfterWaiting(t *testing.T) {
	for _, scenario := range []string{"next Send", "expired", "canceled"} {
		t.Run(scenario, func(t *testing.T) {
			server, repo, user, id, capture := assistantTraceFixture(t)
			capture.events = []assistantTrace{{Sequence: 1, Kind: "context", Status: "completed", Data: json.RawMessage(`{"context":"old retained context"}`)}}
			capture.finished = true
			close(capture.done)
			request := assistantTraceRequest(user, assistantTestCompany, id)
			ctx, cancel := context.WithCancel(request.Context())
			defer cancel()
			owner := assistantTestCompany + ":" + user.UserID
			wrapper := &assistantTraceRetentionRepo{Repository: repo, onRecheck: func() {
				switch scenario {
				case "next Send":
					server.assistant.finish(owner)
					if !server.assistant.begin(owner, store.NewUUIDv7String()) {
						t.Fatal("next Send did not replace the previous capture")
					}
				case "expired":
					server.assistant.mu.Lock()
					server.assistant.requests[owner+":"+id] = time.Now().Add(-time.Second)
					server.assistant.mu.Unlock()
				case "canceled":
					cancel()
				}
			}}
			server.repo = wrapper
			response := httptest.NewRecorder()
			server.handleAssistantTrace(response, request.WithContext(ctx))
			if wrapper.calls.Load() != 2 {
				t.Fatal("retention changed outside the post-wait recheck")
			}
			if scenario == "canceled" {
				// The role helper may return its fixed access error when canceled;
				// neither that error nor an empty response may contain retained data.
				if response.Body.Len() != 0 && strings.TrimSpace(response.Body.String()) != `{"error":"company_access_denied"}` {
					t.Fatalf("canceled recovery returned data: %s", response.Body.String())
				}
			} else if response.Code != http.StatusNotFound || strings.Contains(response.Body.String(), "old retained context") {
				t.Fatalf("recovery returned an unavailable capture: status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestAssistantTraceCaptureIsImmutableCompleteAndSanitized(t *testing.T) {
	server, _, user, id, capture := assistantTraceFixture(t)
	request := assistantTraceRequest(user, assistantTestCompany, id)
	fullText := strings.Repeat("saved text 🥭\n", 9000) + "last retained line"
	data := map[string]any{
		"instructions": fullText,
		"headers":      map[string]any{"Authorization": "private-auth-value"},
		"input":        []any{map[string]any{"text": "trace-fixture-key https://objects.example.test/file?X-Amz-Signature=private-signature", "encrypted_content": "private-continuation"}},
	}
	var emitted []assistantEvent
	emit := func(event assistantEvent) error { emitted = append(emitted, event); return nil }
	if err := server.captureAssistant(request, capture, emit, "provider_request", "prepared", data); err != nil {
		t.Fatal(err)
	}
	data["instructions"] = "edited after capture"
	if err := server.captureAssistant(request, capture, emit, "tool", "failed", map[string]any{"arguments": map[string]any{"name": "Attempted action"}, "error": "The saved SOP changed"}); err != nil {
		t.Fatal(err)
	}
	if len(emitted) != 2 || len(capture.events) != 2 {
		t.Fatal("a failed tool needs its own retained event")
	}
	for i, event := range capture.events {
		if event.Sequence != i+1 || emitted[i].Trace == nil || !reflect.DeepEqual(*emitted[i].Trace, event) {
			t.Fatal("displayed event differs from the immutable capture")
		}
		if _, err := time.Parse(time.RFC3339Nano, event.Time); err != nil {
			t.Fatal("capture lacks its actual event time")
		}
	}
	var first map[string]any
	if err := json.Unmarshal(capture.events[0].Data, &first); err != nil {
		t.Fatal(err)
	}
	if first["instructions"] != fullText {
		t.Fatal("capture was reconstructed or truncated")
	}
	encoded, _ := json.Marshal(capture.events)
	for _, private := range []string{"trace-fixture-key", "private-auth-value", "private-signature", "private-continuation"} {
		if strings.Contains(string(encoded), private) {
			t.Errorf("private value %q entered inspection", private)
		}
	}
	for _, marker := range []string{"security omission", "credential omitted", "secret URL omitted"} {
		if !strings.Contains(string(encoded), marker) {
			t.Errorf("missing explicit omission: %s", marker)
		}
	}
}

func TestAssistantTraceLimitKeepsEarlierEventsAndTerminalMarker(t *testing.T) {
	server, _, user, id, capture := assistantTraceFixture(t)
	capture.inspect = false
	request := assistantTraceRequest(user, assistantTestCompany, id)
	emit := func(assistantEvent) error { t.Fatal("opted-out trace was emitted"); return nil }
	if err := server.captureAssistant(request, capture, emit, "runtime", "completed", map[string]any{"content": strings.Repeat("x", assistantTraceLimit-4096)}); err != nil {
		t.Fatal(err)
	}
	before := append([]byte(nil), capture.events[0].Data...)
	if err := server.captureAssistant(request, capture, emit, "provider_request", "prepared", map[string]any{"body": strings.Repeat("y", 4096)}); err == nil {
		t.Fatal("capture exceeding its limit was accepted")
	}
	if len(capture.events) != 1 || string(capture.events[0].Data) != string(before) {
		t.Fatal("limit replaced or truncated retained data")
	}
	if err := server.captureAssistant(request, capture, emit, "termination", "stopped", map[string]any{"message": "Capture limit stopped further work"}); err != nil {
		t.Fatal("terminal limit marker could not be retained", err)
	}
	if len(capture.events) != 2 || capture.events[1].Sequence != 2 || capture.bytes > assistantTraceLimit {
		t.Fatal("limit damaged event sequence or exceeded its bound")
	}
}

func TestAssistantTraceAdmissionReservesEachInteractionAndRetainsReceipts(t *testing.T) {
	a := &mangoAssistant{active: map[string]bool{}, requests: map[string]time.Time{}, captures: map[string]*assistantCapture{}}
	for i := 0; i < assistantTraceTotalLimit/assistantTraceLimit; i++ {
		if !a.begin(fmt.Sprintf("company:user-%d", i), "first") {
			t.Fatal("bounded capture admission failed too early")
		}
	}
	if a.begin("company:overflow-user", "first") {
		t.Fatal("capture admission exceeded reserved memory")
	}
	a.finish("company:user-0")
	if !a.begin("company:user-0", "second") {
		t.Fatal("next Send could not replace its actor's old recovery capture")
	}
	if _, exists := a.captures["company:user-0:first"]; exists {
		t.Fatal("old recovery capture survived next Send")
	}
	if _, exists := a.requests["company:user-0:first"]; !exists {
		t.Fatal("replacing recovery deleted the duplicate-Send receipt")
	}
	a.finish("company:user-0")
	if a.begin("company:user-0", "first") {
		t.Fatal("old Send was allowed to execute again")
	}
	a.requests["company:user-1:first"] = time.Now().Add(-time.Second)
	a.finish("company:user-1")
	if !a.begin("company:overflow-user", "first") {
		t.Fatal("expired recovery failed to release its reserved capacity")
	}
}

func TestAssistantTraceCaptureFailureStopsBeforeProviderDispatch(t *testing.T) {
	var providerCalls atomic.Int32
	server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		providerCalls.Add(1)
		assistantProviderComplete(w)
	})
	user := mustRealtimeAuthUser(t, repo, assistantTestCompany, "assistant-user", domain.RoleDevAdmin)
	id := store.NewUUIDv7String()
	owner := assistantTestCompany + ":" + user.UserID
	if !server.assistant.begin(owner, id) {
		t.Fatal("capture admission failed")
	}
	defer server.assistant.finish(owner)
	request := assistantTraceRequest(user, assistantTestCompany, id)
	failed := errors.New("browser capture acknowledgment failed")
	err := server.runAssistant(request, assistantRequest{RequestID: id, InspectContext: true, ReasoningEffort: "medium", Messages: []assistantMessage{{Role: "user", Content: "Explain Mango"}}}, func(event assistantEvent) error {
		if event.Trace != nil && event.Trace.Kind == "provider_request" && event.Trace.Status == "prepared" {
			return failed
		}
		return nil
	})
	if !errors.Is(err, failed) || providerCalls.Load() != 0 {
		t.Fatalf("failed capture allowed egress: calls=%d error=%v", providerCalls.Load(), err)
	}
	capture := server.assistant.captures[owner+":"+id]
	if !capture.finished {
		t.Fatal("capture failure left recovery pending")
	}
	prepared := false
	for _, event := range capture.events {
		prepared = prepared || event.Kind == "provider_request" && event.Status == "prepared"
		if event.Kind == "provider_request" && event.Status == "dispatched" {
			t.Fatal("unacknowledged provider request was dispatched")
		}
	}
	if !prepared {
		t.Fatal("failed browser delivery erased the retained prepared request")
	}
}

func TestAssistantTraceCancellationKeepsConfirmedSavedResult(t *testing.T) {
	server, memory, user, id, capture := assistantTraceFixture(t)
	request := assistantTraceRequest(user, assistantTestCompany, id)
	ctx, cancel := context.WithCancel(request.Context())
	defer cancel()
	request = request.WithContext(ctx)
	repo := &assistantUncertainNodeRepo{Repository: memory, cancel: cancel}
	server.repo = repo
	result, err := server.dispatchAssistantTool(request, "create_node", `{"name":"Committed as Stop arrived"}`)
	if err != nil || ctx.Err() == nil || repo.calls != 1 {
		t.Fatalf("confirmed save discarded at cancellation: calls=%d error=%v", repo.calls, err)
	}
	var saved map[string]any
	if err := json.Unmarshal([]byte(result), &saved); err != nil {
		t.Fatal(err)
	}
	if !isCanonicalUUID(fmt.Sprint(saved["node_id"])) {
		t.Fatal("confirmed result lacks its canonical Node identity")
	}
	if err := server.captureAssistant(request, capture, func(assistantEvent) error { t.Fatal("canceled browser received an event"); return nil }, "tool", "saved", map[string]any{"result": saved}); err != nil {
		t.Fatal(err)
	}
	if _, err := server.dispatchAssistantTool(request, "create_node", `{"name":"Must never enter"}`); err == nil || repo.calls != 1 {
		t.Fatal("a later action entered after Stop")
	}
	nodes, err := memory.ListNodes(assistantTestCompany)
	if err != nil || len(nodes) != 1 || nodes[0].NodeID != saved["node_id"] {
		t.Fatal("Stop removed or repeated saved work")
	}
	if len(capture.events) != 1 || !strings.Contains(string(capture.events[0].Data), nodes[0].NodeID) {
		t.Fatal("Stop erased the confirmed saved response")
	}
}
