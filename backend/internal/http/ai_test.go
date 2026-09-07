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
	"time"
)

const aiTestRunID = "10000000-0000-4000-8000-000000000001"

type aiFixture struct {
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
	streams        int
}

func newAIFixture(t *testing.T) *aiFixture {
	t.Helper()
	f := &aiFixture{repo: store.NewMemoryRepo(), status: "running", durable: true}
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
			if len(body) != 2 || body["input"] != "Create an invoice review Node" || body["session_id"] != aiTestRunID || r.Header.Get("Idempotency-Key") != aiTestRunID {
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
			writeJSON(w, 200, map[string]string{"run_id": "run_test", "session_id": aiTestRunID, "status": f.status, "output": "Created the Node."})
		case r.URL.Path == "/v1/runs/run_test/stop":
			f.status = "cancelled"
			writeJSON(w, 200, map[string]string{"status": "stopping"})
		case r.URL.Path == "/v1/runs/run_test/events":
			f.streams++
			w.Header().Set("Content-Type", "text/event-stream")
			io.WriteString(w, "data: {\"event\":\"tool.started\",\"run_id\":\"run_test\",\"preview\":\"private tool arguments\"}\n\n")
			io.WriteString(w, "data: {\"event\":\"message.delta\",\"run_id\":\"run_test\",\"delta\":\"Created\"}\n\n")
			io.WriteString(w, "data: {\"event\":\"run.completed\",\"run_id\":\"run_test\",\"output\":\"Created the Node.\"}\n\n")
			f.status = "completed"
		default:
			t.Errorf("unexpected native request: %s %s", r.Method, r.URL.Path)
			writeError(w, 404, "not_found")
		}
	}))
	t.Cleanup(upstream.Close)
	f.route = HermesRoute{CompanyID: transcriptionTestCompany, UserID: f.user.UserID, URL: upstream.URL, APIKey: strings.Repeat("a", 32), CallbackKey: strings.Repeat("b", 32)}
	f.s = NewServerWithOptions(f.repo, ServerOptions{HermesRoutes: []HermesRoute{f.route}, DisableRealtimeSpine: true, DisableNotificationCleanup: true, DisableAttachmentUploadCleanup: true})
	t.Cleanup(f.s.Close)
	return f
}

func (f *aiFixture) request(t *testing.T, method, path string, body any, user domain.User) *httptest.ResponseRecorder {
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

func (f *aiFixture) submit(t *testing.T) *httptest.ResponseRecorder {
	return f.request(t, http.MethodPost, "/v1/ai/runs", aiSubmission{CompanyID: f.route.CompanyID, RunID: aiTestRunID, Message: "Create an invoice review Node"}, f.user)
}

func (f *aiFixture) action(t *testing.T, callID string, args map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"run_id": "run_test", "session_id": aiTestRunID, "tool_call_id": callID, "action": "mango_create_node", "arguments": args})
	r := httptest.NewRequest(http.MethodPost, "/internal/hermes/actions", bytes.NewReader(raw))
	r.Header.Set("Authorization", "Bearer "+f.route.CallbackKey)
	w := httptest.NewRecorder()
	f.s.Routes().ServeHTTP(w, r)
	return w
}

func aiHistoryBody(eventID, kind string, data map[string]any) map[string]any {
	return map[string]any{"run_id": "run_test", "session_id": aiTestRunID, "event_id": eventID, "type": kind,
		"created_at": "2026-09-07T00:00:00Z", "data": data}
}

func aiTranscriptBody() map[string]any {
	body := aiHistoryBody("run_test:snapshot", "messages.saved", map[string]any{})
	body["chat_name"] = "Invoices"
	body["chat_created_at"] = "2026-09-07T00:00:00Z"
	body["messages"] = []map[string]any{
		{"message_id": 1, "role": "user", "content": "Create an invoice review Node", "created_at": "2026-09-07T00:00:00Z", "current_run": false},
		{"message_id": 3, "role": "assistant", "content": "Created the Node.", "created_at": "2026-09-07T00:00:01Z", "current_run": false},
	}
	body["messages_complete"] = true
	body["message_ids"] = []int64{1, 3}
	return body
}

