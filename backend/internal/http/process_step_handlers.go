package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleProcessSteps(w http.ResponseWriter, r *http.Request, logicGateID, stepID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	var payload struct {
		CompanyID          string          `json:"company_id"`
		Name               *string         `json:"name"`
		BodyJSON           json.RawMessage `json:"body_json"`
		Position           *int            `json:"position"`
		AfterProcessStepID *string         `json:"after_process_step_id"`
	}
	if r.Method == http.MethodPost || r.Method == http.MethodPatch {
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		companyID = strings.TrimSpace(payload.CompanyID)
	} else if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, logicGateID, store.EntityPermissionEdit) {
		return
	}
	actorID, _ := workItemAssignmentRequestEventMetadata(r)
	var result store.ProcessStepMutationResult
	var err error
	switch {
	case r.Method == http.MethodPost && stepID == "":
		if payload.Name == nil {
			writeError(w, http.StatusBadRequest, "name_required")
			return
		}
		result, err = s.repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: companyID, LogicGateID: logicGateID, Name: *payload.Name, BodyJSON: payload.BodyJSON, AfterProcessStepID: payload.AfterProcessStepID, ActorUserID: actorID})
	case r.Method == http.MethodPatch && stepID != "":
		if payload.Name == nil && payload.Position == nil || payload.AfterProcessStepID != nil || payload.BodyJSON != nil {
			writeError(w, http.StatusBadRequest, "invalid_process_step_update")
			return
		}
		result, err = s.repo.UpdateProcessStep(store.ProcessStepUpdateInput{CompanyID: companyID, LogicGateID: logicGateID, ProcessStepID: stepID, Name: payload.Name, Position: payload.Position, ActorUserID: actorID})
	case r.Method == http.MethodDelete && stepID != "":
		result, err = s.repo.DeleteProcessStep(store.ProcessStepDeleteInput{CompanyID: companyID, LogicGateID: logicGateID, ProcessStepID: stepID, ActorUserID: actorID})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if errors.Is(err, store.ErrEditorOwnerTextLimit) {
		writeEditorJSONStoreError(w, err)
		return
	}
	if !writeLogicGateWorkMutationError(w, err, "failed_to_change_process_step") {
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) handleProcessStepRelationships(w http.ResponseWriter, r *http.Request, logicGateID, relationshipID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	var payload struct {
		CompanyID string                       `json:"company_id"`
		Source    domain.ProcessMapResourceRef `json:"source"`
		Target    domain.ProcessMapResourceRef `json:"target"`
	}
	if r.Method == http.MethodPost && relationshipID == "" {
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		companyID = strings.TrimSpace(payload.CompanyID)
	} else if r.Method != http.MethodDelete || relationshipID == "" {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireLogicGateWorkEffectiveAccess(w, r, companyID, logicGateID, store.EntityPermissionEdit) {
		return
	}
	actorID, _ := workItemAssignmentRequestEventMetadata(r)
	var result store.ProcessStepMutationResult
	var err error
	if r.Method == http.MethodPost {
		result, err = s.repo.CreateProcessStepRelationship(store.ProcessStepRelationshipInput{CompanyID: companyID, LogicGateID: logicGateID, Source: payload.Source, Target: payload.Target, ActorUserID: actorID})
	} else {
		result, err = s.repo.DeleteProcessStepRelationship(store.ProcessStepRelationshipDeleteInput{CompanyID: companyID, LogicGateID: logicGateID, RelationshipID: relationshipID, ActorUserID: actorID})
	}
	if !writeLogicGateWorkMutationError(w, err, "failed_to_change_process_step_relationship") {
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	writeJSON(w, http.StatusOK, result)
}
