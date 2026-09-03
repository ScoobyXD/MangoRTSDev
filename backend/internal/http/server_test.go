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
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

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
	if infoRec.Code != http.StatusConflict || !strings.Contains(infoRec.Body.String(), "editor_collaboration_required") {
		t.Fatalf("legacy Logic Gate information status = %d body=%s, want collaboration-required conflict", infoRec.Code, infoRec.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gates/"+firstID+"?company_id="+companyID, nil)
	getRec := httptest.NewRecorder()
	handler.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET logic gate details status = %d, want %d body=%s", getRec.Code, http.StatusOK, getRec.Body.String())
	}
	var details struct {
		Information []any `json:"information"`
	}
	if err := json.NewDecoder(getRec.Body).Decode(&details); err != nil {
		t.Fatalf("decode details: %v", err)
	}
	if len(details.Information) != 0 {
		t.Fatalf("details information count = %d, want 0", len(details.Information))
	}
}

func TestLogicGateRACIAssignmentsAPIAndReadModel(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-logic-gate-RACI-test"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)
	otherCompanyID := "company-logic-gate-RACI-other"
	repo.EnsureCompany(companyID, "RACI Test Company")
	repo.EnsureCompany(otherCompanyID, "Other Company")

	logicGate, err := repo.CreateLogicGate(companyID, "approval gate")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}
	responsible, err := repo.UpsertAuthUser("RACI-responsible", "responsible@example.com", "Responsible User")
	if err != nil {
		t.Fatalf("UpsertAuthUser responsible error = %v", err)
	}
	if _, err := repo.AddCompanyMembership("RACI-responsible", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership responsible error = %v", err)
	}
	accountable, err := repo.UpsertAuthUser("RACI-accountable", "accountable@example.com", "Accountable User")
	if err != nil {
		t.Fatalf("UpsertAuthUser accountable error = %v", err)
	}
	if _, err := repo.AddCompanyMembership("RACI-accountable", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership accountable error = %v", err)
	}
	outsider, err := repo.UpsertAuthUser("RACI-outsider", "outsider@example.com", "Outsider User")
	if err != nil {
		t.Fatalf("UpsertAuthUser outsider error = %v", err)
	}
	if _, err := repo.AddCompanyMembership("RACI-outsider", otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership outsider error = %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"company_id":      companyID,
		"assignment_mode": store.PolicyModeCustomized,
		"gvic_assignments": []map[string]string{
			{"role": domain.RACIRoleResponsible, "principal_type": store.EntityPermissionSubjectUser, "principal_id": responsible.UserID},
			{"role": domain.RACIRoleAccountable, "principal_type": store.EntityPermissionSubjectUser, "principal_id": accountable.UserID},
			{"role": domain.RACIRoleAccountable, "principal_type": store.EntityPermissionSubjectUser, "principal_id": accountable.UserID},
		},
	})
	req := httptest.NewRequest(http.MethodPut, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/gvic", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT logic gate RACI status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Assignments []domain.ResourceRACIAssignment          `json:"gvic_assignments"`
		Effective   []domain.ResourceRACIEffectiveAssignment `json:"effective_assignments"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode RACI payload: %v", err)
	}
	if len(payload.Assignments) != 2 {
		t.Fatalf("assignment count = %d, want 2", len(payload.Assignments))
	}
	if payload.Assignments[0].Role != domain.RACIRoleResponsible ||
		payload.Assignments[0].PrincipalType != store.EntityPermissionSubjectUser ||
		payload.Assignments[0].PrincipalID != responsible.UserID ||
		payload.Assignments[0].UserDisplayName != "Responsible User" {
		t.Fatalf("responsible assignment = %+v", payload.Assignments[0])
	}
	if len(payload.Effective) != 2 {
		t.Fatalf("effective assignment count = %d, want 2", len(payload.Effective))
	}

	details, err := repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails() error = %v", err)
	}
	if len(details.LogicGate.RACIAssignments) != 2 {
		t.Fatalf("details RACI assignments = %+v, want 2 assignments", details.LogicGate.RACIAssignments)
	}
	logicGates, err := repo.ListLogicGates(companyID)
	if err != nil {
		t.Fatalf("ListLogicGates() error = %v", err)
	}
	if len(logicGates) != 1 || len(logicGates[0].RACIAssignments) != 2 {
		t.Fatalf("listed logic gates = %+v, want RACI read model", logicGates)
	}
	assigned, err := repo.QueryLogicGates(companyID, store.LogicGateQuery{AssignedUserID: accountable.UserID})
	if err != nil {
		t.Fatalf("QueryLogicGates assigned error = %v", err)
	}
	if len(assigned) != 1 || assigned[0].LogicGateID != logicGate.LogicGateID || len(assigned[0].RACIAssignments) != 2 {
		t.Fatalf("assigned logic gates = %+v, want gate with RACI read model", assigned)
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
		"company_id":      companyID,
		"assignment_mode": store.PolicyModeCustomized,
		"gvic_assignments": []map[string]string{
			{"role": domain.RACIRoleConsulted, "principal_type": store.EntityPermissionSubjectUser, "principal_id": outsider.UserID},
		},
	})
	outsiderReq := httptest.NewRequest(http.MethodPut, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/gvic", bytes.NewReader(outsiderBody))
	outsiderReq.Header.Set("Content-Type", "application/json")
	outsiderRec := httptest.NewRecorder()
	handler.ServeHTTP(outsiderRec, outsiderReq)
	if outsiderRec.Code != http.StatusBadRequest || !strings.Contains(outsiderRec.Body.String(), "policy_principal_not_in_company") {
		t.Fatalf("PUT outsider RACI status = %d body=%s, want policy_principal_not_in_company", outsiderRec.Code, outsiderRec.Body.String())
	}

	legacyRoleBody, _ := json.Marshal(map[string]any{
		"company_id":      companyID,
		"assignment_mode": store.PolicyModeCustomized,
		"gvic_assignments": []map[string]string{
			{"role": "generated", "principal_type": store.EntityPermissionSubjectUser, "principal_id": responsible.UserID},
		},
	})
	legacyRoleReq := httptest.NewRequest(http.MethodPut, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/gvic", bytes.NewReader(legacyRoleBody))
	legacyRoleReq.Header.Set("Content-Type", "application/json")
	legacyRoleRec := httptest.NewRecorder()
	handler.ServeHTTP(legacyRoleRec, legacyRoleReq)
	if legacyRoleRec.Code != http.StatusBadRequest || !strings.Contains(legacyRoleRec.Body.String(), "invalid_policy") {
		t.Fatalf("PUT legacy role RACI status = %d body=%s, want invalid_policy", legacyRoleRec.Code, legacyRoleRec.Body.String())
	}
}

func TestLogicGateLegacyInformationAPIRequiresCollaboration(t *testing.T) {
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
		if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "editor_collaboration_required") {
			t.Fatalf("legacy Logic Gate information status = %d body=%s", rec.Code, rec.Body.String())
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
	if len(projectionPayload.Items) != 0 {
		t.Fatalf("projection item count = %d, want 0", len(projectionPayload.Items))
	}

	details, err := repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails() error = %v", err)
	}
	if len(details.Information) != 0 {
		t.Fatalf("logic gate information row count = %d, want 0", len(details.Information))
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

func TestNodeInformationRejectsInlineFileBytes(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-node-inline-file-guard-test"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	node, err := repo.CreateNode(companyID, "node with rejected inline file")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}

	body, _ := json.Marshal(map[string]string{
		"company_id":     companyID,
		"type":           "Text box",
		"information":    `<img src="data:image/png;base64,aGVsbG8=">`,
		"information_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST node information status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "inline_file_bytes_not_allowed") {
		t.Fatalf("response body = %s, want inline_file_bytes_not_allowed", rec.Body.String())
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
		"name":       "new title",
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
		"name":       "Creator assigned node",
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
	configured, err := repo.ListResourceRACIAssignments(companyID, store.EntityTypeNode, created.NodeID)
	if err != nil {
		t.Fatalf("ListResourceRACIAssignments() error = %v", err)
	}
	if len(configured) != 0 {
		t.Fatalf("configured node RACI = %+v, want no implicit creator source rows", configured)
	}
	effective, err := repo.ListResourceRACIEffectiveAssignments(companyID, store.EntityTypeNode, created.NodeID)
	if err != nil {
		t.Fatalf("ListResourceRACIEffectiveAssignments() error = %v", err)
	}
	if len(effective) != 0 {
		t.Fatalf("effective node RACI = %+v, want no implicit creator rows", effective)
	}
}

func TestUpdateNodeRACIResponsibleRequiresCompanyMembership(t *testing.T) {
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
		"company_id":      companyID,
		"assignment_mode": store.PolicyModeCustomized,
		"gvic_assignments": []map[string]string{{
			"role":           domain.RACIRoleResponsible,
			"principal_type": store.EntityPermissionSubjectUser,
			"principal_id":   assignee.UserID,
		}},
	})
	assignReq := httptest.NewRequest(http.MethodPut, "/v1/resources/node/"+node.NodeID+"/gvic", bytes.NewReader(assignBody))
	assignReq.Header.Set("Content-Type", "application/json")
	assignRec := httptest.NewRecorder()
	handler.ServeHTTP(assignRec, assignReq)
	if assignRec.Code != http.StatusOK {
		t.Fatalf("PUT node RACI status = %d body=%s", assignRec.Code, assignRec.Body.String())
	}
	var assigned struct {
		RACIAssignments []domain.ResourceRACIAssignment          `json:"gvic_assignments"`
		Effective       []domain.ResourceRACIEffectiveAssignment `json:"effective_assignments"`
	}
	if err := json.NewDecoder(assignRec.Body).Decode(&assigned); err != nil {
		t.Fatalf("decode assigned RACI: %v", err)
	}
	if len(assigned.RACIAssignments) != 1 ||
		assigned.RACIAssignments[0].Role != domain.RACIRoleResponsible ||
		assigned.RACIAssignments[0].PrincipalID != assignee.UserID ||
		len(assigned.Effective) != 1 ||
		assigned.Effective[0].UserID != assignee.UserID {
		t.Fatalf("assigned RACI = %+v effective=%+v, want responsible assignee", assigned.RACIAssignments, assigned.Effective)
	}

	outsiderBody, _ := json.Marshal(map[string]any{
		"company_id":      companyID,
		"assignment_mode": store.PolicyModeCustomized,
		"gvic_assignments": []map[string]string{{
			"role":           domain.RACIRoleResponsible,
			"principal_type": store.EntityPermissionSubjectUser,
			"principal_id":   outsider.UserID,
		}},
	})
	outsiderReq := httptest.NewRequest(http.MethodPut, "/v1/resources/node/"+node.NodeID+"/gvic", bytes.NewReader(outsiderBody))
	outsiderReq.Header.Set("Content-Type", "application/json")
	outsiderRec := httptest.NewRecorder()
	handler.ServeHTTP(outsiderRec, outsiderReq)
	if outsiderRec.Code != http.StatusBadRequest || !strings.Contains(outsiderRec.Body.String(), "policy_principal_not_in_company") {
		t.Fatalf("PUT outsider RACI status = %d body=%s, want policy_principal_not_in_company", outsiderRec.Code, outsiderRec.Body.String())
	}

	clearBody, _ := json.Marshal(map[string]any{
		"company_id":       companyID,
		"assignment_mode":  store.PolicyModeCustomized,
		"gvic_assignments": []map[string]string{},
	})
	clearReq := httptest.NewRequest(http.MethodPut, "/v1/resources/node/"+node.NodeID+"/gvic", bytes.NewReader(clearBody))
	clearReq.Header.Set("Content-Type", "application/json")
	clearRec := httptest.NewRecorder()
	handler.ServeHTTP(clearRec, clearReq)
	if clearRec.Code != http.StatusOK {
		t.Fatalf("PUT clear RACI status = %d body=%s", clearRec.Code, clearRec.Body.String())
	}
	var cleared struct {
		RACIAssignments []domain.ResourceRACIAssignment          `json:"gvic_assignments"`
		Effective       []domain.ResourceRACIEffectiveAssignment `json:"effective_assignments"`
	}
	if err := json.NewDecoder(clearRec.Body).Decode(&cleared); err != nil {
		t.Fatalf("decode cleared RACI: %v", err)
	}
	if len(cleared.RACIAssignments) != 0 || len(cleared.Effective) != 0 {
		t.Fatalf("cleared RACI = %+v effective=%+v, want none", cleared.RACIAssignments, cleared.Effective)
	}
}

func TestLogicGateArenaAPIsExposeAttachedBoardIssueToggleAndNodeMetadata(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{})
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
	if _, err := repo.UpdateNode(store.UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Priority: testPriority(3), PrioritySet: true}); err != nil {
		t.Fatalf("UpdateNode priority: %v", err)
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
	if !issueCard.IsIssue || issueCard.ColumnID != store.LogicGateWorkStatusInProgress {
		t.Fatalf("issue card = %+v, want issue without move", issueCard)
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
			CardID  string `json:"card_id"`
			IsIssue bool   `json:"is_issue"`
		} `json:"cards"`
	}
	if err := json.NewDecoder(arenaRec.Body).Decode(&arenaPayload); err != nil {
		t.Fatalf("decode logic gate arena: %v", err)
	}
	if arenaPayload.LogicGate.LogicGateID != logicGate.LogicGateID || arenaPayload.Board.BoardID != boardID || arenaPayload.Board.LogicGateID == nil || *arenaPayload.Board.LogicGateID != logicGate.LogicGateID {
		t.Fatalf("arena identity = %+v, want selected logic gate and attached board", arenaPayload)
	}
	if len(arenaPayload.Columns) != len(columns) || len(arenaPayload.Cards) != 1 || arenaPayload.Cards[0].CardID != createdCard.CardID || !arenaPayload.Cards[0].IsIssue {
		t.Fatalf("arena contents = %+v, want bounded composed board view", arenaPayload)
	}

	deleteBoardReq := httptest.NewRequest(http.MethodDelete, "/v1/kanban/boards/"+boardID+"?company_id="+companyID, nil)
	deleteBoardRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteBoardRec, deleteBoardReq)
	if deleteBoardRec.Code != http.StatusNotFound {
		t.Fatalf("DELETE attached board status = %d, want %d body=%s", deleteBoardRec.Code, http.StatusNotFound, deleteBoardRec.Body.String())
	}
}

type noRepairLogicGateArenaRepo struct {
	store.Repository
	hideArenaBoards  bool
	dropArenaColumns bool
	ensureCalls      int
	boardListCalls   int
	columnListCalls  int
}

func (r *noRepairLogicGateArenaRepo) EnsureLogicGateKanbanBoard(companyID, logicGateID, title string) (domain.KanbanBoard, error) {
	r.ensureCalls++
	return domain.KanbanBoard{}, fmt.Errorf("unexpected Logic Gate Arena repair for %s/%s", companyID, logicGateID)
}

func (r *noRepairLogicGateArenaRepo) ListKanbanBoards(companyID string, query store.KanbanBoardQuery) ([]domain.KanbanBoard, error) {
	r.boardListCalls++
	if r.hideArenaBoards && query.LogicGateID != "" {
		return []domain.KanbanBoard{}, nil
	}
	return r.Repository.ListKanbanBoards(companyID, query)
}

func (r *noRepairLogicGateArenaRepo) ListKanbanColumns(companyID, boardID string) ([]domain.KanbanColumn, error) {
	r.columnListCalls++
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
	if repo.boardListCalls != 0 || repo.columnListCalls != 0 {
		t.Fatalf("GET arena used legacy Kanban reads boards=%d columns=%d, want projection only", repo.boardListCalls, repo.columnListCalls)
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
	if payload.Board.BoardID != store.LogicGateKanbanBoardID(logicGate.LogicGateID) || len(payload.Columns) != 6 || payload.Columns[0].ColumnID != store.LogicGateWorkStatusRequested {
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
	if rec.Code != http.StatusOK {
		t.Fatalf("GET missing-board arena status = %d body=%s, want projected arena", rec.Code, rec.Body.String())
	}
	if repo.ensureCalls != 0 {
		t.Fatalf("GET missing-board arena called EnsureLogicGateKanbanBoard %d times, want 0", repo.ensureCalls)
	}
	if repo.boardListCalls != 0 || repo.columnListCalls != 0 {
		t.Fatalf("GET missing-board arena used legacy Kanban reads boards=%d columns=%d, want projection only", repo.boardListCalls, repo.columnListCalls)
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
	if rec.Code != http.StatusOK {
		t.Fatalf("GET missing-column arena status = %d body=%s, want projected arena", rec.Code, rec.Body.String())
	}
	if repo.ensureCalls != 0 {
		t.Fatalf("GET missing-column arena called EnsureLogicGateKanbanBoard %d times, want 0", repo.ensureCalls)
	}
	if repo.boardListCalls != 0 || repo.columnListCalls != 0 {
		t.Fatalf("GET missing-column arena used legacy Kanban reads boards=%d columns=%d, want projection only", repo.boardListCalls, repo.columnListCalls)
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

	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Work")
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
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, folder.FolderID, "logic_gate", logicGate.LogicGateID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem() error = %v", err)
	}
	if _, err := repo.CreateNodeRelationship(companyID, nodeA.NodeID, nodeB.NodeID, "Peer", "Peer"); err != nil {
		t.Fatalf("CreateNodeRelationship() error = %v", err)
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
	for _, key := range []string{"relationships", "kanban_boards"} {
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
func httpNodeIDs(items []domain.Node) []string {
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
func httpLogicGateIDs(items []domain.LogicGate) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.LogicGateID)
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

	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, nodeParent.FolderID, "node", nodeA.NodeID, 1000); !errors.Is(err, store.ErrInvalid) {
		t.Fatalf("Assign node A error = %v, want ErrInvalid", err)
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
	assertIDs("node summaries", nodeIDs)
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
	assertIDs("node folder items", folderItemIDs)

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
func TestWorkspaceEntityBatchCreatesNodesAndRelationships(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-batch-node-test"

	body := []byte(`{
		"company_id":"` + companyID + `",
		"entity_kind":"node",
		"items":[
			{"client_id":"copied-a","name":"Copied A"},
			{"client_id":"copied-b","name":"Copied B"}
		],
		"relationships":[
			{"client_id_a":"copied-a","client_id_b":"copied-b","a_position":"Peer","b_position":"Peer"}
		]
	}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/workspace/entity-batches", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST workspace/entity-batches status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var payload struct {
		EntityMappings []struct {
			ClientID string `json:"client_id"`
			EntityID string `json:"entity_id"`
		} `json:"entity_mappings"`
		Nodes []struct {
			NodeID string `json:"node_id"`
			Name   string `json:"name"`
		} `json:"nodes"`
		Relationships []struct {
			NodeIDA string `json:"node_id_a"`
			NodeIDB string `json:"node_id_b"`
		} `json:"relationships"`
		FolderItems []struct {
			FolderID string `json:"folder_id"`
			ItemType string `json:"item_type"`
			ItemID   string `json:"item_id"`
		} `json:"folder_items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode workspace entity batch response: %v", err)
	}
	if len(payload.EntityMappings) != 2 || len(payload.Nodes) != 2 || len(payload.Relationships) != 1 || len(payload.FolderItems) != 0 {
		t.Fatalf("unexpected batch response counts: mappings=%d nodes=%d relationships=%d folder_items=%d", len(payload.EntityMappings), len(payload.Nodes), len(payload.Relationships), len(payload.FolderItems))
	}
	if payload.Relationships[0].NodeIDA == "" || payload.Relationships[0].NodeIDB == "" || payload.Relationships[0].NodeIDA == payload.Relationships[0].NodeIDB {
		t.Fatalf("relationship did not resolve client ids: %+v", payload.Relationships[0])
	}
}

func TestWorkspaceEntityBatchRejectsRemovedMapCoordinates(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	body := []byte(`{
		"company_id":"company-batch-coordinate-rejection",
		"entity_kind":"node",
		"items":[{"client_id":"node-a","name":"Node A","x":120,"y":240}],
		"relationships":[]
	}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/workspace/entity-batches", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST workspace/entity-batches with retired coordinates status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}
func TestWorkspaceEntityBatchAssignsCreatedNodesToCreator(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-batch-creator-test"
	repo.EnsureCompany(companyID, "Batch Creator Company")
	creator, err := repo.UpsertAuthUser("batch-creator-subject", "batch-creator@example.com", "Batch Creator")
	if err != nil {
		t.Fatalf("UpsertAuthUser creator error = %v", err)
	}
	if _, err := repo.AddCompanyMembership("batch-creator-subject", companyID, "company_user"); err != nil {
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
			"name":      "Created child",
		}},
		"relationships": []map[string]any{{
			"entity_id_a": source.NodeID,
			"client_id_b": "created-child",
			"a_position":  "Parent",
			"b_position":  "Child",
		}},
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/workspace/entity-batches", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = requestWithActorForTest(req, creator, companyID)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST workspace/entity-batches status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var payload struct {
		Nodes         []domain.Node `json:"nodes"`
		Relationships []struct {
			NodeIDA string `json:"node_id_a"`
			NodeIDB string `json:"node_id_b"`
		} `json:"relationships"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode workspace entity batch response: %v", err)
	}
	if len(payload.Nodes) != 1 || len(payload.Relationships) != 1 {
		t.Fatalf("batch response counts: nodes=%d relationships=%d, want 1 each", len(payload.Nodes), len(payload.Relationships))
	}
	created := payload.Nodes[0]
	if payload.Relationships[0].NodeIDA != source.NodeID || payload.Relationships[0].NodeIDB != created.NodeID {
		t.Fatalf("batch relationship = %+v, want source parent to created child %s", payload.Relationships[0], created.NodeID)
	}
	configured, err := repo.ListResourceRACIAssignments(companyID, store.EntityTypeNode, created.NodeID)
	if err != nil {
		t.Fatalf("ListResourceRACIAssignments() error = %v", err)
	}
	if len(configured) != 1 ||
		configured[0].Role != domain.RACIRoleResponsible ||
		configured[0].PrincipalType != store.EntityPermissionSubjectUser ||
		configured[0].PrincipalID != creator.UserID {
		t.Fatalf("configured batch node RACI = %+v, want creator responsible source row", configured)
	}
}

func TestWorkspaceEntityBatchCreatesLogicGateWithFolder(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-batch-logic-test"
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Logic folder")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder failed: %v", err)
	}
	body := []byte(`{
		"company_id":"` + companyID + `",
		"entity_kind":"logic_gate",
		"folder_id":"` + folder.FolderID + `",
		"items":[{"client_id":"new-gate","title":"New gate","position":4242}]
	}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/workspace/entity-batches", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST workspace/entity-batches status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var payload struct {
		LogicGates []struct {
			LogicGateID string `json:"logic_gate_id"`
			Header      string `json:"header"`
		} `json:"logic_gates"`
		FolderItems []struct {
			FolderID string `json:"folder_id"`
			ItemType string `json:"item_type"`
			ItemID   string `json:"item_id"`
			Position int    `json:"position"`
		} `json:"folder_items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode workspace entity batch response: %v", err)
	}
	if len(payload.LogicGates) != 1 || len(payload.FolderItems) != 1 {
		t.Fatalf("unexpected logic batch response counts: gates=%d folder_items=%d", len(payload.LogicGates), len(payload.FolderItems))
	}
	createdID := payload.LogicGates[0].LogicGateID
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
	if len(arenaPayload.Columns) != 6 || arenaPayload.Columns[0].ColumnID != store.LogicGateWorkStatusRequested {
		t.Fatalf("arena columns = %d, want default columns", len(arenaPayload.Columns))
	}
}

func TestWorkspaceEntityBatchAssignsCreatedLogicGateRACIToCreator(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-batch-logic-RACI-test"
	repo.EnsureCompany(companyID, "Batch Logic RACI Company")
	creator, err := repo.UpsertAuthUser("batch-RACI-creator", "RACI-creator@example.com", "RACI Creator")
	if err != nil {
		t.Fatalf("UpsertAuthUser creator error = %v", err)
	}
	if _, err := repo.AddCompanyMembership("batch-RACI-creator", companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership creator error = %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"company_id":                   companyID,
		"entity_kind":                  "logic_gate",
		"creator_logic_gate_gvic_role": "responsible",
		"items": []map[string]any{{
			"client_id": "created-gate",
			"title":     "Created gate",
		}},
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/workspace/entity-batches", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = requestWithActorForTest(req, creator, companyID)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST workspace/entity-batches status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var payload struct {
		LogicGates  []domain.LogicGate                 `json:"logic_gates"`
		FolderItems []domain.CompanyExplorerFolderItem `json:"folder_items"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode workspace entity batch response: %v", err)
	}
	if len(payload.LogicGates) != 1 {
		t.Fatalf("logic gates = %d, want 1", len(payload.LogicGates))
	}
	if len(payload.FolderItems) != 0 {
		t.Fatalf("logic gate folder items = %+v, want none without explicit folder", payload.FolderItems)
	}
	assignments := payload.LogicGates[0].RACIAssignments
	if len(assignments) != 1 || assignments[0].Role != domain.RACIRoleResponsible || assignments[0].UserID != creator.UserID {
		t.Fatalf("response RACI assignments = %+v, want responsible creator", assignments)
	}
	if assignments[0].UserDisplayName != "RACI Creator" || assignments[0].UserEmail != "raci-creator@example.com" {
		t.Fatalf("response RACI user read model = %+v, want creator display fields", assignments[0])
	}
	stored, err := repo.GetLogicGate(companyID, payload.LogicGates[0].LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGate error = %v", err)
	}
	if len(stored.RACIAssignments) != 1 || stored.RACIAssignments[0].Role != domain.RACIRoleResponsible || stored.RACIAssignments[0].UserID != creator.UserID {
		t.Fatalf("stored RACI assignments = %+v, want responsible creator only", stored.RACIAssignments)
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
	req := httptest.NewRequest(http.MethodPost, "/v1/nodes", strings.NewReader(`{"company_id":"company","name":"`+strings.Repeat("x", 64)+`"}`))
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
	companyID := "company-scoped-etag-unrelated-test"
	repo.EnsureCompany(companyID, "Scoped ETag Unrelated")
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)
	logicGate, err := repo.CreateLogicGate(companyID, "Snapshot gate")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}
	boardID := store.LogicGateKanbanBoardID(logicGate.LogicGateID)
	url := "/v1/workspace/snapshot?company_id=" + companyID + "&scope=kanban&board_id=" + boardID
	firstReq := httptest.NewRequest(http.MethodGet, url, nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("initial snapshot status = %d body=%s", firstRec.Code, firstRec.Body.String())
	}
	etag := firstRec.Header().Get("ETag")
	createBody := []byte(`{"company_id":"` + companyID + `","folder_kind":"communications","name":"Unrelated"}`)
	createReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders", bytes.NewReader(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create communications folder status = %d body=%s", createRec.Code, createRec.Body.String())
	}
	secondReq := httptest.NewRequest(http.MethodGet, url, nil)
	secondReq.Header.Set("If-None-Match", etag)
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)
	if secondRec.Code != http.StatusNotModified {
		t.Fatalf("snapshot after unrelated folder status = %d body=%s", secondRec.Code, secondRec.Body.String())
	}
}

