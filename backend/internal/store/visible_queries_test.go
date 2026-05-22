package store

import (
	"os"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryVisibleQueriesUseEffectiveAccessDirectGrants(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222301"
	repo.EnsureCompany(companyID, "Visible Direct Co")

	viewer := mustEffectiveAccessUser(t, repo, companyID, "visible-direct-viewer")
	blocked := mustEffectiveAccessUser(t, repo, companyID, "visible-direct-blocked")
	viewNode := mustCreateVisibleQueryNode(t, repo, companyID, "View node")
	editNode := mustCreateVisibleQueryNode(t, repo, companyID, "Edit node")
	hiddenNode := mustCreateVisibleQueryNode(t, repo, companyID, "Hidden node")
	viewGate := mustCreateVisibleQueryGate(t, repo, companyID, "View gate")
	editGate := mustCreateVisibleQueryGate(t, repo, companyID, "Edit gate")
	hiddenGate := mustCreateVisibleQueryGate(t, repo, companyID, "Hidden gate")

	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, viewNode.NodeID, viewer.UserID, EntityPermissionView)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, editNode.NodeID, viewer.UserID, EntityPermissionEdit)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, viewGate.LogicGateID, viewer.UserID, EntityPermissionView)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, editGate.LogicGateID, viewer.UserID, EntityPermissionEdit)

	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	nodes, err := repo.ListVisibleNodes(companyID, viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleNodes viewer: %v", err)
	}
	assertVisibleQueryNodeIDs(t, nodes, viewNode.NodeID, editNode.NodeID)
	assertVisibleQueryNodesDoNotContain(t, nodes, hiddenNode.NodeID)

	gates, err := repo.ListVisibleLogicGates(companyID, viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleLogicGates viewer: %v", err)
	}
	assertVisibleQueryLogicGateIDs(t, gates, viewGate.LogicGateID, editGate.LogicGateID)
	assertVisibleQueryLogicGatesDoNotContain(t, gates, hiddenGate.LogicGateID)

	blockedNodes, err := repo.ListVisibleNodes(companyID, blocked.UserID)
	if err != nil {
		t.Fatalf("ListVisibleNodes blocked: %v", err)
	}
	if len(blockedNodes) != 0 {
		t.Fatalf("blocked user visible nodes = %+v, want none", blockedNodes)
	}
	blockedGates, err := repo.ListVisibleLogicGates(companyID, blocked.UserID)
	if err != nil {
		t.Fatalf("ListVisibleLogicGates blocked: %v", err)
	}
	if len(blockedGates) != 0 {
		t.Fatalf("blocked user visible logic gates = %+v, want none", blockedGates)
	}
}

func TestMemoryVisibleNodesIncludeLogicGateAssignedNodeContext(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222302"
	repo.EnsureCompany(companyID, "Visible Context Co")

	viewer := mustEffectiveAccessUser(t, repo, companyID, "visible-context-viewer")
	visibleGate := mustCreateVisibleQueryGate(t, repo, companyID, "Visible work")
	hiddenGate := mustCreateVisibleQueryGate(t, repo, companyID, "Hidden work")
	contextNode := mustCreateVisibleQueryNode(t, repo, companyID, "Context node")
	hiddenContextNode := mustCreateVisibleQueryNode(t, repo, companyID, "Hidden context node")
	unassignedNode := mustCreateVisibleQueryNode(t, repo, companyID, "Unassigned node")

	mustAssignVisibleQueryNodeToGate(t, repo, companyID, visibleGate.LogicGateID, contextNode.NodeID)
	mustAssignVisibleQueryNodeToGate(t, repo, companyID, hiddenGate.LogicGateID, hiddenContextNode.NodeID)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, visibleGate.LogicGateID, viewer.UserID, EntityPermissionView)

	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	gates, err := repo.ListVisibleLogicGates(companyID, viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleLogicGates: %v", err)
	}
	assertVisibleQueryLogicGateIDs(t, gates, visibleGate.LogicGateID)
	assertVisibleQueryLogicGatesDoNotContain(t, gates, hiddenGate.LogicGateID)

	nodes, err := repo.ListVisibleNodes(companyID, viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleNodes: %v", err)
	}
	assertVisibleQueryNodeIDs(t, nodes, contextNode.NodeID)
	assertVisibleQueryNodesDoNotContain(t, nodes, hiddenContextNode.NodeID, unassignedNode.NodeID)
	assertEffectiveAccess(t, repo, companyID, viewer.UserID, EntityTypeNode, contextNode.NodeID, EntityPermissionEdit, false)
}

