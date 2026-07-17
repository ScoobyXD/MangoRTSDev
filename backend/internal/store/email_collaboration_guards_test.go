package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestMemoryEmailCollaborationNodeUsesNormalWorkSemanticsAndProtectsCanonicalEmail(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000001"
	repo.EnsureCompany(companyID, "Email node company")
	creator := mustEmailCollaborationGuardUser(t, repo, companyID, "email-node-creator", "creator@example.com", domain.RoleCompanyUser)
	priority := 2
	created, err := repo.EnsureCommunicationsEmailCollaboration(CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, CreatedByUserID: creator.UserID, Priority: &priority,
		Message: domain.EmailMessageSnapshot{ID: "email-node-message", ThreadID: "email-node-thread", Subject: "Email node subject"},
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailCollaboration: %v", err)
	}
	collaboration := created.Collaboration

	reused, err := repo.EnsureCommunicationsEmailCollaboration(CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, CreatedByUserID: creator.UserID, Priority: &priority,
		Message: domain.EmailMessageSnapshot{ID: "later-reply", ThreadID: "email-node-thread", Subject: "Later reply"},
	})
	if err != nil || reused.Collaboration.NodeID != collaboration.NodeID || reused.Created {
		t.Fatalf("same-thread ensure = %+v err=%v, want existing node %s", reused, err, collaboration.NodeID)
	}

	node, err := repo.GetNode(companyID, collaboration.NodeID)
	if err != nil || node.Priority == nil || *node.Priority != priority {
		t.Fatalf("email node priority = %+v err=%v, want %d", node, err, priority)
	}
	if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: collaboration.NodeID, Title: "Renamed email node", TitleSet: true}); err != nil {
		t.Fatalf("UpdateNode email node: %v", err)
	}
	assignments, err := repo.ListResourceGVICAssignments(companyID, EntityTypeNode, collaboration.NodeID)
	if err != nil {
		t.Fatalf("ListResourceGVICAssignments: %v", err)
	}
	foundGeneratedCreator := false
	for _, assignment := range assignments {
		if assignment.Role == domain.GVICRoleGenerated && assignment.PrincipalType == EntityPermissionSubjectUser && assignment.PrincipalID == creator.UserID {
			foundGeneratedCreator = true
		}
	}
	if !foundGeneratedCreator {
		t.Fatalf("email node GVIC = %+v, want creator Generated", assignments)
	}

	canonicalID := collaboration.AttachedEmailInformationID
	beforeCanonical := emailCollaborationGuardProjectionInformation(t, repo, companyID, collaboration.NodeID, canonicalID)
	if _, err := repo.UpsertNodeProjectionWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, InformationID: canonicalID,
		Type: "Attached email", Information: `{"subject":"overwritten"}`, ActorUserID: creator.UserID,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("overwrite canonical email projection error = %v, want protected", err)
	}
	if err := repo.DeleteNodeProjection(companyID, collaboration.NodeID, canonicalID); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("DeleteNodeProjection canonical error = %v, want protected", err)
	}
	if got := emailCollaborationGuardProjectionInformation(t, repo, companyID, collaboration.NodeID, canonicalID); got != beforeCanonical {
		t.Fatalf("canonical email projection changed from %q to %q", beforeCanonical, got)
	}

	textID := NewUUIDv7String()
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, InformationID: textID,
		Type: "Text box", Information: `{"title":"Notes","document":"email work"}`, ActorUserID: creator.UserID,
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor Text box: %v", err)
	}
	if _, found := emailCollaborationGuardFindProjection(t, repo, companyID, collaboration.NodeID, textID); !found {
		t.Fatal("email node Text box projection was not persisted")
	}
	if _, err := repo.CreateNodeEditorSaveVersion(EditorSaveVersionInput{
		CompanyID: companyID, ResourceID: collaboration.NodeID, SaveKind: editorSaveKindManual, ActorUserID: creator.UserID,
	}); err != nil {
		t.Fatalf("CreateNodeEditorSaveVersion email node: %v", err)
	}

	logicGate, err := repo.CreateLogicGate(companyID, "Email work gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	assignment, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: collaboration.NodeID,
		Status: LogicGateWorkStatusPending, Priority: &priority, PrioritySet: true, ActorUserID: creator.UserID,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus email node: %v", err)
	}
	if !assignment.Card.CreatedFromEmail {
		t.Fatalf("email node card = %+v, want created_from_email", assignment.Card)
	}
	if _, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: collaboration.NodeID, Status: LogicGateWorkStatusDone,
	}); err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment email node: %v", err)
	}
	if _, err := repo.SetLogicGateNodeAssignmentIssue(LogicGateNodeAssignmentIssueInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: collaboration.NodeID, IsIssue: true,
	}); err != nil {
		t.Fatalf("SetLogicGateNodeAssignmentIssue email node: %v", err)
	}
	if _, err := repo.RemoveLogicGateNodeAssignment(LogicGateNodeAssignmentRemoveInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: collaboration.NodeID,
	}); err != nil {
		t.Fatalf("RemoveLogicGateNodeAssignment email node: %v", err)
	}
	if _, err := repo.SetNodeAccountAssignments(NodeAccountAssignmentUpdateInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, ActorUserID: creator.UserID,
	}); err != nil {
		t.Fatalf("SetNodeAccountAssignments email node: %v", err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeNode, EntityID: collaboration.NodeID,
		DefaultAccess: ResourceDefaultAccessEdit, DefaultAccessSet: true,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("SetEntityPermissions email node error = %v, want protected participant policy", err)
	}
	if err := repo.DeleteNode(companyID, collaboration.NodeID); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("DeleteNode email node error = %v, want protected canonical source", err)
	}

	folders := companyExplorerDefaultFolderIDs(companyID)
	children, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{CompanyID: companyID, ParentEntityID: folders.NodesFolderID})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows Nodes: %v", err)
	}
	row := findCompanyExplorerV2Row(children.Rows, CompanyExplorerV2EntityNode, collaboration.NodeID)
	if row == nil || row.ParentEntityID != folders.NodesFolderID {
		t.Fatalf("email node Explorer row = %+v, want Unfiled/Nodes", row)
	}
}

func mustEmailCollaborationGuardUser(t *testing.T, repo *MemoryRepo, companyID, subject, email, role string) domain.User {
	t.Helper()
	user, err := repo.UpsertAuthUser(subject, email, subject)
	if err != nil {
		t.Fatalf("UpsertAuthUser %s: %v", subject, err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, role); err != nil {
		t.Fatalf("AddCompanyMembership %s: %v", subject, err)
	}
	return user
}

func emailCollaborationGuardProjectionInformation(t *testing.T, repo *MemoryRepo, companyID, nodeID, informationID string) string {
	t.Helper()
	projection, found := emailCollaborationGuardFindProjection(t, repo, companyID, nodeID, informationID)
	if !found {
		t.Fatalf("projection %s not found", informationID)
	}
	return projection.Information
}

func emailCollaborationGuardFindProjection(t *testing.T, repo *MemoryRepo, companyID, nodeID, informationID string) (domain.NodeProjection, bool) {
	t.Helper()
	projections, err := repo.ListNodeProjections(companyID, nodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections: %v", err)
	}
	for _, projection := range projections {
		if projection.InformationID == informationID {
			return projection, true
		}
	}
	return domain.NodeProjection{}, false
}
