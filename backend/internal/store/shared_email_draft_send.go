package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"net/mail"
	"strings"
	"time"
)

const (
	communicationsEmailDraftSendStateDraft   = "draft"
	communicationsEmailDraftSendStateSending = "sending"
	communicationsEmailDraftSendStateSent    = "sent"

	// A claim is exclusive while its short lease is active. A stale claimant
	// may take it over only while Nylas still guarantees that replaying the
	// exact idempotency key cannot create a second delivery.
	CommunicationsEmailDraftSendClaimLease     = 5 * time.Minute
	CommunicationsEmailDraftSendRecoveryWindow = time.Hour
)

func completedEmailMessagePromotesAttachments(message domain.EmailMessageSnapshot) bool {
	if !message.DownloadComplete || len(message.Attachments) == 0 {
		return false
	}
	for _, attachment := range message.Attachments {
		if cleanUUIDText(attachment.AttachmentID) == "" {
			return false
		}
	}
	return true
}

func mergeStoredCompleteEmailMessageAttachments(thread domain.CommunicationsEmailThread, message domain.EmailMessageSnapshot) domain.EmailMessageSnapshot {
	var stored domain.EmailMessageSnapshot
	for _, candidate := range thread.Messages {
		if strings.TrimSpace(candidate.ProviderMessageID) == strings.TrimSpace(message.ID) && candidate.Message.DownloadComplete {
			stored = candidate.Message
			break
		}
	}
	if strings.TrimSpace(stored.ID) == "" || len(stored.Attachments) == 0 {
		return message
	}
	// The send snapshot owns promoted local IDs; stored provider imports only fill its gaps.
	message.Attachments = mergeEmailAttachmentSnapshots(stored.Attachments, message.Attachments, false)
	if len(message.Attachments) > 0 && emailAttachmentSnapshotsHaveMangoIDs(message.Attachments) {
		message.DownloadComplete = true
	}
	return message
}

func versionConflict(currentRevision int64) error {
	return &VersionConflictError{CurrentRevision: currentRevision}
}

func canonicalSharedEmailDraftInput(input CommunicationsEmailDraftInput, collaboration domain.CommunicationsEmailCollaboration) (CommunicationsEmailDraftInput, error) {
	if input.ScheduledSendTimestamp != nil {
		return CommunicationsEmailDraftInput{}, ErrInvalid
	}
	source := collaboration.Message
	requestedSourceMessageID := strings.TrimSpace(input.SourceMessageID)
	if requestedSourceMessageID != "" && requestedSourceMessageID != strings.TrimSpace(source.EmailMessageID) {
		if err := json.Unmarshal([]byte(strings.TrimSpace(input.ReplyToMessageJSON)), &source); err != nil {
			return CommunicationsEmailDraftInput{}, ErrInvalid
		}
	}
	sourceEmailMessageID := strings.TrimSpace(source.EmailMessageID)
	providerSourceMessageID := strings.TrimSpace(source.ID)
	if requestedSourceMessageID != "" && sourceEmailMessageID != requestedSourceMessageID {
		return CommunicationsEmailDraftInput{}, ErrInvalid
	}
	if sourceEmailMessageID == "" || providerSourceMessageID == "" {
		return CommunicationsEmailDraftInput{}, ErrInvalid
	}
	providerThreadID := strings.TrimSpace(collaboration.ProviderThreadID)
	if providerThreadID != "" {
		if strings.TrimSpace(source.ThreadID) != providerThreadID {
			return CommunicationsEmailDraftInput{}, ErrInvalid
		}
	} else if sourceEmailMessageID != strings.TrimSpace(collaboration.RootMessageID) &&
		sourceEmailMessageID != strings.TrimSpace(collaboration.LatestMessageID) &&
		sourceEmailMessageID != strings.TrimSpace(collaboration.Message.EmailMessageID) {
		return CommunicationsEmailDraftInput{}, ErrInvalid
	}
	toRecipients, ccRecipients := canonicalSharedEmailDraftReplyAllEnvelope(source, collaboration.AccountEmail)
	if input.ExpectedRevision == 0 && strings.TrimSpace(input.ToRecipients) == "" && strings.TrimSpace(input.CcRecipients) == "" {
		input.ToRecipients, input.CcRecipients = toRecipients, ccRecipients
	}
	if strings.TrimSpace(input.ToRecipients) == "" && strings.TrimSpace(input.CcRecipients) == "" {
		return CommunicationsEmailDraftInput{}, ErrInvalid
	}
	replyToMessage, err := json.Marshal(source)
	if err != nil {
		return CommunicationsEmailDraftInput{}, err
	}
	input.PersonalUserID = collaboration.PersonalUserID
	input.PersonalAccountEmail = collaboration.PersonalAccountEmail
	input.SharedInboxID = collaboration.SharedInboxID
	if normalizeEmail(input.AccountEmail) == "" {
		input.AccountEmail = collaboration.AccountEmail
	}
	input.Kind = "reply"
	input.SourceMessageID = sourceEmailMessageID
	input.ReplyToMessageJSON = string(replyToMessage)
	input.ScheduledSendTimestamp = nil
	return input, nil
}

