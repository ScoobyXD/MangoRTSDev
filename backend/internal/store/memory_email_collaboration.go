package store

import (
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

func (r *MemoryRepo) EnsureCommunicationsEmailCollaboration(input CommunicationsEmailCollaborationEnsureInput) (CommunicationsEmailCollaborationEnsureResult, error) {
	input, scope, err := normalizeCommunicationsEmailCollaborationEnsureInput(input)
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	beforeNodes := maps.Clone(r.nodes)
	beforeNodeText := maps.Clone(r.nodeText)
	beforeNodeInfo := maps.Clone(r.nodeInfo)
	beforeFolders := maps.Clone(r.folders)
	beforeFolderItems := maps.Clone(r.folderItems)
	beforeExplorerEntities := maps.Clone(r.companyExplorerV2Entities)
	beforeExplorerEdges := maps.Clone(r.companyExplorerV2Edges)
	beforeDefaultFolderSeed := maps.Clone(r.defaultFolderSeed)
	beforeCollaborations := maps.Clone(r.emailCollaborations)
	beforeParticipants := maps.Clone(r.emailCollaborationParticipants)
	beforeEmailThreads := maps.Clone(r.emailThreads)
	beforeEmailThreadScopeIDs := maps.Clone(r.emailThreadScopeIDs)
	beforeEmailThreadDownloadJobs := maps.Clone(r.emailThreadDownloadJobs)
	beforeNodeEmailThreads := maps.Clone(r.nodeEmailThreads)
	beforePermissions := maps.Clone(r.entityPermissions)
	beforeEffectiveAccess := maps.Clone(r.effectiveAccess)
	beforeGVICAssignments := maps.Clone(r.gvicAssignments)
	beforeGVICEffectiveAssignments := maps.Clone(r.gvicEffectiveAssignments)
	beforeGVICMatrixProjectionRows := maps.Clone(r.GVICMatrixProjectionRows)
	beforeGVICPolicyRevisions := maps.Clone(r.gvicPolicyRevisions)
	beforePermissionRevisions := maps.Clone(r.resourcePermissionRevisions)
	beforeWorkspaceReadVersions := maps.Clone(r.workspaceReadVersions)
	beforeResourcePolicySequence := r.resourcePolicySequence
	restore := func() {
		r.nodes, r.nodeText, r.nodeInfo = beforeNodes, beforeNodeText, beforeNodeInfo
		r.folders, r.folderItems = beforeFolders, beforeFolderItems
		r.companyExplorerV2Entities, r.companyExplorerV2Edges = beforeExplorerEntities, beforeExplorerEdges
		r.defaultFolderSeed = beforeDefaultFolderSeed
		r.emailCollaborations, r.emailCollaborationParticipants = beforeCollaborations, beforeParticipants
		r.emailThreads = beforeEmailThreads
		r.emailThreadScopeIDs = beforeEmailThreadScopeIDs
		r.nodeEmailThreads = beforeNodeEmailThreads
		r.emailThreadDownloadJobs = beforeEmailThreadDownloadJobs
		r.entityPermissions, r.effectiveAccess = beforePermissions, beforeEffectiveAccess
		r.gvicAssignments, r.gvicEffectiveAssignments = beforeGVICAssignments, beforeGVICEffectiveAssignments
		r.GVICMatrixProjectionRows, r.gvicPolicyRevisions = beforeGVICMatrixProjectionRows, beforeGVICPolicyRevisions
		r.resourcePermissionRevisions, r.workspaceReadVersions = beforePermissionRevisions, beforeWorkspaceReadVersions
		r.resourcePolicySequence = beforeResourcePolicySequence
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
		RequestDownload: true, RequestedByUserID: input.CreatedByUserID,
	}
	thread, err := r.upsertCommunicationsEmailThreadLocked(threadInput)
	if err != nil {
		restore()
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	if existing, ok := r.findCollaborationLocked(input.CompanyID, scope, input.Message.ID, input.Message.ThreadID); ok {
		existing = r.reconcileEnsuredEmailCollaborationLocked(existing, input)
		existing.EmailThreadID = thread.EmailThreadID
		existing.Provider = thread.Provider
		r.emailCollaborations[key(existing.CompanyID, existing.CollaborationID)] = existing
		if downloadScope, requestedMessageID, ok := communicationsEmailThreadDownloadRequest(thread, threadInput); ok {
			if _, _, err := r.ensureCommunicationsEmailThreadDownloadJobLocked(input.CompanyID, thread.EmailThreadID, downloadScope, requestedMessageID, input.CreatedByUserID); err != nil {
				restore()
				return CommunicationsEmailCollaborationEnsureResult{}, err
			}
		}
		information := communicationsEmailAttachedProjectionPayloadWithThread(existing.AttachedEmailInformationID, existing.CollaborationID, thread.EmailThreadID, input)
		projectionKey := key(input.CompanyID, existing.NodeID)
		if projection, ok := r.nodeText[projectionKey][existing.AttachedEmailInformationID]; ok {
			projection.Information = information
			projection.UpdatedTimestamp = time.Now().UTC()
			r.nodeText[projectionKey][existing.AttachedEmailInformationID] = projection
		}
		for index := range r.nodeInfo[projectionKey] {
			if r.nodeInfo[projectionKey][index].InformationID == existing.AttachedEmailInformationID {
				r.nodeInfo[projectionKey][index].Information = information
				r.nodeInfo[projectionKey][index].UpdatedTimestamp = time.Now().UTC()
			}
		}
		return CommunicationsEmailCollaborationEnsureResult{Collaboration: r.withCollaborationParticipantsLocked(existing)}, nil
	}

	now := time.Now().UTC()
	node, err := r.createNodeLocked(input.CompanyID, communicationsEmailCollaborationTitle(input.Message))
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	node.DefaultAccess = ResourceDefaultAccessNoAccess
	if input.Priority != nil {
		priority := *input.Priority
		node.Priority = &priority
	}
	r.nodes[key(input.CompanyID, node.NodeID)] = node
	informationID, collaborationID := newUUIDv7String(), newUUIDv7String()
	information := communicationsEmailAttachedProjectionPayloadWithThread(informationID, collaborationID, thread.EmailThreadID, input)
	projection := domain.NodeProjection{CompanyID: input.CompanyID, NodeID: node.NodeID, InformationID: informationID, Type: "Attached email", Information: information, CreatedTimestamp: now, UpdatedTimestamp: now}
	r.nodeText[key(input.CompanyID, node.NodeID)] = map[string]domain.NodeProjection{informationID: projection}
	r.nodeInfo[key(input.CompanyID, node.NodeID)] = []domain.NodeInformation{{CompanyID: input.CompanyID, NodeID: node.NodeID, InformationID: informationID, Type: "Attached email", Information: information, CreatedTimestamp: now, UpdatedTimestamp: now}}
	r.ensureCompanyExplorerDefaultFoldersLocked(input.CompanyID)
	r.ensureCompanyExplorerV2NativeEntityLocked(input.CompanyID, CompanyExplorerV2EntityNode, node.NodeID, node.Title, now, now)
	if !r.placeEmailCollaborationNodeInDefaultFolderLocked(input.CompanyID, node.NodeID) {
		restore()
		return CommunicationsEmailCollaborationEnsureResult{}, ErrInvalid
	}
	internalMessageID := internalEmailMessageIDForProvider(thread, input.Message.ID)
	input.Message.EmailMessageID = internalMessageID
	item := domain.CommunicationsEmailCollaboration{
		CompanyID: input.CompanyID, CollaborationID: collaborationID, NodeID: node.NodeID,
		AttachedEmailInformationID: informationID, ScopeType: scope.scopeType,
		PersonalUserID: scope.personalUserID, PersonalAccountEmail: scope.personalAccountEmail,
		SharedInboxID: scope.sharedInboxID, AccountEmail: scope.accountEmail, Provider: thread.Provider,
		ProviderThreadID: input.Message.ThreadID, RootMessageID: internalMessageID,
		LatestMessageID: internalMessageID, Message: input.Message, CreatedByUserID: input.CreatedByUserID,
		EmailThreadID:    thread.EmailThreadID,
		CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	r.emailCollaborations[key(input.CompanyID, item.CollaborationID)] = item
	r.linkCommunicationsEmailThreadToNodeLocked(input.CompanyID, node.NodeID, informationID, thread.EmailThreadID, input.Message.ID, input.CreatedByUserID, now)
	if downloadScope, requestedMessageID, ok := communicationsEmailThreadDownloadRequest(thread, threadInput); ok {
		if _, _, err := r.ensureCommunicationsEmailThreadDownloadJobLocked(input.CompanyID, thread.EmailThreadID, downloadScope, requestedMessageID, input.CreatedByUserID); err != nil {
			restore()
			return CommunicationsEmailCollaborationEnsureResult{}, err
		}
	}

	if err := r.grantCollaborationNodeEditLocked(input.CompanyID, node.NodeID, input.CreatedByUserID, now); err != nil {
		restore()
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	gvicKey := resourceGVICKey{companyID: input.CompanyID, resourceType: EntityTypeNode, resourceID: node.NodeID}
	gvicAssignment := r.resourceGVICAssignmentForPrincipalLocked(gvicKey, normalizedGVICAssignmentInput{
		role: domain.GVICRoleGenerated, principalType: EntityPermissionSubjectUser, principalID: input.CreatedByUserID,
	}, now)
	r.gvicAssignments[gvicSourceAssignmentKey(gvicAssignment.CompanyID, gvicAssignment.ResourceType, gvicAssignment.ResourceID, gvicAssignment.Role, gvicAssignment.PrincipalType, gvicAssignment.PrincipalID)] = gvicAssignment
	r.setDirectGVICPolicySequenceLocked(input.CompanyID, EntityTypeNode, node.NodeID, r.nextResourcePolicySequenceLocked())
	r.syncGVICResourceKeysLocked(input.CompanyID, []resourceGVICKey{gvicKey})
	r.bumpNodeViewVersionLocked(input.CompanyID, node.NodeID)
	if _, err := r.appendDomainEventLocked(workspaceDomainEventInput(input.CompanyID, "node_created", map[string]any{
		"node_id": node.NodeID, "email_collaboration_id": item.CollaborationID,
	})); err != nil {
		restore()
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
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
	if !r.userHasEffectiveAccessLocked(input.CompanyID, input.ParticipantUserID, EntityTypeNode, item.NodeID, EntityPermissionEdit) {
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
