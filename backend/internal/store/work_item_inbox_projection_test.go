package store

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryRepoWorkItemInboxProjectionBackfillMatchesJoinBackedReads(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-777777777777"
	repo.EnsureCompany(companyID, "Projection Inbox Company")
	user := mustCreateInboxReadCompanyUser(t, repo, "projection-user-subject", companyID, "projection@example.com", "Projection User")

	responsibleGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Alpha Responsible")
	aciGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Bravo ACI")
	multiGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Charlie Multi")
	mustSetInboxReadLogicGateRaci(t, repo, companyID, responsibleGate.LogicGateID, []LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleResponsible, UserID: user.UserID}})
	mustSetInboxReadLogicGateRaci(t, repo, companyID, aciGate.LogicGateID, []LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleAccountable, UserID: user.UserID}})
	mustSetInboxReadLogicGateRaci(t, repo, companyID, multiGate.LogicGateID, []LogicGateRaciAssignmentInput{
		{Role: domain.LogicGateRaciRoleResponsible, UserID: user.UserID},
		{Role: domain.LogicGateRaciRoleAccountable, UserID: user.UserID},
	})

	donePriority := 3
	doneNode, err := repo.CreateNodeWithAssignee(companyID, "Done projection node", user.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee done: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: aciGate.LogicGateID,
		NodeID:      doneNode.NodeID,
		Status:      "done",
		Priority:    &donePriority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus done: %v", err)
	}

	issuePriority := 5
	issueNode, err := repo.CreateNodeWithAssignee(companyID, "Issue projection node", user.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee issue: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: multiGate.LogicGateID,
		NodeID:      issueNode.NodeID,
		Status:      "in progress",
		Priority:    &issuePriority,
		PrioritySet: true,
		IsIssue:     true,
		IsIssueSet:  true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus issue: %v", err)
	}

	if err := repo.RebuildWorkItemInboxEntries(companyID); err != nil {
		t.Fatalf("RebuildWorkItemInboxEntries: %v", err)
	}
	assertMemoryProjectionCounts(t, repo, companyID, 3, 4)

	query := WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 20}
	responsibleNodes, err := repo.ListResponsibleInboxNodes(query)
	if err != nil {
		t.Fatalf("ListResponsibleInboxNodes: %v", err)
	}
	if expected := joinBackedResponsibleWorkItemInboxNodesForTest(t, repo, query); !reflect.DeepEqual(responsibleNodes, expected) {
		t.Fatalf("responsible projection nodes = %+v, want join-backed %+v", responsibleNodes, expected)
	}
	myNodes, err := repo.ListMyNodes(query)
	if err != nil {
		t.Fatalf("ListMyNodes: %v", err)
	}
	if expected := joinBackedAssignedWorkItemInboxNodesForTest(t, repo, query); !reflect.DeepEqual(myNodes, expected) {
		t.Fatalf("my nodes = %+v, want join-backed assigned %+v", myNodes, expected)
	}

	doneRead := mustFindInboxReadNode(t, myNodes, doneNode.NodeID)
	if doneRead.Status == nil || *doneRead.Status != "Done" || doneRead.Priority == nil || *doneRead.Priority != donePriority {
		t.Fatalf("done projection node = %+v, want Done with priority %d", doneRead, donePriority)
	}
	if doneRead.AssigneeName == nil || *doneRead.AssigneeName != "Projection User" || doneRead.AssigneeEmail == nil || *doneRead.AssigneeEmail != "projection@example.com" {
		t.Fatalf("done projection assignee labels = name:%v email:%v", doneRead.AssigneeName, doneRead.AssigneeEmail)
	}
	if len(doneRead.LogicGateIDs) != 1 || doneRead.LogicGateIDs[0] != aciGate.LogicGateID {
		t.Fatalf("done projection logic gates = %+v, want %q", doneRead.LogicGateIDs, aciGate.LogicGateID)
	}

	issueRead := mustFindInboxReadNode(t, responsibleNodes, issueNode.NodeID)
	if issueRead.Status == nil || *issueRead.Status != "Issue" || issueRead.StatusColor == nil || *issueRead.StatusColor != "#ffd400" {
		t.Fatalf("issue projection node status = %+v color=%+v, want Issue", issueRead.Status, issueRead.StatusColor)
	}
	if issueRead.Priority == nil || *issueRead.Priority != issuePriority {
		t.Fatalf("issue projection priority = %+v, want %d", issueRead.Priority, issuePriority)
	}

	aciGates, err := repo.ListACIInboxLogicGates(query)
	if err != nil {
		t.Fatalf("ListACIInboxLogicGates: %v", err)
	}
	if expected := joinBackedWorkItemLogicGateInboxItemsForTest(t, repo, query, map[string]bool{
		domain.LogicGateRaciRoleAccountable: true,
		domain.LogicGateRaciRoleConsulted:   true,
		domain.LogicGateRaciRoleInformed:    true,
	}); !reflect.DeepEqual(aciGates, expected) {
		t.Fatalf("ACI projection gates = %+v, want join-backed %+v", aciGates, expected)
	}
	if findInboxReadGate(aciGates, responsibleGate.LogicGateID) != nil {
		t.Fatalf("ACI projection leaked responsible-only gate: %+v", aciGates)
	}
	multiACI := findInboxReadGate(aciGates, multiGate.LogicGateID)
	if multiACI == nil || inboxReadRolesContain(multiACI.Roles, domain.LogicGateRaciRoleResponsible) || !inboxReadRolesContain(multiACI.Roles, domain.LogicGateRaciRoleAccountable) {
		t.Fatalf("ACI projection multi roles = %+v, want accountable only", multiACI)
	}

	myGates, err := repo.ListMyLogicGates(query)
	if err != nil {
		t.Fatalf("ListMyLogicGates: %v", err)
	}
	if expected := joinBackedWorkItemLogicGateInboxItemsForTest(t, repo, query, nil); !reflect.DeepEqual(myGates, expected) {
		t.Fatalf("my logic gates projection = %+v, want join-backed %+v", myGates, expected)
	}
}

