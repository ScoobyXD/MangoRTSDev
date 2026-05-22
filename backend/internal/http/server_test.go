package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func readWorkspaceEventForTest(t *testing.T, ch chan []byte) workspaceEventEnvelope {
	t.Helper()
	select {
	case payload := <-ch:
		var event workspaceEventEnvelope
		if err := json.Unmarshal(payload, &event); err != nil {
			t.Fatalf("decode workspace event: %v", err)
		}
		return event
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for workspace event")
		return workspaceEventEnvelope{}
	}
}

type sseEventForTest struct {
	ID    string
	Event string
	Data  string
}

type workspaceReadyForTest struct {
	CompanyID     string `json:"company_id"`
	AfterSequence int64  `json:"after_sequence"`
}

func openWorkspaceStreamForTest(t *testing.T, handler http.Handler, target string, configure func(*http.Request)) (*bufio.Reader, context.CancelFunc) {
	t.Helper()
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+target, nil)
	if err != nil {
		cancel()
		t.Fatalf("new stream request: %v", err)
	}
	if configure != nil {
		configure(req)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		cancel()
		t.Fatalf("open workspace stream: %v", err)
	}
	t.Cleanup(func() {
		resp.Body.Close()
		cancel()
	})
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		cancel()
		t.Fatalf("workspace stream status = %d body=%s", resp.StatusCode, string(body))
	}
	return bufio.NewReader(resp.Body), cancel
}

func readSSEEventForTest(t *testing.T, reader *bufio.Reader) sseEventForTest {
	t.Helper()
	for {
		event, err := readRawSSEEventForTest(reader)
		if err != nil {
			t.Fatalf("read SSE event: %v", err)
		}
		if event.ID != "" || event.Event != "" || event.Data != "" {
			return event
		}
	}
}

func readRawSSEEventForTest(reader *bufio.Reader) (sseEventForTest, error) {
	var event sseEventForTest
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return event, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			return event, nil
		}
		switch {
		case strings.HasPrefix(line, "id:"):
			event.ID = strings.TrimSpace(strings.TrimPrefix(line, "id:"))
		case strings.HasPrefix(line, "event:"):
			event.Event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			value := strings.TrimPrefix(line, "data:")
			value = strings.TrimPrefix(value, " ")
			if event.Data != "" {
				event.Data += "\n"
			}
			event.Data += value
		}
	}
}

func readWorkspaceReadyForTest(t *testing.T, reader *bufio.Reader) workspaceReadyForTest {
	t.Helper()
	event := readSSEEventForTest(t, reader)
	if event.Event != "ready" {
		t.Fatalf("first SSE event = %q data=%s, want ready", event.Event, event.Data)
	}
	var ready workspaceReadyForTest
	if err := json.Unmarshal([]byte(event.Data), &ready); err != nil {
		t.Fatalf("decode ready event: %v", err)
	}
	return ready
}

func readWorkspaceSSEForTest(t *testing.T, reader *bufio.Reader) workspaceEventEnvelope {
	t.Helper()
	for {
		event := readSSEEventForTest(t, reader)
		switch event.Event {
		case "workspace":
			var envelope workspaceEventEnvelope
			if err := json.Unmarshal([]byte(event.Data), &envelope); err != nil {
				t.Fatalf("decode workspace SSE event: %v", err)
			}
			return envelope
		case "ready", "ping":
			continue
		default:
			t.Fatalf("unexpected SSE event = %q data=%s", event.Event, event.Data)
		}
	}
}

func requestWithActorForTest(req *http.Request, user domain.User, companyID string) *http.Request {
	actor := ActorContext{
		User: user,
		Memberships: []domain.CompanyMembership{{
			CompanyID: companyID,
			UserID:    user.UserID,
			Role:      domain.RoleCompanyAdmin,
		}},
		CompanyID:   companyID,
		CompanyRole: domain.RoleCompanyAdmin,
	}
	return req.WithContext(context.WithValue(req.Context(), actorContextKey{}, actor))
}

func handlerWithCompanyAdminForTest(handler http.Handler, companyID string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := authenticatedActor(r); ok {
			handler.ServeHTTP(w, r)
			return
		}
		actor := ActorContext{
			User: domain.User{UserID: "test-company-admin", Email: "admin@example.com", DisplayName: "Test Admin"},
			Memberships: []domain.CompanyMembership{{
				CompanyID: companyID,
				UserID:    "test-company-admin",
				Role:      domain.RoleCompanyAdmin,
			}},
			CompanyID:   companyID,
			CompanyRole: domain.RoleCompanyAdmin,
		}
		handler.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorContextKey{}, actor)))
	})
}

func newServerWithLegacyMapRoutesForTest(repo store.Repository) *Server {
	return NewServerWithOptions(repo, ServerOptions{LegacyMapRoutesEnabled: true})
}

func TestWorkspaceStreamReceivesDurableEventsFromOtherServer(t *testing.T) {
	repo := store.NewMemoryRepo()
	serverA := NewServer(repo)
	serverB := NewServer(repo)
	companyID := "stream-two-server-company"

	reader, cancel := openWorkspaceStreamForTest(t, serverA.Routes(), "/v1/workspace/stream?company_id="+companyID, nil)
	defer cancel()
	ready := readWorkspaceReadyForTest(t, reader)
	if ready.CompanyID != companyID || ready.AfterSequence != 0 {
		t.Fatalf("ready = %+v, want company %q after_sequence 0", ready, companyID)
	}

	serverB.publishWorkspaceEvent(companyID, "node_created", map[string]any{"node_id": "node-from-server-b"})
	event := readWorkspaceSSEForTest(t, reader)
	if event.Sequence != 1 || event.Type != "node_created" || event.Data["node_id"] != "node-from-server-b" {
		t.Fatalf("durable catch-up event = %+v, want server B node_created sequence 1", event)
	}
}

func TestWorkspaceStreamReplaysFromLastEventID(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "stream-reconnect-company"

	for index := 1; index <= 3; index++ {
		server.publishWorkspaceEvent(companyID, fmt.Sprintf("reconnect_event_%d", index), map[string]any{"index": index})
	}

	reader, cancel := openWorkspaceStreamForTest(t, server.Routes(), "/v1/workspace/stream?company_id="+companyID, func(req *http.Request) {
		req.Header.Set("Last-Event-ID", "1")
	})
	defer cancel()
	ready := readWorkspaceReadyForTest(t, reader)
	if ready.AfterSequence != 1 {
		t.Fatalf("ready after_sequence = %d, want 1", ready.AfterSequence)
	}

	second := readWorkspaceSSEForTest(t, reader)
	if second.Sequence != 2 || second.Type != "reconnect_event_2" {
		t.Fatalf("first replay event = %+v, want sequence 2 reconnect_event_2", second)
	}
	third := readWorkspaceSSEForTest(t, reader)
	if third.Sequence != 3 || third.Type != "reconnect_event_3" {
		t.Fatalf("second replay event = %+v, want sequence 3 reconnect_event_3", third)
	}
}

func TestWorkspaceStreamExplicitZeroReplaysPastOneBatch(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "stream-backlog-company"
	total := workspaceReplayLimit + 25

	for index := 1; index <= total; index++ {
		_, err := repo.AppendDomainEvent(store.DomainEventInput{
			CompanyID:  companyID,
			StreamType: workspaceDomainStreamType,
			StreamID:   companyID,
			Type:       fmt.Sprintf("backlog_event_%03d", index),
			Payload:    map[string]any{"index": index},
		})
		if err != nil {
			t.Fatalf("AppendDomainEvent %d: %v", index, err)
		}
	}

	reader, cancel := openWorkspaceStreamForTest(t, server.Routes(), "/v1/workspace/stream?company_id="+companyID+"&after_sequence=0", nil)
	defer cancel()
	ready := readWorkspaceReadyForTest(t, reader)
	if ready.AfterSequence != 0 {
		t.Fatalf("ready after_sequence = %d, want explicit 0", ready.AfterSequence)
	}

	var last workspaceEventEnvelope
	for sequence := 1; sequence <= total; sequence++ {
		last = readWorkspaceSSEForTest(t, reader)
		if last.Sequence != int64(sequence) {
			t.Fatalf("replay sequence = %d, want %d", last.Sequence, sequence)
		}
	}
	wantType := fmt.Sprintf("backlog_event_%03d", total)
	if last.Type != wantType {
		t.Fatalf("last replay type = %q, want %q", last.Type, wantType)
	}
}

