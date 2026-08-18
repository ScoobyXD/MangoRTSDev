package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func normalizeCommunicationsTriageAtomicWrites(input *CommunicationsTriageConversionInput) error {
	if input.LinkedTextBlock == nil && input.InitialChat == nil {
		return nil
	}
	if input.Target.Mode != CommunicationsEmailConversionTargetExistingNode || len(input.MessageIDs) != 1 {
		return ErrInvalid
	}
	normalize := func(value *NodeInformationInput, expectedType string) error {
		value.CompanyID = input.CompanyID
		value.NodeID = input.NodeID
		value.Type = strings.TrimSpace(value.Type)
		value.Information = strings.TrimSpace(value.Information)
		value.InformationID = cleanUUIDText(value.InformationID)
		value.ActorUserID = cleanUUIDText(value.ActorUserID)
		value.ActorDisplayName = strings.TrimSpace(value.ActorDisplayName)
		if value.Type != expectedType || value.Information == "" || value.InformationID == "" {
			return ErrInvalid
		}
		return nil
	}
	if input.LinkedTextBlock != nil {
		if err := normalize(input.LinkedTextBlock, "Text box"); err != nil {
			return err
		}
		information := strings.TrimSpace(strings.TrimPrefix(input.LinkedTextBlock.Information, editorTextBlockProjectionPrefix))
		var payload map[string]any
		if json.Unmarshal([]byte(information), &payload) != nil {
			return ErrInvalid
		}
		if _, exists := payload["email_message_id"]; exists {
			return ErrInvalid
		}
		if _, exists := payload["email_message_ids"]; exists {
			return ErrInvalid
		}
	}
	if input.InitialChat != nil {
		if err := normalize(input.InitialChat, CommunicationsEmailCollaborationChatInformationType); err != nil {
			return err
		}
	}
	return nil
}

func communicationsEmailThreadInputForConversionMessage(input CommunicationsTriageConversionInput, message domain.EmailMessageSnapshot) CommunicationsEmailThreadUpsertInput {
	for _, candidate := range input.EmailThreads {
		if strings.TrimSpace(candidate.SelectedMessageID) == strings.TrimSpace(message.ID) {
			return candidate
		}
	}
	thread := CommunicationsEmailThreadUpsertInput{
		CompanyID: input.CompanyID, AccountEmail: input.AccountEmail,
		ProviderThreadID: message.ThreadID, SelectedMessageID: message.ID,
		Messages: []domain.EmailMessageSnapshot{message}, HistoryComplete: message.ThreadID == "",
		FetchedAt: time.Now().UTC(),
	}
	if strings.TrimSpace(input.SharedInboxID) != "" {
		thread.SharedInboxID = input.SharedInboxID
	} else {
		thread.PersonalUserID = input.UserID
		thread.PersonalAccountEmail = input.AccountEmail
	}
	return thread
}

type communicationsEmailTextBoxChatWriteInput struct {
	CompanyID         string
	UserID            string
	SharedInboxID     string
	AccountEmail      string
	NodeID            string
	ProviderMessageID string
	LinkedTextBlock   *NodeInformationInput
	InitialChat       *NodeInformationInput
}

func communicationsEmailTextBoxChatWriteInputFromConversion(input CommunicationsTriageConversionInput) communicationsEmailTextBoxChatWriteInput {
	providerMessageID := ""
	if len(input.MessageIDs) > 0 {
		providerMessageID = input.MessageIDs[0]
	}
	return communicationsEmailTextBoxChatWriteInput{
		CompanyID: input.CompanyID, UserID: input.UserID, SharedInboxID: input.SharedInboxID,
		AccountEmail: input.AccountEmail, NodeID: input.NodeID, ProviderMessageID: providerMessageID,
		LinkedTextBlock: input.LinkedTextBlock, InitialChat: input.InitialChat,
	}
}

