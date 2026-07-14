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

func versionConflict(currentRevision int64) error {
	return &VersionConflictError{CurrentRevision: currentRevision}
}

func canonicalSharedEmailDraftInput(input CommunicationsEmailDraftInput, collaboration domain.CommunicationsEmailCollaboration) (CommunicationsEmailDraftInput, error) {
	if input.ScheduledSendTimestamp != nil {
		return CommunicationsEmailDraftInput{}, ErrInvalid
	}
	source := collaboration.Message
	requestedSourceMessageID := strings.TrimSpace(input.SourceMessageID)
	if requestedSourceMessageID != "" && requestedSourceMessageID != strings.TrimSpace(source.ID) {
		if err := json.Unmarshal([]byte(strings.TrimSpace(input.ReplyToMessageJSON)), &source); err != nil {
			return CommunicationsEmailDraftInput{}, ErrInvalid
		}
	}
	sourceMessageID := strings.TrimSpace(source.ID)
	if requestedSourceMessageID != "" && sourceMessageID != requestedSourceMessageID {
		return CommunicationsEmailDraftInput{}, ErrInvalid
	}
	if sourceMessageID == "" {
		return CommunicationsEmailDraftInput{}, ErrInvalid
	}
	providerThreadID := strings.TrimSpace(collaboration.ProviderThreadID)
	if providerThreadID != "" {
		if strings.TrimSpace(source.ThreadID) != providerThreadID {
			return CommunicationsEmailDraftInput{}, ErrInvalid
		}
	} else if sourceMessageID != strings.TrimSpace(collaboration.RootMessageID) &&
		sourceMessageID != strings.TrimSpace(collaboration.LatestMessageID) &&
		sourceMessageID != strings.TrimSpace(collaboration.Message.ID) {
		return CommunicationsEmailDraftInput{}, ErrInvalid
	}
	toRecipients, ccRecipients := canonicalSharedEmailDraftReplyAllEnvelope(source, collaboration.AccountEmail)
	if toRecipients == "" && ccRecipients == "" {
		return CommunicationsEmailDraftInput{}, ErrInvalid
	}
	replyToMessage, err := json.Marshal(source)
	if err != nil {
		return CommunicationsEmailDraftInput{}, err
	}
	input.PersonalUserID = collaboration.PersonalUserID
	input.PersonalAccountEmail = collaboration.PersonalAccountEmail
	input.SharedInboxID = collaboration.SharedInboxID
	input.AccountEmail = collaboration.AccountEmail
	input.Kind = "reply"
	input.SourceMessageID = sourceMessageID
	input.ToRecipients = toRecipients
	input.CcRecipients = ccRecipients
	input.BccRecipients = ""
	input.ReplyToMessageJSON = string(replyToMessage)
	input.ScheduledSendTimestamp = nil
	return input, nil
}

