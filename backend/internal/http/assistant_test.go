package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const assistantTestRequest = "10000000-0000-4000-8000-000000000001"

type assistantFixture struct {
	s              *Server
	repo           *store.MemoryRepo
	user           domain.User
	route          HermesRoute
	gateID, stepID string
	mu             sync.Mutex
	status         string
	admissions     int
	durable        bool
	failAdmission  bool
}

func newAssistantFixture(t *testing.T) *assistantFixture {
	t.Helper()
	f := &assistantFixture{repo: store.NewMemoryRepo(), status: "running", durable: true}
	f.repo.EnsureCompany(transcriptionTestCompany, "Hermes tests")
	f.user = mustRealtimeAuthUser(t, f.repo, transcriptionTestCompany, "hermes-user", domain.RoleCompanyAdmin)
	gate, err := f.repo.CreateLogicGate(transcriptionTestCompany, "Invoices")
	if err != nil {
		t.Fatal(err)
	}
	f.gateID = gate.LogicGateID
	step, err := f.repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: transcriptionTestCompany, LogicGateID: f.gateID, Name: "Review", ActorUserID: f.user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	f.stepID = step.Step.ProcessStepID
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 32) {
			t.Error("missing private Hermes credential")
			w.WriteHeader(401)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		switch {
		case r.URL.Path == "/v1/capabilities":
			writeJSON(w, 200, map[string]any{"features": map[string]any{"runs_idempotency": map[string]any{"durable": f.durable}}})
		case r.URL.Path == "/v1/runs" && r.Method == http.MethodPost:
			var body map[string]any
			if json.NewDecoder(r.Body).Decode(&body) != nil {
				t.Error("invalid native body")
			}
			if len(body) != 2 || body["input"] != "Create an invoice review Node" || body["session_id"] != assistantTestRequest || r.Header.Get("Idempotency-Key") != assistantTestRequest {
				t.Errorf("unexpected native request: %+v", body)
			}
			f.admissions++
			if f.failAdmission {
				f.failAdmission = false
				writeError(w, 502, "response_lost")
				return
			}
			writeJSON(w, 202, map[string]string{"run_id": "run_test"})
		case r.URL.Path == "/v1/runs/run_test":
			writeJSON(w, 200, map[string]string{"run_id": "run_test", "session_id": assistantTestRequest, "status": f.status, "output": "Created the Node."})
		case r.URL.Path == "/v1/runs/run_test/stop":
			f.status = "cancelled"
			writeJSON(w, 200, map[string]string{"status": "stopping"})
		case r.URL.Path == "/v1/runs/run_test/events":
			w.Header().Set("Content-Type", "text/event-stream")
			io.WriteString(w, "data: {\"event\":\"tool.started\",\"run_id\":\"run_test\",\"preview\":\"private tool arguments\"}\n\n")
			io.WriteString(w, "data: {\"event\":\"message.delta\",\"run_id\":\"run_test\",\"delta\":\"Created\"}\n\n")
			io.WriteString(w, "data: {\"event\":\"run.completed\",\"run_id\":\"run_test\",\"output\":\"Created the Node.\"}\n\n")
			f.status = "completed"
		case r.URL.Path == "/api/sessions":
			writeJSON(w, 200, map[string]any{"data": []map[string]any{{"id": assistantTestRequest, "title": "Invoices", "last_active": 1700000000}}})
		case r.URL.Path == "/api/sessions/"+assistantTestRequest+"/messages":
			writeJSON(w, 200, map[string]any{"data": []map[string]any{{"id": 1, "role": "user", "content": "Create an invoice review Node"}, {"id": 2, "role": "tool", "content": "private tool result"}, {"id": 3, "role": "assistant", "content": "Created the Node."}}})
		default:
			writeError(w, 404, "not_found")
		}
	}))
	t.Cleanup(upstream.Close)
	f.route = HermesRoute{CompanyID: transcriptionTestCompany, UserID: f.user.UserID, URL: upstream.URL, APIKey: strings.Repeat("a", 32), CallbackKey: strings.Repeat("b", 32)}
	f.s = NewServerWithOptions(f.repo, ServerOptions{HermesRoutes: []HermesRoute{f.route}, DisableRealtimeSpine: true, DisableNotificationCleanup: true, DisableAttachmentUploadCleanup: true})
	t.Cleanup(f.s.Close)
	return f
}