func sharedEmailDraftContextForThread(thread domain.CommunicationsEmailThread, sourceMessageID string) (domain.CommunicationsEmailCollaboration, error) {
	sourceMessageID = strings.TrimSpace(sourceMessageID)
	var source domain.EmailMessageSnapshot
	for _, stored := range thread.Messages {
		if strings.TrimSpace(stored.EmailMessageID) == sourceMessageID {
			source = stored.Message
			source.EmailMessageID = stored.EmailMessageID
			break
		}
	}
	if strings.TrimSpace(source.EmailMessageID) == "" || strings.TrimSpace(source.ID) == "" {
		return domain.CommunicationsEmailCollaboration{}, ErrNotFound
	}
	rootMessageID, latestMessageID := source.EmailMessageID, source.EmailMessageID
	if len(thread.Messages) > 0 {
		rootMessageID = thread.Messages[0].EmailMessageID
		latestMessageID = thread.Messages[len(thread.Messages)-1].EmailMessageID
	}
	return domain.CommunicationsEmailCollaboration{
		CompanyID: thread.CompanyID, ScopeType: thread.ScopeType,
		PersonalUserID: thread.PersonalUserID, PersonalAccountEmail: thread.PersonalAccountEmail,
		SharedInboxID: thread.SharedInboxID, AccountEmail: thread.AccountEmail,
		Provider: thread.Provider, ProviderThreadID: thread.ProviderThreadID,
		EmailThreadID: thread.EmailThreadID, RootMessageID: rootMessageID,
		LatestMessageID: latestMessageID, Message: source,
	}, nil
}
func preserveSharedEmailDraftIdentity(input *domain.CommunicationsEmailDraft, existing domain.CommunicationsEmailDraft) {
	input.AccountEmail = existing.AccountEmail
	input.Kind = existing.Kind
	input.SourceMessageID = existing.SourceMessageID
	input.EmailThreadID = existing.EmailThreadID
	input.OriginNodeID = existing.OriginNodeID
	input.ReplyToMessageJSON = existing.ReplyToMessageJSON
	input.ScheduledSendTimestamp = nil
}

func CanonicalCommunicationsEmailReplyAllEnvelope(message domain.EmailMessageSnapshot, accountEmail string) (string, string) {
	return canonicalSharedEmailDraftReplyAllEnvelope(message, accountEmail)
}

func canonicalSharedEmailDraftReplyAllEnvelope(message domain.EmailMessageSnapshot, accountEmail string) (string, string) {
	accountEmail = normalizeEmail(accountEmail)
	seen := map[string]bool{}
	to := make([]string, 0)
	cc := make([]string, 0)
	appendAddress := func(target *[]string, address domain.EmailAddressSnapshot) {
		email := normalizeEmail(address.Email)
		if email == "" || email == accountEmail || seen[email] {
			return
		}
		seen[email] = true
		*target = append(*target, (&mail.Address{Name: strings.TrimSpace(address.Name), Address: email}).String())
	}
	replyTargets := message.ReplyTo
	if len(replyTargets) == 0 {
		replyTargets = message.From
	}
	for _, address := range replyTargets {
		appendAddress(&to, address)
	}
	for _, address := range message.To {
		appendAddress(&to, address)
	}
	for _, address := range message.Cc {
		appendAddress(&cc, address)
	}
	return strings.Join(to, ", "), strings.Join(cc, ", ")
}

func sharedEmailDraftSendIdempotencyKey() string {
	return "mangorts-shared-draft-send-" + newUUIDv7String()
}

func sharedEmailDraftSendClaimNow(now time.Time) time.Time {
	if now.IsZero() {
		return time.Now().UTC()
	}
	return now.UTC()
}

