package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const (
	CommunicationsEmailThreadHydrationPartial  = "partial"
	CommunicationsEmailThreadHydrationComplete = "complete"
)

type CommunicationsEmailThreadUpsertInput struct {
	CompanyID            string
	PersonalUserID       string
	PersonalAccountEmail string
	SharedInboxID        string
	AccountEmail         string
	ProviderThreadID     string
	SelectedMessageID    string
	Messages             []domain.EmailMessageSnapshot
	HistoryComplete      bool
	FetchedAt            time.Time
	LastHydrationError   string
}

type CommunicationsNodeEmailImportInput struct {
	CompanyID       string
	NodeID          string
	CreatedByUserID string
	InformationID   string
	Thread          CommunicationsEmailThreadUpsertInput
}

type CommunicationsNodeEmailImportResult struct {
	InformationID string                           `json:"information_id"`
	EmailThread   domain.CommunicationsEmailThread `json:"email_thread"`
}

func normalizeEmailAttachmentSnapshots(values []domain.EmailAttachmentSnapshot) []domain.EmailAttachmentSnapshot {
	seen := map[string]bool{}
	out := make([]domain.EmailAttachmentSnapshot, 0, len(values))
	for _, value := range values {
		value.ID = strings.TrimSpace(value.ID)
		value.AttachmentID = strings.TrimSpace(value.AttachmentID)
		value.Filename = strings.TrimSpace(value.Filename)
		value.ContentType = strings.TrimSpace(value.ContentType)
		value.ContentID = strings.TrimSpace(value.ContentID)
		value.ContentDisposition = strings.TrimSpace(value.ContentDisposition)
		if value.Size < 0 {
			value.Size = 0
		}
		identity := value.ID
		if identity == "" {
			identity = value.AttachmentID
		}
		if identity == "" {
			identity = strings.Join([]string{value.Filename, value.ContentID, value.ContentType}, "\x1f")
		}
		if identity == "" || seen[identity] {
			continue
		}
		seen[identity] = true
		out = append(out, value)
	}
	return out
}

func normalizeCommunicationsEmailThreadInput(input CommunicationsEmailThreadUpsertInput) (CommunicationsEmailThreadUpsertInput, communicationsEmailCollaborationScope, error) {
	companyID, scope, err := normalizeCommunicationsEmailCollaborationScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID, input.AccountEmail)
	if err != nil {
		return CommunicationsEmailThreadUpsertInput{}, communicationsEmailCollaborationScope{}, err
	}
	input.CompanyID = companyID
	input.PersonalUserID = scope.personalUserID
	input.PersonalAccountEmail = scope.personalAccountEmail
	input.SharedInboxID = scope.sharedInboxID
	input.AccountEmail = scope.accountEmail
	input.ProviderThreadID = strings.TrimSpace(input.ProviderThreadID)
	input.SelectedMessageID = strings.TrimSpace(input.SelectedMessageID)
	input.LastHydrationError = strings.TrimSpace(input.LastHydrationError)
	if input.FetchedAt.IsZero() {
		input.FetchedAt = time.Now().UTC()
	} else {
		input.FetchedAt = input.FetchedAt.UTC()
	}
	byID := map[string]domain.EmailMessageSnapshot{}
	for _, candidate := range input.Messages {
		message := normalizeEmailMessageSnapshot(candidate)
		message.Attachments = normalizeEmailAttachmentSnapshots(message.Attachments)
		if message.ID == "" {
			continue
		}
		if message.ThreadID != "" {
			if input.ProviderThreadID == "" {
				input.ProviderThreadID = message.ThreadID
			} else if message.ThreadID != input.ProviderThreadID {
				return CommunicationsEmailThreadUpsertInput{}, communicationsEmailCollaborationScope{}, ErrInvalid
			}
		} else {
			message.ThreadID = input.ProviderThreadID
		}
		if existing, ok := byID[message.ID]; ok {
			byID[message.ID] = mergeEmailMessageSnapshot(existing, message)
		} else {
			byID[message.ID] = message
		}
	}
	if input.SelectedMessageID == "" && len(byID) > 0 {
		ids := make([]string, 0, len(byID))
		for id := range byID {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		input.SelectedMessageID = ids[0]
	}
	if input.SelectedMessageID == "" || len(byID) == 0 {
		return CommunicationsEmailThreadUpsertInput{}, communicationsEmailCollaborationScope{}, ErrInvalid
	}
	input.Messages = make([]domain.EmailMessageSnapshot, 0, len(byID))
	for _, message := range byID {
		input.Messages = append(input.Messages, message)
	}
	sort.Slice(input.Messages, func(i, j int) bool {
		if input.Messages[i].Date != input.Messages[j].Date {
			return input.Messages[i].Date < input.Messages[j].Date
		}
		return input.Messages[i].ID < input.Messages[j].ID
	})
	return input, scope, nil
}

func communicationsEmailThreadMatchesScope(thread domain.CommunicationsEmailThread, companyID string, scope communicationsEmailCollaborationScope) bool {
	if thread.CompanyID != companyID || thread.ScopeType != scope.scopeType {
		return false
	}
	if scope.scopeType == CommunicationsEmailCollaborationScopePersonal {
		return thread.PersonalUserID == scope.personalUserID && thread.PersonalAccountEmail == scope.personalAccountEmail
	}
	return thread.SharedInboxID == scope.sharedInboxID
}

func communicationsEmailThreadInputContainsSelectedMessage(input CommunicationsEmailThreadUpsertInput) bool {
	for _, message := range input.Messages {
		if message.ID == input.SelectedMessageID {
			return true
		}
	}
	return false
}

func communicationsEmailThreadProviderKey(providerThreadID, selectedMessageID string) string {
	if providerThreadID = strings.TrimSpace(providerThreadID); providerThreadID != "" {
		return "thread:" + providerThreadID
	}
	return "message:" + strings.TrimSpace(selectedMessageID)
}

func communicationsEmailThreadScopeKey(companyID string, scope communicationsEmailCollaborationScope, providerKey string) string {
	if scope.scopeType == CommunicationsEmailCollaborationScopePersonal {
		return strings.Join([]string{companyID, scope.scopeType, scope.personalUserID, scope.personalAccountEmail, providerKey}, "\x1f")
	}
	return strings.Join([]string{companyID, scope.scopeType, scope.sharedInboxID, providerKey}, "\x1f")
}

func communicationsEmailThreadForMessages(thread domain.CommunicationsEmailThread) domain.CommunicationsEmailThread {
	if thread.Messages == nil {
		thread.Messages = []domain.CommunicationsEmailMessage{}
	}
	sort.Slice(thread.Messages, func(i, j int) bool {
		if thread.Messages[i].MessageOrder != thread.Messages[j].MessageOrder {
			return thread.Messages[i].MessageOrder < thread.Messages[j].MessageOrder
		}
		return thread.Messages[i].ProviderMessageID < thread.Messages[j].ProviderMessageID
	})
	return thread
}
