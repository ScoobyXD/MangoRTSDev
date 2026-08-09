package httpapi

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/emailqueue"
	"miraeopus/backend/internal/store"
	"strings"
	"sync"
	"time"
)

const defaultEmailWorkerConcurrency = 3
const emailWorkerStartupDeadline = 10 * time.Second

const (
	emailReconciliationControlPageSize  = 10
	emailReconciliationProviderPageSize = 200
	emailReconciliationOverlap          = 5 * time.Minute
)

func (s *Server) enqueueCommunicationsEmailIngestionJob(ctx context.Context, job store.CommunicationsEmailThreadDownloadJob) error {
	if s == nil || s.emailQueue == nil {
		return errors.New("email SQS sender is not configured")
	}
	return s.emailQueue.Send(ctx, emailqueue.Message{
		SchemaVersion:     emailqueue.SchemaVersion,
		Kind:              emailqueue.KindIngestion,
		JobID:             job.DownloadJobID,
		CompanyID:         job.CompanyID,
		EmailConnectionID: job.EmailConnectionID,
	})
}

func (s *Server) enqueueCommunicationsEmailThreadJobs(ctx context.Context, companyID string, threadIDs []string) error {
	if s == nil || s.emailQueue == nil {
		return errors.New("email SQS sender is not configured")
	}
	seen := map[string]bool{}
	for _, threadID := range threadIDs {
		threadID = strings.TrimSpace(threadID)
		if threadID == "" || seen[threadID] {
			continue
		}
		seen[threadID] = true
		jobs, err := s.repo.ListCommunicationsEmailThreadDownloadJobsContext(ctx, companyID, threadID)
		if err != nil {
			return err
		}
		for _, job := range jobs {
			if job.Status != store.CommunicationsEmailThreadDownloadJobAccepted && job.Status != store.CommunicationsEmailThreadDownloadJobProcessing {
				continue
			}
			if err := s.enqueueCommunicationsEmailIngestionJob(ctx, job); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Server) enqueueCommunicationsReconciliationControl(ctx context.Context, source string) error {
	if s == nil || s.emailQueue == nil {
		return errors.New("email SQS sender is not configured")
	}
	now := time.Now().UTC()
	return s.emailQueue.Send(ctx, emailqueue.Message{
		SchemaVersion:    emailqueue.SchemaVersion,
		Kind:             emailqueue.KindReconciliationControl,
		ReconciliationID: strings.TrimSpace(source) + "-" + now.Format("20060102T1504"),
		ScanStartedAt:    now,
	})
}

// RunEmailWorker owns only process lifecycle and bounded concurrency. SQS owns
// visibility, redelivery, receive count, and DLQ movement.
func (s *Server) RunEmailWorker(ctx context.Context, receiver emailqueue.Receiver, concurrency int) error {
	if s == nil || receiver == nil {
		return errors.New("email worker server and receiver are required")
	}
	if err := s.waitForEmailWorkerReadiness(ctx); err != nil {
		return err
	}
	if concurrency <= 0 {
		concurrency = defaultEmailWorkerConcurrency
	}
	sem := make(chan struct{}, concurrency)
	var workers sync.WaitGroup
	defer workers.Wait()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case sem <- struct{}{}:
		}
		delivery, ok, err := receiver.Receive(ctx)
		if err != nil {
			<-sem
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("email worker receive failed: %w", err)
		}
		if !ok {
			<-sem
			continue
		}
		workers.Add(1)
		go func() {
			defer workers.Done()
			defer func() { <-sem }()
			attemptCtx, cancel := context.WithTimeout(ctx, emailqueue.AttemptDeadline)
			defer cancel()
			acknowledge, processErr := s.processEmailQueueDelivery(attemptCtx, delivery)
			if processErr != nil {
				log.Printf("email worker delivery failed kind=%s job_id=%s receive_count=%d: %v", delivery.Message.Kind, delivery.Message.JobID, delivery.ReceiveCount, processErr)
				return
			}
			if !acknowledge {
				return
			}
			if err := receiver.Delete(attemptCtx, delivery.ReceiptHandle); err != nil {
				log.Printf("email worker acknowledgement failed kind=%s job_id=%s: %v", delivery.Message.Kind, delivery.Message.JobID, err)
			}
		}()
	}
}

