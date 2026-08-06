package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestWorkItemInboxReadEndpointValidation(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "11111111-1111-4111-8111-333333333333"
	userID := "22222222-2222-4222-8222-444444444444"
	otherUserID := "33333333-3333-4333-8333-555555555555"

	cases := []struct {
		name string
		path string
	}{
		{name: "missing company", path: "/v1/work-items/generated-inbox"},
		{name: "invalid company", path: "/v1/work-items/generated-inbox?company_id=not-a-uuid"},
		{name: "invalid user", path: "/v1/work-items/generated-inbox?company_id=" + companyID + "&user_id=not-a-uuid"},
		{name: "conflicting user aliases", path: "/v1/work-items/generated-inbox?company_id=" + companyID + "&user_id=" + userID + "&target_user_id=" + otherUserID},
		{name: "invalid limit", path: "/v1/work-items/gvic-inbox?company_id=" + companyID + "&limit=0"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			req = workItemInboxReadRequestWithActor(req, userID, companyID, domain.RoleCompanyUser, false)
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}

	unauthenticatedRec := httptest.NewRecorder()
	unauthenticatedReq := httptest.NewRequest(http.MethodGet, "/v1/work-items/my-nodes?company_id="+companyID, nil)
	handler.ServeHTTP(unauthenticatedRec, unauthenticatedReq)
	if unauthenticatedRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, want %d body=%s", unauthenticatedRec.Code, http.StatusUnauthorized, unauthenticatedRec.Body.String())
	}

	methodRec := httptest.NewRecorder()
	methodReq := httptest.NewRequest(http.MethodPost, "/v1/work-items/my-nodes?company_id="+companyID, nil)
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
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: responsibleGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: user.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments responsible: %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: aciGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{Role: domain.GVICRoleVerified, UserID: user.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments aci: %v", err)
	}
	aciNode, err := repo.CreateNode(companyID, "Read API ACI node")
	if err != nil {
		t.Fatalf("CreateNode aci: %v", err)
	}
	standaloneNode, err := repo.CreateNode(companyID, "Read API standalone node")
	if err != nil {
		t.Fatalf("CreateNode standalone: %v", err)
	}
	mustSetWorkItemReadNodeGVIC(t, repo, companyID, standaloneNode.NodeID, user.UserID)
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: aciGate.LogicGateID, NodeID: aciNode.NodeID, Status: "done", Priority: testPriority(2), PrioritySet: true}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus aci: %v", err)
	}
	responsibleNode, err := repo.CreateNode(companyID, "Read API responsible node")
	if err != nil {
		t.Fatalf("CreateNode responsible: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: responsibleGate.LogicGateID, NodeID: responsibleNode.NodeID, Status: "in progress", Priority: testPriority(4), PrioritySet: true}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus responsible: %v", err)
	}
	handler := NewServer(repo).Routes()
	baseQuery := "company_id=" + companyID

	responsibleRec := getWorkItemInboxRead(t, handler, "/v1/work-items/generated-inbox?"+baseQuery+"&limit=1", user.UserID, companyID, domain.RoleCompanyUser)
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
	if len(responsiblePayload.Nodes) != 1 || responsiblePayload.Nodes[0].NodeID != responsibleNode.NodeID || responsiblePayload.Nodes[0].Status == nil || *responsiblePayload.Nodes[0].Status != "In Progress" {
		t.Fatalf("responsible nodes = %+v, want one Responsible Logic Gate node", responsiblePayload.Nodes)
	}
	if len(responsiblePayload.Nodes[0].LogicGateIDs) != 1 || responsiblePayload.Nodes[0].LogicGateIDs[0] != responsibleGate.LogicGateID {
		t.Fatalf("responsible node logic_gate_ids = %+v, want %q", responsiblePayload.Nodes[0].LogicGateIDs, responsibleGate.LogicGateID)
	}

	myNodesRec := getWorkItemInboxRead(t, handler, "/v1/work-items/my-nodes?"+baseQuery, user.UserID, companyID, domain.RoleCompanyUser)
	var myNodesPayload struct {
		Nodes []domain.Node `json:"nodes"`
	}
	decodeWorkItemInboxReadPayload(t, myNodesRec, &myNodesPayload)
	if len(myNodesPayload.Nodes) != 1 || myNodesPayload.Nodes[0].NodeID != standaloneNode.NodeID {
		t.Fatalf("my nodes = %+v, want standalone assigned node %s", myNodesPayload.Nodes, standaloneNode.NodeID)
	}

	aciRec := getWorkItemInboxRead(t, handler, "/v1/work-items/gvic-inbox?"+baseQuery, user.UserID, companyID, domain.RoleCompanyUser)
	var aciPayload struct {
		LogicGates []store.WorkItemLogicGateInboxItem `json:"logic_gates"`
	}
	decodeWorkItemInboxReadPayload(t, aciRec, &aciPayload)
	if len(aciPayload.LogicGates) != 1 || aciPayload.LogicGates[0].LogicGateID != aciGate.LogicGateID || !inboxReadHTTPRolesContain(aciPayload.LogicGates[0].Roles, domain.GVICRoleVerified) {
		t.Fatalf("ACI payload = %+v, want accountable gate only", aciPayload.LogicGates)
	}

	myGatesRec := getWorkItemInboxRead(t, handler, "/v1/work-items/my-logic-gates?"+baseQuery, user.UserID, companyID, domain.RoleCompanyUser)
	var myGatesPayload struct {
		LogicGates []store.WorkItemLogicGateInboxItem `json:"logic_gates"`
	}
	decodeWorkItemInboxReadPayload(t, myGatesRec, &myGatesPayload)
	if len(myGatesPayload.LogicGates) != 2 {
		t.Fatalf("my logic gates = %+v, want responsible and accountable gates", myGatesPayload.LogicGates)
	}
	if !inboxReadHTTPPayloadHasGateRole(myGatesPayload.LogicGates, responsibleGate.LogicGateID, domain.GVICRoleGenerated) {
		t.Fatalf("my logic gates missing responsible role: %+v", myGatesPayload.LogicGates)
	}
	if !inboxReadHTTPPayloadHasGateRole(myGatesPayload.LogicGates, aciGate.LogicGateID, domain.GVICRoleVerified) {
		t.Fatalf("my logic gates missing accountable role: %+v", myGatesPayload.LogicGates)
	}

	myWorkRec := getWorkItemInboxRead(t, handler, "/v1/work-items/my-work-matrix?"+baseQuery, user.UserID, companyID, domain.RoleCompanyUser)
	var myWorkPayload struct {
		CompanyID string                          `json:"company_id"`
		UserID    string                          `json:"user_id"`
		Rows      []store.GVICMatrixProjectionRow `json:"rows"`
	}
	decodeWorkItemInboxReadPayload(t, myWorkRec, &myWorkPayload)
	if myWorkPayload.CompanyID != companyID || myWorkPayload.UserID != user.UserID {
		t.Fatalf("my work metadata = %+v", myWorkPayload)
	}
	if !inboxReadHTTPMyWorkHasNode(myWorkPayload.Rows, responsibleNode.NodeID, domain.GVICRoleGenerated) {
		t.Fatalf("my work rows missing generated node %s: %+v", responsibleNode.NodeID, myWorkPayload.Rows)
	}
}

