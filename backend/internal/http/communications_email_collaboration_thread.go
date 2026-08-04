package httpapi

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"strings"
)

var errEmailCollaborationSourceUnavailable = errors.New("email collaboration source unavailable")

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

func storedEmailThreadMessages(thread domain.CommunicationsEmailThread) []domain.EmailMessageSnapshot {
	messages := make([]domain.EmailMessageSnapshot, 0, len(thread.Messages))
	for _, item := range thread.Messages {
		messages = append(messages, item.Message)
	}
	return messages
}
