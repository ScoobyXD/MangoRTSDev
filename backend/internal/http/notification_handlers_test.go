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
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}
}

func TestLegacyKanbanCardMoveCreatesNoNotification(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{LegacyKanbanRoutesEnabled: true})
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
			Role:   domain.LogicGateRaciRoleResponsible,
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
			{Role: domain.LogicGateRaciRoleResponsible, UserID: responsible.UserID},
			{Role: domain.LogicGateRaciRoleConsulted, UserID: consultedNoAccess.UserID},
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
	card, err := repo.UpsertKanbanCard(store.KanbanCardMutationInput{
		CompanyID: companyID,
		BoardID:   board.BoardID,
		ColumnID:  pendingColumnID,
		NodeID:    node.NodeID,
		NodeTitle: node.Title,
	})
	if err != nil {
		t.Fatal(err)
	}

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
	if summary.TotalUnread != 0 {
		t.Fatalf("summary total unread = %d, want 0", summary.TotalUnread)
	}
}

func TestLogicGateRaciAssignmentNotificationsRouteToKeyViewsAndRepeatReassignments(t *testing.T) {
	t.Parallel()

	backing := store.NewMemoryRepo()
	repo := &noRebuildEffectiveAccessRepo{MemoryRepo: backing}
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
	accountable, err := repo.UpsertAuthUser("raci-accountable-subject", "raci-accountable@example.com", "RACI Accountable")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("raci-accountable-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	responsible, err := repo.UpsertAuthUser("raci-responsible-subject", "raci-responsible@example.com", "RACI Responsible")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("raci-responsible-subject", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Assignment gate")
	if err != nil {
		t.Fatal(err)
	}

	putRaci := func(assignments []map[string]string) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"company_id":  companyID,
			"assignments": assignments,
		})
		req := httptest.NewRequest(http.MethodPut, "/v1/logic-gates/"+logicGate.LogicGateID+"/raci", bytes.NewReader(body))
		req = requestWithActorForNotifications(req, editor, companyID)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("PUT logic gate RACI status = %d body=%s", rec.Code, rec.Body.String())
		}
	}
	listNotifications := func(user domain.User) []domain.Notification {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID, nil)
		req = requestWithActorForNotifications(req, user, companyID)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET notifications status = %d body=%s", rec.Code, rec.Body.String())
		}
		var payload struct {
			Notifications []domain.Notification `json:"notifications"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("decode notifications: %v", err)
		}
		return payload.Notifications
	}

	putRaci([]map[string]string{
		{"role": domain.LogicGateRaciRoleAccountable, "user_id": accountable.UserID},
		{"role": domain.LogicGateRaciRoleResponsible, "user_id": responsible.UserID},
	})

	accountableNotifications := listNotifications(accountable)
	if len(accountableNotifications) != 1 {
		t.Fatalf("accountable notification count = %d, want 1: %+v", len(accountableNotifications), accountableNotifications)
	}
	if accountableNotifications[0].Surface != domain.NotificationSurfaceACIInbox || accountableNotifications[0].Role != domain.LogicGateRaciRoleAccountable {
		t.Fatalf("accountable notification metadata = %+v, want ACIO accountable", accountableNotifications[0])
	}
	responsibleNotifications := listNotifications(responsible)
	if len(responsibleNotifications) != 1 {
		t.Fatalf("responsible notification count = %d, want 1: %+v", len(responsibleNotifications), responsibleNotifications)
	}
	if responsibleNotifications[0].Surface != domain.NotificationSurfaceRInbox || responsibleNotifications[0].Role != domain.LogicGateRaciRoleResponsible {
		t.Fatalf("responsible notification metadata = %+v, want responsible inbox", responsibleNotifications[0])
	}

	putRaci([]map[string]string{})
	putRaci([]map[string]string{
		{"role": domain.LogicGateRaciRoleAccountable, "user_id": accountable.UserID},
	})

	accountableNotifications = listNotifications(accountable)
	if len(accountableNotifications) != 2 {
		t.Fatalf("accountable notification count after reassignment = %d, want 2: %+v", len(accountableNotifications), accountableNotifications)
	}
	if repo.rebuildCalls != 0 {
		t.Fatalf("Logic Gate RACI notification flow called full-company rebuild %d times, want 0", repo.rebuildCalls)
	}
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
			Role:            domain.LogicGateRaciRoleConsulted,
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
	if len(summary.RoleCounts) != 1 || summary.RoleCounts[0].Surface != domain.NotificationSurfaceACIInbox || summary.RoleCounts[0].Role != domain.LogicGateRaciRoleConsulted || summary.RoleCounts[0].Count != 2 {
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

	listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventMentionCreated, nil)
	listReq = requestWithActorForNotifications(listReq, mentioned, companyID)
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
	if len(payload.Notifications) != 1 {
		t.Fatalf("notification count = %d, want 1: %+v", len(payload.Notifications), payload.Notifications)
	}
	if payload.Notifications[0].Type != domain.NotificationEventMentionCreated {
		t.Fatalf("notification type = %q", payload.Notifications[0].Type)
	}
	if !strings.Contains(payload.Notifications[0].Title, "Author User") {
		t.Fatalf("notification title = %q, want author label", payload.Notifications[0].Title)
	}
	if !strings.Contains(payload.Notifications[0].Title, "has mentioned you in Review packet") {
		t.Fatalf("notification title = %q, want mention target format", payload.Notifications[0].Title)
	}
	if payload.Notifications[0].Surface != domain.NotificationSurfaceRInbox || payload.Notifications[0].Role != domain.LogicGateRaciRoleResponsible {
		t.Fatalf("notification routing = %+v, want responsible node mention", payload.Notifications[0])
	}
	if payload.Notifications[0].InformationID != "22222222-2222-4222-8222-222222222299" {
		t.Fatalf("notification information id = %q, want chat information id", payload.Notifications[0].InformationID)
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
	if len(summary.RoleCounts) != 1 || summary.RoleCounts[0].Surface != domain.NotificationSurfaceRInbox || summary.RoleCounts[0].Role != domain.LogicGateRaciRoleResponsible || summary.RoleCounts[0].Count != 1 {
		t.Fatalf("mention summary role counts = %+v, want responsible mention", summary.RoleCounts)
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

	listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventMentionCreated, nil)
	listReq = requestWithActorForNotifications(listReq, devAdmin, companyID)
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
	if len(payload.Notifications) != 1 {
		t.Fatalf("notification count = %d, want 1: %+v", len(payload.Notifications), payload.Notifications)
	}
	if payload.Notifications[0].RecipientUserID != devAdmin.UserID {
		t.Fatalf("recipient = %q, want dev admin %q", payload.Notifications[0].RecipientUserID, devAdmin.UserID)
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
			Role:   domain.LogicGateRaciRoleAccountable,
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

	listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventMentionCreated, nil)
	listReq = requestWithActorForNotifications(listReq, mentioned, companyID)
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
	if len(payload.Notifications) != 1 {
		t.Fatalf("notification count = %d, want 1: %+v", len(payload.Notifications), payload.Notifications)
	}
	if item := payload.Notifications[0]; item.Type != domain.NotificationEventMentionCreated || item.EntityType != store.EntityTypeLogicGate || item.EntityID != logicGate.LogicGateID {
		t.Fatalf("mention notification = %+v, want logic gate mention", item)
	}
	if item := payload.Notifications[0]; item.Surface != domain.NotificationSurfaceACIInbox || item.Role != domain.LogicGateRaciRoleAccountable || item.LogicGateID != logicGate.LogicGateID {
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
		listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventMentionCreated, nil)
		listReq = requestWithActorForNotifications(listReq, user, companyID)
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
		if len(payload.Notifications) != want {
			t.Fatalf("notification count for %s = %d, want %d: %+v", user.UserID, len(payload.Notifications), want, payload.Notifications)
		}
		if want > 0 && strings.Contains(payload.Notifications[0].BodyPreview, "mango-editor-html") {
			t.Fatalf("body preview contains raw editor HTML: %q", payload.Notifications[0].BodyPreview)
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

	listReq := httptest.NewRequest(http.MethodGet, "/v1/notifications?company_id="+companyID+"&type="+domain.NotificationEventMentionCreated, nil)
	listReq = requestWithActorForNotifications(listReq, mentioned, companyID)
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
	if len(payload.Notifications) != 3 {
		t.Fatalf("notification count = %d, want 3: %+v", len(payload.Notifications), payload.Notifications)
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

func TestNodeAssignmentAndAssignedFieldChangesNotifyAssignee(t *testing.T) {
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

	assignBody, _ := json.Marshal(map[string]any{
		"company_id":       companyID,
		"assignee_user_id": assignee.UserID,
	})
	assignReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+node.NodeID, bytes.NewReader(assignBody))
	assignReq = requestWithActorForNotifications(assignReq, editor, companyID)
	assignReq.Header.Set("Content-Type", "application/json")
	assignRec := httptest.NewRecorder()
	handler.ServeHTTP(assignRec, assignReq)
	if assignRec.Code != http.StatusOK {
		t.Fatalf("PUT node assignment status = %d body=%s", assignRec.Code, assignRec.Body.String())
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
	if len(payload.Notifications) != 2 {
		t.Fatalf("notification count = %d, want 2: %+v", len(payload.Notifications), payload.Notifications)
	}
	types := map[string]bool{}
	for _, item := range payload.Notifications {
		types[item.Type] = true
		if item.Surface != domain.NotificationSurfaceMyTriage || item.Role != domain.NotificationRoleOther || item.NodeID != node.NodeID {
			t.Fatalf("notification metadata = %+v, want my triage other for node", item)
		}
	}
	if !types[domain.NotificationEventNodeAssigned] || !types[domain.NotificationEventNodeFieldsChanged] {
		t.Fatalf("notification types = %+v, want node assigned and node fields changed", types)
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
