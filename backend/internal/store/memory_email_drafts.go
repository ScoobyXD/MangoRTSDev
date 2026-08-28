package store

import (
	"encoding/json"
	"sort"
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
)

func (r *MemoryRepo) ListCommunicationsEmailDrafts(input CommunicationsEmailDraftListInput) ([]domain.CommunicationsEmailDraft, error) {
	owner, err := normalizeCommunicationsSharedDraftOwner(input.SharedResourceType, input.SharedResourceID)
	if err != nil {
		return nil, err
	}
	if owner.resourceID != "" {
		return r.listCommunicationsResourceEmailDrafts(input, owner)
	}
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return nil, ErrInvalid
	}
	kind, sourceMessageIDs, sourceThreadIDs, err := normalizeCommunicationsEmailDraftListFilters(input.Kind, input.SourceMessageIDs, input.SourceThreadIDs)
	if err != nil {
		return nil, err
	}
	sourceMessageIDSet := make(map[string]struct{}, len(sourceMessageIDs))
	for _, sourceMessageID := range sourceMessageIDs {
		sourceMessageIDSet[sourceMessageID] = struct{}{}
	}
	sourceThreadIDSet := make(map[string]struct{}, len(sourceThreadIDs))
	for _, sourceThreadID := range sourceThreadIDs {
		sourceThreadIDSet[sourceThreadID] = struct{}{}
	}
	companyID := scope.companyID

	r.mu.RLock()
	defer r.mu.RUnlock()

	if _, ok := r.companies[companyID]; !ok {
		return nil, ErrNotFound
	}
	sourceThreadIDByMessageID := make(map[string]string)
	for _, thread := range r.emailThreads {
		if thread.CompanyID != companyID {
			continue
		}
		for _, message := range thread.Messages {
			sourceThreadIDByMessageID[message.EmailMessageID] = thread.EmailThreadID
		}
	}
	drafts := make([]domain.CommunicationsEmailDraft, 0)
	for _, draft := range r.emailDrafts {
		if draft.CompanyID != companyID || draft.DeletedTimestamp != nil {
			continue
		}
		include := scope.matchesDraft(draft)
		if input.ResourceSharedOnly {
			include = include && isCommunicationsResourceSharedDraft(draft) &&
				r.userHasEffectiveAccessLocked(companyID, input.ParticipantUserID, draftSharedResourceType(draft), draftSharedResourceID(draft), EntityPermissionEdit)
		} else {
			include = include && !isCommunicationsResourceSharedDraft(draft)
		}
		if !input.ResourceSharedOnly && strings.TrimSpace(input.ParticipantUserID) != "" {
			include = include && draft.CreatedByUserID == strings.TrimSpace(input.ParticipantUserID)
		}
		if kind != "" {
			include = include && draft.Kind == kind
		}
		sourceThreadID := ""
		if draft.SourceMessageID != "" {
			sourceThreadID = sourceThreadIDByMessageID[draft.SourceMessageID]
		}
		if len(sourceMessageIDSet) > 0 || len(sourceThreadIDSet) > 0 {
			_, sourceMatches := sourceMessageIDSet[draft.SourceMessageID]
			_, threadMatches := sourceThreadIDSet[sourceThreadID]
			include = include && (sourceMatches || threadMatches)
		}
		if include {
			draft.CanSend = communicationsResourceDraftCanSendLocked(r, draft, input.ParticipantUserID)
			draft.SourceThreadID = sourceThreadID
			draft.BodyEditorHTML = ""
			draft.ReplyToMessageJSON = "{}"
			drafts = append(drafts, draft)
		}
	}
	sort.SliceStable(drafts, func(i, j int) bool {
		if drafts[i].UpdatedTimestamp.Equal(drafts[j].UpdatedTimestamp) {
			return drafts[i].DraftID < drafts[j].DraftID
		}
		return drafts[i].UpdatedTimestamp.After(drafts[j].UpdatedTimestamp)
	})
	if input.ResourceSharedOnly && len(drafts) > 100 {
		drafts = drafts[:100]
	}
	return drafts, nil
}

