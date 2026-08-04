package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
	"time"
)

const (
	defaultCommunicationsEmailThreadDownloadWorkerInterval = 250 * time.Millisecond
	defaultCommunicationsEmailThreadDownloadBatchLimit     = 4
	communicationsEmailThreadDownloadMaxAttempts           = 8
	communicationsEmailThreadDownloadMaxRetryDelay         = 5 * time.Minute
)

var (
	errCommunicationsEmailThreadDownloadUnavailable = errors.New("email thread download unavailable")
	errCommunicationsEmailAttachmentUnavailable     = errors.New("email attachment unavailable")
)

func (s *Server) startCommunicationsEmailThreadDownloadWorker() {
	if s == nil || s.communicationsEmailThreadDownloadWorkerDisabled || s.repo == nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.communicationsEmailThreadDownloadWorkerCancel = cancel
	go s.runCommunicationsEmailThreadDownloadWorker(ctx)
}

func (s *Server) runCommunicationsEmailThreadDownloadWorker(ctx context.Context) {
	ticker := time.NewTicker(s.communicationsEmailThreadDownloadWorkerInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.communicationsEmailThreadDownloadWorkerWake:
		}
		if _, err := s.processAvailableCommunicationsEmailThreadDownloadJobs(ctx, s.communicationsEmailThreadDownloadWorkerBatchLimit); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("communications email thread download worker failed: %v", err)
		}
	}
}

func (s *Server) wakeCommunicationsEmailThreadDownloadWorker() {
	if s == nil || s.communicationsEmailThreadDownloadWorkerDisabled || s.communicationsEmailThreadDownloadWorkerWake == nil {
		return
	}
	select {
	case s.communicationsEmailThreadDownloadWorkerWake <- struct{}{}:
	default:
	}
}

func (s *Server) processAvailableCommunicationsEmailThreadDownloadJobs(ctx context.Context, limit int) (int, error) {
	jobs, err := s.repo.ClaimCommunicationsEmailThreadDownloadJobs(limit, s.communicationsEmailThreadDownloadWorkerLeaseTimeout)
	if err != nil {
		return 0, err
	}
	processed := 0
	for _, job := range jobs {
		if err := ctx.Err(); err != nil {
			return processed, err
		}
		if err := s.processCommunicationsEmailThreadDownloadJob(ctx, job); err != nil {
			return processed, err
		}
		processed++
	}
	return processed, nil
}

