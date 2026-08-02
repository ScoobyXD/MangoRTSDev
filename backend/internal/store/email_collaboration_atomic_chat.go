package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func normalizeEmailCollaborationChatWriteInput(input NodeInformationInput, informationIDRequired bool) (NodeInformationInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.NodeID = cleanUUIDText(input.NodeID)
	input.ActorUserID = cleanUUIDText(input.ActorUserID)
	input.ActorDisplayName = strings.TrimSpace(input.ActorDisplayName)
	input.Type = strings.TrimSpace(input.Type)
	input.InformationID = strings.TrimSpace(input.InformationID)
	if input.InformationID != "" {
		input.InformationID = cleanUUIDText(input.InformationID)
		if input.InformationID == "" {
			return NodeInformationInput{}, ErrInvalid
		}
	}
	if input.CompanyID == "" || input.NodeID == "" || input.ActorUserID == "" ||
		input.Type != CommunicationsEmailCollaborationChatInformationType || strings.TrimSpace(input.Information) == "" ||
		(informationIDRequired && input.InformationID == "") {
		return NodeInformationInput{}, ErrInvalid
	}
	return input, nil
}

// AddEmailCollaborationNodeInformationWithActor atomically appends a chat
// history item, updates its projection, snapshots every explicit/group mention,
// and grants those permanent participants edit access. Ordinary nodes return
// ErrNotEmailCollaboration so their existing write path remains unchanged.
func (r *MemoryRepo) AddEmailCollaborationNodeInformationWithActor(input NodeInformationInput) (CommunicationsEmailCollaborationInformationWriteResult, error) {
	input, err := normalizeEmailCollaborationChatWriteInput(input, false)
	if err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	participantsBefore := cloneMemoryMap(r.emailCollaborationParticipants)
	permissionsBefore := cloneMemoryMap(r.entityPermissions)
	effectiveAccessBefore := cloneMemoryMap(r.effectiveAccess)
	nodesBefore := cloneMemoryMap(r.nodes)
	nodeInfoBefore := cloneMemorySliceMap(r.nodeInfo)
	nodeTextBefore := cloneMemoryNodeText(r.nodeText)
	contentChangesBefore := cloneMemoryMap(r.nodeContentChanges)
	contentSeenBefore := cloneMemoryMap(r.nodeContentChangeSeen)
	readVersionsBefore := cloneMemoryMap(r.workspaceReadVersions)
	outboxBefore := cloneMemoryMap(r.realtimeOutbox)
	outboxSequenceBefore := r.realtimeOutboxSequence
	committed := false
	defer func() {
		if committed {
			return
		}
		r.emailCollaborationParticipants = participantsBefore
		r.entityPermissions = permissionsBefore
		r.effectiveAccess = effectiveAccessBefore
		r.nodes = nodesBefore
		r.nodeInfo = nodeInfoBefore
		r.nodeText = nodeTextBefore
		r.nodeContentChanges = contentChangesBefore
		r.nodeContentChangeSeen = contentSeenBefore
		r.workspaceReadVersions = readVersionsBefore
		r.realtimeOutbox = outboxBefore
		r.realtimeOutboxSequence = outboxSequenceBefore
	}()

	collaboration, ok := r.emailCollaborationForNodeLocked(input.CompanyID, input.NodeID)
	if !ok {
		return CommunicationsEmailCollaborationInformationWriteResult{}, ErrNotEmailCollaboration
	}
	if input.InformationID != "" && input.InformationID == collaboration.AttachedEmailInformationID {
		return CommunicationsEmailCollaborationInformationWriteResult{}, ErrProtectedEmailCollaborationResource
	}
	mentionedUserIDs, mentionedGroupIDs := CommunicationsEmailChatMentionPrincipalIDs(input.Information)
	participants, err := r.addCollaborationParticipantsLocked(CommunicationsEmailCollaborationParticipantInput{
		CompanyID: input.CompanyID, CollaborationID: collaboration.CollaborationID, ActorUserID: input.ActorUserID,
		MentionedUserIDs: mentionedUserIDs, MentionedGroupIDs: mentionedGroupIDs,
	})
	if err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	item := r.addEmailCollaborationNodeInformationLocked(input)
	messageID := input.InformationID
	if messageID == "" {
		messageID = item.InformationID
	}
	outboxInput, err := nodeChatCreatedOutboxInput(item, messageID)
	if err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	if _, err := r.enqueueRealtimeOutboxLocked(outboxInput); err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	committed = true
	return CommunicationsEmailCollaborationInformationWriteResult{
		Information: item, CollaborationID: collaboration.CollaborationID, MentionedUserIDs: participants.MentionedUserIDs,
	}, nil
}

