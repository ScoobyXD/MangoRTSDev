package httpapi

import (
	"errors"
	"fmt"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
)

const workspaceDomainStreamType = "workspace"

func (s *Server) handleWorkspaceSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if scope == "" {
		scope = "company_explorer"
	}
	etag, err := s.workspaceSnapshotETag(r, companyID, scope)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_read_workspace_version")
		return
	}
	if writeNotModifiedWithETag(w, r, etag) {
		return
	}
	if scope != "full" {
		s.handleScopedWorkspaceSnapshot(w, r, companyID, scope, etag)
		return
	}
	userID := s.entityPermissionActorUserID(r, companyID)
	var nodes []domain.Node
	if userID != "" {
		nodes, err = s.repo.ListVisibleNodes(companyID, userID)
	} else {
		nodes, err = s.repo.ListNodes(companyID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_nodes")
		return
	}
	nodeIDs := visibleNodeIDs(nodes)
	relationships, err := s.repo.ListNodeRelationships(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_node_relationships")
		return
	}
	relationships = filterNodeRelationshipsByVisibleNodes(relationships, nodeIDs)
	var logicGates []domain.LogicGate
	if userID != "" {
		logicGates, err = s.repo.ListVisibleLogicGates(companyID, userID)
	} else {
		logicGates, err = s.repo.ListLogicGates(companyID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gates")
		return
	}
	logicGateIDs := visibleLogicGateIDs(logicGates)
	var projects []domain.Project
	if userID != "" {
		projects, err = s.repo.ListProjects(companyID, userID)
	} else {
		projects, err = s.repo.ListProjects(companyID, "")
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_projects")
		return
	}
	projectIDs := visibleProjectIDs(projects)
	logicGateRelationships, err := s.repo.ListLogicGateRelationships(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_relationships")
		return
	}
	logicGateRelationships = filterLogicGateRelationshipsByVisibleGates(logicGateRelationships, logicGateIDs)
	var nodeFolders []domain.CompanyExplorerFolder
	if userID != "" {
		nodeFolders, err = s.repo.ListVisibleCompanyExplorerFolders(companyID, "node", userID)
	} else {
		nodeFolders, err = s.repo.ListCompanyExplorerFolders(companyID, "node")
	}
	if err != nil {
		log.Printf("workspace snapshot: failed to list node company explorer folders company_id=%s: %v", companyID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
		return
	}
	var logicGateFolders []domain.CompanyExplorerFolder
	if userID != "" {
		logicGateFolders, err = s.repo.ListVisibleCompanyExplorerFolders(companyID, "logic_gate", userID)
	} else {
		logicGateFolders, err = s.repo.ListCompanyExplorerFolders(companyID, "logic_gate")
	}
	if err != nil {
		log.Printf("workspace snapshot: failed to list logic_gate company explorer folders company_id=%s: %v", companyID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
		return
	}
	var projectFolders []domain.CompanyExplorerFolder
	if userID != "" {
		projectFolders, err = s.repo.ListVisibleCompanyExplorerFolders(companyID, "project", userID)
	} else {
		projectFolders, err = s.repo.ListCompanyExplorerFolders(companyID, "project")
	}
	if err != nil {
		log.Printf("workspace snapshot: failed to list project company explorer folders company_id=%s: %v", companyID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
		return
	}
	folders := append(append(nodeFolders, logicGateFolders...), projectFolders...)
	var folderItems []domain.CompanyExplorerFolderItem
	if userID != "" {
		folderItems, err = s.repo.ListVisibleCompanyExplorerFolderItems(companyID, "", "", userID)
	} else {
		folderItems, err = s.repo.ListCompanyExplorerFolderItems(companyID, "", "")
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_items")
		return
	}
	folderItems = filterCompanyExplorerItemsForVisibleEntities(folderItems, nodeIDs, logicGateIDs, projectIDs)
	payload := map[string]any{
		"scope":                    "full",
		"nodes":                    nodes,
		"relationships":            relationships,
		"logic_gates":              logicGates,
		"logic_gate_relationships": logicGateRelationships,
		"projects":                 projects,
		"folders":                  folders,
		"folder_items":             folderItems,
	}
	if s.legacyMapRoutesEnabled && isTruthyQueryValue(firstNonEmptyQueryValue(r, "include_legacy_map", "include_map_payloads")) {
		nodeMapPositions, err := s.repo.ListNodeMapPositions(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_node_map_positions")
			return
		}
		payload["node_map_positions"] = filterNodeMapPositionsByVisibleNodes(nodeMapPositions, nodeIDs)
		logicGateMapPositions, err := s.repo.ListLogicGateMapPositions(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_map_positions")
			return
		}
		payload["logic_gate_map_positions"] = filterLogicGateMapPositionsByVisibleGates(logicGateMapPositions, logicGateIDs)
	}
	if isTruthyQueryValue(firstNonEmptyQueryValue(r, "include_legacy_kanban", "include_kanban_payloads")) {
		payload["kanban_boards"] = logicGateProjectionBoards(logicGates, store.KanbanBoardQuery{Limit: store.KanbanMaxBoardsLimit})
	}
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, payload, etag)
}

func (s *Server) workspaceSnapshotETag(r *http.Request, companyID, scope string) (string, error) {
	resource := "workspace-snapshot:" + scope
	queries := workspaceSnapshotVersionQueries(r, scope)
	return s.workspaceEventETagWithReadVersion(r, companyID, resource, queries, workspaceSnapshotReadVersionQuery(r, companyID, scope))
}

func workspaceSnapshotVersionQueries(r *http.Request, scope string) []store.DomainEventStreamQuery {
	switch scope {
	case "node_map", "node_map_window":
		return []store.DomainEventStreamQuery{
			workspaceEventQuery(nodeListWorkspaceEventTypes...),
			workspaceEventQuery(nodeRelationshipWorkspaceEventTypes...),
			workspaceEventQuery(nodeMapPositionWorkspaceEventTypes...),
			workspaceEventQueryPayload(companyExplorerFolderWorkspaceEventTypes, folderKindPayload("node")),
			workspaceEventQueryPayload(companyExplorerFolderItemWorkspaceEventTypes, itemTypePayload("node")),
		}
	case "logic_gate_map", "logic_gate_map_window":
		return []store.DomainEventStreamQuery{
			workspaceEventQuery(logicGateListWorkspaceEventTypes...),
			workspaceEventQuery(logicGateRelationshipWorkspaceEventTypes...),
			workspaceEventQuery(logicGateMapPositionWorkspaceEventTypes...),
			workspaceEventQueryPayload(companyExplorerFolderWorkspaceEventTypes, folderKindPayload("logic_gate")),
			workspaceEventQueryPayload(companyExplorerFolderItemWorkspaceEventTypes, itemTypePayload("logic_gate")),
		}
	case "company_explorer":
		folderKind := strings.TrimSpace(r.URL.Query().Get("folder_kind"))
		switch folderKind {
		case "node":
			return []store.DomainEventStreamQuery{
				workspaceEventQuery(nodeListWorkspaceEventTypes...),
				workspaceEventQueryPayload(companyExplorerFolderItemWorkspaceEventTypes, itemTypePayload("node")),
				workspaceEventQueryPayload(companyExplorerFolderWorkspaceEventTypes, folderKindPayload("node")),
			}
		case "logic_gate":
			return []store.DomainEventStreamQuery{
				workspaceEventQuery(logicGateListWorkspaceEventTypes...),
				workspaceEventQueryPayload(companyExplorerFolderItemWorkspaceEventTypes, itemTypePayload("logic_gate")),
				workspaceEventQueryPayload(companyExplorerFolderWorkspaceEventTypes, folderKindPayload("logic_gate")),
			}
		case "communications":
			return []store.DomainEventStreamQuery{
				workspaceEventQueryPayload(companyExplorerFolderWorkspaceEventTypes, folderKindPayload("communications")),
			}
		default:
			return []store.DomainEventStreamQuery{
				workspaceEventQuery(nodeListWorkspaceEventTypes...),
				workspaceEventQuery(logicGateListWorkspaceEventTypes...),
				workspaceEventQueryPayload(companyExplorerFolderItemWorkspaceEventTypes, itemTypePayload("node")),
				workspaceEventQueryPayload(companyExplorerFolderItemWorkspaceEventTypes, itemTypePayload("logic_gate")),
				workspaceEventQueryPayload(companyExplorerFolderWorkspaceEventTypes, folderKindPayload("node")),
				workspaceEventQueryPayload(companyExplorerFolderWorkspaceEventTypes, folderKindPayload("logic_gate")),
			}
		}
	case "kanban":
		boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
		if boardID == "" {
			return nil
		}
		return []store.DomainEventStreamQuery{
			workspaceEventQueryPayload(kanbanColumnWorkspaceEventTypes, boardIDPayload(boardID)),
			workspaceEventQueryPayload(kanbanCardWorkspaceEventTypes, boardIDPayload(boardID)),
		}
	default:
		return nil
	}
}
func (s *Server) handleScopedWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID, scope, etag string) {
	switch scope {
	case "node_map":
		s.handleNodeMapWorkspaceSnapshot(w, r, companyID, etag)
	case "node_map_window":
		s.handleNodeMapWindowWorkspaceSnapshot(w, r, companyID, etag)
	case "logic_gate_map":
		s.handleLogicGateMapWorkspaceSnapshot(w, r, companyID, etag)
	case "logic_gate_map_window":
		s.handleLogicGateMapWindowWorkspaceSnapshot(w, r, companyID, etag)
	case "company_explorer":
		s.handleCompanyExplorerWorkspaceSnapshot(w, r, companyID, etag)
	case "kanban":
		s.handleKanbanWorkspaceSnapshot(w, r, companyID, etag)
	default:
		writeError(w, http.StatusBadRequest, "invalid_workspace_snapshot_scope")
	}
}

func (s *Server) handleNodeMapWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID, etag string) {
	folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
	userID := s.entityPermissionActorUserID(r, companyID)
	var nodes []domain.Node
	var relationships []domain.NodeRelationship
	var positions []domain.NodeMapPosition
	var folders []domain.CompanyExplorerFolder
	var folderItems []domain.CompanyExplorerFolderItem
	var err error
	if folderID == "" {
		if userID != "" {
			nodes, err = s.repo.ListVisibleNodes(companyID, userID)
		} else {
			nodes, err = s.repo.ListNodes(companyID)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_nodes")
			return
		}
		relationships, err = s.repo.ListNodeRelationships(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_node_relationships")
			return
		}
		positions, err = s.repo.ListNodeMapPositions(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_node_map_positions")
			return
		}
		if userID != "" {
			folders, err = s.repo.ListVisibleCompanyExplorerFolders(companyID, "node", userID)
		} else {
			folders, err = s.repo.ListCompanyExplorerFolders(companyID, "node")
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
			return
		}
		if userID != "" {
			folderItems, err = s.repo.ListVisibleCompanyExplorerFolderItems(companyID, "", "node", userID)
		} else {
			folderItems, err = s.repo.ListCompanyExplorerFolderItems(companyID, "", "node")
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_items")
			return
		}
	} else {
		if userID != "" {
			nodes, err = s.repo.ListVisibleNodesInFolderSubtree(companyID, folderID, userID)
		} else {
			nodes, err = s.repo.ListNodesInFolderSubtree(companyID, folderID)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_nodes")
			return
		}
		relationships, err = s.repo.ListNodeRelationshipsInFolderSubtree(companyID, folderID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_node_relationships")
			return
		}
		positions, err = s.repo.ListNodeMapPositionsInFolderSubtree(companyID, folderID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_node_map_positions")
			return
		}
		if userID != "" {
			folders, err = s.repo.ListVisibleCompanyExplorerFolderSubtree(companyID, folderID, "node", userID)
		} else {
			folders, err = s.repo.ListCompanyExplorerFolderSubtree(companyID, folderID, "node")
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
			return
		}
		if userID != "" {
			folderItems, err = s.repo.ListVisibleCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, "node", userID)
		} else {
			folderItems, err = s.repo.ListCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, "node")
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_items")
			return
		}
	}
	nodeIDs := visibleNodeIDs(nodes)
	relationships = filterNodeRelationshipsByVisibleNodes(relationships, nodeIDs)
	positions = filterNodeMapPositionsByVisibleNodes(positions, nodeIDs)
	folderItems = filterCompanyExplorerItemsForVisibleEntities(folderItems, nodeIDs, nil, nil)
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{
		"scope":              "node_map",
		"company_id":         companyID,
		"folder_id":          folderID,
		"nodes":              nodes,
		"relationships":      relationships,
		"folders":            folders,
		"folder_items":       folderItems,
		"node_map_positions": positions,
	}, etag)
}
func nodeMapWindowQueryParamPresent(r *http.Request) bool {
	for _, key := range []string{"folder_id", "min_x", "min_y", "max_x", "max_y"} {
		if _, ok := r.URL.Query()[key]; ok {
			return true
		}
	}
	return false
}

