package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestNodeViewV2EffectiveAccessAndNoLeak(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666501"
	repo.EnsureCompany(companyID, "Phase 5 Node View HTTP Co")

	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "phase5-node-viewer")
	editor := mustLogicGateWorkHTTPUser(t, repo, companyID, "phase5-node-editor")
	admin := mustLogicGateWorkHTTPUser(t, repo, companyID, "phase5-node-admin")
	blocked := mustLogicGateWorkHTTPUser(t, repo, companyID, "phase5-node-blocked")

	logicGate, err := repo.CreateLogicGate(companyID, "Node View Assignment Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Phase 5 Visible Node")
	if err != nil {
		t.Fatalf("CreateNode visible: %v", err)
	}
	hiddenNode, err := repo.CreateNode(companyID, "Phase 5 Hidden Node")
	if err != nil {
		t.Fatalf("CreateNode hidden: %v", err)
	}
	if _, err := repo.AddNodeInformationWithActor(store.NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		Type:             "Text box",
		Information:      "visible node editor content",
		InformationID:    "66666666-6666-4666-8666-666666666502",
		ActorUserID:      editor.UserID,
		ActorDisplayName: "Phase 5 Node Editor",
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Position:    10,
		Priority:    testPriority(3),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus visible: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: admin.UserID, AccessLevel: store.EntityPermissionEdit},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions node: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeLogicGate,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		EntityID:         logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: admin.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: blocked.UserID, AccessLevel: store.EntityPermissionNoAccess},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions logic gate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   hiddenNode.NodeID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionNoAccess},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions hidden node: %v", err)
	}

	guardedRepo := &phase5ForbiddenLegacyAndKanbanReadsRepo{Repository: repo}
	server := NewServer(guardedRepo)
	defer server.Close()
	handler := server.Routes()

	view, _ := getNodeViewV2ForTest(t, handler, companyID, node.NodeID, viewer, http.StatusOK)
	if !view.CanEdit {
		t.Fatalf("member can_edit = false, want the single positive edit outcome")
	}
	if view.Node.NodeID != node.NodeID || view.ProjectionCount != 1 || view.AssignmentCount != 1 {
		t.Fatalf("node view = %+v, want summary, projection, and assignment metadata", view)
	}
	if view.ContentChangeCount == 0 {
		t.Fatalf("node view content changes = %+v, want viewer unseen changes", view.ContentChanges)
	}

	editView, _ := getNodeViewV2ForTest(t, handler, companyID, node.NodeID, editor, http.StatusOK)
	if !editView.CanEdit {
		t.Fatalf("editor can_edit = false, want edit")
	}
	adminView, _ := getNodeViewV2ForTest(t, handler, companyID, node.NodeID, admin, http.StatusOK)
	if !adminView.CanEdit {
		t.Fatalf("company admin can_edit = false, want edit")
	}

	_, blockedBody := getNodeViewV2ForTest(t, handler, companyID, node.NodeID, blocked, http.StatusNotFound)
	if strings.Contains(blockedBody, node.Title) {
		t.Fatalf("blocked node view body leaked node title: %s", blockedBody)
	}
	_, hiddenBody := getNodeViewV2ForTest(t, handler, companyID, hiddenNode.NodeID, viewer, http.StatusNotFound)
	if strings.Contains(hiddenBody, hiddenNode.Title) {
		t.Fatalf("hidden node view body leaked hidden node title: %s", hiddenBody)
	}
	if guardedRepo.legacyAccessReadCount != 0 {
		t.Fatalf("node view used legacy access reads %d times", guardedRepo.legacyAccessReadCount)
	}
	if guardedRepo.kanbanReadCount != 0 {
		t.Fatalf("node view used Kanban read methods %d times", guardedRepo.kanbanReadCount)
	}
}