func (r *MemoryRepo) addEmailCollaborationNodeInformationLocked(input NodeInformationInput) domain.NodeInformation {
	now := time.Now().UTC()
	k := key(input.CompanyID, input.NodeID)
	item := domain.NodeInformation{
		CompanyID: input.CompanyID, InformationID: newUUIDv7String(), NodeID: input.NodeID,
		Type: input.Type, Information: input.Information, CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	r.nodeInfo[k] = append(r.nodeInfo[k], item)
	sort.Slice(r.nodeInfo[k], func(i, j int) bool {
		return r.nodeInfo[k][i].CreatedTimestamp.Before(r.nodeInfo[k][j].CreatedTimestamp)
	})
	projectionID := input.InformationID
	if projectionID == "" {
		projectionID = item.InformationID
	}
	if r.nodeText[k] == nil {
		r.nodeText[k] = map[string]domain.NodeProjection{}
	}
	created := item.CreatedTimestamp
	var previous *domain.NodeProjection
	if existing, ok := r.nodeText[k][projectionID]; ok {
		created = existing.CreatedTimestamp
		existingCopy := existing
		previous = &existingCopy
	}
	r.nodeText[k][projectionID] = domain.NodeProjection{
		CompanyID: input.CompanyID, NodeID: input.NodeID, InformationID: projectionID,
		Type: input.Type, Information: input.Information, CreatedTimestamp: created, UpdatedTimestamp: now,
	}
	r.recordNodeContentChangesLocked(buildNodeContentChanges(
		input.CompanyID, input.NodeID, projectionID, input.Type, previous, input.Information,
		normalizeNodeContentChangeActor(input.ActorUserID, input.ActorDisplayName), now,
	))
	r.bumpNodeViewVersionLocked(input.CompanyID, input.NodeID)
	return item
}

// UpsertEmailCollaborationNodeProjectionWithActor is the projection-only
// acceptance path used by the federated ChatPane.
func (r *MemoryRepo) UpsertEmailCollaborationNodeProjectionWithActor(input NodeInformationInput) (CommunicationsEmailCollaborationProjectionWriteResult, error) {
	input, err := normalizeEmailCollaborationChatWriteInput(input, true)
	if err != nil {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	participantsBefore := cloneMemoryMap(r.emailCollaborationParticipants)
	permissionsBefore := cloneMemoryMap(r.entityPermissions)
	effectiveAccessBefore := cloneMemoryMap(r.effectiveAccess)
	nodesBefore := cloneMemoryMap(r.nodes)
	nodeTextBefore := cloneMemoryNodeText(r.nodeText)
	contentChangesBefore := cloneMemoryMap(r.nodeContentChanges)
	contentSeenBefore := cloneMemoryMap(r.nodeContentChangeSeen)
	readVersionsBefore := cloneMemoryMap(r.workspaceReadVersions)
	outboxBefore := cloneMemoryMap(r.realtimeOutbox)
	outboxSequenceBefore := r.realtimeOutboxSequence
	committed := false
	defer func() {
		if committed {
			return
		}
		r.emailCollaborationParticipants = participantsBefore
		r.entityPermissions = permissionsBefore
		r.effectiveAccess = effectiveAccessBefore
		r.nodes = nodesBefore
		r.nodeText = nodeTextBefore
		r.nodeContentChanges = contentChangesBefore
		r.nodeContentChangeSeen = contentSeenBefore
		r.workspaceReadVersions = readVersionsBefore
		r.realtimeOutbox = outboxBefore
		r.realtimeOutboxSequence = outboxSequenceBefore
	}()
	collaboration, ok := r.emailCollaborationForNodeLocked(input.CompanyID, input.NodeID)
	if !ok {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, ErrNotEmailCollaboration
	}
	if input.InformationID == collaboration.AttachedEmailInformationID {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, ErrProtectedEmailCollaborationResource
	}
	mentionedUserIDs, mentionedGroupIDs := CommunicationsEmailChatMentionPrincipalIDs(input.Information)
	participants, err := r.addCollaborationParticipantsLocked(CommunicationsEmailCollaborationParticipantInput{
		CompanyID: input.CompanyID, CollaborationID: collaboration.CollaborationID, ActorUserID: input.ActorUserID,
		MentionedUserIDs: mentionedUserIDs, MentionedGroupIDs: mentionedGroupIDs,
	})
	if err != nil {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, err
	}
	_, projectionExisted := r.nodeText[key(input.CompanyID, input.NodeID)][input.InformationID]
	projection := r.upsertEmailCollaborationNodeProjectionLocked(input)
	if projectionExisted {
		outboxInput, err := nodeChatUpdatedOutboxInput(projection)
		if err != nil {
			return CommunicationsEmailCollaborationProjectionWriteResult{}, err
		}
		if _, err := r.enqueueRealtimeOutboxLocked(outboxInput); err != nil {
			return CommunicationsEmailCollaborationProjectionWriteResult{}, err
		}
		r.bumpNodeViewVersionLocked(input.CompanyID, input.NodeID)
	}
	committed = true
	return CommunicationsEmailCollaborationProjectionWriteResult{
		Projection: projection, CollaborationID: collaboration.CollaborationID, MentionedUserIDs: participants.MentionedUserIDs,
	}, nil
}

func (r *MemoryRepo) upsertEmailCollaborationNodeProjectionLocked(input NodeInformationInput) domain.NodeProjection {
	k := key(input.CompanyID, input.NodeID)
	if r.nodeText[k] == nil {
		r.nodeText[k] = map[string]domain.NodeProjection{}
	}
	now := time.Now().UTC()
	created := now
	var previous *domain.NodeProjection
	if existing, ok := r.nodeText[k][input.InformationID]; ok {
		created = existing.CreatedTimestamp
		existingCopy := existing
		previous = &existingCopy
	}
	projection := domain.NodeProjection{
		CompanyID: input.CompanyID, NodeID: input.NodeID, InformationID: input.InformationID,
		Type: input.Type, Information: input.Information, CreatedTimestamp: created, UpdatedTimestamp: now,
	}
	r.nodeText[k][input.InformationID] = projection
	r.recordNodeContentChangesLocked(buildNodeContentChanges(
		input.CompanyID, input.NodeID, input.InformationID, input.Type, previous, input.Information,
		normalizeNodeContentChangeActor(input.ActorUserID, input.ActorDisplayName), now,
	))
	return projection
}

func (r *PostgresRepo) AddEmailCollaborationNodeInformationWithActor(input NodeInformationInput) (CommunicationsEmailCollaborationInformationWriteResult, error) {
	input, err := normalizeEmailCollaborationChatWriteInput(input, false)
	if err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	defer tx.Rollback()
	target, err := lockPostgresEmailCollaborationTarget(ctx, tx, input.CompanyID, "", input.NodeID)
	if errors.Is(err, ErrNotFound) {
		return CommunicationsEmailCollaborationInformationWriteResult{}, ErrNotEmailCollaboration
	}
	if err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	participants, err := addPostgresEmailCollaborationChatParticipantsTx(ctx, tx, input, target)
	if err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	item, err := addEmailCollaborationNodeInformationTx(ctx, tx, input)
	if err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	messageID := input.InformationID
	if messageID == "" {
		messageID = item.InformationID
	}
	outboxInput, err := nodeChatCreatedOutboxInput(item, messageID)
	if err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	return CommunicationsEmailCollaborationInformationWriteResult{
		Information: item, CollaborationID: target.CollaborationID, MentionedUserIDs: participants.MentionedUserIDs,
	}, nil
}

func (r *PostgresRepo) UpsertEmailCollaborationNodeProjectionWithActor(input NodeInformationInput) (CommunicationsEmailCollaborationProjectionWriteResult, error) {
	input, err := normalizeEmailCollaborationChatWriteInput(input, true)
	if err != nil {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, err
	}
	defer tx.Rollback()
	target, err := lockPostgresEmailCollaborationTarget(ctx, tx, input.CompanyID, "", input.NodeID)
	if errors.Is(err, ErrNotFound) {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, ErrNotEmailCollaboration
	}
	if err != nil {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, err
	}
	participants, err := addPostgresEmailCollaborationChatParticipantsTx(ctx, tx, input, target)
	if err != nil {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, err
	}
	projection, projectionExisted, err := upsertEmailCollaborationNodeProjectionTx(ctx, tx, input)
	if err != nil {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, err
	}
	if projectionExisted {
		outboxInput, err := nodeChatUpdatedOutboxInput(projection)
		if err != nil {
			return CommunicationsEmailCollaborationProjectionWriteResult{}, err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
			return CommunicationsEmailCollaborationProjectionWriteResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, err
	}
	return CommunicationsEmailCollaborationProjectionWriteResult{
		Projection: projection, CollaborationID: target.CollaborationID, MentionedUserIDs: participants.MentionedUserIDs,
	}, nil
}

func addPostgresEmailCollaborationChatParticipantsTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput, target postgresEmailCollaborationTarget) (CommunicationsEmailCollaborationParticipantResult, error) {
	mentionedUserIDs, mentionedGroupIDs := CommunicationsEmailChatMentionPrincipalIDs(input.Information)
	participantInput, err := normalizeCommunicationsEmailCollaborationParticipantInput(CommunicationsEmailCollaborationParticipantInput{
		CompanyID: input.CompanyID, CollaborationID: target.CollaborationID, ActorUserID: input.ActorUserID,
		MentionedUserIDs: mentionedUserIDs, MentionedGroupIDs: mentionedGroupIDs,
	})
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	return addPostgresEmailCollaborationParticipantsTx(ctx, tx, participantInput, target)
}

func addEmailCollaborationNodeInformationTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput) (domain.NodeInformation, error) {
	projection, err := postgresUpsertNodeV3ProjectionTx(ctx, tx, input)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	return nodeInformationFromProjection(projection), nil
}

func upsertEmailCollaborationNodeProjectionTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput) (domain.NodeProjection, bool, error) {
	_, previousFound, err := postgresNodeV3ProjectionTx(ctx, tx, input.CompanyID, input.NodeID, input.InformationID)
	if err != nil {
		return domain.NodeProjection{}, false, err
	}
	projection, err := postgresUpsertNodeV3ProjectionTx(ctx, tx, input)
	if err != nil {
		return domain.NodeProjection{}, false, err
	}
	return projection, previousFound, nil
}
