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
	collaboration, ok := r.emailCollaborations[key(draft.CompanyID, draft.CollaborationID)]
	return ok && r.userHasEffectiveAccessLocked(draft.CompanyID, userID, EntityTypeNode, collaboration.NodeID, EntityPermissionEdit)
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
	if !r.userHasEffectiveAccessLocked(input.CompanyID, input.ParticipantUserID, EntityTypeNode, collaboration.NodeID, EntityPermissionEdit) {
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
from email_drafts
where company_id=$1::uuid and deleted_timestamp is null
 and email_relationship_id is not null
 and exists (
  select 1 from email_relationships relationship
  where relationship.company_id=email_drafts.company_id
   and relationship.email_relationship_id=email_drafts.email_relationship_id
   and mangorts_user_can_access_resource(relationship.company_id,relationship.resource_type,
       relationship.resource_id,$2::uuid,'edit'))
order by updated_timestamp desc,draft_id`, strings.TrimSpace(input.CompanyID), participantUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	seen := make(map[string]struct{}, len(drafts))
	for _, draft := range drafts {
		seen[draft.DraftID] = struct{}{}
	}
	for rows.Next() {
		draft, err := scanCommunicationsEmailDraft(rows)
		if err != nil {
			return nil, err
		}
		if _, ok := seen[draft.DraftID]; !ok {
			seen[draft.DraftID] = struct{}{}
			drafts = append(drafts, draft)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(drafts, func(i, j int) bool { return drafts[i].UpdatedTimestamp.After(drafts[j].UpdatedTimestamp) })
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
from email_drafts
where company_id=$1::uuid and draft_id=$2 and deleted_timestamp is null
 and email_relationship_id is not null
 and exists (
  select 1 from email_relationships relationship
  where relationship.company_id=email_drafts.company_id
   and relationship.email_relationship_id=email_drafts.email_relationship_id
   and mangorts_user_can_access_resource(relationship.company_id,relationship.resource_type,
       relationship.resource_id,$3::uuid,'edit'))`, companyID, draftID, participantUserID))
}

func (r *PostgresRepo) upsertSharedCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	relationshipID := cleanUUIDText(input.CollaborationID)
	participantUserID := cleanUUIDText(input.ParticipantUserID)
	if companyID == "" || draftID == "" || relationshipID == "" || participantUserID == "" || input.ExpectedRevision < 0 {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	defer tx.Rollback()
	collaboration, err := postgresEmailCollaborationByID(ctx, tx, companyID, relationshipID, participantUserID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	var sourceEmailMessageID string
	if err := tx.QueryRowContext(ctx, `
select email_message_id::text from email_relationships
where company_id=$1::uuid and email_relationship_id=$2::uuid`,
		companyID, relationshipID).Scan(&sourceEmailMessageID); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	existing, existingErr := scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts where company_id=$1::uuid and draft_id=$2 for update`, companyID, draftID))
	if existingErr != nil && !errors.Is(existingErr, ErrNotFound) {
		return domain.CommunicationsEmailDraft{}, existingErr
	}
	if existingErr == nil && (existing.DeletedTimestamp != nil || !existing.IsShared || existing.CollaborationID != relationshipID) {
		return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
	}
	input, err = canonicalSharedEmailDraftInput(input, collaboration)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if existingErr == nil {
		if existing.SendState == communicationsEmailDraftSendStateSending {
			return domain.CommunicationsEmailDraft{}, ErrSendInProgress
		}
		if existing.Revision != input.ExpectedRevision {
			return domain.CommunicationsEmailDraft{}, versionConflict(existing.Revision)
		}
		draft, err = scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
update email_drafts set updated_by_user_id=nullif($3,'')::uuid,
 subject=$4,body_editor_html=$5,revision=revision+1,send_state='draft',
 send_claim_token='',send_idempotency_key='',send_idempotency_grant_id='',
 send_idempotency_timestamp=null,send_claimed_revision=0,send_claimed_timestamp=null,
 sent_email_message_id=null,sent_provider_message_id='',updated_timestamp=now(),deleted_timestamp=null
where company_id=$1::uuid and draft_id=$2
returning `+communicationsEmailDraftSelectColumns(),
			companyID, draftID, cleanUUIDText(input.UpdatedByUserID), draft.Subject, draft.BodyEditorHTML))
	} else {
		if input.ExpectedRevision != 0 {
			return domain.CommunicationsEmailDraft{}, versionConflict(0)
		}
		lockKey := companyID + ":" + relationshipID + ":" + sourceEmailMessageID
		if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, lockKey); err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		otherDraftID, err := postgresSharedEmailDraftWithSourceTx(ctx, tx, companyID, relationshipID, sourceEmailMessageID)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		if otherDraftID != "" && otherDraftID != draftID {
			return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
		}
		draft, err = scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
