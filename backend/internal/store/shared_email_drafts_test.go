package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"miraeopus/backend/internal/attachmentcleanup"
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
		Subject: "Seeded subject", BodyEditorHTML: "<p>seeded body</p>", ToRecipients: "seed@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	attachmentIDs := []string{newUUIDv7String(), newUUIDv7String()}
	repo.mu.Lock()
	for _, attachmentID := range attachmentIDs {
		repo.attachments[attachmentKey(companyID, attachmentID)] = domain.Attachment{
			CompanyID: companyID, AttachmentID: attachmentID, OriginalFilename: attachmentID + ".txt", CreatedTimestamp: now,
		}
		relationshipID := newUUIDv7String()
		repo.resourceAttachments[relationshipID] = domain.ResourceAttachment{
			ResourceAttachmentID: relationshipID, CompanyID: companyID, ResourceType: "email_draft", ResourceID: personal.DraftID,
			AttachmentID: attachmentID, RelationshipKind: AttachmentRelationshipFileAttachment, CreatedByUserID: owner.UserID, CreatedTimestamp: now,
		}
	}
	repo.mu.Unlock()
	nodeDraft, created, err := repo.EnsureCommunicationsEmailReplyDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, SharedResourceType: EntityTypeNode, SharedResourceID: nodeID, SharedInboxID: newUUIDv7String(), CreatedByUserID: owner.UserID,
		UpdatedByUserID: owner.UserID, SourceMessageID: sourceMessageID, BodyEditorHTML: "<p>browser value must not win</p>",
		SeedFromPersonalDraftID: personal.DraftID,
	})
	if err != nil || !created || nodeDraft.Revision != 1 || !nodeDraft.CanSend || nodeDraft.SharedInboxID != "" ||
		nodeDraft.Subject != personal.Subject || nodeDraft.BodyEditorHTML != personal.BodyEditorHTML || nodeDraft.ToRecipients != personal.ToRecipients {
		t.Fatalf("Node ensure draft=%+v created=%v err=%v", nodeDraft, created, err)
	}
	seededLinks, err := repo.ListResourceAttachments(companyID, "email_draft", nodeDraft.DraftID)
	if err != nil || len(seededLinks) != len(attachmentIDs) {
		t.Fatalf("seeded shared attachment links=%+v err=%v", seededLinks, err)
	}
	converged, created, err := repo.EnsureCommunicationsEmailReplyDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, SharedResourceType: EntityTypeNode, SharedResourceID: nodeID, CreatedByUserID: collaborator.UserID,
		UpdatedByUserID: collaborator.UserID, SourceMessageID: sourceMessageID, SeedFromPersonalDraftID: "missing-seed-is-ignored",
	})
	if err != nil || created || converged.DraftID != nodeDraft.DraftID {
		t.Fatalf("collaborator ensure draft=%+v created=%v err=%v", converged, created, err)
	}
	projectDraft, created, err := repo.EnsureCommunicationsEmailReplyDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, SharedResourceType: EntityTypeProject, SharedResourceID: projectID, CreatedByUserID: collaborator.UserID,
		UpdatedByUserID: collaborator.UserID, SourceMessageID: sourceMessageID,
	})
	if err != nil || !created || projectDraft.DraftID == nodeDraft.DraftID || projectDraft.DraftID == personal.DraftID {
		t.Fatalf("Project ensure draft=%+v created=%v err=%v", projectDraft, created, err)
	}

	ownerSummaries := mustListEmailDrafts(t, repo, CommunicationsEmailDraftListInput{
		CompanyID: companyID, SharedResourceType: EntityTypeNode, SharedResourceID: nodeID, ParticipantUserID: owner.UserID,
		Kind: "reply", SourceMessageIDs: []string{sourceMessageID},
	})
	if len(ownerSummaries) != 2 {
		t.Fatalf("owner grouped summaries=%+v, want personal plus shared", ownerSummaries)
	}
	collaboratorSummaries := mustListEmailDrafts(t, repo, CommunicationsEmailDraftListInput{
		CompanyID: companyID, SharedResourceType: EntityTypeNode, SharedResourceID: nodeID, ParticipantUserID: collaborator.UserID,
		Kind: "reply", SourceMessageIDs: []string{sourceMessageID},
	})
	if len(collaboratorSummaries) != 1 || collaboratorSummaries[0].DraftID != nodeDraft.DraftID {
		t.Fatalf("collaborator grouped summaries=%+v", collaboratorSummaries)
	}

	updated, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: nodeDraft.DraftID, SharedResourceType: EntityTypeNode, SharedResourceID: nodeID,
		UpdatedByUserID: collaborator.UserID, Kind: "reply", ExpectedRevision: 1, BodyEditorHTML: "<p>two</p>",
	})
	if err != nil || updated.Revision != 2 || updated.BodyEditorHTML != "<p>two</p>" {
		t.Fatalf("collaborator update=%+v err=%v", updated, err)
	}
	if _, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: nodeDraft.DraftID, SharedResourceType: EntityTypeNode, SharedResourceID: nodeID,
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
		CompanyID: companyID, DraftID: projectDraft.DraftID, SharedResourceType: EntityTypeProject, SharedResourceID: projectID,
		UpdatedByUserID: owner.UserID, Kind: "reply", ExpectedRevision: 1, Subject: "Project parity",
	})
	if err != nil || projectUpdated.Revision != 2 {
		t.Fatalf("Project update=%+v err=%v", projectUpdated, err)
	}

	repo.mu.Lock()
	persistentLinkID := newUUIDv7String()
	repo.resourceAttachments[persistentLinkID] = domain.ResourceAttachment{
		ResourceAttachmentID: persistentLinkID, CompanyID: companyID, ResourceType: "email_message", ResourceID: sourceMessageID,
		AttachmentID: attachmentIDs[1], RelationshipKind: AttachmentRelationshipFileAttachment, CreatedByUserID: owner.UserID, CreatedTimestamp: now,
	}
	repo.mu.Unlock()
	if err := repo.SoftDeleteCommunicationsEmailDraft(CommunicationsEmailDraftDeleteInput{
		CompanyID: companyID, DraftID: personal.DraftID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		ParticipantUserID: owner.UserID, UpdatedByUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeNode, ID: nodeID}}, owner.UserID); err != nil {
		t.Fatalf("delete shared-draft Node: %v", err)
	}
	if repo.attachments[attachmentKey(companyID, attachmentIDs[0])].DeletedTimestamp == nil || repo.attachments[attachmentKey(companyID, attachmentIDs[1])].DeletedTimestamp != nil {
		t.Fatalf("delete last-owner/multi-owner attachment state=%+v/%+v", repo.attachments[attachmentKey(companyID, attachmentIDs[0])], repo.attachments[attachmentKey(companyID, attachmentIDs[1])])
	}
	cleanupItem := attachmentcleanup.WorkItem{Kind: WorkKindOrphanAttachment(), CompanyID: companyID, AttachmentID: attachmentIDs[0]}
	work, err := repo.ListWork(context.Background(), companyID, 100)
	if err != nil || len(work) != 0 {
		t.Fatalf("recyclable attachment exposed to cleanup work=%+v err=%v", work, err)
	}
	if eligible, err := repo.Eligible(context.Background(), cleanupItem); err != nil || eligible {
		t.Fatalf("recyclable attachment cleanup eligibility=%v err=%v", eligible, err)
	}
	if err := repo.Finalize(context.Background(), cleanupItem); !errors.Is(err, attachmentcleanup.ErrStillOwned) {
		t.Fatalf("recyclable attachment finalize err=%v, want ErrStillOwned", err)
	}
	recycleItems, err := repo.ListRecycleBinItems(companyID, owner.UserID)
	if err != nil || len(recycleItems) != 1 {
		t.Fatalf("Node recycle items=%+v err=%v", recycleItems, err)
	}
	if _, err := repo.RestoreRecycleBinItems(companyID, owner.UserID, []string{recycleItems[0].RecycleBinItemID}); err != nil {
		t.Fatalf("restore shared-draft Node: %v", err)
	}
	restoredDraft := repo.emailDrafts[communicationsEmailDraftKey(companyID, nodeDraft.DraftID)]
	if restoredDraft.Revision != 3 || repo.attachments[attachmentKey(companyID, attachmentIDs[0])].DeletedTimestamp != nil || repo.attachments[attachmentKey(companyID, attachmentIDs[1])].DeletedTimestamp != nil {
		t.Fatalf("restored draft/attachments=%+v %+v %+v", restoredDraft, repo.attachments[attachmentKey(companyID, attachmentIDs[0])], repo.attachments[attachmentKey(companyID, attachmentIDs[1])])
	}
	restoredLinks, err := repo.ListResourceAttachments(companyID, "email_draft", nodeDraft.DraftID)
	if err != nil || len(restoredLinks) != len(attachmentIDs) {
		t.Fatalf("restored shared attachment links=%+v err=%v", restoredLinks, err)
	}

	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeNode, EntityID: nodeID,
		DefaultAccess: ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetCommunicationsEmailDraft(CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: nodeDraft.DraftID, SharedResourceType: EntityTypeNode, SharedResourceID: nodeID, ParticipantUserID: collaborator.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked collaborator get error=%v, want ErrNotFound", err)
	}
}