func sharedEmailDraftSendClaimActive(draft domain.CommunicationsEmailDraft, now time.Time) bool {
	return draft.SendClaimedTimestamp != nil &&
		now.Before(draft.SendClaimedTimestamp.Add(CommunicationsEmailDraftSendClaimLease))
}

func sharedEmailDraftSendRecoveryExpired(draft domain.CommunicationsEmailDraft, now time.Time) bool {
	if draft.SendState != communicationsEmailDraftSendStateSending || sharedEmailDraftSendClaimActive(draft, now) {
		return false
	}
	idempotencyTimestamp := draft.SendIdempotencyTimestamp
	if idempotencyTimestamp == nil {
		idempotencyTimestamp = draft.SendClaimedTimestamp
	}
	return strings.TrimSpace(draft.SendIdempotencyKey) == "" || idempotencyTimestamp == nil ||
		!now.Before(idempotencyTimestamp.Add(CommunicationsEmailDraftSendRecoveryWindow))
}

func sharedEmailDraftSendSourceChanged(draft domain.CommunicationsEmailDraft, providerGrantID string) bool {
	providerGrantID = strings.TrimSpace(providerGrantID)
	if providerGrantID == "" {
		return false
	}
	return strings.TrimSpace(draft.SendIdempotencyGrantID) == "" || draft.SendIdempotencyGrantID != providerGrantID
}

// claimSharedEmailDraftSend applies the common Memory/Postgres state machine.
// Recovered claims always get a new repository token but preserve the original
// provider idempotency key and its first-use clock.
func claimSharedEmailDraftSend(draft domain.CommunicationsEmailDraft, providerGrantID string, now time.Time) (domain.CommunicationsEmailDraft, error) {
	now = sharedEmailDraftSendClaimNow(now)
	providerGrantID = strings.TrimSpace(providerGrantID)
	if providerGrantID == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	switch draft.SendState {
	case "", communicationsEmailDraftSendStateDraft:
		// A draft-state row has no uncertain provider outcome. Never carry a
		// cached rejected/legacy key into a fresh logical attempt.
		draft.SendIdempotencyKey = ""
		draft.SendIdempotencyGrantID = ""
		draft.SendIdempotencyTimestamp = nil
	case communicationsEmailDraftSendStateSending:
		if draft.SendClaimedRevision != draft.Revision {
			return domain.CommunicationsEmailDraft{}, ErrSendInProgress
		}
		if sharedEmailDraftSendClaimActive(draft, now) {
			return domain.CommunicationsEmailDraft{}, ErrSendInProgress
		}
		if sharedEmailDraftSendSourceChanged(draft, providerGrantID) {
			return domain.CommunicationsEmailDraft{}, ErrSendRecoverySourceChanged
		}
		idempotencyTimestamp := draft.SendIdempotencyTimestamp
		// Compatibility for a claim written during a rolling deployment after
		// the key existed but before its dedicated origin column did.
		if idempotencyTimestamp == nil {
			idempotencyTimestamp = draft.SendClaimedTimestamp
		}
		if sharedEmailDraftSendRecoveryExpired(draft, now) {
			return domain.CommunicationsEmailDraft{}, ErrSendRecoveryExpired
		}
		draft.SendIdempotencyTimestamp = idempotencyTimestamp
	default:
		return domain.CommunicationsEmailDraft{}, ErrNotFound
	}

	idempotencyKey := strings.TrimSpace(draft.SendIdempotencyKey)
	if idempotencyKey == "" {
		idempotencyKey = sharedEmailDraftSendIdempotencyKey()
	}
	if draft.SendIdempotencyTimestamp == nil {
		idempotencyTimestamp := now
		draft.SendIdempotencyTimestamp = &idempotencyTimestamp
	}
	claimedTimestamp := now
	draft.SendState = communicationsEmailDraftSendStateSending
	draft.SendClaimToken = newUUIDv7String()
	draft.SendIdempotencyKey = idempotencyKey
	draft.SendIdempotencyGrantID = providerGrantID
	draft.SendClaimedRevision = draft.Revision
	draft.SendClaimedTimestamp = &claimedTimestamp
	return draft, nil
}

