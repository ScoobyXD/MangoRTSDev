package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func cloneCommunicationsEmailCollaboration(item domain.CommunicationsEmailCollaboration) domain.CommunicationsEmailCollaboration {
	item.Message = normalizeEmailMessageSnapshot(item.Message)
	item.Participants = append([]domain.CommunicationsEmailCollaborationParticipant(nil), item.Participants...)
	return item
}

func (r *MemoryRepo) collaborationParticipantsLocked(companyID, collaborationID string) []domain.CommunicationsEmailCollaborationParticipant {
	items := []domain.CommunicationsEmailCollaborationParticipant{}
	for _, participant := range r.emailCollaborationParticipants {
		if participant.CompanyID == companyID && participant.CollaborationID == collaborationID {
			items = append(items, participant)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].UserID < items[j].UserID
	})
	return items
}

func (r *MemoryRepo) withCollaborationParticipantsLocked(item domain.CommunicationsEmailCollaboration) domain.CommunicationsEmailCollaboration {
	item.Participants = r.collaborationParticipantsLocked(item.CompanyID, item.CollaborationID)
	return cloneCommunicationsEmailCollaboration(item)
}

func collaborationScopeMatches(item domain.CommunicationsEmailCollaboration, scope communicationsEmailCollaborationScope) bool {
	if item.ScopeType != scope.scopeType {
		return false
	}
	if scope.scopeType == CommunicationsEmailCollaborationScopePersonal {
		return item.PersonalUserID == scope.personalUserID && item.PersonalAccountEmail == scope.personalAccountEmail
	}
	return item.SharedInboxID == scope.sharedInboxID
}

func collaborationMessageIdentifierMatches(item domain.CommunicationsEmailCollaboration, messageID string) bool {
	messageID = strings.TrimSpace(messageID)
	return messageID != "" && (item.RootMessageID == messageID || item.LatestMessageID == messageID || item.Message.ID == messageID)
}

func (r *MemoryRepo) findCollaborationLocked(companyID string, scope communicationsEmailCollaborationScope, messageID, threadID string) (domain.CommunicationsEmailCollaboration, bool) {
	threadID = strings.TrimSpace(threadID)
	if threadID != "" {
		for _, item := range r.emailCollaborations {
			if item.CompanyID == companyID && collaborationScopeMatches(item, scope) && item.ProviderThreadID == threadID {
				return item, true
			}
		}
	}
	for _, item := range r.emailCollaborations {
		if item.CompanyID == companyID && collaborationScopeMatches(item, scope) && collaborationMessageIdentifierMatches(item, messageID) {
			return item, true
		}
	}
	return domain.CommunicationsEmailCollaboration{}, false
}

func (r *MemoryRepo) reconcileEnsuredEmailCollaborationLocked(existing domain.CommunicationsEmailCollaboration, input CommunicationsEmailCollaborationEnsureInput) domain.CommunicationsEmailCollaboration {
	providerThreadID := strings.TrimSpace(existing.ProviderThreadID)
	incomingThreadID := strings.TrimSpace(input.Message.ThreadID)
	changed := false
	if providerThreadID == "" && incomingThreadID != "" {
		providerThreadID = incomingThreadID
		existing.ProviderThreadID = incomingThreadID
		changed = true
	}
	if shouldAdvanceEmailCollaborationMessage(existing.Message, input.Message) {
		message := mergeEmailMessageSnapshot(existing.Message, input.Message)
		if providerThreadID != "" {
			message.ThreadID = providerThreadID
		}
		existing.Message = message
		existing.LatestMessageID = message.ID
		changed = true
	}
	if providerThreadID != "" && existing.Message.ThreadID != providerThreadID {
		existing.Message.ThreadID = providerThreadID
		changed = true
	}
	if changed {
		existing.UpdatedTimestamp = time.Now().UTC()
		r.emailCollaborations[key(existing.CompanyID, existing.CollaborationID)] = existing
	}
	return existing
}

