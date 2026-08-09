package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"testing"
	"time"
)

func TestMemorySharedEmailDraftClaimLifecycleAndImmutableIdentity(t *testing.T) {
	repo := NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-701300000211"
	repo.EnsureCompany(companyID, "Shared draft lifecycle")
	creator := mustEmailCollaborationGuardUser(t, repo, companyID, "shared-draft-creator", "owner@example.com", domain.RoleCompanyUser)
	participant := mustEmailCollaborationGuardUser(t, repo, companyID, "shared-draft-participant", "participant@example.com", domain.RoleCompanyUser)
	outsider := mustEmailCollaborationGuardUser(t, repo, companyID, "shared-draft-outsider", "outsider@example.com", domain.RoleCompanyUser)

	created, err := repo.EnsureCommunicationsEmailCollaboration(CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, Provider: "google", CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "shared-draft-source", ThreadID: "shared-draft-thread", Subject: "Source subject",
			From: []domain.EmailAddressSnapshot{{Name: "Customer", Email: "customer@example.com"}},
			To:   []domain.EmailAddressSnapshot{{Email: creator.Email}},
			Cc:   []domain.EmailAddressSnapshot{{Email: participant.Email}},
		},
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailCollaboration: %v", err)
	}
	collaboration := created.Collaboration
	if _, err := repo.AddCommunicationsEmailCollaborationParticipants(CommunicationsEmailCollaborationParticipantInput{
		CompanyID: companyID, CollaborationID: collaboration.CollaborationID,
		ActorUserID: creator.UserID, MentionedUserIDs: []string{participant.UserID},
	}); err != nil {
		t.Fatalf("AddCommunicationsEmailCollaborationParticipants: %v", err)
	}
	scheduled := collaboration.CreatedTimestamp
	if _, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "scheduled-shared-draft", CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: creator.UserID, IsShared: true, ExpectedRevision: 0,
		CreatedByUserID: creator.UserID, UpdatedByUserID: creator.UserID,
		SourceMessageID: "shared-draft-source", Subject: "Scheduled", BodyEditorHTML: "<p>Not allowed</p>",
		ScheduledSendTimestamp: &scheduled,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("scheduled shared draft error = %v, want ErrInvalid", err)
	}

	const draftID = "shared-draft-lifecycle"
	draft, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: creator.UserID, IsShared: true, ExpectedRevision: 0,
		CreatedByUserID: creator.UserID, UpdatedByUserID: creator.UserID,
		Kind: "compose", SourceMessageID: collaboration.RootMessageID,
		AccountEmail: creator.Email, ToRecipients: "customer@example.com",
		Subject: "Shared reply", BodyEditorHTML: "<p>First</p>", ReplyToMessageJSON: "{}",
	})
	if err != nil {
		t.Fatalf("create shared draft: %v", err)
	}
	if !draft.IsShared || draft.Kind != "reply" || draft.Revision != 1 ||
		draft.SourceMessageID != collaboration.RootMessageID || draft.AccountEmail != creator.Email ||
		draft.ToRecipients != "customer@example.com" {
		t.Fatalf("canonical shared draft = %+v", draft)
	}

	participantDrafts, err := repo.ListCommunicationsEmailDrafts(CommunicationsEmailDraftListInput{
		CompanyID: companyID, ParticipantUserID: participant.UserID,
	})
	if err != nil || len(participantDrafts) != 1 || participantDrafts[0].DraftID != draftID {
		t.Fatalf("participant draft list = %+v err=%v", participantDrafts, err)
	}
	mailboxDrafts, err := repo.ListCommunicationsEmailDrafts(CommunicationsEmailDraftListInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		ParticipantUserID: creator.UserID,
	})
	if err != nil || len(mailboxDrafts) != 1 || mailboxDrafts[0].DraftID != draftID {
		t.Fatalf("source mailbox universal draft list = %+v err=%v", mailboxDrafts, err)
	}

	updated, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: participant.UserID, IsShared: true, ExpectedRevision: 1,
		UpdatedByUserID: participant.UserID, Kind: "forward", SourceMessageID: "retarget-attempt",
		ToRecipients: "attacker@example.com", CcRecipients: "team@example.com",
		Subject: "Participant edit", BodyEditorHTML: "<p>Second</p>",
		ReplyToMessageJSON: "{\"id\":\"retarget-attempt\",\"thread_id\":\"other-thread\"}",
	})
	if err != nil {
		t.Fatalf("participant update: %v", err)
	}
	if updated.Revision != 2 || updated.SourceMessageID != draft.SourceMessageID ||
		updated.ReplyToMessageJSON != draft.ReplyToMessageJSON ||
		updated.ToRecipients != "attacker@example.com" || updated.CcRecipients != "team@example.com" ||
		updated.Subject != "Participant edit" || updated.BodyEditorHTML != "<p>Second</p>" {
		t.Fatalf("identity-preserving update = %+v, original=%+v", updated, draft)
	}

	reopened, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "duplicate-shared-draft", CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: creator.UserID, IsShared: true, ExpectedRevision: 0,
		CreatedByUserID: creator.UserID, UpdatedByUserID: creator.UserID,
		SourceMessageID: collaboration.RootMessageID, Subject: "Duplicate", BodyEditorHTML: "<p>Duplicate</p>",
	})
	if err != nil || reopened.DraftID != draftID || reopened.Revision != updated.Revision {
		t.Fatalf("universal draft reopen = %+v err=%v, want existing active draft", reopened, err)
	}

	_, err = repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: creator.UserID, IsShared: true, ExpectedRevision: 1,
		UpdatedByUserID: creator.UserID, Kind: "reply", SourceMessageID: draft.SourceMessageID,
		AccountEmail: creator.Email, ToRecipients: updated.ToRecipients,
		Subject: "Stale edit", BodyEditorHTML: "<p>Stale</p>", ReplyToMessageJSON: updated.ReplyToMessageJSON,
	})
	var conflict *VersionConflictError
	if !errors.As(err, &conflict) || conflict.CurrentRevision != 2 {
		t.Fatalf("stale update error = %v conflict=%+v, want current revision 2", err, conflict)
	}
	if err := repo.SoftDeleteCommunicationsEmailDraft(CommunicationsEmailDraftDeleteInput{
		CompanyID: companyID, DraftID: draftID, ParticipantUserID: creator.UserID, ExpectedRevision: 0,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("revisionless shared delete error = %v, want ErrInvalid", err)
	}

	const attachmentID = "11111111-1111-4111-8111-701300000212"
	if _, _, err := repo.CreateAttachmentWithResourceLink(AttachmentCreateInput{
		CompanyID: companyID, AttachmentID: attachmentID, OriginalFilename: "sent.txt", MimeType: "text/plain",
		ByteSize: 4, SHA256: strings.Repeat("a", 64), StorageBucket: "shared-draft-test-bucket",
		StorageKey: "companies/" + companyID + "/attachments/" + attachmentID + "/original",
		SourceKind: AttachmentSourceEmailOutgoing, ResourceLink: ResourceAttachmentInput{
			CompanyID: companyID, ResourceType: "email_draft", ResourceID: draftID, AttachmentID: attachmentID,
			RelationshipKind: AttachmentRelationshipEmailAttachment, CreatedByUserID: creator.UserID,
		},
	}); err != nil {
		t.Fatalf("create draft attachment: %v", err)
	}

	if _, err := repo.ClaimCommunicationsEmailDraftSend(CommunicationsEmailDraftSendClaimInput{
		CompanyID: companyID, DraftID: draftID, CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: outsider.UserID, ExpectedRevision: 2, ProviderGrantID: "shared-draft-test-grant",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider claim error = %v, want ErrNotFound", err)
	}
	claim, err := repo.ClaimCommunicationsEmailDraftSend(CommunicationsEmailDraftSendClaimInput{
		CompanyID: companyID, DraftID: draftID, CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: participant.UserID, ExpectedRevision: 2, ProviderGrantID: "shared-draft-test-grant",
	})
	if err != nil || claim.ClaimToken == "" || claim.IdempotencyKey == "" ||
		claim.Draft.SendState != communicationsEmailDraftSendStateSending || claim.Recovered {
		t.Fatalf("first send claim = %+v err=%v", claim, err)
	}
	if _, err := repo.ClaimCommunicationsEmailDraftSend(CommunicationsEmailDraftSendClaimInput{
		CompanyID: companyID, DraftID: draftID, CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: creator.UserID, ExpectedRevision: 2, ProviderGrantID: "shared-draft-test-grant",
	}); !errors.Is(err, ErrSendInProgress) {
		t.Fatalf("concurrent claim error = %v, want ErrSendInProgress", err)
	}
	if _, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: creator.UserID, IsShared: true, ExpectedRevision: 2,
		UpdatedByUserID: creator.UserID, Subject: "Edit while sending", BodyEditorHTML: "<p>Blocked</p>",
	}); !errors.Is(err, ErrSendInProgress) {
		t.Fatalf("update while sending error = %v, want ErrSendInProgress", err)
	}
	if err := repo.SoftDeleteCommunicationsEmailDraft(CommunicationsEmailDraftDeleteInput{
		CompanyID: companyID, DraftID: draftID, ParticipantUserID: creator.UserID, ExpectedRevision: 2,
	}); !errors.Is(err, ErrSendInProgress) {
		t.Fatalf("delete while sending error = %v, want ErrSendInProgress", err)
	}

	if err := repo.ReleaseCommunicationsEmailDraftSend(CommunicationsEmailDraftSendReleaseInput{
		CompanyID: companyID, DraftID: draftID, ClaimToken: claim.ClaimToken,
	}); err != nil {
		t.Fatalf("release claim: %v", err)
	}
	retry, err := repo.ClaimCommunicationsEmailDraftSend(CommunicationsEmailDraftSendClaimInput{
		CompanyID: companyID, DraftID: draftID, CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: creator.UserID, ExpectedRevision: 2, ProviderGrantID: "shared-draft-test-grant",
	})
	if err != nil || retry.IdempotencyKey == claim.IdempotencyKey || retry.ClaimToken == claim.ClaimToken || retry.Recovered {
		t.Fatalf("retry claim = %+v err=%v, first=%+v", retry, err, claim)
	}
	if err := repo.CompleteCommunicationsEmailDraftSend(CommunicationsEmailDraftSendCompleteInput{
		CompanyID: companyID, DraftID: draftID, CollaborationID: collaboration.CollaborationID,
		ClaimToken: retry.ClaimToken, UpdatedByUserID: participant.UserID,
		Message: domain.EmailMessageSnapshot{ID: "sent-shared-message", ThreadID: collaboration.ProviderThreadID},
	}); err != nil {
		t.Fatalf("complete send: %v", err)
	}
	sentMessageID := repo.emailDrafts[communicationsEmailDraftKey(companyID, draftID)].SentMessageID
	sentLinks, err := repo.ListResourceAttachments(companyID, "email_message", sentMessageID)
	if err != nil || len(sentLinks) != 1 || sentLinks[0].AttachmentID != attachmentID {
		t.Fatalf("sent message attachment links = %+v err=%v", sentLinks, err)
	}
	draftLinks, err := repo.ListResourceAttachments(companyID, "email_draft", draftID)
	if err != nil || len(draftLinks) != 0 {
		t.Fatalf("retired draft attachment links = %+v err=%v", draftLinks, err)
	}
	if _, err := repo.GetAttachment(companyID, attachmentID); err != nil {
		t.Fatalf("sent attachment must remain live: %v", err)
	}
	if _, err := repo.GetCommunicationsEmailDraft(CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draftID, ParticipantUserID: creator.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("finalized draft get error = %v, want ErrNotFound", err)
	}
}