func (r *MemoryRepo) ClaimCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendClaimInput) (CommunicationsEmailDraftSendClaim, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	collaborationID := strings.TrimSpace(input.CollaborationID)
	participantUserID := strings.TrimSpace(input.ParticipantUserID)
	if companyID == "" || draftID == "" || participantUserID == "" || input.ExpectedRevision <= 0 {
		return CommunicationsEmailDraftSendClaim{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	draftKey := communicationsEmailDraftKey(companyID, draftID)
	draft, ok := r.emailDrafts[draftKey]
	authorized := collaborationID != "" && r.isSharedEmailDraftParticipantLocked(draft, participantUserID)
	if collaborationID != "" {
		authorized = authorized && draft.CollaborationID == collaborationID
	} else if strings.TrimSpace(input.SharedInboxID) != "" {
		authorized = draft.ScopeType == CommunicationsEmailCollaborationScopeShared && draft.SharedInboxID == cleanUUIDText(input.SharedInboxID)
	} else {
		authorized = draft.ScopeType == CommunicationsEmailCollaborationScopePersonal &&
			draft.PersonalUserID == cleanUUIDText(input.PersonalUserID) &&
			draft.PersonalAccountEmail == normalizeEmail(input.PersonalAccountEmail)
	}
	if !ok || draft.DeletedTimestamp != nil || !draft.IsShared || !authorized {
		return CommunicationsEmailDraftSendClaim{}, ErrNotFound
	}
	if draft.Revision != input.ExpectedRevision {
		return CommunicationsEmailDraftSendClaim{}, versionConflict(draft.Revision)
	}
	recovered := draft.SendState == communicationsEmailDraftSendStateSending
	draft, err := claimSharedEmailDraftSend(draft, input.ProviderGrantID, input.Now)
	if err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	r.emailDrafts[draftKey] = draft
	return CommunicationsEmailDraftSendClaim{
		Draft: draft, ClaimToken: draft.SendClaimToken, IdempotencyKey: draft.SendIdempotencyKey,
		Recovered: recovered,
	}, nil
}

func (r *MemoryRepo) ReleaseCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendReleaseInput) error {
	companyID := strings.TrimSpace(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	claimToken := strings.TrimSpace(input.ClaimToken)
	if companyID == "" || draftID == "" || claimToken == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	draftKey := communicationsEmailDraftKey(companyID, draftID)
	draft, ok := r.emailDrafts[draftKey]
	if !ok || draft.DeletedTimestamp != nil || draft.SendState != communicationsEmailDraftSendStateSending || draft.SendClaimToken != claimToken {
		return ErrNotFound
	}
	draft.SendState = communicationsEmailDraftSendStateDraft
	draft.SendClaimToken = ""
	draft.SendIdempotencyKey = ""
	draft.SendIdempotencyGrantID = ""
	draft.SendIdempotencyTimestamp = nil
	draft.SendClaimedRevision = 0
	draft.SendClaimedTimestamp = nil
	r.emailDrafts[draftKey] = draft
	return nil
}

func (r *MemoryRepo) CompleteCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendCompleteInput) error {
	companyID := cleanUUIDText(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	collaborationID := cleanUUIDText(input.CollaborationID)
	claimToken := strings.TrimSpace(input.ClaimToken)
	updatedByUserID := cleanUUIDText(input.UpdatedByUserID)
	message := normalizeEmailMessageSnapshot(input.Message)
	if companyID == "" || draftID == "" || claimToken == "" || message.ID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	draftKey := communicationsEmailDraftKey(companyID, draftID)
	draft, ok := r.emailDrafts[draftKey]
	if !ok || draft.DeletedTimestamp != nil || !draft.IsShared ||
		(collaborationID != "" && draft.CollaborationID != collaborationID) ||
		draft.SendState != communicationsEmailDraftSendStateSending ||
		draft.SendClaimToken != claimToken ||
		draft.SendClaimedRevision != draft.Revision {
		return ErrNotFound
	}
	storedThread, ok := r.emailThreads[key(companyID, draft.EmailThreadID)]
	if !ok {
		return ErrNotFound
	}
	providerThreadID := strings.TrimSpace(storedThread.ProviderThreadID)
	if providerThreadID != "" && strings.TrimSpace(message.ThreadID) != providerThreadID {
		return ErrInvalid
	}
	if strings.TrimSpace(message.ThreadID) == "" {
		message.ThreadID = providerThreadID
	}
	message = mergeStoredCompleteEmailMessageAttachments(storedThread, message)
	promotesAttachments := completedEmailMessagePromotesAttachments(message)
	storedMessage := message
	if promotesAttachments {
		storedMessage.DownloadComplete = false
	}
	updatedThread, err := r.upsertCommunicationsEmailThreadLocked(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: storedThread.PersonalUserID,
		PersonalAccountEmail: storedThread.PersonalAccountEmail, SharedInboxID: storedThread.SharedInboxID,
		AccountEmail: storedThread.AccountEmail, Provider: storedThread.Provider, ProviderThreadID: message.ThreadID,
		SelectedMessageID: message.ID, Messages: []domain.EmailMessageSnapshot{storedMessage},
		HistoryComplete: storedThread.HistoryComplete, FetchedAt: time.Now().UTC(),
	})
	if err != nil {
		return err
	}
	sentEmailMessageID := internalEmailMessageIDForProvider(updatedThread, message.ID)
	if sentEmailMessageID == "" {
		return ErrNotFound
	}
	now := time.Now().UTC()
	draftRelationshipIDs := make([]string, 0)
	draftLinks := make([]domain.ResourceAttachment, 0)
	for relationshipID, link := range r.resourceAttachments {
		if link.CompanyID == companyID && link.ResourceType == "email_draft" && link.ResourceID == draftID && link.DeletedTimestamp == nil {
			draftRelationshipIDs = append(draftRelationshipIDs, relationshipID)
			draftLinks = append(draftLinks, link)
		}
	}
	for _, link := range draftLinks {
		link.ResourceAttachmentID = newUUIDv7String()
		link.ResourceType = "email_message"
		link.ResourceID = sentEmailMessageID
		link.CreatedTimestamp = now
		if _, err := r.upsertResourceAttachmentLocked(link); err != nil {
			return err
		}
	}
	if promotesAttachments {
		if _, err := r.upsertCommunicationsEmailThreadLocked(CommunicationsEmailThreadUpsertInput{
			CompanyID: companyID, PersonalUserID: storedThread.PersonalUserID,
			PersonalAccountEmail: storedThread.PersonalAccountEmail, SharedInboxID: storedThread.SharedInboxID,
			AccountEmail: storedThread.AccountEmail, Provider: storedThread.Provider, ProviderThreadID: message.ThreadID,
			SelectedMessageID: message.ID, Messages: []domain.EmailMessageSnapshot{message},
			HistoryComplete: storedThread.HistoryComplete, FetchedAt: time.Now().UTC(),
		}); err != nil {
			return err
		}
		r.convergeCommunicationsEmailThreadAttachmentLinksLocked(companyID, updatedThread.EmailThreadID)
	}
	for _, relationshipID := range draftRelationshipIDs {
		link := r.resourceAttachments[relationshipID]
		link.DeletedTimestamp = &now
		r.resourceAttachments[relationshipID] = link
	}
	draft.SendState = communicationsEmailDraftSendStateSent
	draft.SendClaimToken = ""
	draft.SendClaimedRevision = 0
	draft.SendClaimedTimestamp = nil
	draft.SentMessageID = sentEmailMessageID
	draft.UpdatedByUserID = updatedByUserID
	draft.Revision++
	draft.UpdatedTimestamp = now
	draft.DeletedTimestamp = &now
	r.emailDrafts[draftKey] = draft
	return nil
}

func (r *PostgresRepo) ClaimCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendClaimInput) (CommunicationsEmailDraftSendClaim, error) {
	companyID := cleanUUIDText(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	relationshipID := cleanUUIDText(input.CollaborationID)
	participantUserID := cleanUUIDText(input.ParticipantUserID)
	if companyID == "" || draftID == "" || participantUserID == "" || input.ExpectedRevision <= 0 {
		return CommunicationsEmailDraftSendClaim{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	defer tx.Rollback()
	var draft domain.CommunicationsEmailDraft
	if relationshipID != "" {
		draft, err = scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id=$1::uuid and draft_id=$2
 and email_thread_id is not null and deleted_timestamp is null
 and exists (
  select 1 from email_relationships relationship
  where relationship.company_id=email_drafts.company_id
   and relationship.email_thread_id=email_drafts.email_thread_id
   and relationship.email_relationship_id=$3::uuid
   and relationship.resource_type='node'
   and relationship.resource_id=email_drafts.origin_node_id
   and relationship.resource_textbox_id is null
   and mangorts_user_can_access_resource(relationship.company_id,relationship.resource_type,
       relationship.resource_id,$4::uuid,'edit'))
for update`, companyID, draftID, relationshipID, participantUserID))
	} else {
		draft, err = scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id=$1::uuid and draft_id=$2
 and email_thread_id is not null and deleted_timestamp is null
 and (($3<>'' and scope_type='shared' and shared_inbox_id=$3::uuid)
   or ($3='' and scope_type='personal' and personal_user_id=$4::uuid and personal_account_email=$5))
for update`, companyID, draftID, cleanUUIDText(input.SharedInboxID),
			cleanUUIDText(input.PersonalUserID), normalizeEmail(input.PersonalAccountEmail)))
	}
	if err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	if draft.Revision != input.ExpectedRevision {
		return CommunicationsEmailDraftSendClaim{}, versionConflict(draft.Revision)
	}
	previousSendState, previousClaimToken := draft.SendState, draft.SendClaimToken
	draft, err = claimSharedEmailDraftSend(draft, input.ProviderGrantID, input.Now)
	if err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	result, err := tx.ExecContext(ctx, `
update email_drafts set send_state='sending',send_claim_token=$3,send_idempotency_key=$4,
 send_idempotency_grant_id=$5,send_idempotency_timestamp=$6,
 send_claimed_revision=$7,send_claimed_timestamp=$8
where company_id=$1::uuid and draft_id=$2 and send_state=$9 and send_claim_token=$10
 and deleted_timestamp is null`, companyID, draftID, draft.SendClaimToken, draft.SendIdempotencyKey,
		draft.SendIdempotencyGrantID, draft.SendIdempotencyTimestamp, draft.SendClaimedRevision,
		draft.SendClaimedTimestamp, previousSendState, previousClaimToken)
	if err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return CommunicationsEmailDraftSendClaim{}, ErrSendInProgress
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	return CommunicationsEmailDraftSendClaim{Draft: draft, ClaimToken: draft.SendClaimToken,
		IdempotencyKey: draft.SendIdempotencyKey, Recovered: previousSendState == communicationsEmailDraftSendStateSending}, nil
}

func (r *PostgresRepo) ReleaseCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendReleaseInput) error {
	result, err := r.db.Exec(`
update email_drafts
set send_state='draft', send_claim_token='', send_idempotency_key='', send_idempotency_grant_id='', send_idempotency_timestamp=null,
    send_claimed_revision=0, send_claimed_timestamp=null
where company_id=$1::uuid and draft_id=$2 and send_state='sending' and send_claim_token=$3 and deleted_timestamp is null`,
		cleanUUIDText(input.CompanyID), strings.TrimSpace(input.DraftID), strings.TrimSpace(input.ClaimToken))
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) CompleteCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendCompleteInput) error {
	companyID := cleanUUIDText(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	relationshipID := cleanUUIDText(input.CollaborationID)
	claimToken := strings.TrimSpace(input.ClaimToken)
	updatedByUserID := cleanUUIDText(input.UpdatedByUserID)
	message := normalizeEmailMessageSnapshot(input.Message)
	if companyID == "" || draftID == "" || claimToken == "" || message.ID == "" {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var revision, claimedRevision int64
	var emailThreadID string
	query := `
select revision,send_claimed_revision,email_thread_id::text from email_drafts
where company_id=$1::uuid and draft_id=$2
 and email_thread_id is not null
 and send_state='sending' and send_claim_token=$4 and deleted_timestamp is null`
	if relationshipID != "" {
		query += ` and exists (
  select 1 from email_relationships relationship
  where relationship.company_id=email_drafts.company_id
   and relationship.email_thread_id=email_drafts.email_thread_id
   and relationship.email_relationship_id=$3::uuid
   and relationship.resource_type='node'
	   and relationship.resource_id=email_drafts.origin_node_id
	   and relationship.resource_textbox_id is null)`
	}
	query += ` for update`
	if err := tx.QueryRowContext(ctx, query, companyID, draftID, relationshipID, claimToken).Scan(&revision, &claimedRevision, &emailThreadID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if claimedRevision != revision {
		return ErrNotFound
	}
	thread, err := postgresCommunicationsEmailThreadByID(ctx, tx, companyID, emailThreadID)
	if err != nil {
		return err
	}
	if thread.ProviderThreadID != "" && message.ThreadID != "" && message.ThreadID != thread.ProviderThreadID {
		return ErrInvalid
	}
	if message.ThreadID == "" {
		message.ThreadID = thread.ProviderThreadID
	}
	message = mergeStoredCompleteEmailMessageAttachments(thread, message)
	promotesAttachments := completedEmailMessagePromotesAttachments(message)
	storedMessage := message
	if promotesAttachments {
		storedMessage.DownloadComplete = false
	}
	updatedThread, err := upsertPostgresCommunicationsEmailThreadTx(ctx, tx, CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: thread.PersonalUserID,
		PersonalAccountEmail: thread.PersonalAccountEmail, SharedInboxID: thread.SharedInboxID,
		AccountEmail: thread.AccountEmail, Provider: thread.Provider, ProviderThreadID: message.ThreadID,
		SelectedMessageID: message.ID, Messages: []domain.EmailMessageSnapshot{storedMessage},
		HistoryComplete: thread.HistoryComplete, FetchedAt: time.Now().UTC(),
	})
	if err != nil {
		return err
	}
	if !promotesAttachments {
		message = mergeStoredCompleteEmailMessageAttachments(updatedThread, message)
		promotesAttachments = completedEmailMessagePromotesAttachments(message)
		if promotesAttachments {
			storedMessage = message
			storedMessage.DownloadComplete = false
			updatedThread, err = upsertPostgresCommunicationsEmailThreadTx(ctx, tx, CommunicationsEmailThreadUpsertInput{
				CompanyID: companyID, PersonalUserID: thread.PersonalUserID,
				PersonalAccountEmail: thread.PersonalAccountEmail, SharedInboxID: thread.SharedInboxID,
				AccountEmail: thread.AccountEmail, Provider: thread.Provider, ProviderThreadID: message.ThreadID,
				SelectedMessageID: message.ID, Messages: []domain.EmailMessageSnapshot{storedMessage},
				HistoryComplete: thread.HistoryComplete, FetchedAt: time.Now().UTC(),
			})
			if err != nil {
				return err
			}
		}
	}
	var sentEmailMessageID string
	for _, item := range updatedThread.Messages {
		if item.ProviderMessageID == message.ID {
			sentEmailMessageID = item.EmailMessageID
			break
		}
	}
	if sentEmailMessageID == "" {
		return ErrNotFound
	}
	if err := promoteEmailDraftAttachmentRelationshipsTx(ctx, tx, companyID, draftID, sentEmailMessageID); err != nil {
		return err
	}
	if promotesAttachments {
		if _, err := upsertPostgresCommunicationsEmailThreadTx(ctx, tx, CommunicationsEmailThreadUpsertInput{
			CompanyID: companyID, PersonalUserID: thread.PersonalUserID,
			PersonalAccountEmail: thread.PersonalAccountEmail, SharedInboxID: thread.SharedInboxID,
			AccountEmail: thread.AccountEmail, Provider: thread.Provider, ProviderThreadID: message.ThreadID,
			SelectedMessageID: message.ID, Messages: []domain.EmailMessageSnapshot{message},
			HistoryComplete: thread.HistoryComplete, FetchedAt: time.Now().UTC(),
		}); err != nil {
			return err
		}
		if _, err := convergeCommunicationsEmailThreadAttachmentLinksTx(ctx, tx, companyID, updatedThread.EmailThreadID); err != nil {
			return err
		}
	}
	result, err := tx.ExecContext(ctx, `
update email_drafts set send_state='sent',send_claim_token='',
 send_claimed_revision=0,send_claimed_timestamp=null,
 sent_email_message_id=$5::uuid,sent_provider_message_id=$6,
 updated_by_user_id=nullif($7,'')::uuid,revision=revision+1,
 updated_timestamp=now(),deleted_timestamp=now()
where company_id=$1::uuid and draft_id=$2 and email_thread_id=$3::uuid
 and send_state='sending' and send_claim_token=$4
 and send_claimed_revision=revision and deleted_timestamp is null`,
		companyID, draftID, emailThreadID, claimToken, sentEmailMessageID, message.ID, updatedByUserID)
	if err != nil {
		return err
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return ErrNotFound
	}
	if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "email_draft", draftID); err != nil {
		return err
	}
	return tx.Commit()
}

func postgresSharedEmailDraftWithSourceTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, sourceMessageID string) (string, error) {
	var draftID string
	err := tx.QueryRowContext(ctx, `
select draft_id from email_drafts
where company_id=$1::uuid and origin_node_id=$2::uuid and source_email_message_id=$3::uuid
 and deleted_timestamp is null
limit 1 for update`, companyID, nodeID, sourceMessageID).Scan(&draftID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return draftID, err
}
