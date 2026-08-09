package httpapi

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/emailqueue"
	"miraeopus/backend/internal/store"
	"strings"
	"time"
)

var errCommunicationsArchiveWorkerUnavailable = errors.New("communications archive worker unavailable")

// archiveCommunicationsMessageByID is the sole provider archive mutation.
// It is called only by the private SQS archive worker.
func (s *Server) archiveCommunicationsMessageByID(ctx context.Context, connection domain.UserEmailConnection, companyID, sharedInboxID, messageID, archiveFolderID string) (NylasMessage, error) {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return NylasMessage{}, store.ErrInvalid
	}
	folders := []string{strings.TrimSpace(archiveFolderID)}
	if connection.Provider == "google" {
		message, err := s.communicationsMessageForFolderMutation(ctx, connection, companyID, sharedInboxID, messageID)
		if err != nil {
			return NylasMessage{}, err
		}
		folders = archiveMessageFolderIDs(connection.Provider, message.Folders, "")
	} else if folders[0] == "" {
		emailFolders, err := s.communicationsFolders(ctx, connection, false)
		if err != nil {
			return NylasMessage{}, err
		}
		folderID := findNylasArchiveFolderID(emailFolders)
		if folderID == "" {
			return NylasMessage{}, errCommunicationsArchiveUnavailable
		}
		folders = []string{folderID}
	}

	var archived NylasMessage
	err := s.withCommunicationsNylasGate(ctx, connection, func(ctx context.Context) error {
		var err error
		archived, err = s.nylasClient.UpdateMessage(ctx, connection.GrantID, messageID, NylasMessageUpdate{Folders: folders})
		return err
	})
	if archived.ID == "" {
		archived.ID = messageID
	}
	return archived, err
}

func (s *Server) processEmailArchiveDelivery(ctx context.Context, message emailqueue.Message) (bool, error) {
	item, err := s.repo.GetCommunicationsArchiveJobItemContext(ctx, message.JobID)
	if err != nil {
		return false, err
	}
	if item.CompanyID != message.CompanyID {
		return false, store.ErrInvalid
	}
	connection, err := s.repo.GetEmailConnectionByIDContext(ctx, item.CompanyID, message.EmailConnectionID)
	if err != nil {
		return false, err
	}
	if normalizeEmailForCompare(connection.AccountEmail) != normalizeEmailForCompare(item.AccountEmail) ||
		strings.TrimSpace(connection.Provider) != strings.TrimSpace(item.Provider) {
		return false, store.ErrInvalid
	}
	switch item.ConnectionScope {
	case "personal":
		if connection.Scope != "personal" || connection.UserID != item.ActorUserID {
			return false, store.ErrInvalid
		}
	case "shared":
		if connection.Scope != "shared" || connection.CompanyEmailConnectionID != item.CompanyEmailConnectionID {
			return false, store.ErrInvalid
		}
	default:
		return false, store.ErrInvalid
	}
	switch item.Status {
	case store.CommunicationsArchiveJobItemStatusArchived:
		err := s.publishCommunicationsArchiveStatusContext(ctx, item, connection)
		return err == nil, err
	case store.CommunicationsArchiveJobItemStatusFailed:
		err := s.publishCommunicationsArchiveStatusContext(ctx, item, connection)
		return err == nil && item.ProviderAttemptCount < 3, err
	}
	item, started, err := s.repo.StartCommunicationsArchiveJobItemAttemptContext(ctx, item.JobItemID)
	if err != nil {
		return false, err
	}
	if !started {
		return item.Status == store.CommunicationsArchiveJobItemStatusArchived, nil
	}
	if connection.Status != "connected" || strings.TrimSpace(connection.GrantID) == "" {
		status := connection.Status
		if status != "configuration_required" {
			status = "reauth_required"
		}
		settled := item
		settled.Status = store.CommunicationsArchiveJobItemStatusFailed
		realtimeInputs, err := communicationsArchiveStatusRealtimeInputs(settled, connection)
		if err != nil {
			return false, err
		}
		if err := s.repo.ParkCommunicationsArchiveJobItemAttemptContext(ctx, item.JobItemID, item.AttemptToken, item.CompanyID, message.EmailConnectionID, status, "email_connection_"+status, realtimeInputs); err != nil {
			return false, err
		}
		s.wakeRealtimeSpine()
		return true, nil
	}
	archived, workErr := s.processCommunicationsArchiveProviderWork(ctx, item, connection)
	if workErr != nil {
		normalized := normalizeCommunicationsEmailProviderError(connection, workErr)
		status := ""
		switch {
		case errors.Is(normalized, errCommunicationsEmailConnectionReauthRequired):
			status = "reauth_required"
		case errors.Is(normalized, errCommunicationsEmailConnectionConfigurationRequired):
			status = "configuration_required"
		}
		if status != "" {
			settled := item
			settled.Status = store.CommunicationsArchiveJobItemStatusFailed
			realtimeInputs, err := communicationsArchiveStatusRealtimeInputs(settled, connection)
			if err != nil {
				return false, err
			}
			if err := s.repo.ParkCommunicationsArchiveJobItemAttemptContext(ctx, item.JobItemID, item.AttemptToken, item.CompanyID, message.EmailConnectionID, status, communicationsEmailWorkErrorCode(normalized), realtimeInputs); err != nil {
				return false, err
			}
			s.wakeRealtimeSpine()
			return true, nil
		}
		settled := item
		settled.Status = store.CommunicationsArchiveJobItemStatusPending
		if settled.ProviderAttemptCount >= 3 {
			settled.Status = store.CommunicationsArchiveJobItemStatusFailed
		}
		realtimeInputs, err := communicationsArchiveStatusRealtimeInputs(settled, connection)
		if err != nil {
			return false, err
		}
		if err := s.repo.FailCommunicationsArchiveJobItemAttemptContext(ctx, item.JobItemID, item.AttemptToken, communicationsEmailWorkErrorCode(normalized), realtimeInputs); err != nil {
			return false, err
		}
		s.wakeRealtimeSpine()
		return false, normalized
	}
	settled := item
	settled.Status = store.CommunicationsArchiveJobItemStatusArchived
	realtimeInputs, err := communicationsArchiveStatusRealtimeInputs(settled, connection)
	if err != nil {
		return false, err
	}
	if err := s.repo.CompleteCommunicationsArchiveJobItemAttemptContext(ctx, item.JobItemID, item.AttemptToken, realtimeInputs); err != nil {
		return false, err
	}
	s.wakeRealtimeSpine()
	s.applyCommunicationsArchivedMessage(connection, item.MessageID, archived)
	return true, nil
}

