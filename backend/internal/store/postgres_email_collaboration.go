package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const postgresEmailCollaborationColumns = `
c.company_id::text,
c.collaboration_id::text,
c.node_id::text,
c.attached_email_information_id::text,
c.scope_type,
coalesce(c.personal_user_id::text, ''),
coalesce(c.personal_account_email, ''),
coalesce(c.shared_inbox_id::text, ''),
c.account_email,
c.provider_thread_id,
c.root_message_id,
c.latest_message_id,
coalesce(c.email_thread_id::text, ''),
c.message_snapshot,
coalesce(c.created_by_user_id::text, ''),
c.created_timestamp,
c.updated_timestamp`

type emailCollaborationRowScanner interface {
	Scan(dest ...any) error
}

type emailCollaborationQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func scanPostgresEmailCollaboration(row emailCollaborationRowScanner) (domain.CommunicationsEmailCollaboration, error) {
	var item domain.CommunicationsEmailCollaboration
	var snapshot []byte
	err := row.Scan(
		&item.CompanyID, &item.CollaborationID, &item.NodeID, &item.AttachedEmailInformationID,
		&item.ScopeType, &item.PersonalUserID, &item.PersonalAccountEmail, &item.SharedInboxID,
		&item.AccountEmail, &item.ProviderThreadID, &item.RootMessageID, &item.LatestMessageID,
		&item.EmailThreadID,
		&snapshot, &item.CreatedByUserID, &item.CreatedTimestamp, &item.UpdatedTimestamp,
	)
	if err != nil {
		return domain.CommunicationsEmailCollaboration{}, err
	}
	if err := json.Unmarshal(snapshot, &item.Message); err != nil {
		return domain.CommunicationsEmailCollaboration{}, err
	}
	return item, nil
}

