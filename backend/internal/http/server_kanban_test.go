package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/store"
)

func TestKanbanProjectionCompatibilityFlow(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{})
	companyID := "11111111-1111-4111-8111-111111111111"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	node, err := repo.CreateNode(companyID, "customer onboarding")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "approval gate")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}
	boardID := store.LogicGateKanbanBoardID(logicGate.LogicGateID)
	if _, err := repo.EnsureLogicGateKanbanBoard(companyID, logicGate.LogicGateID, logicGate.Header); err != nil {
		t.Fatalf("EnsureLogicGateKanbanBoard() error = %v", err)
	}

	columnsReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/columns?company_id="+companyID+"&board_id="+boardID, nil)
	columnsRec := httptest.NewRecorder()
	handler.ServeHTTP(columnsRec, columnsReq)
	if columnsRec.Code != http.StatusOK {
		t.Fatalf("GET kanban columns status = %d body=%s", columnsRec.Code, columnsRec.Body.String())
	}
	var columnsPayload struct {
		Columns []struct {
			ColumnID string `json:"column_id"`
			Title    string `json:"title"`
		} `json:"columns"`
	}
	if err := json.NewDecoder(columnsRec.Body).Decode(&columnsPayload); err != nil {
		t.Fatalf("decode columns: %v", err)
	}
	if len(columnsPayload.Columns) != 4 || columnsPayload.Columns[0].ColumnID != store.LogicGateWorkStatusPending || columnsPayload.Columns[3].ColumnID != store.LogicGateWorkStatusDone {
		t.Fatalf("columns = %+v, want synthesized logic-gate work statuses", columnsPayload.Columns)
	}

	priority := 3
	addCardBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   boardID,
		"column_id":  store.LogicGateWorkStatusPending,
		"node_id":    node.NodeID,
		"node_title": node.Title,
		"position":   1000,
		"priority":   priority,
	})
	addCardReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(addCardBody))
	addCardReq.Header.Set("Content-Type", "application/json")
	addCardRec := httptest.NewRecorder()
	handler.ServeHTTP(addCardRec, addCardReq)
	if addCardRec.Code != http.StatusCreated {
		t.Fatalf("POST kanban card status = %d body=%s", addCardRec.Code, addCardRec.Body.String())
	}
	var createdCard struct {
		CardID      string  `json:"card_id"`
		ColumnID    string  `json:"column_id"`
		NodeID      string  `json:"node_id"`
		LogicGateID *string `json:"logic_gate_id"`
	}
	if err := json.NewDecoder(addCardRec.Body).Decode(&createdCard); err != nil {
		t.Fatalf("decode created card: %v", err)
	}
	if createdCard.CardID == "" || createdCard.ColumnID != store.LogicGateWorkStatusPending || createdCard.NodeID != node.NodeID || createdCard.LogicGateID == nil || *createdCard.LogicGateID != logicGate.LogicGateID {
		t.Fatalf("created card = %+v, want projection card for assigned node", createdCard)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/cards?company_id="+companyID+"&board_id="+boardID+"&column_id="+store.LogicGateWorkStatusPending+"&limit=50", nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET kanban cards status = %d body=%s", listRec.Code, listRec.Body.String())
	}
	var listPayload struct {
		Cards []struct {
			CardID string `json:"card_id"`
			NodeID string `json:"node_id"`
		} `json:"cards"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode cards: %v", err)
	}
	if len(listPayload.Cards) != 1 || listPayload.Cards[0].CardID != createdCard.CardID {
		t.Fatalf("listed cards = %+v, want created projection card", listPayload.Cards)
	}

	moveBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   boardID,
		"column_id":  store.LogicGateWorkStatusDone,
		"is_issue":   true,
	})
	moveReq := httptest.NewRequest(http.MethodPut, "/v1/kanban/cards/"+createdCard.CardID, bytes.NewReader(moveBody))
	moveReq.Header.Set("Content-Type", "application/json")
	moveRec := httptest.NewRecorder()
	handler.ServeHTTP(moveRec, moveReq)
	if moveRec.Code != http.StatusOK {
		t.Fatalf("PUT kanban card status = %d body=%s", moveRec.Code, moveRec.Body.String())
	}
	var movedCard struct {
		ColumnID string `json:"column_id"`
		IsIssue  bool   `json:"is_issue"`
	}
	if err := json.NewDecoder(moveRec.Body).Decode(&movedCard); err != nil {
		t.Fatalf("decode moved card: %v", err)
	}
	if movedCard.ColumnID != store.LogicGateWorkStatusDone || !movedCard.IsIssue {
		t.Fatalf("moved card = %+v, want done issue card", movedCard)
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/kanban/cards/"+createdCard.CardID+"?company_id="+companyID+"&board_id="+boardID, nil)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE kanban card status = %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}
}

func TestKanbanBoardListReadsLogicGates(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{})
	companyID := "11111111-1111-4111-8111-333333333333"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	first, err := repo.CreateLogicGate(companyID, "First gate")
	if err != nil {
		t.Fatalf("CreateLogicGate first: %v", err)
	}
	second, err := repo.CreateLogicGate(companyID, "Second gate")
	if err != nil {
		t.Fatalf("CreateLogicGate second: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/kanban/boards?company_id="+companyID+"&limit=50", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET kanban boards status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Boards []struct {
			BoardID string `json:"board_id"`
			Title   string `json:"title"`
		} `json:"boards"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode boards: %v", err)
	}
	want := map[string]string{
		store.LogicGateKanbanBoardID(first.LogicGateID):  first.Header,
		store.LogicGateKanbanBoardID(second.LogicGateID): second.Header,
	}
	for _, board := range payload.Boards {
		delete(want, board.BoardID)
	}
	if len(want) != 0 {
		t.Fatalf("kanban boards = %+v, missing derived boards %+v", payload.Boards, want)
	}
}

func TestKanbanStandaloneLegacyRoutesAreDisabled(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{})
	companyID := "11111111-1111-4111-8111-222222222222"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	boardBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   "standalone-board",
		"title":      "Standalone board",
	})
	boardReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/boards", bytes.NewReader(boardBody))
	boardReq.Header.Set("Content-Type", "application/json")
	boardRec := httptest.NewRecorder()
	handler.ServeHTTP(boardRec, boardReq)
	if boardRec.Code != http.StatusNotFound {
		t.Fatalf("POST standalone board status = %d body=%s", boardRec.Code, boardRec.Body.String())
	}

	columnBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   "standalone-board",
		"title":      "Todo",
	})
	columnReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/columns", bytes.NewReader(columnBody))
	columnReq.Header.Set("Content-Type", "application/json")
	columnRec := httptest.NewRecorder()
	handler.ServeHTTP(columnRec, columnReq)
	if columnRec.Code != http.StatusNotFound {
		t.Fatalf("POST standalone column status = %d body=%s", columnRec.Code, columnRec.Body.String())
	}

	cardsReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/cards?company_id="+companyID+"&board_id=standalone-board", nil)
	cardsRec := httptest.NewRecorder()
	handler.ServeHTTP(cardsRec, cardsReq)
	if cardsRec.Code != http.StatusNotFound {
		t.Fatalf("GET standalone cards status = %d body=%s", cardsRec.Code, cardsRec.Body.String())
	}
}
