package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
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
	repo.EnsureCompany(companyID, "Folder API Company")

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
			FolderID string `json:"entity_id"`
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
		ParentEntityID string `json:"parent_entity_id"`
	}
	if err := json.NewDecoder(moveRec.Body).Decode(&movedFolder); err != nil {
		t.Fatalf("decode moved folder: %v", err)
	}
	if movedFolder.ParentEntityID != siblingID {
		t.Fatalf("moved folder parent = %q, want %s", movedFolder.ParentEntityID, siblingID)
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

	placeItem := func(targetID string, position int) store.CompanyExplorerV2Row {
		t.Helper()
		body := map[string]any{
			"company_id":       companyID,
			"parent_entity_id": childID,
			"target_type":      "node",
			"target_id":        targetID,
		}
		if position != 0 {
			body["position"] = position
		}
		encoded, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/items", bytes.NewReader(encoded))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST company explorer item status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
		}
		var row store.CompanyExplorerV2Row
		if err := json.NewDecoder(rec.Body).Decode(&row); err != nil {
			t.Fatalf("decode company explorer item: %v", err)
		}
		if row.EdgeID == "" || row.EntityType != "node" || row.ResourceID != targetID || row.ParentEntityID != childID {
			t.Fatalf("placed row = %+v, want node target %s under child folder", row, targetID)
		}
		return row
	}

	placeItem(node.NodeID, 0)
	placeItem(secondNode.NodeID, 0)
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
	thirdAssigned := placeItem(thirdNode.NodeID, 0)
	if thirdAssigned.Position != 4000 {
		t.Fatalf("third item position = %d, want 4000 after folder sibling", thirdAssigned.Position)
	}

	placeItem(node.NodeID, 5000)

	childrenReq := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/children?company_id="+companyID+"&parent_id="+childID, nil)
	childrenRec := httptest.NewRecorder()
	handler.ServeHTTP(childrenRec, childrenReq)
	if childrenRec.Code != http.StatusOK {
		t.Fatalf("GET company explorer children status = %d, want %d body=%s", childrenRec.Code, http.StatusOK, childrenRec.Body.String())
	}
	var children store.CompanyExplorerV2Rows
	if err := json.NewDecoder(childrenRec.Body).Decode(&children); err != nil {
		t.Fatalf("decode folder children: %v", err)
	}
	nodeRows := make([]store.CompanyExplorerV2Row, 0, 3)
	foundMixedFolder := false
	for _, row := range children.Rows {
		if row.EntityType == "folder" && row.Name == "Mixed sibling folder" && row.ParentEntityID == childID && row.Position == 3000 {
			foundMixedFolder = true
			continue
		}
		if row.EntityType == "node" {
			nodeRows = append(nodeRows, row)
		}
	}
	if !foundMixedFolder {
		t.Fatalf("children rows = %+v, want mixed child folder at position 3000", children.Rows)
	}
	if len(nodeRows) != 3 || nodeRows[0].ResourceID != secondNode.NodeID || nodeRows[1].ResourceID != thirdNode.NodeID || nodeRows[1].Position != 4000 || nodeRows[2].ResourceID != node.NodeID || nodeRows[2].Position != 5000 {
		t.Fatalf("node child rows = %+v, want reordered final item refs in child folder", nodeRows)
	}

	siblingReq := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/children?company_id="+companyID+"&parent_id="+siblingID, nil)
	siblingRec := httptest.NewRecorder()
	handler.ServeHTTP(siblingRec, siblingReq)
	if siblingRec.Code != http.StatusOK {
		t.Fatalf("GET sibling company explorer children status = %d, want %d body=%s", siblingRec.Code, http.StatusOK, siblingRec.Body.String())
	}
	var siblingChildren store.CompanyExplorerV2Rows
	if err := json.NewDecoder(siblingRec.Body).Decode(&siblingChildren); err != nil {
		t.Fatalf("decode sibling children: %v", err)
	}
	foundMovedChild := false
	for _, row := range siblingChildren.Rows {
		if row.EntityType == "folder" && row.EntityID == childID && row.ParentEntityID == siblingID {
			foundMovedChild = true
		}
	}
	if !foundMovedChild {
		t.Fatalf("sibling children = %+v, want moved child folder", siblingChildren.Rows)
	}
}

func TestCompanyExplorerSnapshotCarriesGVICAndLogicGateMembership(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-explorer-gvic-snapshot"
	repo.EnsureCompany(companyID, "GVIC Snapshot Company")

	generatedSubject := "gvic-snapshot-generated"
	generated, err := repo.UpsertAuthUser(generatedSubject, "generated-snapshot@example.com", "Generated Snapshot")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(generatedSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "GVIC Snapshot Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.AddResourceGVICAssignments(store.ResourceGVICAssignmentCommandInput{
		CompanyID:    companyID,
		ResourceType: store.EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []store.ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleGenerated,
			PrincipalType: store.EntityPermissionSubjectUser,
			PrincipalID:   generated.UserID,
		}},
		ActorUserID:    generated.UserID,
		IdempotencyKey: "company-explorer-gvic-snapshot",
	}); err != nil {
		t.Fatalf("AddResourceGVICAssignments: %v", err)
	}
	priority := 3
	created, err := repo.CreateGVICMatrixNode(store.GVICMatrixNodeCreateInput{
		CompanyID:      companyID,
		Title:          "GVIC Snapshot Node",
		LogicGateID:    logicGate.LogicGateID,
		ActorUserID:    generated.UserID,
		IdempotencyKey: "company-explorer-gvic-node",
		MutationOrigin: "matrix",
		Priority:       &priority,
		PrioritySet:    true,
	})
	if err != nil {
		t.Fatalf("CreateGVICMatrixNode: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID+"&scope=company_explorer", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET company explorer workspace snapshot status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload struct {
		Nodes      []domain.Node      `json:"nodes"`
		LogicGates []domain.LogicGate `json:"logic_gates"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}

	var snapshotGate *domain.LogicGate
	for i := range payload.LogicGates {
		if payload.LogicGates[i].LogicGateID == logicGate.LogicGateID {
			snapshotGate = &payload.LogicGates[i]
			break
		}
	}
	if snapshotGate == nil {
		t.Fatalf("snapshot logic gates = %+v, missing %s", payload.LogicGates, logicGate.LogicGateID)
	}
	if len(snapshotGate.GVICAssignments) != 1 ||
		snapshotGate.GVICAssignments[0].Role != domain.GVICRoleGenerated ||
		snapshotGate.GVICAssignments[0].PrincipalType != store.EntityPermissionSubjectUser ||
		snapshotGate.GVICAssignments[0].PrincipalID != generated.UserID ||
		snapshotGate.GVICAssignments[0].UserID != generated.UserID {
		t.Fatalf("snapshot gate gvic_assignments = %+v, want generated assignment", snapshotGate.GVICAssignments)
	}

	var snapshotNode *domain.Node
	for i := range payload.Nodes {
		if payload.Nodes[i].NodeID == created.Node.NodeID {
			snapshotNode = &payload.Nodes[i]
			break
		}
	}
	if snapshotNode == nil {
		t.Fatalf("snapshot nodes = %+v, missing %s", payload.Nodes, created.Node.NodeID)
	}
	if !stringSliceContains(snapshotNode.LogicGateIDs, logicGate.LogicGateID) {
		t.Fatalf("snapshot node logic_gate_ids = %+v, want %s", snapshotNode.LogicGateIDs, logicGate.LogicGateID)
	}
}

func stringSliceContains(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func TestCompanyExplorerFolderGETDoesNotSeedDefaults(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-folder-get-read-only-test"

	listFolders := func() []domain.CompanyExplorerFolder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/folders?company_id="+companyID, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET folders status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
		}
		var payload struct {
			Folders []domain.CompanyExplorerFolder `json:"folders"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("decode folders: %v", err)
		}
		return payload.Folders
	}

	if folders := listFolders(); len(folders) != 0 {
		t.Fatalf("first GET returned %d folders, want no read-time default seeding: %+v", len(folders), folders)
	}
	if folders := listFolders(); len(folders) != 0 {
		t.Fatalf("second GET returned %d folders, want no read-time default seeding: %+v", len(folders), folders)
	}
}

