package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestKanbanColumnAndCardAPIFlow(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "11111111-1111-4111-8111-111111111111"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)
	boardID := "frame-kanban-api-test"

	node, err := repo.CreateNode(companyID, "customer onboarding")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "approval gate")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}

	createColumn := func(title string) string {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"company_id": companyID,
			"board_id":   boardID,
			"title":      title,
			"width_px":   280,
			"height_px":  240,
			"item_color": "#fea94e",
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/kanban/columns", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST kanban columns status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
		}
		var payload struct {
			ColumnID string `json:"column_id"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("decode column: %v", err)
		}
		return payload.ColumnID
	}

	todoColumnID := createColumn("Todo")
	doneColumnID := createColumn("Done")

	renameBody, _ := json.Marshal(map[string]string{
		"company_id": companyID,
		"board_id":   boardID,
		"title":      "Ready",
	})
	renameReq := httptest.NewRequest(http.MethodPut, "/v1/kanban/columns/"+todoColumnID, bytes.NewReader(renameBody))
	renameReq.Header.Set("Content-Type", "application/json")
	renameRec := httptest.NewRecorder()
	handler.ServeHTTP(renameRec, renameReq)
	if renameRec.Code != http.StatusOK {
		t.Fatalf("PUT kanban column status = %d, want %d body=%s", renameRec.Code, http.StatusOK, renameRec.Body.String())
	}
	layoutBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   boardID,
		"position":   777,
		"width_px":   340,
		"height_px":  220,
		"item_color": "#123abc",
	})
	layoutReq := httptest.NewRequest(http.MethodPut, "/v1/kanban/columns/"+todoColumnID, bytes.NewReader(layoutBody))
	layoutReq.Header.Set("Content-Type", "application/json")
	layoutRec := httptest.NewRecorder()
	handler.ServeHTTP(layoutRec, layoutReq)
	if layoutRec.Code != http.StatusOK {
		t.Fatalf("PUT kanban column layout status = %d, want %d body=%s", layoutRec.Code, http.StatusOK, layoutRec.Body.String())
	}
	var layoutPayload struct {
		Title    string `json:"title"`
		Position int    `json:"position"`
		WidthPx  int    `json:"width_px"`
		HeightPx int    `json:"height_px"`
		Color    string `json:"item_color"`
	}
	if err := json.NewDecoder(layoutRec.Body).Decode(&layoutPayload); err != nil {
		t.Fatalf("decode layout column: %v", err)
	}
	if layoutPayload.Title != "Ready" || layoutPayload.Position != 777 || layoutPayload.WidthPx != 340 || layoutPayload.HeightPx != 220 || layoutPayload.Color != "#123abc" {
		t.Fatalf("column layout = %+v, want title preserved with position/width/height/color update", layoutPayload)
	}

	addCardBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   boardID,
		"column_id":  todoColumnID,
		"node_id":    node.NodeID,
		"node_title": node.Title,
		"position":   1000,
	})
	addCardReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(addCardBody))
	addCardReq.Header.Set("Content-Type", "application/json")
	addCardRec := httptest.NewRecorder()
	handler.ServeHTTP(addCardRec, addCardReq)
	if addCardRec.Code != http.StatusCreated {
		t.Fatalf("POST kanban card status = %d, want %d body=%s", addCardRec.Code, http.StatusCreated, addCardRec.Body.String())
	}
	var createdCard struct {
		CardID   string `json:"card_id"`
		ColumnID string `json:"column_id"`
	}
	if err := json.NewDecoder(addCardRec.Body).Decode(&createdCard); err != nil {
		t.Fatalf("decode created card: %v", err)
	}
	if createdCard.ColumnID != todoColumnID {
		t.Fatalf("created card column = %q, want %q", createdCard.ColumnID, todoColumnID)
	}

	renameNodeBody, _ := json.Marshal(map[string]string{
		"company_id": companyID,
		"title":      "customer onboarding renamed",
	})
	renameNodeReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+node.NodeID, bytes.NewReader(renameNodeBody))
	renameNodeReq.Header.Set("Content-Type", "application/json")
	renameNodeRec := httptest.NewRecorder()
	handler.ServeHTTP(renameNodeRec, renameNodeReq)
	if renameNodeRec.Code != http.StatusOK {
		t.Fatalf("PUT node title before kanban upsert status = %d, want %d body=%s", renameNodeRec.Code, http.StatusOK, renameNodeRec.Body.String())
	}

	upsertCardBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   boardID,
		"column_id":  doneColumnID,
		"node_id":    node.NodeID,
		"node_title": "customer onboarding renamed",
		"position":   1000,
	})
	upsertCardReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(upsertCardBody))
	upsertCardReq.Header.Set("Content-Type", "application/json")
	upsertCardRec := httptest.NewRecorder()
	handler.ServeHTTP(upsertCardRec, upsertCardReq)
	if upsertCardRec.Code != http.StatusCreated {
		t.Fatalf("POST kanban card upsert status = %d, want %d body=%s", upsertCardRec.Code, http.StatusCreated, upsertCardRec.Body.String())
	}
	var upsertedCard struct {
		CardID    string `json:"card_id"`
		ColumnID  string `json:"column_id"`
		NodeTitle string `json:"node_title"`
	}
	if err := json.NewDecoder(upsertCardRec.Body).Decode(&upsertedCard); err != nil {
		t.Fatalf("decode upserted card: %v", err)
	}
	if upsertedCard.CardID != createdCard.CardID {
		t.Fatalf("upsert card id = %q, want existing %q", upsertedCard.CardID, createdCard.CardID)
	}
	if upsertedCard.ColumnID != doneColumnID || upsertedCard.NodeTitle != "customer onboarding renamed" {
		t.Fatalf("upserted card = %+v, want moved/renamed", upsertedCard)
	}

	addGateCardBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   boardID,
		"column_id":  doneColumnID,
		"node_id":    logicGate.LogicGateID,
		"node_title": logicGate.Header,
	})
	addGateCardReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(addGateCardBody))
	addGateCardReq.Header.Set("Content-Type", "application/json")
	addGateCardRec := httptest.NewRecorder()
	handler.ServeHTTP(addGateCardRec, addGateCardReq)
	if addGateCardRec.Code != http.StatusNotFound {
		t.Fatalf("POST logic-gate kanban card status = %d, want %d body=%s", addGateCardRec.Code, http.StatusNotFound, addGateCardRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/cards?company_id="+companyID+"&board_id="+boardID+"&column_id="+doneColumnID+"&limit=50", nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET kanban cards status = %d, want %d body=%s", listRec.Code, http.StatusOK, listRec.Body.String())
	}
	var listPayload struct {
		Cards []struct {
			NodeID    string `json:"node_id"`
			NodeTitle string `json:"node_title"`
		} `json:"cards"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode cards: %v", err)
	}
	if len(listPayload.Cards) != 1 {
		t.Fatalf("kanban card count = %d, want 1 node card", len(listPayload.Cards))
	}
	if listPayload.Cards[0].NodeTitle != "customer onboarding renamed" {
		t.Fatalf("listed card node_title = %q, want renamed node title", listPayload.Cards[0].NodeTitle)
	}

	listBoardsReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/boards?company_id="+companyID+"&limit=50", nil)
	listBoardsRec := httptest.NewRecorder()
	handler.ServeHTTP(listBoardsRec, listBoardsReq)
	if listBoardsRec.Code != http.StatusOK {
		t.Fatalf("GET kanban boards status = %d, want %d body=%s", listBoardsRec.Code, http.StatusOK, listBoardsRec.Body.String())
	}
	var listBoardsPayload struct {
		Boards []struct {
			BoardID string `json:"board_id"`
			Title   string `json:"title"`
		} `json:"boards"`
	}
	if err := json.NewDecoder(listBoardsRec.Body).Decode(&listBoardsPayload); err != nil {
		t.Fatalf("decode boards: %v", err)
	}
	foundImplicitBoard := false
	for _, board := range listBoardsPayload.Boards {
		if board.BoardID == boardID {
			foundImplicitBoard = true
			break
		}
	}
	if !foundImplicitBoard {
		t.Fatalf("kanban boards = %+v, want implicit board metadata for %q", listBoardsPayload.Boards, boardID)
	}

	filterReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/cards?company_id="+companyID+"&board_id="+boardID+"&status=Done&limit=50", nil)
	filterRec := httptest.NewRecorder()
	handler.ServeHTTP(filterRec, filterReq)
	if filterRec.Code != http.StatusBadRequest {
		t.Fatalf("GET kanban cards with removed filter status = %d, want %d body=%s", filterRec.Code, http.StatusBadRequest, filterRec.Body.String())
	}

	pagedReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/cards?company_id="+companyID+"&board_id="+boardID+"&column_id="+doneColumnID+"&after_position=1000&limit=50", nil)
	pagedRec := httptest.NewRecorder()
	handler.ServeHTTP(pagedRec, pagedReq)
	if pagedRec.Code != http.StatusOK {
		t.Fatalf("GET paged kanban cards status = %d, want %d body=%s", pagedRec.Code, http.StatusOK, pagedRec.Body.String())
	}
	var pagedPayload struct {
		Cards []struct {
			NodeID string `json:"node_id"`
		} `json:"cards"`
	}
	if err := json.NewDecoder(pagedRec.Body).Decode(&pagedPayload); err != nil {
		t.Fatalf("decode paged cards: %v", err)
	}
	if len(pagedPayload.Cards) != 0 {
		t.Fatalf("paged cards = %+v, want none after position 1000", pagedPayload.Cards)
	}

	deleteColumnID := createColumn("Temporary")
	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/kanban/columns/"+deleteColumnID+"?company_id="+companyID+"&board_id="+boardID, nil)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE kanban column status = %d, want %d body=%s", deleteRec.Code, http.StatusOK, deleteRec.Body.String())
	}
}