func TestIsLegalNodeRelationshipPositionPair(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		a    string
		b    string
		want bool
	}{
		{name: "parent_child", a: "Parent", b: "Child", want: true},
		{name: "child_parent", a: "Child", b: "Parent", want: true},
		{name: "peer_peer", a: "Peer", b: "Peer", want: true},
		{name: "parent_parent", a: "Parent", b: "Parent", want: false},
		{name: "child_child", a: "Child", b: "Child", want: false},
		{name: "parent_peer", a: "Parent", b: "Peer", want: false},
		{name: "peer_child", a: "Peer", b: "Child", want: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := isLegalNodeRelationshipPositionPair(tc.a, tc.b)
			if got != tc.want {
				t.Fatalf("isLegalNodeRelationshipPositionPair(%q, %q) = %t, want %t", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

func TestIsLegalLogicGateRelationshipPositionPair(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		a    string
		b    string
		want bool
	}{
		{name: "input_output", a: "Input", b: "Output", want: true},
		{name: "output_input", a: "Output", b: "Input", want: true},
		{name: "input_input", a: "Input", b: "Input", want: false},
		{name: "output_output", a: "Output", b: "Output", want: false},
		{name: "input_peer", a: "Input", b: "Peer", want: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := isLegalLogicGateRelationshipPositionPair(tc.a, tc.b)
			if got != tc.want {
				t.Fatalf("isLegalLogicGateRelationshipPositionPair(%q, %q) = %t, want %t", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

func TestLogicGateCRUDRelationshipAndInformationAPI(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-logic-gate-test"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	createGate := func(header string) string {
		t.Helper()
		body, _ := json.Marshal(map[string]string{
			"company_id": companyID,
			"header":     header,
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/logic-gates", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST logic-gates status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
		}
		var payload struct {
			LogicGateID string `json:"logic_gate_id"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("decode created gate: %v", err)
		}
		return payload.LogicGateID
	}

	firstID := createGate("new logic gate")
	secondID := createGate("second logic gate")

	relationshipBody, _ := json.Marshal(map[string]string{
		"company_id":      companyID,
		"logic_gate_id_a": firstID,
		"logic_gate_id_b": secondID,
		"a_position":      "Output",
		"b_position":      "Input",
	})
	relationshipReq := httptest.NewRequest(http.MethodPost, "/v1/logic-gate-relationships", bytes.NewReader(relationshipBody))
	relationshipReq.Header.Set("Content-Type", "application/json")
	relationshipRec := httptest.NewRecorder()
	handler.ServeHTTP(relationshipRec, relationshipReq)
	if relationshipRec.Code != http.StatusCreated {
		t.Fatalf("POST logic-gate-relationships status = %d, want %d body=%s", relationshipRec.Code, http.StatusCreated, relationshipRec.Body.String())
	}

	invalidRelationshipBody, _ := json.Marshal(map[string]string{
		"company_id":      companyID,
		"logic_gate_id_a": firstID,
		"logic_gate_id_b": secondID,
		"a_position":      "Input",
		"b_position":      "Input",
	})
	invalidRelationshipReq := httptest.NewRequest(http.MethodPost, "/v1/logic-gate-relationships", bytes.NewReader(invalidRelationshipBody))
	invalidRelationshipReq.Header.Set("Content-Type", "application/json")
	invalidRelationshipRec := httptest.NewRecorder()
	handler.ServeHTTP(invalidRelationshipRec, invalidRelationshipReq)
	if invalidRelationshipRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid relationship status = %d, want %d", invalidRelationshipRec.Code, http.StatusBadRequest)
	}

	infoBody, _ := json.Marshal(map[string]string{
		"company_id":     companyID,
		"type":           "Text box",
		"information":    "logic gate notes",
		"information_id": "33333333-3333-4333-8333-333333333333",
	})
	infoReq := httptest.NewRequest(http.MethodPost, "/v1/logic-gates/"+firstID+"/information", bytes.NewReader(infoBody))
	infoReq.Header.Set("Content-Type", "application/json")
	infoRec := httptest.NewRecorder()
	handler.ServeHTTP(infoRec, infoReq)
	if infoRec.Code != http.StatusCreated {
		t.Fatalf("POST logic gate information status = %d, want %d body=%s", infoRec.Code, http.StatusCreated, infoRec.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gates/"+firstID+"?company_id="+companyID, nil)
	getRec := httptest.NewRecorder()
	handler.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET logic gate details status = %d, want %d body=%s", getRec.Code, http.StatusOK, getRec.Body.String())
	}
	var details struct {
		Information   []any `json:"information"`
		Relationships []any `json:"relationships"`
	}
	if err := json.NewDecoder(getRec.Body).Decode(&details); err != nil {
		t.Fatalf("decode details: %v", err)
	}
	if len(details.Information) != 1 || len(details.Relationships) != 1 {
		t.Fatalf("details counts = information:%d relationships:%d, want 1/1", len(details.Information), len(details.Relationships))
	}
}

func TestLogicGateRaciAssignmentsAPIAndReadModel(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-logic-gate-raci-test"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)
	otherCompanyID := "company-logic-gate-raci-other"
	repo.EnsureCompany(companyID, "RACI Test Company")
	repo.EnsureCompany(otherCompanyID, "Other Company")

	logicGate, err := repo.CreateLogicGate(companyID, "approval gate")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}
	responsible, err := repo.UpsertAuthUser("raci-responsible", "responsible@example.com", "Responsible User")
	if err != nil {
		t.Fatalf("UpsertAuthUser responsible error = %v", err)
	}
	if _, err := repo.AddCompanyMembership("raci-responsible", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership responsible error = %v", err)
	}
	accountable, err := repo.UpsertAuthUser("raci-accountable", "accountable@example.com", "Accountable User")
	if err != nil {
		t.Fatalf("UpsertAuthUser accountable error = %v", err)
	}
	if _, err := repo.AddCompanyMembership("raci-accountable", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership accountable error = %v", err)
	}
	outsider, err := repo.UpsertAuthUser("raci-outsider", "outsider@example.com", "Outsider User")
	if err != nil {
		t.Fatalf("UpsertAuthUser outsider error = %v", err)
	}
	if _, err := repo.AddCompanyMembership("raci-outsider", otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership outsider error = %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"assignments": []map[string]string{
			{"role": "responsible", "user_id": responsible.UserID},
			{"role": "accountable", "user_id": accountable.UserID},
			{"role": "accountable", "user_id": accountable.UserID},
		},
	})
	req := httptest.NewRequest(http.MethodPut, "/v1/logic-gates/"+logicGate.LogicGateID+"/raci", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT logic gate raci status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Assignments []domain.LogicGateRaciAssignment `json:"raci_assignments"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode raci payload: %v", err)
	}
	if len(payload.Assignments) != 2 {
		t.Fatalf("assignment count = %d, want 2", len(payload.Assignments))
	}
	if payload.Assignments[0].Role != domain.LogicGateRaciRoleResponsible || payload.Assignments[0].UserDisplayName != "Responsible User" {
		t.Fatalf("responsible assignment = %+v", payload.Assignments[0])
	}

	details, err := repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails() error = %v", err)
	}
	if len(details.LogicGate.RaciAssignments) != 2 {
		t.Fatalf("details raci assignments = %+v, want 2 assignments", details.LogicGate.RaciAssignments)
	}
	logicGates, err := repo.ListLogicGates(companyID)
	if err != nil {
		t.Fatalf("ListLogicGates() error = %v", err)
	}
	if len(logicGates) != 1 || len(logicGates[0].RaciAssignments) != 2 {
		t.Fatalf("listed logic gates = %+v, want raci read model", logicGates)
	}
	assigned, err := repo.QueryLogicGates(companyID, store.LogicGateQuery{AssignedUserID: accountable.UserID})
	if err != nil {
		t.Fatalf("QueryLogicGates assigned error = %v", err)
	}
	if len(assigned) != 1 || assigned[0].LogicGateID != logicGate.LogicGateID || len(assigned[0].RaciAssignments) != 2 {
		t.Fatalf("assigned logic gates = %+v, want gate with raci read model", assigned)
	}
	searchReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gates?company_id="+companyID+"&q=approval&limit=5", nil)
	searchRec := httptest.NewRecorder()
	handler.ServeHTTP(searchRec, searchReq)
	if searchRec.Code != http.StatusOK {
		t.Fatalf("GET logic gate search status = %d body=%s", searchRec.Code, searchRec.Body.String())
	}
	var searchPayload struct {
		LogicGates []domain.LogicGate `json:"logic_gates"`
	}
	if err := json.NewDecoder(searchRec.Body).Decode(&searchPayload); err != nil {
		t.Fatalf("decode logic gate search: %v", err)
	}
	if len(searchPayload.LogicGates) != 1 || searchPayload.LogicGates[0].LogicGateID != logicGate.LogicGateID {
		t.Fatalf("search logic gates = %+v, want approval gate only", searchPayload.LogicGates)
	}

	outsiderBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"assignments": []map[string]string{
			{"role": "consulted", "user_id": outsider.UserID},
		},
	})
	outsiderReq := httptest.NewRequest(http.MethodPut, "/v1/logic-gates/"+logicGate.LogicGateID+"/raci", bytes.NewReader(outsiderBody))
	outsiderReq.Header.Set("Content-Type", "application/json")
	outsiderRec := httptest.NewRecorder()
	handler.ServeHTTP(outsiderRec, outsiderReq)
	if outsiderRec.Code != http.StatusBadRequest || !strings.Contains(outsiderRec.Body.String(), "raci_user_not_in_company") {
		t.Fatalf("PUT outsider raci status = %d body=%s, want raci_user_not_in_company", outsiderRec.Code, outsiderRec.Body.String())
	}
}

func TestLogicGateInformationProjectionAPIKeepsLatestValueAndHistory(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-logic-gate-projection-test"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	logicGate, err := repo.CreateLogicGate(companyID, "logic gate with projected notes")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}

	postInformation := func(value string) {
		t.Helper()
		body, _ := json.Marshal(map[string]string{
			"company_id":     companyID,
			"type":           "Text box",
			"information":    value,
			"information_id": "66666666-6666-4666-8666-666666666666",
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/logic-gates/"+logicGate.LogicGateID+"/information", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST logic-gate information status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
		}
	}

	postInformation("first logic gate note")
	postInformation("second logic gate note")

	projectionReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gates/"+logicGate.LogicGateID+"/projection?company_id="+companyID, nil)
	projectionRec := httptest.NewRecorder()
	handler.ServeHTTP(projectionRec, projectionReq)
	if projectionRec.Code != http.StatusOK {
		t.Fatalf("GET logic-gate projection status = %d, want %d body=%s", projectionRec.Code, http.StatusOK, projectionRec.Body.String())
	}
	var projectionPayload struct {
		Items []struct {
			InformationID string `json:"information_id"`
			Information   string `json:"information"`
		} `json:"items"`
	}
	if err := json.NewDecoder(projectionRec.Body).Decode(&projectionPayload); err != nil {
		t.Fatalf("decode projection: %v", err)
	}
	if len(projectionPayload.Items) != 1 {
		t.Fatalf("projection item count = %d, want 1", len(projectionPayload.Items))
	}
	if projectionPayload.Items[0].InformationID != "66666666-6666-4666-8666-666666666666" {
		t.Fatalf("projection information_id = %q, want stable key", projectionPayload.Items[0].InformationID)
	}
	if projectionPayload.Items[0].Information != "second logic gate note" {
		t.Fatalf("projection information = %q, want latest value", projectionPayload.Items[0].Information)
	}

	details, err := repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails() error = %v", err)
	}
	if len(details.Information) != 2 {
		t.Fatalf("logic gate history row count = %d, want 2", len(details.Information))
	}
}

func TestLogicGateInformationAPIRejectsNodeEditorOnlyTypes(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-logic-gate-node-only-type-test"

	logicGate, err := repo.CreateLogicGate(companyID, "logic gate without node workspace")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}

	body, _ := json.Marshal(map[string]string{
		"company_id":     companyID,
		"type":           "Text block chat",
		"information":    `{"block_id":"block-1","message":"node only"}`,
		"information_id": "88888888-8888-4888-8888-888888888888",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/logic-gates/"+logicGate.LogicGateID+"/information", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST node-only logic-gate information status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestNodeInformationProjectionAPIKeepsEditorTextBoxesIndependent(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-node-projection-collapse-test"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	node, err := repo.CreateNode(companyID, "node with editor text blocks")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}

	postInformation := func(informationID string, value string) {
		t.Helper()
		body, _ := json.Marshal(map[string]string{
			"company_id":     companyID,
			"type":           "Text box",
			"information":    value,
			"information_id": informationID,
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST node information status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
		}
	}

	postInformation("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "old editor document")
	postInformation("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "current editor document")

	projectionReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+node.NodeID+"/projection?company_id="+companyID, nil)
	projectionRec := httptest.NewRecorder()
	handler.ServeHTTP(projectionRec, projectionReq)
	if projectionRec.Code != http.StatusOK {
		t.Fatalf("GET node projection status = %d, want %d body=%s", projectionRec.Code, http.StatusOK, projectionRec.Body.String())
	}
	var projectionPayload struct {
		Items []struct {
			Type        string `json:"type"`
			Information string `json:"information"`
		} `json:"items"`
	}
	if err := json.NewDecoder(projectionRec.Body).Decode(&projectionPayload); err != nil {
		t.Fatalf("decode projection: %v", err)
	}
	if len(projectionPayload.Items) != 2 {
		t.Fatalf("projection item count = %d, want 2", len(projectionPayload.Items))
	}
	if projectionPayload.Items[0].Type != "Text box" || projectionPayload.Items[0].Information != "old editor document" {
		t.Fatalf("first projection item = %+v, want old Text box document", projectionPayload.Items[0])
	}
	if projectionPayload.Items[1].Type != "Text box" || projectionPayload.Items[1].Information != "current editor document" {
		t.Fatalf("second projection item = %+v, want current Text box document", projectionPayload.Items[1])
	}

	details, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails() error = %v", err)
	}
	if len(details.Information) != 2 {
		t.Fatalf("node history row count = %d, want 2", len(details.Information))
	}
}

func TestGetNodeDefaultsToLightweightDetails(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-node-lightweight-details-test"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	node, err := repo.CreateNode(companyID, "node with large history")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}
	largeInformation := strings.Repeat("large-history-row", 512)
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", largeInformation, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"); err != nil {
		t.Fatalf("AddNodeInformation() error = %v", err)
	}
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "current text", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"); err != nil {
		t.Fatalf("AddNodeInformation() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+node.NodeID+"?company_id="+companyID, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET lightweight node status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), largeInformation) {
		t.Fatal("lightweight node details response included append-only information history")
	}
	var lightweightPayload struct {
		Information      []domain.NodeInformation `json:"information"`
		InformationCount int                      `json:"information_count"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&lightweightPayload); err != nil {
		t.Fatalf("decode lightweight node details: %v", err)
	}
	if len(lightweightPayload.Information) != 0 {
		t.Fatalf("lightweight information rows = %d, want 0", len(lightweightPayload.Information))
	}
	if lightweightPayload.InformationCount != 2 {
		t.Fatalf("lightweight information_count = %d, want 2", lightweightPayload.InformationCount)
	}

	fullReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+node.NodeID+"?company_id="+companyID+"&include_information=1", nil)
	fullRec := httptest.NewRecorder()
	handler.ServeHTTP(fullRec, fullReq)
	if fullRec.Code != http.StatusOK {
		t.Fatalf("GET full node status = %d, want %d body=%s", fullRec.Code, http.StatusOK, fullRec.Body.String())
	}
	var fullPayload struct {
		Information      []domain.NodeInformation `json:"information"`
		InformationCount int                      `json:"information_count"`
	}
	if err := json.NewDecoder(fullRec.Body).Decode(&fullPayload); err != nil {
		t.Fatalf("decode full node details: %v", err)
	}
	if len(fullPayload.Information) != 2 || fullPayload.InformationCount != 2 {
		t.Fatalf("full information rows/count = %d/%d, want 2/2", len(fullPayload.Information), fullPayload.InformationCount)
	}
}

func TestProjectionDeleteAPIClearsLatestDocumentForHeadlessClients(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-clear-projection-api-test"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	node, err := repo.CreateNode(companyID, "node with clearable editor")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}
	const stableProjectionID = "77777777-7777-4777-8777-777777777777"
	body, _ := json.Marshal(map[string]string{
		"company_id":     companyID,
		"type":           "Text box",
		"information":    "text to clear",
		"information_id": stableProjectionID,
	})
	postReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(body))
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	handler.ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusCreated {
		t.Fatalf("POST node information status = %d, want %d body=%s", postRec.Code, http.StatusCreated, postRec.Body.String())
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/nodes/"+node.NodeID+"/projection/"+stableProjectionID+"?company_id="+companyID, nil)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE node projection status = %d, want %d body=%s", deleteRec.Code, http.StatusOK, deleteRec.Body.String())
	}

	projectionReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+node.NodeID+"/projection?company_id="+companyID, nil)
	projectionRec := httptest.NewRecorder()
	handler.ServeHTTP(projectionRec, projectionReq)
	if projectionRec.Code != http.StatusOK {
		t.Fatalf("GET node projection status = %d, want %d body=%s", projectionRec.Code, http.StatusOK, projectionRec.Body.String())
	}
	var projectionPayload struct {
		Items []any `json:"items"`
	}
	if err := json.NewDecoder(projectionRec.Body).Decode(&projectionPayload); err != nil {
		t.Fatalf("decode projection payload: %v", err)
	}
	if len(projectionPayload.Items) != 0 {
		t.Fatalf("projection items after clear = %d, want 0", len(projectionPayload.Items))
	}
	details, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails() error = %v", err)
	}
	if len(details.Information) != 1 {
		t.Fatalf("history row count after projection clear = %d, want 1", len(details.Information))
	}
}

func TestInformationAPIsRejectBlankInformation(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-no-blank-information-test"

	node, err := repo.CreateNode(companyID, "node with editor")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "logic gate with editor")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}

	postBlank := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		body, _ := json.Marshal(map[string]string{
			"company_id":     companyID,
			"type":           "Text box",
			"information":    " \n\t ",
			"information_id": "44444444-4444-4444-8444-444444444444",
		})
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	nodeRec := postBlank("/v1/nodes/" + node.NodeID + "/information")
	if nodeRec.Code != http.StatusBadRequest {
		t.Fatalf("blank node information status = %d, want %d body=%s", nodeRec.Code, http.StatusBadRequest, nodeRec.Body.String())
	}
	logicGateRec := postBlank("/v1/logic-gates/" + logicGate.LogicGateID + "/information")
	if logicGateRec.Code != http.StatusBadRequest {
		t.Fatalf("blank logic gate information status = %d, want %d body=%s", logicGateRec.Code, http.StatusBadRequest, logicGateRec.Body.String())
	}

	nodeDetails, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails() error = %v", err)
	}
	if len(nodeDetails.Information) != 0 {
		t.Fatalf("blank node information was stored; got %d rows", len(nodeDetails.Information))
	}
	logicGateDetails, err := repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails() error = %v", err)
	}
	if len(logicGateDetails.Information) != 0 {
		t.Fatalf("blank logic gate information was stored; got %d rows", len(logicGateDetails.Information))
	}
}

func TestUpdateNodeTitleViaPut(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-rename-test"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)
	node, err := repo.CreateNode(companyID, "old title")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}

	body, _ := json.Marshal(map[string]string{
		"company_id": companyID,
		"title":      "new title",
	})
	req := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+node.NodeID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want %d", rec.Code, http.StatusOK)
	}

	details, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails() error = %v", err)
	}
	if details.Node.Title != "new title" {
		t.Fatalf("node title = %q, want %q", details.Node.Title, "new title")
	}
}

func TestCreateNodeAssignsCreator(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-create-node-creator-test"
	repo.EnsureCompany(companyID, "Creator Assignment Company")
	creator, err := repo.UpsertAuthUser("creator-node-subject", "creator@example.com", "Creator User")
	if err != nil {
		t.Fatalf("UpsertAuthUser creator error = %v", err)
	}
	if _, err := repo.AddCompanyMembership("creator-node-subject", companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership creator error = %v", err)
	}

	body, _ := json.Marshal(map[string]string{
		"company_id": companyID,
		"title":      "Creator assigned node",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/nodes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = requestWithActorForTest(req, creator, companyID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST node status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var created domain.Node
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("decode created node: %v", err)
	}
	if created.AssigneeUserID == nil || *created.AssigneeUserID != creator.UserID || created.AssigneeName == nil || *created.AssigneeName != "Creator User" {
		t.Fatalf("created node assignee = %+v, want creator", created)
	}
	details, err := repo.GetNodeDetails(companyID, created.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails() error = %v", err)
	}
	if details.Node.AssigneeUserID == nil || *details.Node.AssigneeUserID != creator.UserID {
		t.Fatalf("details node assignee = %+v, want creator", details.Node)
	}
}

func TestUpdateNodeAssigneeRequiresCompanyMembership(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-node-assignee-test"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)
	otherCompanyID := "company-node-assignee-other"
	repo.EnsureCompany(companyID, "Assignee Test Company")
	repo.EnsureCompany(otherCompanyID, "Other Company")
	node, err := repo.CreateNode(companyID, "assigned node")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}
	assignee, err := repo.UpsertAuthUser("assignee-subject", "assignee@example.com", "Assignee User")
	if err != nil {
		t.Fatalf("UpsertAuthUser assignee error = %v", err)
	}
	if _, err := repo.AddCompanyMembership("assignee-subject", companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership assignee error = %v", err)
	}
	outsider, err := repo.UpsertAuthUser("outsider-subject", "outsider@example.com", "Outsider User")
	if err != nil {
		t.Fatalf("UpsertAuthUser outsider error = %v", err)
	}
	if _, err := repo.AddCompanyMembership("outsider-subject", otherCompanyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership outsider error = %v", err)
	}

	assignBody, _ := json.Marshal(map[string]any{
		"company_id":       companyID,
		"assignee_user_id": assignee.UserID,
	})
	assignReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+node.NodeID, bytes.NewReader(assignBody))
	assignReq.Header.Set("Content-Type", "application/json")
	assignRec := httptest.NewRecorder()
	handler.ServeHTTP(assignRec, assignReq)
	if assignRec.Code != http.StatusOK {
		t.Fatalf("PUT node assignee status = %d body=%s", assignRec.Code, assignRec.Body.String())
	}
	var assigned struct {
		AssigneeUserID *string `json:"assignee_user_id"`
		AssigneeName   *string `json:"assignee_name"`
		AssigneeEmail  *string `json:"assignee_email"`
	}
	if err := json.NewDecoder(assignRec.Body).Decode(&assigned); err != nil {
		t.Fatalf("decode assigned node: %v", err)
	}
	if assigned.AssigneeUserID == nil || *assigned.AssigneeUserID != assignee.UserID || assigned.AssigneeName == nil || *assigned.AssigneeName != "Assignee User" || assigned.AssigneeEmail == nil || *assigned.AssigneeEmail != "assignee@example.com" {
		t.Fatalf("assigned node = %+v, want assignee read model", assigned)
	}
	details, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails() error = %v", err)
	}
	if details.Node.AssigneeName == nil || *details.Node.AssigneeName != "Assignee User" {
		t.Fatalf("details node assignee = %+v, want enriched assignee", details.Node)
	}

	outsiderBody, _ := json.Marshal(map[string]any{
		"company_id":       companyID,
		"assignee_user_id": outsider.UserID,
	})
	outsiderReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+node.NodeID, bytes.NewReader(outsiderBody))
	outsiderReq.Header.Set("Content-Type", "application/json")
	outsiderRec := httptest.NewRecorder()
	handler.ServeHTTP(outsiderRec, outsiderReq)
	if outsiderRec.Code != http.StatusBadRequest || !strings.Contains(outsiderRec.Body.String(), "assignee_user_not_in_company") {
		t.Fatalf("PUT outsider assignee status = %d body=%s, want assignee_user_not_in_company", outsiderRec.Code, outsiderRec.Body.String())
	}

	clearBody, _ := json.Marshal(map[string]any{
		"company_id":       companyID,
		"assignee_user_id": nil,
	})
	clearReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+node.NodeID, bytes.NewReader(clearBody))
	clearReq.Header.Set("Content-Type", "application/json")
	clearRec := httptest.NewRecorder()
	handler.ServeHTTP(clearRec, clearReq)
	if clearRec.Code != http.StatusOK {
		t.Fatalf("PUT clear assignee status = %d body=%s", clearRec.Code, clearRec.Body.String())
	}
	var cleared struct {
		AssigneeUserID *string `json:"assignee_user_id"`
	}
	if err := json.NewDecoder(clearRec.Body).Decode(&cleared); err != nil {
		t.Fatalf("decode cleared node: %v", err)
	}
	if cleared.AssigneeUserID != nil {
		t.Fatalf("cleared assignee_user_id = %v, want nil", *cleared.AssigneeUserID)
	}
}

func TestLogicGateArenaAPIsExposeAttachedBoardIssueToggleAndNodeMetadata(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "11111111-1111-4111-8111-333333333333"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	logicGate, err := repo.CreateLogicGate(companyID, "Fulfillment Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}
	node, err := repo.CreateNode(companyID, "Invoice node")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}
	boardID := store.LogicGateKanbanBoardID(logicGate.LogicGateID)

	listBoardsReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/boards?company_id="+companyID+"&logic_gate_id="+logicGate.LogicGateID, nil)
	listBoardsRec := httptest.NewRecorder()
	handler.ServeHTTP(listBoardsRec, listBoardsReq)
	if listBoardsRec.Code != http.StatusOK {
		t.Fatalf("GET logic-gate boards status = %d body=%s", listBoardsRec.Code, listBoardsRec.Body.String())
	}
	var boardsPayload struct {
		Boards []struct {
			BoardID     string  `json:"board_id"`
			LogicGateID *string `json:"logic_gate_id"`
		} `json:"boards"`
	}
	if err := json.NewDecoder(listBoardsRec.Body).Decode(&boardsPayload); err != nil {
		t.Fatalf("decode boards: %v", err)
	}
	if len(boardsPayload.Boards) != 1 || boardsPayload.Boards[0].BoardID != boardID || boardsPayload.Boards[0].LogicGateID == nil || *boardsPayload.Boards[0].LogicGateID != logicGate.LogicGateID {
		t.Fatalf("logic-gate boards = %+v, want attached board", boardsPayload.Boards)
	}

	columns, err := repo.ListKanbanColumns(companyID, boardID)
	if err != nil {
		t.Fatalf("ListKanbanColumns() error = %v", err)
	}
	columnID := ""
	for _, column := range columns {
		if column.Title == "In Progress" {
			columnID = column.ColumnID
			break
		}
	}
	if columnID == "" {
		t.Fatalf("attached board columns = %+v, want In Progress", columns)
	}

	addCardBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   boardID,
		"column_id":  columnID,
		"node_id":    node.NodeID,
		"node_title": node.Title,
	})
	addCardReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(addCardBody))
	addCardReq.Header.Set("Content-Type", "application/json")
	addCardRec := httptest.NewRecorder()
	handler.ServeHTTP(addCardRec, addCardReq)
	if addCardRec.Code != http.StatusCreated {
		t.Fatalf("POST logic-gate card status = %d body=%s", addCardRec.Code, addCardRec.Body.String())
	}
	var createdCard struct {
		CardID      string  `json:"card_id"`
		LogicGateID *string `json:"logic_gate_id"`
		IsIssue     bool    `json:"is_issue"`
	}
	if err := json.NewDecoder(addCardRec.Body).Decode(&createdCard); err != nil {
		t.Fatalf("decode card: %v", err)
	}
	if createdCard.LogicGateID == nil || *createdCard.LogicGateID != logicGate.LogicGateID || createdCard.IsIssue {
		t.Fatalf("created logic-gate card = %+v", createdCard)
	}

	stream := server.hub.subscribe(companyID)
	defer server.hub.unsubscribe(companyID, stream)

	issueBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   boardID,
		"is_issue":   true,
	})
	issueReq := httptest.NewRequest(http.MethodPut, "/v1/kanban/cards/"+createdCard.CardID, bytes.NewReader(issueBody))
	issueReq.Header.Set("Content-Type", "application/json")
	issueRec := httptest.NewRecorder()
	handler.ServeHTTP(issueRec, issueReq)
	if issueRec.Code != http.StatusOK {
		t.Fatalf("PUT issue card status = %d body=%s", issueRec.Code, issueRec.Body.String())
	}
	var issueCard struct {
		ColumnID string `json:"column_id"`
		IsIssue  bool   `json:"is_issue"`
	}
	if err := json.NewDecoder(issueRec.Body).Decode(&issueCard); err != nil {
		t.Fatalf("decode issue card: %v", err)
	}
	if !issueCard.IsIssue || issueCard.ColumnID != columnID {
		t.Fatalf("issue card = %+v, want issue without move", issueCard)
	}
	cardEvent := readWorkspaceEventForTest(t, stream)
	nodeEvent := readWorkspaceEventForTest(t, stream)
	if cardEvent.Type != "kanban_card_moved" {
		t.Fatalf("first workspace event type = %q, want kanban_card_moved", cardEvent.Type)
	}
	if nodeEvent.Type != "node_updated" || nodeEvent.Data["node_id"] != node.NodeID {
		t.Fatalf("second workspace event = %+v, want node_updated for %q", nodeEvent, node.NodeID)
	}
	nodePayload, ok := nodeEvent.Data["node"].(map[string]any)
	if !ok || nodePayload["status"] != "Issue" {
		t.Fatalf("node_updated payload = %+v, want derived Issue status", nodeEvent.Data["node"])
	}

	updateNodeBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"due_date":   "05/06/2026",
		"priority":   4,
	})
	updateNodeReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+node.NodeID, bytes.NewReader(updateNodeBody))
	updateNodeReq.Header.Set("Content-Type", "application/json")
	updateNodeRec := httptest.NewRecorder()
	handler.ServeHTTP(updateNodeRec, updateNodeReq)
	if updateNodeRec.Code != http.StatusOK {
		t.Fatalf("PUT node metadata status = %d body=%s", updateNodeRec.Code, updateNodeRec.Body.String())
	}
	var updatedNode struct {
		Status   *string `json:"status"`
		DueDate  *string `json:"due_date"`
		Priority *int    `json:"priority"`
	}
	if err := json.NewDecoder(updateNodeRec.Body).Decode(&updatedNode); err != nil {
		t.Fatalf("decode node: %v", err)
	}
	if updatedNode.Status == nil || *updatedNode.Status != "Issue" || updatedNode.DueDate == nil || *updatedNode.DueDate != "2026-05-06" || updatedNode.Priority == nil || *updatedNode.Priority != 4 {
		t.Fatalf("updated node = %+v, want derived status and metadata", updatedNode)
	}

	arenaReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gate-arena?company_id="+companyID+"&logic_gate_id="+logicGate.LogicGateID, nil)
	arenaRec := httptest.NewRecorder()
	handler.ServeHTTP(arenaRec, arenaReq)
	if arenaRec.Code != http.StatusOK {
		t.Fatalf("GET logic gate arena status = %d body=%s", arenaRec.Code, arenaRec.Body.String())
	}
	var arenaPayload struct {
		LogicGate struct {
			LogicGateID string `json:"logic_gate_id"`
		} `json:"logic_gate"`
		Board struct {
			BoardID     string  `json:"board_id"`
			LogicGateID *string `json:"logic_gate_id"`
		} `json:"board"`
		Columns []struct{ ColumnID string } `json:"columns"`
		Cards   []struct {
			CardID      string  `json:"card_id"`
			LogicGateID *string `json:"logic_gate_id"`
			IsIssue     bool    `json:"is_issue"`
		} `json:"cards"`
		CardsLimit int `json:"cards_limit"`
	}
	if err := json.NewDecoder(arenaRec.Body).Decode(&arenaPayload); err != nil {
		t.Fatalf("decode logic gate arena: %v", err)
	}
	if arenaPayload.LogicGate.LogicGateID != logicGate.LogicGateID || arenaPayload.Board.BoardID != boardID || arenaPayload.Board.LogicGateID == nil || *arenaPayload.Board.LogicGateID != logicGate.LogicGateID {
		t.Fatalf("arena identity = %+v, want selected logic gate and attached board", arenaPayload)
	}
	if len(arenaPayload.Columns) != len(columns) || len(arenaPayload.Cards) != 1 || arenaPayload.Cards[0].CardID != createdCard.CardID || arenaPayload.Cards[0].LogicGateID == nil || *arenaPayload.Cards[0].LogicGateID != logicGate.LogicGateID || !arenaPayload.Cards[0].IsIssue || arenaPayload.CardsLimit != store.KanbanMaxCardsLimit {
		t.Fatalf("arena contents = %+v, want bounded composed board view", arenaPayload)
	}

	deleteBoardReq := httptest.NewRequest(http.MethodDelete, "/v1/kanban/boards/"+boardID+"?company_id="+companyID, nil)
	deleteBoardRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteBoardRec, deleteBoardReq)
	if deleteBoardRec.Code != http.StatusConflict {
		t.Fatalf("DELETE attached board status = %d, want %d body=%s", deleteBoardRec.Code, http.StatusConflict, deleteBoardRec.Body.String())
	}
}

type noRepairLogicGateArenaRepo struct {
	store.Repository
	hideArenaBoards  bool
	dropArenaColumns bool
	ensureCalls      int
}

func (r *noRepairLogicGateArenaRepo) EnsureLogicGateKanbanBoard(companyID, logicGateID, title string) (domain.KanbanBoard, error) {
	r.ensureCalls++
	return domain.KanbanBoard{}, fmt.Errorf("unexpected Logic Gate Arena repair for %s/%s", companyID, logicGateID)
}

func (r *noRepairLogicGateArenaRepo) ListKanbanBoards(companyID string, query store.KanbanBoardQuery) ([]domain.KanbanBoard, error) {
	if r.hideArenaBoards && query.LogicGateID != "" {
		return []domain.KanbanBoard{}, nil
	}
	return r.Repository.ListKanbanBoards(companyID, query)
}

func (r *noRepairLogicGateArenaRepo) ListKanbanColumns(companyID, boardID string) ([]domain.KanbanColumn, error) {
	if r.dropArenaColumns {
		return []domain.KanbanColumn{}, nil
	}
	return r.Repository.ListKanbanColumns(companyID, boardID)
}

func TestLogicGateArenaGETLoadsExistingBoardWithoutRepair(t *testing.T) {
	t.Parallel()

	backing := store.NewMemoryRepo()
	companyID := "company-arena-existing-read-only-test"
	logicGate, err := backing.CreateLogicGate(companyID, "Existing Arena Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}
	repo := &noRepairLogicGateArenaRepo{Repository: backing}
	server := NewServer(repo)

	req := httptest.NewRequest(http.MethodGet, "/v1/logic-gate-arena?company_id="+companyID+"&logic_gate_id="+logicGate.LogicGateID, nil)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET arena status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if repo.ensureCalls != 0 {
		t.Fatalf("GET arena called EnsureLogicGateKanbanBoard %d times, want 0", repo.ensureCalls)
	}
	var payload struct {
		Board struct {
			BoardID string `json:"board_id"`
		} `json:"board"`
		Columns []domain.KanbanColumn `json:"columns"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode arena payload: %v", err)
	}
	if payload.Board.BoardID != store.LogicGateKanbanBoardID(logicGate.LogicGateID) || len(payload.Columns) != 3 {
		t.Fatalf("arena payload board=%q columns=%d, want existing provisioned board and columns", payload.Board.BoardID, len(payload.Columns))
	}
}

func TestLogicGateArenaGETDoesNotProvisionMissingBoard(t *testing.T) {
	t.Parallel()

	backing := store.NewMemoryRepo()
	companyID := "company-arena-missing-board-read-only-test"
	logicGate, err := backing.CreateLogicGate(companyID, "Missing Board Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}
	repo := &noRepairLogicGateArenaRepo{Repository: backing, hideArenaBoards: true}
	server := NewServer(repo)

	req := httptest.NewRequest(http.MethodGet, "/v1/logic-gate-arena?company_id="+companyID+"&logic_gate_id="+logicGate.LogicGateID, nil)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "logic_gate_arena_board_not_found") {
		t.Fatalf("GET missing-board arena status = %d body=%s, want explicit missing board", rec.Code, rec.Body.String())
	}
	if repo.ensureCalls != 0 {
		t.Fatalf("GET missing-board arena called EnsureLogicGateKanbanBoard %d times, want 0", repo.ensureCalls)
	}
}

func TestLogicGateArenaGETDoesNotRepairMissingDefaultColumns(t *testing.T) {
	t.Parallel()

	backing := store.NewMemoryRepo()
	companyID := "company-arena-missing-columns-read-only-test"
	logicGate, err := backing.CreateLogicGate(companyID, "Missing Columns Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}
	repo := &noRepairLogicGateArenaRepo{Repository: backing, dropArenaColumns: true}
	server := NewServer(repo)

	req := httptest.NewRequest(http.MethodGet, "/v1/logic-gate-arena?company_id="+companyID+"&logic_gate_id="+logicGate.LogicGateID, nil)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "logic_gate_arena_columns_not_provisioned") {
		t.Fatalf("GET missing-column arena status = %d body=%s, want explicit missing columns", rec.Code, rec.Body.String())
	}
	if repo.ensureCalls != 0 {
		t.Fatalf("GET missing-column arena called EnsureLogicGateKanbanBoard %d times, want 0", repo.ensureCalls)
	}
}

func TestWorkspaceSnapshotReturnsNotModifiedWhenDataUnchanged(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-etag-test"

	_, err := repo.CreateNode(companyID, "alpha")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}

	firstReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID, nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("first snapshot status = %d, want %d", firstRec.Code, http.StatusOK)
	}

	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("first snapshot ETag is empty")
	}

	secondReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID, nil)
	secondReq.Header.Set("If-None-Match", etag)
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)

	if secondRec.Code != http.StatusNotModified {
		t.Fatalf("second snapshot status = %d, want %d", secondRec.Code, http.StatusNotModified)
	}
}

func TestWorkspaceSnapshotDefaultUsesLightweightCompanyExplorerReadModel(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-explorer-light-snapshot-test"

	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Work")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder() error = %v", err)
	}
	nodeA, err := repo.CreateNode(companyID, "alpha")
	if err != nil {
		t.Fatalf("CreateNode alpha error = %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "beta")
	if err != nil {
		t.Fatalf("CreateNode beta error = %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "gate")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, folder.FolderID, "node", nodeA.NodeID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem() error = %v", err)
	}
	if _, err := repo.CreateNodeRelationship(companyID, nodeA.NodeID, nodeB.NodeID, "Peer", "Peer"); err != nil {
		t.Fatalf("CreateNodeRelationship() error = %v", err)
	}
	if _, err := repo.UpsertNodeMapPositions(companyID, []domain.NodeMapPosition{{NodeID: nodeA.NodeID, X: 10, Y: 20}}); err != nil {
		t.Fatalf("UpsertNodeMapPositions() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("company explorer snapshot status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	raw := map[string]json.RawMessage{}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode raw snapshot: %v", err)
	}
	for _, key := range []string{"relationships", "logic_gate_relationships", "node_map_positions", "logic_gate_map_positions", "kanban_boards"} {
		if _, ok := raw[key]; ok {
			t.Fatalf("company_explorer snapshot unexpectedly included %q", key)
		}
	}

	var payload struct {
		Scope      string                             `json:"scope"`
		Nodes      []domain.Node                      `json:"nodes"`
		LogicGates []domain.LogicGate                 `json:"logic_gates"`
		Folders    []domain.CompanyExplorerFolder     `json:"folders"`
		Items      []domain.CompanyExplorerFolderItem `json:"folder_items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode typed snapshot: %v", err)
	}
	if payload.Scope != "company_explorer" || len(payload.Nodes) != 2 || len(payload.LogicGates) != 1 || len(payload.Folders) == 0 || len(payload.Items) == 0 {
		t.Fatalf("company explorer snapshot payload = scope:%q nodes:%d logic_gates:%d folders:%d items:%d, want lightweight explorer data", payload.Scope, len(payload.Nodes), len(payload.LogicGates), len(payload.Folders), len(payload.Items))
	}
	if payload.LogicGates[0].LogicGateID != logicGate.LogicGateID {
		t.Fatalf("logic gate summary id = %q, want %q", payload.LogicGates[0].LogicGateID, logicGate.LogicGateID)
	}
}
func TestMapLayoutPositionAPIAndWorkspaceSnapshot(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := newServerWithLegacyMapRoutesForTest(repo)
	handler := server.Routes()
	companyID := "company-map-layout-test"

	node, err := repo.CreateNode(companyID, "layout node")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "layout gate")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}

	writeNodeBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"map_type":   "node",
		"positions": []map[string]any{{
			"entity_id": node.NodeID,
			"x":         240,
			"y":         360,
		}},
	})
	writeNodeReq := httptest.NewRequest(http.MethodPut, "/v1/map-layout", bytes.NewReader(writeNodeBody))
	writeNodeReq.Header.Set("Content-Type", "application/json")
	writeNodeRec := httptest.NewRecorder()
	handler.ServeHTTP(writeNodeRec, writeNodeReq)
	if writeNodeRec.Code != http.StatusOK {
		t.Fatalf("PUT node map layout status = %d, want %d body=%s", writeNodeRec.Code, http.StatusOK, writeNodeRec.Body.String())
	}

	writeLogicBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"map_type":   "logic_gate",
		"positions": []map[string]any{{
			"entity_id": logicGate.LogicGateID,
			"x":         480,
			"y":         120,
		}},
	})
	writeLogicReq := httptest.NewRequest(http.MethodPut, "/v1/map-layout", bytes.NewReader(writeLogicBody))
	writeLogicReq.Header.Set("Content-Type", "application/json")
	writeLogicRec := httptest.NewRecorder()
	handler.ServeHTTP(writeLogicRec, writeLogicReq)
	if writeLogicRec.Code != http.StatusOK {
		t.Fatalf("PUT logic gate map layout status = %d, want %d body=%s", writeLogicRec.Code, http.StatusOK, writeLogicRec.Body.String())
	}

	readReq := httptest.NewRequest(http.MethodGet, "/v1/map-layout?company_id="+companyID+"&map_type=node", nil)
	readRec := httptest.NewRecorder()
	handler.ServeHTTP(readRec, readReq)
	if readRec.Code != http.StatusOK {
		t.Fatalf("GET node map layout status = %d, want %d body=%s", readRec.Code, http.StatusOK, readRec.Body.String())
	}
	var readPayload struct {
		Positions []struct {
			NodeID string  `json:"node_id"`
			X      float64 `json:"x"`
			Y      float64 `json:"y"`
		} `json:"positions"`
	}
	if err := json.NewDecoder(readRec.Body).Decode(&readPayload); err != nil {
		t.Fatalf("decode node map layout: %v", err)
	}
	if len(readPayload.Positions) != 1 || readPayload.Positions[0].NodeID != node.NodeID || readPayload.Positions[0].X != 240 || readPayload.Positions[0].Y != 360 {
		t.Fatalf("node map positions = %+v, want saved node position", readPayload.Positions)
	}

	snapshotReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=full&include_legacy_map=1", nil)
	snapshotRec := httptest.NewRecorder()
	handler.ServeHTTP(snapshotRec, snapshotReq)
	if snapshotRec.Code != http.StatusOK {
		t.Fatalf("workspace snapshot status = %d, want %d body=%s", snapshotRec.Code, http.StatusOK, snapshotRec.Body.String())
	}
	var snapshot struct {
		NodeMapPositions []struct {
			NodeID string `json:"node_id"`
		} `json:"node_map_positions"`
		LogicGateMapPositions []struct {
			LogicGateID string `json:"logic_gate_id"`
		} `json:"logic_gate_map_positions"`
	}
	if err := json.NewDecoder(snapshotRec.Body).Decode(&snapshot); err != nil {
		t.Fatalf("decode workspace snapshot: %v", err)
	}
	if len(snapshot.NodeMapPositions) != 1 || snapshot.NodeMapPositions[0].NodeID != node.NodeID {
		t.Fatalf("snapshot node_map_positions = %+v, want saved node position", snapshot.NodeMapPositions)
	}
	if len(snapshot.LogicGateMapPositions) != 1 || snapshot.LogicGateMapPositions[0].LogicGateID != logicGate.LogicGateID {
		t.Fatalf("snapshot logic_gate_map_positions = %+v, want saved logic gate position", snapshot.LogicGateMapPositions)
	}
}

func TestWorkspaceSnapshotNodeMapScopeUsesFolderSubtree(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-snapshot-node-map-scope-test"

	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Scoped parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder parent error = %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "node", "Scoped child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder child error = %v", err)
	}
	sibling, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Sibling")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder sibling error = %v", err)
	}

	nodeA, err := repo.CreateNode(companyID, "Scoped A")
	if err != nil {
		t.Fatalf("CreateNode A error = %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Scoped B")
	if err != nil {
		t.Fatalf("CreateNode B error = %v", err)
	}
	nodeC, err := repo.CreateNode(companyID, "Outside C")
	if err != nil {
		t.Fatalf("CreateNode C error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parent.FolderID, "node", nodeA.NodeID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem A error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, child.FolderID, "node", nodeB.NodeID, 2000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem B error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, sibling.FolderID, "node", nodeC.NodeID, 3000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem C error = %v", err)
	}

	scopedRelationship, err := repo.CreateNodeRelationship(companyID, nodeA.NodeID, nodeB.NodeID, "Peer", "Peer")
	if err != nil {
		t.Fatalf("CreateNodeRelationship scoped error = %v", err)
	}
	if _, err := repo.CreateNodeRelationship(companyID, nodeB.NodeID, nodeC.NodeID, "Peer", "Peer"); err != nil {
		t.Fatalf("CreateNodeRelationship outside error = %v", err)
	}
	if _, err := repo.UpsertNodeMapPositions(companyID, []domain.NodeMapPosition{
		{NodeID: nodeA.NodeID, X: 100, Y: 100},
		{NodeID: nodeB.NodeID, X: 200, Y: 200},
		{NodeID: nodeC.NodeID, X: 300, Y: 300},
	}); err != nil {
		t.Fatalf("UpsertNodeMapPositions error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=node_map&folder_id="+parent.FolderID, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("workspace scoped snapshot status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var payload struct {
		Scope            string                             `json:"scope"`
		FolderID         string                             `json:"folder_id"`
		Nodes            []domain.Node                      `json:"nodes"`
		Relationships    []domain.NodeRelationship          `json:"relationships"`
		Folders          []domain.CompanyExplorerFolder     `json:"folders"`
		FolderItems      []domain.CompanyExplorerFolderItem `json:"folder_items"`
		NodeMapPositions []domain.NodeMapPosition           `json:"node_map_positions"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode scoped workspace snapshot: %v", err)
	}
	if payload.Scope != "node_map" || payload.FolderID != parent.FolderID {
		t.Fatalf("snapshot scope=%q folder_id=%q, want node_map %q", payload.Scope, payload.FolderID, parent.FolderID)
	}
	assertIDs := func(label string, got []string, want ...string) {
		t.Helper()
		seen := make(map[string]bool, len(got))
		for _, id := range got {
			seen[id] = true
		}
		if len(seen) != len(want) {
			t.Fatalf("%s ids = %v, want %v", label, got, want)
		}
		for _, id := range want {
			if !seen[id] {
				t.Fatalf("%s ids = %v, missing %s", label, got, id)
			}
		}
	}
	nodeIDs := make([]string, 0, len(payload.Nodes))
	for _, node := range payload.Nodes {
		nodeIDs = append(nodeIDs, node.NodeID)
	}
	assertIDs("nodes", nodeIDs, nodeA.NodeID, nodeB.NodeID)
	relationshipIDs := make([]string, 0, len(payload.Relationships))
	for _, relationship := range payload.Relationships {
		relationshipIDs = append(relationshipIDs, relationship.NodeRelationshipID)
	}
	assertIDs("relationships", relationshipIDs, scopedRelationship.NodeRelationshipID)
	positionIDs := make([]string, 0, len(payload.NodeMapPositions))
	for _, position := range payload.NodeMapPositions {
		positionIDs = append(positionIDs, position.NodeID)
	}
	assertIDs("node_map_positions", positionIDs, nodeA.NodeID, nodeB.NodeID)
	folderIDs := make([]string, 0, len(payload.Folders))
	for _, folder := range payload.Folders {
		folderIDs = append(folderIDs, folder.FolderID)
	}
	assertIDs("folders", folderIDs, parent.FolderID, child.FolderID)
	folderItemIDs := make([]string, 0, len(payload.FolderItems))
	for _, item := range payload.FolderItems {
		folderItemIDs = append(folderItemIDs, item.ItemID)
	}
	assertIDs("folder_items", folderItemIDs, nodeA.NodeID, nodeB.NodeID)

	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatalf("scoped snapshot did not return ETag")
	}
	notModifiedReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=node_map&folder_id="+parent.FolderID, nil)
	notModifiedReq.Header.Set("If-None-Match", etag)
	notModifiedRec := httptest.NewRecorder()
	handler.ServeHTTP(notModifiedRec, notModifiedReq)
	if notModifiedRec.Code != http.StatusNotModified {
		t.Fatalf("workspace scoped snapshot with If-None-Match status = %d, want %d body=%s", notModifiedRec.Code, http.StatusNotModified, notModifiedRec.Body.String())
	}
}

func TestWorkspaceSnapshotNodeMapWindowBoundsPayloadAndPreservesBroadCompatibility(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := newServerWithLegacyMapRoutesForTest(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-555555555555"

	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Window parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder parent error = %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "node", "Window child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder child error = %v", err)
	}
	sibling, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Window sibling")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder sibling error = %v", err)
	}

	nodeA, err := repo.CreateNode(companyID, "Window A")
	if err != nil {
		t.Fatalf("CreateNode A error = %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Window B")
	if err != nil {
		t.Fatalf("CreateNode B error = %v", err)
	}
	nodeOutsideFolder, err := repo.CreateNode(companyID, "Outside folder")
	if err != nil {
		t.Fatalf("CreateNode outside folder error = %v", err)
	}
	nodeOutsideWindow, err := repo.CreateNode(companyID, "Outside window")
	if err != nil {
		t.Fatalf("CreateNode outside window error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parent.FolderID, "node", nodeA.NodeID, 1000); err != nil {
		t.Fatalf("Assign node A error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, child.FolderID, "node", nodeB.NodeID, 2000); err != nil {
		t.Fatalf("Assign node B error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, sibling.FolderID, "node", nodeOutsideFolder.NodeID, 3000); err != nil {
		t.Fatalf("Assign outside folder node error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parent.FolderID, "node", nodeOutsideWindow.NodeID, 4000); err != nil {
		t.Fatalf("Assign outside window node error = %v", err)
	}

	visibleRelationship, err := repo.CreateNodeRelationship(companyID, nodeA.NodeID, nodeB.NodeID, "Peer", "Peer")
	if err != nil {
		t.Fatalf("CreateNodeRelationship visible error = %v", err)
	}
	if _, err := repo.CreateNodeRelationship(companyID, nodeB.NodeID, nodeOutsideFolder.NodeID, "Peer", "Peer"); err != nil {
		t.Fatalf("CreateNodeRelationship outside folder error = %v", err)
	}
	if _, err := repo.CreateNodeRelationship(companyID, nodeA.NodeID, nodeOutsideWindow.NodeID, "Peer", "Peer"); err != nil {
		t.Fatalf("CreateNodeRelationship outside window error = %v", err)
	}
	if _, err := repo.UpsertNodeMapPositions(companyID, []domain.NodeMapPosition{
		{NodeID: nodeA.NodeID, X: 100, Y: 100},
		{NodeID: nodeB.NodeID, X: 200, Y: 200},
		{NodeID: nodeOutsideFolder.NodeID, X: 150, Y: 150},
		{NodeID: nodeOutsideWindow.NodeID, X: 900, Y: 900},
	}); err != nil {
		t.Fatalf("UpsertNodeMapPositions error = %v", err)
	}

	windowURL := "/v1/workspace/snapshot?company_id=" + companyID + "&scope=node_map_window&folder_id=" + parent.FolderID + "&min_x=0&min_y=0&max_x=300&max_y=300&limit=10"
	req := httptest.NewRequest(http.MethodGet, windowURL, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("node_map_window status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload struct {
		Scope            string                             `json:"scope"`
		FolderID         string                             `json:"folder_id"`
		Window           store.NodeMapWindowBounds          `json:"window"`
		Limit            int                                `json:"nodes_limit"`
		Nodes            []domain.Node                      `json:"nodes"`
		Relationships    []domain.NodeRelationship          `json:"relationships"`
		Folders          []domain.CompanyExplorerFolder     `json:"folders"`
		FolderItems      []domain.CompanyExplorerFolderItem `json:"folder_items"`
		NodeMapPositions []domain.NodeMapPosition           `json:"node_map_positions"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode node_map_window payload: %v", err)
	}
	if payload.Scope != "node_map_window" || payload.FolderID != parent.FolderID || payload.Limit != 10 || payload.Window.MaxX != 300 || payload.Window.MaxY != 300 {
		t.Fatalf("window metadata = scope %q folder %q limit %d window %+v", payload.Scope, payload.FolderID, payload.Limit, payload.Window)
	}
	assertHTTPNodeMapIDs(t, "window nodes", httpNodeIDs(payload.Nodes), nodeA.NodeID, nodeB.NodeID)
	assertHTTPNodeMapIDs(t, "window positions", httpPositionNodeIDs(payload.NodeMapPositions), nodeA.NodeID, nodeB.NodeID)
	assertHTTPNodeMapIDs(t, "window relationships", httpRelationshipIDs(payload.Relationships), visibleRelationship.NodeRelationshipID)
	assertHTTPNodeMapIDs(t, "window folder_items", httpFolderItemIDs(payload.FolderItems), nodeA.NodeID, nodeB.NodeID)
	assertHTTPNodeMapIDs(t, "window folders", httpFolderIDs(payload.Folders), parent.FolderID, child.FolderID)

	layoutReq := httptest.NewRequest(http.MethodGet, "/v1/map-layout?company_id="+companyID+"&map_type=node&folder_id="+parent.FolderID+"&min_x=0&min_y=0&max_x=300&max_y=300&limit=10", nil)
	layoutRec := httptest.NewRecorder()
	handler.ServeHTTP(layoutRec, layoutReq)
	if layoutRec.Code != http.StatusOK {
		t.Fatalf("bounded map-layout status = %d, want %d body=%s", layoutRec.Code, http.StatusOK, layoutRec.Body.String())
	}
	var layoutPayload struct {
		Positions []domain.NodeMapPosition `json:"positions"`
	}
	if err := json.NewDecoder(layoutRec.Body).Decode(&layoutPayload); err != nil {
		t.Fatalf("decode bounded map-layout payload: %v", err)
	}
	assertHTTPNodeMapIDs(t, "bounded map-layout positions", httpPositionNodeIDs(layoutPayload.Positions), nodeA.NodeID, nodeB.NodeID)

	broadReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=node_map", nil)
	broadRec := httptest.NewRecorder()
	handler.ServeHTTP(broadRec, broadReq)
	if broadRec.Code != http.StatusOK {
		t.Fatalf("broad node_map status = %d, want %d body=%s", broadRec.Code, http.StatusOK, broadRec.Body.String())
	}
	var broadPayload struct {
		Scope            string                   `json:"scope"`
		Nodes            []domain.Node            `json:"nodes"`
		NodeMapPositions []domain.NodeMapPosition `json:"node_map_positions"`
	}
	if err := json.NewDecoder(broadRec.Body).Decode(&broadPayload); err != nil {
		t.Fatalf("decode broad node_map payload: %v", err)
	}
	if broadPayload.Scope != "node_map" {
		t.Fatalf("broad scope = %q, want node_map", broadPayload.Scope)
	}
	assertHTTPNodeMapIDs(t, "broad nodes", httpNodeIDs(broadPayload.Nodes), nodeA.NodeID, nodeB.NodeID, nodeOutsideFolder.NodeID, nodeOutsideWindow.NodeID)
	assertHTTPNodeMapIDs(t, "broad positions", httpPositionNodeIDs(broadPayload.NodeMapPositions), nodeA.NodeID, nodeB.NodeID, nodeOutsideFolder.NodeID, nodeOutsideWindow.NodeID)
}

func TestWorkspaceSnapshotNodeMapWindowRejectsInvalidInputsAndDoesNotRepairRows(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := newServerWithLegacyMapRoutesForTest(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-666666666666"
	missingFolderID := "22222222-2222-4222-8222-222222222222"

	cases := []struct {
		name string
		url  string
		code int
		err  string
	}{
		{name: "missing folder id", url: "/v1/workspace/snapshot?company_id=" + companyID + "&scope=node_map_window&min_x=0&min_y=0&max_x=100&max_y=100", code: http.StatusBadRequest, err: "folder_id_required"},
		{name: "invalid folder id", url: "/v1/workspace/snapshot?company_id=" + companyID + "&scope=node_map_window&folder_id=not-a-folder&min_x=0&min_y=0&max_x=100&max_y=100", code: http.StatusBadRequest, err: "invalid_folder_id"},
		{name: "invalid window", url: "/v1/workspace/snapshot?company_id=" + companyID + "&scope=node_map_window&folder_id=" + missingFolderID + "&min_x=200&min_y=0&max_x=100&max_y=100", code: http.StatusBadRequest, err: "invalid_window"},
		{name: "missing folder", url: "/v1/workspace/snapshot?company_id=" + companyID + "&scope=node_map_window&folder_id=" + missingFolderID + "&min_x=0&min_y=0&max_x=100&max_y=100", code: http.StatusNotFound, err: "company_explorer_folder_not_found"},
		{name: "map-layout missing folder", url: "/v1/map-layout?company_id=" + companyID + "&map_type=node&folder_id=" + missingFolderID + "&min_x=0&min_y=0&max_x=100&max_y=100", code: http.StatusNotFound, err: "company_explorer_folder_not_found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.url, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.code || !strings.Contains(rec.Body.String(), tc.err) {
				t.Fatalf("status/body = %d/%s, want %d containing %q", rec.Code, rec.Body.String(), tc.code, tc.err)
			}
		})
	}
	folders, err := repo.ListCompanyExplorerFolders(companyID, "node")
	if err != nil {
		t.Fatalf("ListCompanyExplorerFolders after GETs error = %v", err)
	}
	if len(folders) != 0 {
		t.Fatalf("GET node-map window created folders = %+v, want none", folders)
	}
}

type countingNodeMapWindowRepo struct {
	store.Repository
	listNodeMapWindowCalls int
}

func (r *countingNodeMapWindowRepo) ListNodeMapWindow(query store.NodeMapWindowQuery) (store.NodeMapWindowResult, error) {
	r.listNodeMapWindowCalls++
	return r.Repository.ListNodeMapWindow(query)
}

func TestWorkspaceSnapshotNodeMapWindowConditionalGetAndEventFilters(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &countingNodeMapWindowRepo{Repository: base}
	server := newServerWithLegacyMapRoutesForTest(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-777777777777"

	folder, err := base.CreateCompanyExplorerFolder(companyID, "", "node", "Window")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder error = %v", err)
	}
	node, err := base.CreateNode(companyID, "Visible")
	if err != nil {
		t.Fatalf("CreateNode error = %v", err)
	}
	if _, _, err := base.AssignCompanyExplorerFolderItem(companyID, folder.FolderID, "node", node.NodeID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem error = %v", err)
	}
	if _, err := base.UpsertNodeMapPositions(companyID, []domain.NodeMapPosition{{NodeID: node.NodeID, X: 25, Y: 25}}); err != nil {
		t.Fatalf("UpsertNodeMapPositions error = %v", err)
	}

	url := "/v1/workspace/snapshot?company_id=" + companyID + "&scope=node_map_window&folder_id=" + folder.FolderID + "&min_x=0&min_y=0&max_x=100&max_y=100"
	firstReq := httptest.NewRequest(http.MethodGet, url, nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("initial node_map_window status = %d body=%s", firstRec.Code, firstRec.Body.String())
	}
	if repo.listNodeMapWindowCalls != 1 {
		t.Fatalf("ListNodeMapWindow calls after first request = %d, want 1", repo.listNodeMapWindowCalls)
	}
	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("node_map_window ETag is empty")
	}

	unchangedReq := httptest.NewRequest(http.MethodGet, url, nil)
	unchangedReq.Header.Set("If-None-Match", etag)
	unchangedRec := httptest.NewRecorder()
	handler.ServeHTTP(unchangedRec, unchangedReq)
	if unchangedRec.Code != http.StatusNotModified {
		t.Fatalf("unchanged node_map_window status = %d, want %d body=%s", unchangedRec.Code, http.StatusNotModified, unchangedRec.Body.String())
	}
	if repo.listNodeMapWindowCalls != 1 {
		t.Fatalf("ListNodeMapWindow calls after 304 = %d, want 1", repo.listNodeMapWindowCalls)
	}

	communicationsBody, _ := json.Marshal(map[string]string{"company_id": companyID, "folder_kind": "communications", "name": "Shared"})
	communicationsReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders", bytes.NewReader(communicationsBody))
	communicationsReq.Header.Set("Content-Type", "application/json")
	communicationsRec := httptest.NewRecorder()
	handler.ServeHTTP(communicationsRec, communicationsReq)
	if communicationsRec.Code != http.StatusCreated {
		t.Fatalf("create communications folder status = %d body=%s", communicationsRec.Code, communicationsRec.Body.String())
	}
	unrelatedReq := httptest.NewRequest(http.MethodGet, url, nil)
	unrelatedReq.Header.Set("If-None-Match", etag)
	unrelatedRec := httptest.NewRecorder()
	handler.ServeHTTP(unrelatedRec, unrelatedReq)
	if unrelatedRec.Code != http.StatusNotModified {
		t.Fatalf("node_map_window after unrelated communications event status = %d, want %d body=%s", unrelatedRec.Code, http.StatusNotModified, unrelatedRec.Body.String())
	}
	if repo.listNodeMapWindowCalls != 1 {
		t.Fatalf("ListNodeMapWindow calls after unrelated 304 = %d, want 1", repo.listNodeMapWindowCalls)
	}

	writeBody, _ := json.Marshal(map[string]any{"company_id": companyID, "map_type": "node", "positions": []map[string]any{{"entity_id": node.NodeID, "x": 50, "y": 50}}})
	writeReq := httptest.NewRequest(http.MethodPut, "/v1/map-layout", bytes.NewReader(writeBody))
	writeReq.Header.Set("Content-Type", "application/json")
	writeRec := httptest.NewRecorder()
	handler.ServeHTTP(writeRec, writeReq)
	if writeRec.Code != http.StatusOK {
		t.Fatalf("PUT map-layout status = %d body=%s", writeRec.Code, writeRec.Body.String())
	}

	staleReq := httptest.NewRequest(http.MethodGet, url, nil)
	staleReq.Header.Set("If-None-Match", etag)
	staleRec := httptest.NewRecorder()
	handler.ServeHTTP(staleRec, staleReq)
	if staleRec.Code != http.StatusOK {
		t.Fatalf("node_map_window after position update status = %d, want %d body=%s", staleRec.Code, http.StatusOK, staleRec.Body.String())
	}
	if staleRec.Header().Get("ETag") == etag {
		t.Fatalf("node_map_window ETag did not change after node_map_positions_updated")
	}
	if repo.listNodeMapWindowCalls != 2 {
		t.Fatalf("ListNodeMapWindow calls after relevant event = %d, want 2", repo.listNodeMapWindowCalls)
	}
}

func assertHTTPNodeMapIDs(t *testing.T, label string, got []string, want ...string) {
	t.Helper()
	seen := make(map[string]bool, len(got))
	for _, id := range got {
		seen[id] = true
	}
	if len(seen) != len(want) {
		t.Fatalf("%s ids = %v, want %v", label, got, want)
	}
	for _, id := range want {
		if !seen[id] {
			t.Fatalf("%s ids = %v, missing %s", label, got, id)
		}
	}
}

func httpNodeIDs(items []domain.Node) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.NodeID)
	}
	return ids
}

func httpPositionNodeIDs(items []domain.NodeMapPosition) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.NodeID)
	}
	return ids
}

func httpRelationshipIDs(items []domain.NodeRelationship) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.NodeRelationshipID)
	}
	return ids
}

func httpFolderItemIDs(items []domain.CompanyExplorerFolderItem) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ItemID)
	}
	return ids
}

func httpFolderIDs(items []domain.CompanyExplorerFolder) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.FolderID)
	}
	return ids
}
func TestWorkspaceSnapshotLogicGateMapWindowBoundsPayloadAndPreservesBroadCompatibility(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := newServerWithLegacyMapRoutesForTest(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-aaaaaaaaaaaa"

	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Window parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder parent error = %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "logic_gate", "Window child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder child error = %v", err)
	}
	sibling, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Window sibling")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder sibling error = %v", err)
	}

	gateA, err := repo.CreateLogicGate(companyID, "Window A")
	if err != nil {
		t.Fatalf("CreateLogicGate A error = %v", err)
	}
	gateB, err := repo.CreateLogicGate(companyID, "Window B")
	if err != nil {
		t.Fatalf("CreateLogicGate B error = %v", err)
	}
	gateOutsideFolder, err := repo.CreateLogicGate(companyID, "Outside folder")
	if err != nil {
		t.Fatalf("CreateLogicGate outside folder error = %v", err)
	}
	gateOutsideWindow, err := repo.CreateLogicGate(companyID, "Outside window")
	if err != nil {
		t.Fatalf("CreateLogicGate outside window error = %v", err)
	}
	gateWithoutPosition, err := repo.CreateLogicGate(companyID, "Without position")
	if err != nil {
		t.Fatalf("CreateLogicGate without position error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parent.FolderID, "logic_gate", gateA.LogicGateID, 1000); err != nil {
		t.Fatalf("Assign gate A error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, child.FolderID, "logic_gate", gateB.LogicGateID, 2000); err != nil {
		t.Fatalf("Assign gate B error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, sibling.FolderID, "logic_gate", gateOutsideFolder.LogicGateID, 3000); err != nil {
		t.Fatalf("Assign outside folder gate error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parent.FolderID, "logic_gate", gateOutsideWindow.LogicGateID, 4000); err != nil {
		t.Fatalf("Assign outside window gate error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parent.FolderID, "logic_gate", gateWithoutPosition.LogicGateID, 5000); err != nil {
		t.Fatalf("Assign unpositioned gate error = %v", err)
	}

	visibleRelationship, err := repo.CreateLogicGateRelationship(companyID, gateA.LogicGateID, gateB.LogicGateID, "Peer", "Peer")
	if err != nil {
		t.Fatalf("CreateLogicGateRelationship visible error = %v", err)
	}
	if _, err := repo.CreateLogicGateRelationship(companyID, gateB.LogicGateID, gateOutsideFolder.LogicGateID, "Peer", "Peer"); err != nil {
		t.Fatalf("CreateLogicGateRelationship outside folder error = %v", err)
	}
	if _, err := repo.CreateLogicGateRelationship(companyID, gateA.LogicGateID, gateOutsideWindow.LogicGateID, "Peer", "Peer"); err != nil {
		t.Fatalf("CreateLogicGateRelationship outside window error = %v", err)
	}
	if _, err := repo.CreateLogicGateRelationship(companyID, gateA.LogicGateID, gateWithoutPosition.LogicGateID, "Peer", "Peer"); err != nil {
		t.Fatalf("CreateLogicGateRelationship unpositioned error = %v", err)
	}
	if _, err := repo.UpsertLogicGateMapPositions(companyID, []domain.LogicGateMapPosition{
		{LogicGateID: gateA.LogicGateID, X: 100, Y: 100},
		{LogicGateID: gateB.LogicGateID, X: 200, Y: 200},
		{LogicGateID: gateOutsideFolder.LogicGateID, X: 150, Y: 150},
		{LogicGateID: gateOutsideWindow.LogicGateID, X: 900, Y: 900},
	}); err != nil {
		t.Fatalf("UpsertLogicGateMapPositions error = %v", err)
	}

	windowURL := "/v1/workspace/snapshot?company_id=" + companyID + "&scope=logic_gate_map_window&folder_id=" + parent.FolderID + "&min_x=0&min_y=0&max_x=300&max_y=300&limit=10"
	req := httptest.NewRequest(http.MethodGet, windowURL, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("logic_gate_map_window status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload struct {
		Scope                 string                             `json:"scope"`
		FolderID              string                             `json:"folder_id"`
		Window                store.NodeMapWindowBounds          `json:"window"`
		Limit                 int                                `json:"logic_gates_limit"`
		LogicGates            []domain.LogicGate                 `json:"logic_gates"`
		Relationships         []domain.LogicGateRelationship     `json:"logic_gate_relationships"`
		Folders               []domain.CompanyExplorerFolder     `json:"folders"`
		FolderItems           []domain.CompanyExplorerFolderItem `json:"folder_items"`
		LogicGateMapPositions []domain.LogicGateMapPosition      `json:"logic_gate_map_positions"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode logic_gate_map_window payload: %v", err)
	}
	if payload.Scope != "logic_gate_map_window" || payload.FolderID != parent.FolderID || payload.Limit != 10 || payload.Window.MaxX != 300 || payload.Window.MaxY != 300 {
		t.Fatalf("window metadata = scope %q folder %q limit %d window %+v", payload.Scope, payload.FolderID, payload.Limit, payload.Window)
	}
	assertHTTPNodeMapIDs(t, "window logic_gates", httpLogicGateIDs(payload.LogicGates), gateA.LogicGateID, gateB.LogicGateID)
	assertHTTPNodeMapIDs(t, "window positions", httpLogicGatePositionIDs(payload.LogicGateMapPositions), gateA.LogicGateID, gateB.LogicGateID)
	assertHTTPNodeMapIDs(t, "window relationships", httpLogicGateRelationshipIDs(payload.Relationships), visibleRelationship.LogicGateRelationshipID)
	assertHTTPNodeMapIDs(t, "window folder_items", httpFolderItemIDs(payload.FolderItems), gateA.LogicGateID, gateB.LogicGateID)
	assertHTTPNodeMapIDs(t, "window folders", httpFolderIDs(payload.Folders), parent.FolderID, child.FolderID)

	layoutReq := httptest.NewRequest(http.MethodGet, "/v1/map-layout?company_id="+companyID+"&map_type=logic_gate&folder_id="+parent.FolderID+"&min_x=0&min_y=0&max_x=300&max_y=300&limit=10", nil)
	layoutRec := httptest.NewRecorder()
	handler.ServeHTTP(layoutRec, layoutReq)
	if layoutRec.Code != http.StatusOK {
		t.Fatalf("bounded logic gate map-layout status = %d, want %d body=%s", layoutRec.Code, http.StatusOK, layoutRec.Body.String())
	}
	var layoutPayload struct {
		Positions []domain.LogicGateMapPosition `json:"positions"`
	}
	if err := json.NewDecoder(layoutRec.Body).Decode(&layoutPayload); err != nil {
		t.Fatalf("decode bounded logic gate map-layout payload: %v", err)
	}
	assertHTTPNodeMapIDs(t, "bounded logic gate map-layout positions", httpLogicGatePositionIDs(layoutPayload.Positions), gateA.LogicGateID, gateB.LogicGateID)

	broadReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=logic_gate_map", nil)
	broadRec := httptest.NewRecorder()
	handler.ServeHTTP(broadRec, broadReq)
	if broadRec.Code != http.StatusOK {
		t.Fatalf("broad logic_gate_map status = %d, want %d body=%s", broadRec.Code, http.StatusOK, broadRec.Body.String())
	}
	var broadPayload struct {
		Scope                 string                        `json:"scope"`
		LogicGates            []domain.LogicGate            `json:"logic_gates"`
		LogicGateMapPositions []domain.LogicGateMapPosition `json:"logic_gate_map_positions"`
	}
	if err := json.NewDecoder(broadRec.Body).Decode(&broadPayload); err != nil {
		t.Fatalf("decode broad logic_gate_map payload: %v", err)
	}
	if broadPayload.Scope != "logic_gate_map" {
		t.Fatalf("broad scope = %q, want logic_gate_map", broadPayload.Scope)
	}
	assertHTTPNodeMapIDs(t, "broad logic_gates", httpLogicGateIDs(broadPayload.LogicGates), gateA.LogicGateID, gateB.LogicGateID, gateOutsideFolder.LogicGateID, gateOutsideWindow.LogicGateID, gateWithoutPosition.LogicGateID)
	assertHTTPNodeMapIDs(t, "broad positions", httpLogicGatePositionIDs(broadPayload.LogicGateMapPositions), gateA.LogicGateID, gateB.LogicGateID, gateOutsideFolder.LogicGateID, gateOutsideWindow.LogicGateID)
}

func TestWorkspaceSnapshotLogicGateMapWindowRejectsInvalidInputsAndDoesNotRepairRows(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := newServerWithLegacyMapRoutesForTest(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-bbbbbbbbbbbb"
	missingFolderID := "22222222-2222-4222-8222-222222222222"

	cases := []struct {
		name string
		url  string
		code int
		err  string
	}{
		{name: "missing company id", url: "/v1/workspace/snapshot?scope=logic_gate_map_window&folder_id=" + missingFolderID + "&min_x=0&min_y=0&max_x=100&max_y=100", code: http.StatusBadRequest, err: "company_id_required"},
		{name: "missing folder id", url: "/v1/workspace/snapshot?company_id=" + companyID + "&scope=logic_gate_map_window&min_x=0&min_y=0&max_x=100&max_y=100", code: http.StatusBadRequest, err: "folder_id_required"},
		{name: "invalid folder id", url: "/v1/workspace/snapshot?company_id=" + companyID + "&scope=logic_gate_map_window&folder_id=not-a-folder&min_x=0&min_y=0&max_x=100&max_y=100", code: http.StatusBadRequest, err: "invalid_folder_id"},
		{name: "invalid window", url: "/v1/workspace/snapshot?company_id=" + companyID + "&scope=logic_gate_map_window&folder_id=" + missingFolderID + "&min_x=200&min_y=0&max_x=100&max_y=100", code: http.StatusBadRequest, err: "invalid_window"},
		{name: "missing folder", url: "/v1/workspace/snapshot?company_id=" + companyID + "&scope=logic_gate_map_window&folder_id=" + missingFolderID + "&min_x=0&min_y=0&max_x=100&max_y=100", code: http.StatusNotFound, err: "company_explorer_folder_not_found"},
		{name: "map-layout missing folder", url: "/v1/map-layout?company_id=" + companyID + "&map_type=logic_gate&folder_id=" + missingFolderID + "&min_x=0&min_y=0&max_x=100&max_y=100", code: http.StatusNotFound, err: "company_explorer_folder_not_found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.url, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.code || !strings.Contains(rec.Body.String(), tc.err) {
				t.Fatalf("status/body = %d/%s, want %d containing %q", rec.Code, rec.Body.String(), tc.code, tc.err)
			}
		})
	}
	folders, err := repo.ListCompanyExplorerFolders(companyID, "logic_gate")
	if err != nil {
		t.Fatalf("ListCompanyExplorerFolders after GETs error = %v", err)
	}
	if len(folders) != 0 {
		t.Fatalf("GET logic-gate-map window created folders = %+v, want none", folders)
	}
}

type countingLogicGateMapWindowRepo struct {
	store.Repository
	listLogicGateMapWindowCalls int
}

func (r *countingLogicGateMapWindowRepo) ListLogicGateMapWindow(query store.LogicGateMapWindowQuery) (store.LogicGateMapWindowResult, error) {
	r.listLogicGateMapWindowCalls++
	return r.Repository.ListLogicGateMapWindow(query)
}

func TestWorkspaceSnapshotLogicGateMapWindowConditionalGetAndEventFilters(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &countingLogicGateMapWindowRepo{Repository: base}
	server := newServerWithLegacyMapRoutesForTest(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-cccccccccccc"

	folder, err := base.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Window")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder error = %v", err)
	}
	logicGate, err := base.CreateLogicGate(companyID, "Visible")
	if err != nil {
		t.Fatalf("CreateLogicGate error = %v", err)
	}
	if _, _, err := base.AssignCompanyExplorerFolderItem(companyID, folder.FolderID, "logic_gate", logicGate.LogicGateID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem error = %v", err)
	}
	if _, err := base.UpsertLogicGateMapPositions(companyID, []domain.LogicGateMapPosition{{LogicGateID: logicGate.LogicGateID, X: 25, Y: 25}}); err != nil {
		t.Fatalf("UpsertLogicGateMapPositions error = %v", err)
	}

	url := "/v1/workspace/snapshot?company_id=" + companyID + "&scope=logic_gate_map_window&folder_id=" + folder.FolderID + "&min_x=0&min_y=0&max_x=100&max_y=100"
	firstReq := httptest.NewRequest(http.MethodGet, url, nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("initial logic_gate_map_window status = %d body=%s", firstRec.Code, firstRec.Body.String())
	}
	if repo.listLogicGateMapWindowCalls != 1 {
		t.Fatalf("ListLogicGateMapWindow calls after first request = %d, want 1", repo.listLogicGateMapWindowCalls)
	}
	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("logic_gate_map_window ETag is empty")
	}

	unchangedReq := httptest.NewRequest(http.MethodGet, url, nil)
	unchangedReq.Header.Set("If-None-Match", etag)
	unchangedRec := httptest.NewRecorder()
	handler.ServeHTTP(unchangedRec, unchangedReq)
	if unchangedRec.Code != http.StatusNotModified {
		t.Fatalf("unchanged logic_gate_map_window status = %d, want %d body=%s", unchangedRec.Code, http.StatusNotModified, unchangedRec.Body.String())
	}
	if repo.listLogicGateMapWindowCalls != 1 {
		t.Fatalf("ListLogicGateMapWindow calls after 304 = %d, want 1", repo.listLogicGateMapWindowCalls)
	}

	communicationsBody, _ := json.Marshal(map[string]string{"company_id": companyID, "folder_kind": "communications", "name": "Shared"})
	communicationsReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders", bytes.NewReader(communicationsBody))
	communicationsReq.Header.Set("Content-Type", "application/json")
	communicationsRec := httptest.NewRecorder()
	handler.ServeHTTP(communicationsRec, communicationsReq)
	if communicationsRec.Code != http.StatusCreated {
		t.Fatalf("create communications folder status = %d body=%s", communicationsRec.Code, communicationsRec.Body.String())
	}
	unrelatedReq := httptest.NewRequest(http.MethodGet, url, nil)
	unrelatedReq.Header.Set("If-None-Match", etag)
	unrelatedRec := httptest.NewRecorder()
	handler.ServeHTTP(unrelatedRec, unrelatedReq)
	if unrelatedRec.Code != http.StatusNotModified {
		t.Fatalf("logic_gate_map_window after unrelated communications event status = %d, want %d body=%s", unrelatedRec.Code, http.StatusNotModified, unrelatedRec.Body.String())
	}
	if repo.listLogicGateMapWindowCalls != 1 {
		t.Fatalf("ListLogicGateMapWindow calls after unrelated 304 = %d, want 1", repo.listLogicGateMapWindowCalls)
	}

	writeBody, _ := json.Marshal(map[string]any{"company_id": companyID, "map_type": "logic_gate", "positions": []map[string]any{{"entity_id": logicGate.LogicGateID, "x": 50, "y": 50}}})
	writeReq := httptest.NewRequest(http.MethodPut, "/v1/map-layout", bytes.NewReader(writeBody))
	writeReq.Header.Set("Content-Type", "application/json")
	writeRec := httptest.NewRecorder()
	handler.ServeHTTP(writeRec, writeReq)
	if writeRec.Code != http.StatusOK {
		t.Fatalf("PUT logic gate map-layout status = %d body=%s", writeRec.Code, writeRec.Body.String())
	}

	staleReq := httptest.NewRequest(http.MethodGet, url, nil)
	staleReq.Header.Set("If-None-Match", etag)
	staleRec := httptest.NewRecorder()
	handler.ServeHTTP(staleRec, staleReq)
	if staleRec.Code != http.StatusOK {
		t.Fatalf("logic_gate_map_window after position update status = %d, want %d body=%s", staleRec.Code, http.StatusOK, staleRec.Body.String())
	}
	if staleRec.Header().Get("ETag") == etag {
		t.Fatalf("logic_gate_map_window ETag did not change after logic_gate_map_positions_updated")
	}
	if repo.listLogicGateMapWindowCalls != 2 {
		t.Fatalf("ListLogicGateMapWindow calls after relevant event = %d, want 2", repo.listLogicGateMapWindowCalls)
	}
}

func httpLogicGateIDs(items []domain.LogicGate) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.LogicGateID)
	}
	return ids
}

