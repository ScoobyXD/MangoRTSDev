package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func isNodeEditorOnlyInformationType(infoType string) bool {
	switch strings.TrimSpace(infoType) {
	case "Text block chat", "Attached email":
		return true
	default:
		return false
	}
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

	if len(parts) == 2 && parts[1] == "raci" {
		if r.Method == http.MethodGet {
			companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
			if companyID == "" {
				writeError(w, http.StatusBadRequest, "company_id_required")
				return
			}
			logicGate, err := s.repo.GetLogicGate(companyID, logicGateID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "logic_gate_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_raci")
				return
			}
			writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
				"company_id":       companyID,
				"logic_gate_id":    logicGateID,
				"raci_assignments": logicGate.RaciAssignments,
			})
			return
		}
		if r.Method != http.MethodPut {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		var req struct {
			CompanyID   string                               `json:"company_id"`
			Assignments []store.LogicGateRaciAssignmentInput `json:"assignments"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if strings.TrimSpace(req.CompanyID) == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		assignments, err := s.repo.SetLogicGateRaciAssignments(store.LogicGateRaciAssignmentUpdateInput{
			CompanyID:   req.CompanyID,
			LogicGateID: logicGateID,
			Assignments: req.Assignments,
		})
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_raci_assignments")
			return
		}
		if errors.Is(err, store.ErrAssigneeNotInCompany) {
			writeError(w, http.StatusBadRequest, "raci_user_not_in_company")
			return
		}
		if errors.Is(err, store.ErrRaciStorageUnavailable) {
			writeError(w, http.StatusServiceUnavailable, "logic_gate_raci_storage_unavailable")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "logic_gate_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_update_logic_gate_raci")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "logic_gate_raci_updated", map[string]any{"logic_gate_id": logicGateID, "raci_assignments": assignments})
		actorUserID, actorLabel := notificationActorPayload(r)
		logicGateTitle := ""
		if logicGate, err := s.repo.GetLogicGate(req.CompanyID, logicGateID); err == nil {
			logicGateTitle = logicGate.Header
		}
		s.recordNotificationEvent(store.NotificationEventInput{
			CompanyID:      req.CompanyID,
			ActorUserID:    actorUserID,
			Type:           domain.NotificationEventLogicGateRaciUpdated,
			EntityType:     "logic_gate",
			EntityID:       logicGateID,
			IdempotencyKey: "logic-gate-raci:" + req.CompanyID + ":" + logicGateID + ":" + logicGateRaciFingerprint(assignments),
			Payload: map[string]any{
				"assignment_user_ids": logicGateRaciAssignmentUserIDs(assignments),
				"actor_display_name":  actorLabel,
				"logic_gate_title":    logicGateTitle,
			},
		})
		writeJSON(w, http.StatusOK, map[string]any{
			"company_id":       req.CompanyID,
			"logic_gate_id":    logicGateID,
			"raci_assignments": assignments,
		})
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

	if len(parts) == 3 && parts[1] == "projection" {
		if r.Method != http.MethodDelete {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		informationID := strings.TrimSpace(parts[2])
		if informationID == "" {
			writeError(w, http.StatusBadRequest, "information_id_required")
			return
		}
		// Same contract as nodes: clear the latest value without manufacturing
		// blank history rows on high-volume UI or agent writes.
		if err := s.repo.DeleteLogicGateProjection(companyID, logicGateID, informationID); errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "logic_gate_not_found")
			return
		} else if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_delete_logic_gate_projection")
			return
		}
		s.publishWorkspaceEvent(companyID, "logic_gate_projection_deleted", map[string]any{"logic_gate_id": logicGateID, "information_id": informationID})
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
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
		if isNodeEditorOnlyInformationType(req.Type) {
			writeError(w, http.StatusBadRequest, "logic_gate_information_type_not_supported")
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
		actorUserID, actorLabel := notificationActorPayload(r)
		mentionedUserIDs, err := s.notifications.ResolveMentionedUserIDs(req.CompanyID, req.Information)
		if err == nil && len(mentionedUserIDs) > 0 {
			s.recordNotificationEvent(store.NotificationEventInput{
				CompanyID:      req.CompanyID,
				ActorUserID:    actorUserID,
				Type:           domain.NotificationEventMentionCreated,
				EntityType:     "logic_gate",
				EntityID:       logicGateID,
				IdempotencyKey: "mention:logic-gate:" + item.InformationID,
				Payload: map[string]any{
					"comment":            item.Information,
					"information_id":     item.InformationID,
					"mentioned_user_ids": mentionedUserIDs,
					"actor_display_name": actorLabel,
				},
			})
		}
		writeJSON(w, http.StatusCreated, item)
		return
	}

	writeError(w, http.StatusNotFound, "not_found")
}
