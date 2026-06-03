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

func TestV4MiniPhase3LegacyKanbanCardMutationUsesLogicGateWorkAccess(t *testing.T) {
	t.Parallel()

	base := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777731"
	base.EnsureCompany(companyID, "V4 Mini Kanban Guard Co")

	editor := mustLogicGateWorkHTTPUser(t, base, companyID, "v4-mini-kanban-editor")
	logicGate, err := base.CreateLogicGate(companyID, "V4 Mini Kanban Guard Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := base.CreateNode(companyID, "V4 Mini Kanban Guard Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	assigned, err := base.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    testPriority(3),
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := base.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   editor.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	repo := &phase3ForbiddenKanbanCardListRepo{Repository: base}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	body, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   store.LogicGateKanbanBoardID(logicGate.LogicGateID),
		"column_id":  store.LogicGateWorkStatusDone,
	})
	req := httptest.NewRequest(http.MethodPut, "/v1/kanban/cards/"+assigned.Card.CardID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = requestWithLogicGateWorkActorForTest(req, editor, companyID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("legacy Kanban card compatibility PUT status = %d body=%s", rec.Code, rec.Body.String())
	}
	if repo.cardListCalls != 0 {
		t.Fatalf("legacy Kanban card compatibility PUT loaded board card lists %d times", repo.cardListCalls)
	}
}

func TestV4MiniPhase3LogicGateWorkAndKanbanReadDeniedResponses(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777732"
	repo.EnsureCompany(companyID, "V4 Mini Kanban Denied Co")
	blocked := mustLogicGateWorkHTTPUser(t, repo, companyID, "v4-mini-kanban-blocked")
	logicGate, err := repo.CreateLogicGate(companyID, "Hidden Phase 3 Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   blocked.UserID,
			AccessLevel: store.EntityPermissionNoAccess,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions hidden phase 3 gate: %v", err)
	}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	for _, target := range []string{
		"/v2/logic-gates/" + logicGate.LogicGateID + "/work?company_id=" + companyID,
		"/v1/workspace/snapshot?company_id=" + companyID + "&scope=kanban&board_id=" + store.LogicGateKanbanBoardID(logicGate.LogicGateID),
	} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req = requestWithLogicGateWorkActorForTest(req, blocked, companyID)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		assertGenericResourceDenied(t, rec, logicGate.Header)
	}
}

