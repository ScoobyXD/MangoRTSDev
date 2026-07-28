package httpapi

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"strings"
	"sync"
	"time"
)

const communicationsEmailThreadDownloadWorkers = 4

var errEmailCollaborationSourceUnavailable = errors.New("email collaboration source unavailable")

// loadCommunicationsEmailCollaborationThread reads through the collaboration's
// immutable source mailbox. The caller has already resolved the collaboration
// through GetCommunicationsEmailCollaboration, which is the permanent-
// participant authorization boundary; source-mailbox permissions are not
// required (and provider credentials are never returned to the participant).
func (s *Server) loadCommunicationsEmailCollaborationThread(ctx context.Context, collaboration domain.CommunicationsEmailCollaboration, actorUserID string) ([]NylasMessage, bool) {
	if s.nylasClient == nil || !s.nylasConfig.IsConfigured() {
		return nil, false
	}
	connection, err := s.resolveEmailCollaborationSourceConnection(collaboration, actorUserID)
	if err != nil {
		return nil, false
	}
	threadID := strings.TrimSpace(collaboration.ProviderThreadID)
	if threadID == "" {
		return nil, false
	}

	var thread NylasThread
	if err := s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
		var callErr error
		thread, callErr = s.nylasClient.GetThread(callCtx, connection.GrantID, threadID)
		return callErr
	}); err != nil || strings.TrimSpace(thread.ID) != threadID {
		return nil, false
	}

	messageIDs := cleanEmailCollaborationThreadMessageIDs(thread.MessageIDs)
	if len(messageIDs) == 0 {
		return nil, false
	}
	messages, err := s.downloadEmailThreadMessages(ctx, connection, threadID, messageIDs)
	if err != nil {
		return nil, false
	}
	return messages, true
}

func (s *Server) resolveEmailCollaborationSourceConnection(collaboration domain.CommunicationsEmailCollaboration, actorUserID string) (domain.UserEmailConnection, error) {
	var connection domain.UserEmailConnection
	switch strings.TrimSpace(collaboration.ScopeType) {
	case store.CommunicationsEmailCollaborationScopeShared:
		companyConnection, err := s.repo.GetCompanyEmailConnectionByAccountEmail(collaboration.CompanyID, collaboration.AccountEmail)
		if err != nil {
			return domain.UserEmailConnection{}, errEmailCollaborationSourceUnavailable
		}
		connection = userConnectionForCompanyEmailConnection(companyConnection, actorUserID)
	case store.CommunicationsEmailCollaborationScopePersonal:
		connections, err := s.repo.ListUserEmailConnections(collaboration.PersonalUserID)
		if err != nil {
			return domain.UserEmailConnection{}, errEmailCollaborationSourceUnavailable
		}
		accountEmail := normalizeEmailForCompare(collaboration.PersonalAccountEmail)
		for _, candidate := range connections {
			if normalizeEmailForCompare(candidate.AccountEmail) == accountEmail {
				connection = candidate
				break
			}
		}
	default:
		return domain.UserEmailConnection{}, errEmailCollaborationSourceUnavailable
	}
	if connection.Status != "connected" || strings.TrimSpace(connection.GrantID) == "" {
		return domain.UserEmailConnection{}, errEmailCollaborationSourceUnavailable
	}
	return connection, nil
}

func cleanEmailCollaborationThreadMessageIDs(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func (s *Server) downloadEmailThreadMessages(ctx context.Context, connection domain.UserEmailConnection, threadID string, messageIDs []string) ([]NylasMessage, error) {
	type messageDownloadJob struct {
		index     int
		messageID string
	}

	downloadCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	jobs := make(chan messageDownloadJob, len(messageIDs))
	for index, messageID := range messageIDs {
		jobs <- messageDownloadJob{index: index, messageID: messageID}
	}
	close(jobs)

	messages := make([]NylasMessage, len(messageIDs))
	workerCount := communicationsEmailThreadDownloadWorkers
	if workerCount > len(messageIDs) {
		workerCount = len(messageIDs)
	}
	var workers sync.WaitGroup
	var firstErr error
	var firstErrOnce sync.Once
	recordError := func(err error) {
		firstErrOnce.Do(func() {
			firstErr = err
			cancel()
		})
	}
	for worker := 0; worker < workerCount; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for job := range jobs {
				if downloadCtx.Err() != nil {
					return
				}
				var message NylasMessage
				err := s.withCommunicationsNylasGate(downloadCtx, connection, func(callCtx context.Context) error {
					var callErr error
					message, callErr = s.nylasClient.GetMessage(callCtx, connection.GrantID, job.messageID)
					return callErr
				})
				if err != nil {
					recordError(err)
					return
				}
				if strings.TrimSpace(message.ID) != job.messageID || strings.TrimSpace(message.ThreadID) != threadID {
					recordError(errEmailCollaborationSourceUnavailable)
					return
				}
				messages[job.index] = message
			}
		}()
	}
	workers.Wait()
	if firstErr != nil {
		return nil, firstErr
	}
	return messages, nil
}

func communicationsEmailThreadInputFromCollaboration(collaboration domain.CommunicationsEmailCollaboration, messages []domain.EmailMessageSnapshot, historyComplete bool, downloadError string) store.CommunicationsEmailThreadUpsertInput {
	input := store.CommunicationsEmailThreadUpsertInput{
		CompanyID: collaboration.CompanyID, AccountEmail: collaboration.AccountEmail,
		ProviderThreadID: collaboration.ProviderThreadID, SelectedMessageID: collaboration.RootMessageID,
		Messages: messages, HistoryComplete: historyComplete, FetchedAt: time.Now().UTC(),
		LastDownloadError: downloadError,
	}
	if input.SelectedMessageID == "" {
		input.SelectedMessageID = collaboration.Message.ID
	}
	if collaboration.ScopeType == store.CommunicationsEmailCollaborationScopeShared {
		input.SharedInboxID = collaboration.SharedInboxID
	} else {
		input.PersonalUserID = collaboration.PersonalUserID
		input.PersonalAccountEmail = collaboration.PersonalAccountEmail
	}
	return input
}

func (s *Server) downloadAndPersistCommunicationsEmailCollaborationThread(ctx context.Context, collaboration domain.CommunicationsEmailCollaboration, actorUserID string) (domain.CommunicationsEmailThread, bool) {
	providerMessages, complete := s.loadCommunicationsEmailCollaborationThread(ctx, collaboration, actorUserID)
	snapshots := make([]domain.EmailMessageSnapshot, 0, len(providerMessages))
	for _, message := range providerMessages {
		snapshots = append(snapshots, emailMessageSnapshotFromNylas(message))
	}
	downloadError := ""
	if !complete {
		snapshots = []domain.EmailMessageSnapshot{collaboration.Message}
		downloadError = "provider_thread_temporarily_unavailable"
	}
	thread, err := s.repo.UpsertCommunicationsEmailThread(communicationsEmailThreadInputFromCollaboration(collaboration, snapshots, complete, downloadError))
	if err != nil {
		return domain.CommunicationsEmailThread{}, false
	}
	return thread, complete
}

func storedEmailThreadMessages(thread domain.CommunicationsEmailThread) []domain.EmailMessageSnapshot {
	messages := make([]domain.EmailMessageSnapshot, 0, len(thread.Messages))
	for _, item := range thread.Messages {
		messages = append(messages, item.Message)
	}
	return messages
}