func httpLogicGatePositionIDs(items []domain.LogicGateMapPosition) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.LogicGateID)
	}
	return ids
}

func httpLogicGateRelationshipIDs(items []domain.LogicGateRelationship) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.LogicGateRelationshipID)
	}
	return ids
}
func TestWorkspaceSnapshotCompanyExplorerScopeUsesFolderSubtree(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-explorer-subtree-snapshot-test"

	nodeParent, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Node parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder node parent error = %v", err)
	}
	nodeChild, err := repo.CreateCompanyExplorerFolder(companyID, nodeParent.FolderID, "node", "Node child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder node child error = %v", err)
	}
	nodeSibling, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Node sibling")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder node sibling error = %v", err)
	}
	logicParent, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Logic parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder logic parent error = %v", err)
	}
	logicChild, err := repo.CreateCompanyExplorerFolder(companyID, logicParent.FolderID, "logic_gate", "Logic child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder logic child error = %v", err)
	}
	logicSibling, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Logic sibling")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder logic sibling error = %v", err)
	}

	nodeA, err := repo.CreateNode(companyID, "Node A")
	if err != nil {
		t.Fatalf("CreateNode A error = %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Node B")
	if err != nil {
		t.Fatalf("CreateNode B error = %v", err)
	}
	nodeOutside, err := repo.CreateNode(companyID, "Node outside")
	if err != nil {
		t.Fatalf("CreateNode outside error = %v", err)
	}
	gateA, err := repo.CreateLogicGate(companyID, "Gate A")
	if err != nil {
		t.Fatalf("CreateLogicGate A error = %v", err)
	}
	gateB, err := repo.CreateLogicGate(companyID, "Gate B")
	if err != nil {
		t.Fatalf("CreateLogicGate B error = %v", err)
	}
	gateOutside, err := repo.CreateLogicGate(companyID, "Gate outside")
	if err != nil {
		t.Fatalf("CreateLogicGate outside error = %v", err)
	}

	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, nodeParent.FolderID, "node", nodeA.NodeID, 1000); err != nil {
		t.Fatalf("Assign node A error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, nodeChild.FolderID, "node", nodeB.NodeID, 2000); err != nil {
		t.Fatalf("Assign node B error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, nodeSibling.FolderID, "node", nodeOutside.NodeID, 3000); err != nil {
		t.Fatalf("Assign outside node error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, logicParent.FolderID, "logic_gate", gateA.LogicGateID, 1000); err != nil {
		t.Fatalf("Assign gate A error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, logicChild.FolderID, "logic_gate", gateB.LogicGateID, 2000); err != nil {
		t.Fatalf("Assign gate B error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, logicSibling.FolderID, "logic_gate", gateOutside.LogicGateID, 3000); err != nil {
		t.Fatalf("Assign outside gate error = %v", err)
	}

	assertIDs := func(label string, got []string, want ...string) {
		t.Helper()
		seen := make(map[string]bool, len(got))
		for _, id := range got {
			seen[id] = true
		}
		if len(seen) != len(want) {
			t.Fatalf("%s ids = %v, want %v", label, got, want)
		}
		for _, id := range want {
			if !seen[id] {
				t.Fatalf("%s ids = %v, missing %s", label, got, id)
			}
		}
	}

	nodeReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=company_explorer&folder_kind=node&folder_id="+nodeParent.FolderID, nil)
	nodeRec := httptest.NewRecorder()
	handler.ServeHTTP(nodeRec, nodeReq)
	if nodeRec.Code != http.StatusOK {
		t.Fatalf("node subtree snapshot status = %d, want %d body=%s", nodeRec.Code, http.StatusOK, nodeRec.Body.String())
	}
	var nodePayload struct {
		Scope       string                             `json:"scope"`
		FolderKind  string                             `json:"folder_kind"`
		FolderID    string                             `json:"folder_id"`
		Nodes       []domain.Node                      `json:"nodes"`
		LogicGates  []domain.LogicGate                 `json:"logic_gates"`
		Folders     []domain.CompanyExplorerFolder     `json:"folders"`
		FolderItems []domain.CompanyExplorerFolderItem `json:"folder_items"`
	}
	if err := json.NewDecoder(nodeRec.Body).Decode(&nodePayload); err != nil {
		t.Fatalf("decode node subtree snapshot: %v", err)
	}
	if nodePayload.Scope != "company_explorer" || nodePayload.FolderKind != "node" || nodePayload.FolderID != nodeParent.FolderID {
		t.Fatalf("node subtree identity = scope:%q kind:%q folder:%q", nodePayload.Scope, nodePayload.FolderKind, nodePayload.FolderID)
	}
	nodeIDs := make([]string, 0, len(nodePayload.Nodes))
	for _, node := range nodePayload.Nodes {
		nodeIDs = append(nodeIDs, node.NodeID)
	}
	assertIDs("node summaries", nodeIDs, nodeA.NodeID, nodeB.NodeID)
	if len(nodePayload.LogicGates) != 0 {
		t.Fatalf("node subtree logic gates = %+v, want none", nodePayload.LogicGates)
	}
	folderIDs := make([]string, 0, len(nodePayload.Folders))
	for _, folder := range nodePayload.Folders {
		folderIDs = append(folderIDs, folder.FolderID)
	}
	assertIDs("node folders", folderIDs, nodeParent.FolderID, nodeChild.FolderID)
	folderItemIDs := make([]string, 0, len(nodePayload.FolderItems))
	for _, item := range nodePayload.FolderItems {
		folderItemIDs = append(folderItemIDs, item.ItemID)
	}
	assertIDs("node folder items", folderItemIDs, nodeA.NodeID, nodeB.NodeID)

	logicReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=company_explorer&folder_kind=logic_gate&folder_id="+logicParent.FolderID, nil)
	logicRec := httptest.NewRecorder()
	handler.ServeHTTP(logicRec, logicReq)
	if logicRec.Code != http.StatusOK {
		t.Fatalf("logic subtree snapshot status = %d, want %d body=%s", logicRec.Code, http.StatusOK, logicRec.Body.String())
	}
	var logicPayload struct {
		Nodes       []domain.Node                      `json:"nodes"`
		LogicGates  []domain.LogicGate                 `json:"logic_gates"`
		Folders     []domain.CompanyExplorerFolder     `json:"folders"`
		FolderItems []domain.CompanyExplorerFolderItem `json:"folder_items"`
	}
	if err := json.NewDecoder(logicRec.Body).Decode(&logicPayload); err != nil {
		t.Fatalf("decode logic subtree snapshot: %v", err)
	}
	if len(logicPayload.Nodes) != 0 {
		t.Fatalf("logic subtree nodes = %+v, want none", logicPayload.Nodes)
	}
	logicGateIDs := make([]string, 0, len(logicPayload.LogicGates))
	for _, gate := range logicPayload.LogicGates {
		logicGateIDs = append(logicGateIDs, gate.LogicGateID)
	}
	assertIDs("logic gate summaries", logicGateIDs, gateA.LogicGateID, gateB.LogicGateID)
	logicFolderIDs := make([]string, 0, len(logicPayload.Folders))
	for _, folder := range logicPayload.Folders {
		logicFolderIDs = append(logicFolderIDs, folder.FolderID)
	}
	assertIDs("logic folders", logicFolderIDs, logicParent.FolderID, logicChild.FolderID)
	logicFolderItemIDs := make([]string, 0, len(logicPayload.FolderItems))
	for _, item := range logicPayload.FolderItems {
		logicFolderItemIDs = append(logicFolderItemIDs, item.ItemID)
	}
	assertIDs("logic folder items", logicFolderItemIDs, gateA.LogicGateID, gateB.LogicGateID)
}

func TestWorkspaceSnapshotCompanyExplorerSubtreeErrorsAndDoesNotSeedRows(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-explorer-subtree-error-test"
	missingFolderID := "00000000-0000-4000-8000-000000000000"

	invalidReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=company_explorer&folder_kind=node&folder_id=not-a-folder-id", nil)
	invalidRec := httptest.NewRecorder()
	handler.ServeHTTP(invalidRec, invalidReq)
	if invalidRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid folder snapshot status = %d, want %d body=%s", invalidRec.Code, http.StatusBadRequest, invalidRec.Body.String())
	}

	missingKindReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=company_explorer&folder_id="+missingFolderID, nil)
	missingKindRec := httptest.NewRecorder()
	handler.ServeHTTP(missingKindRec, missingKindReq)
	if missingKindRec.Code != http.StatusBadRequest {
		t.Fatalf("missing folder kind status = %d, want %d body=%s", missingKindRec.Code, http.StatusBadRequest, missingKindRec.Body.String())
	}

	beforeFolders, err := repo.ListCompanyExplorerFolders(companyID, "node")
	if err != nil {
		t.Fatalf("ListCompanyExplorerFolders before error = %v", err)
	}
	missingReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=company_explorer&folder_kind=node&folder_id="+missingFolderID, nil)
	missingRec := httptest.NewRecorder()
	handler.ServeHTTP(missingRec, missingReq)
	if missingRec.Code != http.StatusNotFound {
		t.Fatalf("missing folder snapshot status = %d, want %d body=%s", missingRec.Code, http.StatusNotFound, missingRec.Body.String())
	}
	afterFolders, err := repo.ListCompanyExplorerFolders(companyID, "node")
	if err != nil {
		t.Fatalf("ListCompanyExplorerFolders after error = %v", err)
	}
	afterItems, err := repo.ListCompanyExplorerFolderItems(companyID, "", "node")
	if err != nil {
		t.Fatalf("ListCompanyExplorerFolderItems after error = %v", err)
	}
	if len(beforeFolders) != 0 || len(afterFolders) != 0 || len(afterItems) != 0 {
		t.Fatalf("GET subtree read created rows: before_folders=%d after_folders=%d after_items=%d", len(beforeFolders), len(afterFolders), len(afterItems))
	}
}
func TestMapEntityBatchCreatesNodesRelationshipsAndPositions(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := newServerWithLegacyMapRoutesForTest(repo)
	companyID := "company-map-batch-node-test"

	body := []byte(`{
		"company_id":"` + companyID + `",
		"entity_kind":"node",
		"items":[
			{"client_id":"copied-a","title":"Copied A","x":120,"y":240},
			{"client_id":"copied-b","title":"Copied B","x":320,"y":240}
		],
		"relationships":[
			{"client_id_a":"copied-a","client_id_b":"copied-b","a_position":"Peer","b_position":"Peer"}
		]
	}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/map-entity-batches", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST map-entity-batches status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var payload struct {
		EntityMappings []struct {
			ClientID string `json:"client_id"`
			EntityID string `json:"entity_id"`
		} `json:"entity_mappings"`
		Nodes []struct {
			NodeID string `json:"node_id"`
			Title  string `json:"title"`
		} `json:"nodes"`
		Relationships []struct {
			NodeIDA string `json:"node_id_a"`
			NodeIDB string `json:"node_id_b"`
		} `json:"relationships"`
		NodeMapPositions []struct {
			NodeID string  `json:"node_id"`
			X      float64 `json:"x"`
			Y      float64 `json:"y"`
		} `json:"node_map_positions"`
		FolderItems []struct {
			FolderID string `json:"folder_id"`
			ItemType string `json:"item_type"`
			ItemID   string `json:"item_id"`
		} `json:"folder_items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode map entity batch response: %v", err)
	}
	if len(payload.EntityMappings) != 2 || len(payload.Nodes) != 2 || len(payload.Relationships) != 1 || len(payload.NodeMapPositions) != 2 || len(payload.FolderItems) != 2 {
		t.Fatalf("unexpected batch response counts: mappings=%d nodes=%d relationships=%d positions=%d folder_items=%d", len(payload.EntityMappings), len(payload.Nodes), len(payload.Relationships), len(payload.NodeMapPositions), len(payload.FolderItems))
	}
	if payload.Relationships[0].NodeIDA == "" || payload.Relationships[0].NodeIDB == "" || payload.Relationships[0].NodeIDA == payload.Relationships[0].NodeIDB {
		t.Fatalf("relationship did not resolve client ids: %+v", payload.Relationships[0])
	}
	for _, item := range payload.FolderItems {
		if item.FolderID == "" || item.ItemType != "node" || item.ItemID == "" {
			t.Fatalf("node batch folder item = %+v, want active-node placement", item)
		}
	}
}

func TestMapEntityBatchAssignsCreatedNodesToCreator(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := newServerWithLegacyMapRoutesForTest(repo)
	companyID := "company-map-batch-creator-test"
	repo.EnsureCompany(companyID, "Map Batch Creator Company")
	creator, err := repo.UpsertAuthUser("map-batch-creator-subject", "batch-creator@example.com", "Batch Creator")
	if err != nil {
		t.Fatalf("UpsertAuthUser creator error = %v", err)
	}
	if _, err := repo.AddCompanyMembership("map-batch-creator-subject", companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership creator error = %v", err)
	}
	source, err := repo.CreateNode(companyID, "Existing parent")
	if err != nil {
		t.Fatalf("CreateNode source error = %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"company_id":  companyID,
		"entity_kind": "node",
		"items": []map[string]any{{
			"client_id": "created-child",
			"title":     "Created child",
			"x":         120,
			"y":         240,
		}},
		"relationships": []map[string]any{{
			"entity_id_a": source.NodeID,
			"client_id_b": "created-child",
			"a_position":  "Parent",
			"b_position":  "Child",
		}},
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/map-entity-batches", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = requestWithActorForTest(req, creator, companyID)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST map-entity-batches status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var payload struct {
		Nodes         []domain.Node `json:"nodes"`
		Relationships []struct {
			NodeIDA string `json:"node_id_a"`
			NodeIDB string `json:"node_id_b"`
		} `json:"relationships"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode map entity batch response: %v", err)
	}
	if len(payload.Nodes) != 1 || len(payload.Relationships) != 1 {
		t.Fatalf("batch response counts: nodes=%d relationships=%d, want 1 each", len(payload.Nodes), len(payload.Relationships))
	}
	created := payload.Nodes[0]
	if created.AssigneeUserID == nil || *created.AssigneeUserID != creator.UserID || created.AssigneeName == nil || *created.AssigneeName != "Batch Creator" {
		t.Fatalf("created batch node assignee = %+v, want creator", created)
	}
	if payload.Relationships[0].NodeIDA != source.NodeID || payload.Relationships[0].NodeIDB != created.NodeID {
		t.Fatalf("batch relationship = %+v, want source parent to created child %s", payload.Relationships[0], created.NodeID)
	}
	details, err := repo.GetNodeDetails(companyID, created.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails() error = %v", err)
	}
	if details.Node.AssigneeUserID == nil || *details.Node.AssigneeUserID != creator.UserID {
		t.Fatalf("details node assignee = %+v, want creator", details.Node)
	}
}

func TestMapEntityBatchCreatesLogicGateWithFolderAndExistingRelationship(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := newServerWithLegacyMapRoutesForTest(repo)
	companyID := "company-map-batch-logic-test"
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Logic folder")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder failed: %v", err)
	}
	source, err := repo.CreateLogicGate(companyID, "Existing source")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}

	body := []byte(`{
		"company_id":"` + companyID + `",
		"entity_kind":"logic_gate",
		"folder_id":"` + folder.FolderID + `",
		"items":[{"client_id":"new-gate","header":"New gate","x":480,"y":360,"position":4242}],
		"relationships":[{"entity_id_a":"` + source.LogicGateID + `","client_id_b":"new-gate","a_position":"Input","b_position":"Output"}]
	}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/map-entity-batches", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST map-entity-batches status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var payload struct {
		LogicGates []struct {
			LogicGateID string `json:"logic_gate_id"`
			Header      string `json:"header"`
		} `json:"logic_gates"`
		LogicGateRelationships []struct {
			LogicGateIDA string `json:"logic_gate_id_a"`
			LogicGateIDB string `json:"logic_gate_id_b"`
		} `json:"logic_gate_relationships"`
		FolderItems []struct {
			FolderID string `json:"folder_id"`
			ItemType string `json:"item_type"`
			ItemID   string `json:"item_id"`
			Position int    `json:"position"`
		} `json:"folder_items"`
		LogicGateMapPositions []struct {
			LogicGateID string  `json:"logic_gate_id"`
			X           float64 `json:"x"`
			Y           float64 `json:"y"`
		} `json:"logic_gate_map_positions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode map entity batch response: %v", err)
	}
	if len(payload.LogicGates) != 1 || len(payload.LogicGateRelationships) != 1 || len(payload.FolderItems) != 1 || len(payload.LogicGateMapPositions) != 1 {
		t.Fatalf("unexpected logic batch response counts: gates=%d relationships=%d folder_items=%d positions=%d", len(payload.LogicGates), len(payload.LogicGateRelationships), len(payload.FolderItems), len(payload.LogicGateMapPositions))
	}
	createdID := payload.LogicGates[0].LogicGateID
	if payload.LogicGateRelationships[0].LogicGateIDA != source.LogicGateID || payload.LogicGateRelationships[0].LogicGateIDB != createdID {
		t.Fatalf("relationship did not connect existing source to created gate: %+v created=%s", payload.LogicGateRelationships[0], createdID)
	}
	if payload.FolderItems[0].FolderID != folder.FolderID || payload.FolderItems[0].ItemType != "logic_gate" || payload.FolderItems[0].ItemID != createdID {
		t.Fatalf("folder item did not place created gate: %+v created=%s", payload.FolderItems[0], createdID)
	}
	if payload.FolderItems[0].Position != 4242 {
		t.Fatalf("folder item position = %d, want 4242", payload.FolderItems[0].Position)
	}

	boardsBeforeArena, err := repo.ListKanbanBoards(companyID, store.KanbanBoardQuery{LogicGateID: createdID, Limit: 2})
	if err != nil {
		t.Fatalf("ListKanbanBoards before arena load failed: %v", err)
	}
	if len(boardsBeforeArena) != 1 || boardsBeforeArena[0].BoardID != store.LogicGateKanbanBoardID(createdID) {
		t.Fatalf("batch create arena boards = %+v, want one attached board before arena load", boardsBeforeArena)
	}

	arenaReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gate-arena?company_id="+companyID+"&logic_gate_id="+createdID, nil)
	arenaRec := httptest.NewRecorder()
	server.Routes().ServeHTTP(arenaRec, arenaReq)
	if arenaRec.Code != http.StatusOK {
		t.Fatalf("GET logic gate arena status = %d, want %d body=%s", arenaRec.Code, http.StatusOK, arenaRec.Body.String())
	}
	var arenaPayload struct {
		Board struct {
			BoardID     string  `json:"board_id"`
			LogicGateID *string `json:"logic_gate_id"`
		} `json:"board"`
		Columns []struct {
			ColumnID string `json:"column_id"`
		} `json:"columns"`
	}
	if err := json.Unmarshal(arenaRec.Body.Bytes(), &arenaPayload); err != nil {
		t.Fatalf("decode logic gate arena response: %v", err)
	}
	if arenaPayload.Board.BoardID != store.LogicGateKanbanBoardID(createdID) || arenaPayload.Board.LogicGateID == nil || *arenaPayload.Board.LogicGateID != createdID {
		t.Fatalf("arena board = %+v, want attached board for created gate %s", arenaPayload.Board, createdID)
	}
	if len(arenaPayload.Columns) != 3 {
		t.Fatalf("arena columns = %d, want default columns", len(arenaPayload.Columns))
	}
}

func TestSelectLogicGateArenaBoardFallsBackToAttachedBoard(t *testing.T) {
	t.Parallel()

	board, ok := selectLogicGateArenaBoard([]domain.KanbanBoard{
		{BoardID: "legacy-attached-board"},
	}, "logic-gate:22222222-2222-4222-8222-222222222222")
	if !ok || board.BoardID != "legacy-attached-board" {
		t.Fatalf("selected board = %+v ok=%v, want legacy attached board fallback", board, ok)
	}
}

func TestRequestBodyLimitRejectsOversizedPayload(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{MaxRequestBodyBytes: 32})
	req := httptest.NewRequest(http.MethodPost, "/v1/nodes", strings.NewReader(`{"company_id":"company","title":"`+strings.Repeat("x", 64)+`"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	server.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusRequestEntityTooLarge, strings.TrimSpace(rec.Body.String()))
	}
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error != "request_body_too_large" {
		t.Fatalf("error = %q, want request_body_too_large", payload.Error)
	}
}

type countingListNodesRepo struct {
	store.Repository
	listNodesCalls int
}

func (r *countingListNodesRepo) ListNodes(companyID string) ([]domain.Node, error) {
	r.listNodesCalls++
	return r.Repository.ListNodes(companyID)
}

func TestNodesConditionalGetSkipsListWhenWorkspaceTokenMatches(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &countingListNodesRepo{Repository: base}
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-node-list-etag-test"

	if _, err := base.CreateNode(companyID, "alpha"); err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}

	firstReq := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+companyID, nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("first node list status = %d, want %d body=%s", firstRec.Code, http.StatusOK, firstRec.Body.String())
	}
	if repo.listNodesCalls != 1 {
		t.Fatalf("ListNodes calls after first request = %d, want 1", repo.listNodesCalls)
	}
	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("node list ETag is empty")
	}

	secondReq := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+companyID, nil)
	secondReq.Header.Set("If-None-Match", etag)
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)
	if secondRec.Code != http.StatusNotModified {
		t.Fatalf("second node list status = %d, want %d body=%s", secondRec.Code, http.StatusNotModified, secondRec.Body.String())
	}
	if repo.listNodesCalls != 1 {
		t.Fatalf("ListNodes calls after matching conditional request = %d, want 1", repo.listNodesCalls)
	}
}