func (s *Server) waitForEmailWorkerReadiness(ctx context.Context) error {
	if s.repo == nil {
		return errors.New("PostgreSQL repository is required for the email worker")
	}
	if s.nylasClient == nil {
		return errors.New("Nylas client is required for the email worker")
	}
	if s.emailQueue == nil {
		return errors.New("SQS sender is required for the email worker")
	}
	if !s.emailWorkerExternalRealtime || s.realtimeBackplane == nil || s.realtimeSpineInitialBackplaneReady == nil {
		return errors.New("external Valkey realtime is required for the email worker")
	}
	readyCtx, cancel := context.WithTimeout(ctx, emailWorkerStartupDeadline)
	defer cancel()
	if err := s.repo.CheckEmailSQSWorkerSchemaReadinessContext(readyCtx); err != nil {
		return fmt.Errorf("email worker PostgreSQL final schema check failed: %w", err)
	}
	select {
	case <-s.realtimeSpineInitialBackplaneReady:
		return nil
	case <-readyCtx.Done():
		return fmt.Errorf("email worker Valkey readiness failed: %w", readyCtx.Err())
	}
}

func (s *Server) processEmailQueueDelivery(ctx context.Context, delivery emailqueue.Delivery) (bool, error) {
	switch delivery.Message.Kind {
	case emailqueue.KindIngestion:
		return s.processEmailIngestionDelivery(ctx, delivery.Message)
	case emailqueue.KindArchiveItem:
		return s.processEmailArchiveDelivery(ctx, delivery.Message)
	case emailqueue.KindReconciliationControl:
		return s.processEmailReconciliationControl(ctx, delivery.Message)
	case emailqueue.KindReconciliationConnection:
		return s.processEmailReconciliationConnection(ctx, delivery.Message)
	default:
		return false, errors.New("unknown email work message kind")
	}
}

func (s *Server) processEmailIngestionDelivery(ctx context.Context, message emailqueue.Message) (bool, error) {
	job, err := s.repo.GetCommunicationsEmailIngestionJobContext(ctx, message.JobID)
	if err != nil {
		return false, err
	}
	if job.CompanyID != message.CompanyID || job.EmailConnectionID != message.EmailConnectionID {
		return false, store.ErrInvalid
	}
	switch job.Status {
	case store.CommunicationsEmailThreadDownloadJobCompleted:
		err := s.publishCommunicationsEmailIngestionCompletionContext(ctx, job)
		return err == nil, err
	case store.CommunicationsEmailThreadDownloadJobParked:
		return true, nil
	case store.CommunicationsEmailThreadDownloadJobExhausted:
		return false, nil
	}
	job, started, err := s.repo.StartCommunicationsEmailIngestionAttemptContext(ctx, job.DownloadJobID)
	if err != nil {
		return false, err
	}
	if !started {
		switch job.Status {
		case store.CommunicationsEmailThreadDownloadJobCompleted:
			err := s.publishCommunicationsEmailIngestionCompletionContext(ctx, job)
			return err == nil, err
		case store.CommunicationsEmailThreadDownloadJobParked:
			return true, nil
		default:
			return false, nil
		}
	}
	workErr := s.processCommunicationsEmailIngestionProviderWork(ctx, job)
	if workErr == nil {
		if err := s.repo.CompleteCommunicationsEmailIngestionAttemptContext(ctx, job.DownloadJobID, job.AttemptToken); err != nil {
			return false, err
		}
		job, err = s.repo.GetCommunicationsEmailIngestionJobContext(ctx, job.DownloadJobID)
		if err != nil {
			return false, err
		}
		err = s.publishCommunicationsEmailIngestionCompletionContext(ctx, job)
		return err == nil, err
	}
	code := communicationsEmailWorkErrorCode(workErr)
	if errors.Is(workErr, errCommunicationsEmailConnectionReauthRequired) {
		if err := s.repo.ParkCommunicationsEmailIngestionAttemptContext(ctx, job.DownloadJobID, job.AttemptToken, "reauth_required", code); err != nil {
			return false, err
		}
		return true, nil
	}
	if errors.Is(workErr, errCommunicationsEmailConnectionConfigurationRequired) {
		if err := s.repo.ParkCommunicationsEmailIngestionAttemptContext(ctx, job.DownloadJobID, job.AttemptToken, "configuration_required", code); err != nil {
			return false, err
		}
		return true, nil
	}
	if err := s.repo.FailCommunicationsEmailIngestionAttemptContext(ctx, job.DownloadJobID, job.AttemptToken, code); err != nil {
		return false, err
	}
	return false, workErr
}

