package store

import (
	"miraeopus/backend/internal/domain"
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
	multiRoleGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Echo Multi")
	otherUserGate := mustCreateInboxReadLogicGate(t, repo, companyID, "Foxtrot Other User")
	otherCompanyGate := mustCreateInboxReadLogicGate(t, repo, otherCompanyID, "Other Company Gate")

	mustSetInboxReadLogicGateRaci(t, repo, companyID, responsibleOnly.LogicGateID, []LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleResponsible, UserID: user.UserID}})
	mustSetInboxReadLogicGateRaci(t, repo, companyID, accountableGate.LogicGateID, []LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleAccountable, UserID: user.UserID}})
	mustSetInboxReadLogicGateRaci(t, repo, companyID, consultedGate.LogicGateID, []LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleConsulted, UserID: user.UserID}})
	mustSetInboxReadLogicGateRaci(t, repo, companyID, informedGate.LogicGateID, []LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleInformed, UserID: user.UserID}})
	mustSetInboxReadLogicGateRaci(t, repo, companyID, multiRoleGate.LogicGateID, []LogicGateRaciAssignmentInput{
		{Role: domain.LogicGateRaciRoleResponsible, UserID: user.UserID},
		{Role: domain.LogicGateRaciRoleAccountable, UserID: user.UserID},
	})
	mustSetInboxReadLogicGateRaci(t, repo, companyID, otherUserGate.LogicGateID, []LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleAccountable, UserID: otherUser.UserID}})
	mustSetInboxReadLogicGateRaci(t, repo, otherCompanyID, otherCompanyGate.LogicGateID, []LogicGateRaciAssignmentInput{{Role: domain.LogicGateRaciRoleAccountable, UserID: user.UserID}})

	olderNode, err := repo.CreateNodeWithAssignee(companyID, "Older assigned node", user.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee older: %v", err)
	}
	newerNode, err := repo.CreateNodeWithAssignee(companyID, "Newer assigned node", user.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee newer: %v", err)
	}
	if _, err := repo.CreateNode(companyID, "Unassigned node"); err != nil {
		t.Fatalf("CreateNode unassigned: %v", err)
	}
	if _, err := repo.CreateNodeWithAssignee(otherCompanyID, "Other company assigned node", user.UserID); err != nil {
		t.Fatalf("CreateNodeWithAssignee other company: %v", err)
	}
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
		LogicGateID: responsibleOnly.LogicGateID,
		NodeID:      responsibleNode.NodeID,
		Status:      "in progress",
		Priority:    &responsiblePriority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus responsible: %v", err)
	}
	if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: responsibleNode.NodeID, AssigneeUserIDSet: true}); err != nil {
		t.Fatalf("clear responsible node assignee: %v", err)
	}
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatalf("RebuildEffectiveResourceAccessForCompany: %v", err)
	}

	responsibleNodes, err := repo.ListResponsibleInboxNodes(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListResponsibleInboxNodes: %v", err)
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
	if len(myNodes) != 2 || mustFindInboxReadNode(t, myNodes, olderNode.NodeID).NodeID == "" {
		t.Fatalf("my nodes = %+v, want the assigned company nodes", myNodes)
	}

	aciGates, err := repo.ListACIInboxLogicGates(WorkItemInboxQuery{CompanyID: companyID, UserID: user.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListACIInboxLogicGates: %v", err)
	}
	if findInboxReadGate(aciGates, responsibleOnly.LogicGateID) != nil {
		t.Fatalf("ACI inbox returned responsible-only gate: %+v", aciGates)
	}
	for _, gateID := range []string{accountableGate.LogicGateID, consultedGate.LogicGateID, informedGate.LogicGateID, multiRoleGate.LogicGateID} {
		if findInboxReadGate(aciGates, gateID) == nil {
			t.Fatalf("ACI inbox missing gate %q: %+v", gateID, aciGates)
		}
	}
	multiACI := findInboxReadGate(aciGates, multiRoleGate.LogicGateID)
	if !inboxReadRolesContain(multiACI.Roles, domain.LogicGateRaciRoleAccountable) || inboxReadRolesContain(multiACI.Roles, domain.LogicGateRaciRoleResponsible) {
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
	responsibleGateRead := findInboxReadGate(myGates, responsibleOnly.LogicGateID)
	if responsibleGateRead == nil || !inboxReadRolesContain(responsibleGateRead.Roles, domain.LogicGateRaciRoleResponsible) {
		t.Fatalf("my logic gates responsible roles = %+v, want responsible gate", responsibleGateRead)
	}
	multiMy := findInboxReadGate(myGates, multiRoleGate.LogicGateID)
	if multiMy == nil || !inboxReadRolesContain(multiMy.Roles, domain.LogicGateRaciRoleResponsible) || !inboxReadRolesContain(multiMy.Roles, domain.LogicGateRaciRoleAccountable) {
		t.Fatalf("my logic gate multi roles = %+v, want all user RACI roles", multiMy)
	}
	if len(multiMy.RaciAssignments) != 2 {
		t.Fatalf("my logic gate raci_assignments = %+v, want existing assignments", multiMy.RaciAssignments)
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

func mustSetInboxReadLogicGateRaci(t *testing.T, repo *MemoryRepo, companyID, logicGateID string, assignments []LogicGateRaciAssignmentInput) {
	t.Helper()
	if _, err := repo.SetLogicGateRaciAssignments(LogicGateRaciAssignmentUpdateInput{CompanyID: companyID, LogicGateID: logicGateID, Assignments: assignments}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments %s: %v", logicGateID, err)
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
