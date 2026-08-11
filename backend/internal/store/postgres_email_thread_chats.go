package store

import (
	"context"
	"encoding/json"
	"miraeopus/backend/internal/domain"
)

const postgresEmailThreadChatTargetCTE = `
with target_thread as (
  select thread.email_thread_id
  from email_threads thread
  ` + postgresEmailCollaborationConnectionJoins + `
  where thread.company_id=$1::uuid
    and connection.connection_type=$2
    and (($2='personal' and connection.personal_user_id=nullif($3,'')::uuid and connection.account_email=$4)
      or ($2='shared' and inbox.shared_inbox_id=nullif($5,'')::uuid))
    and ((nullif($7,'') is not null and thread.provider_thread_id=$7)
      or (nullif($6,'') is not null and exists (
        select 1 from email_messages requested
        where requested.company_id=thread.company_id
          and requested.email_thread_id=thread.email_thread_id
          and requested.provider_message_id=$6
      )))
  order by thread.updated_timestamp desc,thread.email_thread_id
  limit 1
)
`

func emailThreadChatQueryArgs(input CommunicationsEmailCollaborationListInput, scope communicationsEmailCollaborationScope) []any {
	return []any{
		input.CompanyID, scope.scopeType, scope.personalUserID, scope.personalAccountEmail,
		scope.sharedInboxID, input.MessageID, input.ThreadID, input.ParticipantUserID,
	}
}

func (r *PostgresRepo) ListCommunicationsEmailThreadChatGroups(input CommunicationsEmailCollaborationListInput) ([]domain.CommunicationsEmailThreadChatGroup, error) {
	input, scope, err := normalizeCommunicationsEmailCollaborationListInput(input)
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	args := emailThreadChatQueryArgs(input, scope)
	rows, err := r.db.QueryContext(ctx, postgresEmailThreadChatTargetCTE+`
select relationship.resource_id::text,node.name,relationship.resource_textbox_id,relationship.email_relationship_id::text,
       relationship.email_thread_id::text,relationship.email_message_id::text,
       message.provider_message_id,message.message_order
from target_thread target
join email_relationships relationship
  on relationship.company_id=$1::uuid
 and relationship.email_thread_id=target.email_thread_id
 and relationship.resource_type='node'
 and relationship.resource_textbox_id is not null
join email_messages message
  on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id
 and message.email_message_id=relationship.email_message_id
join nodes node
  on node.company_id=relationship.company_id
 and node.node_id=relationship.resource_id
where mangorts_user_can_access_resource(
  relationship.company_id,'node',relationship.resource_id,$8::uuid,'edit')
  and exists (
    select 1 from node_textbox_chats chat
    where chat.company_id=relationship.company_id
      and chat.node_id=relationship.resource_id
      and chat.textbox_id::text=relationship.resource_textbox_id
      and chat.deleted_timestamp is null
  )
order by case when message.provider_message_id=$6 then 0 else 1 end,
         message.message_order,lower(node.name),relationship.resource_id,relationship.resource_textbox_id`, args...)
	if err != nil {
		return nil, err
	}
	groups := make([]domain.CommunicationsEmailThreadChatGroup, 0)
	groupIndex := map[string]int{}
	for rows.Next() {
		var group domain.CommunicationsEmailThreadChatGroup
		if err := rows.Scan(
			&group.NodeID, &group.NodeName, &group.TextboxID, &group.RelationshipID, &group.EmailThreadID,
			&group.EmailMessageID, &group.ProviderMessageID, &group.MessageOrder,
		); err != nil {
			rows.Close()
			return nil, err
		}
		group.Chats = []domain.NodeProjection{}
		groupKey := group.NodeID + "\x1f" + group.TextboxID
		if _, exists := groupIndex[groupKey]; exists {
			continue
		}
		groupIndex[groupKey] = len(groups)
		groups = append(groups, group)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if len(groups) == 0 {
		return groups, nil
	}

	chatRows, err := r.db.QueryContext(ctx, postgresEmailThreadChatTargetCTE+postgresNodeTextboxChatProjectionSelect+`
join target_thread target on true
where chat.company_id=$1::uuid
  and chat.deleted_timestamp is null
  and mangorts_user_can_access_resource(chat.company_id,'node',chat.node_id,$8::uuid,'edit')
  and exists (
    select 1
    from email_relationships relationship
    where relationship.company_id=chat.company_id
      and relationship.email_thread_id=target.email_thread_id
      and relationship.resource_type='node'
      and relationship.resource_id=chat.node_id
      and relationship.resource_textbox_id=chat.textbox_id::text
  )
order by chat.created_timestamp,chat.chat_id`, args...)
	if err != nil {
		return nil, err
	}
	defer chatRows.Close()
	for chatRows.Next() {
		chat, err := scanNodeTextboxChatProjection(chatRows)
		if err != nil {
			return nil, err
		}
		var payload nodeTextboxChatPayload
		if err := json.Unmarshal([]byte(chat.Information), &payload); err != nil {
			return nil, err
		}
		if index, ok := groupIndex[chat.NodeID+"\x1f"+payload.BlockID]; ok {
			groups[index].Chats = append(groups[index].Chats, chat)
		}
	}
	return groups, chatRows.Err()
}