func TestMemoryBatchRecycleRestoreMergesSharedDraftsWithoutRollingBackLaterPersonalWork(t *testing.T) {
	repo, companyID, owner, _, _, _ := newEmailDraftScopeStoreFixture(t)
	thread, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		AccountEmail: "owner-a@example.com", Provider: "google", ProviderThreadID: "batch-restore-thread",
		SelectedMessageID: "batch-restore-message",
		Messages:          []domain.EmailMessageSnapshot{{ID: "batch-restore-message", ThreadID: "batch-restore-thread", Subject: "Batch restore"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	sourceMessageID := thread.Messages[0].EmailMessageID
	nodeID, projectID := newUUIDv7String(), newUUIDv7String()
	resources := []struct {
		resourceType string
		resourceID   string
	}{{EntityTypeNode, nodeID}, {EntityTypeProject, projectID}}
	now := time.Now().UTC()
	repo.mu.Lock()
	repo.nodes[key(companyID, nodeID)] = domain.Node{
		CompanyID: companyID, NodeID: nodeID, Title: "Restore Node", DefaultAccess: ResourceDefaultAccessEdit, CreatedTimestamp: now,
	}
	repo.projects[key(companyID, projectID)] = domain.Project{
		CompanyID: companyID, ProjectID: projectID, Name: "Restore Project", DefaultAccess: ResourceDefaultAccessEdit, CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	repo.nodeEmailThreads[memoryNodeEmailThreadKey(companyID, nodeID, thread.EmailThreadID)] = domain.CommunicationsNodeEmailThread{
		CompanyID: companyID, NodeID: nodeID, InformationID: newUUIDv7String(), EmailThreadID: thread.EmailThreadID, SelectedMessageID: sourceMessageID,
	}
	projectRelationshipID := newUUIDv7String()
	repo.projectEmailRelationships[memoryProjectEmailRelationshipKey(companyID, projectRelationshipID)] = memoryProjectEmailRelationship{
		CompanyID: companyID, ProjectID: projectID, RelationshipID: projectRelationshipID,
		EmailThreadID: thread.EmailThreadID, EmailMessageID: sourceMessageID, CreatedTimestamp: now,
	}
	repo.mu.Unlock()

	sharedDrafts := make([]domain.CommunicationsEmailDraft, 0, len(resources))
	sharedAttachmentIDs := make([]string, 0, len(resources))
	for _, resource := range resources {
		draft, created, err := repo.EnsureCommunicationsEmailReplyDraft(CommunicationsEmailDraftInput{
			CompanyID: companyID, SharedResourceType: resource.resourceType, SharedResourceID: resource.resourceID,
			CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, SourceMessageID: sourceMessageID,
		})
		if err != nil || !created {
			t.Fatalf("ensure shared draft for %s %s: created=%v err=%v", resource.resourceType, resource.resourceID, created, err)
		}
		attachmentID := newUUIDv7String()
		relationshipID := newUUIDv7String()
		repo.mu.Lock()
		repo.attachments[attachmentKey(companyID, attachmentID)] = domain.Attachment{
			CompanyID: companyID, AttachmentID: attachmentID, OriginalFilename: attachmentID + ".txt", CreatedTimestamp: now,
		}
		repo.resourceAttachments[relationshipID] = domain.ResourceAttachment{
			ResourceAttachmentID: relationshipID, CompanyID: companyID, ResourceType: "email_draft", ResourceID: draft.DraftID,
			AttachmentID: attachmentID, RelationshipKind: AttachmentRelationshipFileAttachment, CreatedByUserID: owner.UserID,
			CreatedTimestamp: now, ResourceRevision: draft.Revision,
		}
		repo.mu.Unlock()
		sharedDrafts = append(sharedDrafts, draft)
		sharedAttachmentIDs = append(sharedAttachmentIDs, attachmentID)
	}

	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeNode, ID: nodeID}}, owner.UserID); err != nil {
		t.Fatalf("delete Node: %v", err)
	}
	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeProject, ID: projectID}}, owner.UserID); err != nil {
		t.Fatalf("delete Project: %v", err)
	}

	personalDraftID := "draft:personal:created-after-resource-deletes"
	if _, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: personalDraftID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, Kind: "compose", AccountEmail: "owner-a@example.com", Subject: "Initial personal work",
	}); err != nil {
		t.Fatalf("create later personal draft: %v", err)
	}
	personalDraft, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: personalDraftID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, Kind: "compose", AccountEmail: "owner-a@example.com",
		Subject: "Latest personal work", BodyEditorHTML: "<p>must survive restore</p>", ExistingOnly: true,
	})
	if err != nil {
		t.Fatalf("edit later personal draft: %v", err)
	}
	personalAttachmentID := newUUIDv7String()
	personalRelationshipID := newUUIDv7String()
	repo.mu.Lock()
	repo.attachments[attachmentKey(companyID, personalAttachmentID)] = domain.Attachment{
		CompanyID: companyID, AttachmentID: personalAttachmentID, OriginalFilename: "later-personal.txt", CreatedTimestamp: now,
	}
	repo.resourceAttachments[personalRelationshipID] = domain.ResourceAttachment{
		ResourceAttachmentID: personalRelationshipID, CompanyID: companyID, ResourceType: "email_draft", ResourceID: personalDraft.DraftID,
		AttachmentID: personalAttachmentID, RelationshipKind: AttachmentRelationshipFileAttachment, CreatedByUserID: owner.UserID, CreatedTimestamp: now,
	}
	repo.mu.Unlock()

	recycleItems, err := repo.ListRecycleBinItems(companyID, owner.UserID)
	if err != nil || len(recycleItems) != len(resources) {
		t.Fatalf("recycle items=%+v err=%v", recycleItems, err)
	}
	recycleIDByResource := map[string]string{}
	for _, item := range recycleItems {
		recycleIDByResource[item.ObjectKind+":"+item.ObjectID] = item.RecycleBinItemID
	}
	restoreItemIDs := []string{
		recycleIDByResource[EntityTypeNode+":"+nodeID],
		recycleIDByResource[EntityTypeProject+":"+projectID],
	}
	forcedRestoreError := errors.New("forced recycle restore event failure")
	repo.domainEventAppendErr = forcedRestoreError
	if _, err := repo.RestoreRecycleBinItems(companyID, owner.UserID, restoreItemIDs); !errors.Is(err, forcedRestoreError) {
		t.Fatalf("forced batch restore error=%v, want %v", err, forcedRestoreError)
	}
	repo.domainEventAppendErr = nil
	if _, nodeRestored := repo.nodes[key(companyID, nodeID)]; nodeRestored {
		t.Fatal("failed batch restore leaked restored Node")
	}
	if _, projectRestored := repo.projects[key(companyID, projectID)]; projectRestored {
		t.Fatal("failed batch restore leaked restored Project")
	}
	if _, draftRestored := repo.emailDrafts[communicationsEmailDraftKey(companyID, sharedDrafts[0].DraftID)]; draftRestored {
		t.Fatal("failed batch restore leaked restored shared draft")
	}
	personalAfterFailure, err := repo.GetCommunicationsEmailDraft(CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: personalDraftID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
	})
	if err != nil || personalAfterFailure.Subject != "Latest personal work" {
		t.Fatalf("personal draft after failed batch restore=%+v err=%v", personalAfterFailure, err)
	}
	if _, err := repo.RestoreRecycleBinItems(companyID, owner.UserID, restoreItemIDs); err != nil {
		t.Fatalf("batch restore Node and Project: %v", err)
	}
	if _, ok := repo.nodes[key(companyID, nodeID)]; !ok {
		t.Fatal("batch restore did not restore Node owner")
	}
	if _, ok := repo.projects[key(companyID, projectID)]; !ok {
		t.Fatal("batch restore did not restore Project owner")
	}
	if _, ok := repo.nodeEmailThreads[memoryNodeEmailThreadKey(companyID, nodeID, thread.EmailThreadID)]; !ok {
		t.Fatal("batch restore did not restore Node email relationship")
	}
	if _, ok := repo.projectEmailRelationships[memoryProjectEmailRelationshipKey(companyID, projectRelationshipID)]; !ok {
		t.Fatal("batch restore did not restore Project email relationship")
	}

	for index, draft := range sharedDrafts {
		restored := repo.emailDrafts[communicationsEmailDraftKey(companyID, draft.DraftID)]
		if restored.DeletedTimestamp != nil || restored.Revision != draft.Revision+1 {
			t.Fatalf("restored shared draft[%d]=%+v, want revision %d", index, restored, draft.Revision+1)
		}
		links, err := repo.ListResourceAttachments(companyID, "email_draft", draft.DraftID)
		if err != nil || len(links) != 1 || links[0].ResourceRevision != restored.Revision {
			t.Fatalf("restored shared links[%d]=%+v err=%v", index, links, err)
		}
		if attachment := repo.attachments[attachmentKey(companyID, sharedAttachmentIDs[index])]; attachment.DeletedTimestamp != nil {
			t.Fatalf("restored shared attachment[%d]=%+v", index, attachment)
		}
	}
	preservedPersonal, err := repo.GetCommunicationsEmailDraft(CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: personalDraftID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
	})
	if err != nil || preservedPersonal.Subject != "Latest personal work" || preservedPersonal.BodyEditorHTML != "<p>must survive restore</p>" {
		t.Fatalf("personal draft after batch restore=%+v err=%v", preservedPersonal, err)
	}
	personalLinks, err := repo.ListResourceAttachments(companyID, "email_draft", personalDraftID)
	if err != nil || len(personalLinks) != 1 || personalLinks[0].AttachmentID != personalAttachmentID {
		t.Fatalf("personal links after batch restore=%+v err=%v", personalLinks, err)
	}
	if attachment := repo.attachments[attachmentKey(companyID, personalAttachmentID)]; attachment.DeletedTimestamp != nil {
		t.Fatalf("personal attachment after batch restore=%+v", attachment)
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
		CompanyID: companyID, SharedResourceType: EntityTypeNode, SharedResourceID: node.NodeID, SharedInboxID: inboxB.FolderID,
		CreatedByUserID: collaborator.UserID, SourceMessageID: sourceMessageID,
	})
	if err != nil || !created || draft.SharedInboxID != inboxB.FolderID || draft.CanSend {
		t.Fatalf("exact alias ensure draft=%+v created=%v err=%v", draft, created, err)
	}
	reopened, created, err := repo.EnsureCommunicationsEmailReplyDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, SharedResourceType: EntityTypeNode, SharedResourceID: node.NodeID, SharedInboxID: inboxA.FolderID,
		CreatedByUserID: collaborator.UserID, SourceMessageID: sourceMessageID,
	})
	if err != nil || created || reopened.DraftID != draft.DraftID || reopened.SharedInboxID != inboxB.FolderID || reopened.CanSend {
		t.Fatalf("alias reopen draft=%+v created=%v err=%v", reopened, created, err)
	}
}
