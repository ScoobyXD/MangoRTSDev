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

func TestNodeInformationProjectionAPICollapsesEditorTextBoxes(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-node-projection-collapse-test"

	node, err := repo.CreateNode(companyID, "node with one editor document")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}

	postInformation := func(informationID string, value string) {
		t.Helper()
		body, _ := json.Marshal(map[string]string{
			"company_id":     companyID,
			"type":           "Text box",
			"information":    value,
			"information_id": informationID,
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST node information status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
		}
	}

	postInformation("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "old editor document")
	postInformation("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "current editor document")

	projectionReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+node.NodeID+"/projection?company_id="+companyID, nil)
	projectionRec := httptest.NewRecorder()
	handler.ServeHTTP(projectionRec, projectionReq)
	if projectionRec.Code != http.StatusOK {
		t.Fatalf("GET node projection status = %d, want %d body=%s", projectionRec.Code, http.StatusOK, projectionRec.Body.String())
	}
	var projectionPayload struct {
		Items []struct {
			Type        string `json:"type"`
			Information string `json:"information"`
		} `json:"items"`
	}
	if err := json.NewDecoder(projectionRec.Body).Decode(&projectionPayload); err != nil {
		t.Fatalf("decode projection: %v", err)
	}
	if len(projectionPayload.Items) != 1 {
		t.Fatalf("projection item count = %d, want 1", len(projectionPayload.Items))
	}
	if projectionPayload.Items[0].Type != "Text box" || projectionPayload.Items[0].Information != "current editor document" {
		t.Fatalf("projection item = %+v, want current Text box document", projectionPayload.Items[0])
	}

	details, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails() error = %v", err)
	}
	if len(details.Information) != 2 {
		t.Fatalf("node history row count = %d, want 2", len(details.Information))
	}
}