func TestWorkspaceSnapshotScopesIgnoreUnrelatedCompanyExplorerFolderChanges(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-scoped-etag-unrelated-test"

	urls := []string{
		"/v1/workspace/snapshot?company_id=" + companyID + "&scope=node_map",
		"/v1/workspace/snapshot?company_id=" + companyID + "&scope=logic_gate_map",
		"/v1/workspace/snapshot?company_id=" + companyID + "&scope=kanban&board_id=board-a",
	}
	etags := make(map[string]string, len(urls))
	for _, url := range urls {
		req := httptest.NewRequest(http.MethodGet, url, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("initial snapshot %s status = %d, want %d body=%s", url, rec.Code, http.StatusOK, rec.Body.String())
		}
		etag := rec.Header().Get("ETag")
		if etag == "" {
			t.Fatalf("initial snapshot %s ETag is empty", url)
		}
		etags[url] = etag
	}

	body, _ := json.Marshal(map[string]string{
		"company_id":  companyID,
		"folder_kind": "communications",
		"name":        "Shared inbox",
	})
	createReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders", bytes.NewReader(body))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create communications folder status = %d, want %d body=%s", createRec.Code, http.StatusCreated, createRec.Body.String())
	}

	for _, url := range urls {
		req := httptest.NewRequest(http.MethodGet, url, nil)
		req.Header.Set("If-None-Match", etags[url])
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotModified {
			t.Fatalf("snapshot %s after unrelated folder status = %d, want %d body=%s", url, rec.Code, http.StatusNotModified, rec.Body.String())
		}
	}
}

