package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) isSharedEmailDraftParticipantLocked(draft domain.CommunicationsEmailDraft, userID string) bool {
	if !draft.IsShared || strings.TrimSpace(draft.CollaborationID) == "" || strings.TrimSpace(userID) == "" {
		return false
	}
	_, ok := r.emailCollaborationParticipants[emailCollaborationParticipantKey(draft.CompanyID, draft.CollaborationID, userID)]
	return ok
}

func (r *MemoryRepo) upsertSharedCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.DraftID = strings.TrimSpace(input.DraftID)
	input.CollaborationID = strings.TrimSpace(input.CollaborationID)
	input.ParticipantUserID = strings.TrimSpace(input.ParticipantUserID)
	if input.CompanyID == "" || input.DraftID == "" || input.CollaborationID == "" || input.ParticipantUserID == "" || input.ExpectedRevision < 0 {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	collaboration, ok := r.emailCollaborations[key(input.CompanyID, input.CollaborationID)]
	if !ok {
		return domain.CommunicationsEmailDraft{}, ErrNotFound
	}
	if _, ok := r.emailCollaborationParticipants[emailCollaborationParticipantKey(input.CompanyID, input.CollaborationID, input.ParticipantUserID)]; !ok {
		return domain.CommunicationsEmailDraft{}, ErrNotFound
	}
	draftKey := communicationsEmailDraftKey(input.CompanyID, input.DraftID)
	existing, exists := r.emailDrafts[draftKey]
	if exists {
		if existing.DeletedTimestamp != nil || !existing.IsShared || existing.CollaborationID != input.CollaborationID {
			return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
		}
		input.SourceMessageID = existing.SourceMessageID
		input.ReplyToMessageJSON = existing.ReplyToMessageJSON
	}

	input, err := canonicalSharedEmailDraftInput(input, collaboration)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draft.CollaborationID = collaboration.CollaborationID
	draft.IsShared = true

	now := time.Now().UTC()
	if exists {
		if existing.SendState == communicationsEmailDraftSendStateSending {
			return domain.CommunicationsEmailDraft{}, ErrSendInProgress
		}
		if existing.Revision != input.ExpectedRevision {
			return domain.CommunicationsEmailDraft{}, versionConflict(existing.Revision)
		}
		preserveSharedEmailDraftIdentity(&draft, existing)
		draft.CreatedTimestamp = existing.CreatedTimestamp
		draft.CreatedByUserID = existing.CreatedByUserID
		draft.Revision = existing.Revision + 1
	} else {
		if input.ExpectedRevision != 0 {
			return domain.CommunicationsEmailDraft{}, versionConflict(0)
		}
		for _, other := range r.emailDrafts {
			if other.CompanyID == draft.CompanyID && other.IsShared && other.CollaborationID == draft.CollaborationID &&
				other.SourceMessageID == draft.SourceMessageID && other.DeletedTimestamp == nil {
				return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
			}
		}
		draft.CreatedTimestamp = now
		draft.Revision = 1
	}
	draft.SendState = communicationsEmailDraftSendStateDraft
	draft.SendClaimToken = ""
	draft.SendIdempotencyKey = ""
	draft.SendIdempotencyGrantID = ""
	draft.SendIdempotencyTimestamp = nil
	draft.SendClaimedRevision = 0
	draft.SendClaimedTimestamp = nil
	draft.SentMessageID = ""
	draft.UpdatedTimestamp = now
	draft.DeletedTimestamp = nil
	r.emailDrafts[draftKey] = draft
	return draft, nil
}