func (s *Server) processCommunicationsEmailThreadDownloadJob(ctx context.Context, job store.CommunicationsEmailThreadDownloadJob) error {
	if s.nylasClient == nil || !s.nylasConfig.IsConfigured() {
		return s.recordCommunicationsEmailThreadDownloadFailure(job, errCommunicationsEmailThreadDownloadUnavailable)
	}
	thread, err := s.repo.GetCommunicationsEmailThread(job.CompanyID, job.EmailThreadID)
	if err != nil {
		return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
	}
	connection, err := s.resolveEmailThreadSourceConnection(thread, job.RequestedByUserID)
	if err != nil {
		return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
	}

	messageIDs := []string{job.RequestedProviderMessageID}
	if job.DownloadScope == store.CommunicationsEmailThreadDownloadScopeFullThread {
		var providerThread NylasThread
		err = s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
			var callErr error
			providerThread, callErr = s.nylasClient.GetThread(callCtx, connection.GrantID, thread.ProviderThreadID)
			return callErr
		})
		if err != nil || strings.TrimSpace(providerThread.ID) != strings.TrimSpace(thread.ProviderThreadID) {
			if err == nil {
				err = errEmailCollaborationSourceUnavailable
			}
			return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
		}
		messageIDs = cleanEmailCollaborationThreadMessageIDs(providerThread.MessageIDs)
	}
	if len(messageIDs) == 0 {
		return s.recordCommunicationsEmailThreadDownloadFailure(job, store.ErrInvalid)
	}

	for _, messageID := range messageIDs {
		thread, err = s.repo.GetCommunicationsEmailThread(job.CompanyID, job.EmailThreadID)
		if err != nil {
			return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
		}
		if storedEmailMessageDownloadComplete(thread, messageID) {
			continue
		}
		var message NylasMessage
		err = s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
			var callErr error
			message, callErr = s.nylasClient.GetMessage(callCtx, connection.GrantID, messageID)
			return callErr
		})
		if err != nil {
			return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
		}
		if strings.TrimSpace(message.ID) != messageID || (thread.ProviderThreadID != "" && strings.TrimSpace(message.ThreadID) != thread.ProviderThreadID) {
			return s.recordCommunicationsEmailThreadDownloadFailure(job, errEmailCollaborationSourceUnavailable)
		}
		message = s.attachRawMIMEAttachmentsIfMissing(ctx, connection, message)
		if emailMessageHasUnresolvedCIDAttachments(message) {
			return s.recordCommunicationsEmailThreadDownloadFailure(job, errCommunicationsEmailAttachmentUnavailable)
		}
		preliminarySnapshot := emailMessageSnapshotFromNylas(message)
		preliminarySnapshot.DownloadComplete = false
		thread, err = s.repo.UpsertCommunicationsEmailThread(communicationsEmailThreadInputFromStoredThread(thread, preliminarySnapshot, thread.HistoryComplete))
		if err != nil {
			return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
		}
		message, err = s.storeImportedEmailMessageAttachments(ctx, connection, thread, job.RequestedByUserID, message)
		if err != nil {
			return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
		}
		snapshot := emailMessageSnapshotFromNylas(message)
		snapshot.DownloadComplete = true
		messageCompletesHistory := thread.HistoryComplete || (job.DownloadScope == store.CommunicationsEmailThreadDownloadScopeMessage && strings.TrimSpace(thread.ProviderThreadID) == "")
		if _, err = s.repo.UpsertCommunicationsEmailThread(communicationsEmailThreadInputFromStoredThread(thread, snapshot, messageCompletesHistory)); err != nil {
			return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
		}
	}

	if job.DownloadScope == store.CommunicationsEmailThreadDownloadScopeFullThread {
		thread, err = s.repo.GetCommunicationsEmailThread(job.CompanyID, job.EmailThreadID)
		if err != nil || len(thread.Messages) == 0 {
			if err == nil {
				err = store.ErrInvalid
			}
			return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
		}
		anchor := thread.Messages[0].Message
		if _, err = s.repo.UpsertCommunicationsEmailThread(communicationsEmailThreadInputFromStoredThread(thread, anchor, true)); err != nil {
			return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
		}
	}
	if err := s.repo.MarkCommunicationsEmailThreadDownloadJobCompleted(job.DownloadJobID); err != nil {
		return err
	}
	return nil
}

func storedEmailMessageDownloadComplete(thread domain.CommunicationsEmailThread, providerMessageID string) bool {
	for _, item := range thread.Messages {
		if item.ProviderMessageID == providerMessageID {
			return item.Message.DownloadComplete
		}
	}
	return false
}

func internalEmailMessageIDForProvider(thread domain.CommunicationsEmailThread, providerMessageID string) string {
	providerMessageID = strings.TrimSpace(providerMessageID)
	for _, item := range thread.Messages {
		if strings.TrimSpace(item.ProviderMessageID) == providerMessageID {
			return strings.TrimSpace(item.EmailMessageID)
		}
	}
	return ""
}

func communicationsEmailThreadInputFromStoredThread(thread domain.CommunicationsEmailThread, message domain.EmailMessageSnapshot, historyComplete bool) store.CommunicationsEmailThreadUpsertInput {
	input := store.CommunicationsEmailThreadUpsertInput{
		CompanyID: thread.CompanyID, PersonalUserID: thread.PersonalUserID, PersonalAccountEmail: thread.PersonalAccountEmail,
		SharedInboxID: thread.SharedInboxID, AccountEmail: thread.AccountEmail, Provider: thread.Provider, ProviderThreadID: thread.ProviderThreadID,
		SelectedMessageID: message.ID, Messages: []domain.EmailMessageSnapshot{message}, HistoryComplete: historyComplete, FetchedAt: time.Now().UTC(),
	}
	return input
}

func (s *Server) resolveEmailThreadSourceConnection(thread domain.CommunicationsEmailThread, actorUserID string) (domain.UserEmailConnection, error) {
	return s.resolveEmailCollaborationSourceConnection(domain.CommunicationsEmailCollaboration{
		CompanyID: thread.CompanyID, ScopeType: thread.ScopeType, PersonalUserID: thread.PersonalUserID,
		PersonalAccountEmail: thread.PersonalAccountEmail, SharedInboxID: thread.SharedInboxID, AccountEmail: thread.AccountEmail,
		ProviderThreadID: thread.ProviderThreadID, RootMessageID: thread.RootProviderMessageID,
	}, actorUserID)
}