func TestCompanyExplorerDefaultFoldersSeedOnceAndProtectSystemFolders(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-default-folder-seed-test"
	repo.EnsureCompany(companyID, "Default Folder Seed Company")

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
	if len(systemNames) != 4 || !systemNames["Active Nodes"] || !systemNames["Active Logic Gates"] || !systemNames["Active Projects"] || !systemNames["History"] || systemFolderID == "" {
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
		if folder.FolderKind == "logic_gate" && folder.SystemKey == nil {
			t.Fatalf("logic gate default folder was recreated after delete: %+v", folder)
		}
		if folder.SystemKey != nil {
			systemCount++
		}
	}
	if systemCount != 4 {
		t.Fatalf("system folder count after default delete = %d, want 4", systemCount)
	}
}

func TestCompanyExplorerFolderCreateIgnoresDeprecatedFolderKind(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-communications-folder-cutoff-test"
	repo.EnsureCompany(companyID, "Communications Folder Cutoff Company")

	createBody, _ := json.Marshal(map[string]string{
		"company_id":  companyID,
		"folder_kind": "communications",
		"name":        "Shared",
	})
	createReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/folders", bytes.NewReader(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("POST deprecated folder_kind company explorer folder status = %d, want %d body=%s", createRec.Code, http.StatusCreated, createRec.Body.String())
	}
	var payload store.CompanyExplorerV2Row
	if err := json.NewDecoder(createRec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode created folder: %v", err)
	}
	if payload.EntityType != store.CompanyExplorerV2EntityFolder || payload.EntityID == "" {
		t.Fatalf("created deprecated folder_kind payload = %+v, want normal folder row", payload)
	}
}

func TestCommunicationsSharedInboxGVICAPI(t *testing.T) {
	t.Parallel()

	backing := store.NewMemoryRepo()
	repo := backing
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-shared-inbox-gvic-test"
	repo.EnsureCompany(companyID, "Shared Inbox GVIC Test")

	generated, err := repo.UpsertAuthUser("subject-shared-gvic-generated", "generated@example.com", "Generated Person")
	if err != nil {
		t.Fatalf("UpsertAuthUser generated error = %v", err)
	}
	verified, err := repo.UpsertAuthUser("subject-shared-gvic-verified", "verified@example.com", "Verified Person")
	if err != nil {
		t.Fatalf("UpsertAuthUser verified error = %v", err)
	}
	informedMember, err := repo.UpsertAuthUser("subject-shared-gvic-informed", "informed@example.com", "Informed Person")
	if err != nil {
		t.Fatalf("UpsertAuthUser informed member error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(generated.CognitoSubject, companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership generated error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(verified.CognitoSubject, companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership verified error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(informedMember.CognitoSubject, companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership informed member error = %v", err)
	}
	department, err := repo.CreateCompanyUserGroup(companyID, "", "Finance")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup error = %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, department.GroupID, []string{informedMember.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers error = %v", err)
	}

	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       generated.UserID,
		Provider:     "google",
		AccountEmail: "ar@example.com",
		Scope:        "shared",
		GrantID:      "grant-ar-gvic",
		Status:       "connected",
	}); err != nil {
		t.Fatalf("UpsertUserEmailConnection shared error = %v", err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "AR", "ar@example.com")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder error = %v", err)
	}
	body, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"gvic_assignments": []map[string]string{
			{"role": domain.GVICRoleGenerated, "principal_type": store.EntityPermissionSubjectUser, "principal_id": generated.UserID},
			{"role": domain.GVICRoleVerified, "principal_type": store.EntityPermissionSubjectUser, "principal_id": verified.UserID},
			{"role": domain.GVICRoleInformed, "principal_type": store.EntityPermissionSubjectGroup, "principal_id": department.GroupID},
		},
	})
	resourceType := store.CommunicationsSharedInboxGVICResourceType(folder)
	req := httptest.NewRequest(http.MethodPut, "/v1/resources/"+resourceType+"/"+folder.FolderID+"/gvic", bytes.NewReader(body))
	req = requestWithActorForTest(req, generated, companyID)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT shared inbox GVIC status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var updatePayload struct {
		Assignments          []domain.ResourceGVICAssignment          `json:"gvic_assignments"`
		EffectiveAssignments []domain.ResourceGVICEffectiveAssignment `json:"effective_assignments"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&updatePayload); err != nil {
		t.Fatalf("decode PUT shared inbox GVIC: %v", err)
	}
	if len(updatePayload.Assignments) != 3 {
		t.Fatalf("PUT shared inbox GVIC assignment count = %d, want 3", len(updatePayload.Assignments))
	}
	foundGenerated := false
	foundGroupSource := false
	for _, assignment := range updatePayload.Assignments {
		if assignment.ResourceType != resourceType || assignment.ResourceID != folder.FolderID {
			t.Fatalf("assignment = %+v, want resource %s/%s", assignment, resourceType, folder.FolderID)
		}
		if assignment.Role == domain.GVICRoleGenerated && assignment.PrincipalType == store.EntityPermissionSubjectUser && assignment.PrincipalID == generated.UserID && assignment.UserID == generated.UserID {
			foundGenerated = true
		}
		if assignment.Role == domain.GVICRoleInformed && assignment.PrincipalType == store.EntityPermissionSubjectGroup && assignment.PrincipalID == department.GroupID {
			foundGroupSource = true
		}
	}
	if !foundGenerated || !foundGroupSource {
		t.Fatalf("gvic source assignments = %+v, want generated user and informed group", updatePayload.Assignments)
	}
	foundExpandedMember := false
	for _, assignment := range updatePayload.EffectiveAssignments {
		if assignment.Role == domain.GVICRoleInformed && assignment.UserID == informedMember.UserID && assignment.SourcePrincipalType == store.EntityPermissionSubjectGroup && assignment.SourcePrincipalID == department.GroupID {
			foundExpandedMember = true
		}
	}
	if !foundExpandedMember {
		t.Fatalf("effective assignments = %+v, want informed group expanded to member", updatePayload.EffectiveAssignments)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/communications/shared-inboxes?company_id="+companyID, nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET communications folders status = %d, want %d body=%s", listRec.Code, http.StatusOK, listRec.Body.String())
	}
	var listPayload struct {
		Folders []struct {
			FolderID    string                          `json:"folder_id"`
			Assignments []domain.ResourceGVICAssignment `json:"gvic_assignments"`
		} `json:"shared_inboxes"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode communications folders: %v", err)
	}
	for _, listed := range listPayload.Folders {
		if listed.FolderID != folder.FolderID {
			continue
		}
		if len(listed.Assignments) != 3 {
			t.Fatalf("listed assignment count = %d, want 3", len(listed.Assignments))
		}
		foundGroup := false
		for _, assignment := range listed.Assignments {
			if assignment.Role == domain.GVICRoleInformed && assignment.PrincipalType == store.EntityPermissionSubjectGroup && assignment.PrincipalID == department.GroupID {
				foundGroup = true
			}
		}
		if !foundGroup {
			t.Fatalf("listed assignments = %+v, want informed department GVIC assignment", listed.Assignments)
		}
		return
	}
	t.Fatalf("folder %s not found in list payload", folder.FolderID)
}