func listPostgresEmailCollaborationParticipants(ctx context.Context, q emailCollaborationQueryer, companyID, collaborationID string) ([]domain.CommunicationsEmailCollaborationParticipant, error) {
	rows, err := q.QueryContext(ctx, `
select company_id::text, collaboration_id::text, user_id::text,
       coalesce(added_by_user_id::text, ''), added_via_type,
       coalesce(added_via_id::text, ''), created_timestamp
from communications_email_collaboration_participants
where company_id=$1::uuid and collaboration_id=$2::uuid
order by created_timestamp, user_id`, companyID, collaborationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.CommunicationsEmailCollaborationParticipant{}
	for rows.Next() {
		var item domain.CommunicationsEmailCollaborationParticipant
		if err := rows.Scan(&item.CompanyID, &item.CollaborationID, &item.UserID, &item.AddedByUserID, &item.AddedViaType, &item.AddedViaID, &item.CreatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresEmailCollaborationByID(ctx context.Context, q emailCollaborationQueryer, companyID, collaborationID, participantUserID string) (domain.CommunicationsEmailCollaboration, error) {
	participantClause := ""
	args := []any{companyID, collaborationID}
	if participantUserID != "" {
		participantClause = ` and exists (
  select 1 from communications_email_collaboration_participants participant
  where participant.company_id=c.company_id
    and participant.collaboration_id=c.collaboration_id
    and participant.user_id=$3::uuid
)`
		args = append(args, participantUserID)
	}
	item, err := scanPostgresEmailCollaboration(q.QueryRowContext(ctx, `
select `+postgresEmailCollaborationColumns+`
from communications_email_collaborations c
where c.company_id=$1::uuid and c.collaboration_id=$2::uuid`+participantClause, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsEmailCollaboration{}, ErrNotFound
	}
	if err != nil {
		return domain.CommunicationsEmailCollaboration{}, err
	}
	item.Participants, err = listPostgresEmailCollaborationParticipants(ctx, q, companyID, collaborationID)
	return item, err
}

func postgresEmailCollaborationLookup(ctx context.Context, q emailCollaborationQueryer, companyID string, scope communicationsEmailCollaborationScope, messageID, threadID, participantUserID string) (domain.CommunicationsEmailCollaboration, error) {
	item, err := scanPostgresEmailCollaboration(q.QueryRowContext(ctx, `
select `+postgresEmailCollaborationColumns+`
from communications_email_collaborations c
where c.company_id=$1::uuid
  and c.scope_type=$2
  and (($2='personal' and c.personal_user_id=nullif($3, '')::uuid and c.personal_account_email=$4)
       or ($2='shared' and c.shared_inbox_id=nullif($5, '')::uuid))
  and ((nullif($7, '') is not null and c.provider_thread_id=$7)
       or (nullif($6, '') is not null and (c.root_message_id=$6 or c.latest_message_id=$6 or c.message_snapshot->>'id'=$6)))
  and (nullif($8, '')::uuid is null or exists (
    select 1 from communications_email_collaboration_participants participant
    where participant.company_id=c.company_id
      and participant.collaboration_id=c.collaboration_id
      and participant.user_id=nullif($8, '')::uuid
  ))
order by c.updated_timestamp desc
limit 1`, companyID, scope.scopeType, scope.personalUserID, scope.personalAccountEmail, scope.sharedInboxID, messageID, threadID, participantUserID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsEmailCollaboration{}, ErrNotFound
	}
	if err != nil {
		return domain.CommunicationsEmailCollaboration{}, err
	}
	item.Participants, err = listPostgresEmailCollaborationParticipants(ctx, q, companyID, item.CollaborationID)
	return item, err
}

func postgresEmailCollaborationLookupForEnsure(ctx context.Context, q emailCollaborationQueryer, input CommunicationsEmailCollaborationEnsureInput, scope communicationsEmailCollaborationScope) (domain.CommunicationsEmailCollaboration, error) {
	// A known provider thread is canonical. The exact source-message fallback is
	// consulted second so a retry can attach a newly learned thread id to the
	// original fallback row without ever looking in another mailbox scope.
	if input.Message.ThreadID != "" {
		item, err := postgresEmailCollaborationLookup(ctx, q, input.CompanyID, scope, "", input.Message.ThreadID, "")
		if err == nil || !errors.Is(err, ErrNotFound) {
			return item, err
		}
	}
	return postgresEmailCollaborationLookup(ctx, q, input.CompanyID, scope, input.Message.ID, "", "")
}

func reconcilePostgresEnsuredEmailCollaborationTx(ctx context.Context, tx *sql.Tx, existing domain.CommunicationsEmailCollaboration, input CommunicationsEmailCollaborationEnsureInput) (domain.CommunicationsEmailCollaboration, error) {
	providerThreadID := strings.TrimSpace(existing.ProviderThreadID)
	incomingThreadID := strings.TrimSpace(input.Message.ThreadID)
	message := existing.Message
	changed := false
	if providerThreadID == "" && incomingThreadID != "" {
		providerThreadID = incomingThreadID
		changed = true
	}
	if shouldAdvanceEmailCollaborationMessage(existing.Message, input.Message) {
		message = mergeEmailMessageSnapshot(existing.Message, input.Message)
		changed = true
	}
	if providerThreadID != "" && message.ThreadID != providerThreadID {
		message.ThreadID = providerThreadID
		changed = true
	}
	if !changed {
		return existing, nil
	}
	snapshot, err := json.Marshal(message)
	if err != nil {
		return domain.CommunicationsEmailCollaboration{}, err
	}
	if _, err := tx.ExecContext(ctx, `
update communications_email_collaborations
set provider_thread_id=$3,
    latest_message_id=$4,
    message_snapshot=$5::jsonb,
    updated_timestamp=now()
where company_id=$1::uuid and collaboration_id=$2::uuid`,
		existing.CompanyID, existing.CollaborationID, providerThreadID, message.ID, string(snapshot)); err != nil {
		return domain.CommunicationsEmailCollaboration{}, err
	}
	return postgresEmailCollaborationByID(ctx, tx, existing.CompanyID, existing.CollaborationID, "")
}

func (r *PostgresRepo) EnsureCommunicationsEmailCollaboration(input CommunicationsEmailCollaborationEnsureInput) (CommunicationsEmailCollaborationEnsureResult, error) {
	input, scope, err := normalizeCommunicationsEmailCollaborationEnsureInput(input)
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("begin_transaction", err)
	}
	defer tx.Rollback()
	// The immutable mailbox scope is the convergence boundary. A request keyed
	// by the message fallback and a retry carrying a newly known thread id must
	// acquire the same lock.
	lockKey := communicationsEmailCollaborationScopeLockKey(input.CompanyID, scope)
	if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("lock_scope", err)
	}
	var member bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from company_memberships where company_id=$1::uuid and user_id=$2::uuid)`, input.CompanyID, input.CreatedByUserID).Scan(&member); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("check_creator_membership", err)
	}
	if !member {
		return CommunicationsEmailCollaborationEnsureResult{}, ErrPrincipalNotInCompany
	}
	threadInput := CommunicationsEmailThreadUpsertInput{
		CompanyID: input.CompanyID, PersonalUserID: scope.personalUserID,
		PersonalAccountEmail: scope.personalAccountEmail, SharedInboxID: scope.sharedInboxID,
		AccountEmail: scope.accountEmail, ProviderThreadID: input.Message.ThreadID,
		SelectedMessageID: input.Message.ID, Messages: []domain.EmailMessageSnapshot{input.Message},
		HistoryComplete: input.Message.ThreadID == "", FetchedAt: time.Now().UTC(),
		RequestDownload: true, RequestedByUserID: input.CreatedByUserID,
	}
	thread, err := upsertPostgresCommunicationsEmailThreadTx(ctx, tx, threadInput)
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("persist_email_thread", err)
	}
	if existing, err := postgresEmailCollaborationLookupForEnsure(ctx, tx, input, scope); err == nil {
		existing, err = reconcilePostgresEnsuredEmailCollaborationTx(ctx, tx, existing, input)
		if err != nil {
			return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("reconcile_existing", err)
		}
		if _, err := tx.ExecContext(ctx, `
update communications_email_collaborations
set email_thread_id=$3::uuid, updated_timestamp=now()
where company_id=$1::uuid and collaboration_id=$2::uuid`, input.CompanyID, existing.CollaborationID, thread.EmailThreadID); err != nil {
			return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("link_existing_thread", err)
		}
		if err := linkPostgresCommunicationsEmailThreadToNodeTx(ctx, tx, input.CompanyID, existing.NodeID, existing.AttachedEmailInformationID, thread.EmailThreadID, input.Message.ID, input.CreatedByUserID); err != nil {
			return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("link_existing_node_thread", err)
		}
		if downloadScope, requestedMessageID, ok := communicationsEmailThreadDownloadRequest(thread, threadInput); ok {
			if _, _, err := ensurePostgresCommunicationsEmailThreadDownloadJobTx(ctx, tx, input.CompanyID, thread.EmailThreadID, downloadScope, requestedMessageID, input.CreatedByUserID); err != nil {
				return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("queue_thread_download", err)
			}
		}
		existing, err = postgresEmailCollaborationByID(ctx, tx, input.CompanyID, existing.CollaborationID, "")
		if err != nil {
			return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("reload_existing", err)
		}
		if err := tx.Commit(); err != nil {
			return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("commit_existing", err)
		}
		return CommunicationsEmailCollaborationEnsureResult{Collaboration: existing}, nil
	} else if !errors.Is(err, ErrNotFound) {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("lookup_existing", err)
	}
	nodeID, informationID, collaborationID := newUUIDv7String(), newUUIDv7String(), newUUIDv7String()
	if _, err := tx.ExecContext(ctx, `
insert into nodes (company_id, node_id, name, priority, default_access, created_timestamp)
values ($1::uuid, $2::uuid, $3, $4, 'no_access', now())`, input.CompanyID, nodeID, communicationsEmailCollaborationTitle(input.Message), input.Priority); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("insert_node", err)
	}
	information := communicationsEmailAttachedProjectionPayloadWithThread(informationID, collaborationID, thread.EmailThreadID, input)
	if _, err := tx.ExecContext(ctx, `
insert into node_information (company_id, information_id, node_id, type, information, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, 'Attached email'::information_type, $4, now(), now())`, input.CompanyID, informationID, nodeID, information); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("insert_attached_email_history", err)
	}
	if _, err := tx.ExecContext(ctx, `
insert into node_projection_table (company_id, node_id, information_id, type, information, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, 'Attached email'::information_type, $4, now(), now())`, input.CompanyID, nodeID, informationID, information); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("insert_attached_email_projection", err)
	}
	if _, _, err := placeEmailCollaborationNodeInDefaultFolderTx(ctx, tx, input.CompanyID, nodeID, input.CreatedByUserID); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("place_explorer_node", err)
	}
	snapshot, err := json.Marshal(input.Message)
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("encode_message_snapshot", err)
	}
	if _, err := tx.ExecContext(ctx, `
insert into communications_email_collaborations (
  company_id, collaboration_id, node_id, attached_email_information_id,
  scope_type, personal_user_id, personal_account_email, shared_inbox_id, account_email,
  provider_thread_id, root_message_id, latest_message_id, email_thread_id, message_snapshot, created_by_user_id,
  created_timestamp, updated_timestamp
) values (
  $1::uuid, $2::uuid, $3::uuid, $4::uuid,
  $5, nullif($6, '')::uuid, nullif($7, ''), nullif($8, '')::uuid, $9,
  $10, $11, $11, $12::uuid, $13::jsonb, $14::uuid, now(), now()
)`, input.CompanyID, collaborationID, nodeID, informationID, scope.scopeType,
		scope.personalUserID, scope.personalAccountEmail, scope.sharedInboxID, scope.accountEmail,
		input.Message.ThreadID, input.Message.ID, thread.EmailThreadID, string(snapshot), input.CreatedByUserID); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("insert_collaboration", err)
	}
	if _, err := tx.ExecContext(ctx, `
insert into communications_email_collaboration_participants
  (company_id, collaboration_id, user_id, added_by_user_id, added_via_type, added_via_id, created_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, $3::uuid, 'creator', null, now())`, input.CompanyID, collaborationID, input.CreatedByUserID); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("insert_creator_participant", err)
	}
	if err := linkPostgresCommunicationsEmailThreadToNodeTx(ctx, tx, input.CompanyID, nodeID, informationID, thread.EmailThreadID, input.Message.ID, input.CreatedByUserID); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("link_created_node_thread", err)
	}
	if downloadScope, requestedMessageID, ok := communicationsEmailThreadDownloadRequest(thread, threadInput); ok {
		if _, _, err := ensurePostgresCommunicationsEmailThreadDownloadJobTx(ctx, tx, input.CompanyID, thread.EmailThreadID, downloadScope, requestedMessageID, input.CreatedByUserID); err != nil {
			return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("queue_thread_download", err)
		}
	}
	if err := insertPostgresResourcePermissionTx(ctx, tx, input.CompanyID, EntityTypeNode, nodeID, resourcePermissionAssignment{SubjectType: EntityPermissionSubjectUser, SubjectID: input.CreatedByUserID, AccessLevel: EntityPermissionEdit}); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("grant_creator_access", err)
	}
	if _, err := tx.ExecContext(ctx, `
insert into resource_gvic_assignments (
  company_id, resource_type, resource_id, role, principal_type, principal_id, created_timestamp, updated_timestamp
) values ($1::uuid, 'node', $2::uuid, $3, 'user', $4::uuid, now(), now())
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id) do nothing`,
		input.CompanyID, nodeID, domain.GVICRoleGenerated, input.CreatedByUserID); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("assign_creator_gvic", err)
	}
	policySequence, err := nextPostgresResourcePolicySequenceTx(ctx, tx)
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("allocate_creator_gvic_policy", err)
	}
	if err := setPostgresResourceGVICPolicyRevisionTx(ctx, tx, input.CompanyID, EntityTypeNode, nodeID, policySequence); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("set_creator_gvic_policy", err)
	}
	gvicKey := resourceGVICKey{companyID: input.CompanyID, resourceType: EntityTypeNode, resourceID: nodeID}
	if err := syncResourceGVICEffectiveAssignmentsTx(ctx, tx, input.CompanyID, []resourceGVICKey{gvicKey}); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("sync_creator_gvic", err)
	}
	if err := syncPostgresGVICMatrixProjectionForNodeTx(ctx, tx, input.CompanyID, nodeID); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("sync_creator_gvic_projection", err)
	}
	item, err := postgresEmailCollaborationByID(ctx, tx, input.CompanyID, collaborationID, input.CreatedByUserID)
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("load_created", err)
	}
	if _, err := r.appendDomainEventTx(ctx, tx, workspaceDomainEventInput(input.CompanyID, "node_created", map[string]any{
		"node_id": nodeID, "email_collaboration_id": collaborationID,
	})); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("append_workspace_event", err)
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("commit_created", err)
	}
	return CommunicationsEmailCollaborationEnsureResult{Collaboration: item, Created: true}, nil
}

func (r *PostgresRepo) ResolveCommunicationsEmailCollaboration(input CommunicationsEmailCollaborationResolveInput) (domain.CommunicationsEmailCollaboration, error) {
	input, scope, err := normalizeCommunicationsEmailCollaborationResolveInput(input)
	if err != nil {
		return domain.CommunicationsEmailCollaboration{}, err
	}
	return postgresEmailCollaborationLookup(context.Background(), r.db, input.CompanyID, scope, input.MessageID, input.ThreadID, input.ParticipantUserID)
}

func (r *PostgresRepo) GetCommunicationsEmailCollaboration(companyID, collaborationID, participantUserID string) (domain.CommunicationsEmailCollaboration, error) {
	companyID, collaborationID, participantUserID = cleanUUIDText(companyID), cleanUUIDText(collaborationID), cleanUUIDText(participantUserID)
	if companyID == "" || collaborationID == "" || participantUserID == "" {
		return domain.CommunicationsEmailCollaboration{}, ErrInvalid
	}
	return postgresEmailCollaborationByID(context.Background(), r.db, companyID, collaborationID, participantUserID)
}

func (r *PostgresRepo) ListCommunicationsEmailCollaborations(companyID, participantUserID string) ([]domain.CommunicationsEmailCollaboration, error) {
	companyID, participantUserID = cleanUUIDText(companyID), cleanUUIDText(participantUserID)
	if companyID == "" || participantUserID == "" {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx, `
select `+postgresEmailCollaborationColumns+`
from communications_email_collaborations c
join communications_email_collaboration_participants mine
  on mine.company_id=c.company_id and mine.collaboration_id=c.collaboration_id
where c.company_id=$1::uuid and mine.user_id=$2::uuid
order by c.updated_timestamp desc, c.collaboration_id`, companyID, participantUserID)
	if err != nil {
		return nil, err
	}
	items := []domain.CommunicationsEmailCollaboration{}
	for rows.Next() {
		item, err := scanPostgresEmailCollaboration(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range items {
		items[index].Participants, err = listPostgresEmailCollaborationParticipants(ctx, r.db, companyID, items[index].CollaborationID)
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

func (r *PostgresRepo) AddCommunicationsEmailCollaborationParticipants(input CommunicationsEmailCollaborationParticipantInput) (CommunicationsEmailCollaborationParticipantResult, error) {
	input, err := normalizeCommunicationsEmailCollaborationParticipantInput(input)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	return r.addPostgresEmailCollaborationParticipants(input, "")
}

func (r *PostgresRepo) AddCommunicationsEmailCollaborationParticipantsForNode(input CommunicationsEmailCollaborationNodeParticipantInput) (CommunicationsEmailCollaborationParticipantResult, error) {
	input, err := normalizeCommunicationsEmailCollaborationNodeParticipantInput(input)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	return r.addPostgresEmailCollaborationParticipants(CommunicationsEmailCollaborationParticipantInput{CompanyID: input.CompanyID, ActorUserID: input.ActorUserID, MentionedUserIDs: input.MentionedUserIDs, MentionedGroupIDs: input.MentionedGroupIDs}, input.NodeID)
}

type postgresEmailCollaborationTarget struct {
	CollaborationID            string
	NodeID                     string
	AttachedEmailInformationID string
}

func lockPostgresEmailCollaborationTarget(ctx context.Context, tx *sql.Tx, companyID, collaborationID, nodeID string) (postgresEmailCollaborationTarget, error) {
	target := postgresEmailCollaborationTarget{}
	var err error
	if nodeID != "" {
		err = tx.QueryRowContext(ctx, `
select collaboration_id::text, node_id::text, attached_email_information_id::text
from communications_email_collaborations
where company_id=$1::uuid and node_id=$2::uuid
for update`, companyID, nodeID).Scan(&target.CollaborationID, &target.NodeID, &target.AttachedEmailInformationID)
	} else {
		err = tx.QueryRowContext(ctx, `
select collaboration_id::text, node_id::text, attached_email_information_id::text
from communications_email_collaborations
where company_id=$1::uuid and collaboration_id=$2::uuid
for update`, companyID, collaborationID).Scan(&target.CollaborationID, &target.NodeID, &target.AttachedEmailInformationID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return postgresEmailCollaborationTarget{}, ErrNotFound
	}
	return target, err
}

func (r *PostgresRepo) addPostgresEmailCollaborationParticipants(input CommunicationsEmailCollaborationParticipantInput, nodeID string) (CommunicationsEmailCollaborationParticipantResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	defer tx.Rollback()
	target, err := lockPostgresEmailCollaborationTarget(ctx, tx, input.CompanyID, input.CollaborationID, nodeID)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	input.CollaborationID = target.CollaborationID
	result, err := addPostgresEmailCollaborationParticipantsTx(ctx, tx, input, target)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	return result, nil
}

// addPostgresEmailCollaborationParticipantsTx assumes target's collaboration
// row is already locked. It deliberately does not commit so a caller can make
// the participant snapshot and chat write one acceptance transaction.
func addPostgresEmailCollaborationParticipantsTx(ctx context.Context, tx *sql.Tx, input CommunicationsEmailCollaborationParticipantInput, target postgresEmailCollaborationTarget) (CommunicationsEmailCollaborationParticipantResult, error) {
	var actorParticipant bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from communications_email_collaboration_participants where company_id=$1::uuid and collaboration_id=$2::uuid and user_id=$3::uuid)`, input.CompanyID, input.CollaborationID, input.ActorUserID).Scan(&actorParticipant); err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	if !actorParticipant {
		return CommunicationsEmailCollaborationParticipantResult{}, ErrNotFound
	}
	type provenance struct{ viaType, viaID string }
	mentioned := map[string]provenance{}
	for _, userID := range input.MentionedUserIDs {
		var member bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from company_memberships where company_id=$1::uuid and user_id=$2::uuid)`, input.CompanyID, userID).Scan(&member); err != nil {
			return CommunicationsEmailCollaborationParticipantResult{}, err
		}
		if !member {
			return CommunicationsEmailCollaborationParticipantResult{}, ErrPrincipalNotInCompany
		}
		mentioned[userID] = provenance{CommunicationsEmailCollaborationParticipantUser, userID}
	}
	for _, groupID := range input.MentionedGroupIDs {
		var groupExists bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from company_user_groups where company_id=$1::uuid and group_id=$2::uuid)`, input.CompanyID, groupID).Scan(&groupExists); err != nil {
			return CommunicationsEmailCollaborationParticipantResult{}, err
		}
		if !groupExists {
			return CommunicationsEmailCollaborationParticipantResult{}, ErrInvalid
		}
		rows, err := tx.QueryContext(ctx, `
with recursive subtree as (
  select group_id from company_user_groups where company_id=$1::uuid and group_id=$2::uuid
  union all
  select child.group_id from company_user_groups child join subtree parent on child.parent_group_id=parent.group_id where child.company_id=$1::uuid
)
select distinct member.user_id::text
from company_user_group_members member join subtree on subtree.group_id=member.group_id
where member.company_id=$1::uuid`, input.CompanyID, groupID)
		if err != nil {
			return CommunicationsEmailCollaborationParticipantResult{}, err
		}
		for rows.Next() {
			var userID string
			if err := rows.Scan(&userID); err != nil {
				rows.Close()
				return CommunicationsEmailCollaborationParticipantResult{}, err
			}
			if _, explicit := mentioned[userID]; !explicit {
				mentioned[userID] = provenance{CommunicationsEmailCollaborationParticipantGroup, groupID}
			}
		}
		if err := rows.Close(); err != nil {
			return CommunicationsEmailCollaborationParticipantResult{}, err
		}
	}
	mentionedUserIDs := make([]string, 0, len(mentioned))
	for userID, source := range mentioned {
		mentionedUserIDs = append(mentionedUserIDs, userID)
		if _, err := tx.ExecContext(ctx, `
insert into communications_email_collaboration_participants
  (company_id, collaboration_id, user_id, added_by_user_id, added_via_type, added_via_id, created_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, nullif($6, '')::uuid, now())
on conflict (company_id, collaboration_id, user_id) do nothing`, input.CompanyID, input.CollaborationID, userID, input.ActorUserID, source.viaType, source.viaID); err != nil {
			return CommunicationsEmailCollaborationParticipantResult{}, err
		}
		if err := insertPostgresResourcePermissionTx(ctx, tx, input.CompanyID, EntityTypeNode, target.NodeID, resourcePermissionAssignment{SubjectType: EntityPermissionSubjectUser, SubjectID: userID, AccessLevel: EntityPermissionEdit}); err != nil {
			return CommunicationsEmailCollaborationParticipantResult{}, err
		}
	}
	sort.Strings(mentionedUserIDs)
	participants, err := listPostgresEmailCollaborationParticipants(ctx, tx, input.CompanyID, input.CollaborationID)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	return CommunicationsEmailCollaborationParticipantResult{CollaborationID: input.CollaborationID, NodeID: target.NodeID, Participants: participants, MentionedUserIDs: mentionedUserIDs}, nil
}

