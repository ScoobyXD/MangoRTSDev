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

	viewer := mustCreateInboxReadCompanyUser(t, repo, "visible-direct-viewer", companyID, "visible-direct-viewer@example.com", "Visible Direct Viewer")
	blocked := mustCreateInboxReadCompanyUser(t, repo, "visible-direct-blocked", companyID, "visible-direct-blocked@example.com", "Visible Direct Blocked")
	viewNode := mustCreateVisibleQueryNode(t, repo, companyID, "View node")
	editNode := mustCreateVisibleQueryNode(t, repo, companyID, "Edit node")
	hiddenNode := mustCreateVisibleQueryNode(t, repo, companyID, "Hidden node")
	viewGate := mustCreateVisibleQueryGate(t, repo, companyID, "View gate")
	editGate := mustCreateVisibleQueryGate(t, repo, companyID, "Edit gate")
	hiddenGate := mustCreateVisibleQueryGate(t, repo, companyID, "Hidden gate")

	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, viewNode.NodeID, viewer.UserID, EntityPermissionView)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, editNode.NodeID, viewer.UserID, EntityPermissionEdit)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, hiddenNode.NodeID, viewer.UserID, EntityPermissionNoAccess)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, viewGate.LogicGateID, viewer.UserID, EntityPermissionView)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, editGate.LogicGateID, viewer.UserID, EntityPermissionEdit)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, hiddenGate.LogicGateID, viewer.UserID, EntityPermissionNoAccess)

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

func TestMemoryVisibleFolderAndSearchReadsUseEffectiveAccess(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222303"
	repo.EnsureCompany(companyID, "Visible Folder Co")

	viewer := mustCreateInboxReadCompanyUser(t, repo, "visible-folder-viewer", companyID, "visible-folder-viewer@example.com", "Visible Folder Viewer")
	nodeParent, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Node parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder node parent: %v", err)
	}
	nodeChild, err := repo.CreateCompanyExplorerFolder(companyID, nodeParent.FolderID, "node", "Node child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder node child: %v", err)
	}
	logicParent, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Logic parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder logic parent: %v", err)
	}
	logicChild, err := repo.CreateCompanyExplorerFolder(companyID, logicParent.FolderID, "logic_gate", "Logic child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder logic child: %v", err)
	}

	viewNode := mustCreateVisibleQueryNode(t, repo, companyID, "Folder view node")
	editNode := mustCreateVisibleQueryNode(t, repo, companyID, "Folder edit node")
	hiddenNode := mustCreateVisibleQueryNode(t, repo, companyID, "Folder hidden node")
	viewGate := mustCreateVisibleQueryGate(t, repo, companyID, "Approval view gate")
	adminGate := mustCreateVisibleQueryGate(t, repo, companyID, "Approval admin gate")
	hiddenGate := mustCreateVisibleQueryGate(t, repo, companyID, "Approval hidden gate")

	mustAssignVisibleQueryFolderItem(t, repo, companyID, nodeParent.FolderID, "node", viewNode.NodeID)
	mustAssignVisibleQueryFolderItem(t, repo, companyID, nodeChild.FolderID, "node", editNode.NodeID)
	mustAssignVisibleQueryFolderItem(t, repo, companyID, nodeChild.FolderID, "node", hiddenNode.NodeID)
	mustAssignVisibleQueryFolderItem(t, repo, companyID, logicParent.FolderID, "logic_gate", viewGate.LogicGateID)
	mustAssignVisibleQueryFolderItem(t, repo, companyID, logicChild.FolderID, "logic_gate", adminGate.LogicGateID)
	mustAssignVisibleQueryFolderItem(t, repo, companyID, logicChild.FolderID, "logic_gate", hiddenGate.LogicGateID)

	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, viewNode.NodeID, viewer.UserID, EntityPermissionView)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, editNode.NodeID, viewer.UserID, EntityPermissionEdit)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, hiddenNode.NodeID, viewer.UserID, EntityPermissionNoAccess)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, viewGate.LogicGateID, viewer.UserID, EntityPermissionView)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, adminGate.LogicGateID, viewer.UserID, EntityPermissionAdmin)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, hiddenGate.LogicGateID, viewer.UserID, EntityPermissionNoAccess)

	nodes, err := repo.ListVisibleNodesInFolderSubtree(companyID, nodeParent.FolderID, viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleNodesInFolderSubtree: %v", err)
	}
	assertVisibleQueryNodeIDs(t, nodes, viewNode.NodeID, editNode.NodeID)
	assertVisibleQueryNodesDoNotContain(t, nodes, hiddenNode.NodeID)

	gates, err := repo.ListVisibleLogicGatesInFolderSubtree(companyID, logicParent.FolderID, viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleLogicGatesInFolderSubtree: %v", err)
	}
	assertVisibleQueryLogicGateIDs(t, gates, viewGate.LogicGateID, adminGate.LogicGateID)
	assertVisibleQueryLogicGatesDoNotContain(t, gates, hiddenGate.LogicGateID)

	queryGates, err := repo.QueryVisibleLogicGates(companyID, viewer.UserID, LogicGateQuery{Search: "approval", Limit: 10})
	if err != nil {
		t.Fatalf("QueryVisibleLogicGates: %v", err)
	}
	assertVisibleQueryLogicGateIDs(t, queryGates, adminGate.LogicGateID, viewGate.LogicGateID)
	assertVisibleQueryLogicGatesDoNotContain(t, queryGates, hiddenGate.LogicGateID)
}