func (s *Server) publishCommunicationsArchiveStatusContext(ctx context.Context, item store.CommunicationsArchiveJobItem, connection domain.UserEmailConnection) error {
	inputs, err := communicationsArchiveStatusRealtimeInputs(item, connection)
	if err != nil {
		return err
	}
	for _, input := range inputs {
		if _, err := s.enqueueRealtimeOutboxAndWake(ctx, input); err != nil {
			return err
		}
	}
	return nil
}

func communicationsArchiveStatusRealtimeInputs(item store.CommunicationsArchiveJobItem, connection domain.UserEmailConnection) ([]store.RealtimeOutboxInput, error) {
	change := nylasWebhookChange{Trigger: "message.updated", MessageID: item.MessageID, OccurredAt: time.Now().UTC()}
	if communicationsMessageReadStatusScopeTypeForConnection(connection) != "shared" {
		scope := realtimePersonalMailboxScope(connection.UserID, connection.AccountEmail)
		input, err := personalMailboxWebhookHintInput(item.CompanyID, connection.UserID, connection.AccountEmail,
			archiveStatusEventID(item, item.CompanyID, scope), change)
		return []store.RealtimeOutboxInput{input}, err
	}
	sharedInboxID := strings.TrimSpace(item.SharedInboxID)
	if sharedInboxID == "" {
		return nil, store.ErrInvalid
	}
	scope := realtimeSharedMailboxScope(sharedInboxID)
	input, err := sharedMailboxWebhookHintInput(item.CompanyID, sharedInboxID,
		archiveStatusEventID(item, item.CompanyID, scope), change)
	return []store.RealtimeOutboxInput{input}, err
}

func archiveStatusEventID(item store.CommunicationsArchiveJobItem, companyID, scope string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		"mangorts-email-archive-status-v1", item.JobItemID, fmt.Sprint(item.ProviderAttemptCount), item.Status,
		strings.TrimSpace(companyID), strings.TrimSpace(scope),
	}, "\x1f")))
	raw := sum[:16]
	raw[6] = (raw[6] & 0x0f) | 0x50
	raw[8] = (raw[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:16])
}

func (s *Server) processCommunicationsArchiveProviderWork(ctx context.Context, item store.CommunicationsArchiveJobItem, connection domain.UserEmailConnection) (NylasMessage, error) {
	if s.nylasClient == nil {
		return NylasMessage{}, errCommunicationsArchiveWorkerUnavailable
	}
	archiveFolderID := ""
	if connection.Provider != "google" {
		emailFolders, err := s.communicationsFolders(ctx, connection, false)
		if err != nil {
			return NylasMessage{}, err
		}
		archiveFolderID = findNylasArchiveFolderID(emailFolders)
		if archiveFolderID == "" {
			return NylasMessage{}, errCommunicationsArchiveUnavailable
		}
	}
	return s.archiveCommunicationsMessageByID(ctx, connection, item.CompanyID, item.SharedInboxID, item.MessageID, archiveFolderID)
}