func TestMyWorkMatrixNodeMoveUpdatesRolePriorityAndPreservesLogicGate(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-565656565656"
	repo.EnsureCompany(companyID, "My Work Move Company")
	user, err := repo.UpsertAuthUser("my-work-move-user", "my-work-move@example.com", "My Work Move User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("my-work-move-user", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "My Work Move Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: user.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Move me from generated to consulted")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    testPriority(1),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	handler := NewServer(repo).Routes()
	rec := postMyWorkMatrixMoveJSON(t, handler, node.NodeID, user.UserID, companyID, domain.RoleCompanyAdmin, map[string]any{
		"company_id":         companyID,
		"target_user_id":     user.UserID,
		"target_gvic_role":   domain.GVICRoleConsulted,
		"logic_gate_id":      logicGate.LogicGateID,
		"from_logic_gate_id": logicGate.LogicGateID,
		"priority":           3,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("move status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload struct {
		Node                    domain.Node                     `json:"node"`
		Rows                    []store.GVICMatrixProjectionRow `json:"gvic_projection_rows"`
		RemovedProjectionRowIDs []string                        `json:"removed_projection_row_ids"`
	}
	decodeWorkItemInboxReadPayload(t, rec, &payload)
	if payload.Node.Priority == nil || *payload.Node.Priority != 3 {
		t.Fatalf("node priority = %+v, want 3", payload.Node.Priority)
	}
	if len(payload.Node.LogicGateIDs) != 1 || payload.Node.LogicGateIDs[0] != logicGate.LogicGateID {
		t.Fatalf("node logic_gate_ids = %+v, want preserved gate %s", payload.Node.LogicGateIDs, logicGate.LogicGateID)
	}
	if !inboxReadHTTPMyWorkHasNode(payload.Rows, node.NodeID, domain.GVICRoleConsulted) {
		t.Fatalf("response rows missing consulted node: %+v", payload.Rows)
	}
	if inboxReadHTTPMyWorkHasNode(payload.Rows, node.NodeID, domain.GVICRoleGenerated) {
		t.Fatalf("response rows still include generated node: %+v", payload.Rows)
	}
	if len(payload.RemovedProjectionRowIDs) == 0 {
		t.Fatalf("removed projection row IDs empty, want old generated row removed")
	}

	myWorkRec := getWorkItemInboxRead(t, handler, "/v1/work-items/my-work-matrix?company_id="+companyID, user.UserID, companyID, domain.RoleCompanyAdmin)
	var myWorkPayload struct {
		Rows []store.GVICMatrixProjectionRow `json:"rows"`
	}
	decodeWorkItemInboxReadPayload(t, myWorkRec, &myWorkPayload)
	if !inboxReadHTTPMyWorkHasNode(myWorkPayload.Rows, node.NodeID, domain.GVICRoleConsulted) {
		t.Fatalf("my work rows missing consulted node after move: %+v", myWorkPayload.Rows)
	}
	if inboxReadHTTPMyWorkHasNode(myWorkPayload.Rows, node.NodeID, domain.GVICRoleGenerated) {
		t.Fatalf("my work rows still include generated node after move: %+v", myWorkPayload.Rows)
	}
	assignments, err := repo.ListNodeLogicGateAssignments(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeLogicGateAssignments: %v", err)
	}
	if len(assignments) != 1 || assignments[0].LogicGateID != logicGate.LogicGateID {
		t.Fatalf("logic gate assignments = %+v, want preserved gate", assignments)
	}
}

func TestWorkItemMyWorkMatrixLogsRepoError(t *testing.T) {
	companyID := "11111111-1111-4111-8111-999999999999"
	userID := "22222222-2222-4222-8222-999999999999"
	repoErr := errors.New("ERROR: for SELECT DISTINCT, ORDER BY expressions must appear in select list (SQLSTATE 42P10)")
	repo := myWorkMatrixErrorRepo{Repository: store.NewMemoryRepo(), err: repoErr}
	handler := NewServer(repo).Routes()

	var logs bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&logs)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/work-items/my-work-matrix?company_id="+companyID, nil)
	req = workItemInboxReadRequestWithActor(req, userID, companyID, domain.RoleCompanyUser, false)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "failed_to_list_my_work_matrix") {
		t.Fatalf("response body = %s, want public error code", body)
	}
	if strings.Contains(body, "SQLSTATE") {
		t.Fatalf("response body leaked backend error: %s", body)
	}
	logged := logs.String()
	for _, needle := range []string{
		"failed_to_list_my_work_matrix",
		"user_id=" + userID,
		"viewer_user_id=" + userID,
		"company_id=" + companyID,
		"SQLSTATE 42P10",
	} {
		if !strings.Contains(logged, needle) {
			t.Fatalf("log output missing %q: %s", needle, logged)
		}
	}
}

func TestWorkItemInboxReadUsesAuthenticatedActorUserID(t *testing.T) {
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-888888888888"
	repo.EnsureCompany(companyID, "Authenticated Inbox Read Company")
	actor, err := repo.UpsertAuthUser("work-item-read-actor", "actor@example.com", "Actor")
	if err != nil {
		t.Fatalf("UpsertAuthUser actor: %v", err)
	}
	other, err := repo.UpsertAuthUser("work-item-read-other", "other@example.com", "Other")
	if err != nil {
		t.Fatalf("UpsertAuthUser other: %v", err)
	}
	admin, err := repo.UpsertAuthUser("work-item-read-admin", "admin@example.com", "Admin")
	if err != nil {
		t.Fatalf("UpsertAuthUser admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership actor: %v", err)
	}
	if _, err := repo.AddCompanyMembership(other.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership other: %v", err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership admin: %v", err)
	}
	ownNode, err := repo.CreateNode(companyID, "Actor assigned node")
	if err != nil {
		t.Fatalf("CreateNode actor: %v", err)
	}
	mustSetWorkItemReadNodeGVIC(t, repo, companyID, ownNode.NodeID, actor.UserID)
	otherNode, err := repo.CreateNode(companyID, "Other assigned node")
	if err != nil {
		t.Fatalf("CreateNode other: %v", err)
	}
	mustSetWorkItemReadNodeGVIC(t, repo, companyID, otherNode.NodeID, other.UserID)

	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key)}).Routes()
	actorToken := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)
	adminToken := "Bearer " + testJWT(t, key, "kid", admin.CognitoSubject, admin.Email)

	ownReq := httptest.NewRequest(http.MethodGet, "/v1/work-items/my-nodes?company_id="+companyID, nil)
	ownReq.Header.Set("Authorization", actorToken)
	ownRec := httptest.NewRecorder()
	handler.ServeHTTP(ownRec, ownReq)
	if ownRec.Code != http.StatusOK {
		t.Fatalf("own inbox status = %d, want %d body=%s", ownRec.Code, http.StatusOK, ownRec.Body.String())
	}
	var ownPayload struct {
		UserID string        `json:"user_id"`
		Nodes  []domain.Node `json:"nodes"`
	}
	decodeWorkItemInboxReadPayload(t, ownRec, &ownPayload)
	if ownPayload.UserID != actor.UserID || !inboxReadHTTPNodesExactly(ownPayload.Nodes, ownNode.NodeID) {
		t.Fatalf("own inbox payload = %+v, want only actor node %s", ownPayload, ownNode.NodeID)
	}

	spoofReq := httptest.NewRequest(http.MethodGet, "/v1/work-items/my-nodes?company_id="+companyID+"&user_id="+other.UserID, nil)
	spoofReq.Header.Set("Authorization", actorToken)
	spoofRec := httptest.NewRecorder()
	handler.ServeHTTP(spoofRec, spoofReq)
	if spoofRec.Code != http.StatusForbidden {
		t.Fatalf("spoofed user_id status = %d, want %d body=%s", spoofRec.Code, http.StatusForbidden, spoofRec.Body.String())
	}

	targetReq := httptest.NewRequest(http.MethodGet, "/v1/work-items/my-nodes?company_id="+companyID+"&target_user_id="+other.UserID, nil)
	targetReq.Header.Set("Authorization", actorToken)
	targetRec := httptest.NewRecorder()
	handler.ServeHTTP(targetRec, targetReq)
	if targetRec.Code != http.StatusOK {
		t.Fatalf("target user status = %d, want %d body=%s", targetRec.Code, http.StatusOK, targetRec.Body.String())
	}
	var targetPayload struct {
		UserID string        `json:"user_id"`
		Nodes  []domain.Node `json:"nodes"`
	}
	decodeWorkItemInboxReadPayload(t, targetRec, &targetPayload)
	if targetPayload.UserID != other.UserID || !inboxReadHTTPNodesExactly(targetPayload.Nodes, otherNode.NodeID) {
		t.Fatalf("target user payload = %+v, want only target node %s", targetPayload, otherNode.NodeID)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         otherNode.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions hidden other node: %v", err)
	}
	hiddenTargetReq := httptest.NewRequest(http.MethodGet, "/v1/work-items/my-nodes?company_id="+companyID+"&target_user_id="+other.UserID, nil)
	hiddenTargetReq.Header.Set("Authorization", actorToken)
	hiddenTargetRec := httptest.NewRecorder()
	handler.ServeHTTP(hiddenTargetRec, hiddenTargetReq)
	if hiddenTargetRec.Code != http.StatusOK {
		t.Fatalf("hidden target user status = %d, want %d body=%s", hiddenTargetRec.Code, http.StatusOK, hiddenTargetRec.Body.String())
	}
	var hiddenTargetPayload struct {
		Nodes []domain.Node `json:"nodes"`
	}
	decodeWorkItemInboxReadPayload(t, hiddenTargetRec, &hiddenTargetPayload)
	if len(hiddenTargetPayload.Nodes) != 0 {
		t.Fatalf("hidden target user payload = %+v, want inaccessible target node filtered", hiddenTargetPayload.Nodes)
	}

	adminReq := httptest.NewRequest(http.MethodGet, "/v1/work-items/my-nodes?company_id="+companyID+"&target_user_id="+other.UserID, nil)
	adminReq.Header.Set("Authorization", adminToken)
	adminRec := httptest.NewRecorder()
	handler.ServeHTTP(adminRec, adminReq)
	if adminRec.Code != http.StatusOK {
		t.Fatalf("admin cross-user status = %d, want %d body=%s", adminRec.Code, http.StatusOK, adminRec.Body.String())
	}
	var adminPayload struct {
		UserID string        `json:"user_id"`
		Nodes  []domain.Node `json:"nodes"`
	}
	decodeWorkItemInboxReadPayload(t, adminRec, &adminPayload)
	if adminPayload.UserID != other.UserID || !inboxReadHTTPNodesExactly(adminPayload.Nodes, otherNode.NodeID) {
		t.Fatalf("admin cross-user payload = %+v, want only target node %s", adminPayload, otherNode.NodeID)
	}
}

