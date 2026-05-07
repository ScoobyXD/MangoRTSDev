package httpapi

import (
	"encoding/json"
	"errors"
	"math"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type mapLayoutPositionRequest struct {
	EntityID    string  `json:"entity_id"`
	NodeID      string  `json:"node_id"`
	LogicGateID string  `json:"logic_gate_id"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
}

func (p mapLayoutPositionRequest) entityIDFor(mapType string) string {
	if strings.TrimSpace(p.EntityID) != "" {
		return strings.TrimSpace(p.EntityID)
	}
	if mapType == "node" {
		return strings.TrimSpace(p.NodeID)
	}
	return strings.TrimSpace(p.LogicGateID)
}

func validMapLayoutCoordinate(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
}

func (s *Server) handleMapLayout(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		mapType := strings.TrimSpace(r.URL.Query().Get("map_type"))
		if companyID == "" || mapType == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_map_type_required")
			return
		}
		if mapType == "node" {
			items, err := s.repo.ListNodeMapPositions(companyID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_node_map_positions")
				return
			}
			if sets, shouldFilter, err := s.assignmentSetsForRequest(r, companyID); err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_filter_node_map_positions")
				return
			} else if shouldFilter {
				items = filterNodeMapPositionsByAssignments(items, sets)
			}
			writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"company_id": companyID, "map_type": mapType, "positions": items})
			return
		}
		if mapType == "logic_gate" {
			items, err := s.repo.ListLogicGateMapPositions(companyID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_map_positions")
				return
			}
			if sets, shouldFilter, err := s.assignmentSetsForRequest(r, companyID); err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_filter_logic_gate_map_positions")
				return
			} else if shouldFilter {
				items = filterLogicGateMapPositionsByAssignments(items, sets)
			}
			writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"company_id": companyID, "map_type": mapType, "positions": items})
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_map_type")
	case http.MethodPut:
		var req struct {
			CompanyID string                     `json:"company_id"`
			MapType   string                     `json:"map_type"`
			Positions []mapLayoutPositionRequest `json:"positions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		req.MapType = strings.TrimSpace(req.MapType)
		if req.CompanyID == "" || req.MapType == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_map_type_required")
			return
		}
		if len(req.Positions) == 0 {
			writeError(w, http.StatusBadRequest, "positions_required")
			return
		}
		if len(req.Positions) > 500 {
			writeError(w, http.StatusBadRequest, "too_many_positions")
			return
		}
		if req.MapType == "node" {
			positions := make([]domain.NodeMapPosition, 0, len(req.Positions))
			for _, input := range req.Positions {
				nodeID := input.entityIDFor(req.MapType)
				if nodeID == "" || !validMapLayoutCoordinate(input.X) || !validMapLayoutCoordinate(input.Y) {
					writeError(w, http.StatusBadRequest, "invalid_position")
					return
				}
				positions = append(positions, domain.NodeMapPosition{CompanyID: req.CompanyID, NodeID: nodeID, X: input.X, Y: input.Y})
			}
			items, err := s.repo.UpsertNodeMapPositions(req.CompanyID, positions)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "node_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_save_node_map_positions")
				return
			}
			s.publishWorkspaceEvent(req.CompanyID, "node_map_positions_updated", map[string]any{"positions": items})
			writeJSON(w, http.StatusOK, map[string]any{"company_id": req.CompanyID, "map_type": req.MapType, "positions": items})
			return
		}
		if req.MapType == "logic_gate" {
			positions := make([]domain.LogicGateMapPosition, 0, len(req.Positions))
			for _, input := range req.Positions {
				logicGateID := input.entityIDFor(req.MapType)
				if logicGateID == "" || !validMapLayoutCoordinate(input.X) || !validMapLayoutCoordinate(input.Y) {
					writeError(w, http.StatusBadRequest, "invalid_position")
					return
				}
				positions = append(positions, domain.LogicGateMapPosition{CompanyID: req.CompanyID, LogicGateID: logicGateID, X: input.X, Y: input.Y})
			}
			items, err := s.repo.UpsertLogicGateMapPositions(req.CompanyID, positions)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "logic_gate_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_save_logic_gate_map_positions")
				return
			}
			s.publishWorkspaceEvent(req.CompanyID, "logic_gate_map_positions_updated", map[string]any{"positions": items})
			writeJSON(w, http.StatusOK, map[string]any{"company_id": req.CompanyID, "map_type": req.MapType, "positions": items})
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_map_type")
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}
