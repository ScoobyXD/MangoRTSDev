package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

func (r *MemoryRepo) ListCommunicationsEmailThreadChatGroups(input CommunicationsEmailCollaborationListInput) ([]domain.CommunicationsEmailThreadChatGroup, error) {
	items, err := r.ListCommunicationsEmailCollaborations(input)
	if err != nil {
		return nil, err
	}
	groups := make([]domain.CommunicationsEmailThreadChatGroup, 0)
	seen := map[string]bool{}
	for _, item := range items {
		thread, err := r.GetCommunicationsEmailThread(item.CompanyID, item.EmailThreadID)
		if err != nil {
			return nil, err
		}
		messageByID := map[string]domain.CommunicationsEmailMessage{}
		for _, message := range thread.Messages {
			messageByID[message.EmailMessageID] = message
		}
		node, err := r.GetNode(item.CompanyID, item.NodeID)
		if err != nil {
			return nil, err
		}
		projections, err := r.ListNodeProjections(item.CompanyID, item.NodeID)
		if err != nil {
			return nil, err
		}
		chatsByTextboxID := map[string][]domain.NodeProjection{}
		for _, projection := range projections {
			if !isNodeTextboxChatType(projection.Type) {
				continue
			}
			var payload nodeTextboxChatPayload
			if json.Unmarshal([]byte(projection.Information), &payload) == nil && payload.BlockID != "" {
				chatsByTextboxID[payload.BlockID] = append(chatsByTextboxID[payload.BlockID], projection)
			}
		}
		for _, projection := range projections {
			if !isEditorTextBoxType(projection.Type) {
				continue
			}
			var payload struct {
				EmailMessageID  string   `json:"email_message_id"`
				EmailMessageIDs []string `json:"email_message_ids"`
			}
			raw := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(projection.Information), editorTextBlockProjectionPrefix))
			if json.Unmarshal([]byte(raw), &payload) != nil {
				continue
			}
			messageIDs := append([]string(nil), payload.EmailMessageIDs...)
			if payload.EmailMessageID != "" {
				messageIDs = append(messageIDs, payload.EmailMessageID)
			}
			var message domain.CommunicationsEmailMessage
			foundMessage := false
			for _, emailMessageID := range messageIDs {
				candidate, ok := messageByID[cleanUUIDText(emailMessageID)]
				if !ok {
					continue
				}
				if !foundMessage || candidate.MessageOrder < message.MessageOrder {
					message, foundMessage = candidate, true
				}
			}
			groupKey := item.NodeID + "\x1f" + projection.InformationID
			chats := chatsByTextboxID[projection.InformationID]
			if !foundMessage || len(chats) == 0 || seen[groupKey] {
				continue
			}
			seen[groupKey] = true
			groups = append(groups, domain.CommunicationsEmailThreadChatGroup{
				NodeID: item.NodeID, NodeName: node.Title, TextboxID: projection.InformationID, RelationshipID: item.CollaborationID,
				EmailThreadID: thread.EmailThreadID, EmailMessageID: message.EmailMessageID,
				ProviderMessageID: message.ProviderMessageID, MessageOrder: message.MessageOrder,
				Chats: append([]domain.NodeProjection(nil), chats...),
			})
		}
	}
	sort.SliceStable(groups, func(i, j int) bool {
		if groups[i].MessageOrder != groups[j].MessageOrder {
			return groups[i].MessageOrder < groups[j].MessageOrder
		}
		if groups[i].NodeName != groups[j].NodeName {
			return groups[i].NodeName < groups[j].NodeName
		}
		return groups[i].TextboxID < groups[j].TextboxID
	})
	return groups, nil
}
