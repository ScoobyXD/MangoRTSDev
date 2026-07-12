package store

import (
	"testing"
	"time"

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

func TestMemoryNodeViewReadIsPureAndAnchorCleanPreservesUnseenChanges(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555611"
	repo.EnsureCompany(companyID, "Node View Pure Read Co")
	actor, err := repo.UpsertAuthUser("node-view-pure-actor", "pure-actor@example.com", "Pure Actor")
	if err != nil {
		t.Fatalf("UpsertAuthUser actor: %v", err)
	}
	viewer, err := repo.UpsertAuthUser("node-view-pure-viewer", "pure-viewer@example.com", "Pure Viewer")
	if err != nil {
		t.Fatalf("UpsertAuthUser viewer: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Pure Read Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		InformationID:    "55555555-5555-4555-8555-555555555612",
		Type:             "Text box",
		Information:      "unseen projection",
		ActorUserID:      actor.UserID,
		ActorDisplayName: actor.DisplayName,
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor: %v", err)
	}

	before, err := repo.CurrentNodeViewVersion(companyID, node.NodeID, viewer.UserID)
	if err != nil {
		t.Fatalf("CurrentNodeViewVersion before read: %v", err)
	}
	view, err := repo.GetNodeView(NodeViewInput{CompanyID: companyID, NodeID: node.NodeID, UserID: viewer.UserID})
	if err != nil {
		t.Fatalf("GetNodeView: %v", err)
	}
	if len(view.ContentChanges) == 0 {
		t.Fatal("viewer content changes are empty, want unseen actor change")
	}
	afterRead, err := repo.CurrentNodeViewVersion(companyID, node.NodeID, viewer.UserID)
	if err != nil {
		t.Fatalf("CurrentNodeViewVersion after read: %v", err)
	}
	if afterRead != before {
		t.Fatalf("node view read changed versions from %+v to %+v", before, afterRead)
	}
	if anchored, err := repo.AnchorCleanNodeProjections(NodeProjectionAnchorInput{CompanyID: companyID, NodeID: node.NodeID, UserID: viewer.UserID}); err != nil || anchored != 0 {
		t.Fatalf("AnchorCleanNodeProjections with unseen change = %d err=%v, want 0 nil", anchored, err)
	}
	if changes, err := repo.ListUnseenNodeContentChanges(NodeContentChangeListInput{CompanyID: companyID, NodeID: node.NodeID, UserID: viewer.UserID}); err != nil || len(changes) == 0 {
		t.Fatalf("unseen changes after clean anchor = %+v err=%v, want preserved", changes, err)
	}

	if _, err := repo.MarkNodeContentChangeSeen(NodeContentChangeSeenInput{
		CompanyID: companyID,
		NodeID:    node.NodeID,
		ChangeID:  view.ContentChanges[0].ChangeID,
		UserID:    viewer.UserID,
	}); err != nil {
		t.Fatalf("MarkNodeContentChangeSeen: %v", err)
	}
	versionAfterSeen, err := repo.CurrentNodeViewVersion(companyID, node.NodeID, viewer.UserID)
	if err != nil {
		t.Fatalf("CurrentNodeViewVersion after seen: %v", err)
	}
	if versionAfterSeen.User <= afterRead.User {
		t.Fatalf("user version after seen = %d, want > %d", versionAfterSeen.User, afterRead.User)
	}
	if anchored, err := repo.AnchorCleanNodeProjections(NodeProjectionAnchorInput{CompanyID: companyID, NodeID: node.NodeID, UserID: viewer.UserID}); err != nil || anchored != 0 {
		t.Fatalf("idempotent clean anchor = %d err=%v, want 0 nil", anchored, err)
	}
}

func TestMemoryAnchorCleanUsesProjectionTimestampSoLaterOlderWallClockChangeRemainsUnseen(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555621"
	repo.EnsureCompany(companyID, "Node Anchor Ordering Co")
	actor, err := repo.UpsertAuthUser("node-anchor-order-actor", "order-actor@example.com", "Order Actor")
	if err != nil {
		t.Fatalf("UpsertAuthUser actor: %v", err)
	}
	viewer, err := repo.UpsertAuthUser("node-anchor-order-viewer", "order-viewer@example.com", "Order Viewer")
	if err != nil {
		t.Fatalf("UpsertAuthUser viewer: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Ordering Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	informationID := "55555555-5555-4555-8555-555555555622"
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "base", informationID); err != nil {
		t.Fatalf("AddNodeInformation: %v", err)
	}
	projection := repo.nodeText[key(companyID, node.NodeID)][informationID]
	projection.UpdatedTimestamp = time.Now().UTC().Add(-time.Hour)
	repo.nodeText[key(companyID, node.NodeID)][informationID] = projection
	versionBeforeAnchor, err := repo.CurrentNodeViewVersion(companyID, node.NodeID, viewer.UserID)
	if err != nil {
		t.Fatalf("CurrentNodeViewVersion before anchor: %v", err)
	}
	if anchored, err := repo.AnchorCleanNodeProjections(NodeProjectionAnchorInput{CompanyID: companyID, NodeID: node.NodeID, UserID: viewer.UserID}); err != nil || anchored != 1 {
		t.Fatalf("AnchorCleanNodeProjections = %d err=%v, want 1 nil", anchored, err)
	}
	versionAfterAnchor, err := repo.CurrentNodeViewVersion(companyID, node.NodeID, viewer.UserID)
	if err != nil {
		t.Fatalf("CurrentNodeViewVersion after anchor: %v", err)
	}
	if versionAfterAnchor != versionBeforeAnchor {
		t.Fatalf("clean anchor changed ETag versions from %+v to %+v", versionBeforeAnchor, versionAfterAnchor)
	}
	seen := repo.nodeProjectionSeen[nodeProjectionSeenKey(companyID, node.NodeID, informationID, viewer.UserID)]
	if !seen.seenAt.Equal(projection.UpdatedTimestamp) {
		t.Fatalf("anchor seen timestamp=%s, want projection timestamp=%s", seen.seenAt, projection.UpdatedTimestamp)
	}

	changeTime := projection.UpdatedTimestamp.Add(time.Minute)
	repo.mu.Lock()
	repo.recordNodeContentChangesLocked([]domain.NodeContentChange{{
		CompanyID:        companyID,
		ChangeID:         "55555555-5555-4555-8555-555555555623",
		NodeID:           node.NodeID,
		InformationID:    informationID,
		ChangeType:       NodeContentChangeAddition,
		Text:             "X",
		StartOffset:      4,
		EndOffset:        5,
		ActorUserID:      actor.UserID,
		ActorDisplayName: actor.DisplayName,
		CreatedTimestamp: changeTime,
	}})
	projection.Information = "baseX"
	projection.UpdatedTimestamp = changeTime.Add(time.Minute)
	repo.nodeText[key(companyID, node.NodeID)][informationID] = projection
	repo.mu.Unlock()

	changes, err := repo.ListUnseenNodeContentChanges(NodeContentChangeListInput{CompanyID: companyID, NodeID: node.NodeID, UserID: viewer.UserID})
	if err != nil {
		t.Fatalf("ListUnseenNodeContentChanges: %v", err)
	}
	if len(changes) != 1 || changes[0].Text != "X" {
		t.Fatalf("later committed older-wall-clock changes = %+v, want X visible", changes)
	}
}
