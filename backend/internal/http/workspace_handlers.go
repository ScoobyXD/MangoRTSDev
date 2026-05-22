package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const workspaceDomainStreamType = "workspace"
const workspaceReplayLimit = 500
const workspaceCatchupInterval = 250 * time.Millisecond

const (
	workspaceReplaySourceInitial        = "initial_replay"
	workspaceReplaySourcePoll           = "poll"
	workspaceReplaySourceHub            = "hub"
	workspaceReplaySourceExternalFanout = "external_fanout"
	workspaceReplayOutcomeSuccess       = "success"
	workspaceReplayOutcomeError         = "error"
)

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
	logicGateRelationships, err := s.repo.ListLogicGateRelationships(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_relationships")
		return
	}
	logicGateRelationships = filterLogicGateRelationshipsByVisibleGates(logicGateRelationships, logicGateIDs)
	nodeFolders, err := s.repo.ListCompanyExplorerFolders(companyID, "node")
	if err != nil {
		log.Printf("workspace snapshot: failed to list node company explorer folders company_id=%s: %v", companyID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
		return
	}
	logicGateFolders, err := s.repo.ListCompanyExplorerFolders(companyID, "logic_gate")
	if err != nil {
		log.Printf("workspace snapshot: failed to list logic_gate company explorer folders company_id=%s: %v", companyID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
		return
	}
	folders := append(nodeFolders, logicGateFolders...)
	var folderItems []domain.CompanyExplorerFolderItem
	if userID != "" {
		folderItems, err = s.repo.ListVisibleCompanyExplorerFolderItems(companyID, "", "", userID)
	} else {
		folderItems, err = s.repo.ListCompanyExplorerFolderItems(companyID, "", "")
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
		return
	}
	folderItems = filterCompanyExplorerItemsForVisibleEntities(folderItems, nodeIDs, logicGateIDs)
	payload := map[string]any{
		"scope":                    "full",
		"nodes":                    nodes,
		"relationships":            relationships,
		"logic_gates":              logicGates,
		"logic_gate_relationships": logicGateRelationships,
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
		kanbanBoards, err := s.repo.ListKanbanBoards(companyID, store.KanbanBoardQuery{Limit: store.KanbanMaxBoardsLimit})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_kanban_boards")
			return
		}
		payload["kanban_boards"] = kanbanBoards
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
		folders, err = s.repo.ListCompanyExplorerFolders(companyID, "node")
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
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
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
		folders, err = s.repo.ListCompanyExplorerFolderSubtree(companyID, folderID, "node")
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
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
			return
		}
	}
	nodeIDs := visibleNodeIDs(nodes)
	relationships = filterNodeRelationshipsByVisibleNodes(relationships, nodeIDs)
	positions = filterNodeMapPositionsByVisibleNodes(positions, nodeIDs)
	folderItems = filterCompanyExplorerItemsForVisibleEntities(folderItems, nodeIDs, nil)
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
	result.FolderItems = filterCompanyExplorerItemsForVisibleEntities(result.FolderItems, nodeIDs, nil)
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
	result.FolderItems = filterCompanyExplorerItemsForVisibleEntities(result.FolderItems, nil, logicGateIDs)
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
		folders, err = s.repo.ListCompanyExplorerFolders(companyID, "logic_gate")
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
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
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
		folders, err = s.repo.ListCompanyExplorerFolderSubtree(companyID, folderID, "logic_gate")
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
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
			return
		}
	}
	logicGateIDs := visibleLogicGateIDs(logicGates)
	relationships = filterLogicGateRelationshipsByVisibleGates(relationships, logicGateIDs)
	positions = filterLogicGateMapPositionsByVisibleGates(positions, logicGateIDs)
	folderItems = filterCompanyExplorerItemsForVisibleEntities(folderItems, nil, logicGateIDs)
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
				writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
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
		}
	} else {
		if folderKind == "" {
			for _, kind := range []string{"node", "logic_gate"} {
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
				writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
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
		}
	}

	folderItems = filterCompanyExplorerItemsForVisibleEntities(folderItems, visibleNodeIDs(nodes), visibleLogicGateIDs(logicGates))
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{
		"scope":        "company_explorer",
		"company_id":   companyID,
		"folder_kind":  folderKind,
		"folder_id":    folderID,
		"folders":      folders,
		"folder_items": folderItems,
		"nodes":        nodes,
		"logic_gates":  logicGates,
	}, etag)
}
func (s *Server) handleKanbanWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID, etag string) {
	boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
	if boardID == "" {
		writeError(w, http.StatusBadRequest, "board_id_required")
		return
	}
	if store.IsLogicGateKanbanBoardID(boardID) {
		logicGateID := strings.TrimSpace(strings.TrimPrefix(boardID, "logic-gate:"))
		if !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
			return
		}
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

func (s *Server) handleWorkspaceStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	streamUserID := ""
	if actor, ok := authenticatedActor(r); ok {
		if actorRoleForCompany(actor, companyID) == "" {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return
		}
		streamUserID = strings.TrimSpace(actor.User.UserID)
	}
	afterSequence, explicitCursor, ok := workspaceReplayAfterSequence(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_after_sequence")
		return
	}
	if !explicitCursor {
		sequence, err := s.repo.CurrentDomainEventSequence(store.DomainEventStreamQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID})
		if err != nil {
			log.Printf("workspace stream baseline failed company_id=%s: %v", companyID, err)
			writeError(w, http.StatusInternalServerError, "failed_to_read_workspace_version")
			return
		}
		afterSequence = sequence
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "stream_unsupported")
		return
	}

	prepareSSEHeaders(w)

	ch := s.hub.subscribeUser(companyID, streamUserID)
	defer s.hub.unsubscribeUser(companyID, streamUserID, ch)
	externalCh := s.workspaceWakeHub.subscribeUser(companyID, streamUserID)
	defer s.workspaceWakeHub.unsubscribeUser(companyID, streamUserID, externalCh)

	fmt.Fprintf(w, "event: ready\ndata: {\"company_id\":%q,\"user_id\":%q,\"after_sequence\":%d}\n\n", companyID, streamUserID, afterSequence)
	flusher.Flush()

	lastSentSequence := afterSequence
	if explicitCursor {
		if err := s.writeAndRecordWorkspaceDurableCatchup(workspaceReplaySourceInitial, w, flusher, companyID, streamUserID, &lastSentSequence); err != nil {
			log.Printf("workspace stream replay failed company_id=%s after_sequence=%d: %v", companyID, afterSequence, err)
		}
	}

	heartbeat := time.NewTicker(sseHeartbeatInterval)
	defer heartbeat.Stop()
	catchup := time.NewTicker(s.workspaceCatchupInterval)
	defer catchup.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			fmt.Fprint(w, "event: ping\ndata: {}\n\n")
			flusher.Flush()
		case <-catchup.C:
			if err := s.writeAndRecordWorkspaceDurableCatchup(workspaceReplaySourcePoll, w, flusher, companyID, streamUserID, &lastSentSequence); err != nil {
				log.Printf("workspace stream catch-up failed company_id=%s after_sequence=%d: %v", companyID, lastSentSequence, err)
			}
		case payload := <-ch:
			sequence := workspacePayloadSequence(payload)
			if sequence > 0 && sequence <= lastSentSequence {
				continue
			}
			if err := s.writeAndRecordWorkspaceDurableCatchup(workspaceReplaySourceHub, w, flusher, companyID, streamUserID, &lastSentSequence); err != nil {
				log.Printf("workspace stream hub catch-up failed company_id=%s after_sequence=%d payload_sequence=%d: %v", companyID, lastSentSequence, sequence, err)
			}
		case notification := <-externalCh:
			if notification.Sequence > 0 && notification.Sequence <= lastSentSequence {
				continue
			}
			if err := s.writeAndRecordWorkspaceDurableCatchup(workspaceReplaySourceExternalFanout, w, flusher, companyID, streamUserID, &lastSentSequence); err != nil {
				log.Printf("workspace stream external fanout catch-up failed company_id=%s after_sequence=%d notification_sequence=%d: %v", companyID, lastSentSequence, notification.Sequence, err)
			}
		}
	}
}

