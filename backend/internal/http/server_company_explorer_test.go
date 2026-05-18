package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

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
	if len(snapshot.Folders) != 12 || len(snapshot.FolderItems) != 3 {
		t.Fatalf("snapshot folder counts = folders:%d items:%d, want 12/3", len(snapshot.Folders), len(snapshot.FolderItems))
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

func TestCompanyExplorerDefaultFoldersSeedOnceAndProtectSystemFolders(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-default-folder-seed-test"

	listFolders := func() []struct {
		FolderID       string  `json:"folder_id"`
		ParentFolderID *string `json:"parent_folder_id"`
		FolderKind     string  `json:"folder_kind"`
		SystemKey      *string `json:"system_key"`
		Name           string  `json:"name"`
	} {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/folders?company_id="+companyID, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET default folders status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
		}
		var payload struct {
			Folders []struct {
				FolderID       string  `json:"folder_id"`
				ParentFolderID *string `json:"parent_folder_id"`
				FolderKind     string  `json:"folder_kind"`
				SystemKey      *string `json:"system_key"`
				Name           string  `json:"name"`
			} `json:"folders"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("decode default folders: %v", err)
		}
		return payload.Folders
	}

	folders := listFolders()
	var logicRootID string
	var systemFolderID string
	childNames := map[string]bool{}
	systemNames := map[string]bool{}
	for _, folder := range folders {
		if folder.Name == "Logic Gates" && folder.FolderKind == "logic_gate" && folder.ParentFolderID == nil {
			logicRootID = folder.FolderID
		}
		if folder.SystemKey != nil {
			systemNames[folder.Name] = true
			if folder.Name == "History" {
				systemFolderID = folder.FolderID
			}
		}
	}
	for _, folder := range folders {
		if folder.ParentFolderID != nil && *folder.ParentFolderID == logicRootID {
			childNames[folder.Name] = true
		}
	}
	if logicRootID == "" || len(childNames) != 5 || !childNames["Product"] || !childNames["Design"] || !childNames["Production"] || !childNames["Supply Chain"] || !childNames["QA"] {
		t.Fatalf("default logic gate folders = root:%q children:%v", logicRootID, childNames)
	}
	if len(systemNames) != 2 || !systemNames["Active Nodes"] || !systemNames["History"] || systemFolderID == "" {
		t.Fatalf("system folders = id:%q names:%v", systemFolderID, systemNames)
	}

	deleteSystemReq := httptest.NewRequest(http.MethodDelete, "/v1/company-explorer/folders/"+systemFolderID+"?company_id="+companyID, nil)
	deleteSystemRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteSystemRec, deleteSystemReq)
	if deleteSystemRec.Code != http.StatusConflict {
		t.Fatalf("DELETE system folder status = %d, want %d body=%s", deleteSystemRec.Code, http.StatusConflict, deleteSystemRec.Body.String())
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/company-explorer/folders/"+logicRootID+"?company_id="+companyID, nil)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE default folder status = %d, want %d body=%s", deleteRec.Code, http.StatusOK, deleteRec.Body.String())
	}
	foldersAfterDelete := listFolders()
	systemCount := 0
	for _, folder := range foldersAfterDelete {
		if folder.FolderKind == "logic_gate" {
			t.Fatalf("logic gate default folder was recreated after delete: %+v", folder)
		}
		if folder.SystemKey != nil {
			systemCount++
		}
	}
	if systemCount != 2 {
		t.Fatalf("system folder count after default delete = %d, want 2", systemCount)
	}
}

func TestCompanyExplorerCommunicationsDefaultFoldersSeedOnceAndAreMutable(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-communications-folder-seed-test"

	type folderPayload struct {
		FolderID       string  `json:"folder_id"`
		ParentFolderID *string `json:"parent_folder_id"`
		FolderKind     string  `json:"folder_kind"`
		SystemKey      *string `json:"system_key"`
		Name           string  `json:"name"`
	}
	listCommunicationsFolders := func() []folderPayload {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/folders?company_id="+companyID+"&folder_kind=communications", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET communications default folders status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
		}
		var payload struct {
			Folders []folderPayload `json:"folders"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("decode communications default folders: %v", err)
		}
		return payload.Folders
	}
	folderByName := func(folders []folderPayload, name string) folderPayload {
		t.Helper()
		for _, folder := range folders {
			if folder.Name == name {
				return folder
			}
		}
		t.Fatalf("folder %q not found in %+v", name, folders)
		return folderPayload{}
	}
	assertParent := func(folders []folderPayload, childName, parentName string) {
		t.Helper()
		child := folderByName(folders, childName)
		parent := folderByName(folders, parentName)
		if child.ParentFolderID == nil || *child.ParentFolderID != parent.FolderID {
			t.Fatalf("folder %q parent = %v, want %q", childName, child.ParentFolderID, parentName)
		}
	}

	folders := listCommunicationsFolders()
	if len(folders) != 21 {
		t.Fatalf("communications default folder count = %d, want 21: %+v", len(folders), folders)
	}
	for _, name := range []string{"BM", "Supply Chain", "Production", "QA", "Finance", "Legal", "HR"} {
		folder := folderByName(folders, name)
		if folder.ParentFolderID != nil {
			t.Fatalf("root folder %q has parent %v", name, folder.ParentFolderID)
		}
		if folder.SystemKey != nil {
			t.Fatalf("default communications folder %q should be customer-mutable, got system key %q", name, *folder.SystemKey)
		}
	}
	for _, pair := range [][2]string{
		{"Product", "BM"},
		{"Account", "BM"},
		{"Commercial", "BM"},
		{"Project", "BM"},
		{"design", "Product"},
		{"printing", "Product"},
		{"suppliers", "Product"},
		{"orders", "Supply Chain"},
		{"shipping", "Supply Chain"},
		{"receiving", "Supply Chain"},
		{"temps", "Production"},
		{"quality", "QA"},
		{"ar", "Finance"},
		{"ap", "Finance"},
	} {
		assertParent(folders, pair[0], pair[1])
	}

	bm := folderByName(folders, "BM")
	renameBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"name":       "Business Management",
	})
	renameReq := httptest.NewRequest(http.MethodPut, "/v1/company-explorer/folders/"+bm.FolderID, bytes.NewReader(renameBody))
	renameReq.Header.Set("Content-Type", "application/json")
	renameRec := httptest.NewRecorder()
	handler.ServeHTTP(renameRec, renameReq)
	if renameRec.Code != http.StatusOK {
		t.Fatalf("PUT communications default folder status = %d, want %d body=%s", renameRec.Code, http.StatusOK, renameRec.Body.String())
	}

	folders = listCommunicationsFolders()
	supplyChain := folderByName(folders, "Supply Chain")
	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/company-explorer/folders/"+supplyChain.FolderID+"?company_id="+companyID, nil)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE communications default folder status = %d, want %d body=%s", deleteRec.Code, http.StatusOK, deleteRec.Body.String())
	}
	folders = listCommunicationsFolders()
	for _, deletedName := range []string{"Supply Chain", "orders", "shipping", "receiving"} {
		for _, folder := range folders {
			if folder.Name == deletedName {
				t.Fatalf("deleted communications folder %q was recreated: %+v", deletedName, folder)
			}
		}
	}
	if folderByName(folders, "Business Management").FolderID != bm.FolderID {
		t.Fatalf("renamed communications default folder did not persist")
	}

	for _, folder := range folders {
		if folder.ParentFolderID != nil {
			continue
		}
		deleteRootReq := httptest.NewRequest(http.MethodDelete, "/v1/company-explorer/folders/"+folder.FolderID+"?company_id="+companyID, nil)
		deleteRootRec := httptest.NewRecorder()
		handler.ServeHTTP(deleteRootRec, deleteRootReq)
		if deleteRootRec.Code != http.StatusOK {
			t.Fatalf("DELETE communications root %q status = %d, want %d body=%s", folder.Name, deleteRootRec.Code, http.StatusOK, deleteRootRec.Body.String())
		}
	}
	if folders = listCommunicationsFolders(); len(folders) != 0 {
		t.Fatalf("communications defaults were recreated after deleting all folders: %+v", folders)
	}
}

