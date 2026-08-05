package httpapi

import (
	"fmt"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
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
	case "company_explorer":
		s.handleCompanyExplorerWorkspaceSnapshot(w, r, companyID, etag)
	case "kanban":
		s.handleKanbanWorkspaceSnapshot(w, r, companyID, etag)
	default:
		writeError(w, http.StatusBadRequest, "invalid_workspace_snapshot_scope")
	}
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
