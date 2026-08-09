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
	emailReconciliationUnsentAge        = 10 * time.Minute
	emailReconciliationUnsentPageSize   = 200
)

func (s *Server) enqueueCommunicationsEmailIngestionJob(ctx context.Context, job store.CommunicationsEmailIngestionJob) error {
	if s == nil || s.emailQueue == nil {
		return errors.New("email SQS sender is not configured")
	}
	if err := s.emailQueue.Send(ctx, emailqueue.Message{
		SchemaVersion:     emailqueue.SchemaVersion,
		Kind:              emailqueue.KindIngestion,
		JobID:             job.IngestionJobID,
		CompanyID:         job.CompanyID,
		EmailConnectionID: job.EmailConnectionID,
	}); err != nil {
		return err
	}
	return s.repo.MarkCommunicationsEmailIngestionJobSQSAcceptedContext(ctx, job.IngestionJobID)
}

func (s *Server) enqueueCommunicationsEmailIngestionJobsForThreads(ctx context.Context, companyID string, threadIDs []string) error {
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
		jobs, err := s.repo.ListCommunicationsEmailIngestionJobsForThreadContext(ctx, companyID, threadID)
		if err != nil {
			return err
		}
		for _, job := range jobs {
			if job.Status != store.CommunicationsEmailIngestionJobAccepted && job.Status != store.CommunicationsEmailIngestionJobProcessing {
				continue
			}
			if err := s.enqueueCommunicationsEmailIngestionJob(ctx, job); err != nil {
				return err
			}
		}
	}
	return nil
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
	case store.CommunicationsEmailIngestionJobCompleted:
		err := s.publishCommunicationsEmailIngestionStatusContext(ctx, job)
		return err == nil, err
	case store.CommunicationsEmailIngestionJobParked:
		return true, nil
	case store.CommunicationsEmailIngestionJobExhausted:
		return false, nil
	}
	job, started, err := s.repo.StartCommunicationsEmailIngestionAttemptContext(ctx, job.IngestionJobID)
	if err != nil {
		return false, err
	}
	if !started {
		switch job.Status {
		case store.CommunicationsEmailIngestionJobCompleted:
			err := s.publishCommunicationsEmailIngestionStatusContext(ctx, job)
			return err == nil, err
		case store.CommunicationsEmailIngestionJobParked:
			return true, nil
		default:
			return false, nil
		}
	}
	workErr := s.processCommunicationsEmailIngestionProviderWork(ctx, job)
	if workErr == nil {
		settled := job
		settled.Status = store.CommunicationsEmailIngestionJobCompleted
		realtimeInputs, err := s.communicationsEmailIngestionStatusRealtimeInputs(ctx, settled)
		if err != nil {
			return false, err
		}
		if err := s.repo.CompleteCommunicationsEmailIngestionAttemptContext(ctx, job.IngestionJobID, job.AttemptToken, realtimeInputs); err != nil {
			return false, err
		}
		s.wakeRealtimeSpine()
		return true, nil
	}
	code := communicationsEmailWorkErrorCode(workErr)
	if errors.Is(workErr, errCommunicationsEmailConnectionReauthRequired) {
		settled := job
		settled.Status = store.CommunicationsEmailIngestionJobParked
		realtimeInputs, err := s.communicationsEmailIngestionStatusRealtimeInputs(ctx, settled)
		if err != nil {
			return false, err
		}
		if err := s.repo.ParkCommunicationsEmailIngestionAttemptContext(ctx, job.IngestionJobID, job.AttemptToken, "reauth_required", code, realtimeInputs); err != nil {
			return false, err
		}
		s.wakeRealtimeSpine()
		return true, nil
	}
	if errors.Is(workErr, errCommunicationsEmailConnectionConfigurationRequired) {
		settled := job
		settled.Status = store.CommunicationsEmailIngestionJobParked
		realtimeInputs, err := s.communicationsEmailIngestionStatusRealtimeInputs(ctx, settled)
		if err != nil {
			return false, err
		}
		if err := s.repo.ParkCommunicationsEmailIngestionAttemptContext(ctx, job.IngestionJobID, job.AttemptToken, "configuration_required", code, realtimeInputs); err != nil {
			return false, err
		}
		s.wakeRealtimeSpine()
		return true, nil
	}
	settled := job
	settled.Status = store.CommunicationsEmailIngestionJobAccepted
	if settled.ProviderAttemptCount >= store.CommunicationsEmailProviderAttemptLimit {
		settled.Status = store.CommunicationsEmailIngestionJobExhausted
	}
	realtimeInputs, err := s.communicationsEmailIngestionStatusRealtimeInputs(ctx, settled)
	if err != nil {
		return false, err
	}
	if err := s.repo.FailCommunicationsEmailIngestionAttemptContext(ctx, job.IngestionJobID, job.AttemptToken, code, realtimeInputs); err != nil {
		return false, err
	}
	s.wakeRealtimeSpine()
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
	case errors.Is(err, errCommunicationsEmailIngestionUnavailable), errors.Is(err, errEmailCollaborationSourceUnavailable):
		return "email_thread_source_unavailable"
	default:
		return communicationsMutationErrorCode(err)
	}
}

