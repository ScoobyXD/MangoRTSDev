package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"miraeopus/backend/internal/domain"
	"slices"
	"strings"
	"time"
)

const (
	NotificationRealtimeDeleteEach = "deleted"
	NotificationRealtimeClear      = "cleared"
)

func stableRealtimeEventID(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	value := append([]byte(nil), sum[:16]...)
	value[6] = (value[6] & 0x0f) | 0x50
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16])
}

func notificationRealtimeScope(userID string) string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ""
	}
	return "notifications:user:" + userID
}

func notificationCreatedOutboxInput(item domain.Notification) (RealtimeOutboxInput, error) {
	scope := notificationRealtimeScope(item.RecipientUserID)
	payload, err := json.Marshal(map[string]any{
		"type": "notification.created", "company_id": item.CompanyID, "scope": scope,
		"notification": item, "ts": time.Now().UTC(),
	})
	if err != nil {
		return RealtimeOutboxInput{}, err
	}
	return normalizeRealtimeOutboxInput(RealtimeOutboxInput{
		EventID:   stableRealtimeEventID("notification.created", item.NotificationID),
		CompanyID: item.CompanyID, Scope: scope, EventType: "notification.created",
		Payload: payload, AllowedUserIDs: []string{item.RecipientUserID}, AudienceRestricted: true,
	})
}

func notificationDeletedOutboxInput(item domain.Notification) (RealtimeOutboxInput, error) {
	scope := notificationRealtimeScope(item.RecipientUserID)
	payload, err := json.Marshal(map[string]any{
		"type": "notification.deleted", "company_id": item.CompanyID, "scope": scope,
		"notification_id": item.NotificationID, "ts": time.Now().UTC(),
	})
	if err != nil {
		return RealtimeOutboxInput{}, err
	}
	return normalizeRealtimeOutboxInput(RealtimeOutboxInput{
		EventID:   stableRealtimeEventID("notification.deleted", item.NotificationID),
		CompanyID: item.CompanyID, Scope: scope, EventType: "notification.deleted",
		Payload: payload, AllowedUserIDs: []string{item.RecipientUserID}, AudienceRestricted: true,
	})
}

func notificationDeletionOutboxInputs(items []domain.Notification, mode string) ([]RealtimeOutboxInput, error) {
	if mode != NotificationRealtimeClear {
		inputs := make([]RealtimeOutboxInput, 0, len(items))
		for _, item := range items {
			input, err := notificationDeletedOutboxInput(item)
			if err != nil {
				return nil, err
			}
			inputs = append(inputs, input)
		}
		return inputs, nil
	}
	type groupKey struct{ companyID, userID string }
	groups := map[groupKey][]string{}
	for _, item := range items {
		key := groupKey{strings.TrimSpace(item.CompanyID), strings.TrimSpace(item.RecipientUserID)}
		groups[key] = append(groups[key], strings.TrimSpace(item.NotificationID))
	}
	inputs := make([]RealtimeOutboxInput, 0, len(groups))
	for key, notificationIDs := range groups {
		slices.Sort(notificationIDs)
		scope := notificationRealtimeScope(key.userID)
		payload, err := json.Marshal(map[string]any{
			"type": "notifications.cleared", "company_id": key.companyID, "scope": scope,
			"deleted_count": len(notificationIDs), "ts": time.Now().UTC(),
		})
		if err != nil {
			return nil, err
		}
		input, err := normalizeRealtimeOutboxInput(RealtimeOutboxInput{
			EventID:   stableRealtimeEventID("notifications.cleared", key.companyID, key.userID, strings.Join(notificationIDs, ",")),
			CompanyID: key.companyID, Scope: scope, EventType: "notifications.cleared",
			Payload: payload, AllowedUserIDs: []string{key.userID}, AudienceRestricted: true,
		})
		if err != nil {
			return nil, err
		}
		inputs = append(inputs, input)
	}
	return inputs, nil
}

func nodeChatOutboxInput(companyID, nodeID, blockID, messageID, eventType string) (RealtimeOutboxInput, error) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	blockID = strings.TrimSpace(blockID)
	messageID = strings.TrimSpace(messageID)
	scope := "chat:node:" + nodeID
	payload, err := json.Marshal(map[string]any{
		"type": eventType, "company_id": companyID, "scope": scope,
		"node_id": nodeID, "block_id": blockID, "message_id": messageID,
	})
	if err != nil {
		return RealtimeOutboxInput{}, err
	}
	return normalizeRealtimeOutboxInput(RealtimeOutboxInput{
		EventID:   stableRealtimeEventID(eventType, companyID, nodeID, messageID),
		CompanyID: companyID, Scope: scope, EventType: eventType,
		ResourceType: EntityTypeNode, ResourceID: nodeID, Permission: EntityPermissionEdit,
		Payload: payload,
	})
}