func TestNodeCreateRefreshesEffectiveAccessForV2View(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666521"
	repo.EnsureCompany(companyID, "Node Create V2 Refresh Co")
	creator := mustLogicGateWorkHTTPUser(t, repo, companyID, "node-create-refresh")
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	createBody := []byte(`{"company_id":"` + companyID + `","name":"Fresh V2 Node"}`)
	createReq := httptest.NewRequest(http.MethodPost, "/v1/nodes", bytes.NewReader(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createReq = requestWithLogicGateWorkActorForTest(createReq, creator, companyID)
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("POST node status = %d body=%s, want %d", createRec.Code, createRec.Body.String(), http.StatusCreated)
	}
	var created domain.Node
	if err := json.Unmarshal(createRec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created node: %v body=%s", err, createRec.Body.String())
	}

	view, _ := getNodeViewV2ForTest(t, handler, companyID, created.NodeID, creator, http.StatusOK)
	if view.Node.NodeID != created.NodeID || !view.CanEdit {
		t.Fatalf("created node v2 view = %+v, want creator access", view)
	}
}

func TestNodeViewV2AllowsCompanyAdminWithoutEffectiveProjection(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666522"
	repo.EnsureCompany(companyID, "Node Admin V2 Co")
	admin, err := repo.UpsertAuthUser("node-view-admin", "node-view-admin@example.com", "Node View Admin")
	if err != nil {
		t.Fatalf("UpsertAuthUser admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership admin: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Admin Visible Without Projection")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	req := httptest.NewRequest(http.MethodGet, "/v2/nodes/"+node.NodeID+"/view?company_id="+companyID, nil)
	req = requestWithActorForTest(req, admin, companyID)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("GET admin node view status = %d body=%s, want %d", rr.Code, rr.Body.String(), http.StatusOK)
	}
}

func TestNodeViewV2AllowsNoAuthDevRead(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666523"
	repo.EnsureCompany(companyID, "Node No Auth V2 Co")
	node, err := repo.CreateNode(companyID, "No Auth Dev Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	req := httptest.NewRequest(http.MethodGet, "/v2/nodes/"+node.NodeID+"/view?company_id="+companyID, nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("GET no-auth node view status = %d body=%s, want %d", rr.Code, rr.Body.String(), http.StatusOK)
	}
}

func TestLogicGateViewV2EffectiveAccessContextualNodesAndNoLeak(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666511"
	repo.EnsureCompany(companyID, "Phase 5 Logic Gate View HTTP Co")

	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "phase5-gate-viewer")
	editor := mustLogicGateWorkHTTPUser(t, repo, companyID, "phase5-gate-editor")
	admin := mustLogicGateWorkHTTPUser(t, repo, companyID, "phase5-gate-admin")
	blocked := mustLogicGateWorkHTTPUser(t, repo, companyID, "phase5-gate-blocked")

	logicGate, err := repo.CreateLogicGate(companyID, "Phase 5 Visible Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate visible: %v", err)
	}
	hiddenGate, err := repo.CreateLogicGate(companyID, "Phase 5 Hidden Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate hidden: %v", err)
	}
	assignedNode, err := repo.CreateNode(companyID, "Phase 5 Context Node")
	if err != nil {
		t.Fatalf("CreateNode assigned: %v", err)
	}
	hiddenAssignedNode, err := repo.CreateNode(companyID, "Phase 5 Hidden Context Node")
	if err != nil {
		t.Fatalf("CreateNode hidden assigned: %v", err)
	}
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "visible logic gate editor content", "66666666-6666-4666-8666-666666666512"); err != nil {
		t.Fatalf("AddLogicGateInformation: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      assignedNode.NodeID,
		Status:      "done",
		Position:    10,
		Priority:    testPriority(3),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus visible: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: hiddenGate.LogicGateID,
		NodeID:      hiddenAssignedNode.NodeID,
		Status:      "pending",
		Position:    20,
		Priority:    testPriority(4),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus hidden: %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: editor.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeLogicGate,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		EntityID:         logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: admin.UserID, AccessLevel: store.EntityPermissionEdit},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions logic gate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   hiddenGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionNoAccess},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions hidden logic gate: %v", err)
	}

	guardedRepo := &phase5ForbiddenLegacyAndKanbanReadsRepo{Repository: repo}
	server := NewServer(guardedRepo)
	defer server.Close()
	handler := server.Routes()

	view, viewBody := getLogicGateViewV2ForTest(t, handler, companyID, logicGate.LogicGateID, viewer, http.StatusOK)
	if !view.CanEdit {
		t.Fatalf("member can_edit = false, want the single positive edit outcome")
	}
	if view.LogicGate.LogicGateID != logicGate.LogicGateID || view.ProjectionCount != 1 || view.GVICAssignmentCount != 1 {
		t.Fatalf("logic gate view = %+v, want details, projection, and GVIC", view)
	}
	if strings.Contains(viewBody, `"work"`) || view.NodeCount != 0 || view.AssignmentCount != 0 {
		t.Fatalf("default logic gate view included work payload: %s", viewBody)
	}
	viewWithWork, _ := getLogicGateViewV2ForTestWithQuery(t, handler, companyID, logicGate.LogicGateID, viewer, "include_work=1", http.StatusOK)
	if viewWithWork.NodeCount != 1 || len(viewWithWork.Work.Cards) != 1 || viewWithWork.Work.Cards[0].NodeID != assignedNode.NodeID {
		t.Fatalf("logic gate work cards = %+v, want assigned node through explicit include_work", viewWithWork.Work.Cards)
	}

	getLogicGateViewV2ForTest(t, handler, companyID, logicGate.LogicGateID, editor, http.StatusOK)
	adminView, _ := getLogicGateViewV2ForTest(t, handler, companyID, logicGate.LogicGateID, admin, http.StatusOK)
	if !adminView.CanEdit {
		t.Fatalf("company admin can_edit = false, want edit")
	}

	_, blockedBody := getLogicGateViewV2ForTest(t, handler, companyID, logicGate.LogicGateID, blocked, http.StatusNotFound)
	if strings.Contains(blockedBody, assignedNode.Title) || strings.Contains(blockedBody, logicGate.Header) {
		t.Fatalf("blocked logic gate view body leaked data: %s", blockedBody)
	}
	_, hiddenBody := getLogicGateViewV2ForTest(t, handler, companyID, hiddenGate.LogicGateID, viewer, http.StatusNotFound)
	if strings.Contains(hiddenBody, hiddenAssignedNode.Title) || strings.Contains(hiddenBody, hiddenGate.Header) {
		t.Fatalf("hidden logic gate view body leaked data: %s", hiddenBody)
	}
	if guardedRepo.legacyAccessReadCount != 0 {
		t.Fatalf("logic gate view used legacy access reads %d times", guardedRepo.legacyAccessReadCount)
	}
	if guardedRepo.kanbanReadCount != 0 {
		t.Fatalf("logic gate view used Kanban read methods %d times", guardedRepo.kanbanReadCount)
	}
}

