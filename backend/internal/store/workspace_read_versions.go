package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

var (
	NodeListWorkspaceEventTypes = []string{
		"node_created",
		"node_updated",
		"node_deleted",
		"node_permissions_updated",
		"kanban_card_upserted",
		"kanban_card_moved",
		"kanban_card_deleted",
		WorkItemLogicGateAssignmentSavedEventType,
		WorkItemLogicGateAssignmentMovedEventType,
		WorkItemLogicGateAssignmentRemovedEventType,
		WorkItemLogicGateIssueToggledEventType,
		"kanban_column_deleted",
		"kanban_board_deleted",
	}
	NodeRelationshipWorkspaceEventTypes = []string{
		"relationship_created",
		"relationship_deleted",
		"node_deleted",
	}
	LogicGateListWorkspaceEventTypes = []string{
		"logic_gate_created",
		"logic_gate_updated",
		"logic_gate_deleted",
		"logic_gate_gvic_updated",
		"logic_gate_permissions_updated",
	}
	LogicGateRelationshipWorkspaceEventTypes = []string{
		"logic_gate_relationship_created",
		"logic_gate_relationship_deleted",
		"logic_gate_deleted",
	}
	ProjectListWorkspaceEventTypes = []string{
		"project_created",
		"project_updated",
		"project_deleted",
		"project_information_created",
		"project_information_deleted",
		"project_relationship_upserted",
		"project_relationship_deleted",
		"project_permissions_updated",
	}
	NodeMapPositionWorkspaceEventTypes = []string{
		"node_map_positions_updated",
	}
	LogicGateMapPositionWorkspaceEventTypes = []string{
		"logic_gate_map_positions_updated",
	}
	CompanyExplorerFolderWorkspaceEventTypes = []string{
		"company_explorer_folder_created",
		"company_explorer_folder_updated",
		"company_explorer_folder_deleted",
		"company_explorer_folder_permissions_updated",
		"communications_shared_inbox_gvic_updated",
		"shared_triage_access_updated",
	}
	CompanyExplorerFolderItemWorkspaceEventTypes = []string{
		"company_explorer_item_placed",
		"company_explorer_item_removed",
	}
	KanbanBoardWorkspaceEventTypes = []string{
		"kanban_board_saved",
		"kanban_board_updated",
		"kanban_board_deleted",
		"logic_gate_deleted",
	}
	KanbanColumnWorkspaceEventTypes = []string{
		"kanban_column_created",
		"kanban_column_updated",
		"kanban_column_deleted",
		"kanban_board_deleted",
		"logic_gate_deleted",
	}
	KanbanCardWorkspaceEventTypes = []string{
		"kanban_card_upserted",
		"kanban_card_moved",
		"kanban_card_deleted",
		WorkItemLogicGateAssignmentSavedEventType,
		WorkItemLogicGateAssignmentMovedEventType,
		WorkItemLogicGateAssignmentRemovedEventType,
		WorkItemLogicGateIssueToggledEventType,
		"kanban_column_deleted",
		"kanban_board_deleted",
		"node_deleted",
		"logic_gate_deleted",
	}
)

type WorkspaceReadVersionQuery struct {
	CompanyID   string
	UserID      string
	Scope       string
	ResourceKey string
}

func NormalizeWorkspaceReadVersionQuery(query WorkspaceReadVersionQuery) (WorkspaceReadVersionQuery, error) {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.UserID = strings.TrimSpace(query.UserID)
	query.Scope = strings.TrimSpace(query.Scope)
	query.ResourceKey = strings.TrimSpace(query.ResourceKey)
	if query.CompanyID == "" || query.Scope == "" {
		return WorkspaceReadVersionQuery{}, ErrInvalid
	}
	return query, nil
}

func WorkspaceReadVersionUserResourceKey(userID, resourceKey string) string {
	userID = strings.TrimSpace(userID)
	resourceKey = strings.TrimSpace(resourceKey)
	if userID == "" {
		return resourceKey
	}
	return "user:" + userID + "|" + resourceKey
}

func WorkspaceReadVersionResourceKey(key, value string) string {
	key = strings.TrimSpace(key)
	value = strings.TrimSpace(value)
	if key == "" || value == "" {
		return ""
	}
	return key + ":" + value
}

func WorkspaceReadVersionStaticRows(companyID string) []WorkspaceReadVersionQuery {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil
	}
	return []WorkspaceReadVersionQuery{
		{CompanyID: companyID, Scope: "workspace-snapshot:full"},
		{CompanyID: companyID, Scope: "workspace-snapshot:node_map"},
		{CompanyID: companyID, Scope: "workspace-snapshot:node_map_window"},
		{CompanyID: companyID, Scope: "workspace-snapshot:logic_gate_map"},
		{CompanyID: companyID, Scope: "workspace-snapshot:logic_gate_map_window"},
		{CompanyID: companyID, Scope: "workspace-snapshot:company_explorer"},
		{CompanyID: companyID, Scope: "workspace-snapshot:shared_triage"},
		{CompanyID: companyID, Scope: "nodes"},
		{CompanyID: companyID, Scope: "projects"},
		{CompanyID: companyID, Scope: "node-relationships"},
		{CompanyID: companyID, Scope: "logic-gates"},
		{CompanyID: companyID, Scope: "logic-gate-relationships"},
		{CompanyID: companyID, Scope: "map-layout:node"},
		{CompanyID: companyID, Scope: "map-layout:node-window"},
		{CompanyID: companyID, Scope: "map-layout:logic_gate"},
		{CompanyID: companyID, Scope: "map-layout:logic_gate-window"},
		{CompanyID: companyID, Scope: "kanban-boards"},
	}
}

