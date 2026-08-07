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
	defaultCommunicationsEmailConnectionScanInterval       = 30 * time.Second
	communicationsEmailConnectionScanOverlap               = 5 * time.Minute
	communicationsEmailReconnectBacklogThreshold           = 5 * time.Minute
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
	go s.runCommunicationsEmailConnectionScanner(ctx)
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

func (s *Server) runCommunicationsEmailConnectionScanner(ctx context.Context) {
	ticker := time.NewTicker(defaultCommunicationsEmailConnectionScanInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.communicationsEmailConnectionScannerWake:
		}
		if err := s.scanConnectedCommunicationsEmailConnections(ctx, time.Now().UTC()); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("communications email connection scan failed: %v", err)
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

func (s *Server) wakeCommunicationsEmailConnectionScanner() {
	if s == nil || s.communicationsEmailThreadDownloadWorkerDisabled || s.communicationsEmailConnectionScannerWake == nil {
		return
	}
	select {
	case s.communicationsEmailConnectionScannerWake <- struct{}{}:
	default:
	}
}

func (s *Server) scanConnectedCommunicationsEmailConnections(ctx context.Context, scanStarted time.Time) error {
	connections, err := s.repo.ListConnectedEmailConnections()
	if err != nil {
		return err
	}
	for _, connection := range connections {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := s.scanConnectedCommunicationsEmailConnection(ctx, connection, scanStarted); err != nil {
			normalized := s.normalizeCommunicationsEmailIngestionError(connection, err)
			if !errors.Is(normalized, errCommunicationsEmailConnectionReauthRequired) {
				log.Printf("communications email connection scan failed company_id=%s connection_id=%s: %v", connection.CompanyID, connection.EmailConnectionID, normalized)
			}
		}
	}
	return nil
}

func (s *Server) scanConnectedCommunicationsEmailConnection(ctx context.Context, connection domain.UserEmailConnection, scanStarted time.Time) error {
	if connection.Status != "connected" || connection.EmailConnectionID == "" || connection.CompanyID == "" {
		return nil
	}
	var folders []NylasFolder
	if err := s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
		var callErr error
		folders, callErr = s.nylasClient.ListFolders(callCtx, connection.GrantID)
		return callErr
	}); err != nil {
		return err
	}
	inboxID := findNylasSystemFolderID(folders, "inbox")
	if inboxID == "" {
		return errEmailCollaborationSourceUnavailable
	}
	lowerBound := connection.LastSuccessfulScanAt.UTC().Add(-communicationsEmailConnectionScanOverlap)
	activationFloor := connection.IngestionStartedAt.UTC().Add(-time.Second)
	if lowerBound.Before(activationFloor) {
		lowerBound = activationFloor
	}
	priority := store.CommunicationsEmailIngestionPriorityScan
	if scanStarted.Sub(connection.LastSuccessfulScanAt) > communicationsEmailReconnectBacklogThreshold {
		priority = store.CommunicationsEmailIngestionPriorityBacklog
	}
	pageToken := ""
	seenPageTokens := map[string]bool{}
	for {
		var page NylasMessagePage
		err := s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
			var callErr error
			page, callErr = s.nylasClient.ListMessages(callCtx, connection.GrantID, NylasMessageQuery{
				Limit: 200, PageToken: pageToken, FolderID: inboxID,
				ReceivedAfter: lowerBound.Unix(), ReceivedBefore: scanStarted.Unix(),
			})
			return callErr
		})
		if err != nil {
			return err
		}
		for _, message := range page.Messages {
			if message.Date < connection.IngestionStartedAt.Unix() || strings.TrimSpace(message.ID) == "" {
				continue
			}
			if _, _, err := s.repo.EnsureCommunicationsEmailIngestionJob(store.CommunicationsEmailIngestionJobInput{
				CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
				ProviderMessageID: message.ID, ProviderThreadID: message.ThreadID, Priority: priority,
			}); err != nil {
				return err
			}
		}
		next := strings.TrimSpace(page.NextPageToken)
		if next == "" {
			break
		}
		if seenPageTokens[next] {
			return errors.New("email connection scan repeated page token")
		}
		seenPageTokens[next] = true
		pageToken = next
	}
	if err := s.repo.UpdateEmailConnectionScanCheckpoint(connection.CompanyID, connection.EmailConnectionID, scanStarted); err != nil {
		return err
	}
	s.wakeCommunicationsEmailThreadDownloadWorker()
	return nil
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
	connection, err := s.repo.GetEmailConnectionByID(job.CompanyID, job.EmailConnectionID)
	if err != nil {
		return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
	}
	if connection.Status != "connected" || strings.TrimSpace(connection.GrantID) == "" {
		return s.recordCommunicationsEmailThreadDownloadFailure(job, errCommunicationsEmailConnectionReauthRequired)
	}

	automaticDiscovery := strings.TrimSpace(job.EmailThreadID) == ""
	var trigger NylasMessage
	err = s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
		var callErr error
		trigger, callErr = s.nylasClient.GetMessage(callCtx, connection.GrantID, job.ProviderMessageID)
		return callErr
	})
	if err != nil {
		return s.recordCommunicationsEmailThreadDownloadFailure(job, s.normalizeCommunicationsEmailIngestionError(connection, err))
	}
	if strings.TrimSpace(trigger.ID) != strings.TrimSpace(job.ProviderMessageID) {
		return s.recordCommunicationsEmailThreadDownloadFailure(job, errEmailCollaborationSourceUnavailable)
	}
	if automaticDiscovery {
		if trigger.Date < connection.IngestionStartedAt.Unix() {
			return s.repo.MarkCommunicationsEmailThreadDownloadJobCompleted(job.DownloadJobID)
		}
		eligible, inboxErr := s.communicationsEmailMessageIsInInbox(ctx, connection, trigger)
		if inboxErr != nil {
			return s.recordCommunicationsEmailThreadDownloadFailure(job, s.normalizeCommunicationsEmailIngestionError(connection, inboxErr))
		}
		if !eligible {
			return s.repo.MarkCommunicationsEmailThreadDownloadJobCompleted(job.DownloadJobID)
		}
	}

	var thread domain.CommunicationsEmailThread
	if strings.TrimSpace(job.EmailThreadID) != "" {
		thread, err = s.repo.GetCommunicationsEmailThread(job.CompanyID, job.EmailThreadID)
	} else {
		preliminary := emailMessageSnapshotFromNylas(trigger)
		preliminary.DownloadComplete = false
		thread, err = s.repo.UpsertCommunicationsEmailThread(
			s.communicationsEmailThreadInputForConnection(connection, preliminary, false),
		)
	}
	if err != nil {
		return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
	}
	if thread.EmailConnectionID != "" && thread.EmailConnectionID != job.EmailConnectionID {
		return s.recordCommunicationsEmailThreadDownloadFailure(job, store.ErrInvalid)
	}
	job.EmailThreadID = thread.EmailThreadID
	job.ProviderThreadID = firstNonBlank(thread.ProviderThreadID, trigger.ThreadID, job.ProviderThreadID)
	attachedJob, _, attachErr := s.repo.EnsureCommunicationsEmailIngestionJob(store.CommunicationsEmailIngestionJobInput{
		CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID, EmailThreadID: thread.EmailThreadID,
		ProviderMessageID: job.ProviderMessageID, ProviderThreadID: job.ProviderThreadID, Priority: job.Priority,
	})
	if attachErr != nil {
		return s.recordCommunicationsEmailThreadDownloadFailure(job, attachErr)
	}
	job.EmailThreadID = attachedJob.EmailThreadID

	messageIDs := []string{trigger.ID}
	if strings.TrimSpace(job.ProviderThreadID) != "" {
		var providerThread NylasThread
		err = s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
			var callErr error
			providerThread, callErr = s.nylasClient.GetThread(callCtx, connection.GrantID, job.ProviderThreadID)
			return callErr
		})
		if err != nil || strings.TrimSpace(providerThread.ID) != strings.TrimSpace(job.ProviderThreadID) {
			if err == nil {
				err = errEmailCollaborationSourceUnavailable
			}
			return s.recordCommunicationsEmailThreadDownloadFailure(job, s.normalizeCommunicationsEmailIngestionError(connection, err))
		}
		messageIDs = cleanEmailCollaborationThreadMessageIDs(providerThread.MessageIDs)
		messageIDs = cleanEmailCollaborationThreadMessageIDs(append(messageIDs, trigger.ID))
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
		message := trigger
		if messageID != trigger.ID {
			err = s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
				var callErr error
				message, callErr = s.nylasClient.GetMessage(callCtx, connection.GrantID, messageID)
				return callErr
			})
		}
		if err != nil {
			return s.recordCommunicationsEmailThreadDownloadFailure(job, s.normalizeCommunicationsEmailIngestionError(connection, err))
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
		message, err = s.storeImportedEmailMessageAttachments(ctx, connection, thread, connection.UserID, message)
		if err != nil {
			return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
		}
		snapshot := emailMessageSnapshotFromNylas(message)
		snapshot.DownloadComplete = true
		if _, err = s.repo.UpsertCommunicationsEmailThread(communicationsEmailThreadInputFromStoredThread(thread, snapshot, false)); err != nil {
			return s.recordCommunicationsEmailThreadDownloadFailure(job, err)
		}
	}

	thread, err = s.repo.GetCommunicationsEmailThread(job.CompanyID, thread.EmailThreadID)
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
	if err := s.repo.MarkCommunicationsEmailThreadDownloadJobCompleted(job.DownloadJobID); err != nil {
		return err
	}
	s.publishCommunicationsEmailIngestionCompletion(connection, trigger.ID, job.ProviderThreadID)
	return nil
}

