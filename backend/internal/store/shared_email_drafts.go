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
	if !draft.IsShared || strings.TrimSpace(draft.EmailThreadID) == "" || strings.TrimSpace(userID) == "" {
		return false
	}
	for _, collaboration := range r.emailCollaborations {
		if collaboration.CompanyID == draft.CompanyID && collaboration.EmailThreadID == draft.EmailThreadID &&
			r.userHasEffectiveAccessLocked(draft.CompanyID, userID, EntityTypeNode, collaboration.NodeID, EntityPermissionEdit) {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) upsertSharedCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.DraftID = strings.TrimSpace(input.DraftID)
	input.CollaborationID = strings.TrimSpace(input.CollaborationID)
	input.ParticipantUserID = strings.TrimSpace(input.ParticipantUserID)
	if input.CompanyID == "" || input.DraftID == "" || input.ParticipantUserID == "" || input.ExpectedRevision < 0 {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	var collaboration domain.CommunicationsEmailCollaboration
	if input.CollaborationID != "" {
		var ok bool
		collaboration, ok = r.emailCollaborations[key(input.CompanyID, input.CollaborationID)]
		if !ok || !r.userHasEffectiveAccessLocked(input.CompanyID, input.ParticipantUserID, EntityTypeNode, collaboration.NodeID, EntityPermissionEdit) {
			return domain.CommunicationsEmailDraft{}, ErrNotFound
		}
	} else {
		var thread domain.CommunicationsEmailThread
		for _, candidate := range r.emailThreads {
			if candidate.CompanyID != input.CompanyID {
				continue
			}
			if cleanUUIDText(input.EmailThreadID) == candidate.EmailThreadID {
				thread = candidate
				break
			}
			for _, message := range candidate.Messages {
				if message.EmailMessageID == cleanUUIDText(input.SourceMessageID) {
					thread = candidate
					break
				}
			}
			if thread.EmailThreadID != "" {
				break
			}
		}
		if thread.EmailThreadID == "" ||
			(thread.ScopeType == CommunicationsEmailCollaborationScopePersonal &&
				(thread.PersonalUserID != input.ParticipantUserID || thread.PersonalAccountEmail != normalizeEmail(input.PersonalAccountEmail))) ||
			(thread.ScopeType == CommunicationsEmailCollaborationScopeShared && !r.userHasEffectiveAccessLocked(input.CompanyID, input.ParticipantUserID, EntityTypeSharedInbox, thread.SharedInboxID, EntityPermissionEdit)) {
			return domain.CommunicationsEmailDraft{}, ErrNotFound
		}
		var err error
		collaboration, err = sharedEmailDraftContextForThread(thread, input.SourceMessageID)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
	}
	input.EmailThreadID = collaboration.EmailThreadID
	requestedSender := normalizeEmail(input.AccountEmail)
	if requestedSender != "" && requestedSender != normalizeEmail(collaboration.AccountEmail) {
		connection, ok := r.emailConnections[emailConnectionKey(input.ParticipantUserID, requestedSender)]
		if !ok || connection.CompanyID != input.CompanyID || connection.Status != "connected" || strings.TrimSpace(connection.GrantID) == "" {
			return domain.CommunicationsEmailDraft{}, ErrNotFound
		}
	}
	input.OriginNodeID = cleanUUIDText(input.OriginNodeID)
	if strings.TrimSpace(input.OriginNodeID) != "" && (collaboration.NodeID == "" || input.OriginNodeID != collaboration.NodeID) {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	draftKey := communicationsEmailDraftKey(input.CompanyID, input.DraftID)
	existing, exists := r.emailDrafts[draftKey]
	if exists {
		if existing.DeletedTimestamp != nil || !existing.IsShared || existing.EmailThreadID != collaboration.EmailThreadID {
			return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
		}
		if existing.SendState == communicationsEmailDraftSendStateSending {
			return domain.CommunicationsEmailDraft{}, ErrSendInProgress
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
	draft.CollaborationID = input.CollaborationID
	draft.EmailThreadID = collaboration.EmailThreadID
	draft.OriginNodeID = input.OriginNodeID
	draft.IsShared = true

	now := time.Now().UTC()
	if exists {
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
			if other.CompanyID == draft.CompanyID && other.IsShared && other.EmailThreadID == draft.EmailThreadID && other.DeletedTimestamp == nil {
				other.CollaborationID = collaboration.CollaborationID
				return other, nil
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
 and email_thread_id is not null
 and exists (
  select 1 from email_relationships relationship
  where relationship.company_id=email_drafts.company_id
   and relationship.email_thread_id=email_drafts.email_thread_id
   and relationship.resource_type='node'
   and relationship.resource_textbox_id is null
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
			draft.CollaborationID, _ = postgresAccessibleEmailCollaborationIDForThread(context.Background(), r.db, draft.CompanyID, draft.EmailThreadID, participantUserID)
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
	draft, err := scanCommunicationsEmailDraft(r.db.QueryRow(`
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id=$1::uuid and draft_id=$2 and deleted_timestamp is null
 and email_thread_id is not null
 and exists (
  select 1 from email_relationships relationship
  where relationship.company_id=email_drafts.company_id
   and relationship.email_thread_id=email_drafts.email_thread_id
   and relationship.resource_type='node'
   and relationship.resource_textbox_id is null
   and mangorts_user_can_access_resource(relationship.company_id,relationship.resource_type,
       relationship.resource_id,$3::uuid,'edit'))`, companyID, draftID, participantUserID))
	if err == nil {
		draft.CollaborationID, _ = postgresAccessibleEmailCollaborationIDForThread(context.Background(), r.db, companyID, draft.EmailThreadID, participantUserID)
	}
	return draft, err
}

func postgresAccessibleEmailCollaborationIDForThread(ctx context.Context, q emailCollaborationQueryer, companyID, emailThreadID, participantUserID string) (string, error) {
	var relationshipID string
	err := q.QueryRowContext(ctx, `
select relationship.email_relationship_id::text
from email_relationships relationship
where relationship.company_id=$1::uuid and relationship.email_thread_id=$2::uuid
 and relationship.resource_type='node' and relationship.resource_textbox_id is null
 and mangorts_user_can_access_resource(relationship.company_id,relationship.resource_type,
     relationship.resource_id,$3::uuid,'edit')
order by relationship.created_timestamp,relationship.email_relationship_id
limit 1`, companyID, emailThreadID, participantUserID).Scan(&relationshipID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return relationshipID, err
}

func (r *PostgresRepo) upsertSharedCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	relationshipID := cleanUUIDText(input.CollaborationID)
	participantUserID := cleanUUIDText(input.ParticipantUserID)
	if companyID == "" || draftID == "" || participantUserID == "" || input.ExpectedRevision < 0 {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	defer tx.Rollback()
	var collaboration domain.CommunicationsEmailCollaboration
	if relationshipID != "" {
		collaboration, err = postgresEmailCollaborationByID(ctx, tx, companyID, relationshipID, participantUserID)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
	} else {
		var emailThreadID string
		if err := tx.QueryRowContext(ctx, `
select email_thread_id::text from email_messages
where company_id=$1::uuid and email_message_id=$2::uuid`, companyID, cleanUUIDText(input.SourceMessageID)).Scan(&emailThreadID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return domain.CommunicationsEmailDraft{}, ErrNotFound
			}
			return domain.CommunicationsEmailDraft{}, err
		}
		thread, err := postgresCommunicationsEmailThreadByID(ctx, tx, companyID, emailThreadID)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		if (thread.ScopeType == CommunicationsEmailCollaborationScopePersonal &&
			(thread.PersonalUserID != participantUserID || thread.PersonalAccountEmail != normalizeEmail(input.PersonalAccountEmail))) ||
			(thread.ScopeType == CommunicationsEmailCollaborationScopeShared && thread.SharedInboxID != cleanUUIDText(input.SharedInboxID)) {
			return domain.CommunicationsEmailDraft{}, ErrNotFound
		}
		collaboration, err = sharedEmailDraftContextForThread(thread, input.SourceMessageID)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
	}
	input.EmailThreadID = collaboration.EmailThreadID
	requestedSender := normalizeEmail(input.AccountEmail)
	if requestedSender != "" && requestedSender != normalizeEmail(collaboration.AccountEmail) {
		var authorized bool
		if err := tx.QueryRowContext(ctx, `
select exists (
 select 1 from email_connections
 where company_id=$1::uuid and connection_type='personal'
  and personal_user_id=$2::uuid and account_email=$3
  and status='connected' and grant_id<>'')`, companyID, participantUserID, requestedSender).Scan(&authorized); err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		if !authorized {
			return domain.CommunicationsEmailDraft{}, ErrNotFound
		}
	}
	input.OriginNodeID = cleanUUIDText(input.OriginNodeID)
	if strings.TrimSpace(input.OriginNodeID) != "" && (collaboration.NodeID == "" || input.OriginNodeID != collaboration.NodeID) {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	input, err = canonicalSharedEmailDraftInput(input, collaboration)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	var sourceEmailMessageID string
	if err := tx.QueryRowContext(ctx, `
select email_message_id::text from email_messages
where company_id=$1::uuid and email_thread_id=$2::uuid and email_message_id=$3::uuid`,
		companyID, collaboration.EmailThreadID, input.SourceMessageID).Scan(&sourceEmailMessageID); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	existing, existingErr := scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts where company_id=$1::uuid and draft_id=$2 for update`, companyID, draftID))
	if existingErr != nil && !errors.Is(existingErr, ErrNotFound) {
		return domain.CommunicationsEmailDraft{}, existingErr
	}
	if existingErr == nil && (existing.DeletedTimestamp != nil || !existing.IsShared || existing.EmailThreadID != collaboration.EmailThreadID) {
		return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
	}
	if existingErr == nil && existing.SendState == communicationsEmailDraftSendStateSending {
		return domain.CommunicationsEmailDraft{}, ErrSendInProgress
	}
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if existingErr == nil {
		if existing.Revision != input.ExpectedRevision {
			return domain.CommunicationsEmailDraft{}, versionConflict(existing.Revision)
		}
		draft, err = scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
update email_drafts set updated_by_user_id=nullif($3,'')::uuid,
 sender_account_email=$4,to_recipients=$5,cc_recipients=$6,bcc_recipients=$7,
 subject=$8,body_editor_html=$9,revision=revision+1,send_state='draft',
 send_claim_token='',send_idempotency_key='',send_idempotency_grant_id='',
 send_idempotency_timestamp=null,send_claimed_revision=0,send_claimed_timestamp=null,
 sent_email_message_id=null,sent_provider_message_id='',updated_timestamp=now(),deleted_timestamp=null
where company_id=$1::uuid and draft_id=$2
returning `+communicationsEmailDraftSelectColumns(),
			companyID, draftID, cleanUUIDText(input.UpdatedByUserID), draft.AccountEmail,
			draft.ToRecipients, draft.CcRecipients, draft.BccRecipients, draft.Subject, draft.BodyEditorHTML))
	} else {
		if input.ExpectedRevision != 0 {
			return domain.CommunicationsEmailDraft{}, versionConflict(0)
		}
		lockKey := companyID + ":" + collaboration.EmailThreadID
		if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, lockKey); err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		otherDraftID, err := postgresSharedEmailDraftWithSourceTx(ctx, tx, companyID, collaboration.EmailThreadID)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		if otherDraftID != "" && otherDraftID != draftID {
			existing, err := scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `select `+communicationsEmailDraftSelectColumns()+` from email_drafts where company_id=$1::uuid and draft_id=$2`, companyID, otherDraftID))
			if err != nil {
				return domain.CommunicationsEmailDraft{}, err
			}
			existing.CollaborationID = relationshipID
			return existing, tx.Commit()
		}
		draft, err = scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
insert into email_drafts(
 company_id,draft_id,email_thread_id,origin_node_id,source_email_message_id,email_account_type,
 personal_user_id,personal_account_email,shared_inbox_id,sender_account_email,
 created_by_user_id,updated_by_user_id,kind,to_recipients,cc_recipients,bcc_recipients,
 subject,body_editor_html,scheduled_send_timestamp,revision,created_timestamp,updated_timestamp,deleted_timestamp
) values(
 $1::uuid,$2,$3::uuid,nullif($4,'')::uuid,$5::uuid,case $6 when 'personal' then 'personal_email_account' else 'shared_email_account' end,nullif($7,'')::uuid,nullif($8,''),nullif($9,'')::uuid,$10,
 nullif($11,'')::uuid,nullif($12,'')::uuid,$13,$14,$15,$16,$17,$18,$19,1,now(),now(),null)
returning `+communicationsEmailDraftSelectColumns(),
			companyID, draftID, collaboration.EmailThreadID, draft.OriginNodeID, sourceEmailMessageID, draft.ScopeType,
			draft.PersonalUserID, draft.PersonalAccountEmail, draft.SharedInboxID, draft.AccountEmail,
			cleanUUIDText(input.CreatedByUserID), cleanUUIDText(input.UpdatedByUserID), draft.Kind,
			draft.ToRecipients, draft.CcRecipients, draft.BccRecipients, draft.Subject,
			draft.BodyEditorHTML, draft.ScheduledSendTimestamp))
	}
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draft.CollaborationID = relationshipID
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
  and relationship.email_thread_id=email_drafts.email_thread_id
  and relationship.resource_type='node'
  and relationship.resource_textbox_id is null
  and mangorts_user_can_access_resource(relationship.company_id,relationship.resource_type,
      relationship.resource_id,$3::uuid,'edit'))`
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
update email_drafts set deleted_timestamp=now(),updated_timestamp=now(),
 updated_by_user_id=nullif($4,'')::uuid,revision=revision+1
where company_id=$1::uuid and draft_id=$2 and deleted_timestamp is null
 and email_thread_id is not null
 and (send_state='draft' or (send_state='sending'
      and (send_claimed_timestamp is null or send_claimed_timestamp <= $6::timestamptz - interval '5 minutes')))
 and revision=$5::bigint and `+permission,
		companyID, draftID, participantUserID, cleanUUIDText(input.UpdatedByUserID), input.ExpectedRevision, now)
	if err != nil {
		return err
	}
	if rows, _ := result.RowsAffected(); rows > 0 {
		if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, "email_draft", draftID); err != nil {
			return err
		}
		return tx.Commit()
	}
	var currentRevision int64
	var sendState string
	var claimed sql.NullTime
	err = tx.QueryRowContext(ctx, `
select revision,send_state,send_claimed_timestamp from email_drafts
where company_id=$1::uuid and draft_id=$2 and deleted_timestamp is null
 and email_thread_id is not null and `+permission,
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
