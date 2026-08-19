package store

import (
	"errors"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestSharedEmailDraftAttachmentMutationsUseOneRevision(t *testing.T) {
	const (
		companyID    = "11111111-1111-1111-1111-111111111111"
		nodeID       = "22222222-2222-2222-2222-222222222222"
		editorID     = "33333333-3333-3333-3333-333333333333"
		viewerID     = "44444444-4444-4444-4444-444444444444"
		attachmentID = "55555555-5555-5555-5555-555555555555"
		draftID      = "shared-draft"
	)
	repo := NewMemoryRepo()
	repo.companies[companyID] = domain.Company{CompanyID: companyID, Name: "Test"}
	repo.nodes[key(companyID, nodeID)] = domain.Node{
		CompanyID: companyID, NodeID: nodeID, Title: "Node", DefaultAccess: ResourceDefaultAccessNoAccess,
	}
	repo.memberships[membershipKey(companyID, editorID)] = domain.CompanyMembership{
		CompanyID: companyID, UserID: editorID, Role: domain.RoleCompanyAdmin,
	}
	repo.memberships[membershipKey(companyID, viewerID)] = domain.CompanyMembership{
		CompanyID: companyID, UserID: viewerID, Role: domain.RoleCompanyUser,
	}
	repo.emailDrafts[communicationsEmailDraftKey(companyID, draftID)] = domain.CommunicationsEmailDraft{
		CompanyID: companyID, DraftID: draftID, SharedNodeID: nodeID, Revision: 1, Kind: "reply",
	}
	repo.attachments[attachmentKey(companyID, attachmentID)] = domain.Attachment{
		CompanyID: companyID, AttachmentID: attachmentID, OriginalFilename: "shared.txt",
	}
	access, err := repo.GetEmailAttachmentResourceAccess(EmailAttachmentResourceAccessInput{
		CompanyID: companyID, UserID: viewerID, ResourceType: "email_draft", ResourceID: draftID, AccessLevel: EntityPermissionEdit,
	})
	if err != nil || access.Allowed {
		t.Fatalf("non-editor shared draft attachment access=%+v err=%v", access, err)
	}

	linked, err := repo.LinkResourceAttachment(ResourceAttachmentInput{
		CompanyID: companyID, ResourceType: "email_draft", ResourceID: draftID,
		AttachmentID: attachmentID, RelationshipKind: AttachmentRelationshipFileAttachment,
		CreatedByUserID: editorID, ExpectedRevision: 1,
	})
	if err != nil {
		t.Fatalf("link shared attachment: %v", err)
	}
	if linked.ResourceRevision != 2 || repo.emailDrafts[communicationsEmailDraftKey(companyID, draftID)].Revision != 2 {
		t.Fatalf("link revision=(response %d, stored %d), want 2", linked.ResourceRevision, repo.emailDrafts[communicationsEmailDraftKey(companyID, draftID)].Revision)
	}

	stale := ResourceAttachmentDeleteInput{
		CompanyID: companyID, ResourceType: "email_draft", ResourceID: draftID,
		AttachmentID: attachmentID, ActorUserID: editorID, ExpectedRevision: 1,
	}
	if err := repo.SoftDeleteResourceAttachment(stale); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale unlink error=%v, want conflict", err)
	}
	if repo.emailDrafts[communicationsEmailDraftKey(companyID, draftID)].Revision != 2 {
		t.Fatal("stale unlink changed the draft revision")
	}

	stale.ActorUserID, stale.ExpectedRevision = viewerID, 2
	if err := repo.SoftDeleteResourceAttachment(stale); !errors.Is(err, ErrConflict) {
		t.Fatalf("unauthorized unlink error=%v, want conflict", err)
	}
	stale.ActorUserID = editorID
	if err := repo.SoftDeleteResourceAttachment(stale); err != nil {
		t.Fatalf("current unlink: %v", err)
	}
	if repo.emailDrafts[communicationsEmailDraftKey(companyID, draftID)].Revision != 3 {
		t.Fatal("current unlink did not advance the draft revision once")
	}
}

