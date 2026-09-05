package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type assistantResultFixture struct {
	server                       *Server
	repo                         *store.MemoryRepo
	user                         domain.User
	processID, nodeID, requestID string
	owner, key                   string
}

func seedAssistantResult(t *testing.T) assistantResultFixture {
	t.Helper()
	server, repo := assistantTestServer(t, nil)
	user := mustRealtimeAuthUser(t, repo, assistantTestCompany, "assistant-user", domain.RoleCompanyUser)
	process, err := repo.CreateLogicGate(assistantTestCompany, "Saved Process receipt")
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(assistantTestCompany, "Saved Node receipt")
	if err != nil {
		t.Fatal(err)
	}
	server.assistant = &mangoAssistant{active: map[string]bool{}, requests: map[string]time.Time{}, captures: map[string]*assistantCapture{}}
	id := store.NewUUIDv7String()
	owner := assistantTestCompany + ":" + user.UserID
	if !server.assistant.begin(owner, id) {
		t.Fatal("receipt admission failed")
	}
	key := owner + ":" + id
	server.assistant.recordAssistantResult(key, assistantEvent{Type: "process", ProcessID: process.LogicGateID, Name: process.Header})
	server.assistant.recordAssistantResult(key, assistantEvent{Type: "node", ProcessID: process.LogicGateID, NodeID: node.NodeID})
	server.assistant.finishAssistantResult(key)
	server.assistant.finish(owner)
	// Result recovery must never return a neighboring inspection capture.
	server.assistant.captures[key].events = []assistantTrace{{Data: json.RawMessage(`{"context":"private context must not appear"}`)}}
	return assistantResultFixture{server: server, repo: repo, user: user, processID: process.LogicGateID, nodeID: node.NodeID, requestID: id, owner: owner, key: key}
}

func assistantResultRequest(user domain.User, companyID, requestID string) *http.Request {
	return requestWithActorForTest(httptest.NewRequest(http.MethodGet, "/v1/assistant/result?company_id="+companyID+"&request_id="+requestID, nil), user, companyID)
}

