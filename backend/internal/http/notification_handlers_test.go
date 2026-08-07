package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func requestWithActorForNotifications(req *http.Request, user domain.User, companyID string) *http.Request {
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

func grantNotificationEntityAccess(t *testing.T, repo *store.MemoryRepo, companyID, entityType, entityID string, userIDs ...string) {
	t.Helper()
	permissions := make([]store.EntityPermissionInput, 0, len(userIDs))
	for _, userID := range userIDs {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			continue
		}
		permissions = append(permissions, store.EntityPermissionInput{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   userID,
			AccessLevel: store.EntityPermissionEdit,
			Permission:  store.EntityPermissionEdit,
		})
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:   companyID,
		EntityType:  entityType,
		EntityID:    entityID,
		Permissions: permissions,
	}); err != nil {
		t.Fatalf("SetEntityPermissions %s %s: %v", entityType, entityID, err)
	}
}

func mustCreateNotificationTestUser(t *testing.T, repo *store.MemoryRepo, subject, companyID, email, displayName string) domain.User {
	t.Helper()
	user, err := repo.UpsertAuthUser(subject, email, displayName)
	if err != nil {
		t.Fatalf("UpsertAuthUser %s: %v", subject, err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership %s: %v", subject, err)
	}
	return user
}

func TestUpdateGroupsLoadRootsAndBranches(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{DisableNotificationCleanup: true})
	handler := server.Routes()
	companyID := "66666666-6666-4666-8666-666666666666"
	repo.EnsureCompany(companyID, "Updates Groups Company")
	user := mustCreateNotificationTestUser(t, repo, "updates-groups-user", companyID, "updates-groups@example.com", "Updates Groups User")

	logicGate, err := repo.CreateLogicGate(companyID, "Updates Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Updates Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 3
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "in progress",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	alpha, err := repo.CreateProject(store.ProjectInput{CompanyID: companyID, Name: "Alpha Updates", Status: "Active", ActorUserID: user.UserID})
	if err != nil || alpha.Project == nil {
		t.Fatalf("CreateProject alpha: %v", err)
	}
	bravo, err := repo.CreateProject(store.ProjectInput{CompanyID: companyID, Name: "Bravo Updates", Status: "Active", ActorUserID: user.UserID})
	if err != nil || bravo.Project == nil {
		t.Fatalf("CreateProject bravo: %v", err)
	}
	if _, err := repo.UpsertProjectRelationship(store.ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: alpha.Project.ProjectID, ResourceType: store.EntityTypeNode,
		ResourceID: node.NodeID, Position: 1, ActorUserID: user.UserID,
	}); err != nil {
		t.Fatalf("UpsertProjectRelationship Alpha: %v", err)
	}
	if _, err := repo.UpsertProjectRelationship(store.ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: bravo.Project.ProjectID, ResourceType: store.EntityTypeNode,
		ResourceID: node.NodeID, Position: 2, ActorUserID: user.UserID,
	}); !errors.Is(err, store.ErrProjectNodeInAnotherProject) {
		t.Fatalf("UpsertProjectRelationship Bravo err = %v, want ErrProjectNodeInAnotherProject", err)
	}
	for _, projectID := range []string{alpha.Project.ProjectID, bravo.Project.ProjectID} {
		grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeProject, projectID, user.UserID)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeLogicGate, logicGate.LogicGateID, user.UserID)
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, node.NodeID, user.UserID)

	created, err := repo.CreateNotifications(store.CreateNotificationsInput{Notifications: []store.NotificationCreateInput{
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventNodeFieldsChanged,
			SourceEventID:   "66666666-6666-4666-8666-666666666601",
			EntityType:      store.EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Node updated",
			LogicGateID:     logicGate.LogicGateID,
			NodeID:          node.NodeID,
		},
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventUrgentMentionCreated,
			SourceEventID:   "66666666-6666-4666-8666-666666666602",
			EntityType:      store.EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Urgent mention",
			LogicGateID:     logicGate.LogicGateID,
			NodeID:          node.NodeID,
		},
	}})
	if err != nil {
		t.Fatalf("CreateNotifications: %v", err)
	}
	if len(created) != 2 {
		t.Fatalf("created notifications = %+v, want 2", created)
	}

	rootsReq := httptest.NewRequest(http.MethodGet, "/v1/updates/groups/roots?company_id="+companyID+"&filter=update", nil)
	rootsReq = requestWithActorForNotifications(rootsReq, user, companyID)
	rootsRR := httptest.NewRecorder()
	handler.ServeHTTP(rootsRR, rootsReq)
	if rootsRR.Code != http.StatusOK {
		t.Fatalf("roots status = %d body=%s", rootsRR.Code, rootsRR.Body.String())
	}
	var rootsPayload struct {
		Groups []store.UpdatesNestedGroup `json:"groups"`
	}
	if err := json.NewDecoder(rootsRR.Body).Decode(&rootsPayload); err != nil {
		t.Fatalf("decode roots: %v", err)
	}
	if len(rootsPayload.Groups) != 1 || rootsPayload.Groups[0].Label != "Alpha Updates" {
		t.Fatalf("roots = %+v, want Alpha project root", rootsPayload.Groups)
	}
	if len(rootsPayload.Groups[0].Groups) != 0 || len(rootsPayload.Groups[0].Notifications) != 0 {
		t.Fatalf("root payload should be unloaded branch only: %+v", rootsPayload.Groups[0])
	}

	branchReq := httptest.NewRequest(http.MethodGet, "/v1/updates/groups/branch?company_id="+companyID+"&filter=update&root_id="+url.QueryEscape(rootsPayload.Groups[0].ID), nil)
	branchReq = requestWithActorForNotifications(branchReq, user, companyID)
	branchRR := httptest.NewRecorder()
	handler.ServeHTTP(branchRR, branchReq)
	if branchRR.Code != http.StatusOK {
		t.Fatalf("branch status = %d body=%s", branchRR.Code, branchRR.Body.String())
	}
	var branchPayload struct {
		Group store.UpdatesNestedGroup `json:"group"`
	}
	if err := json.NewDecoder(branchRR.Body).Decode(&branchPayload); err != nil {
		t.Fatalf("decode branch: %v", err)
	}
	if branchPayload.Group.Label != "Alpha Updates" || updateGroupNotificationCount(branchPayload.Group) != 1 {
		t.Fatalf("branch = %+v, want Alpha update branch with one non-mention notification", branchPayload.Group)
	}
	if !updateGroupHasResource(branchPayload.Group, store.EntityTypeLogicGate, logicGate.LogicGateID) || !updateGroupHasResource(branchPayload.Group, store.EntityTypeNode, node.NodeID) {
		t.Fatalf("branch hierarchy = %+v, want logic gate and node layers", branchPayload.Group)
	}

	if _, err := repo.MarkNotificationRead(user.UserID, created[0].NotificationID, true); err != nil {
		t.Fatalf("MarkNotificationRead: %v", err)
	}
	readRootsReq := httptest.NewRequest(http.MethodGet, "/v1/updates/groups/roots?company_id="+companyID+"&filter=update", nil)
	readRootsReq = requestWithActorForNotifications(readRootsReq, user, companyID)
	readRootsRR := httptest.NewRecorder()
	handler.ServeHTTP(readRootsRR, readRootsReq)
	if readRootsRR.Code != http.StatusOK {
		t.Fatalf("read roots status = %d body=%s", readRootsRR.Code, readRootsRR.Body.String())
	}
	var readRootsPayload struct {
		Groups []store.UpdatesNestedGroup `json:"groups"`
	}
	if err := json.NewDecoder(readRootsRR.Body).Decode(&readRootsPayload); err != nil {
		t.Fatalf("decode read roots: %v", err)
	}
	if len(readRootsPayload.Groups) != 0 {
		t.Fatalf("read roots = %+v, want no update roots after mark read", readRootsPayload.Groups)
	}

	seenRangeReq := httptest.NewRequest(http.MethodGet, "/v1/updates/seen-range?company_id="+companyID, nil)
	seenRangeReq = requestWithActorForNotifications(seenRangeReq, user, companyID)
	seenRangeRR := httptest.NewRecorder()
	handler.ServeHTTP(seenRangeRR, seenRangeReq)
	if seenRangeRR.Code != http.StatusOK {
		t.Fatalf("seen range status = %d body=%s", seenRangeRR.Code, seenRangeRR.Body.String())
	}
	var seenRange store.UpdatesSeenRange
	if err := json.NewDecoder(seenRangeRR.Body).Decode(&seenRange); err != nil {
		t.Fatalf("decode seen range: %v", err)
	}
	if seenRange.OldestCreatedTimestamp == nil || seenRange.NewestCreatedTimestamp == nil {
		t.Fatalf("seen range = %+v, want archived update bounds", seenRange)
	}

	seenDate := created[0].CreatedTimestamp.UTC().Format("2006-01-02")
	seenRootsPath := "/v1/updates/groups/roots?company_id=" + companyID + "&filter=update&view=seen&from=" + seenDate + "&to=" + seenDate
	seenRootsReq := httptest.NewRequest(http.MethodGet, seenRootsPath, nil)
	seenRootsReq = requestWithActorForNotifications(seenRootsReq, user, companyID)
	seenRootsRR := httptest.NewRecorder()
	handler.ServeHTTP(seenRootsRR, seenRootsReq)
	if seenRootsRR.Code != http.StatusOK {
		t.Fatalf("seen roots status = %d body=%s", seenRootsRR.Code, seenRootsRR.Body.String())
	}
	var seenRootsPayload struct {
		Groups []store.UpdatesNestedGroup `json:"groups"`
	}
	if err := json.NewDecoder(seenRootsRR.Body).Decode(&seenRootsPayload); err != nil {
		t.Fatalf("decode seen roots: %v", err)
	}
	if len(seenRootsPayload.Groups) != 1 {
		t.Fatalf("seen roots = %+v, want archived update root", seenRootsPayload.Groups)
	}
	seenBranchPath := "/v1/updates/groups/branch?company_id=" + companyID + "&filter=update&view=seen&from=" + seenDate + "&to=" + seenDate + "&root_id=" + url.QueryEscape(seenRootsPayload.Groups[0].ID)
	seenBranchReq := httptest.NewRequest(http.MethodGet, seenBranchPath, nil)
	seenBranchReq = requestWithActorForNotifications(seenBranchReq, user, companyID)
	seenBranchRR := httptest.NewRecorder()
	handler.ServeHTTP(seenBranchRR, seenBranchReq)
	if seenBranchRR.Code != http.StatusOK {
		t.Fatalf("seen branch status = %d body=%s", seenBranchRR.Code, seenBranchRR.Body.String())
	}
	var seenBranchPayload struct {
		Group store.UpdatesNestedGroup `json:"group"`
	}
	if err := json.NewDecoder(seenBranchRR.Body).Decode(&seenBranchPayload); err != nil {
		t.Fatalf("decode seen branch: %v", err)
	}
	if updateGroupNotificationCount(seenBranchPayload.Group) != 1 {
		t.Fatalf("seen branch = %+v, want one archived notification", seenBranchPayload.Group)
	}

	urgentReq := httptest.NewRequest(http.MethodGet, "/v1/updates/groups/branch?company_id="+companyID+"&filter=urgent&root_id="+url.QueryEscape(rootsPayload.Groups[0].ID), nil)
	urgentReq = requestWithActorForNotifications(urgentReq, user, companyID)
	urgentRR := httptest.NewRecorder()
	handler.ServeHTTP(urgentRR, urgentReq)
	if urgentRR.Code != http.StatusOK {
		t.Fatalf("urgent branch status = %d body=%s", urgentRR.Code, urgentRR.Body.String())
	}
	var urgentPayload struct {
		Group store.UpdatesNestedGroup `json:"group"`
	}
	if err := json.NewDecoder(urgentRR.Body).Decode(&urgentPayload); err != nil {
		t.Fatalf("decode urgent branch: %v", err)
	}
	if updateGroupNotificationCount(urgentPayload.Group) != 1 || updateFirstNotificationType(urgentPayload.Group) != domain.NotificationEventUrgentMentionCreated {
		t.Fatalf("urgent branch = %+v, want urgent mention only", urgentPayload.Group)
	}
}

