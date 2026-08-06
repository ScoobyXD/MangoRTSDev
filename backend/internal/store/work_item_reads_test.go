package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"reflect"
	"sort"
	"testing"
	"time"
)

func TestMemoryRepoWorkItemInboxReadContracts(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111111"
	otherCompanyID := "22222222-2222-4222-8222-222222222222"
	repo.EnsureCompany(companyID, "Inbox Read Company")
	repo.EnsureCompany(otherCompanyID, "Other Inbox Read Company")

	user := mustCreateInboxReadCompanyUser(t, repo, "inbox-user-subject", companyID, "inbox@example.com", "Inbox User")
	if _, err := repo.AddCompanyMembership("inbox-user-subject", otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership other company: %v", err)
	}
	otherUser := mustCreateInboxReadCompanyUser(t, repo, "other-inbox-user-subject", companyID, "other-inbox@example.com", "Other Inbox User")

	generatedOnly := mustCreateInboxReadLogicGate(t, repo, companyID, "Alpha Responsible")
	accountableGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Bravo Accountable")
	consultedGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Charlie Consulted")
	informedGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Delta Informed")
	mixedPrincipalGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Echo Mixed Principals")
	otherUserGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Foxtrot Other User")
	otherCompanyGate := mustCreateInboxReadLogicGate(t, repo, otherCompanyID, "Other Company Gate")

	mustSetInboxReadLogicGateGVIC(t, repo, companyID, generatedOnly.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: user.UserID}})
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, accountableGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleVerified, UserID: user.UserID}})
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, consultedGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleConsulted, UserID: user.UserID}})
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, informedGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleInformed, UserID: user.UserID}})
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, mixedPrincipalGate.LogicGateID, []LogicGateGVICAssignmentInput{
		{Role: domain.GVICRoleGenerated, UserID: otherUser.UserID},
		{Role: domain.GVICRoleVerified, UserID: user.UserID},
	})
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, otherUserGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleVerified, UserID: otherUser.UserID}})
	mustSetInboxReadLogicGateGVIC(t, repo, otherCompanyID, otherCompanyGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleVerified, UserID: user.UserID}})

	olderNode, err := repo.CreateNode(companyID, "Older assigned node")
	if err != nil {
		t.Fatalf("CreateNode older: %v", err)
	}
	mustSetInboxReadNodeGVIC(t, repo, companyID, olderNode.NodeID, user.UserID)
	newerNode, err := repo.CreateNode(companyID, "Newer assigned node")
	if err != nil {
		t.Fatalf("CreateNode newer: %v", err)
	}
	mustSetInboxReadNodeGVIC(t, repo, companyID, newerNode.NodeID, user.UserID)
	if _, err := repo.CreateNode(companyID, "Unassigned node"); err != nil {
		t.Fatalf("CreateNode unassigned: %v", err)
	}
	otherCompanyNode, err := repo.CreateNode(otherCompanyID, "Other company assigned node")
	if err != nil {
		t.Fatalf("CreateNode other company: %v", err)
	}
	mustSetInboxReadNodeGVIC(t, repo, otherCompanyID, otherCompanyNode.NodeID, user.UserID)
	responsibleNode, err := repo.CreateNode(companyID, "Responsible gate node")
	if err != nil {
		t.Fatalf("CreateNode responsible gate: %v", err)
	}
	setMemoryInboxReadNodeCreatedTimestamp(t, repo, companyID, olderNode.NodeID, time.Date(2026, 5, 19, 10, 0, 0, 0, time.UTC))
	setMemoryInboxReadNodeCreatedTimestamp(t, repo, companyID, newerNode.NodeID, time.Date(2026, 5, 19, 11, 0, 0, 0, time.UTC))
	setMemoryInboxReadNodeCreatedTimestamp(t, repo, companyID, responsibleNode.NodeID, time.Date(2026, 5, 19, 9, 0, 0, 0, time.UTC))

	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: accountableGate.LogicGateID,
		NodeID:      olderNode.NodeID,
		Status:      "In Progress",
		Priority:    testPriority(5),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	responsiblePriority := 4
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: generatedOnly.LogicGateID,
		NodeID:      responsibleNode.NodeID,
		Status:      "in progress",
		Priority:    &responsiblePriority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus responsible: %v", err)
	}
	mustSetInboxReadNodeInherited(t, repo, companyID, responsibleNode.NodeID)
	responsibleNodes, err := repo.ListGeneratedInboxNodes(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListGeneratedInboxNodes: %v", err)
	}
	if len(responsibleNodes) != 2 || responsibleNodes[0].NodeID != responsibleNode.NodeID || responsibleNodes[1].NodeID != olderNode.NodeID {
		t.Fatalf("responsible nodes = %+v, want inherited responsible node followed by customized older node", responsibleNodes)
	}
	responsibleRead := mustFindInboxReadNode(t, responsibleNodes, responsibleNode.NodeID)
	if responsibleRead.Status == nil || *responsibleRead.Status != "In Progress" {
		t.Fatalf("responsible node status = %+v, want card-derived In Progress", responsibleRead.Status)
	}
	if responsibleRead.Priority == nil || *responsibleRead.Priority != responsiblePriority {
		t.Fatalf("responsible node priority = %+v, want %d", responsibleRead.Priority, responsiblePriority)
	}
	if len(responsibleRead.LogicGateIDs) != 1 || responsibleRead.LogicGateIDs[0] != generatedOnly.LogicGateID {
		t.Fatalf("responsible node logic_gate_ids = %+v, want %q", responsibleRead.LogicGateIDs, generatedOnly.LogicGateID)
	}

	limitedResponsible, err := repo.ListGeneratedInboxNodes(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 1})
	if err != nil {
		t.Fatalf("ListGeneratedInboxNodes limited: %v", err)
	}
	if len(limitedResponsible) != 1 || limitedResponsible[0].NodeID != responsibleNode.NodeID {
		t.Fatalf("limited responsible nodes = %+v, want responsible node first", limitedResponsible)
	}

	myNodes, err := repo.ListMyNodes(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListMyNodes: %v", err)
	}
	if len(myNodes) != 1 || myNodes[0].NodeID != newerNode.NodeID {
		t.Fatalf("my nodes = %+v, want standalone assigned company node %s", myNodes, newerNode.NodeID)
	}

	aciGates, err := repo.ListACIInboxLogicGates(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListACIInboxLogicGates: %v", err)
	}
	if findInboxReadGate(aciGates, generatedOnly.LogicGateID) != nil {
		t.Fatalf("ACI inbox returned responsible-only gate: %+v", aciGates)
	}
	for _, gateID := range []string{accountableGate.LogicGateID, consultedGate.LogicGateID, informedGate.LogicGateID, mixedPrincipalGate.LogicGateID} {
		if findInboxReadGate(aciGates, gateID) == nil {
			t.Fatalf("ACI inbox missing gate %q: %+v", gateID, aciGates)
		}
	}
	mixedACI := findInboxReadGate(aciGates, mixedPrincipalGate.LogicGateID)
	if !reflect.DeepEqual(mixedACI.Roles, []string{domain.GVICRoleVerified}) {
		t.Fatalf("ACI mixed-principal roles = %+v, want only verified", mixedACI.Roles)
	}
	limitedACI, err := repo.ListACIInboxLogicGates(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 2})
	if err != nil {
		t.Fatalf("ListACIInboxLogicGates limited: %v", err)
	}
	if len(limitedACI) != 2 || limitedACI[0].LogicGateID != accountableGate.LogicGateID || limitedACI[1].LogicGateID != consultedGate.LogicGateID {
		t.Fatalf("limited ACI gates = %+v, want deterministic header ordering", limitedACI)
	}

	myGates, err := repo.ListMyLogicGates(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListMyLogicGates: %v", err)
	}
	if findInboxReadGate(myGates, otherUserGate.LogicGateID) != nil || findInboxReadGate(myGates, otherCompanyGate.LogicGateID) != nil {
		t.Fatalf("my logic gates leaked another user/company gate: %+v", myGates)
	}
	responsibleGateRead := findInboxReadGate(myGates, generatedOnly.LogicGateID)
	if responsibleGateRead == nil || !inboxReadRolesContain(responsibleGateRead.Roles, domain.GVICRoleGenerated) {
		t.Fatalf("my logic gates responsible roles = %+v, want responsible gate", responsibleGateRead)
	}
	mixedMy := findInboxReadGate(myGates, mixedPrincipalGate.LogicGateID)
	if mixedMy == nil || !reflect.DeepEqual(mixedMy.Roles, []string{domain.GVICRoleVerified}) {
		t.Fatalf("my logic gate mixed-principal roles = %+v, want only verified", mixedMy)
	}
	if len(mixedMy.GVICAssignments) != 2 {
		t.Fatalf("my logic gate GVIC_assignments = %+v, want both source assignments", mixedMy.GVICAssignments)
	}
}

