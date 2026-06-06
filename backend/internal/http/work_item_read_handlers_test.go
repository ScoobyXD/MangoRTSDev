package httpapi

import (
	"context"
	"encoding/json"
	"errors"
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
	otherUserID := "33333333-3333-4333-8333-555555555555"

	cases := []struct {
		name string
		path string
	}{
		{name: "missing company", path: "/v1/work-items/responsible-inbox"},
		{name: "invalid company", path: "/v1/work-items/responsible-inbox?company_id=not-a-uuid"},
		{name: "invalid user", path: "/v1/work-items/responsible-inbox?company_id=" + companyID + "&user_id=not-a-uuid"},
		{name: "conflicting user aliases", path: "/v1/work-items/responsible-inbox?company_id=" + companyID + "&user_id=" + userID + "&target_user_id=" + otherUserID},
		{name: "invalid limit", path: "/v1/work-items/aci-inbox?company_id=" + companyID + "&limit=0"},
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
	aciNode, err := repo.CreateNodeWithAssignee(companyID, "Read API ACI node", user.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee aci: %v", err)
	}
	standaloneNode, err := repo.CreateNodeWithAssignee(companyID, "Read API standalone node", user.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee standalone: %v", err)
	}
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
	if _, err := repo.UpdateNode(store.UpdateNodeInput{CompanyID: companyID, NodeID: responsibleNode.NodeID, AssigneeUserIDSet: true}); err != nil {
		t.Fatalf("clear responsible node assignee: %v", err)
	}

	handler := NewServer(repo).Routes()
	baseQuery := "company_id=" + companyID

	responsibleRec := getWorkItemInboxRead(t, handler, "/v1/work-items/responsible-inbox?"+baseQuery+"&limit=1", user.UserID, companyID, domain.RoleCompanyUser)
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

	aciRec := getWorkItemInboxRead(t, handler, "/v1/work-items/aci-inbox?"+baseQuery, user.UserID, companyID, domain.RoleCompanyUser)
	var aciPayload struct {
		LogicGates []store.WorkItemLogicGateInboxItem `json:"logic_gates"`
	}
	decodeWorkItemInboxReadPayload(t, aciRec, &aciPayload)
	if len(aciPayload.LogicGates) != 1 || aciPayload.LogicGates[0].LogicGateID != aciGate.LogicGateID || !inboxReadHTTPRolesContain(aciPayload.LogicGates[0].Roles, domain.LogicGateRaciRoleAccountable) {
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
	if !inboxReadHTTPPayloadHasGateRole(myGatesPayload.LogicGates, responsibleGate.LogicGateID, domain.LogicGateRaciRoleResponsible) {
		t.Fatalf("my logic gates missing responsible role: %+v", myGatesPayload.LogicGates)
	}
	if !inboxReadHTTPPayloadHasGateRole(myGatesPayload.LogicGates, aciGate.LogicGateID, domain.LogicGateRaciRoleAccountable) {
		t.Fatalf("my logic gates missing accountable role: %+v", myGatesPayload.LogicGates)
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
	ownNode, err := repo.CreateNodeWithAssignee(companyID, "Actor assigned node", actor.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee actor: %v", err)
	}
	otherNode, err := repo.CreateNodeWithAssignee(companyID, "Other assigned node", other.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee other: %v", err)
	}

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
		{name: "responsible inbox", path: "/v1/work-items/responsible-inbox", want: "responsible"},
		{name: "aci inbox", path: "/v1/work-items/aci-inbox", want: "aci"},
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
	req := httptest.NewRequest(http.MethodGet, "/v1/work-items/responsible-inbox?company_id="+companyID, nil).WithContext(ctx)

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

func (r *contextRecordingWorkItemReadRepo) ListResponsibleInboxNodes(store.WorkItemInboxQuery) ([]domain.Node, error) {
	r.legacyCalled = true
	return nil, errLegacyWorkItemRead
}

func (r *contextRecordingWorkItemReadRepo) ListResponsibleInboxNodesContext(ctx context.Context, query store.WorkItemInboxQuery) ([]domain.Node, error) {
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