func updateGroupNotificationCount(group store.UpdatesNestedGroup) int {
	total := len(group.Notifications)
	for _, child := range group.Groups {
		total += updateGroupNotificationCount(child)
	}
	return total
}

func updateGroupHasResource(group store.UpdatesNestedGroup, resourceType, resourceID string) bool {
	if group.ResourceType == resourceType && group.ResourceID == resourceID {
		return true
	}
	for _, child := range group.Groups {
		if updateGroupHasResource(child, resourceType, resourceID) {
			return true
		}
	}
	return false
}

func updateFirstNotificationType(group store.UpdatesNestedGroup) string {
	if len(group.Notifications) > 0 {
		return group.Notifications[0].Type
	}
	for _, child := range group.Groups {
		if notificationType := updateFirstNotificationType(child); notificationType != "" {
			return notificationType
		}
	}
	return ""
}

func TestLegacyKanbanCardMoveCreatesNoNotification(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{})
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-111111111111"

	responsible, err := repo.UpsertAuthUser("responsible-subject", "responsible@example.com", "Responsible User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("responsible-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	mover, err := repo.UpsertAuthUser("mover-subject", "mover@example.com", "Mover User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("mover-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}

	logicGate, err := repo.CreateLogicGate(companyID, "Launch gate")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleResponsible,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	consultedNoAccess, err := repo.UpsertAuthUser("consulted-no-access-subject", "consulted-no-access@example.com", "Consulted No Access")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("consulted-no-access-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	blockedNoAccess, err := repo.UpsertAuthUser("blocked-no-access-subject", "blocked-no-access@example.com", "Blocked No Access")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("blocked-no-access-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	assignments, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{
			{Role: domain.GVICRoleResponsible, UserID: responsible.UserID},
			{Role: domain.GVICRoleConsulted, UserID: consultedNoAccess.UserID},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(assignments) != 2 {
		t.Fatalf("GVIC assignments = %+v, want responsible and consulted", assignments)
	}
	board, err := repo.EnsureLogicGateKanbanBoard(companyID, logicGate.LogicGateID, logicGate.Header)
	if err != nil {
		t.Fatal(err)
	}
	columns, err := repo.ListKanbanColumns(companyID, board.BoardID)
	if err != nil {
		t.Fatal(err)
	}
	var pendingColumnID, inProgressColumnID string
	for _, column := range columns {
		switch column.Title {
		case "Pending":
			pendingColumnID = column.ColumnID
		case "In Progress":
			inProgressColumnID = column.ColumnID
		}
	}
	if pendingColumnID == "" || inProgressColumnID == "" {
		t.Fatalf("missing default Logic Gate columns: %+v", columns)
	}
	node, err := repo.CreateNode(companyID, "Prepare release")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateNode(store.UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Priority: testPriority(3), PrioritySet: true}); err != nil {
		t.Fatalf("UpdateNode priority: %v", err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeLogicGate, logicGate.LogicGateID, responsible.UserID)
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, node.NodeID, responsible.UserID)
	assignment, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		ColumnID:    pendingColumnID,
		NodeTitle:   node.Title,
	})
	if err != nil {
		t.Fatal(err)
	}
	card := assignment.Card

	moveBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   board.BoardID,
		"column_id":  inProgressColumnID,
	})
	moveReq := httptest.NewRequest(http.MethodPut, "/v1/kanban/cards/"+card.CardID, bytes.NewReader(moveBody))
	moveReq = requestWithActorForNotifications(moveReq, mover, companyID)
	moveReq.Header.Set("Content-Type", "application/json")
	moveRec := httptest.NewRecorder()
	handler.ServeHTTP(moveRec, moveReq)
	if moveRec.Code != http.StatusOK {
		t.Fatalf("PUT kanban card status = %d body=%s", moveRec.Code, moveRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID, nil)
	listReq = requestWithActorForNotifications(listReq, responsible, companyID)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET notifications status = %d body=%s", listRec.Code, listRec.Body.String())
	}
	var payload struct {
		Notifications []domain.Notification `json:"notifications"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode notifications: %v", err)
	}
	if len(payload.Notifications) != 0 {
		t.Fatalf("legacy kanban move notification count = %d, want 0: %+v", len(payload.Notifications), payload.Notifications)
	}

	blockedReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID, nil)
	blockedReq = requestWithActorForNotifications(blockedReq, blockedNoAccess, companyID)
	blockedRec := httptest.NewRecorder()
	handler.ServeHTTP(blockedRec, blockedReq)
	if blockedRec.Code != http.StatusOK {
		t.Fatalf("GET blocked notifications status = %d body=%s", blockedRec.Code, blockedRec.Body.String())
	}
	var blockedPayload struct {
		Notifications []domain.Notification `json:"notifications"`
	}
	if err := json.NewDecoder(blockedRec.Body).Decode(&blockedPayload); err != nil {
		t.Fatalf("decode blocked notifications: %v", err)
	}
	if len(blockedPayload.Notifications) != 0 {
		t.Fatalf("blocked notification count = %d, want 0: %+v", len(blockedPayload.Notifications), blockedPayload.Notifications)
	}

	summaryReq := httptest.NewRequest(http.MethodGet, "/v1/notifications/summary?company_id="+companyID, nil)
	summaryReq = requestWithActorForNotifications(summaryReq, responsible, companyID)
	summaryRec := httptest.NewRecorder()
	handler.ServeHTTP(summaryRec, summaryReq)
	if summaryRec.Code != http.StatusOK {
		t.Fatalf("GET notification summary status = %d body=%s", summaryRec.Code, summaryRec.Body.String())
	}
	var summary domain.NotificationSummary
	if err := json.NewDecoder(summaryRec.Body).Decode(&summary); err != nil {
		t.Fatalf("decode notification summary: %v", err)
	}
}

func TestOldLogicGateAssignmentRoutesAreNotFound(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "77777777-7777-4777-8777-777777777770"

	editor, err := repo.UpsertAuthUser("gvic-editor-subject", "gvic-editor@example.com", "GVIC Editor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("gvic-editor-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Assignment gate")
	if err != nil {
		t.Fatal(err)
	}

	assertNotFound := func(method, path string) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"company_id": companyID,
			"assignments": []map[string]string{{
				"role":    domain.GVICRoleResponsible,
				"user_id": editor.UserID,
			}},
		})
		req := httptest.NewRequest(method, path, bytes.NewReader(body))
		req = requestWithActorForNotifications(req, editor, companyID)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s %s status = %d body=%s, want not_found", method, path, rec.Code, rec.Body.String())
		}
	}

	assertNotFound(http.MethodPut, "/v1/logic-gates/"+logicGate.LogicGateID+"/GVIC")
	assertNotFound(http.MethodPost, "/v1/logic-gates/"+logicGate.LogicGateID+"/GVIC/add")
}

func TestNotificationSummaryCountsChangedTargetsForRoleBadges(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666660"
	user, err := repo.UpsertAuthUser("summary-subject", "summary@example.com", "Summary User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("summary-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Summary gate")
	if err != nil {
		t.Fatal(err)
	}
	nodeA, err := repo.CreateNode(companyID, "Node A")
	if err != nil {
		t.Fatal(err)
	}
	nodeB, err := repo.CreateNode(companyID, "Node B")
	if err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeLogicGate, logicGate.LogicGateID, user.UserID)
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, nodeA.NodeID, user.UserID)
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, nodeB.NodeID, user.UserID)

	candidates := make([]store.NotificationCreateInput, 0, 7)
	for index := 0; index < 7; index++ {
		nodeID := nodeA.NodeID
		if index >= 5 {
			nodeID = nodeB.NodeID
		}
		candidates = append(candidates, store.NotificationCreateInput{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            store.WorkItemLogicGateAssignmentMovedEventType,
			SourceEventID:   "66666666-6666-4666-8666-00000000000" + string(rune('1'+index)),
			EntityType:      store.EntityTypeLogicGate,
			EntityID:        logicGate.LogicGateID,
			Title:           "Node status changed",
			Surface:         domain.NotificationSurfaceCVIInbox,
			Role:            domain.GVICRoleConsulted,
			LogicGateID:     logicGate.LogicGateID,
			NodeID:          nodeID,
		})
	}
	if _, err := repo.CreateNotifications(store.CreateNotificationsInput{Notifications: candidates}); err != nil {
		t.Fatalf("CreateNotifications: %v", err)
	}

	summary, err := repo.GetNotificationSummary(store.NotificationSummaryInput{UserID: user.UserID, CompanyID: companyID})
	if err != nil {
		t.Fatalf("GetNotificationSummary: %v", err)
	}
	if summary.TotalUnread != 7 {
		t.Fatalf("total unread = %d, want 7", summary.TotalUnread)
	}
	if len(summary.RoleCounts) != 1 || summary.RoleCounts[0].Surface != domain.NotificationSurfaceCVIInbox || summary.RoleCounts[0].Role != domain.GVICRoleConsulted || summary.RoleCounts[0].Count != 2 {
		t.Fatalf("role counts = %+v, want two changed node targets", summary.RoleCounts)
	}
	countsByNode := map[string]int{}
	for _, count := range summary.LogicGateCounts {
		countsByNode[count.NodeID] += count.Count
	}
	if countsByNode[nodeA.NodeID] != 5 || countsByNode[nodeB.NodeID] != 2 {
		t.Fatalf("logic gate counts by node = %+v, want 5 and 2", countsByNode)
	}
}

func TestNodeChatMentionCreatesMentionNotification(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "22222222-2222-4222-8222-222222222222"

	author, err := repo.UpsertAuthUser("author-subject", "author@example.com", "Author User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("author-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	mentioned, err := repo.UpsertAuthUser("mentioned-subject", "mentioned@example.com", "Mentioned User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("mentioned-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Review packet")
	if err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, node.NodeID, mentioned.UserID)

	commentBody, _ := json.Marshal(map[string]any{
		"company_id":     companyID,
		"type":           "Text block chat",
		"information":    "Please review this, @Mentioned User.",
		"information_id": "22222222-2222-4222-8222-222222222299",
	})
	commentReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(commentBody))
	commentReq = requestWithActorForNotifications(commentReq, author, companyID)
	commentReq.Header.Set("Content-Type", "application/json")
	commentRec := httptest.NewRecorder()
	handler.ServeHTTP(commentRec, commentReq)
	if commentRec.Code != http.StatusCreated {
		t.Fatalf("POST node information status = %d body=%s", commentRec.Code, commentRec.Body.String())
	}

	notifications := waitForNotificationCountForTest(t, func() []domain.Notification {
		listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventMentionCreated, nil)
		listReq = requestWithActorForNotifications(listReq, mentioned, companyID)
		return listNotificationsForRequestForTest(t, handler, listReq)
	}, 1)
	if notifications[0].Type != domain.NotificationEventMentionCreated {
		t.Fatalf("notification type = %q", notifications[0].Type)
	}
	if !strings.Contains(notifications[0].Title, "Author User") {
		t.Fatalf("notification title = %q, want author label", notifications[0].Title)
	}
	if !strings.Contains(notifications[0].Title, "mentioned you in chat on Review packet") {
		t.Fatalf("notification title = %q, want mention target format", notifications[0].Title)
	}
	if notifications[0].Surface != domain.NotificationSurfaceCVIInbox || notifications[0].Role != domain.NotificationRoleOther {
		t.Fatalf("notification routing = %+v, want CVI other node mention", notifications[0])
	}
	if notifications[0].InformationID != "22222222-2222-4222-8222-222222222299" {
		t.Fatalf("notification information id = %q, want chat information id", notifications[0].InformationID)
	}

	summaryReq := httptest.NewRequest(http.MethodGet, "/v1/notifications/summary?company_id="+companyID, nil)
	summaryReq = requestWithActorForNotifications(summaryReq, mentioned, companyID)
	summaryRec := httptest.NewRecorder()
	handler.ServeHTTP(summaryRec, summaryReq)
	if summaryRec.Code != http.StatusOK {
		t.Fatalf("GET notification summary status = %d body=%s", summaryRec.Code, summaryRec.Body.String())
	}
	var summary domain.NotificationSummary
	if err := json.NewDecoder(summaryRec.Body).Decode(&summary); err != nil {
		t.Fatalf("decode notification summary: %v", err)
	}
	if len(summary.TypeCounts) != 1 || summary.TypeCounts[0].Type != domain.NotificationEventMentionCreated || summary.TypeCounts[0].Count != 1 {
		t.Fatalf("summary type counts = %+v, want one mention", summary.TypeCounts)
	}
	if len(summary.RoleCounts) != 1 || summary.RoleCounts[0].Surface != domain.NotificationSurfaceCVIInbox || summary.RoleCounts[0].Role != domain.NotificationRoleOther || summary.RoleCounts[0].Count != 1 {
		t.Fatalf("mention summary role counts = %+v, want one CVI other mention", summary.RoleCounts)
	}
	if len(summary.LogicGateCounts) != 0 {
		t.Fatalf("mention summary logic gate counts = %+v, want none for node without logic gate", summary.LogicGateCounts)
	}
}

func TestNodeChatMentionResolvesDevAdminOutsideCompany(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "22222222-2222-4222-8222-222222222224"
	adminCompanyID := "22222222-2222-4222-8222-222222222225"

	author, err := repo.UpsertAuthUser("dev-mention-author-subject", "author-dev-mention@example.com", "Author User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("dev-mention-author-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	devAdmin, err := repo.UpsertAuthUser("dev-mentioned-subject", "dev-mentioned@example.com", "Jonathan Kim")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("dev-mentioned-subject", adminCompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Dev admin mention node")
	if err != nil {
		t.Fatal(err)
	}

	commentBody, _ := json.Marshal(map[string]any{
		"company_id":  companyID,
		"type":        "Text block chat",
		"information": "Please review this, @Jonathan Kim.",
	})
	commentReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(commentBody))
	commentReq = requestWithActorForNotifications(commentReq, author, companyID)
	commentReq.Header.Set("Content-Type", "application/json")
	commentRec := httptest.NewRecorder()
	handler.ServeHTTP(commentRec, commentReq)
	if commentRec.Code != http.StatusCreated {
		t.Fatalf("POST node information status = %d body=%s", commentRec.Code, commentRec.Body.String())
	}

	notifications := waitForNotificationCountForTest(t, func() []domain.Notification {
		listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventMentionCreated, nil)
		listReq = requestWithActorForNotifications(listReq, devAdmin, companyID)
		return listNotificationsForRequestForTest(t, handler, listReq)
	}, 1)
	if notifications[0].RecipientUserID != devAdmin.UserID {
		t.Fatalf("recipient = %q, want dev admin %q", notifications[0].RecipientUserID, devAdmin.UserID)
	}
}

func TestLogicGateLegacyTextBoxMentionWriteIsRejected(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "22222222-2222-4222-8222-222222222223"

	author, err := repo.UpsertAuthUser("gate-author-subject", "gate-author@example.com", "Gate Author")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("gate-author-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	mentioned, err := repo.UpsertAuthUser("gate-mentioned-subject", "gate-mentioned@example.com", "Gate Mentioned")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("gate-mentioned-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Mention gate")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleVerifier,
			UserID: mentioned.UserID,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeLogicGate, logicGate.LogicGateID, mentioned.UserID)

	infoBody, _ := json.Marshal(map[string]any{
		"company_id":  companyID,
		"type":        "Text box",
		"information": "Please review this, @Gate Mentioned please.",
	})
	infoReq := httptest.NewRequest(http.MethodPost, "/v1/logic-gates/"+logicGate.LogicGateID+"/information", bytes.NewReader(infoBody))
	infoReq = requestWithActorForNotifications(infoReq, author, companyID)
	infoReq.Header.Set("Content-Type", "application/json")
	infoRec := httptest.NewRecorder()
	handler.ServeHTTP(infoRec, infoReq)
	if infoRec.Code != http.StatusConflict || !strings.Contains(infoRec.Body.String(), "editor_collaboration_required") {
		t.Fatalf("legacy Logic Gate information status = %d body=%s", infoRec.Code, infoRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventMentionCreated, nil)
	listReq = requestWithActorForNotifications(listReq, mentioned, companyID)
	if notifications := listNotificationsForRequestForTest(t, handler, listReq); len(notifications) != 0 {
		t.Fatalf("legacy rejected Logic Gate write created notifications: %+v", notifications)
	}
}

func TestNodeTextBoxMentionsCreateOnlyNewNotificationsAcrossSameInformationID(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "55555555-5555-4555-8555-555555555555"

	author, err := repo.UpsertAuthUser("textbox-author-subject", "textbox-author@example.com", "Text Author")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("textbox-author-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	first, err := repo.UpsertAuthUser("textbox-first-subject", "textbox-first@example.com", "First Mention")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("textbox-first-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	second, err := repo.UpsertAuthUser("textbox-second-subject", "textbox-second@example.com", "Second Mention")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("textbox-second-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Mention box")
	if err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, node.NodeID, first.UserID, second.UserID)

	postTextBox := func(information string) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"company_id":     companyID,
			"type":           "Text box",
			"information":    information,
			"information_id": "66666666-6666-4666-8666-666666666666",
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(body))
		req = requestWithActorForNotifications(req, author, companyID)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST node text box status = %d body=%s", rec.Code, rec.Body.String())
		}
	}
	postTextBox(`<!-- mango-node-text-block-v1 -->{"title":"Plan","document":"<!-- mango-editor-html-v1 --><span data-mango-mention=\"true\">@First Mention</span> please review."}`)
	postTextBox(`<!-- mango-node-text-block-v1 -->{"title":"Plan","document":"<!-- mango-editor-html-v1 --><span data-mango-mention=\"true\">@First Mention</span> and <span data-mango-mention=\"true\">@Second Mention</span> please review."}`)

	assertMentionCount := func(user domain.User, want int) {
		t.Helper()
		notifications := waitForNotificationCountForTest(t, func() []domain.Notification {
			listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventMentionCreated, nil)
			listReq = requestWithActorForNotifications(listReq, user, companyID)
			return listNotificationsForRequestForTest(t, handler, listReq)
		}, want)
		if want > 0 && strings.Contains(notifications[0].BodyPreview, "mango-editor-html") {
			t.Fatalf("body preview contains raw editor HTML: %q", notifications[0].BodyPreview)
		}
	}
	assertMentionCount(first, 1)
	assertMentionCount(second, 1)
}

func TestNodeTextBoxRepeatedMentionOccurrenceCreatesFreshAndOccurrenceNotifications(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "56565656-5656-4656-8656-565656565656"

	author, err := repo.UpsertAuthUser("repeat-mention-author-subject", "repeat-author@example.com", "Repeat Author")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("repeat-mention-author-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	mentioned, err := repo.UpsertAuthUser("repeat-mentioned-subject", "repeat-mentioned@example.com", "Repeat Mention")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("repeat-mentioned-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Repeated mention box")
	if err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, node.NodeID, mentioned.UserID)

	postTextBox := func(document string) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"company_id":     companyID,
			"type":           "Text box",
			"information":    `<!-- mango-node-text-block-v1 -->{"title":"Plan","document":"<!-- mango-editor-html-v1 -->` + document + `"}`,
			"information_id": "67676767-6767-4767-8767-676767676767",
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(body))
		req = requestWithActorForNotifications(req, author, companyID)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST node text box status = %d body=%s", rec.Code, rec.Body.String())
		}
	}
	postTextBox(`<span data-mango-mention=\"true\">@Repeat Mention</span> please review.`)
	postTextBox(`<span data-mango-mention=\"true\">@Repeat Mention</span> and <span data-mango-mention=\"true\">@Repeat Mention</span> please review.`)
	postTextBox(`<span data-mango-mention=\"true\">@Repeat Mention</span> and <span data-mango-mention=\"true\">@Repeat Mention</span> please review.`)

	waitForNotificationCountForTest(t, func() []domain.Notification {
		listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventMentionCreated, nil)
		listReq = requestWithActorForNotifications(listReq, mentioned, companyID)
		return listNotificationsForRequestForTest(t, handler, listReq)
	}, 2)
}

