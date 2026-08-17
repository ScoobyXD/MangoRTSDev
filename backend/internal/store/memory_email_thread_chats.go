package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func memoryEmailThreadChatMessageTimestamp(message domain.CommunicationsEmailMessage) time.Time {
	if message.Message.Date > 0 {
		if message.Message.Date > 1_000_000_000_000 {
			return time.UnixMilli(message.Message.Date).UTC()
		}
		return time.Unix(message.Message.Date, 0).UTC()
	}
	return message.CreatedTimestamp
}

func (r *MemoryRepo) ListCommunicationsEmailThreadChatGroups(input CommunicationsEmailCollaborationListInput) (domain.CommunicationsEmailThreadChatView, error) {
	items, err := r.ListCommunicationsEmailCollaborations(input)
	if err != nil {
		return domain.CommunicationsEmailThreadChatView{}, err
	}
	groups := make([]domain.CommunicationsEmailThreadChatGroup, 0)
	textboxLinks := make([]domain.CommunicationsEmailThreadTextboxLink, 0)
	seen := map[string]bool{}
	seenLinks := map[string]bool{}
	for _, item := range items {
		thread, err := r.GetCommunicationsEmailThread(item.CompanyID, item.EmailThreadID)
		if err != nil {
			return domain.CommunicationsEmailThreadChatView{}, err
		}
		messageByID := map[string]domain.CommunicationsEmailMessage{}
		for _, message := range thread.Messages {
			messageByID[message.EmailMessageID] = message
		}
		node, err := r.GetNode(item.CompanyID, item.NodeID)
		if err != nil {
			return domain.CommunicationsEmailThreadChatView{}, err
		}
		projections, err := r.ListNodeProjections(item.CompanyID, item.NodeID)
		if err != nil {
			return domain.CommunicationsEmailThreadChatView{}, err
		}
		chatsByTextboxID := map[string][]domain.NodeProjection{}
		linkedMessageIDsByTextboxID := map[string][]string{}
		for _, projection := range projections {
			if isNodeTextboxChatType(projection.Type) {
				var payload nodeTextboxChatPayload
				if json.Unmarshal([]byte(projection.Information), &payload) == nil && payload.BlockID != "" {
					chatsByTextboxID[payload.BlockID] = append(chatsByTextboxID[payload.BlockID], projection)
				}
				continue
			}
			if strings.EqualFold(strings.TrimSpace(projection.Type), "Attached email") {
				var payload nodeAttachedEmailPayload
				if json.Unmarshal([]byte(projection.Information), &payload) != nil {
					continue
				}
				textboxID := cleanUUIDText(payload.BlockID)
				emailMessageID := cleanUUIDText(payload.EmailMessageID)
				if textboxID != "" && emailMessageID != "" {
					linkedMessageIDsByTextboxID[textboxID] = append(linkedMessageIDsByTextboxID[textboxID], emailMessageID)
				}
			}
		}
		var textboxDisplayOrder int64
		for _, projection := range projections {
			if !isEditorTextBoxType(projection.Type) {
				continue
			}
			currentTextboxDisplayOrder := textboxDisplayOrder
			textboxDisplayOrder++
			var payload struct {
				Title string `json:"title"`
			}
			raw := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(projection.Information), editorTextBlockProjectionPrefix))
			if json.Unmarshal([]byte(raw), &payload) != nil {
				continue
			}
			messageIDs := linkedMessageIDsByTextboxID[projection.InformationID]
			linkedMessages := make([]domain.CommunicationsEmailThreadChatLinkedMessage, 0, len(messageIDs))
			linkedMessageIDs := map[string]bool{}
			for _, emailMessageID := range messageIDs {
				cleanMessageID := cleanUUIDText(emailMessageID)
				candidate, ok := messageByID[cleanMessageID]
				if !ok || linkedMessageIDs[cleanMessageID] {
					continue
				}
				linkedMessageIDs[cleanMessageID] = true
				messageTimestamp := memoryEmailThreadChatMessageTimestamp(candidate)
				linkedMessages = append(linkedMessages, domain.CommunicationsEmailThreadChatLinkedMessage{
					EmailMessageID: candidate.EmailMessageID, ProviderMessageID: candidate.ProviderMessageID,
					MessageTimestamp: messageTimestamp,
				})
			}
			groupKey := item.NodeID + "\x1f" + projection.InformationID
			for _, linkedMessage := range linkedMessages {
				linkKey := groupKey + "\x1f" + linkedMessage.EmailMessageID
				if seenLinks[linkKey] {
					continue
				}
				seenLinks[linkKey] = true
				textboxLinks = append(textboxLinks, domain.CommunicationsEmailThreadTextboxLink{
					NodeID: item.NodeID, TextboxID: projection.InformationID,
					EmailMessageID: linkedMessage.EmailMessageID, ProviderMessageID: linkedMessage.ProviderMessageID,
				})
			}
			chats := append([]domain.NodeProjection(nil), chatsByTextboxID[projection.InformationID]...)
			if len(linkedMessages) == 0 || len(chats) == 0 || seen[groupKey] {
				continue
			}
			sort.SliceStable(chats, func(i, j int) bool {
				if !chats[i].CreatedTimestamp.Equal(chats[j].CreatedTimestamp) {
					return chats[i].CreatedTimestamp.Before(chats[j].CreatedTimestamp)
				}
				return chats[i].InformationID < chats[j].InformationID
			})
			seen[groupKey] = true
			groups = append(groups, domain.CommunicationsEmailThreadChatGroup{
				NodeID: item.NodeID, NodeName: node.Title, TextboxID: projection.InformationID,
				TextboxTitle: strings.TrimSpace(payload.Title), TextboxDisplayOrder: currentTextboxDisplayOrder,
				EmailThreadID:  thread.EmailThreadID,
				LinkedMessages: linkedMessages, Chats: chats,
			})
		}
	}
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