func (r *MemoryRepo) GetCommunicationsEmailDraft(input CommunicationsEmailDraftGetInput) (domain.CommunicationsEmailDraft, error) {
	owner, err := normalizeCommunicationsSharedDraftOwner(input.SharedResourceType, input.SharedResourceID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if owner.resourceID != "" {
		return r.getCommunicationsResourceEmailDraft(input, owner)
	}
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	companyID := scope.companyID
	draftID := strings.TrimSpace(input.DraftID)
	if draftID == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	draft, ok := r.emailDrafts[communicationsEmailDraftKey(companyID, draftID)]
	authorized := ok && scope.matchesDraft(draft)
	if strings.TrimSpace(input.ParticipantUserID) != "" {
		authorized = authorized && draft.CreatedByUserID == strings.TrimSpace(input.ParticipantUserID)
	}
	if !authorized || draft.DeletedTimestamp != nil {
		return domain.CommunicationsEmailDraft{}, ErrNotFound
	}
	return draft, nil
}

func (r *MemoryRepo) UpsertCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	owner, err := normalizeCommunicationsSharedDraftOwner(input.SharedResourceType, input.SharedResourceID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if owner.resourceID != "" {
		return r.updateCommunicationsResourceEmailDraft(input, owner)
	}
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if err := r.validateCommunicationsEmailDraftScopeLocked(draft); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	existing, exists := r.emailDrafts[communicationsEmailDraftKey(draft.CompanyID, draft.DraftID)]
	if input.ExistingOnly {
		if !exists || existing.DeletedTimestamp != nil || !communicationsEmailDraftScopesMatch(existing, draft) ||
			existing.CreatedByUserID != draft.CreatedByUserID || existing.Kind != draft.Kind ||
			existing.SourceMessageID != draft.SourceMessageID {
			return domain.CommunicationsEmailDraft{}, ErrNotFound
		}
		if err := r.prepareCommunicationsEmailDraftSourceLocked(&draft); err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		now := time.Now().UTC()
		draft.CreatedTimestamp = existing.CreatedTimestamp
		draft.CreatedByUserID = existing.CreatedByUserID
		draft.UpdatedTimestamp = now
		draft.DeletedTimestamp = nil
		r.emailDrafts[communicationsEmailDraftKey(draft.CompanyID, draft.DraftID)] = draft
		return draft, nil
	}
	if exists && (!communicationsEmailDraftScopesMatch(existing, draft) || existing.CreatedByUserID != draft.CreatedByUserID ||
		existing.Kind != draft.Kind || existing.SourceMessageID != draft.SourceMessageID) {
		return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
	}
	if err := r.prepareCommunicationsEmailDraftSourceLocked(&draft); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if draft.SourceMessageID != "" {
		for _, candidate := range r.emailDrafts {
			if candidate.DraftID != draft.DraftID && communicationsEmailDraftSemanticIdentityMatches(candidate, draft) {
				return domain.CommunicationsEmailDraft{}, ErrEmailDraftIdentityConflict
			}
		}
	}
	now := time.Now().UTC()
	if !exists {
		draft.CreatedTimestamp = now
	} else {
		draft.CreatedTimestamp = existing.CreatedTimestamp
		draft.CreatedByUserID = existing.CreatedByUserID
	}
	draft.UpdatedTimestamp = now
	draft.DeletedTimestamp = nil
	r.emailDrafts[communicationsEmailDraftKey(draft.CompanyID, draft.DraftID)] = draft
	return draft, nil
}

func (r *MemoryRepo) EnsureCommunicationsEmailReplyDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, bool, error) {
	owner, err := normalizeCommunicationsSharedDraftOwner(input.SharedResourceType, input.SharedResourceID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	if owner.resourceID != "" {
		return r.ensureCommunicationsResourceEmailReplyDraft(input, owner)
	}
	if strings.TrimSpace(input.SeedFromPersonalDraftID) != "" {
		return domain.CommunicationsEmailDraft{}, false, ErrInvalid
	}
	input.DraftID = "draft:reply:" + newUUIDv7String()
	input.Kind = "reply"
	input.ReplyToMessageJSON = "{}"
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	if cleanUUIDText(draft.CreatedByUserID) == "" {
		return domain.CommunicationsEmailDraft{}, false, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.validateCommunicationsEmailDraftScopeLocked(draft); err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	for _, existing := range r.emailDrafts {
		if !communicationsEmailDraftSemanticIdentityMatches(existing, draft) {
			continue
		}
		if existing.Kind != "reply" {
			return domain.CommunicationsEmailDraft{}, false, ErrEmailDraftIdentityConflict
		}
		if err := r.prepareCommunicationsEmailDraftSourceLocked(&existing); err != nil {
			return domain.CommunicationsEmailDraft{}, false, err
		}
		return existing, false, nil
	}
	if err := r.prepareCommunicationsEmailDraftSourceLocked(&draft); err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	now := time.Now().UTC()
	draft.CreatedTimestamp = now
	draft.UpdatedTimestamp = now
	draft.DeletedTimestamp = nil
	r.emailDrafts[communicationsEmailDraftKey(draft.CompanyID, draft.DraftID)] = draft
	return draft, true, nil
}

func (r *MemoryRepo) validateCommunicationsEmailDraftScopeLocked(draft domain.CommunicationsEmailDraft) error {
	if _, ok := r.companies[draft.CompanyID]; !ok {
		return ErrNotFound
	}
	if draft.ScopeType == "personal" {
		if _, ok := r.emailConnections[emailConnectionKey(draft.PersonalUserID, draft.PersonalAccountEmail)]; !ok {
			return ErrNotFound
		}
		return nil
	}
	folder, ok := r.folders[key(draft.CompanyID, draft.SharedInboxID)]
	if !ok || CommunicationsSharedInboxResourceType(folder) != EntityTypeSharedInbox {
		return ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) prepareCommunicationsEmailDraftSourceLocked(draft *domain.CommunicationsEmailDraft) error {
	if draft.Kind == "reply" {
		draft.ReplyToMessageJSON = "{}"
	}
	if draft.SourceMessageID == "" {
		return nil
	}
	for _, thread := range r.emailThreads {
		if thread.CompanyID != draft.CompanyID || thread.ScopeType != draft.ScopeType ||
			(draft.ScopeType == "personal" && (thread.PersonalUserID != draft.PersonalUserID || thread.PersonalAccountEmail != draft.PersonalAccountEmail)) ||
			(draft.ScopeType == "shared" && thread.SharedInboxID != draft.SharedInboxID) {
			continue
		}
		for _, message := range thread.Messages {
			if message.EmailMessageID != draft.SourceMessageID {
				continue
			}
			if draft.Kind == "reply" {
				payload, err := json.Marshal(map[string]string{
					"id": message.ProviderMessageID, "email_message_id": message.EmailMessageID,
					"thread_id": thread.ProviderThreadID,
				})
				if err != nil {
					return err
				}
				draft.ReplyToMessageJSON = string(payload)
			}
			return nil
		}
	}
	return ErrEmailDraftSourceNotFound
}

func communicationsEmailDraftSemanticIdentityMatches(left, right domain.CommunicationsEmailDraft) bool {
	return left.DeletedTimestamp == nil && left.CompanyID == right.CompanyID &&
		left.CreatedByUserID == right.CreatedByUserID && left.SourceMessageID == right.SourceMessageID &&
		communicationsEmailDraftScopesMatch(left, right)
}

func (r *MemoryRepo) SoftDeleteCommunicationsEmailDraft(input CommunicationsEmailDraftDeleteInput) error {
	owner, err := normalizeCommunicationsSharedDraftOwner(input.SharedResourceType, input.SharedResourceID)
	if err != nil {
		return err
	}
	if owner.resourceID != "" {
		return r.deleteCommunicationsResourceEmailDraft(input, owner)
	}
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return err
	}
	companyID := scope.companyID
	draftID := strings.TrimSpace(input.DraftID)
	if draftID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	key := communicationsEmailDraftKey(companyID, draftID)
	draft, ok := r.emailDrafts[key]
	authorized := ok && scope.matchesDraft(draft)
	if strings.TrimSpace(input.ParticipantUserID) != "" {
		authorized = authorized && draft.CreatedByUserID == strings.TrimSpace(input.ParticipantUserID)
	}
	if !authorized || draft.DeletedTimestamp != nil {
		return ErrNotFound
	}
	now := time.Now().UTC()
	draft.UpdatedByUserID = strings.TrimSpace(input.UpdatedByUserID)
	draft.UpdatedTimestamp = now
	draft.DeletedTimestamp = &now
	r.emailDrafts[key] = draft
	r.retireMemoryEmailDraftAttachmentsLocked(companyID, draft.DraftID, now)
	return nil
}

func (r *MemoryRepo) GetCommunicationsSharedEmailDraftForSend(input CommunicationsEmailDraftGetInput) (domain.CommunicationsEmailDraft, error) {
	companyID, actorUserID, draftID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.ParticipantUserID), strings.TrimSpace(input.DraftID)
	if companyID == "" || actorUserID == "" || draftID == "" || input.ExpectedRevision < 1 {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	draft, ok := r.emailDrafts[communicationsEmailDraftKey(companyID, draftID)]
	if !ok || draft.DeletedTimestamp != nil || !isCommunicationsResourceSharedDraft(draft) ||
		!r.userHasEffectiveAccessLocked(companyID, actorUserID, draftSharedResourceType(draft), draftSharedResourceID(draft), EntityPermissionEdit) {
		return domain.CommunicationsEmailDraft{}, ErrNotFound
	}
	if draft.Revision != input.ExpectedRevision {
		return domain.CommunicationsEmailDraft{}, ErrVersionConflict
	}
	draft.CanSend = communicationsResourceDraftCanSendLocked(r, draft, actorUserID)
	return draft, nil
}

type communicationsSharedDraftOwner struct {
	resourceType string
	resourceID   string
}

func normalizeCommunicationsSharedDraftOwner(resourceType, resourceID string) (communicationsSharedDraftOwner, error) {
	resourceType, resourceID = strings.ToLower(strings.TrimSpace(resourceType)), cleanUUIDText(resourceID)
	if (resourceType == "") != (resourceID == "") || (resourceType != "" && resourceType != EntityTypeNode && resourceType != EntityTypeProject) {
		return communicationsSharedDraftOwner{}, ErrInvalid
	}
	return communicationsSharedDraftOwner{resourceType: resourceType, resourceID: resourceID}, nil
}

func isCommunicationsResourceSharedDraft(draft domain.CommunicationsEmailDraft) bool {
	return draft.SharedResourceType != "" && draft.SharedResourceID != ""
}

func draftSharedResourceType(draft domain.CommunicationsEmailDraft) string {
	return draft.SharedResourceType
}

func draftSharedResourceID(draft domain.CommunicationsEmailDraft) string {
	return draft.SharedResourceID
}

func communicationsSharedDraftOwnerMatches(draft domain.CommunicationsEmailDraft, owner communicationsSharedDraftOwner) bool {
	return draft.SharedResourceType == owner.resourceType && draft.SharedResourceID == owner.resourceID
}

func communicationsResourceDraftCanSendLocked(r *MemoryRepo, draft domain.CommunicationsEmailDraft, actorUserID string) bool {
	actorUserID = strings.TrimSpace(actorUserID)
	if draft.ScopeType == "personal" {
		return actorUserID != "" && actorUserID == draft.PersonalUserID
	}
	return actorUserID != "" && draft.SharedInboxID != "" &&
		r.userHasEffectiveAccessLocked(draft.CompanyID, actorUserID, EntityTypeSharedInbox, draft.SharedInboxID, EntityPermissionEdit)
}

func (r *MemoryRepo) listCommunicationsResourceEmailDrafts(input CommunicationsEmailDraftListInput, owner communicationsSharedDraftOwner) ([]domain.CommunicationsEmailDraft, error) {
	companyID, actorUserID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.ParticipantUserID)
	if companyID == "" || actorUserID == "" {
		return nil, ErrInvalid
	}
	kind, sourceMessageIDs, sourceThreadIDs, err := normalizeCommunicationsEmailDraftListFilters(input.Kind, input.SourceMessageIDs, input.SourceThreadIDs)
	if err != nil {
		return nil, err
	}
	if len(sourceMessageIDs) == 0 && len(sourceThreadIDs) == 0 {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if !r.userHasEffectiveAccessLocked(companyID, actorUserID, owner.resourceType, owner.resourceID, EntityPermissionEdit) {
		return nil, ErrNotFound
	}
	sourceIDs, threadIDs := stringSet(sourceMessageIDs), stringSet(sourceThreadIDs)
	drafts := make([]domain.CommunicationsEmailDraft, 0)
	for _, draft := range r.emailDrafts {
		if draft.CompanyID != companyID || draft.DeletedTimestamp != nil || (kind != "" && draft.Kind != kind) {
			continue
		}
		isShared := communicationsSharedDraftOwnerMatches(draft, owner)
		isPersonal := !isCommunicationsResourceSharedDraft(draft) && draft.CreatedByUserID == actorUserID &&
			communicationsResourceDraftCanSendLocked(r, draft, actorUserID)
		if (!isShared && !isPersonal) || !r.memoryResourceHasExactEmailRelationshipLocked(owner, companyID, draft.SourceMessageID) {
			continue
		}
		threadID := r.memoryEmailThreadIDForMessageLocked(companyID, draft.SourceMessageID)
		if (len(sourceIDs) > 0 || len(threadIDs) > 0) && !sourceIDs[draft.SourceMessageID] && !threadIDs[threadID] {
			continue
		}
		draft.SourceThreadID = threadID
		draft.BodyEditorHTML = ""
		draft.ReplyToMessageJSON = "{}"
		draft.CanSend = isPersonal || communicationsResourceDraftCanSendLocked(r, draft, actorUserID)
		drafts = append(drafts, draft)
	}
	sort.SliceStable(drafts, func(i, j int) bool {
		if drafts[i].UpdatedTimestamp.Equal(drafts[j].UpdatedTimestamp) {
			return drafts[i].DraftID < drafts[j].DraftID
		}
		return drafts[i].UpdatedTimestamp.After(drafts[j].UpdatedTimestamp)
	})
	return drafts, nil
}

func stringSet(values []string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		result[value] = true
	}
	return result
}

func (r *MemoryRepo) getCommunicationsResourceEmailDraft(input CommunicationsEmailDraftGetInput, owner communicationsSharedDraftOwner) (domain.CommunicationsEmailDraft, error) {
	companyID, actorUserID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.ParticipantUserID)
	if companyID == "" || actorUserID == "" || strings.TrimSpace(input.DraftID) == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	draft, ok := r.emailDrafts[communicationsEmailDraftKey(companyID, input.DraftID)]
	if !ok || draft.DeletedTimestamp != nil || !communicationsSharedDraftOwnerMatches(draft, owner) ||
		!r.userHasEffectiveAccessLocked(companyID, actorUserID, owner.resourceType, owner.resourceID, EntityPermissionEdit) {
		return domain.CommunicationsEmailDraft{}, ErrNotFound
	}
	if input.ExpectedRevision > 0 && draft.Revision != input.ExpectedRevision {
		return domain.CommunicationsEmailDraft{}, ErrVersionConflict
	}
	draft.CanSend = communicationsResourceDraftCanSendLocked(r, draft, actorUserID)
	return draft, nil
}