func seedSharedEmailDraftRecoveryTest(t *testing.T, suffix string) (*MemoryRepo, domain.User, domain.CommunicationsEmailCollaboration, domain.CommunicationsEmailDraft) {
	t.Helper()
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-7013000004" + suffix
	repo.EnsureCompany(companyID, "Shared draft recovery")
	owner := mustEmailCollaborationGuardUser(t, repo, companyID, "shared-draft-recovery-"+suffix, "recovery-"+suffix+"@example.com", domain.RoleCompanyUser)
	ensured, err := repo.EnsureCommunicationsEmailCollaboration(CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "recovery-source-" + suffix, ThreadID: "recovery-thread-" + suffix,
			From: []domain.EmailAddressSnapshot{{Email: "customer@example.com"}},
			To:   []domain.EmailAddressSnapshot{{Email: owner.Email}},
		},
	})
	if err != nil {
		t.Fatalf("ensure recovery collaboration: %v", err)
	}
	draft, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "recovery-draft-" + suffix,
		CollaborationID: ensured.Collaboration.CollaborationID, ParticipantUserID: owner.UserID,
		IsShared: true, CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID,
		SourceMessageID: ensured.Collaboration.RootMessageID, Subject: "Recovery", BodyEditorHTML: "<p>Once</p>",
	})
	if err != nil {
		t.Fatalf("create recovery draft: %v", err)
	}
	return repo, owner, ensured.Collaboration, draft
}