func TestMemoryRepoLogicGateGVICGroupAssignmentsIncludeSubgroups(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "33333333-3333-4333-8333-333333333333"
	repo.EnsureCompany(companyID, "Group GVIC Company")

	user := mustCreateInboxReadCompanyUser(t, repo, "group-GVIC-user-subject", companyID, "group-GVIC@example.com", "Group GVIC User")
	parentGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Operations")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup parent: %v", err)
	}
	childGroup, err := repo.CreateCompanyUserGroup(companyID, parentGroup.GroupID, "Escalations")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup child: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, childGroup.GroupID, []string{user.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers child: %v", err)
	}

	responsibleGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Parent Group Responsible")
	aciGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Child Group Accountable")
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, responsibleGate.LogicGateID, []LogicGateGVICAssignmentInput{{
		Role:          domain.GVICRoleConsulted,
		PrincipalType: EntityPermissionSubjectGroup,
		PrincipalID:   parentGroup.GroupID,
	}})
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, aciGate.LogicGateID, []LogicGateGVICAssignmentInput{{
		Role:          domain.GVICRoleInformed,
		PrincipalType: EntityPermissionSubjectGroup,
		PrincipalID:   childGroup.GroupID,
	}})

	aciGates, err := repo.ListACIInboxLogicGates(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListACIInboxLogicGates: %v", err)
	}
	responsibleGateRead := findInboxReadGate(aciGates, responsibleGate.LogicGateID)
	if responsibleGateRead == nil || !inboxReadRolesContain(responsibleGateRead.Roles, domain.GVICRoleConsulted) {
		t.Fatalf("ACI gates = %+v, want parent group consulted gate", aciGates)
	}
	if len(responsibleGateRead.GVICAssignments) != 1 ||
		responsibleGateRead.GVICAssignments[0].PrincipalType != EntityPermissionSubjectGroup ||
		responsibleGateRead.GVICAssignments[0].PrincipalID != parentGroup.GroupID {
		t.Fatalf("responsible gate assignments = %+v, want configured group assignment", responsibleGateRead.GVICAssignments)
	}

	aciGateRead := findInboxReadGate(aciGates, aciGate.LogicGateID)
	if aciGateRead == nil || !inboxReadRolesContain(aciGateRead.Roles, domain.GVICRoleInformed) {
		t.Fatalf("ACI gates = %+v, want child group informed gate", aciGates)
	}
}