func parseNodeMapWindowFloatParam(r *http.Request, key string) (float64, bool) {
	values, ok := r.URL.Query()[key]
	if !ok || len(values) == 0 || strings.TrimSpace(values[0]) == "" {
		return 0, false
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(values[0]), 64)
	if err != nil || !validMapLayoutCoordinate(value) {
		return 0, false
	}
	return value, true
}

func parseNodeMapWindowQuery(r *http.Request, companyID string) (store.NodeMapWindowQuery, string, bool) {
	folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
	if folderID == "" {
		return store.NodeMapWindowQuery{}, "folder_id_required", false
	}
	if !isValidCompanyExplorerResourceID(folderID) {
		return store.NodeMapWindowQuery{}, "invalid_folder_id", false
	}
	minX, ok := parseNodeMapWindowFloatParam(r, "min_x")
	if !ok {
		return store.NodeMapWindowQuery{}, "invalid_window", false
	}
	minY, ok := parseNodeMapWindowFloatParam(r, "min_y")
	if !ok {
		return store.NodeMapWindowQuery{}, "invalid_window", false
	}
	maxX, ok := parseNodeMapWindowFloatParam(r, "max_x")
	if !ok {
		return store.NodeMapWindowQuery{}, "invalid_window", false
	}
	maxY, ok := parseNodeMapWindowFloatParam(r, "max_y")
	if !ok {
		return store.NodeMapWindowQuery{}, "invalid_window", false
	}
	if minX > maxX || minY > maxY {
		return store.NodeMapWindowQuery{}, "invalid_window", false
	}
	limit, ok := parsePositiveLimit(r.URL.Query().Get("limit"), store.NodeMapWindowDefaultLimit, store.NodeMapWindowMaxLimit)
	if !ok {
		return store.NodeMapWindowQuery{}, "invalid_limit", false
	}
	return store.NodeMapWindowQuery{
		CompanyID: companyID,
		FolderID:  folderID,
		Window: store.NodeMapWindowBounds{
			MinX: minX,
			MinY: minY,
			MaxX: maxX,
			MaxY: maxY,
		},
		Limit: limit,
	}, "", true
}

