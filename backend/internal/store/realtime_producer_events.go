package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"miraeopus/backend/internal/domain"
	"slices"
	"strings"
	"time"
)

const (
	NotificationRealtimeDeleteEach               = "deleted"
	NotificationRealtimeClear                    = "cleared"
	raciTabsRealtimeScope                        = "raci-tabs:company"
	processMapRealtimeScope                      = "process-map:company"
	processMapProtectedGeometryChangedPayloadKey = "protected_geometry_changed"
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

func isRACITabsChangedDomainEvent(event domain.DomainEvent) bool {
	if !isWorkspaceStreamDomainEvent(event) {
		return false
	}
	switch strings.TrimSpace(event.Type) {
	case LogicGateRACIUpdatedEventType,
		"company_explorer_folder_updated", "company_explorer_folder_deleted",
		"company_explorer_item_removed",
		"company_user_group_updated", "company_user_group_deleted", "company_user_group_members_updated":
		return true
	case "company_explorer_item_placed":
		return workspaceEventPayloadString(event.Payload, "target_type") == EntityTypeLogicGate
	case "resource_gvic_policy_updated":
		resourceType := workspaceEventPayloadString(event.Payload, "resource_type")
		return resourceType == EntityTypeCompanyExplorerFolder || resourceType == EntityTypeLogicGate
	default:
		return false
	}
}

func raciTabsChangedOutboxInput(companyID string, eventIDs, allowedUserIDs []string) (RealtimeOutboxInput, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" || len(eventIDs) == 0 {
		return RealtimeOutboxInput{}, ErrInvalid
	}
	payload, err := json.Marshal(map[string]any{
		"type": "raci_tabs.changed", "company_id": companyID, "scope": raciTabsRealtimeScope,
	})
	if err != nil {
		return RealtimeOutboxInput{}, err
	}
	return normalizeRealtimeOutboxInput(RealtimeOutboxInput{
		EventID:   stableRealtimeEventID("raci_tabs.changed", companyID, strings.Join(eventIDs, ",")),
		CompanyID: companyID, Scope: raciTabsRealtimeScope, EventType: "raci_tabs.changed", Payload: payload,
		AllowedUserIDs: allowedUserIDs, AudienceRestricted: true,
	})
}

func processMapChangedOutboxInput(companyID string, eventIDs, allowedUserIDs []string, originConnectionID string, protectedGeometryChanged bool) (RealtimeOutboxInput, error) {
	companyID = strings.TrimSpace(companyID)
	eventIDs = append([]string(nil), eventIDs...)
	for index := range eventIDs {
		eventIDs[index] = strings.TrimSpace(eventIDs[index])
	}
	eventIDs = slices.DeleteFunc(eventIDs, func(eventID string) bool { return eventID == "" })
	slices.Sort(eventIDs)
	eventIDs = slices.Compact(eventIDs)
	if companyID == "" || len(eventIDs) == 0 {
		return RealtimeOutboxInput{}, ErrInvalid
	}
	payloadFields := map[string]any{
		"type": "process_map.changed", "company_id": companyID, "scope": processMapRealtimeScope,
		"protected_geometry_changed": protectedGeometryChanged,
	}
	if originConnectionID = strings.TrimSpace(originConnectionID); originConnectionID != "" {
		payloadFields["origin_connection_id"] = originConnectionID
	}
	payload, err := json.Marshal(payloadFields)
	if err != nil {
		return RealtimeOutboxInput{}, err
	}
	return normalizeRealtimeOutboxInput(RealtimeOutboxInput{
		EventID:   stableRealtimeEventID("process_map.changed", companyID, strings.Join(eventIDs, ",")),
		CompanyID: companyID, Scope: processMapRealtimeScope, EventType: "process_map.changed", Payload: payload,
		AllowedUserIDs: allowedUserIDs, AudienceRestricted: true,
	})
}

func isProcessMapChangedDomainEvent(event domain.DomainEvent) bool {
	if !isWorkspaceStreamDomainEvent(event) {
		return false
	}
	eventType := strings.TrimSpace(event.Type)
	return stringInList(eventType, ProcessMapWorkspaceEventTypes) ||
		(eventType == "logic_gate_created" && workspaceEventPayloadString(event.Payload, "realtime_change_type") == "resource_restored")
}

func isDirectProcessMapMutationDomainEvent(event domain.DomainEvent) bool {
	switch strings.TrimSpace(event.Type) {
	case ProcessMapPlacementSavedEvent, ProcessMapPlacementDeletedEvent,
		ResourceOperationalRelationshipCreatedEvent, ResourceOperationalRelationshipDeletedEvent,
		ProcessMapTraceSavedEvent:
		return true
	default:
		return false
	}
}

