package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleProcessStepMap(w http.ResponseWriter, r *http.Request, logicGateID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	var payload struct {
		CompanyID    string                           `json:"company_id"`
		BaseRevision *int64                           `json:"base_revision"`
		Steps        []domain.ProcessStepMapRectangle `json:"steps"`
		Routes       []domain.ProcessStepMapRoute     `json:"routes"`
	}
	if r.Method == http.MethodPut {
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<20))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&payload); err != nil || payload.BaseRevision == nil || payload.Steps == nil || payload.Routes == nil {
			writeError(w, http.StatusBadRequest, "invalid_process_step_map")
			return
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			writeError(w, http.StatusBadRequest, "invalid_process_step_map")
			return
		}
		companyID = strings.TrimSpace(payload.CompanyID)
	} else if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if r.Method == http.MethodGet {
		if _, _, ok := s.requireLogicGateWorkReadAccess(w, r, companyID, logicGateID); !ok {
			return
		}
		layout, err := s.repo.GetProcessStepMap(companyID, logicGateID)
		if !writeLogicGateWorkMutationError(w, err, "failed_to_load_process_step_map") {
			return
		}
		writeJSON(w, http.StatusOK, layout)
		return
	}
	if !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, logicGateID, store.EntityPermissionEdit) {
		return
	}
	actorID, _ := workItemAssignmentRequestEventMetadata(r)
	result, err := s.repo.PutProcessStepMap(store.ProcessStepMapPutInput{CompanyID: companyID, LogicGateID: logicGateID, BaseRevision: *payload.BaseRevision, Steps: payload.Steps, Routes: payload.Routes, ActorUserID: actorID})
	if errors.Is(err, store.ErrVersionConflict) {
		writeError(w, http.StatusConflict, "process_step_map_revision_conflict")
		return
	}
	if !writeLogicGateWorkMutationError(w, err, "failed_to_save_process_step_map") {
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	writeJSON(w, http.StatusOK, result)
}
