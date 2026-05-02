package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"miraeopus/backend/internal/domain"
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
	mux.HandleFunc("/v1/workspace/context-events", s.handleWorkspaceContextEvents)
	mux.HandleFunc("/v1/workspace/context-projections", s.handleWorkspaceContextProjections)
	mux.HandleFunc("/v1/workspace/context-deltas", s.handleWorkspaceContextDeltas)
	mux.HandleFunc("/v1/workspace/folders", s.handleWorkspaceFolders)
	mux.HandleFunc("/v1/workspace/folders/", s.handleWorkspaceFolderByID)
	mux.HandleFunc("/v1/workspace/folder-items", s.handleWorkspaceFolderItems)
	mux.HandleFunc("/v1/logic-gates", s.handleLogicGates)
	mux.HandleFunc("/v1/logic-gates/", s.handleLogicGateSubresource)
	mux.HandleFunc("/v1/logic-gate-relationships", s.handleLogicGateRelationships)
	mux.HandleFunc("/v1/logic-gate-relationships/", s.handleLogicGateRelationshipByID)
	mux.HandleFunc("/v1/operations", s.handleOperations)
	mux.HandleFunc("/v1/operations/", s.handleOperationByID)
	mux.HandleFunc("/v1/kanban/columns", s.handleKanbanColumns)
	mux.HandleFunc("/v1/kanban/columns/", s.handleKanbanColumnByID)
	mux.HandleFunc("/v1/kanban/cards", s.handleKanbanCards)
	mux.HandleFunc("/v1/kanban/cards/", s.handleKanbanCardByID)
	return mux
}