func TestKanbanBoardAPIFlow(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-333333333333"
	boardID := "ops-kanban-board"

	saveBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   boardID,
		"title":      "Operations board",
	})
	saveReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/boards", bytes.NewReader(saveBody))
	saveReq.Header.Set("Content-Type", "application/json")
	saveRec := httptest.NewRecorder()
	handler.ServeHTTP(saveRec, saveReq)
	if saveRec.Code != http.StatusCreated {
		t.Fatalf("POST kanban board status = %d, want %d body=%s", saveRec.Code, http.StatusCreated, saveRec.Body.String())
	}
	var saved struct {
		BoardID  string `json:"board_id"`
		Title    string `json:"title"`
		Position int    `json:"position"`
	}
	if err := json.NewDecoder(saveRec.Body).Decode(&saved); err != nil {
		t.Fatalf("decode saved board: %v", err)
	}
	if saved.BoardID != boardID || saved.Title != "Operations board" || saved.Position <= 0 {
		t.Fatalf("saved board = %+v, want durable named board", saved)
	}

	updateBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"title":      "Operations board renamed",
		"position":   777,
	})
	updateReq := httptest.NewRequest(http.MethodPut, "/v1/kanban/boards/"+boardID, bytes.NewReader(updateBody))
	updateReq.Header.Set("Content-Type", "application/json")
	updateRec := httptest.NewRecorder()
	handler.ServeHTTP(updateRec, updateReq)
	if updateRec.Code != http.StatusOK {
		t.Fatalf("PUT kanban board status = %d, want %d body=%s", updateRec.Code, http.StatusOK, updateRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/boards?company_id="+companyID+"&after_position=700&limit=50", nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET kanban boards status = %d, want %d body=%s", listRec.Code, http.StatusOK, listRec.Body.String())
	}
	var listPayload struct {
		Boards []struct {
			BoardID  string `json:"board_id"`
			Title    string `json:"title"`
			Position int    `json:"position"`
		} `json:"boards"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode board list: %v", err)
	}
	if len(listPayload.Boards) != 1 || listPayload.Boards[0].BoardID != boardID || listPayload.Boards[0].Title != "Operations board renamed" || listPayload.Boards[0].Position != 777 {
		t.Fatalf("listed boards = %+v, want updated paged board", listPayload.Boards)
	}

	folderBody, _ := json.Marshal(map[string]any{
		"company_id":  companyID,
		"folder_kind": "node",
		"name":        "Delivery",
	})
	folderReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders", bytes.NewReader(folderBody))
	folderReq.Header.Set("Content-Type", "application/json")
	folderRec := httptest.NewRecorder()
	handler.ServeHTTP(folderRec, folderReq)
	if folderRec.Code != http.StatusCreated {
		t.Fatalf("POST explorer folder status = %d, want %d body=%s", folderRec.Code, http.StatusCreated, folderRec.Body.String())
	}
	var folder struct {
		FolderID string `json:"folder_id"`
	}
	if err := json.NewDecoder(folderRec.Body).Decode(&folder); err != nil {
		t.Fatalf("decode folder: %v", err)
	}

	assignBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"folder_id":  folder.FolderID,
		"item_type":  "kanban",
		"item_id":    boardID,
	})
	assignReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folder-items", bytes.NewReader(assignBody))
	assignReq.Header.Set("Content-Type", "application/json")
	assignRec := httptest.NewRecorder()
	handler.ServeHTTP(assignRec, assignReq)
	if assignRec.Code != http.StatusBadRequest {
		t.Fatalf("POST kanban explorer folder item status = %d, want %d body=%s", assignRec.Code, http.StatusBadRequest, assignRec.Body.String())
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/kanban/boards/"+boardID+"?company_id="+companyID, nil)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE kanban board status = %d, want %d body=%s", deleteRec.Code, http.StatusOK, deleteRec.Body.String())
	}
	itemsReq := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/folder-items?company_id="+companyID+"&item_type=kanban", nil)
	itemsRec := httptest.NewRecorder()
	handler.ServeHTTP(itemsRec, itemsReq)
	if itemsRec.Code != http.StatusBadRequest {
		t.Fatalf("GET kanban explorer items status = %d, want %d body=%s", itemsRec.Code, http.StatusBadRequest, itemsRec.Body.String())
	}
}

func TestKanbanCardAPIUsesNodeOnlyCardsAndRemovesQueryEndpoint(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-222222222222"
	boardID := "frame-kanban-query-test"

	nodeA, err := repo.CreateNode(companyID, "Alpha task")
	if err != nil {
		t.Fatalf("CreateNode Alpha error = %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Beta task")
	if err != nil {
		t.Fatalf("CreateNode Beta error = %v", err)
	}

	createColumn := func(title string) string {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"company_id": companyID, "board_id": boardID, "title": title})
		req := httptest.NewRequest(http.MethodPost, "/v1/kanban/columns", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST kanban column status = %d body=%s", rec.Code, rec.Body.String())
		}
		var payload struct {
			ColumnID string `json:"column_id"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("decode column: %v", err)
		}
		return payload.ColumnID
	}

	readyColumnID := createColumn("Ready")
	doneColumnID := createColumn("Done")
	postCard := func(nodeID, title string) string {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"company_id":           companyID,
			"board_id":             boardID,
			"column_id":            readyColumnID,
			"node_id":              nodeID,
			"node_title":           title,
			"description_snapshot": "longer API-visible text",
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST kanban card status = %d body=%s", rec.Code, rec.Body.String())
		}
		var payload struct {
			CardID              string `json:"card_id"`
			NodeID              string `json:"node_id"`
			NodeTitle           string `json:"node_title"`
			DescriptionSnapshot string `json:"description_snapshot"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("decode card: %v", err)
		}
		if payload.NodeID != nodeID || payload.NodeTitle != title || payload.DescriptionSnapshot != "longer API-visible text" {
			t.Fatalf("card payload = %+v, want node-only card fields", payload)
		}
		return payload.CardID
	}

	cardAID := postCard(nodeA.NodeID, "Alpha task")
	postCard(nodeB.NodeID, "Beta task")

	listReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/cards?company_id="+companyID+"&board_id="+boardID+"&column_id="+readyColumnID+"&limit=50", nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET kanban cards status = %d body=%s", listRec.Code, listRec.Body.String())
	}
	var listPayload struct {
		Cards []struct {
			CardID    string `json:"card_id"`
			NodeID    string `json:"node_id"`
			NodeTitle string `json:"node_title"`
		} `json:"cards"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode list payload: %v", err)
	}
	if len(listPayload.Cards) != 2 || listPayload.Cards[0].NodeID != nodeA.NodeID || listPayload.Cards[0].NodeTitle != "Alpha task" {
		t.Fatalf("list cards = %+v, want ordered node-only cards", listPayload.Cards)
	}

	queryReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/query", bytes.NewReader([]byte(`{}`)))
	queryReq.Header.Set("Content-Type", "application/json")
	queryRec := httptest.NewRecorder()
	handler.ServeHTTP(queryRec, queryReq)
	if queryRec.Code != http.StatusNotFound {
		t.Fatalf("POST kanban query status = %d, want removed route 404 body=%s", queryRec.Code, queryRec.Body.String())
	}

	moveBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"board_id":   boardID,
		"column_id":  doneColumnID,
	})
	moveReq := httptest.NewRequest(http.MethodPut, "/v1/kanban/cards/"+cardAID, bytes.NewReader(moveBody))
	moveReq.Header.Set("Content-Type", "application/json")
	moveRec := httptest.NewRecorder()
	handler.ServeHTTP(moveRec, moveReq)
	if moveRec.Code != http.StatusOK {
		t.Fatalf("PUT kanban card move status = %d body=%s", moveRec.Code, moveRec.Body.String())
	}
	var moved struct {
		ColumnID  string `json:"column_id"`
		NodeTitle string `json:"node_title"`
	}
	if err := json.NewDecoder(moveRec.Body).Decode(&moved); err != nil {
		t.Fatalf("decode moved card: %v", err)
	}
	if moved.ColumnID != doneColumnID || moved.NodeTitle != "Alpha task" {
		t.Fatalf("moved card = %+v, want column changed without metadata fields", moved)
	}
}

