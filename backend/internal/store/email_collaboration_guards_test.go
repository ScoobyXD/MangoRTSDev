package store

import (
	"context"
	"miraeopus/backend/internal/domain"
	"testing"
)

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