func processMapChangedOriginConnectionIDsByCompany(events []domain.DomainEvent) map[string]string {
	originConnectionIDs := map[string]string{}
	invalid := map[string]bool{}
	for _, event := range events {
		if !isProcessMapChangedDomainEvent(event) {
			continue
		}
		companyID := strings.TrimSpace(event.CompanyID)
		if companyID == "" {
			continue
		}
		originConnectionID := workspaceEventPayloadString(event.Payload, processMapRealtimeOriginConnectionIDPayloadKey)
		if !isDirectProcessMapMutationDomainEvent(event) || originConnectionID == "" {
			invalid[companyID] = true
			continue
		}
		if existing := originConnectionIDs[companyID]; existing != "" && existing != originConnectionID {
			invalid[companyID] = true
			continue
		}
		originConnectionIDs[companyID] = originConnectionID
	}
	for companyID := range invalid {
		delete(originConnectionIDs, companyID)
	}
	return originConnectionIDs
}

func processMapChangedEventIDsByCompany(events []domain.DomainEvent) map[string][]string {
	byCompany := map[string][]string{}
	for _, event := range events {
		if !isProcessMapChangedDomainEvent(event) {
			continue
		}
		companyID := strings.TrimSpace(event.CompanyID)
		eventID := strings.TrimSpace(event.EventID)
		if companyID == "" || eventID == "" || slices.Contains(byCompany[companyID], eventID) {
			continue
		}
		byCompany[companyID] = append(byCompany[companyID], eventID)
	}
	return byCompany
}

func processMapChangedProtectedGeometryChangedByCompany(events []domain.DomainEvent) map[string]bool {
	byCompany := map[string]bool{}
	for _, event := range events {
		if !isProcessMapChangedDomainEvent(event) {
			continue
		}
		companyID := strings.TrimSpace(event.CompanyID)
		if companyID == "" {
			continue
		}
		if _, exists := byCompany[companyID]; !exists {
			byCompany[companyID] = false
		}
		if changed, ok := event.Payload[processMapProtectedGeometryChangedPayloadKey].(bool); ok && changed {
			byCompany[companyID] = true
		}
		switch strings.TrimSpace(event.Type) {
		case "logic_gate_permissions_updated", "company_explorer_folder_permissions_updated",
			"company_user_group_deleted", "company_user_group_members_updated",
			CompanyMembershipSavedEventType, CompanyMembershipDeletedEventType:
			byCompany[companyID] = true
		}
	}
	return byCompany
}

type processMapAccessAudience map[string]map[string]bool

func processMapAccessAudienceKey(resourceType, resourceID string) string {
	return strings.TrimSpace(resourceType) + "\x00" + strings.TrimSpace(resourceID)
}

func processMapAccessAudienceChanged(before, after processMapAccessAudience) bool {
	return !maps.EqualFunc(before, after, func(beforeUsers, afterUsers map[string]bool) bool {
		return maps.Equal(beforeUsers, afterUsers)
	})
}

func processMapAccessResourcesFromPlacements(root domain.ProcessMapPlacement, descendants []domain.ProcessMapPlacement) []domain.ProcessMapResourceRef {
	resources := make([]domain.ProcessMapResourceRef, 0, len(descendants)+1)
	resources = append(resources, domain.ProcessMapResourceRef{ResourceType: root.ResourceType, ResourceID: root.ResourceID})
	for _, item := range descendants {
		resources = append(resources, domain.ProcessMapResourceRef{ResourceType: item.ResourceType, ResourceID: item.ResourceID})
	}
	return resources
}

func (r *MemoryRepo) processMapAccessResourcesLocked(companyID, resourceType, resourceID string) []domain.ProcessMapResourceRef {
	root, exists := r.processMapPlacements[processMapPlacementMemoryKey(companyID, resourceType, resourceID)]
	if !exists {
		return nil
	}
	resources := []domain.ProcessMapResourceRef{{ResourceType: root.ResourceType, ResourceID: root.ResourceID}}
	if resourceType != domain.ProcessMapResourceTypeFolder {
		return resources
	}
	childrenByParent := map[string][]domain.ProcessMapPlacement{}
	for _, placement := range r.processMapPlacements {
		if placement.CompanyID != companyID || placement.MapParentFolderID == nil {
			continue
		}
		parentID := strings.TrimSpace(*placement.MapParentFolderID)
		if parentID != "" {
			childrenByParent[parentID] = append(childrenByParent[parentID], placement)
		}
	}
	queue := []string{resourceID}
	seen := map[string]bool{processMapAccessAudienceKey(root.ResourceType, root.ResourceID): true}
	for len(queue) > 0 {
		parentID := queue[0]
		queue = queue[1:]
		for _, child := range childrenByParent[parentID] {
			resourceKey := processMapAccessAudienceKey(child.ResourceType, child.ResourceID)
			if seen[resourceKey] {
				continue
			}
			seen[resourceKey] = true
			resources = append(resources, domain.ProcessMapResourceRef{ResourceType: child.ResourceType, ResourceID: child.ResourceID})
			if child.ResourceType == domain.ProcessMapResourceTypeFolder {
				queue = append(queue, child.ResourceID)
			}
		}
	}
	return resources
}