func TestWorkItemInboxReadHandlersUseRequestContext(t *testing.T) {
	companyID := "11111111-1111-4111-8111-666666666666"
	userID := "22222222-2222-4222-8222-666666666666"
	requestValue := "request-context"
	cases := []struct {
		name string
		path string
		want string
	}{
		{name: "responsible inbox", path: "/v1/work-items/generated-inbox", want: "responsible"},
		{name: "aci inbox", path: "/v1/work-items/gvic-inbox", want: "aci"},
		{name: "my nodes", path: "/v1/work-items/my-nodes", want: "my_nodes"},
		{name: "my logic gates", path: "/v1/work-items/my-logic-gates", want: "my_logic_gates"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &contextRecordingWorkItemReadRepo{Repository: store.NewMemoryRepo(), requestValue: requestValue}
			handler := NewServer(repo).Routes()
			ctx := context.WithValue(context.Background(), workItemReadRequestContextKey{}, requestValue)
			ctx = context.WithValue(ctx, actorContextKey{}, workItemInboxReadActorContext(userID, companyID, domain.RoleCompanyUser, false))
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, tc.path+"?company_id="+companyID, nil).WithContext(ctx)

			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
			}
			if repo.called != tc.want {
				t.Fatalf("called = %q, want %q", repo.called, tc.want)
			}
			if !repo.sawRequestValue {
				t.Fatal("repository did not see the request context value")
			}
			if repo.legacyCalled {
				t.Fatal("handler called legacy no-context repository method")
			}
		})
	}
}

