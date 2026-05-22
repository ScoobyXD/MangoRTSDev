package httpapi

import (
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
)

var (
	nodeListWorkspaceEventTypes                  = store.NodeListWorkspaceEventTypes
	nodeRelationshipWorkspaceEventTypes          = store.NodeRelationshipWorkspaceEventTypes
	logicGateListWorkspaceEventTypes             = store.LogicGateListWorkspaceEventTypes
	logicGateRelationshipWorkspaceEventTypes     = store.LogicGateRelationshipWorkspaceEventTypes
	nodeMapPositionWorkspaceEventTypes           = store.NodeMapPositionWorkspaceEventTypes
	logicGateMapPositionWorkspaceEventTypes      = store.LogicGateMapPositionWorkspaceEventTypes
	companyExplorerFolderWorkspaceEventTypes     = store.CompanyExplorerFolderWorkspaceEventTypes
	companyExplorerFolderItemWorkspaceEventTypes = store.CompanyExplorerFolderItemWorkspaceEventTypes
	kanbanBoardWorkspaceEventTypes               = store.KanbanBoardWorkspaceEventTypes
	kanbanColumnWorkspaceEventTypes              = store.KanbanColumnWorkspaceEventTypes
	kanbanCardWorkspaceEventTypes                = store.KanbanCardWorkspaceEventTypes
)

func workspaceEventQuery(eventTypes ...string) store.DomainEventStreamQuery {
	return store.DomainEventStreamQuery{EventTypes: eventTypes}
}

func workspaceEventQueryPayload(eventTypes []string, payloadEquals map[string]string) store.DomainEventStreamQuery {
	return store.DomainEventStreamQuery{EventTypes: eventTypes, PayloadEquals: payloadEquals}
}

func (s *Server) workspaceEventVersion(companyID string, queries []store.DomainEventStreamQuery) (int64, error) {
	if len(queries) == 0 {
		queries = []store.DomainEventStreamQuery{{}}
	}
	var version int64
	for _, query := range queries {
		query.CompanyID = companyID
		query.StreamType = workspaceDomainStreamType
		query.StreamID = companyID
		sequence, err := s.repo.CurrentDomainEventSequence(query)
		if err != nil {
			return 0, err
		}
		if sequence > version {
			version = sequence
		}
	}
	return version, nil
}

func (s *Server) workspaceEventETag(r *http.Request, companyID, resource string, queries []store.DomainEventStreamQuery) (string, error) {
	version, err := s.workspaceEventVersionWithReadVersion(companyID, workspaceReadVersionQueryForResource(companyID, resource, queries), queries)
	if err != nil {
		return "", err
	}
	return strongETagFromString("workspace-events:" + companyID + ":" + resource + ":" + r.URL.Path + "?" + r.URL.Query().Encode() + ":" + strconv.FormatInt(version, 10)), nil
}

func (s *Server) workspaceEventETagWithReadVersion(r *http.Request, companyID, resource string, queries []store.DomainEventStreamQuery, readVersion store.WorkspaceReadVersionQuery) (string, error) {
	readVersion.UserID = workspaceReadVersionUserID(r, companyID)
	version, err := s.workspaceEventVersionWithReadVersion(companyID, readVersion, queries)
	if err != nil {
		return "", err
	}
	return strongETagFromString("workspace-events:" + companyID + ":" + resource + ":" + r.URL.Path + "?" + r.URL.Query().Encode() + ":" + strconv.FormatInt(version, 10)), nil
}

func (s *Server) workspaceEventVersionWithReadVersion(companyID string, readVersion store.WorkspaceReadVersionQuery, queries []store.DomainEventStreamQuery) (int64, error) {
	if strings.TrimSpace(readVersion.Scope) != "" {
		version, found, err := s.repo.CurrentWorkspaceReadVersion(readVersion)
		if err != nil {
			return 0, err
		}
		if found {
			return version, nil
		}
		if strings.TrimSpace(readVersion.UserID) != "" {
			readVersion.UserID = ""
			version, found, err := s.repo.CurrentWorkspaceReadVersion(readVersion)
			if err != nil {
				return 0, err
			}
			if found {
				return version, nil
			}
		}
	}
	return s.workspaceEventVersion(companyID, queries)
}

