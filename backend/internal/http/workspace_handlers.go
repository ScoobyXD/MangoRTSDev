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
	if scope != "" {
		s.handleScopedWorkspaceSnapshot(w, r, companyID, scope)
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
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
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
	})
}

func (s *Server) handleScopedWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID, scope string) {
	switch scope {
	case "node_map":
		s.handleNodeMapWorkspaceSnapshot(w, r, companyID)
	case "logic_gate_map":
		s.handleLogicGateMapWorkspaceSnapshot(w, r, companyID)
	case "company_explorer":
		s.handleCompanyExplorerWorkspaceSnapshot(w, r, companyID)
	case "kanban":
		s.handleKanbanWorkspaceSnapshot(w, r, companyID)
	default:
		writeError(w, http.StatusBadRequest, "invalid_workspace_snapshot_scope")
	}
}

func (s *Server) handleNodeMapWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID string) {
	folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
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
	positions, err := s.repo.ListNodeMapPositions(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_node_map_positions")
		return
	}
	folderItems := []domain.CompanyExplorerFolderItem{}
	if folderID != "" {
		folderItems, err = s.repo.ListCompanyExplorerFolderItems(companyID, folderID, "node")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
			return
		}
		visible := folderItemIDSet(folderItems)
		nodes = filterNodesByID(nodes, visible)
		relationships = filterNodeRelationshipsByVisibleEndpoints(relationships, visible)
		positions = filterNodePositionsByID(positions, visible)
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"scope":              "node_map",
		"company_id":         companyID,
		"folder_id":          folderID,
		"nodes":              nodes,
		"relationships":      relationships,
		"folder_items":       folderItems,
		"node_map_positions": positions,
	})
}

func (s *Server) handleLogicGateMapWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID string) {
	folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
	logicGates, err := s.repo.ListLogicGates(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gates")
		return
	}
	relationships, err := s.repo.ListLogicGateRelationships(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_relationships")
		return
	}
	positions, err := s.repo.ListLogicGateMapPositions(companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_map_positions")
		return
	}
	folderItems := []domain.CompanyExplorerFolderItem{}
	if folderID != "" {
		folderItems, err = s.repo.ListCompanyExplorerFolderItems(companyID, folderID, "logic_gate")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
			return
		}
		visible := folderItemIDSet(folderItems)
		logicGates = filterLogicGatesByID(logicGates, visible)
		relationships = filterLogicGateRelationshipsByVisibleEndpoints(relationships, visible)
		positions = filterLogicGatePositionsByID(positions, visible)
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"scope":                    "logic_gate_map",
		"company_id":               companyID,
		"folder_id":                folderID,
		"logic_gates":              logicGates,
		"logic_gate_relationships": relationships,
		"folder_items":             folderItems,
		"logic_gate_map_positions": positions,
	})
}

func (s *Server) handleCompanyExplorerWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID string) {
	folderKind := strings.TrimSpace(r.URL.Query().Get("folder_kind"))
	folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
	folders := []domain.CompanyExplorerFolder{}
	var err error
	if folderKind == "" {
		for _, kind := range []string{"node", "logic_gate", "communications"} {
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
	folderItems, err := s.repo.ListCompanyExplorerFolderItems(companyID, folderID, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folder_items")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"scope":        "company_explorer",
		"company_id":   companyID,
		"folder_kind":  folderKind,
		"folder_id":    folderID,
		"folders":      folders,
		"folder_items": folderItems,
	})
}

func (s *Server) handleKanbanWorkspaceSnapshot(w http.ResponseWriter, r *http.Request, companyID string) {
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
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"scope":       "kanban",
		"company_id":  companyID,
		"board_id":    boardID,
		"columns":     columns,
		"cards":       cards,
		"cards_limit": cardQuery.Limit,
	})
}