func workspaceReplayAfterSequence(r *http.Request) (int64, bool, bool) {
	if values, hasAfterSequence := r.URL.Query()["after_sequence"]; hasAfterSequence {
		raw := ""
		if len(values) > 0 {
			raw = strings.TrimSpace(values[0])
		}
		value, ok := parseWorkspaceStreamSequence(raw)
		return value, true, ok
	}
	raw := strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	if raw == "" {
		return 0, false, true
	}
	value, ok := parseWorkspaceStreamSequence(raw)
	return value, true, ok
}

func parseWorkspaceStreamSequence(raw string) (int64, bool) {
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, false
	}
	return value, true
}

type workspaceDurableCatchupResult struct {
	Batches            int
	Events             int
	StartAfterSequence int64
	LastSequence       int64
}

func (s *Server) writeAndRecordWorkspaceDurableCatchup(source string, w http.ResponseWriter, flusher http.Flusher, companyID, userID string, lastSentSequence *int64) error {
	start := time.Now()
	result, err := s.writeWorkspaceDurableCatchup(w, flusher, companyID, userID, lastSentSequence)
	s.recordWorkspaceReplayMetric(source, result, time.Since(start), err)
	return err
}

func (s *Server) recordWorkspaceReplayMetric(source string, result workspaceDurableCatchupResult, duration time.Duration, err error) {
	if s.metrics == nil {
		return
	}
	outcome := workspaceReplayOutcomeSuccess
	if err != nil {
		outcome = workspaceReplayOutcomeError
	}
	s.metrics.RecordWorkspaceReplay(WorkspaceReplayMetric{
		Source:             source,
		Outcome:            outcome,
		Duration:           duration,
		Batches:            result.Batches,
		Events:             result.Events,
		StartAfterSequence: result.StartAfterSequence,
		LastSequence:       result.LastSequence,
	})
}