type appendForbiddenKanbanRepo struct {
	*store.MemoryRepo
	appendCalls int
}

func (r *appendForbiddenKanbanRepo) AppendDomainEvent(input store.DomainEventInput) (domain.DomainEvent, error) {
	r.appendCalls++
	return domain.DomainEvent{}, errors.New("legacy append forbidden")
}

type failingKanbanCardWorkspaceEventRepo struct {
	*store.MemoryRepo
	err error
}

func (r *failingKanbanCardWorkspaceEventRepo) UpsertKanbanCardWithWorkspaceEvent(input store.KanbanCardMutationInput) (store.KanbanCardWorkspaceEventResult, error) {
	return store.KanbanCardWorkspaceEventResult{}, r.err
}

func TestKanbanHTTPPublishesCommittedWorkspaceEventsWithoutLegacyAppend(t *testing.T) {
	repo := &appendForbiddenKanbanRepo{MemoryRepo: store.NewMemoryRepo()}
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "14141414-1414-4141-8141-141414141414"
	boardID := "http-committed-kanban-events"

	stream := server.hub.subscribe(companyID)
	defer server.hub.unsubscribe(companyID, stream)

	columnBody, _ := json.Marshal(map[string]any{"company_id": companyID, "board_id": boardID, "title": "Ready"})
	columnReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/columns", bytes.NewReader(columnBody))
	columnReq.Header.Set("Content-Type", "application/json")
	columnRec := httptest.NewRecorder()
	handler.ServeHTTP(columnRec, columnReq)
	if columnRec.Code != http.StatusCreated {
		t.Fatalf("POST kanban column status = %d body=%s", columnRec.Code, columnRec.Body.String())
	}
	var column struct {
		ColumnID string `json:"column_id"`
	}
	if err := json.NewDecoder(columnRec.Body).Decode(&column); err != nil {
		t.Fatalf("decode column: %v", err)
	}
	columnEvent := readWorkspaceEventForTest(t, stream)
	if columnEvent.Type != "kanban_column_created" || columnEvent.Data["board_id"] != boardID || columnEvent.Data["column_id"] != column.ColumnID {
		t.Fatalf("column event = %+v", columnEvent)
	}
	if repo.appendCalls != 0 {
		t.Fatalf("HTTP called legacy AppendDomainEvent %d times, want committed-event publish only", repo.appendCalls)
	}

	node, err := repo.CreateNode(companyID, "HTTP committed event node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	cardBody, _ := json.Marshal(map[string]any{"company_id": companyID, "board_id": boardID, "column_id": column.ColumnID, "node_id": node.NodeID, "node_title": node.Title})
	cardReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(cardBody))
	cardReq.Header.Set("Content-Type", "application/json")
	cardRec := httptest.NewRecorder()
	handler.ServeHTTP(cardRec, cardReq)
	if cardRec.Code != http.StatusCreated {
		t.Fatalf("POST kanban card status = %d body=%s", cardRec.Code, cardRec.Body.String())
	}
	var card struct {
		CardID string `json:"card_id"`
	}
	if err := json.NewDecoder(cardRec.Body).Decode(&card); err != nil {
		t.Fatalf("decode card: %v", err)
	}
	cardEvent := readWorkspaceEventForTest(t, stream)
	if cardEvent.Type != "kanban_card_upserted" || cardEvent.Data["board_id"] != boardID || cardEvent.Data["card_id"] != card.CardID {
		t.Fatalf("card event = %+v", cardEvent)
	}
	if repo.appendCalls != 0 {
		t.Fatalf("HTTP called legacy AppendDomainEvent %d times, want committed-event publish only", repo.appendCalls)
	}

	durable, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 10})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(durable) != 2 || durable[0].Type != "kanban_column_created" || durable[1].Type != "kanban_card_upserted" {
		t.Fatalf("durable events = %+v, want committed column/card events", durable)
	}
}

func TestKanbanHTTPDoesNotPublishHubEventWhenAtomicMutationFails(t *testing.T) {
	companyID := "15151515-1515-4151-8151-151515151515"
	repo := &failingKanbanCardWorkspaceEventRepo{MemoryRepo: store.NewMemoryRepo(), err: errors.New("commit failed")}
	server := NewServer(repo)
	stream := server.hub.subscribe(companyID)
	defer server.hub.unsubscribe(companyID, stream)

	body, _ := json.Marshal(map[string]any{"company_id": companyID, "board_id": "board", "column_id": "column", "node_id": "node", "node_title": "node"})
	req := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("POST kanban card status = %d body=%s, want 500", rec.Code, rec.Body.String())
	}

	select {
	case payload := <-stream:
		t.Fatalf("hub published payload for failed atomic Kanban mutation: %s", string(payload))
	case <-time.After(100 * time.Millisecond):
	}
}
