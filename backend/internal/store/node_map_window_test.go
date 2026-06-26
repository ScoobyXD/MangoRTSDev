package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestMemoryRepoListNodeMapWindowBoundsFolderWindowAndRelationships(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-333333333333"

	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder parent failed: %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "node", "Child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder child failed: %v", err)
	}
	nodeA, err := repo.CreateNode(companyID, "A")
	if err != nil {
		t.Fatalf("CreateNode A failed: %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "B")
	if err != nil {
		t.Fatalf("CreateNode B failed: %v", err)
	}
	nodeOutsideFolder, err := repo.CreateNode(companyID, "Outside folder")
	if err != nil {
		t.Fatalf("CreateNode outside folder failed: %v", err)
	}
	nodeOutsideWindow, err := repo.CreateNode(companyID, "Outside window")
	if err != nil {
		t.Fatalf("CreateNode outside window failed: %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parent.FolderID, "node", nodeA.NodeID, 1000); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Assign A error = %v, want ErrInvalid", err)
	}

	if _, err := repo.CreateNodeRelationship(companyID, nodeA.NodeID, nodeB.NodeID, "Peer", "Peer"); err != nil {
		t.Fatalf("Create visible relationship failed: %v", err)
	}
	if _, err := repo.CreateNodeRelationship(companyID, nodeB.NodeID, nodeOutsideFolder.NodeID, "Peer", "Peer"); err != nil {
		t.Fatalf("Create outside-folder relationship failed: %v", err)
	}
	if _, err := repo.CreateNodeRelationship(companyID, nodeA.NodeID, nodeOutsideWindow.NodeID, "Peer", "Peer"); err != nil {
		t.Fatalf("Create outside-window relationship failed: %v", err)
	}
	if _, err := repo.UpsertNodeMapPositions(companyID, []domain.NodeMapPosition{
		{NodeID: nodeA.NodeID, X: 100, Y: 100},
		{NodeID: nodeB.NodeID, X: 200, Y: 200},
		{NodeID: nodeOutsideFolder.NodeID, X: 150, Y: 150},
		{NodeID: nodeOutsideWindow.NodeID, X: 900, Y: 900},
	}); err != nil {
		t.Fatalf("UpsertNodeMapPositions failed: %v", err)
	}

	query := NodeMapWindowQuery{
		CompanyID: companyID,
		FolderID:  parent.FolderID,
		Window:    NodeMapWindowBounds{MinX: 0, MinY: 0, MaxX: 300, MaxY: 300},
		Limit:     10,
	}
	result, err := repo.ListNodeMapWindow(query)
	if err != nil {
		t.Fatalf("ListNodeMapWindow failed: %v", err)
	}
	assertNodeMapIDs(t, "nodes", nodeIDsFromNodes(result.Nodes))
	assertNodeMapIDs(t, "positions", nodeIDsFromPositions(result.NodeMapPositions))
	assertNodeMapIDs(t, "relationships", relationshipIDs(result.Relationships))
	assertNodeMapIDs(t, "folder_items", itemIDs(result.FolderItems))
	assertNodeMapIDs(t, "folders", folderIDs(result.Folders), parent.FolderID, child.FolderID)

	positions, err := repo.ListNodeMapPositionsWindow(query)
	if err != nil {
		t.Fatalf("ListNodeMapPositionsWindow failed: %v", err)
	}
	assertNodeMapIDs(t, "positions-only", nodeIDsFromPositions(positions))

	limited := query
	limited.Limit = 1
	limitedResult, err := repo.ListNodeMapWindow(limited)
	if err != nil {
		t.Fatalf("ListNodeMapWindow limited failed: %v", err)
	}
	assertNodeMapIDs(t, "limited nodes", nodeIDsFromNodes(limitedResult.Nodes))
	if len(limitedResult.Relationships) != 0 {
		t.Fatalf("limited relationships = %+v, want none because only one endpoint is visible", limitedResult.Relationships)
	}
}

func TestMemoryRepoListNodeMapWindowRejectsInvalidOrMissingFolder(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-444444444444"
	query := NodeMapWindowQuery{
		CompanyID: companyID,
		FolderID:  "22222222-2222-4222-8222-222222222222",
		Window:    NodeMapWindowBounds{MinX: 0, MinY: 0, MaxX: 100, MaxY: 100},
		Limit:     10,
	}
	if _, err := repo.ListNodeMapWindow(query); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ListNodeMapWindow missing folder error = %v, want ErrNotFound", err)
	}
	query.FolderID = ""
	if _, err := repo.ListNodeMapWindow(query); !errors.Is(err, ErrInvalid) {
		t.Fatalf("ListNodeMapWindow missing folder id error = %v, want ErrInvalid", err)
	}
	query.FolderID = "22222222-2222-4222-8222-222222222222"
	query.Window.MinX = 200
	query.Window.MaxX = 100
	if _, err := repo.ListNodeMapWindow(query); !errors.Is(err, ErrInvalid) {
		t.Fatalf("ListNodeMapWindow invalid window error = %v, want ErrInvalid", err)
	}
}

func assertNodeMapIDs(t *testing.T, label string, got []string, want ...string) {
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

func nodeIDsFromNodes(items []domain.Node) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.NodeID)
	}
	return ids
}

func nodeIDsFromPositions(items []domain.NodeMapPosition) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.NodeID)
	}
	return ids
}

func relationshipIDs(items []domain.NodeRelationship) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.NodeRelationshipID)
	}
	return ids
}

func itemIDs(items []domain.CompanyExplorerFolderItem) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ItemID)
	}
	return ids
}

func folderIDs(items []domain.CompanyExplorerFolder) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.FolderID)
	}
	return ids
}
