package httpapi

import (
	"fmt"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"strings"
)

// These direct helpers exist only for transport/audience tests. Production
// persisted mutations must reach this boundary through the durable outbox.
func (s *Server) publishKanbanChanged(companyID, boardID, changeType string) {
	scope := realtimeBoardScope(boardID)
	logicGateID := store.LogicGateIDFromKanbanBoardID(boardID)
	if logicGateID == "" {
		return
	}
	s.publishRealtimeMessageToCurrentEntityAudience(companyID, scope, store.EntityTypeLogicGate, logicGateID, store.EntityPermissionEdit, realtimeKanbanChangedMessage{
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
		if isKanbanRealtimeDomainEventForTest(event.Type) {
			for _, boardPayloadKey := range []string{"board_id", "source_board_id"} {
				if boardID := domainEventPayloadStringForTest(event.Payload, boardPayloadKey); boardID != "" {
					key := companyID + "\x00" + boardID
					changes[key] = boardChange{companyID: companyID, boardID: boardID, changeType: event.Type}
				}
			}
		}
		if strings.TrimSpace(event.Type) != "node_updated" || !s.realtimeRegistry.hasScopeTypeSubscribers(companyID, "board") {
			continue
		}
		nodeID := domainEventPayloadStringForTest(event.Payload, "node_id")
		if nodeID == "" {
			continue
		}
		rows, err := s.repo.ListKanbanBoardProjectionRowsForNode(companyID, nodeID)
		if err != nil {
			log.Printf("failed to resolve test board changes for node company_id=%s node_id=%s: %v", companyID, nodeID, err)
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

func isKanbanRealtimeDomainEventForTest(eventType string) bool {
	switch strings.TrimSpace(eventType) {
	case "kanban_board_saved", "kanban_board_updated", "kanban_board_deleted",
		"kanban_column_created", "kanban_column_updated", "kanban_column_deleted",
		"kanban_card_upserted", "kanban_card_moved", "kanban_card_deleted":
		return true
	default:
		return false
	}
}

func domainEventPayloadStringForTest(data map[string]any, key string) string {
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
