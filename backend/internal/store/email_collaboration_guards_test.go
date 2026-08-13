package store

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"slices"
	"testing"
)

func TestMemoryEmailRelationshipRemovalStopsWhenNodeThreadHasSharedDraft(t *testing.T) {
	repo := NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-701300000091"
	repo.EnsureCompany(companyID, "Protected email relationship")
	owner := mustEmailCollaborationGuardUser(t, repo, companyID, "protected-email-owner", "owner@example.com", domain.RoleCompanyUser)
	if _, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		GrantID: "protected-email-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	created, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "protected-message", ThreadID: "protected-thread", Subject: "Protected",
			From: []domain.EmailAddressSnapshot{{Email: "customer@example.com"}},
			To:   []domain.EmailAddressSnapshot{{Email: owner.Email}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	collaboration := created.Collaboration
	draft, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "protected-shared-draft", OriginNodeID: collaboration.NodeID,
		EmailThreadID: collaboration.EmailThreadID, SourceMessageID: collaboration.RootMessageID,
		ParticipantUserID: owner.UserID, CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID,
		IsShared: true, Kind: "reply", AccountEmail: owner.Email,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteNodeProjection(companyID, collaboration.NodeID, collaboration.AttachedEmailInformationID); !errors.Is(err, ErrEmailRelationshipHasNodeWork) {
		t.Fatalf("delete protected email relationship error = %v, want ErrEmailRelationshipHasNodeWork", err)
	}
	if _, found := emailCollaborationGuardFindProjection(t, repo, companyID, collaboration.NodeID, collaboration.AttachedEmailInformationID); !found {
		t.Fatal("blocked relationship removal changed the Node")
	}
	if err := repo.SoftDeleteCommunicationsEmailDraft(CommunicationsEmailDraftDeleteInput{
		CompanyID: companyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
		UpdatedByUserID: owner.UserID, ExpectedRevision: draft.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteNodeProjection(companyID, collaboration.NodeID, collaboration.AttachedEmailInformationID); err != nil {
		t.Fatalf("delete accidental relationship after draft discard: %v", err)
	}
}

func TestMemoryEmailRelationshipUsesOrdinaryNodePermissionsAndDeletesOnlyTheRelationship(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000001"
	repo.EnsureCompany(companyID, "Email relationship company")
	creator := mustEmailCollaborationGuardUser(t, repo, companyID, "email-node-creator", "creator@example.com", domain.RoleCompanyUser)
	created, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, Provider: "google", CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{ID: "email-node-message", ThreadID: "email-node-thread", Subject: "Email node subject"},
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailCollaboration: %v", err)
	}
	relationship := created.Collaboration
	storedThread, err := repo.GetCommunicationsEmailThread(companyID, relationship.EmailThreadID)
	if err != nil || len(storedThread.Messages) != 1 {
		t.Fatalf("GetCommunicationsEmailThread before second Node link: %+v err=%v", storedThread, err)
	}
	secondNode, err := repo.CreateNode(companyID, "Second email relationship Node")
	if err != nil {
		t.Fatalf("CreateNode second relationship host: %v", err)
	}
	secondInformationID := NewUUIDv7String()
	if _, err := repo.ImportCommunicationsEmailIntoNode(CommunicationsNodeEmailImportInput{
		CompanyID: companyID, NodeID: secondNode.NodeID, CreatedByUserID: creator.UserID, InformationID: secondInformationID,
		Thread: CommunicationsEmailThreadUpsertInput{
			CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
			AccountEmail: creator.Email, Provider: storedThread.Provider, ProviderThreadID: storedThread.ProviderThreadID,
			SelectedMessageID: storedThread.Messages[0].ProviderMessageID, Messages: []domain.EmailMessageSnapshot{storedThread.Messages[0].Message},
			HistoryComplete: true,
		},
	}); err != nil {
		t.Fatalf("ImportCommunicationsEmailIntoNode second relationship host: %v", err)
	}
	nodeIDs, err := repo.ListCommunicationsEmailThreadNodeIDs(companyID, relationship.EmailThreadID)
	if err != nil || len(nodeIDs) != 2 || !slices.Contains(nodeIDs, relationship.NodeID) || !slices.Contains(nodeIDs, secondNode.NodeID) {
		t.Fatalf("thread Node identities = %+v err=%v, want both exact Nodes", nodeIDs, err)
	}
	for _, folder := range repo.folders {
		if folder.CompanyID == companyID && folder.Name == "Nodes" {
			t.Fatalf("email collaboration created obsolete Company Explorer Nodes folder: %+v", folder)
		}
	}
	for _, item := range repo.folderItems {
		if item.CompanyID == companyID && item.ItemType == EntityTypeNode {
			t.Fatalf("email collaboration created obsolete Node placement: %+v", item)
		}
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeNode, EntityID: relationship.NodeID,
		DefaultAccess: ResourceDefaultAccessEdit, DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("ordinary Node permission update: %v", err)
	}
	textID := NewUUIDv7String()
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: relationship.NodeID, InformationID: textID,
		Type: "Text box", Information: `{"title":"Notes","document":"email work"}`, ActorUserID: creator.UserID,
	}); err != nil {
		t.Fatalf("ordinary Node content write: %v", err)
	}
	if err := repo.DeleteNodeProjection(companyID, relationship.NodeID, relationship.AttachedEmailInformationID); err != nil {
		t.Fatalf("delete email relationship: %v", err)
	}
	if _, found := emailCollaborationGuardFindProjection(t, repo, companyID, relationship.NodeID, relationship.AttachedEmailInformationID); found {
		t.Fatal("deleted email relationship still appears in Node projections")
	}
	if _, err := repo.GetNode(companyID, relationship.NodeID); err != nil {
		t.Fatalf("relationship deletion removed host Node: %v", err)
	}
	if second, err := repo.GetCommunicationsNodeEmailThread(companyID, secondNode.NodeID, relationship.EmailThreadID); err != nil || second.InformationID != secondInformationID {
		t.Fatalf("deleting Node A relationship changed Node B relationship: %+v err=%v", second, err)
	}
	nodeIDs, err = repo.ListCommunicationsEmailThreadNodeIDs(companyID, relationship.EmailThreadID)
	if err != nil || len(nodeIDs) != 1 || nodeIDs[0] != secondNode.NodeID {
		t.Fatalf("thread Node identities after isolated delete = %+v err=%v", nodeIDs, err)
	}
	thread, err := repo.GetCommunicationsEmailThread(companyID, relationship.EmailThreadID)
	if err != nil || len(thread.Messages) != 1 || thread.Messages[0].EmailMessageID == "" {
		t.Fatalf("relationship deletion changed stored email thread: %+v err=%v", thread, err)
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