func workspaceReadVersionRowsForDomainEvent(event domain.DomainEvent) []WorkspaceReadVersionQuery {
	if !isWorkspaceStreamDomainEvent(event) {
		return nil
	}

	rows := map[string]WorkspaceReadVersionQuery{}
	add := func(scope, resourceKey string) {
		query := WorkspaceReadVersionQuery{
			CompanyID:   strings.TrimSpace(event.CompanyID),
			Scope:       strings.TrimSpace(scope),
			ResourceKey: strings.TrimSpace(resourceKey),
		}
		if query.CompanyID == "" || query.Scope == "" {
			return
		}
		rows[workspaceReadVersionMemoryKey(query.CompanyID, query.Scope, query.ResourceKey)] = query
	}
	addCompanyExplorer := func(resourceKey string) {
		add("workspace-snapshot:company_explorer", resourceKey)
	}
	addNodeMapSnapshots := func() {
		add("workspace-snapshot:node_map", "")
		add("workspace-snapshot:node_map_window", "")
	}
	addLogicGateMapSnapshots := func() {
		add("workspace-snapshot:logic_gate_map", "")
		add("workspace-snapshot:logic_gate_map_window", "")
	}
	addKanbanBoardResource := func(scope string, boardID string) {
		if boardID == "" {
			return
		}
		add(scope, WorkspaceReadVersionResourceKey("board_id", boardID))
	}

	eventType := strings.TrimSpace(event.Type)
	boardID := workspaceEventPayloadString(event.Payload, "board_id")
	targetType := workspaceEventPayloadString(event.Payload, "target_type")

	if isWorkspaceDerivedProjectionRequestEventType(eventType) {
		return nil
	}
	add("workspace-snapshot:full", "")

	if stringInList(eventType, NodeListWorkspaceEventTypes) {
		add("nodes", "")
		addNodeMapSnapshots()
		addCompanyExplorer("")
	}
	if eventType == "node_deleted" || eventType == "node_permissions_updated" {
		addCompanyExplorer("")
	}
	if stringInList(eventType, NodeRelationshipWorkspaceEventTypes) {
		add("node-relationships", "")
		addNodeMapSnapshots()
	}
	if stringInList(eventType, NodeMapPositionWorkspaceEventTypes) {
		add("map-layout:node", "")
		add("map-layout:node-window", "")
		addNodeMapSnapshots()
	}
	if eventType == "node_deleted" {
		add("map-layout:node", "")
		add("map-layout:node-window", "")
	}

	if stringInList(eventType, LogicGateListWorkspaceEventTypes) {
		add("logic-gates", "")
		addLogicGateMapSnapshots()
		addCompanyExplorer("")
	}
	if eventType == "logic_gate_deleted" || eventType == "logic_gate_permissions_updated" {
		addCompanyExplorer("")
	}
	if stringInList(eventType, LogicGateRelationshipWorkspaceEventTypes) {
		add("logic-gate-relationships", "")
		addLogicGateMapSnapshots()
	}
	if stringInList(eventType, LogicGateMapPositionWorkspaceEventTypes) {
		add("map-layout:logic_gate", "")
		add("map-layout:logic_gate-window", "")
		addLogicGateMapSnapshots()
	}
	if eventType == "logic_gate_deleted" {
		add("map-layout:logic_gate", "")
		add("map-layout:logic_gate-window", "")
	}

	if stringInList(eventType, ProjectListWorkspaceEventTypes) {
		add("projects", "")
		addCompanyExplorer("")
	}
	if eventType == "project_deleted" || eventType == "project_permissions_updated" {
		addCompanyExplorer("")
	}

	if stringInList(eventType, CompanyExplorerFolderWorkspaceEventTypes) {
		addCompanyExplorer("")
	}
	if stringInList(eventType, CompanyExplorerFolderItemWorkspaceEventTypes) {
		switch targetType {
		case "node":
			addNodeMapSnapshots()
			add("map-layout:node-window", "")
			addCompanyExplorer("")
		case "logic_gate":
			addLogicGateMapSnapshots()
			add("map-layout:logic_gate-window", "")
			addCompanyExplorer("")
		case "project":
			addCompanyExplorer("")
		}
	}

	if stringInList(eventType, KanbanBoardWorkspaceEventTypes) {
		add("kanban-boards", "")
	}
	if stringInList(eventType, KanbanColumnWorkspaceEventTypes) {
		addKanbanBoardResource("kanban-columns", boardID)
		addKanbanBoardResource("workspace-snapshot:kanban", boardID)
	}
	if stringInList(eventType, KanbanCardWorkspaceEventTypes) {
		addKanbanBoardResource("kanban-cards", boardID)
		addKanbanBoardResource("workspace-snapshot:kanban", boardID)
	}

	out := make([]WorkspaceReadVersionQuery, 0, len(rows))
	for _, row := range rows {
		out = append(out, row)
	}
	return out
}

func isWorkspaceStreamDomainEvent(event domain.DomainEvent) bool {
	companyID := strings.TrimSpace(event.CompanyID)
	return companyID != "" &&
		strings.TrimSpace(event.StreamType) == workspaceDomainStreamType &&
		strings.TrimSpace(event.StreamID) == companyID
}

func isWorkspaceDerivedProjectionRequestEventType(eventType string) bool {
	switch strings.TrimSpace(eventType) {
	case WorkspaceDerivedProjectionRequestedEventType,
		WorkspaceDeferredFolderItemAssignEventType,
		WorkspaceDeferredNodeMapPositionUpsertEventType,
		WorkspaceDeferredLogicMapPositionUpsertEventType:
		return true
	default:
		return false
	}
}

func workspaceEventPayloadString(payload map[string]any, key string) string {
	value, ok := payload[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

func stringInList(value string, items []string) bool {
	for _, item := range items {
		if value == item {
			return true
		}
	}
	return false
}
