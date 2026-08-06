package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"

	"time"
)

const postgresEmailCollaborationColumns = `
relationship.company_id::text,
relationship.email_relationship_id::text,
relationship.resource_id::text,
relationship.email_relationship_id::text,
case thread.email_account_type when 'personal_email_account' then 'personal' else 'shared' end,
coalesce(thread.personal_user_id::text, ''),
coalesce(thread.personal_account_email, ''),
coalesce(thread.shared_inbox_id::text, ''),
thread.email_account_email,
thread.provider,
thread.provider_thread_id,
message.email_message_id::text,
message.email_message_id::text,
relationship.email_thread_id::text,
jsonb_build_object(
 'id',message.provider_message_id,'email_message_id',message.email_message_id::text,'thread_id',thread.provider_thread_id,
 'subject',message.subject,'snippet',message.snippet,
 'body',case when btrim(message.rich_html_body)<>'' then message.rich_html_body else message.text_fallback end,
 'date',coalesce(floor(extract(epoch from message.message_timestamp)*1000)::bigint,0),
 'unread',message.unread,'starred',message.starred,
 'from',message.sender_snapshot,'to',message.to_snapshot,'cc',message.cc_snapshot,
 'bcc',message.bcc_snapshot,'reply_to',message.reply_to_snapshot,
 'attachments',message.attachment_metadata,'folders',message.folder_snapshot,
 'folder_ids',message.folder_id_snapshot,'download_complete',message.download_complete
),
'',
relationship.created_timestamp,
greatest(thread.updated_timestamp,message.updated_timestamp)`

