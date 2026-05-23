package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestLogicGateWorkV2AccessAndMutations(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666401"
	repo.EnsureCompany(companyID, "Logic Gate Work HTTP Co")

	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "work-v2-viewer")
	editor := mustLogicGateWorkHTTPUser(t, repo, companyID, "work-v2-editor")
	admin := mustLogicGateWorkHTTPUser(t, repo, companyID, "work-v2-admin")
	blocked := mustLogicGateWorkHTTPUser(t, repo, companyID, "work-v2-blocked")

	logicGate, err := repo.CreateLogicGate(companyID, "Visible Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate visible: %v", err)
	}
	hiddenGate, err := repo.CreateLogicGate(companyID, "Hidden Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate hidden: %v", err)
	}
	visibleNode, err := repo.CreateNode(companyID, "Visible assigned node")
	if err != nil {
		t.Fatalf("CreateNode visible: %v", err)
	}
	hiddenNode, err := repo.CreateNode(companyID, "Hidden assigned node")
	if err != nil {
		t.Fatalf("CreateNode hidden: %v", err)
	}
	mutableNode, err := repo.CreateNode(companyID, "Mutable assigned node")
	if err != nil {
		t.Fatalf("CreateNode mutable: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      visibleNode.NodeID,
		Status:      "pending",
		Position:    10,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus visible: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: hiddenGate.LogicGateID,
		NodeID:      hiddenNode.NodeID,
		Status:      "done",
		Position:    20,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus hidden: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionView},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: admin.UserID, AccessLevel: store.EntityPermissionAdmin},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions visible gate: %v", err)
	}
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}
	if hasNodeView, err := repo.UserHasEffectiveAccess(companyID, viewer.UserID, store.EntityTypeNode, visibleNode.NodeID, store.EntityPermissionView); err != nil {
		t.Fatalf("UserHasEffectiveAccess contextual node: %v", err)
	} else if !hasNodeView {
		t.Fatalf("viewer lacks contextual node visibility for assigned node")
	}

	guardedRepo := &logicGateWorkForbiddenKanbanReadsRepo{Repository: repo}
	server := NewServer(guardedRepo)
	defer server.Close()
	handler := server.Routes()

	work := getLogicGateWorkV2ForTest(t, handler, companyID, logicGate.LogicGateID, viewer, http.StatusOK)
	if len(work.Assignments) != 1 || work.Assignments[0].Assignment.NodeID != visibleNode.NodeID {
		t.Fatalf("viewer work assignments = %+v, want only visible node", work.Assignments)
	}
	if len(work.Nodes) != 1 || work.Nodes[0].NodeID != visibleNode.NodeID {
		t.Fatalf("viewer work nodes = %+v, want assigned node without node grant", work.Nodes)
	}
	if len(work.Statuses) != 3 || work.Statuses[0].StatusKey != store.LogicGateWorkStatusPending {
		t.Fatalf("statuses = %+v, want canonical statuses", work.Statuses)
	}
	getLogicGateWorkV2ForTest(t, handler, companyID, logicGate.LogicGateID, editor, http.StatusOK)
	getLogicGateWorkV2ForTest(t, handler, companyID, logicGate.LogicGateID, admin, http.StatusOK)
	getLogicGateWorkV2ForTest(t, handler, companyID, logicGate.LogicGateID, blocked, http.StatusNotFound)
	getLogicGateWorkV2ForTest(t, handler, companyID, hiddenGate.LogicGateID, viewer, http.StatusNotFound)
	if guardedRepo.kanbanReadCount != 0 {
		t.Fatalf("v2 work read used Kanban read methods %d times", guardedRepo.kanbanReadCount)
	}

	postPayload := map[string]any{
		"company_id": companyID,
		"node_id":    mutableNode.NodeID,
		"status":     "pending",
		"position":   30,
	}
	postAsViewer := logicGateWorkV2Request(t, http.MethodPost, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes", postPayload, viewer, companyID)
	postAsViewerRecord := httptest.NewRecorder()
	handler.ServeHTTP(postAsViewerRecord, postAsViewer)
	if postAsViewerRecord.Code != http.StatusForbidden {
		t.Fatalf("view-only POST status = %d body=%s, want 403", postAsViewerRecord.Code, postAsViewerRecord.Body.String())
	}

	postAsEditor := logicGateWorkV2Request(t, http.MethodPost, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes", postPayload, editor, companyID)
	postRecord := httptest.NewRecorder()
	handler.ServeHTTP(postRecord, postAsEditor)
	if postRecord.Code != http.StatusCreated {
		t.Fatalf("editor POST status = %d body=%s, want 201", postRecord.Code, postRecord.Body.String())
	}
	postResult := decodeLogicGateWorkMutationPayloadForTest(t, postRecord)
	if postResult.Assignment.NodeID != mutableNode.NodeID || postResult.Assignment.StatusKey != store.LogicGateWorkStatusPending {
		t.Fatalf("POST assignment = %+v, want pending mutable node", postResult.Assignment)
	}

	clientGeneratedNodeID := "019e476d-ee56-7aaa-aaaa-aaaaaaaaaaaa"
	createNodePayload := map[string]any{
		"company_id":        companyID,
		"node_id":           clientGeneratedNodeID,
		"create_node_title": "Created from Kanban",
		"node_title":        "Created from Kanban",
		"status":            "done",
		"position":          40,
	}
	createNodeReq := logicGateWorkV2Request(t, http.MethodPost, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes", createNodePayload, editor, companyID)
	createNodeRecord := httptest.NewRecorder()
	handler.ServeHTTP(createNodeRecord, createNodeReq)
	if createNodeRecord.Code != http.StatusCreated {
		t.Fatalf("editor POST create-node status = %d body=%s, want 201", createNodeRecord.Code, createNodeRecord.Body.String())
	}
	createNodeResult := decodeLogicGateWorkMutationPayloadForTest(t, createNodeRecord)
	if createNodeResult.Node.NodeID != clientGeneratedNodeID || createNodeResult.Node.Title != "Created from Kanban" {
		t.Fatalf("created node = %+v, want client-generated node", createNodeResult.Node)
	}
	if createNodeResult.Card.NodeID != clientGeneratedNodeID || createNodeResult.Assignment.StatusKey != store.LogicGateWorkStatusDone {
		t.Fatalf("created assignment/card = %+v / %+v, want done client-generated node", createNodeResult.Assignment, createNodeResult.Card)
	}
	afterCreate := getLogicGateWorkV2ForTest(t, handler, companyID, logicGate.LogicGateID, editor, http.StatusOK)
	createdVisible := false
	for _, assignment := range afterCreate.Assignments {
		if assignment.Assignment.NodeID == clientGeneratedNodeID {
			createdVisible = true
			break
		}
	}
	if !createdVisible {
		t.Fatalf("created client-generated node missing from v2 work response: %+v", afterCreate.Assignments)
	}

	putPayload := map[string]any{
		"company_id": companyID,
		"status":     "done",
		"position":   5,
		"is_issue":   true,
	}
	putAsEditor := logicGateWorkV2Request(t, http.MethodPut, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes/"+mutableNode.NodeID+"/state", putPayload, editor, companyID)
	putRecord := httptest.NewRecorder()
	handler.ServeHTTP(putRecord, putAsEditor)
	if putRecord.Code != http.StatusOK {
		t.Fatalf("editor PUT status = %d body=%s, want 200", putRecord.Code, putRecord.Body.String())
	}
	putResult := decodeLogicGateWorkMutationPayloadForTest(t, putRecord)
	if putResult.Assignment.StatusKey != store.LogicGateWorkStatusDone || !putResult.Assignment.IsIssue {
		t.Fatalf("PUT assignment = %+v, want done issue assignment", putResult.Assignment)
	}

	deleteAsEditor := httptest.NewRequest(http.MethodDelete, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes/"+mutableNode.NodeID+"?company_id="+companyID, nil)
	deleteAsEditor = requestWithLogicGateWorkActorForTest(deleteAsEditor, editor, companyID)
	deleteRecord := httptest.NewRecorder()
	handler.ServeHTTP(deleteRecord, deleteAsEditor)
	if deleteRecord.Code != http.StatusOK {
		t.Fatalf("editor DELETE status = %d body=%s, want 200", deleteRecord.Code, deleteRecord.Body.String())
	}
	afterDelete := getLogicGateWorkV2ForTest(t, handler, companyID, logicGate.LogicGateID, editor, http.StatusOK)
	for _, assignment := range afterDelete.Assignments {
		if assignment.Assignment.NodeID == mutableNode.NodeID {
			t.Fatalf("deleted node still present in v2 work response: %+v", afterDelete.Assignments)
		}
		if assignment.Assignment.NodeID == hiddenNode.NodeID {
			t.Fatalf("hidden node leaked in visible gate response: %+v", afterDelete.Assignments)
		}
	}
}

func TestLogicGateWorkV2StateChangeCreatesNotifications(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666411"
	repo.EnsureCompany(companyID, "Logic Gate Work Notifications Co")

	editor := mustLogicGateWorkHTTPUser(t, repo, companyID, "work-v2-notify-editor")
	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "work-v2-notify-viewer")
	responsible := mustLogicGateWorkHTTPUser(t, repo, companyID, "work-v2-notify-responsible")
	blocked := mustLogicGateWorkHTTPUser(t, repo, companyID, "work-v2-notify-blocked")

	logicGate, err := repo.CreateLogicGate(companyID, "Notification Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Notification Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: store.EntityPermissionEdit, Permission: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionView, Permission: store.EntityPermissionView},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	if _, err := repo.SetLogicGateRaciAssignments(store.LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleResponsible,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	putPayload := map[string]any{
		"company_id": companyID,
		"status":     "done",
	}
	req := logicGateWorkV2Request(t, http.MethodPut, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes/"+node.NodeID+"/state", putPayload, editor, companyID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT work state status = %d body=%s, want 200", rec.Code, rec.Body.String())
	}

	responsibleNotifications := listLogicGateWorkNotificationsForTest(t, handler, companyID, responsible)
	if len(responsibleNotifications) != 1 {
		t.Fatalf("responsible notification count = %d, want 1: %+v", len(responsibleNotifications), responsibleNotifications)
	}
	item := responsibleNotifications[0]
	if item.Type != store.WorkItemLogicGateAssignmentMovedEventType {
		t.Fatalf("responsible notification type = %q, want %q", item.Type, store.WorkItemLogicGateAssignmentMovedEventType)
	}
	if item.Surface != domain.NotificationSurfaceRInbox || item.Role != domain.LogicGateRaciRoleResponsible {
		t.Fatalf("responsible notification metadata = %+v, want responsible R inbox", item)
	}
	if item.LogicGateID != logicGate.LogicGateID || item.NodeID != node.NodeID {
		t.Fatalf("responsible notification target = %+v, want gate/node", item)
	}

	viewerNotifications := listLogicGateWorkNotificationsForTest(t, handler, companyID, viewer)
	if len(viewerNotifications) != 1 {
		t.Fatalf("viewer notification count = %d, want 1: %+v", len(viewerNotifications), viewerNotifications)
	}
	if viewerNotifications[0].Surface != domain.NotificationSurfaceACIInbox || viewerNotifications[0].Role != domain.NotificationRoleOther {
		t.Fatalf("viewer notification metadata = %+v, want ACI other", viewerNotifications[0])
	}
	if got := listLogicGateWorkNotificationsForTest(t, handler, companyID, editor); len(got) != 0 {
		t.Fatalf("actor self notifications = %+v, want none", got)
	}
	if got := listLogicGateWorkNotificationsForTest(t, handler, companyID, blocked); len(got) != 0 {
		t.Fatalf("blocked notifications = %+v, want none", got)
	}
}

func mustLogicGateWorkHTTPUser(t *testing.T, repo *store.MemoryRepo, companyID, subject string) domain.User {
	t.Helper()
	user, err := repo.UpsertAuthUser(subject, subject+"@example.com", strings.ReplaceAll(subject, "-", " "))
	if err != nil {
		t.Fatalf("UpsertAuthUser %s: %v", subject, err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership %s: %v", subject, err)
	}
	return user
}

func requestWithLogicGateWorkActorForTest(req *http.Request, user domain.User, companyID string) *http.Request {
	actor := ActorContext{
		User: user,
		Memberships: []domain.CompanyMembership{{
			CompanyID: companyID,
			UserID:    user.UserID,
			Role:      domain.RoleCompanyUser,
		}},
		CompanyID:   companyID,
		CompanyRole: domain.RoleCompanyUser,
	}
	return req.WithContext(context.WithValue(req.Context(), actorContextKey{}, actor))
}

func getLogicGateWorkV2ForTest(t *testing.T, handler http.Handler, companyID, logicGateID string, actor domain.User, wantStatus int) domain.LogicGateWorkView {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v2/logic-gates/"+logicGateID+"/work?company_id="+companyID, nil)
	req = requestWithLogicGateWorkActorForTest(req, actor, companyID)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != wantStatus {
		t.Fatalf("GET work status = %d body=%s, want %d", rr.Code, rr.Body.String(), wantStatus)
	}
	if wantStatus != http.StatusOK {
		return domain.LogicGateWorkView{}
	}
	var work domain.LogicGateWorkView
	if err := json.NewDecoder(rr.Body).Decode(&work); err != nil {
		t.Fatalf("decode work response: %v body=%s", err, rr.Body.String())
	}
	return work
}

func logicGateWorkV2Request(t *testing.T, method, target string, payload map[string]any, actor domain.User, companyID string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(payload); err != nil {
		t.Fatalf("encode request payload: %v", err)
	}
	req := httptest.NewRequest(method, target, &body)
	req.Header.Set("Content-Type", "application/json")
	return requestWithLogicGateWorkActorForTest(req, actor, companyID)
}

func listLogicGateWorkNotificationsForTest(t *testing.T, handler http.Handler, companyID string, actor domain.User) []domain.Notification {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID, nil)
	req = requestWithLogicGateWorkActorForTest(req, actor, companyID)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("GET notifications status = %d body=%s, want 200", rr.Code, rr.Body.String())
	}
	var payload struct {
		Notifications []domain.Notification `json:"notifications"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode notifications response: %v body=%s", err, rr.Body.String())
	}
	return payload.Notifications
}

type logicGateWorkMutationPayloadForTest struct {
	Assignment domain.NodeLogicGateAssignment `json:"assignment"`
	Node       domain.Node                    `json:"node"`
	Card       domain.KanbanCard              `json:"card"`
}

func decodeLogicGateWorkMutationPayloadForTest(t *testing.T, rr *httptest.ResponseRecorder) logicGateWorkMutationPayloadForTest {
	t.Helper()
	var payload logicGateWorkMutationPayloadForTest
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode mutation response: %v body=%s", err, rr.Body.String())
	}
	return payload
}

type logicGateWorkForbiddenKanbanReadsRepo struct {
	store.Repository
	kanbanReadCount int
}

func (r *logicGateWorkForbiddenKanbanReadsRepo) ListKanbanBoards(companyID string, query store.KanbanBoardQuery) ([]domain.KanbanBoard, error) {
	r.kanbanReadCount++
	return nil, store.ErrInvalid
}

func (r *logicGateWorkForbiddenKanbanReadsRepo) ListKanbanColumns(companyID, boardID string) ([]domain.KanbanColumn, error) {
	r.kanbanReadCount++
	return nil, store.ErrInvalid
}

func (r *logicGateWorkForbiddenKanbanReadsRepo) ListKanbanCards(companyID, boardID string, query store.KanbanCardQuery) ([]domain.KanbanCard, error) {
	r.kanbanReadCount++
	return nil, store.ErrInvalid
}
