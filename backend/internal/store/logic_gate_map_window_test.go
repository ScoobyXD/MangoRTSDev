package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestMemoryRepoListLogicGateMapWindowBoundsFolderWindowAndRelationships(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-888888888888"

	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder parent failed: %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "logic_gate", "Child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder child failed: %v", err)
	}
	sibling, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Sibling")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder sibling failed: %v", err)
	}

	gateA, err := repo.CreateLogicGate(companyID, "A")
	if err != nil {
		t.Fatalf("CreateLogicGate A failed: %v", err)
	}
	gateB, err := repo.CreateLogicGate(companyID, "B")
	if err != nil {
		t.Fatalf("CreateLogicGate B failed: %v", err)
	}
	gateOutsideFolder, err := repo.CreateLogicGate(companyID, "Outside folder")
	if err != nil {
		t.Fatalf("CreateLogicGate outside folder failed: %v", err)
	}
	gateOutsideWindow, err := repo.CreateLogicGate(companyID, "Outside window")
	if err != nil {
		t.Fatalf("CreateLogicGate outside window failed: %v", err)
	}
	gateWithoutPosition, err := repo.CreateLogicGate(companyID, "Without position")
	if err != nil {
		t.Fatalf("CreateLogicGate without position failed: %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parent.FolderID, "logic_gate", gateA.LogicGateID, 1000); err != nil {
		t.Fatalf("Assign A failed: %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, child.FolderID, "logic_gate", gateB.LogicGateID, 2000); err != nil {
		t.Fatalf("Assign B failed: %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, sibling.FolderID, "logic_gate", gateOutsideFolder.LogicGateID, 3000); err != nil {
		t.Fatalf("Assign outside folder failed: %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parent.FolderID, "logic_gate", gateOutsideWindow.LogicGateID, 4000); err != nil {
		t.Fatalf("Assign outside window failed: %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parent.FolderID, "logic_gate", gateWithoutPosition.LogicGateID, 5000); err != nil {
		t.Fatalf("Assign without position failed: %v", err)
	}

	visibleRelationship, err := repo.CreateLogicGateRelationship(companyID, gateA.LogicGateID, gateB.LogicGateID, "Peer", "Peer")
	if err != nil {
		t.Fatalf("Create visible relationship failed: %v", err)
	}
	if _, err := repo.CreateLogicGateRelationship(companyID, gateB.LogicGateID, gateOutsideFolder.LogicGateID, "Peer", "Peer"); err != nil {
		t.Fatalf("Create outside-folder relationship failed: %v", err)
	}
	if _, err := repo.CreateLogicGateRelationship(companyID, gateA.LogicGateID, gateOutsideWindow.LogicGateID, "Peer", "Peer"); err != nil {
		t.Fatalf("Create outside-window relationship failed: %v", err)
	}
	if _, err := repo.CreateLogicGateRelationship(companyID, gateA.LogicGateID, gateWithoutPosition.LogicGateID, "Peer", "Peer"); err != nil {
		t.Fatalf("Create unpositioned relationship failed: %v", err)
	}
	if _, err := repo.UpsertLogicGateMapPositions(companyID, []domain.LogicGateMapPosition{
		{LogicGateID: gateA.LogicGateID, X: 100, Y: 100},
		{LogicGateID: gateB.LogicGateID, X: 200, Y: 200},
		{LogicGateID: gateOutsideFolder.LogicGateID, X: 150, Y: 150},
		{LogicGateID: gateOutsideWindow.LogicGateID, X: 900, Y: 900},
	}); err != nil {
		t.Fatalf("UpsertLogicGateMapPositions failed: %v", err)
	}

	query := LogicGateMapWindowQuery{
		CompanyID: companyID,
		FolderID:  parent.FolderID,
		Window:    NodeMapWindowBounds{MinX: 0, MinY: 0, MaxX: 300, MaxY: 300},
		Limit:     10,
	}
	result, err := repo.ListLogicGateMapWindow(query)
	if err != nil {
		t.Fatalf("ListLogicGateMapWindow failed: %v", err)
	}
	assertLogicGateMapIDs(t, "logic_gates", logicGateIDsFromGates(result.LogicGates), gateA.LogicGateID, gateB.LogicGateID)
	assertLogicGateMapIDs(t, "positions", logicGateIDsFromPositions(result.LogicGateMapPositions), gateA.LogicGateID, gateB.LogicGateID)
	assertLogicGateMapIDs(t, "relationships", logicGateRelationshipIDs(result.Relationships), visibleRelationship.LogicGateRelationshipID)
	assertLogicGateMapIDs(t, "folder_items", logicGateMapItemIDs(result.FolderItems), gateA.LogicGateID, gateB.LogicGateID)
	assertLogicGateMapIDs(t, "folders", logicGateMapFolderIDs(result.Folders), parent.FolderID, child.FolderID)

	positions, err := repo.ListLogicGateMapPositionsWindow(query)
	if err != nil {
		t.Fatalf("ListLogicGateMapPositionsWindow failed: %v", err)
	}
	assertLogicGateMapIDs(t, "positions-only", logicGateIDsFromPositions(positions), gateA.LogicGateID, gateB.LogicGateID)

	limited := query
	limited.Limit = 1
	limitedResult, err := repo.ListLogicGateMapWindow(limited)
	if err != nil {
		t.Fatalf("ListLogicGateMapWindow limited failed: %v", err)
	}
	assertLogicGateMapIDs(t, "limited logic_gates", logicGateIDsFromGates(limitedResult.LogicGates), gateA.LogicGateID)
	if len(limitedResult.Relationships) != 0 {
		t.Fatalf("limited relationships = %+v, want none because only one endpoint is visible", limitedResult.Relationships)
	}
}

func TestMemoryRepoListLogicGateMapWindowRejectsInvalidOrMissingFolder(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-999999999999"
	query := LogicGateMapWindowQuery{
		CompanyID: companyID,
		FolderID:  "22222222-2222-4222-8222-222222222222",
		Window:    NodeMapWindowBounds{MinX: 0, MinY: 0, MaxX: 100, MaxY: 100},
		Limit:     10,
	}
	if _, err := repo.ListLogicGateMapWindow(query); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ListLogicGateMapWindow missing folder error = %v, want ErrNotFound", err)
	}
	query.FolderID = ""
	if _, err := repo.ListLogicGateMapWindow(query); !errors.Is(err, ErrInvalid) {
		t.Fatalf("ListLogicGateMapWindow missing folder id error = %v, want ErrInvalid", err)
	}
	query.FolderID = "22222222-2222-4222-8222-222222222222"
	query.Window.MinX = 200
	query.Window.MaxX = 100
	if _, err := repo.ListLogicGateMapWindow(query); !errors.Is(err, ErrInvalid) {
		t.Fatalf("ListLogicGateMapWindow invalid window error = %v, want ErrInvalid", err)
	}
}

func assertLogicGateMapIDs(t *testing.T, label string, got []string, want ...string) {
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

func logicGateIDsFromGates(items []domain.LogicGate) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.LogicGateID)
	}
	return ids
}

func logicGateIDsFromPositions(items []domain.LogicGateMapPosition) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.LogicGateID)
	}
	return ids
}

func logicGateRelationshipIDs(items []domain.LogicGateRelationship) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.LogicGateRelationshipID)
	}
	return ids
}

func logicGateMapItemIDs(items []domain.CompanyExplorerFolderItem) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ItemID)
	}
	return ids
}

func logicGateMapFolderIDs(items []domain.CompanyExplorerFolder) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.FolderID)
	}
	return ids
}