func TestMemoryVisibleExplorerSharedTriageAndWorkItemReadsDoNotLeak(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222304"
	repo.EnsureCompany(companyID, "Visible Explorer Co")

	viewer := mustCreateInboxReadCompanyUser(t, repo, "visible-explorer-viewer", companyID, "visible-explorer-viewer@example.com", "Visible Explorer Viewer")
	nodeFolder, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Node folder")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder node: %v", err)
	}
	logicFolder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Logic folder")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder logic: %v", err)
	}
	sharedParent, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Visible shared", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder shared parent: %v", err)
	}
	sharedChild, err := repo.CreateCommunicationsSharedInboxFolder(companyID, sharedParent.FolderID, "Visible child", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder shared child: %v", err)
	}
	hiddenShared, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Hidden shared", "")
	if err != nil {
		t.Fatalf("CreateCommunicationsSharedInboxFolder hidden shared: %v", err)
	}

	visibleNode := mustCreateVisibleQueryNode(t, repo, companyID, "Explorer visible node")
	hiddenNode := mustCreateVisibleQueryNode(t, repo, companyID, "Explorer hidden node")
	visibleGate := mustCreateVisibleQueryGate(t, repo, companyID, "Explorer visible gate")
	hiddenGate := mustCreateVisibleQueryGate(t, repo, companyID, "Explorer hidden gate")
	mustAssignVisibleQueryFolderItem(t, repo, companyID, nodeFolder.FolderID, "node", visibleNode.NodeID)
	mustAssignVisibleQueryFolderItem(t, repo, companyID, nodeFolder.FolderID, "node", hiddenNode.NodeID)
	mustAssignVisibleQueryFolderItem(t, repo, companyID, logicFolder.FolderID, "logic_gate", visibleGate.LogicGateID)
	mustAssignVisibleQueryFolderItem(t, repo, companyID, logicFolder.FolderID, "logic_gate", hiddenGate.LogicGateID)

	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, visibleNode.NodeID, viewer.UserID, EntityPermissionView)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, hiddenNode.NodeID, viewer.UserID, EntityPermissionNoAccess)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, visibleGate.LogicGateID, viewer.UserID, EntityPermissionEdit)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, hiddenGate.LogicGateID, viewer.UserID, EntityPermissionNoAccess)
	for _, folderID := range []string{sharedParent.FolderID, sharedChild.FolderID, hiddenShared.FolderID} {
		mustSetVisibleQueryDefaultAccess(t, repo, companyID, EntityTypeSharedTriageFolder, folderID, ResourceDefaultAccessNoAccess)
	}
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeSharedTriageFolder, sharedParent.FolderID, viewer.UserID, EntityPermissionEdit)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeSharedTriageFolder, sharedChild.FolderID, viewer.UserID, EntityPermissionEdit)

	responsibleGate := mustCreateVisibleQueryGate(t, repo, companyID, "Work item responsible")
	responsibleNode := mustCreateVisibleQueryNode(t, repo, companyID, "Work item responsible node")
	mustSetInboxReadLogicGateRaci(t, repo, companyID, responsibleGate.LogicGateID, []LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleResponsible, UserID: viewer.UserID}})
	mustAssignVisibleQueryNodeToGate(t, repo, companyID, responsibleGate.LogicGateID, responsibleNode.NodeID)
	aciGate := mustCreateVisibleQueryGate(t, repo, companyID, "Work item ACI")
	mustSetInboxReadLogicGateRaci(t, repo, companyID, aciGate.LogicGateID, []LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleAccountable, UserID: viewer.UserID}})

	sharedFolders, err := repo.ListVisibleCommunicationsSharedInboxFolders(companyID, viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleCommunicationsSharedInboxFolders: %v", err)
	}
	assertVisibleQueryFolderIDs(t, sharedFolders, sharedParent.FolderID, sharedChild.FolderID)
	assertVisibleQueryFoldersDoNotContain(t, sharedFolders, hiddenShared.FolderID)

	folderItems, err := repo.ListVisibleCompanyExplorerFolderItems(companyID, "", "", viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleCompanyExplorerFolderItems: %v", err)
	}
	assertVisibleQueryFolderItemIDs(t, folderItems, "node", visibleNode.NodeID, "node", responsibleNode.NodeID, "logic_gate", visibleGate.LogicGateID)
	assertVisibleQueryFolderItemsDoNotContain(t, folderItems, "node", hiddenNode.NodeID, "logic_gate", hiddenGate.LogicGateID)

	nodeSummaries, err := repo.ListVisibleCompanyExplorerNodeSummaries(companyID, viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleCompanyExplorerNodeSummaries: %v", err)
	}
	assertVisibleQueryNodeIDs(t, nodeSummaries, visibleNode.NodeID, responsibleNode.NodeID)
	assertVisibleQueryNodesDoNotContain(t, nodeSummaries, hiddenNode.NodeID)

	gateSummaries, err := repo.ListVisibleCompanyExplorerLogicGateSummaries(companyID, viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleCompanyExplorerLogicGateSummaries: %v", err)
	}
	assertVisibleQueryLogicGateIDs(t, gateSummaries, visibleGate.LogicGateID, responsibleGate.LogicGateID, aciGate.LogicGateID)
	assertVisibleQueryLogicGatesDoNotContain(t, gateSummaries, hiddenGate.LogicGateID)

	mustSetVisibleQueryDefaultAccess(t, repo, companyID, EntityTypeNode, responsibleNode.NodeID, ResourceDefaultAccessNoAccess)
	responsibleNodes, err := repo.ListResponsibleInboxNodes(WorkItemInboxQuery{CompanyID: companyID, UserID: viewer.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListResponsibleInboxNodes: %v", err)
	}
	assertVisibleQueryNodesDoNotContain(t, responsibleNodes, responsibleNode.NodeID)

	mustSetVisibleQueryDefaultAccess(t, repo, companyID, EntityTypeLogicGate, aciGate.LogicGateID, ResourceDefaultAccessNoAccess)
	aciGates, err := repo.ListACIInboxLogicGates(WorkItemInboxQuery{CompanyID: companyID, UserID: viewer.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListACIInboxLogicGates: %v", err)
	}
	if findInboxReadGate(aciGates, aciGate.LogicGateID) != nil {
		t.Fatalf("ACI work item read leaked inaccessible gate: %+v", aciGates)
	}
}

func TestMemoryVisibleCompanyExplorerFoldersUseFolderPermissions(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "22222222-2222-4222-8222-222222222305"
	repo.EnsureCompany(companyID, "Visible Folder Permissions Co")

	viewer := mustCreateInboxReadCompanyUser(t, repo, "visible-folder-permissions-viewer", companyID, "visible-folder-permissions-viewer@example.com", "Visible Folder Permissions Viewer")
	visibleNodeFolder, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Visible node folder")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder visible node: %v", err)
	}
	hiddenNodeFolder, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Hidden node folder")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder hidden node: %v", err)
	}
	visibleChildUnderHiddenNodeFolder, err := repo.CreateCompanyExplorerFolder(companyID, hiddenNodeFolder.FolderID, "node", "Visible child under hidden node folder")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder visible child under hidden node: %v", err)
	}
	logicParent, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Responsible")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder logic parent: %v", err)
	}
	hiddenNestedLogicFolder, err := repo.CreateCompanyExplorerFolder(companyID, logicParent.FolderID, "logic_gate", "Hidden nested logic folder")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder hidden nested logic: %v", err)
	}

	visibleNode := mustCreateVisibleQueryNode(t, repo, companyID, "Visible folder node")
	hiddenFolderNode := mustCreateVisibleQueryNode(t, repo, companyID, "Hidden folder node")
	visibleGate := mustCreateVisibleQueryGate(t, repo, companyID, "Visible parent gate")
	hiddenNestedGate := mustCreateVisibleQueryGate(t, repo, companyID, "Hidden nested gate")

	mustAssignVisibleQueryFolderItem(t, repo, companyID, visibleNodeFolder.FolderID, "node", visibleNode.NodeID)
	mustAssignVisibleQueryFolderItem(t, repo, companyID, hiddenNodeFolder.FolderID, "node", hiddenFolderNode.NodeID)
	mustAssignVisibleQueryFolderItem(t, repo, companyID, logicParent.FolderID, "logic_gate", visibleGate.LogicGateID)
	mustAssignVisibleQueryFolderItem(t, repo, companyID, hiddenNestedLogicFolder.FolderID, "logic_gate", hiddenNestedGate.LogicGateID)

	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, visibleNode.NodeID, viewer.UserID, EntityPermissionView)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, hiddenFolderNode.NodeID, viewer.UserID, EntityPermissionView)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, visibleGate.LogicGateID, viewer.UserID, EntityPermissionView)
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeLogicGate, hiddenNestedGate.LogicGateID, viewer.UserID, EntityPermissionView)
	mustSetVisibleQueryDefaultAccess(t, repo, companyID, EntityTypeCompanyExplorerFolder, hiddenNodeFolder.FolderID, ResourceDefaultAccessNoAccess)
	mustSetVisibleQueryDefaultAccess(t, repo, companyID, EntityTypeCompanyExplorerFolder, hiddenNestedLogicFolder.FolderID, ResourceDefaultAccessNoAccess)

	folders, err := repo.ListVisibleCompanyExplorerFolders(companyID, "", viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleCompanyExplorerFolders: %v", err)
	}
	assertVisibleQueryFoldersContain(t, folders, visibleNodeFolder.FolderID, logicParent.FolderID)
	assertVisibleQueryFoldersDoNotContain(t, folders, hiddenNodeFolder.FolderID, visibleChildUnderHiddenNodeFolder.FolderID, hiddenNestedLogicFolder.FolderID)

	folderItems, err := repo.ListVisibleCompanyExplorerFolderItems(companyID, "", "", viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleCompanyExplorerFolderItems: %v", err)
	}
	assertVisibleQueryFolderItemIDs(t, folderItems, "node", visibleNode.NodeID, "logic_gate", visibleGate.LogicGateID)
	assertVisibleQueryFolderItemsDoNotContain(t, folderItems, "node", hiddenFolderNode.NodeID, "logic_gate", hiddenNestedGate.LogicGateID)

	hiddenNodeSubtreeItems, err := repo.ListVisibleCompanyExplorerFolderItemsInFolderSubtree(companyID, hiddenNodeFolder.FolderID, "node", viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleCompanyExplorerFolderItemsInFolderSubtree hidden node: %v", err)
	}
	if len(hiddenNodeSubtreeItems) != 0 {
		t.Fatalf("hidden node folder subtree items = %+v, want none", hiddenNodeSubtreeItems)
	}
	hiddenNodeSubtree, err := repo.ListVisibleCompanyExplorerNodeSummariesInFolderSubtree(companyID, hiddenNodeFolder.FolderID, viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleCompanyExplorerNodeSummariesInFolderSubtree hidden node: %v", err)
	}
	assertVisibleQueryNodesDoNotContain(t, hiddenNodeSubtree, hiddenFolderNode.NodeID)
	if len(hiddenNodeSubtree) != 0 {
		t.Fatalf("hidden node folder subtree nodes = %+v, want none", hiddenNodeSubtree)
	}

	logicParentSubtree, err := repo.ListVisibleCompanyExplorerLogicGateSummariesInFolderSubtree(companyID, logicParent.FolderID, viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleCompanyExplorerLogicGateSummariesInFolderSubtree parent: %v", err)
	}
	assertVisibleQueryLogicGateIDs(t, logicParentSubtree, visibleGate.LogicGateID)
	assertVisibleQueryLogicGatesDoNotContain(t, logicParentSubtree, hiddenNestedGate.LogicGateID)
	hiddenNestedSubtree, err := repo.ListVisibleCompanyExplorerLogicGateSummariesInFolderSubtree(companyID, hiddenNestedLogicFolder.FolderID, viewer.UserID)
	if err != nil {
		t.Fatalf("ListVisibleCompanyExplorerLogicGateSummariesInFolderSubtree hidden nested: %v", err)
	}
	if len(hiddenNestedSubtree) != 0 {
		t.Fatalf("hidden nested logic folder subtree gates = %+v, want none", hiddenNestedSubtree)
	}
}