func (f *aiFixture) history(t *testing.T, body map[string]any, key string) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/internal/hermes/history", bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+key)
	w := httptest.NewRecorder()
	f.s.Routes().ServeHTTP(w, r)
	return w
}

func TestAIRunsActionsStreamAndResume(t *testing.T) {
	f := newAIFixture(t)
	for i := 0; i < 2; i++ {
		w := f.submit(t)
		if w.Code != 202 {
			t.Fatalf("submit %d: %d %s", i, w.Code, w.Body)
		}
		var accepted store.AIRun
		if err := json.Unmarshal(w.Body.Bytes(), &accepted); err != nil || accepted.RunID != aiTestRunID || accepted.ChatID != aiTestRunID || accepted.HermesRunID != "" {
			t.Fatalf("public admission must expose local IDs only: %s (%v)", w.Body, err)
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
	stream := f.request(t, http.MethodGet, "/v1/ai/runs/"+aiTestRunID+"/events?company_id="+f.route.CompanyID, nil, f.user)
	if stream.Code != 200 || !strings.Contains(stream.Body.String(), "message.delta") || !strings.Contains(stream.Body.String(), "run.completed") || strings.Contains(stream.Body.String(), "private tool") {
		t.Fatalf("stream=%d %s", stream.Code, stream.Body)
	}
	if strings.Contains(stream.Body.String(), "run_test") || !strings.Contains(stream.Body.String(), aiTestRunID) {
		t.Fatalf("stream must bind events to local run ID: %s", stream.Body)
	}
	if saved := f.history(t, aiTranscriptBody(), f.route.CallbackKey); saved.Code != 200 {
		t.Fatalf("transcript callback: %d %s", saved.Code, saved.Body)
	}
	// A new Go server reads the same durable admission/native status; it does not rerun the action.
	restarted := NewServerWithOptions(f.repo, ServerOptions{HermesRoutes: []HermesRoute{f.route}, DisableRealtimeSpine: true, DisableNotificationCleanup: true, DisableAttachmentUploadCleanup: true})
	defer restarted.Close()
	f.s = restarted
	status := f.request(t, http.MethodGet, "/v1/ai/runs/"+aiTestRunID+"?company_id="+f.route.CompanyID, nil, f.user)
	if status.Code != 200 || !strings.Contains(status.Body.String(), "completed") {
		t.Fatalf("resume=%d %s", status.Code, status.Body)
	}
	detail := f.request(t, http.MethodGet, "/v1/ai/chats/"+aiTestRunID+"?company_id="+f.route.CompanyID, nil, f.user)
	if detail.Code != 200 || strings.Contains(detail.Body.String(), "private tool") || !strings.Contains(detail.Body.String(), "Created the Node.") {
		t.Fatalf("detail=%d %s", detail.Code, detail.Body)
	}
}

func TestAIScopeAndStopFailClosed(t *testing.T) {
	f := newAIFixture(t)
	unauth := f.request(t, http.MethodGet, "/v1/ai/chats?company_id="+f.route.CompanyID, nil, domain.User{})
	if unauth.Code != 401 {
		t.Fatalf("anonymous=%d", unauth.Code)
	}
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit=%d %s", w.Code, w.Body)
	}
	other := mustRealtimeAuthUser(t, f.repo, f.route.CompanyID, "hermes-other", domain.RoleCompanyUser)
	if w := f.request(t, http.MethodGet, "/v1/ai/runs/"+aiTestRunID+"?company_id="+f.route.CompanyID, nil, other); w.Code != 503 {
		t.Fatalf("other route=%d %s", w.Code, w.Body)
	}
	args := map[string]any{"logic_gate_id": f.gateID, "process_step_id": f.stepID, "title": "Invoice 42", "company_id": f.route.CompanyID}
	if w := f.action(t, "call_forged", args); w.Code != 400 {
		t.Fatalf("scope arg=%d %s", w.Code, w.Body)
	}
	delete(args, "company_id")
	cancel := f.request(t, http.MethodPost, "/v1/ai/runs/"+aiTestRunID+"/cancel", map[string]string{"company_id": f.route.CompanyID}, f.user)
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

func TestAIRequiresDurableHermesAndUniqueRoutes(t *testing.T) {
	f := newAIFixture(t)
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

func TestAIUncertainAdmissionRetainsSubmissionAndRetriesSameIdentity(t *testing.T) {
	f := newAIFixture(t)
	f.failAdmission = true
	if w := f.submit(t); w.Code != 502 {
		t.Fatalf("uncertain response=%d %s", w.Code, w.Body)
	}
	w := f.request(t, http.MethodGet, "/v1/ai/chats/"+aiTestRunID+"?company_id="+f.route.CompanyID, nil, f.user)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "pending_submission") || !strings.Contains(w.Body.String(), aiTestRunID) {
		t.Fatalf("pending=%d %s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), "Create an invoice review Node") {
		t.Fatal("pending chat lost the original input")
	}
	pendingStream := f.request(t, http.MethodGet, "/v1/ai/runs/"+aiTestRunID+"/events?company_id="+f.route.CompanyID, nil, f.user)
	if pendingStream.Code != 409 || !strings.Contains(pendingStream.Body.String(), "ai_run_pending") || f.streams != 0 {
		t.Fatalf("pending run opened a native stream: %d %s", pendingStream.Code, pendingStream.Body)
	}
	// The durable local run owns its first input, even when a retry sends replacement fields.
	w = f.request(t, http.MethodPost, "/v1/ai/runs", aiSubmission{CompanyID: f.route.CompanyID, RunID: aiTestRunID, ChatID: "different-session", Message: "Replace the original prompt"}, f.user)
	if w.Code != 202 {
		t.Fatalf("retry=%d %s", w.Code, w.Body)
	}
	if f.admissions != 2 {
		t.Fatalf("same-key transport attempts=%d", f.admissions)
	}
	run, err := f.repo.ActiveAIRun(context.Background(), f.route.CompanyID, f.route.UserID)
	if err != nil || run.RunID != aiTestRunID || run.HermesRunID != "run_test" || run.PendingInput != "" {
		t.Fatalf("admission=%+v %v", run, err)
	}
}

type aiAdmissionRaceRepo struct {
	store.Repository
	active store.AIRun
}

func (r *aiAdmissionRaceRepo) ReserveAIRun(ctx context.Context, input store.AIRun) (store.AIRun, error) {
	if _, err := r.Repository.ReserveAIRun(ctx, r.active); err != nil {
		return store.AIRun{}, err
	}
	return r.Repository.ReserveAIRun(ctx, input)
}

func TestAIAdmissionConflictIdentifiesExactActiveChat(t *testing.T) {
	for _, race := range []bool{false, true} {
		t.Run(fmt.Sprintf("reserve_race=%t", race), func(t *testing.T) {
			f := newAIFixture(t)
			ctx := context.Background()
			for _, chat := range []store.AIChat{
				{CompanyID: f.route.CompanyID, UserID: f.route.UserID, ChatID: "older-chat", Name: "Older", CreatedAt: time.Now().Add(-time.Hour)},
				{CompanyID: f.route.CompanyID, UserID: f.route.UserID, ChatID: "newer-chat", Name: "Newer"},
			} {
				if _, err := f.repo.UpsertAIChat(ctx, chat); err != nil {
					t.Fatal(err)
				}
			}
			active := store.AIRun{CompanyID: f.route.CompanyID, UserID: f.route.UserID, RunID: aiTestRunID, ChatID: "older-chat", PendingInput: "Existing work"}
			if race {
				f.s.repo = &aiAdmissionRaceRepo{Repository: f.repo, active: active}
			} else if _, err := f.repo.ReserveAIRun(ctx, active); err != nil {
				t.Fatal(err)
			}
			w := f.request(t, http.MethodPost, "/v1/ai/runs", aiSubmission{CompanyID: f.route.CompanyID, RunID: "10000000-0000-4000-8000-000000000002", ChatID: "newer-chat", Message: "New work"}, f.user)
			var body map[string]string
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || w.Code != 409 || body["error"] != "ai_run_active_or_request_conflict" || body["active_chat_id"] != "older-chat" || body["active_run_id"] != aiTestRunID {
				t.Fatalf("active admission conflict: %d %s (%v)", w.Code, w.Body, err)
			}
			if f.admissions != 0 {
				t.Fatalf("conflicting request admitted %d native runs", f.admissions)
			}
		})
	}
}

func TestAITenantRouteCannotReadAnotherTenantRun(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit=%d %s", w.Code, w.Body)
	}
	other := mustRealtimeAuthUser(t, f.repo, f.route.CompanyID, "configured-other", domain.RoleCompanyUser)
	otherRoute := f.route
	otherRoute.UserID = other.UserID
	// Production route validation rejects reused origins; this deliberately shares
	// a fake origin to verify Mango ownership still rejects the ID before HTTP.
	f.s.hermesRoutes = append(f.s.hermesRoutes, otherRoute)
	w := f.request(t, http.MethodGet, "/v1/ai/runs/"+aiTestRunID+"?company_id="+f.route.CompanyID, nil, other)
	if w.Code != 404 {
		t.Fatalf("other tenant run=%d %s", w.Code, w.Body)
	}
}

func TestAIStreamHasOneConsumerAndReleases(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit=%d %s", w.Code, w.Body)
	}
	release, err := f.repo.AcquireAIStream(context.Background(), f.route.CompanyID, f.route.UserID, aiTestRunID)
	if err != nil {
		t.Fatal(err)
	}
	w := f.request(t, http.MethodGet, "/v1/ai/runs/"+aiTestRunID+"/events?company_id="+f.route.CompanyID, nil, f.user)
	if w.Code != 409 || !strings.Contains(w.Body.String(), "ai_response_open_elsewhere") {
		t.Fatalf("second observer=%d %s", w.Code, w.Body)
	}
	release()
	w = f.request(t, http.MethodGet, "/v1/ai/runs/"+aiTestRunID+"/events?company_id="+f.route.CompanyID, nil, f.user)
	if w.Code != 200 {
		t.Fatalf("released observer=%d %s", w.Code, w.Body)
	}
}

func TestAIRemovedMembershipCannotReadNativeHistory(t *testing.T) {
	f := newAIFixture(t)
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
	w := f.request(t, http.MethodGet, "/v1/ai/chats?company_id="+f.route.CompanyID, nil, f.user)
	if w.Code != 403 {
		t.Fatalf("dormant history=%d %s", w.Code, w.Body)
	}
}

func TestAIHistoryCallbacksPersistWithoutBrowserStream(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit: %d %s", w.Code, w.Body)
	}
	snapshot := aiTranscriptBody()
	finished := aiHistoryBody("run_test:finished", "run.finished", map[string]any{"completed": true, "failed": false, "interrupted": false, "output": "Created the Node."})
	for _, body := range []map[string]any{snapshot, snapshot} {
		if w := f.history(t, body, f.route.CallbackKey); w.Code != 200 {
			t.Fatalf("history: %d %s", w.Code, w.Body)
		}
	}
	if w := f.history(t, finished, f.route.CallbackKey); w.Code != 503 {
		t.Fatalf("native still running: %d %s", w.Code, w.Body)
	}
	run, err := f.repo.GetAIRun(context.Background(), f.route.CompanyID, f.user.UserID, aiTestRunID)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, event := range run.History {
		counts[event.ID]++
	}
	if counts["run_test:snapshot"] != 1 || counts["run_test:finished"] != 1 || aiRunOutput(run) != "Created the Node." {
		t.Fatalf("saved callback history: %+v", run.History)
	}
	if run.Status != "running" {
		t.Fatalf("a session hook must not invent native terminal status: %s", run.Status)
	}
	f.mu.Lock()
	f.status = "completed"
	f.mu.Unlock()
	for range 2 {
		if w := f.history(t, finished, f.route.CallbackKey); w.Code != 200 {
			t.Fatalf("terminal retry: %d %s", w.Code, w.Body)
		}
	}
	run, err = f.repo.GetAIRun(context.Background(), f.route.CompanyID, f.user.UserID, aiTestRunID)
	if err != nil || run.Status != "completed" {
		t.Fatalf("history did not settle without browser: %+v %v", run, err)
	}
	snapshot["chat_name"] = "Changed on replay"
	if w := f.history(t, snapshot, f.route.CallbackKey); w.Code != 200 {
		t.Fatalf("lost-ack replay: %d %s", w.Code, w.Body)
	}
	detail := f.request(t, http.MethodGet, "/v1/ai/chats/"+aiTestRunID+"?company_id="+f.route.CompanyID, nil, f.user)
	var saved struct {
		ChatID   string            `json:"chat_id"`
		Name     string            `json:"name"`
		Messages []store.AIMessage `json:"messages"`
	}
	if detail.Code != 200 || json.Unmarshal(detail.Body.Bytes(), &saved) != nil {
		t.Fatalf("saved chat: %d %s", detail.Code, detail.Body)
	}
	if saved.ChatID != aiTestRunID || saved.Name != "Invoices" || len(saved.Messages) != 2 {
		t.Fatalf("saved chat=%+v", saved)
	}
	if saved.Messages[0].MessageID != 1 || saved.Messages[0].Role != "user" || saved.Messages[1].MessageID != 3 || saved.Messages[1].Role != "ai" {
		t.Fatalf("native IDs and translated roles: %+v", saved.Messages)
	}
	if saved.Messages[0].RunID != "" || saved.Messages[1].RunID != "" {
		t.Fatal("native snapshots must not invent a run association")
	}
	if !saved.Messages[1].CreatedAt.Equal(time.Date(2026, 9, 7, 0, 0, 1, 0, time.UTC)) {
		t.Fatal("native message timestamp was replaced")
	}
	f.mu.Lock()
	streams := f.streams
	f.mu.Unlock()
	if streams != 0 {
		t.Fatalf("history depended on %d browser streams", streams)
	}
}