func nodeMapWindowSnapshotPayload(result store.NodeMapWindowResult) map[string]any {
	return map[string]any{
		"scope":              "node_map_window",
		"company_id":         result.CompanyID,
		"folder_id":          result.FolderID,
		"window":             result.Window,
		"nodes_limit":        result.Limit,
		"nodes":              result.Nodes,
		"relationships":      result.Relationships,
		"folders":            result.Folders,
		"folder_items":       result.FolderItems,
		"node_map_positions": result.NodeMapPositions,
	}
}

func (s *Server) handleNodeMapWindowWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID, etag string) {
	query, errCode, ok := parseNodeMapWindowQuery(r, companyID)
	if !ok {
		writeError(w, http.StatusBadRequest, errCode)
		return
	}
	result, err := s.repo.ListNodeMapWindow(query)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_window")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_node_map_window")
		return
	}
	result.Nodes, err = s.filterVisibleNodes(r, companyID, result.Nodes)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_filter_nodes")
		return
	}
	nodeIDs := visibleNodeIDs(result.Nodes)
	result.Relationships = filterNodeRelationshipsByVisibleNodes(result.Relationships, nodeIDs)
	result.NodeMapPositions = filterNodeMapPositionsByVisibleNodes(result.NodeMapPositions, nodeIDs)
	result.FolderItems = filterCompanyExplorerItemsForVisibleEntities(result.FolderItems, nodeIDs, nil, nil)
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, nodeMapWindowSnapshotPayload(result), etag)
}
func logicGateMapWindowQueryParamPresent(r *http.Request) bool {
	for _, key := range []string{"folder_id", "min_x", "min_y", "max_x", "max_y"} {
		if _, ok := r.URL.Query()[key]; ok {
			return true
		}
	}
	return false
}