func TestPostgresVisibleQueriesUseDynamicPermissions(t *testing.T) {
	nodeRaw, err := os.ReadFile("postgres_nodes.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_nodes.go: %v", err)
	}
	nodeSource := visibleQueryNormalizeSource(string(nodeRaw))
	for _, needle := range []string{
		"func (r *postgresrepo) listvisiblenodes",
		"mangorts_user_can_access_resource(n.company_id, 'node', n.node_id",
		"func (r *postgresrepo) listvisiblenodesinfoldersubtree",
		"join folder_nodes visible on visible.node_id=n.node_id",
	} {
		if !strings.Contains(nodeSource, needle) {
			t.Fatalf("Postgres visible node query missing %q", needle)
		}
	}
	for _, forbidden := range []string{"listaccessibleentityids", "effective_" + "resource_" + "access"} {
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
		"mangorts_user_can_access_resource(gate.company_id, 'logic_gate', gate.logic_gate_id",
		"func (r *postgresrepo) listvisiblelogicgatesinfoldersubtree",
		"join folder_gates visible on visible.logic_gate_id=gate.logic_gate_id",
		"func (r *postgresrepo) queryvisiblelogicgates",
	} {
		if !strings.Contains(logicGateSource, needle) {
			t.Fatalf("Postgres visible Logic Gate query missing %q", needle)
		}
	}
	for _, forbidden := range []string{"listaccessibleentityids", "effective_" + "resource_" + "access"} {
		if strings.Contains(logicGateSource, forbidden) {
			t.Fatalf("Postgres visible Logic Gate query should not use %q", forbidden)
		}
	}

	companyExplorerRaw, err := os.ReadFile("postgres_company_explorer.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_company_explorer.go: %v", err)
	}
	companyExplorerSource := visibleQueryNormalizeSource(string(companyExplorerRaw))
	for _, needle := range []string{
		"func (r *postgresrepo) listvisiblecompanyexplorerfolders",
		"func (r *postgresrepo) listvisiblecompanyexplorerfolderitems",
		"func (r *postgresrepo) listvisiblecompanyexplorernodesummaries",
		"func (r *postgresrepo) listvisiblecompanyexplorerlogicgatesummaries",
		"mangorts_user_can_access_resource",
		"item.item_type not in ('node', 'logic_gate', 'project')",
	} {
		if !strings.Contains(companyExplorerSource, needle) {
			t.Fatalf("Postgres visible company explorer query missing %q", needle)
		}
	}
	for _, forbidden := range []string{"listaccessibleentityids", "effective_" + "resource_" + "access"} {
		if strings.Contains(companyExplorerSource, forbidden) {
			t.Fatalf("Postgres visible company explorer query should not use %q", forbidden)
		}
	}

	sharedInboxRaw, err := os.ReadFile("postgres_shared_inbox_folders.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_shared_inbox_folders.go: %v", err)
	}
	sharedInboxSource := visibleQueryNormalizeSource(string(sharedInboxRaw))
	for _, needle := range []string{
		"func (r *postgresrepo) listvisiblecommunicationssharedinboxfolders",
		"mangorts_user_can_access_resource",
		"'shared_triage_folder'",
	} {
		if !strings.Contains(sharedInboxSource, needle) {
			t.Fatalf("Postgres visible shared inbox query missing %q", needle)
		}
	}
	for _, forbidden := range []string{"listaccessibleentityids", "effective_" + "resource_" + "access"} {
		if strings.Contains(sharedInboxSource, forbidden) {
			t.Fatalf("Postgres visible shared inbox query should not use %q", forbidden)
		}
	}

	workItemRaw, err := os.ReadFile("postgres_work_item_reads.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_work_item_reads.go: %v", err)
	}
	workItemSource := visibleQueryNormalizeSource(string(workItemRaw))
	for _, needle := range []string{
		"from racio_matrix_projection_table entry",
		"mangorts_user_can_access_resource(entry.company_id, 'node', entry.resource_id, $4::uuid, 'edit')",
		"mangorts_user_can_access_resource(entry.company_id, 'logic_gate', entry.resource_id, $4::uuid, 'edit')",
	} {
		if !strings.Contains(workItemSource, needle) {
			t.Fatalf("Postgres visible work item query missing %q", needle)
		}
	}
	for _, forbidden := range []string{"listaccessibleentityids", "effective_" + "resource_" + "access"} {
		if strings.Contains(workItemSource, forbidden) {
			t.Fatalf("Postgres visible work item query should not use %q", forbidden)
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
	input := EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: entityType,
		EntityID:   entityID,
	}
	if usesDefaultResourceAccessPolicy(entityType) {
		input.DefaultAccess = ResourceDefaultAccessNoAccess
		input.DefaultAccessSet = true
		if accessLevel != EntityPermissionNoAccess {
			input.OverrideUserIDs = []string{userID}
		}
	} else {
		input.Permissions = []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   userID,
			AccessLevel: accessLevel,
		}}
	}
	if _, err := repo.SetEntityPermissions(input); err != nil {
		t.Fatalf("SetEntityPermissions %s/%s: %v", entityType, entityID, err)
	}
}