func TestMemoryRepoMyWorkMatrixRowsKeepResourceInProjectAfterRejectedAddition(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "44444444-4444-4444-8444-444444444444"
	repo.EnsureCompany(companyID, "My Work Projects Company")
	user := mustCreateInboxReadCompanyUser(t, repo, "my-work-project-user", companyID, "my-work-project@example.com", "My Work Project User")

	logicGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Single Project Gate")
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, logicGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: user.UserID}})
	node, err := repo.CreateNode(companyID, "Done node under active project gate")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 3
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "In Progress",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	mustSetInboxReadNodeInherited(t, repo, companyID, node.NodeID)

	alpha := mustCreateInboxReadProject(t, repo, companyID, "Alpha Project", "Active", user.UserID)
	bravo := mustCreateInboxReadProject(t, repo, companyID, "Bravo Project", "In Progress", user.UserID)
	mustLinkInboxReadProjectResource(t, repo, companyID, alpha.ProjectID, EntityTypeNode, node.NodeID, 1, user.UserID)
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: bravo.ProjectID, ResourceType: EntityTypeNode,
		ResourceID: node.NodeID, Position: 2, ActorUserID: user.UserID,
	}); !errors.Is(err, ErrProjectNodeInAnotherProject) {
		t.Fatalf("add node to Bravo err = %v, want ErrProjectNodeInAnotherProject", err)
	}

	rows, err := repo.ListMyWorkMatrixRows(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListMyWorkMatrixRows: %v", err)
	}
	assertMyWorkProjectNames(t, rows, EntityTypeNode, node.NodeID, []string{"Alpha Project"})

	matrix, err := repo.ListMyWorkMatrix(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID})
	if err != nil {
		t.Fatalf("ListMyWorkMatrix: %v", err)
	}
	if alphaRow := findMyWorkTestRow(matrix.Rows, EntityTypeProject, alpha.ProjectID); alphaRow == nil {
		t.Fatalf("Alpha project missing after rejected addition; rows=%+v", matrix.Rows)
	}
	if bravoRow := findMyWorkTestRow(matrix.Rows, EntityTypeProject, bravo.ProjectID); bravoRow != nil {
		t.Fatalf("Bravo project contains rejected Node: %+v", bravoRow)
	}
	nodeRow := findMyWorkTestRow(matrix.Rows, EntityTypeNode, node.NodeID)
	if nodeRow == nil ||
		nodeRow.ProjectionRowID == "" ||
		nodeRow.ProjectID != alpha.ProjectID ||
		nodeRow.ProjectName != "Alpha Project" ||
		nodeRow.LogicGateID == nil ||
		*nodeRow.LogicGateID != logicGate.LogicGateID ||
		nodeRow.LogicGateName != "Single Project Gate" ||
		nodeRow.NodeID != node.NodeID ||
		nodeRow.NodeName != "Done node under active project gate" ||
		nodeRow.GVICAssignment != domain.GVICRoleGenerated ||
		nodeRow.IsContainerRow {
		t.Fatalf("node leaf path row = %+v; rows=%+v", nodeRow, matrix.Rows)
	}
}