func TestNodeTextBoxMentionBodyPreviewUsesMentionOccurrenceBlock(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "58585858-5858-4858-8858-585858585858"

	author, err := repo.UpsertAuthUser("preview-mention-author-subject", "preview-author@example.com", "Preview Author")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("preview-mention-author-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	mentioned, err := repo.UpsertAuthUser("preview-mentioned-subject", "preview-mentioned@example.com", "Preview Mention")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("preview-mentioned-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Preview mention box")
	if err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, node.NodeID, mentioned.UserID)

	postTextBox := func(document string) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"company_id":     companyID,
			"type":           "Text box",
			"information":    `<!-- mango-node-text-block-v1 -->{"title":"Plan","document":"<!-- mango-editor-html-v1 -->` + document + `"}`,
			"information_id": "68686868-6868-4868-8868-686868686868",
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(body))
		req = requestWithActorForNotifications(req, author, companyID)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST node text box status = %d body=%s", rec.Code, rec.Body.String())
		}
	}
	listNotifications := func(notificationType string) []domain.Notification {
		t.Helper()
		listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+notificationType, nil)
		listReq = requestWithActorForNotifications(listReq, mentioned, companyID)
		return listNotificationsForRequestForTest(t, handler, listReq)
	}

	staleMention := `<div><span data-mango-mention=\"true\">@Preview Mention</span> aaaaazzzzz stale mention from hours ago.</div><div>1. Remember automatic numbering from an older note.</div>`
	freshMention := `<div><span data-mango-mention=\"true\">@Preview Mention</span></div><div>editor text box do you see this?</div>`
	freshUrgentMention := `<div><span data-mango-mention=\"true\" data-mango-mention-kind=\"urgent\">!Preview Mention</span> editor text box very urgent do you see this?</div>`

	postTextBox(staleMention)
	postTextBox(staleMention + freshMention)
	normalNotifications := waitForNotificationCountForTest(t, func() []domain.Notification {
		return listNotifications(domain.NotificationEventMentionCreated)
	}, 2)

	var normalPreview string
	for _, item := range normalNotifications {
		if strings.Contains(item.BodyPreview, "editor text box do you see this") {
			normalPreview = item.BodyPreview
			break
		}
	}
	if normalPreview == "" {
		t.Fatalf("normal mention previews = %+v, want fresh occurrence text", normalNotifications)
	}
	if strings.Contains(normalPreview, "aaaaazzzzz") || strings.Contains(normalPreview, "automatic numbering") {
		t.Fatalf("normal mention body preview = %q, want only the fresh mention block", normalPreview)
	}
	var staleNotificationID string
	for _, item := range normalNotifications {
		if strings.Contains(item.BodyPreview, "aaaaazzzzz") {
			staleNotificationID = item.NotificationID
			break
		}
	}
	if staleNotificationID == "" {
		t.Fatalf("normal mention previews = %+v, want stale occurrence for delete regression", normalNotifications)
	}
	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/notifications/"+staleNotificationID, nil)
	deleteReq = requestWithActorForNotifications(deleteReq, mentioned, companyID)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE stale notification status = %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}
	postTextBox(staleMention + freshMention)
	normalAfterDelete := waitForNotificationCountForTest(t, func() []domain.Notification {
		return listNotifications(domain.NotificationEventMentionCreated)
	}, 1)
	if strings.Contains(normalAfterDelete[0].BodyPreview, "aaaaazzzzz") {
		t.Fatalf("normal mention after stale delete = %+v, old occurrence should not be recreated", normalAfterDelete)
	}

	postTextBox(staleMention + freshMention + freshUrgentMention)
	urgentNotifications := waitForNotificationCountForTest(t, func() []domain.Notification {
		return listNotifications(domain.NotificationEventUrgentMentionCreated)
	}, 1)
	urgentPreview := urgentNotifications[0].BodyPreview
	if !strings.Contains(urgentPreview, "editor text box very urgent do you see this") {
		t.Fatalf("urgent mention body preview = %q, want fresh urgent occurrence text", urgentPreview)
	}
	if strings.Contains(urgentPreview, "aaaaazzzzz") || strings.Contains(urgentPreview, "automatic numbering") {
		t.Fatalf("urgent mention body preview = %q, want only the fresh urgent mention block", urgentPreview)
	}
}

