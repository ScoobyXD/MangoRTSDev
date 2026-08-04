package httpapi

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"sort"
	"strconv"
	"strings"
	"time"
)

func communicationsEmailAccountReadInput(companyID, sharedInboxID string, connection domain.UserEmailConnection) store.CommunicationsEmailAccountReadInput {
	input := store.CommunicationsEmailAccountReadInput{
		CompanyID: companyID, AccountEmail: connection.AccountEmail, Provider: connection.Provider,
	}
	if strings.TrimSpace(sharedInboxID) != "" {
		input.SharedInboxID = sharedInboxID
	} else {
		input.PersonalUserID = connection.UserID
		input.PersonalAccountEmail = connection.AccountEmail
	}
	return input
}

func nylasAddressesFromStored(values []domain.EmailAddressSnapshot) []NylasEmailAddress {
	items := make([]NylasEmailAddress, 0, len(values))
	for _, value := range values {
		items = append(items, NylasEmailAddress{Name: value.Name, Email: value.Email})
	}
	return items
}

func nylasAttachmentsFromStored(values []domain.EmailAttachmentSnapshot) []NylasAttachment {
	items := make([]NylasAttachment, 0, len(values))
	for _, value := range values {
		items = append(items, NylasAttachment{
			ID: value.ID, AttachmentID: value.AttachmentID, Filename: value.Filename,
			ContentType: value.ContentType, ContentID: value.ContentID,
			ContentDisposition: value.ContentDisposition, IsInline: value.IsInline, Size: value.Size,
		})
	}
	return items
}

func nylasMessageFromStored(item domain.CommunicationsEmailMessage) NylasMessage {
	message := item.Message
	return NylasMessage{
		EmailMessageID: item.EmailMessageID, ID: item.ProviderMessageID,
		ThreadID: item.ProviderThreadID, Subject: message.Subject, Snippet: message.Snippet,
		Body: message.Body, Date: message.Date, Unread: message.Unread, Starred: message.Starred,
		From: nylasAddressesFromStored(message.From), To: nylasAddressesFromStored(message.To),
		Cc: nylasAddressesFromStored(message.Cc), Bcc: nylasAddressesFromStored(message.Bcc),
		ReplyTo:     nylasAddressesFromStored(message.ReplyTo),
		Attachments: nylasAttachmentsFromStored(message.Attachments),
		Folders:     append([]string(nil), message.Folders...), FolderIDs: append([]string(nil), message.FolderIDs...),
	}
}

func nylasThreadFromStored(thread domain.CommunicationsEmailThread) NylasThread {
	messages := make([]NylasMessage, 0, len(thread.Messages))
	participants := []NylasEmailAddress{}
	seenParticipants := map[string]bool{}
	unread, starred := false, false
	folders := []string{}
	seenFolders := map[string]bool{}
	for _, item := range thread.Messages {
		message := nylasMessageFromStored(item)
		messages = append(messages, message)
		unread = unread || message.Unread
		starred = starred || message.Starred
		for _, address := range append(append([]NylasEmailAddress{}, message.From...), append(message.To, message.Cc...)...) {
			key := strings.ToLower(strings.TrimSpace(address.Email))
			if key == "" || seenParticipants[key] {
				continue
			}
			seenParticipants[key] = true
			participants = append(participants, address)
		}
		for _, folder := range message.Folders {
			key := strings.ToLower(strings.TrimSpace(folder))
			if key != "" && !seenFolders[key] {
				seenFolders[key] = true
				folders = append(folders, folder)
			}
		}
	}
	result := NylasThread{ID: thread.ProviderThreadID, Unread: unread, Starred: starred, Participants: participants, Folders: folders}
	if result.ID == "" {
		result.ID = thread.RootProviderMessageID
	}
	for _, message := range messages {
		result.MessageIDs = append(result.MessageIDs, message.ID)
		if result.EarliestMessageDate == 0 || message.Date < result.EarliestMessageDate {
			result.EarliestMessageDate = message.Date
		}
		if message.Date >= result.LatestMessageReceivedDate {
			copy := message
			result.LatestMessageReceivedDate = message.Date
			result.LatestDraftOrMessage = &copy
			result.Subject, result.Snippet = message.Subject, message.Snippet
		}
	}
	return result
}

func storedEmailMessageSearchText(message NylasMessage) string {
	var values []string
	values = append(values, message.Subject, message.Snippet, message.Body)
	for _, addresses := range [][]NylasEmailAddress{message.From, message.To, message.Cc, message.Bcc, message.ReplyTo} {
		for _, address := range addresses {
			values = append(values, address.Name, address.Email)
		}
	}
	return strings.ToLower(strings.Join(values, "\n"))
}

func storedEmailFolderTokens(message NylasMessage) map[string]bool {
	tokens := map[string]bool{}
	for _, value := range append(append([]string{}, message.Folders...), message.FolderIDs...) {
		value = strings.Trim(strings.ToLower(strings.TrimSpace(value)), "\\")
		if value != "" {
			tokens[value] = true
		}
	}
	return tokens
}

