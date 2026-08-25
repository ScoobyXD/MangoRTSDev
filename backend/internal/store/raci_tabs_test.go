package store

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryRACITabsSynchronizeEffectiveUsersAndPersonalLayout(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777701"
	repo.EnsureCompany(companyID, "RACI Tabs Company")
	alice := mustCreateRACIMembershipUser(t, repo, "raci-tabs-alice", companyID)
	bob := mustCreateRACIMembershipUser(t, repo, "raci-tabs-bob", companyID)
	gate, err := repo.CreateLogicGate(companyID, "Launch Gate")
	if err != nil {
		t.Fatal(err)
	}
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Delivery")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{alice.UserID, bob.UserID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{
			{Role: domain.RACIRoleConsulted, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID},
			{Role: domain.RACIRoleResponsible, UserID: alice.UserID},
		},
	}); err != nil {
		t.Fatal(err)
	}

	responsible, err := repo.ListRACITabBranch(RACITabBranchInput{CompanyID: companyID, UserID: alice.UserID, Role: domain.RACIRoleResponsible, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(responsible.Rows) != 1 || responsible.Rows[0].Item == nil || responsible.Rows[0].Item.LogicGateID != gate.LogicGateID {
		t.Fatalf("Alice responsible rows = %+v", responsible.Rows)
	}
	consulted, err := repo.ListRACITabBranch(RACITabBranchInput{CompanyID: companyID, UserID: bob.UserID, Role: domain.RACIRoleConsulted})
	if err != nil {
		t.Fatal(err)
	}
	if len(consulted.Rows) != 1 || consulted.Rows[0].Item == nil {
		t.Fatalf("Bob consulted rows = %+v", consulted.Rows)
	}

	root, err := repo.CreateRACITabFolder(RACITabFolderCreateInput{CompanyID: companyID, UserID: bob.UserID, Role: domain.RACIRoleConsulted, Name: "Customers"})
	if err != nil {
		t.Fatal(err)
	}
	nested, err := repo.CreateRACITabFolder(RACITabFolderCreateInput{CompanyID: companyID, UserID: bob.UserID, Role: domain.RACIRoleConsulted, ParentFolderID: root.FolderID, Name: "West"})
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.ApplyRACITabLayout(RACITabLayoutInput{
		CompanyID: companyID, UserID: bob.UserID, Role: domain.RACIRoleConsulted,
		Entries: []RACITabLayoutEntry{{EntryType: RACITabLayoutEntryItem, EntryID: gate.LogicGateID, ParentFolderID: nested.FolderID, Position: 1000}},
	}); err != nil {
		t.Fatal(err)
	}
	rootPage, err := repo.ListRACITabBranch(RACITabBranchInput{CompanyID: companyID, UserID: bob.UserID, Role: domain.RACIRoleConsulted})
	if err != nil {
		t.Fatal(err)
	}
	if len(rootPage.Rows) != 1 || rootPage.Rows[0].Folder == nil || !rootPage.Rows[0].Folder.HasChildren {
		t.Fatalf("root lazy page = %+v", rootPage.Rows)
	}
	childPage, err := repo.ListRACITabBranch(RACITabBranchInput{CompanyID: companyID, UserID: bob.UserID, Role: domain.RACIRoleConsulted, ParentFolderID: nested.FolderID})
	if err != nil || len(childPage.Rows) != 1 || childPage.Rows[0].Item == nil {
		t.Fatalf("nested lazy page = %+v err=%v", childPage.Rows, err)
	}

	beforeRename := childPage.Rows[0].Item
	if _, _, err := repo.UpdateLogicGateHeaderWithWorkspaceEvent(companyID, gate.LogicGateID, "Renamed Launch Gate"); err != nil {
		t.Fatal(err)
	}
	childPage, err = repo.ListRACITabBranch(RACITabBranchInput{CompanyID: companyID, UserID: bob.UserID, Role: domain.RACIRoleConsulted, ParentFolderID: nested.FolderID})
	if err != nil || childPage.Rows[0].Item.Name != "Renamed Launch Gate" {
		t.Fatalf("renamed copied item = %+v err=%v", childPage.Rows, err)
	}
	afterRename := childPage.Rows[0].Item
	if afterRename.FolderID == nil || *afterRename.FolderID != nested.FolderID || afterRename.Position != beforeRename.Position || afterRename.Role != beforeRename.Role || !afterRename.CreatedTimestamp.Equal(beforeRename.CreatedTimestamp) {
		t.Fatalf("rename changed personal layout before=%+v after=%+v", beforeRename, afterRename)
	}

	if _, err := repo.SetLogicGateRACIAssignments(LogicGateRACIAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleAccountable, UserID: bob.UserID}},
	}); err != nil {
		t.Fatal(err)
	}
	oldRole, _ := repo.ListRACITabBranch(RACITabBranchInput{CompanyID: companyID, UserID: bob.UserID, Role: domain.RACIRoleConsulted})
	newRole, _ := repo.ListRACITabBranch(RACITabBranchInput{CompanyID: companyID, UserID: bob.UserID, Role: domain.RACIRoleAccountable})
	if len(oldRole.Rows) != 1 || oldRole.Rows[0].Folder == nil {
		t.Fatalf("personal folders should survive a role change: %+v", oldRole.Rows)
	}
	if len(newRole.Rows) != 1 || newRole.Rows[0].Item == nil || newRole.Rows[0].Item.FolderID != nil {
		t.Fatalf("changed winning role should append at new root: %+v", newRole.Rows)
	}
	if _, err := repo.ListRACITabBranch(RACITabBranchInput{CompanyID: companyID, UserID: alice.UserID, Role: domain.RACIRoleResponsible}); err != nil {
		t.Fatal(err)
	}
}

