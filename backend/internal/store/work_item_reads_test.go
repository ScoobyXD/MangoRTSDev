package store

import (
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
	multiRoleGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Echo Multi")
	otherUserGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Foxtrot Other User")
	otherCompanyGate := mustCreateInboxReadLogicGate(t, repo, otherCompanyID, "Other Company Gate")

	mustSetInboxReadLogicGateGVIC(t, repo, companyID, generatedOnly.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: user.UserID}})
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, accountableGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleVerified, UserID: user.UserID}})
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, consultedGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleConsulted, UserID: user.UserID}})
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, informedGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleInformed, UserID: user.UserID}})
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, multiRoleGate.LogicGateID, []LogicGateGVICAssignmentInput{
		{Role: domain.GVICRoleGenerated, UserID: user.UserID},
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
		Status:      "done",
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
	responsibleNodes, err := repo.ListGeneratedInboxNodes(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListGeneratedInboxNodes: %v", err)
	}
	if len(responsibleNodes) != 1 || responsibleNodes[0].NodeID != responsibleNode.NodeID {
		t.Fatalf("responsible nodes = %+v, want responsible Logic Gate node", responsibleNodes)
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
	for _, gateID := range []string{accountableGate.LogicGateID, consultedGate.LogicGateID, informedGate.LogicGateID, multiRoleGate.LogicGateID} {
		if findInboxReadGate(aciGates, gateID) == nil {
			t.Fatalf("ACI inbox missing gate %q: %+v", gateID, aciGates)
		}
	}
	multiACI := findInboxReadGate(aciGates, multiRoleGate.LogicGateID)
	if !inboxReadRolesContain(multiACI.Roles, domain.GVICRoleVerified) || inboxReadRolesContain(multiACI.Roles, domain.GVICRoleGenerated) {
		t.Fatalf("ACI multi-role roles = %+v, want accountable only from the user's A/C/I roles", multiACI.Roles)
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
	multiMy := findInboxReadGate(myGates, multiRoleGate.LogicGateID)
	if multiMy == nil || !inboxReadRolesContain(multiMy.Roles, domain.GVICRoleGenerated) || !inboxReadRolesContain(multiMy.Roles, domain.GVICRoleVerified) {
		t.Fatalf("my logic gate multi roles = %+v, want all user GVIC roles", multiMy)
	}
	if len(multiMy.GVICAssignments) != 2 {
		t.Fatalf("my logic gate GVIC_assignments = %+v, want existing assignments", multiMy.GVICAssignments)
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
	responsibleNode, err := repo.CreateNode(companyID, "Parent group responsible node")
	if err != nil {
		t.Fatalf("CreateNode responsible: %v", err)
	}
	priority := 3
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: responsibleGate.LogicGateID,
		NodeID:      responsibleNode.NodeID,
		Status:      "in progress",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus responsible: %v", err)
	}

	mustSetInboxReadLogicGateGVIC(t, repo, companyID, responsibleGate.LogicGateID, []LogicGateGVICAssignmentInput{{
		Role:          domain.GVICRoleGenerated,
		PrincipalType: EntityPermissionSubjectGroup,
		PrincipalID:   parentGroup.GroupID,
	}})
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, aciGate.LogicGateID, []LogicGateGVICAssignmentInput{{
		Role:          domain.GVICRoleVerified,
		PrincipalType: EntityPermissionSubjectGroup,
		PrincipalID:   childGroup.GroupID,
	}})

	responsibleNodes, err := repo.ListGeneratedInboxNodes(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListGeneratedInboxNodes: %v", err)
	}
	if len(responsibleNodes) != 1 || responsibleNodes[0].NodeID != responsibleNode.NodeID {
		t.Fatalf("responsible nodes = %+v, want parent-group assigned node", responsibleNodes)
	}

	myGates, err := repo.ListMyLogicGates(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListMyLogicGates: %v", err)
	}
	responsibleGateRead := findInboxReadGate(myGates, responsibleGate.LogicGateID)
	if responsibleGateRead == nil || !inboxReadRolesContain(responsibleGateRead.Roles, domain.GVICRoleGenerated) {
		t.Fatalf("my gates = %+v, want parent group responsible gate", myGates)
	}
	if len(responsibleGateRead.GVICAssignments) != 1 ||
		responsibleGateRead.GVICAssignments[0].PrincipalType != EntityPermissionSubjectGroup ||
		responsibleGateRead.GVICAssignments[0].PrincipalID != parentGroup.GroupID {
		t.Fatalf("responsible gate assignments = %+v, want configured group assignment", responsibleGateRead.GVICAssignments)
	}

	aciGates, err := repo.ListACIInboxLogicGates(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListACIInboxLogicGates: %v", err)
	}
	aciGateRead := findInboxReadGate(aciGates, aciGate.LogicGateID)
	if aciGateRead == nil || !inboxReadRolesContain(aciGateRead.Roles, domain.GVICRoleVerified) {
		t.Fatalf("ACI gates = %+v, want child group accountable gate", aciGates)
	}
}

func TestMemoryRepoMyWorkMatrixRowsDuplicateAcrossActiveProjectRelationships(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "44444444-4444-4444-8444-444444444444"
	repo.EnsureCompany(companyID, "My Work Projects Company")
	user := mustCreateInboxReadCompanyUser(t, repo, "my-work-project-user", companyID, "my-work-project@example.com", "My Work Project User")

	logicGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Multi Project Gate")
	node, err := repo.CreateNode(companyID, "Done node under active project gate")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 3
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "done",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	mustSetInboxReadLogicGateGVIC(t, repo, companyID, logicGate.LogicGateID, []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: user.UserID}})

	alpha := mustCreateInboxReadProject(t, repo, companyID, "Alpha Project", "Active", user.UserID)
	bravo := mustCreateInboxReadProject(t, repo, companyID, "Bravo Project", "In Progress", user.UserID)
	doneProject := mustCreateInboxReadProject(t, repo, companyID, "Done Project", "Done", user.UserID)
	mustLinkInboxReadProjectResource(t, repo, companyID, alpha.ProjectID, EntityTypeLogicGate, logicGate.LogicGateID, 1, user.UserID)
	mustLinkInboxReadProjectResource(t, repo, companyID, bravo.ProjectID, EntityTypeLogicGate, logicGate.LogicGateID, 2, user.UserID)
	mustLinkInboxReadProjectResource(t, repo, companyID, doneProject.ProjectID, EntityTypeLogicGate, logicGate.LogicGateID, 3, user.UserID)

	rows, err := repo.ListMyWorkMatrixRows(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Limit: 1})
	if err != nil {
		t.Fatalf("ListMyWorkMatrixRows: %v", err)
	}
	assertMyWorkProjectNames(t, rows, EntityTypeLogicGate, logicGate.LogicGateID, []string{"Alpha Project", "Bravo Project"})
	assertMyWorkProjectNames(t, rows, EntityTypeNode, node.NodeID, []string{"Alpha Project", "Bravo Project"})

	matrix, err := repo.ListMyWorkMatrix(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID})
	if err != nil {
		t.Fatalf("ListMyWorkMatrix: %v", err)
	}
	cell := findMyWorkTestCell(matrix, domain.GVICRoleGenerated, 3)
	if cell == nil {
		t.Fatalf("generated priority 3 cell missing: %+v", matrix.Cells)
	}
	for _, projectName := range []string{"Alpha Project", "Bravo Project"} {
		project := findMyWorkTestTree(cell.Roots, EntityTypeProject, projectName)
		if project == nil {
			t.Fatalf("project %q missing from roots: %+v", projectName, cell.Roots)
		}
		gate := findMyWorkTestTree(project.Children, EntityTypeLogicGate, logicGate.LogicGateID)
		if gate == nil {
			t.Fatalf("logic gate missing under %q: %+v", projectName, project.Children)
		}
		if nodeTree := findMyWorkTestTree(gate.Children, EntityTypeNode, node.NodeID); nodeTree == nil {
			t.Fatalf("node missing under %q/%s: %+v", projectName, logicGate.LogicGateID, gate.Children)
		}
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
	activeProject := mustCreateInboxReadProject(t, repo, companyID, "Active Project", "Active", user.UserID)
	mustLinkInboxReadProjectResource(t, repo, companyID, activeProject.ProjectID, EntityTypeNode, activeProjectDone.NodeID, 1, user.UserID)

	doneProjectNode, err := repo.CreateNode(companyID, "Done project active node")
	if err != nil {
		t.Fatalf("CreateNode done project node: %v", err)
	}
	mustUpdateInboxReadNodeStatus(t, repo, companyID, doneProjectNode.NodeID, "In Progress", user.UserID)
	mustSetInboxReadNodeGVIC(t, repo, companyID, doneProjectNode.NodeID, user.UserID)
	doneProject := mustCreateInboxReadProject(t, repo, companyID, "Closed Project", "Done", user.UserID)
	mustLinkInboxReadProjectResource(t, repo, companyID, doneProject.ProjectID, EntityTypeNode, doneProjectNode.NodeID, 1, user.UserID)

	rows, err := repo.ListMyWorkMatrixRows(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID})
	if err != nil {
		t.Fatalf("ListMyWorkMatrixRows: %v", err)
	}
	assertMyWorkProjectNames(t, rows, EntityTypeNode, standaloneDone.NodeID, nil)
	assertMyWorkProjectNames(t, rows, EntityTypeNode, activeProjectDone.NodeID, []string{"Active Project"})
	assertMyWorkProjectNames(t, rows, EntityTypeNode, doneProjectNode.NodeID, nil)
}