func TestAIHistoryScopeAndNativeRoleBoundary(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit: %d %s", w.Code, w.Body)
	}
	body := aiTranscriptBody()
	if w := f.history(t, body, "wrong-key"); w.Code != 401 {
		t.Fatalf("unauthorized callback: %d %s", w.Code, w.Body)
	}
	other := mustRealtimeAuthUser(t, f.repo, f.route.CompanyID, "history-other", domain.RoleCompanyUser)
	otherRoute := f.route
	otherRoute.UserID = other.UserID
	otherRoute.CallbackKey = strings.Repeat("c", 32)
	f.s.hermesRoutes = append(f.s.hermesRoutes, otherRoute)
	if w := f.history(t, body, otherRoute.CallbackKey); w.Code != 410 {
		t.Fatalf("cross-account callback: %d %s", w.Code, w.Body)
	}
	forged := aiTranscriptBody()
	forged["session_id"] = "another-session"
	if w := f.history(t, forged, f.route.CallbackKey); w.Code != 404 {
		t.Fatalf("cross-chat callback: %d %s", w.Code, w.Body)
	}
	for _, role := range []string{"ai", "tool", "system"} {
		forged = aiTranscriptBody()
		forged["messages"] = []map[string]any{{"message_id": 9, "role": role, "content": "private trace", "created_at": "2026-09-07T00:00:00Z"}}
		if w := f.history(t, forged, f.route.CallbackKey); w.Code != 400 {
			t.Fatalf("inbound %s role: %d %s", role, w.Code, w.Body)
		}
	}
	messages, err := f.repo.ListAIMessages(context.Background(), f.route.CompanyID, f.user.UserID, aiTestRunID, 100, 0)
	if err != nil || len(messages) != 0 {
		t.Fatalf("rejected callbacks stored messages: %+v %v", messages, err)
	}
	unsafe := aiHistoryBody("unsafe-tool", "tool.started", map[string]any{"tool_name": "mango_create_node", "tool_call_id": "call-1", "arguments": "private tool input"})
	if w := f.history(t, unsafe, f.route.CallbackKey); w.Code != 400 {
		t.Fatalf("raw tool payload accepted: %d %s", w.Code, w.Body)
	}
	otherCompany, err := f.repo.CreateCompany("Retained membership")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.repo.AddCompanyMembership(f.user.CognitoSubject, otherCompany.CompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err = f.repo.DeleteCompanyUser(f.route.CompanyID, f.user.UserID, false); err != nil {
		t.Fatal(err)
	}
	if w := f.history(t, body, f.route.CallbackKey); w.Code != 403 {
		t.Fatalf("removed membership callback: %d %s", w.Code, w.Body)
	}
}