func storedEmailMessageMatchesMailbox(connection domain.UserEmailConnection, mailbox string, message NylasMessage) bool {
	mailbox = normalizeCommunicationsMailbox(mailbox)
	folders := storedEmailFolderTokens(message)
	switch mailbox {
	case "", "all":
		return true
	case "primary":
		if connection.Provider == "google" {
			return nylasMessageMatchesPrimaryMailbox(message)
		}
		return folders["inbox"]
	case "sent":
		return folders["sent"] || folders["sent mail"]
	case "starred":
		return message.Starred
	case "spam":
		return folders["spam"] || folders["junk"] || folders["junk email"]
	case "archive":
		return !folders["inbox"] && !folders["trash"] && !folders["spam"] && !folders["junk"] &&
			!folders["sent"] && !folders["sent mail"] && !folders["draft"] && !folders["drafts"]
	default:
		return false
	}
}

func storedEmailMessageMatchesQuery(connection domain.UserEmailConnection, query NylasMessageQuery, message NylasMessage) bool {
	if query.ThreadID != "" && message.ThreadID != query.ThreadID {
		return false
	}
	if query.Unread != nil && message.Unread != *query.Unread {
		return false
	}
	if query.Starred != nil && message.Starred != *query.Starred {
		return false
	}
	if query.FolderID != "" {
		matched := false
		for _, value := range append(append([]string{}, message.FolderIDs...), message.Folders...) {
			if strings.EqualFold(strings.TrimSpace(value), query.FolderID) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if !storedEmailMessageMatchesMailbox(connection, query.Mailbox, message) {
		return false
	}
	if search := strings.ToLower(strings.TrimSpace(query.Query)); search != "" && !strings.Contains(storedEmailMessageSearchText(message), search) {
		return false
	}
	return true
}

func parseStoredEmailPageOffset(value string) (int, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, nil
	}
	if !strings.HasPrefix(value, "v3:") {
		return 0, store.ErrInvalid
	}
	offset, err := strconv.Atoi(strings.TrimPrefix(value, "v3:"))
	if err != nil || offset < 0 {
		return 0, store.ErrInvalid
	}
	return offset, nil
}

func (s *Server) storedCommunicationsMessagePage(connection domain.UserEmailConnection, query NylasMessageQuery) (NylasMessagePage, error) {
	threads, err := s.repo.ListCommunicationsEmailThreadsForAccount(
		communicationsEmailAccountReadInput(query.CompanyID, query.SharedInboxID, connection),
	)
	if err != nil {
		return NylasMessagePage{}, err
	}
	messages := []NylasMessage{}
	for _, thread := range threads {
		for _, item := range thread.Messages {
			message := nylasMessageFromStored(item)
			if storedEmailMessageMatchesQuery(connection, query, message) {
				messages = append(messages, message)
			}
		}
	}
	sort.SliceStable(messages, func(i, j int) bool {
		if messages[i].Date != messages[j].Date {
			if query.Order == "oldest" {
				return messages[i].Date < messages[j].Date
			}
			return messages[i].Date > messages[j].Date
		}
		return messages[i].ID < messages[j].ID
	})
	offset, err := parseStoredEmailPageOffset(query.PageToken)
	if err != nil {
		return NylasMessagePage{}, err
	}
	if offset > len(messages) {
		return NylasMessagePage{}, store.ErrInvalid
	}
	limit := query.Limit
	if limit <= 0 {
		limit = communicationsNylasDefaultMessageLimit
	}
	end := offset + limit
	if end > len(messages) {
		end = len(messages)
	}
	page := NylasMessagePage{Messages: append([]NylasMessage(nil), messages[offset:end]...)}
	if end < len(messages) {
		page.NextPageToken = "v3:" + strconv.Itoa(end)
	}
	return s.enrichCommunicationsMessagePageForConnection(connection, query.CompanyID, page), nil
}

func (s *Server) storedCommunicationsMessage(connection domain.UserEmailConnection, companyID, sharedInboxID, providerMessageID string) (NylasMessage, error) {
	threads, err := s.repo.ListCommunicationsEmailThreadsForAccount(
		communicationsEmailAccountReadInput(companyID, sharedInboxID, connection),
	)
	if err != nil {
		return NylasMessage{}, err
	}
	providerMessageID = strings.TrimSpace(providerMessageID)
	for _, thread := range threads {
		for _, item := range thread.Messages {
			if item.ProviderMessageID == providerMessageID {
				return s.enrichCommunicationsMessageReadStatus(connection, nylasMessageFromStored(item)), nil
			}
		}
	}
	return NylasMessage{}, store.ErrNotFound
}

func (s *Server) storedCommunicationsThread(connection domain.UserEmailConnection, companyID, sharedInboxID, providerThreadID string) (NylasThread, error) {
	threads, err := s.repo.ListCommunicationsEmailThreadsForAccount(
		communicationsEmailAccountReadInput(companyID, sharedInboxID, connection),
	)
	if err != nil {
		return NylasThread{}, err
	}
	providerThreadID = strings.TrimSpace(providerThreadID)
	for _, thread := range threads {
		if thread.ProviderThreadID == providerThreadID || (thread.ProviderThreadID == "" && thread.RootProviderMessageID == providerThreadID) {
			return nylasThreadFromStored(thread), nil
		}
	}
	return NylasThread{}, store.ErrNotFound
}

func (s *Server) persistCommunicationsProviderMessages(companyID, sharedInboxID string, connection domain.UserEmailConnection, messages []NylasMessage) error {
	groups := map[string][]domain.EmailMessageSnapshot{}
	for _, message := range messages {
		snapshot := emailMessageSnapshotFromNylas(message)
		if snapshot.ID == "" {
			continue
		}
		groupKey := snapshot.ThreadID
		if groupKey == "" {
			groupKey = "message:" + snapshot.ID
		}
		groups[groupKey] = append(groups[groupKey], snapshot)
	}
	for _, snapshots := range groups {
		if len(snapshots) == 0 {
			continue
		}
		input := store.CommunicationsEmailThreadUpsertInput{
			CompanyID: companyID, AccountEmail: connection.AccountEmail, Provider: connection.Provider,
			ProviderThreadID: snapshots[0].ThreadID, SelectedMessageID: snapshots[0].ID,
			Messages: snapshots, HistoryComplete: snapshots[0].ThreadID == "", FetchedAt: time.Now().UTC(),
		}
		if strings.TrimSpace(sharedInboxID) != "" {
			input.SharedInboxID = sharedInboxID
		} else {
			input.PersonalUserID = connection.UserID
			input.PersonalAccountEmail = connection.AccountEmail
		}
		if _, err := s.repo.UpsertCommunicationsEmailThread(input); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) refreshCommunicationsMessagesIntoV3(ctx context.Context, connection domain.UserEmailConnection, query NylasMessageQuery) error {
	providerQuery := query
	providerQuery.PageToken = ""
	providerQuery.Refresh = true
	providerQuery, err := s.applyCommunicationsMailboxQuery(ctx, connection, providerQuery)
	if err != nil {
		return err
	}
	var page NylasMessagePage
	err = s.withCommunicationsNylasGate(ctx, connection, func(callCtx context.Context) error {
		var callErr error
		page, callErr = s.nylasClient.ListMessages(callCtx, connection.GrantID, providerQuery)
		return callErr
	})
	if err != nil {
		return err
	}
	if err := s.persistCommunicationsProviderMessages(query.CompanyID, query.SharedInboxID, connection, page.Messages); err != nil {
		return err
	}
	return nil
}

func (s *Server) persistCommunicationsWebhookChange(ctx context.Context, grantContext communicationsWebhookGrantContext, change nylasWebhookChange) error {
	if change.Trigger != "message.created" && change.Trigger != "message.updated" {
		return nil
	}
	var message NylasMessage
	if change.MessageHydrated {
		message = nylasMessageFromStored(domain.CommunicationsEmailMessage{
			ProviderMessageID: change.Message.ID, ProviderThreadID: change.Message.ThreadID, Message: change.Message,
		})
	} else {
		if strings.TrimSpace(change.MessageID) == "" {
			return store.ErrInvalid
		}
		if err := s.withCommunicationsNylasGate(ctx, grantContext.connection, func(callCtx context.Context) error {
			var callErr error
			message, callErr = s.nylasClient.GetMessage(callCtx, grantContext.connection.GrantID, change.MessageID)
			return callErr
		}); err != nil {
			return err
		}
	}
	if strings.TrimSpace(message.ID) == "" {
		return store.ErrInvalid
	}
	if communicationsMessageReadStatusScopeTypeForConnection(grantContext.connection) == "shared" {
		for _, sharedInboxID := range grantContext.sharedInboxIDs {
			if strings.TrimSpace(sharedInboxID) == "" {
				continue
			}
			if err := s.persistCommunicationsProviderMessages(grantContext.connection.CompanyID, sharedInboxID, grantContext.connection, []NylasMessage{message}); err != nil {
				return err
			}
		}
		return nil
	}
	memberships, err := s.repo.ListUserMemberships(grantContext.connection.UserID)
	if err != nil {
		return err
	}
	for _, membership := range memberships {
		if strings.TrimSpace(membership.CompanyID) == "" {
			continue
		}
		if err := s.persistCommunicationsProviderMessages(membership.CompanyID, "", grantContext.connection, []NylasMessage{message}); err != nil {
			return err
		}
	}
	return nil
}
func isStoredEmailNotFound(err error) bool {
	return errors.Is(err, store.ErrNotFound)
}