func (f *assistantFixture) request(t *testing.T, method, path string, body any, user domain.User) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	if user.UserID != "" {
		r = r.WithContext(context.WithValue(r.Context(), actorContextKey{}, ActorContext{User: user, Memberships: []domain.CompanyMembership{{CompanyID: f.route.CompanyID, UserID: user.UserID, Role: domain.RoleCompanyAdmin}}, CompanyID: f.route.CompanyID, CompanyRole: domain.RoleCompanyAdmin}))
	}
	w := httptest.NewRecorder()
	f.s.Routes().ServeHTTP(w, r)
	return w
}

func (f *assistantFixture) submit(t *testing.T) *httptest.ResponseRecorder {
	return f.request(t, http.MethodPost, "/v1/assistant/runs", assistantSubmission{CompanyID: f.route.CompanyID, RequestID: assistantTestRequest, Message: "Create an invoice review Node"}, f.user)
}

func (f *assistantFixture) action(t *testing.T, callID string, args map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"run_id": "run_test", "session_id": assistantTestRequest, "tool_call_id": callID, "action": "mango_create_node", "arguments": args})
	r := httptest.NewRequest(http.MethodPost, "/internal/hermes/actions", bytes.NewReader(raw))
	r.Header.Set("Authorization", "Bearer "+f.route.CallbackKey)
	w := httptest.NewRecorder()
	f.s.Routes().ServeHTTP(w, r)
	return w
}

func TestAssistantRunsActionsStreamAndResume(t *testing.T) {
	f := newAssistantFixture(t)
	for i := 0; i < 2; i++ {
		w := f.submit(t)
		if w.Code != 202 {
			t.Fatalf("submit %d: %d %s", i, w.Code, w.Body)
		}
	}
	if f.admissions != 1 {
		t.Fatalf("native admissions=%d", f.admissions)
	}
	args := map[string]any{"logic_gate_id": f.gateID, "process_step_id": f.stepID, "title": "Invoice 42"}
	first := f.action(t, "call_first", args)
	second := f.action(t, "call_retry", args)
	if first.Code != 200 || second.Code != 200 || first.Body.String() != second.Body.String() {
		t.Fatalf("action/retry: %d %s / %d %s", first.Code, first.Body, second.Code, second.Body)
	}
	canonicalRetry := f.action(t, "call_same_ids", map[string]any{"logic_gate_id": strings.ToUpper(f.gateID), "process_step_id": strings.ToUpper(f.stepID), "title": "  Invoice 42  "})
	if canonicalRetry.Code != 200 || first.Body.String() != canonicalRetry.Body.String() {
		t.Fatalf("equivalent action arguments: %d %s", canonicalRetry.Code, canonicalRetry.Body)
	}
	nodes, err := f.repo.ListNodes(f.route.CompanyID)
	if err != nil || len(nodes) != 1 {
		t.Fatalf("nodes=%d err=%v", len(nodes), err)
	}
	work, err := f.repo.GetLogicGateWork(f.route.CompanyID, f.gateID, f.user.UserID)
	if err != nil || len(work.Nodes) != 1 {
		t.Fatalf("saved process work: %+v %v", work, err)
	}
	stream := f.request(t, http.MethodGet, "/v1/assistant/runs/run_test/events?company_id="+f.route.CompanyID, nil, f.user)
	if stream.Code != 200 || !strings.Contains(stream.Body.String(), "message.delta") || !strings.Contains(stream.Body.String(), "run.completed") || strings.Contains(stream.Body.String(), "private tool") {
		t.Fatalf("stream=%d %s", stream.Code, stream.Body)
	}
	// A new Go server reads the same durable admission/native status; it does not rerun the action.
	restarted := NewServerWithOptions(f.repo, ServerOptions{HermesRoutes: []HermesRoute{f.route}, DisableRealtimeSpine: true, DisableNotificationCleanup: true, DisableAttachmentUploadCleanup: true})
	defer restarted.Close()
	f.s = restarted
	status := f.request(t, http.MethodGet, "/v1/assistant/runs/run_test?company_id="+f.route.CompanyID, nil, f.user)
	if status.Code != 200 || !strings.Contains(status.Body.String(), "completed") {
		t.Fatalf("resume=%d %s", status.Code, status.Body)
	}
	detail := f.request(t, http.MethodGet, "/v1/assistant/conversations/"+assistantTestRequest+"?company_id="+f.route.CompanyID, nil, f.user)
	if detail.Code != 200 || strings.Contains(detail.Body.String(), "private tool") || !strings.Contains(detail.Body.String(), "Created the Node.") {
		t.Fatalf("detail=%d %s", detail.Code, detail.Body)
	}
}