func (r *MemoryRepo) EnsureCommunicationsEmailCollaboration(input CommunicationsEmailCollaborationEnsureInput) (CommunicationsEmailCollaborationEnsureResult, error) {
	input, scope, err := normalizeCommunicationsEmailCollaborationEnsureInput(input)
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.companies[input.CompanyID]; !ok {
		return CommunicationsEmailCollaborationEnsureResult{}, ErrNotFound
	}
	if _, ok := r.memberships[membershipKey(input.CompanyID, input.CreatedByUserID)]; !ok {
		return CommunicationsEmailCollaborationEnsureResult{}, ErrPrincipalNotInCompany
	}
	if existing, ok := r.findCollaborationLocked(input.CompanyID, scope, input.Message.ID, input.Message.ThreadID); ok {
		existing = r.reconcileEnsuredEmailCollaborationLocked(existing, input)
		return CommunicationsEmailCollaborationEnsureResult{Collaboration: r.withCollaborationParticipantsLocked(existing)}, nil
	}

	now := time.Now().UTC()
	node, err := r.createNodeLocked(input.CompanyID, communicationsEmailCollaborationTitle(input.Message))
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	node.DefaultAccess = ResourceDefaultAccessNoAccess
	r.nodes[key(input.CompanyID, node.NodeID)] = node
	informationID, collaborationID := newUUIDv7String(), newUUIDv7String()
	information := communicationsEmailAttachedProjectionPayload(informationID, collaborationID, input)
	projection := domain.NodeProjection{CompanyID: input.CompanyID, NodeID: node.NodeID, InformationID: informationID, Type: "Attached email", Information: information, CreatedTimestamp: now, UpdatedTimestamp: now}
	r.nodeText[key(input.CompanyID, node.NodeID)] = map[string]domain.NodeProjection{informationID: projection}
	r.nodeInfo[key(input.CompanyID, node.NodeID)] = []domain.NodeInformation{{CompanyID: input.CompanyID, NodeID: node.NodeID, InformationID: informationID, Type: "Attached email", Information: information, CreatedTimestamp: now, UpdatedTimestamp: now}}
	r.ensureCompanyExplorerDefaultFoldersLocked(input.CompanyID)
	r.ensureCompanyExplorerV2NativeEntityLocked(input.CompanyID, CompanyExplorerV2EntityNode, node.NodeID, node.Title, now, now)
	if !r.placeEmailCollaborationNodeInDefaultFolderLocked(input.CompanyID, node.NodeID) {
		return CommunicationsEmailCollaborationEnsureResult{}, ErrInvalid
	}
	item := domain.CommunicationsEmailCollaboration{
		CompanyID: input.CompanyID, CollaborationID: collaborationID, NodeID: node.NodeID,
		AttachedEmailInformationID: informationID, ScopeType: scope.scopeType,
		PersonalUserID: scope.personalUserID, PersonalAccountEmail: scope.personalAccountEmail,
		SharedInboxID: scope.sharedInboxID, AccountEmail: scope.accountEmail,
		ProviderThreadID: input.Message.ThreadID, RootMessageID: input.Message.ID,
		LatestMessageID: input.Message.ID, Message: input.Message, CreatedByUserID: input.CreatedByUserID,
		CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	r.emailCollaborations[key(input.CompanyID, item.CollaborationID)] = item
	participant := domain.CommunicationsEmailCollaborationParticipant{CompanyID: input.CompanyID, CollaborationID: item.CollaborationID, UserID: input.CreatedByUserID, AddedByUserID: input.CreatedByUserID, AddedViaType: CommunicationsEmailCollaborationParticipantCreator, CreatedTimestamp: now}
	r.emailCollaborationParticipants[emailCollaborationParticipantKey(input.CompanyID, item.CollaborationID, participant.UserID)] = participant
	if err := r.grantCollaborationNodeEditLocked(input.CompanyID, node.NodeID, input.CreatedByUserID, now); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	r.bumpNodeViewVersionLocked(input.CompanyID, node.NodeID)
	return CommunicationsEmailCollaborationEnsureResult{Collaboration: r.withCollaborationParticipantsLocked(item), Created: true}, nil
}

func (r *MemoryRepo) grantCollaborationNodeEditLocked(companyID, nodeID, userID string, now time.Time) error {
	if _, ok := r.memberships[membershipKey(companyID, userID)]; !ok {
		return ErrPrincipalNotInCompany
	}
	node, ok := r.nodes[key(companyID, nodeID)]
	if !ok {
		return ErrNotFound
	}
	node.DefaultAccess = ResourceDefaultAccessNoAccess
	r.nodes[key(companyID, nodeID)] = node
	permission := domain.EntityPermission{CompanyID: companyID, EntityType: EntityTypeNode, EntityID: nodeID, SubjectType: EntityPermissionSubjectUser, SubjectID: userID, Permission: EntityPermissionEdit, AccessLevel: EntityPermissionEdit, CreatedTimestamp: now}
	r.entityPermissions[entityPermissionKey(companyID, EntityTypeNode, nodeID, EntityPermissionSubjectUser, userID, EntityPermissionEdit)] = permission
	if err := r.recomputeDirectGrantEffectiveAccessForResourceLocked(companyID, EntityTypeNode, nodeID); err != nil {
		return err
	}
	return r.recomputeCompanyMemberDefaultEffectiveAccessForResourceLocked(companyID, EntityTypeNode, nodeID)
}

func (r *MemoryRepo) ResolveCommunicationsEmailCollaboration(input CommunicationsEmailCollaborationResolveInput) (domain.CommunicationsEmailCollaboration, error) {
	input, scope, err := normalizeCommunicationsEmailCollaborationResolveInput(input)
	if err != nil {
		return domain.CommunicationsEmailCollaboration{}, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.findCollaborationLocked(input.CompanyID, scope, input.MessageID, input.ThreadID)
	if !ok {
		return domain.CommunicationsEmailCollaboration{}, ErrNotFound
	}
	if _, ok := r.emailCollaborationParticipants[emailCollaborationParticipantKey(input.CompanyID, item.CollaborationID, input.ParticipantUserID)]; !ok {
		return domain.CommunicationsEmailCollaboration{}, ErrNotFound
	}
	return r.withCollaborationParticipantsLocked(item), nil
}

func (r *MemoryRepo) GetCommunicationsEmailCollaboration(companyID, collaborationID, participantUserID string) (domain.CommunicationsEmailCollaboration, error) {
	companyID, collaborationID, participantUserID = cleanUUIDText(companyID), cleanUUIDText(collaborationID), cleanUUIDText(participantUserID)
	if companyID == "" || collaborationID == "" || participantUserID == "" {
		return domain.CommunicationsEmailCollaboration{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.emailCollaborations[key(companyID, collaborationID)]
	if !ok {
		return domain.CommunicationsEmailCollaboration{}, ErrNotFound
	}
	if _, ok := r.emailCollaborationParticipants[emailCollaborationParticipantKey(companyID, collaborationID, participantUserID)]; !ok {
		return domain.CommunicationsEmailCollaboration{}, ErrNotFound
	}
	return r.withCollaborationParticipantsLocked(item), nil
}

func (r *MemoryRepo) ListCommunicationsEmailCollaborations(companyID, participantUserID string) ([]domain.CommunicationsEmailCollaboration, error) {
	companyID, participantUserID = cleanUUIDText(companyID), cleanUUIDText(participantUserID)
	if companyID == "" || participantUserID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := []domain.CommunicationsEmailCollaboration{}
	for _, item := range r.emailCollaborations {
		if item.CompanyID != companyID {
			continue
		}
		if _, ok := r.emailCollaborationParticipants[emailCollaborationParticipantKey(companyID, item.CollaborationID, participantUserID)]; ok {
			items = append(items, r.withCollaborationParticipantsLocked(item))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedTimestamp.After(items[j].UpdatedTimestamp) })
	return items, nil
}

func (r *MemoryRepo) AddCommunicationsEmailCollaborationParticipants(input CommunicationsEmailCollaborationParticipantInput) (CommunicationsEmailCollaborationParticipantResult, error) {
	input, err := normalizeCommunicationsEmailCollaborationParticipantInput(input)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.addCollaborationParticipantsLocked(input)
}

func (r *MemoryRepo) AddCommunicationsEmailCollaborationParticipantsForNode(input CommunicationsEmailCollaborationNodeParticipantInput) (CommunicationsEmailCollaborationParticipantResult, error) {
	input, err := normalizeCommunicationsEmailCollaborationNodeParticipantInput(input)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, item := range r.emailCollaborations {
		if item.CompanyID == input.CompanyID && item.NodeID == input.NodeID {
			return r.addCollaborationParticipantsLocked(CommunicationsEmailCollaborationParticipantInput{CompanyID: input.CompanyID, CollaborationID: item.CollaborationID, ActorUserID: input.ActorUserID, MentionedUserIDs: input.MentionedUserIDs, MentionedGroupIDs: input.MentionedGroupIDs})
		}
	}
	return CommunicationsEmailCollaborationParticipantResult{}, ErrNotFound
}

func (r *MemoryRepo) addCollaborationParticipantsLocked(input CommunicationsEmailCollaborationParticipantInput) (CommunicationsEmailCollaborationParticipantResult, error) {
	item, ok := r.emailCollaborations[key(input.CompanyID, input.CollaborationID)]
	if !ok {
		return CommunicationsEmailCollaborationParticipantResult{}, ErrNotFound
	}
	if _, ok := r.emailCollaborationParticipants[emailCollaborationParticipantKey(input.CompanyID, item.CollaborationID, input.ActorUserID)]; !ok {
		return CommunicationsEmailCollaborationParticipantResult{}, ErrNotFound
	}
	type provenance struct{ viaType, viaID string }
	mentioned := map[string]provenance{}
	for _, userID := range input.MentionedUserIDs {
		if _, ok := r.memberships[membershipKey(input.CompanyID, userID)]; !ok {
			return CommunicationsEmailCollaborationParticipantResult{}, ErrPrincipalNotInCompany
		}
		mentioned[userID] = provenance{CommunicationsEmailCollaborationParticipantUser, userID}
	}
	for _, groupID := range input.MentionedGroupIDs {
		groupIDs := companyUserGroupSubtreeIDsLocked(r.userGroups, input.CompanyID, groupID)
		if len(groupIDs) == 0 {
			return CommunicationsEmailCollaborationParticipantResult{}, ErrInvalid
		}
		for _, member := range r.userGroupMembers {
			if member.CompanyID == input.CompanyID && groupIDs[member.GroupID] {
				if _, explicit := mentioned[member.UserID]; !explicit {
					mentioned[member.UserID] = provenance{CommunicationsEmailCollaborationParticipantGroup, groupID}
				}
			}
		}
	}
	now := time.Now().UTC()
	mentionedUserIDs := make([]string, 0, len(mentioned))
	for userID, source := range mentioned {
		mentionedUserIDs = append(mentionedUserIDs, userID)
		participantKey := emailCollaborationParticipantKey(input.CompanyID, item.CollaborationID, userID)
		if _, exists := r.emailCollaborationParticipants[participantKey]; !exists {
			r.emailCollaborationParticipants[participantKey] = domain.CommunicationsEmailCollaborationParticipant{CompanyID: input.CompanyID, CollaborationID: item.CollaborationID, UserID: userID, AddedByUserID: input.ActorUserID, AddedViaType: source.viaType, AddedViaID: source.viaID, CreatedTimestamp: now}
		}
		if err := r.grantCollaborationNodeEditLocked(input.CompanyID, item.NodeID, userID, now); err != nil {
			return CommunicationsEmailCollaborationParticipantResult{}, err
		}
	}
	sort.Strings(mentionedUserIDs)
	return CommunicationsEmailCollaborationParticipantResult{CollaborationID: item.CollaborationID, NodeID: item.NodeID, Participants: r.collaborationParticipantsLocked(input.CompanyID, item.CollaborationID), MentionedUserIDs: mentionedUserIDs}, nil
}

func (r *MemoryRepo) UpdateCommunicationsEmailCollaborationMessage(input CommunicationsEmailCollaborationMessageInput) ([]string, error) {
	accountEmail := input.PersonalAccountEmail
	if strings.TrimSpace(input.SharedInboxID) != "" {
		accountEmail = "shared@scope.invalid"
	}
	companyID, scope, err := normalizeCommunicationsEmailCollaborationScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID, accountEmail)
	if err != nil {
		return nil, err
	}
	message := normalizeEmailMessageSnapshot(input.Message)
	if message.ID == "" {
		return nil, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.findCollaborationLocked(companyID, scope, message.ID, message.ThreadID)
	if !ok {
		return []string{}, nil
	}
	if shouldAdvanceEmailCollaborationMessage(item.Message, message) {
		message = mergeEmailMessageSnapshot(item.Message, message)
		item.Message, item.LatestMessageID = message, message.ID
		if item.ProviderThreadID == "" {
			item.ProviderThreadID = message.ThreadID
		}
		item.UpdatedTimestamp = time.Now().UTC()
		r.emailCollaborations[key(companyID, item.CollaborationID)] = item
	}
	participants := r.collaborationParticipantsLocked(companyID, item.CollaborationID)
	userIDs := make([]string, 0, len(participants))
	for _, participant := range participants {
		userIDs = append(userIDs, participant.UserID)
	}
	return userIDs, nil
}