func TestV4MiniPhase3KanbanMutationDeniedResponses(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777733"
	repo.EnsureCompany(companyID, "V4 Mini Kanban Mutation Co")
	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "v4-mini-kanban-viewer")
	logicGate, err := repo.CreateLogicGate(companyID, "Hidden Phase 3 Mutation Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Phase 3 mutation node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   viewer.UserID,
			AccessLevel: store.EntityPermissionNoAccess,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	body, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   store.LogicGateKanbanBoardID(logicGate.LogicGateID),
		"column_id":  store.LogicGateWorkStatusPending,
		"node_id":    node.NodeID,
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = requestWithLogicGateWorkActorForTest(req, viewer, companyID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	assertGenericResourceDenied(t, rec, logicGate.Header)
}

func TestV4MiniPhase3OldKanbanRoutePolicy(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777734"
	repo.EnsureCompany(companyID, "V4 Mini Kanban Policy Co")
	user := mustLogicGateWorkHTTPUser(t, repo, companyID, "v4-mini-kanban-policy")
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	listReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/boards?company_id="+companyID, nil)
	listReq = requestWithLogicGateWorkActorForTest(listReq, user, companyID)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET projected kanban boards status = %d body=%s, want empty projection list", listRec.Code, listRec.Body.String())
	}
	var listPayload struct {
		Boards []domain.KanbanBoard `json:"boards"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode projected board list: %v", err)
	}
	if len(listPayload.Boards) != 0 {
		t.Fatalf("projected boards = %+v, want none without visible Logic Gates", listPayload.Boards)
	}

	for _, target := range []string{
		"/v1/kanban/columns?company_id=" + companyID + "&board_id=standalone-board",
		"/v1/kanban/cards?company_id=" + companyID + "&board_id=standalone-board",
	} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req = requestWithLogicGateWorkActorForTest(req, user, companyID)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "legacy_kanban_routes_disabled") {
			t.Fatalf("GET %s status = %d body=%s, want disabled 404", target, rec.Code, rec.Body.String())
		}
	}

	body, _ := json.Marshal(map[string]any{"company_id": companyID, "board_id": "standalone-board", "title": "Todo"})
	req := httptest.NewRequest(http.MethodPost, "/v1/kanban/columns", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = requestWithLogicGateWorkActorForTest(req, user, companyID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "legacy_kanban_routes_disabled") {
		t.Fatalf("POST standalone column status = %d body=%s, want disabled 404", rec.Code, rec.Body.String())
	}
}

func TestV4MiniPhase3KanbanBoardListProjectsVisibleLogicGates(t *testing.T) {
	t.Parallel()

	base := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777735"
	base.EnsureCompany(companyID, "V4 Mini Kanban Projection Co")
	viewer := mustLogicGateWorkHTTPUser(t, base, companyID, "v4-mini-kanban-projection-viewer")
	visible, err := base.CreateLogicGate(companyID, "Visible Projection Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate visible: %v", err)
	}
	hidden, err := base.CreateLogicGate(companyID, "Hidden Projection Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate hidden: %v", err)
	}
	if _, err := base.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   visible.LogicGateID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   viewer.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	if _, err := base.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   hidden.LogicGateID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   viewer.UserID,
			AccessLevel: store.EntityPermissionNoAccess,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions hidden projection gate: %v", err)
	}

	repo := &phase3ForbiddenKanbanBoardListRepo{Repository: base}
	server := NewServer(repo)
	defer server.Close()
	req := httptest.NewRequest(http.MethodGet, "/v1/kanban/boards?company_id="+companyID+"&limit=50", nil)
	req = requestWithLogicGateWorkActorForTest(req, viewer, companyID)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET projected kanban boards status = %d body=%s", rec.Code, rec.Body.String())
	}
	if repo.boardListCalls != 0 {
		t.Fatalf("projected board list loaded legacy Kanban boards %d times", repo.boardListCalls)
	}
	var payload struct {
		Boards []domain.KanbanBoard `json:"boards"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode projected board list: %v", err)
	}
	if len(payload.Boards) != 1 {
		t.Fatalf("projected boards = %+v, want only visible gate %s and not hidden %s", payload.Boards, visible.LogicGateID, hidden.LogicGateID)
	}
	board := payload.Boards[0]
	if board.BoardID != store.LogicGateKanbanBoardID(visible.LogicGateID) || board.LogicGateID == nil || *board.LogicGateID != visible.LogicGateID || board.Title != visible.Header {
		t.Fatalf("projected board = %+v, want visible Logic Gate board", board)
	}
}