func TestPostgresVisibleQueriesUseEffectiveAccessReadModel(t *testing.T) {
	nodeRaw, err := os.ReadFile("postgres_nodes.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_nodes.go: %v", err)
	}
	nodeSource := visibleQueryNormalizeSource(string(nodeRaw))
	for _, needle := range []string{
		"func (r *postgresrepo) listvisiblenodes",
		"join ( select distinct access.resource_id",
		"from effective_resource_access access",
		"access.resource_type='node'",
		") visible on visible.resource_id=n.node_id",
		"mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($3)",
	} {
		if !strings.Contains(nodeSource, needle) {
			t.Fatalf("Postgres visible node query missing %q", needle)
		}
	}
	for _, forbidden := range []string{"listaccessibleentityids", "mangorts_user_can_access_resource"} {
		if strings.Contains(nodeSource, forbidden) {
			t.Fatalf("Postgres visible node query should not use %q", forbidden)
		}
	}

	logicGateRaw, err := os.ReadFile("postgres_logic_gates.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_logic_gates.go: %v", err)
	}
	logicGateSource := visibleQueryNormalizeSource(string(logicGateRaw))
	for _, needle := range []string{
		"func (r *postgresrepo) listvisiblelogicgates",
		"join ( select distinct access.resource_id",
		"from effective_resource_access access",
		"access.resource_type='logic_gate'",
		") visible on visible.resource_id=gate.logic_gate_id",
		"mangorts_access_level_rank(access.access_level) >= mangorts_access_level_rank($3)",
	} {
		if !strings.Contains(logicGateSource, needle) {
			t.Fatalf("Postgres visible Logic Gate query missing %q", needle)
		}
	}
	for _, forbidden := range []string{"listaccessibleentityids", "mangorts_user_can_access_resource"} {
		if strings.Contains(logicGateSource, forbidden) {
			t.Fatalf("Postgres visible Logic Gate query should not use %q", forbidden)
		}
	}
}

func mustCreateVisibleQueryNode(t *testing.T, repo *MemoryRepo, companyID, title string) domain.Node {
	t.Helper()
	node, err := repo.CreateNode(companyID, title)
	if err != nil {
		t.Fatalf("CreateNode %q: %v", title, err)
	}
	return node
}

func mustCreateVisibleQueryGate(t *testing.T, repo *MemoryRepo, companyID, header string) domain.LogicGate {
	t.Helper()
	gate, err := repo.CreateLogicGate(companyID, header)
	if err != nil {
		t.Fatalf("CreateLogicGate %q: %v", header, err)
	}
	return gate
}

func mustSetVisibleQueryPermission(t *testing.T, repo *MemoryRepo, companyID, entityType, entityID, userID, accessLevel string) {
	t.Helper()
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: entityType,
		EntityID:   entityID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   userID,
			AccessLevel: accessLevel,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions %s/%s: %v", entityType, entityID, err)
	}
}

func mustAssignVisibleQueryNodeToGate(t *testing.T, repo *MemoryRepo, companyID, logicGateID, nodeID string) {
	t.Helper()
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGateID,
		NodeID:      nodeID,
		Status:      "pending",
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus %s/%s: %v", logicGateID, nodeID, err)
	}
}

func assertVisibleQueryNodeIDs(t *testing.T, nodes []domain.Node, wantIDs ...string) {
	t.Helper()
	got := map[string]bool{}
	for _, node := range nodes {
		got[node.NodeID] = true
	}
	if len(got) != len(wantIDs) {
		t.Fatalf("visible node IDs = %+v, want %+v", got, wantIDs)
	}
	for _, wantID := range wantIDs {
		if !got[wantID] {
			t.Fatalf("visible node IDs = %+v, want %s", got, wantID)
		}
	}
}

func assertVisibleQueryNodesDoNotContain(t *testing.T, nodes []domain.Node, hiddenIDs ...string) {
	t.Helper()
	for _, node := range nodes {
		for _, hiddenID := range hiddenIDs {
			if node.NodeID == hiddenID {
				t.Fatalf("visible nodes leaked hidden node %s in %+v", hiddenID, nodes)
			}
		}
	}
}

func assertVisibleQueryLogicGateIDs(t *testing.T, gates []domain.LogicGate, wantIDs ...string) {
	t.Helper()
	got := map[string]bool{}
	for _, gate := range gates {
		got[gate.LogicGateID] = true
	}
	if len(got) != len(wantIDs) {
		t.Fatalf("visible Logic Gate IDs = %+v, want %+v", got, wantIDs)
	}
	for _, wantID := range wantIDs {
		if !got[wantID] {
			t.Fatalf("visible Logic Gate IDs = %+v, want %s", got, wantID)
		}
	}
}

func assertVisibleQueryLogicGatesDoNotContain(t *testing.T, gates []domain.LogicGate, hiddenIDs ...string) {
	t.Helper()
	for _, gate := range gates {
		for _, hiddenID := range hiddenIDs {
			if gate.LogicGateID == hiddenID {
				t.Fatalf("visible Logic Gates leaked hidden gate %s in %+v", hiddenID, gates)
			}
		}
	}
}

func visibleQueryNormalizeSource(raw string) string {
	return strings.ToLower(strings.Join(strings.Fields(raw), " "))
}
