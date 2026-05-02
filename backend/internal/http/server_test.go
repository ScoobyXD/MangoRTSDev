package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/store"
)

func TestIsLegalNodeRelationshipPositionPair(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		a    string
		b    string
		want bool
	}{
		{name: "parent_child", a: "Parent", b: "Child", want: true},
		{name: "child_parent", a: "Child", b: "Parent", want: true},
		{name: "peer_peer", a: "Peer", b: "Peer", want: true},
		{name: "parent_parent", a: "Parent", b: "Parent", want: false},
		{name: "child_child", a: "Child", b: "Child", want: false},
		{name: "parent_peer", a: "Parent", b: "Peer", want: false},
		{name: "peer_child", a: "Peer", b: "Child", want: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := isLegalNodeRelationshipPositionPair(tc.a, tc.b)
			if got != tc.want {
				t.Fatalf("isLegalNodeRelationshipPositionPair(%q, %q) = %t, want %t", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

func TestIsLegalLogicGateRelationshipPositionPair(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		a    string
		b    string
		want bool
	}{
		{name: "input_output", a: "Input", b: "Output", want: true},
		{name: "output_input", a: "Output", b: "Input", want: true},
		{name: "input_input", a: "Input", b: "Input", want: false},
		{name: "output_output", a: "Output", b: "Output", want: false},
		{name: "input_peer", a: "Input", b: "Peer", want: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := isLegalLogicGateRelationshipPositionPair(tc.a, tc.b)
			if got != tc.want {
				t.Fatalf("isLegalLogicGateRelationshipPositionPair(%q, %q) = %t, want %t", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

func TestLogicGateCRUDRelationshipAndInformationAPI(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-logic-gate-test"

	createGate := func(header string) string {
		t.Helper()
		body, _ := json.Marshal(map[string]string{
			"company_id": companyID,
			"header":     header,
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/logic-gates", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST logic-gates status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
		}
		var payload struct {
			LogicGateID string `json:"logic_gate_id"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("decode created gate: %v", err)
		}
		return payload.LogicGateID
	}

	firstID := createGate("new logic gate")
	secondID := createGate("second logic gate")

	relationshipBody, _ := json.Marshal(map[string]string{
		"company_id":      companyID,
		"logic_gate_id_a": firstID,
		"logic_gate_id_b": secondID,
		"a_position":      "Output",
		"b_position":      "Input",
	})
	relationshipReq := httptest.NewRequest(http.MethodPost, "/v1/logic-gate-relationships", bytes.NewReader(relationshipBody))
	relationshipReq.Header.Set("Content-Type", "application/json")
	relationshipRec := httptest.NewRecorder()
	handler.ServeHTTP(relationshipRec, relationshipReq)
	if relationshipRec.Code != http.StatusCreated {
		t.Fatalf("POST logic-gate-relationships status = %d, want %d body=%s", relationshipRec.Code, http.StatusCreated, relationshipRec.Body.String())
	}

	invalidRelationshipBody, _ := json.Marshal(map[string]string{
		"company_id":      companyID,
		"logic_gate_id_a": firstID,
		"logic_gate_id_b": secondID,
		"a_position":      "Input",
		"b_position":      "Input",
	})
	invalidRelationshipReq := httptest.NewRequest(http.MethodPost, "/v1/logic-gate-relationships", bytes.NewReader(invalidRelationshipBody))
	invalidRelationshipReq.Header.Set("Content-Type", "application/json")
	invalidRelationshipRec := httptest.NewRecorder()
	handler.ServeHTTP(invalidRelationshipRec, invalidRelationshipReq)
	if invalidRelationshipRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid relationship status = %d, want %d", invalidRelationshipRec.Code, http.StatusBadRequest)
	}

	infoBody, _ := json.Marshal(map[string]string{
		"company_id":     companyID,
		"type":           "Text box",
		"information":    "logic gate notes",
		"information_id": "33333333-3333-4333-8333-333333333333",
	})
	infoReq := httptest.NewRequest(http.MethodPost, "/v1/logic-gates/"+firstID+"/information", bytes.NewReader(infoBody))
	infoReq.Header.Set("Content-Type", "application/json")
	infoRec := httptest.NewRecorder()
	handler.ServeHTTP(infoRec, infoReq)
	if infoRec.Code != http.StatusCreated {
		t.Fatalf("POST logic gate information status = %d, want %d body=%s", infoRec.Code, http.StatusCreated, infoRec.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gates/"+firstID+"?company_id="+companyID, nil)
	getRec := httptest.NewRecorder()
	handler.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET logic gate details status = %d, want %d body=%s", getRec.Code, http.StatusOK, getRec.Body.String())
	}
	var details struct {
		Information   []any `json:"information"`
		Relationships []any `json:"relationships"`
	}
	if err := json.NewDecoder(getRec.Body).Decode(&details); err != nil {
		t.Fatalf("decode details: %v", err)
	}
	if len(details.Information) != 1 || len(details.Relationships) != 1 {
		t.Fatalf("details counts = information:%d relationships:%d, want 1/1", len(details.Information), len(details.Relationships))
	}
}

func TestLogicGateInformationProjectionAPIKeepsLatestValueAndHistory(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-logic-gate-projection-test"

	logicGate, err := repo.CreateLogicGate(companyID, "logic gate with projected notes")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}

	postInformation := func(value string) {
		t.Helper()
		body, _ := json.Marshal(map[string]string{
			"company_id":     companyID,
			"type":           "Text box",
			"information":    value,
			"information_id": "66666666-6666-4666-8666-666666666666",
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/logic-gates/"+logicGate.LogicGateID+"/information", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST logic-gate information status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
		}
	}

	postInformation("first logic gate note")
	postInformation("second logic gate note")

	projectionReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gates/"+logicGate.LogicGateID+"/projection?company_id="+companyID, nil)
	projectionRec := httptest.NewRecorder()
	handler.ServeHTTP(projectionRec, projectionReq)
	if projectionRec.Code != http.StatusOK {
		t.Fatalf("GET logic-gate projection status = %d, want %d body=%s", projectionRec.Code, http.StatusOK, projectionRec.Body.String())
	}
	var projectionPayload struct {
		Items []struct {
			InformationID string `json:"information_id"`
			Information   string `json:"information"`
		} `json:"items"`
	}
	if err := json.NewDecoder(projectionRec.Body).Decode(&projectionPayload); err != nil {
		t.Fatalf("decode projection: %v", err)
	}
	if len(projectionPayload.Items) != 1 {
		t.Fatalf("projection item count = %d, want 1", len(projectionPayload.Items))
	}
	if projectionPayload.Items[0].InformationID != "66666666-6666-4666-8666-666666666666" {
		t.Fatalf("projection information_id = %q, want stable key", projectionPayload.Items[0].InformationID)
	}
	if projectionPayload.Items[0].Information != "second logic gate note" {
		t.Fatalf("projection information = %q, want latest value", projectionPayload.Items[0].Information)
	}

	details, err := repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails() error = %v", err)
	}
	if len(details.Information) != 2 {
		t.Fatalf("logic gate history row count = %d, want 2", len(details.Information))
	}
}

func TestInformationAPIsRejectBlankInformation(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-no-blank-information-test"

	node, err := repo.CreateNode(companyID, "node with editor")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "logic gate with editor")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}

	postBlank := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		body, _ := json.Marshal(map[string]string{
			"company_id":     companyID,
			"type":           "Text box",
			"information":    " \n\t ",
			"information_id": "44444444-4444-4444-8444-444444444444",
		})
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	nodeRec := postBlank("/v1/nodes/" + node.NodeID + "/information")
	if nodeRec.Code != http.StatusBadRequest {
		t.Fatalf("blank node information status = %d, want %d body=%s", nodeRec.Code, http.StatusBadRequest, nodeRec.Body.String())
	}
	logicGateRec := postBlank("/v1/logic-gates/" + logicGate.LogicGateID + "/information")
	if logicGateRec.Code != http.StatusBadRequest {
		t.Fatalf("blank logic gate information status = %d, want %d body=%s", logicGateRec.Code, http.StatusBadRequest, logicGateRec.Body.String())
	}

	nodeDetails, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails() error = %v", err)
	}
	if len(nodeDetails.Information) != 0 {
		t.Fatalf("blank node information was stored; got %d rows", len(nodeDetails.Information))
	}
	logicGateDetails, err := repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails() error = %v", err)
	}
	if len(logicGateDetails.Information) != 0 {
		t.Fatalf("blank logic gate information was stored; got %d rows", len(logicGateDetails.Information))
	}
}

func TestCompanyExplorerFolderAPIsSupportNestedFoldersAndMembership(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-folder-api-test"

	node, err := repo.CreateNode(companyID, "Foldered node")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}

	createFolder := func(name, parentFolderID string) string {
		t.Helper()
		body, _ := json.Marshal(map[string]string{
			"company_id":       companyID,
			"parent_folder_id": parentFolderID,
			"folder_kind":      "node",
			"name":             name,
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST company explorer folders status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
		}
		var payload struct {
			FolderID string `json:"folder_id"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("decode folder: %v", err)
		}
		if payload.FolderID == "" {
			t.Fatalf("folder_id was empty")
		}
		return payload.FolderID
	}

	parentID := createFolder("Customers", "")
	childID := createFolder("Onboarding", parentID)
	siblingID := createFolder("Escalations", parentID)

	moveBody, _ := json.Marshal(map[string]string{
		"company_id":       companyID,
		"parent_folder_id": siblingID,
	})
	moveReq := httptest.NewRequest(http.MethodPut, "/v1/company-explorer/folders/"+childID, bytes.NewReader(moveBody))
	moveReq.Header.Set("Content-Type", "application/json")
	moveRec := httptest.NewRecorder()
	handler.ServeHTTP(moveRec, moveReq)
	if moveRec.Code != http.StatusOK {
		t.Fatalf("PUT company explorer folder status = %d, want %d body=%s", moveRec.Code, http.StatusOK, moveRec.Body.String())
	}
	var movedFolder struct {
		ParentFolderID *string `json:"parent_folder_id"`
	}
	if err := json.NewDecoder(moveRec.Body).Decode(&movedFolder); err != nil {
		t.Fatalf("decode moved folder: %v", err)
	}
	if movedFolder.ParentFolderID == nil || *movedFolder.ParentFolderID != siblingID {
		t.Fatalf("moved folder parent = %v, want %s", movedFolder.ParentFolderID, siblingID)
	}

	cycleBody, _ := json.Marshal(map[string]string{
		"company_id":       companyID,
		"parent_folder_id": childID,
	})
	cycleReq := httptest.NewRequest(http.MethodPut, "/v1/company-explorer/folders/"+siblingID, bytes.NewReader(cycleBody))
	cycleReq.Header.Set("Content-Type", "application/json")
	cycleRec := httptest.NewRecorder()
	handler.ServeHTTP(cycleRec, cycleReq)
	if cycleRec.Code != http.StatusBadRequest {
		t.Fatalf("cyclic PUT company explorer folder status = %d, want %d body=%s", cycleRec.Code, http.StatusBadRequest, cycleRec.Body.String())
	}

	assignBody, _ := json.Marshal(map[string]string{
		"company_id": companyID,
		"folder_id":  childID,
		"item_type":  "node",
		"item_id":    node.NodeID,
	})
	assignReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folder-items", bytes.NewReader(assignBody))
	assignReq.Header.Set("Content-Type", "application/json")
	assignRec := httptest.NewRecorder()
	handler.ServeHTTP(assignRec, assignReq)
	if assignRec.Code != http.StatusOK {
		t.Fatalf("POST company explorer folder-items status = %d, want %d body=%s", assignRec.Code, http.StatusOK, assignRec.Body.String())
	}

	itemsReq := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/folder-items?company_id="+companyID+"&folder_id="+childID+"&item_type=node", nil)
	itemsRec := httptest.NewRecorder()
	handler.ServeHTTP(itemsRec, itemsReq)
	if itemsRec.Code != http.StatusOK {
		t.Fatalf("GET company explorer folder-items status = %d, want %d body=%s", itemsRec.Code, http.StatusOK, itemsRec.Body.String())
	}
	var itemsPayload struct {
		Items []struct {
			FolderID string `json:"folder_id"`
			ItemType string `json:"item_type"`
			ItemID   string `json:"item_id"`
		} `json:"folder_items"`
	}
	if err := json.NewDecoder(itemsRec.Body).Decode(&itemsPayload); err != nil {
		t.Fatalf("decode folder items: %v", err)
	}
	if len(itemsPayload.Items) != 1 || itemsPayload.Items[0].FolderID != childID || itemsPayload.Items[0].ItemID != node.NodeID {
		t.Fatalf("folder item payload = %+v, want node in child folder", itemsPayload.Items)
	}

	snapshotReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID, nil)
	snapshotRec := httptest.NewRecorder()
	handler.ServeHTTP(snapshotRec, snapshotReq)
	if snapshotRec.Code != http.StatusOK {
		t.Fatalf("GET workspace snapshot status = %d, want %d body=%s", snapshotRec.Code, http.StatusOK, snapshotRec.Body.String())
	}
	var snapshot struct {
		Folders []struct {
			FolderID       string  `json:"folder_id"`
			ParentFolderID *string `json:"parent_folder_id"`
		} `json:"folders"`
		FolderItems []struct {
			FolderID string `json:"folder_id"`
			ItemID   string `json:"item_id"`
		} `json:"folder_items"`
	}
	if err := json.NewDecoder(snapshotRec.Body).Decode(&snapshot); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	if len(snapshot.Folders) != 3 || len(snapshot.FolderItems) != 1 {
		t.Fatalf("snapshot folder counts = folders:%d items:%d, want 3/1", len(snapshot.Folders), len(snapshot.FolderItems))
	}
	foundChild := false
	for _, folder := range snapshot.Folders {
		if folder.FolderID == childID && folder.ParentFolderID != nil && *folder.ParentFolderID == siblingID {
			foundChild = true
		}
	}
	if !foundChild {
		t.Fatalf("snapshot did not preserve moved child folder parent")
	}
}

func TestKanbanColumnAndCardAPIFlow(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "11111111-1111-4111-8111-111111111111"
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

	addCardBody, _ := json.Marshal(map[string]any{
		"company_id":     companyID,
		"board_id":       boardID,
		"column_id":      todoColumnID,
		"item_type":      "node",
		"item_id":        node.NodeID,
		"title_snapshot": node.Title,
		"position":       1000,
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

	upsertCardBody, _ := json.Marshal(map[string]any{
		"company_id":     companyID,
		"board_id":       boardID,
		"column_id":      doneColumnID,
		"item_type":      "node",
		"item_id":        node.NodeID,
		"title_snapshot": "customer onboarding renamed",
		"position":       1000,
	})
	upsertCardReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(upsertCardBody))
	upsertCardReq.Header.Set("Content-Type", "application/json")
	upsertCardRec := httptest.NewRecorder()
	handler.ServeHTTP(upsertCardRec, upsertCardReq)
	if upsertCardRec.Code != http.StatusCreated {
		t.Fatalf("POST kanban card upsert status = %d, want %d body=%s", upsertCardRec.Code, http.StatusCreated, upsertCardRec.Body.String())
	}
	var upsertedCard struct {
		CardID        string `json:"card_id"`
		ColumnID      string `json:"column_id"`
		TitleSnapshot string `json:"title_snapshot"`
	}
	if err := json.NewDecoder(upsertCardRec.Body).Decode(&upsertedCard); err != nil {
		t.Fatalf("decode upserted card: %v", err)
	}
	if upsertedCard.CardID != createdCard.CardID {
		t.Fatalf("upsert card id = %q, want existing %q", upsertedCard.CardID, createdCard.CardID)
	}
	if upsertedCard.ColumnID != doneColumnID || upsertedCard.TitleSnapshot != "customer onboarding renamed" {
		t.Fatalf("upserted card = %+v, want moved/renamed", upsertedCard)
	}

	addGateCardBody, _ := json.Marshal(map[string]any{
		"company_id":     companyID,
		"board_id":       boardID,
		"column_id":      doneColumnID,
		"item_type":      "logic_gate",
		"item_id":        logicGate.LogicGateID,
		"title_snapshot": logicGate.Header,
	})
	addGateCardReq := httptest.NewRequest(http.MethodPost, "/v1/kanban/cards", bytes.NewReader(addGateCardBody))
	addGateCardReq.Header.Set("Content-Type", "application/json")
	addGateCardRec := httptest.NewRecorder()
	handler.ServeHTTP(addGateCardRec, addGateCardReq)
	if addGateCardRec.Code != http.StatusCreated {
		t.Fatalf("POST logic-gate kanban card status = %d, want %d body=%s", addGateCardRec.Code, http.StatusCreated, addGateCardRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/cards?company_id="+companyID+"&board_id="+boardID+"&column_id="+doneColumnID+"&limit=50", nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET kanban cards status = %d, want %d body=%s", listRec.Code, http.StatusOK, listRec.Body.String())
	}
	var listPayload struct {
		Cards []struct {
			ItemType string `json:"item_type"`
			ItemID   string `json:"item_id"`
		} `json:"cards"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode cards: %v", err)
	}
	if len(listPayload.Cards) != 2 {
		t.Fatalf("kanban card count = %d, want 2", len(listPayload.Cards))
	}

	pagedReq := httptest.NewRequest(http.MethodGet, "/v1/kanban/cards?company_id="+companyID+"&board_id="+boardID+"&column_id="+doneColumnID+"&after_position=1000&limit=50", nil)
	pagedRec := httptest.NewRecorder()
	handler.ServeHTTP(pagedRec, pagedReq)
	if pagedRec.Code != http.StatusOK {
		t.Fatalf("GET paged kanban cards status = %d, want %d body=%s", pagedRec.Code, http.StatusOK, pagedRec.Body.String())
	}
	var pagedPayload struct {
		Cards []struct {
			ItemType string `json:"item_type"`
			ItemID   string `json:"item_id"`
		} `json:"cards"`
	}
	if err := json.NewDecoder(pagedRec.Body).Decode(&pagedPayload); err != nil {
		t.Fatalf("decode paged cards: %v", err)
	}
	if len(pagedPayload.Cards) != 1 || pagedPayload.Cards[0].ItemType != "logic_gate" {
		t.Fatalf("paged cards = %+v, want only logic gate after position 1000", pagedPayload.Cards)
	}
}

func TestUpdateNodeTitleViaPut(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-rename-test"
	node, err := repo.CreateNode(companyID, "old title")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}

	body, _ := json.Marshal(map[string]string{
		"company_id": companyID,
		"title":      "new title",
	})
	req := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+node.NodeID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want %d", rec.Code, http.StatusOK)
	}

	details, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails() error = %v", err)
	}
	if details.Node.Title != "new title" {
		t.Fatalf("node title = %q, want %q", details.Node.Title, "new title")
	}
}

func TestWorkspaceSnapshotReturnsNotModifiedWhenDataUnchanged(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-etag-test"

	_, err := repo.CreateNode(companyID, "alpha")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}

	firstReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID, nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("first snapshot status = %d, want %d", firstRec.Code, http.StatusOK)
	}

	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("first snapshot ETag is empty")
	}

	secondReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID, nil)
	secondReq.Header.Set("If-None-Match", etag)
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)

	if secondRec.Code != http.StatusNotModified {
		t.Fatalf("second snapshot status = %d, want %d", secondRec.Code, http.StatusNotModified)
	}
}
