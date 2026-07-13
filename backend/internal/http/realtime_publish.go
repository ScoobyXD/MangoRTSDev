package httpapi

import (
	"encoding/json"
	"fmt"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"strings"
)

func (s *Server) publishRealtimeMessage(companyID, scope string, message any) int {
	return s.publishRealtimeMessageWithAudience(companyID, scope, nil, message)
}

func (s *Server) publishRealtimeMessageToUsers(companyID, scope string, userIDs []string, message any) int {
	allowedUserIDs := map[string]struct{}{}
	for _, userID := range userIDs {
		if userID = strings.TrimSpace(userID); userID != "" {
			allowedUserIDs[userID] = struct{}{}
		}
	}
	return s.publishRealtimeMessageWithAudience(companyID, scope, allowedUserIDs, message)
}

func (s *Server) publishRealtimeMessageWithAudience(companyID, scope string, allowedUserIDs map[string]struct{}, message any) int {
	companyID = strings.TrimSpace(companyID)
	scope = strings.TrimSpace(scope)
	if s == nil || s.realtimeRegistry == nil || companyID == "" || scope == "" {
		return 0
	}
	restrictedAudience := allowedUserIDs != nil
	if (restrictedAudience && len(allowedUserIDs) == 0) || !s.realtimeRegistry.hasSubscribers(companyID, scope) {
		s.recordOperationalMetric("realtime.publish_skipped_no_subscribers_count", realtimeScopeType(scope), 1, 0)
		return 0
	}
	payload, err := json.Marshal(message)
	if err != nil {
		log.Printf("failed to marshal realtime message company_id=%s scope=%s: %v", companyID, scope, err)
		return 0
	}
	published := 0
	if restrictedAudience {
		published = s.realtimeRegistry.publishToUsers(companyID, scope, payload, allowedUserIDs)
	} else {
		published = s.realtimeRegistry.publish(companyID, scope, payload)
	}
	if published == 0 {
		metric := "realtime.publish_skipped_no_subscribers_count"
		if restrictedAudience {
			metric = "realtime.publish_skipped_no_authorized_subscribers_count"
		}
		s.recordOperationalMetric(metric, realtimeScopeType(scope), 1, 0)
		return 0
	}
	s.recordOperationalMetric("realtime.messages_published", realtimeScopeType(scope), int64(published), 0)
	return published
}

func nodeChatProjectionDetails(items []domain.NodeProjection, messageID string) (string, bool) {
	messageID = strings.TrimSpace(messageID)
	for _, item := range items {
		if strings.TrimSpace(item.InformationID) != messageID || strings.TrimSpace(item.Type) != "Text block chat" {
			continue
		}
		var payload struct {
			BlockID string `json:"block_id"`
		}
		_ = json.Unmarshal([]byte(item.Information), &payload)
		return strings.TrimSpace(payload.BlockID), true
	}
	return "", false
}
func (s *Server) publishNodeChatCreated(companyID, nodeID, messageID string, item domain.NodeInformation) {
	if strings.TrimSpace(item.Type) != "Text block chat" {
		return
	}
	var payload struct {
		BlockID string `json:"block_id"`
	}
	_ = json.Unmarshal([]byte(item.Information), &payload)
	scope := realtimeChatScope(nodeID)
	s.publishRealtimeMessage(companyID, scope, realtimeChatMessage{
		Type:      realtimeMessageChatCreated,
		CompanyID: strings.TrimSpace(companyID),
		Scope:     scope,
		NodeID:    strings.TrimSpace(nodeID),
		BlockID:   strings.TrimSpace(payload.BlockID),
		MessageID: strings.TrimSpace(messageID),
	})
}

func (s *Server) publishNodeChatDeleted(companyID, nodeID, blockID, messageID string) {
	scope := realtimeChatScope(nodeID)
	s.publishRealtimeMessage(companyID, scope, realtimeChatMessage{
		Type:      realtimeMessageChatDeleted,
		CompanyID: strings.TrimSpace(companyID),
		Scope:     scope,
		NodeID:    strings.TrimSpace(nodeID),
		BlockID:   strings.TrimSpace(blockID),
		MessageID: strings.TrimSpace(messageID),
	})
}