func (s *Server) writeWorkspaceDurableCatchup(w http.ResponseWriter, flusher http.Flusher, companyID, userID string, lastSentSequence *int64) (workspaceDurableCatchupResult, error) {
	result := workspaceDurableCatchupResult{StartAfterSequence: *lastSentSequence, LastSequence: *lastSentSequence}
	for {
		result.Batches++
		replay, err := s.repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: *lastSentSequence, Limit: workspaceReplayLimit})
		if err != nil {
			result.LastSequence = *lastSentSequence
			return result, err
		}
		if len(replay) == 0 {
			result.LastSequence = *lastSentSequence
			return result, nil
		}
		for _, event := range replay {
			if event.Sequence <= *lastSentSequence {
				continue
			}
			if strings.TrimSpace(userID) != "" && !s.workspaceEventVisibleToUser(event, userID) {
				*lastSentSequence = event.Sequence
				continue
			}
			if writeWorkspaceSSE(w, event) {
				*lastSentSequence = event.Sequence
				result.Events++
			}
		}
		result.LastSequence = *lastSentSequence
		flusher.Flush()
		if len(replay) < workspaceReplayLimit {
			return result, nil
		}
	}
}

func workspacePayloadSequence(payload []byte) int64 {
	var envelope workspaceEventEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return 0
	}
	return envelope.Sequence
}

type workspaceEventEnvelope struct {
	EventID    string         `json:"event_id,omitempty"`
	Sequence   int64          `json:"sequence,omitempty"`
	StreamType string         `json:"stream_type,omitempty"`
	StreamID   string         `json:"stream_id,omitempty"`
	CompanyID  string         `json:"company_id"`
	Type       string         `json:"type"`
	TS         time.Time      `json:"ts"`
	Data       map[string]any `json:"data,omitempty"`
}

type workspaceEventHub struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan []byte]struct{}
}

func workspaceSubscriptionKey(companyID, userID string) string {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return companyID
	}
	return companyID + ":" + userID
}

func newWorkspaceEventHub() *workspaceEventHub {
	return &workspaceEventHub{subscribers: map[string]map[chan []byte]struct{}{}}
}

func (h *workspaceEventHub) subscribe(companyID string) chan []byte {
	return h.subscribeUser(companyID, "")
}