func (s *Server) publishCommunicationsEmailIngestionCompletion(connection domain.UserEmailConnection, messageID, threadID string) {
	change := nylasWebhookChange{
		Trigger: "message.updated", MessageID: strings.TrimSpace(messageID),
		ThreadID: strings.TrimSpace(threadID), OccurredAt: time.Now().UTC(),
	}
	if communicationsMessageReadStatusScopeTypeForConnection(connection) != "shared" {
		s.applyNylasWebhookCacheInvalidation(connection.UserID, communicationsConnectionCacheScope(connection), change)
		if err := s.publishPersonalMailboxWebhookHint(connection.UserID, connection.AccountEmail, change); err != nil {
			log.Printf("failed to publish completed personal email ingestion hint company_id=%s connection_id=%s message_id=%s: %v", connection.CompanyID, connection.EmailConnectionID, messageID, err)
		}
		return
	}
	s.applyNylasWebhookCacheInvalidationForAccountScope(communicationsConnectionCacheScope(connection), change)
	companyConnection := companyEmailConnectionFromUserConnectionForHTTP(connection)
	sharedInboxIDs, err := s.communicationsSharedInboxIDsForCompanyEmailConnection(companyConnection)
	if err != nil {
		log.Printf("failed to resolve completed shared email ingestion audience company_id=%s connection_id=%s message_id=%s: %v", connection.CompanyID, connection.EmailConnectionID, messageID, err)
		return
	}
	for _, sharedInboxID := range sharedInboxIDs {
		if err := s.publishSharedMailboxWebhookHint(connection.CompanyID, sharedInboxID, change); err != nil {
			log.Printf("failed to publish completed shared email ingestion hint company_id=%s connection_id=%s shared_inbox_id=%s message_id=%s: %v", connection.CompanyID, connection.EmailConnectionID, sharedInboxID, messageID, err)
		}
	}
}

