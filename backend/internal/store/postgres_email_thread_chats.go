package store

import (
	"context"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
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

func (r *PostgresRepo) ListCommunicationsEmailThreadChatGroups(input CommunicationsEmailCollaborationListInput) (domain.CommunicationsEmailThreadChatView, error) {
	input, scope, err := normalizeCommunicationsEmailCollaborationListInput(input)
	if err != nil {
		return domain.CommunicationsEmailThreadChatView{}, err
	}
	ctx := context.Background()
	args := emailThreadChatQueryArgs(input, scope)
	rows, err := r.db.QueryContext(ctx, postgresEmailThreadChatTargetCTE+`
select relationship.resource_id::text,node.name,relationship.resource_textbox_id,
       coalesce(textbox.title,''),textbox.display_order,relationship.email_thread_id::text,
       relationship.email_message_id::text,message.provider_message_id,
       coalesce(message.message_timestamp,message.created_timestamp)
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
join node_textboxes textbox
  on textbox.company_id=relationship.company_id
 and textbox.node_id=relationship.resource_id
 and textbox.textbox_id::text=relationship.resource_textbox_id
 and textbox.deleted_timestamp is null
where mangorts_user_can_access_resource(
  relationship.company_id,'node',relationship.resource_id,$8::uuid,'edit')
order by relationship.resource_id,relationship.resource_textbox_id,
         coalesce(message.message_timestamp,message.created_timestamp),relationship.email_message_id`, args...)
	if err != nil {
		return domain.CommunicationsEmailThreadChatView{}, err
	}
	groups := make([]domain.CommunicationsEmailThreadChatGroup, 0)
	textboxLinks := make([]domain.CommunicationsEmailThreadTextboxLink, 0)
	groupIndex := map[string]int{}
	for rows.Next() {
		var nodeID, nodeName, textboxID, textboxTitle, emailThreadID string
		var textboxDisplayOrder int64
		var linked domain.CommunicationsEmailThreadChatLinkedMessage
		if err := rows.Scan(
			&nodeID, &nodeName, &textboxID, &textboxTitle, &textboxDisplayOrder, &emailThreadID,
			&linked.EmailMessageID, &linked.ProviderMessageID, &linked.MessageTimestamp,
		); err != nil {
			rows.Close()
			return domain.CommunicationsEmailThreadChatView{}, err
		}
		groupKey := nodeID + "\x1f" + textboxID
		index, exists := groupIndex[groupKey]
		if !exists {
			index = len(groups)
			groupIndex[groupKey] = index
			groups = append(groups, domain.CommunicationsEmailThreadChatGroup{
				NodeID: nodeID, NodeName: nodeName, TextboxID: textboxID, TextboxTitle: textboxTitle,
				TextboxDisplayOrder: textboxDisplayOrder,
				EmailThreadID:       emailThreadID, LinkedMessages: []domain.CommunicationsEmailThreadChatLinkedMessage{},
				Chats: []domain.NodeProjection{},
			})
		}
		groups[index].LinkedMessages = append(groups[index].LinkedMessages, linked)
		textboxLinks = append(textboxLinks, domain.CommunicationsEmailThreadTextboxLink{
			NodeID: nodeID, TextboxID: textboxID, EmailMessageID: linked.EmailMessageID,
			ProviderMessageID: linked.ProviderMessageID,
		})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return domain.CommunicationsEmailThreadChatView{}, err
	}
	if err := rows.Close(); err != nil {
		return domain.CommunicationsEmailThreadChatView{}, err
	}
	if len(groups) == 0 {
		return domain.CommunicationsEmailThreadChatView{Groups: groups, TextboxLinks: textboxLinks}, nil
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
		return domain.CommunicationsEmailThreadChatView{}, err
	}
	defer chatRows.Close()
	for chatRows.Next() {
		chat, err := scanNodeTextboxChatProjection(chatRows)
		if err != nil {
			return domain.CommunicationsEmailThreadChatView{}, err
		}
		var payload textboxChatPayload
		if err := json.Unmarshal([]byte(chat.Information), &payload); err != nil {
			return domain.CommunicationsEmailThreadChatView{}, err
		}
		if index, ok := groupIndex[chat.NodeID+"\x1f"+payload.BlockID]; ok {
			groups[index].Chats = append(groups[index].Chats, chat)
		}
	}
	if err := chatRows.Err(); err != nil {
		return domain.CommunicationsEmailThreadChatView{}, err
	}
	visibleGroups := make([]domain.CommunicationsEmailThreadChatGroup, 0, len(groups))
	for _, group := range groups {
		if len(group.Chats) > 0 {
			visibleGroups = append(visibleGroups, group)
		}
	}
	groups = visibleGroups
	sort.SliceStable(groups, func(i, j int) bool {
		leftNodeName := strings.ToLower(strings.TrimSpace(groups[i].NodeName))
		rightNodeName := strings.ToLower(strings.TrimSpace(groups[j].NodeName))
		if leftNodeName != rightNodeName {
			return leftNodeName < rightNodeName
		}
		if groups[i].NodeID != groups[j].NodeID {
			return groups[i].NodeID < groups[j].NodeID
		}
		if groups[i].TextboxDisplayOrder != groups[j].TextboxDisplayOrder {
			return groups[i].TextboxDisplayOrder < groups[j].TextboxDisplayOrder
		}
		return groups[i].TextboxID < groups[j].TextboxID
	})
	return domain.CommunicationsEmailThreadChatView{Groups: groups, TextboxLinks: textboxLinks}, nil
}