func getNodeViewV2ForTest(t *testing.T, handler http.Handler, companyID, nodeID string, actor domain.User, wantStatus int) (domain.NodeView, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v2/nodes/"+nodeID+"/view?company_id="+companyID, nil)
	req = requestWithLogicGateWorkActorForTest(req, actor, companyID)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	body := rr.Body.String()
	if rr.Code != wantStatus {
		t.Fatalf("GET node view status = %d body=%s, want %d", rr.Code, body, wantStatus)
	}
	if wantStatus != http.StatusOK {
		return domain.NodeView{}, body
	}
	var view domain.NodeView
	if err := json.Unmarshal([]byte(body), &view); err != nil {
		t.Fatalf("decode node view response: %v body=%s", err, body)
	}
	return view, body
}

func getLogicGateViewV2ForTest(t *testing.T, handler http.Handler, companyID, logicGateID string, actor domain.User, wantStatus int) (domain.LogicGateView, string) {
	t.Helper()
	return getLogicGateViewV2ForTestWithQuery(t, handler, companyID, logicGateID, actor, "", wantStatus)
}

func getLogicGateViewV2ForTestWithQuery(t *testing.T, handler http.Handler, companyID, logicGateID string, actor domain.User, extraQuery string, wantStatus int) (domain.LogicGateView, string) {
	t.Helper()
	path := "/v2/logic-gates/" + logicGateID + "/view?company_id=" + companyID
	if strings.TrimSpace(extraQuery) != "" {
		path += "&" + extraQuery
	}
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req = requestWithLogicGateWorkActorForTest(req, actor, companyID)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	body := rr.Body.String()
	if rr.Code != wantStatus {
		t.Fatalf("GET logic gate view status = %d body=%s, want %d", rr.Code, body, wantStatus)
	}
	if wantStatus != http.StatusOK {
		return domain.LogicGateView{}, body
	}
	var view domain.LogicGateView
	if err := json.Unmarshal([]byte(body), &view); err != nil {
		t.Fatalf("decode logic gate view response: %v body=%s", err, body)
	}
	return view, body
}

type phase5ForbiddenLegacyAndKanbanReadsRepo struct {
	store.Repository
	legacyAccessReadCount int
	kanbanReadCount       int
}