func TestCommunicationsSharedTriageGVICDoesNotInheritFromParent(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-shared-triage-gvic-inheritance-test"
	repo.EnsureCompany(companyID, "Shared Triage GVIC Inheritance")

	parentUser, err := repo.UpsertAuthUser("subject-shared-gvic-parent", "parent-gvic@example.com", "Parent GVIC")
	if err != nil {
		t.Fatalf("UpsertAuthUser parent error = %v", err)
	}
	childUser, err := repo.UpsertAuthUser("subject-shared-gvic-child", "child-gvic@example.com", "Child GVIC")
	if err != nil {
		t.Fatalf("UpsertAuthUser child error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(parentUser.CognitoSubject, companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership parent error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(childUser.CognitoSubject, companyID, "company_user"); err != nil {
		t.Fatalf("AddCompanyMembership child error = %v", err)
	}

	parent, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Parent", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder parent error = %v", err)
	}
	child, err := repo.CreateCommunicationsSharedInboxFolder(companyID, parent.FolderID, "Child", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder child error = %v", err)
	}

	parentBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"gvic_assignments": []map[string]string{
			{"role": domain.GVICRoleGenerated, "principal_type": store.EntityPermissionSubjectUser, "principal_id": parentUser.UserID},
		},
	})
	parentReq := httptest.NewRequest(http.MethodPut, "/v1/resources/"+store.EntityTypeSharedTriageFolder+"/"+parent.FolderID+"/gvic", bytes.NewReader(parentBody))
	parentReq = requestWithActorForTest(parentReq, parentUser, companyID)
	parentReq.Header.Set("Content-Type", "application/json")
	parentRec := httptest.NewRecorder()
	handler.ServeHTTP(parentRec, parentReq)
	if parentRec.Code != http.StatusOK {
		t.Fatalf("PUT parent folder GVIC status = %d, want %d body=%s", parentRec.Code, http.StatusOK, parentRec.Body.String())
	}

	childBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"gvic_assignments": []map[string]string{
			{"role": domain.GVICRoleVerified, "principal_type": store.EntityPermissionSubjectUser, "principal_id": childUser.UserID},
		},
	})
	childReq := httptest.NewRequest(http.MethodPut, "/v1/resources/"+store.EntityTypeSharedTriageFolder+"/"+child.FolderID+"/gvic", bytes.NewReader(childBody))
	childReq = requestWithActorForTest(childReq, childUser, companyID)
	childReq.Header.Set("Content-Type", "application/json")
	childRec := httptest.NewRecorder()
	handler.ServeHTTP(childRec, childReq)
	if childRec.Code != http.StatusOK {
		t.Fatalf("PUT child GVIC status = %d, want %d body=%s", childRec.Code, http.StatusOK, childRec.Body.String())
	}
	var childPayload struct {
		Assignments          []domain.ResourceGVICAssignment          `json:"gvic_assignments"`
		EffectiveAssignments []domain.ResourceGVICEffectiveAssignment `json:"effective_assignments"`
	}
	if err := json.NewDecoder(childRec.Body).Decode(&childPayload); err != nil {
		t.Fatalf("decode PUT child GVIC: %v", err)
	}
	if len(childPayload.Assignments) != 1 {
		t.Fatalf("child PUT assignment count = %d, want direct child only", len(childPayload.Assignments))
	}
	if childPayload.Assignments[0].ResourceID != child.FolderID || childPayload.Assignments[0].Role != domain.GVICRoleVerified || childPayload.Assignments[0].UserID != childUser.UserID {
		t.Fatalf("child assignment = %+v, want direct child assignment only", childPayload.Assignments[0])
	}
	if len(childPayload.EffectiveAssignments) != 1 || childPayload.EffectiveAssignments[0].Role != domain.GVICRoleVerified || childPayload.EffectiveAssignments[0].UserID != childUser.UserID {
		t.Fatalf("child effective assignments = %+v, want direct verified child only", childPayload.EffectiveAssignments)
	}
}

func TestCommunicationsSharedInboxAccountEmailAPI(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-shared-inbox-account-test"
	repo.EnsureCompany(companyID, "Shared Inbox Account Company")

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
		Scope:        "shared",
		GrantID:      "grant-shared-account",
		Status:       "connected",
	}); err != nil {
		t.Fatalf("UpsertUserEmailConnection error = %v", err)
	}

	createBody, _ := json.Marshal(map[string]string{
		"company_id":    companyID,
		"name":          "AR Inbox",
		"account_email": "TRIAGE@example.com",
	})
	createReq := httptest.NewRequest(http.MethodPost, "/v1/communications/shared-inboxes", bytes.NewReader(createBody))
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

	listReq := httptest.NewRequest(http.MethodGet, "/v1/communications/shared-inboxes?company_id="+companyID, nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET communications folders status = %d, want %d body=%s", listRec.Code, http.StatusOK, listRec.Body.String())
	}
	var listPayload struct {
		Folders []struct {
			FolderID     string `json:"folder_id"`
			AccountEmail string `json:"account_email"`
		} `json:"shared_inboxes"`
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
	clearReq := httptest.NewRequest(http.MethodPut, "/v1/communications/shared-inboxes/"+created.FolderID, bytes.NewReader(clearBody))
	clearReq.Header.Set("Content-Type", "application/json")
	clearRec := httptest.NewRecorder()
	handler.ServeHTTP(clearRec, clearReq)
	if clearRec.Code != http.StatusBadRequest {
		t.Fatalf("PUT clear shared inbox account status = %d, want %d body=%s", clearRec.Code, http.StatusBadRequest, clearRec.Body.String())
	}

	missingBody, _ := json.Marshal(map[string]string{
		"company_id":    companyID,
		"name":          "Missing Account",
		"account_email": "missing@example.com",
	})
	missingReq := httptest.NewRequest(http.MethodPost, "/v1/communications/shared-inboxes", bytes.NewReader(missingBody))
	missingReq.Header.Set("Content-Type", "application/json")
	missingRec := httptest.NewRecorder()
	handler.ServeHTTP(missingRec, missingReq)
	if missingRec.Code != http.StatusBadRequest {
		t.Fatalf("POST missing shared inbox account status = %d, want %d body=%s", missingRec.Code, http.StatusBadRequest, missingRec.Body.String())
	}
}