func (r *MemoryRepo) ensureCommunicationsResourceEmailReplyDraft(input CommunicationsEmailDraftInput, owner communicationsSharedDraftOwner) (domain.CommunicationsEmailDraft, bool, error) {
	companyID, actorUserID, sourceMessageID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.CreatedByUserID), cleanUUIDText(input.SourceMessageID)
	if companyID == "" || actorUserID == "" || sourceMessageID == "" || input.ScheduledSendTimestamp != nil {
		return domain.CommunicationsEmailDraft{}, false, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.userHasEffectiveAccessLocked(companyID, actorUserID, owner.resourceType, owner.resourceID, EntityPermissionEdit) {
		return domain.CommunicationsEmailDraft{}, false, ErrNotFound
	}
	for _, existing := range r.emailDrafts {
		if existing.CompanyID == companyID && existing.DeletedTimestamp == nil && existing.SourceMessageID == sourceMessageID && communicationsSharedDraftOwnerMatches(existing, owner) {
			existing.CanSend = communicationsResourceDraftCanSendLocked(r, existing, actorUserID)
			return existing, false, nil
		}
	}
	thread, message, ok := r.memoryResourceEmailSourceLocked(owner, companyID, sourceMessageID)
	if !ok {
		return domain.CommunicationsEmailDraft{}, false, ErrEmailDraftSourceNotFound
	}
	sharedInboxID := ""
	if thread.ScopeType == "shared" {
		sharedInboxID = cleanUUIDText(input.SharedInboxID)
		folder, found := r.folders[key(companyID, sharedInboxID)]
		connection, connected := r.companyEmailConnections[companyEmailConnectionKey(companyID, folder.CompanyEmailConnectionID)]
		if !found || !connected || normalizeMemorySharedInboxFolder(folder).EntryType != CommunicationsSharedInboxEntryTypeSharedInbox ||
			connection.EmailConnectionID != thread.EmailConnectionID {
			return domain.CommunicationsEmailDraft{}, false, ErrEmailDraftSourceNotFound
		}
	}
	seedDraftID := strings.TrimSpace(input.SeedFromPersonalDraftID)
	if seedDraftID != "" {
		seed, found := r.emailDrafts[communicationsEmailDraftKey(companyID, seedDraftID)]
		exactMailbox := seed.ScopeType == thread.ScopeType
		if thread.ScopeType == "personal" {
			exactMailbox = exactMailbox && seed.PersonalUserID == thread.PersonalUserID && strings.EqualFold(seed.PersonalAccountEmail, thread.PersonalAccountEmail)
		} else {
			exactMailbox = exactMailbox && seed.SharedInboxID == sharedInboxID
		}
		if !found || seed.DeletedTimestamp != nil || seed.CreatedByUserID != actorUserID || seed.Kind != "reply" ||
			seed.SourceMessageID != sourceMessageID || seed.SharedResourceType != "" || seed.SharedResourceID != "" || !exactMailbox {
			return domain.CommunicationsEmailDraft{}, false, ErrInvalid
		}
		input.ToRecipients, input.CcRecipients, input.BccRecipients = seed.ToRecipients, seed.CcRecipients, seed.BccRecipients
		input.Subject, input.BodyEditorHTML = seed.Subject, seed.BodyEditorHTML
	}
	now := time.Now().UTC()
	draft := domain.CommunicationsEmailDraft{
		CompanyID: companyID, DraftID: "draft:reply:" + newUUIDv7String(), ScopeType: thread.ScopeType,
		PersonalUserID: thread.PersonalUserID, PersonalAccountEmail: thread.PersonalAccountEmail,
		SharedInboxID: sharedInboxID, SharedResourceType: owner.resourceType, SharedResourceID: owner.resourceID,
		Revision: 1, CreatedByUserID: actorUserID, UpdatedByUserID: actorUserID, Kind: "reply",
		SourceMessageID: sourceMessageID, SourceThreadID: thread.EmailThreadID, AccountEmail: thread.AccountEmail,
		ToRecipients: input.ToRecipients, CcRecipients: input.CcRecipients, BccRecipients: input.BccRecipients,
		Subject: input.Subject, BodyEditorHTML: input.BodyEditorHTML, CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	payload, err := json.Marshal(map[string]string{"id": message.ProviderMessageID, "email_message_id": sourceMessageID, "thread_id": thread.ProviderThreadID})
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	draft.ReplyToMessageJSON = string(payload)
	draft.CanSend = communicationsResourceDraftCanSendLocked(r, draft, actorUserID)
	r.emailDrafts[communicationsEmailDraftKey(companyID, draft.DraftID)] = draft
	if seedDraftID != "" {
		for _, sourceLink := range r.resourceAttachments {
			if sourceLink.CompanyID != companyID || sourceLink.ResourceType != "email_draft" || sourceLink.ResourceID != seedDraftID || sourceLink.DeletedTimestamp != nil {
				continue
			}
			link := sourceLink
			link.ResourceAttachmentID, link.ResourceID = newUUIDv7String(), draft.DraftID
			link.CreatedByUserID, link.CreatedTimestamp, link.ResourceRevision = actorUserID, now, draft.Revision
			r.resourceAttachments[link.ResourceAttachmentID] = link
		}
	}
	return draft, true, nil
}

func (r *MemoryRepo) updateCommunicationsResourceEmailDraft(input CommunicationsEmailDraftInput, owner communicationsSharedDraftOwner) (domain.CommunicationsEmailDraft, error) {
	companyID, actorUserID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.UpdatedByUserID)
	if companyID == "" || actorUserID == "" || strings.TrimSpace(input.DraftID) == "" || input.ExpectedRevision < 1 ||
		(input.Kind != "" && normalizeCommunicationsEmailDraftKind(input.Kind) != "reply") || input.ScheduledSendTimestamp != nil {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := communicationsEmailDraftKey(companyID, input.DraftID)
	draft, ok := r.emailDrafts[key]
	if !ok || draft.DeletedTimestamp != nil || !communicationsSharedDraftOwnerMatches(draft, owner) ||
		!r.userHasEffectiveAccessLocked(companyID, actorUserID, owner.resourceType, owner.resourceID, EntityPermissionEdit) {
		return domain.CommunicationsEmailDraft{}, ErrNotFound
	}
	if draft.Revision != input.ExpectedRevision {
		return domain.CommunicationsEmailDraft{}, ErrVersionConflict
	}
	draft.UpdatedByUserID = actorUserID
	draft.ToRecipients, draft.CcRecipients, draft.BccRecipients = input.ToRecipients, input.CcRecipients, input.BccRecipients
	draft.Subject, draft.BodyEditorHTML = input.Subject, input.BodyEditorHTML
	draft.Revision++
	draft.UpdatedTimestamp = time.Now().UTC()
	draft.CanSend = communicationsResourceDraftCanSendLocked(r, draft, actorUserID)
	r.emailDrafts[key] = draft
	return draft, nil
}

func (r *MemoryRepo) deleteCommunicationsResourceEmailDraft(input CommunicationsEmailDraftDeleteInput, owner communicationsSharedDraftOwner) error {
	companyID, actorUserID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.UpdatedByUserID)
	if companyID == "" || actorUserID == "" || strings.TrimSpace(input.DraftID) == "" || input.ExpectedRevision < 1 {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := communicationsEmailDraftKey(companyID, input.DraftID)
	draft, ok := r.emailDrafts[key]
	if !ok || draft.DeletedTimestamp != nil || !communicationsSharedDraftOwnerMatches(draft, owner) ||
		!r.userHasEffectiveAccessLocked(companyID, actorUserID, owner.resourceType, owner.resourceID, EntityPermissionEdit) {
		return ErrNotFound
	}
	if draft.Revision != input.ExpectedRevision {
		return ErrVersionConflict
	}
	now := time.Now().UTC()
	draft.UpdatedByUserID, draft.UpdatedTimestamp, draft.DeletedTimestamp = actorUserID, now, &now
	draft.Revision++
	r.emailDrafts[key] = draft
	r.retireMemoryEmailDraftAttachmentsLocked(companyID, draft.DraftID, now)
	return nil
}

func (r *MemoryRepo) retireMemoryEmailDraftAttachmentsLocked(companyID, draftID string, now time.Time) {
	r.retireMemoryAttachmentOwnerLocked(companyID, "email_draft", draftID, now)
}

func (r *MemoryRepo) deleteMemoryResourceSharedEmailDraftsLocked(companyID, resourceType, resourceID string) {
	now := time.Now().UTC()
	for draftKey, draft := range r.emailDrafts {
		matches := draft.SharedResourceType == resourceType && draft.SharedResourceID == resourceID
		if draft.CompanyID != companyID || !matches {
			continue
		}
		r.retireMemoryEmailDraftAttachmentsLocked(companyID, draft.DraftID, now)
		delete(r.emailDrafts, draftKey)
	}
}

func (r *MemoryRepo) retireMemoryExactResourceSharedEmailDraftLocked(companyID, resourceType, resourceID, sourceMessageID string) {
	now := time.Now().UTC()
	for draftKey, draft := range r.emailDrafts {
		matches := draft.SharedResourceType == resourceType && draft.SharedResourceID == resourceID
		if draft.CompanyID != companyID || !matches || draft.SourceMessageID != sourceMessageID || draft.DeletedTimestamp != nil {
			continue
		}
		draft.DeletedTimestamp, draft.UpdatedTimestamp, draft.Revision = &now, now, draft.Revision+1
		r.emailDrafts[draftKey] = draft
		r.retireMemoryEmailDraftAttachmentsLocked(companyID, draft.DraftID, now)
	}
}

func (r *MemoryRepo) memoryResourceHasExactEmailRelationshipLocked(owner communicationsSharedDraftOwner, companyID, sourceMessageID string) bool {
	_, _, ok := r.memoryResourceEmailSourceLocked(owner, companyID, sourceMessageID)
	return ok
}

func (r *MemoryRepo) memoryResourceEmailSourceLocked(owner communicationsSharedDraftOwner, companyID, sourceMessageID string) (domain.CommunicationsEmailThread, domain.CommunicationsEmailMessage, bool) {
	threadID := ""
	if owner.resourceType == EntityTypeNode {
		for _, relationship := range r.nodeEmailThreads {
			if relationship.CompanyID == companyID && relationship.NodeID == owner.resourceID && relationship.SelectedMessageID == sourceMessageID {
				threadID = relationship.EmailThreadID
				break
			}
		}
	} else {
		for _, relationship := range r.projectEmailRelationships {
			if relationship.CompanyID == companyID && relationship.ProjectID == owner.resourceID && relationship.EmailMessageID == sourceMessageID && relationship.ResourceTextboxID == "" {
				threadID = relationship.EmailThreadID
				break
			}
		}
	}
	thread, ok := r.emailThreads[key(companyID, threadID)]
	if !ok {
		return domain.CommunicationsEmailThread{}, domain.CommunicationsEmailMessage{}, false
	}
	for _, message := range thread.Messages {
		if message.EmailMessageID == sourceMessageID {
			return thread, message, true
		}
	}
	return domain.CommunicationsEmailThread{}, domain.CommunicationsEmailMessage{}, false
}

func (r *MemoryRepo) memoryEmailThreadIDForMessageLocked(companyID, sourceMessageID string) string {
	for _, thread := range r.emailThreads {
		if thread.CompanyID != companyID {
			continue
		}
		for _, message := range thread.Messages {
			if message.EmailMessageID == sourceMessageID {
				return thread.EmailThreadID
			}
		}
	}
	return ""
}

func (r *MemoryRepo) GetCommunicationsEmailSignature(input CommunicationsEmailSignatureScopeInput) (domain.CommunicationsEmailSignature, error) {
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailSignature{}, err
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	var found domain.CommunicationsEmailSignature
	for _, signature := range r.emailSignatures {
		if signature.CompanyID != scope.companyID {
			continue
		}
		if scope.matchesSignature(signature) && (found.SignatureID == "" || signature.UpdatedTimestamp.After(found.UpdatedTimestamp)) {
			found = signature
		}
	}
	if found.SignatureID == "" {
		return domain.CommunicationsEmailSignature{}, ErrNotFound
	}
	return found, nil
}

func (r *MemoryRepo) UpsertCommunicationsEmailSignature(input CommunicationsEmailSignatureInput) (domain.CommunicationsEmailSignature, error) {
	signature, err := normalizeCommunicationsEmailSignatureInput(input)
	if err != nil {
		return domain.CommunicationsEmailSignature{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.companies[signature.CompanyID]; !ok {
		return domain.CommunicationsEmailSignature{}, ErrNotFound
	}
	if signature.ScopeType == "personal" {
		if _, ok := r.emailConnections[emailConnectionKey(signature.PersonalUserID, signature.PersonalAccountEmail)]; !ok {
			return domain.CommunicationsEmailSignature{}, ErrNotFound
		}
	} else if _, ok := r.folders[key(signature.CompanyID, signature.SharedInboxID)]; !ok {
		return domain.CommunicationsEmailSignature{}, ErrNotFound
	}

	now := time.Now().UTC()
	existing := r.emailSignatures[communicationsEmailSignatureKey(signature.CompanyID, signature.SignatureID)]
	if existing.CreatedTimestamp.IsZero() {
		signature.CreatedTimestamp = now
	} else {
		signature.CreatedTimestamp = existing.CreatedTimestamp
		if strings.TrimSpace(signature.CreatedByUserID) == "" {
			signature.CreatedByUserID = existing.CreatedByUserID
		}
	}
	signature.UpdatedTimestamp = now
	r.emailSignatures[communicationsEmailSignatureKey(signature.CompanyID, signature.SignatureID)] = signature
	return signature, nil
}

type communicationsEmailScope struct {
	companyID            string
	scopeType            string
	personalUserID       string
	personalAccountEmail string
	sharedInboxID        string
}

func normalizeCommunicationsEmailDraftInput(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draftID := strings.TrimSpace(input.DraftID)
	if draftID == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	kind := normalizeCommunicationsEmailDraftKind(input.Kind)
	if kind == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	sourceMessageID := cleanUUIDText(input.SourceMessageID)
	if strings.TrimSpace(input.SourceMessageID) != "" && sourceMessageID == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	if kind == "reply" && sourceMessageID == "" {
		return domain.CommunicationsEmailDraft{}, ErrEmailReplySourceNotIngested
	}
	replyToJSON := strings.TrimSpace(input.ReplyToMessageJSON)
	if replyToJSON == "" {
		replyToJSON = "{}"
	}
	return domain.CommunicationsEmailDraft{
		CompanyID:              scope.companyID,
		DraftID:                draftID,
		ScopeType:              scope.scopeType,
		PersonalUserID:         scope.personalUserID,
		PersonalAccountEmail:   scope.personalAccountEmail,
		SharedInboxID:          scope.sharedInboxID,
		CreatedByUserID:        strings.TrimSpace(input.CreatedByUserID),
		UpdatedByUserID:        strings.TrimSpace(input.UpdatedByUserID),
		Kind:                   kind,
		SourceMessageID:        sourceMessageID,
		AccountEmail:           normalizeEmail(input.AccountEmail),
		ToRecipients:           input.ToRecipients,
		CcRecipients:           input.CcRecipients,
		BccRecipients:          input.BccRecipients,
		Subject:                input.Subject,
		BodyEditorHTML:         input.BodyEditorHTML,
		ReplyToMessageJSON:     replyToJSON,
		ScheduledSendTimestamp: input.ScheduledSendTimestamp,
	}, nil
}

func normalizeCommunicationsEmailDraftListFilters(kindInput string, sourceMessageIDInputs, sourceThreadIDInputs []string) (string, []string, []string, error) {
	kind := strings.ToLower(strings.TrimSpace(kindInput))
	if kind != "" {
		kind = normalizeCommunicationsEmailDraftKind(kind)
		if kind == "" {
			return "", nil, nil, ErrInvalid
		}
	}
	if len(sourceMessageIDInputs) > CommunicationsEmailDraftSourceFilterMax || len(sourceThreadIDInputs) > CommunicationsEmailDraftSourceFilterMax {
		return "", nil, nil, ErrInvalid
	}
	normalizeIDs := func(inputs []string) ([]string, error) {
		ids := make([]string, 0, len(inputs))
		seen := make(map[string]struct{}, len(inputs))
		for _, input := range inputs {
			id := cleanUUIDText(input)
			if id == "" {
				return nil, ErrInvalid
			}
			if _, exists := seen[id]; exists {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
		return ids, nil
	}
	sourceMessageIDs, err := normalizeIDs(sourceMessageIDInputs)
	if err != nil {
		return "", nil, nil, err
	}
	sourceThreadIDs, err := normalizeIDs(sourceThreadIDInputs)
	if err != nil {
		return "", nil, nil, err
	}
	return kind, sourceMessageIDs, sourceThreadIDs, nil
}

func normalizeCommunicationsEmailSignatureInput(input CommunicationsEmailSignatureInput) (domain.CommunicationsEmailSignature, error) {
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailSignature{}, err
	}
	signatureID := strings.TrimSpace(input.SignatureID)
	if signatureID == "" {
		signatureID = communicationsEmailSignatureID(scope)
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "Default"
	}
	return domain.CommunicationsEmailSignature{
		CompanyID:            scope.companyID,
		SignatureID:          signatureID,
		ScopeType:            scope.scopeType,
		PersonalUserID:       scope.personalUserID,
		PersonalAccountEmail: scope.personalAccountEmail,
		SharedInboxID:        scope.sharedInboxID,
		Name:                 name,
		BodyEditorHTML:       input.BodyEditorHTML,
		IsDefault:            input.IsDefault,
		CreatedByUserID:      strings.TrimSpace(input.CreatedByUserID),
		UpdatedByUserID:      strings.TrimSpace(input.UpdatedByUserID),
	}, nil
}

func normalizeCommunicationsEmailScope(companyID, personalUserID, personalAccountEmail, sharedInboxID string) (communicationsEmailScope, error) {
	scope := communicationsEmailScope{
		companyID:            strings.TrimSpace(companyID),
		personalUserID:       strings.TrimSpace(personalUserID),
		personalAccountEmail: normalizeEmail(personalAccountEmail),
		sharedInboxID:        strings.TrimSpace(sharedInboxID),
	}
	if scope.companyID == "" {
		return communicationsEmailScope{}, ErrInvalid
	}
	if scope.sharedInboxID != "" {
		if scope.personalUserID != "" || scope.personalAccountEmail != "" {
			return communicationsEmailScope{}, ErrInvalid
		}
		scope.scopeType = "shared"
		return scope, nil
	}
	if scope.personalUserID == "" || scope.personalAccountEmail == "" {
		return communicationsEmailScope{}, ErrInvalid
	}
	scope.scopeType = "personal"
	return scope, nil
}

func (scope communicationsEmailScope) matchesSignature(signature domain.CommunicationsEmailSignature) bool {
	if scope.scopeType == "shared" {
		return signature.ScopeType == "shared" && signature.SharedInboxID == scope.sharedInboxID
	}
	return signature.ScopeType == "personal" && signature.PersonalUserID == scope.personalUserID && signature.PersonalAccountEmail == scope.personalAccountEmail
}

func (scope communicationsEmailScope) matchesDraft(draft domain.CommunicationsEmailDraft) bool {
	if scope.scopeType == "shared" {
		return draft.ScopeType == "shared" && draft.SharedInboxID == scope.sharedInboxID
	}
	return draft.ScopeType == "personal" && draft.PersonalUserID == scope.personalUserID && draft.PersonalAccountEmail == scope.personalAccountEmail
}

func communicationsEmailDraftScopesMatch(left, right domain.CommunicationsEmailDraft) bool {
	return left.CompanyID == right.CompanyID &&
		left.ScopeType == right.ScopeType &&
		left.PersonalUserID == right.PersonalUserID &&
		left.PersonalAccountEmail == right.PersonalAccountEmail &&
		left.SharedInboxID == right.SharedInboxID
}

func normalizeCommunicationsEmailDraftKind(kind string) string {
	switch strings.TrimSpace(strings.ToLower(kind)) {
	case "", "compose":
		return "compose"
	case "reply":
		return "reply"
	case "forward":
		return "forward"
	default:
		return ""
	}
}

func communicationsEmailDraftKey(companyID, draftID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(draftID)
}

func communicationsEmailSignatureKey(companyID, signatureID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(signatureID)
}

func communicationsEmailSignatureID(scope communicationsEmailScope) string {
	if scope.scopeType == "shared" {
		return "shared:" + scope.sharedInboxID
	}
	return "personal:" + scope.personalUserID + ":" + scope.personalAccountEmail
}