func TestCommunicationsSharedInboxRaciAPI(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-shared-inbox-raci-test"

	responsible, err := repo.UpsertAuthUser("subject-shared-raci-responsible", "responsible@example.com", "R Person")
	if err != nil {
		t.Fatalf("UpsertAuthUser responsible error = %v", err)
	}
	accountable, err := repo.UpsertAuthUser("subject-shared-raci-accountable", "accountable@example.com", "A Person")
	if err != nil {
		t.Fatalf("UpsertAuthUser accountable error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(responsible.CognitoSubject, companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership responsible error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(accountable.CognitoSubject, companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership accountable error = %v", err)
	}

	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "AR")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder error = %v", err)
	}
	body, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"assignments": []map[string]string{
			{"role": "responsible", "user_id": responsible.UserID},
			{"role": "accountable", "user_id": accountable.UserID},
		},
	})
	req := httptest.NewRequest(http.MethodPut, "/v1/company-explorer/folders/"+folder.FolderID+"/raci", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT shared inbox RACI status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var updatePayload struct {
		Assignments []struct {
			FolderID        string `json:"folder_id"`
			Role            string `json:"role"`
			UserID          string `json:"user_id"`
			UserDisplayName string `json:"user_display_name"`
		} `json:"raci_assignments"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&updatePayload); err != nil {
		t.Fatalf("decode PUT shared inbox RACI: %v", err)
	}
	if len(updatePayload.Assignments) != 2 {
		t.Fatalf("PUT shared inbox RACI assignment count = %d, want 2", len(updatePayload.Assignments))
	}
	if updatePayload.Assignments[0].FolderID != folder.FolderID || updatePayload.Assignments[0].Role != "responsible" || updatePayload.Assignments[0].UserID != responsible.UserID || updatePayload.Assignments[0].UserDisplayName != "R Person" {
		t.Fatalf("first assignment = %+v", updatePayload.Assignments[0])
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/folders?company_id="+companyID+"&folder_kind=communications", nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET communications folders status = %d, want %d body=%s", listRec.Code, http.StatusOK, listRec.Body.String())
	}
	var listPayload struct {
		Folders []struct {
			FolderID    string `json:"folder_id"`
			Assignments []struct {
				Role   string `json:"role"`
				UserID string `json:"user_id"`
			} `json:"raci_assignments"`
		} `json:"folders"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode communications folders: %v", err)
	}
	for _, listed := range listPayload.Folders {
		if listed.FolderID != folder.FolderID {
			continue
		}
		if len(listed.Assignments) != 2 {
			t.Fatalf("listed assignment count = %d, want 2", len(listed.Assignments))
		}
		return
	}
	t.Fatalf("folder %s not found in list payload", folder.FolderID)
}