func parseLogicGateMapWindowQuery(r *http.Request, companyID string) (store.LogicGateMapWindowQuery, string, bool) {
	folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
	if folderID == "" {
		return store.LogicGateMapWindowQuery{}, "folder_id_required", false
	}
	if !isValidCompanyExplorerResourceID(folderID) {
		return store.LogicGateMapWindowQuery{}, "invalid_folder_id", false
	}
	minX, ok := parseNodeMapWindowFloatParam(r, "min_x")
	if !ok {
		return store.LogicGateMapWindowQuery{}, "invalid_window", false
	}
	minY, ok := parseNodeMapWindowFloatParam(r, "min_y")
	if !ok {
		return store.LogicGateMapWindowQuery{}, "invalid_window", false
	}
	maxX, ok := parseNodeMapWindowFloatParam(r, "max_x")
	if !ok {
		return store.LogicGateMapWindowQuery{}, "invalid_window", false
	}
	maxY, ok := parseNodeMapWindowFloatParam(r, "max_y")
	if !ok {
		return store.LogicGateMapWindowQuery{}, "invalid_window", false
	}
	if minX > maxX || minY > maxY {
		return store.LogicGateMapWindowQuery{}, "invalid_window", false
	}
	limit, ok := parsePositiveLimit(r.URL.Query().Get("limit"), store.LogicGateMapWindowDefaultLimit, store.LogicGateMapWindowMaxLimit)
	if !ok {
		return store.LogicGateMapWindowQuery{}, "invalid_limit", false
	}
	return store.LogicGateMapWindowQuery{
		CompanyID: companyID,
		FolderID:  folderID,
		Window: store.NodeMapWindowBounds{
			MinX: minX,
			MinY: minY,
			MaxX: maxX,
			MaxY: maxY,
		},
		Limit: limit,
	}, "", true
}