func mustSetVisibleQueryDefaultAccess(t *testing.T, repo *MemoryRepo, companyID, entityType, entityID, defaultAccess string) {
	t.Helper()
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       entityType,
		EntityID:         entityID,
		DefaultAccess:    defaultAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions default %s/%s: %v", entityType, entityID, err)
	}
}

func mustAssignVisibleQueryNodeToGate(t *testing.T, repo *MemoryRepo, companyID, logicGateID, nodeID string) {
	t.Helper()
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGateID,
		NodeID:      nodeID,
		Status:      "pending",
		Priority:    testPriority(3),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus %s/%s: %v", logicGateID, nodeID, err)
	}
}

func mustAssignVisibleQueryFolderItem(t *testing.T, repo *MemoryRepo, companyID, folderID, itemType, itemID string) {
	t.Helper()
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, folderID, itemType, itemID, 0); err != nil {
		t.Fatalf("AssignCompanyExplorerFolderItem %s/%s: %v", itemType, itemID, err)
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

func assertVisibleQueryFolderIDs(t *testing.T, folders []domain.CompanyExplorerFolder, wantIDs ...string) {
	t.Helper()
	got := map[string]bool{}
	for _, folder := range folders {
		got[folder.FolderID] = true
	}
	if len(got) != len(wantIDs) {
		t.Fatalf("visible folder IDs = %+v, want %+v", got, wantIDs)
	}
	for _, wantID := range wantIDs {
		if !got[wantID] {
			t.Fatalf("visible folder IDs = %+v, want %s", got, wantID)
		}
	}
}

func assertVisibleQueryFoldersContain(t *testing.T, folders []domain.CompanyExplorerFolder, wantIDs ...string) {
	t.Helper()
	got := map[string]bool{}
	for _, folder := range folders {
		got[folder.FolderID] = true
	}
	for _, wantID := range wantIDs {
		if !got[wantID] {
			t.Fatalf("visible folder IDs = %+v, want to contain %s", got, wantID)
		}
	}
}

func assertVisibleQueryFoldersDoNotContain(t *testing.T, folders []domain.CompanyExplorerFolder, hiddenIDs ...string) {
	t.Helper()
	for _, folder := range folders {
		for _, hiddenID := range hiddenIDs {
			if folder.FolderID == hiddenID {
				t.Fatalf("visible folders leaked hidden folder %s in %+v", hiddenID, folders)
			}
		}
	}
}

func assertVisibleQueryFolderItemIDs(t *testing.T, items []domain.CompanyExplorerFolderItem, wantPairs ...string) {
	t.Helper()
	if len(wantPairs)%2 != 0 {
		t.Fatalf("wantPairs must be item_type/item_id pairs: %+v", wantPairs)
	}
	got := map[string]bool{}
	for _, item := range items {
		got[item.ItemType+":"+item.ItemID] = true
	}
	if len(got) != len(wantPairs)/2 {
		t.Fatalf("visible folder items = %+v, want %+v", got, wantPairs)
	}
	for index := 0; index < len(wantPairs); index += 2 {
		wantKey := wantPairs[index] + ":" + wantPairs[index+1]
		if !got[wantKey] {
			t.Fatalf("visible folder items = %+v, want %s", got, wantKey)
		}
	}
}

func assertVisibleQueryFolderItemsDoNotContain(t *testing.T, items []domain.CompanyExplorerFolderItem, hiddenPairs ...string) {
	t.Helper()
	if len(hiddenPairs)%2 != 0 {
		t.Fatalf("hiddenPairs must be item_type/item_id pairs: %+v", hiddenPairs)
	}
	hidden := map[string]bool{}
	for index := 0; index < len(hiddenPairs); index += 2 {
		hidden[hiddenPairs[index]+":"+hiddenPairs[index+1]] = true
	}
	for _, item := range items {
		if hidden[item.ItemType+":"+item.ItemID] {
			t.Fatalf("visible folder items leaked hidden item %s/%s in %+v", item.ItemType, item.ItemID, items)
		}
	}
}

func visibleQueryNormalizeSource(raw string) string {
	return strings.ToLower(strings.Join(strings.Fields(raw), " "))
}
