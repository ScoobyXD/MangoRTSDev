package httpapi

import (
	"encoding/json"
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
	nodes, err := s.repo.ListNodes(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_nodes")
		return
	}
	relationships, err := s.repo.ListNodeRelationships(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_node_relationships")
		return
	}
	logicGates, err := s.repo.ListLogicGates(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gates")
		return
	}
	logicGateRelationships, err := s.repo.ListLogicGateRelationships(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_relationships")
		return
	}
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
	folderItems, err := s.repo.ListCompanyExplorerFolderItems(companyID, "", "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
		return
	}
	nodeMapPositions, err := s.repo.ListNodeMapPositions(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_node_map_positions")
		return
	}
	logicGateMapPositions, err := s.repo.ListLogicGateMapPositions(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_map_positions")
		return
	}
	kanbanBoards, err := s.repo.ListKanbanBoards(companyID, store.KanbanBoardQuery{Limit: store.KanbanMaxBoardsLimit})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_kanban_boards")
		return
	}
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{
		"scope":                    "full",
		"nodes":                    nodes,
		"relationships":            relationships,
		"logic_gates":              logicGates,
		"logic_gate_relationships": logicGateRelationships,
		"folders":                  folders,
		"folder_items":             folderItems,
		"node_map_positions":       nodeMapPositions,
		"logic_gate_map_positions": logicGateMapPositions,
		"kanban_boards":            kanbanBoards,
	}, etag)
}

func (s *Server) workspaceSnapshotETag(r *http.Request, companyID, scope string) (string, error) {
	return s.workspaceEventETag(r, companyID, "workspace-snapshot:"+scope, workspaceSnapshotVersionQueries(r, scope))
}