func TestCompanyExplorerFolderAndItemListEndpointsSupportSubtreeReads(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-folder-list-subtree-test"

	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder parent error = %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "node", "Child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder child error = %v", err)
	}
	sibling, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Sibling")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder sibling error = %v", err)
	}
	nodeA, err := repo.CreateNode(companyID, "Node A")
	if err != nil {
		t.Fatalf("CreateNode A error = %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Node B")
	if err != nil {
		t.Fatalf("CreateNode B error = %v", err)
	}
	nodeOutside, err := repo.CreateNode(companyID, "Node outside")
	if err != nil {
		t.Fatalf("CreateNode outside error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parent.FolderID, "node", nodeA.NodeID, 1000); err != nil {
		t.Fatalf("Assign node A error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, child.FolderID, "node", nodeB.NodeID, 2000); err != nil {
		t.Fatalf("Assign node B error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, sibling.FolderID, "node", nodeOutside.NodeID, 3000); err != nil {
		t.Fatalf("Assign outside node error = %v", err)
	}

	assertIDs := func(label string, got []string, want ...string) {
		t.Helper()
		seen := make(map[string]bool, len(got))
		for _, id := range got {
			seen[id] = true
		}
		if len(seen) != len(want) {
			t.Fatalf("%s ids = %v, want %v", label, got, want)
		}
		for _, id := range want {
			if !seen[id] {
				t.Fatalf("%s ids = %v, missing %s", label, got, id)
			}
		}
	}

	foldersReq := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/folders?company_id="+companyID+"&folder_kind=node&folder_id="+parent.FolderID, nil)
	foldersRec := httptest.NewRecorder()
	handler.ServeHTTP(foldersRec, foldersReq)
	if foldersRec.Code != http.StatusOK {
		t.Fatalf("GET folders subtree status = %d, want %d body=%s", foldersRec.Code, http.StatusOK, foldersRec.Body.String())
	}
	var foldersPayload struct {
		Folders []domain.CompanyExplorerFolder `json:"folders"`
	}
	if err := json.NewDecoder(foldersRec.Body).Decode(&foldersPayload); err != nil {
		t.Fatalf("decode folders subtree: %v", err)
	}
	folderIDs := make([]string, 0, len(foldersPayload.Folders))
	for _, folder := range foldersPayload.Folders {
		folderIDs = append(folderIDs, folder.FolderID)
	}
	assertIDs("folders", folderIDs, parent.FolderID, child.FolderID)

	invalidFolderReq := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/folders?company_id="+companyID+"&folder_kind=node&folder_id=bad-folder-id", nil)
	invalidFolderRec := httptest.NewRecorder()
	handler.ServeHTTP(invalidFolderRec, invalidFolderReq)
	if invalidFolderRec.Code != http.StatusBadRequest {
		t.Fatalf("GET invalid folders subtree status = %d, want %d body=%s", invalidFolderRec.Code, http.StatusBadRequest, invalidFolderRec.Body.String())
	}
}
func TestCommunicationsSharedInboxVisibleListUsesDefaultAccessOverrides(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	companyID := "company-shared-inbox-visible-default-test"
	repo.EnsureCompany(companyID, "Shared Inbox Visible Default")

	user, err := repo.UpsertAuthUser("shared-visible-user", "visible@example.com", "Visible")
	if err != nil {
		t.Fatalf("UpsertAuthUser error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership error = %v", err)
	}
	visible, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Visible", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder visible error = %v", err)
	}
	hidden, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Hidden", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder hidden error = %v", err)
	}
	for _, folder := range []domain.CompanyExplorerFolder{visible, hidden} {
		if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID:        companyID,
			EntityType:       store.EntityTypeSharedInboxFolder,
			EntityID:         folder.FolderID,
			DefaultAccess:    store.ResourceDefaultAccessNoAccess,
			DefaultAccessSet: true,
		}); err != nil {
			t.Fatalf("SetEntityPermissions default %s error = %v", folder.FolderID, err)
		}
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeSharedInboxFolder,
		EntityID:         visible.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		OverrideUserIDs:  []string{user.UserID},
	}); err != nil {
		t.Fatalf("SetEntityPermissions visible override error = %v", err)
	}

	folders, err := repo.ListVisibleCommunicationsSharedInboxFolders(companyID, user.UserID)
	if err != nil {
		t.Fatalf("ListVisibleCommunicationsSharedInboxFolders error = %v", err)
	}
	ids := map[string]bool{}
	for _, folder := range folders {
		ids[folder.FolderID] = true
	}
	if !ids[visible.FolderID] || ids[hidden.FolderID] {
		t.Fatalf("visible shared inbox IDs = %v, want only %q", ids, visible.FolderID)
	}
}