func rewriteCommunicationsEmailTextBoxChatMessageID(input *communicationsEmailTextBoxChatWriteInput, emailMessageID string) error {
	emailMessageID = cleanUUIDText(emailMessageID)
	if emailMessageID == "" {
		return ErrInvalid
	}
	if input.InitialChat == nil {
		return nil
	}
	var payload map[string]any
	if json.Unmarshal([]byte(strings.TrimSpace(input.InitialChat.Information)), &payload) != nil {
		return ErrInvalid
	}
	payload["selection_message_id"] = emailMessageID
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	input.InitialChat.Information = string(raw)
	return nil
}

func communicationsEmailInitialChatTextboxID(initialChat *NodeInformationInput) (string, error) {
	if initialChat == nil {
		return "", ErrInvalid
	}
	var payload textboxChatPayload
	if err := json.Unmarshal([]byte(strings.TrimSpace(initialChat.Information)), &payload); err != nil {
		return "", ErrInvalid
	}
	textboxID := cleanUUIDText(payload.BlockID)
	if textboxID == "" {
		return "", ErrInvalid
	}
	return textboxID, nil
}

func (r *MemoryRepo) linkCommunicationsEmailMessageToTextboxLocked(input communicationsEmailTextBoxChatWriteInput, emailMessageID, textboxID string) error {
	emailMessageID = cleanUUIDText(emailMessageID)
	textboxID = cleanUUIDText(textboxID)
	if emailMessageID == "" || textboxID == "" {
		return ErrInvalid
	}
	projectionKey := key(input.CompanyID, input.NodeID)
	projections := r.nodeText[projectionKey]
	target, targetExists := projections[textboxID]
	if !targetExists || !isEditorTextBoxType(target.Type) {
		return ErrNotFound
	}
	for _, projection := range projections {
		if !strings.EqualFold(strings.TrimSpace(projection.Type), "Attached email") {
			continue
		}
		var payload emailTextboxRelationshipPayload
		if json.Unmarshal([]byte(projection.Information), &payload) != nil || cleanUUIDText(payload.EmailMessageID) != emailMessageID {
			continue
		}
		linkedTextboxID := cleanUUIDText(payload.BlockID)
		linkedTextbox, linkedTextboxExists := projections[linkedTextboxID]
		if linkedTextboxID == "" || !linkedTextboxExists || !isEditorTextBoxType(linkedTextbox.Type) {
			continue
		}
		if linkedTextboxID != textboxID {
			return ErrEmailMessageTextboxConflict
		}
		return nil
	}
	var selectedMessage domain.CommunicationsEmailMessage
	var selectedThread domain.CommunicationsEmailThread
	found := false
	for _, relationship := range r.nodeEmailThreads {
		if relationship.CompanyID != input.CompanyID || relationship.NodeID != input.NodeID {
			continue
		}
		thread, ok := r.emailThreads[key(input.CompanyID, relationship.EmailThreadID)]
		if !ok {
			continue
		}
		for _, message := range thread.Messages {
			if message.EmailMessageID == emailMessageID {
				selectedMessage, selectedThread, found = message, thread, true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		return ErrEmailMessageNotAttachedToNode
	}
	snapshot := selectedMessage.Message
	snapshot.EmailMessageID = selectedMessage.EmailMessageID
	information := attachedEmailProjectionInformationWithThread(
		snapshot, selectedThread.SharedInboxID, selectedThread.AccountEmail,
		selectedThread.EmailThreadID, time.Now().UTC(), true,
	)
	var payload map[string]any
	if json.Unmarshal([]byte(information), &payload) != nil {
		return ErrInvalid
	}
	payload["block_id"] = textboxID
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	relationshipID := newUUIDv7String()
	projections[relationshipID] = domain.NodeProjection{
		CompanyID: input.CompanyID, NodeID: input.NodeID, InformationID: relationshipID,
		Type: "Attached email", Information: string(raw), CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	r.nodeInfo[projectionKey] = append(r.nodeInfo[projectionKey], domain.NodeInformation{
		CompanyID: input.CompanyID, NodeID: input.NodeID, InformationID: relationshipID,
		Type: "Attached email", Information: string(raw), CreatedTimestamp: now, UpdatedTimestamp: now,
	})
	return nil
}

func linkPostgresCommunicationsEmailMessageToExistingTextboxTx(
	ctx context.Context,
	tx *sql.Tx,
	input communicationsEmailTextBoxChatWriteInput,
	emailMessageID string,
) error {
	textboxID, err := communicationsEmailInitialChatTextboxID(input.InitialChat)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,
  resource_type,resource_id,resource_textbox_id,created_timestamp
)
select relationship.company_id,gen_random_uuid(),relationship.email_thread_id,relationship.email_message_id,
       'node',relationship.resource_id,textbox.textbox_id::text,clock_timestamp()
from email_relationships relationship
join node_textboxes textbox
  on textbox.company_id=relationship.company_id
 and textbox.node_id=relationship.resource_id
 and textbox.textbox_id=$3::uuid
 and textbox.deleted_timestamp is null
where relationship.company_id=$1::uuid and relationship.resource_type='node'
  and relationship.resource_id=$2::uuid and relationship.email_message_id=$4::uuid
  and relationship.resource_textbox_id is null
order by relationship.created_timestamp desc
limit 1
on conflict do nothing`, input.CompanyID, input.NodeID, textboxID, emailMessageID)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 1 {
		return nil
	}
	var existingTextboxID string
	err = tx.QueryRowContext(ctx, `
select resource_textbox_id
from email_relationships
where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid
  and email_message_id=$3::uuid and resource_textbox_id is not null
limit 1`, input.CompanyID, input.NodeID, emailMessageID).Scan(&existingTextboxID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrEmailMessageNotAttachedToNode
	}
	if err != nil {
		return err
	}
	if existingTextboxID != textboxID {
		return ErrEmailMessageTextboxConflict
	}
	return nil
}

func (r *MemoryRepo) communicationsEmailTextBoxChatInternalMessageIDLocked(input communicationsEmailTextBoxChatWriteInput) string {
	providerMessageID := strings.TrimSpace(input.ProviderMessageID)
	for _, relationship := range r.nodeEmailThreads {
		if relationship.CompanyID != input.CompanyID || relationship.NodeID != input.NodeID {
			continue
		}
		thread, ok := r.emailThreads[key(input.CompanyID, relationship.EmailThreadID)]
		if !ok {
			continue
		}
		if input.SharedInboxID != "" && thread.SharedInboxID != input.SharedInboxID {
			continue
		}
		if input.SharedInboxID == "" && (thread.PersonalUserID != input.UserID || thread.PersonalAccountEmail != normalizeEmail(input.AccountEmail)) {
			continue
		}
		for _, message := range thread.Messages {
			if message.ProviderMessageID == providerMessageID {
				return message.EmailMessageID
			}
		}
	}
	return ""
}
func (r *MemoryRepo) addCommunicationsConversionInformationLocked(input NodeInformationInput) (domain.NodeInformation, error) {

	item := r.addEmailCollaborationNodeInformationLocked(input)
	if input.Type == CommunicationsEmailCollaborationChatInformationType {
		outboxInput, err := nodeChatCreatedOutboxInput(item, input.InformationID)
		if err != nil {
			return domain.NodeInformation{}, err
		}
		if _, err := r.enqueueRealtimeOutboxLocked(outboxInput); err != nil {
			return domain.NodeInformation{}, err
		}
	}
	return item, nil
}

func (r *PostgresRepo) addCommunicationsConversionInformationTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput) (domain.NodeInformation, error) {
	if isEditorTextBoxType(input.Type) {
		return r.addInitialNodeInformationTx(ctx, tx, input)
	}
	item, err := addEmailCollaborationNodeInformationTx(ctx, tx, input)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	if input.Type == CommunicationsEmailCollaborationChatInformationType {
		outboxInput, err := nodeChatCreatedOutboxInput(item, input.InformationID)
		if err != nil {
			return domain.NodeInformation{}, err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
			return domain.NodeInformation{}, err
		}
	}
	return item, nil
}

func (r *MemoryRepo) addCommunicationsEmailTextBoxChatWritesLocked(input communicationsEmailTextBoxChatWriteInput, result *CommunicationsTriageConversionResult) error {
	if input.LinkedTextBlock == nil && input.InitialChat == nil {
		return nil
	}
	emailMessageID := r.communicationsEmailTextBoxChatInternalMessageIDLocked(input)
	if err := rewriteCommunicationsEmailTextBoxChatMessageID(&input, emailMessageID); err != nil {
		return err
	}
	if input.LinkedTextBlock != nil {
		if _, err := r.addCommunicationsConversionInformationLocked(*input.LinkedTextBlock); err != nil {
			return err
		}
		if err := r.linkCommunicationsEmailMessageToTextboxLocked(input, emailMessageID, input.LinkedTextBlock.InformationID); err != nil {
			return err
		}
		result.LinkedTextBlockID = input.LinkedTextBlock.InformationID
	}
	if input.InitialChat != nil {
		if input.LinkedTextBlock == nil {
			textboxID, err := communicationsEmailInitialChatTextboxID(input.InitialChat)
			if err != nil {
				return err
			}
			if err := r.linkCommunicationsEmailMessageToTextboxLocked(input, emailMessageID, textboxID); err != nil {
				return err
			}
		}
		if _, err := r.addCommunicationsConversionInformationLocked(*input.InitialChat); err != nil {
			return err
		}
		result.InitialChatID = input.InitialChat.InformationID
	}
	return nil
}

func (r *PostgresRepo) addCommunicationsEmailTextBoxChatWritesTx(ctx context.Context, tx *sql.Tx, input communicationsEmailTextBoxChatWriteInput, result *CommunicationsTriageConversionResult) error {
	if input.LinkedTextBlock == nil && input.InitialChat == nil {
		return nil
	}
	var emailMessageID string
	err := tx.QueryRowContext(ctx, `
select relationship.email_message_id::text
from email_relationships relationship
join email_messages message on message.company_id=relationship.company_id and message.email_message_id=relationship.email_message_id
join email_threads thread on thread.company_id=relationship.company_id and thread.email_thread_id=relationship.email_thread_id
join email_connections connection on connection.company_id=thread.company_id
 and connection.email_connection_id=thread.email_connection_id
left join shared_inboxes inbox on inbox.company_id=thread.company_id
 and inbox.company_email_connection_id=thread.email_connection_id
where relationship.company_id=$1::uuid and relationship.resource_type='node' and relationship.resource_id=$2::uuid
  and relationship.resource_textbox_id is null and message.provider_message_id=$3
  and (($4<>'' and inbox.shared_inbox_id=nullif($4,'')::uuid)
    or ($4='' and connection.connection_type='personal'
      and connection.personal_user_id=$5::uuid and connection.account_email=$6))
order by relationship.created_timestamp desc
limit 1`, input.CompanyID, input.NodeID, input.ProviderMessageID, input.SharedInboxID, input.UserID, normalizeEmail(input.AccountEmail)).Scan(&emailMessageID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := rewriteCommunicationsEmailTextBoxChatMessageID(&input, emailMessageID); err != nil {
		return err
	}
	if input.LinkedTextBlock != nil {
		if _, err := r.addCommunicationsConversionInformationTx(ctx, tx, *input.LinkedTextBlock); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,
  resource_type,resource_id,resource_textbox_id,created_timestamp
)
select company_id,gen_random_uuid(),email_thread_id,email_message_id,
       'node',resource_id,$3::text,clock_timestamp()
from email_relationships
where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid
  and email_message_id=$4::uuid and resource_textbox_id is null
order by created_timestamp desc
limit 1
on conflict do nothing`, input.CompanyID, input.NodeID, input.LinkedTextBlock.InformationID, emailMessageID); err != nil {
			return err
		}
		result.LinkedTextBlockID = input.LinkedTextBlock.InformationID
	}
	if input.InitialChat != nil {
		if input.LinkedTextBlock == nil {
			if err := linkPostgresCommunicationsEmailMessageToExistingTextboxTx(ctx, tx, input, emailMessageID); err != nil {
				return err
			}
		}
		if _, err := r.addCommunicationsConversionInformationTx(ctx, tx, *input.InitialChat); err != nil {
			return err
		}
		result.InitialChatID = input.InitialChat.InformationID
	}
	return nil
}

