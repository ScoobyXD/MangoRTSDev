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
		query := store.LogicGateQuery{
			Search: strings.TrimSpace(firstNonEmptyQueryValue(r, "q", "query")),
		}
		if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" || query.Search != "" {
			limit, ok := parsePositiveLimit(rawLimit, store.LogicGateSearchDefaultLimit, store.LogicGateSearchMaxLimit)
			if !ok {
				writeError(w, http.StatusBadRequest, "invalid_limit")
				return
			}
			query.Limit = limit
		}
		if isTruthyQueryValue(firstNonEmptyQueryValue(r, "assigned_to_me", "mine")) {
			actor, ok := authenticatedActor(r)
			if !ok {
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			query.AssignedUserID = actor.User.UserID
		}
		etag, notModified, err := s.writeWorkspaceEventNotModified(w, r, companyID, "logic-gates", []store.DomainEventStreamQuery{
			workspaceEventQuery(logicGateListWorkspaceEventTypes...),
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_read_workspace_version")
			return
		}
		if notModified {
			return
		}
		userID := s.entityPermissionActorUserID(r, companyID)
		if query.Search != "" || query.AssignedUserID != "" || query.Limit > 0 {
			var items []domain.LogicGate
			if userID != "" {
				items, err = s.repo.QueryVisibleLogicGates(companyID, userID, query)
			} else {
				items, err = s.repo.QueryLogicGates(companyID, query)
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_query_logic_gates")
				return
			}
			writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{"logic_gates": items}, etag)
			return
		}
		var items []domain.LogicGate
		if userID != "" {
			items, err = s.repo.ListVisibleLogicGates(companyID, userID)
		} else {
			items, err = s.repo.ListLogicGates(companyID)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gates")
			return
		}
		writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{"logic_gates": items}, etag)
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