func TestNotificationReadAllCanClearOneNotificationType(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "57575757-5757-4757-8757-575757575757"

	user, err := repo.UpsertAuthUser("clear-type-subject", "clear-type@example.com", "Clear Type")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("clear-type-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Clear notification node")
	if err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, node.NodeID, user.UserID)
	_, err = repo.CreateNotifications(store.CreateNotificationsInput{Notifications: []store.NotificationCreateInput{
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventMentionCreated,
			SourceEventID:   "11111111-1111-4111-8111-111111111111",
			EntityType:      store.EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Someone Clear notification node",
			BodyPreview:     "@Clear Type",
			NodeID:          node.NodeID,
		},
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventNodeFieldsChanged,
			SourceEventID:   "22222222-2222-4222-8222-222222222222",
			EntityType:      store.EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Node updated",
			BodyPreview:     "Fields changed",
			Surface:         domain.NotificationSurfaceRInbox,
			Role:            domain.GVICRoleResponsible,
			NodeID:          node.NodeID,
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{"company_id": companyID, "type": domain.NotificationEventMentionCreated})
	req := httptest.NewRequest(http.MethodPost, "/v1/notifications/read-all", bytes.NewReader(body))
	req = requestWithActorForNotifications(req, user, companyID)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST read-all status = %d body=%s", rec.Code, rec.Body.String())
	}
	var clearPayload struct {
		UpdatedCount int `json:"updated_count"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&clearPayload); err != nil {
		t.Fatalf("decode read-all: %v", err)
	}
	if clearPayload.UpdatedCount != 1 {
		t.Fatalf("updated_count = %d, want 1", clearPayload.UpdatedCount)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&unread_only=true", nil)
	listReq = requestWithActorForNotifications(listReq, user, companyID)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET notifications status = %d body=%s", listRec.Code, listRec.Body.String())
	}
	var listPayload struct {
		Notifications []domain.Notification `json:"notifications"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode notifications: %v", err)
	}
	if len(listPayload.Notifications) != 1 || listPayload.Notifications[0].Type != domain.NotificationEventNodeFieldsChanged {
		t.Fatalf("remaining unread notifications = %+v, want only node fields notification", listPayload.Notifications)
	}
}

