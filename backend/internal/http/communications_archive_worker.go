package httpapi

import (
	"context"
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	defaultCommunicationsArchiveWorkerInterval   = 250 * time.Millisecond
	defaultCommunicationsArchiveWorkerBatchLimit = 10
	communicationsArchiveJobMaxAttempts          = 5
	communicationsArchiveJobMaxRetryDelay        = time.Minute
)

var errCommunicationsArchiveWorkerUnavailable = errors.New("communications archive worker unavailable")

func (s *Server) startCommunicationsArchiveWorker() {
	if s == nil || s.communicationsArchiveWorkerDisabled || s.repo == nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.communicationsArchiveWorkerCancel = cancel
	go s.runCommunicationsArchiveWorker(ctx)
}

func (s *Server) runCommunicationsArchiveWorker(ctx context.Context) {
	ticker := time.NewTicker(s.communicationsArchiveWorkerInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.communicationsArchiveWorkerWake:
		}
		if _, err := s.processAvailableCommunicationsArchiveJobItems(ctx, s.communicationsArchiveWorkerBatchLimit); err != nil && !strings.Contains(err.Error(), "context canceled") {
			log.Printf("communications archive worker failed: %v", err)
		}
	}
}

func (s *Server) wakeCommunicationsArchiveWorker() {
	if s == nil || s.communicationsArchiveWorkerDisabled || s.communicationsArchiveWorkerWake == nil {
		return
	}
	select {
	case s.communicationsArchiveWorkerWake <- struct{}{}:
	default:
	}
}

func (s *Server) processAvailableCommunicationsArchiveJobItems(ctx context.Context, limit int) (int, error) {
	if s == nil || s.repo == nil {
		return 0, nil
	}
	items, err := s.repo.ClaimCommunicationsArchiveJobItems(limit, s.communicationsArchiveWorkerLeaseTimeout)
	if err != nil {
		return 0, err
	}
	archiveFolderIDs := map[string]string{}
	processed := 0
	for _, item := range items {
		if err := ctx.Err(); err != nil {
			return processed, err
		}
		if err := s.processCommunicationsArchiveJobItem(ctx, item, archiveFolderIDs); err != nil {
			return processed, err
		}
		processed++
	}
	return processed, nil
}

func (s *Server) processCommunicationsArchiveJobItem(ctx context.Context, item store.CommunicationsArchiveJobItem, archiveFolderIDs map[string]string) error {
	connection := communicationsArchiveJobItemConnection(item)
	if s.nylasClient == nil || !s.nylasConfig.IsConfigured() {
		return s.recordCommunicationsArchiveJobItemFailure(item, errCommunicationsArchiveWorkerUnavailable)
	}

	archiveFolderID := ""
	if connection.Provider != "google" {
		cacheKey := strings.TrimSpace(connection.Provider) + "\x1f" + strings.TrimSpace(connection.GrantID)
		if cached, ok := archiveFolderIDs[cacheKey]; ok {
			archiveFolderID = cached
		} else {
			emailFolders, err := s.communicationsFolders(ctx, connection, false)
			if err != nil {
				return s.recordCommunicationsArchiveJobItemFailure(item, err)
			}
			archiveFolderID = findNylasArchiveFolderID(emailFolders)
			if archiveFolderID == "" {
				return s.recordCommunicationsArchiveJobItemFailure(item, errCommunicationsArchiveUnavailable)
			}
			archiveFolderIDs[cacheKey] = archiveFolderID
		}
	}

	archived, err := s.archiveCommunicationsMessageByID(ctx, connection, item.CompanyID, item.SharedInboxID, item.MessageID, archiveFolderID)
	if err != nil {
		var apiErr NylasAPIError
		if errors.As(err, &apiErr) && (apiErr.StatusCode == http.StatusUnauthorized || apiErr.StatusCode == http.StatusForbidden) {
			s.markCommunicationsConnectionReauthRequired(connection)
		}
		return s.recordCommunicationsArchiveJobItemFailure(item, err)
	}

	messageID := firstNonBlank(archived.ID, item.MessageID)
	if err := s.applyCommunicationsArchiveBatchResult(connection, item.CompanyID, item.SharedInboxID, communicationsArchiveBatchResult{
		ArchivedIDs: []string{messageID},
		Messages:    []NylasMessage{archived},
		Failed:      []communicationsArchiveBatchFailure{},
	}); err != nil {
		return s.recordCommunicationsArchiveJobItemFailure(item, err)
	}
	if err := s.repo.MarkCommunicationsArchiveJobItemArchived(item.JobItemID); err != nil {
		return err
	}
	return nil
}

func communicationsArchiveJobItemConnection(item store.CommunicationsArchiveJobItem) domain.UserEmailConnection {
	return domain.UserEmailConnection{
		UserID:                   strings.TrimSpace(item.ActorUserID),
		Provider:                 strings.TrimSpace(item.Provider),
		AccountEmail:             strings.TrimSpace(item.AccountEmail),
		Scope:                    strings.TrimSpace(item.ConnectionScope),
		CompanyID:                strings.TrimSpace(item.CompanyID),
		CompanyEmailConnectionID: strings.TrimSpace(item.CompanyEmailConnectionID),
		GrantID:                  strings.TrimSpace(item.GrantID),
		Status:                   "connected",
	}
}

func (s *Server) recordCommunicationsArchiveJobItemFailure(item store.CommunicationsArchiveJobItem, archiveErr error) error {
	code := communicationsMutationErrorCode(archiveErr)
	final := communicationsArchiveJobFailureIsFinal(archiveErr, item.AttemptCount)
	availableAt := time.Now().UTC().Add(communicationsArchiveJobRetryDelay(item.AttemptCount, archiveErr))
	if err := s.repo.MarkCommunicationsArchiveJobItemFailed(item.JobItemID, code, availableAt, final); err != nil {
		return err
	}
	return nil
}

func communicationsArchiveJobFailureIsFinal(err error, attemptCount int) bool {
	if attemptCount >= communicationsArchiveJobMaxAttempts {
		return true
	}
	if errors.Is(err, store.ErrInvalid) {
		return true
	}
	var apiErr NylasAPIError
	if errors.As(err, &apiErr) {
		if apiErr.StatusCode == http.StatusTooManyRequests || apiErr.StatusCode >= 500 {
			return false
		}
		if apiErr.StatusCode >= 400 && apiErr.StatusCode < 500 {
			return true
		}
	}
	return false
}

func communicationsArchiveJobRetryDelay(attemptCount int, err error) time.Duration {
	var apiErr NylasAPIError
	if errors.As(err, &apiErr) {
		if retryAfter := strings.TrimSpace(apiErr.RetryAfter); retryAfter != "" {
			if seconds, parseErr := strconv.Atoi(retryAfter); parseErr == nil && seconds > 0 {
				delay := time.Duration(seconds) * time.Second
				if delay > communicationsArchiveJobMaxRetryDelay {
					return communicationsArchiveJobMaxRetryDelay
				}
				return delay
			}
			if retryAt, parseErr := http.ParseTime(retryAfter); parseErr == nil {
				delay := time.Until(retryAt)
				if delay > communicationsArchiveJobMaxRetryDelay {
					return communicationsArchiveJobMaxRetryDelay
				}
				if delay > 0 {
					return delay
				}
			}
		}
	}
	if attemptCount <= 1 {
		return time.Second
	}
	shift := attemptCount - 1
	if shift > 5 {
		shift = 5
	}
	delay := time.Duration(1<<shift) * time.Second
	if delay > communicationsArchiveJobMaxRetryDelay {
		return communicationsArchiveJobMaxRetryDelay
	}
	return delay
}
