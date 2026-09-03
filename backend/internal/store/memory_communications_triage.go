package store

import (
	"context"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

type communicationsEmailNodeLink struct {
	CompanyID        string
	UserID           string
	SharedInboxID    string
	AccountEmail     string
	MessageID        string
	NodeID           string
	LogicGateID      string
	Message          domain.EmailMessageSnapshot
	CreatedTimestamp time.Time
	UpdatedTimestamp time.Time
}

type memoryCommunicationsTriageConversionSnapshot struct {
	triageItems                    map[string]domain.CommunicationsTriageItem
	logicGates                     map[string]domain.LogicGate
	nodes                          map[string]domain.Node
	nodeInfo                       map[string][]domain.NodeInformation
	nodeText                       map[string]map[string]domain.NodeProjection
	folders                        map[string]domain.CompanyExplorerFolder
	folderItems                    map[string]domain.CompanyExplorerFolderItem
	defaultFolderSeed              map[string]bool
	nodeLogicGateAssignments       map[string]domain.NodeLogicGateAssignment
	emailNodeLinks                 map[string]communicationsEmailNodeLink
	domainEvents                   map[string]domain.DomainEvent
	nodeCompletionTransitions      map[string]time.Time
	projectRelationships           map[string]domain.ProjectRelationship
	projectRelationshipProjection  map[string]domain.ProjectRelationshipProjection
	companyExplorerV2Entities      map[string]memoryCompanyExplorerV2Entity
	companyExplorerV2Edges         map[string]memoryCompanyExplorerV2Edge
	emailThreads                   map[string]domain.CommunicationsEmailThread
	emailThreadScopeIDs            map[string]string
	nodeEmailThreads               map[string]domain.CommunicationsNodeEmailThread
	projectEmailRelationships      map[string]memoryProjectEmailRelationship
	emailCollaborationParticipants map[string]domain.CommunicationsEmailCollaborationParticipant
	entityPermissions              map[string]domain.EntityPermission
	effectiveAccess                map[string]domain.EffectiveResourceAccess
	realtimeOutbox                 map[string]RealtimeOutboxEvent
	realtimeOutboxSequence         int64
	workspaceReadVersions          map[string]int64
	gvicAssignments                map[string]domain.ResourceRACIAssignment
	gvicEffectiveAssignments       map[string]domain.ResourceRACIEffectiveAssignment
	gvicPolicyRevisions            map[string]int64
	resourcePermissionRevisions    map[string]int64
	resourcePolicySequence         int64
}

func (r *MemoryRepo) snapshotCommunicationsTriageConversionStateLocked() memoryCommunicationsTriageConversionSnapshot {
	return memoryCommunicationsTriageConversionSnapshot{
		triageItems:                    cloneMemoryMap(r.triageItems),
		logicGates:                     cloneMemoryMap(r.logicGates),
		nodes:                          cloneMemoryMap(r.nodes),
		nodeInfo:                       cloneMemorySliceMap(r.nodeInfo),
		nodeText:                       cloneMemoryNodeText(r.nodeText),
		folders:                        cloneMemoryMap(r.folders),
		folderItems:                    cloneMemoryMap(r.folderItems),
		defaultFolderSeed:              cloneMemoryMap(r.defaultFolderSeed),
		nodeLogicGateAssignments:       cloneMemoryMap(r.nodeLogicGateAssignments),
		emailNodeLinks:                 cloneMemoryMap(r.emailNodeLinks),
		domainEvents:                   cloneMemoryMap(r.domainEvents),
		nodeCompletionTransitions:      cloneMemoryMap(r.nodeCompletionTransitions),
		projectRelationships:           cloneMemoryMap(r.projectRelationships),
		projectRelationshipProjection:  cloneMemoryMap(r.projectRelationshipProjection),
		companyExplorerV2Entities:      cloneMemoryMap(r.companyExplorerV2Entities),
		companyExplorerV2Edges:         cloneMemoryMap(r.companyExplorerV2Edges),
		emailThreads:                   cloneCommunicationsEmailThreadsMap(r.emailThreads),
		emailThreadScopeIDs:            cloneMemoryMap(r.emailThreadScopeIDs),
		nodeEmailThreads:               cloneMemoryMap(r.nodeEmailThreads),
		projectEmailRelationships:      cloneMemoryProjectEmailRelationships(r.projectEmailRelationships),
		emailCollaborationParticipants: cloneMemoryMap(r.emailCollaborationParticipants),
		entityPermissions:              cloneMemoryMap(r.entityPermissions),
		effectiveAccess:                cloneMemoryMap(r.effectiveAccess),
		realtimeOutbox:                 cloneMemoryMap(r.realtimeOutbox),
		realtimeOutboxSequence:         r.realtimeOutboxSequence,
		workspaceReadVersions:          cloneMemoryMap(r.workspaceReadVersions),
		gvicAssignments:                cloneMemoryMap(r.gvicAssignments),
		gvicEffectiveAssignments:       cloneMemoryMap(r.gvicEffectiveAssignments),
		gvicPolicyRevisions:            cloneMemoryMap(r.gvicPolicyRevisions),
		resourcePermissionRevisions:    cloneMemoryMap(r.resourcePermissionRevisions),
		resourcePolicySequence:         r.resourcePolicySequence,
	}
}

func (r *MemoryRepo) restoreCommunicationsTriageConversionStateLocked(snapshot memoryCommunicationsTriageConversionSnapshot) {
	r.triageItems = snapshot.triageItems
	r.logicGates = snapshot.logicGates
	r.nodes = snapshot.nodes
	r.nodeInfo = snapshot.nodeInfo
	r.nodeText = snapshot.nodeText
	r.folders = snapshot.folders
	r.folderItems = snapshot.folderItems
	r.defaultFolderSeed = snapshot.defaultFolderSeed
	r.nodeLogicGateAssignments = snapshot.nodeLogicGateAssignments
	r.emailNodeLinks = snapshot.emailNodeLinks
	r.domainEvents = snapshot.domainEvents
	r.nodeCompletionTransitions = snapshot.nodeCompletionTransitions
	r.projectRelationships = snapshot.projectRelationships
	r.projectRelationshipProjection = snapshot.projectRelationshipProjection
	r.companyExplorerV2Entities = snapshot.companyExplorerV2Entities
	r.companyExplorerV2Edges = snapshot.companyExplorerV2Edges
	r.emailThreads = snapshot.emailThreads
	r.emailThreadScopeIDs = snapshot.emailThreadScopeIDs
	r.nodeEmailThreads = snapshot.nodeEmailThreads
	r.projectEmailRelationships = snapshot.projectEmailRelationships
	r.emailCollaborationParticipants = snapshot.emailCollaborationParticipants
	r.entityPermissions = snapshot.entityPermissions
	r.effectiveAccess = snapshot.effectiveAccess
	r.realtimeOutbox = snapshot.realtimeOutbox
	r.realtimeOutboxSequence = snapshot.realtimeOutboxSequence
	r.workspaceReadVersions = snapshot.workspaceReadVersions
	r.gvicAssignments = snapshot.gvicAssignments
	r.gvicEffectiveAssignments = snapshot.gvicEffectiveAssignments
	r.gvicPolicyRevisions = snapshot.gvicPolicyRevisions
	r.resourcePermissionRevisions = snapshot.resourcePermissionRevisions
	r.resourcePolicySequence = snapshot.resourcePolicySequence
}

func (r *MemoryRepo) UpsertCommunicationsTriageItem(userID string, message domain.EmailMessageSnapshot) (domain.CommunicationsTriageItem, error) {
	userID = strings.TrimSpace(userID)
	message = normalizeEmailMessageSnapshot(message)
	if userID == "" || message.ID == "" {
		return domain.CommunicationsTriageItem{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.userIDExistsLocked(userID) {
		return domain.CommunicationsTriageItem{}, ErrNotFound
	}
	now := time.Now().UTC()
	k := triageItemKey(userID, message.ID)
	created := now
	if existing, ok := r.triageItems[k]; ok {
		created = existing.CreatedTimestamp
	}
	item := domain.CommunicationsTriageItem{
		UserID:           userID,
		MessageID:        message.ID,
		Message:          message,
		CreatedTimestamp: created,
		UpdatedTimestamp: now,
	}
	r.triageItems[k] = item
	return item, nil
}

func (r *MemoryRepo) ConvertCommunicationsTriageItems(ctx context.Context, input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error) {
	if err := ctx.Err(); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	input, err := NormalizeCommunicationsTriageConversionInput(input)
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotCommunicationsTriageConversionStateLocked()
	committed := false
	defer func() {
		if !committed {
			r.restoreCommunicationsTriageConversionStateLocked(snapshot)
		}
	}()

	if input.Target.Mode == CommunicationsEmailConversionTargetExistingNode {
		result, err := r.attachCommunicationsTriageItemsToExistingNodeLocked(input)
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		events, err := r.appendDomainEventsLocked(communicationsEmailConversionWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.Events = events
		committed = true
		return result, nil
	}
	if input.Target.Mode == CommunicationsEmailConversionTargetProject {
		result, err := r.convertCommunicationsTriageItemsToExplorerTargetLocked(input)
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		events, err := r.appendDomainEventsLocked(communicationsEmailConversionWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.Events = events
		committed = true
		return result, nil
	}
	logicGate := domain.LogicGate{}
	createdLogicGate := false
	switch input.Target.Mode {
	case CommunicationsEmailConversionTargetExistingLogicGate:
		var ok bool
		logicGate, ok = r.logicGates[key(input.CompanyID, input.LogicGateID)]
		if !ok {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
	case CommunicationsEmailConversionTargetNewLogicGate:
		now := time.Now().UTC()
		logicGate = domain.LogicGate{
			CompanyID:        input.CompanyID,
			LogicGateID:      newUUIDv7String(),
			Header:           input.NewLogicGateHeader,
			CreatedTimestamp: now,
		}
		r.logicGates[key(input.CompanyID, logicGate.LogicGateID)] = logicGate
		input.LogicGateID = logicGate.LogicGateID
		input.Target.LogicGateID = logicGate.LogicGateID
		createdLogicGate = true
	default:
		return CommunicationsTriageConversionResult{}, ErrInvalid
	}
	input.Target.Header = logicGate.Header
	if input.Target.ProjectID != "" {
		if _, ok := r.projects[key(input.CompanyID, input.Target.ProjectID)]; !ok {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
	}

	if !r.processStepBelongsLocked(input.CompanyID, input.LogicGateID, input.ProcessStepID) {
		return CommunicationsTriageConversionResult{}, ErrInvalid
	}
	now := time.Now().UTC()
	nextPosition := r.nextProcessWorkPositionLocked(input.CompanyID, input.LogicGateID)
	result := CommunicationsTriageConversionResult{
		Target:           input.Target,
		LogicGate:        r.withLogicGateRACILocked(logicGate),
		CreatedLogicGate: createdLogicGate,
	}
	for index, messageID := range input.MessageIDs {
		triageItem, ok := r.triageItems[triageItemKey(input.UserID, messageID)]
		if !ok {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
		nodeID := newUUIDv7String()
		node := domain.Node{
			CompanyID:        input.CompanyID,
			NodeID:           nodeID,
			Title:            emailNodeTitle(triageItem.Message),
			Priority:         cloneIntPointer(input.Priority),
			Status:           cloneStringPointer(&input.Status),
			CreatedTimestamp: now,
		}
		r.nodes[key(input.CompanyID, nodeID)] = node

		assignment := r.upsertNodeLogicGateAssignmentLocked(nodeLogicGateAssignmentMutation{
			CompanyID: input.CompanyID, NodeID: nodeID, LogicGateID: input.LogicGateID,
			ProcessStepID:     input.ProcessStepID,
			Position:          nextPosition + index*1000,
			RequestedByUserID: requestedByUserIDForLogicGateStatus(input.Status, input.ActorUserID, ""),
			PlacedByUserID:    input.ActorUserID, CreatedTimestamp: now, UpdatedTimestamp: now,
		})
		r.syncRACIMatrixProjectionForNodeLocked(input.CompanyID, nodeID)
		link := communicationsEmailNodeLink{
			CompanyID:        input.CompanyID,
			UserID:           input.UserID,
			SharedInboxID:    input.SharedInboxID,
			AccountEmail:     input.AccountEmail,
			MessageID:        messageID,
			NodeID:           nodeID,
			LogicGateID:      input.LogicGateID,
			Message:          triageItem.Message,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
		r.emailNodeLinks[emailNodeAttachmentLinkKey(input.CompanyID, input.UserID, messageID, nodeID)] = link
		emailInput := input
		emailInput.NodeID = nodeID
		informationID, emailThreadID, emailMessageID, err := r.persistCommunicationsConversionEmailLocked(emailInput, triageItem.Message, now)
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.AttachedEmailInformationIDs = append(result.AttachedEmailInformationIDs, informationID)
		result.EmailThreadIDs = append(result.EmailThreadIDs, emailThreadID)
		result.EmailMessageIDs = append(result.EmailMessageIDs, emailMessageID)
		delete(r.triageItems, triageItemKey(input.UserID, messageID))
		if input.Target.ProjectID != "" {
			relationships, err := r.upsertCommunicationsTriageProjectRelationshipLocked(input, nodeID, now)
			if err != nil {
				return CommunicationsTriageConversionResult{}, err
			}
			result.ProjectRelationships = append(result.ProjectRelationships, relationships...)
		}

		node = r.withNodeReadModelLocked(r.nodes[key(input.CompanyID, nodeID)])
		placement := domain.CommunicationsEmailPlacement{
			CompanyID:        link.CompanyID,
			UserID:           link.UserID,
			MessageID:        link.MessageID,
			NodeID:           link.NodeID,
			LogicGateID:      link.LogicGateID,
			CreatedTimestamp: link.CreatedTimestamp,
			UpdatedTimestamp: link.UpdatedTimestamp,
		}
		provenance := CommunicationsEmailConversionProvenance{
			CompanyID:   link.CompanyID,
			UserID:      link.UserID,
			MessageID:   link.MessageID,
			ThreadID:    strings.TrimSpace(triageItem.Message.ThreadID),
			NodeID:      link.NodeID,
			LogicGateID: link.LogicGateID,
		}
		result.Nodes = append(result.Nodes, node)
		result.Assignments = append(result.Assignments, assignment)
		result.EmailPlacements = append(result.EmailPlacements, placement)
		result.EmailProvenance = append(result.EmailProvenance, provenance)
		result.DeletedMessageIDs = append(result.DeletedMessageIDs, messageID)
	}
	events, err := r.appendDomainEventsLocked(communicationsEmailConversionWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	result.Events = events
	committed = true
	return result, nil
}

func (r *MemoryRepo) attachCommunicationsTriageItemsToStandaloneNodeLocked(input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error) {
	node, ok := r.nodes[key(input.CompanyID, input.NodeID)]
	if !ok {
		return CommunicationsTriageConversionResult{}, ErrNotFound
	}
	if input.PrioritySet {
		node.Priority = cloneIntPointer(input.Priority)
	}
	r.nodes[key(input.CompanyID, input.NodeID)] = node

	now := time.Now().UTC()
	result := CommunicationsTriageConversionResult{Target: input.Target}
	for _, messageID := range input.MessageIDs {
		triageItem, ok := r.triageItems[triageItemKey(input.UserID, messageID)]
		if !ok {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
		informationID, emailThreadID, emailMessageID, err := r.persistCommunicationsConversionEmailLocked(input, triageItem.Message, now)
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.AttachedEmailInformationIDs = append(result.AttachedEmailInformationIDs, informationID)
		result.EmailThreadIDs = append(result.EmailThreadIDs, emailThreadID)
		result.EmailMessageIDs = append(result.EmailMessageIDs, emailMessageID)
		delete(r.triageItems, triageItemKey(input.UserID, messageID))
		updatedNode := r.withNodeReadModelLocked(r.nodes[key(input.CompanyID, input.NodeID)])
		result.Nodes = append(result.Nodes, updatedNode)
		result.EmailProvenance = append(result.EmailProvenance, CommunicationsEmailConversionProvenance{
			CompanyID: input.CompanyID,
			UserID:    input.UserID,
			MessageID: messageID,
			ThreadID:  strings.TrimSpace(triageItem.Message.ThreadID),
			NodeID:    input.NodeID,
		})
		result.DeletedMessageIDs = append(result.DeletedMessageIDs, messageID)
	}
	if err := r.addCommunicationsEmailTextBoxChatWritesLocked(communicationsEmailTextBoxChatWriteInputFromConversion(input), &result); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	return result, nil
}

func (r *MemoryRepo) convertCommunicationsTriageItemsToExplorerTargetLocked(input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error) {
	if input.Target.ProjectID != "" {
		if _, ok := r.projects[key(input.CompanyID, input.Target.ProjectID)]; !ok {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
	}

	now := time.Now().UTC()
	result := CommunicationsTriageConversionResult{Target: input.Target}
	for _, messageID := range input.MessageIDs {
		triageItem, ok := r.triageItems[triageItemKey(input.UserID, messageID)]
		if !ok {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
		nodeID := newUUIDv7String()
		node := domain.Node{
			CompanyID:        input.CompanyID,
			NodeID:           nodeID,
			Title:            emailNodeTitle(triageItem.Message),
			Priority:         cloneIntPointer(input.Priority),
			CreatedTimestamp: now,
		}
		r.nodes[key(input.CompanyID, nodeID)] = node
		emailInput := input
		emailInput.NodeID = nodeID
		informationID, emailThreadID, emailMessageID, err := r.persistCommunicationsConversionEmailLocked(emailInput, triageItem.Message, now)
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.AttachedEmailInformationIDs = append(result.AttachedEmailInformationIDs, informationID)
		result.EmailThreadIDs = append(result.EmailThreadIDs, emailThreadID)
		result.EmailMessageIDs = append(result.EmailMessageIDs, emailMessageID)
		delete(r.triageItems, triageItemKey(input.UserID, messageID))
		if input.Target.ProjectID != "" {
			relationships, err := r.upsertCommunicationsTriageProjectRelationshipLocked(input, nodeID, now)
			if err != nil {
				return CommunicationsTriageConversionResult{}, err
			}
			result.ProjectRelationships = append(result.ProjectRelationships, relationships...)
		}
		node = r.withNodeReadModelLocked(r.nodes[key(input.CompanyID, nodeID)])
		result.Nodes = append(result.Nodes, node)
		result.EmailProvenance = append(result.EmailProvenance, CommunicationsEmailConversionProvenance{
			CompanyID: input.CompanyID,
			UserID:    input.UserID,
			MessageID: messageID,
			ThreadID:  strings.TrimSpace(triageItem.Message.ThreadID),
			NodeID:    nodeID,
		})
		result.DeletedMessageIDs = append(result.DeletedMessageIDs, messageID)
	}
	return result, nil
}

func (r *MemoryRepo) nextProjectRelationshipPositionLocked(companyID, projectID string) int {
	position := 1000
	for _, relationship := range r.projectRelationships {
		if relationship.CompanyID == companyID && relationship.ProjectID == projectID && relationship.Position >= position {
			position = relationship.Position + 1000
		}
	}
	return position
}

func (r *MemoryRepo) upsertCommunicationsTriageProjectRelationshipLocked(input CommunicationsTriageConversionInput, nodeID string, now time.Time) ([]domain.ProjectRelationshipProjection, error) {
	position := input.Target.Position
	if position <= 0 {
		position = r.nextProjectRelationshipPositionLocked(input.CompanyID, input.Target.ProjectID)
	}
	if strings.TrimSpace(input.LogicGateID) == "" {
		return nil, ErrProjectNodeLogicGateRequired
	}
	gateProjection, err := r.upsertProjectRelationshipSourceLocked(ProjectRelationshipInput{
		CompanyID: input.CompanyID, ProjectID: input.Target.ProjectID, ResourceType: EntityTypeLogicGate,
		ResourceID: input.LogicGateID, Position: position,
	})
	if err != nil {
		return nil, err
	}
	nodeProjection, err := r.upsertProjectRelationshipSourceLocked(ProjectRelationshipInput{
		CompanyID: input.CompanyID, ProjectID: input.Target.ProjectID, ResourceType: EntityTypeNode,
		ResourceID: nodeID, Position: position,
	})
	if err != nil {
		return nil, err
	}
	r.syncRACIMatrixProjectionForProjectResourcesLocked(input.CompanyID, []string{nodeID}, []string{input.LogicGateID})
	return []domain.ProjectRelationshipProjection{gateProjection, nodeProjection}, nil
}
func (r *MemoryRepo) attachCommunicationsTriageItemsToExistingNodeLocked(input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error) {
	if input.LogicGateID == "" {
		return r.attachCommunicationsTriageItemsToStandaloneNodeLocked(input)
	}
	logicGate, ok := r.logicGates[key(input.CompanyID, input.LogicGateID)]
	if !ok {
		return CommunicationsTriageConversionResult{}, ErrNotFound
	}
	node, ok := r.nodes[key(input.CompanyID, input.NodeID)]
	if !ok {
		return CommunicationsTriageConversionResult{}, ErrNotFound
	}
	assignment, ok := r.nodeLogicGateAssignmentLocked(input.CompanyID, input.NodeID, input.LogicGateID)
	if !ok {
		return CommunicationsTriageConversionResult{}, ErrNotFound
	}
	if input.PrioritySet {
		node.Priority = cloneIntPointer(input.Priority)
	}
	r.nodes[key(input.CompanyID, input.NodeID)] = node

	now := time.Now().UTC()
	result := CommunicationsTriageConversionResult{
		Target:    input.Target,
		LogicGate: r.withLogicGateRACILocked(logicGate),
	}
	result.Target.Header = logicGate.Header
	for _, messageID := range input.MessageIDs {
		triageItem, ok := r.triageItems[triageItemKey(input.UserID, messageID)]
		if !ok {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
		link := communicationsEmailNodeLink{
			CompanyID:        input.CompanyID,
			UserID:           input.UserID,
			SharedInboxID:    input.SharedInboxID,
			AccountEmail:     input.AccountEmail,
			MessageID:        messageID,
			NodeID:           input.NodeID,
			LogicGateID:      input.LogicGateID,
			Message:          triageItem.Message,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
		r.emailNodeLinks[emailNodeAttachmentLinkKey(input.CompanyID, input.UserID, messageID, input.NodeID)] = link
		informationID, emailThreadID, emailMessageID, err := r.persistCommunicationsConversionEmailLocked(input, triageItem.Message, now)
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.AttachedEmailInformationIDs = append(result.AttachedEmailInformationIDs, informationID)
		result.EmailThreadIDs = append(result.EmailThreadIDs, emailThreadID)
		result.EmailMessageIDs = append(result.EmailMessageIDs, emailMessageID)
		delete(r.triageItems, triageItemKey(input.UserID, messageID))

		updatedNode := r.withNodeReadModelLocked(r.nodes[key(input.CompanyID, input.NodeID)])
		placement := domain.CommunicationsEmailPlacement{
			CompanyID:        link.CompanyID,
			UserID:           link.UserID,
			MessageID:        link.MessageID,
			NodeID:           link.NodeID,
			LogicGateID:      link.LogicGateID,
			CreatedTimestamp: link.CreatedTimestamp,
			UpdatedTimestamp: link.UpdatedTimestamp,
		}
		provenance := CommunicationsEmailConversionProvenance{
			CompanyID:   link.CompanyID,
			UserID:      link.UserID,
			MessageID:   link.MessageID,
			ThreadID:    strings.TrimSpace(triageItem.Message.ThreadID),
			NodeID:      link.NodeID,
			LogicGateID: link.LogicGateID,
		}
		result.Nodes = append(result.Nodes, updatedNode)
		result.Assignments = append(result.Assignments, assignment)
		result.EmailPlacements = append(result.EmailPlacements, placement)
		result.EmailProvenance = append(result.EmailProvenance, provenance)
		result.DeletedMessageIDs = append(result.DeletedMessageIDs, messageID)
	}
	if err := r.addCommunicationsEmailTextBoxChatWritesLocked(communicationsEmailTextBoxChatWriteInputFromConversion(input), &result); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	return result, nil
}

func (r *MemoryRepo) RevertCommunicationsTriageNode(input CommunicationsTriageRevertInput) (CommunicationsTriageRevertResult, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	if input.UserID == "" || input.CompanyID == "" || input.NodeID == "" {
		return CommunicationsTriageRevertResult{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	beforeState := r.snapshotRecycleStateLocked()
	beforeTriageItems := cloneMap(r.triageItems)
	committed := false
	defer func() {
		if !committed {
			r.restoreRecycleSnapshotLocked(beforeState)
			r.triageItems = beforeTriageItems
		}
	}()

	_, link, ok := r.communicationsEmailNodeLinkLocked(input.CompanyID, input.NodeID)
	if !ok || link.UserID != input.UserID {
		return CommunicationsTriageRevertResult{}, ErrNotFound
	}
	now := time.Now().UTC()
	triageItem := domain.CommunicationsTriageItem{
		UserID:           input.UserID,
		MessageID:        link.MessageID,
		Message:          link.Message,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.triageItems[triageItemKey(input.UserID, link.MessageID)] = triageItem

	if err := r.deleteNodeLocked(input.CompanyID, link.NodeID, false); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	events, err := r.appendDomainEventsLocked([]DomainEventInput{
		workspaceDomainEventInput(input.CompanyID, WorkItemLogicGateAssignmentRemovedEventType, map[string]any{"logic_gate_id": link.LogicGateID, "node_id": link.NodeID}),
		nodeDeletedWorkspaceEventInput(input.CompanyID, link.NodeID),
	})
	if err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	committed = true
	return CommunicationsTriageRevertResult{
		TriageItem:    triageItem,
		DeletedNodeID: link.NodeID,
		Events:        events,
	}, nil
}

func (r *MemoryRepo) TransferCommunicationsEmailNode(input CommunicationsEmailNodeTransferInput) (CommunicationsEmailNodeTransferResult, error) {
	input, err := NormalizeCommunicationsEmailNodeTransferInput(input)
	if err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	beforeState := r.snapshotRecycleStateLocked()
	committed := false
	defer func() {
		if !committed {
			r.restoreRecycleSnapshotLocked(beforeState)
		}
	}()

	_, sourceLink, ok := r.communicationsEmailNodeLinkLocked(input.CompanyID, input.SourceNodeID)
	if !ok || (input.UserID != "" && sourceLink.UserID != input.UserID) {
		return CommunicationsEmailNodeTransferResult{}, ErrNotFound
	}
	targetNode, ok := r.nodes[key(input.CompanyID, input.TargetNodeID)]
	if !ok {
		return CommunicationsEmailNodeTransferResult{}, ErrNotFound
	}
	targetAssignment, ok := r.nodeLogicGateAssignmentLocked(input.CompanyID, targetNode.NodeID, "")
	if !ok {
		return CommunicationsEmailNodeTransferResult{}, ErrNotFound
	}
	targetLogicGateID := targetAssignment.LogicGateID
	if targetNode.NodeID == sourceLink.NodeID {
		return CommunicationsEmailNodeTransferResult{}, ErrInvalid
	}

	now := time.Now().UTC()
	attachmentLink := sourceLink
	attachmentLink.NodeID = targetNode.NodeID
	attachmentLink.LogicGateID = targetLogicGateID
	attachmentLink.CreatedTimestamp = now
	attachmentLink.UpdatedTimestamp = now
	attachmentKey := emailNodeAttachmentLinkKey(input.CompanyID, sourceLink.UserID, sourceLink.MessageID, targetNode.NodeID)
	if existing, ok := r.emailNodeLinks[attachmentKey]; ok {
		attachmentLink.CreatedTimestamp = existing.CreatedTimestamp
	}
	r.emailNodeLinks[attachmentKey] = attachmentLink
	emailThreadID := ""
	for _, threadLink := range r.nodeEmailThreads {
		if threadLink.CompanyID != input.CompanyID || threadLink.NodeID != sourceLink.NodeID {
			continue
		}
		thread, ok := r.emailThreads[key(input.CompanyID, threadLink.EmailThreadID)]
		if !ok {
			continue
		}
		for _, message := range thread.Messages {
			if message.ProviderMessageID == sourceLink.MessageID {
				emailThreadID = thread.EmailThreadID
				break
			}
		}
		if emailThreadID != "" {
			break
		}
	}
	if emailThreadID == "" {
		return CommunicationsEmailNodeTransferResult{}, ErrNotFound
	}
	informationID := r.addEmailProjectionWithThreadLocked(input.CompanyID, targetNode.NodeID, sourceLink.SharedInboxID, sourceLink.AccountEmail, sourceLink.Message, emailThreadID, now, false)
	if _, err := r.linkCommunicationsEmailThreadToNodeLocked(input.CompanyID, targetNode.NodeID, informationID, emailThreadID, sourceLink.MessageID, sourceLink.UserID, now); err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}
	if err := r.deleteNodeLocked(input.CompanyID, sourceLink.NodeID, false); err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}
	events, err := r.appendDomainEventsLocked([]DomainEventInput{
		workspaceDomainEventInput(input.CompanyID, WorkItemLogicGateAssignmentRemovedEventType, map[string]any{"logic_gate_id": sourceLink.LogicGateID, "node_id": sourceLink.NodeID}),
		nodeDeletedWorkspaceEventInput(input.CompanyID, sourceLink.NodeID),
		workspaceDomainEventInput(input.CompanyID, "node_updated", map[string]any{"node_id": targetNode.NodeID}),
	})
	if err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}
	committed = true

	return CommunicationsEmailNodeTransferResult{
		EmailPlacement: domain.CommunicationsEmailPlacement{
			CompanyID:        attachmentLink.CompanyID,
			UserID:           attachmentLink.UserID,
			MessageID:        attachmentLink.MessageID,
			NodeID:           attachmentLink.NodeID,
			LogicGateID:      attachmentLink.LogicGateID,
			CreatedTimestamp: attachmentLink.CreatedTimestamp,
			UpdatedTimestamp: attachmentLink.UpdatedTimestamp,
		},
		DeletedNodeID: sourceLink.NodeID,
		TargetNodeID:  targetNode.NodeID,
		Events:        events,
	}, nil
}

func (r *MemoryRepo) communicationsEmailNodeLinkLocked(companyID, nodeID string) (string, communicationsEmailNodeLink, bool) {
	var selected communicationsEmailNodeLink
	selectedKey := ""
	for linkKey, link := range r.emailNodeLinks {
		if link.CompanyID != companyID || link.NodeID != nodeID {
			continue
		}
		if selectedKey == "" || link.CreatedTimestamp.Before(selected.CreatedTimestamp) || (link.CreatedTimestamp.Equal(selected.CreatedTimestamp) && linkKey < selectedKey) {
			selectedKey, selected = linkKey, link
		}
	}
	if assignment, ok := r.nodeLogicGateAssignmentLocked(companyID, nodeID, ""); ok {
		selected.LogicGateID = assignment.LogicGateID
	} else {
		selected.LogicGateID = ""
	}
	return selectedKey, selected, selectedKey != ""
}

func (r *MemoryRepo) ListCommunicationsEmailPlacements(userID, companyID string, messageIDs []string) ([]domain.CommunicationsEmailPlacement, error) {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	if userID == "" || companyID == "" {
		return nil, ErrInvalid
	}
	ids := normalizeUniqueStrings(messageIDs, 0)
	if len(ids) == 0 {
		return []domain.CommunicationsEmailPlacement{}, nil
	}
	idSet := make(map[string]bool, len(ids))
	for _, id := range ids {
		idSet[id] = true
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	placements := make([]domain.CommunicationsEmailPlacement, 0)
	for _, link := range r.emailNodeLinks {
		if (link.UserID != "" && link.UserID != userID) || link.CompanyID != companyID || !idSet[link.MessageID] {
			continue
		}
		if assignment, ok := r.nodeLogicGateAssignmentLocked(companyID, link.NodeID, ""); ok {
			link.LogicGateID = assignment.LogicGateID
		} else {
			link.LogicGateID = ""
		}
		placements = append(placements, domain.CommunicationsEmailPlacement{
			CompanyID:        link.CompanyID,
			UserID:           link.UserID,
			MessageID:        link.MessageID,
			NodeID:           link.NodeID,
			LogicGateID:      link.LogicGateID,
			CreatedTimestamp: link.CreatedTimestamp,
			UpdatedTimestamp: link.UpdatedTimestamp,
		})
	}
	sort.Slice(placements, func(i, j int) bool {
		if !placements[i].CreatedTimestamp.Equal(placements[j].CreatedTimestamp) {
			return placements[i].CreatedTimestamp.After(placements[j].CreatedTimestamp)
		}
		if placements[i].MessageID != placements[j].MessageID {
			return placements[i].MessageID < placements[j].MessageID
		}
		return placements[i].LogicGateID < placements[j].LogicGateID
	})
	return placements, nil
}

func (r *MemoryRepo) ListCommunicationsEmailPlacementsForConnection(userID, companyID, emailConnectionID string, messageIDs []string) ([]domain.CommunicationsEmailPlacement, error) {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	emailConnectionID = strings.TrimSpace(emailConnectionID)
	if userID == "" || companyID == "" || emailConnectionID == "" {
		return nil, ErrInvalid
	}
	ids := normalizeUniqueStrings(messageIDs, 0)
	if len(ids) == 0 {
		return []domain.CommunicationsEmailPlacement{}, nil
	}
	idSet := make(map[string]bool, len(ids))
	for _, id := range ids {
		idSet[id] = true
	}

	r.mu.RLock()
	defer r.mu.RUnlock()
	placements := make([]domain.CommunicationsEmailPlacement, 0)
	for _, link := range r.emailNodeLinks {
		if (link.UserID != "" && link.UserID != userID) || link.CompanyID != companyID || !idSet[link.MessageID] {
			continue
		}
		var linkConnectionID string
		if link.SharedInboxID != "" {
			if folder, ok := r.folders[key(companyID, link.SharedInboxID)]; ok {
				linkConnectionID = folder.CompanyEmailConnectionID
			}
		} else if connection, ok := r.emailConnections[emailConnectionKey(link.UserID, link.AccountEmail)]; ok {
			linkConnectionID = connection.EmailConnectionID
		}
		if linkConnectionID != emailConnectionID {
			continue
		}
		if assignment, ok := r.nodeLogicGateAssignmentLocked(companyID, link.NodeID, ""); ok {
			link.LogicGateID = assignment.LogicGateID
		} else {
			link.LogicGateID = ""
		}
		placements = append(placements, domain.CommunicationsEmailPlacement{
			CompanyID: link.CompanyID, UserID: link.UserID, MessageID: link.MessageID,
			NodeID: link.NodeID, LogicGateID: link.LogicGateID,
			CreatedTimestamp: link.CreatedTimestamp, UpdatedTimestamp: link.UpdatedTimestamp,
		})
	}
	sort.Slice(placements, func(i, j int) bool {
		if !placements[i].CreatedTimestamp.Equal(placements[j].CreatedTimestamp) {
			return placements[i].CreatedTimestamp.After(placements[j].CreatedTimestamp)
		}
		if placements[i].MessageID != placements[j].MessageID {
			return placements[i].MessageID < placements[j].MessageID
		}
		return placements[i].LogicGateID < placements[j].LogicGateID
	})
	return placements, nil
}

func (r *MemoryRepo) addEmailProjectionWithThreadLocked(companyID, nodeID, sharedInboxID, accountEmail string, message domain.EmailMessageSnapshot, emailThreadID string, now time.Time, createdFromEmail bool) string {
	information := attachedEmailProjectionInformationWithThread(message, sharedInboxID, accountEmail, emailThreadID, now, createdFromEmail)
	informationID := newUUIDv7String()
	info := domain.NodeInformation{
		CompanyID:        companyID,
		InformationID:    informationID,
		NodeID:           nodeID,
		Type:             "Attached email",
		Information:      information,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	k := key(companyID, nodeID)
	r.nodeInfo[k] = append(r.nodeInfo[k], info)
	if r.nodeText[k] == nil {
		r.nodeText[k] = map[string]domain.NodeProjection{}
	}
	r.nodeText[k][informationID] = domain.NodeProjection{
		CompanyID:        companyID,
		NodeID:           nodeID,
		Type:             info.Type,
		Information:      information,
		InformationID:    informationID,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	return informationID
}

func attachedEmailProjectionInformation(message domain.EmailMessageSnapshot, sharedInboxID, accountEmail string, attachedAt time.Time, createdFromEmail bool) string {
	return attachedEmailProjectionInformationWithThread(message, sharedInboxID, accountEmail, "", attachedAt, createdFromEmail)
}

func attachedEmailProjectionInformationWithThread(message domain.EmailMessageSnapshot, sharedInboxID, accountEmail, emailThreadID string, attachedAt time.Time, createdFromEmail bool) string {
	var date *int64
	if message.Date > 0 {
		value := message.Date
		date = &value
	}
	payload := struct {
		MessageID         string `json:"message_id"`
		EmailMessageID    string `json:"email_message_id,omitempty"`
		ThreadID          string `json:"thread_id"`
		EmailThreadID     string `json:"email_thread_id,omitempty"`
		SharedInboxID     string `json:"shared_inbox_id,omitempty"`
		AccountEmail      string `json:"account_email,omitempty"`
		Subject           string `json:"subject"`
		Snippet           string `json:"snippet"`
		From              string `json:"from"`
		Date              *int64 `json:"date"`
		AttachedTimestamp string `json:"attached_timestamp"`
		CreatedFromEmail  bool   `json:"created_from_email,omitempty"`
	}{
		MessageID:         strings.TrimSpace(message.ID),
		EmailMessageID:    cleanUUIDText(message.EmailMessageID),
		ThreadID:          strings.TrimSpace(message.ThreadID),
		EmailThreadID:     strings.TrimSpace(emailThreadID),
		SharedInboxID:     strings.TrimSpace(sharedInboxID),
		AccountEmail:      strings.TrimSpace(accountEmail),
		Subject:           emailNodeTitle(message),
		Snippet:           strings.TrimSpace(message.Snippet),
		From:              emailAddressSnapshotListLabel(message.From),
		Date:              date,
		AttachedTimestamp: attachedAt.UTC().Format(time.RFC3339Nano),
		CreatedFromEmail:  createdFromEmail,
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func emailAddressSnapshotListLabel(addresses []domain.EmailAddressSnapshot) string {
	labels := make([]string, 0, len(addresses))
	for _, address := range addresses {
		email := strings.TrimSpace(address.Email)
		if email == "" {
			continue
		}
		name := strings.TrimSpace(address.Name)
		if name != "" {
			labels = append(labels, name+" <"+email+">")
			continue
		}
		labels = append(labels, email)
	}
	return strings.Join(labels, ", ")
}

func normalizeEmailMessageSnapshot(message domain.EmailMessageSnapshot) domain.EmailMessageSnapshot {
	message.ID = strings.TrimSpace(message.ID)
	message.ThreadID = strings.TrimSpace(message.ThreadID)
	message.Subject = strings.TrimSpace(message.Subject)
	message.Snippet = strings.TrimSpace(message.Snippet)
	message.Body = strings.TrimSpace(message.Body)
	message.From = normalizeEmailAddressSnapshots(message.From)
	message.To = normalizeEmailAddressSnapshots(message.To)
	message.Cc = normalizeEmailAddressSnapshots(message.Cc)
	message.Bcc = normalizeEmailAddressSnapshots(message.Bcc)
	message.ReplyTo = normalizeEmailAddressSnapshots(message.ReplyTo)
	message.Attachments = normalizeEmailAttachmentSnapshots(message.Attachments)
	message.Folders = normalizeUniqueStrings(message.Folders, 100)
	message.FolderIDs = normalizeUniqueStrings(message.FolderIDs, 100)
	return message
}

func normalizeEmailAddressSnapshots(addresses []domain.EmailAddressSnapshot) []domain.EmailAddressSnapshot {
	out := make([]domain.EmailAddressSnapshot, 0, len(addresses))
	seen := map[string]bool{}
	for _, address := range addresses {
		email := strings.ToLower(strings.TrimSpace(address.Email))
		if email == "" || seen[email] {
			continue
		}
		seen[email] = true
		out = append(out, domain.EmailAddressSnapshot{Name: strings.TrimSpace(address.Name), Email: email})
	}
	return out
}

func normalizeUniqueStrings(values []string, limit int) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		clean := strings.TrimSpace(value)
		if clean == "" || seen[clean] {
			continue
		}
		seen[clean] = true
		out = append(out, clean)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

func emailNodeTitle(message domain.EmailMessageSnapshot) string {
	if subject := strings.TrimSpace(message.Subject); subject != "" {
		return subject
	}
	if len(message.From) > 0 {
		if message.From[0].Name != "" {
			return "Email from " + message.From[0].Name
		}
		if message.From[0].Email != "" {
			return "Email from " + message.From[0].Email
		}
	}
	return "Email"
}

func emailDescriptionSnapshot(message domain.EmailMessageSnapshot) string {
	if snippet := strings.TrimSpace(message.Snippet); snippet != "" {
		return snippet
	}
	return strings.TrimSpace(message.Body)
}
