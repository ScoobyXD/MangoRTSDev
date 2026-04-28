package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"miraeopus/backend/internal/store"
)

type Server struct {
	repo store.Repository
	hub  *workspaceEventHub
}

func NewServer(repo store.Repository) *Server {
	return &Server{
		repo: repo,
		hub:  newWorkspaceEventHub(),
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/v1/nodes", s.handleNodes)
	mux.HandleFunc("/v1/nodes/", s.handleNodeSubresource)
	mux.HandleFunc("/v1/node-relationships", s.handleNodeRelationships)
	mux.HandleFunc("/v1/node-relationships/", s.handleNodeRelationshipByID)
	mux.HandleFunc("/v1/workspace/snapshot", s.handleWorkspaceSnapshot)
	mux.HandleFunc("/v1/workspace/stream", s.handleWorkspaceStream)
	mux.HandleFunc("/v1/logic-gates", s.handleLogicGates)
	mux.HandleFunc("/v1/operations", s.handleOperations)
	mux.HandleFunc("/v1/operations/", s.handleOperationByID)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		items, err := s.repo.ListNodes(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_nodes")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"nodes": items})
		return
	}

	if r.Method == http.MethodPost {
		var req struct {
			CompanyID string `json:"company_id"`
			Header    string `json:"header"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.Header) == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_header_required")
			return
		}

		item, err := s.repo.CreateNode(req.CompanyID, req.Header)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_create_node")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "node_created", map[string]any{"node_id": item.NodeID, "node": item})
		writeJSON(w, http.StatusCreated, item)
		return
	}

	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func (s *Server) handleNodeSubresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/nodes/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	nodeID := parts[0]

	if len(parts) == 1 {
		if r.Method == http.MethodDelete {
			companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
			if companyID == "" {
				writeError(w, http.StatusBadRequest, "company_id_required")
				return
			}
			if err := s.repo.DeleteNode(companyID, nodeID); errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "node_not_found")
				return
			} else if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_delete_node")
				return
			}
			s.publishWorkspaceEvent(companyID, "node_deleted", map[string]any{"node_id": nodeID})
			writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		details, err := s.repo.GetNodeDetails(companyID, nodeID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_node")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, details)
		return
	}

	if len(parts) == 2 && parts[1] == "editor-projection" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		items, err := s.repo.ListNodeEditorProjections(companyID, nodeID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_node_editor_projection")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"company_id": companyID,
			"node_id":    nodeID,
			"items":      items,
		})
		return
	}

	if len(parts) == 2 && parts[1] == "information" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		var req struct {
			CompanyID   string `json:"company_id"`
			Type        string `json:"type"`
			Information string `json:"information"`
			InfoKey     string `json:"info_key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.Type) == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_type_required")
			return
		}

		item, err := s.repo.AddNodeInformation(req.CompanyID, nodeID, req.Type, req.Information, req.InfoKey)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_add_node_information")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "node_information_created", map[string]any{"node_id": nodeID, "information_id": item.InformationID})
		writeJSON(w, http.StatusCreated, item)
		return
	}

	writeError(w, http.StatusNotFound, "not_found")
}