func TestDeleteOneNotificationRemovesItFromGetResults(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{DisableNotificationCleanup: true})
	handler := server.Routes()
	companyID := "58585858-5858-4858-8858-585858585858"
	user, err := repo.UpsertAuthUser("delete-one-subject", "delete-one@example.com", "Delete One")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("delete-one-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Delete notification node")
	if err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, node.NodeID, user.UserID)
	created, err := repo.CreateNotifications(store.CreateNotificationsInput{Notifications: []store.NotificationCreateInput{
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventMentionCreated,
			SourceEventID:   "58585858-5858-4858-8858-000000000001",
			EntityType:      store.EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "First notification",
			NodeID:          node.NodeID,
		},
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventNodeFieldsChanged,
			SourceEventID:   "58585858-5858-4858-8858-000000000002",
			EntityType:      store.EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Second notification",
			NodeID:          node.NodeID,
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/notifications/"+created[0].NotificationID, nil)
	deleteReq = requestWithActorForNotifications(deleteReq, user, companyID)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE notification status = %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID, nil)
	listReq = requestWithActorForNotifications(listReq, user, companyID)
	notifications := listNotificationsForRequestForTest(t, handler, listReq)
	if len(notifications) != 1 || notifications[0].NotificationID != created[1].NotificationID {
		t.Fatalf("notifications after delete one = %+v, want only second notification", notifications)
	}
}