func communicationsEmailWorkErrorCode(err error) string {
	switch {
	case errors.Is(err, errCommunicationsEmailConnectionReauthRequired):
		return "email_connection_reauth_required"
	case errors.Is(err, errCommunicationsEmailConnectionConfigurationRequired):
		return "email_connection_configuration_required"
	case errors.Is(err, errCommunicationsEmailAttachmentUnavailable):
		return "email_attachment_download_failed"
	case errors.Is(err, errCommunicationsEmailThreadDownloadUnavailable), errors.Is(err, errEmailCollaborationSourceUnavailable):
		return "email_thread_source_unavailable"
	default:
		return communicationsMutationErrorCode(err)
	}
}

func (s *Server) publishCommunicationsEmailIngestionCompletionContext(ctx context.Context, job store.CommunicationsEmailThreadDownloadJob) error {
	connection, err := s.repo.GetEmailConnectionByIDContext(ctx, job.CompanyID, job.EmailConnectionID)
	if err != nil {
		return err
	}
	change := nylasWebhookChange{
		Trigger: "message.updated", MessageID: strings.TrimSpace(job.ProviderMessageID),
		ThreadID: strings.TrimSpace(job.ProviderThreadID), OccurredAt: time.Now().UTC(),
	}
	if communicationsMessageReadStatusScopeTypeForConnection(connection) != "shared" {
		s.applyNylasWebhookCacheInvalidation(connection.UserID, communicationsConnectionCacheScope(connection), change)
		scope := realtimePersonalMailboxScope(connection.UserID, connection.AccountEmail)
		return s.publishPersonalMailboxWebhookHintContext(
			ctx, job.CompanyID, connection.UserID, connection.AccountEmail,
			emailIngestionCompletionEventID(job.DownloadJobID, job.CompanyID, scope), change,
		)
	}
	s.applyNylasWebhookCacheInvalidationForAccountScope(communicationsConnectionCacheScope(connection), change)
	sharedInboxIDs, err := s.communicationsSharedInboxIDsForCompanyEmailConnectionContext(ctx, companyEmailConnectionFromUserConnectionForHTTP(connection))
	if err != nil {
		return err
	}
	for _, sharedInboxID := range sharedInboxIDs {
		scope := realtimeSharedMailboxScope(sharedInboxID)
		if err := s.publishSharedMailboxWebhookHintContext(
			ctx, job.CompanyID, sharedInboxID,
			emailIngestionCompletionEventID(job.DownloadJobID, job.CompanyID, scope), change,
		); err != nil {
			return fmt.Errorf("publish completed shared mailbox hint: %w", err)
		}
	}
	return nil
}

func emailIngestionCompletionEventID(jobID, companyID, scope string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		"mangorts-email-ingestion-completion-v1",
		strings.TrimSpace(jobID),
		strings.TrimSpace(companyID),
		strings.TrimSpace(scope),
	}, "\x1f")))
	raw := sum[:16]
	raw[6] = (raw[6] & 0x0f) | 0x50
	raw[8] = (raw[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:16])
}

func (s *Server) processEmailReconciliationControl(ctx context.Context, message emailqueue.Message) (bool, error) {
	connections, err := s.repo.ListDueEmailConnectionsContext(
		ctx, message.ScanStartedAt, message.ConnectionCursor, emailReconciliationControlPageSize,
	)
	if err != nil {
		return false, err
	}
	for _, connection := range connections {
		lowerBound := connection.LastSuccessfulScanAt.UTC().Add(-emailReconciliationOverlap)
		activationFloor := connection.IngestionStartedAt.UTC().Add(-time.Second)
		if lowerBound.Before(activationFloor) {
			lowerBound = activationFloor
		}
		if err := s.emailQueue.Send(ctx, emailqueue.Message{
			SchemaVersion:     emailqueue.SchemaVersion,
			Kind:              emailqueue.KindReconciliationConnection,
			CompanyID:         connection.CompanyID,
			EmailConnectionID: connection.EmailConnectionID,
			ReconciliationID:  message.ReconciliationID,
			ScanStartedAt:     message.ScanStartedAt,
			LowerBound:        lowerBound,
		}); err != nil {
			return false, err
		}
	}
	if len(connections) == emailReconciliationControlPageSize {
		continuation := message
		continuation.ConnectionCursor = connections[len(connections)-1].EmailConnectionID
		if err := s.emailQueue.Send(ctx, continuation); err != nil {
			return false, err
		}
	}
	return true, nil
}