func TestMemoryRACITabsAPIRenameSynchronizesAndRollsBack(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777709"
	repo.EnsureCompany(companyID, "RACI Tabs Rename")
	user := mustCreateRACIMembershipUser(t, repo, "raci-tabs-rename-user", companyID)
	gate, err := repo.CreateLogicGate(companyID, "Original Gate")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, UserID: user.UserID}},
	}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateRACITabFolder(RACITabFolderCreateInput{CompanyID: companyID, UserID: user.UserID, Role: domain.RACIRoleResponsible, Name: "Personal"})
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.ApplyRACITabLayout(RACITabLayoutInput{CompanyID: companyID, UserID: user.UserID, Role: domain.RACIRoleResponsible, Entries: []RACITabLayoutEntry{{EntryType: RACITabLayoutEntryItem, EntryID: gate.LogicGateID, ParentFolderID: folder.FolderID, Position: 2300}}}); err != nil {
		t.Fatal(err)
	}
	itemKey := memoryRACITabItemKey(companyID, user.UserID, gate.LogicGateID)
	before := repo.raciTabItems[itemKey]
	forced := errors.New("forced rename event failure")
	repo.domainEventAppendErr = forced
	if _, _, err := repo.UpdateLogicGateHeaderWithWorkspaceEvent(companyID, gate.LogicGateID, "Rolled Back"); !errors.Is(err, forced) {
		t.Fatalf("failed rename error = %v", err)
	}
	rolledBack := repo.raciTabItems[itemKey]
	if rolledBack != before {
		t.Fatalf("failed rename changed RACI tab before=%+v after=%+v", before, rolledBack)
	}
	storedGate, err := repo.GetLogicGate(companyID, gate.LogicGateID)
	if err != nil || storedGate.Header != "Original Gate" {
		t.Fatalf("failed rename changed Logic Gate = %+v err=%v", storedGate, err)
	}

	repo.domainEventAppendErr = nil
	if _, _, err := repo.UpdateLogicGateHeaderWithWorkspaceEvent(companyID, gate.LogicGateID, "Committed Gate"); err != nil {
		t.Fatal(err)
	}
	after := repo.raciTabItems[itemKey]
	if after.Name != "Committed Gate" || after.FolderID == nil || *after.FolderID != folder.FolderID || after.Position != before.Position || after.Role != before.Role || !after.CreatedTimestamp.Equal(before.CreatedTimestamp) {
		t.Fatalf("committed rename changed layout before=%+v after=%+v", before, after)
	}
	if after.UpdatedTimestamp.Equal(before.UpdatedTimestamp) {
		t.Fatalf("committed rename did not update copied timestamp: %+v", after)
	}
}