func (h *workspaceEventHub) subscribeUser(companyID, userID string) chan []byte {
	ch := make(chan []byte, 24)
	key := workspaceSubscriptionKey(companyID, userID)
	h.mu.Lock()
	bucket := h.subscribers[key]
	if bucket == nil {
		bucket = map[chan []byte]struct{}{}
		h.subscribers[key] = bucket
	}
	bucket[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *workspaceEventHub) unsubscribe(companyID string, ch chan []byte) {
	h.unsubscribeUser(companyID, "", ch)
}

func (h *workspaceEventHub) unsubscribeUser(companyID, userID string, ch chan []byte) {
	key := workspaceSubscriptionKey(companyID, userID)
	h.mu.Lock()
	if bucket := h.subscribers[key]; bucket != nil {
		delete(bucket, ch)
		if len(bucket) == 0 {
			delete(h.subscribers, key)
		}
	}
	h.mu.Unlock()
	close(ch)
}

func (h *workspaceEventHub) hasSubscribers(companyID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subscribers[companyID]) > 0
}

func (h *workspaceEventHub) publish(companyID string, payload []byte) {
	h.publishUser(companyID, "", payload)
}

func (h *workspaceEventHub) publishUser(companyID, userID string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subscribers[workspaceSubscriptionKey(companyID, userID)] {
		select {
		case ch <- payload:
		default:
		}
	}
}

func (s *Server) publishWorkspaceEvent(companyID, eventType string, data map[string]any) {
	event, err := s.repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID:  companyID,
		StreamType: workspaceDomainStreamType,
		StreamID:   companyID,
		Type:       eventType,
		Payload:    data,
	})
	if err != nil {
		log.Printf("failed to append workspace domain event company_id=%s type=%s: %v", companyID, eventType, err)
		return
	}
	s.publishCommittedWorkspaceEvent(event)
}

func (s *Server) publishCommittedWorkspaceEvents(events []domain.DomainEvent) {
	for _, event := range events {
		s.publishCommittedWorkspaceEvent(event)
	}
}
func (s *Server) publishCommittedWorkspaceEvent(event domain.DomainEvent) {
	payload, err := json.Marshal(workspaceEventEnvelopeFromDomainEvent(event))
	if err != nil {
		log.Printf("failed to marshal committed workspace event company_id=%s sequence=%d event_id=%s: %v", event.CompanyID, event.Sequence, event.EventID, err)
		return
	}
	s.hub.publish(event.CompanyID, payload)
	userIDs, err := s.repo.ListEffectiveUsersForWorkspaceEvent(event)
	if err != nil {
		log.Printf("failed to resolve workspace event recipients company_id=%s sequence=%d event_id=%s: %v", event.CompanyID, event.Sequence, event.EventID, err)
	} else {
		for _, userID := range userIDs {
			s.hub.publishUser(event.CompanyID, userID, payload)
		}
	}
	s.notifyWorkspaceEventFanout(event)
}

func (s *Server) workspaceEventVisibleToUser(event domain.DomainEvent, userID string) bool {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return true
	}
	userIDs, err := s.repo.ListEffectiveUsersForWorkspaceEvent(event)
	if err != nil {
		log.Printf("failed to resolve workspace event visibility company_id=%s sequence=%d event_id=%s user_id=%s: %v", event.CompanyID, event.Sequence, event.EventID, userID, err)
		return false
	}
	for _, allowedUserID := range userIDs {
		if strings.TrimSpace(allowedUserID) == userID {
			return true
		}
	}
	return false
}

func workspaceEventEnvelopeFromDomainEvent(event domain.DomainEvent) workspaceEventEnvelope {
	return workspaceEventEnvelope{
		EventID:    event.EventID,
		Sequence:   event.Sequence,
		StreamType: event.StreamType,
		StreamID:   event.StreamID,
		CompanyID:  event.CompanyID,
		Type:       event.Type,
		TS:         event.CreatedTimestamp,
		Data:       event.Payload,
	}
}

func writeWorkspaceSSE(w http.ResponseWriter, event domain.DomainEvent) bool {
	payload, err := json.Marshal(workspaceEventEnvelopeFromDomainEvent(event))
	if err != nil {
		log.Printf("failed to marshal workspace event company_id=%s sequence=%d event_id=%s: %v", event.CompanyID, event.Sequence, event.EventID, err)
		return false
	}
	fmt.Fprintf(w, "id: %d\nevent: workspace\ndata: %s\n\n", event.Sequence, payload)
	return true
}