func (r *PostgresRepo) appendParticipantSharedCommunicationsEmailDrafts(input CommunicationsEmailDraftListInput, drafts []domain.CommunicationsEmailDraft) ([]domain.CommunicationsEmailDraft, error) {
	participantUserID := cleanUUIDText(input.ParticipantUserID)
	if participantUserID == "" {
		return drafts, nil
	}
	rows, err := r.db.Query(`
select `+communicationsEmailDraftSelectColumns()+`
from communications_email_drafts d
where d.company_id = $1::uuid
	and d.deleted_timestamp is null
	and d.is_shared
	and exists (
		select 1
		from communications_email_collaboration_participants p
		where p.company_id = d.company_id
			and p.collaboration_id = d.collaboration_id
			and p.user_id = $2::uuid
	)
order by d.updated_timestamp desc, d.draft_id asc`, strings.TrimSpace(input.CompanyID), participantUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	seen := make(map[string]struct{}, len(drafts))
	for _, draft := range drafts {
		seen[draft.DraftID] = struct{}{}
	}
	for rows.Next() {
		draft, scanErr := scanCommunicationsEmailDraft(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		if _, ok := seen[draft.DraftID]; ok {
			continue
		}
		seen[draft.DraftID] = struct{}{}
		drafts = append(drafts, draft)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(drafts, func(i, j int) bool {
		return drafts[i].UpdatedTimestamp.After(drafts[j].UpdatedTimestamp)
	})
	return drafts, nil
}

func (r *PostgresRepo) getParticipantSharedCommunicationsEmailDraft(input CommunicationsEmailDraftGetInput) (domain.CommunicationsEmailDraft, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	participantUserID := cleanUUIDText(input.ParticipantUserID)
	if companyID == "" || draftID == "" || participantUserID == "" {
		return domain.CommunicationsEmailDraft{}, ErrNotFound
	}
	return scanCommunicationsEmailDraft(r.db.QueryRow(`
select `+communicationsEmailDraftSelectColumns()+`
from communications_email_drafts d
where d.company_id = $1::uuid
	and d.draft_id = $2
	and d.deleted_timestamp is null
	and d.is_shared
	and exists (
		select 1
		from communications_email_collaboration_participants p
		where p.company_id = d.company_id
			and p.collaboration_id = d.collaboration_id
			and p.user_id = $3::uuid
	)`, companyID, draftID, participantUserID))
}

func (r *PostgresRepo) upsertSharedCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	collaborationID := cleanUUIDText(input.CollaborationID)
	participantUserID := cleanUUIDText(input.ParticipantUserID)
	if companyID == "" || draftID == "" || collaborationID == "" || participantUserID == "" || input.ExpectedRevision < 0 {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	defer tx.Rollback()

	collaboration, err := postgresEmailCollaborationByID(ctx, tx, companyID, collaborationID, participantUserID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}

	existing, existingErr := scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
select `+communicationsEmailDraftSelectColumns()+`
from communications_email_drafts
where company_id = $1::uuid and draft_id = $2
for update`, companyID, draftID))
	if existingErr != nil && !errors.Is(existingErr, ErrNotFound) {
		return domain.CommunicationsEmailDraft{}, existingErr
	}
	if existingErr == nil {
		if existing.DeletedTimestamp != nil || !existing.IsShared || existing.CollaborationID != collaborationID {
			return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
		}
		input.SourceMessageID = existing.SourceMessageID
		input.ReplyToMessageJSON = existing.ReplyToMessageJSON
	}

	input, err = canonicalSharedEmailDraftInput(input, collaboration)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draft.CollaborationID = collaborationID
	draft.IsShared = true

	if existingErr == nil {
		if existing.SendState == communicationsEmailDraftSendStateSending {
			return domain.CommunicationsEmailDraft{}, ErrSendInProgress
		}
		if existing.Revision != input.ExpectedRevision {
			return domain.CommunicationsEmailDraft{}, versionConflict(existing.Revision)
		}
		preserveSharedEmailDraftIdentity(&draft, existing)
		draft, err = scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
update communications_email_drafts
set updated_by_user_id = nullif($3, '')::uuid,
	subject = $4,
	body_editor_html = $5,
	revision = revision + 1,
	send_state = 'draft',
	send_claim_token = '',
	send_idempotency_key = '',
	send_idempotency_grant_id = '',
	send_idempotency_timestamp = null,
	send_claimed_revision = 0,
	send_claimed_timestamp = null,
	sent_message_id = '',
	updated_timestamp = now(),
	deleted_timestamp = null
where company_id = $1::uuid and draft_id = $2
returning `+communicationsEmailDraftSelectColumns(), companyID, draftID, cleanUUIDText(input.UpdatedByUserID), draft.Subject, draft.BodyEditorHTML))
	} else {
		if input.ExpectedRevision != 0 {
			return domain.CommunicationsEmailDraft{}, versionConflict(0)
		}
		lockKey := companyID + ":" + collaborationID + ":" + draft.SourceMessageID
		if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		otherDraftID, err := postgresSharedEmailDraftWithSourceTx(ctx, tx, companyID, collaborationID, draft.SourceMessageID)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		if otherDraftID != "" && otherDraftID != draftID {
			return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
		}
		draft, err = scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
insert into communications_email_drafts (
	company_id, draft_id, personal_user_id, personal_account_email, shared_inbox_id,
	created_by_user_id, updated_by_user_id, kind, source_message_id, account_email,
	to_recipients, cc_recipients, bcc_recipients, subject, body_editor_html,
	reply_to_message, scheduled_send_timestamp, collaboration_id, is_shared, revision,
	created_timestamp, updated_timestamp, deleted_timestamp
) values (
	$1::uuid, $2, nullif($3, '')::uuid, nullif($4, ''), nullif($5, '')::uuid,
	nullif($6, '')::uuid, nullif($7, '')::uuid, $8, $9, $10,
	$11, $12, $13, $14, $15, coalesce(nullif($16, '')::jsonb, '{}'::jsonb),
	$17, $18::uuid, true, 1, now(), now(), null
)
returning `+communicationsEmailDraftSelectColumns(), companyID, draftID, draft.PersonalUserID, draft.PersonalAccountEmail, draft.SharedInboxID, cleanUUIDText(input.CreatedByUserID), cleanUUIDText(input.UpdatedByUserID), draft.Kind, draft.SourceMessageID, draft.AccountEmail, draft.ToRecipients, draft.CcRecipients, draft.BccRecipients, draft.Subject, draft.BodyEditorHTML, draft.ReplyToMessageJSON, draft.ScheduledSendTimestamp, collaborationID))
	}
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	return draft, nil
}

func (r *PostgresRepo) softDeleteParticipantSharedCommunicationsEmailDraft(input CommunicationsEmailDraftDeleteInput) error {
	companyID := strings.TrimSpace(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	participantUserID := cleanUUIDText(input.ParticipantUserID)
	if companyID == "" || draftID == "" || participantUserID == "" {
		return ErrNotFound
	}
	if input.ExpectedRevision <= 0 {
		return ErrInvalid
	}
	now := sharedEmailDraftSendClaimNow(input.Now)
	result, err := r.db.Exec(`
update communications_email_drafts d
set deleted_timestamp = now(),
	updated_timestamp = now(),
	updated_by_user_id = nullif($4, '')::uuid,
	revision = revision + 1
where d.company_id = $1::uuid
	and d.draft_id = $2
	and d.deleted_timestamp is null
	and d.is_shared
	and (
		d.send_state = 'draft'
		or (
			d.send_state = 'sending'
			and (d.send_claimed_timestamp is null or d.send_claimed_timestamp <= $6::timestamptz - interval '5 minutes')
		)
	)
	and d.revision = $5::bigint
	and exists (
		select 1
		from communications_email_collaboration_participants p
		where p.company_id = d.company_id
			and p.collaboration_id = d.collaboration_id
			and p.user_id = $3::uuid
	)`, companyID, draftID, participantUserID, cleanUUIDText(input.UpdatedByUserID), input.ExpectedRevision, now)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows > 0 {
		return nil
	}
	var currentRevision int64
	var sendState string
	var sendClaimedTimestamp sql.NullTime
	err = r.db.QueryRow(`
select d.revision, d.send_state, d.send_claimed_timestamp
from communications_email_drafts d
where d.company_id = $1::uuid and d.draft_id = $2 and d.deleted_timestamp is null and d.is_shared
	and exists (
		select 1 from communications_email_collaboration_participants p
		where p.company_id = d.company_id and p.collaboration_id = d.collaboration_id and p.user_id = $3::uuid
	)`, companyID, draftID, participantUserID).Scan(
		&currentRevision, &sendState, &sendClaimedTimestamp,
	)
	if err == nil {
		if currentRevision != input.ExpectedRevision {
			return versionConflict(currentRevision)
		}
		if sendState == communicationsEmailDraftSendStateSending {
			draft := domain.CommunicationsEmailDraft{SendState: sendState}
			if sendClaimedTimestamp.Valid {
				draft.SendClaimedTimestamp = &sendClaimedTimestamp.Time
			}
			if !sharedEmailDraftSendClaimActive(draft, now) {
				// The atomic update above should have discarded this inactive
				// claim. Treat a concurrent state change as in-progress.
				return ErrSendInProgress
			}
			return ErrSendInProgress
		}
		return versionConflict(currentRevision)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	return ErrNotFound
}