func TestKanbanWorkspaceSnapshotScopeInvalidatesForRelevantEvents(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "company-scoped-etag-relevant-test"
	admin, err := repo.UpsertAuthUser("etag-admin", "etag-admin@example.com", "ETag Admin")
	if err != nil {
		t.Fatalf("UpsertAuthUser admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership("etag-admin", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership admin: %v", err)
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.Routes().ServeHTTP(w, requestWithActorForTest(r, admin, companyID))
	})
	logicGate, err := repo.CreateLogicGate(companyID, "Relevant gate")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}
	boardID := store.LogicGateKanbanBoardID(logicGate.LogicGateID)
	kanbanNode, err := repo.CreateNode(companyID, "Relevant kanban node")
	if err != nil {
		t.Fatalf("CreateNode kanban error = %v", err)
	}
	url := "/v1/workspace/snapshot?company_id=" + companyID + "&scope=kanban&board_id=" + boardID
	firstReq := httptest.NewRequest(http.MethodGet, url, nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("initial kanban snapshot status = %d body=%s", firstRec.Code, firstRec.Body.String())
	}
	etag := firstRec.Header().Get("ETag")
	cardBody, _ := json.Marshal(map[string]any{"company_id": companyID, "board_id": boardID, "column_id": store.LogicGateWorkStatusPending, "node_id": kanbanNode.NodeID, "node_title": kanbanNode.Title, "priority": 3})
	createReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(cardBody))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create kanban card status = %d body=%s", createRec.Code, createRec.Body.String())
	}
	secondReq := httptest.NewRequest(http.MethodGet, url, nil)
	secondReq.Header.Set("If-None-Match", etag)
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)
	if secondRec.Code != http.StatusOK || secondRec.Header().Get("ETag") == etag {
		t.Fatalf("kanban snapshot did not invalidate: status=%d etag=%q", secondRec.Code, secondRec.Header().Get("ETag"))
	}
}

