package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
	"time"
)

var (
	errCommunicationsEmailIngestionUnavailable  = errors.New("email ingestion unavailable")
	errCommunicationsEmailAttachmentUnavailable = errors.New("email attachment unavailable")
)

func (s *Server) processCommunicationsEmailIngestionProviderWork(ctx context.Context, job store.CommunicationsEmailIngestionJob) error {
	if s.nylasClient == nil {
		return errCommunicationsEmailIngestionUnavailable
	}
	connection, err := s.repo.GetEmailConnectionByIDContext(ctx, job.CompanyID, job.EmailConnectionID)
	if err != nil {
		return err
	}
	if connection.Status != "connected" || strings.TrimSpace(connection.GrantID) == "" {
		return errCommunicationsEmailConnectionReauthRequired
	}

	automaticDiscovery := strings.TrimSpace(job.EmailThreadID) == ""
	var trigger NylasMessage
	err = s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
		var callErr error
		trigger, callErr = s.nylasClient.GetMessage(callCtx, connection.GrantID, job.ProviderMessageID)
		return callErr
	})
	if err != nil {
		return normalizeCommunicationsEmailProviderError(connection, err)
	}
	if strings.TrimSpace(trigger.ID) != strings.TrimSpace(job.ProviderMessageID) {
		return errEmailCollaborationSourceUnavailable
	}
	if automaticDiscovery {
		if trigger.Date < connection.IngestionStartedAt.Unix() {
			return nil
		}
		eligible, folderErr := s.communicationsEmailMessageIsInInboxOrSent(ctx, connection, trigger)
		if folderErr != nil {
			return normalizeCommunicationsEmailProviderError(connection, folderErr)
		}
		if !eligible {
			return nil
		}
	}

	providerThreadID := firstNonBlank(trigger.ThreadID, job.ProviderThreadID)
	messageIDs := []string{trigger.ID}
	if providerThreadID != "" {
		var providerThread NylasThread
		err = s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
			var callErr error
			providerThread, callErr = s.nylasClient.GetThread(callCtx, connection.GrantID, providerThreadID)
			return callErr
		})
		if err != nil || strings.TrimSpace(providerThread.ID) != providerThreadID {
			if err == nil {
				err = errEmailCollaborationSourceUnavailable
			}
			return normalizeCommunicationsEmailProviderError(connection, err)
		}
		messageIDs = cleanEmailCollaborationThreadMessageIDs(providerThread.MessageIDs)
		messageIDs = cleanEmailCollaborationThreadMessageIDs(append(messageIDs, trigger.ID))
	}
	if len(messageIDs) == 0 {
		return store.ErrInvalid
	}

	var thread domain.CommunicationsEmailThread
	if strings.TrimSpace(job.EmailThreadID) != "" {
		thread, err = s.repo.GetCommunicationsEmailThreadContext(ctx, job.CompanyID, job.EmailThreadID)
	} else {
		identities, resolveErr := s.repo.ResolveCommunicationsEmailMessageIdentitiesForConnectionContext(
			ctx, job.CompanyID, job.EmailConnectionID, messageIDs,
		)
		if resolveErr != nil {
			return resolveErr
		}
		storedThreadID := ""
		for _, messageID := range messageIDs {
			identity, ok := identities[messageID]
			if !ok {
				continue
			}
			if storedThreadID != "" && storedThreadID != identity.EmailThreadID {
				return errEmailCollaborationSourceUnavailable
			}
			storedThreadID = identity.EmailThreadID
		}
		if storedThreadID != "" {
			thread, err = s.repo.GetCommunicationsEmailThreadContext(ctx, job.CompanyID, storedThreadID)
		} else {
			preliminary := emailMessageSnapshotFromNylas(trigger)
			preliminary.DownloadComplete = false
			thread, err = s.repo.UpsertCommunicationsEmailThreadContext(ctx,
				s.communicationsEmailThreadInputForConnection(ctx, connection, preliminary, false),
			)
		}
	}
	if err != nil {
		return err
	}
	if thread.EmailConnectionID != "" && thread.EmailConnectionID != job.EmailConnectionID {
		return store.ErrInvalid
	}
	if strings.TrimSpace(thread.ProviderThreadID) != "" && providerThreadID != "" &&
		strings.TrimSpace(thread.ProviderThreadID) != providerThreadID {
		return errEmailCollaborationSourceUnavailable
	}
	if strings.TrimSpace(thread.ProviderThreadID) == "" && providerThreadID != "" {
		providerMessageIDs := make(map[string]struct{}, len(messageIDs))
		for _, messageID := range messageIDs {
			providerMessageIDs[messageID] = struct{}{}
		}
		var anchor domain.EmailMessageSnapshot
		for _, stored := range thread.Messages {
			if _, ok := providerMessageIDs[stored.ProviderMessageID]; ok {
				anchor = stored.Message
				break
			}
		}
		if strings.TrimSpace(anchor.ID) == "" {
			return errEmailCollaborationSourceUnavailable
		}
		anchor.ThreadID = providerThreadID
		thread.ProviderThreadID = providerThreadID
		thread, err = s.repo.UpsertCommunicationsEmailThreadContext(ctx,
			communicationsEmailThreadInputFromStoredThread(thread, anchor, false),
		)
		if err != nil {
			return err
		}
	}
	job.EmailThreadID = thread.EmailThreadID
	job.ProviderThreadID = firstNonBlank(thread.ProviderThreadID, providerThreadID)
	attachedJob, _, attachErr := s.repo.EnsureCommunicationsEmailIngestionJobContext(ctx, store.CommunicationsEmailIngestionJobInput{
		CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID, EmailThreadID: thread.EmailThreadID,
		ProviderMessageID: job.ProviderMessageID, ProviderThreadID: job.ProviderThreadID, Priority: job.Priority,
	})
	if attachErr != nil {
		return attachErr
	}
	job.EmailThreadID = attachedJob.EmailThreadID

	for _, messageID := range messageIDs {
		storedMessage, stored := storedEmailMessageForProvider(thread, messageID)
		if stored && storedMessage.Message.DownloadComplete {
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
			return normalizeCommunicationsEmailProviderError(connection, err)
		}
		if strings.TrimSpace(message.ID) != messageID || (thread.ProviderThreadID != "" && strings.TrimSpace(message.ThreadID) != thread.ProviderThreadID) {
			return errEmailCollaborationSourceUnavailable
		}
		message, err = s.attachRawMIMEAttachmentsIfMissingResult(ctx, connection, message)
		if err != nil {
			return normalizeCommunicationsEmailProviderError(connection, err)
		}
		if emailMessageHasUnresolvedCIDAttachments(message) {
			return errCommunicationsEmailAttachmentUnavailable
		}
		if stored {
			message = communicationsSendResponseWithLocalContent(message, NylasSendMessageRequest{
				Attachments: nylasAttachmentsFromStoredSnapshots(storedMessage.Message.Attachments),
			})
		}
		preliminarySnapshot := emailMessageSnapshotFromNylas(message)
		preliminarySnapshot.DownloadComplete = false
		thread, err = s.repo.UpsertCommunicationsEmailThreadContext(ctx, communicationsEmailThreadInputFromStoredThread(thread, preliminarySnapshot, false))
		if err != nil {
			return err
		}
		message, err = s.storeImportedEmailMessageAttachments(ctx, connection, thread, connection.UserID, message)
		if err != nil {
			return err
		}
		snapshot := emailMessageSnapshotFromNylas(message)
		snapshot.DownloadComplete = true
		if thread, err = s.repo.UpsertCommunicationsEmailThreadContext(ctx, communicationsEmailThreadInputFromStoredThread(thread, snapshot, false)); err != nil {
			return err
		}
	}

	if len(thread.Messages) == 0 {
		return store.ErrInvalid
	}
	attachmentsChanged, err := s.repo.ConvergeCommunicationsEmailThreadAttachmentLinksContext(ctx, thread.CompanyID, thread.EmailThreadID)
	if err != nil {
		return err
	}
	if attachmentsChanged {
		s.wakeAttachmentDeletionCleanup()
	}
	anchor := thread.Messages[0].Message
	if _, err = s.repo.UpsertCommunicationsEmailThreadContext(ctx, communicationsEmailThreadInputFromStoredThread(thread, anchor, true)); err != nil {
		return err
	}
	return nil
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

