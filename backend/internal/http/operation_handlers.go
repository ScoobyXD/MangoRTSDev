package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
	"time"
)

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