type missingWorkspaceReadVersionRepo struct {
	store.Repository
	currentReadVersionCalls    int
	currentDomainSequenceCalls int
}

func (r *missingWorkspaceReadVersionRepo) CurrentWorkspaceReadVersion(query store.WorkspaceReadVersionQuery) (int64, bool, error) {
	r.currentReadVersionCalls++
	return 0, false, nil
}

func (r *missingWorkspaceReadVersionRepo) CurrentDomainEventSequence(query store.DomainEventStreamQuery) (int64, error) {
	r.currentDomainSequenceCalls++
	return r.Repository.CurrentDomainEventSequence(query)
}

func TestWorkspaceSnapshotMissingReadVersionRowFallsBackWithoutPayloadOn304(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &missingWorkspaceReadVersionRepo{Repository: base}
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-666666666666"
	base.EnsureCompany(companyID, "Read Version Company")
	if _, err := base.CreateNode(companyID, "Visible"); err != nil {
		t.Fatalf("CreateNode error = %v", err)
	}
	url := "/v1/workspace/snapshot?company_id=" + companyID + "&scope=company_explorer"
	firstReq := httptest.NewRequest(http.MethodGet, url, nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("initial snapshot status = %d body=%s", firstRec.Code, firstRec.Body.String())
	}
	if repo.currentReadVersionCalls == 0 || repo.currentDomainSequenceCalls == 0 {
		t.Fatalf("fallback calls = read_version:%d domain_sequence:%d, want both nonzero", repo.currentReadVersionCalls, repo.currentDomainSequenceCalls)
	}
	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("snapshot ETag is empty")
	}
	secondReq := httptest.NewRequest(http.MethodGet, url, nil)
	secondReq.Header.Set("If-None-Match", etag)
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)
	if secondRec.Code != http.StatusNotModified {
		t.Fatalf("conditional snapshot status = %d, want %d body=%s", secondRec.Code, http.StatusNotModified, secondRec.Body.String())
	}
}