var (
	errCommunicationsEmailConnectionReauthRequired        = errors.New("email connection reauth required")
	errCommunicationsEmailConnectionConfigurationRequired = errors.New("email connection configuration required")
)

func normalizeCommunicationsEmailProviderError(connection domain.UserEmailConnection, err error) error {
	var apiErr NylasAPIError
	if errors.As(err, &apiErr) {
		code := strings.TrimSpace(apiErr.Code)
		if apiErr.StatusCode == http.StatusUnauthorized || apiErr.StatusCode == http.StatusForbidden ||
			(apiErr.StatusCode == http.StatusNotFound && code == "grant.not_found") {
			return errCommunicationsEmailConnectionReauthRequired
		}
		if apiErr.StatusCode == http.StatusBadRequest && strings.EqualFold(strings.TrimSpace(connection.Provider), "google") &&
			strings.Contains(strings.ToLower(apiErr.Message), "precondition") {
			return errCommunicationsEmailConnectionConfigurationRequired
		}
	}
	return err
}

func (s *Server) communicationsEmailMessageIsInInboxOrSent(ctx context.Context, connection domain.UserEmailConnection, message NylasMessage) (bool, error) {
	var folders []NylasFolder
	err := s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
		var callErr error
		folders, callErr = s.nylasClient.ListFolders(callCtx, connection.GrantID)
		return callErr
	})
	if err != nil {
		return false, err
	}
	return communicationsEmailMessageHasInboxOrSentFolder(message, folders), nil
}