func (s *Server) handleNodeRelationships(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		items, err := s.repo.ListNodeRelationships(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_node_relationships")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"relationships": items})
		return
	}

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID string `json:"company_id"`
		NodeIDA   string `json:"node_id_a"`
		NodeIDB   string `json:"node_id_b"`
		APosition string `json:"a_position"`
		BPosition string `json:"b_position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.NodeIDA) == "" || strings.TrimSpace(req.NodeIDB) == "" {
		writeError(w, http.StatusBadRequest, "company_id_node_ids_required")
		return
	}
	validPositions := map[string]bool{"Parent": true, "Child": true, "Peer": true}
	if !validPositions[req.APosition] || !validPositions[req.BPosition] {
		writeError(w, http.StatusBadRequest, "invalid_relationship_position")
		return
	}
	if strings.TrimSpace(req.NodeIDA) == strings.TrimSpace(req.NodeIDB) {
		writeError(w, http.StatusBadRequest, "self_relationship_not_allowed")
		return
	}
	if !isLegalNodeRelationshipPositionPair(req.APosition, req.BPosition) {
		writeError(w, http.StatusBadRequest, "illegal_relationship_pair")
		return
	}

	item, err := s.repo.CreateNodeRelationship(req.CompanyID, req.NodeIDA, req.NodeIDB, req.APosition, req.BPosition)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "node_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_node_relationship")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "relationship_created", map[string]any{"node_relationship_id": item.NodeRelationshipID, "node_id_a": item.NodeIDA, "node_id_b": item.NodeIDB, "relationship": item})
	writeJSON(w, http.StatusCreated, item)
}

func isLegalNodeRelationshipPositionPair(aPosition, bPosition string) bool {
	return (aPosition == "Parent" && bPosition == "Child") ||
		(aPosition == "Child" && bPosition == "Parent") ||
		(aPosition == "Peer" && bPosition == "Peer")
}

func (s *Server) handleNodeRelationshipByID(w http.ResponseWriter, r *http.Request) {
	relationshipID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/node-relationships/"))
	if relationshipID == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if strings.Contains(relationshipID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if err := s.repo.DeleteNodeRelationship(companyID, relationshipID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "relationship_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_node_relationship")
		return
	}
	s.publishWorkspaceEvent(companyID, "relationship_deleted", map[string]any{"node_relationship_id": relationshipID})
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

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
	// Keep snapshot payload deterministic for unchanged data so ETag-based 304 responses
	// actually work. Using a "now" timestamp here makes every response look different and
	// defeats conditional GETs on this hot path.
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"nodes": nodes, "relationships": relationships})
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

	ch := s.hub.subscribe()
	defer s.hub.unsubscribe(ch)

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
			var envelope workspaceEventEnvelope
			if err := json.Unmarshal(payload, &envelope); err != nil {
				continue
			}
			if envelope.CompanyID != companyID {
				continue
			}
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
	subscribers map[chan []byte]struct{}
}

func newWorkspaceEventHub() *workspaceEventHub {
	return &workspaceEventHub{subscribers: map[chan []byte]struct{}{}}
}

func (h *workspaceEventHub) subscribe() chan []byte {
	ch := make(chan []byte, 24)
	h.mu.Lock()
	h.subscribers[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *workspaceEventHub) unsubscribe(ch chan []byte) {
	h.mu.Lock()
	delete(h.subscribers, ch)
	h.mu.Unlock()
	close(ch)
}

func (h *workspaceEventHub) publish(payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subscribers {
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
	s.hub.publish(payload)
}

func (s *Server) handleLogicGates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID string `json:"company_id"`
		Header    string `json:"header"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.Header) == "" {
		writeError(w, http.StatusBadRequest, "company_id_and_header_required")
		return
	}
	item, err := s.repo.CreateLogicGate(req.CompanyID, req.Header)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_logic_gate")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleOperations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID      string  `json:"company_id"`
		NodeID         *string `json:"node_id"`
		LogicGateID    *string `json:"logic_gate_id"`
		Status         string  `json:"status"`
		StartTimestamp string  `json:"start_timestamp"`
		EndTimestamp   *string `json:"end_timestamp"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.Status) == "" || strings.TrimSpace(req.StartTimestamp) == "" {
		writeError(w, http.StatusBadRequest, "company_id_status_start_timestamp_required")
		return
	}
	start, err := time.Parse(time.RFC3339, req.StartTimestamp)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_start_timestamp")
		return
	}
	var end *time.Time
	if req.EndTimestamp != nil && strings.TrimSpace(*req.EndTimestamp) != "" {
		parsed, parseErr := time.Parse(time.RFC3339, *req.EndTimestamp)
		if parseErr != nil {
			writeError(w, http.StatusBadRequest, "invalid_end_timestamp")
			return
		}
		end = &parsed
	}

	item, err := s.repo.CreateOperation(store.CreateOperationInput{
		CompanyID:      req.CompanyID,
		NodeID:         req.NodeID,
		LogicGateID:    req.LogicGateID,
		Status:         req.Status,
		StartTimestamp: start,
		EndTimestamp:   end,
	})
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "referenced_node_or_logic_gate_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_operation")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleOperationByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	operationID := strings.TrimPrefix(r.URL.Path, "/v1/operations/")
	if strings.TrimSpace(operationID) == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}

	item, err := s.repo.GetOperation(companyID, operationID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "operation_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_operation")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, item)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONMaybeNotModified(w http.ResponseWriter, r *http.Request, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_encode_json")
		return
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:]) + `"`
	if strings.TrimSpace(r.Header.Get("If-None-Match")) == etag {
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", etag)
	w.WriteHeader(status)
	_, _ = w.Write(append(bytes.Clone(body), '\n'))
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}