func preserveSharedEmailDraftIdentity(input *domain.CommunicationsEmailDraft, existing domain.CommunicationsEmailDraft) {
	input.Kind = existing.Kind
	input.SourceMessageID = existing.SourceMessageID
	input.AccountEmail = existing.AccountEmail
	input.ToRecipients = existing.ToRecipients
	input.CcRecipients = existing.CcRecipients
	input.BccRecipients = existing.BccRecipients
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
	if companyID == "" || draftID == "" || collaborationID == "" || participantUserID == "" || input.ExpectedRevision <= 0 {
		return CommunicationsEmailDraftSendClaim{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	draftKey := communicationsEmailDraftKey(companyID, draftID)
	draft, ok := r.emailDrafts[draftKey]
	if !ok || draft.DeletedTimestamp != nil || !draft.IsShared || draft.CollaborationID != collaborationID || !r.isSharedEmailDraftParticipantLocked(draft, participantUserID) {
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

func (r *MemoryRepo) FinalizeCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendFinalizeInput) error {
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
	if !ok || draft.DeletedTimestamp != nil || draft.SendState != communicationsEmailDraftSendStateSending || draft.SendClaimToken != claimToken || draft.SendClaimedRevision != draft.Revision {
		return ErrNotFound
	}
	now := time.Now().UTC()
	draft.SendState = communicationsEmailDraftSendStateSent
	draft.SendClaimToken = ""
	draft.SendClaimedRevision = 0
	draft.SendClaimedTimestamp = nil
	draft.SentMessageID = strings.TrimSpace(input.SentMessageID)
	draft.UpdatedByUserID = strings.TrimSpace(input.UpdatedByUserID)
	draft.Revision++
	draft.UpdatedTimestamp = now
	draft.DeletedTimestamp = &now
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
	if companyID == "" || draftID == "" || collaborationID == "" || claimToken == "" || message.ID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	draftKey := communicationsEmailDraftKey(companyID, draftID)
	draft, ok := r.emailDrafts[draftKey]
	if !ok || draft.DeletedTimestamp != nil || !draft.IsShared ||
		draft.CollaborationID != collaborationID ||
		draft.SendState != communicationsEmailDraftSendStateSending ||
		draft.SendClaimToken != claimToken ||
		draft.SendClaimedRevision != draft.Revision {
		return ErrNotFound
	}
	collaborationKey := key(companyID, collaborationID)
	collaboration, ok := r.emailCollaborations[collaborationKey]
	if !ok {
		return ErrNotFound
	}
	providerThreadID := strings.TrimSpace(collaboration.ProviderThreadID)
	if providerThreadID != "" && strings.TrimSpace(message.ThreadID) != providerThreadID {
		return ErrInvalid
	}
	if strings.TrimSpace(message.ThreadID) == "" {
		message.ThreadID = providerThreadID
	}
	now := time.Now().UTC()
	collaboration.Message = message
	collaboration.LatestMessageID = message.ID
	if collaboration.ProviderThreadID == "" {
		collaboration.ProviderThreadID = message.ThreadID
	}
	collaboration.UpdatedTimestamp = now

	draft.SendState = communicationsEmailDraftSendStateSent
	draft.SendClaimToken = ""
	draft.SendClaimedRevision = 0
	draft.SendClaimedTimestamp = nil
	draft.SentMessageID = message.ID
	draft.UpdatedByUserID = updatedByUserID
	draft.Revision++
	draft.UpdatedTimestamp = now
	draft.DeletedTimestamp = &now

	// Both assignments happen only after every validation has succeeded while
	// holding the same lock, so MemoryRepo cannot expose a partial completion.
	r.emailCollaborations[collaborationKey] = collaboration
	r.emailDrafts[draftKey] = draft
	return nil
}

func (r *PostgresRepo) ClaimCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendClaimInput) (CommunicationsEmailDraftSendClaim, error) {
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	companyID := cleanUUIDText(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	collaborationID := cleanUUIDText(input.CollaborationID)
	participantUserID := cleanUUIDText(input.ParticipantUserID)
	if companyID == "" || draftID == "" || collaborationID == "" || participantUserID == "" || input.ExpectedRevision <= 0 {
		return CommunicationsEmailDraftSendClaim{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	defer tx.Rollback()
	draft, err := scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
select `+communicationsEmailDraftSelectColumns()+`
from communications_email_drafts d
where d.company_id=$1::uuid
  and d.draft_id=$2
  and d.collaboration_id=$3::uuid
  and d.is_shared
  and d.deleted_timestamp is null
  and exists (
    select 1 from communications_email_collaboration_participants p
    where p.company_id=d.company_id and p.collaboration_id=d.collaboration_id and p.user_id=$4::uuid
  )
for update`, companyID, draftID, collaborationID, participantUserID))
	if err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	if draft.Revision != input.ExpectedRevision {
		return CommunicationsEmailDraftSendClaim{}, versionConflict(draft.Revision)
	}
	previousSendState := draft.SendState
	previousClaimToken := draft.SendClaimToken
	draft, err = claimSharedEmailDraftSend(draft, input.ProviderGrantID, input.Now)
	if err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	result, err := tx.ExecContext(ctx, `
update communications_email_drafts
set send_state='sending', send_claim_token=$3, send_idempotency_key=$4,
	    send_idempotency_grant_id=$5, send_idempotency_timestamp=$6,
	    send_claimed_revision=$7, send_claimed_timestamp=$8
where company_id=$1::uuid and draft_id=$2 and send_state=$9 and send_claim_token=$10
  and deleted_timestamp is null`,
		companyID, draftID, draft.SendClaimToken, draft.SendIdempotencyKey,
		draft.SendIdempotencyGrantID, draft.SendIdempotencyTimestamp,
		draft.SendClaimedRevision, draft.SendClaimedTimestamp,
		previousSendState, previousClaimToken)
	if err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	if rows != 1 {
		return CommunicationsEmailDraftSendClaim{}, ErrSendInProgress
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailDraftSendClaim{}, err
	}
	return CommunicationsEmailDraftSendClaim{
		Draft: draft, ClaimToken: draft.SendClaimToken, IdempotencyKey: draft.SendIdempotencyKey,
		Recovered: previousSendState == communicationsEmailDraftSendStateSending,
	}, nil
}

func (r *PostgresRepo) ReleaseCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendReleaseInput) error {
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return err
	}
	result, err := r.db.Exec(`
update communications_email_drafts
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

func (r *PostgresRepo) FinalizeCommunicationsEmailDraftSend(input CommunicationsEmailDraftSendFinalizeInput) error {
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return err
	}
	result, err := r.db.Exec(`
update communications_email_drafts
set send_state='sent', send_claim_token='', send_claimed_revision=0, send_claimed_timestamp=null,
    sent_message_id=$4, updated_by_user_id=nullif($5, '')::uuid,
    revision=revision+1, updated_timestamp=now(), deleted_timestamp=now()
where company_id=$1::uuid and draft_id=$2 and send_state='sending' and send_claim_token=$3
  and send_claimed_revision=revision and deleted_timestamp is null`,
		cleanUUIDText(input.CompanyID), strings.TrimSpace(input.DraftID), strings.TrimSpace(input.ClaimToken),
		strings.TrimSpace(input.SentMessageID), cleanUUIDText(input.UpdatedByUserID))
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
	if err := r.ensureCommunicationsEmailDraftsSchema(); err != nil {
		return err
	}
	companyID := cleanUUIDText(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	collaborationID := cleanUUIDText(input.CollaborationID)
	claimToken := strings.TrimSpace(input.ClaimToken)
	updatedByUserID := cleanUUIDText(input.UpdatedByUserID)
	message := normalizeEmailMessageSnapshot(input.Message)
	if companyID == "" || draftID == "" || collaborationID == "" || claimToken == "" || message.ID == "" {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var revision, claimedRevision int64
	err = tx.QueryRowContext(ctx, `
select revision, send_claimed_revision
from communications_email_drafts
where company_id=$1::uuid and draft_id=$2 and collaboration_id=$3::uuid
  and is_shared and send_state='sending' and send_claim_token=$4
  and deleted_timestamp is null
for update`, companyID, draftID, collaborationID, claimToken).Scan(&revision, &claimedRevision)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if claimedRevision != revision {
		return ErrNotFound
	}

	var providerThreadID string
	err = tx.QueryRowContext(ctx, `
select provider_thread_id
from communications_email_collaborations
where company_id=$1::uuid and collaboration_id=$2::uuid
for update`, companyID, collaborationID).Scan(&providerThreadID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	providerThreadID = strings.TrimSpace(providerThreadID)
	if providerThreadID != "" && strings.TrimSpace(message.ThreadID) != providerThreadID {
		return ErrInvalid
	}
	if strings.TrimSpace(message.ThreadID) == "" {
		message.ThreadID = providerThreadID
	}
	snapshot, err := json.Marshal(message)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
update communications_email_collaborations
set latest_message_id=$3, message_snapshot=$4::jsonb,
    provider_thread_id=case when provider_thread_id='' then $5 else provider_thread_id end,
    updated_timestamp=now()
where company_id=$1::uuid and collaboration_id=$2::uuid`,
		companyID, collaborationID, message.ID, string(snapshot), message.ThreadID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
update communications_email_drafts
set send_state='sent', send_claim_token='', send_claimed_revision=0, send_claimed_timestamp=null,
    sent_message_id=$5, updated_by_user_id=nullif($6, '')::uuid,
    revision=revision+1, updated_timestamp=now(), deleted_timestamp=now()
where company_id=$1::uuid and draft_id=$2 and collaboration_id=$3::uuid
  and send_state='sending' and send_claim_token=$4
  and send_claimed_revision=revision and deleted_timestamp is null`,
		companyID, draftID, collaborationID, claimToken, message.ID, updatedByUserID)
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
	return tx.Commit()
}
func postgresSharedEmailDraftWithSourceTx(ctx context.Context, tx *sql.Tx, companyID, collaborationID, sourceMessageID string) (string, error) {
	var draftID string

	err := tx.QueryRowContext(ctx, `
select draft_id
from communications_email_drafts
where company_id=$1::uuid and collaboration_id=$2::uuid and source_message_id=$3
  and is_shared and deleted_timestamp is null
limit 1
for update`, companyID, collaborationID, sourceMessageID).Scan(&draftID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return draftID, err
}
