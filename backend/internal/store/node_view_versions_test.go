package store

import (
	"testing"

	"miraeopus/backend/internal/domain"
)

func requireNodeViewVersionAdvanced(t *testing.T, repo *MemoryRepo, companyID, nodeID, userID string, before NodeViewVersion) NodeViewVersion {
	t.Helper()
	after, err := repo.CurrentNodeViewVersion(companyID, nodeID, userID)
	if err != nil {
		t.Fatalf("CurrentNodeViewVersion: %v", err)
	}
	if after.Shared <= before.Shared {
		t.Fatalf("shared node view version = %d, want > %d", after.Shared, before.Shared)
	}
	return after
}

func TestMemoryNodeViewVersionCoversCanonicalSharedDependencies(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555601"
	repo.EnsureCompany(companyID, "Node View Versions Co")
	actor, err := repo.UpsertAuthUser("node-view-version-actor", "actor@example.com", "Actor")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Versioned Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	other, err := repo.CreateNode(companyID, "Related Node")
	if err != nil {
		t.Fatalf("CreateNode other: %v", err)
	}
	version, err := repo.CurrentNodeViewVersion(companyID, node.NodeID, actor.UserID)
	if err != nil {
		t.Fatalf("initial CurrentNodeViewVersion: %v", err)
	}

	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		InformationID:    "55555555-5555-4555-8555-555555555602",
		Type:             "Text box",
		Information:      "projection one",
		ActorUserID:      actor.UserID,
		ActorDisplayName: actor.DisplayName,
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor: %v", err)
	}
	version = requireNodeViewVersionAdvanced(t, repo, companyID, node.NodeID, actor.UserID, version)

	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleGenerated,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   actor.UserID,
		}},
		ActorUserID: actor.UserID,
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments: %v", err)
	}
	version = requireNodeViewVersionAdvanced(t, repo, companyID, node.NodeID, actor.UserID, version)
	view, err := repo.GetNodeView(NodeViewInput{CompanyID: companyID, NodeID: node.NodeID, UserID: actor.UserID})
	if err != nil {
		t.Fatalf("GetNodeView after GVIC mutation: %v", err)
	}
	if len(view.GVICAssignments) != 1 || view.GVICAssignments[0].PrincipalID != actor.UserID {
		t.Fatalf("node view GVIC assignments = %+v, want actor assignment", view.GVICAssignments)
	}

	if _, err := repo.CreateNodeRelationship(companyID, node.NodeID, other.NodeID, "Parent", "Child"); err != nil {
		t.Fatalf("CreateNodeRelationship: %v", err)
	}
	version = requireNodeViewVersionAdvanced(t, repo, companyID, node.NodeID, actor.UserID, version)

	accountResult, err := repo.CreateAccount(AccountInput{CompanyID: companyID, Name: "Version Account"})
	if err != nil || accountResult.Account == nil {
		t.Fatalf("CreateAccount: result=%+v err=%v", accountResult, err)
	}
	if _, err := repo.SetNodeAccountAssignments(NodeAccountAssignmentUpdateInput{
		CompanyID: companyID,
		NodeID:    node.NodeID,
		AccountIDs: []string{
			accountResult.Account.AccountID,
		},
		ActorUserID: actor.UserID,
	}); err != nil {
		t.Fatalf("SetNodeAccountAssignments: %v", err)
	}
	version = requireNodeViewVersionAdvanced(t, repo, companyID, node.NodeID, actor.UserID, version)
	if _, err := repo.UpdateAccount(AccountInput{
		CompanyID: companyID,
		AccountID: accountResult.Account.AccountID,
		Name:      "Renamed Version Account",
	}); err != nil {
		t.Fatalf("UpdateAccount: %v", err)
	}
	version = requireNodeViewVersionAdvanced(t, repo, companyID, node.NodeID, actor.UserID, version)

	logicGate, err := repo.CreateLogicGate(companyID, "Version Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	priority := 3
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusPending,
		Position:    10,
		Priority:    &priority,
		PrioritySet: true,
		ActorUserID: actor.UserID,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	version = requireNodeViewVersionAdvanced(t, repo, companyID, node.NodeID, actor.UserID, version)
	if _, err := repo.RemoveLogicGateNodeAssignment(LogicGateNodeAssignmentRemoveInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		ActorUserID: actor.UserID,
	}); err != nil {
		t.Fatalf("RemoveLogicGateNodeAssignment: %v", err)
	}
	requireNodeViewVersionAdvanced(t, repo, companyID, node.NodeID, actor.UserID, version)
}