func TestMemoryRepoMyWorkMatrixRowsApplyProjectActiveRules(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555555"
	repo.EnsureCompany(companyID, "My Work Active Rules Company")
	user := mustCreateInboxReadCompanyUser(t, repo, "my-work-active-user", companyID, "my-work-active@example.com", "My Work Active User")

	standaloneDone, err := repo.CreateNode(companyID, "Standalone done node")
	if err != nil {
		t.Fatalf("CreateNode standalone done: %v", err)
	}
	mustUpdateInboxReadNodeStatus(t, repo, companyID, standaloneDone.NodeID, "Done", user.UserID)
	mustSetInboxReadNodeGVIC(t, repo, companyID, standaloneDone.NodeID, user.UserID)

	activeProjectDone, err := repo.CreateNode(companyID, "Project done node")
	if err != nil {
		t.Fatalf("CreateNode project done: %v", err)
	}
	mustUpdateInboxReadNodeStatus(t, repo, companyID, activeProjectDone.NodeID, "Done", user.UserID)
	mustSetInboxReadNodeGVIC(t, repo, companyID, activeProjectDone.NodeID, user.UserID)
	activeNodeGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Active Project Node Gate")
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, activeNodeGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: user.UserID}})
	activeNodePriority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: activeNodeGate.LogicGateID, NodeID: activeProjectDone.NodeID,
		Status: "Done", Priority: &activeNodePriority, PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus active project node: %v", err)
	}
	activeProject := mustCreateInboxReadProject(t, repo, companyID, "Active Project", "Active", user.UserID)
	mustLinkInboxReadProjectResource(t, repo, companyID, activeProject.ProjectID, EntityTypeNode, activeProjectDone.NodeID, 1, user.UserID)

	doneViaGate, err := repo.CreateNode(companyID, "Project logic gate done node")
	if err != nil {
		t.Fatalf("CreateNode project logic gate done: %v", err)
	}
	logicGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Active Project Gate")
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, logicGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: user.UserID}})
	gatePriority := 2
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      doneViaGate.NodeID,
		Status:      "Done",
		Priority:    &gatePriority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	mustSetInboxReadNodeInherited(t, repo, companyID, doneViaGate.NodeID)
	mustLinkInboxReadProjectResource(t, repo, companyID, activeProject.ProjectID, EntityTypeNode, doneViaGate.NodeID, 2, user.UserID)

	doneProjectNode, err := repo.CreateNode(companyID, "Done project active node")
	if err != nil {
		t.Fatalf("CreateNode done project node: %v", err)
	}
	mustUpdateInboxReadNodeStatus(t, repo, companyID, doneProjectNode.NodeID, "In Progress", user.UserID)
	mustSetInboxReadNodeGVIC(t, repo, companyID, doneProjectNode.NodeID, user.UserID)
	closedNodeGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Closed Project Node Gate")
	closedNodePriority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: closedNodeGate.LogicGateID, NodeID: doneProjectNode.NodeID,
		Status: "In Progress", Priority: &closedNodePriority, PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus closed project node: %v", err)
	}
	doneProject := mustCreateInboxReadProject(t, repo, companyID, "Closed Project", "Done", user.UserID)
	mustLinkInboxReadProjectResource(t, repo, companyID, doneProject.ProjectID, EntityTypeNode, doneProjectNode.NodeID, 1, user.UserID)

	rows, err := repo.ListMyWorkMatrixRows(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID})
	if err != nil {
		t.Fatalf("ListMyWorkMatrixRows: %v", err)
	}
	assertMyWorkProjectNames(t, rows, EntityTypeNode, standaloneDone.NodeID, nil)
	assertMyWorkProjectNames(t, rows, EntityTypeNode, activeProjectDone.NodeID, []string{"Active Project"})
	assertMyWorkProjectNames(t, rows, EntityTypeNode, doneViaGate.NodeID, []string{"Active Project"})
	assertMyWorkProjectNames(t, rows, EntityTypeNode, doneProjectNode.NodeID, nil)
}

