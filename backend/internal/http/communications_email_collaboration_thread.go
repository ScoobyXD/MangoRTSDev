package httpapi

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"strings"
	"sync"
)

const communicationsEmailCollaborationThreadHydrationWorkers = 4

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
	messages, err := s.hydrateEmailCollaborationThreadMessages(ctx, connection, threadID, messageIDs)
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

func (s *Server) hydrateEmailCollaborationThreadMessages(ctx context.Context, connection domain.UserEmailConnection, threadID string, messageIDs []string) ([]NylasMessage, error) {
	type hydrationJob struct {
		index     int
		messageID string
	}

	hydrationCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	jobs := make(chan hydrationJob, len(messageIDs))
	for index, messageID := range messageIDs {
		jobs <- hydrationJob{index: index, messageID: messageID}
	}
	close(jobs)

	messages := make([]NylasMessage, len(messageIDs))
	workerCount := communicationsEmailCollaborationThreadHydrationWorkers
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
				if hydrationCtx.Err() != nil {
					return
				}
				var message NylasMessage
				err := s.withCommunicationsNylasGate(hydrationCtx, connection, func(callCtx context.Context) error {
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
