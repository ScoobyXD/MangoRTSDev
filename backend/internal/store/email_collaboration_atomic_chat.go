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
	projection := r.upsertEmailCollaborationNodeProjectionLocked(input)
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
	if input.InformationID != "" && input.InformationID == target.AttachedEmailInformationID {
		return CommunicationsEmailCollaborationInformationWriteResult{}, ErrProtectedEmailCollaborationResource
	}
	participants, err := addPostgresEmailCollaborationChatParticipantsTx(ctx, tx, input, target)
	if err != nil {
		return CommunicationsEmailCollaborationInformationWriteResult{}, err
	}
	item, err := addEmailCollaborationNodeInformationTx(ctx, tx, input)
	if err != nil {
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
	if input.InformationID == target.AttachedEmailInformationID {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, ErrProtectedEmailCollaborationResource
	}
	participants, err := addPostgresEmailCollaborationChatParticipantsTx(ctx, tx, input, target)
	if err != nil {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, err
	}
	projection, err := upsertEmailCollaborationNodeProjectionTx(ctx, tx, input)
	if err != nil {
		return CommunicationsEmailCollaborationProjectionWriteResult{}, err
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
	item := domain.NodeInformation{
		CompanyID: input.CompanyID, InformationID: newUUIDv7String(), NodeID: input.NodeID,
		Type: input.Type, Information: input.Information,
	}
	if err := tx.QueryRowContext(ctx, `
insert into node_information
  (company_id, information_id, node_id, type, information, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, now(), now())
returning company_id::text, information_id::text, node_id::text, type::text, information, created_timestamp, updated_timestamp`,
		item.CompanyID, item.InformationID, item.NodeID, item.Type, item.Information,
	).Scan(&item.CompanyID, &item.InformationID, &item.NodeID, &item.Type, &item.Information, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
		return domain.NodeInformation{}, err
	}
	projectionID := input.InformationID
	if projectionID == "" {
		projectionID = item.InformationID
	}
	previous, previousFound, err := postgresNodeProjectionTx(ctx, tx, input.CompanyID, input.NodeID, projectionID)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	if _, err := upsertEmailCollaborationNodeProjectionRowTx(ctx, tx, input, projectionID); err != nil {
		return domain.NodeInformation{}, err
	}
	if err := recordEmailCollaborationNodeContentChangesTx(ctx, tx, input, projectionID, previous, previousFound); err != nil {
		return domain.NodeInformation{}, err
	}
	return item, nil
}

func upsertEmailCollaborationNodeProjectionTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput) (domain.NodeProjection, error) {
	previous, previousFound, err := postgresNodeProjectionTx(ctx, tx, input.CompanyID, input.NodeID, input.InformationID)
	if err != nil {
		return domain.NodeProjection{}, err
	}
	projection, err := upsertEmailCollaborationNodeProjectionRowTx(ctx, tx, input, input.InformationID)
	if err != nil {
		return domain.NodeProjection{}, err
	}
	if err := recordEmailCollaborationNodeContentChangesTx(ctx, tx, input, input.InformationID, previous, previousFound); err != nil {
		return domain.NodeProjection{}, err
	}
	return projection, nil
}

func upsertEmailCollaborationNodeProjectionRowTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput, informationID string) (domain.NodeProjection, error) {
	var projection domain.NodeProjection
	if err := tx.QueryRowContext(ctx, `
insert into node_projection_table
  (company_id, node_id, information_id, type, information, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, now(), now())
on conflict (company_id, node_id, information_id)
do update set type=excluded.type, information=excluded.information, updated_timestamp=now()
returning company_id::text, node_id::text, information_id::text, type::text, information, created_timestamp, updated_timestamp`,
		input.CompanyID, input.NodeID, informationID, input.Type, input.Information,
	).Scan(&projection.CompanyID, &projection.NodeID, &projection.InformationID, &projection.Type, &projection.Information, &projection.CreatedTimestamp, &projection.UpdatedTimestamp); err != nil {
		return domain.NodeProjection{}, err
	}
	return projection, nil
}

func recordEmailCollaborationNodeContentChangesTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput, informationID string, previous domain.NodeProjection, previousFound bool) error {
	var previousPtr *domain.NodeProjection
	if previousFound {
		previousPtr = &previous
	}
	return insertNodeContentChangesTx(ctx, tx, buildNodeContentChanges(
		input.CompanyID, input.NodeID, informationID, input.Type, previousPtr, input.Information,
		normalizeNodeContentChangeActor(input.ActorUserID, input.ActorDisplayName), time.Now().UTC(),
	))
}