func TestWorkspaceSnapshotScopesInvalidateForRelevantEvents(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-scoped-etag-relevant-test"

	nodeMapURL := "/v1/workspace/snapshot?company_id=" + companyID + "&scope=node_map"
	firstNodeReq := httptest.NewRequest(http.MethodGet, nodeMapURL, nil)
	firstNodeRec := httptest.NewRecorder()
	handler.ServeHTTP(firstNodeRec, firstNodeReq)
	if firstNodeRec.Code != http.StatusOK {
		t.Fatalf("initial node_map snapshot status = %d body=%s", firstNodeRec.Code, firstNodeRec.Body.String())
	}
	nodeMapETag := firstNodeRec.Header().Get("ETag")

	nodeBody, _ := json.Marshal(map[string]string{"company_id": companyID, "title": "Relevant node"})
	createNodeReq := httptest.NewRequest(http.MethodPost, "/v1/nodes", bytes.NewReader(nodeBody))
	createNodeReq.Header.Set("Content-Type", "application/json")
	createNodeRec := httptest.NewRecorder()
	handler.ServeHTTP(createNodeRec, createNodeReq)
	if createNodeRec.Code != http.StatusCreated {
		t.Fatalf("create node status = %d body=%s", createNodeRec.Code, createNodeRec.Body.String())
	}

	staleNodeReq := httptest.NewRequest(http.MethodGet, nodeMapURL, nil)
	staleNodeReq.Header.Set("If-None-Match", nodeMapETag)
	staleNodeRec := httptest.NewRecorder()
	handler.ServeHTTP(staleNodeRec, staleNodeReq)
	if staleNodeRec.Code != http.StatusOK {
		t.Fatalf("node_map after node create status = %d, want %d body=%s", staleNodeRec.Code, http.StatusOK, staleNodeRec.Body.String())
	}
	if staleNodeRec.Header().Get("ETag") == nodeMapETag {
		t.Fatalf("node_map ETag did not change after node create")
	}

	boardID := "board-relevant"
	if _, err := repo.CreateKanbanBoard(companyID, boardID, "Board", 1000); err != nil {
		t.Fatalf("CreateKanbanBoard() error = %v", err)
	}
	kanbanURL := "/v1/workspace/snapshot?company_id=" + companyID + "&scope=kanban&board_id=" + boardID
	firstKanbanReq := httptest.NewRequest(http.MethodGet, kanbanURL, nil)
	firstKanbanRec := httptest.NewRecorder()
	handler.ServeHTTP(firstKanbanRec, firstKanbanReq)
	if firstKanbanRec.Code != http.StatusOK {
		t.Fatalf("initial kanban snapshot status = %d body=%s", firstKanbanRec.Code, firstKanbanRec.Body.String())
	}
	kanbanETag := firstKanbanRec.Header().Get("ETag")

	columnBody, _ := json.Marshal(map[string]any{"company_id": companyID, "board_id": boardID, "title": "Todo", "position": 1000})
	createColumnReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/columns", bytes.NewReader(columnBody))
	createColumnReq.Header.Set("Content-Type", "application/json")
	createColumnRec := httptest.NewRecorder()
	handler.ServeHTTP(createColumnRec, createColumnReq)
	if createColumnRec.Code != http.StatusCreated {
		t.Fatalf("create kanban column status = %d body=%s", createColumnRec.Code, createColumnRec.Body.String())
	}

	staleKanbanReq := httptest.NewRequest(http.MethodGet, kanbanURL, nil)
	staleKanbanReq.Header.Set("If-None-Match", kanbanETag)
	staleKanbanRec := httptest.NewRecorder()
	handler.ServeHTTP(staleKanbanRec, staleKanbanReq)
	if staleKanbanRec.Code != http.StatusOK {
		t.Fatalf("kanban snapshot after column create status = %d, want %d body=%s", staleKanbanRec.Code, http.StatusOK, staleKanbanRec.Body.String())
	}
	if staleKanbanRec.Header().Get("ETag") == kanbanETag {
		t.Fatalf("kanban ETag did not change after column create")
	}
}