func TestMemoryRACITabsCountsPaginationCyclesAndFolderDelete(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777702"
	repo.EnsureCompany(companyID, "RACI Tabs Counts")
	user := mustCreateRACIMembershipUser(t, repo, "raci-tabs-count-user", companyID)
	gates := make([]domain.LogicGate, 0, 2)
	for _, name := range []string{"First", "Second"} {
		gate, err := repo.CreateLogicGate(companyID, name)
		if err != nil {
			t.Fatal(err)
		}
		gates = append(gates, gate)
		if _, err := repo.AddLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Assignments: []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, UserID: user.UserID}}}); err != nil {
			t.Fatal(err)
		}
	}
	firstPage, err := repo.ListRACITabBranch(RACITabBranchInput{CompanyID: companyID, UserID: user.UserID, Role: domain.RACIRoleResponsible, Limit: 1})
	if err != nil || len(firstPage.Rows) != 1 || firstPage.NextCursor != "1" {
		t.Fatalf("bounded first page = %+v err=%v", firstPage, err)
	}
	secondPage, err := repo.ListRACITabBranch(RACITabBranchInput{CompanyID: companyID, UserID: user.UserID, Role: domain.RACIRoleResponsible, Offset: 1, Limit: 1})
	if err != nil || len(secondPage.Rows) != 1 || secondPage.NextCursor != "" {
		t.Fatalf("bounded second page = %+v err=%v", secondPage, err)
	}

	for index, status := range []string{"requested", "pending", "in_progress", "review", "backlog", "done"} {
		node, createErr := repo.CreateNode(companyID, status)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, assignErr := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gates[0].LogicGateID, NodeID: node.NodeID, Status: status, Position: (index + 1) * 1000}); assignErr != nil {
			t.Fatal(assignErr)
		}
	}
	counts, err := repo.GetRACITabLogicGateCounts(RACITabLogicGateCountsInput{CompanyID: companyID, UserID: user.UserID, LogicGateID: gates[0].LogicGateID})
	if err != nil || counts != (domain.RACITabStatusCounts{Request: 1, Pending: 1, InProgress: 1, Review: 1}) {
		t.Fatalf("tracked counts = %+v err=%v", counts, err)
	}

	root, _ := repo.CreateRACITabFolder(RACITabFolderCreateInput{CompanyID: companyID, UserID: user.UserID, Role: domain.RACIRoleResponsible, Name: "Root"})
	child, _ := repo.CreateRACITabFolder(RACITabFolderCreateInput{CompanyID: companyID, UserID: user.UserID, Role: domain.RACIRoleResponsible, ParentFolderID: root.FolderID, Name: "Child"})
	if err := repo.ApplyRACITabLayout(RACITabLayoutInput{CompanyID: companyID, UserID: user.UserID, Role: domain.RACIRoleResponsible, Entries: []RACITabLayoutEntry{{EntryType: RACITabLayoutEntryItem, EntryID: gates[0].LogicGateID, ParentFolderID: child.FolderID, Position: 1000}}}); err != nil {
		t.Fatal(err)
	}
	rootPage, _ := repo.ListRACITabBranch(RACITabBranchInput{CompanyID: companyID, UserID: user.UserID, Role: domain.RACIRoleResponsible})
	var rootRow *domain.RACITabFolder
	for _, row := range rootPage.Rows {
		if row.Folder != nil && row.Folder.FolderID == root.FolderID {
			rootRow = row.Folder
		}
	}
	if rootRow == nil || rootRow.StatusCounts != counts || rootPage.StatusCounts != counts {
		t.Fatalf("recursive totals root=%+v role=%+v", rootRow, rootPage.StatusCounts)
	}
	if err := repo.ApplyRACITabLayout(RACITabLayoutInput{CompanyID: companyID, UserID: user.UserID, Role: domain.RACIRoleResponsible, Entries: []RACITabLayoutEntry{{EntryType: RACITabLayoutEntryFolder, EntryID: root.FolderID, ParentFolderID: child.FolderID, Position: 1000}}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cycle move error = %v", err)
	}
	if err := repo.DeleteRACITabFolder(RACITabFolderDeleteInput{CompanyID: companyID, UserID: user.UserID, FolderID: root.FolderID}); err != nil {
		t.Fatal(err)
	}
	afterDelete, _ := repo.ListRACITabBranch(RACITabBranchInput{CompanyID: companyID, UserID: user.UserID, Role: domain.RACIRoleResponsible})
	var movedToRoot bool
	for _, row := range afterDelete.Rows {
		if row.Item != nil && row.Item.LogicGateID == gates[0].LogicGateID && row.Item.FolderID == nil {
			movedToRoot = true
		}
	}
	if !movedToRoot {
		t.Fatalf("folder deletion did not preserve item at role root: %+v", afterDelete.Rows)
	}
}