func nodeChatCreatedOutboxInput(item domain.NodeInformation, messageID string) (RealtimeOutboxInput, error) {
	if !strings.EqualFold(strings.TrimSpace(item.Type), "Text block chat") {
		return RealtimeOutboxInput{}, ErrInvalid
	}
	var body struct {
		BlockID string `json:"block_id"`
	}
	_ = json.Unmarshal([]byte(item.Information), &body)
	return nodeChatOutboxInput(item.CompanyID, item.NodeID, body.BlockID, messageID, "chat.message.created")
}

func nodeChatDeletedOutboxInput(item domain.NodeProjection) (RealtimeOutboxInput, error) {
	if !strings.EqualFold(strings.TrimSpace(item.Type), "Text block chat") {
		return RealtimeOutboxInput{}, ErrInvalid
	}
	var body struct {
		BlockID string `json:"block_id"`
	}
	_ = json.Unmarshal([]byte(item.Information), &body)
	return nodeChatOutboxInput(item.CompanyID, item.NodeID, body.BlockID, item.InformationID, "chat.message.deleted")
}

func nodeChatUpdatedOutboxInput(item domain.NodeProjection) (RealtimeOutboxInput, error) {
	if !strings.EqualFold(strings.TrimSpace(item.Type), "Text block chat") {
		return RealtimeOutboxInput{}, ErrInvalid
	}
	var body struct {
		BlockID string `json:"block_id"`
	}
	_ = json.Unmarshal([]byte(item.Information), &body)
	input, err := nodeChatOutboxInput(item.CompanyID, item.NodeID, body.BlockID, item.InformationID, "chat.message.updated")
	if err != nil {
		return RealtimeOutboxInput{}, err
	}
	// Each saved edit needs its own durable event even though the comment ID is stable.
	input.EventID = stableRealtimeEventID("chat.message.updated", item.CompanyID, item.NodeID, item.InformationID, item.Information)
	return input, nil
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

func directKanbanBoardIDsForDomainEvent(event domain.DomainEvent) map[string]string {
	boardIDs := map[string]string{}
	changeType := strings.TrimSpace(event.Type)
	if override := workspaceEventPayloadString(event.Payload, "realtime_change_type"); override != "" {
		changeType = override
	}
	if isKanbanRealtimeDomainEvent(event.Type) {
		for _, key := range []string{"board_id", "source_board_id"} {
			boardID := workspaceEventPayloadString(event.Payload, key)
			if LogicGateIDFromKanbanBoardID(boardID) != "" {
				boardIDs[boardID] = changeType
			}
		}
	}
	switch strings.TrimSpace(event.Type) {
	case "logic_gate_deleted", "logic_gate_created", "logic_gate_updated":
		logicGateID := workspaceEventPayloadString(event.Payload, "logic_gate_id")
		if boardID := LogicGateKanbanBoardID(logicGateID); logicGateID != "" {
			boardIDs[boardID] = changeType
		}
	}
	return boardIDs
}

func companyExplorerTargetWorkspaceEventInputs(companyID string, targets []CompanyExplorerDeletedTarget, restored bool) []DomainEventInput {
	inputs := make([]DomainEventInput, 0, len(targets))
	for _, target := range targets {
		payload := map[string]any{"realtime_change_type": "resource_deleted"}
		eventType := ""
		switch strings.TrimSpace(target.Kind) {
		case "folder":
			eventType = "company_explorer_folder_deleted"
			payload["folder_id"] = target.ID
			payload["folder_kind"] = target.FolderKind
		case "node":
			eventType = "node_deleted"
			payload["node_id"] = target.ID
		case "logic_gate":
			eventType = "logic_gate_deleted"
			payload["logic_gate_id"] = target.ID
			payload["realtime_audience_snapshot"] = true
		case "project":
			eventType = "project_deleted"
			payload["project_id"] = target.ID
		case "kanban":
			eventType = "kanban_board_deleted"
			payload["board_id"] = target.ID
			payload["realtime_audience_snapshot"] = true
		}
		if restored {
			payload["realtime_change_type"] = "resource_restored"
			delete(payload, "realtime_audience_snapshot")
			switch strings.TrimSpace(target.Kind) {
			case "folder":
				eventType = "company_explorer_folder_created"
			case "node":
				eventType = "node_created"
			case "logic_gate":
				eventType = "logic_gate_created"
			case "project":
				eventType = "project_created"
			case "kanban":
				eventType = "kanban_board_saved"
			}
		}
		if eventType != "" {
			inputs = append(inputs, workspaceDomainEventInput(companyID, eventType, payload))
		}
	}
	return inputs
}

func kanbanChangedOutboxInput(event domain.DomainEvent, boardID, changeType string) (RealtimeOutboxInput, error) {
	return kanbanChangedOutboxInputForEvents(event.CompanyID, boardID, changeType, []string{event.EventID}, nil, false)
}

func kanbanChangedOutboxInputForEvents(companyID, boardID, changeType string, eventIDs, allowedUserIDs []string, audienceRestricted bool) (RealtimeOutboxInput, error) {
	companyID = strings.TrimSpace(companyID)
	boardID = strings.TrimSpace(boardID)
	logicGateID := LogicGateIDFromKanbanBoardID(boardID)
	scope := "board:" + boardID
	if companyID == "" || logicGateID == "" || len(eventIDs) == 0 {
		return RealtimeOutboxInput{}, ErrInvalid
	}
	payload, err := json.Marshal(map[string]any{
		"type": "kanban.changed", "company_id": companyID, "scope": scope,
		"board_id": boardID, "change_type": strings.TrimSpace(changeType),
	})
	if err != nil {
		return RealtimeOutboxInput{}, err
	}
	input := RealtimeOutboxInput{
		EventID:   stableRealtimeEventID("kanban.changed", strings.Join(eventIDs, ","), boardID),
		CompanyID: companyID, Scope: scope, EventType: "kanban.changed", Payload: payload,
		AllowedUserIDs: allowedUserIDs, AudienceRestricted: audienceRestricted,
	}
	if !audienceRestricted {
		input.ResourceType = EntityTypeLogicGate
		input.ResourceID = logicGateID
		input.Permission = EntityPermissionEdit
	}
	return normalizeRealtimeOutboxInput(input)
}

type kanbanRealtimeChange struct {
	companyID          string
	boardID            string
	changeType         string
	eventIDs           []string
	audienceRestricted bool
}

func appendKanbanRealtimeEventID(change kanbanRealtimeChange, eventID string) kanbanRealtimeChange {
	eventID = strings.TrimSpace(eventID)
	if eventID == "" || slices.Contains(change.eventIDs, eventID) {
		return change
	}
	change.eventIDs = append(change.eventIDs, eventID)
	return change
}

func kanbanRealtimeChangeKey(companyID, boardID string) string {
	return strings.TrimSpace(companyID) + "\x00" + strings.TrimSpace(boardID)
}

func domainEventSnapshotsRealtimeAudience(event domain.DomainEvent) bool {
	value, _ := event.Payload["realtime_audience_snapshot"].(bool)
	return value
}

func nodeDomainEventKanbanChangeType(eventType string) (string, bool) {
	switch strings.TrimSpace(eventType) {
	case "node_updated":
		return "node_updated", true
	case "node_deleted":
		return "resource_deleted", true
	case "node_created":
		return "resource_restored", true
	default:
		return "", false
	}
}

func (r *MemoryRepo) enqueueKanbanRealtimeForDomainEventLocked(event domain.DomainEvent) error {
	return r.enqueueKanbanRealtimeForDomainEventsLocked([]domain.DomainEvent{event})
}

func (r *MemoryRepo) enqueueKanbanRealtimeForDomainEventsLocked(events []domain.DomainEvent) error {
	changes := map[string]kanbanRealtimeChange{}
	for _, event := range events {
		for boardID, changeType := range directKanbanBoardIDsForDomainEvent(event) {
			key := kanbanRealtimeChangeKey(event.CompanyID, boardID)
			change := changes[key]
			change.companyID, change.boardID, change.changeType = event.CompanyID, boardID, changeType
			change.audienceRestricted = change.audienceRestricted || domainEventSnapshotsRealtimeAudience(event)
			changes[key] = appendKanbanRealtimeEventID(change, event.EventID)
		}
		changeType, resolveNode := nodeDomainEventKanbanChangeType(event.Type)
		if !resolveNode {
			continue
		}
		nodeID := workspaceEventPayloadString(event.Payload, "node_id")
		for _, row := range r.kanbanProjectionRowsForNodeLocked(event.CompanyID, nodeID) {
			boardID := strings.TrimSpace(row.BoardID)
			if LogicGateIDFromKanbanBoardID(boardID) == "" {
				continue
			}
			key := kanbanRealtimeChangeKey(event.CompanyID, boardID)
			change := changes[key]
			change.companyID, change.boardID = event.CompanyID, boardID
			if change.changeType == "" {
				change.changeType = changeType
			}
			changes[key] = appendKanbanRealtimeEventID(change, event.EventID)
		}
	}
	for _, change := range changes {
		var allowedUserIDs []string
		if change.audienceRestricted {
			allowedUserIDs = mapKeys(r.effectiveUserIDsForResourceLocked(change.companyID, EntityTypeLogicGate, LogicGateIDFromKanbanBoardID(change.boardID), EntityPermissionEdit))
			slices.Sort(allowedUserIDs)
		}
		input, err := kanbanChangedOutboxInputForEvents(change.companyID, change.boardID, change.changeType, change.eventIDs, allowedUserIDs, change.audienceRestricted)
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxLocked(input); err != nil {
			return err
		}
	}
	return nil
}

func postgresEffectiveUsersForResourceTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID, accessLevel string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `
select distinct membership.user_id::text
from company_memberships membership
where (membership.company_id=$1::uuid or membership.role='dev_admin')
  and mangorts_user_can_access_resource($1::uuid, $2::text, $3::uuid, membership.user_id, $4::text)
order by membership.user_id::text`, companyID, resourceType, resourceID, accessLevel)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	userIDs := []string{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		userIDs = append(userIDs, userID)
	}
	return userIDs, rows.Err()
}