func TestV4MiniPhase3WorkspaceSnapshotKanbanPayloadProjectsVisibleLogicGates(t *testing.T) {
	t.Parallel()

	base := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777736"
	base.EnsureCompany(companyID, "V4 Mini Kanban Snapshot Projection Co")
	viewer := mustLogicGateWorkHTTPUser(t, base, companyID, "v4-mini-kanban-snapshot-viewer")
	adminSubject := "v4-mini-kanban-snapshot-admin"
	admin, err := base.UpsertAuthUser(adminSubject, "v4-mini-kanban-snapshot-admin@example.com", "V4 Mini Kanban Snapshot Admin")
	if err != nil {
		t.Fatalf("UpsertAuthUser admin: %v", err)
	}
	if _, err := base.AddCompanyMembership(adminSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership admin: %v", err)
	}
	visible, err := base.CreateLogicGate(companyID, "Visible Snapshot Projection Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate visible: %v", err)
	}
	hidden, err := base.CreateLogicGate(companyID, "Hidden Snapshot Projection Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate hidden: %v", err)
	}
	if _, err := base.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   visible.LogicGateID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   viewer.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions visible snapshot gate: %v", err)
	}
	if _, err := base.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   hidden.LogicGateID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   viewer.UserID,
			AccessLevel: store.EntityPermissionNoAccess,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions hidden snapshot gate: %v", err)
	}

	repo := &phase3ForbiddenKanbanBoardListRepo{Repository: base}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	viewerReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=full&include_kanban_payloads=1", nil)
	viewerReq = requestWithLogicGateWorkActorForTest(viewerReq, viewer, companyID)
	viewerRec := httptest.NewRecorder()
	handler.ServeHTTP(viewerRec, viewerReq)
	if viewerRec.Code != http.StatusOK {
		t.Fatalf("viewer full workspace snapshot status = %d body=%s", viewerRec.Code, viewerRec.Body.String())
	}
	if repo.boardListCalls != 0 {
		t.Fatalf("viewer full workspace snapshot loaded legacy Kanban boards %d times", repo.boardListCalls)
	}
	viewerBody := viewerRec.Body.String()
	if strings.Contains(viewerBody, hidden.LogicGateID) || strings.Contains(viewerBody, store.LogicGateKanbanBoardID(hidden.LogicGateID)) || strings.Contains(viewerBody, hidden.Header) {
		t.Fatalf("viewer full workspace snapshot leaked hidden Logic Gate Kanban board: body=%s", viewerBody)
	}
	var viewerPayload struct {
		KanbanBoards []domain.KanbanBoard `json:"kanban_boards"`
	}
	if err := json.NewDecoder(strings.NewReader(viewerBody)).Decode(&viewerPayload); err != nil {
		t.Fatalf("decode viewer full workspace snapshot: %v body=%s", err, viewerBody)
	}
	if len(viewerPayload.KanbanBoards) != 1 {
		t.Fatalf("viewer kanban_boards = %+v, want only visible Logic Gate board", viewerPayload.KanbanBoards)
	}
	viewerBoard := viewerPayload.KanbanBoards[0]
	if viewerBoard.BoardID != store.LogicGateKanbanBoardID(visible.LogicGateID) || viewerBoard.LogicGateID == nil || *viewerBoard.LogicGateID != visible.LogicGateID || viewerBoard.Title != visible.Header {
		t.Fatalf("viewer kanban board = %+v, want visible Logic Gate board", viewerBoard)
	}

	adminReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=full&include_kanban_payloads=1", nil)
	adminReq = requestWithActorForTest(adminReq, admin, companyID)
	adminRec := httptest.NewRecorder()
	handler.ServeHTTP(adminRec, adminReq)
	if adminRec.Code != http.StatusOK {
		t.Fatalf("admin full workspace snapshot status = %d body=%s", adminRec.Code, adminRec.Body.String())
	}
	if repo.boardListCalls != 0 {
		t.Fatalf("admin full workspace snapshot loaded legacy Kanban boards %d times", repo.boardListCalls)
	}
	adminBody := adminRec.Body.String()
	var adminPayload struct {
		KanbanBoards []domain.KanbanBoard `json:"kanban_boards"`
	}
	if err := json.NewDecoder(strings.NewReader(adminBody)).Decode(&adminPayload); err != nil {
		t.Fatalf("decode admin full workspace snapshot: %v body=%s", err, adminBody)
	}
	if len(adminPayload.KanbanBoards) != 2 {
		t.Fatalf("admin kanban_boards = %+v, want both Logic Gate boards", adminPayload.KanbanBoards)
	}
	adminBoardsByID := make(map[string]domain.KanbanBoard, len(adminPayload.KanbanBoards))
	for _, board := range adminPayload.KanbanBoards {
		adminBoardsByID[board.BoardID] = board
	}
	for _, gate := range []domain.LogicGate{visible, hidden} {
		board, ok := adminBoardsByID[store.LogicGateKanbanBoardID(gate.LogicGateID)]
		if !ok || board.LogicGateID == nil || *board.LogicGateID != gate.LogicGateID || board.Title != gate.Header {
			t.Fatalf("admin kanban_boards = %+v, missing Logic Gate board for %+v", adminPayload.KanbanBoards, gate)
		}
	}
}

type phase3ForbiddenKanbanCardListRepo struct {
	store.Repository
	cardListCalls int
}

func (r *phase3ForbiddenKanbanCardListRepo) ListKanbanCards(companyID, boardID string, query store.KanbanCardQuery) ([]domain.KanbanCard, error) {
	r.cardListCalls++
	return nil, store.ErrInvalid
}

type phase3ForbiddenKanbanBoardListRepo struct {
	store.Repository
	boardListCalls int
}

func (r *phase3ForbiddenKanbanBoardListRepo) ListKanbanBoards(companyID string, query store.KanbanBoardQuery) ([]domain.KanbanBoard, error) {
	r.boardListCalls++
	return nil, store.ErrInvalid
}
