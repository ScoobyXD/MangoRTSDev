package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *MemoryRepo) isSharedEmailDraftParticipantLocked(draft domain.CommunicationsEmailDraft, userID string) bool {
	if !draft.IsShared || strings.TrimSpace(draft.OriginNodeID) == "" || strings.TrimSpace(userID) == "" {
		return false
	}
	return r.userHasEffectiveAccessLocked(draft.CompanyID, userID, EntityTypeNode, draft.OriginNodeID, EntityPermissionEdit)
}

func (r *MemoryRepo) upsertSharedCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.DraftID = strings.TrimSpace(input.DraftID)
	input.ParticipantUserID = strings.TrimSpace(input.ParticipantUserID)
	input.OriginNodeID = cleanUUIDText(input.OriginNodeID)
	input.SourceMessageID = cleanUUIDText(input.SourceMessageID)
	if input.CompanyID == "" || input.DraftID == "" || input.ParticipantUserID == "" || input.OriginNodeID == "" || input.ExpectedRevision < 0 {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.userHasEffectiveAccessLocked(input.CompanyID, input.ParticipantUserID, EntityTypeNode, input.OriginNodeID, EntityPermissionEdit) {
		return domain.CommunicationsEmailDraft{}, ErrEmailDraftNodeAccessDenied
	}
	draftKey := communicationsEmailDraftKey(input.CompanyID, input.DraftID)
	existing, exists := r.emailDrafts[draftKey]
	if exists {
		if existing.DeletedTimestamp != nil || !existing.IsShared || existing.OriginNodeID != input.OriginNodeID {
			return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
		}
		input.SourceMessageID = existing.SourceMessageID
		input.EmailThreadID = existing.EmailThreadID
	}
	if input.SourceMessageID == "" {
		return domain.CommunicationsEmailDraft{}, ErrEmailReplySourceNotIngested
	}
	var thread domain.CommunicationsEmailThread
	for _, candidate := range r.emailThreads {
		if candidate.CompanyID != input.CompanyID {
			continue
		}
		for _, message := range candidate.Messages {
			if message.EmailMessageID == input.SourceMessageID {
				thread = candidate
				break
			}
		}
		if thread.EmailThreadID != "" {
			break
		}
	}
	if thread.EmailThreadID == "" {
		return domain.CommunicationsEmailDraft{}, ErrEmailDraftSourceNotFound
	}
	if requestedThreadID := cleanUUIDText(input.EmailThreadID); requestedThreadID != "" && requestedThreadID != thread.EmailThreadID {
		return domain.CommunicationsEmailDraft{}, ErrEmailDraftNodeMismatch
	}
	linked := false
	for _, link := range r.nodeEmailThreads {
		if link.CompanyID == input.CompanyID && link.NodeID == input.OriginNodeID && link.EmailThreadID == thread.EmailThreadID {
			linked = true
			break
		}
	}
	if !linked {
		return domain.CommunicationsEmailDraft{}, ErrEmailDraftNodeMismatch
	}
	context, err := sharedEmailDraftContextForThread(thread, input.SourceMessageID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, ErrEmailDraftSourceNotFound
	}
	input.EmailThreadID = thread.EmailThreadID
	if exists {
		if existing.DeletedTimestamp != nil || !existing.IsShared || existing.EmailThreadID != thread.EmailThreadID ||
			existing.OriginNodeID != input.OriginNodeID || existing.SourceMessageID != input.SourceMessageID {
			return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
		}
		if existing.SendState == communicationsEmailDraftSendStateSending {
			return domain.CommunicationsEmailDraft{}, ErrSendInProgress
		}
		if input.ExpectedRevision == 0 && existing.SourceMessageID == input.SourceMessageID {
			return existing, nil
		}
		input.SourceMessageID = existing.SourceMessageID
		input.ReplyToMessageJSON = existing.ReplyToMessageJSON
		input.AccountEmail = existing.AccountEmail
	}
	requestedSender := normalizeEmail(input.AccountEmail)
	if !exists && requestedSender != "" && requestedSender != normalizeEmail(context.AccountEmail) {
		connection, ok := r.emailConnections[emailConnectionKey(input.ParticipantUserID, requestedSender)]
		if !ok || connection.CompanyID != input.CompanyID || connection.Status != "connected" || strings.TrimSpace(connection.GrantID) == "" {
			return domain.CommunicationsEmailDraft{}, ErrEmailDraftSenderNotConnected
		}
	}

	input, err = canonicalSharedEmailDraftInput(input, context)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draft.EmailThreadID = thread.EmailThreadID
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
			if other.CompanyID == draft.CompanyID && other.IsShared && other.OriginNodeID == draft.OriginNodeID &&
				other.SourceMessageID == draft.SourceMessageID && other.DeletedTimestamp == nil {
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
	limit := input.Limit
	if limit <= 0 || limit > 5 {
		limit = 5
	}
	rows, err := r.db.Query(`
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts
where company_id=$1::uuid and deleted_timestamp is null
 and is_shared and origin_node_id is not null
 and mangorts_user_can_access_resource(email_drafts.company_id,'node',origin_node_id,$2::uuid,'edit')
 and ($3='' or origin_node_id=$3::uuid)
 and ($4='' or source_email_message_id=$4::uuid)
 and ($5::timestamptz is null or updated_timestamp < $5::timestamptz
      or (updated_timestamp=$5::timestamptz and draft_id>$6))
order by updated_timestamp desc,draft_id
limit $7`, strings.TrimSpace(input.CompanyID), participantUserID, cleanUUIDText(input.OriginNodeID),
		cleanUUIDText(input.SourceMessageID), input.BeforeUpdatedAt, strings.TrimSpace(input.BeforeDraftID), limit)
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
	 and is_shared and origin_node_id is not null
	 and mangorts_user_can_access_resource(email_drafts.company_id,'node',origin_node_id,$3::uuid,'edit')`, companyID, draftID, participantUserID))
	return draft, err
}

func (r *PostgresRepo) upsertSharedCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	draftID := strings.TrimSpace(input.DraftID)
	participantUserID := cleanUUIDText(input.ParticipantUserID)
	input.OriginNodeID = cleanUUIDText(input.OriginNodeID)
	input.SourceMessageID = cleanUUIDText(input.SourceMessageID)
	if companyID == "" || draftID == "" || participantUserID == "" || input.OriginNodeID == "" || input.ExpectedRevision < 0 {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	defer tx.Rollback()
	var nodeAccessible bool
	if err := tx.QueryRowContext(ctx, `
select exists (
 select 1 from nodes
 where company_id=$1::uuid and node_id=$2::uuid
   and mangorts_user_can_access_resource(company_id,'node',node_id,$3::uuid,'edit')
)`, companyID, input.OriginNodeID, participantUserID).Scan(&nodeAccessible); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if !nodeAccessible {
		return domain.CommunicationsEmailDraft{}, ErrEmailDraftNodeAccessDenied
	}
	existing, existingErr := scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
select `+communicationsEmailDraftSelectColumns()+`
from email_drafts where company_id=$1::uuid and draft_id=$2 for update`, companyID, draftID))
	if existingErr != nil && !errors.Is(existingErr, ErrNotFound) {
		return domain.CommunicationsEmailDraft{}, existingErr
	}
	if existingErr == nil {
		if existing.DeletedTimestamp != nil || !existing.IsShared || existing.OriginNodeID != input.OriginNodeID {
			return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
		}
		input.SourceMessageID = existing.SourceMessageID
		input.EmailThreadID = existing.EmailThreadID
	}
	if input.SourceMessageID == "" {
		return domain.CommunicationsEmailDraft{}, ErrEmailReplySourceNotIngested
	}
	var emailThreadID string
	if err := tx.QueryRowContext(ctx, `
select email_thread_id::text from email_messages
where company_id=$1::uuid and email_message_id=$2::uuid`, companyID, input.SourceMessageID).Scan(&emailThreadID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CommunicationsEmailDraft{}, ErrEmailDraftSourceNotFound
		}
		return domain.CommunicationsEmailDraft{}, err
	}
	if requestedThreadID := cleanUUIDText(input.EmailThreadID); requestedThreadID != "" && requestedThreadID != emailThreadID {
		return domain.CommunicationsEmailDraft{}, ErrEmailDraftNodeMismatch
	}
	var linked bool
	if err := tx.QueryRowContext(ctx, `
select exists (
 select 1 from email_relationships
 where company_id=$1::uuid and email_thread_id=$2::uuid
   and resource_type='node' and resource_id=$3::uuid and resource_textbox_id is null
)`, companyID, emailThreadID, input.OriginNodeID).Scan(&linked); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if !linked {
		return domain.CommunicationsEmailDraft{}, ErrEmailDraftNodeMismatch
	}
	thread, err := postgresCommunicationsEmailThreadByID(ctx, tx, companyID, emailThreadID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draftContext, err := sharedEmailDraftContextForThread(thread, input.SourceMessageID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, ErrEmailDraftSourceNotFound
	}
	input.EmailThreadID = emailThreadID
	if existingErr == nil && (existing.DeletedTimestamp != nil || !existing.IsShared || existing.EmailThreadID != emailThreadID ||
		existing.OriginNodeID != input.OriginNodeID || existing.SourceMessageID != input.SourceMessageID) {
		return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
	}
	if existingErr == nil && existing.SendState == communicationsEmailDraftSendStateSending {
		return domain.CommunicationsEmailDraft{}, ErrSendInProgress
	}
	if existingErr == nil && input.ExpectedRevision == 0 && existing.SourceMessageID == input.SourceMessageID {
		if err := tx.Commit(); err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		return existing, nil
	}
	if existingErr == nil {
		input.SourceMessageID = existing.SourceMessageID
		input.ReplyToMessageJSON = existing.ReplyToMessageJSON
		input.AccountEmail = existing.AccountEmail
	}
	requestedSender := normalizeEmail(input.AccountEmail)
	if existingErr != nil && requestedSender != "" && requestedSender != normalizeEmail(draftContext.AccountEmail) {
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
			return domain.CommunicationsEmailDraft{}, ErrEmailDraftSenderNotConnected
		}
	}
	input, err = canonicalSharedEmailDraftInput(input, draftContext)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	var sourceEmailMessageID string
	if err := tx.QueryRowContext(ctx, `
select email_message_id::text from email_messages
where company_id=$1::uuid and email_thread_id=$2::uuid and email_message_id=$3::uuid`,
		companyID, emailThreadID, input.SourceMessageID).Scan(&sourceEmailMessageID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CommunicationsEmailDraft{}, ErrEmailDraftSourceNotFound
		}
		return domain.CommunicationsEmailDraft{}, err
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
		lockKey := companyID + ":" + input.OriginNodeID + ":" + sourceEmailMessageID
		if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, lockKey); err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		otherDraftID, err := postgresSharedEmailDraftWithSourceTx(ctx, tx, companyID, input.OriginNodeID, sourceEmailMessageID)
		if err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		if otherDraftID != "" {
			existing, err := scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `select `+communicationsEmailDraftSelectColumns()+` from email_drafts where company_id=$1::uuid and draft_id=$2`, companyID, otherDraftID))
			if err != nil {
				return domain.CommunicationsEmailDraft{}, err
			}
			return existing, tx.Commit()
		}
		draft, err = scanCommunicationsEmailDraft(tx.QueryRowContext(ctx, `
insert into email_drafts(
	 company_id,draft_id,email_thread_id,origin_node_id,source_email_message_id,is_shared,email_account_type,
 personal_user_id,personal_account_email,shared_inbox_id,sender_account_email,
 created_by_user_id,updated_by_user_id,kind,to_recipients,cc_recipients,bcc_recipients,
 subject,body_editor_html,scheduled_send_timestamp,revision,created_timestamp,updated_timestamp,deleted_timestamp
) values(
	 $1::uuid,$2,$3::uuid,nullif($4,'')::uuid,$5::uuid,true,case $6 when 'personal' then 'personal_email_account' else 'shared_email_account' end,nullif($7,'')::uuid,nullif($8,''),nullif($9,'')::uuid,$10,
 nullif($11,'')::uuid,nullif($12,'')::uuid,$13,$14,$15,$16,$17,$18,$19,1,now(),now(),null)
returning `+communicationsEmailDraftSelectColumns(),
			companyID, draftID, emailThreadID, draft.OriginNodeID, sourceEmailMessageID, draft.ScopeType,
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
	permission := `origin_node_id is not null and
mangorts_user_can_access_resource(email_drafts.company_id,'node',origin_node_id,$3::uuid,'edit')`
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
	 and is_shared
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
	 and is_shared and `+permission,
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