func logicGateMapWindowSnapshotPayload(result store.LogicGateMapWindowResult) map[string]any {
	return map[string]any{
		"scope":                    "logic_gate_map_window",
		"company_id":               result.CompanyID,
		"folder_id":                result.FolderID,
		"window":                   result.Window,
		"logic_gates_limit":        result.Limit,
		"logic_gates":              result.LogicGates,
		"logic_gate_relationships": result.Relationships,
		"folders":                  result.Folders,
		"folder_items":             result.FolderItems,
		"logic_gate_map_positions": result.LogicGateMapPositions,
	}
}

func (s *Server) handleLogicGateMapWindowWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID, etag string) {
	query, errCode, ok := parseLogicGateMapWindowQuery(r, companyID)
	if !ok {
		writeError(w, http.StatusBadRequest, errCode)
		return
	}
	result, err := s.repo.ListLogicGateMapWindow(query)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_window")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_map_window")
		return
	}
	result.LogicGates, err = s.filterVisibleLogicGates(r, companyID, result.LogicGates)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_filter_logic_gates")
		return
	}
	logicGateIDs := visibleLogicGateIDs(result.LogicGates)
	result.Relationships = filterLogicGateRelationshipsByVisibleGates(result.Relationships, logicGateIDs)
	result.LogicGateMapPositions = filterLogicGateMapPositionsByVisibleGates(result.LogicGateMapPositions, logicGateIDs)
	result.FolderItems = filterCompanyExplorerItemsForVisibleEntities(result.FolderItems, nil, logicGateIDs, nil)
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, logicGateMapWindowSnapshotPayload(result), etag)
}
func (s *Server) handleLogicGateMapWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID, etag string) {
	folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
	userID := s.entityPermissionActorUserID(r, companyID)
	var logicGates []domain.LogicGate
	var relationships []domain.LogicGateRelationship
	var positions []domain.LogicGateMapPosition
	var folders []domain.CompanyExplorerFolder
	var folderItems []domain.CompanyExplorerFolderItem
	var err error
	if folderID == "" {
		if userID != "" {
			logicGates, err = s.repo.ListVisibleLogicGates(companyID, userID)
		} else {
			logicGates, err = s.repo.ListLogicGates(companyID)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gates")
			return
		}
		relationships, err = s.repo.ListLogicGateRelationships(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_relationships")
			return
		}
		positions, err = s.repo.ListLogicGateMapPositions(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_map_positions")
			return
		}
		if userID != "" {
			folders, err = s.repo.ListVisibleCompanyExplorerFolders(companyID, "logic_gate", userID)
		} else {
			folders, err = s.repo.ListCompanyExplorerFolders(companyID, "logic_gate")
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
			return
		}
		if userID != "" {
			folderItems, err = s.repo.ListVisibleCompanyExplorerFolderItems(companyID, "", "logic_gate", userID)
		} else {
			folderItems, err = s.repo.ListCompanyExplorerFolderItems(companyID, "", "logic_gate")
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_items")
			return
		}
	} else {
		if userID != "" {
			logicGates, err = s.repo.ListVisibleLogicGatesInFolderSubtree(companyID, folderID, userID)
		} else {
			logicGates, err = s.repo.ListLogicGatesInFolderSubtree(companyID, folderID)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gates")
			return
		}
		relationships, err = s.repo.ListLogicGateRelationshipsInFolderSubtree(companyID, folderID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_relationships")
			return
		}
		positions, err = s.repo.ListLogicGateMapPositionsInFolderSubtree(companyID, folderID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_map_positions")
			return
		}
		if userID != "" {
			folders, err = s.repo.ListVisibleCompanyExplorerFolderSubtree(companyID, folderID, "logic_gate", userID)
		} else {
			folders, err = s.repo.ListCompanyExplorerFolderSubtree(companyID, folderID, "logic_gate")
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
			return
		}
		if userID != "" {
			folderItems, err = s.repo.ListVisibleCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, "logic_gate", userID)
		} else {
			folderItems, err = s.repo.ListCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, "logic_gate")
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_items")
			return
		}
	}
	logicGateIDs := visibleLogicGateIDs(logicGates)
	relationships = filterLogicGateRelationshipsByVisibleGates(relationships, logicGateIDs)
	positions = filterLogicGateMapPositionsByVisibleGates(positions, logicGateIDs)
	folderItems = filterCompanyExplorerItemsForVisibleEntities(folderItems, nil, logicGateIDs, nil)
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{
		"scope":                    "logic_gate_map",
		"company_id":               companyID,
		"folder_id":                folderID,
		"logic_gates":              logicGates,
		"logic_gate_relationships": relationships,
		"folders":                  folders,
		"folder_items":             folderItems,
		"logic_gate_map_positions": positions,
	}, etag)
}
func (s *Server) handleCompanyExplorerWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID, etag string) {
	folderKind := strings.TrimSpace(r.URL.Query().Get("folder_kind"))
	folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
	if folderKind != "" && !isValidCompanyExplorerFolderKind(folderKind) {
		writeError(w, http.StatusBadRequest, "invalid_folder_kind")
		return
	}
	if folderID != "" {
		if !isValidCompanyExplorerResourceID(folderID) {
			writeError(w, http.StatusBadRequest, "invalid_folder_id")
			return
		}
		if folderKind == "" {
			writeError(w, http.StatusBadRequest, "folder_kind_required")
			return
		}
	}

	itemType := companyExplorerItemTypeForFolderKind(folderKind)
	userID := s.entityPermissionActorUserID(r, companyID)
	folders := []domain.CompanyExplorerFolder{}
	folderItems := []domain.CompanyExplorerFolderItem{}
	nodes := []domain.Node{}
	logicGates := []domain.LogicGate{}
	projects := []domain.Project{}
	var err error

	if folderID != "" {
		if userID != "" {
			folders, err = s.repo.ListVisibleCompanyExplorerFolderSubtree(companyID, folderID, folderKind, userID)
		} else {
			folders, err = s.repo.ListCompanyExplorerFolderSubtree(companyID, folderID, folderKind)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
			return
		}
		if len(folders) == 0 {
			writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
			return
		}
		if itemType != "" {
			if userID != "" {
				folderItems, err = s.repo.ListVisibleCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, itemType, userID)
			} else {
				folderItems, err = s.repo.ListCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, itemType)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_items")
				return
			}
		}
		switch folderKind {
		case "node":
			if userID != "" {
				nodes, err = s.repo.ListVisibleCompanyExplorerNodeSummariesInFolderSubtree(companyID, folderID, userID)
			} else {
				nodes, err = s.repo.ListCompanyExplorerNodeSummariesInFolderSubtree(companyID, folderID)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_node_summaries")
				return
			}
		case "logic_gate":
			if userID != "" {
				logicGates, err = s.repo.ListVisibleCompanyExplorerLogicGateSummariesInFolderSubtree(companyID, folderID, userID)
			} else {
				logicGates, err = s.repo.ListCompanyExplorerLogicGateSummariesInFolderSubtree(companyID, folderID)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_summaries")
				return
			}
		case "project":
			if userID != "" {
				projects, err = s.repo.ListVisibleCompanyExplorerProjectSummariesInFolderSubtree(companyID, folderID, userID)
			} else {
				projects, err = s.repo.ListCompanyExplorerProjectSummariesInFolderSubtree(companyID, folderID)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_project_summaries")
				return
			}
		}
	} else {
		if folderKind == "" {
			for _, kind := range []string{"node", "logic_gate", "project"} {
				var items []domain.CompanyExplorerFolder
				var listErr error
				if userID != "" {
					items, listErr = s.repo.ListVisibleCompanyExplorerFolders(companyID, kind, userID)
				} else {
					items, listErr = s.repo.ListCompanyExplorerFolders(companyID, kind)
				}
				if listErr != nil {
					err = listErr
					break
				}
				folders = append(folders, items...)
			}
		} else {
			if userID != "" {
				folders, err = s.repo.ListVisibleCompanyExplorerFolders(companyID, folderKind, userID)
			} else {
				folders, err = s.repo.ListCompanyExplorerFolders(companyID, folderKind)
			}
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
			return
		}
		if folderKind == "" || itemType != "" {
			if userID != "" {
				folderItems, err = s.repo.ListVisibleCompanyExplorerFolderItems(companyID, "", itemType, userID)
			} else {
				folderItems, err = s.repo.ListCompanyExplorerFolderItems(companyID, "", itemType)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_items")
				return
			}
		}
		switch folderKind {
		case "":
			if userID != "" {
				nodes, err = s.repo.ListVisibleCompanyExplorerNodeSummaries(companyID, userID)
			} else {
				nodes, err = s.repo.ListCompanyExplorerNodeSummaries(companyID)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_node_summaries")
				return
			}
			if userID != "" {
				logicGates, err = s.repo.ListVisibleCompanyExplorerLogicGateSummaries(companyID, userID)
			} else {
				logicGates, err = s.repo.ListCompanyExplorerLogicGateSummaries(companyID)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_summaries")
				return
			}
			if userID != "" {
				projects, err = s.repo.ListVisibleCompanyExplorerProjectSummaries(companyID, userID)
			} else {
				projects, err = s.repo.ListCompanyExplorerProjectSummaries(companyID)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_project_summaries")
				return
			}
		case "node":
			if userID != "" {
				nodes, err = s.repo.ListVisibleCompanyExplorerNodeSummaries(companyID, userID)
			} else {
				nodes, err = s.repo.ListCompanyExplorerNodeSummaries(companyID)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_node_summaries")
				return
			}
		case "logic_gate":
			if userID != "" {
				logicGates, err = s.repo.ListVisibleCompanyExplorerLogicGateSummaries(companyID, userID)
			} else {
				logicGates, err = s.repo.ListCompanyExplorerLogicGateSummaries(companyID)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_summaries")
				return
			}
		case "project":
			if userID != "" {
				projects, err = s.repo.ListVisibleCompanyExplorerProjectSummaries(companyID, userID)
			} else {
				projects, err = s.repo.ListCompanyExplorerProjectSummaries(companyID)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_project_summaries")
				return
			}
		}
	}

	folderItems = filterCompanyExplorerItemsForVisibleEntities(folderItems, visibleNodeIDs(nodes), visibleLogicGateIDs(logicGates), visibleProjectIDs(projects))
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{
		"scope":        "company_explorer",
		"company_id":   companyID,
		"folder_kind":  folderKind,
		"folder_id":    folderID,
		"folders":      folders,
		"folder_items": folderItems,
		"nodes":        nodes,
		"logic_gates":  logicGates,
		"projects":     projects,
	}, etag)
}
func (s *Server) handleKanbanWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID, etag string) {
	boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
	if boardID == "" {
		writeError(w, http.StatusBadRequest, "board_id_required")
		return
	}
	logicGateID := store.LogicGateIDFromKanbanBoardID(boardID)
	if logicGateID == "" {
		writeLegacyKanbanDisabled(w)
		return
	}
	if !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
		return
	}
	columns, err := s.repo.ListKanbanColumns(companyID, boardID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_kanban_columns")
		return
	}
	cardQuery, ok, errCode := parseKanbanCardQueryParams(r)
	if !ok {
		writeError(w, http.StatusBadRequest, errCode)
		return
	}
	cards, err := s.repo.ListKanbanCards(companyID, boardID, cardQuery)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_kanban_cards")
		return
	}
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{
		"scope":       "kanban",
		"company_id":  companyID,
		"board_id":    boardID,
		"columns":     columns,
		"cards":       cards,
		"cards_limit": cardQuery.Limit,
	}, etag)
}