func TestCommunicationsSharedInboxRaciInheritsToChildFolders(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-shared-inbox-raci-inheritance-test"

	parentUser, err := repo.UpsertAuthUser("subject-shared-raci-parent", "parent-raci@example.com", "Parent RACI")
	if err != nil {
		t.Fatalf("UpsertAuthUser parent error = %v", err)
	}
	childUser, err := repo.UpsertAuthUser("subject-shared-raci-child", "child-raci@example.com", "Child RACI")
	if err != nil {
		t.Fatalf("UpsertAuthUser child error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(parentUser.CognitoSubject, companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership parent error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(childUser.CognitoSubject, companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership child error = %v", err)
	}

	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder parent error = %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "communications", "Child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder child error = %v", err)
	}

	parentBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"assignments": []map[string]string{
			{"role": "responsible", "user_id": parentUser.UserID},
		},
	})
	parentReq := httptest.NewRequest(http.MethodPut, "/v1/company-explorer/folders/"+parent.FolderID+"/raci", bytes.NewReader(parentBody))
	parentReq.Header.Set("Content-Type", "application/json")
	parentRec := httptest.NewRecorder()
	handler.ServeHTTP(parentRec, parentReq)
	if parentRec.Code != http.StatusOK {
		t.Fatalf("PUT parent RACI status = %d, want %d body=%s", parentRec.Code, http.StatusOK, parentRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/folders?company_id="+companyID+"&folder_kind=communications", nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET communications folders status = %d, want %d body=%s", listRec.Code, http.StatusOK, listRec.Body.String())
	}
	var listPayload struct {
		Folders []struct {
			FolderID    string `json:"folder_id"`
			Assignments []struct {
				FolderID        string `json:"folder_id"`
				Role            string `json:"role"`
				UserID          string `json:"user_id"`
				UserDisplayName string `json:"user_display_name"`
			} `json:"raci_assignments"`
		} `json:"folders"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode communications folders: %v", err)
	}
	var childAssignments []struct {
		FolderID        string `json:"folder_id"`
		Role            string `json:"role"`
		UserID          string `json:"user_id"`
		UserDisplayName string `json:"user_display_name"`
	}
	for _, listed := range listPayload.Folders {
		if listed.FolderID == child.FolderID {
			childAssignments = listed.Assignments
			break
		}
	}
	if len(childAssignments) != 1 {
		t.Fatalf("child inherited assignment count = %d, want 1", len(childAssignments))
	}
	if childAssignments[0].FolderID != parent.FolderID || childAssignments[0].Role != "responsible" || childAssignments[0].UserID != parentUser.UserID || childAssignments[0].UserDisplayName != "Parent RACI" {
		t.Fatalf("child inherited assignment = %+v", childAssignments[0])
	}

	childBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"assignments": []map[string]string{
			{"role": "accountable", "user_id": childUser.UserID},
		},
	})
	childReq := httptest.NewRequest(http.MethodPut, "/v1/company-explorer/folders/"+child.FolderID+"/raci", bytes.NewReader(childBody))
	childReq.Header.Set("Content-Type", "application/json")
	childRec := httptest.NewRecorder()
	handler.ServeHTTP(childRec, childReq)
	if childRec.Code != http.StatusOK {
		t.Fatalf("PUT child RACI status = %d, want %d body=%s", childRec.Code, http.StatusOK, childRec.Body.String())
	}
	var childPayload struct {
		Assignments []struct {
			FolderID string `json:"folder_id"`
			Role     string `json:"role"`
			UserID   string `json:"user_id"`
		} `json:"raci_assignments"`
	}
	if err := json.NewDecoder(childRec.Body).Decode(&childPayload); err != nil {
		t.Fatalf("decode PUT child RACI: %v", err)
	}
	if len(childPayload.Assignments) != 2 {
		t.Fatalf("child PUT assignment count = %d, want inherited parent plus direct child", len(childPayload.Assignments))
	}
	seenParent := false
	seenChild := false
	for _, assignment := range childPayload.Assignments {
		if assignment.FolderID == parent.FolderID && assignment.Role == "responsible" && assignment.UserID == parentUser.UserID {
			seenParent = true
		}
		if assignment.FolderID == child.FolderID && assignment.Role == "accountable" && assignment.UserID == childUser.UserID {
			seenChild = true
		}
	}
	if !seenParent || !seenChild {
		t.Fatalf("child assignments = %+v, want inherited parent and direct child assignments", childPayload.Assignments)
	}
}

func TestCommunicationsSharedInboxAccountEmailAPI(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-shared-inbox-account-test"

	user, err := repo.UpsertAuthUser("subject-shared-account", "triage@example.com", "Triage User")
	if err != nil {
		t.Fatalf("UpsertAuthUser error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership error = %v", err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: "triage@example.com",
		GrantID:      "grant-shared-account",
		Status:       "connected",
	}); err != nil {
		t.Fatalf("UpsertUserEmailConnection error = %v", err)
	}

	createBody, _ := json.Marshal(map[string]string{
		"company_id":    companyID,
		"folder_kind":   "communications",
		"name":          "AR Inbox",
		"account_email": "TRIAGE@example.com",
	})
	createReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders", bytes.NewReader(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("POST shared inbox account status = %d, want %d body=%s", createRec.Code, http.StatusCreated, createRec.Body.String())
	}
	var created struct {
		FolderID     string `json:"folder_id"`
		AccountEmail string `json:"account_email"`
	}
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode created shared inbox: %v", err)
	}
	if created.FolderID == "" || created.AccountEmail != "triage@example.com" {
		t.Fatalf("created shared inbox = %+v, want normalized account email", created)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/folders?company_id="+companyID+"&folder_kind=communications", nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET communications folders status = %d, want %d body=%s", listRec.Code, http.StatusOK, listRec.Body.String())
	}
	var listPayload struct {
		Folders []struct {
			FolderID     string `json:"folder_id"`
			AccountEmail string `json:"account_email"`
		} `json:"folders"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode communications folder list: %v", err)
	}
	found := false
	for _, folder := range listPayload.Folders {
		if folder.FolderID != created.FolderID {
			continue
		}
		found = true
		if folder.AccountEmail != "triage@example.com" {
			t.Fatalf("listed account_email = %q, want triage@example.com", folder.AccountEmail)
		}
	}
	if !found {
		t.Fatalf("created shared inbox %s not found in list payload", created.FolderID)
	}

	clearBody, _ := json.Marshal(map[string]string{
		"company_id":    companyID,
		"account_email": "",
	})
	clearReq := httptest.NewRequest(http.MethodPut, "/v1/company-explorer/folders/"+created.FolderID, bytes.NewReader(clearBody))
	clearReq.Header.Set("Content-Type", "application/json")
	clearRec := httptest.NewRecorder()
	handler.ServeHTTP(clearRec, clearReq)
	if clearRec.Code != http.StatusOK {
		t.Fatalf("PUT clear shared inbox account status = %d, want %d body=%s", clearRec.Code, http.StatusOK, clearRec.Body.String())
	}
	var cleared struct {
		AccountEmail *string `json:"account_email"`
	}
	if err := json.NewDecoder(clearRec.Body).Decode(&cleared); err != nil {
		t.Fatalf("decode cleared shared inbox: %v", err)
	}
	if cleared.AccountEmail != nil {
		t.Fatalf("cleared account_email = %v, want nil", *cleared.AccountEmail)
	}

	missingBody, _ := json.Marshal(map[string]string{
		"company_id":    companyID,
		"folder_kind":   "communications",
		"name":          "Missing Account",
		"account_email": "missing@example.com",
	})
	missingReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders", bytes.NewReader(missingBody))
	missingReq.Header.Set("Content-Type", "application/json")
	missingRec := httptest.NewRecorder()
	handler.ServeHTTP(missingRec, missingReq)
	if missingRec.Code != http.StatusBadRequest {
		t.Fatalf("POST missing shared inbox account status = %d, want %d body=%s", missingRec.Code, http.StatusBadRequest, missingRec.Body.String())
	}
}

