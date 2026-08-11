package store

import (
	"context"
	"maps"
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
	item, ok := r.emailCollaborations[key(companyID, collaborationID)]
	if !ok {
		return nil
	}
	items := []domain.CommunicationsEmailCollaborationParticipant{}
	for _, membership := range r.memberships {
		if membership.CompanyID != companyID || !r.userHasEffectiveAccessLocked(companyID, membership.UserID, EntityTypeNode, item.NodeID, EntityPermissionEdit) {
			continue
		}
		items = append(items, domain.CommunicationsEmailCollaborationParticipant{
			CompanyID: companyID, CollaborationID: collaborationID, UserID: membership.UserID,
			AddedViaType: "permission", CreatedTimestamp: item.CreatedTimestamp,
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UserID < items[j].UserID })
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
	for _, item := range r.emailCollaborations {
		if item.CompanyID == companyID && collaborationScopeMatches(item, scope) && collaborationMessageIdentifierMatches(item, messageID) {
			return item, true
		}
	}
	threadID = strings.TrimSpace(threadID)
	if threadID != "" {
		for _, item := range r.emailCollaborations {
			if item.CompanyID == companyID && collaborationScopeMatches(item, scope) && item.ProviderThreadID == threadID {
				return item, true
			}
		}
	}
	return domain.CommunicationsEmailCollaboration{}, false
}
func (r *MemoryRepo) findCollaborationForRequestedNodeLocked(companyID string, scope communicationsEmailCollaborationScope, messageID, threadID, nodeID string) (domain.CommunicationsEmailCollaboration, bool) {
	nodeID = strings.TrimSpace(nodeID)
	for _, item := range r.emailCollaborations {
		if item.CompanyID != companyID || item.NodeID != nodeID || !collaborationScopeMatches(item, scope) {
			continue
		}
		if collaborationMessageIdentifierMatches(item, messageID) {
			return item, true
		}
	}
	return domain.CommunicationsEmailCollaboration{}, false
}

func internalEmailMessageIDForProvider(thread domain.CommunicationsEmailThread, providerMessageID string) string {
	providerMessageID = strings.TrimSpace(providerMessageID)
	for _, message := range thread.Messages {
		if message.ProviderMessageID == providerMessageID {
			return message.EmailMessageID
		}
	}
	return ""
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

func (r *MemoryRepo) EnsureCommunicationsEmailCollaboration(ctx context.Context, input CommunicationsEmailCollaborationEnsureInput) (CommunicationsEmailCollaborationEnsureResult, error) {
	if err := ctx.Err(); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	input, scope, err := normalizeCommunicationsEmailCollaborationEnsureInput(input)
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	beforeNodes := maps.Clone(r.nodes)
	beforeNodeText := maps.Clone(r.nodeText)
	beforeNodeInfo := maps.Clone(r.nodeInfo)
	beforeCollaborations := maps.Clone(r.emailCollaborations)
	beforeParticipants := maps.Clone(r.emailCollaborationParticipants)
	beforeEmailThreads := maps.Clone(r.emailThreads)
	beforeEmailThreadScopeIDs := maps.Clone(r.emailThreadScopeIDs)
	beforeEmailIngestionJobs := maps.Clone(r.emailIngestionJobs)
	beforeNodeEmailThreads := maps.Clone(r.nodeEmailThreads)
	beforePermissions := maps.Clone(r.entityPermissions)
	beforeEffectiveAccess := maps.Clone(r.effectiveAccess)
	beforeRACIAssignments := maps.Clone(r.gvicAssignments)
	beforeRACIMatrixProjectionRows := maps.Clone(r.RACIMatrixProjectionRows)
	beforeRACIV2Settings := maps.Clone(r.gvicV2Settings)
	beforePermissionV2Settings := maps.Clone(r.permissionV2Settings)
	beforeRACIV2Sequence := r.gvicV2Sequence
	beforePermissionV2Sequence := r.permissionV2Sequence
	beforeWorkspaceReadVersions := maps.Clone(r.workspaceReadVersions)
	restore := func() {
		r.nodes, r.nodeText, r.nodeInfo = beforeNodes, beforeNodeText, beforeNodeInfo
		r.emailCollaborations, r.emailCollaborationParticipants = beforeCollaborations, beforeParticipants
		r.emailThreads = beforeEmailThreads
		r.emailThreadScopeIDs = beforeEmailThreadScopeIDs
		r.nodeEmailThreads = beforeNodeEmailThreads
		r.emailIngestionJobs = beforeEmailIngestionJobs
		r.entityPermissions, r.effectiveAccess = beforePermissions, beforeEffectiveAccess
		r.gvicAssignments = beforeRACIAssignments
		r.RACIMatrixProjectionRows = beforeRACIMatrixProjectionRows
		r.gvicV2Settings, r.permissionV2Settings = beforeRACIV2Settings, beforePermissionV2Settings
		r.gvicV2Sequence, r.permissionV2Sequence, r.workspaceReadVersions = beforeRACIV2Sequence, beforePermissionV2Sequence, beforeWorkspaceReadVersions
	}
	if _, ok := r.companies[input.CompanyID]; !ok {
		return CommunicationsEmailCollaborationEnsureResult{}, ErrNotFound
	}
	if _, ok := r.memberships[membershipKey(input.CompanyID, input.CreatedByUserID)]; !ok {
		return CommunicationsEmailCollaborationEnsureResult{}, ErrPrincipalNotInCompany
	}
	threadInput := CommunicationsEmailThreadUpsertInput{
		CompanyID: input.CompanyID, PersonalUserID: scope.personalUserID,
		PersonalAccountEmail: scope.personalAccountEmail, SharedInboxID: scope.sharedInboxID,
		AccountEmail: scope.accountEmail, Provider: input.Provider, ProviderThreadID: input.Message.ThreadID,
		SelectedMessageID: input.Message.ID, Messages: []domain.EmailMessageSnapshot{input.Message},
		HistoryComplete: input.Message.ThreadID == "", FetchedAt: time.Now().UTC(),
	}
	thread, err := r.upsertCommunicationsEmailThreadLocked(threadInput)
	if err != nil {
		restore()
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	now := time.Now().UTC()
	nodeID := input.TargetNodeID
	createdNode := false
	reuseExistingNode := false
	if nodeID != "" {
		if _, ok := r.nodes[key(input.CompanyID, nodeID)]; !ok || !r.userHasEffectiveAccessLocked(input.CompanyID, input.CreatedByUserID, EntityTypeNode, nodeID, EntityPermissionEdit) {
			restore()
			return CommunicationsEmailCollaborationEnsureResult{}, ErrNotFound
		}
		reuseExistingNode = true
	} else {
		nodeID = input.RequestedNodeID
		if nodeID == "" {
			if existing, ok := r.findCollaborationLocked(input.CompanyID, scope, input.Message.ID, input.Message.ThreadID); ok {
				nodeID = existing.NodeID
				reuseExistingNode = true
			}
		}
		if existing, ok := r.findCollaborationForRequestedNodeLocked(input.CompanyID, scope, input.Message.ID, "", nodeID); ok {
			nodeID = existing.NodeID
			reuseExistingNode = true
		} else {
			if nodeID != "" {
				if _, exists := r.nodes[key(input.CompanyID, nodeID)]; exists {
					if !reuseExistingNode {
						restore()
						return CommunicationsEmailCollaborationEnsureResult{}, ErrAlreadyExists
					}
				} else {
					reuseExistingNode = false
				}
			}
			if !reuseExistingNode {
				node, createErr := r.createNodeWithIDLocked(input.CompanyID, nodeID, communicationsEmailCollaborationTitle(input.Message))
				if createErr != nil {
					restore()
					return CommunicationsEmailCollaborationEnsureResult{}, createErr
				}
				node.DefaultAccess = ResourceDefaultAccessNoAccess
				if input.Priority != nil {
					priority := *input.Priority
					node.Priority = &priority
				}
				r.nodes[key(input.CompanyID, node.NodeID)] = node
				nodeID = node.NodeID
				if _, err := r.customizeNewMemoryResourcePermissionForCreatorLocked(input.CompanyID, EntityTypeNode, nodeID, input.CreatedByUserID); err != nil {
					restore()
					return CommunicationsEmailCollaborationEnsureResult{}, err
				}
				if _, err := r.customizeNewMemoryResourceRACIForCreatorLocked(input.CompanyID, EntityTypeNode, nodeID, domain.RACIRoleResponsible, input.CreatedByUserID); err != nil {
					restore()
					return CommunicationsEmailCollaborationEnsureResult{}, err
				}
				createdNode = true
			}
		}
	}
	existing, ok := r.findCollaborationForRequestedNodeLocked(input.CompanyID, scope, input.Message.ID, "", nodeID)
	informationID, collaborationID := newUUIDv7String(), newUUIDv7String()
	internalMessageID := internalEmailMessageIDForProvider(thread, input.Message.ID)
	input.Message.EmailMessageID = internalMessageID
	var item domain.CommunicationsEmailCollaboration
	if ok {
		existing = r.reconcileEnsuredEmailCollaborationLocked(existing, input)
		existing.EmailThreadID = thread.EmailThreadID
		existing.Provider = thread.Provider
		r.emailCollaborations[key(existing.CompanyID, existing.CollaborationID)] = existing
		informationID, collaborationID = existing.AttachedEmailInformationID, existing.CollaborationID
		item = existing
	} else {
		information := communicationsEmailAttachedProjectionPayloadWithThread(informationID, collaborationID, thread.EmailThreadID, input)
		projectionKey := key(input.CompanyID, nodeID)
		if r.nodeText[projectionKey] == nil {
			r.nodeText[projectionKey] = map[string]domain.NodeProjection{}
		}
		r.nodeText[projectionKey][informationID] = domain.NodeProjection{CompanyID: input.CompanyID, NodeID: nodeID, InformationID: informationID, Type: "Attached email", Information: information, CreatedTimestamp: now, UpdatedTimestamp: now}
		r.nodeInfo[projectionKey] = append(r.nodeInfo[projectionKey], domain.NodeInformation{CompanyID: input.CompanyID, NodeID: nodeID, InformationID: informationID, Type: "Attached email", Information: information, CreatedTimestamp: now, UpdatedTimestamp: now})
		item = domain.CommunicationsEmailCollaboration{
			CompanyID: input.CompanyID, CollaborationID: collaborationID, NodeID: nodeID,
			AttachedEmailInformationID: informationID, ScopeType: scope.scopeType,
			PersonalUserID: scope.personalUserID, PersonalAccountEmail: scope.personalAccountEmail,
			SharedInboxID: scope.sharedInboxID, AccountEmail: scope.accountEmail, Provider: thread.Provider,
			ProviderThreadID: input.Message.ThreadID, RootMessageID: internalMessageID,
			LatestMessageID: internalMessageID, Message: input.Message, CreatedByUserID: input.CreatedByUserID,
			EmailThreadID:    thread.EmailThreadID,
			CreatedTimestamp: now, UpdatedTimestamp: now,
		}
		r.emailCollaborations[key(input.CompanyID, item.CollaborationID)] = item
	}
	if _, err := r.linkCommunicationsEmailThreadToNodeLocked(input.CompanyID, nodeID, informationID, thread.EmailThreadID, input.Message.ID, input.CreatedByUserID, now); err != nil {
		restore()
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	if input.LinkedTextBlock != nil {
		input.LinkedTextBlock.CompanyID, input.LinkedTextBlock.NodeID = input.CompanyID, nodeID
	}
	if input.InitialChat != nil {
		input.InitialChat.CompanyID, input.InitialChat.NodeID = input.CompanyID, nodeID
		mentionedUserIDs, mentionedGroupIDs := CommunicationsEmailChatMentionPrincipalIDs(input.InitialChat.Information)
		if _, err := r.addCollaborationParticipantsLocked(CommunicationsEmailCollaborationParticipantInput{
			CompanyID: input.CompanyID, CollaborationID: collaborationID, ActorUserID: input.CreatedByUserID,
			MentionedUserIDs: mentionedUserIDs, MentionedGroupIDs: mentionedGroupIDs,
		}); err != nil {
			restore()
			return CommunicationsEmailCollaborationEnsureResult{}, err
		}
	}
	if input.LinkedTextBlock != nil || input.InitialChat != nil {
		writeInput := communicationsEmailTextBoxChatWriteInput{
			CompanyID: input.CompanyID, UserID: input.CreatedByUserID, SharedInboxID: input.SharedInboxID,
			AccountEmail: input.AccountEmail, NodeID: nodeID, ProviderMessageID: input.Message.ID,
			ExistingTextBoxID: input.TargetTextboxID,
			LinkedTextBlock:   input.LinkedTextBlock, InitialChat: input.InitialChat,
		}
		if err := r.addCommunicationsEmailTextBoxChatWritesLocked(writeInput, &CommunicationsTriageConversionResult{}); err != nil {
			restore()
			return CommunicationsEmailCollaborationEnsureResult{}, err
		}
	}
	r.bumpNodeViewVersionLocked(input.CompanyID, nodeID)
	if createdNode {
		if _, err := r.appendDomainEventLocked(workspaceDomainEventInput(input.CompanyID, "node_created", map[string]any{
			"node_id": nodeID, "email_collaboration_id": item.CollaborationID,
		})); err != nil {
			restore()
			return CommunicationsEmailCollaborationEnsureResult{}, err
		}
	}
	return CommunicationsEmailCollaborationEnsureResult{Collaboration: r.withCollaborationParticipantsLocked(item), Created: createdNode}, nil
}

func (r *MemoryRepo) grantCollaborationNodeEditLocked(companyID, nodeID, userID string, now time.Time) error {
	if _, ok := r.memberships[membershipKey(companyID, userID)]; !ok {
		return ErrPrincipalNotInCompany
	}
	node, ok := r.nodes[key(companyID, nodeID)]
	if !ok {
		return ErrNotFound
	}
	_ = node
	if !r.ensureV2PolicySettingsLocked(companyID, EntityTypeNode, nodeID) {
		return ErrNotFound
	}
	resolved := r.resolveV2PolicyLocked(companyID, EntityTypeNode, nodeID, false)
	sourceType, sourceID := EntityTypeNode, nodeID
	if resolved.SourceID != "" && (resolved.SourceType != EntityTypeNode || resolved.SourceID != nodeID || resolved.OverwrittenBy != nil) {
		sourceType, sourceID = resolved.SourceType, resolved.SourceID
	}
	sourceSetting := r.permissionV2Settings[resourcePolicyKey(companyID, sourceType, sourceID)]
	permissions := r.directMemoryPermissionEdgesLocked(companyID, sourceType, sourceID)
	settingKey := resourcePolicyKey(companyID, EntityTypeNode, nodeID)
	setting := r.permissionV2Settings[settingKey]
	setting.Mode = PolicyModeCustomized
	setting.DefaultAccess = sourceSetting.DefaultAccess
	setting.CustomizedSequence = r.nextPermissionV2SequenceLocked()
	r.permissionV2Settings[settingKey] = setting
	replaced := false
	for index := range permissions {
		if permissions[index].SubjectType == EntityPermissionSubjectUser && permissions[index].SubjectID == userID {
			permissions[index].AccessLevel, permissions[index].Permission = EntityPermissionEdit, EntityPermissionEdit
			replaced = true
		}
	}
	if !replaced {
		permissions = append(permissions, domain.EntityPermission{SubjectType: EntityPermissionSubjectUser, SubjectID: userID, AccessLevel: EntityPermissionEdit, Permission: EntityPermissionEdit, CreatedTimestamp: now})
	}
	r.replaceMemoryPermissionEdgesLocked(companyID, EntityTypeNode, nodeID, permissions)
	return nil
}

func (r *MemoryRepo) ListCommunicationsEmailCollaborations(input CommunicationsEmailCollaborationListInput) ([]domain.CommunicationsEmailCollaboration, error) {
	input, scope, err := normalizeCommunicationsEmailCollaborationListInput(input)
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	threadID := strings.TrimSpace(input.ThreadID)
	byNode := map[string]domain.CommunicationsEmailCollaboration{}
	for _, item := range r.emailCollaborations {
		if item.CompanyID != input.CompanyID || !collaborationScopeMatches(item, scope) {
			continue
		}
		matches := (threadID != "" && item.ProviderThreadID == threadID) || collaborationMessageIdentifierMatches(item, input.MessageID)
		if !matches {
			continue
		}
		if !r.userHasEffectiveAccessLocked(input.CompanyID, input.ParticipantUserID, EntityTypeNode, item.NodeID, EntityPermissionEdit) {
			continue
		}
		current, exists := byNode[item.NodeID]
		itemIsExact := collaborationMessageIdentifierMatches(item, input.MessageID)
		currentIsExact := collaborationMessageIdentifierMatches(current, input.MessageID)
		if !exists || (itemIsExact && !currentIsExact) || (itemIsExact == currentIsExact && item.CreatedTimestamp.After(current.CreatedTimestamp)) {
			byNode[item.NodeID] = item
		}
	}
	items := make([]domain.CommunicationsEmailCollaboration, 0, len(byNode))
	for _, item := range byNode {
		items = append(items, r.withCollaborationParticipantsLocked(item))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CollaborationID < items[j].CollaborationID
		}
		return items[i].CreatedTimestamp.After(items[j].CreatedTimestamp)
	})
	return items, nil
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
	if !r.userHasEffectiveAccessLocked(companyID, participantUserID, EntityTypeNode, item.NodeID, EntityPermissionEdit) {
		return domain.CommunicationsEmailCollaboration{}, ErrNotFound
	}
	return r.withCollaborationParticipantsLocked(item), nil
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
	if !ok || !r.userHasEffectiveAccessLocked(input.CompanyID, input.ActorUserID, EntityTypeNode, item.NodeID, EntityPermissionEdit) {
		return CommunicationsEmailCollaborationParticipantResult{}, ErrNotFound
	}
	mentioned := map[string]bool{}
	for _, userID := range input.MentionedUserIDs {
		if _, ok := r.memberships[membershipKey(input.CompanyID, userID)]; !ok {
			return CommunicationsEmailCollaborationParticipantResult{}, ErrPrincipalNotInCompany
		}
		mentioned[userID] = true
	}
	for _, groupID := range input.MentionedGroupIDs {
		groupIDs := companyUserGroupSubtreeIDsLocked(r.userGroups, input.CompanyID, groupID)
		if len(groupIDs) == 0 {
			return CommunicationsEmailCollaborationParticipantResult{}, ErrInvalid
		}
		for _, member := range r.userGroupMembers {
			if member.CompanyID == input.CompanyID && groupIDs[member.GroupID] {
				mentioned[member.UserID] = true
			}
		}
	}
	now := time.Now().UTC()
	mentionedUserIDs := make([]string, 0, len(mentioned))
	for userID := range mentioned {
		mentionedUserIDs = append(mentionedUserIDs, userID)
		if err := r.grantCollaborationNodeEditLocked(input.CompanyID, item.NodeID, userID, now); err != nil {
			return CommunicationsEmailCollaborationParticipantResult{}, err
		}
	}
	sort.Strings(mentionedUserIDs)
	return CommunicationsEmailCollaborationParticipantResult{
		CollaborationID: item.CollaborationID, NodeID: item.NodeID,
		Participants:     r.collaborationParticipantsLocked(input.CompanyID, item.CollaborationID),
		MentionedUserIDs: mentionedUserIDs,
	}, nil
}