func (r *MemoryRepo) processMapAccessAudienceLocked(companyID string, resources []domain.ProcessMapResourceRef) processMapAccessAudience {
	audience := processMapAccessAudience{}
	type resolvedResource struct {
		resourceKey string
		sourceKey   string
	}
	resolvedResources := make([]resolvedResource, 0, len(resources))
	sourceDefaults := map[string]string{}
	for _, resource := range resources {
		resourceKey := processMapAccessAudienceKey(resource.ResourceType, resource.ResourceID)
		if _, exists := audience[resourceKey]; exists {
			continue
		}
		audience[resourceKey] = map[string]bool{}
		if !r.ensureV2PolicySettingsLocked(companyID, resource.ResourceType, resource.ResourceID) {
			continue
		}
		resolved := r.resolveV2PolicyLocked(companyID, resource.ResourceType, resource.ResourceID, false)
		if resolved.SourceID == "" {
			continue
		}
		sourceKey := resourcePolicyKey(companyID, resolved.SourceType, resolved.SourceID)
		resolvedResources = append(resolvedResources, resolvedResource{
			resourceKey: resourceKey, sourceKey: sourceKey,
		})
		sourceDefaults[sourceKey] = r.permissionV2Settings[sourceKey].DefaultAccess
	}

	userIDs := map[string]bool{}
	adminUserIDs := map[string]bool{}
	for _, membership := range r.memberships {
		userID := strings.TrimSpace(membership.UserID)
		if userID == "" || (membership.CompanyID != companyID && membership.Role != domain.RoleDevAdmin) {
			continue
		}
		userIDs[userID] = true
		if membership.Role == domain.RoleDevAdmin || (membership.CompanyID == companyID && membership.Role == domain.RoleCompanyAdmin) {
			adminUserIDs[userID] = true
		}
	}
	for resourceKey := range audience {
		for userID := range adminUserIDs {
			audience[resourceKey][userID] = true
		}
	}

	assignmentsBySource := map[string][]resourcePermissionAssignment{}
	for _, permission := range r.entityPermissions {
		if permission.CompanyID != companyID {
			continue
		}
		sourceKey := resourcePolicyKey(companyID, permission.EntityType, permission.EntityID)
		if _, exists := sourceDefaults[sourceKey]; !exists {
			continue
		}
		assignmentsBySource[sourceKey] = append(assignmentsBySource[sourceKey], resourcePermissionAssignment{
			SubjectType: permission.SubjectType, SubjectID: permission.SubjectID, AccessLevel: permission.AccessLevel,
		})
	}

	groupParents := map[string]string{}
	validGroupIDs := map[string]bool{}
	for _, group := range r.userGroups {
		if group.CompanyID != companyID {
			continue
		}
		groupID := strings.TrimSpace(group.GroupID)
		validGroupIDs[groupID] = true
		groupParents[groupID] = companyUserGroupParentID(group)
	}
	groupUserDepths := map[string]map[string]int{}
	for _, member := range r.userGroupMembers {
		userID := strings.TrimSpace(member.UserID)
		groupID := strings.TrimSpace(member.GroupID)
		if member.CompanyID != companyID || !userIDs[userID] || adminUserIDs[userID] || !validGroupIDs[groupID] {
			continue
		}
		seen := map[string]bool{}
		for depth := 0; groupID != "" && validGroupIDs[groupID] && !seen[groupID]; depth++ {
			seen[groupID] = true
			if groupUserDepths[groupID] == nil {
				groupUserDepths[groupID] = map[string]int{}
			}
			previousDepth, exists := groupUserDepths[groupID][userID]
			if !exists || depth < previousDepth {
				groupUserDepths[groupID][userID] = depth
			}
			groupID = groupParents[groupID]
		}
	}

	sourceAudiences := map[string]map[string]bool{}
	for sourceKey, defaultAccess := range sourceDefaults {
		allowedUserIDs := maps.Clone(adminUserIDs)
		assignments := assignmentsBySource[sourceKey]
		for userID := range userIDs {
			if adminUserIDs[userID] {
				continue
			}
			accessLevel := defaultAccess
			directMatch := false
			for _, assignment := range assignments {
				if assignment.SubjectType == EntityPermissionSubjectUser && assignment.SubjectID == userID {
					accessLevel = assignment.AccessLevel
					directMatch = true
					break
				}
			}
			if !directMatch {
				bestDepth, bestRank := int(^uint(0)>>1), int(^uint(0)>>1)
				for _, assignment := range assignments {
					if assignment.SubjectType != EntityPermissionSubjectGroup {
						continue
					}
					depth, exists := groupUserDepths[strings.TrimSpace(assignment.SubjectID)][userID]
					rank := EntityPermissionRank(assignment.AccessLevel)
					if exists && (depth < bestDepth || (depth == bestDepth && rank < bestRank)) {
						accessLevel, bestDepth, bestRank = assignment.AccessLevel, depth, rank
					}
				}
			}
			if EntityPermissionSatisfies(accessLevel, EntityPermissionEdit) {
				allowedUserIDs[userID] = true
			}
		}
		sourceAudiences[sourceKey] = allowedUserIDs
	}
	for _, resource := range resolvedResources {
		audience[resource.resourceKey] = maps.Clone(sourceAudiences[resource.sourceKey])
	}
	return audience
}

func postgresProcessMapAccessResourcesTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) ([]domain.ProcessMapResourceRef, error) {
	if resourceType != domain.ProcessMapResourceTypeFolder && resourceType != domain.ProcessMapResourceTypeProcess {
		return nil, nil
	}
	root, err := processMapPlacementByResourceTx(ctx, tx, companyID, resourceType, resourceID, true)
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	descendants := []domain.ProcessMapPlacement{}
	if resourceType == domain.ProcessMapResourceTypeFolder {
		descendants, err = postgresProcessMapDescendantsTx(ctx, tx, companyID, resourceID, true)
		if err != nil {
			return nil, err
		}
	}
	return processMapAccessResourcesFromPlacements(root, descendants), nil
}

func postgresProcessMapAccessAudienceTx(ctx context.Context, tx *sql.Tx, companyID string, resources []domain.ProcessMapResourceRef) (processMapAccessAudience, error) {
	audience := processMapAccessAudience{}
	uniqueResources := make([]domain.ProcessMapResourceRef, 0, len(resources))
	for _, resource := range resources {
		resourceKey := processMapAccessAudienceKey(resource.ResourceType, resource.ResourceID)
		if _, exists := audience[resourceKey]; exists {
			continue
		}
		audience[resourceKey] = map[string]bool{}
		uniqueResources = append(uniqueResources, resource)
	}
	if len(uniqueResources) == 0 {
		return audience, nil
	}
	resourcesJSON, err := json.Marshal(uniqueResources)
	if err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `
with requested as (
  select distinct item.resource_type,item.resource_id
  from jsonb_to_recordset($2::jsonb) item(resource_type text,resource_id uuid)
), eligible_users as (
  select distinct membership.user_id
  from company_memberships membership
  where membership.company_id=$1::uuid or membership.role='dev_admin'
)
select requested.resource_type,requested.resource_id::text,eligible_users.user_id::text
from requested
cross join eligible_users
where mangorts_user_can_access_resource(
  $1::uuid,requested.resource_type,requested.resource_id,eligible_users.user_id,$3::text
)`, companyID, string(resourcesJSON), EntityPermissionEdit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var resourceType, resourceID, userID string
		if err := rows.Scan(&resourceType, &resourceID, &userID); err != nil {
			return nil, err
		}
		audience[processMapAccessAudienceKey(resourceType, resourceID)][userID] = true
	}
	return audience, rows.Err()
}

func markProcessMapProtectedGeometryChanged(payload map[string]any, before, after processMapAccessAudience) {
	if processMapAccessAudienceChanged(before, after) {
		payload[processMapProtectedGeometryChangedPayloadKey] = true
	}
}

func processMapChangedAffectedUserIDsByCompany(events []domain.DomainEvent) map[string][]string {
	byCompany := map[string][]string{}
	for _, event := range events {
		if !isWorkspaceStreamDomainEvent(event) {
			continue
		}
		switch strings.TrimSpace(event.Type) {
		case CompanyMembershipSavedEventType, CompanyMembershipDeletedEventType:
		default:
			continue
		}
		companyID := strings.TrimSpace(event.CompanyID)
		userID := workspaceEventPayloadString(event.Payload, "user_id")
		if companyID == "" || userID == "" || slices.Contains(byCompany[companyID], userID) {
			continue
		}
		byCompany[companyID] = append(byCompany[companyID], userID)
	}
	return byCompany
}