func (r *PostgresRepo) UpdateCommunicationsEmailCollaborationMessage(input CommunicationsEmailCollaborationMessageInput) ([]string, error) {
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
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	item, err := scanPostgresEmailCollaboration(tx.QueryRowContext(ctx, `
select `+postgresEmailCollaborationColumns+`
from communications_email_collaborations c
where c.company_id=$1::uuid and c.scope_type=$2
  and (($2='personal' and c.personal_user_id=nullif($3, '')::uuid and c.personal_account_email=$4)
       or ($2='shared' and c.shared_inbox_id=nullif($5, '')::uuid))
  and ((nullif($7, '') is not null and c.provider_thread_id=$7) or c.root_message_id=$6 or c.latest_message_id=$6)
for update`, companyID, scope.scopeType, scope.personalUserID, scope.personalAccountEmail, scope.sharedInboxID, message.ID, message.ThreadID))
	if errors.Is(err, sql.ErrNoRows) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	thread, err := upsertPostgresCommunicationsEmailThreadTx(ctx, tx, CommunicationsEmailThreadUpsertInput{
		CompanyID: item.CompanyID, PersonalUserID: item.PersonalUserID,
		PersonalAccountEmail: item.PersonalAccountEmail, SharedInboxID: item.SharedInboxID,
		AccountEmail: item.AccountEmail, ProviderThreadID: item.ProviderThreadID,
		SelectedMessageID: item.RootMessageID, Messages: []domain.EmailMessageSnapshot{message},
		FetchedAt: time.Now().UTC(),
	})
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
update communications_email_collaborations
set email_thread_id=$3::uuid, updated_timestamp=now()
where company_id=$1::uuid and collaboration_id=$2::uuid`, item.CompanyID, item.CollaborationID, thread.EmailThreadID); err != nil {
		return nil, err
	}
	if err := linkPostgresCommunicationsEmailThreadToNodeTx(ctx, tx, item.CompanyID, item.NodeID, item.AttachedEmailInformationID, thread.EmailThreadID, item.RootMessageID, item.CreatedByUserID); err != nil {
		return nil, err
	}
	existing := item.Message
	collaborationID := item.CollaborationID
	if shouldAdvanceEmailCollaborationMessage(existing, message) {
		merged := mergeEmailMessageSnapshot(existing, message)
		snapshot, err := json.Marshal(merged)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
update communications_email_collaborations
set latest_message_id=$3,
	message_snapshot=$5::jsonb,
	provider_thread_id=case when provider_thread_id='' then $4 else provider_thread_id end,
	updated_timestamp=now()
where company_id=$1::uuid and collaboration_id=$2::uuid`, companyID, collaborationID, merged.ID, merged.ThreadID, string(snapshot)); err != nil {
			return nil, err
		}
	}
	participants, err := listPostgresEmailCollaborationParticipants(ctx, tx, companyID, collaborationID)
	if err != nil {
		return nil, err
	}
	for _, participant := range participants {
		if scope.scopeType == CommunicationsEmailCollaborationScopePersonal && participant.UserID == scope.personalUserID {
			continue
		}
		rows, err := tx.QueryContext(ctx, `
select account_email
from user_email_connections
where user_id=$1::uuid and status='connected' and btrim(grant_id)<>''
order by account_email`, participant.UserID)
		if err != nil {
			return nil, err
		}
		accountEmails := make([]string, 0)
		for rows.Next() {
			var accountEmail string
			if err := rows.Scan(&accountEmail); err != nil {
				rows.Close()
				return nil, err
			}
			accountEmails = append(accountEmails, accountEmail)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		for _, accountEmail := range accountEmails {
			outbox, err := communicationsEmailCollaborationMailboxOutboxInput(companyID, participant.UserID, accountEmail, message)
			if err != nil {
				return nil, err
			}
			if err := insertRealtimeOutboxTx(ctx, tx, outbox); err != nil {
				return nil, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	userIDs := make([]string, 0, len(participants))
	for _, participant := range participants {
		userIDs = append(userIDs, participant.UserID)
	}
	return userIDs, nil
}
