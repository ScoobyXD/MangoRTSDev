package store

import (
	"errors"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestMemoryResourceSharedEmailDraftIdentityRevisionAuthorizationAndParity(t *testing.T) {
	repo, companyID, owner, collaborator, _, _ := newEmailDraftScopeStoreFixture(t)
	thread, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		AccountEmail: "owner-a@example.com", Provider: "google", ProviderThreadID: "shared-draft-thread",
		SelectedMessageID: "shared-draft-message",
		Messages:          []domain.EmailMessageSnapshot{{ID: "shared-draft-message", ThreadID: "shared-draft-thread", Subject: "Source"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	sourceMessageID := thread.Messages[0].EmailMessageID
	nodeID, projectID := newUUIDv7String(), newUUIDv7String()
	now := time.Now().UTC()
	repo.mu.Lock()
	repo.nodes[key(companyID, nodeID)] = domain.Node{CompanyID: companyID, NodeID: nodeID, Title: "Shared Node", DefaultAccess: ResourceDefaultAccessEdit, CreatedTimestamp: now}
	repo.projects[key(companyID, projectID)] = domain.Project{CompanyID: companyID, ProjectID: projectID, Name: "Shared Project", DefaultAccess: ResourceDefaultAccessEdit, CreatedTimestamp: now, UpdatedTimestamp: now}
	repo.nodeEmailThreads[memoryNodeEmailThreadKey(companyID, nodeID, thread.EmailThreadID)] = domain.CommunicationsNodeEmailThread{
		CompanyID: companyID, NodeID: nodeID, InformationID: newUUIDv7String(), EmailThreadID: thread.EmailThreadID, SelectedMessageID: sourceMessageID,
	}
	projectRelationshipID := newUUIDv7String()
	repo.projectEmailRelationships[memoryProjectEmailRelationshipKey(companyID, projectRelationshipID)] = memoryProjectEmailRelationship{
		CompanyID: companyID, ProjectID: projectID, RelationshipID: projectRelationshipID,
		EmailThreadID: thread.EmailThreadID, EmailMessageID: sourceMessageID, CreatedTimestamp: now,
	}
	repo.mu.Unlock()

	personal, _, err := repo.EnsureCommunicationsEmailReplyDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, SourceMessageID: sourceMessageID,
	})
	if err != nil {
		t.Fatal(err)
	}
	nodeDraft, created, err := repo.EnsureCommunicationsEmailReplyDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, SharedNodeID: nodeID, SharedInboxID: newUUIDv7String(), CreatedByUserID: owner.UserID,
		UpdatedByUserID: owner.UserID, SourceMessageID: sourceMessageID, BodyEditorHTML: "<p>one</p>",
	})
	if err != nil || !created || nodeDraft.Revision != 1 || !nodeDraft.CanSend || nodeDraft.SharedInboxID != "" {
		t.Fatalf("Node ensure draft=%+v created=%v err=%v", nodeDraft, created, err)
	}
	converged, created, err := repo.EnsureCommunicationsEmailReplyDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, SharedNodeID: nodeID, CreatedByUserID: collaborator.UserID,
		UpdatedByUserID: collaborator.UserID, SourceMessageID: sourceMessageID,
	})
	if err != nil || created || converged.DraftID != nodeDraft.DraftID {
		t.Fatalf("collaborator ensure draft=%+v created=%v err=%v", converged, created, err)
	}
	projectDraft, created, err := repo.EnsureCommunicationsEmailReplyDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, SharedProjectID: projectID, CreatedByUserID: collaborator.UserID,
		UpdatedByUserID: collaborator.UserID, SourceMessageID: sourceMessageID,
	})
	if err != nil || !created || projectDraft.DraftID == nodeDraft.DraftID || projectDraft.DraftID == personal.DraftID {
		t.Fatalf("Project ensure draft=%+v created=%v err=%v", projectDraft, created, err)
	}

	ownerSummaries := mustListEmailDrafts(t, repo, CommunicationsEmailDraftListInput{
		CompanyID: companyID, SharedNodeID: nodeID, ParticipantUserID: owner.UserID,
		Kind: "reply", SourceMessageIDs: []string{sourceMessageID},
	})
	if len(ownerSummaries) != 2 {
		t.Fatalf("owner grouped summaries=%+v, want personal plus shared", ownerSummaries)
	}
	collaboratorSummaries := mustListEmailDrafts(t, repo, CommunicationsEmailDraftListInput{
		CompanyID: companyID, SharedNodeID: nodeID, ParticipantUserID: collaborator.UserID,
		Kind: "reply", SourceMessageIDs: []string{sourceMessageID},
	})
	if len(collaboratorSummaries) != 1 || collaboratorSummaries[0].DraftID != nodeDraft.DraftID {
		t.Fatalf("collaborator grouped summaries=%+v", collaboratorSummaries)
	}

	updated, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: nodeDraft.DraftID, SharedNodeID: nodeID,
		UpdatedByUserID: collaborator.UserID, Kind: "reply", ExpectedRevision: 1, BodyEditorHTML: "<p>two</p>",
	})
	if err != nil || updated.Revision != 2 || updated.BodyEditorHTML != "<p>two</p>" {
		t.Fatalf("collaborator update=%+v err=%v", updated, err)
	}
	if _, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: nodeDraft.DraftID, SharedNodeID: nodeID,
		UpdatedByUserID: owner.UserID, Kind: "reply", ExpectedRevision: 1,
	}); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale update error=%v, want ErrVersionConflict", err)
	}

	ownerSend, err := repo.GetCommunicationsSharedEmailDraftForSend(CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: nodeDraft.DraftID, ParticipantUserID: owner.UserID, ExpectedRevision: 2,
	})
	if err != nil || !ownerSend.CanSend {
		t.Fatalf("owner send preflight=%+v err=%v", ownerSend, err)
	}
	collaboratorSend, err := repo.GetCommunicationsSharedEmailDraftForSend(CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: nodeDraft.DraftID, ParticipantUserID: collaborator.UserID, ExpectedRevision: 2,
	})
	if err != nil || collaboratorSend.CanSend {
		t.Fatalf("collaborator send preflight=%+v err=%v", collaboratorSend, err)
	}
	projectUpdated, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: projectDraft.DraftID, SharedProjectID: projectID,
		UpdatedByUserID: owner.UserID, Kind: "reply", ExpectedRevision: 1, Subject: "Project parity",
	})
	if err != nil || projectUpdated.Revision != 2 {
		t.Fatalf("Project update=%+v err=%v", projectUpdated, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeNode, EntityID: nodeID,
		DefaultAccess: ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetCommunicationsEmailDraft(CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: nodeDraft.DraftID, SharedNodeID: nodeID, ParticipantUserID: collaborator.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked collaborator get error=%v, want ErrNotFound", err)
	}
}

func TestMemorySharedEmailDraftUsesExactInboxAlias(t *testing.T) {
	repo, companyID, _, collaborator, _, _ := newEmailDraftScopeStoreFixture(t)
	if _, err := repo.UpsertCompanyEmailConnection(CompanyEmailConnectionInput{
		CompanyID: companyID, Provider: "google", AccountEmail: "alias@example.com", GrantID: "alias-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	inboxA, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Alias A", "alias@example.com")
	if err != nil {
		t.Fatal(err)
	}
	inboxB, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Alias B", "alias@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if inboxA.CompanyEmailConnectionID == "" || inboxA.CompanyEmailConnectionID != inboxB.CompanyEmailConnectionID {
		t.Fatalf("inboxes do not share one connection: A=%+v B=%+v", inboxA, inboxB)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeSharedInbox, EntityID: inboxB.FolderID,
		DefaultAccess: ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
	}); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Alias Node")
	if err != nil {
		t.Fatal(err)
	}
	imported, err := repo.ImportCommunicationsEmailIntoNode(CommunicationsNodeEmailImportInput{
		CompanyID: companyID, NodeID: node.NodeID, CreatedByUserID: collaborator.UserID,
		Thread: CommunicationsEmailThreadUpsertInput{
			CompanyID: companyID, SharedInboxID: inboxA.FolderID, AccountEmail: "alias@example.com", Provider: "google",
			ProviderThreadID: "alias-thread", SelectedMessageID: "alias-message",
			Messages: []domain.EmailMessageSnapshot{{ID: "alias-message", ThreadID: "alias-thread", Subject: "Alias"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	sourceMessageID := imported.EmailThread.Messages[0].EmailMessageID
	draft, created, err := repo.EnsureCommunicationsEmailReplyDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, SharedNodeID: node.NodeID, SharedInboxID: inboxB.FolderID,
		CreatedByUserID: collaborator.UserID, SourceMessageID: sourceMessageID,
	})
	if err != nil || !created || draft.SharedInboxID != inboxB.FolderID || draft.CanSend {
		t.Fatalf("exact alias ensure draft=%+v created=%v err=%v", draft, created, err)
	}
	reopened, created, err := repo.EnsureCommunicationsEmailReplyDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, SharedNodeID: node.NodeID, SharedInboxID: inboxA.FolderID,
		CreatedByUserID: collaborator.UserID, SourceMessageID: sourceMessageID,
	})
	if err != nil || created || reopened.DraftID != draft.DraftID || reopened.SharedInboxID != inboxB.FolderID || reopened.CanSend {
		t.Fatalf("alias reopen draft=%+v created=%v err=%v", reopened, created, err)
	}
}