type countingReadVersionNodeMapWindowRepo struct {
	store.Repository
	currentReadVersionCalls    int
	currentDomainSequenceCalls int
	listNodeMapWindowCalls     int
}

func (r *countingReadVersionNodeMapWindowRepo) CurrentWorkspaceReadVersion(query store.WorkspaceReadVersionQuery) (int64, bool, error) {
	r.currentReadVersionCalls++
	return r.Repository.CurrentWorkspaceReadVersion(query)
}

func (r *countingReadVersionNodeMapWindowRepo) CurrentDomainEventSequence(query store.DomainEventStreamQuery) (int64, error) {
	r.currentDomainSequenceCalls++
	return r.Repository.CurrentDomainEventSequence(query)
}

func (r *countingReadVersionNodeMapWindowRepo) ListNodeMapWindow(query store.NodeMapWindowQuery) (store.NodeMapWindowResult, error) {
	r.listNodeMapWindowCalls++
	return r.Repository.ListNodeMapWindow(query)
}

func TestWorkspaceSnapshotNodeMapWindowConditionalGetUsesReadVersionRow(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &countingReadVersionNodeMapWindowRepo{Repository: base}
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-444444444444"

	folder, err := base.CreateCompanyExplorerFolder(companyID, "", "node", "Window")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder error = %v", err)
	}
	node, err := base.CreateNode(companyID, "Visible")
	if err != nil {
		t.Fatalf("CreateNode error = %v", err)
	}
	if _, _, err := base.AssignCompanyExplorerFolderItem(companyID, folder.FolderID, "node", node.NodeID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem error = %v", err)
	}
	if _, err := base.UpsertNodeMapPositions(companyID, []domain.NodeMapPosition{{NodeID: node.NodeID, X: 25, Y: 25}}); err != nil {
		t.Fatalf("UpsertNodeMapPositions error = %v", err)
	}
	if _, err := base.AppendDomainEvent(store.DomainEventInput{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, Type: "node_map_positions_updated"}); err != nil {
		t.Fatalf("AppendDomainEvent node_map_positions_updated: %v", err)
	}

	url := "/v1/workspace/snapshot?company_id=" + companyID + "&scope=node_map_window&folder_id=" + folder.FolderID + "&min_x=0&min_y=0&max_x=100&max_y=100"
	firstReq := httptest.NewRequest(http.MethodGet, url, nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("initial node_map_window status = %d body=%s", firstRec.Code, firstRec.Body.String())
	}
	if repo.currentReadVersionCalls == 0 {
		t.Fatal("CurrentWorkspaceReadVersion was not called")
	}
	if repo.currentDomainSequenceCalls != 0 {
		t.Fatalf("CurrentDomainEventSequence calls after read-version hit = %d, want 0", repo.currentDomainSequenceCalls)
	}
	if repo.listNodeMapWindowCalls != 1 {
		t.Fatalf("ListNodeMapWindow calls after first request = %d, want 1", repo.listNodeMapWindowCalls)
	}
	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("node_map_window ETag is empty")
	}

	secondReq := httptest.NewRequest(http.MethodGet, url, nil)
	secondReq.Header.Set("If-None-Match", etag)
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)
	if secondRec.Code != http.StatusNotModified {
		t.Fatalf("conditional node_map_window status = %d, want %d body=%s", secondRec.Code, http.StatusNotModified, secondRec.Body.String())
	}
	if repo.currentDomainSequenceCalls != 0 {
		t.Fatalf("CurrentDomainEventSequence calls after conditional read-version hit = %d, want 0", repo.currentDomainSequenceCalls)
	}
	if repo.listNodeMapWindowCalls != 1 {
		t.Fatalf("ListNodeMapWindow calls after 304 = %d, want 1", repo.listNodeMapWindowCalls)
	}
}