func TestCompanyExplorerCommunicationsFolderListDoesNotApplyGVICFiltering(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-shared-inbox-list-unfiltered-test"
	repo.EnsureCompany(companyID, "Shared Inbox List Unfiltered")

	currentUser, err := repo.UpsertAuthUser("shared-inbox-current", "current@example.com", "Current")
	if err != nil {
		t.Fatalf("UpsertAuthUser current error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(currentUser.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership current error = %v", err)
	}
	assignedUser, err := repo.UpsertAuthUser("shared-inbox-assigned", "assigned@example.com", "Assigned")
	if err != nil {
		t.Fatalf("UpsertAuthUser assigned error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(assignedUser.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership assigned error = %v", err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       assignedUser.UserID,
		Provider:     "google",
		AccountEmail: "assigned-shared@example.com",
		Scope:        "shared",
		GrantID:      "grant-assigned-shared",
		Status:       "connected",
	}); err != nil {
		t.Fatalf("UpsertUserEmailConnection assigned shared error = %v", err)
	}

	unassigned, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Unassigned", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder unassigned error = %v", err)
	}
	assigned, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Assigned", "assigned-shared@example.com")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder assigned error = %v", err)
	}
	if _, err := repo.SetCommunicationsSharedInboxGVICAssignments(store.SharedInboxGVICAssignmentUpdateInput{
		CompanyID: companyID,
		FolderID:  assigned.FolderID,
		Assignments: []store.SharedInboxGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: assignedUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetCommunicationsSharedInboxGVICAssignments assigned error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/shared-inboxes?company_id="+companyID, nil)
	req = requestWithActorForTest(req, currentUser, companyID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET communications folders status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var payload struct {
		Folders []domain.CompanyExplorerFolder `json:"shared_inboxes"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode communications folders: %v", err)
	}
	ids := map[string]bool{}
	for _, folder := range payload.Folders {
		ids[folder.FolderID] = true
	}
	if !ids[unassigned.FolderID] || !ids[assigned.FolderID] {
		t.Fatalf("communications folder list IDs = %v, want both %q and %q", ids, unassigned.FolderID, assigned.FolderID)
	}
}

func TestCompanyExplorerItemPlacementDoesNotBreakNativeRelationships(t *testing.T) {
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
			FolderID string `json:"entity_id"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("decode folder %s: %v", name, err)
		}
		return payload.FolderID
	}

	assign := func(folderID, itemType, itemID string, position int) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"company_id":       companyID,
			"parent_entity_id": folderID,
			"target_type":      itemType,
			"target_id":        itemID,
			"position":         position,
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/items", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST company explorer item %s/%s status = %d, want %d body=%s", itemType, itemID, rec.Code, http.StatusCreated, rec.Body.String())
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
	if len(nodeRelationships) != 1 {
		t.Fatalf("node relationships after cross-folder reference move = %d, want 1", len(nodeRelationships))
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
	if len(nodeRelationships) != 2 {
		t.Fatalf("node relationships after same-folder reorder = %d, want 2", len(nodeRelationships))
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
	if len(logicRelationships) != 1 {
		t.Fatalf("logic-gate relationships after cross-folder reference move = %d, want 1", len(logicRelationships))
	}
}

func TestCompanyExplorerLazyRootsReturnOnlyRootRows(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-lazy-roots-test"
	repo.EnsureCompany(companyID, "Lazy Roots")

	root, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Root")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder root error = %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, root.FolderID, "node", "Child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder child error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/roots?company_id="+companyID+"&scope=all", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET lazy roots status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	payload := decodeCompanyExplorerLazyRowsForTest(t, rec)
	rootFolders := companyExplorerLazyFolderIDSet(payload)
	if !rootFolders[root.FolderID] {
		t.Fatalf("lazy roots = %v, want root folder %s", payload.Rows, root.FolderID)
	}
	if rootFolders[child.FolderID] {
		t.Fatalf("lazy roots included child folder %s", child.FolderID)
	}
	if companies := companyExplorerLazyCompanyIDSet(payload); companies[companyID] {
		t.Fatalf("lazy roots included synthetic company root %s: %+v", companyID, payload.Rows)
	}

	childReq := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/children?company_id="+companyID+"&scope=all&parent_id="+companyID, nil)
	childRec := httptest.NewRecorder()
	handler.ServeHTTP(childRec, childReq)
	if childRec.Code != http.StatusOK {
		t.Fatalf("GET company root children status = %d, want %d body=%s", childRec.Code, http.StatusOK, childRec.Body.String())
	}
	folders := companyExplorerLazyFolderIDSet(decodeCompanyExplorerLazyRowsForTest(t, childRec))
	if !folders[root.FolderID] {
		t.Fatalf("lazy root folders = %v, want root folder %s", folders, root.FolderID)
	}
	if folders[child.FolderID] {
		t.Fatalf("lazy root folders included child folder %s", child.FolderID)
	}
}

func TestCompanyExplorerLazyFolderChildrenReturnImmediateRowsOnly(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-lazy-folder-children-test"
	repo.EnsureCompany(companyID, "Lazy Folder Children")

	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder parent error = %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "node", "Child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder child error = %v", err)
	}
	grandchild, err := repo.CreateCompanyExplorerFolder(companyID, child.FolderID, "node", "Grandchild")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder grandchild error = %v", err)
	}
	parentNode, err := repo.CreateNode(companyID, "Parent node")
	if err != nil {
		t.Fatalf("CreateNode parent error = %v", err)
	}
	childNode, err := repo.CreateNode(companyID, "Child node")
	if err != nil {
		t.Fatalf("CreateNode child error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parent.FolderID, "node", parentNode.NodeID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem parent error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, child.FolderID, "node", childNode.NodeID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem child error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/children?company_id="+companyID+"&scope=all&parent_type=folder&parent_id="+parent.FolderID, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET lazy folder children status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	payload := decodeCompanyExplorerLazyRowsForTest(t, rec)
	folders := companyExplorerLazyFolderIDSet(payload)
	nodes := companyExplorerLazyNodeIDSet(payload)
	items := companyExplorerLazyFolderItemIDSet(payload)
	if !folders[child.FolderID] || folders[grandchild.FolderID] {
		t.Fatalf("lazy child folders = %v, want child only and no grandchild", folders)
	}
	if !nodes[parentNode.NodeID] || nodes[childNode.NodeID] {
		t.Fatalf("lazy child nodes = %v, want parent node only", nodes)
	}
	if !items[parentNode.NodeID] || items[childNode.NodeID] {
		t.Fatalf("lazy child folder items = %v, want parent item only", items)
	}
}

func TestCompanyExplorerBatchDeleteTargetsMovesV2RowsToRecycleBinAndRestores(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-explorer-batch-delete-test"
	repo.EnsureCompany(companyID, "Batch Delete")

	folder, err := repo.CreateCompanyExplorerV2Folder(store.CompanyExplorerV2FolderInput{
		CompanyID:      companyID,
		ParentEntityID: companyID,
		Name:           "Placed work",
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder: %v", err)
	}
	nodeA, err := repo.CreateNode(companyID, "Batch node A")
	if err != nil {
		t.Fatalf("CreateNode A: %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Batch node B")
	if err != nil {
		t.Fatalf("CreateNode B: %v", err)
	}
	rowA, err := repo.UpsertCompanyExplorerV2Edge(store.CompanyExplorerV2EdgeInput{
		CompanyID:       companyID,
		ParentEntityID:  folder.EntityID,
		ChildEntityType: store.CompanyExplorerV2EntityNode,
		ChildResourceID: nodeA.NodeID,
	})
	if err != nil {
		t.Fatalf("UpsertCompanyExplorerV2Edge A: %v", err)
	}
	rowB, err := repo.UpsertCompanyExplorerV2Edge(store.CompanyExplorerV2EdgeInput{
		CompanyID:       companyID,
		ParentEntityID:  folder.EntityID,
		ChildEntityType: store.CompanyExplorerV2EntityNode,
		ChildResourceID: nodeB.NodeID,
	})
	if err != nil {
		t.Fatalf("UpsertCompanyExplorerV2Edge B: %v", err)
	}

	body := []byte(`{"company_id":"` + companyID + `","targets":[` +
		`{"kind":"node","id":"` + nodeA.NodeID + `","edge_id":"` + rowA.EdgeID + `"},` +
		`{"kind":"node","id":"` + nodeB.NodeID + `","edge_id":"` + rowB.EdgeID + `"}` +
		`]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/delete-targets", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST batch delete status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	children, err := repo.ListCompanyExplorerV2ChildRows(store.CompanyExplorerV2RowsQuery{
		CompanyID:      companyID,
		View:           store.CompanyExplorerLazyScopeAll,
		ParentEntityID: folder.EntityID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows after delete: %v", err)
	}
	if len(children.Rows) != 0 {
		t.Fatalf("children after batch edge delete = %+v, want empty", children.Rows)
	}
	if _, err := repo.GetNode(companyID, nodeA.NodeID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("GetNode A after delete err = %v, want ErrNotFound", err)
	}
	recycleItems, err := repo.ListRecycleBinItems(companyID)
	if err != nil {
		t.Fatalf("ListRecycleBinItems after delete: %v", err)
	}
	if len(recycleItems) != 2 {
		t.Fatalf("recycle items after delete = %d, want 2; items=%+v", len(recycleItems), recycleItems)
	}
	events, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{
		CompanyID:     companyID,
		StreamType:    workspaceDomainStreamType,
		StreamID:      companyID,
		AfterSequence: 0,
		Limit:         10,
	})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	removed := 0
	for _, event := range events {
		if event.Type == "node_deleted" {
			removed++
		}
	}
	if removed != 2 {
		t.Fatalf("node_deleted events = %d, want 2; events=%+v", removed, events)
	}
	itemIDs := make([]string, 0, len(recycleItems))
	for _, item := range recycleItems {
		itemIDs = append(itemIDs, item.RecycleBinItemID)
	}
	if _, err := repo.RestoreRecycleBinItems(companyID, itemIDs); err != nil {
		t.Fatalf("RestoreRecycleBinItems failed: %v", err)
	}
	children, err = repo.ListCompanyExplorerV2ChildRows(store.CompanyExplorerV2RowsQuery{
		CompanyID:      companyID,
		View:           store.CompanyExplorerLazyScopeAll,
		ParentEntityID: folder.EntityID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows after restore: %v", err)
	}
	if len(children.Rows) != 2 {
		t.Fatalf("children after restore = %d, want 2", len(children.Rows))
	}
}

func TestCompanyExplorerBatchDeleteTargetsRemovesMoreThanFolderItemBatchLimit(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-explorer-large-batch-delete-test"
	repo.EnsureCompany(companyID, "Large Batch Delete")

	folder, err := repo.CreateCompanyExplorerV2Folder(store.CompanyExplorerV2FolderInput{
		CompanyID:      companyID,
		ParentEntityID: companyID,
		Name:           "Many placed work items",
	})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder: %v", err)
	}
	count := store.CompanyExplorerFolderItemBatchMaxItems + 25
	targets := make([]map[string]string, 0, count)
	for index := 0; index < count; index++ {
		node, err := repo.CreateNode(companyID, fmt.Sprintf("Large batch node %03d", index))
		if err != nil {
			t.Fatalf("CreateNode %d: %v", index, err)
		}
		row, err := repo.UpsertCompanyExplorerV2Edge(store.CompanyExplorerV2EdgeInput{
			CompanyID:       companyID,
			ParentEntityID:  folder.EntityID,
			ChildEntityType: store.CompanyExplorerV2EntityNode,
			ChildResourceID: node.NodeID,
		})
		if err != nil {
			t.Fatalf("UpsertCompanyExplorerV2Edge %d: %v", index, err)
		}
		targets = append(targets, map[string]string{"kind": "node", "id": node.NodeID, "edge_id": row.EdgeID})
	}

	body, err := json.Marshal(map[string]any{"company_id": companyID, "targets": targets})
	if err != nil {
		t.Fatalf("Marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/delete-targets", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST large batch delete status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var response struct {
		Targets []store.CompanyExplorerDeletedTarget `json:"targets"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("Unmarshal response: %v", err)
	}
	if len(response.Targets) != count {
		t.Fatalf("deleted targets = %d, want %d", len(response.Targets), count)
	}
	children, err := repo.ListCompanyExplorerV2ChildRows(store.CompanyExplorerV2RowsQuery{
		CompanyID:      companyID,
		View:           store.CompanyExplorerLazyScopeAll,
		ParentEntityID: folder.EntityID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows after delete: %v", err)
	}
	if len(children.Rows) != 0 {
		t.Fatalf("children after large batch edge delete = %d, want empty", len(children.Rows))
	}
	recycleItems, err := repo.ListRecycleBinItems(companyID)
	if err != nil {
		t.Fatalf("ListRecycleBinItems after large delete: %v", err)
	}
	if len(recycleItems) != count {
		t.Fatalf("recycle items after large delete = %d, want %d", len(recycleItems), count)
	}
	itemIDs := make([]string, 0, len(recycleItems))
	for _, item := range recycleItems {
		itemIDs = append(itemIDs, item.RecycleBinItemID)
	}
	if _, err := repo.RestoreRecycleBinItems(companyID, itemIDs); err != nil {
		t.Fatalf("RestoreRecycleBinItems large batch failed: %v", err)
	}
	children, err = repo.ListCompanyExplorerV2ChildRows(store.CompanyExplorerV2RowsQuery{
		CompanyID:      companyID,
		View:           store.CompanyExplorerLazyScopeAll,
		ParentEntityID: folder.EntityID,
	})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows after large restore: %v", err)
	}
	if len(children.Rows) != count {
		t.Fatalf("children after large restore = %d, want %d", len(children.Rows), count)
	}
	deleteAgainBody, err := json.Marshal(map[string]any{"company_id": companyID, "targets": targets})
	if err != nil {
		t.Fatalf("Marshal second large delete request: %v", err)
	}
	deleteAgainReq := httptest.NewRequest(http.MethodPost, "/v1/company-explorer/delete-targets", bytes.NewReader(deleteAgainBody))
	deleteAgainRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteAgainRec, deleteAgainReq)
	if deleteAgainRec.Code != http.StatusOK {
		t.Fatalf("POST second large batch delete status = %d, want %d body=%s", deleteAgainRec.Code, http.StatusOK, deleteAgainRec.Body.String())
	}
	recycleItems, err = repo.ListRecycleBinItems(companyID)
	if err != nil {
		t.Fatalf("ListRecycleBinItems after second large delete: %v", err)
	}
	itemIDs = itemIDs[:0]
	for _, item := range recycleItems {
		itemIDs = append(itemIDs, item.RecycleBinItemID)
	}
	if err := repo.PermanentlyDeleteRecycleBinItems(companyID, itemIDs); err != nil {
		t.Fatalf("PermanentlyDeleteRecycleBinItems large batch failed: %v", err)
	}
	remainingRecycleItems, err := repo.ListRecycleBinItems(companyID)
	if err != nil {
		t.Fatalf("ListRecycleBinItems after permanent delete: %v", err)
	}
	if len(remainingRecycleItems) != 0 {
		t.Fatalf("recycle items after permanent delete = %d, want empty", len(remainingRecycleItems))
	}
}

func TestCompanyExplorerLazyLogicGateChildrenReturnDirectNodes(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-lazy-gate-children-test"
	repo.EnsureCompany(companyID, "Lazy Gate Children")

	gateA, err := repo.CreateLogicGate(companyID, "Gate A")
	if err != nil {
		t.Fatalf("CreateLogicGate A error = %v", err)
	}
	gateB, err := repo.CreateLogicGate(companyID, "Gate B")
	if err != nil {
		t.Fatalf("CreateLogicGate B error = %v", err)
	}
	nodeA, err := repo.CreateNode(companyID, "Node A")
	if err != nil {
		t.Fatalf("CreateNode A error = %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Node B")
	if err != nil {
		t.Fatalf("CreateNode B error = %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: gateA.LogicGateID,
		NodeID:      nodeA.NodeID,
		Status:      "pending",
		Position:    10,
		Priority:    testPriority(1),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus A error = %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: gateB.LogicGateID,
		NodeID:      nodeB.NodeID,
		Status:      "pending",
		Position:    20,
		Priority:    testPriority(2),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus B error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/children?company_id="+companyID+"&scope=all&parent_type=logic_gate&parent_id="+gateA.LogicGateID, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET lazy logic gate children status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	nodes := companyExplorerLazyNodeIDSet(decodeCompanyExplorerLazyRowsForTest(t, rec))
	if !nodes[nodeA.NodeID] || nodes[nodeB.NodeID] {
		t.Fatalf("lazy logic gate child nodes = %v, want only %s", nodes, nodeA.NodeID)
	}
}

func TestCompanyExplorerLazyRejectsLegacyScopes(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-lazy-scope-test"
	repo.EnsureCompany(companyID, "Lazy Scope")
	for _, scope := range []string{"me", "team"} {
		req := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/roots?company_id="+companyID+"&scope="+scope, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("GET company explorer roots scope=%s status = %d, want %d body=%s", scope, rec.Code, http.StatusBadRequest, rec.Body.String())
		}
	}
	return

	userA, err := repo.UpsertAuthUser("lazy-scope-user-a", "a@example.com", "User A")
	if err != nil {
		t.Fatalf("UpsertAuthUser A error = %v", err)
	}
	userB, err := repo.UpsertAuthUser("lazy-scope-user-b", "b@example.com", "User B")
	if err != nil {
		t.Fatalf("UpsertAuthUser B error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(userA.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership A error = %v", err)
	}
	if _, err := repo.AddCompanyMembership(userB.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership B error = %v", err)
	}
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Team")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup error = %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{userA.UserID, userB.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers error = %v", err)
	}

	gateA, err := repo.CreateLogicGate(companyID, "User A Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate A error = %v", err)
	}
	gateB, err := repo.CreateLogicGate(companyID, "User B Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate B error = %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: gateA.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: userA.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments A error = %v", err)
	}
	if _, err := repo.SetLogicGateGVICAssignments(store.LogicGateGVICAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: gateB.LogicGateID,
		Assignments: []store.LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: userB.UserID}},
	}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments B error = %v", err)
	}
	nodeA, err := repo.CreateNode(companyID, "User A gate node")
	if err != nil {
		t.Fatalf("CreateNode gate A child error = %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "User B gate node")
	if err != nil {
		t.Fatalf("CreateNode gate B child error = %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: gateA.LogicGateID,
		NodeID:      nodeA.NodeID,
		Status:      "pending",
		Position:    10,
		Priority:    testPriority(1),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus A error = %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: gateB.LogicGateID,
		NodeID:      nodeB.NodeID,
		Status:      "pending",
		Position:    10,
		Priority:    testPriority(1),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus B error = %v", err)
	}

	userAFolder := mustCreateScopedCompanyExplorerFolderForTest(t, repo, companyID, "User A folder", store.CompanyExplorerFolderScopeUser, userA.UserID)
	userBFolder := mustCreateScopedCompanyExplorerFolderForTest(t, repo, companyID, "User B folder", store.CompanyExplorerFolderScopeUser, userB.UserID)
	teamFolder := mustCreateScopedCompanyExplorerFolderForTest(t, repo, companyID, "Team folder", store.CompanyExplorerFolderScopeTeam, group.GroupID)
	allFolder := mustCreateScopedCompanyExplorerFolderForTest(t, repo, companyID, "All folder", store.CompanyExplorerFolderScopeCompany, "")
	responsibleRoot := mustCreateScopedCompanyExplorerFolderForTest(t, repo, companyID, "Responsible", store.CompanyExplorerFolderScopeCompany, "")
	nestedResponsible, err := repo.CreateCompanyExplorerFolder(companyID, responsibleRoot.FolderID, "logic_gate", "Nested Responsible Custom")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder nested responsible error = %v", err)
	}
	hiddenFolder := mustCreateScopedCompanyExplorerFolderForTest(t, repo, companyID, "Hidden folder", store.CompanyExplorerFolderScopeCompany, "")
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, allFolder.FolderID, "logic_gate", gateA.LogicGateID, 1000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem gate A error = %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, allFolder.FolderID, "logic_gate", gateB.LogicGateID, 2000); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem gate B error = %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeCompanyExplorerFolder,
		EntityID:         hiddenFolder.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions hidden folder error = %v", err)
	}

	meRows := getCompanyExplorerLazyRowsForTest(t, handler, companyID, "me", userA.UserID)
	meFolders := companyExplorerLazyFolderIDSet(meRows)
	if !meFolders[userAFolder.FolderID] || !meFolders[userBFolder.FolderID] || !meFolders[teamFolder.FolderID] || !meFolders[allFolder.FolderID] || !meFolders[responsibleRoot.FolderID] || meFolders[hiddenFolder.FolderID] {
		t.Fatalf("legacy me folders = %v, want all visible company-wide folder shells", meFolders)
	}

	teamRows := getCompanyExplorerLazyRowsForTest(t, handler, companyID, "team", userA.UserID)
	teamFolders := companyExplorerLazyFolderIDSet(teamRows)
	if !teamFolders[userAFolder.FolderID] || !teamFolders[userBFolder.FolderID] || !teamFolders[teamFolder.FolderID] || !teamFolders[allFolder.FolderID] || !teamFolders[responsibleRoot.FolderID] || teamFolders[hiddenFolder.FolderID] {
		t.Fatalf("legacy team folders = %v, want all visible company-wide folder shells", teamFolders)
	}

	allRows := getCompanyExplorerLazyRowsForTest(t, handler, companyID, "all", userA.UserID)
	allFolders := companyExplorerLazyFolderIDSet(allRows)
	if !allFolders[userAFolder.FolderID] || !allFolders[userBFolder.FolderID] || !allFolders[teamFolder.FolderID] || !allFolders[allFolder.FolderID] || !allFolders[responsibleRoot.FolderID] || allFolders[hiddenFolder.FolderID] {
		t.Fatalf("all folders = %v, want all visible company-wide folder shells and no hidden folder", allFolders)
	}

	responsibleChildren := getCompanyExplorerLazyChildRowsForTest(t, handler, companyID, "me", userA.UserID, "folder", responsibleRoot.FolderID)
	responsibleChildFolders := companyExplorerLazyFolderIDSet(responsibleChildren)
	if !responsibleChildFolders[nestedResponsible.FolderID] {
		t.Fatalf("me scoped responsible children = %v, want nested custom folder %s", responsibleChildFolders, nestedResponsible.FolderID)
	}

	allFolderChildren := getCompanyExplorerLazyChildRowsForTest(t, handler, companyID, "me", userA.UserID, "folder", allFolder.FolderID)
	allFolderItems := companyExplorerLazyFolderItemIDSet(allFolderChildren)
	allFolderLogicGates := companyExplorerLazyLogicGateIDSet(allFolderChildren)
	if !allFolderItems[gateA.LogicGateID] || !allFolderItems[gateB.LogicGateID] || !allFolderLogicGates[gateA.LogicGateID] || !allFolderLogicGates[gateB.LogicGateID] {
		t.Fatalf("legacy me all-folder gate rows items=%v gates=%v, want all company-wide gate rows", allFolderItems, allFolderLogicGates)
	}

	gateAChildren := getCompanyExplorerLazyChildRowsForTest(t, handler, companyID, "me", userA.UserID, "logic_gate", gateA.LogicGateID)
	gateANodes := companyExplorerLazyNodeIDSet(gateAChildren)
	if !gateANodes[nodeA.NodeID] || gateANodes[nodeB.NodeID] {
		t.Fatalf("legacy me gate A children = %v, want native child %s only", gateANodes, nodeA.NodeID)
	}
	gateBChildren := getCompanyExplorerLazyChildRowsForTest(t, handler, companyID, "me", userA.UserID, "logic_gate", gateB.LogicGateID)
	gateBNodes := companyExplorerLazyNodeIDSet(gateBChildren)
	if !gateBNodes[nodeB.NodeID] || gateBNodes[nodeA.NodeID] {
		t.Fatalf("legacy me gate B children = %v, want native child %s only", gateBNodes, nodeB.NodeID)
	}
}