func companyEmailConnectionFromUserConnectionForHTTP(connection domain.UserEmailConnection) domain.CompanyEmailConnection {
	return domain.CompanyEmailConnection{
		EmailConnectionID:        connection.EmailConnectionID,
		CompanyEmailConnectionID: connection.CompanyEmailConnectionID,
		CompanyID:                connection.CompanyID, Provider: connection.Provider,
		AccountEmail: connection.AccountEmail, GrantID: connection.GrantID,
		Status: connection.Status, ConnectedByUserID: connection.UserID,
		IngestionStartedAt:   connection.IngestionStartedAt,
		LastSuccessfulScanAt: connection.LastSuccessfulScanAt,
		CreatedTimestamp:     connection.CreatedTimestamp, UpdatedTimestamp: connection.UpdatedTimestamp,
	}
}

var errCommunicationsEmailConnectionReauthRequired = errors.New("email connection reauth required")

func (s *Server) normalizeCommunicationsEmailIngestionError(connection domain.UserEmailConnection, err error) error {
	var apiErr NylasAPIError
	if errors.As(err, &apiErr) && (apiErr.StatusCode == http.StatusUnauthorized || apiErr.StatusCode == http.StatusForbidden) {
		if communicationsMessageReadStatusScopeTypeForConnection(connection) == "shared" {
			_, _ = s.repo.UpdateCompanyEmailConnectionStatus(connection.CompanyID, connection.CompanyEmailConnectionID, "reauth_required")
		} else {
			_, _ = s.repo.UpdateUserEmailConnectionStatus(connection.UserID, connection.AccountEmail, "reauth_required")
		}
		return errCommunicationsEmailConnectionReauthRequired
	}
	return err
}