type countingMapLayoutWindowRepo struct {
	store.Repository
	currentDomainSequenceCalls     int
	listNodeMapPositionsCalls      int
	listLogicGateMapPositionsCalls int
}

func (r *countingMapLayoutWindowRepo) CurrentDomainEventSequence(query store.DomainEventStreamQuery) (int64, error) {
	r.currentDomainSequenceCalls++
	return r.Repository.CurrentDomainEventSequence(query)
}

func (r *countingMapLayoutWindowRepo) ListNodeMapPositionsWindow(query store.NodeMapWindowQuery) ([]domain.NodeMapPosition, error) {
	r.listNodeMapPositionsCalls++
	return r.Repository.ListNodeMapPositionsWindow(query)
}

func (r *countingMapLayoutWindowRepo) ListLogicGateMapPositionsWindow(query store.LogicGateMapWindowQuery) ([]domain.LogicGateMapPosition, error) {
	r.listLogicGateMapPositionsCalls++
	return r.Repository.ListLogicGateMapPositionsWindow(query)
}

func TestMapLayoutWindowConditionalGetsUseReadVersionRows(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &countingMapLayoutWindowRepo{Repository: base}
	server := newServerWithLegacyMapRoutesForTest(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-555555555555"

	nodeFolder, err := base.CreateCompanyExplorerFolder(companyID, "", "node", "Node Window")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder node error = %v", err)
	}
	node, err := base.CreateNode(companyID, "Visible Node")
	if err != nil {
		t.Fatalf("CreateNode error = %v", err)
	}
	if _, _, err := base.AssignCompanyExplorerFolderItem(companyID, nodeFolder.FolderID, "node", node.NodeID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem node error = %v", err)
	}
	if _, err := base.UpsertNodeMapPositions(companyID, []domain.NodeMapPosition{{NodeID: node.NodeID, X: 25, Y: 25}}); err != nil {
		t.Fatalf("UpsertNodeMapPositions error = %v", err)
	}
	if _, err := base.AppendDomainEvent(store.DomainEventInput{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, Type: "node_map_positions_updated"}); err != nil {
		t.Fatalf("AppendDomainEvent node_map_positions_updated: %v", err)
	}

	logicFolder, err := base.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Logic Window")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder logic error = %v", err)
	}
	logicGate, err := base.CreateLogicGate(companyID, "Visible Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate error = %v", err)
	}
	if _, _, err := base.AssignCompanyExplorerFolderItem(companyID, logicFolder.FolderID, "logic_gate", logicGate.LogicGateID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem logic error = %v", err)
	}
	if _, err := base.UpsertLogicGateMapPositions(companyID, []domain.LogicGateMapPosition{{LogicGateID: logicGate.LogicGateID, X: 25, Y: 25}}); err != nil {
		t.Fatalf("UpsertLogicGateMapPositions error = %v", err)
	}
	if _, err := base.AppendDomainEvent(store.DomainEventInput{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, Type: "logic_gate_map_positions_updated"}); err != nil {
		t.Fatalf("AppendDomainEvent logic_gate_map_positions_updated: %v", err)
	}

	nodeURL := "/v1/map-layout?company_id=" + companyID + "&map_type=node&folder_id=" + nodeFolder.FolderID + "&min_x=0&min_y=0&max_x=100&max_y=100"
	assertMapLayoutWindowConditionalGETSkipsPayloadForTest(t, handler, nodeURL, &repo.currentDomainSequenceCalls, func() int { return repo.listNodeMapPositionsCalls })
	if repo.listNodeMapPositionsCalls != 1 {
		t.Fatalf("ListNodeMapPositionsWindow calls = %d, want 1", repo.listNodeMapPositionsCalls)
	}

	logicURL := "/v1/map-layout?company_id=" + companyID + "&map_type=logic_gate&folder_id=" + logicFolder.FolderID + "&min_x=0&min_y=0&max_x=100&max_y=100"
	assertMapLayoutWindowConditionalGETSkipsPayloadForTest(t, handler, logicURL, &repo.currentDomainSequenceCalls, func() int { return repo.listLogicGateMapPositionsCalls })
	if repo.listLogicGateMapPositionsCalls != 1 {
		t.Fatalf("ListLogicGateMapPositionsWindow calls = %d, want 1", repo.listLogicGateMapPositionsCalls)
	}
}