func (s *Server) storeImportedEmailMessageAttachments(ctx context.Context, connection domain.UserEmailConnection, thread domain.CommunicationsEmailThread, actorUserID string, message NylasMessage) (NylasMessage, error) {
	if len(message.Attachments) == 0 {
		return message, nil
	}
	if s.attachmentStorage == nil {
		return NylasMessage{}, errCommunicationsEmailAttachmentUnavailable
	}
	emailMessageID := internalEmailMessageIDForProvider(thread, message.ID)
	if emailMessageID == "" {
		return NylasMessage{}, errCommunicationsEmailAttachmentUnavailable
	}
	for index := range message.Attachments {
		attachment := &message.Attachments[index]
		mangoAttachmentID := strings.TrimSpace(attachment.AttachmentID)
		if mangoAttachmentID != "" {
			if _, getErr := s.repo.GetAttachment(thread.CompanyID, mangoAttachmentID); getErr == nil {
				if err := s.linkImportedEmailAttachment(thread.CompanyID, actorUserID, emailMessageID, mangoAttachmentID, attachment.IsInline || strings.TrimSpace(attachment.ContentID) != ""); err != nil {
					return NylasMessage{}, err
				}
				continue
			}
		}
		providerAttachmentID := firstNonBlank(attachment.ID, attachment.AttachmentID)
		mangoAttachmentID = deterministicImportedEmailAttachmentID(thread.CompanyID, thread.EmailThreadID, message.ID, providerAttachmentID, attachment.ContentID, attachment.Filename)
		if _, getErr := s.repo.GetAttachment(thread.CompanyID, mangoAttachmentID); getErr == nil {
			attachment.AttachmentID = mangoAttachmentID
			if err := s.linkImportedEmailAttachment(thread.CompanyID, actorUserID, emailMessageID, mangoAttachmentID, attachment.IsInline || strings.TrimSpace(attachment.ContentID) != ""); err != nil {
				return NylasMessage{}, err
			}
			continue
		}
		body, err := importedEmailAttachmentBytes(ctx, s, connection, message.ID, providerAttachmentID)
		if err != nil {
			return NylasMessage{}, err
		}
		mimeType := strings.TrimSpace(attachment.ContentType)
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		filename := strings.TrimSpace(attachment.Filename)
		if filename == "" {
			filename = "email-attachment"
		}
		digest := sha256.Sum256(body)
		digestHex := fmt.Sprintf("%x", digest[:])
		storageKey := attachmentOriginalObjectKey(thread.CompanyID, mangoAttachmentID)
		if err := s.attachmentStorage.PutObject(ctx, AttachmentPutObjectInput{Key: storageKey, ContentType: mimeType, ContentLength: int64(len(body)), SHA256: digestHex, Body: bytes.NewReader(body)}); err != nil {
			return NylasMessage{}, errCommunicationsEmailAttachmentUnavailable
		}
		relationship := store.AttachmentRelationshipEmailAttachment
		if attachment.IsInline || strings.TrimSpace(attachment.ContentID) != "" {
			relationship = store.AttachmentRelationshipEmailInline
		}
		now := time.Now().UTC()
		_, _, createErr := s.repo.CreateAttachmentWithResourceLink(store.AttachmentCreateInput{
			CompanyID: thread.CompanyID, AttachmentID: mangoAttachmentID, UploadedByUserID: actorUserID, OriginalFilename: filename,
			MimeType: mimeType, ByteSize: int64(len(body)), SHA256: digestHex, SHA256VerificationMethod: "server_stream",
			StorageChecksumAlgorithm: "SHA256", StorageChecksumValue: rawSHA256Base64(digestHex), StorageChecksumType: "FULL_OBJECT",
			StorageBucket: s.attachmentStorage.Bucket(), StorageKey: storageKey, SourceKind: store.AttachmentSourceEmailIncoming,
			SourceProvider: strings.TrimSpace(connection.Provider), CreatedTimestamp: now,
			ResourceLink: store.ResourceAttachmentInput{CompanyID: thread.CompanyID, ResourceType: "email_message", ResourceID: emailMessageID, RelationshipKind: relationship, CreatedByUserID: actorUserID, CreatedTimestamp: now},
		})
		if createErr != nil && !errors.Is(createErr, store.ErrAlreadyExists) {
			return NylasMessage{}, createErr
		}
		attachment.AttachmentID = mangoAttachmentID
		if err := s.linkImportedEmailAttachment(thread.CompanyID, actorUserID, emailMessageID, mangoAttachmentID, relationship == store.AttachmentRelationshipEmailInline); err != nil {
			return NylasMessage{}, err
		}
	}
	return message, nil
}

