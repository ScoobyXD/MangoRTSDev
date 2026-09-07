package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAIHistoryNeverBindsAnOlderRunToANewerSubmission(t *testing.T) {
	f := newAIFixture(t)
	f.failAdmission = true
	if w := f.submit(t); w.Code != 502 {
		t.Fatalf("pending admission: %d %s", w.Code, w.Body)
	}
	if w := f.history(t, aiTranscriptBody(), f.route.CallbackKey); w.Code != 503 {
		t.Fatalf("unknown history should wait: %d %s", w.Code, w.Body)
	}
	run, err := f.repo.GetAIRun(context.Background(), f.route.CompanyID, f.user.UserID, aiTestRunID)
	if err != nil || run.HermesRunID != "" {
		t.Fatalf("callback inferred ownership: %+v %v", run, err)
	}
	if _, err = f.repo.BindAIRun(context.Background(), f.route.CompanyID, f.user.UserID, aiTestRunID, "run_new"); err != nil {
		t.Fatal(err)
	}
	if w := f.history(t, aiTranscriptBody(), f.route.CallbackKey); w.Code != 410 {
		t.Fatalf("older callback should be parked: %d %s", w.Code, w.Body)
	}
	messages, err := f.repo.ListAIMessages(context.Background(), f.route.CompanyID, f.user.UserID, aiTestRunID, 100, 0)
	if err != nil || len(messages) != 0 {
		t.Fatalf("older callback imported messages: %+v %v", messages, err)
	}
}

func TestAIEarlyActionResolvesTheExactAdmissionKey(t *testing.T) {
	f := newAIFixture(t)
	f.failAdmission = true
	if w := f.submit(t); w.Code != 502 {
		t.Fatalf("pending admission: %d %s", w.Code, w.Body)
	}
	native := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/runs/run_test":
			writeJSON(w, 200, map[string]string{"run_id": "run_test", "session_id": aiTestRunID, "status": "running"})
		case "/v1/capabilities":
			writeJSON(w, 200, map[string]any{"features": map[string]any{"runs_idempotency": map[string]bool{"durable": true}}})
		case "/v1/runs":
			if r.Header.Get("Idempotency-Key") != aiTestRunID {
				t.Error("callback did not resolve exact local admission key")
			}
			writeJSON(w, 202, map[string]string{"run_id": "run_new"})
		default:
			t.Errorf("unexpected native request: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer native.Close()
	f.s.hermesRoutes[0].URL = native.URL
	w := f.action(t, "old-tool", map[string]any{"logic_gate_id": f.gateID, "process_step_id": f.stepID, "title": "Must not create"})
	if w.Code != 409 {
		t.Fatalf("old action accepted: %d %s", w.Code, w.Body)
	}
	run, err := f.repo.GetAIRun(context.Background(), f.route.CompanyID, f.user.UserID, aiTestRunID)
	if err != nil || run.HermesRunID != "run_new" {
		t.Fatalf("old action replaced execution identity: %+v %v", run, err)
	}
	nodes, err := f.repo.ListNodes(f.route.CompanyID)
	if err != nil || len(nodes) != 0 {
		t.Fatalf("old action created work: %+v %v", nodes, err)
	}
}

func TestAIHistoryRetainsImmutableEventsAfterNativeRetention(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("admission: %d %s", w.Code, w.Body)
	}
	if _, err := f.repo.SetAIRunStatus(context.Background(), f.route.CompanyID, f.user.UserID, aiTestRunID, "completed"); err != nil {
		t.Fatal(err)
	}
	f.s.hermesRoutes[0].URL = "http://127.0.0.1:1"
	body := aiHistoryBody("run_test:final", "message.completed", map[string]any{"output": "Durable final text"})
	if w := f.history(t, body, f.route.CallbackKey); w.Code != 200 {
		t.Fatalf("offline bound history: %d %s", w.Code, w.Body)
	}
	body["data"] = map[string]any{"output": "Changed event"}
	if w := f.history(t, body, f.route.CallbackKey); w.Code != 409 {
		t.Fatalf("history overwritten: %d %s", w.Code, w.Body)
	}
	body["event_id"] = "status:running"
	if w := f.history(t, body, f.route.CallbackKey); w.Code != 400 {
		t.Fatalf("reserved history namespace accepted: %d %s", w.Code, w.Body)
	}
	w := f.request(t, http.MethodGet, "/v1/ai/runs/"+aiTestRunID+"?company_id="+f.route.CompanyID, nil, f.user)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Durable final text") {
		t.Fatalf("offline saved run: %d %s", w.Code, w.Body)
	}
}

func TestAINativeQueuedExecutionKeepsLocalAdmission(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("admission: %d %s", w.Code, w.Body)
	}
	f.mu.Lock()
	f.status = "queued"
	f.mu.Unlock()
	w := f.request(t, http.MethodGet, "/v1/ai/runs/"+aiTestRunID+"?company_id="+f.route.CompanyID, nil, f.user)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"running"`) {
		t.Fatalf("native queued admission: %d %s", w.Code, w.Body)
	}
}