func (s *Server) captureKanbanBoardsForDeleteTargets(companyID string, targets []store.CompanyExplorerDeleteTargetInput) []string {
	seen := map[string]bool{}
	for _, target := range targets {
		switch strings.TrimSpace(target.Kind) {
		case "node":
			rows, err := s.repo.ListKanbanBoardProjectionRowsForNode(companyID, target.ID)
			if err != nil {
				log.Printf("failed to capture board changes before node delete company_id=%s node_id=%s: %v", companyID, target.ID, err)
				continue
			}
			for _, row := range rows {
				if boardID := strings.TrimSpace(row.BoardID); boardID != "" {
					seen[boardID] = true
				}
			}
		case "logic_gate":
			if boardID := store.LogicGateKanbanBoardID(target.ID); boardID != "" {
				seen[boardID] = true
			}
		case "kanban":
			if boardID := strings.TrimSpace(target.ID); boardID != "" {
				seen[boardID] = true
			}
		}
	}
	boardIDs := make([]string, 0, len(seen))
	for boardID := range seen {
		boardIDs = append(boardIDs, boardID)
	}
	return boardIDs
}

func (s *Server) publishCapturedKanbanDeletes(companyID string, boardIDs []string) {
	for _, boardID := range boardIDs {
		s.publishKanbanChanged(companyID, boardID, "resource_deleted")
	}
}
func (s *Server) publishKanbanChanged(companyID, boardID, changeType string) {
	scope := realtimeBoardScope(boardID)
	s.publishRealtimeMessage(companyID, scope, realtimeKanbanChangedMessage{
		Type:       realtimeMessageKanbanChanged,
		CompanyID:  strings.TrimSpace(companyID),
		Scope:      scope,
		BoardID:    strings.TrimSpace(boardID),
		ChangeType: strings.TrimSpace(changeType),
	})
}

func (s *Server) publishKanbanChangesForEvents(events []domain.DomainEvent) {
	type boardChange struct {
		companyID  string
		boardID    string
		changeType string
	}
	changes := map[string]boardChange{}
	for _, event := range events {
		companyID := strings.TrimSpace(event.CompanyID)
		if companyID == "" {
			continue
		}
		if isKanbanRealtimeDomainEvent(event.Type) {
			if boardID := domainEventPayloadString(event.Payload, "board_id"); boardID != "" {
				key := companyID + "\x00" + boardID
				changes[key] = boardChange{companyID: companyID, boardID: boardID, changeType: event.Type}
			}
		}
		if strings.TrimSpace(event.Type) != "node_updated" {
			continue
		}
		nodeID := domainEventPayloadString(event.Payload, "node_id")
		if nodeID == "" {
			continue
		}
		rows, err := s.repo.ListKanbanBoardProjectionRowsForNode(companyID, nodeID)
		if err != nil {
			log.Printf("failed to resolve mounted board changes for node company_id=%s node_id=%s: %v", companyID, nodeID, err)
			continue
		}
		for _, row := range rows {
			boardID := strings.TrimSpace(row.BoardID)
			if boardID == "" {
				continue
			}
			key := companyID + "\x00" + boardID
			if _, exists := changes[key]; !exists {
				changes[key] = boardChange{companyID: companyID, boardID: boardID, changeType: "node_updated"}
			}
		}
	}
	for _, change := range changes {
		s.publishKanbanChanged(change.companyID, change.boardID, change.changeType)
	}
}

func isKanbanRealtimeDomainEvent(eventType string) bool {
	switch strings.TrimSpace(eventType) {
	case "kanban_board_saved", "kanban_board_updated", "kanban_board_deleted",
		"kanban_column_created", "kanban_column_updated", "kanban_column_deleted",
		"kanban_card_upserted", "kanban_card_moved", "kanban_card_deleted":
		return true
	default:
		return false
	}
}

func domainEventPayloadString(data map[string]any, key string) string {
	if data == nil {
		return ""
	}
	value, ok := data[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case *string:
		if typed != nil {
			return strings.TrimSpace(*typed)
		}
	}
	return strings.TrimSpace(fmt.Sprint(value))
}