func mustCreateScopedCompanyExplorerFolderForTest(t *testing.T, repo *store.MemoryRepo, companyID, name, scopeType, scopeID string) domain.CompanyExplorerFolder {
	t.Helper()
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", name)
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder %s error = %v", name, err)
	}
	if scopeType != store.CompanyExplorerFolderScopeCompany {
		folder, err = repo.SetCompanyExplorerFolderScope(companyID, folder.FolderID, scopeType, scopeID)
		if err != nil {
			t.Fatalf("SetCompanyExplorerFolderScope %s error = %v", name, err)
		}
	}
	return folder
}

func getCompanyExplorerLazyRowsForTest(t *testing.T, handler http.Handler, companyID, scope, userID string) store.CompanyExplorerV2Rows {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/roots?company_id="+companyID+"&scope="+scope, nil)
	req = workItemInboxReadRequestWithActor(req, userID, companyID, domain.RoleCompanyUser, false)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET lazy roots scope=%s status = %d, want %d body=%s", scope, rec.Code, http.StatusOK, rec.Body.String())
	}
	return decodeCompanyExplorerLazyRowsForTest(t, rec)
}

func getCompanyExplorerLazyChildRowsForTest(t *testing.T, handler http.Handler, companyID, scope, userID, parentType, parentID string) store.CompanyExplorerV2Rows {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/company-explorer/children?company_id="+companyID+"&scope="+scope+"&parent_type="+parentType+"&parent_id="+parentID, nil)
	req = workItemInboxReadRequestWithActor(req, userID, companyID, domain.RoleCompanyUser, false)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET lazy children scope=%s parent_type=%s parent_id=%s status = %d, want %d body=%s", scope, parentType, parentID, rec.Code, http.StatusOK, rec.Body.String())
	}
	return decodeCompanyExplorerLazyRowsForTest(t, rec)
}