func TestRACITabsSchemaAndMigrationContract(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	schema, err := os.ReadFile(filepath.Join(root, "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join(root, "db", "migrations", "20260810_zzzz_raci_tabs.sql"))
	if err != nil {
		t.Fatal(err)
	}
	targetedMigration, err := os.ReadFile(filepath.Join(root, "db", "migrations", "20260811_zz_targeted_raci_tabs.sql"))
	if err != nil {
		t.Fatal(err)
	}
	schemaNormalized := normalizeCanonicalSchemaContract(string(schema))
	for name, expected := range map[string][]string{
		"raci_tabs_items":   {"company_id", "user_id", "role", "logic_gate_id", "folder_id", "name", "position", "created_timestamp", "updated_timestamp"},
		"raci_tabs_folders": {"company_id", "folder_id", "user_id", "role", "parent_folder_id", "name", "position", "created_timestamp", "updated_timestamp"},
	} {
		assertExactUnorderedColumns(t, name, createTableColumnNames(t, schemaNormalized, name), expected)
	}
	normalized := strings.ToLower(string(migration))
	for _, required := range []string{
		"cross join lateral mangorts_v2_effective_gvic_assignments",
		"on conflict (company_id, user_id, logic_gate_id) do nothing",
		"trg_zz_raci_tabs_assignment_changed",
		"trg_zz_raci_tabs_group_member_changed",
		"trg_zz_raci_tabs_explorer_item_changed",
		"trg_zz_raci_tabs_logic_gate_changed",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("migration missing %q", required)
		}
	}
	if strings.Contains(normalized, "gvic_matrix_projection_table") {
		t.Fatal("RACI Tabs migration depends on retired matrix projection storage")
	}
	targetedNormalized := strings.ToLower(string(targetedMigration))
	for _, required := range []string{
		"mangorts_sync_raci_tabs_explorer_subtree",
		"mangorts_sync_raci_tabs_policy_resource",
		"mangorts_sync_raci_tabs_group_ancestors",
		"mangorts_raci_tabs_membership_added",
		"drop function if exists mangorts_sync_raci_tabs_company(uuid)",
	} {
		if !strings.Contains(targetedNormalized, required) {
			t.Fatalf("targeted RACI Tabs migration missing %q", required)
		}
	}
	for _, forbiddenDefinition := range []string{
		"create or replace function mangorts_sync_raci_tabs_company",
		"create or replace function mangorts_raci_tabs_company_changed",
	} {
		if strings.Contains(schemaNormalized, forbiddenDefinition) {
			t.Fatalf("canonical schema still defines company-wide RACI synchronization %q", forbiddenDefinition)
		}
	}
}

func assertExactUnorderedColumns(t *testing.T, table string, actual, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("%s column count = %d, want %d; actual=%v", table, len(actual), len(expected), actual)
	}
	expectedSet := make(map[string]bool, len(expected))
	for _, column := range expected {
		expectedSet[column] = true
	}
	for _, column := range actual {
		if !expectedSet[column] {
			t.Fatalf("%s has unexpected column %q; actual=%v", table, column, actual)
		}
		delete(expectedSet, column)
	}
	if len(expectedSet) != 0 {
		t.Fatalf("%s is missing columns %v; actual=%v", table, expectedSet, actual)
	}
}

func createTableColumnNames(t *testing.T, source, table string) []string {
	t.Helper()
	pattern := regexp.MustCompile(`(?is)create table if not exists ` + regexp.QuoteMeta(table) + `\s*\((.*?)\n\);`)
	match := pattern.FindStringSubmatch(source)
	if len(match) != 2 {
		t.Fatalf("missing create table %s", table)
	}
	columns := []string{}
	for _, rawLine := range strings.Split(match[1], "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "constraint ") || strings.HasPrefix(line, "primary key") || strings.HasPrefix(line, "unique ") || strings.HasPrefix(line, "foreign key") || strings.HasPrefix(line, "references ") {
			continue
		}
		columns = append(columns, strings.Fields(line)[0])
	}
	return columns
}