func (r *phase5ForbiddenLegacyAndKanbanReadsRepo) ListAccessibleEntityIDs(companyID, entityType, userID, accessLevel string, entityIDs []string) (map[string]bool, error) {
	r.legacyAccessReadCount++
	return nil, store.ErrInvalid
}

func (r *phase5ForbiddenLegacyAndKanbanReadsRepo) UserCanAccessEntity(companyID, entityType, entityID, userID, accessLevel string) (bool, error) {
	r.legacyAccessReadCount++
	return false, store.ErrInvalid
}

func (r *phase5ForbiddenLegacyAndKanbanReadsRepo) ListKanbanBoards(companyID string, query store.KanbanBoardQuery) ([]domain.KanbanBoard, error) {
	r.kanbanReadCount++
	return nil, store.ErrInvalid
}

func (r *phase5ForbiddenLegacyAndKanbanReadsRepo) ListKanbanColumns(companyID, boardID string) ([]domain.KanbanColumn, error) {
	r.kanbanReadCount++
	return nil, store.ErrInvalid
}

func (r *phase5ForbiddenLegacyAndKanbanReadsRepo) ListKanbanCards(companyID, boardID string, query store.KanbanCardQuery) ([]domain.KanbanCard, error) {
	r.kanbanReadCount++
	return nil, store.ErrInvalid
}

type nodeViewReadPathCountingRepo struct {
	store.Repository
	getNodeViewCalls    int
	markSeenCalls       int
	currentVersionCalls int
}

func (repo *nodeViewReadPathCountingRepo) GetNodeView(input store.NodeViewInput) (domain.NodeView, error) {
	repo.getNodeViewCalls++
	return repo.Repository.GetNodeView(input)
}

func (repo *nodeViewReadPathCountingRepo) MarkNodeContentChangeSeen(input store.NodeContentChangeSeenInput) (int, error) {
	repo.markSeenCalls++
	return repo.Repository.MarkNodeContentChangeSeen(input)
}

func (repo *nodeViewReadPathCountingRepo) CurrentNodeViewVersion(companyID, nodeID, userID string) (store.NodeViewVersion, error) {
	repo.currentVersionCalls++
	return repo.Repository.CurrentNodeViewVersion(companyID, nodeID, userID)
}