func TestMemoryRepoMyWorkMatrixIncludesProjectAsFirstClassRoot(t *testing.T) {
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
	cell := findMyWorkTestCell(matrix, domain.GVICRoleVerified, 0)
	if cell == nil {
		t.Fatalf("verified no-priority cell missing: %+v", matrix.Cells)
	}
	root := findMyWorkTestTree(cell.Roots, EntityTypeProject, project.ProjectID)
	if root == nil || root.Name != "First Class Project" {
		t.Fatalf("project root = %+v, want First Class Project", root)
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
		if row.ResourceType == resourceType && row.ResourceID == resourceID {
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

func findMyWorkTestCell(matrix MyWorkMatrixResponse, role string, priority int) *MyWorkMatrixCell {
	for index := range matrix.Cells {
		cell := &matrix.Cells[index]
		gotPriority := 0
		if cell.Priority != nil {
			gotPriority = *cell.Priority
		}
		if cell.Role == role && gotPriority == priority {
			return cell
		}
	}
	return nil
}

func findMyWorkTestTree(items []MyWorkResourceTree, kind, idOrName string) *MyWorkResourceTree {
	for index := range items {
		item := &items[index]
		if item.Kind == kind && (item.ResourceID == idOrName || item.Name == idOrName) {
			return item
		}
		if child := findMyWorkTestTree(item.Children, kind, idOrName); child != nil {
			return child
		}
	}
	return nil
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