type emailCollaborationRowScanner interface{ Scan(...any) error }
type emailCollaborationQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func scanPostgresEmailCollaboration(row emailCollaborationRowScanner) (domain.CommunicationsEmailCollaboration, error) {
	var item domain.CommunicationsEmailCollaboration
	var snapshot []byte
	err := row.Scan(&item.CompanyID, &item.CollaborationID, &item.NodeID, &item.AttachedEmailInformationID,
		&item.ScopeType, &item.PersonalUserID, &item.PersonalAccountEmail, &item.SharedInboxID,
		&item.AccountEmail, &item.Provider, &item.ProviderThreadID, &item.RootMessageID, &item.LatestMessageID,
		&item.EmailThreadID, &snapshot, &item.CreatedByUserID, &item.CreatedTimestamp, &item.UpdatedTimestamp)
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
select membership.company_id::text,relationship.email_relationship_id::text,
 membership.user_id::text,'','permission','',relationship.created_timestamp
from email_relationships relationship
join company_memberships membership on membership.company_id=relationship.company_id
where relationship.company_id=$1::uuid and relationship.email_relationship_id=$2::uuid
 and relationship.resource_type='node'
 and mangorts_user_can_access_resource(relationship.company_id,relationship.resource_type,
     relationship.resource_id,membership.user_id,'edit')
order by membership.user_id`, companyID, collaborationID)
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
	clause := ""
	args := []any{companyID, collaborationID}
	if participantUserID != "" {
		clause = ` and mangorts_user_can_access_resource(relationship.company_id,
 relationship.resource_type,relationship.resource_id,$3::uuid,'edit')`
		args = append(args, participantUserID)
	}
	item, err := scanPostgresEmailCollaboration(q.QueryRowContext(ctx, `
select `+postgresEmailCollaborationColumns+`
from email_relationships relationship
join email_threads thread on thread.company_id=relationship.company_id and thread.email_thread_id=relationship.email_thread_id
join email_messages message on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id and message.email_message_id=relationship.email_message_id
where relationship.company_id=$1::uuid and relationship.email_relationship_id=$2::uuid
 and relationship.resource_type='node' and relationship.resource_textbox_id is null`+clause, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsEmailCollaboration{}, ErrNotFound
	}
	if err != nil {
		return domain.CommunicationsEmailCollaboration{}, err
	}
	item.Participants, err = listPostgresEmailCollaborationParticipants(ctx, q, companyID, collaborationID)
	return item, err
}

func postgresEmailCollaborationLookup(ctx context.Context, q emailCollaborationQueryer, companyID string, scope communicationsEmailCollaborationScope, messageID, threadID, participantUserID, nodeID string) (domain.CommunicationsEmailCollaboration, error) {
	item, err := scanPostgresEmailCollaboration(q.QueryRowContext(ctx, `
select `+postgresEmailCollaborationColumns+`
from email_relationships relationship
join email_threads thread on thread.company_id=relationship.company_id and thread.email_thread_id=relationship.email_thread_id
join email_messages message on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id and message.email_message_id=relationship.email_message_id
where relationship.company_id=$1::uuid and relationship.resource_type='node'
 and relationship.resource_textbox_id is null and thread.email_account_type=case $2 when 'personal' then 'personal_email_account' else 'shared_email_account' end
 and (($2='personal' and thread.personal_user_id=nullif($3,'')::uuid and thread.personal_account_email=$4)
   or ($2='shared' and thread.shared_inbox_id=nullif($5,'')::uuid))
 and ((nullif($7,'') is not null and thread.provider_thread_id=$7)
   or (nullif($6,'') is not null and message.provider_message_id=$6))
 and (nullif($8,'')::uuid is null or mangorts_user_can_access_resource(
   relationship.company_id,relationship.resource_type,relationship.resource_id,nullif($8,'')::uuid,'edit'))
 and (nullif($9,'')::uuid is null or relationship.resource_id=nullif($9,'')::uuid)
order by relationship.created_timestamp desc limit 1`, companyID, scope.scopeType, scope.personalUserID,
		scope.personalAccountEmail, scope.sharedInboxID, messageID, threadID, participantUserID, nodeID))
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
	if input.Message.ThreadID != "" {
		item, err := postgresEmailCollaborationLookup(ctx, q, input.CompanyID, scope, "", input.Message.ThreadID, "", input.RequestedNodeID)
		if err == nil || !errors.Is(err, ErrNotFound) {
			return item, err
		}
	}
	return postgresEmailCollaborationLookup(ctx, q, input.CompanyID, scope, input.Message.ID, "", "", input.RequestedNodeID)
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
	if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, communicationsEmailCollaborationScopeLockKey(input.CompanyID, scope)); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("lock_scope", err)
	}
	var member bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from company_memberships where company_id=$1::uuid and user_id=$2::uuid)`, input.CompanyID, input.CreatedByUserID).Scan(&member); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	if !member {
		return CommunicationsEmailCollaborationEnsureResult{}, ErrPrincipalNotInCompany
	}
	threadInput := CommunicationsEmailThreadUpsertInput{CompanyID: input.CompanyID, PersonalUserID: scope.personalUserID,
		PersonalAccountEmail: scope.personalAccountEmail, SharedInboxID: scope.sharedInboxID, AccountEmail: scope.accountEmail, Provider: input.Provider,
		ProviderThreadID: input.Message.ThreadID, SelectedMessageID: input.Message.ID, Messages: []domain.EmailMessageSnapshot{input.Message},
		HistoryComplete: input.Message.ThreadID == "", FetchedAt: time.Now().UTC(), RequestDownload: true, RequestedByUserID: input.CreatedByUserID}
	thread, err := upsertPostgresCommunicationsEmailThreadTx(ctx, tx, threadInput)
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, wrapEmailCollaborationEnsureStage("persist_email_thread", err)
	}
	if existing, lookupErr := postgresEmailCollaborationLookupForEnsure(ctx, tx, input, scope); lookupErr == nil {
		if ds, mid, ok := communicationsEmailThreadDownloadRequest(thread, threadInput); ok {
			if _, _, err := ensurePostgresCommunicationsEmailThreadDownloadJobTx(ctx, tx, input.CompanyID, thread.EmailThreadID, ds, mid, input.CreatedByUserID); err != nil {
				return CommunicationsEmailCollaborationEnsureResult{}, err
			}
		}
		if err := tx.Commit(); err != nil {
			return CommunicationsEmailCollaborationEnsureResult{}, err
		}
		return CommunicationsEmailCollaborationEnsureResult{Collaboration: existing}, nil
	} else if !errors.Is(lookupErr, ErrNotFound) {
		return CommunicationsEmailCollaborationEnsureResult{}, lookupErr
	}
	nodeID := input.RequestedNodeID
	if nodeID == "" {
		nodeID = newUUIDv7String()
	}
	relationshipID := newUUIDv7String()
	if _, err := tx.ExecContext(ctx, `insert into nodes(company_id,node_id,name,priority,default_access,created_timestamp)
values($1::uuid,$2::uuid,$3,$4,'no_access',now())`, input.CompanyID, nodeID, communicationsEmailCollaborationTitle(input.Message), input.Priority); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	if err := linkPostgresCommunicationsEmailThreadToNodeTx(ctx, tx, input.CompanyID, nodeID, relationshipID, thread.EmailThreadID, input.Message.ID, input.CreatedByUserID); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	if ds, mid, ok := communicationsEmailThreadDownloadRequest(thread, threadInput); ok {
		if _, _, err := ensurePostgresCommunicationsEmailThreadDownloadJobTx(ctx, tx, input.CompanyID, thread.EmailThreadID, ds, mid, input.CreatedByUserID); err != nil {
			return CommunicationsEmailCollaborationEnsureResult{}, err
		}
	}
	if _, err := customizeNewPostgresResourcePermissionForCreatorTx(ctx, tx, input.CompanyID, EntityTypeNode, nodeID, input.CreatedByUserID); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	if _, err := customizeNewPostgresResourceGVICForCreatorTx(ctx, tx, resourceGVICKey{companyID: input.CompanyID, resourceType: EntityTypeNode, resourceID: nodeID}, domain.GVICRoleGenerated, input.CreatedByUserID); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	item, err := postgresEmailCollaborationByID(ctx, tx, input.CompanyID, relationshipID, input.CreatedByUserID)
	if err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	if _, err := r.appendDomainEventTx(ctx, tx, workspaceDomainEventInput(input.CompanyID, "node_created", map[string]any{"node_id": nodeID, "email_relationship_id": relationshipID})); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailCollaborationEnsureResult{}, err
	}
	return CommunicationsEmailCollaborationEnsureResult{Collaboration: item, Created: true}, nil
}