func folderItemIDSet(items []domain.CompanyExplorerFolderItem) map[string]bool {
	visible := make(map[string]bool, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.ItemID) != "" {
			visible[item.ItemID] = true
		}
	}
	return visible
}

func filterNodesByID(items []domain.Node, visible map[string]bool) []domain.Node {
	out := make([]domain.Node, 0, len(items))
	for _, item := range items {
		if visible[item.NodeID] {
			out = append(out, item)
		}
	}
	return out
}

func filterNodeRelationshipsByVisibleEndpoints(items []domain.NodeRelationship, visible map[string]bool) []domain.NodeRelationship {
	out := make([]domain.NodeRelationship, 0, len(items))
	for _, item := range items {
		if visible[item.NodeIDA] && visible[item.NodeIDB] {
			out = append(out, item)
		}
	}
	return out
}

func filterNodePositionsByID(items []domain.NodeMapPosition, visible map[string]bool) []domain.NodeMapPosition {
	out := make([]domain.NodeMapPosition, 0, len(items))
	for _, item := range items {
		if visible[item.NodeID] {
			out = append(out, item)
		}
	}
	return out
}

func filterLogicGatesByID(items []domain.LogicGate, visible map[string]bool) []domain.LogicGate {
	out := make([]domain.LogicGate, 0, len(items))
	for _, item := range items {
		if visible[item.LogicGateID] {
			out = append(out, item)
		}
	}
	return out
}

func filterLogicGateRelationshipsByVisibleEndpoints(items []domain.LogicGateRelationship, visible map[string]bool) []domain.LogicGateRelationship {
	out := make([]domain.LogicGateRelationship, 0, len(items))
	for _, item := range items {
		if visible[item.LogicGateIDA] && visible[item.LogicGateIDB] {
			out = append(out, item)
		}
	}
	return out
}

func filterLogicGatePositionsByID(items []domain.LogicGateMapPosition, visible map[string]bool) []domain.LogicGateMapPosition {
	out := make([]domain.LogicGateMapPosition, 0, len(items))
	for _, item := range items {
		if visible[item.LogicGateID] {
			out = append(out, item)
		}
	}
	return out
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
	afterSequence, ok := workspaceReplayAfterSequence(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_after_sequence")
		return
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

	if afterSequence > 0 {
		replay, err := s.repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: afterSequence, Limit: workspaceReplayLimit})
		if err != nil {
			log.Printf("workspace stream replay failed company_id=%s after_sequence=%d: %v", companyID, afterSequence, err)
		} else {
			for _, event := range replay {
				writeWorkspaceSSE(w, event)
				flusher.Flush()
			}
		}
	}

	heartbeat := time.NewTicker(sseHeartbeatInterval)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			fmt.Fprint(w, "event: ping\ndata: {}\n\n")
			flusher.Flush()
		case payload := <-ch:
			if sequence := workspacePayloadSequence(payload); sequence > 0 {
				fmt.Fprintf(w, "id: %d\nevent: workspace\ndata: %s\n\n", sequence, payload)
			} else {
				fmt.Fprintf(w, "event: workspace\ndata: %s\n\n", payload)
			}
			flusher.Flush()
		}
	}
}

func workspaceReplayAfterSequence(r *http.Request) (int64, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("after_sequence"))
	if raw == "" {
		raw = strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	}
	if raw == "" {
		return 0, true
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, false
	}
	return value, true
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
		payload, marshalErr := json.Marshal(workspaceEventEnvelope{CompanyID: companyID, Type: eventType, TS: time.Now().UTC(), Data: data})
		if marshalErr == nil {
			s.hub.publish(companyID, payload)
		}
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

func writeWorkspaceSSE(w http.ResponseWriter, event domain.DomainEvent) {
	payload, err := json.Marshal(workspaceEventEnvelopeFromDomainEvent(event))
	if err != nil {
		return
	}
	fmt.Fprintf(w, "id: %d\nevent: workspace\ndata: %s\n\n", event.Sequence, payload)
}