func TestAssistantScopeAndStopFailClosed(t *testing.T) {
	f := newAssistantFixture(t)
	unauth := f.request(t, http.MethodGet, "/v1/assistant/conversations?company_id="+f.route.CompanyID, nil, domain.User{})
	if unauth.Code != 401 {
		t.Fatalf("anonymous=%d", unauth.Code)
	}
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit=%d %s", w.Code, w.Body)
	}
	other := mustRealtimeAuthUser(t, f.repo, f.route.CompanyID, "hermes-other", domain.RoleCompanyUser)
	if w := f.request(t, http.MethodGet, "/v1/assistant/runs/run_test?company_id="+f.route.CompanyID, nil, other); w.Code != 503 {
		t.Fatalf("other route=%d %s", w.Code, w.Body)
	}
	args := map[string]any{"logic_gate_id": f.gateID, "process_step_id": f.stepID, "title": "Invoice 42", "company_id": f.route.CompanyID}
	if w := f.action(t, "call_forged", args); w.Code != 400 {
		t.Fatalf("scope arg=%d %s", w.Code, w.Body)
	}
	delete(args, "company_id")
	cancel := f.request(t, http.MethodPost, "/v1/assistant/runs/run_test/cancel", map[string]string{"company_id": f.route.CompanyID}, f.user)
	if cancel.Code != 200 {
		t.Fatalf("cancel=%d %s", cancel.Code, cancel.Body)
	}
	// Even a misbehaving service reporting running cannot reopen Mango's persisted Stop gate.
	f.mu.Lock()
	f.status = "running"
	f.mu.Unlock()
	if w := f.action(t, "call_late", args); w.Code != 409 {
		t.Fatalf("late action=%d %s", w.Code, w.Body)
	}
	nodes, _ := f.repo.ListNodes(f.route.CompanyID)
	if len(nodes) != 0 {
		t.Fatal("Stop admitted new Node")
	}
}

func TestAssistantRequiresDurableHermesAndUniqueRoutes(t *testing.T) {
	f := newAssistantFixture(t)
	f.durable = false
	if w := f.submit(t); w.Code != 503 || !strings.Contains(w.Body.String(), "durable_storage_required") {
		t.Fatalf("non-durable=%d %s", w.Code, w.Body)
	}
	if f.admissions != 0 {
		t.Fatal("non-durable native run admitted")
	}
	raw := fmt.Sprintf(`[{"company_id":%q,"user_id":%q,"url":"http://localhost:8642","api_key_env":"API","callback_key_env":"CALLBACK"}]`, f.route.CompanyID, f.route.UserID)
	lookup := func(name string) string {
		if name == "API" {
			return strings.Repeat("a", 32)
		}
		return strings.Repeat("b", 32)
	}
	if _, err := ParseHermesRoutes(raw, lookup); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseHermesRoutes(strings.TrimSuffix(raw, "]")+","+strings.TrimPrefix(raw, "["), lookup); err == nil {
		t.Fatal("duplicate tenant service accepted")
	}
	if _, err := ParseHermesRoutes(strings.ReplaceAll(raw, "http://localhost:8642", "http://secret@localhost:8642"), lookup); err == nil {
		t.Fatal("credential URL accepted")
	}
}

