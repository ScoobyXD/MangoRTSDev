package httpapi

import (
	"encoding/json"
	"fmt"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
	"sync"
	"time"
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
	folders, err := s.repo.ListCompanyExplorerFolders(companyID, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_folders")
		return
	}
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
	// Keep snapshot payload deterministic for unchanged data so ETag-based 304 responses
	// actually work. Using a "now" timestamp here makes every response look different and
	// defeats conditional GETs on this hot path.
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
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
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "stream_unsupported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := s.hub.subscribe(companyID)
	defer s.hub.unsubscribe(companyID, ch)

	fmt.Fprintf(w, "event: ready\ndata: {\"company_id\":%q}\n\n", companyID)
	flusher.Flush()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			fmt.Fprint(w, "event: ping\ndata: {}\n\n")
			flusher.Flush()
		case payload := <-ch:
			fmt.Fprintf(w, "event: workspace\ndata: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

type workspaceEventEnvelope struct {
	CompanyID string         `json:"company_id"`
	Type      string         `json:"type"`
	TS        time.Time      `json:"ts"`
	Data      map[string]any `json:"data,omitempty"`
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
	payload, err := json.Marshal(workspaceEventEnvelope{
		CompanyID: companyID,
		Type:      eventType,
		TS:        time.Now().UTC(),
		Data:      data,
	})
	if err != nil {
		return
	}
	s.hub.publish(companyID, payload)
}