func TestWorkItemInboxReadHandlerPreservesCancelledRequestContext(t *testing.T) {
	companyID := "11111111-1111-4111-8111-777777777777"
	userID := "22222222-2222-4222-8222-777777777777"
	requestValue := "cancelled-request-context"
	repo := &contextRecordingWorkItemReadRepo{Repository: store.NewMemoryRepo(), requestValue: requestValue}
	handler := NewServer(repo).Routes()
	ctx := context.WithValue(context.Background(), workItemReadRequestContextKey{}, requestValue)
	ctx = context.WithValue(ctx, actorContextKey{}, workItemInboxReadActorContext(userID, companyID, domain.RoleCompanyUser, false))
	ctx, cancel := context.WithCancel(ctx)
	cancel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/work-items/generated-inbox?company_id="+companyID, nil).WithContext(ctx)

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
	if repo.called != "responsible" {
		t.Fatalf("called = %q, want responsible", repo.called)
	}
	if !errors.Is(repo.sawErr, context.Canceled) {
		t.Fatalf("repository context error = %v, want context.Canceled", repo.sawErr)
	}
	if repo.legacyCalled {
		t.Fatal("handler called legacy no-context repository method")
	}
}

type workItemReadRequestContextKey struct{}

type contextRecordingWorkItemReadRepo struct {
	store.Repository
	requestValue    string
	called          string
	sawRequestValue bool
	sawErr          error
	legacyCalled    bool
}

