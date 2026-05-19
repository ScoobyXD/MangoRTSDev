package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestWorkItemInboxReadEndpointValidation(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "11111111-1111-4111-8111-333333333333"
	userID := "22222222-2222-4222-8222-444444444444"

	cases := []struct {
		name string
		path string
	}{
		{name: "missing company", path: "/v1/work-items/responsible-inbox?user_id=" + userID},
		{name: "invalid company", path: "/v1/work-items/responsible-inbox?company_id=not-a-uuid&user_id=" + userID},
		{name: "missing user", path: "/v1/work-items/responsible-inbox?company_id=" + companyID},
		{name: "invalid user", path: "/v1/work-items/responsible-inbox?company_id=" + companyID + "&user_id=not-a-uuid"},
		{name: "invalid limit", path: "/v1/work-items/aci-inbox?company_id=" + companyID + "&user_id=" + userID + "&limit=0"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}

	methodRec := httptest.NewRecorder()
	methodReq := httptest.NewRequest(http.MethodPost, "/v1/work-items/my-nodes?company_id="+companyID+"&user_id="+userID, nil)
	handler.ServeHTTP(methodRec, methodReq)
	if methodRec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST my-nodes status = %d, want %d", methodRec.Code, http.StatusMethodNotAllowed)
	}
}

func TestWorkItemInboxReadEndpointsReturnContracts(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-555555555555"
	repo.EnsureCompany(companyID, "Inbox Read API Company")
	user, err := repo.UpsertAuthUser("read-api-user", "read-api@example.com", "Read API User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("read-api-user", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	responsibleGate, err := repo.CreateLogicGate(companyID, "Responsible API Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate responsible: %v", err)
	}
	aciGate, err := repo.CreateLogicGate(companyID, "ACI API Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate aci: %v", err)
	}
	if _, err := repo.SetLogicGateRaciAssignments(store.LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: responsibleGate.LogicGateID,
		Assignments: []store.LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleResponsible, UserID: user.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments responsible: %v", err)
	}
	if _, err := repo.SetLogicGateRaciAssignments(store.LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: aciGate.LogicGateID,
		Assignments: []store.LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleAccountable, UserID: user.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments aci: %v", err)
	}
	node, err := repo.CreateNodeWithAssignee(companyID, "Read API node", user.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: aciGate.LogicGateID, NodeID: node.NodeID, Status: "done"}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	handler := NewServer(repo).Routes()
	baseQuery := "company_id=" + companyID + "&user_id=" + user.UserID

	responsibleRec := getWorkItemInboxRead(t, handler, "/v1/work-items/responsible-inbox?"+baseQuery+"&limit=1")
	var responsiblePayload struct {
		CompanyID string        `json:"company_id"`
		UserID    string        `json:"user_id"`
		Limit     int           `json:"limit"`
		Nodes     []domain.Node `json:"nodes"`
	}
	decodeWorkItemInboxReadPayload(t, responsibleRec, &responsiblePayload)
	if responsiblePayload.CompanyID != companyID || responsiblePayload.UserID != user.UserID || responsiblePayload.Limit != 1 {
		t.Fatalf("responsible metadata = %+v", responsiblePayload)
	}
	if len(responsiblePayload.Nodes) != 1 || responsiblePayload.Nodes[0].Status == nil || *responsiblePayload.Nodes[0].Status != "Done" {
		t.Fatalf("responsible nodes = %+v, want one card-derived Done node", responsiblePayload.Nodes)
	}
	if len(responsiblePayload.Nodes[0].LogicGateIDs) != 1 || responsiblePayload.Nodes[0].LogicGateIDs[0] != aciGate.LogicGateID {
		t.Fatalf("responsible node logic_gate_ids = %+v, want %q", responsiblePayload.Nodes[0].LogicGateIDs, aciGate.LogicGateID)
	}

	myNodesRec := getWorkItemInboxRead(t, handler, "/v1/work-items/my-nodes?"+baseQuery)
	var myNodesPayload struct {
		Nodes []domain.Node `json:"nodes"`
	}
	decodeWorkItemInboxReadPayload(t, myNodesRec, &myNodesPayload)
	if len(myNodesPayload.Nodes) != 1 || myNodesPayload.Nodes[0].NodeID != node.NodeID {
		t.Fatalf("my nodes = %+v, want assigned node", myNodesPayload.Nodes)
	}

	aciRec := getWorkItemInboxRead(t, handler, "/v1/work-items/aci-inbox?"+baseQuery)
	var aciPayload struct {
		LogicGates []store.WorkItemLogicGateInboxItem `json:"logic_gates"`
	}
	decodeWorkItemInboxReadPayload(t, aciRec, &aciPayload)
	if len(aciPayload.LogicGates) != 1 || aciPayload.LogicGates[0].LogicGateID != aciGate.LogicGateID || !inboxReadHTTPRolesContain(aciPayload.LogicGates[0].Roles, domain.LogicGateRaciRoleAccountable) {
		t.Fatalf("ACI payload = %+v, want accountable gate only", aciPayload.LogicGates)
	}

	myGatesRec := getWorkItemInboxRead(t, handler, "/v1/work-items/my-logic-gates?"+baseQuery)
	var myGatesPayload struct {
		LogicGates []store.WorkItemLogicGateInboxItem `json:"logic_gates"`
	}
	decodeWorkItemInboxReadPayload(t, myGatesRec, &myGatesPayload)
	if len(myGatesPayload.LogicGates) != 2 {
		t.Fatalf("my logic gates = %+v, want responsible and accountable gates", myGatesPayload.LogicGates)
	}
	if !inboxReadHTTPPayloadHasGateRole(myGatesPayload.LogicGates, responsibleGate.LogicGateID, domain.LogicGateRaciRoleResponsible) {
		t.Fatalf("my logic gates missing responsible role: %+v", myGatesPayload.LogicGates)
	}
	if !inboxReadHTTPPayloadHasGateRole(myGatesPayload.LogicGates, aciGate.LogicGateID, domain.LogicGateRaciRoleAccountable) {
		t.Fatalf("my logic gates missing accountable role: %+v", myGatesPayload.LogicGates)
	}
}

func getWorkItemInboxRead(t *testing.T, handler http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s status = %d, want %d body=%s", path, rec.Code, http.StatusOK, rec.Body.String())
	}
	return rec
}

func decodeWorkItemInboxReadPayload(t *testing.T, rec *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.NewDecoder(rec.Body).Decode(target); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}

func inboxReadHTTPPayloadHasGateRole(items []store.WorkItemLogicGateInboxItem, logicGateID string, role string) bool {
	for _, item := range items {
		if item.LogicGateID == logicGateID && inboxReadHTTPRolesContain(item.Roles, role) {
			return true
		}
	}
	return false
}

func inboxReadHTTPRolesContain(roles []string, role string) bool {
	for _, candidate := range roles {
		if candidate == role {
			return true
		}
	}
	return false
}
