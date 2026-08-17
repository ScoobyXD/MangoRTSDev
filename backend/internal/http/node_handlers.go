package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *Server) handleNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		etag, notModified, err := s.writeWorkspaceEventNotModified(w, r, companyID, "nodes", []store.DomainEventStreamQuery{
			workspaceEventQuery(nodeListWorkspaceEventTypes...),
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_read_workspace_version")
			return
		}
		if notModified {
			return
		}
		userID := s.entityPermissionActorUserID(r, companyID)
		var items []domain.Node
		if userID != "" {
			items, err = s.repo.ListVisibleNodes(companyID, userID)
		} else {
			items, err = s.repo.ListNodes(companyID)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_nodes")
			return
		}
		writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{"nodes": items}, etag)
		return
	}

	if r.Method == http.MethodPost {
		var fields map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		for _, unsupported := range []string{"title", "assignee_user_id", "status_color"} {
			if _, exists := fields[unsupported]; exists {
				writeError(w, http.StatusBadRequest, "unsupported_node_field")
				return
			}
		}
		companyID, companyIDSet, ok := parseOptionalStringField(fields, "company_id")
		if !ok || !companyIDSet || companyID == nil || strings.TrimSpace(*companyID) == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_name_required")
			return
		}
		name, nameSet, ok := parseOptionalStringField(fields, "name")
		if !ok || !nameSet || name == nil || strings.TrimSpace(*name) == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_name_required")
			return
		}

		item, event, err := s.repo.CreateNodeWithWorkspaceEvent(strings.TrimSpace(*companyID), strings.TrimSpace(*name))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_create_node")
			return
		}
		s.publishCommittedWorkspaceEvent(event)
		writeJSON(w, http.StatusCreated, item)
		return
	}

	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func normalizeNodeDueDate(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", true
	}
	for _, layout := range []string{"2006-01-02", "01/02/2006"} {
		parsed, err := time.Parse(layout, raw)
		if err == nil {
			return parsed.Format("2006-01-02"), true
		}
	}
	return "", false
}

func parseOptionalStringField(fields map[string]json.RawMessage, key string) (*string, bool, bool) {
	raw, ok := fields[key]
	if !ok {
		return nil, false, true
	}
	if strings.TrimSpace(string(raw)) == "null" {
		value := ""
		return &value, true, true
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, true, false
	}
	value = strings.TrimSpace(value)
	return &value, true, true
}

func parseOptionalPriorityField(fields map[string]json.RawMessage) (*int, bool, bool) {
	raw, ok := fields["priority"]
	if !ok {
		return nil, false, true
	}
	if strings.TrimSpace(string(raw)) == "null" {
		return nil, true, true
	}
	var numeric int
	if err := json.Unmarshal(raw, &numeric); err == nil {
		if numeric == 0 {
			return nil, true, true
		}
		return &numeric, true, numeric >= 1 && numeric <= 5
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return nil, true, false
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, true, true
	}
	parsed, err := strconv.Atoi(text)
	if err != nil {
		return nil, true, false
	}
	return &parsed, true, parsed >= 1 && parsed <= 5
}

type timedCompanyExplorerDeleteRepository interface {
	DeleteCompanyExplorerTargetsWithTiming(companyID string, targets []store.CompanyExplorerDeleteTargetInput, deletedByUserID string, recorder store.TimingRecorder) (store.CompanyExplorerDeleteResult, error)
}

