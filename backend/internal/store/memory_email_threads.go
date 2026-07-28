package store

import (
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

func (r *MemoryRepo) upsertCommunicationsEmailThreadLocked(input CommunicationsEmailThreadUpsertInput) (domain.CommunicationsEmailThread, error) {
	input, scope, err := normalizeCommunicationsEmailThreadInput(input)
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
		thread = domain.CommunicationsEmailThread{
			CompanyID: input.CompanyID, EmailThreadID: threadID, ScopeType: scope.scopeType,
			PersonalUserID: scope.personalUserID, PersonalAccountEmail: scope.personalAccountEmail,
			SharedInboxID: scope.sharedInboxID, AccountEmail: scope.accountEmail,
			ProviderThreadID: input.ProviderThreadID, RootProviderMessageID: input.SelectedMessageID,
			DownloadStatus:   CommunicationsEmailThreadDownloadPartial,
			CreatedTimestamp: now,
		}
		r.emailThreadScopeIDs[scopeKey] = threadID
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
	sort.Slice(thread.Messages, func(i, j int) bool {
		left, right := thread.Messages[i], thread.Messages[j]
		if left.Message.Date != right.Message.Date {
			return left.Message.Date < right.Message.Date
		}
		return left.ProviderMessageID < right.ProviderMessageID
	})
	for index := range thread.Messages {
		thread.Messages[index].MessageOrder = index
	}
	thread.HistoryComplete = thread.HistoryComplete || input.HistoryComplete
	if thread.HistoryComplete {
		thread.DownloadStatus = CommunicationsEmailThreadDownloadComplete
		thread.LastDownloadError = ""
	} else {
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
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.upsertCommunicationsEmailThreadLocked(input)
}

func (r *MemoryRepo) GetCommunicationsEmailThread(companyID, emailThreadID string) (domain.CommunicationsEmailThread, error) {
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

func (r *MemoryRepo) linkCommunicationsEmailThreadToNodeLocked(companyID, nodeID, informationID, emailThreadID, selectedMessageID, actorUserID string, now time.Time) domain.CommunicationsNodeEmailThread {
	link := domain.CommunicationsNodeEmailThread{
		CompanyID: companyID, NodeID: nodeID, InformationID: informationID,
		EmailThreadID: emailThreadID, SelectedMessageID: selectedMessageID,
		CreatedByUserID: actorUserID, CreatedTimestamp: now,
	}
	r.nodeEmailThreads[memoryNodeEmailThreadKey(companyID, nodeID, emailThreadID)] = link
	return link
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
	r.linkCommunicationsEmailThreadToNodeLocked(input.CompanyID, input.NodeID, input.InformationID, thread.EmailThreadID, selected.ID, input.CreatedByUserID, now)
	if downloadScope, requestedMessageID, ok := communicationsEmailThreadDownloadRequest(thread, input.Thread); ok {
		if _, _, err := r.ensureCommunicationsEmailThreadDownloadJobLocked(input.CompanyID, thread.EmailThreadID, downloadScope, requestedMessageID, input.Thread.RequestedByUserID); err != nil {
			return CommunicationsNodeEmailImportResult{}, err
		}
	}
	return CommunicationsNodeEmailImportResult{InformationID: input.InformationID, EmailThread: thread}, nil
}