func importedEmailAttachmentBytes(ctx context.Context, s *Server, connection domain.UserEmailConnection, messageID, providerAttachmentID string) ([]byte, error) {
	if strings.TrimSpace(providerAttachmentID) == "" {
		return nil, errCommunicationsEmailAttachmentUnavailable
	}
	var body []byte
	err := s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
		var callErr error
		body, callErr = s.nylasClient.DownloadAttachment(callCtx, connection.GrantID, messageID, providerAttachmentID)
		return callErr
	})
	if err != nil || int64(len(body)) > communicationsAttachmentDownloadMaxBytes {
		return nil, errCommunicationsEmailAttachmentUnavailable
	}
	return body, nil
}
func deterministicImportedEmailAttachmentID(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x1f")))
	b := append([]byte(nil), sum[:16]...)
	b[6] = (b[6] & 0x0f) | 0x50
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func (s *Server) linkImportedEmailAttachment(companyID, actorUserID, emailMessageID, attachmentID string, inline bool) error {
	relationship := store.AttachmentRelationshipEmailAttachment
	if inline {
		relationship = store.AttachmentRelationshipEmailInline
	}
	_, err := s.repo.LinkResourceAttachment(store.ResourceAttachmentInput{
		CompanyID: companyID, ResourceType: "email_message", ResourceID: emailMessageID,
		AttachmentID: attachmentID, RelationshipKind: relationship, CreatedByUserID: actorUserID,
	})
	return err
}
func (s *Server) recordCommunicationsEmailThreadDownloadFailure(job store.CommunicationsEmailThreadDownloadJob, downloadErr error) error {
	code := communicationsMutationErrorCode(downloadErr)
	if errors.Is(downloadErr, errCommunicationsEmailAttachmentUnavailable) {
		code = "email_attachment_download_failed"
	}
	if errors.Is(downloadErr, errCommunicationsEmailThreadDownloadUnavailable) || errors.Is(downloadErr, errEmailCollaborationSourceUnavailable) {
		code = "email_thread_source_unavailable"
	}
	final := communicationsEmailThreadDownloadFailureIsFinal(downloadErr, job.AttemptCount)
	availableAt := time.Now().UTC().Add(communicationsEmailThreadDownloadRetryDelay(job.AttemptCount))
	return s.repo.MarkCommunicationsEmailThreadDownloadJobFailed(job.DownloadJobID, code, availableAt, final)
}

func communicationsEmailThreadDownloadFailureIsFinal(err error, attemptCount int) bool {
	if attemptCount >= communicationsEmailThreadDownloadMaxAttempts || errors.Is(err, store.ErrInvalid) || errors.Is(err, store.ErrNotFound) {
		return true
	}
	var apiErr NylasAPIError
	if errors.As(err, &apiErr) && apiErr.StatusCode >= http.StatusBadRequest && apiErr.StatusCode < http.StatusInternalServerError && apiErr.StatusCode != http.StatusTooManyRequests {
		return true
	}
	return false
}

func communicationsEmailThreadDownloadRetryDelay(attemptCount int) time.Duration {
	if attemptCount <= 1 {
		return time.Second
	}
	shift := attemptCount - 1
	if shift > 8 {
		shift = 8
	}
	delay := time.Duration(1<<shift) * time.Second
	if delay > communicationsEmailThreadDownloadMaxRetryDelay {
		return communicationsEmailThreadDownloadMaxRetryDelay
	}
	return delay
}

func (s *Server) linkStoredEmailThreadAttachments(companyID, emailThreadID, actorUserID string) error {
	thread, err := s.repo.GetCommunicationsEmailThread(companyID, emailThreadID)
	if err != nil {
		return err
	}

	for _, item := range thread.Messages {
		for _, attachment := range item.Message.Attachments {
			attachmentID := strings.TrimSpace(attachment.AttachmentID)
			if attachmentID == "" {
				continue
			}
			if _, err := s.repo.GetAttachment(companyID, attachmentID); err != nil {
				continue
			}
			if err := s.linkImportedEmailAttachment(companyID, actorUserID, item.EmailMessageID, attachmentID, attachment.IsInline || strings.TrimSpace(attachment.ContentID) != ""); err != nil {
				return err
			}
		}
	}
	return nil
}