func TestAssistantResultRecoversNonDeveloperLinksThroughRegisteredRoute(t *testing.T) {
	fixture := seedAssistantResult(t)
	r := httptest.NewRequest(http.MethodGet, "/v1/assistant/result?company_id="+assistantTestCompany+"&request_id="+fixture.requestID, nil)
	r.Header.Set("Authorization", "Bearer assistant-token")
	response := httptest.NewRecorder()
	fixture.server.Routes().ServeHTTP(response, r)
	if response.Code != http.StatusOK {
		t.Fatalf("ordinary user could not recover saved links: %d %s", response.Code, response.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	process, _ := result["process"].(map[string]any)
	if len(result) != 3 || result["finished"] != true || result["node_id"] != fixture.nodeID || len(process) != 2 || process["id"] != fixture.processID || process["name"] != "Saved Process receipt" {
		t.Fatalf("receipt changed saved links or included extra fields: %+v", result)
	}
	if strings.Contains(response.Body.String(), "private context") || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("resource receipt leaked inspection data or allowed caching")
	}
}

func TestAssistantResultRejectsWrongOwnerCompanyOrExpiredReceipt(t *testing.T) {
	for _, scenario := range []string{"other user", "other company", "expired", "unknown", "invalid", "unauthenticated", "wrong method"} {
		t.Run(scenario, func(t *testing.T) {
			fixture := seedAssistantResult(t)
			r := assistantResultRequest(fixture.user, assistantTestCompany, fixture.requestID)
			want := http.StatusNotFound
			switch scenario {
			case "other user":
				other := mustRealtimeAuthUser(t, fixture.repo, assistantTestCompany, "other-result-user", domain.RoleDevAdmin)
				r = assistantResultRequest(other, assistantTestCompany, fixture.requestID)
			case "other company":
				companyID := store.NewUUIDv7String()
				fixture.repo.EnsureCompany(companyID, "Other company")
				if _, err := fixture.repo.AddCompanyMembership(fixture.user.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
					t.Fatal(err)
				}
				r = assistantResultRequest(fixture.user, companyID, fixture.requestID)
			case "expired":
				fixture.server.assistant.requests[fixture.key] = time.Now().Add(-time.Second)
			case "unknown":
				r = assistantResultRequest(fixture.user, assistantTestCompany, store.NewUUIDv7String())
			case "invalid":
				r = assistantResultRequest(fixture.user, assistantTestCompany, "not-a-request-id")
				want = http.StatusBadRequest
			case "unauthenticated":
				r = httptest.NewRequest(http.MethodGet, "/v1/assistant/result", nil)
				want = http.StatusUnauthorized
			case "wrong method":
				r.Method = http.MethodPost
				want = http.StatusMethodNotAllowed
			}
			response := httptest.NewRecorder()
			fixture.server.handleAssistantResult(response, r)
			if response.Code != want || strings.Contains(response.Body.String(), fixture.nodeID) || strings.Contains(response.Body.String(), fixture.processID) {
				t.Fatalf("receipt authorization failed: status=%d want=%d body=%s", response.Code, want, response.Body.String())
			}
		})
	}
}

func TestAssistantResultFiltersCurrentResourceAccessAndDeletedTargets(t *testing.T) {
	for _, scenario := range []string{"hidden Process", "hidden Node", "deleted Process", "deleted Node", "stale admin"} {
		t.Run(scenario, func(t *testing.T) {
			fixture := seedAssistantResult(t)
			r := assistantResultRequest(fixture.user, assistantTestCompany, fixture.requestID)
			wantProcess, wantNode := true, true
			var err error
			switch scenario {
			case "hidden Process", "stale admin":
				_, err = fixture.repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: assistantTestCompany, EntityType: store.EntityTypeLogicGate, EntityID: fixture.processID, DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true, ActorUserID: fixture.user.UserID})
				wantProcess = false
				if scenario == "stale admin" {
					actor, _ := authenticatedActor(r)
					actor.IsDevAdmin = true
					r = r.WithContext(context.WithValue(r.Context(), actorContextKey{}, actor))
				}
			case "hidden Node":
				_, err = fixture.repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: assistantTestCompany, EntityType: store.EntityTypeNode, EntityID: fixture.nodeID, DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true, ActorUserID: fixture.user.UserID})
				wantNode = false
			case "deleted Process":
				err = fixture.repo.DeleteLogicGate(assistantTestCompany, fixture.processID)
				wantProcess = false
			case "deleted Node":
				err = fixture.repo.DeleteNode(assistantTestCompany, fixture.nodeID)
				wantNode = false
			}
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			fixture.server.handleAssistantResult(response, r)
			if response.Code != http.StatusOK || strings.Contains(response.Body.String(), fixture.processID) != wantProcess || strings.Contains(response.Body.String(), fixture.nodeID) != wantNode {
				t.Fatalf("receipt ignored current access/existence: status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestAssistantResultSurvivesNextSendAndExpiresWithRequest(t *testing.T) {
	fixture := seedAssistantResult(t)
	a := fixture.server.assistant
	nextID := store.NewUUIDv7String()
	if !a.begin(fixture.owner, nextID) || a.results[fixture.key] == nil || a.captures[fixture.key] != nil {
		t.Fatal("next Send erased the small resource receipt or retained old inspection data")
	}
	a.finish(fixture.owner)
	a.requests[fixture.key] = time.Now().Add(-time.Second)
	if !a.begin(fixture.owner, store.NewUUIDv7String()) {
		t.Fatal("receipt expiry prevented a new request")
	}
	if a.results[fixture.key] != nil || !a.requests[fixture.key].IsZero() {
		t.Fatal("expired result was not removed with its request receipt")
	}
}

func TestAssistantResultWaitsForEnteredWorkAndHonorsCancellation(t *testing.T) {
	fixture := seedAssistantResult(t)
	a := fixture.server.assistant
	requestID := store.NewUUIDv7String()
	if !a.begin(fixture.owner, requestID) {
		t.Fatal("request admission failed")
	}
	key := fixture.owner + ":" + requestID
	r := assistantResultRequest(fixture.user, assistantTestCompany, requestID)
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { fixture.server.handleAssistantResult(response, r); close(done) }()
	select {
	case <-done:
		t.Fatal("result returned before the entered work settled")
	case <-time.After(10 * time.Millisecond):
	}
	a.recordAssistantResult(key, assistantEvent{Type: "node", NodeID: fixture.nodeID})
	a.finishAssistantResult(key)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("result did not wake when work settled")
	}
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), fixture.nodeID) || !strings.Contains(response.Body.String(), `"finished":true`) {
		t.Fatalf("result lost the entered action: %d %s", response.Code, response.Body.String())
	}
	a.finish(fixture.owner)
	requestID = store.NewUUIDv7String()
	if !a.begin(fixture.owner, requestID) {
		t.Fatal("request admission failed")
	}
	r = assistantResultRequest(fixture.user, assistantTestCompany, requestID)
	ctx, cancel := context.WithCancel(r.Context())
	cancel()
	response = httptest.NewRecorder()
	fixture.server.handleAssistantResult(response, r.WithContext(ctx))
	if response.Body.Len() != 0 {
		t.Fatalf("cancelled result read returned data: %s", response.Body.String())
	}
}