func TestProjectionDeleteAPIClearsLatestDocumentForHeadlessClients(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-clear-projection-api-test"

	node, err := repo.CreateNode(companyID, "node with clearable editor")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}
	const stableProjectionID = "77777777-7777-4777-8777-777777777777"
	body, _ := json.Marshal(map[string]string{
		"company_id":     companyID,
		"type":           "Text box",
		"information":    "text to clear",
		"information_id": stableProjectionID,
	})
	postReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/information", bytes.NewReader(body))
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	handler.ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusCreated {
		t.Fatalf("POST node information status = %d, want %d body=%s", postRec.Code, http.StatusCreated, postRec.Body.String())
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/nodes/"+node.NodeID+"/projection/"+stableProjectionID+"?company_id="+companyID, nil)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE node projection status = %d, want %d body=%s", deleteRec.Code, http.StatusOK, deleteRec.Body.String())
	}

	projectionReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+node.NodeID+"/projection?company_id="+companyID, nil)
	projectionRec := httptest.NewRecorder()
	handler.ServeHTTP(projectionRec, projectionReq)
	if projectionRec.Code != http.StatusOK {
		t.Fatalf("GET node projection status = %d, want %d body=%s", projectionRec.Code, http.StatusOK, projectionRec.Body.String())
	}
	var projectionPayload struct {
		Items []any `json:"items"`
	}
	if err := json.NewDecoder(projectionRec.Body).Decode(&projectionPayload); err != nil {
		t.Fatalf("decode projection payload: %v", err)
	}
	if len(projectionPayload.Items) != 0 {
		t.Fatalf("projection items after clear = %d, want 0", len(projectionPayload.Items))
	}
	details, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails() error = %v", err)
	}
	if len(details.Information) != 1 {
		t.Fatalf("history row count after projection clear = %d, want 1", len(details.Information))
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
	secondNode, err := repo.CreateNode(companyID, "Second foldered node")
	if err != nil {
		t.Fatalf("CreateNode(second) error = %v", err)
	}
	thirdNode, err := repo.CreateNode(companyID, "Third foldered node")
	if err != nil {
		t.Fatalf("CreateNode(third) error = %v", err)
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

	renameBody, _ := json.Marshal(map[string]string{
		"company_id": companyID,
		"name":       "Renamed Customers",
	})
	renameReq := httptest.NewRequest(http.MethodPut, "/v1/company-explorer/folders/"+parentID, bytes.NewReader(renameBody))
	renameReq.Header.Set("Content-Type", "application/json")
	renameRec := httptest.NewRecorder()
	handler.ServeHTTP(renameRec, renameReq)
	if renameRec.Code != http.StatusOK {
		t.Fatalf("rename company explorer folder status = %d, want %d body=%s", renameRec.Code, http.StatusOK, renameRec.Body.String())
	}
	var renamedFolder struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(renameRec.Body).Decode(&renamedFolder); err != nil {
		t.Fatalf("decode renamed folder: %v", err)
	}
	if renamedFolder.Name != "Renamed Customers" {
		t.Fatalf("renamed folder name = %q, want Renamed Customers", renamedFolder.Name)
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
	secondAssignBody, _ := json.Marshal(map[string]string{
		"company_id": companyID,
		"folder_id":  childID,
		"item_type":  "node",
		"item_id":    secondNode.NodeID,
	})
	secondAssignReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folder-items", bytes.NewReader(secondAssignBody))
	secondAssignReq.Header.Set("Content-Type", "application/json")
	secondAssignRec := httptest.NewRecorder()
	handler.ServeHTTP(secondAssignRec, secondAssignReq)
	if secondAssignRec.Code != http.StatusOK {
		t.Fatalf("POST second company explorer folder-items status = %d, want %d body=%s", secondAssignRec.Code, http.StatusOK, secondAssignRec.Body.String())
	}
	mixedFolderBody, _ := json.Marshal(map[string]string{
		"company_id":       companyID,
		"parent_folder_id": childID,
		"folder_kind":      "node",
		"name":             "Mixed sibling folder",
	})
	mixedFolderReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders", bytes.NewReader(mixedFolderBody))
	mixedFolderReq.Header.Set("Content-Type", "application/json")
	mixedFolderRec := httptest.NewRecorder()
	handler.ServeHTTP(mixedFolderRec, mixedFolderReq)
	if mixedFolderRec.Code != http.StatusCreated {
		t.Fatalf("POST mixed sibling folder status = %d, want %d body=%s", mixedFolderRec.Code, http.StatusCreated, mixedFolderRec.Body.String())
	}
	var mixedFolder struct {
		Position int `json:"position"`
	}
	if err := json.NewDecoder(mixedFolderRec.Body).Decode(&mixedFolder); err != nil {
		t.Fatalf("decode mixed sibling folder: %v", err)
	}
	if mixedFolder.Position != 3000 {
		t.Fatalf("mixed sibling folder position = %d, want 3000 after two item rows", mixedFolder.Position)
	}
	thirdAssignBody, _ := json.Marshal(map[string]string{
		"company_id": companyID,
		"folder_id":  childID,
		"item_type":  "node",
		"item_id":    thirdNode.NodeID,
	})
	thirdAssignReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folder-items", bytes.NewReader(thirdAssignBody))
	thirdAssignReq.Header.Set("Content-Type", "application/json")
	thirdAssignRec := httptest.NewRecorder()
	handler.ServeHTTP(thirdAssignRec, thirdAssignReq)
	if thirdAssignRec.Code != http.StatusOK {
		t.Fatalf("POST third company explorer folder-items status = %d, want %d body=%s", thirdAssignRec.Code, http.StatusOK, thirdAssignRec.Body.String())
	}
	var thirdAssigned struct {
		Position int `json:"position"`
	}
	if err := json.NewDecoder(thirdAssignRec.Body).Decode(&thirdAssigned); err != nil {
		t.Fatalf("decode third folder item: %v", err)
	}
	if thirdAssigned.Position != 4000 {
		t.Fatalf("third folder item position = %d, want 4000 after folder sibling", thirdAssigned.Position)
	}
	reorderBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"folder_id":  childID,
		"item_type":  "node",
		"item_id":    node.NodeID,
		"position":   5000,
	})
	reorderReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folder-items", bytes.NewReader(reorderBody))
	reorderReq.Header.Set("Content-Type", "application/json")
	reorderRec := httptest.NewRecorder()
	handler.ServeHTTP(reorderRec, reorderReq)
	if reorderRec.Code != http.StatusOK {
		t.Fatalf("POST reorder company explorer folder-items status = %d, want %d body=%s", reorderRec.Code, http.StatusOK, reorderRec.Body.String())
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
			Position int    `json:"position"`
		} `json:"folder_items"`
	}
	if err := json.NewDecoder(itemsRec.Body).Decode(&itemsPayload); err != nil {
		t.Fatalf("decode folder items: %v", err)
	}
	if len(itemsPayload.Items) != 3 || itemsPayload.Items[0].ItemID != secondNode.NodeID || itemsPayload.Items[1].ItemID != thirdNode.NodeID || itemsPayload.Items[1].Position != 4000 || itemsPayload.Items[2].ItemID != node.NodeID || itemsPayload.Items[2].Position != 5000 {
		t.Fatalf("folder item payload = %+v, want reordered nodes in child folder", itemsPayload.Items)
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
	if len(snapshot.Folders) != 4 || len(snapshot.FolderItems) != 3 {
		t.Fatalf("snapshot folder counts = folders:%d items:%d, want 4/3", len(snapshot.Folders), len(snapshot.FolderItems))
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

func TestCompanyExplorerFolderItemMovesBreakRelationships(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-folder-move-relationships-test"

	createFolder := func(kind, name string) string {
		t.Helper()
		body, _ := json.Marshal(map[string]string{
			"company_id":  companyID,
			"folder_kind": kind,
			"name":        name,
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST folder %s status = %d, want %d body=%s", name, rec.Code, http.StatusCreated, rec.Body.String())
		}
		var payload struct {
			FolderID string `json:"folder_id"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("decode folder %s: %v", name, err)
		}
		return payload.FolderID
	}

	assign := func(folderID, itemType, itemID string, position int) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"company_id": companyID,
			"folder_id":  folderID,
			"item_type":  itemType,
			"item_id":    itemID,
			"position":   position,
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folder-items", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("POST folder item %s/%s status = %d, want %d body=%s", itemType, itemID, rec.Code, http.StatusOK, rec.Body.String())
		}
	}

	nodeA, err := repo.CreateNode(companyID, "Node A")
	if err != nil {
		t.Fatalf("CreateNode A error = %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Node B")
	if err != nil {
		t.Fatalf("CreateNode B error = %v", err)
	}
	nodeFolderA := createFolder("node", "Node Folder A")
	nodeFolderB := createFolder("node", "Node Folder B")
	assign(nodeFolderA, "node", nodeA.NodeID, 0)
	assign(nodeFolderA, "node", nodeB.NodeID, 0)
	if _, err := repo.CreateNodeRelationship(companyID, nodeA.NodeID, nodeB.NodeID, "Peer", "Peer"); err != nil {
		t.Fatalf("CreateNodeRelationship error = %v", err)
	}

	assign(nodeFolderB, "node", nodeA.NodeID, 0)
	nodeRelationships, err := repo.ListNodeRelationships(companyID)
	if err != nil {
		t.Fatalf("ListNodeRelationships after move error = %v", err)
	}
	if len(nodeRelationships) != 0 {
		t.Fatalf("node relationships after cross-folder move = %d, want 0", len(nodeRelationships))
	}

	assign(nodeFolderB, "node", nodeB.NodeID, 0)
	if _, err := repo.CreateNodeRelationship(companyID, nodeA.NodeID, nodeB.NodeID, "Parent", "Child"); err != nil {
		t.Fatalf("CreateNodeRelationship same-folder error = %v", err)
	}
	assign(nodeFolderB, "node", nodeA.NodeID, 9000)
	nodeRelationships, err = repo.ListNodeRelationships(companyID)
	if err != nil {
		t.Fatalf("ListNodeRelationships after reorder error = %v", err)
	}
	if len(nodeRelationships) != 1 {
		t.Fatalf("node relationships after same-folder reorder = %d, want 1", len(nodeRelationships))
	}

	gateA, err := repo.CreateLogicGate(companyID, "Gate A")
	if err != nil {
		t.Fatalf("CreateLogicGate A error = %v", err)
	}
	gateB, err := repo.CreateLogicGate(companyID, "Gate B")
	if err != nil {
		t.Fatalf("CreateLogicGate B error = %v", err)
	}
	logicFolderA := createFolder("logic_gate", "Logic Folder A")
	logicFolderB := createFolder("logic_gate", "Logic Folder B")
	assign(logicFolderA, "logic_gate", gateA.LogicGateID, 0)
	assign(logicFolderA, "logic_gate", gateB.LogicGateID, 0)
	if _, err := repo.CreateLogicGateRelationship(companyID, gateA.LogicGateID, gateB.LogicGateID, "Input", "Output"); err != nil {
		t.Fatalf("CreateLogicGateRelationship error = %v", err)
	}

	assign(logicFolderB, "logic_gate", gateA.LogicGateID, 0)
	logicRelationships, err := repo.ListLogicGateRelationships(companyID)
	if err != nil {
		t.Fatalf("ListLogicGateRelationships after move error = %v", err)
	}
	if len(logicRelationships) != 0 {
		t.Fatalf("logic-gate relationships after cross-folder move = %d, want 0", len(logicRelationships))
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
			"width_px":   280,
			"height_px":  240,
			"item_color": "#245c9f",
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
	if len(listBoardsPayload.Boards) != 1 || listBoardsPayload.Boards[0].BoardID != boardID {
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
	if assignRec.Code != http.StatusOK {
		t.Fatalf("POST kanban explorer folder item status = %d, want %d body=%s", assignRec.Code, http.StatusOK, assignRec.Body.String())
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
	if itemsRec.Code != http.StatusOK {
		t.Fatalf("GET kanban explorer items status = %d, want %d body=%s", itemsRec.Code, http.StatusOK, itemsRec.Body.String())
	}
	var itemsPayload struct {
		Items []struct {
			ItemType string `json:"item_type"`
			ItemID   string `json:"item_id"`
		} `json:"folder_items"`
	}
	if err := json.NewDecoder(itemsRec.Body).Decode(&itemsPayload); err != nil {
		t.Fatalf("decode kanban explorer items: %v", err)
	}
	if len(itemsPayload.Items) != 0 {
		t.Fatalf("kanban explorer items after board delete = %+v, want cleanup", itemsPayload.Items)
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

func TestMapLayoutPositionAPIAndWorkspaceSnapshot(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-map-layout-test"

	node, err := repo.CreateNode(companyID, "layout node")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "layout gate")
	if err != nil {
		t.Fatalf("CreateLogicGate() error = %v", err)
	}

	writeNodeBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"map_type":   "node",
		"positions": []map[string]any{{
			"entity_id": node.NodeID,
			"x":         240,
			"y":         360,
		}},
	})
	writeNodeReq := httptest.NewRequest(http.MethodPut, "/v1/map-layout", bytes.NewReader(writeNodeBody))
	writeNodeReq.Header.Set("Content-Type", "application/json")
	writeNodeRec := httptest.NewRecorder()
	handler.ServeHTTP(writeNodeRec, writeNodeReq)
	if writeNodeRec.Code != http.StatusOK {
		t.Fatalf("PUT node map layout status = %d, want %d body=%s", writeNodeRec.Code, http.StatusOK, writeNodeRec.Body.String())
	}

	writeLogicBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"map_type":   "logic_gate",
		"positions": []map[string]any{{
			"entity_id": logicGate.LogicGateID,
			"x":         480,
			"y":         120,
		}},
	})
	writeLogicReq := httptest.NewRequest(http.MethodPut, "/v1/map-layout", bytes.NewReader(writeLogicBody))
	writeLogicReq.Header.Set("Content-Type", "application/json")
	writeLogicRec := httptest.NewRecorder()
	handler.ServeHTTP(writeLogicRec, writeLogicReq)
	if writeLogicRec.Code != http.StatusOK {
		t.Fatalf("PUT logic gate map layout status = %d, want %d body=%s", writeLogicRec.Code, http.StatusOK, writeLogicRec.Body.String())
	}

	readReq := httptest.NewRequest(http.MethodGet, "/v1/map-layout?company_id="+companyID+"&map_type=node", nil)
	readRec := httptest.NewRecorder()
	handler.ServeHTTP(readRec, readReq)
	if readRec.Code != http.StatusOK {
		t.Fatalf("GET node map layout status = %d, want %d body=%s", readRec.Code, http.StatusOK, readRec.Body.String())
	}
	var readPayload struct {
		Positions []struct {
			NodeID string  `json:"node_id"`
			X      float64 `json:"x"`
			Y      float64 `json:"y"`
		} `json:"positions"`
	}
	if err := json.NewDecoder(readRec.Body).Decode(&readPayload); err != nil {
		t.Fatalf("decode node map layout: %v", err)
	}
	if len(readPayload.Positions) != 1 || readPayload.Positions[0].NodeID != node.NodeID || readPayload.Positions[0].X != 240 || readPayload.Positions[0].Y != 360 {
		t.Fatalf("node map positions = %+v, want saved node position", readPayload.Positions)
	}

	snapshotReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID, nil)
	snapshotRec := httptest.NewRecorder()
	handler.ServeHTTP(snapshotRec, snapshotReq)
	if snapshotRec.Code != http.StatusOK {
		t.Fatalf("workspace snapshot status = %d, want %d body=%s", snapshotRec.Code, http.StatusOK, snapshotRec.Body.String())
	}
	var snapshot struct {
		NodeMapPositions []struct {
			NodeID string `json:"node_id"`
		} `json:"node_map_positions"`
		LogicGateMapPositions []struct {
			LogicGateID string `json:"logic_gate_id"`
		} `json:"logic_gate_map_positions"`
	}
	if err := json.NewDecoder(snapshotRec.Body).Decode(&snapshot); err != nil {
		t.Fatalf("decode workspace snapshot: %v", err)
	}
	if len(snapshot.NodeMapPositions) != 1 || snapshot.NodeMapPositions[0].NodeID != node.NodeID {
		t.Fatalf("snapshot node_map_positions = %+v, want saved node position", snapshot.NodeMapPositions)
	}
	if len(snapshot.LogicGateMapPositions) != 1 || snapshot.LogicGateMapPositions[0].LogicGateID != logicGate.LogicGateID {
		t.Fatalf("snapshot logic_gate_map_positions = %+v, want saved logic gate position", snapshot.LogicGateMapPositions)
	}
}
