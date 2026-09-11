package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/openaiagents"
	"miraeopus/backend/internal/store"
)

type aiOrchestrationProvider struct {
	mu              sync.Mutex
	requests        int
	sessionStatus   string
	turns           []openaiagents.Turn
	pending         []openaiagents.RequiredAction
	failSubmissions int
	results         []map[string]any
	items           map[string]openaiagents.ItemPage
	itemRequests    []string
	deleted         bool
	deleteRequests  int
	messageStatus   int
	dropMessage     bool
	messageStarted  chan struct{}
	messageRelease  chan struct{}
}

func (p *aiOrchestrationProvider) serveHTTP(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.requests++
	w.Header().Set("Content-Type", "application/json")
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/agents/sessions/asess_test":
		json.NewEncoder(w).Encode(map[string]any{"id": "asess_test", "status": p.sessionStatus, "required_actions": p.pending, "error": nil})
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/turns"):
		json.NewEncoder(w).Encode(map[string]any{"data": p.turns, "has_more": false})
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/items"):
		after := r.URL.Query().Get("after")
		p.itemRequests = append(p.itemRequests, after)
		json.NewEncoder(w).Encode(p.items[after])
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/events"):
		var body struct {
			Events []map[string]any `json:"events"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "invalid fixture event", 400)
			return
		}
		for _, event := range body.Events {
			if event["type"] == "agent.session.input.message" {
				if p.dropMessage {
					connection, _, err := w.(http.Hijacker).Hijack()
					if err == nil {
						_ = connection.Close()
					}
					return
				}
				if p.messageStatus != 0 {
					http.Error(w, "fixture rejected followup", p.messageStatus)
					return
				}
				if p.messageStarted != nil {
					started, release := p.messageStarted, p.messageRelease
					p.mu.Unlock()
					close(started)
					<-release
					p.mu.Lock()
				}
			}
			if event["type"] == "agent.session.input.tool_result" {
				p.results = append(p.results, event)
				if p.failSubmissions > 0 {
					p.failSubmissions--
					http.Error(w, "fixture submission outage", 503)
					return
				}
			}
		}
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodDelete && r.URL.Path == "/agents/sessions/asess_test":
		p.deleteRequests++
		if p.deleted {
			http.Error(w, "session already deleted", 404)
			return
		}
		p.deleted = true
		json.NewEncoder(w).Encode(map[string]any{"id": "asess_test", "deleted": true})
	default:
		http.Error(w, "unexpected fixture path", 404)
	}
}

type aiOrchestrationFixture struct {
	repo      *store.MemoryRepo
	server    *Server
	provider  *aiOrchestrationProvider
	local     store.AIAgentSession
	actor     domain.User
	processID string
}

func newAIOrchestrationFixture(t *testing.T) *aiOrchestrationFixture {
	t.Helper()
	repo := store.NewMemoryRepo()
	const company = "77777777-7777-4777-8777-777777777771"
	repo.EnsureCompany(company, "AI orchestration fixture")
	actor := mustLogicGateWorkHTTPUser(t, repo, company, "ai-owner")
	gate, err := repo.CreateLogicGate(company, "Review workflow")
	if err != nil {
		t.Fatal(err)
	}
	provider := &aiOrchestrationProvider{sessionStatus: "requires_action", turns: []openaiagents.Turn{{ID: "turn_test", Status: "waiting"}}}
	remote := httptest.NewServer(http.HandlerFunc(provider.serveHTTP))
	t.Cleanup(remote.Close)
	server := NewServerWithOptions(repo, ServerOptions{DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableRealtimeSpine: true})
	t.Cleanup(server.Close)
	server.aiClient = openaiagents.NewClient("fixture-key", remote.Client(), remote.URL)
	local := store.AIAgentSession{ID: "asess_test", CompanyID: company, UserID: actor.UserID, Prompt: "Review mail", Skills: json.RawMessage(`[]`)}
	if err := repo.CreateAIAgentSession(context.Background(), local); err != nil {
		t.Fatal(err)
	}
	return &aiOrchestrationFixture{repo: repo, server: server, provider: provider, local: local, actor: actor, processID: gate.LogicGateID}
}

func (f *aiOrchestrationFixture) request(method, suffix string, payload any) *http.Request {
	var body []byte
	if payload != nil {
		body, _ = json.Marshal(payload)
	}
	r := httptest.NewRequest(method, "/v1/ai/sessions/"+f.local.ID+suffix+"?company_id="+f.local.CompanyID, bytes.NewReader(body))
	return requestWithLogicGateWorkActorForTest(r, f.actor, f.local.CompanyID)
}

func (f *aiOrchestrationFixture) call(t *testing.T, method, suffix string, payload any, want int) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	f.server.handleAISession(w, f.request(method, suffix, payload))
	if w.Code != want {
		t.Fatalf("%s %s: got %d %s, want %d", method, suffix, w.Code, w.Body, want)
	}
	return w
}

func (f *aiOrchestrationFixture) pendingCreate(title string) openaiagents.RequiredAction {
	args, _ := json.Marshal(map[string]any{"process_id": f.processID, "step_id": nil, "title": title})
	return openaiagents.RequiredAction{Type: "function_call", TurnID: "turn_test", CallID: "call_test", Name: "create_process_node", Arguments: args}
}

func (f *aiOrchestrationFixture) setPending(action openaiagents.RequiredAction) {
	f.provider.mu.Lock()
	defer f.provider.mu.Unlock()
	f.provider.pending = []openaiagents.RequiredAction{action}
}

func (f *aiOrchestrationFixture) nodes(t *testing.T) []domain.Node {
	t.Helper()
	nodes, err := f.repo.ListNodes(f.local.CompanyID)
	if err != nil {
		t.Fatal(err)
	}
	return nodes
}

func (f *aiOrchestrationFixture) actions(t *testing.T) []store.AIAgentAction {
	t.Helper()
	actions, err := f.repo.ListAIAgentActions(context.Background(), f.local.CompanyID, f.local.UserID, f.local.ID)
	if err != nil {
		t.Fatal(err)
	}
	return actions
}

func TestAIAgentSessionScopeStopsBeforeProviderAccess(t *testing.T) {
	f := newAIOrchestrationFixture(t)
	other := mustLogicGateWorkHTTPUser(t, f.repo, f.local.CompanyID, "ai-other")
	otherCompany := "77777777-7777-4777-8777-777777777772"
	f.repo.EnsureCompany(otherCompany, "Other company")
	if _, err := f.repo.AddCompanyMembership(f.actor.CognitoSubject, otherCompany, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	for _, route := range []struct{ method, suffix string }{{http.MethodGet, ""}, {http.MethodDelete, ""}, {http.MethodPost, "/actions/call_test"}, {http.MethodPost, "/advance"}} {
		method := route.method
		r := f.request(method, route.suffix, map[string]any{"turn_id": "turn_test", "approved": true})
		r = requestWithLogicGateWorkActorForTest(r, other, f.local.CompanyID)
		w := httptest.NewRecorder()
		f.server.handleAISession(w, r)
		if w.Code != 404 {
			t.Fatalf("foreign user %s: %d %s", method, w.Code, w.Body)
		}
		r = f.request(method, route.suffix, map[string]any{"turn_id": "turn_test", "approved": true})
		q := r.URL.Query()
		q.Set("company_id", otherCompany)
		r.URL.RawQuery = q.Encode()
		r = requestWithLogicGateWorkActorForTest(r, f.actor, otherCompany)
		w = httptest.NewRecorder()
		f.server.handleAISession(w, r)
		if w.Code != 404 {
			t.Fatalf("foreign company %s: %d %s", method, w.Code, w.Body)
		}
	}
	r := httptest.NewRequest(http.MethodGet, "/v1/ai/sessions/asess_test?company_id="+f.local.CompanyID, nil)
	w := httptest.NewRecorder()
	f.server.handleAISession(w, r)
	if w.Code != 401 {
		t.Fatalf("anonymous access: %d", w.Code)
	}
	f.provider.mu.Lock()
	requests := f.provider.requests
	f.provider.mu.Unlock()
	if requests != 0 {
		t.Fatalf("unauthorized actor made %d provider requests", requests)
	}
}

func TestAIAgentMutationsWaitForExactApprovalAndConcurrentDecisionsRunOnce(t *testing.T) {
	f := newAIOrchestrationFixture(t)
	f.setPending(f.pendingCreate("Original approved title"))
	f.call(t, http.MethodPost, "/advance", nil, 200)
	if len(f.nodes(t)) != 0 {
		t.Fatal("provider mutated app before approval")
	}
	actions := f.actions(t)
	if len(actions) != 1 || actions[0].State != "pending" || !actions[0].Consequential {
		t.Fatalf("missing pending approval: %+v", actions)
	}
	// A provider refresh cannot silently replace the exact arguments shown to the user.
	f.setPending(f.pendingCreate("Changed provider title"))
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := f.request(http.MethodPost, "/actions/call_test", map[string]any{"turn_id": "turn_test", "approved": true})
			if err := f.server.decideAIAction(r, f.local, "turn_test", "call_test", true); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	nodes := f.nodes(t)
	if len(nodes) != 1 || nodes[0].Title != "Original approved title" {
		t.Fatalf("approval did not create exactly one original action: %+v; receipts %+v", nodes, f.actions(t))
	}
	if got := f.actions(t)[0]; got.State != "completed" {
		t.Fatalf("missing durable completion: %+v", got)
	}
}

func TestAIAgentSavedResultReusedAfterProviderSubmissionFailure(t *testing.T) {
	f := newAIOrchestrationFixture(t)
	f.setPending(f.pendingCreate("One committed node"))
	f.call(t, http.MethodPost, "/advance", nil, 200)
	f.provider.mu.Lock()
	f.provider.failSubmissions = 1
	f.provider.mu.Unlock()
	f.call(t, http.MethodPost, "/actions/call_test", map[string]any{"turn_id": "turn_test", "approved": true}, 502)
	actions := f.actions(t)
	if len(f.nodes(t)) != 1 || len(actions) != 1 || actions[0].State != "completed" || len(actions[0].Output) == 0 {
		t.Fatalf("result not durable before provider submission: %+v", actions)
	}
	f.call(t, http.MethodPost, "/advance", nil, 200)
	if len(f.nodes(t)) != 1 {
		t.Fatal("recovery repeated the app mutation")
	}
	f.provider.mu.Lock()
	defer f.provider.mu.Unlock()
	if len(f.provider.results) != 2 || f.provider.results[0]["output"] != f.provider.results[1]["output"] || f.provider.results[1]["success"] != true {
		t.Fatalf("recovery did not replay exact saved output: %+v", f.provider.results)
	}
}

func TestAIAgentRejectedAndExecutingReceiptsNeverRerun(t *testing.T) {
	for _, state := range []string{"rejected", "executing"} {
		t.Run(state, func(t *testing.T) {
			f := newAIOrchestrationFixture(t)
			f.setPending(f.pendingCreate("Must not run"))
			f.call(t, http.MethodPost, "/advance", nil, 200)
			if state == "rejected" {
				f.call(t, http.MethodPost, "/actions/call_test", map[string]any{"turn_id": "turn_test", "approved": false}, 200)
			} else {
				claimed, err := f.repo.ClaimAIAgentAction(context.Background(), f.local.CompanyID, f.local.UserID, f.local.ID, "turn_test", "call_test")
				if err != nil || !claimed {
					t.Fatalf("crash receipt setup: %v %v", claimed, err)
				}
			}
			f.call(t, http.MethodPost, "/advance", nil, 200)
			f.call(t, http.MethodPost, "/actions/call_test", map[string]any{"turn_id": "turn_test", "approved": true}, 200)
			if len(f.nodes(t)) != 0 || f.actions(t)[0].State != state {
				t.Fatalf("%s receipt reran: %+v", state, f.actions(t))
			}
			f.provider.mu.Lock()
			defer f.provider.mu.Unlock()
			if state == "executing" && len(f.provider.results) != 0 {
				t.Fatal("uncertain crash receipt invented a provider result")
			}
			for _, result := range f.provider.results {
				if result["success"] != false {
					t.Fatalf("rejection became success: %+v", result)
				}
			}
		})
	}
}

func TestAIAgentCancelGatesStaleActionClaims(t *testing.T) {
	f := newAIOrchestrationFixture(t)
	f.setPending(f.pendingCreate("Cancelled work"))
	f.call(t, http.MethodPost, "/advance", nil, 200)
	action := f.actions(t)[0]
	f.call(t, http.MethodPost, "/cancel", nil, 200)
	f.call(t, http.MethodPost, "/actions/call_test", map[string]any{"turn_id": "turn_test", "approved": true}, 409)
	// A request that read local state before cancellation still cannot claim later.
	if err := f.server.runAIAction(f.request(http.MethodPost, "/advance", nil), f.local, action, true); err != nil {
		t.Fatal(err)
	}
	if len(f.nodes(t)) != 0 || f.actions(t)[0].State != "pending" {
		t.Fatalf("cancelled session executed stale action: %+v", f.actions(t))
	}
}

func TestAIAgentSnapshotUsesTurnOutcomeAndSessionFailure(t *testing.T) {
	for _, test := range []struct{ name, session, turn, want string }{{"idle_no_turn", "idle", "", "queued"}, {"idle_failed_turn", "idle", "failed", "failed"}, {"failed_before_turn", "failed", "", "failed"}, {"cancelled_turn", "idle", "cancelled", "cancelled"}} {
		t.Run(test.name, func(t *testing.T) {
			f := newAIOrchestrationFixture(t)
			f.provider.mu.Lock()
			f.provider.sessionStatus = test.session
			f.provider.pending = nil
			f.provider.turns = nil
			if test.turn != "" {
				f.provider.turns = []openaiagents.Turn{{ID: "turn_test", Status: test.turn}}
			}
			f.provider.mu.Unlock()
			view, err := f.server.aiSnapshot(context.Background(), f.local, "")
			if err != nil || view.Status != test.want {
				t.Fatalf("snapshot status %q, error %v; want %q", view.Status, err, test.want)
			}
		})
	}
}

func TestAIAgentSnapshotHidesNoLongerPendingApproval(t *testing.T) {
	f := newAIOrchestrationFixture(t)
	f.setPending(f.pendingCreate("Old turn action"))
	f.call(t, http.MethodPost, "/advance", nil, 200)
	f.provider.mu.Lock()
	f.provider.pending = nil
	f.provider.sessionStatus = "idle"
	f.provider.turns = []openaiagents.Turn{{ID: "turn_test", Status: "cancelled"}}
	f.provider.mu.Unlock()
	view, err := f.server.aiSnapshot(context.Background(), f.local, "")
	if err != nil || len(view.Actions) != 0 {
		t.Fatalf("stale approval still presented: %+v, %v", view.Actions, err)
	}
	if len(f.actions(t)) != 1 {
		t.Fatal("hiding obsolete approval deleted its durable receipt")
	}
	if err := f.server.decideAIAction(f.request(http.MethodPost, "/actions/call_test", nil), f.local, "turn_test", "call_test", true); err == nil {
		t.Fatal("approved action no longer pending at provider")
	}
	if len(f.nodes(t)) != 0 {
		t.Fatal("stale approval mutated work")
	}
}

func TestAIAgentSnapshotPagesWithoutSkippingChangingMessage(t *testing.T) {
	f := newAIOrchestrationFixture(t)
	part := func(text string) []openaiagents.ContentPart {
		return []openaiagents.ContentPart{{Type: "output_text", Text: text}}
	}
	f.provider.mu.Lock()
	f.provider.items = map[string]openaiagents.ItemPage{
		"": {Data: []openaiagents.Item{
			{ID: "tool_0", Type: "function_call_output", Status: "completed"},
			{ID: "user_1", Type: "message", Role: "user", Status: "completed", Content: part("Review this workflow")},
			{ID: "ai_1", Type: "message", Role: "assistant", Status: "in_progress", Content: part("Reading")},
		}, LastID: "ai_1", HasMore: true},
		"user_1": {Data: []openaiagents.Item{{ID: "ai_1", Type: "message", Role: "assistant", Status: "in_progress", Content: part("Still reading")}}, LastID: "ai_1"},
	}
	f.provider.mu.Unlock()
	view, err := f.server.aiSnapshot(context.Background(), f.local, "")
	if err != nil || view.ItemsCursor != "user_1" || !view.ItemsHasMore || len(view.Items) != 2 || view.Items[1].ID != "ai_1" || view.Items[1].Role != "ai" {
		t.Fatalf("first page crossed mutable message or exposed tool output: %+v, %v", view, err)
	}
	// The public query passes the exact opaque item cursor through to OpenAI.
	r := f.request(http.MethodGet, "", nil)
	q := r.URL.Query()
	q.Set("items_after", view.ItemsCursor)
	r.URL.RawQuery = q.Encode()
	w := httptest.NewRecorder()
	f.server.handleAISession(w, r)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &view) != nil {
		t.Fatalf("incremental HTTP snapshot: %d %s", w.Code, w.Body)
	}
	if view.ItemsCursor != "user_1" || view.ItemsHasMore || len(view.Items) != 1 || view.Items[0].Text != "Still reading" {
		t.Fatalf("mutable message was not refreshed: %+v", view)
	}
	f.provider.mu.Lock()
	if len(f.provider.itemRequests) != 2 || f.provider.itemRequests[0] != "" || f.provider.itemRequests[1] != "user_1" {
		t.Fatalf("snapshot read more than its one requested page: %+v", f.provider.itemRequests)
	}
	f.provider.items["user_1"] = openaiagents.ItemPage{Data: []openaiagents.Item{
		{ID: "ai_1", Type: "message", Role: "assistant", Status: "completed", Content: part("Read complete")},
		{ID: "tool_1", Type: "function_call_output", Status: "completed"},
		{ID: "ai_2", Type: "message", Role: "assistant", Status: "incomplete", Content: part("Stopped answer")},
	}, LastID: "ai_2"}
	f.provider.mu.Unlock()
	view, err = f.server.aiSnapshot(context.Background(), f.local, "user_1")
	if err != nil || view.ItemsCursor != "ai_2" || len(view.Items) != 2 || view.ItemsHasMore {
		t.Fatalf("settled messages did not advance cursor: %+v, %v", view, err)
	}
	view, err = f.server.aiSnapshot(context.Background(), f.local, view.ItemsCursor)
	if err != nil || view.ItemsCursor != "ai_2" || len(view.Items) != 0 || view.ItemsHasMore {
		t.Fatalf("empty new page reset the cursor: %+v, %v", view, err)
	}
}

func TestAIAgentFollowupAwaitsNewTurnInsteadOfOldCompletion(t *testing.T) {
	f := newAIOrchestrationFixture(t)
	f.provider.mu.Lock()
	f.provider.sessionStatus = "idle"
	f.provider.turns = []openaiagents.Turn{{ID: "turn_old", Status: "completed"}}
	f.provider.mu.Unlock()
	w := f.call(t, http.MethodPost, "/messages", map[string]any{"prompt": "Now review the next workflow"}, 200)
	var view aiSessionView
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil || view.Status != "queued" {
		t.Fatalf("followup reused old completion: %s, %v", w.Body, err)
	}
	local, err := f.repo.GetAIAgentSession(context.Background(), f.local.CompanyID, f.local.UserID, f.local.ID)
	if err != nil || local.AwaitingTurnAfter != "turn_old" {
		t.Fatalf("followup marker missing: %+v, %v", local, err)
	}
	f.provider.mu.Lock()
	f.provider.turns = []openaiagents.Turn{{ID: "turn_old", Status: "failed", Error: &openaiagents.TurnError{Code: "rate_limit_exceeded", Message: "old failure"}}}
	f.provider.mu.Unlock()
	view, err = f.server.aiSnapshot(context.Background(), local, "")
	if err != nil || view.Status != "queued" || view.Error != "" {
		t.Fatalf("new followup inherited the previous turn's failure: %+v, %v", view, err)
	}
	f.provider.mu.Lock()
	f.provider.sessionStatus = "in_progress"
	f.provider.turns = []openaiagents.Turn{{ID: "turn_new", Status: "in_progress"}, {ID: "turn_old", Status: "completed"}}
	f.provider.mu.Unlock()
	view, err = f.server.aiSnapshot(context.Background(), local, "")
	if err != nil || view.Status != "in_progress" {
		t.Fatalf("new turn did not replace queued marker: %+v, %v", view, err)
	}
}

func TestAIAgentStoppedSessionDoesNotClaimProviderCancellation(t *testing.T) {
	f := newAIOrchestrationFixture(t)
	f.local.Stopped = true
	view, err := f.server.aiSnapshot(context.Background(), f.local, "")
	if err != nil || !view.Stopped || view.Status != "waiting" || !strings.Contains(view.Error, "has not confirmed") {
		t.Fatalf("local stop claimed remote cancellation: %+v, %v", view, err)
	}
	f.provider.mu.Lock()
	f.provider.turns = []openaiagents.Turn{{ID: "turn_test", Status: "cancelled"}}
	f.provider.mu.Unlock()
	view, err = f.server.aiSnapshot(context.Background(), f.local, "")
	if err != nil || view.Status != "cancelled" || view.Error != "" {
		t.Fatalf("confirmed cancellation was not reflected: %+v, %v", view, err)
	}
}

func TestAIAgentSnapshotCountsReadsAndRecoveryLoadsOneSavedResult(t *testing.T) {
	f := newAIOrchestrationFixture(t)
	ctx := context.Background()
	for _, saved := range []struct {
		call, name, state string
		consequential     bool
	}{
		{"mail_page_1", "list_email_messages", "completed", false},
		{"mail_page_2", "list_email_messages", "completed", false},
		{"mail_body_1", "read_email_message", "completed", false},
		{"mail_failed", "read_email_message", "failed", false},
		{"node_created", "create_process_node", "completed", true},
	} {
		a := store.AIAgentAction{SessionID: f.local.ID, TurnID: "turn_test", CallID: saved.call, Name: saved.name, Arguments: json.RawMessage(`{}`), Consequential: saved.consequential}
		if err := f.repo.PutAIAgentAction(ctx, f.local.CompanyID, f.local.UserID, a); err != nil {
			t.Fatal(err)
		}
		if claimed, err := f.repo.ClaimAIAgentAction(ctx, f.local.CompanyID, f.local.UserID, f.local.ID, a.TurnID, a.CallID); !claimed || err != nil {
			t.Fatalf("claim fixture: %v %v", claimed, err)
		}
		a.State, a.Output = saved.state, json.RawMessage(`{"saved":"private mailbox body"}`)
		if a.State == "failed" {
			a.Error = "message unavailable"
		}
		if err := f.repo.FinishAIAgentAction(ctx, f.local.CompanyID, f.local.UserID, a); err != nil {
			t.Fatal(err)
		}
	}
	view, err := f.server.aiSnapshot(ctx, f.local, "")
	if err != nil || view.ReadCounts["list_email_messages"] != 2 || view.ReadCounts["read_email_message"] != 1 || len(view.Actions) != 2 {
		t.Fatalf("read progress is not compact: %+v, %v", view, err)
	}
	for _, a := range view.Actions {
		if !a.Consequential && len(a.Output) != 0 {
			t.Fatal("progress exposed readonly result body")
		}
	}
	f.setPending(openaiagents.RequiredAction{Type: "function_call", TurnID: "turn_test", CallID: "mail_body_1", Name: "read_email_message", Arguments: json.RawMessage(`{}`)})
	if err := f.server.advanceAI(f.request(http.MethodPost, "/advance", nil), f.local); err != nil {
		t.Fatal(err)
	}
	f.provider.mu.Lock()
	defer f.provider.mu.Unlock()
	if len(f.provider.results) != 1 || f.provider.results[0]["output"] != `{"saved":"private mailbox body"}` || f.provider.results[0]["success"] != true {
		t.Fatalf("recovery used metadata instead of exact saved body: %+v", f.provider.results)
	}
}

type aiDeleteOnceFailureRepo struct {
	store.Repository
	failed bool
}

func (r *aiDeleteOnceFailureRepo) DeleteAIAgentSession(ctx context.Context, company, user, id string) error {
	if !r.failed {
		r.failed = true
		return errors.New("fixture local delete failure")
	}
	return r.Repository.DeleteAIAgentSession(ctx, company, user, id)
}

func TestAIAgentDeleteRetriesLocalCleanupAfterProviderAlreadyDeleted(t *testing.T) {
	f := newAIOrchestrationFixture(t)
	f.server.repo = &aiDeleteOnceFailureRepo{Repository: f.repo}
	f.call(t, http.MethodDelete, "", nil, 503)
	local, err := f.repo.GetAIAgentSession(context.Background(), f.local.CompanyID, f.local.UserID, f.local.ID)
	if err != nil || !local.Stopped {
		t.Fatalf("failed local deletion must leave a stopped recoverable row: %+v, %v", local, err)
	}
	f.call(t, http.MethodDelete, "", nil, 200)
	if _, err := f.repo.GetAIAgentSession(context.Background(), f.local.CompanyID, f.local.UserID, f.local.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("provider404 blocked local cleanup retry: %v", err)
	}
	f.provider.mu.Lock()
	defer f.provider.mu.Unlock()
	if f.provider.deleteRequests != 2 {
		t.Fatalf("expected first delete and confirmed missing retry, got %d", f.provider.deleteRequests)
	}
}

func TestAIAgentFollowupRestoresMarkerOnlyForDefinitiveRejection(t *testing.T) {
	for _, test := range []struct {
		name            string
		status          int
		drop, uncertain bool
	}{
		{"bad_request", 400, false, false},
		{"authentication", 401, false, false},
		{"access", 403, false, false},
		{"missing", 404, false, false},
		{"conflict", 409, false, false},
		{"rate_limit", 429, false, false},
		{"timeout", 408, false, true},
		{"server_failure", 503, false, true},
		{"connection_lost", 0, true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newAIOrchestrationFixture(t)
			if err := f.repo.AwaitAIAgentTurn(context.Background(), f.local.CompanyID, f.local.UserID, f.local.ID, "previous_marker"); err != nil {
				t.Fatal(err)
			}
			f.provider.mu.Lock()
			f.provider.sessionStatus = "idle"
			f.provider.turns = []openaiagents.Turn{{ID: "turn_old", Status: "completed"}}
			f.provider.messageStatus, f.provider.dropMessage = test.status, test.drop
			f.provider.mu.Unlock()
			wantHTTP := 502
			if test.drop {
				wantHTTP = 503
			}
			f.call(t, http.MethodPost, "/messages", map[string]any{"prompt": "Start next workflow"}, wantHTTP)
			local, err := f.repo.GetAIAgentSession(context.Background(), f.local.CompanyID, f.local.UserID, f.local.ID)
			wantMarker := "previous_marker"
			if test.uncertain {
				wantMarker = "turn_old"
			}
			if err != nil || local.AwaitingTurnAfter != wantMarker {
				t.Fatalf("rejection tracking: marker %q want %q, %v", local.AwaitingTurnAfter, wantMarker, err)
			}
		})
	}
}

func TestAIAgentStoppedSessionRejectsFollowupWithoutProviderWork(t *testing.T) {
	f := newAIOrchestrationFixture(t)
	if err := f.repo.StopAIAgentSession(context.Background(), f.local.CompanyID, f.local.UserID, f.local.ID); err != nil {
		t.Fatal(err)
	}
	f.call(t, http.MethodPost, "/messages", map[string]any{"prompt": "Resume work"}, 409)
	f.provider.mu.Lock()
	defer f.provider.mu.Unlock()
	if f.provider.requests != 0 {
		t.Fatalf("stopped followup sent %d provider requests", f.provider.requests)
	}
}

func TestAIAgentInflightFollowupCannotUndoConcurrentStop(t *testing.T) {
	f := newAIOrchestrationFixture(t)
	started, release := make(chan struct{}), make(chan struct{})
	f.provider.mu.Lock()
	f.provider.messageStarted, f.provider.messageRelease = started, release
	f.provider.mu.Unlock()
	response := httptest.NewRecorder()
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		f.server.handleAISession(response, f.request(http.MethodPost, "/messages", map[string]any{"prompt": "Next workflow"}))
	}()
	<-started
	f.call(t, http.MethodPost, "/cancel", nil, 200)
	close(release)
	<-finished
	if response.Code != 200 {
		t.Fatalf("inflight followup: %d %s", response.Code, response.Body)
	}
	local, err := f.repo.GetAIAgentSession(context.Background(), f.local.CompanyID, f.local.UserID, f.local.ID)
	if err != nil || !local.Stopped {
		t.Fatalf("followup cleared concurrent stop: %+v, %v", local, err)
	}
	var view aiSessionView
	if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil || !view.Stopped {
		t.Fatalf("followup response hid concurrent stop: %s, %v", response.Body, err)
	}
}