func TestNodeViewV2ConditionalReadSkipsPayloadBuildAndAllReadsArePure(t *testing.T) {
	memoryRepo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666541"
	memoryRepo.EnsureCompany(companyID, "Node View Conditional Co")
	actor := mustLogicGateWorkHTTPUser(t, memoryRepo, companyID, "node-view-conditional-actor")
	node, err := memoryRepo.CreateNode(companyID, "Conditional Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := memoryRepo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   actor.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	informationID := "66666666-6666-4666-8666-666666666542"
	if _, err := memoryRepo.AddNodeInformationWithActor(store.NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		InformationID:    informationID,
		Type:             "Text box",
		Information:      "conditional projection",
		ActorUserID:      actor.UserID,
		ActorDisplayName: actor.DisplayName,
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor: %v", err)
	}
	beforeRead, err := memoryRepo.CurrentNodeViewVersion(companyID, node.NodeID, actor.UserID)
	if err != nil {
		t.Fatalf("CurrentNodeViewVersion before read: %v", err)
	}

	countingRepo := &nodeViewReadPathCountingRepo{Repository: memoryRepo}
	server := NewServer(countingRepo)
	defer server.Close()
	handler := server.Routes()
	path := "/v2/nodes/" + node.NodeID + "/view?company_id=" + companyID

	firstReq := httptest.NewRequest(http.MethodGet, path, nil)
	firstReq = requestWithLogicGateWorkActorForTest(firstReq, actor, companyID)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("first GET status=%d body=%s", firstRec.Code, firstRec.Body.String())
	}
	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("first GET omitted ETag")
	}
	if countingRepo.getNodeViewCalls != 1 || countingRepo.markSeenCalls != 0 {
		t.Fatalf("first GET calls: GetNodeView=%d MarkSeen=%d, want 1/0", countingRepo.getNodeViewCalls, countingRepo.markSeenCalls)
	}
	afterRead, err := memoryRepo.CurrentNodeViewVersion(companyID, node.NodeID, actor.UserID)
	if err != nil {
		t.Fatalf("CurrentNodeViewVersion after read: %v", err)
	}
	if afterRead != beforeRead {
		t.Fatalf("GET changed node view versions from %+v to %+v", beforeRead, afterRead)
	}

	conditionalReq := httptest.NewRequest(http.MethodGet, path, nil)
	conditionalReq.Header.Set("If-None-Match", etag)
	conditionalReq = requestWithLogicGateWorkActorForTest(conditionalReq, actor, companyID)
	conditionalRec := httptest.NewRecorder()
	handler.ServeHTTP(conditionalRec, conditionalReq)
	if conditionalRec.Code != http.StatusNotModified {
		t.Fatalf("conditional GET status=%d body=%s, want 304", conditionalRec.Code, conditionalRec.Body.String())
	}
	if conditionalRec.Body.Len() != 0 {
		t.Fatalf("304 body=%q, want empty", conditionalRec.Body.String())
	}
	if countingRepo.getNodeViewCalls != 1 || countingRepo.markSeenCalls != 0 {
		t.Fatalf("304 calls: GetNodeView=%d MarkSeen=%d, want 1/0 total", countingRepo.getNodeViewCalls, countingRepo.markSeenCalls)
	}
	if countingRepo.currentVersionCalls != 2 {
		t.Fatalf("CurrentNodeViewVersion calls=%d, want 2", countingRepo.currentVersionCalls)
	}

	if _, err := memoryRepo.AddNodeInformationWithActor(store.NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		InformationID:    informationID,
		Type:             "Text box",
		Information:      "conditional projection changed",
		ActorUserID:      actor.UserID,
		ActorDisplayName: actor.DisplayName,
	}); err != nil {
		t.Fatalf("update projection: %v", err)
	}
	staleReq := httptest.NewRequest(http.MethodGet, path, nil)
	staleReq.Header.Set("If-None-Match", etag)
	staleReq = requestWithLogicGateWorkActorForTest(staleReq, actor, companyID)
	staleRec := httptest.NewRecorder()
	handler.ServeHTTP(staleRec, staleReq)
	if staleRec.Code != http.StatusOK {
		t.Fatalf("GET after projection mutation status=%d body=%s, want 200", staleRec.Code, staleRec.Body.String())
	}
	if staleRec.Header().Get("ETag") == etag {
		t.Fatalf("ETag did not change after projection autosave: %s", etag)
	}
	if countingRepo.getNodeViewCalls != 2 {
		t.Fatalf("GetNodeView calls after mutation=%d, want 2", countingRepo.getNodeViewCalls)
	}
}
func TestNodeProjectionAnchorCleanEndpointIsIdempotentAndDoesNotConsumeUnseen(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666551"
	repo.EnsureCompany(companyID, "Node Anchor Clean Co")
	actor := mustLogicGateWorkHTTPUser(t, repo, companyID, "node-anchor-actor")
	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "node-anchor-viewer")
	node, err := repo.CreateNode(companyID, "Anchor Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: actor.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionEdit},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	if _, err := repo.AddNodeInformationWithActor(store.NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		InformationID:    "66666666-6666-4666-8666-666666666552",
		Type:             "Text box",
		Information:      "anchor content",
		ActorUserID:      actor.UserID,
		ActorDisplayName: actor.DisplayName,
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor: %v", err)
	}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()
	path := "/v1/nodes/" + node.NodeID + "/changes/anchor-clean"
	postAnchor := func(user domain.User) int {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader([]byte(`{"company_id":"`+companyID+`"}`)))
		req.Header.Set("Content-Type", "application/json")
		req = requestWithLogicGateWorkActorForTest(req, user, companyID)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("POST anchor-clean status=%d body=%s", rec.Code, rec.Body.String())
		}
		var response struct {
			Anchored int `json:"anchored"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
			t.Fatalf("decode anchor response: %v", err)
		}
		return response.Anchored
	}
	if anchored := postAnchor(viewer); anchored != 0 {
		t.Fatalf("viewer anchor with unseen actor change=%d, want 0", anchored)
	}
	if changes, err := repo.ListUnseenNodeContentChanges(store.NodeContentChangeListInput{CompanyID: companyID, NodeID: node.NodeID, UserID: viewer.UserID}); err != nil || len(changes) == 0 {
		t.Fatalf("viewer unseen changes after anchor=%+v err=%v, want preserved", changes, err)
	}
	if anchored := postAnchor(actor); anchored != 1 {
		t.Fatalf("actor clean anchor=%d, want 1", anchored)
	}
	if anchored := postAnchor(actor); anchored != 0 {
		t.Fatalf("actor repeated anchor=%d, want 0", anchored)
	}
}