func decodeCompanyExplorerLazyRowsForTest(t *testing.T, rec *httptest.ResponseRecorder) store.CompanyExplorerV2Rows {
	t.Helper()
	var payload store.CompanyExplorerV2Rows
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode lazy rows: %v", err)
	}
	return payload
}

func companyExplorerLazyFolderIDSet(payload store.CompanyExplorerV2Rows) map[string]bool {
	ids := map[string]bool{}
	for _, row := range payload.Rows {
		if row.EntityType == store.CompanyExplorerV2EntityFolder {
			ids[row.EntityID] = true
		}
	}
	return ids
}

func companyExplorerLazyCompanyIDSet(payload store.CompanyExplorerV2Rows) map[string]bool {
	ids := map[string]bool{}
	for _, row := range payload.Rows {
		if row.EntityType == store.CompanyExplorerV2EntityCompany {
			ids[row.EntityID] = true
		}
	}
	return ids
}

func companyExplorerLazyNodeIDSet(payload store.CompanyExplorerV2Rows) map[string]bool {
	ids := map[string]bool{}
	for _, row := range payload.Rows {
		if row.EntityType == store.CompanyExplorerV2EntityNode {
			ids[row.ResourceID] = true
		}
	}
	return ids
}

func companyExplorerLazyLogicGateIDSet(payload store.CompanyExplorerV2Rows) map[string]bool {
	ids := map[string]bool{}
	for _, row := range payload.Rows {
		if row.EntityType == store.CompanyExplorerV2EntityLogicGate {
			ids[row.ResourceID] = true
		}
	}
	return ids
}

func companyExplorerLazyFolderItemIDSet(payload store.CompanyExplorerV2Rows) map[string]bool {
	ids := map[string]bool{}
	for _, row := range payload.Rows {
		if row.EntityType == store.CompanyExplorerV2EntityNode || row.EntityType == store.CompanyExplorerV2EntityLogicGate || row.EntityType == store.CompanyExplorerV2EntityProject {
			ids[row.ResourceID] = true
		}
	}
	return ids
}