func (r *PostgresRepo) ListCommunicationsEmailCollaborations(input CommunicationsEmailCollaborationListInput) ([]domain.CommunicationsEmailCollaboration, error) {
	input, scope, err := normalizeCommunicationsEmailCollaborationListInput(input)
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx, `
select `+postgresEmailCollaborationColumns+`
from email_relationships relationship
join email_threads thread on thread.company_id=relationship.company_id and thread.email_thread_id=relationship.email_thread_id
join email_messages message on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id and message.email_message_id=relationship.email_message_id
where relationship.company_id=$1::uuid and relationship.resource_type='node'
 and relationship.resource_textbox_id is null and thread.email_account_type=case $2 when 'personal' then 'personal_email_account' else 'shared_email_account' end
 and (($2='personal' and thread.personal_user_id=nullif($3,'')::uuid and thread.personal_account_email=$4)
   or ($2='shared' and thread.shared_inbox_id=nullif($5,'')::uuid))
 and ((nullif($7,'') is not null and thread.provider_thread_id=$7)
   or (nullif($6,'') is not null and message.provider_message_id=$6))
 and mangorts_user_can_access_resource(relationship.company_id,relationship.resource_type,relationship.resource_id,$8::uuid,'edit')
order by relationship.created_timestamp desc,relationship.email_relationship_id`, input.CompanyID, scope.scopeType, scope.personalUserID,
		scope.personalAccountEmail, scope.sharedInboxID, input.MessageID, input.ThreadID, input.ParticipantUserID)
	if err != nil {
		return nil, err
	}
	items := []domain.CommunicationsEmailCollaboration{}
	for rows.Next() {
		item, scanErr := scanPostgresEmailCollaboration(rows)
		if scanErr != nil {
			rows.Close()
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range items {
		participants, participantErr := listPostgresEmailCollaborationParticipants(ctx, r.db, input.CompanyID, items[index].CollaborationID)
		if participantErr != nil {
			return nil, participantErr
		}
		items[index].Participants = participants
	}
	return items, nil
}
func (r *PostgresRepo) GetCommunicationsEmailCollaboration(companyID, collaborationID, participantUserID string) (domain.CommunicationsEmailCollaboration, error) {
	companyID, collaborationID, participantUserID = cleanUUIDText(companyID), cleanUUIDText(collaborationID), cleanUUIDText(participantUserID)
	if companyID == "" || collaborationID == "" || participantUserID == "" {
		return domain.CommunicationsEmailCollaboration{}, ErrInvalid
	}
	return postgresEmailCollaborationByID(context.Background(), r.db, companyID, collaborationID, participantUserID)
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

type postgresEmailCollaborationTarget struct{ CollaborationID, NodeID, AttachedEmailInformationID string }

func lockPostgresEmailCollaborationTarget(ctx context.Context, tx *sql.Tx, companyID, collaborationID, nodeID string) (postgresEmailCollaborationTarget, error) {
	var t postgresEmailCollaborationTarget
	var err error
	if nodeID != "" {
		err = tx.QueryRowContext(ctx, `select email_relationship_id::text,resource_id::text,email_relationship_id::text
from email_relationships where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid and resource_textbox_id is null
order by created_timestamp,email_relationship_id limit 1 for update`, companyID, nodeID).Scan(&t.CollaborationID, &t.NodeID, &t.AttachedEmailInformationID)
	} else {
		err = tx.QueryRowContext(ctx, `select email_relationship_id::text,resource_id::text,email_relationship_id::text
from email_relationships where company_id=$1::uuid and email_relationship_id=$2::uuid and resource_type='node' and resource_textbox_id is null for update`, companyID, collaborationID).Scan(&t.CollaborationID, &t.NodeID, &t.AttachedEmailInformationID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return postgresEmailCollaborationTarget{}, ErrNotFound
	}
	return t, err
}
func (r *PostgresRepo) addPostgresEmailCollaborationParticipants(input CommunicationsEmailCollaborationParticipantInput, nodeID string) (CommunicationsEmailCollaborationParticipantResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	defer tx.Rollback()
	t, err := lockPostgresEmailCollaborationTarget(ctx, tx, input.CompanyID, input.CollaborationID, nodeID)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	input.CollaborationID = t.CollaborationID
	result, err := addPostgresEmailCollaborationParticipantsTx(ctx, tx, input, t)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	return result, nil
}
func addPostgresEmailCollaborationParticipantsTx(ctx context.Context, tx *sql.Tx, input CommunicationsEmailCollaborationParticipantInput, t postgresEmailCollaborationTarget) (CommunicationsEmailCollaborationParticipantResult, error) {
	var allowed bool
	if err := tx.QueryRowContext(ctx, `select mangorts_user_can_access_resource($1::uuid,'node',$2::uuid,$3::uuid,'edit')`, input.CompanyID, t.NodeID, input.ActorUserID).Scan(&allowed); err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	if !allowed {
		return CommunicationsEmailCollaborationParticipantResult{}, ErrNotFound
	}
	policy, err := postgresV2PermissionPolicy(ctx, tx, input.CompanyID, EntityTypeNode, t.NodeID)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	permissionInputs := map[string]EntityPermissionInput{}
	for _, permission := range policy.EffectivePermissions {
		item := EntityPermissionInput{SubjectType: permission.SubjectType, SubjectID: permission.SubjectID, AccessLevel: permission.AccessLevel}
		permissionInputs[item.SubjectType+":"+item.SubjectID] = item
	}
	mentioned := map[string]bool{}
	for _, userID := range input.MentionedUserIDs {
		var member bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from company_memberships where company_id=$1::uuid and user_id=$2::uuid)`, input.CompanyID, userID).Scan(&member); err != nil {
			return CommunicationsEmailCollaborationParticipantResult{}, err
		}
		if !member {
			return CommunicationsEmailCollaborationParticipantResult{}, ErrPrincipalNotInCompany
		}
		permissionInputs[EntityPermissionSubjectUser+":"+userID] = EntityPermissionInput{SubjectType: EntityPermissionSubjectUser, SubjectID: userID, AccessLevel: EntityPermissionEdit}
		mentioned[userID] = true
	}
	for _, groupID := range input.MentionedGroupIDs {
		var exists bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from company_user_groups where company_id=$1::uuid and group_id=$2::uuid)`, input.CompanyID, groupID).Scan(&exists); err != nil {
			return CommunicationsEmailCollaborationParticipantResult{}, err
		}
		if !exists {
			return CommunicationsEmailCollaborationParticipantResult{}, ErrInvalid
		}
		permissionInputs[EntityPermissionSubjectGroup+":"+groupID] = EntityPermissionInput{SubjectType: EntityPermissionSubjectGroup, SubjectID: groupID, AccessLevel: EntityPermissionEdit}
		rows, err := tx.QueryContext(ctx, `with recursive subtree as(select group_id from company_user_groups where company_id=$1::uuid and group_id=$2::uuid union all select child.group_id from company_user_groups child join subtree parent on child.parent_group_id=parent.group_id where child.company_id=$1::uuid)
select distinct member.user_id::text from company_user_group_members member join subtree on subtree.group_id=member.group_id where member.company_id=$1::uuid`, input.CompanyID, groupID)
		if err != nil {
			return CommunicationsEmailCollaborationParticipantResult{}, err
		}
		for rows.Next() {
			var userID string
			if err := rows.Scan(&userID); err != nil {
				rows.Close()
				return CommunicationsEmailCollaborationParticipantResult{}, err
			}
			mentioned[userID] = true
		}
		if err := rows.Close(); err != nil {
			return CommunicationsEmailCollaborationParticipantResult{}, err
		}
	}
	completePermissions := make([]EntityPermissionInput, 0, len(permissionInputs))
	for _, permission := range permissionInputs {
		completePermissions = append(completePermissions, permission)
	}
	if _, err := customizeResourcePermissionPolicyTx(ctx, tx, input.CompanyID, EntityTypeNode, t.NodeID, policy.EffectiveDefaultAccess, completePermissions); err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	ids := make([]string, 0, len(mentioned))
	for id := range mentioned {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	participants, err := listPostgresEmailCollaborationParticipants(ctx, tx, input.CompanyID, input.CollaborationID)
	if err != nil {
		return CommunicationsEmailCollaborationParticipantResult{}, err
	}
	return CommunicationsEmailCollaborationParticipantResult{CollaborationID: input.CollaborationID, NodeID: t.NodeID, Participants: participants, MentionedUserIDs: ids}, nil
}