func (r *MemoryRepo) enqueueProcessMapRealtimeForDomainEventsLocked(events []domain.DomainEvent) error {
	affectedUserIDs := processMapChangedAffectedUserIDsByCompany(events)
	originConnectionIDs := processMapChangedOriginConnectionIDsByCompany(events)
	protectedGeometryChanged := processMapChangedProtectedGeometryChangedByCompany(events)
	for companyID, eventIDs := range processMapChangedEventIDsByCompany(events) {
		allowed := []string{}
		for _, membership := range r.memberships {
			if membership.CompanyID == companyID || membership.Role == domain.RoleDevAdmin {
				allowed = append(allowed, membership.UserID)
			}
		}
		allowed = append(allowed, affectedUserIDs[companyID]...)
		slices.Sort(allowed)
		input, err := processMapChangedOutboxInput(companyID, eventIDs, allowed, originConnectionIDs[companyID], protectedGeometryChanged[companyID])
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxLocked(input); err != nil {
			return err
		}
	}
	return nil
}

func (r *PostgresRepo) enqueueProcessMapRealtimeForDomainEventsTx(ctx context.Context, tx *sql.Tx, events []domain.DomainEvent) error {
	affectedUserIDs := processMapChangedAffectedUserIDsByCompany(events)
	originConnectionIDs := processMapChangedOriginConnectionIDsByCompany(events)
	protectedGeometryChanged := processMapChangedProtectedGeometryChangedByCompany(events)
	for companyID, eventIDs := range processMapChangedEventIDsByCompany(events) {
		rows, err := tx.QueryContext(ctx, `
select distinct user_id::text
from company_memberships
where company_id=$1::uuid or role='dev_admin'
order by user_id::text`, companyID)
		if err != nil {
			return err
		}
		allowed := []string{}
		for rows.Next() {
			var userID string
			if err := rows.Scan(&userID); err != nil {
				rows.Close()
				return err
			}
			allowed = append(allowed, userID)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		allowed = append(allowed, affectedUserIDs[companyID]...)
		input, err := processMapChangedOutboxInput(companyID, eventIDs, allowed, originConnectionIDs[companyID], protectedGeometryChanged[companyID])
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, input); err != nil {
			return err
		}
	}
	return nil
}

func raciTabsChangedEventIDsByCompany(events []domain.DomainEvent) map[string][]string {
	byCompany := map[string][]string{}
	for _, event := range events {
		if !isRACITabsChangedDomainEvent(event) {
			continue
		}
		companyID := strings.TrimSpace(event.CompanyID)
		eventID := strings.TrimSpace(event.EventID)
		if companyID == "" || eventID == "" || slices.Contains(byCompany[companyID], eventID) {
			continue
		}
		byCompany[companyID] = append(byCompany[companyID], eventID)
	}
	return byCompany
}

func (r *MemoryRepo) enqueueRACITabsRealtimeForDomainEventsLocked(events []domain.DomainEvent) error {
	for companyID, eventIDs := range raciTabsChangedEventIDsByCompany(events) {
		allowed := []string{}
		for _, membership := range r.memberships {
			if membership.CompanyID == companyID || membership.Role == domain.RoleDevAdmin {
				allowed = append(allowed, membership.UserID)
			}
		}
		slices.Sort(allowed)
		input, err := raciTabsChangedOutboxInput(companyID, eventIDs, allowed)
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxLocked(input); err != nil {
			return err
		}
	}
	return nil
}

func (r *PostgresRepo) enqueueRACITabsRealtimeForDomainEventsTx(ctx context.Context, tx *sql.Tx, events []domain.DomainEvent) error {
	for companyID, eventIDs := range raciTabsChangedEventIDsByCompany(events) {
		rows, err := tx.QueryContext(ctx, `
select distinct user_id::text
from company_memberships
where company_id=$1::uuid or role='dev_admin'
order by user_id::text`, companyID)
		if err != nil {
			return err
		}
		allowed := []string{}
		for rows.Next() {
			var userID string
			if err := rows.Scan(&userID); err != nil {
				rows.Close()
				return err
			}
			allowed = append(allowed, userID)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		input, err := raciTabsChangedOutboxInput(companyID, eventIDs, allowed)
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, input); err != nil {
			return err
		}
	}
	return nil
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