func TestMemoryRepoMyWorkMatrixRowsIncludeGeneratedAssigneeForPersonGrouping(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555556"
	repo.EnsureCompany(companyID, "My Work Generated Person Company")
	generated := mustCreateInboxReadCompanyUser(t, repo, "my-work-generated-person", companyID, "generated@example.com", "Generated Person")
	verifier := mustCreateInboxReadCompanyUser(t, repo, "my-work-verifier-person", companyID, "verifier@example.com", "Verifier Person")
	logicGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Generated Person Gate")
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, logicGate.LogicGateID, []LogicGateGVICAssignmentInput{
		{Role: domain.GVICRoleGenerated, UserID: generated.UserID},
		{Role: domain.GVICRoleVerified, UserID: verifier.UserID},
	})
	node, err := repo.CreateNode(companyID, "Generated Person Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 2
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID,
		Priority: &priority, PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	mustSetInboxReadNodeInherited(t, repo, companyID, node.NodeID)

	rows, err := repo.ListMyWorkMatrixRows(WorkItemInboxQuery{
		CompanyID: companyID, UserID: verifier.UserID, ViewerUserID: verifier.UserID,
	})
	if err != nil {
		t.Fatalf("ListMyWorkMatrixRows: %v", err)
	}
	row := findMyWorkTestRow(rows, EntityTypeNode, node.NodeID)
	if row == nil || row.GVICAssignment != domain.GVICRoleVerified {
		t.Fatalf("verifier My Work row = %+v; rows=%+v", row, rows)
	}
	if !reflect.DeepEqual(row.GeneratedUserIDs, []string{generated.UserID}) {
		t.Fatalf("generated user IDs = %+v, want generated assignee %s", row.GeneratedUserIDs, generated.UserID)
	}
}
func TestMemoryRepoMyWorkMatrixExcludesProjectWithoutNodeLeaf(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666666"
	repo.EnsureCompany(companyID, "My Work Project Root Company")
	user := mustCreateInboxReadCompanyUser(t, repo, "my-work-root-user", companyID, "my-work-root@example.com", "My Work Root User")
	project := mustCreateInboxReadProject(t, repo, companyID, "First Class Project", "Active", user.UserID)
	mustSetInboxReadResourceGVIC(t, repo, companyID, EntityTypeProject, project.ProjectID, domain.GVICRoleVerified, user.UserID)

	matrix, err := repo.ListMyWorkMatrix(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID})
	if err != nil {
		t.Fatalf("ListMyWorkMatrix: %v", err)
	}
	if len(matrix.Rows) != 0 {
		t.Fatalf("project-only GVIC assignment produced My Work rows: %+v", matrix.Rows)
	}
}