func TestAssistantUncertainAdmissionRetainsSubmissionAndRetriesSameIdentity(t *testing.T) {
	f := newAssistantFixture(t)
	f.failAdmission = true
	if w := f.submit(t); w.Code != 502 {
		t.Fatalf("uncertain response=%d %s", w.Code, w.Body)
	}
	w := f.request(t, http.MethodGet, "/v1/assistant/conversations/"+assistantTestRequest+"?company_id="+f.route.CompanyID, nil, f.user)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "pending_submission") || !strings.Contains(w.Body.String(), assistantTestRequest) {
		t.Fatalf("pending=%d %s", w.Code, w.Body)
	}
	if w = f.submit(t); w.Code != 202 {
		t.Fatalf("retry=%d %s", w.Code, w.Body)
	}
	if f.admissions != 2 {
		t.Fatalf("same-key transport attempts=%d", f.admissions)
	}
	run, err := f.repo.ActiveAssistantRun(context.Background(), f.route.CompanyID, f.route.UserID)
	if err != nil || run.RunID != "run_test" || run.Message != "" {
		t.Fatalf("admission=%+v %v", run, err)
	}
}

func TestAssistantTenantRouteCannotReadAnotherTenantRun(t *testing.T) {
	f := newAssistantFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit=%d %s", w.Code, w.Body)
	}
	other := mustRealtimeAuthUser(t, f.repo, f.route.CompanyID, "configured-other", domain.RoleCompanyUser)
	otherRoute := f.route
	otherRoute.UserID = other.UserID
	// Production route validation rejects reused origins; this deliberately shares
	// a fake origin to verify Mango ownership still rejects the ID before HTTP.
	f.s.hermesRoutes = append(f.s.hermesRoutes, otherRoute)
	w := f.request(t, http.MethodGet, "/v1/assistant/runs/run_test?company_id="+f.route.CompanyID, nil, other)
	if w.Code != 404 {
		t.Fatalf("other tenant run=%d %s", w.Code, w.Body)
	}
}

func TestAssistantStreamHasOneConsumerAndReleases(t *testing.T) {
	f := newAssistantFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit=%d %s", w.Code, w.Body)
	}
	release, err := f.repo.AcquireAssistantStream(context.Background(), f.route.CompanyID, f.route.UserID, assistantTestRequest)
	if err != nil {
		t.Fatal(err)
	}
	w := f.request(t, http.MethodGet, "/v1/assistant/runs/run_test/events?company_id="+f.route.CompanyID, nil, f.user)
	if w.Code != 409 || !strings.Contains(w.Body.String(), "assistant_response_open_elsewhere") {
		t.Fatalf("second observer=%d %s", w.Code, w.Body)
	}
	release()
	w = f.request(t, http.MethodGet, "/v1/assistant/runs/run_test/events?company_id="+f.route.CompanyID, nil, f.user)
	if w.Code != 200 {
		t.Fatalf("released observer=%d %s", w.Code, w.Body)
	}
}

func TestAssistantRemovedMembershipCannotReadNativeHistory(t *testing.T) {
	f := newAssistantFixture(t)
	other, err := f.repo.CreateCompany("Other membership")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.repo.AddCompanyMembership(f.user.CognitoSubject, other.CompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err = f.repo.DeleteCompanyUser(f.route.CompanyID, f.user.UserID, false); err != nil {
		t.Fatal(err)
	}
	w := f.request(t, http.MethodGet, "/v1/assistant/conversations?company_id="+f.route.CompanyID, nil, f.user)
	if w.Code != 403 {
		t.Fatalf("dormant history=%d %s", w.Code, w.Body)
	}
}
