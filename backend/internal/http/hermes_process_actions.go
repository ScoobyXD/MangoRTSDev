package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"miraeopus/backend/internal/store"
)

func (s *Server) handleHermesProcessAction(w http.ResponseWriter, r *http.Request, run store.AIRun, action string, raw json.RawMessage) {
	switch action {
	case "mango_create_process":
		var args struct {
			Name     string `json:"name"`
			FolderID string `json:"folder_id"`
		}
		if !decodeHermesArguments(raw, &args) || strings.TrimSpace(args.Name) == "" || len(args.Name) > 500 || (args.FolderID != "" && !isCanonicalUUID(args.FolderID)) {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		args.Name, args.FolderID = strings.TrimSpace(args.Name), strings.ToLower(args.FolderID)
		result, err := s.repo.AICreateProcess(r.Context(), run, hermesArgumentKey(args), args.FolderID, args.Name)
		if err != nil {
			writeAIStoreError(w, err)
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		writeJSON(w, 200, result.LogicGates[0])
	case "mango_update_process":
		var args struct {
			LogicGateID string `json:"logic_gate_id"`
			Name        string `json:"name"`
		}
		if !decodeHermesArguments(raw, &args) || !isCanonicalUUID(args.LogicGateID) || strings.TrimSpace(args.Name) == "" || len(args.Name) > 500 {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		args.LogicGateID, args.Name = strings.ToLower(args.LogicGateID), strings.TrimSpace(args.Name)
		if !s.requireEntityEdit(w, r, run.CompanyID, store.EntityTypeLogicGate, args.LogicGateID, "logic_gate_not_found") {
			return
		}
		result, err := s.repo.AIUpdateProcess(r.Context(), run, hermesArgumentKey(args), args.LogicGateID, args.Name)
		if err != nil {
			writeAIStoreError(w, err)
			return
		}
		s.publishCommittedWorkspaceEvent(result.Event)
		writeJSON(w, 200, result.Process)
	case "mango_move_process":
		var args struct {
			LogicGateID string          `json:"logic_gate_id"`
			FolderID    json.RawMessage `json:"folder_id"`
		}
		if !decodeHermesArguments(raw, &args) || !isCanonicalUUID(args.LogicGateID) || len(args.FolderID) == 0 {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		var folderID *string
		if json.Unmarshal(args.FolderID, &folderID) != nil || (folderID != nil && !isCanonicalUUID(*folderID)) {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		destination := ""
		if folderID != nil {
			destination = strings.ToLower(*folderID)
		}
		input := struct{ LogicGateID, FolderID string }{strings.ToLower(args.LogicGateID), destination}
		result, err := s.repo.AIMoveProcess(r.Context(), run, hermesArgumentKey(input), input.LogicGateID, input.FolderID)
		if err != nil {
			writeAIStoreError(w, err)
			return
		}
		s.wakeRealtimeSpine()
		writeJSON(w, 200, result)
	case "mango_create_step":
		var args struct {
			LogicGateID        string  `json:"logic_gate_id"`
			Name               string  `json:"name"`
			AfterProcessStepID *string `json:"after_process_step_id"`
		}
		if !decodeHermesArguments(raw, &args) || !isCanonicalUUID(args.LogicGateID) || strings.TrimSpace(args.Name) == "" || len(args.Name) > 200 || (args.AfterProcessStepID != nil && !isCanonicalUUID(*args.AfterProcessStepID)) {
			writeError(w, 400, "invalid_action_arguments")
			return
		}
		args.LogicGateID, args.Name = strings.ToLower(args.LogicGateID), strings.TrimSpace(args.Name)
		if args.AfterProcessStepID != nil {
			*args.AfterProcessStepID = strings.ToLower(*args.AfterProcessStepID)
		}
		if !s.requireLogicGateWorkEffectiveAccess(w, r, run.CompanyID, args.LogicGateID, store.EntityPermissionEdit) {
			return
		}
		result, err := s.repo.AICreateProcessStep(r.Context(), run, hermesArgumentKey(args), store.ProcessStepCreateInput{LogicGateID: args.LogicGateID, Name: args.Name, AfterProcessStepID: args.AfterProcessStepID})
		if err != nil {
			writeAIStoreError(w, err)
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		writeJSON(w, 200, result)
	}
}