func (r *contextRecordingWorkItemReadRepo) recordWorkItemReadContext(ctx context.Context, called string) error {
	r.called = called
	r.sawRequestValue = ctx.Value(workItemReadRequestContextKey{}) == r.requestValue
	r.sawErr = ctx.Err()
	if !r.sawRequestValue {
		return errMissingWorkItemReadRequestContext
	}
	if r.sawErr != nil {
		return r.sawErr
	}
	return nil
}

func (r *contextRecordingWorkItemReadRepo) ListGeneratedInboxNodes(store.WorkItemInboxQuery) ([]domain.Node, error) {
	r.legacyCalled = true
	return nil, errLegacyWorkItemRead
}

func (r *contextRecordingWorkItemReadRepo) ListGeneratedInboxNodesContext(ctx context.Context, query store.WorkItemInboxQuery) ([]domain.Node, error) {
	if err := r.recordWorkItemReadContext(ctx, "responsible"); err != nil {
		return nil, err
	}
	return []domain.Node{}, nil
}

func (r *contextRecordingWorkItemReadRepo) ListACIInboxLogicGates(store.WorkItemInboxQuery) ([]store.WorkItemLogicGateInboxItem, error) {
	r.legacyCalled = true
	return nil, errLegacyWorkItemRead
}

func (r *contextRecordingWorkItemReadRepo) ListACIInboxLogicGatesContext(ctx context.Context, query store.WorkItemInboxQuery) ([]store.WorkItemLogicGateInboxItem, error) {
	if err := r.recordWorkItemReadContext(ctx, "aci"); err != nil {
		return nil, err
	}
	return []store.WorkItemLogicGateInboxItem{}, nil
}