func communicationsEmailMessageHasInboxOrSentFolder(message NylasMessage, folders []NylasFolder) bool {
	return nylasMessageHasAnyFolder(message, []string{
		"inbox", "sent",
		findNylasSystemFolderID(folders, "inbox"),
		findNylasSystemFolderID(folders, "sent"),
	})
}

func (s *Server) communicationsEmailThreadInputForConnection(ctx context.Context, connection domain.UserEmailConnection, message domain.EmailMessageSnapshot, historyComplete bool) store.CommunicationsEmailThreadUpsertInput {
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
		if sharedInboxIDs, err := s.communicationsSharedInboxIDsForCompanyEmailConnectionContext(ctx, companyConnection); err == nil && len(sharedInboxIDs) > 0 {
			input.SharedInboxID = sharedInboxIDs[0]
		}
	} else {
		input.PersonalUserID = connection.UserID
		input.PersonalAccountEmail = connection.AccountEmail
	}
	return input
}

func storedEmailMessageForProvider(thread domain.CommunicationsEmailThread, providerMessageID string) (domain.CommunicationsEmailMessage, bool) {
	for _, item := range thread.Messages {
		if item.ProviderMessageID == providerMessageID {
			return item, true
		}
	}
	return domain.CommunicationsEmailMessage{}, false
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
			exists, getErr := s.repo.AttachmentExistsContext(ctx, thread.CompanyID, mangoAttachmentID)
			if getErr != nil {
				return NylasMessage{}, getErr
			}
			if exists {
				if err := s.linkImportedEmailAttachment(ctx, thread.CompanyID, actorUserID, emailMessageID, mangoAttachmentID, attachment.IsInline || strings.TrimSpace(attachment.ContentID) != ""); err != nil {
					return NylasMessage{}, err
				}
				continue
			}
		}
		providerAttachmentID := firstNonBlank(attachment.ID, attachment.AttachmentID)
		mangoAttachmentID = store.ImportedEmailAttachmentID(thread.CompanyID, thread.EmailThreadID, message.ID, providerAttachmentID, attachment.ContentID, attachment.Filename)
		exists, getErr := s.repo.AttachmentExistsContext(ctx, thread.CompanyID, mangoAttachmentID)
		if getErr != nil {
			return NylasMessage{}, getErr
		}
		if exists {
			attachment.AttachmentID = mangoAttachmentID
			if err := s.linkImportedEmailAttachment(ctx, thread.CompanyID, actorUserID, emailMessageID, mangoAttachmentID, attachment.IsInline || strings.TrimSpace(attachment.ContentID) != ""); err != nil {
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
		_, _, createErr := s.repo.CreateAttachmentWithResourceLinkContext(ctx, store.AttachmentCreateInput{
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
		if err := s.linkImportedEmailAttachment(ctx, thread.CompanyID, actorUserID, emailMessageID, mangoAttachmentID, relationship == store.AttachmentRelationshipEmailInline); err != nil {
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
	if err != nil {
		return nil, normalizeCommunicationsEmailProviderError(connection, err)
	}
	if int64(len(body)) > communicationsAttachmentDownloadMaxBytes {
		return nil, errCommunicationsEmailAttachmentUnavailable
	}
	return body, nil
}
func (s *Server) linkImportedEmailAttachment(ctx context.Context, companyID, actorUserID, emailMessageID, attachmentID string, inline bool) error {
	relationship := store.AttachmentRelationshipEmailAttachment
	if inline {
		relationship = store.AttachmentRelationshipEmailInline
	}
	_, err := s.repo.LinkResourceAttachmentContext(ctx, store.ResourceAttachmentInput{
		CompanyID: companyID, ResourceType: "email_message", ResourceID: emailMessageID,
		AttachmentID: attachmentID, RelationshipKind: relationship, CreatedByUserID: actorUserID,
	})
	return err
}
func (s *Server) linkStoredEmailThreadAttachments(ctx context.Context, companyID, emailThreadID, actorUserID string) error {
	thread, err := s.repo.GetCommunicationsEmailThreadContext(ctx, companyID, emailThreadID)
	if err != nil {
		return err
	}

	for _, item := range thread.Messages {
		for _, attachment := range item.Message.Attachments {
			attachmentID := strings.TrimSpace(attachment.AttachmentID)
			if attachmentID == "" {
				continue
			}
			exists, err := s.repo.AttachmentExistsContext(ctx, companyID, attachmentID)
			if err != nil || !exists {
				continue
			}
			if err := s.linkImportedEmailAttachment(ctx, companyID, actorUserID, item.EmailMessageID, attachmentID, attachment.IsInline || strings.TrimSpace(attachment.ContentID) != ""); err != nil {
				return err
			}
		}
	}
	return nil
}