func (s *Server) handleNodeSubresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/nodes/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	nodeID := parts[0]
	if len(parts) == 3 && parts[1] == "email-threads" {
		s.handleNodeEmailThread(w, r, nodeID, parts[2])
		return
	}

	if len(parts) == 2 && parts[1] == "timeline-events" {
		s.handleNodeTimelineEvents(w, r, nodeID)
		return
	}

	if len(parts) == 2 && parts[1] == "verification-requests" {
		s.handleNodeVerificationRequests(w, r, nodeID)
		return
	}

	if len(parts) == 4 && parts[1] == "verification-requests" && parts[3] == "complete" {
		s.handleNodeVerificationCompletion(w, r, nodeID, parts[2])
		return
	}

	if len(parts) == 2 && parts[1] == "accounts" {
		s.handleNodeAccounts(w, r, nodeID)
		return
	}

	if len(parts) == 1 {
		if r.Method == http.MethodPut {
			var fields map[string]json.RawMessage
			if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_json")
				return
			}
			companyIDField, companyIDSet, ok := parseOptionalStringField(fields, "company_id")
			if !ok || !companyIDSet || companyIDField == nil || strings.TrimSpace(*companyIDField) == "" {
				writeError(w, http.StatusBadRequest, "company_id_required")
				return
			}
			for _, unsupported := range []string{"title", "assignee_user_id", "status_color", "fallback_status_color"} {
				if _, exists := fields[unsupported]; exists {
					writeError(w, http.StatusBadRequest, "unsupported_node_field")
					return
				}
			}
			input := store.UpdateNodeInput{CompanyID: strings.TrimSpace(*companyIDField), NodeID: nodeID}
			if name, set, ok := parseOptionalStringField(fields, "name"); !ok {
				writeError(w, http.StatusBadRequest, "invalid_name")
				return
			} else if set {
				if name == nil || strings.TrimSpace(*name) == "" {
					writeError(w, http.StatusBadRequest, "name_required")
					return
				}
				input.Title = strings.TrimSpace(*name)
				input.TitleSet = true
			}
			if dueDate, set, ok := parseOptionalStringField(fields, "due_date"); !ok {
				writeError(w, http.StatusBadRequest, "invalid_due_date")
				return
			} else if set {
				normalized, valid := normalizeNodeDueDate(*dueDate)
				if !valid {
					writeError(w, http.StatusBadRequest, "invalid_due_date")
					return
				}
				input.DueDate = &normalized
				input.DueDateSet = true
			}
			if status, set, ok := parseOptionalStringField(fields, "status"); !ok {
				writeError(w, http.StatusBadRequest, "invalid_status")
				return
			} else if set {
				input.Status = status
				input.StatusSet = true
			}
			if priority, set, ok := parseOptionalPriorityField(fields); !ok {
				writeError(w, http.StatusBadRequest, "invalid_priority")
				return
			} else if set {
				input.Priority = priority
				input.PrioritySet = true
			}
			if !input.TitleSet && !input.StatusSet && !input.DueDateSet && !input.PrioritySet {
				writeError(w, http.StatusBadRequest, "node_update_required")
				return
			}
			if !s.requireEntityEdit(w, r, input.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
				return
			}
			input.ActorUserID, input.ActorDisplayName = nodeChangeActorPayload(r)
			item, event, err := s.repo.UpdateNodeAndWorkspaceEvent(input)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "node_not_found")
				return
			}
			if errors.Is(err, store.ErrPrincipalNotInCompany) {
				writeError(w, http.StatusBadRequest, "principal_user_not_in_company")
				return
			}
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusBadRequest, "invalid_node_update")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_update_node")
				return
			}
			s.publishCommittedWorkspaceEvent(event)
			s.projectCommittedNotificationEvents([]domain.DomainEvent{event})
			writeJSON(w, http.StatusOK, item)
			return
		}
		if r.Method == http.MethodDelete {
			timedWriter, timings := startTimedRequest(w)
			w = timedWriter
			defer func() {
				timings.log(r, timedWriter.status)
			}()
			stop := timings.observeAccounted("request.validate")
			companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
			if companyID == "" {
				stop()
				writeError(w, http.StatusBadRequest, "company_id_required")
				return
			}
			stop()
			stop = timings.observeAccounted("request.access_check")
			if !s.requireEntityEdit(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") {
				stop()
				return
			}
			stop()
			actor, ok := requireActorDisplayNameConfirmation(w, r, confirmationDisplayNameFromHeader(r))
			if !ok {
				return
			}
			deletedByUserID := actor.User.UserID
			targets := []store.CompanyExplorerDeleteTargetInput{{Kind: "node", ID: nodeID}}
			stop = timings.observeAccounted("source.transaction")
			var result store.CompanyExplorerDeleteResult
			var err error
			if repo, ok := s.repo.(timedCompanyExplorerDeleteRepository); ok {
				result, err = repo.DeleteCompanyExplorerTargetsWithTiming(companyID, targets, deletedByUserID, timings)
			} else {
				result, err = s.repo.DeleteCompanyExplorerTargets(companyID, targets, deletedByUserID)
			}
			stop()
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "node_not_found")
				return
			} else if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_delete_node")
				return
			}
			stop = timings.observeAccounted("events.publish.enqueue")
			s.publishCommittedWorkspaceEvents(result.Events)
			stop()
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
		if !s.requireEntityView(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") {
			return
		}
		loadDetails := s.repo.GetNodeDetailsSummary
		if nodeDetailsIncludeInformationHistory(r) {
			loadDetails = s.repo.GetNodeDetails
		}
		details, err := loadDetails(companyID, nodeID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_node")
			return
		}
		relationshipNodeIDs := make([]string, 0, len(details.Relationships)*2)
		for _, relationship := range details.Relationships {
			relationshipNodeIDs = append(relationshipNodeIDs, relationship.NodeIDA, relationship.NodeIDB)
		}
		visibleRelationshipNodeIDs, err := s.visibleEntityIDSet(r, companyID, store.EntityTypeNode, relationshipNodeIDs)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_filter_nodes")
			return
		}
		details.Relationships = filterNodeRelationshipsByVisibleNodes(details.Relationships, visibleRelationshipNodeIDs)
		details.RelationshipsCount = len(details.Relationships)
		if details.InformationCount == 0 && len(details.Information) > 0 {
			details.InformationCount = len(details.Information)
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, details)
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
			if strings.TrimSpace(req.Information) == "" {
				writeError(w, http.StatusBadRequest, "information_required")
				return
			}
			if rejectDurableInlineFileBytes(w, "node_projection", req.Information) {
				return
			}
			if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
				return
			}
			if strings.EqualFold(strings.TrimSpace(req.Type), "Text box") {
				writeError(w, http.StatusConflict, "editor_collaboration_required")
				return
			}
			if strings.TrimSpace(req.InformationID) != "" {
				if projections, listErr := s.repo.ListNodeProjections(req.CompanyID, nodeID); listErr != nil {
					writeChatCommentEditError(w, listErr, "failed_to_load_chat_comment")
					return
				} else if _, exists := findNodeChatComment(projections, req.InformationID); exists {
					writeError(w, http.StatusConflict, "chat_comment_patch_required")
					return
				}
			}
			actorUserID, actorLabel := nodeChangeActorPayload(r)
			writeInput := store.NodeInformationInput{
				CompanyID:        req.CompanyID,
				NodeID:           nodeID,
				Type:             req.Type,
				Information:      req.Information,
				InformationID:    req.InformationID,
				ActorUserID:      actorUserID,
				ActorDisplayName: actorLabel,
				ExpectedRevision: req.ExpectedRevision,
			}
			item, err := s.repo.UpsertNodeProjectionWithActor(writeInput)
			var revisionConflict *store.ProjectionRevisionConflictError
			if errors.As(err, &revisionConflict) {
				writeProjectionRevisionConflict(w, revisionConflict)
				return
			}
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "node_not_found")
				return
			}
			if errors.Is(err, store.ErrProjectionRevisionRequired) {
				writeError(w, http.StatusBadRequest, "expected_revision_required")
				return
			}
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusBadRequest, "invalid_projection")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_save_node_projection")
				return
			}

			s.recordMentionNotifications(r, req.CompanyID, "node", nodeID, req.InformationID, req.Type, req.Information)
			s.recordNodeChatNotification(r, req.CompanyID, nodeID, req.InformationID, req.Type, req.Information)
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
		if !s.requireEntityView(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") {
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
			if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
				return
			}
			current, err := s.repo.ListNodeProjections(req.CompanyID, nodeID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "node_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_load_node_projection")
				return
			}
			currentPayloads := make([]string, 0, len(current))
			for _, item := range current {
				currentPayloads = append(currentPayloads, item.Information)
			}
			if rejectAnyDurableInlineFileBytes(w, "node_save_version_source", currentPayloads) {
				return
			}
			actorUserID, actorLabel := nodeChangeActorPayload(r)
			version, err := s.repo.CreateNodeEditorSaveVersion(store.EditorSaveVersionInput{
				CompanyID:        req.CompanyID,
				ResourceID:       nodeID,
				SaveKind:         req.SaveKind,
				ActorUserID:      actorUserID,
				ActorDisplayName: actorLabel,
			})
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusBadRequest, "no_editor_projection_to_save")
				return
			}
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "node_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_save_node_version")
				return
			}
			s.publishWorkspaceEvent(req.CompanyID, "node_editor_save_version_created", map[string]any{"node_id": nodeID, "save_id": version.SaveID, "save_kind": version.SaveKind})
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
		if !s.requireEntityView(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") {
			return
		}
		versions, err := s.repo.ListNodeEditorSaveVersions(companyID, nodeID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_node_save_versions")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"company_id": companyID,
			"node_id":    nodeID,
			"versions":   versions,
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
		if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
			return
		}
		versions, err := s.repo.ListNodeEditorSaveVersions(req.CompanyID, nodeID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "save_version_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_node_save_versions")
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
			if rejectAnyDurableInlineFileBytes(w, "node_save_version_restore", payloads) {
				return
			}
			break
		}
		actorUserID, actorLabel := nodeChangeActorPayload(r)
		version, err := s.repo.RestoreNodeEditorSaveVersion(store.EditorSaveVersionRestoreInput{
			CompanyID:        req.CompanyID,
			ResourceID:       nodeID,
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
			writeError(w, http.StatusInternalServerError, "failed_to_restore_node_save_version")
			return
		}
		s.wakeRealtimeSpine()
		s.publishWorkspaceEvent(req.CompanyID, "node_editor_save_version_restored", map[string]any{"node_id": nodeID, "save_id": version.SaveID})
		writeJSON(w, http.StatusOK, version)
		return
	}

	if len(parts) == 3 && parts[1] == "projection" {
		if r.Method == http.MethodPatch {
			s.handleNodeChatCommentEdit(w, r, nodeID, strings.TrimSpace(parts[2]))
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
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") {
			return
		}
		// Clearing an editor document removes the latest hot-read projection only.
		// The append-only information history stays intact for audit/debug paths.
		projections, listErr := s.repo.ListNodeProjections(companyID, nodeID)
		if listErr != nil {
			writeChatCommentEditError(w, listErr, "failed_to_load_chat_comment")
			return
		}
		for _, projection := range projections {
			if projection.InformationID == informationID && strings.EqualFold(strings.TrimSpace(projection.Type), "Text box") {
				writeError(w, http.StatusConflict, "editor_collaboration_required")
				return
			}
		}
		if chatComment, found := findNodeChatComment(projections, informationID); found {
			actorUserID, _ := nodeChangeActorPayload(r)
			if !chatCommentOwnedBy(chatComment.Information, actorUserID) {
				writeError(w, http.StatusForbidden, "chat_comment_author_required")
				return
			}
		}
		actorUserID, actorLabel := nodeChangeActorPayload(r)
		if err := s.repo.DeleteNodeProjectionWithActor(store.NodeProjectionDeleteInput{
			CompanyID:        companyID,
			NodeID:           nodeID,
			InformationID:    informationID,
			ActorUserID:      actorUserID,
			ActorDisplayName: actorLabel,
			ExpectedRevision: expectedRevision,
		}); errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
			return
		} else if errors.Is(err, store.ErrEmailRelationshipHasNodeWork) {
			writeError(w, http.StatusConflict, "email_removal_has_node_work")
			return
		} else if revisionConflict := (*store.ProjectionRevisionConflictError)(nil); errors.As(err, &revisionConflict) {
			writeProjectionRevisionConflict(w, revisionConflict)
			return
		} else if errors.Is(err, store.ErrProjectionRevisionRequired) {
			writeError(w, http.StatusBadRequest, "expected_revision_required")
			return
		} else if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_delete_node_projection")
			return
		}
		s.publishWorkspaceEvent(companyID, "node_projection_deleted", map[string]any{"node_id": nodeID, "information_id": informationID})
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
		if strings.TrimSpace(req.Information) == "" {
			// UI clients and future headless agents share this endpoint. Guarding here keeps
			// blank editor blurs from creating hot-path history/projection noise in Postgres.
			writeError(w, http.StatusBadRequest, "information_required")
			return
		}
		if rejectDurableInlineFileBytes(w, "node_content", req.Information) {
			return
		}
		if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
			return
		}
		if strings.TrimSpace(req.InformationID) != "" {
			if projections, listErr := s.repo.ListNodeProjections(req.CompanyID, nodeID); listErr != nil {
				writeChatCommentEditError(w, listErr, "failed_to_load_chat_comment")
				return
			} else if _, exists := findNodeChatComment(projections, req.InformationID); exists {
				writeError(w, http.StatusConflict, "chat_comment_patch_required")
				return
			}
		}

		actorUserID, actorLabel := nodeChangeActorPayload(r)
		writeInput := store.NodeInformationInput{
			CompanyID:        req.CompanyID,
			NodeID:           nodeID,
			Type:             req.Type,
			Information:      req.Information,
			InformationID:    req.InformationID,
			ActorUserID:      actorUserID,
			ActorDisplayName: actorLabel,
		}
		item, err := s.repo.AddNodeInformationWithActor(writeInput)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
			return
		}

		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_add_node_information")
			return
		}
		s.publishWorkspaceEvent(req.CompanyID, "node_information_created", map[string]any{"node_id": nodeID, "information_id": item.InformationID})
		mentionInformationID := strings.TrimSpace(req.InformationID)
		if mentionInformationID == "" {
			mentionInformationID = item.InformationID
		}
		s.recordMentionNotifications(r, req.CompanyID, "node", nodeID, mentionInformationID, req.Type, req.Information)
		s.recordNodeChatNotification(r, req.CompanyID, nodeID, mentionInformationID, req.Type, req.Information)
		writeJSON(w, http.StatusCreated, item)
		return
	}

	writeError(w, http.StatusNotFound, "not_found")
}

func nodeDetailsIncludeInformationHistory(r *http.Request) bool {
	if isTruthyQueryValue(firstNonEmptyQueryValue(r, "include_information", "include_history")) {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("history")), "full")
}

func nodeChangeActorPayload(r *http.Request) (string, string) {
	actor, ok := authenticatedActor(r)
	if !ok {
		return "", ""
	}
	label := strings.TrimSpace(actor.User.DisplayName)
	if label == "" {
		label = strings.TrimSpace(actor.User.Email)
	}
	return strings.TrimSpace(actor.User.UserID), label
}