func (s *Server) publishCommunicationsEmailIngestionStatusContext(ctx context.Context, job store.CommunicationsEmailIngestionJob) error {
	inputs, err := s.communicationsEmailIngestionStatusRealtimeInputs(ctx, job)
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

func (s *Server) communicationsEmailIngestionStatusRealtimeInputs(ctx context.Context, job store.CommunicationsEmailIngestionJob) ([]store.RealtimeOutboxInput, error) {
	connection, err := s.repo.GetEmailConnectionByIDContext(ctx, job.CompanyID, job.EmailConnectionID)
	if err != nil {
		return nil, err
	}
	change := nylasWebhookChange{
		Trigger: "message.updated", MessageID: strings.TrimSpace(job.ProviderMessageID),
		ThreadID: strings.TrimSpace(job.ProviderThreadID), OccurredAt: time.Now().UTC(),
	}
	if communicationsMessageReadStatusScopeTypeForConnection(connection) != "shared" {
		s.applyNylasWebhookCacheInvalidation(connection.UserID, communicationsConnectionCacheScope(connection), change)
		scope := realtimePersonalMailboxScope(connection.UserID, connection.AccountEmail)
		input, err := personalMailboxWebhookHintInput(job.CompanyID, connection.UserID, connection.AccountEmail,
			emailIngestionStatusEventID(job, scope), change)
		return []store.RealtimeOutboxInput{input}, err
	}
	sharedInboxIDs, err := s.communicationsSharedInboxIDsForCompanyEmailConnectionContext(ctx, companyEmailConnectionFromUserConnectionForHTTP(connection))
	if err != nil {
		return nil, err
	}
	if len(sharedInboxIDs) == 0 {
		return nil, store.ErrNotFound
	}
	s.applyNylasWebhookCacheInvalidationForAccountScope(communicationsConnectionCacheScope(connection), change)
	inputs := make([]store.RealtimeOutboxInput, 0, len(sharedInboxIDs))
	for _, sharedInboxID := range sharedInboxIDs {
		scope := realtimeSharedMailboxScope(sharedInboxID)
		input, err := sharedMailboxWebhookHintInput(job.CompanyID, sharedInboxID,
			emailIngestionStatusEventID(job, scope), change)
		if err != nil {
			return nil, fmt.Errorf("build shared mailbox ingestion hint: %w", err)
		}
		inputs = append(inputs, input)
	}
	return inputs, nil
}

func emailIngestionStatusEventID(job store.CommunicationsEmailIngestionJob, scope string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		"mangorts-email-ingestion-status-v2",
		strings.TrimSpace(job.IngestionJobID),
		fmt.Sprint(job.ProviderAttemptCount),
		strings.TrimSpace(job.Status),
		strings.TrimSpace(job.CompanyID),
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
	if err := s.recoverUnsentEmailSQSWork(ctx, connection, message.ScanStartedAt); err != nil {
		return false, err
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
		job, _, err := s.repo.EnsureCommunicationsEmailIngestionJobContext(ctx, store.CommunicationsEmailIngestionJobInput{
			CompanyID:         connection.CompanyID,
			EmailConnectionID: connection.EmailConnectionID,
			ProviderMessageID: providerMessage.ID,
			ProviderThreadID:  providerMessage.ThreadID,
			Priority:          store.CommunicationsEmailIngestionPriorityScan,
		})
		if err != nil {
			return false, err
		}
		if job.Status != store.CommunicationsEmailIngestionJobAccepted || job.SQSAcceptedTimestamp != nil {
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

func (s *Server) recoverUnsentEmailSQSWork(ctx context.Context, connection domain.UserEmailConnection, scanStartedAt time.Time) error {
	if scanStartedAt.IsZero() {
		scanStartedAt = time.Now().UTC()
	}
	createdBefore := scanStartedAt.UTC().Add(-emailReconciliationUnsentAge)
	jobs, err := s.repo.ListUnsentCommunicationsEmailIngestionJobsContext(
		ctx, connection.CompanyID, connection.EmailConnectionID, createdBefore, emailReconciliationUnsentPageSize,
	)
	if err != nil {
		return err
	}
	for _, job := range jobs {
		if err := s.enqueueCommunicationsEmailIngestionJob(ctx, job); err != nil {
			return err
		}
	}
	items, err := s.repo.ListUnsentCommunicationsArchiveJobItemsContext(
		ctx, connection.CompanyID, connection.EmailConnectionID, createdBefore, emailReconciliationUnsentPageSize,
	)
	if err != nil {
		return err
	}
	for _, item := range items {
		if err := s.emailQueue.Send(ctx, emailqueue.Message{
			SchemaVersion: emailqueue.SchemaVersion, Kind: emailqueue.KindArchiveItem,
			JobID: item.JobItemID, CompanyID: item.CompanyID, EmailConnectionID: connection.EmailConnectionID,
		}); err != nil {
			return err
		}
	}
	return nil
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