func TestClearAllNotificationsRequiresCompanyID(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{DisableNotificationCleanup: true})
	handler := server.Routes()
	companyID := "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a"
	user, err := repo.UpsertAuthUser("clear-all-missing-company-subject", "clear-all-missing-company@example.com", "Clear Missing Company")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("clear-all-missing-company-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/notifications", nil)
	deleteReq = requestWithActorForNotifications(deleteReq, user, companyID)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusBadRequest {
		t.Fatalf("DELETE notifications without company_id status = %d body=%s, want %d", deleteRec.Code, deleteRec.Body.String(), http.StatusBadRequest)
	}
}

func TestClearAllNotificationsRemovesOnlyCurrentUsersNotifications(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{DisableNotificationCleanup: true})
	handler := server.Routes()
	companyID := "59595959-5959-4959-8959-595959595959"
	otherCompanyID := "69696969-6969-4969-8969-696969696969"
	user, err := repo.UpsertAuthUser("clear-all-subject", "clear-all@example.com", "Clear All")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("clear-all-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("clear-all-subject", otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	other, err := repo.UpsertAuthUser("clear-all-other-subject", "clear-all-other@example.com", "Clear All Other")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("clear-all-other-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Clear all notification node")
	if err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, node.NodeID, user.UserID, other.UserID)
	otherCompanyNode, err := repo.CreateNode(otherCompanyID, "Other company clear all notification node")
	if err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, otherCompanyID, store.EntityTypeNode, otherCompanyNode.NodeID, user.UserID)
	if _, err := repo.CreateNotifications(store.CreateNotificationsInput{Notifications: []store.NotificationCreateInput{
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventMentionCreated,
			SourceEventID:   "59595959-5959-4959-8959-000000000001",
			EntityType:      store.EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Current user first",
			NodeID:          node.NodeID,
		},
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventNodeFieldsChanged,
			SourceEventID:   "59595959-5959-4959-8959-000000000002",
			EntityType:      store.EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Current user second",
			NodeID:          node.NodeID,
		},
		{
			CompanyID:       companyID,
			RecipientUserID: other.UserID,
			Type:            domain.NotificationEventMentionCreated,
			SourceEventID:   "59595959-5959-4959-8959-000000000003",
			EntityType:      store.EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Other user notification",
			NodeID:          node.NodeID,
		},
		{
			CompanyID:       otherCompanyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventMentionCreated,
			SourceEventID:   "59595959-5959-4959-8959-000000000004",
			EntityType:      store.EntityTypeNode,
			EntityID:        otherCompanyNode.NodeID,
			Title:           "Other company notification",
			NodeID:          otherCompanyNode.NodeID,
		},
	}}); err != nil {
		t.Fatal(err)
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/notifications?company_id="+companyID, nil)
	deleteReq = requestWithActorForNotifications(deleteReq, user, companyID)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE notifications status = %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}
	var deletedPayload struct {
		DeletedCount int `json:"deleted_count"`
	}
	if err := json.NewDecoder(deleteRec.Body).Decode(&deletedPayload); err != nil {
		t.Fatalf("decode delete all: %v", err)
	}
	if deletedPayload.DeletedCount != 2 {
		t.Fatalf("deleted_count = %d, want 2", deletedPayload.DeletedCount)
	}

	userListReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID, nil)
	userListReq = requestWithActorForNotifications(userListReq, user, companyID)
	if got := listNotificationsForRequestForTest(t, handler, userListReq); len(got) != 0 {
		t.Fatalf("current user notifications after clear all = %+v, want none", got)
	}
	otherCompanyListReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+otherCompanyID, nil)
	otherCompanyListReq = requestWithActorForNotifications(otherCompanyListReq, user, otherCompanyID)
	if got := listNotificationsForRequestForTest(t, handler, otherCompanyListReq); len(got) != 1 || got[0].CompanyID != otherCompanyID {
		t.Fatalf("same user other company notifications after clear all = %+v, want untouched other company notification", got)
	}
	otherListReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID, nil)
	otherListReq = requestWithActorForNotifications(otherListReq, other, companyID)
	if got := listNotificationsForRequestForTest(t, handler, otherListReq); len(got) != 1 || got[0].RecipientUserID != other.UserID {
		t.Fatalf("other user notifications after clear all = %+v, want untouched other notification", got)
	}
}