func (r *PostgresRepo) enqueueKanbanRealtimeForDomainEventTx(ctx context.Context, tx *sql.Tx, event domain.DomainEvent) error {
	return r.enqueueKanbanRealtimeForDomainEventsTx(ctx, tx, []domain.DomainEvent{event})
}

func (r *PostgresRepo) enqueueKanbanRealtimeForDomainEventsTx(ctx context.Context, tx *sql.Tx, events []domain.DomainEvent) error {
	changes := map[string]kanbanRealtimeChange{}
	for _, event := range events {
		for boardID, changeType := range directKanbanBoardIDsForDomainEvent(event) {
			key := kanbanRealtimeChangeKey(event.CompanyID, boardID)
			change := changes[key]
			change.companyID, change.boardID, change.changeType = event.CompanyID, boardID, changeType
			change.audienceRestricted = change.audienceRestricted || domainEventSnapshotsRealtimeAudience(event)
			changes[key] = appendKanbanRealtimeEventID(change, event.EventID)
		}
		changeType, resolveNode := nodeDomainEventKanbanChangeType(event.Type)
		if !resolveNode {
			continue
		}
		nodeID := workspaceEventPayloadString(event.Payload, "node_id")
		if nodeID == "" {
			continue
		}
		rows, err := postgresKanbanProjectionRowsForNodeTx(ctx, tx, event.CompanyID, nodeID)
		if err != nil {
			return err
		}
		for _, row := range rows {
			boardID := strings.TrimSpace(row.BoardID)
			if LogicGateIDFromKanbanBoardID(boardID) == "" {
				continue
			}
			key := kanbanRealtimeChangeKey(event.CompanyID, boardID)
			change := changes[key]
			change.companyID, change.boardID = event.CompanyID, boardID
			if change.changeType == "" {
				change.changeType = changeType
			}
			changes[key] = appendKanbanRealtimeEventID(change, event.EventID)
		}
	}
	for _, change := range changes {
		var allowedUserIDs []string
		if change.audienceRestricted {
			var err error
			allowedUserIDs, err = postgresEffectiveUsersForResourceTx(ctx, tx, change.companyID, EntityTypeLogicGate, LogicGateIDFromKanbanBoardID(change.boardID), EntityPermissionEdit)
			if err != nil {
				return err
			}
		}
		input, err := kanbanChangedOutboxInputForEvents(change.companyID, change.boardID, change.changeType, change.eventIDs, allowedUserIDs, change.audienceRestricted)
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, input); err != nil {
			return err
		}
	}
	return nil
}
