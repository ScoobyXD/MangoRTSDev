package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"miraeopus/backend/internal/store"
)

func (s *Server) handleActionItems(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/action-items" {
		writeError(w, http.StatusNotFound, "action_item_not_found")
		return
	}
	switch r.Method {
	case http.MethodPost:
		var request struct {
			CompanyID string  `json:"company_id"`
			BodyText  string  `json:"body_text"`
			Name      string  `json:"name"`
			Color     *string `json:"color"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		actor, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID)
		if !ok {
			return
		}
		item, err := s.repo.CreateActionItem(store.ActionItemInput{
			CompanyID: request.CompanyID, Name: request.Name, BodyText: request.BodyText,
			Color: request.Color, CreatedByUserID: actor.User.UserID,
		})
		if errors.Is(err, store.ErrPrincipalNotInCompany) {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return
		}
		if err != nil {
			writeEntityError(w, err, "failed_to_create_action_item")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"action_item": item})
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		huddleNodeID := strings.TrimSpace(r.URL.Query().Get("huddle_node_id"))
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeHuddleNode, huddleNodeID, "huddle_node_not_found") {
			return
		}
		items, err := s.repo.ListHuddleNodeActionItems(companyID, huddleNodeID)
		if err != nil {
			writeEntityError(w, err, "failed_to_list_action_items")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"action_items": items})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}
