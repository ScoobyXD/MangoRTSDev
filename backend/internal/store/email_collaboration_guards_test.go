package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestMemoryEmailCollaborationCanonicalNodeGuards(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000001"
	repo.EnsureCompany(companyID, "Email collaboration guard company")
	creator := mustEmailCollaborationGuardUser(t, repo, companyID, "guard-creator", "creator@example.com", domain.RoleCompanyUser)
	other := mustEmailCollaborationGuardUser(t, repo, companyID, "guard-other", "other@example.com", domain.RoleCompanyUser)

	created, err := repo.EnsureCommunicationsEmailCollaboration(CommunicationsEmailCollaborationEnsureInput{
		CompanyID:            companyID,
		PersonalUserID:       creator.UserID,
		PersonalAccountEmail: creator.Email,
		AccountEmail:         creator.Email,
		CreatedByUserID:      creator.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "guard-message", ThreadID: "guard-thread", Subject: "Immutable email bridge",
		},
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailCollaboration: %v", err)
	}
	collaboration := created.Collaboration

	byNode, err := repo.GetCommunicationsEmailCollaborationByNode(companyID, collaboration.NodeID)
	if err != nil || byNode.CollaborationID != collaboration.CollaborationID {
		t.Fatalf("GetCommunicationsEmailCollaborationByNode = %+v err=%v", byNode, err)
	}
	if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: collaboration.NodeID, Title: "renamed", TitleSet: true}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("UpdateNode collaboration error = %v, want protected", err)
	}
	if err := repo.DeleteNode(companyID, collaboration.NodeID); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("DeleteNode collaboration error = %v, want protected", err)
	}
	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeNode, ID: collaboration.NodeID}}, creator.UserID); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("DeleteCompanyExplorerTargets collaboration error = %v, want protected", err)
	}

	canonicalID := collaboration.AttachedEmailInformationID
	beforeDetails, err := repo.GetNodeDetails(companyID, collaboration.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails before guarded content writes: %v", err)
	}
	beforeCanonical := emailCollaborationGuardProjectionInformation(t, repo, companyID, collaboration.NodeID, canonicalID)
	if _, err := repo.UpsertNodeProjectionWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, InformationID: canonicalID,
		Type: "Text block chat", Information: `{"block_id":"overwrite"}`, ActorUserID: creator.UserID,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("overwrite canonical projection error = %v, want protected", err)
	}
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, InformationID: canonicalID,
		Type: "Attached email", Information: `{"subject":"overwritten"}`, ActorUserID: creator.UserID,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("append-overwrite canonical projection error = %v, want protected", err)
	}
	arbitraryTextID := NewUUIDv7String()
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, InformationID: arbitraryTextID,
		Type: "Text box", Information: `{"content":"forbidden"}`, ActorUserID: creator.UserID,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("append arbitrary Text box error = %v, want protected", err)
	}
	afterDetails, err := repo.GetNodeDetails(companyID, collaboration.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails after guarded content writes: %v", err)
	}
	if afterDetails.InformationCount != beforeDetails.InformationCount {
		t.Fatalf("guarded information writes changed history count from %d to %d", beforeDetails.InformationCount, afterDetails.InformationCount)
	}
	if got := emailCollaborationGuardProjectionInformation(t, repo, companyID, collaboration.NodeID, canonicalID); got != beforeCanonical {
		t.Fatalf("guarded canonical writes changed projection from %q to %q", beforeCanonical, got)
	}
	if _, found := emailCollaborationGuardFindProjection(t, repo, companyID, collaboration.NodeID, arbitraryTextID); found {
		t.Fatal("guarded arbitrary Text box projection was persisted")
	}
	if err := repo.DeleteNodeProjection(companyID, collaboration.NodeID, canonicalID); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("DeleteNodeProjection canonical error = %v, want protected", err)
	}
	chatID := NewUUIDv7String()
	if _, err := repo.UpsertNodeProjectionWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, InformationID: chatID,
		Type: "Text block chat", Information: `{"block_id":"chat","content":"hello"}`, ActorUserID: creator.UserID,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("generic chat projection error = %v, want protected", err)
	}
	if _, err := repo.UpsertEmailCollaborationNodeProjectionWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, InformationID: chatID,
		Type:        CommunicationsEmailCollaborationChatInformationType,
		Information: `{"block_id":"chat","content":"hello"}`, ActorUserID: creator.UserID,
	}); err != nil {
		t.Fatalf("dedicated collaboration chat projection: %v", err)
	}
	if err := repo.DeleteNodeProjection(companyID, collaboration.NodeID, chatID); err != nil {
		t.Fatalf("DeleteNodeProjection chat: %v", err)
	}
	if _, err := repo.CreateNodeEditorSaveVersion(EditorSaveVersionInput{
		CompanyID: companyID, ResourceID: collaboration.NodeID, SaveKind: editorSaveKindManual, ActorUserID: creator.UserID,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("CreateNodeEditorSaveVersion collaboration error = %v, want protected", err)
	}
	if _, err := repo.RestoreNodeEditorSaveVersion(EditorSaveVersionRestoreInput{
		CompanyID: companyID, ResourceID: collaboration.NodeID, SaveID: NewUUIDv7String(), ActorUserID: creator.UserID,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("RestoreNodeEditorSaveVersion collaboration error = %v, want protected", err)
	}

	logicGate, err := repo.CreateLogicGate(companyID, "Guarded assignment target")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	priority := 3
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: collaboration.NodeID,
		Status: LogicGateWorkStatusPending, Priority: &priority, PrioritySet: true, ActorUserID: creator.UserID,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("AssignNodeToLogicGateStatus collaboration error = %v, want protected", err)
	}
	if _, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: collaboration.NodeID, Status: LogicGateWorkStatusDone,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("MoveLogicGateNodeAssignment collaboration error = %v, want protected", err)
	}
	if _, err := repo.SetLogicGateNodeAssignmentIssue(LogicGateNodeAssignmentIssueInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: collaboration.NodeID, IsIssue: true,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("SetLogicGateNodeAssignmentIssue collaboration error = %v, want protected", err)
	}
	if _, err := repo.RemoveLogicGateNodeAssignment(LogicGateNodeAssignmentRemoveInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: collaboration.NodeID,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("RemoveLogicGateNodeAssignment collaboration error = %v, want protected", err)
	}
	assignments, err := repo.ListNodeLogicGateAssignments(companyID, collaboration.NodeID)
	if err != nil || len(assignments) != 0 {
		t.Fatalf("collaboration Logic Gate assignments = %+v err=%v, want none", assignments, err)
	}
	guardedNode, err := repo.GetNode(companyID, collaboration.NodeID)
	if err != nil || guardedNode.Priority != nil || guardedNode.Status != nil {
		t.Fatalf("collaboration node gained work semantics = %+v err=%v", guardedNode, err)
	}

	emptyGVICSet := ResourceGVICAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: collaboration.NodeID, ActorUserID: creator.UserID,
	}
	if _, err := repo.SetResourceGVICAssignments(emptyGVICSet); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("SetResourceGVICAssignments collaboration error = %v, want protected", err)
	}
	emptyGVICCommand := ResourceGVICAssignmentCommandInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: collaboration.NodeID, ActorUserID: creator.UserID,
	}
	if _, err := repo.AddResourceGVICAssignments(emptyGVICCommand); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("AddResourceGVICAssignments collaboration error = %v, want protected", err)
	}
	if _, err := repo.RemoveResourceGVICAssignments(emptyGVICCommand); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("RemoveResourceGVICAssignments collaboration error = %v, want protected", err)
	}
	if _, err := repo.SetNodeAccountAssignments(NodeAccountAssignmentUpdateInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, ActorUserID: creator.UserID,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("SetNodeAccountAssignments collaboration error = %v, want protected", err)
	}
	if items, err := repo.ListNodeAccountAssignments(companyID, collaboration.NodeID); err != nil || len(items) != 0 {
		t.Fatalf("collaboration account assignments = %+v err=%v, want none", items, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeNode, EntityID: collaboration.NodeID,
		DefaultAccess: ResourceDefaultAccessEdit, DefaultAccessSet: true,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("SetEntityPermissions collaboration error = %v, want protected", err)
	}
	node, err := repo.GetNode(companyID, collaboration.NodeID)
	if err != nil || node.DefaultAccess != ResourceDefaultAccessNoAccess {
		t.Fatalf("collaboration node after permission replace = %+v err=%v", node, err)
	}
	permissions, err := repo.ListEntityPermissions(companyID, EntityTypeNode, collaboration.NodeID)
	if err != nil || !emailCollaborationGuardHasEditGrant(permissions, creator.UserID) {
		t.Fatalf("collaboration permissions = %+v err=%v, want creator edit", permissions, err)
	}

	folders := companyExplorerDefaultFolderIDs(companyID)
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeCompanyExplorerFolder, EntityID: folders.NodesFolderID,
		DefaultAccess: ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
		Permissions:        []EntityPermissionInput{{SubjectType: EntityPermissionSubjectUser, SubjectID: other.UserID, AccessLevel: EntityPermissionEdit}},
		ApplyToDescendants: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions Nodes folder descendants: %v", err)
	}
	if allowed, err := repo.UserHasEffectiveAccess(companyID, other.UserID, EntityTypeNode, collaboration.NodeID, EntityPermissionEdit); err != nil || allowed {
		t.Fatalf("folder descendant access for nonparticipant = %v err=%v, want false", allowed, err)
	}
	if allowed, err := repo.UserHasEffectiveAccess(companyID, creator.UserID, EntityTypeNode, collaboration.NodeID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("creator permanent edit after folder propagation = %v err=%v, want true", allowed, err)
	}

	children, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{CompanyID: companyID, ParentEntityID: folders.NodesFolderID})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows Nodes: %v", err)
	}
	var nodeRow CompanyExplorerV2Row
	for _, row := range children.Rows {
		if row.EntityType == CompanyExplorerV2EntityNode && row.ResourceID == collaboration.NodeID {
			nodeRow = row
			break
		}
	}
	if nodeRow.EdgeID == "" || nodeRow.ParentEntityID != folders.NodesFolderID {
		t.Fatalf("collaboration Explorer row = %+v children=%+v, want Unfiled/Nodes", nodeRow, children.Rows)
	}
	target, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{CompanyID: companyID, ParentEntityID: companyID, Name: "Other folder"})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder: %v", err)
	}
	if _, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{CompanyID: companyID, EdgeID: nodeRow.EdgeID, ParentEntityID: target.EntityID}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("MoveCompanyExplorerV2Edge collaboration error = %v, want protected", err)
	}
	if err := repo.DeleteCompanyExplorerV2Edge(companyID, nodeRow.EdgeID); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("DeleteCompanyExplorerV2Edge collaboration error = %v, want protected", err)
	}
	if _, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID: companyID, ParentEntityID: target.EntityID, ChildEntityType: EntityTypeNode, ChildResourceID: collaboration.NodeID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("generic node Explorer placement error = %v, want ErrInvalid", err)
	}

	ordinary, err := repo.CreateNode(companyID, "Ordinary node")
	if err != nil {
		t.Fatalf("CreateNode ordinary: %v", err)
	}
	if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: ordinary.NodeID, Title: "Ordinary renamed", TitleSet: true}); err != nil {
		t.Fatalf("UpdateNode ordinary: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{CompanyID: companyID, EntityType: EntityTypeNode, EntityID: ordinary.NodeID, DefaultAccess: ResourceDefaultAccessNoAccess, DefaultAccessSet: true}); err != nil {
		t.Fatalf("SetEntityPermissions ordinary: %v", err)
	}
	// Arrange a pre-existing ordinary Node edge directly. Generic Node edge
	// creation remains unsupported, but move/delete must not mistake an
	// ordinary legacy edge for the protected collaboration projection.
	repo.mu.Lock()
	repo.ensureCompanyExplorerV2CompanyGraphLocked(companyID)
	repo.ensureCompanyExplorerV2NativeEntityLocked(companyID, CompanyExplorerV2EntityNode, ordinary.NodeID, ordinary.Title, ordinary.CreatedTimestamp, ordinary.CreatedTimestamp)
	placedOrdinary := repo.placeEmailCollaborationNodeInDefaultFolderLocked(companyID, ordinary.NodeID)
	repo.mu.Unlock()
	if !placedOrdinary {
		t.Fatal("failed to arrange ordinary Node Explorer edge")
	}
	ordinaryChildren, err := repo.ListCompanyExplorerV2ChildRows(CompanyExplorerV2RowsQuery{CompanyID: companyID, ParentEntityID: folders.NodesFolderID})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows ordinary: %v", err)
	}
	ordinaryRow := findCompanyExplorerV2Row(ordinaryChildren.Rows, CompanyExplorerV2EntityNode, ordinary.NodeID)
	if ordinaryRow == nil || ordinaryRow.EdgeID == "" {
		t.Fatalf("ordinary Node Explorer row = %+v, want stored edge", ordinaryRow)
	}
	movedOrdinary, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: companyID, EdgeID: ordinaryRow.EdgeID, ParentEntityID: target.EntityID,
	})
	if err != nil {
		t.Fatalf("MoveCompanyExplorerV2Edge ordinary: %v", err)
	}
	if movedOrdinary.ParentEntityID != target.EntityID {
		t.Fatalf("moved ordinary Node parent = %s, want %s", movedOrdinary.ParentEntityID, target.EntityID)
	}
	if err := repo.DeleteCompanyExplorerV2Edge(companyID, movedOrdinary.EdgeID); err != nil {
		t.Fatalf("DeleteCompanyExplorerV2Edge ordinary: %v", err)
	}
	if err := repo.DeleteNode(companyID, ordinary.NodeID); err != nil {
		t.Fatalf("DeleteNode ordinary: %v", err)
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

func emailCollaborationGuardHasEditGrant(items []domain.EntityPermission, userID string) bool {
	for _, item := range items {
		if item.SubjectType == EntityPermissionSubjectUser && item.SubjectID == userID && item.AccessLevel == EntityPermissionEdit {
			return true
		}
	}
	return false
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
