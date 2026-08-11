package store

import (
	"miraeopus/backend/internal/domain"
	"reflect"
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

	responsibleOnly := mustCreateInboxReadLogicGate(t, repo, companyID, "Alpha Responsible")
	accountableGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Bravo Accountable")
	consultedGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Charlie Consulted")
	informedGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Delta Informed")
	mixedPrincipalGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Echo Mixed Principals")
	otherUserGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Foxtrot Other User")
	otherCompanyGate := mustCreateInboxReadLogicGate(t, repo, otherCompanyID, "Other Company Gate")

	mustSetInboxReadLogicGateRACI(t, repo, companyID, responsibleOnly.LogicGateID, []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, UserID: user.UserID}})
	mustSetInboxReadLogicGateRACI(t, repo, companyID, accountableGate.LogicGateID, []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleAccountable, UserID: user.UserID}})
	mustSetInboxReadLogicGateRACI(t, repo, companyID, consultedGate.LogicGateID, []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleConsulted, UserID: user.UserID}})
	mustSetInboxReadLogicGateRACI(t, repo, companyID, informedGate.LogicGateID, []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleInformed, UserID: user.UserID}})
	mustSetInboxReadLogicGateRACI(t, repo, companyID, mixedPrincipalGate.LogicGateID, []LogicGateRACIAssignmentInput{
		{Role: domain.RACIRoleResponsible, UserID: otherUser.UserID},
		{Role: domain.RACIRoleAccountable, UserID: user.UserID},
	})
	mustSetInboxReadLogicGateRACI(t, repo, companyID, otherUserGate.LogicGateID, []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleAccountable, UserID: otherUser.UserID}})
	mustSetInboxReadLogicGateRACI(t, repo, otherCompanyID, otherCompanyGate.LogicGateID, []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleAccountable, UserID: user.UserID}})

	olderNode, err := repo.CreateNode(companyID, "Older assigned node")
	if err != nil {
		t.Fatalf("CreateNode older: %v", err)
	}
	mustSetInboxReadNodeRACI(t, repo, companyID, olderNode.NodeID, user.UserID)
	newerNode, err := repo.CreateNode(companyID, "Newer assigned node")
	if err != nil {
		t.Fatalf("CreateNode newer: %v", err)
	}
	mustSetInboxReadNodeRACI(t, repo, companyID, newerNode.NodeID, user.UserID)
	if _, err := repo.CreateNode(companyID, "Unassigned node"); err != nil {
		t.Fatalf("CreateNode unassigned: %v", err)
	}
	otherCompanyNode, err := repo.CreateNode(otherCompanyID, "Other company assigned node")
	if err != nil {
		t.Fatalf("CreateNode other company: %v", err)
	}
	mustSetInboxReadNodeRACI(t, repo, otherCompanyID, otherCompanyNode.NodeID, user.UserID)
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
		LogicGateID: responsibleOnly.LogicGateID,
		NodeID:      responsibleNode.NodeID,
		Status:      "in progress",
		Priority:    &responsiblePriority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus responsible: %v", err)
	}
	mustSetInboxReadNodeInherited(t, repo, companyID, responsibleNode.NodeID)
	responsibleNodes, err := repo.ListResponsibleInboxNodes(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListResponsibleInboxNodes: %v", err)
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
	if len(responsibleRead.LogicGateIDs) != 1 || responsibleRead.LogicGateIDs[0] != responsibleOnly.LogicGateID {
		t.Fatalf("responsible node logic_gate_ids = %+v, want %q", responsibleRead.LogicGateIDs, responsibleOnly.LogicGateID)
	}

	limitedResponsible, err := repo.ListResponsibleInboxNodes(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 1})
	if err != nil {
		t.Fatalf("ListResponsibleInboxNodes limited: %v", err)
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
	if findInboxReadGate(aciGates, responsibleOnly.LogicGateID) != nil {
		t.Fatalf("ACI inbox returned responsible-only gate: %+v", aciGates)
	}
	for _, gateID := range []string{accountableGate.LogicGateID, consultedGate.LogicGateID, informedGate.LogicGateID, mixedPrincipalGate.LogicGateID} {
		if findInboxReadGate(aciGates, gateID) == nil {
			t.Fatalf("ACI inbox missing gate %q: %+v", gateID, aciGates)
		}
	}
	mixedACI := findInboxReadGate(aciGates, mixedPrincipalGate.LogicGateID)
	if !reflect.DeepEqual(mixedACI.Roles, []string{domain.RACIRoleAccountable}) {
		t.Fatalf("ACI mixed-principal roles = %+v, want only Accountable", mixedACI.Roles)
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
	responsibleGateRead := findInboxReadGate(myGates, responsibleOnly.LogicGateID)
	if responsibleGateRead == nil || !inboxReadRolesContain(responsibleGateRead.Roles, domain.RACIRoleResponsible) {
		t.Fatalf("my logic gates responsible roles = %+v, want responsible gate", responsibleGateRead)
	}
	mixedMy := findInboxReadGate(myGates, mixedPrincipalGate.LogicGateID)
	if mixedMy == nil || !reflect.DeepEqual(mixedMy.Roles, []string{domain.RACIRoleAccountable}) {
		t.Fatalf("my logic gate mixed-principal roles = %+v, want only Accountable", mixedMy)
	}
	if len(mixedMy.RACIAssignments) != 2 {
		t.Fatalf("my logic gate RACI_assignments = %+v, want both source assignments", mixedMy.RACIAssignments)
	}
}

func TestMemoryRepoLogicGateRACIGroupAssignmentsIncludeSubgroups(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "33333333-3333-4333-8333-333333333333"
	repo.EnsureCompany(companyID, "Group RACI Company")

	user := mustCreateInboxReadCompanyUser(t, repo, "group-RACI-user-subject", companyID, "group-RACI@example.com", "Group RACI User")
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
	mustSetInboxReadLogicGateRACI(t, repo, companyID, responsibleGate.LogicGateID, []LogicGateRACIAssignmentInput{{
		Role:          domain.RACIRoleConsulted,
		PrincipalType: EntityPermissionSubjectGroup,
		PrincipalID:   parentGroup.GroupID,
	}})
	mustSetInboxReadLogicGateRACI(t, repo, companyID, aciGate.LogicGateID, []LogicGateRACIAssignmentInput{{
		Role:          domain.RACIRoleInformed,
		PrincipalType: EntityPermissionSubjectGroup,
		PrincipalID:   childGroup.GroupID,
	}})

	aciGates, err := repo.ListACIInboxLogicGates(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListACIInboxLogicGates: %v", err)
	}
	responsibleGateRead := findInboxReadGate(aciGates, responsibleGate.LogicGateID)
	if responsibleGateRead == nil || !inboxReadRolesContain(responsibleGateRead.Roles, domain.RACIRoleConsulted) {
		t.Fatalf("ACI gates = %+v, want parent group consulted gate", aciGates)
	}
	if len(responsibleGateRead.RACIAssignments) != 1 ||
		responsibleGateRead.RACIAssignments[0].PrincipalType != EntityPermissionSubjectGroup ||
		responsibleGateRead.RACIAssignments[0].PrincipalID != parentGroup.GroupID {
		t.Fatalf("responsible gate assignments = %+v, want configured group assignment", responsibleGateRead.RACIAssignments)
	}

	aciGateRead := findInboxReadGate(aciGates, aciGate.LogicGateID)
	if aciGateRead == nil || !inboxReadRolesContain(aciGateRead.Roles, domain.RACIRoleInformed) {
		t.Fatalf("ACI gates = %+v, want child group informed gate", aciGates)
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

func mustSetInboxReadLogicGateRACI(t *testing.T, repo *MemoryRepo, companyID, logicGateID string, assignments []LogicGateRACIAssignmentInput) {
	t.Helper()
	if _, err := repo.SetLogicGateRACIAssignments(LogicGateRACIAssignmentUpdateInput{CompanyID: companyID, LogicGateID: logicGateID, Assignments: assignments}); err != nil {
		t.Fatalf("SetLogicGateRACIAssignments %s: %v", logicGateID, err)
	}
}

func mustSetInboxReadNodeRACI(t *testing.T, repo *MemoryRepo, companyID, nodeID, userID string) {
	t.Helper()
	mustSetInboxReadResourceRACI(t, repo, companyID, EntityTypeNode, nodeID, domain.RACIRoleResponsible, userID)
}

func mustSetInboxReadNodeInherited(t *testing.T, repo *MemoryRepo, companyID, nodeID string) {
	t.Helper()
	current, err := repo.GetResourceRACIPolicy(companyID, EntityTypeNode, nodeID)
	if err != nil {
		t.Fatalf("GetResourceRACIPolicy node %s: %v", nodeID, err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: nodeID,
		AssignmentMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly,
		ExpectedRevision: current.Revision,
	}); err != nil {
		t.Fatalf("PutResourceRACIPolicy inherited node %s: %v", nodeID, err)
	}
}

func mustSetInboxReadResourceRACI(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID, role, userID string) {
	t.Helper()
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          role,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   userID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments %s %s: %v", resourceType, resourceID, err)
	}
}

func findRACIMatrixTestRow(rows []RACIMatrixProjectionRow, resourceType, resourceID string) *RACIMatrixProjectionRow {
	for index := range rows {
		row := &rows[index]
		if raciMatrixTestRowMatches(*row, resourceType, resourceID) {
			return row
		}
	}
	return nil
}

func raciMatrixTestRowMatches(row RACIMatrixProjectionRow, resourceType, resourceID string) bool {
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