func assertMapLayoutWindowConditionalGETSkipsPayloadForTest(t *testing.T, handler http.Handler, url string, domainSequenceCalls *int, payloadCalls func() int) {
	t.Helper()
	beforeDomainSequenceCalls := *domainSequenceCalls
	firstReq := httptest.NewRequest(http.MethodGet, url, nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("initial map-layout window status = %d body=%s", firstRec.Code, firstRec.Body.String())
	}
	if *domainSequenceCalls != beforeDomainSequenceCalls {
		t.Fatalf("CurrentDomainEventSequence calls after read-version hit = %d, want %d", *domainSequenceCalls, beforeDomainSequenceCalls)
	}
	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("map-layout window ETag is empty")
	}
	payloadCallsAfterFirst := payloadCalls()

	secondReq := httptest.NewRequest(http.MethodGet, url, nil)
	secondReq.Header.Set("If-None-Match", etag)
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)
	if secondRec.Code != http.StatusNotModified {
		t.Fatalf("conditional map-layout window status = %d, want %d body=%s", secondRec.Code, http.StatusNotModified, secondRec.Body.String())
	}
	if *domainSequenceCalls != beforeDomainSequenceCalls {
		t.Fatalf("CurrentDomainEventSequence calls after conditional read-version hit = %d, want %d", *domainSequenceCalls, beforeDomainSequenceCalls)
	}
	if payloadCalls() != payloadCallsAfterFirst {
		t.Fatalf("payload calls after 304 = %d, want %d", payloadCalls(), payloadCallsAfterFirst)
	}
}

type missingWorkspaceReadVersionRepo struct {
	store.Repository
	currentReadVersionCalls    int
	currentDomainSequenceCalls int
	listNodeMapWindowCalls     int
}

func (r *missingWorkspaceReadVersionRepo) CurrentWorkspaceReadVersion(query store.WorkspaceReadVersionQuery) (int64, bool, error) {
	r.currentReadVersionCalls++
	return 0, false, nil
}

func (r *missingWorkspaceReadVersionRepo) CurrentDomainEventSequence(query store.DomainEventStreamQuery) (int64, error) {
	r.currentDomainSequenceCalls++
	return r.Repository.CurrentDomainEventSequence(query)
}

func (r *missingWorkspaceReadVersionRepo) ListNodeMapWindow(query store.NodeMapWindowQuery) (store.NodeMapWindowResult, error) {
	r.listNodeMapWindowCalls++
	return r.Repository.ListNodeMapWindow(query)
}

func TestWorkspaceSnapshotMissingReadVersionRowFallsBackWithoutPayloadOn304(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &missingWorkspaceReadVersionRepo{Repository: base}
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-666666666666"

	folder, err := base.CreateCompanyExplorerFolder(companyID, "", "node", "Window")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder error = %v", err)
	}
	node, err := base.CreateNode(companyID, "Visible")
	if err != nil {
		t.Fatalf("CreateNode error = %v", err)
	}
	if _, _, err := base.AssignCompanyExplorerFolderItem(companyID, folder.FolderID, "node", node.NodeID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem error = %v", err)
	}
	if _, err := base.UpsertNodeMapPositions(companyID, []domain.NodeMapPosition{{NodeID: node.NodeID, X: 25, Y: 25}}); err != nil {
		t.Fatalf("UpsertNodeMapPositions error = %v", err)
	}

	url := "/v1/workspace/snapshot?company_id=" + companyID + "&scope=node_map_window&folder_id=" + folder.FolderID + "&min_x=0&min_y=0&max_x=100&max_y=100"
	firstReq := httptest.NewRequest(http.MethodGet, url, nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("initial node_map_window status = %d body=%s", firstRec.Code, firstRec.Body.String())
	}
	if repo.currentReadVersionCalls == 0 || repo.currentDomainSequenceCalls == 0 {
		t.Fatalf("fallback calls = read_version:%d domain_sequence:%d, want both nonzero", repo.currentReadVersionCalls, repo.currentDomainSequenceCalls)
	}
	if repo.listNodeMapWindowCalls != 1 {
		t.Fatalf("ListNodeMapWindow calls after first request = %d, want 1", repo.listNodeMapWindowCalls)
	}
	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("node_map_window ETag is empty")
	}

	secondReq := httptest.NewRequest(http.MethodGet, url, nil)
	secondReq.Header.Set("If-None-Match", etag)
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)
	if secondRec.Code != http.StatusNotModified {
		t.Fatalf("conditional node_map_window status = %d, want %d body=%s", secondRec.Code, http.StatusNotModified, secondRec.Body.String())
	}
	if repo.listNodeMapWindowCalls != 1 {
		t.Fatalf("ListNodeMapWindow calls after missing-row fallback 304 = %d, want 1", repo.listNodeMapWindowCalls)
	}
}