func (s *Server) handleWorkspaceContextEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID      string          `json:"company_id"`
		WorkspaceID    string          `json:"workspace_id"`
		ContextID      string          `json:"context_id"`
		SourceModuleID string          `json:"source_module_id"`
		Sequence       int64           `json:"sequence"`
		UserActionType string          `json:"user_action_type"`
		Payload        json.RawMessage `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.WorkspaceID) == "" || strings.TrimSpace(req.ContextID) == "" || strings.TrimSpace(req.SourceModuleID) == "" || req.Sequence <= 0 || strings.TrimSpace(req.UserActionType) == "" {
		writeError(w, http.StatusBadRequest, "company_workspace_context_source_sequence_user_action_type_required")
		return
	}
	payloadJSON := "{}"
	if len(req.Payload) > 0 {
		payloadJSON = string(req.Payload)
	}
	projection, err := s.repo.AppendWorkspaceContextEvent(domain.WorkspaceContextEvent{
		CompanyID:      req.CompanyID,
		WorkspaceID:    req.WorkspaceID,
		ContextID:      req.ContextID,
		SourceModuleID: req.SourceModuleID,
		Sequence:       req.Sequence,
		UserActionType: req.UserActionType,
		PayloadJSON:    payloadJSON,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_append_workspace_context_event")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "workspace_context_projection_updated", map[string]any{
		"workspace_id":     req.WorkspaceID,
		"context_id":       req.ContextID,
		"sequence":         projection.LastSequence,
		"user_action_type": req.UserActionType,
	})
	writeJSON(w, http.StatusCreated, projection)
}

func (s *Server) handleWorkspaceContextProjections(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	workspaceID := strings.TrimSpace(r.URL.Query().Get("workspace_id"))
	contextID := strings.TrimSpace(r.URL.Query().Get("context_id"))
	if companyID == "" || workspaceID == "" || contextID == "" {
		writeError(w, http.StatusBadRequest, "company_workspace_context_required")
		return
	}
	item, err := s.repo.GetWorkspaceContextProjection(companyID, workspaceID, contextID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "workspace_context_projection_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_get_workspace_context_projection")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, item)
}

func (s *Server) handleWorkspaceContextDeltas(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	workspaceID := strings.TrimSpace(r.URL.Query().Get("workspace_id"))
	contextID := strings.TrimSpace(r.URL.Query().Get("context_id"))
	if companyID == "" || workspaceID == "" || contextID == "" {
		writeError(w, http.StatusBadRequest, "company_workspace_context_required")
		return
	}
	var afterSequence int64
	if raw := strings.TrimSpace(r.URL.Query().Get("after_sequence")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, "invalid_after_sequence")
			return
		}
		afterSequence = parsed
	}
	events, err := s.repo.ListWorkspaceContextEventsAfterSequence(companyID, workspaceID, contextID, afterSequence, 250)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_workspace_context_deltas")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"company_id":     companyID,
		"workspace_id":   workspaceID,
		"context_id":     contextID,
		"after_sequence": afterSequence,
		"events":         events,
	})
}

func (s *Server) handleWorkspaceFolders(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		folderKind := strings.TrimSpace(r.URL.Query().Get("folder_kind"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if folderKind != "" && !isValidWorkspaceFolderKind(folderKind) {
			writeError(w, http.StatusBadRequest, "invalid_folder_kind")
			return
		}
		items, err := s.repo.ListWorkspaceFolders(companyID, folderKind)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_workspace_folders")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"folders": items})
		return
	}

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID      string `json:"company_id"`
		ParentFolderID string `json:"parent_folder_id"`
		FolderKind     string `json:"folder_kind"`
		Name           string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.ParentFolderID = strings.TrimSpace(req.ParentFolderID)
	req.FolderKind = strings.TrimSpace(req.FolderKind)
	req.Name = strings.TrimSpace(req.Name)
	if req.CompanyID == "" || req.Name == "" || !isValidWorkspaceFolderKind(req.FolderKind) {
		writeError(w, http.StatusBadRequest, "company_id_folder_kind_name_required")
		return
	}
	item, err := s.repo.CreateWorkspaceFolder(req.CompanyID, req.ParentFolderID, req.FolderKind, req.Name)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "parent_folder_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_workspace_folder")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "workspace_folder_created", map[string]any{"folder_id": item.FolderID, "folder": item})
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleWorkspaceFolderByID(w http.ResponseWriter, r *http.Request) {
	folderID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/workspace/folders/"))
	if folderID == "" || strings.Contains(folderID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}

	if r.Method == http.MethodPut {
		var req struct {
			CompanyID      string `json:"company_id"`
			ParentFolderID string `json:"parent_folder_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		req.ParentFolderID = strings.TrimSpace(req.ParentFolderID)
		if req.CompanyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		item, err := s.repo.MoveWorkspaceFolder(req.CompanyID, folderID, req.ParentFolderID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "workspace_folder_not_found")
			return
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_workspace_folder_move")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_move_workspace_folder")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "workspace_folder_moved", map[string]any{"folder_id": item.FolderID, "folder": item})
		writeJSON(w, http.StatusOK, item)
		return
	}

	if r.Method == http.MethodDelete {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if err := s.repo.DeleteWorkspaceFolder(companyID, folderID); errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "workspace_folder_not_found")
			return
		} else if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_delete_workspace_folder")
			return
		}
		s.publishWorkspaceEvent(companyID, "workspace_folder_deleted", map[string]any{"folder_id": folderID})
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}

	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func (s *Server) handleWorkspaceFolderItems(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
		itemType := strings.TrimSpace(r.URL.Query().Get("item_type"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if itemType != "" && !isValidWorkspaceFolderKind(itemType) {
			writeError(w, http.StatusBadRequest, "invalid_item_type")
			return
		}
		items, err := s.repo.ListWorkspaceFolderItems(companyID, folderID, itemType)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_workspace_folder_items")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"folder_items": items})
		return
	}

	if r.Method == http.MethodPost {
		var req struct {
			CompanyID string `json:"company_id"`
			FolderID  string `json:"folder_id"`
			ItemType  string `json:"item_type"`
			ItemID    string `json:"item_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		req.FolderID = strings.TrimSpace(req.FolderID)
		req.ItemType = strings.TrimSpace(req.ItemType)
		req.ItemID = strings.TrimSpace(req.ItemID)
		if req.CompanyID == "" || req.FolderID == "" || req.ItemID == "" || !isValidWorkspaceFolderKind(req.ItemType) {
			writeError(w, http.StatusBadRequest, "company_folder_item_required")
			return
		}
		item, err := s.repo.AssignWorkspaceFolderItem(req.CompanyID, req.FolderID, req.ItemType, req.ItemID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "workspace_folder_or_item_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_assign_workspace_folder_item")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "workspace_folder_item_assigned", map[string]any{"folder_item": item})
		writeJSON(w, http.StatusOK, item)
		return
	}

	if r.Method == http.MethodDelete {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		itemType := strings.TrimSpace(r.URL.Query().Get("item_type"))
		itemID := strings.TrimSpace(r.URL.Query().Get("item_id"))
		if companyID == "" || itemID == "" || !isValidWorkspaceFolderKind(itemType) {
			writeError(w, http.StatusBadRequest, "company_item_required")
			return
		}
		if err := s.repo.RemoveWorkspaceFolderItem(companyID, itemType, itemID); errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "workspace_folder_item_not_found")
			return
		} else if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_remove_workspace_folder_item")
			return
		}
		s.publishWorkspaceEvent(companyID, "workspace_folder_item_removed", map[string]any{"item_type": itemType, "item_id": itemID})
		writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
		return
	}

	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func isValidWorkspaceFolderKind(value string) bool {
	return value == "node" || value == "logic_gate"
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
			Title     string `json:"title"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.Title) == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_title_required")
			return
		}

		item, err := s.repo.CreateNode(req.CompanyID, strings.TrimSpace(req.Title))
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
		if r.Method == http.MethodPut {
			var req struct {
				CompanyID string `json:"company_id"`
				Title     string `json:"title"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_json")
				return
			}
			if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.Title) == "" {
				writeError(w, http.StatusBadRequest, "company_id_and_title_required")
				return
			}
			item, err := s.repo.UpdateNodeTitle(req.CompanyID, nodeID, strings.TrimSpace(req.Title))
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "node_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_update_node")
				return
			}
			s.publishWorkspaceEvent(req.CompanyID, "node_updated", map[string]any{"node_id": nodeID, "node": item})
			writeJSON(w, http.StatusOK, item)
			return
		}
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

	if len(parts) == 2 && parts[1] == "projection" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		items, err := s.repo.ListNodeProjections(companyID, nodeID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_node_projection")
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
			CompanyID     string `json:"company_id"`
			Type          string `json:"type"`
			Information   string `json:"information"`
			InformationID string `json:"information_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.Type) == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_type_required")
			return
		}
		if strings.TrimSpace(req.Information) == "" {
			// UI clients and future headless agents share this endpoint. Guarding here keeps
			// blank editor blurs from creating hot-path history/projection noise in Postgres.
			writeError(w, http.StatusBadRequest, "information_required")
			return
		}

		item, err := s.repo.AddNodeInformation(req.CompanyID, nodeID, req.Type, req.Information, req.InformationID)
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
	folders, err := s.repo.ListWorkspaceFolders(companyID, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_workspace_folders")
		return
	}
	folderItems, err := s.repo.ListWorkspaceFolderItems(companyID, "", "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_workspace_folder_items")
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
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		items, err := s.repo.ListLogicGates(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gates")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"logic_gates": items})
		return
	}

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
	s.publishWorkspaceEvent(req.CompanyID, "logic_gate_created", map[string]any{"logic_gate_id": item.LogicGateID, "logic_gate": item})
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleLogicGateSubresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/logic-gates/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	logicGateID := parts[0]

	if len(parts) == 1 {
		if r.Method == http.MethodPut {
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
			item, err := s.repo.UpdateLogicGateHeader(req.CompanyID, logicGateID, strings.TrimSpace(req.Header))
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "logic_gate_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_update_logic_gate")
				return
			}
			s.publishWorkspaceEvent(req.CompanyID, "logic_gate_updated", map[string]any{"logic_gate_id": logicGateID, "logic_gate": item})
			writeJSON(w, http.StatusOK, item)
			return
		}
		if r.Method == http.MethodDelete {
			companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
			if companyID == "" {
				writeError(w, http.StatusBadRequest, "company_id_required")
				return
			}
			if err := s.repo.DeleteLogicGate(companyID, logicGateID); errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "logic_gate_not_found")
				return
			} else if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_delete_logic_gate")
				return
			}
			s.publishWorkspaceEvent(companyID, "logic_gate_deleted", map[string]any{"logic_gate_id": logicGateID})
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
		details, err := s.repo.GetLogicGateDetails(companyID, logicGateID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "logic_gate_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, details)
		return
	}

	if len(parts) == 2 && parts[1] == "projection" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		items, err := s.repo.ListLogicGateProjections(companyID, logicGateID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "logic_gate_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_projection")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"company_id":    companyID,
			"logic_gate_id": logicGateID,
			"items":         items,
		})
		return
	}

	if len(parts) == 2 && parts[1] == "information" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		var req struct {
			CompanyID     string `json:"company_id"`
			Type          string `json:"type"`
			Information   string `json:"information"`
			InformationID string `json:"information_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.Type) == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_type_required")
			return
		}
		if strings.TrimSpace(req.Information) == "" {
			// Keep the API contract strict: empty text boxes should not become durable
			// logic_gate_information rows, no matter whether the caller is UI or an agent.
			writeError(w, http.StatusBadRequest, "information_required")
			return
		}
		item, err := s.repo.AddLogicGateInformation(req.CompanyID, logicGateID, req.Type, req.Information, req.InformationID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "logic_gate_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_add_logic_gate_information")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "logic_gate_information_created", map[string]any{"logic_gate_id": logicGateID, "information_id": item.InformationID})
		writeJSON(w, http.StatusCreated, item)
		return
	}

	writeError(w, http.StatusNotFound, "not_found")
}

func (s *Server) handleLogicGateRelationships(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		items, err := s.repo.ListLogicGateRelationships(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_relationships")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"logic_gate_relationships": items})
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID    string `json:"company_id"`
		LogicGateIDA string `json:"logic_gate_id_a"`
		LogicGateIDB string `json:"logic_gate_id_b"`
		APosition    string `json:"a_position"`
		BPosition    string `json:"b_position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.LogicGateIDA) == "" || strings.TrimSpace(req.LogicGateIDB) == "" {
		writeError(w, http.StatusBadRequest, "company_id_logic_gate_ids_required")
		return
	}
	validPositions := map[string]bool{"Input": true, "Output": true}
	if !validPositions[req.APosition] || !validPositions[req.BPosition] {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_relationship_position")
		return
	}
	if strings.TrimSpace(req.LogicGateIDA) == strings.TrimSpace(req.LogicGateIDB) {
		writeError(w, http.StatusBadRequest, "self_relationship_not_allowed")
		return
	}
	if !isLegalLogicGateRelationshipPositionPair(req.APosition, req.BPosition) {
		writeError(w, http.StatusBadRequest, "illegal_logic_gate_relationship_pair")
		return
	}
	item, err := s.repo.CreateLogicGateRelationship(req.CompanyID, req.LogicGateIDA, req.LogicGateIDB, req.APosition, req.BPosition)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_logic_gate_relationship")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "logic_gate_relationship_created", map[string]any{
		"logic_gate_relationship_id": item.LogicGateRelationshipID,
		"logic_gate_id_a":            item.LogicGateIDA,
		"logic_gate_id_b":            item.LogicGateIDB,
		"logic_gate_relationship":    item,
	})
	writeJSON(w, http.StatusCreated, item)
}

