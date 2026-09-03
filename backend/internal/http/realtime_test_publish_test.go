package httpapi

import (
	"context"
	"fmt"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/realtime"
	"miraeopus/backend/internal/store"
	"strings"
	"testing"
)

// enqueueRealtimeTestMessage exercises the production durable outbox boundary.
// Its caller must explicitly construct a local backplane, just as local
// development does; the lifecycle publisher remains the only delivery path.
func enqueueRealtimeTestMessage(t *testing.T, s *Server, companyID, scope string, message any) {
	t.Helper()
	payload, eventType, err := realtimeMessagePayload(message)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.enqueueRealtimeOutboxAndWake(context.Background(), store.RealtimeOutboxInput{
		CompanyID: companyID, Scope: scope, EventType: eventType, Payload: payload,
	}); err != nil {
		t.Fatal(err)
	}
	if s.realtimeBackplane == nil {
		t.Fatal("realtime test server requires an explicit backplane")
	}
}

func enqueueRealtimeEntityTestMessage(t *testing.T, s *Server, companyID, scope, resourceType, resourceID, permission string, message any) {
	t.Helper()
	payload, eventType, err := realtimeMessagePayload(message)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.enqueueRealtimeOutboxAndWake(context.Background(), store.RealtimeOutboxInput{
		CompanyID: companyID, Scope: scope, EventType: eventType, Payload: payload,
		ResourceType: resourceType, ResourceID: resourceID, Permission: permission,
	}); err != nil {
		t.Fatal(err)
	}
	if s.realtimeBackplane == nil {
		t.Fatal("realtime test server requires an explicit backplane")
	}
}

func explicitLocalRealtimeTestOptions(options ServerOptions) ServerOptions {
	options.RealtimeBackplane = realtime.NewLocalBackplane()
	return options
}

func publishKanbanChangedForTest(t *testing.T, s *Server, companyID, boardID, changeType string) {
	t.Helper()
	scope := realtimeBoardScope(boardID)
	logicGateID := store.LogicGateIDFromKanbanBoardID(boardID)
	if logicGateID == "" {
		return
	}
	enqueueRealtimeEntityTestMessage(t, s, companyID, scope, store.EntityTypeLogicGate, logicGateID, store.EntityPermissionEdit, realtimeKanbanChangedMessage{
		Type:       realtimeMessageKanbanChanged,
		CompanyID:  strings.TrimSpace(companyID),
		Scope:      scope,
		BoardID:    strings.TrimSpace(boardID),
		ChangeType: strings.TrimSpace(changeType),
	})
}

func publishKanbanChangesForEventsForTest(t *testing.T, s *Server, events []domain.DomainEvent) {
	t.Helper()
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
		publishKanbanChangedForTest(t, s, change.companyID, change.boardID, change.changeType)
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