func (r *contextRecordingWorkItemReadRepo) ListMyNodes(store.WorkItemInboxQuery) ([]domain.Node, error) {
	r.legacyCalled = true
	return nil, errLegacyWorkItemRead
}

func (r *contextRecordingWorkItemReadRepo) ListMyNodesContext(ctx context.Context, query store.WorkItemInboxQuery) ([]domain.Node, error) {
	if err := r.recordWorkItemReadContext(ctx, "my_nodes"); err != nil {
		return nil, err
	}
	return []domain.Node{}, nil
}

func (r *contextRecordingWorkItemReadRepo) ListMyLogicGates(store.WorkItemInboxQuery) ([]store.WorkItemLogicGateInboxItem, error) {
	r.legacyCalled = true
	return nil, errLegacyWorkItemRead
}

func (r *contextRecordingWorkItemReadRepo) ListMyLogicGatesContext(ctx context.Context, query store.WorkItemInboxQuery) ([]store.WorkItemLogicGateInboxItem, error) {
	if err := r.recordWorkItemReadContext(ctx, "my_logic_gates"); err != nil {
		return nil, err
	}
	return []store.WorkItemLogicGateInboxItem{}, nil
}

var (
	errLegacyWorkItemRead                = errors.New("legacy work item read called")
	errMissingWorkItemReadRequestContext = errors.New("missing work item read request context")
)

