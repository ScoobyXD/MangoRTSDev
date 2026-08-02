package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func normalizeCommunicationsTriageAtomicWrites(input *CommunicationsTriageConversionInput) error {
	if input.LinkedTextBlock == nil && input.InitialChat == nil {
		return nil
	}
	if input.Target.Mode != CommunicationsEmailConversionTargetExistingNode || len(input.MessageIDs) != 1 || input.LinkedTextBlock == nil {
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
	if err := normalize(input.LinkedTextBlock, "Text box"); err != nil {
		return err
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

func (r *MemoryRepo) addCommunicationsConversionInformationLocked(input NodeInformationInput) (domain.NodeInformation, error) {
	if input.Type == CommunicationsEmailCollaborationChatInformationType {
		if collaboration, ok := r.emailCollaborationForNodeLocked(input.CompanyID, input.NodeID); ok {
			mentionedUserIDs, mentionedGroupIDs := CommunicationsEmailChatMentionPrincipalIDs(input.Information)
			if _, err := r.addCollaborationParticipantsLocked(CommunicationsEmailCollaborationParticipantInput{
				CompanyID: input.CompanyID, CollaborationID: collaboration.CollaborationID, ActorUserID: input.ActorUserID,
				MentionedUserIDs: mentionedUserIDs, MentionedGroupIDs: mentionedGroupIDs,
			}); err != nil {
				return domain.NodeInformation{}, err
			}
		}
	}
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
	if input.Type == CommunicationsEmailCollaborationChatInformationType {
		target, err := lockPostgresEmailCollaborationTarget(ctx, tx, input.CompanyID, "", input.NodeID)
		if err == nil {
			if _, err := addPostgresEmailCollaborationChatParticipantsTx(ctx, tx, input, target); err != nil {
				return domain.NodeInformation{}, err
			}
		} else if !errors.Is(err, ErrNotFound) {
			return domain.NodeInformation{}, err
		}
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

func (r *MemoryRepo) addCommunicationsConversionAtomicWritesLocked(input CommunicationsTriageConversionInput, result *CommunicationsTriageConversionResult) error {
	if input.LinkedTextBlock == nil {
		return nil
	}
	item, err := r.addCommunicationsConversionInformationLocked(*input.LinkedTextBlock)
	if err != nil {
		return err
	}
	result.LinkedTextBlockID = input.LinkedTextBlock.InformationID
	if input.InitialChat != nil {
		chat, err := r.addCommunicationsConversionInformationLocked(*input.InitialChat)
		if err != nil {
			return err
		}
		_ = chat
		result.InitialChatID = input.InitialChat.InformationID
	}
	_ = item
	return nil
}

func (r *PostgresRepo) addCommunicationsConversionAtomicWritesTx(ctx context.Context, tx *sql.Tx, input CommunicationsTriageConversionInput, result *CommunicationsTriageConversionResult) error {
	if input.LinkedTextBlock == nil {
		return nil
	}
	if _, err := r.addCommunicationsConversionInformationTx(ctx, tx, *input.LinkedTextBlock); err != nil {
		return err
	}
	result.LinkedTextBlockID = input.LinkedTextBlock.InformationID
	if input.InitialChat != nil {
		if _, err := r.addCommunicationsConversionInformationTx(ctx, tx, *input.InitialChat); err != nil {
			return err
		}
		result.InitialChatID = input.InitialChat.InformationID
	}
	return nil
}

func (r *MemoryRepo) persistCommunicationsConversionEmailLocked(input CommunicationsTriageConversionInput, message domain.EmailMessageSnapshot, now time.Time) (string, string, error) {
	threadInput := communicationsEmailThreadInputForConversionMessage(input, message)
	thread, err := r.upsertCommunicationsEmailThreadLocked(threadInput)
	if strings.TrimSpace(input.AccountEmail) == "" {
		informationID := r.addEmailProjectionWithThreadLocked(input.CompanyID, input.NodeID, input.SharedInboxID, input.AccountEmail, message, "", now, input.Target.Mode != CommunicationsEmailConversionTargetExistingNode)
		return informationID, "", nil
	}
	if err != nil {
		return "", "", err
	}
	informationID := r.addEmailProjectionWithThreadLocked(input.CompanyID, input.NodeID, input.SharedInboxID, input.AccountEmail, message, thread.EmailThreadID, now, input.Target.Mode != CommunicationsEmailConversionTargetExistingNode)
	r.linkCommunicationsEmailThreadToNodeLocked(input.CompanyID, input.NodeID, informationID, thread.EmailThreadID, message.ID, input.ActorUserID, now)
	if downloadScope, requestedMessageID, ok := communicationsEmailThreadDownloadRequest(thread, threadInput); ok {
		if _, _, err := r.ensureCommunicationsEmailThreadDownloadJobLocked(input.CompanyID, thread.EmailThreadID, downloadScope, requestedMessageID, threadInput.RequestedByUserID); err != nil {
			return "", "", err
		}
	}
	return informationID, thread.EmailThreadID, nil
}

func (r *PostgresRepo) persistCommunicationsConversionEmailTx(ctx context.Context, tx *sql.Tx, input CommunicationsTriageConversionInput, message domain.EmailMessageSnapshot, now time.Time) (string, string, error) {
	threadInput := communicationsEmailThreadInputForConversionMessage(input, message)
	thread, err := upsertPostgresCommunicationsEmailThreadTx(ctx, tx, threadInput)
	if err != nil {
		return "", "", err
	}
	relationshipID, err := addEmailProjectionSQLWithThread(ctx, tx, input.CompanyID, input.NodeID,
		input.SharedInboxID, input.AccountEmail, message, thread.EmailThreadID, now,
		input.Target.Mode != CommunicationsEmailConversionTargetExistingNode)
	if err != nil {
		return "", "", err
	}
	if downloadScope, requestedMessageID, ok := communicationsEmailThreadDownloadRequest(thread, threadInput); ok {
		if _, _, err := ensurePostgresCommunicationsEmailThreadDownloadJobTx(ctx, tx, input.CompanyID,
			thread.EmailThreadID, downloadScope, requestedMessageID, threadInput.RequestedByUserID); err != nil {
			return "", "", err
		}
	}
	return relationshipID, thread.EmailThreadID, nil
}
