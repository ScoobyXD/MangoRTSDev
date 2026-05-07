package httpapi

import (
	"encoding/json"
	"errors"
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
		items, err := s.repo.ListNodes(companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_nodes")
			return
		}
		if sets, shouldFilter, err := s.assignmentSetsForRequest(r, companyID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_filter_nodes")
			return
		} else if shouldFilter {
			items = filterNodesByAssignments(items, sets)
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
			item, err := s.repo.UpdateNode(input)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "node_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_update_node")
				return
			}
			s.publishWorkspaceEvent(input.CompanyID, "node_updated", map[string]any{"node_id": nodeID, "node": item})
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
		// Clearing an editor document removes the latest hot-read projection only.
		// The append-only information history stays intact for audit/debug paths.
		if err := s.repo.DeleteNodeProjection(companyID, nodeID, informationID); errors.Is(err, store.ErrNotFound) {
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