func TestClearNotificationsAppliesSurfaceAndRoleFilters(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{DisableNotificationCleanup: true})
	handler := server.Routes()
	companyID := "70707070-7070-4070-8070-707070707070"
	user, err := repo.UpsertAuthUser("clear-filter-subject", "clear-filter@example.com", "Clear Filter")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("clear-filter-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Filtered clear notification node")
	if err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, node.NodeID, user.UserID)
	if _, err := repo.CreateNotifications(store.CreateNotificationsInput{Notifications: []store.NotificationCreateInput{
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventNodeFieldsChanged,
			SourceEventID:   "70707070-7070-4070-8070-000000000001",
			EntityType:      store.EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Responsible R inbox",
			Surface:         domain.NotificationSurfaceRInbox,
			Role:            domain.GVICRoleResponsible,
			NodeID:          node.NodeID,
		},
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventNodeFieldsChanged,
			SourceEventID:   "70707070-7070-4070-8070-000000000002",
			EntityType:      store.EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Consulted R inbox",
			Surface:         domain.NotificationSurfaceRInbox,
			Role:            domain.GVICRoleConsulted,
			NodeID:          node.NodeID,
		},
		{
			CompanyID:       companyID,
			RecipientUserID: user.UserID,
			Type:            domain.NotificationEventNodeFieldsChanged,
			SourceEventID:   "70707070-7070-4070-8070-000000000003",
			EntityType:      store.EntityTypeNode,
			EntityID:        node.NodeID,
			Title:           "Responsible CVI inbox",
			Surface:         domain.NotificationSurfaceCVIInbox,
			Role:            domain.GVICRoleResponsible,
			NodeID:          node.NodeID,
		},
	}}); err != nil {
		t.Fatal(err)
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/notifications?company_id="+companyID+"&surface="+domain.NotificationSurfaceRInbox+"&role="+domain.GVICRoleResponsible, nil)
	deleteReq = requestWithActorForNotifications(deleteReq, user, companyID)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE filtered notifications status = %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}
	var deletedPayload struct {
		DeletedCount int `json:"deleted_count"`
	}
	if err := json.NewDecoder(deleteRec.Body).Decode(&deletedPayload); err != nil {
		t.Fatalf("decode filtered delete: %v", err)
	}
	if deletedPayload.DeletedCount != 1 {
		t.Fatalf("deleted_count = %d, want 1", deletedPayload.DeletedCount)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID, nil)
	listReq = requestWithActorForNotifications(listReq, user, companyID)
	remaining := listNotificationsForRequestForTest(t, handler, listReq)
	if len(remaining) != 2 {
		t.Fatalf("remaining notifications after filtered clear = %+v, want 2", remaining)
	}
	for _, item := range remaining {
		if item.Surface == domain.NotificationSurfaceRInbox && item.Role == domain.GVICRoleResponsible {
			t.Fatalf("remaining notifications include deleted filtered notification: %+v", remaining)
		}
	}
}

