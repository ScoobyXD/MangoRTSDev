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
			AccessLevel: store.EntityPermissionView,
			Permission:  store.EntityPermissionView,
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
	if _, err := repo.SetLogicGateRaciAssignments(store.LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateRaciAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
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
	assignments, err := repo.SetLogicGateRaciAssignments(store.LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateRaciAssignmentInput{
			{Role: domain.GVICRoleGenerated, UserID: responsible.UserID},
			{Role: domain.GVICRoleConsulted, UserID: consultedNoAccess.UserID},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(assignments) != 2 {
		t.Fatalf("raci assignments = %+v, want responsible and consulted", assignments)
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

func TestLogicGateRaciRoutesRequireGVIC(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "77777777-7777-4777-8777-777777777770"

	editor, err := repo.UpsertAuthUser("raci-editor-subject", "raci-editor@example.com", "RACI Editor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("raci-editor-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Assignment gate")
	if err != nil {
		t.Fatal(err)
	}

	assertGone := func(method, path string) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"company_id": companyID,
			"assignments": []map[string]string{{
				"role":    "responsible",
				"user_id": editor.UserID,
			}},
		})
		req := httptest.NewRequest(method, path, bytes.NewReader(body))
		req = requestWithActorForNotifications(req, editor, companyID)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusGone || !strings.Contains(rec.Body.String(), "gvic_required") {
			t.Fatalf("%s %s status = %d body=%s, want gvic_required", method, path, rec.Code, rec.Body.String())
		}
	}

	assertGone(http.MethodPut, "/v1/logic-gates/"+logicGate.LogicGateID+"/raci")
	assertGone(http.MethodPost, "/v1/logic-gates/"+logicGate.LogicGateID+"/raci/add")
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
			Surface:         domain.NotificationSurfaceACIInbox,
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
	if len(summary.RoleCounts) != 1 || summary.RoleCounts[0].Surface != domain.NotificationSurfaceACIInbox || summary.RoleCounts[0].Role != domain.GVICRoleConsulted || summary.RoleCounts[0].Count != 2 {
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
	if _, err := repo.UpdateNode(store.UpdateNodeInput{
		CompanyID:         companyID,
		NodeID:            node.NodeID,
		AssigneeUserID:    &mentioned.UserID,
		AssigneeUserIDSet: true,
	}); err != nil {
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
	if !strings.Contains(notifications[0].Title, "has mentioned you in Review packet") {
		t.Fatalf("notification title = %q, want mention target format", notifications[0].Title)
	}
	if notifications[0].Surface != domain.NotificationSurfaceACIInbox || notifications[0].Role != domain.NotificationRoleOther {
		t.Fatalf("notification routing = %+v, want ACI other node mention", notifications[0])
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
	if len(summary.RoleCounts) != 1 || summary.RoleCounts[0].Surface != domain.NotificationSurfaceACIInbox || summary.RoleCounts[0].Role != domain.NotificationRoleOther || summary.RoleCounts[0].Count != 1 {
		t.Fatalf("mention summary role counts = %+v, want one ACI other mention", summary.RoleCounts)
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

func TestLogicGateTextBoxMentionCreatesMentionNotification(t *testing.T) {
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
	if _, err := repo.SetLogicGateRaciAssignments(store.LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []store.LogicGateRaciAssignmentInput{{
			Role:   domain.GVICRoleVerified,
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
	if infoRec.Code != http.StatusCreated {
		t.Fatalf("POST logic gate information status = %d body=%s", infoRec.Code, infoRec.Body.String())
	}

	notifications := waitForNotificationCountForTest(t, func() []domain.Notification {
		listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventMentionCreated, nil)
		listReq = requestWithActorForNotifications(listReq, mentioned, companyID)
		return listNotificationsForRequestForTest(t, handler, listReq)
	}, 1)
	if item := notifications[0]; item.Type != domain.NotificationEventMentionCreated || item.EntityType != store.EntityTypeLogicGate || item.EntityID != logicGate.LogicGateID {
		t.Fatalf("mention notification = %+v, want logic gate mention", item)
	}
	if item := notifications[0]; item.Surface != domain.NotificationSurfaceACIInbox || item.Role != domain.GVICRoleVerified || item.LogicGateID != logicGate.LogicGateID {
		t.Fatalf("logic gate mention routing = %+v, want accountable logic gate", item)
	}
}

func TestNodeTextBoxMentionsCreateFreshNotificationsAcrossSameInformationID(t *testing.T) {
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
	assertMentionCount(first, 2)
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
	}, 3)
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
			Role:            "responsible",
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
			Role:            domain.GVICRoleGenerated,
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
			Title:           "Responsible ACI inbox",
			Surface:         domain.NotificationSurfaceACIInbox,
			Role:            domain.GVICRoleGenerated,
			NodeID:          node.NodeID,
		},
	}}); err != nil {
		t.Fatal(err)
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/notifications?company_id="+companyID+"&surface="+domain.NotificationSurfaceRInbox+"&role="+domain.GVICRoleGenerated, nil)
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
		if item.Surface == domain.NotificationSurfaceRInbox && item.Role == domain.GVICRoleGenerated {
			t.Fatalf("remaining notifications include deleted filtered notification: %+v", remaining)
		}
	}
}

func TestNodeChatWithoutMentionDoesNotNotifyAssignee(t *testing.T) {
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
	node, err := repo.CreateNode(companyID, "Quiet packet")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateNode(store.UpdateNodeInput{
		CompanyID:         companyID,
		NodeID:            node.NodeID,
		AssigneeUserID:    &assignee.UserID,
		AssigneeUserIDSet: true,
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

	listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID, nil)
	listReq = requestWithActorForNotifications(listReq, assignee, companyID)
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
		t.Fatalf("notification count = %d, want 0: %+v", len(payload.Notifications), payload.Notifications)
	}
}

func TestNodeGeneratedGVICFieldChangesNotifyGeneratedUser(t *testing.T) {
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
	node, err := repo.CreateNode(companyID, "Assigned node")
	if err != nil {
		t.Fatal(err)
	}
	grantNotificationEntityAccess(t, repo, companyID, store.EntityTypeNode, node.NodeID, assignee.UserID)

	gvicBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"gvic_assignments": []map[string]string{{
			"role":           domain.GVICRoleGenerated,
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
	}, 1)
	types := map[string]bool{}
	for _, item := range notifications {
		types[item.Type] = true
		if item.Surface != domain.NotificationSurfaceMyTriage || item.Role != domain.NotificationRoleOther || item.NodeID != node.NodeID {
			t.Fatalf("notification metadata = %+v, want my triage other for node", item)
		}
	}
	if !types[domain.NotificationEventNodeFieldsChanged] {
		t.Fatalf("notification types = %+v, want node fields changed", types)
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
	if len(summary.RoleCounts) != 1 || summary.RoleCounts[0].Surface != domain.NotificationSurfaceMyTriage || summary.RoleCounts[0].Role != domain.NotificationRoleOther || summary.RoleCounts[0].Count != 1 {
		t.Fatalf("summary role counts = %+v, want one my triage other node target", summary.RoleCounts)
	}
}