func workspaceSnapshotVersionQueries(r *http.Request, scope string) []store.DomainEventStreamQuery {
	switch scope {
	case "node_map":
		return []store.DomainEventStreamQuery{
			workspaceEventQuery(nodeListWorkspaceEventTypes...),
			workspaceEventQuery(nodeRelationshipWorkspaceEventTypes...),
			workspaceEventQuery(nodeMapPositionWorkspaceEventTypes...),
			workspaceEventQueryPayload(companyExplorerFolderWorkspaceEventTypes, folderKindPayload("node")),
			workspaceEventQueryPayload(companyExplorerFolderItemWorkspaceEventTypes, itemTypePayload("node")),
		}
	case "logic_gate_map":
		return []store.DomainEventStreamQuery{
			workspaceEventQuery(logicGateListWorkspaceEventTypes...),
			workspaceEventQuery(logicGateRelationshipWorkspaceEventTypes...),
			workspaceEventQuery(logicGateMapPositionWorkspaceEventTypes...),
			workspaceEventQueryPayload(companyExplorerFolderWorkspaceEventTypes, folderKindPayload("logic_gate")),
			workspaceEventQueryPayload(companyExplorerFolderItemWorkspaceEventTypes, itemTypePayload("logic_gate")),
		}
	case "company_explorer":
		folderKind := strings.TrimSpace(r.URL.Query().Get("folder_kind"))
		queries := []store.DomainEventStreamQuery{
			workspaceEventQuery(nodeListWorkspaceEventTypes...),
			workspaceEventQuery(logicGateListWorkspaceEventTypes...),
			workspaceEventQueryPayload(companyExplorerFolderItemWorkspaceEventTypes, itemTypePayload("node")),
			workspaceEventQueryPayload(companyExplorerFolderItemWorkspaceEventTypes, itemTypePayload("logic_gate")),
		}
		if folderKind == "" {
			for _, kind := range []string{"node", "logic_gate"} {
				queries = append(queries, workspaceEventQueryPayload(companyExplorerFolderWorkspaceEventTypes, folderKindPayload(kind)))
			}
		} else {
			queries = append(queries, workspaceEventQueryPayload(companyExplorerFolderWorkspaceEventTypes, folderKindPayload(folderKind)))
		}
		return queries
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
	case "logic_gate_map":
		s.handleLogicGateMapWorkspaceSnapshot(w, r, companyID, etag)
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
	var nodes []domain.Node
	var relationships []domain.NodeRelationship
	var positions []domain.NodeMapPosition
	var folders []domain.CompanyExplorerFolder
	var folderItems []domain.CompanyExplorerFolderItem
	var err error
	if folderID == "" {
		nodes, err = s.repo.ListNodes(companyID)
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
		folderItems, err = s.repo.ListCompanyExplorerFolderItems(companyID, "", "node")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
			return
		}
	} else {
		nodes, err = s.repo.ListNodesInFolderSubtree(companyID, folderID)
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
		folderItems, err = s.repo.ListCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, "node")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
			return
		}
	}
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
func (s *Server) handleLogicGateMapWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID, etag string) {
	folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
	var logicGates []domain.LogicGate
	var relationships []domain.LogicGateRelationship
	var positions []domain.LogicGateMapPosition
	var folders []domain.CompanyExplorerFolder
	var folderItems []domain.CompanyExplorerFolderItem
	var err error
	if folderID == "" {
		logicGates, err = s.repo.ListLogicGates(companyID)
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
		folderItems, err = s.repo.ListCompanyExplorerFolderItems(companyID, "", "logic_gate")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
			return
		}
	} else {
		logicGates, err = s.repo.ListLogicGatesInFolderSubtree(companyID, folderID)
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
		folderItems, err = s.repo.ListCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, "logic_gate")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
			return
		}
	}
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
	folders := []domain.CompanyExplorerFolder{}
	var folderItems []domain.CompanyExplorerFolderItem
	var err error
	if folderID != "" {
		folders, err = s.repo.ListCompanyExplorerFolderSubtree(companyID, folderID, folderKind)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
			return
		}
		folderItems, err = s.repo.ListCompanyExplorerFolderItemsInFolderSubtree(companyID, folderID, "")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
			return
		}
	} else {
		if folderKind == "" {
			for _, kind := range []string{"node", "logic_gate"} {
				items, listErr := s.repo.ListCompanyExplorerFolders(companyID, kind)
				if listErr != nil {
					err = listErr
					break
				}
				folders = append(folders, items...)
			}
		} else {
			folders, err = s.repo.ListCompanyExplorerFolders(companyID, folderKind)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
			return
		}
		folderItems, err = s.repo.ListCompanyExplorerFolderItems(companyID, "", "")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
			return
		}
	}
	nodes, err := s.repo.ListCompanyExplorerNodeSummaries(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_node_summaries")
		return
	}
	logicGates, err := s.repo.ListCompanyExplorerLogicGateSummaries(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_summaries")
		return
	}
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

	ch := s.hub.subscribe(companyID)
	defer s.hub.unsubscribe(companyID, ch)

	fmt.Fprintf(w, "event: ready\ndata: {\"company_id\":%q,\"after_sequence\":%d}\n\n", companyID, afterSequence)
	flusher.Flush()

	lastSentSequence := afterSequence
	if explicitCursor {
		if err := s.writeWorkspaceDurableCatchup(w, flusher, companyID, &lastSentSequence); err != nil {
			log.Printf("workspace stream replay failed company_id=%s after_sequence=%d: %v", companyID, afterSequence, err)
		}
	}

	heartbeat := time.NewTicker(sseHeartbeatInterval)
	defer heartbeat.Stop()
	catchup := time.NewTicker(workspaceCatchupInterval)
	defer catchup.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			fmt.Fprint(w, "event: ping\ndata: {}\n\n")
			flusher.Flush()
		case <-catchup.C:
			if err := s.writeWorkspaceDurableCatchup(w, flusher, companyID, &lastSentSequence); err != nil {
				log.Printf("workspace stream catch-up failed company_id=%s after_sequence=%d: %v", companyID, lastSentSequence, err)
			}
		case payload := <-ch:
			sequence := workspacePayloadSequence(payload)
			if sequence > 0 && sequence <= lastSentSequence {
				continue
			}
			if err := s.writeWorkspaceDurableCatchup(w, flusher, companyID, &lastSentSequence); err != nil {
				log.Printf("workspace stream hub catch-up failed company_id=%s after_sequence=%d payload_sequence=%d: %v", companyID, lastSentSequence, sequence, err)
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

func (s *Server) writeWorkspaceDurableCatchup(w http.ResponseWriter, flusher http.Flusher, companyID string, lastSentSequence *int64) error {
	for {
		replay, err := s.repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: *lastSentSequence, Limit: workspaceReplayLimit})
		if err != nil {
			return err
		}
		if len(replay) == 0 {
			return nil
		}
		for _, event := range replay {
			if event.Sequence <= *lastSentSequence {
				continue
			}
			if writeWorkspaceSSE(w, event) {
				*lastSentSequence = event.Sequence
			}
		}
		flusher.Flush()
		if len(replay) < workspaceReplayLimit {
			return nil
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

func newWorkspaceEventHub() *workspaceEventHub {
	return &workspaceEventHub{subscribers: map[string]map[chan []byte]struct{}{}}
}

func (h *workspaceEventHub) subscribe(companyID string) chan []byte {
	ch := make(chan []byte, 24)
	h.mu.Lock()
	bucket := h.subscribers[companyID]
	if bucket == nil {
		bucket = map[chan []byte]struct{}{}
		h.subscribers[companyID] = bucket
	}
	bucket[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *workspaceEventHub) unsubscribe(companyID string, ch chan []byte) {
	h.mu.Lock()
	if bucket := h.subscribers[companyID]; bucket != nil {
		delete(bucket, ch)
		if len(bucket) == 0 {
			delete(h.subscribers, companyID)
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
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subscribers[companyID] {
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
	payload, err := json.Marshal(workspaceEventEnvelopeFromDomainEvent(event))
	if err != nil {
		return
	}
	s.hub.publish(companyID, payload)
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