func TestMemorySharedEmailDraftStaleClaimRecoveryPreservesProviderIdempotency(t *testing.T) {
	repo, owner, collaboration, draft := seedSharedEmailDraftRecoveryTest(t, "01")
	firstNow := time.Date(2026, 7, 13, 20, 0, 0, 0, time.UTC)
	claimInput := CommunicationsEmailDraftSendClaimInput{
		CompanyID: draft.CompanyID, DraftID: draft.DraftID, CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: owner.UserID, ExpectedRevision: draft.Revision, ProviderGrantID: "recovery-grant-01", Now: firstNow,
	}
	first, err := repo.ClaimCommunicationsEmailDraftSend(claimInput)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	claimInput.Now = firstNow.Add(CommunicationsEmailDraftSendClaimLease - time.Nanosecond)
	if _, err := repo.ClaimCommunicationsEmailDraftSend(claimInput); !errors.Is(err, ErrSendInProgress) {
		t.Fatalf("active lease claim error = %v, want ErrSendInProgress", err)
	}
	claimInput.Now = firstNow.Add(CommunicationsEmailDraftSendClaimLease)
	recovered, err := repo.ClaimCommunicationsEmailDraftSend(claimInput)
	if err != nil {
		t.Fatalf("recover stale claim: %v", err)
	}
	if !recovered.Recovered || recovered.ClaimToken == first.ClaimToken || recovered.IdempotencyKey != first.IdempotencyKey {
		t.Fatalf("recovered identity = %+v, first = %+v", recovered, first)
	}
	if recovered.Draft.SendIdempotencyTimestamp == nil || !recovered.Draft.SendIdempotencyTimestamp.Equal(firstNow) ||
		recovered.Draft.SendClaimedTimestamp == nil || !recovered.Draft.SendClaimedTimestamp.Equal(claimInput.Now) {
		t.Fatalf("recovered clocks = idempotency=%v claimed=%v", recovered.Draft.SendIdempotencyTimestamp, recovered.Draft.SendClaimedTimestamp)
	}
	if err := repo.CompleteCommunicationsEmailDraftSend(CommunicationsEmailDraftSendCompleteInput{
		CompanyID: draft.CompanyID, DraftID: draft.DraftID, CollaborationID: collaboration.CollaborationID,
		ClaimToken: first.ClaimToken, UpdatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{ID: "old-claim-must-not-complete", ThreadID: collaboration.ProviderThreadID},
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("superseded claim completion error = %v, want ErrNotFound", err)
	}
	if err := repo.CompleteCommunicationsEmailDraftSend(CommunicationsEmailDraftSendCompleteInput{
		CompanyID: draft.CompanyID, DraftID: draft.DraftID, CollaborationID: collaboration.CollaborationID,
		ClaimToken: recovered.ClaimToken, UpdatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{ID: "recovered-sent-message", ThreadID: collaboration.ProviderThreadID},
	}); err != nil {
		t.Fatalf("complete recovered claim: %v", err)
	}
}

func TestMemorySharedEmailDraftExpiredRecoveryCanOnlyBeDiscarded(t *testing.T) {
	repo, owner, collaboration, draft := seedSharedEmailDraftRecoveryTest(t, "02")
	firstNow := time.Date(2026, 7, 13, 21, 0, 0, 0, time.UTC)
	claimInput := CommunicationsEmailDraftSendClaimInput{
		CompanyID: draft.CompanyID, DraftID: draft.DraftID, CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: owner.UserID, ExpectedRevision: draft.Revision, ProviderGrantID: "recovery-grant-02", Now: firstNow,
	}
	first, err := repo.ClaimCommunicationsEmailDraftSend(claimInput)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	claimInput.Now = firstNow.Add(CommunicationsEmailDraftSendRecoveryWindow)
	if _, err := repo.ClaimCommunicationsEmailDraftSend(claimInput); !errors.Is(err, ErrSendRecoveryExpired) {
		t.Fatalf("expired recovery claim error = %v, want ErrSendRecoveryExpired", err)
	}
	current, err := repo.GetCommunicationsEmailDraft(CommunicationsEmailDraftGetInput{
		CompanyID: draft.CompanyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
	})
	if err != nil || current.SendState != communicationsEmailDraftSendStateSending ||
		current.SendClaimToken != first.ClaimToken || current.SendIdempotencyKey != first.IdempotencyKey {
		t.Fatalf("expired claim mutated canonical draft = %+v err=%v", current, err)
	}
	if err := repo.SoftDeleteCommunicationsEmailDraft(CommunicationsEmailDraftDeleteInput{
		CompanyID: draft.CompanyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
		ExpectedRevision: draft.Revision, UpdatedByUserID: owner.UserID,
		Now: firstNow.Add(CommunicationsEmailDraftSendClaimLease - time.Nanosecond),
	}); !errors.Is(err, ErrSendInProgress) {
		t.Fatalf("pre-expiry discard error = %v, want ErrSendInProgress", err)
	}
	if err := repo.SoftDeleteCommunicationsEmailDraft(CommunicationsEmailDraftDeleteInput{
		CompanyID: draft.CompanyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
		ExpectedRevision: draft.Revision, UpdatedByUserID: owner.UserID, Now: claimInput.Now,
	}); err != nil {
		t.Fatalf("discard expired recovery draft: %v", err)
	}
	if _, err := repo.GetCommunicationsEmailDraft(CommunicationsEmailDraftGetInput{
		CompanyID: draft.CompanyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("discarded recovery draft get error = %v, want ErrNotFound", err)
	}
}

func TestMemorySharedEmailDraftRecoveryRejectsChangedProviderGrantAndAllowsDiscard(t *testing.T) {
	repo, owner, collaboration, draft := seedSharedEmailDraftRecoveryTest(t, "03")
	firstNow := time.Date(2026, 7, 14, 2, 0, 0, 0, time.UTC)
	claimInput := CommunicationsEmailDraftSendClaimInput{
		CompanyID: draft.CompanyID, DraftID: draft.DraftID, CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: owner.UserID, ExpectedRevision: draft.Revision,
		ProviderGrantID: "original-grant", Now: firstNow,
	}
	first, err := repo.ClaimCommunicationsEmailDraftSend(claimInput)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	claimInput.ProviderGrantID = "reconnected-grant"
	claimInput.Now = firstNow.Add(CommunicationsEmailDraftSendClaimLease)
	if _, err := repo.ClaimCommunicationsEmailDraftSend(claimInput); !errors.Is(err, ErrSendRecoverySourceChanged) {
		t.Fatalf("changed-grant recovery error = %v, want ErrSendRecoverySourceChanged", err)
	}
	current, err := repo.GetCommunicationsEmailDraft(CommunicationsEmailDraftGetInput{
		CompanyID: draft.CompanyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
	})
	if err != nil || current.SendClaimToken != first.ClaimToken ||
		current.SendIdempotencyKey != first.IdempotencyKey || current.SendIdempotencyGrantID != "original-grant" {
		t.Fatalf("changed-grant claim mutated canonical draft = %+v err=%v", current, err)
	}
	if err := repo.SoftDeleteCommunicationsEmailDraft(CommunicationsEmailDraftDeleteInput{
		CompanyID: draft.CompanyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
		ExpectedRevision: draft.Revision, UpdatedByUserID: owner.UserID,
		Now: claimInput.Now,
	}); err != nil {
		t.Fatalf("discard changed-grant recovery draft: %v", err)
	}
}