func isLegalLogicGateRelationshipPositionPair(aPosition, bPosition string) bool {
	return (aPosition == "Input" && bPosition == "Output") ||
		(aPosition == "Output" && bPosition == "Input")
}

func (s *Server) handleLogicGateRelationshipByID(w http.ResponseWriter, r *http.Request) {
	relationshipID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/logic-gate-relationships/"))
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
	if err := s.repo.DeleteLogicGateRelationship(companyID, relationshipID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_relationship_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_logic_gate_relationship")
		return
	}
	s.publishWorkspaceEvent(companyID, "logic_gate_relationship_deleted", map[string]any{"logic_gate_relationship_id": relationshipID})
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
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

func parsePositiveLimit(raw string, fallback int, maximum int) (int, bool) {
	value := fallback
	if strings.TrimSpace(raw) != "" {
		parsed, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || parsed <= 0 {
			return 0, false
		}
		value = parsed
	}
	if value > maximum {
		value = maximum
	}
	return value, true
}

func (s *Server) handleKanbanColumns(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
		if companyID == "" || boardID == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_board_id_required")
			return
		}
		items, err := s.repo.ListKanbanColumns(companyID, boardID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_kanban_columns")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"columns": items})
		return
	}

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID string `json:"company_id"`
		BoardID   string `json:"board_id"`
		Title     string `json:"title"`
		Position  int    `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.BoardID = strings.TrimSpace(req.BoardID)
	req.Title = strings.TrimSpace(req.Title)
	if req.CompanyID == "" || req.BoardID == "" || req.Title == "" {
		writeError(w, http.StatusBadRequest, "company_id_board_id_and_title_required")
		return
	}
	item, err := s.repo.CreateKanbanColumn(req.CompanyID, req.BoardID, req.Title, req.Position)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_kanban_column")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "kanban_column_created", map[string]any{
		"board_id":  req.BoardID,
		"column_id": item.ColumnID,
		"column":    item,
	})
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleKanbanColumnByID(w http.ResponseWriter, r *http.Request) {
	columnID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/kanban/columns/"))
	if columnID == "" || strings.Contains(columnID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method == http.MethodPut {
		var req struct {
			CompanyID string `json:"company_id"`
			BoardID   string `json:"board_id"`
			Title     string `json:"title"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		req.BoardID = strings.TrimSpace(req.BoardID)
		req.Title = strings.TrimSpace(req.Title)
		if req.CompanyID == "" || req.BoardID == "" || req.Title == "" {
			writeError(w, http.StatusBadRequest, "company_id_board_id_and_title_required")
			return
		}
		item, err := s.repo.UpdateKanbanColumnTitle(req.CompanyID, req.BoardID, columnID, req.Title)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "kanban_column_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_update_kanban_column")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "kanban_column_updated", map[string]any{
			"board_id":  req.BoardID,
			"column_id": columnID,
			"column":    item,
		})
		writeJSON(w, http.StatusOK, item)
		return
	}
	if r.Method == http.MethodDelete {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
		if companyID == "" || boardID == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_board_id_required")
			return
		}
		err := s.repo.DeleteKanbanColumn(companyID, boardID, columnID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "kanban_column_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_delete_kanban_column")
			return
		}
		s.publishWorkspaceEvent(companyID, "kanban_column_deleted", map[string]any{
			"board_id":  boardID,
			"column_id": columnID,
		})
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func (s *Server) handleKanbanCards(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
		columnID := strings.TrimSpace(r.URL.Query().Get("column_id"))
		limit, ok := parsePositiveLimit(r.URL.Query().Get("limit"), 200, 500)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_limit")
			return
		}
		afterPosition := 0
		if raw := strings.TrimSpace(r.URL.Query().Get("after_position")); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed < 0 {
				writeError(w, http.StatusBadRequest, "invalid_after_position")
				return
			}
			afterPosition = parsed
		}
		if companyID == "" || boardID == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_board_id_required")
			return
		}
		items, err := s.repo.ListKanbanCards(companyID, boardID, columnID, afterPosition, limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_kanban_cards")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"cards": items})
		return
	}

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID     string `json:"company_id"`
		BoardID       string `json:"board_id"`
		ColumnID      string `json:"column_id"`
		ItemType      string `json:"item_type"`
		ItemID        string `json:"item_id"`
		TitleSnapshot string `json:"title_snapshot"`
		Position      int    `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.BoardID = strings.TrimSpace(req.BoardID)
	req.ColumnID = strings.TrimSpace(req.ColumnID)
	req.ItemType = strings.TrimSpace(req.ItemType)
	req.ItemID = strings.TrimSpace(req.ItemID)
	req.TitleSnapshot = strings.TrimSpace(req.TitleSnapshot)
	if req.CompanyID == "" || req.BoardID == "" || req.ColumnID == "" || req.ItemID == "" {
		writeError(w, http.StatusBadRequest, "company_board_column_and_item_required")
		return
	}
	if req.ItemType != "node" && req.ItemType != "logic_gate" {
		writeError(w, http.StatusBadRequest, "invalid_kanban_item_type")
		return
	}
	if req.TitleSnapshot == "" {
		req.TitleSnapshot = req.ItemID
	}
	item, err := s.repo.UpsertKanbanCard(req.CompanyID, req.BoardID, req.ColumnID, req.ItemType, req.ItemID, req.TitleSnapshot, req.Position)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "kanban_column_or_item_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_upsert_kanban_card")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "kanban_card_upserted", map[string]any{
		"board_id": req.BoardID,
		"card_id":  item.CardID,
		"card":     item,
	})
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleKanbanCardByID(w http.ResponseWriter, r *http.Request) {
	cardID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/kanban/cards/"))
	if cardID == "" || strings.Contains(cardID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method == http.MethodPut {
		var req struct {
			CompanyID string `json:"company_id"`
			BoardID   string `json:"board_id"`
			ColumnID  string `json:"column_id"`
			Position  int    `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		req.BoardID = strings.TrimSpace(req.BoardID)
		req.ColumnID = strings.TrimSpace(req.ColumnID)
		if req.CompanyID == "" || req.BoardID == "" || req.ColumnID == "" {
			writeError(w, http.StatusBadRequest, "company_board_and_column_required")
			return
		}
		item, err := s.repo.MoveKanbanCard(req.CompanyID, req.BoardID, cardID, req.ColumnID, req.Position)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "kanban_card_or_column_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_move_kanban_card")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "kanban_card_moved", map[string]any{
			"board_id": req.BoardID,
			"card_id":  cardID,
			"card":     item,
		})
		writeJSON(w, http.StatusOK, item)
		return
	}
	if r.Method == http.MethodDelete {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
		if companyID == "" || boardID == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_board_id_required")
			return
		}
		err := s.repo.DeleteKanbanCard(companyID, boardID, cardID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "kanban_card_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_delete_kanban_card")
			return
		}
		s.publishWorkspaceEvent(companyID, "kanban_card_deleted", map[string]any{
			"board_id": boardID,
			"card_id":  cardID,
		})
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
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