func (r *MemoryRepo) persistCommunicationsConversionEmailLocked(input CommunicationsTriageConversionInput, message domain.EmailMessageSnapshot, now time.Time) (string, string, string, error) {
	threadInput := communicationsEmailThreadInputForConversionMessage(input, message)
	thread, err := r.upsertCommunicationsEmailThreadLocked(threadInput)
	if err != nil {
		return "", "", "", err
	}
	informationID := r.addEmailProjectionWithThreadLocked(input.CompanyID, input.NodeID, input.SharedInboxID, input.AccountEmail, message, thread.EmailThreadID, now, input.Target.Mode != CommunicationsEmailConversionTargetExistingNode)
	if _, err := r.linkCommunicationsEmailThreadToNodeLocked(input.CompanyID, input.NodeID, informationID, thread.EmailThreadID, message.ID, input.ActorUserID, now); err != nil {
		return "", "", "", err
	}
	if requestedMessageID, sourceID, ok := communicationsEmailIngestionRequest(thread, threadInput); ok && thread.EmailConnectionID != "" {
		if emailConnectionID := r.emailConnectionIDForThreadLocked(thread); emailConnectionID != "" {
			if _, _, err := r.ensureCommunicationsEmailIngestionJobLocked(CommunicationsEmailIngestionJobInput{
				CompanyID: input.CompanyID, EmailConnectionID: emailConnectionID, EmailThreadID: thread.EmailThreadID,
				ProviderMessageID: requestedMessageID, ProviderThreadID: thread.ProviderThreadID, Priority: CommunicationsEmailIngestionPriorityVisible,
				EnqueueSourceID: sourceID,
			}); err != nil {
				return "", "", "", err
			}
		}
	}
	return informationID, thread.EmailThreadID, internalEmailMessageIDForProvider(thread, message.ID), nil
}
func (r *PostgresRepo) persistCommunicationsConversionEmailTx(ctx context.Context, tx *sql.Tx, input CommunicationsTriageConversionInput, message domain.EmailMessageSnapshot, now time.Time) (string, string, string, error) {
	threadInput := communicationsEmailThreadInputForConversionMessage(input, message)
	thread, err := upsertPostgresCommunicationsEmailThreadTx(ctx, tx, threadInput)
	if err != nil {
		return "", "", "", err
	}
	relationshipID, err := addEmailProjectionSQLWithThread(ctx, tx, input.CompanyID, input.NodeID,
		input.SharedInboxID, input.AccountEmail, message, thread.EmailThreadID, now,
		input.Target.Mode != CommunicationsEmailConversionTargetExistingNode)
	if err != nil {
		return "", "", "", err
	}
	if requestedMessageID, sourceID, ok := communicationsEmailIngestionRequest(thread, threadInput); ok {
		if _, _, err := ensurePostgresCommunicationsEmailIngestionJobTx(ctx, tx, CommunicationsEmailIngestionJobInput{
			CompanyID: input.CompanyID, EmailConnectionID: thread.EmailConnectionID, EmailThreadID: thread.EmailThreadID,
			ProviderMessageID: requestedMessageID, ProviderThreadID: thread.ProviderThreadID, Priority: CommunicationsEmailIngestionPriorityVisible,
			EnqueueSourceID: sourceID,
		}); err != nil {
			return "", "", "", err
		}
	}
	return relationshipID, thread.EmailThreadID, internalEmailMessageIDForProvider(thread, message.ID), nil
}