func (s *Server) publishWorkspaceEvent(companyID, eventType string, data map[string]any) (domain.DomainEvent, bool) {
	event, err := s.repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Type:       eventType,
		Payload:    data,
	})
	if err != nil {
		log.Printf("failed to append workspace domain event company_id=%s type=%s: %v", companyID, eventType, err)
		return domain.DomainEvent{}, false
	}
	s.publishCommittedWorkspaceEvent(event)
	return event, true
}

func (s *Server) publishCommittedWorkspaceEvents(events []domain.DomainEvent) {
	s.publishCommittedWorkspaceEventsWithTiming(events, nil)
}

func (s *Server) publishCommittedWorkspaceEventsWithTiming(events []domain.DomainEvent, timings *requestTimingRecorder) {
	if len(events) == 0 {
		return
	}
	stop := timings.observeAccounted("events.publish")
	s.wakeRealtimeSpine()
	stop()
}

func (s *Server) publishCommittedWorkspaceEvent(event domain.DomainEvent) {
	s.publishCommittedWorkspaceEventWithTiming(event, nil)
}

func (s *Server) publishCommittedWorkspaceEventWithTiming(event domain.DomainEvent, timings *requestTimingRecorder) {
	s.publishCommittedWorkspaceEventsWithTiming([]domain.DomainEvent{event}, timings)
}
func cloneDomainEventsForAsync(events []domain.DomainEvent) []domain.DomainEvent {
	if len(events) == 0 {
		return nil
	}
	out := make([]domain.DomainEvent, len(events))
	for i, event := range events {
		out[i] = event
		if event.ActorUserID != nil {
			actorUserID := *event.ActorUserID
			out[i].ActorUserID = &actorUserID
		}
		if event.Payload != nil {
			payload := make(map[string]any, len(event.Payload))
			for key, value := range event.Payload {
				payload[key] = value
			}
			out[i].Payload = payload
		}
	}
	return out
}

func domainEventTypesForLog(events []domain.DomainEvent) string {
	if len(events) == 0 {
		return "-"
	}
	counts := map[string]int{}
	order := make([]string, 0, len(events))
	for _, event := range events {
		eventType := strings.TrimSpace(event.Type)
		if eventType == "" {
			eventType = "<unknown>"
		}
		if counts[eventType] == 0 {
			order = append(order, eventType)
		}
		counts[eventType]++
	}
	parts := make([]string, 0, len(order))
	for _, eventType := range order {
		if counts[eventType] > 1 {
			parts = append(parts, fmt.Sprintf("%s(%dx)", eventType, counts[eventType]))
			continue
		}
		parts = append(parts, eventType)
	}
	return strings.Join(parts, ",")
}