func workspaceReadVersionQueryForResource(companyID, resource string, queries []store.DomainEventStreamQuery) store.WorkspaceReadVersionQuery {
	switch resource {
	case "nodes", "node-relationships", "logic-gates", "logic-gate-relationships", "map-layout:node", "map-layout:node-window", "map-layout:logic_gate", "map-layout:logic_gate-window", "kanban-boards":
		return store.WorkspaceReadVersionQuery{CompanyID: companyID, Scope: resource}
	case "company-explorer-folder-items":
		itemType := workspaceEventQueryPayloadValue(queries, "item_type")
		if itemType == "" {
			return store.WorkspaceReadVersionQuery{CompanyID: companyID, Scope: resource}
		}
		return store.WorkspaceReadVersionQuery{CompanyID: companyID, Scope: resource, ResourceKey: store.WorkspaceReadVersionResourceKey("item_type", itemType)}
	case "kanban-columns", "kanban-cards":
		boardID := workspaceEventQueryPayloadValue(queries, "board_id")
		if boardID == "" {
			return store.WorkspaceReadVersionQuery{}
		}
		return store.WorkspaceReadVersionQuery{CompanyID: companyID, Scope: resource, ResourceKey: store.WorkspaceReadVersionResourceKey("board_id", boardID)}
	default:
		return store.WorkspaceReadVersionQuery{}
	}
}

func workspaceEventQueryPayloadValue(queries []store.DomainEventStreamQuery, key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	for _, query := range queries {
		if len(query.PayloadEquals) == 0 {
			continue
		}
		if value := strings.TrimSpace(query.PayloadEquals[key]); value != "" {
			return value
		}
	}
	return ""
}

func workspaceSnapshotReadVersionQuery(r *http.Request, companyID, scope string) store.WorkspaceReadVersionQuery {
	userID := workspaceReadVersionUserID(r, companyID)
	switch scope {
	case "full", "node_map", "node_map_window", "logic_gate_map", "logic_gate_map_window":
		return store.WorkspaceReadVersionQuery{CompanyID: companyID, UserID: userID, Scope: "workspace-snapshot:" + scope}
	case "company_explorer":
		folderKind := strings.TrimSpace(r.URL.Query().Get("folder_kind"))
		query := store.WorkspaceReadVersionQuery{CompanyID: companyID, UserID: userID, Scope: "workspace-snapshot:company_explorer"}
		if folderKind == "node" || folderKind == "logic_gate" || folderKind == "communications" {
			query.ResourceKey = store.WorkspaceReadVersionResourceKey("folder_kind", folderKind)
		}
		return query
	case "kanban":
		boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
		if boardID == "" {
			return store.WorkspaceReadVersionQuery{}
		}
		return store.WorkspaceReadVersionQuery{CompanyID: companyID, UserID: userID, Scope: "workspace-snapshot:kanban", ResourceKey: store.WorkspaceReadVersionResourceKey("board_id", boardID)}
	default:
		return store.WorkspaceReadVersionQuery{}
	}
}

func workspaceReadVersionUserID(r *http.Request, companyID string) string {
	actor, ok := authenticatedActor(r)
	if !ok || actorRoleForCompany(actor, companyID) == "" {
		return ""
	}
	return strings.TrimSpace(actor.User.UserID)
}

func (s *Server) writeWorkspaceEventNotModified(w http.ResponseWriter, r *http.Request, companyID, resource string, queries []store.DomainEventStreamQuery) (string, bool, error) {
	etag, err := s.workspaceEventETag(r, companyID, resource, queries)
	if err != nil {
		return "", false, err
	}
	return etag, writeNotModifiedWithETag(w, r, etag), nil
}

func folderKindPayload(kind string) map[string]string {
	return map[string]string{"folder_kind": strings.TrimSpace(kind)}
}

func itemTypePayload(itemType string) map[string]string {
	return map[string]string{"item_type": strings.TrimSpace(itemType)}
}

func boardIDPayload(boardID string) map[string]string {
	return map[string]string{"board_id": strings.TrimSpace(boardID)}
}