func TestWorkItemInboxProjectionMigrationAndPostgresReadsUseProjection(t *testing.T) {
	migrationPath := filepath.Join("..", "..", "db", "migrations", "20260519_work_item_inbox_entries.sql")
	migrationRaw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("ReadFile migration: %v", err)
	}
	migration := strings.ToLower(strings.Join(strings.Fields(string(migrationRaw)), " "))
	for _, needle := range []string{
		"create table if not exists work_item_inbox_entries",
		"from nodes n left join lateral ( select assignment_row.* from node_logic_gate_assignments assignment_row",
		"join logic_gate_raci_assignments assignment",
		"create or replace function rebuild_work_item_inbox_entries_for_company",
		"create trigger trg_rebuild_work_item_inbox_entries_assignment after insert or update or delete on node_logic_gate_assignments",
		"create trigger trg_rebuild_work_item_inbox_entries_raci after insert or update or delete on logic_gate_raci_assignments",
		"perform rebuild_work_item_inbox_entries_for_company(company_row.company_id)",
	} {
		if !strings.Contains(migration, needle) {
			t.Fatalf("projection migration missing %q", needle)
		}
	}
	if strings.Contains(migration, "from kanban_cards") {
		t.Fatal("projection migration should not derive inbox truth directly from kanban_cards")
	}
	responsibleMigrationPath := filepath.Join("..", "..", "db", "migrations", "20260520_responsible_inbox_raci_nodes.sql")
	responsibleMigrationRaw, err := os.ReadFile(responsibleMigrationPath)
	if err != nil {
		t.Fatalf("ReadFile responsible migration: %v", err)
	}
	responsibleMigration := strings.ToLower(strings.Join(strings.Fields(string(responsibleMigrationRaw)), " "))
	for _, needle := range []string{
		"create unique index if not exists idx_work_item_inbox_entries_node_user_role",
		"and role = 'responsible'",
		"create or replace function rebuild_work_item_inbox_entries_for_logic_gate_nodes",
		"perform rebuild_work_item_inbox_entries_for_logic_gate_nodes",
	} {
		if !strings.Contains(responsibleMigration, needle) {
			t.Fatalf("responsible projection migration missing %q", needle)
		}
	}

	schemaPath := filepath.Join("..", "..", "db", "schema.sql")
	schemaRaw, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("ReadFile schema: %v", err)
	}
	schema := strings.ToLower(strings.Join(strings.Fields(string(schemaRaw)), " "))
	for _, needle := range []string{
		"create table if not exists work_item_inbox_entries",
		"create or replace function rebuild_work_item_inbox_entries_for_node",
		"create unique index if not exists idx_work_item_inbox_entries_node_user_role",
		"and role = 'responsible'",
		"create trigger trg_rebuild_work_item_inbox_entries_assignment after insert or update or delete on node_logic_gate_assignments",
	} {
		if !strings.Contains(schema, needle) {
			t.Fatalf("canonical schema missing %q", needle)
		}
	}

	postgresReadPath := filepath.Join("postgres_work_item_reads.go")
	postgresReadRaw, err := os.ReadFile(postgresReadPath)
	if err != nil {
		t.Fatalf("ReadFile postgres reads: %v", err)
	}
	postgresReads := strings.ToLower(strings.Join(strings.Fields(string(postgresReadRaw)), " "))
	if !strings.Contains(postgresReads, "from work_item_inbox_entries entry") {
		t.Fatal("Postgres work item inbox reads should select from work_item_inbox_entries")
	}
	if strings.Contains(postgresReads, "from nodes n") || strings.Contains(postgresReads, "from logic_gates logic_gate") {
		t.Fatal("Postgres work item inbox reads should not use the prior broad join-backed query path")
	}
}

