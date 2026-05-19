package httpapi

import (
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
)

var (
	nodeListWorkspaceEventTypes = []string{
		"node_created",
		"node_updated",
		"node_deleted",
		"kanban_card_upserted",
		"kanban_card_moved",
		"kanban_card_deleted",
		"kanban_column_deleted",
		"kanban_board_deleted",
	}
	nodeRelationshipWorkspaceEventTypes = []string{
		"relationship_created",
		"relationship_deleted",
	}
	logicGateListWorkspaceEventTypes = []string{
		"logic_gate_created",
		"logic_gate_updated",
		"logic_gate_deleted",
		"logic_gate_raci_updated",
	}
	logicGateRelationshipWorkspaceEventTypes = []string{
		"logic_gate_relationship_created",
		"logic_gate_relationship_deleted",
	}
	nodeMapPositionWorkspaceEventTypes = []string{
		"node_map_positions_updated",
	}
	logicGateMapPositionWorkspaceEventTypes = []string{
		"logic_gate_map_positions_updated",
	}
	companyExplorerFolderWorkspaceEventTypes = []string{
		"company_explorer_folder_created",
		"company_explorer_folder_updated",
		"company_explorer_folder_deleted",
		"communications_shared_inbox_raci_updated",
	}
	companyExplorerFolderItemWorkspaceEventTypes = []string{
		"company_explorer_folder_item_assigned",
		"company_explorer_folder_item_removed",
	}
	kanbanBoardWorkspaceEventTypes = []string{
		"kanban_board_saved",
		"kanban_board_updated",
		"kanban_board_deleted",
	}
	kanbanColumnWorkspaceEventTypes = []string{
		"kanban_column_created",
		"kanban_column_updated",
		"kanban_column_deleted",
		"kanban_board_deleted",
	}
	kanbanCardWorkspaceEventTypes = []string{
		"kanban_card_upserted",
		"kanban_card_moved",
		"kanban_card_deleted",
		"kanban_column_deleted",
		"kanban_board_deleted",
	}
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
	version, err := s.workspaceEventVersion(companyID, queries)
	if err != nil {
		return "", err
	}
	return strongETagFromString("workspace-events:" + companyID + ":" + resource + ":" + r.URL.Path + "?" + r.URL.Query().Encode() + ":" + strconv.FormatInt(version, 10)), nil
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