func TestCompanyExplorerFolderItemBatchAssignsItemsInOneRequest(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-folder-item-batch-test"

	nodeA, err := repo.CreateNode(companyID, "Batch A")
	if err != nil {
		t.Fatalf("CreateNode(A) error = %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Batch B")
	if err != nil {
		t.Fatalf("CreateNode(B) error = %v", err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Batch folder")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder() error = %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"assignments": []map[string]any{
			{"folder_id": folder.FolderID, "item_type": "node", "item_id": nodeA.NodeID, "position": 1000},
			{"folder_id": folder.FolderID, "item_type": "node", "item_id": nodeB.NodeID, "position": 2000},
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folder-items/batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST folder item batch status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload struct {
		FolderItems []struct {
			ItemID   string `json:"item_id"`
			Position int    `json:"position"`
		} `json:"folder_items"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode folder item batch: %v", err)
	}
	if len(payload.FolderItems) != 2 || payload.FolderItems[0].ItemID != nodeA.NodeID || payload.FolderItems[0].Position != 1000 || payload.FolderItems[1].ItemID != nodeB.NodeID || payload.FolderItems[1].Position != 2000 {
		t.Fatalf("batch payload = %+v, want assigned nodes in request order", payload.FolderItems)
	}
}

func TestFilterCommunicationsSharedInboxFoldersForUserIncludesAssignedSubtreeAndAncestors(t *testing.T) {
	t.Parallel()

	parentID := "shared-root"
	folders := []domain.CompanyExplorerFolder{
		{FolderID: parentID, FolderKind: "communications", Name: "Shared Triage"},
		{
			FolderID:        "ar",
			ParentFolderID:  &parentID,
			FolderKind:      "communications",
			Name:            "AR",
			RaciAssignments: []domain.SharedInboxRaciAssignment{{FolderID: "ar", UserID: "user-1", Role: domain.LogicGateRaciRoleResponsible}},
		},
		{FolderID: "ar-child", ParentFolderID: stringPtr("ar"), FolderKind: "communications", Name: "AR Child"},
		{
			FolderID:        "ap",
			ParentFolderID:  &parentID,
			FolderKind:      "communications",
			Name:            "AP",
			RaciAssignments: []domain.SharedInboxRaciAssignment{{FolderID: "ap", UserID: "user-2", Role: domain.LogicGateRaciRoleAccountable}},
		},
	}

	filtered := filterCommunicationsSharedInboxFoldersForUser(folders, "user-1")
	ids := make([]string, 0, len(filtered))
	for _, folder := range filtered {
		ids = append(ids, folder.FolderID)
	}

	want := []string{"shared-root", "ar", "ar-child"}
	if len(ids) != len(want) {
		t.Fatalf("filtered IDs = %v, want %v", ids, want)
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("filtered IDs = %v, want %v", ids, want)
		}
	}
}

func stringPtr(value string) *string {
	return &value
}

func TestCompanyExplorerDeleteBatchDeletesSelectedTargetsInOneRequest(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-explorer-delete-batch-test"

	node, err := repo.CreateNode(companyID, "Batch delete node")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Batch delete folder")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder() error = %v", err)
	}
	childFolder, err := repo.CreateCompanyExplorerFolder(companyID, folder.FolderID, "node", "Batch delete child folder")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder(child) error = %v", err)
	}
	folderNode, err := repo.CreateNode(companyID, "Node inside folder")
	if err != nil {
		t.Fatalf("CreateNode(folderNode) error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, childFolder.FolderID, "node", folderNode.NodeID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem(node) error = %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"targets": []map[string]string{
			{"kind": "node", "id": node.NodeID},
			{"kind": "folder", "id": folder.FolderID, "folder_kind": "node"},
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/delete-batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST delete batch status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if _, err := repo.GetNode(companyID, node.NodeID); err != store.ErrNotFound {
		t.Fatalf("GetNode after batch delete error = %v, want ErrNotFound", err)
	}
	if _, err := repo.GetNode(companyID, folderNode.NodeID); err != store.ErrNotFound {
		t.Fatalf("GetNode for folder child after batch delete error = %v, want ErrNotFound", err)
	}
	folders, err := repo.ListCompanyExplorerFolders(companyID, "node")
	if err != nil {
		t.Fatalf("ListCompanyExplorerFolders() error = %v", err)
	}
	for _, item := range folders {
		if item.FolderID == folder.FolderID || item.FolderID == childFolder.FolderID {
			t.Fatalf("folder %s still exists after batch delete", item.FolderID)
		}
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