func (s *Server) processEmailReconciliationConnection(ctx context.Context, message emailqueue.Message) (bool, error) {
	if s.nylasClient == nil {
		return false, errors.New("Nylas client is required for email reconciliation")
	}
	connection, err := s.repo.GetEmailConnectionByIDContext(ctx, message.CompanyID, message.EmailConnectionID)
	if err != nil {
		return false, err
	}
	if connection.Status != "connected" || strings.TrimSpace(connection.GrantID) == "" {
		return true, nil
	}
	var folders []NylasFolder
	err = s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
		var callErr error
		folders, callErr = s.nylasClient.ListFolders(callCtx, connection.GrantID)
		return callErr
	})
	if err != nil {
		return s.settleEmailReconciliationProviderError(ctx, connection, err)
	}
	inboxID := findNylasSystemFolderID(folders, "inbox")
	if inboxID == "" {
		return false, errEmailCollaborationSourceUnavailable
	}
	var page NylasMessagePage
	err = s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
		var callErr error
		page, callErr = s.nylasClient.ListMessages(callCtx, connection.GrantID, NylasMessageQuery{
			Limit:          emailReconciliationProviderPageSize,
			PageToken:      message.ProviderPageToken,
			FolderID:       inboxID,
			ReceivedAfter:  message.LowerBound.Unix(),
			ReceivedBefore: message.ScanStartedAt.Unix(),
		})
		return callErr
	})
	if err != nil {
		return s.settleEmailReconciliationProviderError(ctx, connection, err)
	}
	for _, providerMessage := range page.Messages {
		if strings.TrimSpace(providerMessage.ID) == "" || providerMessage.Date < connection.IngestionStartedAt.Unix() {
			continue
		}
		job, created, err := s.repo.EnsureCommunicationsEmailIngestionJobContext(ctx, store.CommunicationsEmailIngestionJobInput{
			CompanyID:         connection.CompanyID,
			EmailConnectionID: connection.EmailConnectionID,
			ProviderMessageID: providerMessage.ID,
			ProviderThreadID:  providerMessage.ThreadID,
			Priority:          store.CommunicationsEmailIngestionPriorityScan,
			EnqueueSourceID:   message.ReconciliationID,
		})
		if err != nil {
			return false, err
		}
		if !created && (job.Status != store.CommunicationsEmailThreadDownloadJobAccepted ||
			strings.TrimSpace(job.EnqueueSourceID) != strings.TrimSpace(message.ReconciliationID)) {
			continue
		}
		if err := s.enqueueCommunicationsEmailIngestionJob(ctx, job); err != nil {
			return false, err
		}
	}
	if next := strings.TrimSpace(page.NextPageToken); next != "" {
		continuation := message
		continuation.ProviderPageToken = next
		if err := s.emailQueue.Send(ctx, continuation); err != nil {
			return false, err
		}
		return true, nil
	}
	if err := s.repo.UpdateEmailConnectionScanCheckpointContext(ctx, connection.CompanyID, connection.EmailConnectionID, message.ScanStartedAt); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Server) settleEmailReconciliationProviderError(ctx context.Context, connection domain.UserEmailConnection, providerErr error) (bool, error) {
	normalized := normalizeCommunicationsEmailProviderError(connection, providerErr)
	status := ""
	switch {
	case errors.Is(normalized, errCommunicationsEmailConnectionReauthRequired):
		status = "reauth_required"
	case errors.Is(normalized, errCommunicationsEmailConnectionConfigurationRequired):
		status = "configuration_required"
	default:
		return false, normalized
	}
	if err := s.repo.UpdateEmailConnectionStatusByIDContext(ctx, connection.CompanyID, connection.EmailConnectionID, status); err != nil {
		return false, err
	}
	return true, nil
}