func assertMemoryProjectionCounts(t *testing.T, repo *MemoryRepo, companyID string, wantNodeEntries, wantLogicGateEntries int) {
	t.Helper()
	repo.mu.RLock()
	defer repo.mu.RUnlock()
	nodeEntries := 0
	logicGateEntries := 0
	for _, entry := range repo.workItemInboxEntries {
		if entry.CompanyID != companyID {
			continue
		}
		switch entry.EntryKind {
		case memoryWorkItemInboxEntryKindNode:
			nodeEntries++
		case memoryWorkItemInboxEntryKindLogicGate:
			logicGateEntries++
		}
	}
	if nodeEntries != wantNodeEntries || logicGateEntries != wantLogicGateEntries {
		t.Fatalf("projection entry counts node=%d gate=%d, want node=%d gate=%d", nodeEntries, logicGateEntries, wantNodeEntries, wantLogicGateEntries)
	}
}

func joinBackedAssignedWorkItemInboxNodesForTest(t *testing.T, repo *MemoryRepo, query WorkItemInboxQuery) []domain.Node {
	t.Helper()
	query = NormalizeWorkItemInboxQuery(query)
	repo.mu.RLock()
	defer repo.mu.RUnlock()
	items := make([]domain.Node, 0)
	for _, node := range repo.nodes {
		if node.CompanyID != query.CompanyID || node.AssigneeUserID == nil || strings.TrimSpace(*node.AssigneeUserID) != query.UserID {
			continue
		}
		items = append(items, repo.withNodeReadModelLocked(node))
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].NodeID < items[j].NodeID
	})
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items
}

func joinBackedResponsibleWorkItemInboxNodesForTest(t *testing.T, repo *MemoryRepo, query WorkItemInboxQuery) []domain.Node {
	t.Helper()
	query = NormalizeWorkItemInboxQuery(query)
	repo.mu.RLock()
	defer repo.mu.RUnlock()
	items := make([]domain.Node, 0)
	for _, node := range repo.nodes {
		if node.CompanyID != query.CompanyID {
			continue
		}
		assignment, ok := repo.nodeLogicGateAssignmentLocked(node.CompanyID, node.NodeID, "")
		if !ok {
			continue
		}
		assignments := repo.logicGateRaci[key(node.CompanyID, assignment.LogicGateID)]
		if len(workItemInboxRolesForUser(assignments, query.UserID, map[string]bool{domain.LogicGateRaciRoleResponsible: true})) == 0 {
			continue
		}
		items = append(items, repo.withNodeReadModelLocked(node))
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].NodeID < items[j].NodeID
	})
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items
}

func joinBackedWorkItemLogicGateInboxItemsForTest(t *testing.T, repo *MemoryRepo, query WorkItemInboxQuery, allowedRoles map[string]bool) []WorkItemLogicGateInboxItem {
	t.Helper()
	query = NormalizeWorkItemInboxQuery(query)
	repo.mu.RLock()
	defer repo.mu.RUnlock()
	items := make([]WorkItemLogicGateInboxItem, 0)
	for _, gate := range repo.logicGates {
		if gate.CompanyID != query.CompanyID {
			continue
		}
		assignments := repo.logicGateRaci[key(gate.CompanyID, gate.LogicGateID)]
		roles := workItemInboxRolesForUser(assignments, query.UserID, allowedRoles)
		if len(roles) == 0 {
			continue
		}
		gate = repo.withLogicGateRaciLocked(gate)
		items = append(items, WorkItemLogicGateInboxItem{
			CompanyID:        gate.CompanyID,
			LogicGateID:      gate.LogicGateID,
			Header:           gate.Header,
			Roles:            roles,
			RaciAssignments:  gate.RaciAssignments,
			CreatedTimestamp: gate.CreatedTimestamp,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		left := strings.ToLower(strings.TrimSpace(items[i].Header))
		right := strings.ToLower(strings.TrimSpace(items[j].Header))
		if left != right {
			return left < right
		}
		return items[i].LogicGateID < items[j].LogicGateID
	})
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items
}
