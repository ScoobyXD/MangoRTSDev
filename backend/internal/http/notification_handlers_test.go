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
			Role:      domain.RoleCompanyUser,
		}},
		CompanyID:   companyID,
		CompanyRole: domain.RoleCompanyUser,
	}
	return req.WithContext(context.WithValue(req.Context(), actorContextKey{}, actor))
}

func TestLogicGateStateMoveCreatesNotificationForResponsibleUser(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
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
	if len(payload.Notifications) != 1 {
		t.Fatalf("notification count = %d, want 1: %+v", len(payload.Notifications), payload.Notifications)
	}
	if payload.Notifications[0].Type != domain.NotificationEventLogicGateStateChanged {
		t.Fatalf("notification type = %q", payload.Notifications[0].Type)
	}
	if !strings.Contains(payload.Notifications[0].Title, "In Progress") {
		t.Fatalf("notification title = %q, want In Progress", payload.Notifications[0].Title)
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

	commentBody, _ := json.Marshal(map[string]any{
		"company_id":  companyID,
		"type":        "Text block chat",
		"information": "Please review this, @Mentioned User.",
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
}