type myWorkMatrixErrorRepo struct {
	store.Repository
	err error
}

func (r myWorkMatrixErrorRepo) ListMyWorkMatrix(store.WorkItemInboxQuery) (store.MyWorkMatrixResponse, error) {
	return store.MyWorkMatrixResponse{}, r.err
}

func getWorkItemInboxRead(t *testing.T, handler http.Handler, path, userID, companyID, role string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req = workItemInboxReadRequestWithActor(req, userID, companyID, role, false)
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s status = %d, want %d body=%s", path, rec.Code, http.StatusOK, rec.Body.String())
	}
	return rec
}

func workItemInboxReadRequestWithActor(req *http.Request, userID, companyID, role string, isDevAdmin bool) *http.Request {
	return req.WithContext(context.WithValue(req.Context(), actorContextKey{}, workItemInboxReadActorContext(userID, companyID, role, isDevAdmin)))
}

func workItemInboxReadActorContext(userID, companyID, role string, isDevAdmin bool) ActorContext {
	actor := ActorContext{
		User:       domain.User{UserID: userID, Email: userID + "@example.com", DisplayName: "Work Item Read User"},
		CompanyID:  companyID,
		IsDevAdmin: isDevAdmin,
	}
	if role != "" {
		actor.Memberships = []domain.CompanyMembership{{
			CompanyID: companyID,
			UserID:    userID,
			Role:      role,
		}}
		actor.CompanyRole = role
	}
	return actor
}

func decodeWorkItemInboxReadPayload(t *testing.T, rec *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.NewDecoder(rec.Body).Decode(target); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}

func postMyWorkMatrixMoveJSON(t *testing.T, handler http.Handler, nodeID, userID, companyID, role string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/work-items/my-work-matrix/nodes/"+nodeID+"/move", bytes.NewReader(encoded))
	req.Header.Set("Content-Type", "application/json")
	req = workItemInboxReadRequestWithActor(req, userID, companyID, role, false)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func mustSetWorkItemReadNodeGVIC(t *testing.T, repo *store.MemoryRepo, companyID, nodeID, userID string) {
	t.Helper()
	if _, err := repo.SetResourceGVICAssignments(store.ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: store.EntityTypeNode,
		ResourceID:   nodeID,
		Assignments: []store.ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleGenerated,
			PrincipalType: store.EntityPermissionSubjectUser,
			PrincipalID:   userID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments %s: %v", nodeID, err)
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

func inboxReadHTTPNodesExactly(nodes []domain.Node, nodeID string) bool {
	return len(nodes) == 1 && nodes[0].NodeID == nodeID
}

func inboxReadHTTPMyWorkHasNode(rows []store.GVICMatrixProjectionRow, nodeID string, role string) bool {
	for _, row := range rows {
		if row.NodeID == nodeID && row.GVICAssignment == role && !row.IsContainerRow {
			return true
		}
	}
	return false
}