func (s *Server) communicationsEmailMessageIsInInbox(ctx context.Context, connection domain.UserEmailConnection, message NylasMessage) (bool, error) {
	var folders []NylasFolder
	err := s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
		var callErr error
		folders, callErr = s.nylasClient.ListFolders(callCtx, connection.GrantID)
		return callErr
	})
	if err != nil {
		return false, err
	}
	inboxID := strings.TrimSpace(findNylasSystemFolderID(folders, "inbox"))
	for _, folder := range append(append([]string(nil), message.Folders...), message.FolderIDs...) {
		folder = strings.Trim(strings.ToLower(strings.TrimSpace(folder)), "\\")
		if folder == "inbox" || (inboxID != "" && folder == strings.ToLower(inboxID)) {
			return true, nil
		}
	}
	return false, nil
}

func (s *Server) communicationsEmailThreadInputForConnection(connection domain.UserEmailConnection, message domain.EmailMessageSnapshot, historyComplete bool) store.CommunicationsEmailThreadUpsertInput {
	input := store.CommunicationsEmailThreadUpsertInput{
		CompanyID: connection.CompanyID, AccountEmail: connection.AccountEmail, Provider: connection.Provider,
		ProviderThreadID: message.ThreadID, SelectedMessageID: message.ID, Messages: []domain.EmailMessageSnapshot{message},
		HistoryComplete: historyComplete, FetchedAt: time.Now().UTC(),
	}
	if communicationsMessageReadStatusScopeTypeForConnection(connection) == "shared" {
		companyConnection := domain.CompanyEmailConnection{
			EmailConnectionID: connection.EmailConnectionID, CompanyEmailConnectionID: connection.CompanyEmailConnectionID,
			CompanyID: connection.CompanyID, AccountEmail: connection.AccountEmail,
		}
		if sharedInboxIDs, err := s.communicationsSharedInboxIDsForCompanyEmailConnection(companyConnection); err == nil && len(sharedInboxIDs) > 0 {
			input.SharedInboxID = sharedInboxIDs[0]
		}
	} else {
		input.PersonalUserID = connection.UserID
		input.PersonalAccountEmail = connection.AccountEmail
	}
	return input
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
	if errors.Is(downloadErr, errCommunicationsEmailConnectionReauthRequired) {
		code = "email_connection_reauth_required"
	}
	if errors.Is(downloadErr, errCommunicationsEmailAttachmentUnavailable) {
		code = "email_attachment_download_failed"
	}
	if errors.Is(downloadErr, errCommunicationsEmailThreadDownloadUnavailable) || errors.Is(downloadErr, errEmailCollaborationSourceUnavailable) {
		code = "email_thread_source_unavailable"
	}
	final := communicationsEmailThreadDownloadFailureIsFinal(downloadErr, job.AttemptCount)
	availableAt := time.Now().UTC().Add(communicationsEmailThreadDownloadRetryDelay(job.AttemptCount))
	if errors.Is(downloadErr, errCommunicationsEmailConnectionReauthRequired) {
		availableAt = time.Now().UTC().Add(5 * time.Minute)
	}
	return s.repo.MarkCommunicationsEmailThreadDownloadJobFailed(job.DownloadJobID, code, availableAt, final)
}

func communicationsEmailThreadDownloadFailureIsFinal(err error, attemptCount int) bool {
	if errors.Is(err, errCommunicationsEmailConnectionReauthRequired) {
		return false
	}
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