func TestSharedEmailDraftDirectUploadCASRunsAtFinalize(t *testing.T) {
	const (
		companyID = "12111111-1111-4111-8111-111111111111"
		nodeID    = "12222222-2222-4222-8222-222222222222"
		editorID  = "12333333-3333-4333-8333-333333333333"
		draftID   = "shared-upload-draft"
	)
	repo := NewMemoryRepo()
	repo.companies[companyID] = domain.Company{CompanyID: companyID, Name: "Test"}
	repo.nodes[key(companyID, nodeID)] = domain.Node{CompanyID: companyID, NodeID: nodeID, Title: "Node", DefaultAccess: ResourceDefaultAccessEdit}
	repo.memberships[membershipKey(companyID, editorID)] = domain.CompanyMembership{CompanyID: companyID, UserID: editorID, Role: domain.RoleCompanyAdmin}
	repo.emailDrafts[communicationsEmailDraftKey(companyID, draftID)] = domain.CommunicationsEmailDraft{
		CompanyID: companyID, DraftID: draftID, SharedNodeID: nodeID, Revision: 1, Kind: "reply",
	}
	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	input := testAttachmentUploadIntentInput(companyID, now, domain.AttachmentUploadStrategySingle)
	input.ActorUserID, input.ResourceType, input.ResourceID, input.ExpectedRevision = editorID, "email_draft", draftID, 1
	intent, created, err := repo.CreateAttachmentUploadIntent(input)
	if err != nil || !created || intent.ResourceExpectedRevision != 1 || intent.ResourceRevision != 0 {
		t.Fatalf("create intent=(%+v,%v,%v)", intent, created, err)
	}
	if repo.emailDrafts[communicationsEmailDraftKey(companyID, draftID)].Revision != 1 {
		t.Fatal("upload intent creation advanced the draft")
	}
	if _, _, err = repo.BeginAttachmentUploadCompletion(AttachmentUploadTransitionInput{
		CompanyID: companyID, ActorUserID: editorID, UploadIntentID: intent.UploadIntentID, Now: now.Add(time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	draft := repo.emailDrafts[communicationsEmailDraftKey(companyID, draftID)]
	draft.Revision = 2
	repo.emailDrafts[communicationsEmailDraftKey(companyID, draftID)] = draft
	if _, _, err = repo.FinalizeAttachmentUpload(AttachmentUploadFinalizeInput{
		CompanyID: companyID, ActorUserID: editorID, UploadIntentID: intent.UploadIntentID, Now: now.Add(2 * time.Minute),
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale finalize error=%v, want conflict", err)
	}
	if _, exists := repo.attachments[attachmentKey(companyID, intent.AttachmentID)]; exists {
		t.Fatal("stale finalize left an unattached attachment")
	}

	input.UploadIntentID, input.AttachmentID, input.ClientRequestID = newUUIDv7String(), newUUIDv7String(), "current-upload"
	input.StorageKey, input.ExpectedRevision = "companies/test/current/original", 2
	current, _, err := repo.CreateAttachmentUploadIntent(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = repo.BeginAttachmentUploadCompletion(AttachmentUploadTransitionInput{
		CompanyID: companyID, ActorUserID: editorID, UploadIntentID: current.UploadIntentID, Now: now.Add(3 * time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	_, link, err := repo.FinalizeAttachmentUpload(AttachmentUploadFinalizeInput{
		CompanyID: companyID, ActorUserID: editorID, UploadIntentID: current.UploadIntentID, Now: now.Add(4 * time.Minute),
	})
	if err != nil || link.ResourceRevision != 3 {
		t.Fatalf("current finalize link=%+v err=%v", link, err)
	}
	_, replay, err := repo.FinalizeAttachmentUpload(AttachmentUploadFinalizeInput{
		CompanyID: companyID, ActorUserID: editorID, UploadIntentID: current.UploadIntentID, Now: now.Add(5 * time.Minute),
	})
	if err != nil || replay.ResourceRevision != 3 {
		t.Fatalf("idempotent finalize link=%+v err=%v", replay, err)
	}
}