func TestAINewChatExistsWithoutNativeRun(t *testing.T) {
	f := newAIFixture(t)
	chatID := store.NewUUIDv7String()
	body := map[string]string{"company_id": f.route.CompanyID, "chat_id": chatID, "name": "New chat"}
	created := f.request(t, http.MethodPost, "/v1/ai/chats", body, f.user)
	if created.Code != 201 {
		t.Fatalf("empty chat: %d %s", created.Code, created.Body)
	}
	detail := f.request(t, http.MethodGet, "/v1/ai/chats/"+chatID+"?company_id="+f.route.CompanyID, nil, f.user)
	var saved struct {
		ChatID      string            `json:"chat_id"`
		Messages    []store.AIMessage `json:"messages"`
		ActiveRunID string            `json:"active_run_id"`
	}
	if detail.Code != 200 || json.Unmarshal(detail.Body.Bytes(), &saved) != nil || saved.ChatID != chatID || len(saved.Messages) != 0 || saved.ActiveRunID != "" {
		t.Fatalf("empty detail: %d %s", detail.Code, detail.Body)
	}
	listed := f.request(t, http.MethodGet, "/v1/ai/chats?company_id="+f.route.CompanyID, nil, f.user)
	if listed.Code != 200 || !strings.Contains(listed.Body.String(), chatID) || !strings.Contains(listed.Body.String(), "New chat") {
		t.Fatalf("empty list: %d %s", listed.Code, listed.Body)
	}
	if f.admissions != 0 || f.streams != 0 {
		t.Fatal("empty chat executed native work")
	}
}

