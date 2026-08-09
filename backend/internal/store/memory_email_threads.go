package store

import (
	"context"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func cloneCommunicationsEmailThread(item domain.CommunicationsEmailThread) domain.CommunicationsEmailThread {
	item.Messages = append([]domain.CommunicationsEmailMessage(nil), item.Messages...)
	for index := range item.Messages {
		message := item.Messages[index].Message
		message.From = append([]domain.EmailAddressSnapshot(nil), message.From...)
		message.To = append([]domain.EmailAddressSnapshot(nil), message.To...)
		message.Cc = append([]domain.EmailAddressSnapshot(nil), message.Cc...)
		message.Bcc = append([]domain.EmailAddressSnapshot(nil), message.Bcc...)
		message.ReplyTo = append([]domain.EmailAddressSnapshot(nil), message.ReplyTo...)
		message.Attachments = append([]domain.EmailAttachmentSnapshot(nil), message.Attachments...)
		message.Folders = append([]string(nil), message.Folders...)
		message.FolderIDs = append([]string(nil), message.FolderIDs...)
		item.Messages[index].Message = message
	}
	return communicationsEmailThreadForMessages(item)
}
func cloneCommunicationsEmailThreadsMap(source map[string]domain.CommunicationsEmailThread) map[string]domain.CommunicationsEmailThread {
	out := make(map[string]domain.CommunicationsEmailThread, len(source))
	for threadKey, thread := range source {
		out[threadKey] = cloneCommunicationsEmailThread(thread)
	}
	return out
}

func memoryNodeEmailThreadKey(companyID, nodeID, emailThreadID string) string {
	return strings.Join([]string{companyID, nodeID, emailThreadID}, "\x1f")
}

func (r *MemoryRepo) communicationsEmailThreadProviderLocked(input CommunicationsEmailThreadUpsertInput, scope communicationsEmailCollaborationScope) (string, error) {
	if input.Provider == "google" || input.Provider == "microsoft" {
		return input.Provider, nil
	}
	if scope.scopeType == CommunicationsEmailCollaborationScopePersonal {
		connection, ok := r.emailConnections[emailConnectionKey(scope.personalUserID, scope.personalAccountEmail)]
		if !ok || (connection.Provider != "google" && connection.Provider != "microsoft") {
			return "", ErrInvalid
		}
		return connection.Provider, nil
	}
	folder, ok := r.folders[key(input.CompanyID, scope.sharedInboxID)]
	if !ok || normalizeMemorySharedInboxFolder(folder).EntryType != CommunicationsSharedInboxEntryTypeSharedInbox {
		return "", ErrInvalid
	}
	connection, ok := r.companyEmailConnections[companyEmailConnectionKey(input.CompanyID, folder.CompanyEmailConnectionID)]
	if !ok || normalizeEmail(connection.AccountEmail) != scope.accountEmail || (connection.Provider != "google" && connection.Provider != "microsoft") {
		return "", ErrInvalid
	}
	return connection.Provider, nil
}

func (r *MemoryRepo) emailConnectionIDForScopeLocked(companyID string, scope communicationsEmailCollaborationScope) string {
	if scope.scopeType == CommunicationsEmailCollaborationScopePersonal {
		connection, ok := r.emailConnections[emailConnectionKey(scope.personalUserID, scope.personalAccountEmail)]
		if ok && connection.CompanyID == companyID {
			return connection.EmailConnectionID
		}
		return ""
	}
	folder, ok := r.folders[key(companyID, scope.sharedInboxID)]
	if !ok {
		return ""
	}
	connection, ok := r.companyEmailConnections[companyEmailConnectionKey(companyID, folder.CompanyEmailConnectionID)]
	if !ok {
		return ""
	}
	return connection.EmailConnectionID
}

func (r *MemoryRepo) emailConnectionIDForThreadLocked(thread domain.CommunicationsEmailThread) string {
	scope := communicationsEmailCollaborationScope{
		scopeType: thread.ScopeType, personalUserID: thread.PersonalUserID,
		personalAccountEmail: thread.PersonalAccountEmail, sharedInboxID: thread.SharedInboxID,
		accountEmail: thread.AccountEmail,
	}
	return r.emailConnectionIDForScopeLocked(thread.CompanyID, scope)
}

func (r *MemoryRepo) upsertCommunicationsEmailThreadLocked(input CommunicationsEmailThreadUpsertInput) (domain.CommunicationsEmailThread, error) {
	input, scope, err := normalizeCommunicationsEmailThreadInput(input)
	if err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	input.Provider, err = r.communicationsEmailThreadProviderLocked(input, scope)
	if err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	providerKey := communicationsEmailThreadProviderKey(input.ProviderThreadID, input.SelectedMessageID)
	scopeKey := communicationsEmailThreadScopeKey(input.CompanyID, scope, providerKey)
	threadID := r.emailThreadScopeIDs[scopeKey]
	if threadID == "" {
		for _, candidate := range r.emailThreads {
			if !communicationsEmailThreadMatchesScope(candidate, input.CompanyID, scope) {
				continue
			}
			for _, message := range candidate.Messages {
				if message.ProviderMessageID == input.SelectedMessageID {
					threadID = candidate.EmailThreadID
					r.emailThreadScopeIDs[scopeKey] = threadID
					break
				}
			}
			if threadID != "" {
				break
			}
		}
	}
	now := time.Now().UTC()
	thread, found := r.emailThreads[key(input.CompanyID, threadID)]
	if !found {
		if !communicationsEmailThreadInputContainsSelectedMessage(input) {
			return domain.CommunicationsEmailThread{}, ErrInvalid
		}
		threadID = newUUIDv7String()
		connectionID := r.emailConnectionIDForScopeLocked(input.CompanyID, scope)
		if connectionID == "" {
			connectionID = newUUIDv7String()
		}
		thread = domain.CommunicationsEmailThread{
			CompanyID: input.CompanyID, EmailThreadID: threadID, ScopeType: scope.scopeType,
			EmailConnectionID: connectionID,
			PersonalUserID:    scope.personalUserID, PersonalAccountEmail: scope.personalAccountEmail,
			SharedInboxID: scope.sharedInboxID, AccountEmail: scope.accountEmail, Provider: input.Provider,
			ProviderThreadID: input.ProviderThreadID, RootProviderMessageID: input.SelectedMessageID,
			DownloadStatus:   CommunicationsEmailThreadDownloadPartial,
			CreatedTimestamp: now,
		}
		r.emailThreadScopeIDs[scopeKey] = threadID
	}
	if thread.EmailConnectionID == "" {
		thread.EmailConnectionID = r.emailConnectionIDForScopeLocked(input.CompanyID, scope)
	}
	if thread.Provider == "" {
		thread.Provider = input.Provider
	}
	if thread.ProviderThreadID != "" && input.ProviderThreadID != "" && thread.ProviderThreadID != input.ProviderThreadID {
		return domain.CommunicationsEmailThread{}, ErrInvalid
	}
	if thread.ProviderThreadID == "" {
		thread.ProviderThreadID = input.ProviderThreadID
	}
	if thread.RootProviderMessageID == "" {
		thread.RootProviderMessageID = input.SelectedMessageID
	}
	messageIndex := map[string]int{}
	for index, item := range thread.Messages {
		messageIndex[item.ProviderMessageID] = index
	}
	for _, snapshot := range input.Messages {
		if index, ok := messageIndex[snapshot.ID]; ok {
			thread.Messages[index].Message = mergeEmailMessageSnapshot(thread.Messages[index].Message, snapshot)
			thread.Messages[index].ProviderThreadID = thread.Messages[index].Message.ThreadID
			thread.Messages[index].UpdatedTimestamp = now
			continue
		}
		thread.Messages = append(thread.Messages, domain.CommunicationsEmailMessage{
			CompanyID: input.CompanyID, EmailMessageID: newUUIDv7String(), EmailThreadID: threadID,
			ProviderMessageID: snapshot.ID, ProviderThreadID: snapshot.ThreadID,
			Message: snapshot, CreatedTimestamp: now, UpdatedTimestamp: now,
		})
	}
	for _, snapshot := range input.Messages {
		if !snapshot.DownloadComplete {
			continue
		}
		for _, placement := range r.nodeEmailThreads {
			if placement.CompanyID != input.CompanyID || placement.EmailThreadID != threadID {
				continue
			}
			userID := thread.PersonalUserID
			link := communicationsEmailNodeLink{
				CompanyID: input.CompanyID, UserID: userID, SharedInboxID: thread.SharedInboxID,
				AccountEmail: thread.AccountEmail, MessageID: snapshot.ID, NodeID: placement.NodeID,
				Message: snapshot, CreatedTimestamp: now, UpdatedTimestamp: now,
			}
			r.emailNodeLinks[emailNodeAttachmentLinkKey(input.CompanyID, userID, snapshot.ID, placement.NodeID)] = link
		}
	}
	sort.Slice(thread.Messages, func(i, j int) bool {
		left, right := thread.Messages[i], thread.Messages[j]
		if left.Message.Date != right.Message.Date {
			return left.Message.Date < right.Message.Date
		}
		return left.ProviderMessageID < right.ProviderMessageID
	})
	for index := range thread.Messages {
		thread.Messages[index].MessageOrder = index
		thread.Messages[index].Message.EmailMessageID = thread.Messages[index].EmailMessageID
	}
	thread.HistoryComplete = thread.HistoryComplete || input.HistoryComplete
	if input.HistoryComplete {
		thread.DownloadStatus = CommunicationsEmailThreadDownloadComplete
		thread.LastDownloadError = ""
	} else if thread.DownloadStatus != CommunicationsEmailThreadDownloadDownloading {
		thread.DownloadStatus = CommunicationsEmailThreadDownloadPartial
		thread.LastDownloadError = input.LastDownloadError
	}
	fetchedAt := input.FetchedAt
	thread.FetchedAt = &fetchedAt
	thread.UpdatedTimestamp = now
	r.emailThreads[key(input.CompanyID, threadID)] = thread
	return cloneCommunicationsEmailThread(thread), nil
}

func (r *MemoryRepo) UpsertCommunicationsEmailThread(input CommunicationsEmailThreadUpsertInput) (domain.CommunicationsEmailThread, error) {
	return r.UpsertCommunicationsEmailThreadContext(context.Background(), input)
}

func (r *MemoryRepo) UpsertCommunicationsEmailThreadContext(ctx context.Context, input CommunicationsEmailThreadUpsertInput) (domain.CommunicationsEmailThread, error) {
	if err := ctx.Err(); err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.upsertCommunicationsEmailThreadLocked(input)
}

func (r *MemoryRepo) GetCommunicationsEmailThread(companyID, emailThreadID string) (domain.CommunicationsEmailThread, error) {
	return r.GetCommunicationsEmailThreadContext(context.Background(), companyID, emailThreadID)
}

func (r *MemoryRepo) GetCommunicationsEmailThreadContext(ctx context.Context, companyID, emailThreadID string) (domain.CommunicationsEmailThread, error) {
	if err := ctx.Err(); err != nil {
		return domain.CommunicationsEmailThread{}, err
	}
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	if companyID == "" || emailThreadID == "" {
		return domain.CommunicationsEmailThread{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.emailThreads[key(companyID, emailThreadID)]
	if !ok {
		return domain.CommunicationsEmailThread{}, ErrNotFound
	}
	return cloneCommunicationsEmailThread(item), nil
}

func (r *MemoryRepo) ListCommunicationsEmailThreadsForAccount(input CommunicationsEmailAccountReadInput) ([]domain.CommunicationsEmailThread, error) {
	input, scope, err := normalizeCommunicationsEmailAccountReadInput(input)
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := []domain.CommunicationsEmailThread{}
	for _, thread := range r.emailThreads {
		if thread.Provider == input.Provider && communicationsEmailThreadMatchesScope(thread, input.CompanyID, scope) {
			items = append(items, cloneCommunicationsEmailThread(thread))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].UpdatedTimestamp.Equal(items[j].UpdatedTimestamp) {
			return items[i].UpdatedTimestamp.After(items[j].UpdatedTimestamp)
		}
		return items[i].EmailThreadID < items[j].EmailThreadID
	})
	return items, nil
}

func (r *MemoryRepo) ListCommunicationsEmailMessagesForAccount(input CommunicationsEmailAccountReadInput) ([]domain.CommunicationsEmailMessage, error) {
	input, scope, err := normalizeCommunicationsEmailAccountReadInput(input)
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := []domain.CommunicationsEmailMessage{}
	for _, thread := range r.emailThreads {
		if thread.Provider != input.Provider || !communicationsEmailThreadMatchesScope(thread, input.CompanyID, scope) {
			continue
		}
		clonedThread := cloneCommunicationsEmailThread(thread)
		for _, message := range clonedThread.Messages {
			message.ProviderThreadID = clonedThread.ProviderThreadID
			message.Message.ThreadID = clonedThread.ProviderThreadID
			items = append(items, message)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Message.Date != items[j].Message.Date {
			return items[i].Message.Date > items[j].Message.Date
		}
		return items[i].ProviderMessageID < items[j].ProviderMessageID
	})
	return items, nil
}
func (r *MemoryRepo) GetCommunicationsNodeEmailThread(companyID, nodeID, emailThreadID string) (domain.CommunicationsNodeEmailThread, error) {
	companyID, nodeID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(nodeID), cleanUUIDText(emailThreadID)
	if companyID == "" || nodeID == "" || emailThreadID == "" {
		return domain.CommunicationsNodeEmailThread{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.nodeEmailThreads[memoryNodeEmailThreadKey(companyID, nodeID, emailThreadID)]
	if !ok {
		return domain.CommunicationsNodeEmailThread{}, ErrNotFound
	}
	thread, ok := r.emailThreads[key(companyID, emailThreadID)]
	if !ok {
		return domain.CommunicationsNodeEmailThread{}, ErrNotFound
	}
	item.Thread = cloneCommunicationsEmailThread(thread)
	return item, nil
}

func (r *MemoryRepo) linkCommunicationsEmailThreadToNodeLocked(companyID, nodeID, informationID, emailThreadID, selectedMessageID, actorUserID string, now time.Time) (domain.CommunicationsNodeEmailThread, error) {
	selectedInternalMessageID := cleanUUIDText(selectedMessageID)
	if thread, ok := r.emailThreads[key(companyID, emailThreadID)]; ok {
		for _, message := range thread.Messages {
			if message.ProviderMessageID == selectedMessageID || message.EmailMessageID == selectedMessageID {
				selectedInternalMessageID = message.EmailMessageID
				break
			}
		}
	}
	link := domain.CommunicationsNodeEmailThread{
		CompanyID: companyID, NodeID: nodeID, InformationID: informationID,
		EmailThreadID: emailThreadID, SelectedMessageID: selectedInternalMessageID,
		CreatedByUserID: actorUserID, CreatedTimestamp: now,
	}
	r.nodeEmailThreads[memoryNodeEmailThreadKey(companyID, nodeID, emailThreadID)] = link
	return link, nil
}

func (r *MemoryRepo) ImportCommunicationsEmailIntoNode(input CommunicationsNodeEmailImportInput) (CommunicationsNodeEmailImportResult, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.NodeID = cleanUUIDText(input.NodeID)
	input.CreatedByUserID = cleanUUIDText(input.CreatedByUserID)
	input.InformationID = cleanUUIDText(input.InformationID)
	if input.CompanyID == "" || input.NodeID == "" || input.CreatedByUserID == "" {
		return CommunicationsNodeEmailImportResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.nodes[key(input.CompanyID, input.NodeID)]; !ok {
		return CommunicationsNodeEmailImportResult{}, ErrNotFound
	}
	thread, err := r.upsertCommunicationsEmailThreadLocked(input.Thread)
	if err != nil {
		return CommunicationsNodeEmailImportResult{}, err
	}
	if existing, ok := r.nodeEmailThreads[memoryNodeEmailThreadKey(input.CompanyID, input.NodeID, thread.EmailThreadID)]; ok {
		return CommunicationsNodeEmailImportResult{InformationID: existing.InformationID, EmailThread: thread}, nil
	}
	if input.InformationID == "" {
		input.InformationID = newUUIDv7String()
	}
	now := time.Now().UTC()
	selected := thread.Messages[0].Message
	for _, item := range thread.Messages {
		if item.ProviderMessageID == input.Thread.SelectedMessageID {
			selected = item.Message
			break
		}
	}
	information := attachedEmailProjectionInformationWithThread(selected, input.Thread.SharedInboxID, input.Thread.AccountEmail, thread.EmailThreadID, now, false)
	info := domain.NodeInformation{
		CompanyID: input.CompanyID, InformationID: input.InformationID, NodeID: input.NodeID,
		Type: "Attached email", Information: information, CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	k := key(input.CompanyID, input.NodeID)
	r.nodeInfo[k] = append(r.nodeInfo[k], info)
	if r.nodeText[k] == nil {
		r.nodeText[k] = map[string]domain.NodeProjection{}
	}
	r.nodeText[k][input.InformationID] = domain.NodeProjection{
		CompanyID: input.CompanyID, NodeID: input.NodeID, InformationID: input.InformationID,
		Type: info.Type, Information: information, CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	if _, err := r.linkCommunicationsEmailThreadToNodeLocked(input.CompanyID, input.NodeID, input.InformationID, thread.EmailThreadID, selected.ID, input.CreatedByUserID, now); err != nil {
		return CommunicationsNodeEmailImportResult{}, err
	}
	if downloadScope, requestedMessageID, ok := communicationsEmailThreadDownloadRequest(thread, input.Thread); ok {
		if _, _, err := r.ensureCommunicationsEmailThreadDownloadJobLocked(input.CompanyID, thread.EmailThreadID, downloadScope, requestedMessageID, input.Thread.RequestedByUserID); err != nil {
			return CommunicationsNodeEmailImportResult{}, err
		}
	}
	return CommunicationsNodeEmailImportResult{InformationID: input.InformationID, EmailThread: thread}, nil
}