func firstNonEmptyQueryValue(r *http.Request, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(r.URL.Query().Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func isTruthyQueryValue(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
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
			if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
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
			if !s.requireEntityAdmin(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
				return
			}
			actor, ok := requireActorDisplayNameConfirmation(w, r, confirmationDisplayNameFromHeader(r))
			if !ok {
				return
			}
			deletedByUserID := actor.User.UserID
			targets := []store.CompanyExplorerDeleteTargetInput{{Kind: "logic_gate", ID: logicGateID}}
			capturedBoardDeletes := s.captureKanbanBoardsForDeleteTargets(companyID, targets)
			result, err := s.repo.DeleteCompanyExplorerTargets(companyID, targets, deletedByUserID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "logic_gate_not_found")
				return
			} else if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_delete_logic_gate")
				return
			}
			s.publishCommittedWorkspaceEvents(result.Events)
			s.publishCapturedKanbanDeletes(companyID, capturedBoardDeletes)
			writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "targets": result.Targets})
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
		if !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
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
		relationshipLogicGateIDs := make([]string, 0, len(details.Relationships)*2)
		for _, relationship := range details.Relationships {
			relationshipLogicGateIDs = append(relationshipLogicGateIDs, relationship.LogicGateIDA, relationship.LogicGateIDB)
		}
		visibleRelationshipLogicGateIDs, err := s.visibleEntityIDSet(r, companyID, store.EntityTypeLogicGate, relationshipLogicGateIDs)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_filter_logic_gates")
			return
		}
		details.Relationships = filterLogicGateRelationshipsByVisibleGates(details.Relationships, visibleRelationshipLogicGateIDs)
		writeJSONMaybeNotModified(w, r, http.StatusOK, details)
		return
	}

	if len(parts) == 2 && parts[1] == "permissions" {
		s.handleEntityPermissions(w, r, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found", "logic_gate_permissions_updated")
		return
	}

	if len(parts) == 2 && parts[1] == "projection" {
		if r.Method == http.MethodPost {
			var req struct {
				CompanyID        string `json:"company_id"`
				Type             string `json:"type"`
				Information      string `json:"information"`
				InformationID    string `json:"information_id"`
				ExpectedRevision *int64 `json:"expected_revision"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_json")
				return
			}
			if strings.TrimSpace(req.CompanyID) == "" || strings.TrimSpace(req.Type) == "" || strings.TrimSpace(req.InformationID) == "" {
				writeError(w, http.StatusBadRequest, "company_id_type_and_information_id_required")
				return
			}
			if isNodeEditorOnlyInformationType(req.Type) {
				writeError(w, http.StatusBadRequest, "logic_gate_information_type_not_supported")
				return
			}
			if strings.TrimSpace(req.Information) == "" {
				writeError(w, http.StatusBadRequest, "information_required")
				return
			}
			if rejectDurableInlineFileBytes(w, "logic_gate_projection", req.Information) {
				return
			}
			if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
				return
			}
			if strings.EqualFold(strings.TrimSpace(req.Type), "Text box") {
				writeError(w, http.StatusConflict, "editor_collaboration_required")
				return
			}
			actorUserID, actorLabel := nodeChangeActorPayload(r)
			item, err := s.repo.UpsertLogicGateProjection(store.LogicGateProjectionInput{
				CompanyID:        req.CompanyID,
				LogicGateID:      logicGateID,
				Type:             req.Type,
				Information:      req.Information,
				InformationID:    req.InformationID,
				ActorUserID:      actorUserID,
				ActorDisplayName: actorLabel,
				ExpectedRevision: req.ExpectedRevision,
			})
			var revisionConflict *store.ProjectionRevisionConflictError
			if errors.As(err, &revisionConflict) {
				writeProjectionRevisionConflict(w, revisionConflict)
				return
			}
			if errors.Is(err, store.ErrProjectionRevisionRequired) {
				writeError(w, http.StatusBadRequest, "expected_revision_required")
				return
			}
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "logic_gate_not_found")
				return
			}
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusBadRequest, "invalid_projection")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_save_logic_gate_projection")
				return
			}
			s.recordMentionNotifications(r, req.CompanyID, "logic_gate", logicGateID, req.InformationID, req.Type, req.Information)
			writeJSON(w, http.StatusOK, item)
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
		if !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
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

	if len(parts) == 2 && parts[1] == "save-versions" {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if r.Method == http.MethodPost {
			var req struct {
				CompanyID string `json:"company_id"`
				SaveKind  string `json:"save_kind"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_json")
				return
			}
			if strings.TrimSpace(req.CompanyID) == "" {
				writeError(w, http.StatusBadRequest, "company_id_required")
				return
			}
			if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
				return
			}
			current, err := s.repo.ListLogicGateProjections(req.CompanyID, logicGateID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "logic_gate_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_projection")
				return
			}
			currentPayloads := make([]string, 0, len(current))
			for _, item := range current {
				currentPayloads = append(currentPayloads, item.Information)
			}
			if rejectAnyDurableInlineFileBytes(w, "logic_gate_save_version_source", currentPayloads) {
				return
			}
			actorUserID, actorLabel := nodeChangeActorPayload(r)
			version, err := s.repo.CreateLogicGateEditorSaveVersion(store.EditorSaveVersionInput{
				CompanyID:        req.CompanyID,
				ResourceID:       logicGateID,
				SaveKind:         req.SaveKind,
				ActorUserID:      actorUserID,
				ActorDisplayName: actorLabel,
			})
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusBadRequest, "no_editor_projection_to_save")
				return
			}
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "logic_gate_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_save_logic_gate_version")
				return
			}
			s.publishWorkspaceEvent(req.CompanyID, "logic_gate_editor_save_version_created", map[string]any{"logic_gate_id": logicGateID, "save_id": version.SaveID, "save_kind": version.SaveKind})
			writeJSON(w, http.StatusCreated, version)
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
			return
		}
		versions, err := s.repo.ListLogicGateEditorSaveVersions(companyID, logicGateID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "logic_gate_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_save_versions")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"company_id":    companyID,
			"logic_gate_id": logicGateID,
			"versions":      versions,
		})
		return
	}

	if len(parts) == 4 && parts[1] == "save-versions" && parts[3] == "restore" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		saveID := strings.TrimSpace(parts[2])
		var req struct {
			CompanyID string `json:"company_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if strings.TrimSpace(req.CompanyID) == "" || saveID == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_save_id_required")
			return
		}
		if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
			return
		}
		versions, err := s.repo.ListLogicGateEditorSaveVersions(req.CompanyID, logicGateID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "save_version_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_logic_gate_save_versions")
			return
		}
		for _, candidate := range versions {
			if candidate.SaveID != saveID {
				continue
			}
			payloads := make([]string, 0, len(candidate.Items))
			for _, item := range candidate.Items {
				payloads = append(payloads, item.Information)
			}
			if rejectAnyDurableInlineFileBytes(w, "logic_gate_save_version_restore", payloads) {
				return
			}
			break
		}
		actorUserID, actorLabel := nodeChangeActorPayload(r)
		version, err := s.repo.RestoreLogicGateEditorSaveVersion(store.EditorSaveVersionRestoreInput{
			CompanyID:        req.CompanyID,
			ResourceID:       logicGateID,
			SaveID:           saveID,
			ActorUserID:      actorUserID,
			ActorDisplayName: actorLabel,
		})
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "save_version_not_found")
			return
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_save_version")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_restore_logic_gate_save_version")
			return
		}
		s.wakeRealtimeSpine()
		s.publishWorkspaceEvent(req.CompanyID, "logic_gate_editor_save_version_restored", map[string]any{"logic_gate_id": logicGateID, "save_id": version.SaveID})
		writeJSON(w, http.StatusOK, version)
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
		expectedRevision, revisionErr := parseOptionalExpectedRevision(r)
		if revisionErr != nil {
			writeError(w, http.StatusBadRequest, "invalid_expected_revision")
			return
		}
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
			return
		}
		if projections, listErr := s.repo.ListLogicGateProjections(companyID, logicGateID); listErr == nil {
			for _, projection := range projections {
				if projection.InformationID == informationID && strings.EqualFold(strings.TrimSpace(projection.Type), "Text box") {
					writeError(w, http.StatusConflict, "editor_collaboration_required")
					return
				}
			}
		}
		// Same contract as nodes: clear the latest value without manufacturing
		// blank history rows on high-volume UI or agent writes.
		if err := s.repo.DeleteLogicGateProjection(store.LogicGateProjectionDeleteInput{
			CompanyID: companyID, LogicGateID: logicGateID, InformationID: informationID, ExpectedRevision: expectedRevision,
		}); errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "logic_gate_not_found")
			return
		} else if revisionConflict := (*store.ProjectionRevisionConflictError)(nil); errors.As(err, &revisionConflict) {
			writeProjectionRevisionConflict(w, revisionConflict)
			return
		} else if errors.Is(err, store.ErrProjectionRevisionRequired) {
			writeError(w, http.StatusBadRequest, "expected_revision_required")
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
		if rejectDurableInlineFileBytes(w, "logic_gate_information", req.Information) {
			return
		}
		if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
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
		mentionInformationID := strings.TrimSpace(req.InformationID)
		if mentionInformationID == "" {
			mentionInformationID = item.InformationID
		}
		s.recordMentionNotifications(r, req.CompanyID, "logic_gate", logicGateID, mentionInformationID, req.Type, req.Information)
		writeJSON(w, http.StatusCreated, item)
		return
	}

	writeError(w, http.StatusNotFound, "not_found")
}