func mustCreateInboxReadCompanyUser(t *testing.T, repo *MemoryRepo, subject, companyID, email, displayName string) domain.User {
	t.Helper()
	user, err := repo.UpsertAuthUser(subject, email, displayName)
	if err != nil {
		t.Fatalf("UpsertAuthUser %s: %v", subject, err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership %s: %v", subject, err)
	}
	return user
}

func mustCreateInboxReadLogicGate(t *testing.T, repo *MemoryRepo, companyID, header string) domain.LogicGate {
	t.Helper()
	logicGate, err := repo.CreateLogicGate(companyID, header)
	if err != nil {
		t.Fatalf("CreateLogicGate %q: %v", header, err)
	}
	return logicGate
}

func mustSetInboxReadLogicGateGVIC(t *testing.T, repo *MemoryRepo, companyID, logicGateID string, assignments []LogicGateGVICAssignmentInput) {
	t.Helper()
	if _, err := repo.SetLogicGateGVICAssignments(LogicGateGVICAssignmentUpdateInput{CompanyID: companyID, LogicGateID: logicGateID, Assignments: assignments}); err != nil {
		t.Fatalf("SetLogicGateGVICAssignments %s: %v", logicGateID, err)
	}
}

func mustCreateInboxReadProject(t *testing.T, repo *MemoryRepo, companyID, name, status, actorUserID string) domain.Project {
	t.Helper()
	result, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: name, Status: status, ActorUserID: actorUserID})
	if err != nil {
		t.Fatalf("CreateProject %q: %v", name, err)
	}
	if result.Project == nil {
		t.Fatalf("CreateProject %q returned nil project", name)
	}
	return *result.Project
}

func mustLinkInboxReadProjectResource(t *testing.T, repo *MemoryRepo, companyID, projectID, resourceType, resourceID string, position int, actorUserID string) {
	t.Helper()
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID:    companyID,
		ProjectID:    projectID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Position:     position,
		ActorUserID:  actorUserID,
	}); err != nil {
		t.Fatalf("UpsertProjectRelationship %s %s: %v", resourceType, resourceID, err)
	}
}

func mustUpdateInboxReadNodeStatus(t *testing.T, repo *MemoryRepo, companyID, nodeID, status, actorUserID string) {
	t.Helper()
	if _, err := repo.UpdateNode(UpdateNodeInput{
		CompanyID:   companyID,
		NodeID:      nodeID,
		Status:      &status,
		StatusSet:   true,
		ActorUserID: actorUserID,
	}); err != nil {
		t.Fatalf("UpdateNode %s status: %v", nodeID, err)
	}
}

