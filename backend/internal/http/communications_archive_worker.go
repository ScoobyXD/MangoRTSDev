package httpapi

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/emailqueue"
	"miraeopus/backend/internal/store"
	"strings"
)

var errCommunicationsArchiveWorkerUnavailable = errors.New("communications archive worker unavailable")

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
		return true, nil
	case store.CommunicationsArchiveJobItemStatusFailed:
		return item.AttemptCount < 3, nil
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
		if err := s.repo.ParkCommunicationsArchiveJobItemAttemptContext(ctx, item.JobItemID, item.AttemptToken, item.CompanyID, message.EmailConnectionID, status, "email_connection_"+status); err != nil {
			return false, err
		}
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
			if err := s.repo.ParkCommunicationsArchiveJobItemAttemptContext(ctx, item.JobItemID, item.AttemptToken, item.CompanyID, message.EmailConnectionID, status, communicationsEmailWorkErrorCode(normalized)); err != nil {
				return false, err
			}
			return true, nil
		}
		if err := s.repo.FailCommunicationsArchiveJobItemAttemptContext(ctx, item.JobItemID, item.AttemptToken, communicationsEmailWorkErrorCode(normalized)); err != nil {
			return false, err
		}
		return false, normalized
	}
	if err := s.repo.CompleteCommunicationsArchiveJobItemAttemptContext(ctx, item.JobItemID, item.AttemptToken); err != nil {
		return false, err
	}
	if err := s.applyCommunicationsArchiveBatchResult(connection, item.CompanyID, item.SharedInboxID, communicationsArchiveBatchResult{
		ArchivedIDs: []string{firstNonBlank(archived.ID, item.MessageID)}, Messages: []NylasMessage{archived},
	}); err != nil {
		return false, err
	}
	return true, nil
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