func TestNodeChatWithoutMentionNotifiesNodeGVICOnly(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "33333333-3333-4333-8333-333333333333"

	author, err := repo.UpsertAuthUser("plain-author-subject", "plain-author@example.com", "Plain Author")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("plain-author-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	assignee, err := repo.UpsertAuthUser("plain-assignee-subject", "plain-assignee@example.com", "Plain Assignee")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("plain-assignee-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	logicGateAssignee, err := repo.UpsertAuthUser("plain-logic-gate-assignee-subject", "plain-logic-gate-assignee@example.com", "Plain Logic Gate Assignee")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("plain-logic-gate-assignee-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Quiet packet")
	if err != nil {
		t.Fatal(err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Quiet Gate")
	if err != nil {
		t.Fatal(err)
	}
	priority := 3
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      store.LogicGateWorkStatusPending,
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleResponsible,
			UserID: logicGateAssignee.UserID,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetResourceGVICAssignments(store.ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: store.EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []store.ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleResponsible,
			PrincipalType: store.EntityPermissionSubjectUser,
			PrincipalID:   assignee.UserID,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	commentBody, _ := json.Marshal(map[string]any{
		"company_id":  companyID,
		"type":        "Text block chat",
		"information": "Plain discussion without a mention.",
	})
	commentReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(commentBody))
	commentReq = requestWithActorForNotifications(commentReq, author, companyID)
	commentReq.Header.Set("Content-Type", "application/json")
	commentRec := httptest.NewRecorder()
	handler.ServeHTTP(commentRec, commentReq)
	if commentRec.Code != http.StatusCreated {
		t.Fatalf("POST node information status = %d body=%s", commentRec.Code, commentRec.Body.String())
	}

	notifications := waitForNotificationCountForTest(t, func() []domain.Notification {
		listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventNodeCommentCreated, nil)
		listReq = requestWithActorForNotifications(listReq, assignee, companyID)
		return listNotificationsForRequestForTest(t, handler, listReq)
	}, 1)
	item := notifications[0]
	if item.Type != domain.NotificationEventNodeCommentCreated || item.EntityType != store.EntityTypeNode || item.EntityID != node.NodeID {
		t.Fatalf("notification = %+v, want node comment update", item)
	}
	if item.RecipientUserID != assignee.UserID || item.ActorUserID == nil || *item.ActorUserID != author.UserID {
		t.Fatalf("notification users = %+v, want assignee recipient and author actor", item)
	}
	if item.LogicGateID != logicGate.LogicGateID || item.NodeID != node.NodeID || item.Role != domain.GVICRoleResponsible {
		t.Fatalf("notification routing = %+v, want Responsible Logic Gate Node routing", item)
	}
	if item.Priority == nil || *item.Priority != priority {
		t.Fatalf("notification priority = %v, want node priority %d", item.Priority, priority)
	}
	if !strings.Contains(item.BodyPreview, "Plain discussion without a mention.") {
		t.Fatalf("notification body = %q, want chat preview", item.BodyPreview)
	}
	logicGateListReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventNodeCommentCreated, nil)
	logicGateListReq = requestWithActorForNotifications(logicGateListReq, logicGateAssignee, companyID)
	if logicGateNotifications := listNotificationsForRequestForTest(t, handler, logicGateListReq); len(logicGateNotifications) != 0 {
		t.Fatalf("Logic Gate-only user received node chat notifications: %+v", logicGateNotifications)
	}
}

func TestNodeGVICAssignmentAndFieldChangesUseCurrentNodeRole(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "44444444-4444-4444-8444-444444444444"

	assignee, err := repo.UpsertAuthUser("node-assignee-notify-subject", "node-assignee-notify@example.com", "Node Assignee")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("node-assignee-notify-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	editor, err := repo.UpsertAuthUser("node-editor-notify-subject", "node-editor-notify@example.com", "Node Editor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("node-editor-notify-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	alice, err := repo.UpsertAuthUser("node-alice-notify-subject", "node-alice-notify@example.com", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("node-alice-notify-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	charlie, err := repo.UpsertAuthUser("node-charlie-notify-subject", "node-charlie-notify@example.com", "Charlie")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("node-charlie-notify-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Assigned node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser, SubjectID: editor.UserID,
			AccessLevel: store.EntityPermissionEdit, Permission: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("restrict node access: %v", err)
	}
	if _, err := repo.SetResourceGVICAssignments(store.ResourceGVICAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: store.EntityTypeNode, ResourceID: node.NodeID,
		Assignments: []store.ResourceGVICAssignmentInput{
			{Role: domain.GVICRoleConsulted, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: alice.UserID},
			{Role: domain.GVICRoleInformed, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: charlie.UserID},
		},
	}); err != nil {
		t.Fatalf("seed Node GVIC: %v", err)
	}

	gvicBody, _ := json.Marshal(map[string]any{
		"company_id":      companyID,
		"assignment_mode": store.PolicyModeCustomized,
		"gvic_assignments": []map[string]string{{
			"role":           domain.GVICRoleConsulted,
			"principal_type": store.EntityPermissionSubjectUser,
			"principal_id":   alice.UserID,
		}, {
			"role":           domain.GVICRoleResponsible,
			"principal_type": store.EntityPermissionSubjectUser,
			"principal_id":   assignee.UserID,
		}},
	})
	gvicReq := httptest.NewRequest(http.MethodPut, "/v1/resources/node/"+node.NodeID+"/gvic", bytes.NewReader(gvicBody))
	gvicReq = requestWithActorForNotifications(gvicReq, editor, companyID)
	gvicReq.Header.Set("Content-Type", "application/json")
	gvicRec := httptest.NewRecorder()
	handler.ServeHTTP(gvicRec, gvicReq)
	if gvicRec.Code != http.StatusOK {
		t.Fatalf("PUT node GVIC status = %d body=%s", gvicRec.Code, gvicRec.Body.String())
	}

	updateBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"status":     "In Progress",
		"due_date":   "2026-06-01",
		"priority":   2,
	})
	updateReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+node.NodeID, bytes.NewReader(updateBody))
	updateReq = requestWithActorForNotifications(updateReq, editor, companyID)
	updateReq.Header.Set("Content-Type", "application/json")
	updateRec := httptest.NewRecorder()
	handler.ServeHTTP(updateRec, updateReq)
	if updateRec.Code != http.StatusOK {
		t.Fatalf("PUT node fields status = %d body=%s", updateRec.Code, updateRec.Body.String())
	}

	notifications := waitForNotificationCountForTest(t, func() []domain.Notification {
		listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID, nil)
		listReq = requestWithActorForNotifications(listReq, assignee, companyID)
		return listNotificationsForRequestForTest(t, handler, listReq)
	}, 2)
	types := map[string]bool{}
	for _, item := range notifications {
		types[item.Type] = true
		if item.Surface != domain.NotificationSurfaceRInbox || item.Role != domain.GVICRoleResponsible || item.NodeID != node.NodeID {
			t.Fatalf("notification metadata = %+v, want current Node Responsible role", item)
		}
		if item.Type == domain.NotificationEventNodeFieldsChanged && (item.Priority == nil || *item.Priority != 2) {
			t.Fatalf("field update priority = %v, want 2", item.Priority)
		}
	}
	if !types[domain.NotificationEventNodeAssigned] || !types[domain.NotificationEventNodeFieldsChanged] {
		t.Fatalf("notification types = %+v, want targeted assignment and node fields changed", types)
	}

	aliceNotifications := listNotificationsForRequestForTest(t, handler, requestWithActorForNotifications(
		httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID, nil),
		alice,
		companyID,
	))
	if len(aliceNotifications) != 1 ||
		aliceNotifications[0].Type != domain.NotificationEventNodeFieldsChanged ||
		aliceNotifications[0].Role != domain.GVICRoleConsulted {
		t.Fatalf("Alice notifications = %+v, want only current-role field update", aliceNotifications)
	}
	charlieNotifications := listNotificationsForRequestForTest(t, handler, requestWithActorForNotifications(
		httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID, nil),
		charlie,
		companyID,
	))
	if len(charlieNotifications) != 0 {
		t.Fatalf("Charlie notifications = %+v, want none after removal", charlieNotifications)
	}

	summaryReq := httptest.NewRequest(http.MethodGet, "/v1/notifications/summary?company_id="+companyID, nil)
	summaryReq = requestWithActorForNotifications(summaryReq, assignee, companyID)
	summaryRec := httptest.NewRecorder()
	handler.ServeHTTP(summaryRec, summaryReq)
	if summaryRec.Code != http.StatusOK {
		t.Fatalf("GET notification summary status = %d body=%s", summaryRec.Code, summaryRec.Body.String())
	}
	var summary domain.NotificationSummary
	if err := json.NewDecoder(summaryRec.Body).Decode(&summary); err != nil {
		t.Fatalf("decode notification summary: %v", err)
	}
	if len(summary.RoleCounts) != 1 || summary.RoleCounts[0].Surface != domain.NotificationSurfaceRInbox || summary.RoleCounts[0].Role != domain.GVICRoleResponsible || summary.RoleCounts[0].Count != 1 {
		t.Fatalf("summary role counts = %+v, want one current Node Responsible target", summary.RoleCounts)
	}
}

func TestMarkNotificationReadSucceedsAfterReferencedNodeIsDeleted(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{DisableNotificationCleanup: true})
	handler := server.Routes()
	companyID := "58585858-5858-4858-8858-585858585859"
	repo.EnsureCompany(companyID, "Deleted Update Target Company")
	user := mustCreateNotificationTestUser(t, repo, "deleted-update-target", companyID, "deleted-update@example.com", "Deleted Update User")
	node, err := repo.CreateNode(companyID, "Deleted update node")
	if err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, node.NodeID, user.UserID)
	created, err := repo.CreateNotifications(store.CreateNotificationsInput{Notifications: []store.NotificationCreateInput{{
		CompanyID:       companyID,
		RecipientUserID: user.UserID,
		Type:            domain.NotificationEventNodeFieldsChanged,
		SourceEventID:   "58585858-5858-4858-8858-585858585860",
		EntityType:      store.EntityTypeNode,
		EntityID:        node.NodeID,
		Title:           "Deleted node update",
		NodeID:          node.NodeID,
	}}})
	if err != nil {
		t.Fatalf("CreateNotifications: %v", err)
	}
	if err := repo.DeleteNode(companyID, node.NodeID); err != nil {
		t.Fatalf("DeleteNode: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/notifications/"+created[0].NotificationID+"/read", nil)
	req = requestWithActorForNotifications(req, user, companyID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST notification read after node deletion status = %d body=%s", rec.Code, rec.Body.String())
	}
	var item domain.Notification
	if err := json.NewDecoder(rec.Body).Decode(&item); err != nil {
		t.Fatalf("decode marked notification: %v", err)
	}
	if item.NotificationID != created[0].NotificationID || item.ReadTimestamp == nil {
		t.Fatalf("marked notification = %+v, want deleted-node update with read timestamp", item)
	}
}