func TestAIPendingStopResolvesOriginalRunAndKeepsActionsClosed(t *testing.T) {
	f := newAIFixture(t)
	f.failAdmission = true
	if w := f.submit(t); w.Code != 502 {
		t.Fatalf("uncertain send: %d %s", w.Code, w.Body)
	}
	stopped := f.request(t, http.MethodPost, "/v1/ai/runs/"+aiTestRunID+"/cancel", map[string]string{"company_id": f.route.CompanyID}, f.user)
	if stopped.Code != 200 {
		t.Fatalf("pending Stop: %d %s", stopped.Code, stopped.Body)
	}
	run, err := f.repo.GetAIRun(context.Background(), f.route.CompanyID, f.user.UserID, aiTestRunID)
	if err != nil || run.RunID != aiTestRunID || run.HermesRunID != "run_test" || run.Status != "stopping" || f.admissions != 2 {
		t.Fatalf("pending Stop lost its identity/gate: %+v admissions=%d err=%v", run, f.admissions, err)
	}
	f.mu.Lock()
	f.status = "running"
	f.mu.Unlock()
	late := f.action(t, "late-after-pending-stop", map[string]any{"logic_gate_id": f.gateID, "process_step_id": f.stepID, "title": "Must remain blocked"})
	if late.Code != 409 {
		t.Fatalf("pending Stop admitted action: %d %s", late.Code, late.Body)
	}
	nodes, err := f.repo.ListNodes(f.route.CompanyID)
	if err != nil || len(nodes) != 0 {
		t.Fatalf("pending Stop created work: %d %v", len(nodes), err)
	}
}
