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

		assigneeUserID := ""
		if actor, ok := authenticatedActor(r); ok && strings.TrimSpace(actor.User.UserID) != "" {
			assigneeUserID = strings.TrimSpace(actor.User.UserID)
		}
		item, event, err := s.repo.CreateNodeWithAssigneeAndWorkspaceEvent(req.CompanyID, strings.TrimSpace(req.Title), assigneeUserID)
		if errors.Is(err, store.ErrAssigneeNotInCompany) {
			writeError(w, http.StatusBadRequest, "assignee_user_not_in_company")
			return
		}
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

func (s *Server) handleNodeSubresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/nodes/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	nodeID := parts[0]

	if len(parts) >= 2 && parts[1] == "changes" {
		s.handleNodeContentChanges(w, r, nodeID, parts[2:])
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
			input := store.UpdateNodeInput{CompanyID: strings.TrimSpace(*companyIDField), NodeID: nodeID}
			if title, set, ok := parseOptionalStringField(fields, "title"); !ok {
				writeError(w, http.StatusBadRequest, "invalid_title")
				return
			} else if set {
				if title == nil || strings.TrimSpace(*title) == "" {
					writeError(w, http.StatusBadRequest, "title_required")
					return
				}
				input.Title = strings.TrimSpace(*title)
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
			if statusColor, set, ok := parseOptionalStringField(fields, "status_color"); !ok {
				writeError(w, http.StatusBadRequest, "invalid_status_color")
				return
			} else if set {
				input.StatusColor = statusColor
				input.StatusColorSet = true
			}
			if priority, set, ok := parseOptionalPriorityField(fields); !ok {
				writeError(w, http.StatusBadRequest, "invalid_priority")
				return
			} else if set {
				input.Priority = priority
				input.PrioritySet = true
			}
			if assigneeUserID, set, ok := parseOptionalStringField(fields, "assignee_user_id"); !ok {
				writeError(w, http.StatusBadRequest, "invalid_assignee_user_id")
				return
			} else if set {
				input.AssigneeUserID = assigneeUserID
				input.AssigneeUserIDSet = true
			}
			if !input.TitleSet && !input.StatusSet && !input.StatusColorSet && !input.DueDateSet && !input.PrioritySet && !input.AssigneeUserIDSet {
				writeError(w, http.StatusBadRequest, "node_update_required")
				return
			}
			if !s.requireEntityEdit(w, r, input.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
				return
			}
			beforeNode, beforeNodeErr := s.repo.GetNode(input.CompanyID, nodeID)
			item, event, err := s.repo.UpdateNodeAndWorkspaceEvent(input)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "node_not_found")
				return
			}
			if errors.Is(err, store.ErrAssigneeNotInCompany) {
				writeError(w, http.StatusBadRequest, "assignee_user_not_in_company")
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
			if beforeNodeErr == nil {
				s.recordNodeUpdateNotifications(r, input, beforeNode, item)
			}
			writeJSON(w, http.StatusOK, item)
			return
		}
		if r.Method == http.MethodDelete {
			companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
			if companyID == "" {
				writeError(w, http.StatusBadRequest, "company_id_required")
				return
			}
			if !s.requireEntityAdmin(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") {
				return
			}
			event, err := s.repo.DeleteNodeAndWorkspaceEvent(companyID, nodeID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "node_not_found")
				return
			} else if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_delete_node")
				return
			}
			s.publishCommittedWorkspaceEvent(event)
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

	if len(parts) == 2 && parts[1] == "permissions" {
		s.handleEntityPermissions(w, r, store.EntityTypeNode, nodeID, "node_not_found", "node_permissions_updated")
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
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found") {
			return
		}
		// Clearing an editor document removes the latest hot-read projection only.
		// The append-only information history stays intact for audit/debug paths.
		actorUserID, actorLabel := nodeChangeActorPayload(r)
		if err := s.repo.DeleteNodeProjectionWithActor(store.NodeProjectionDeleteInput{
			CompanyID:        companyID,
			NodeID:           nodeID,
			InformationID:    informationID,
			ActorUserID:      actorUserID,
			ActorDisplayName: actorLabel,
		}); errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
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
		if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
			return
		}

		actorUserID, actorLabel := nodeChangeActorPayload(r)
		item, err := s.repo.AddNodeInformationWithActor(store.NodeInformationInput{
			CompanyID:        req.CompanyID,
			NodeID:           nodeID,
			Type:             req.Type,
			Information:      req.Information,
			InformationID:    req.InformationID,
			ActorUserID:      actorUserID,
			ActorDisplayName: actorLabel,
		})
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

func (s *Server) handleNodeContentChanges(w http.ResponseWriter, r *http.Request, nodeID string, parts []string) {
	if len(parts) == 0 {
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
		actorUserID, _ := nodeChangeActorPayload(r)
		if actorUserID == "" {
			writeJSON(w, http.StatusOK, map[string]any{
				"company_id": companyID,
				"node_id":    nodeID,
				"changes":    []any{},
			})
			return
		}
		items, err := s.repo.ListUnseenNodeContentChanges(store.NodeContentChangeListInput{
			CompanyID: companyID,
			NodeID:    nodeID,
			UserID:    actorUserID,
		})
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
			return
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_node_change_query")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_node_changes")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"company_id": companyID,
			"node_id":    nodeID,
			"changes":    items,
		})
		return
	}

	if len(parts) == 1 && parts[0] == "seen-all" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		var req struct {
			CompanyID string `json:"company_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		if req.CompanyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireEntityView(w, r, req.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
			return
		}
		actorUserID, _ := nodeChangeActorPayload(r)
		if actorUserID == "" {
			writeError(w, http.StatusUnauthorized, "authenticated_user_required")
			return
		}
		count, err := s.repo.MarkNodeContentChangeSeen(store.NodeContentChangeSeenInput{
			CompanyID: req.CompanyID,
			NodeID:    nodeID,
			UserID:    actorUserID,
		})
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_not_found")
			return
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_node_change_seen_request")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_mark_node_changes_seen")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "seen", "count": count})
		return
	}

	if len(parts) == 2 && parts[1] == "seen" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		changeID := strings.TrimSpace(parts[0])
		if changeID == "" {
			writeError(w, http.StatusBadRequest, "change_id_required")
			return
		}
		var req struct {
			CompanyID string `json:"company_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		if req.CompanyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireEntityView(w, r, req.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
			return
		}
		actorUserID, _ := nodeChangeActorPayload(r)
		if actorUserID == "" {
			writeError(w, http.StatusUnauthorized, "authenticated_user_required")
			return
		}
		count, err := s.repo.MarkNodeContentChangeSeen(store.NodeContentChangeSeenInput{
			CompanyID: req.CompanyID,
			NodeID:    nodeID,
			ChangeID:  changeID,
			UserID:    actorUserID,
		})
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "node_change_not_found")
			return
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_node_change_seen_request")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_mark_node_change_seen")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "seen", "count": count})
		return
	}

	writeError(w, http.StatusNotFound, "not_found")
}