func mustSetInboxReadNodeGVIC(t *testing.T, repo *MemoryRepo, companyID, nodeID, userID string) {
	t.Helper()
	mustSetInboxReadResourceGVIC(t, repo, companyID, EntityTypeNode, nodeID, domain.GVICRoleGenerated, userID)
}

func mustSetInboxReadNodeInherited(t *testing.T, repo *MemoryRepo, companyID, nodeID string) {
	t.Helper()
	current, err := repo.GetResourceGVICPolicy(companyID, EntityTypeNode, nodeID)
	if err != nil {
		t.Fatalf("GetResourceGVICPolicy node %s: %v", nodeID, err)
	}
	if _, _, err := repo.PutResourceGVICPolicy(ResourceGVICPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: nodeID,
		AssignmentMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly,
		ExpectedRevision: current.Revision,
	}); err != nil {
		t.Fatalf("PutResourceGVICPolicy inherited node %s: %v", nodeID, err)
	}
}

func mustSetInboxReadResourceGVIC(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID, role, userID string) {
	t.Helper()
	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          role,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   userID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments %s %s: %v", resourceType, resourceID, err)
	}
}

func assertMyWorkProjectNames(t *testing.T, rows []GVICMatrixProjectionRow, resourceType, resourceID string, want []string) {
	t.Helper()
	got := make([]string, 0)
	for _, row := range rows {
		if myWorkTestRowMatches(row, resourceType, resourceID) {
			got = append(got, row.ProjectName)
		}
	}
	sort.Strings(got)
	if got == nil {
		got = []string{}
	}
	if want == nil {
		want = []string{}
	}
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("project names for %s %s = %+v, want %+v; rows=%+v", resourceType, resourceID, got, want, rows)
	}
}

func findMyWorkTestRow(rows []GVICMatrixProjectionRow, resourceType, resourceID string) *GVICMatrixProjectionRow {
	for index := range rows {
		row := &rows[index]
		if myWorkTestRowMatches(*row, resourceType, resourceID) {
			return row
		}
	}
	return nil
}

func myWorkTestRowMatches(row GVICMatrixProjectionRow, resourceType, resourceID string) bool {
	switch resourceType {
	case EntityTypeNode:
		return row.NodeID == resourceID
	case EntityTypeProject:
		return row.ProjectID == resourceID
	case EntityTypeLogicGate:
		return row.LogicGateID != nil && *row.LogicGateID == resourceID
	default:
		return false
	}
}

func setMemoryInboxReadNodeCreatedTimestamp(t *testing.T, repo *MemoryRepo, companyID, nodeID string, created time.Time) {
	t.Helper()
	repo.mu.Lock()
	defer repo.mu.Unlock()
	node, ok := repo.nodes[key(companyID, nodeID)]
	if !ok {
		t.Fatalf("node %s not found", nodeID)
	}
	node.CreatedTimestamp = created
	repo.nodes[key(companyID, nodeID)] = node
}

func mustFindInboxReadNode(t *testing.T, nodes []domain.Node, nodeID string) domain.Node {
	t.Helper()
	for _, node := range nodes {
		if node.NodeID == nodeID {
			return node
		}
	}
	t.Fatalf("node %s not found in %+v", nodeID, nodes)
	return domain.Node{}
}

func findInboxReadGate(items []WorkItemLogicGateInboxItem, logicGateID string) *WorkItemLogicGateInboxItem {
	for index := range items {
		if items[index].LogicGateID == logicGateID {
			return &items[index]
		}
	}
	return nil
}

func inboxReadRolesContain(roles []string, role string) bool {
	for _, candidate := range roles {
		if candidate == role {
			return true
		}
	}
	return false
}