insert into email_drafts(
 company_id,draft_id,email_relationship_id,source_email_message_id,email_account_type,
 personal_user_id,personal_account_email,shared_inbox_id,sender_account_email,
 created_by_user_id,updated_by_user_id,kind,to_recipients,cc_recipients,bcc_recipients,
 subject,body_editor_html,scheduled_send_timestamp,revision,created_timestamp,updated_timestamp,deleted_timestamp
) values(
 $1::uuid,$2,$3::uuid,$4::uuid,case $5 when 'personal' then 'personal_email_account' else 'shared_email_account' end,nullif($6,'')::uuid,nullif($7,''),nullif($8,'')::uuid,$9,
 nullif($10,'')::uuid,nullif($11,'')::uuid,$12,$13,$14,$15,$16,$17,$18,1,now(),now(),null)
returning `+communicationsEmailDraftSelectColumns(),
			companyID, draftID, relationshipID, sourceEmailMessageID, draft.ScopeType,
			draft.PersonalUserID, draft.PersonalAccountEmail, draft.SharedInboxID, draft.AccountEmail,
			cleanUUIDText(input.CreatedByUserID), cleanUUIDText(input.UpdatedByUserID), draft.Kind,
			draft.ToRecipients, draft.CcRecipients, draft.BccRecipients, draft.Subject,
			draft.BodyEditorHTML, draft.ScheduledSendTimestamp))
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
	permission := `
exists (
 select 1 from email_relationships relationship
 where relationship.company_id=email_drafts.company_id
  and relationship.email_relationship_id=email_drafts.email_relationship_id
  and mangorts_user_can_access_resource(relationship.company_id,relationship.resource_type,
      relationship.resource_id,$3::uuid,'edit'))`
	result, err := r.db.Exec(`
update email_drafts set deleted_timestamp=now(),updated_timestamp=now(),
 updated_by_user_id=nullif($4,'')::uuid,revision=revision+1
where company_id=$1::uuid and draft_id=$2 and deleted_timestamp is null
 and email_relationship_id is not null
 and (send_state='draft' or (send_state='sending'
      and (send_claimed_timestamp is null or send_claimed_timestamp <= $6::timestamptz - interval '5 minutes')))
 and revision=$5::bigint and `+permission,
		companyID, draftID, participantUserID, cleanUUIDText(input.UpdatedByUserID), input.ExpectedRevision, now)
	if err != nil {
		return err
	}
	if rows, _ := result.RowsAffected(); rows > 0 {
		return nil
	}
	var currentRevision int64
	var sendState string
	var claimed sql.NullTime
	err = r.db.QueryRow(`
select revision,send_state,send_claimed_timestamp from email_drafts
where company_id=$1::uuid and draft_id=$2 and deleted_timestamp is null
 and email_relationship_id is not null and `+permission,
		companyID, draftID, participantUserID).Scan(&currentRevision, &sendState, &claimed)
	if err == nil {
		if currentRevision != input.ExpectedRevision {
			return versionConflict(currentRevision)
		}
		return ErrSendInProgress
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	return ErrNotFound
}
