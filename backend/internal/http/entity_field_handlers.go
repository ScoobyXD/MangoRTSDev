package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleEntityFields(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		items, err := s.repo.ListEntityFields(companyID)
		if err != nil {
			writeEntityFieldError(w, err, "failed_to_list_entity_fields")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"fields": items})
	case http.MethodPost:
		var request struct {
			CompanyID string `json:"company_id"`
			FieldID   string `json:"field_id"`
			Name      string `json:"name"`
			Color     string `json:"color"`
			Position  *int   `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		actor, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID)
		if !ok {
			return
		}
		input := store.EntityFieldInput{
			CompanyID:   request.CompanyID,
			FieldID:     request.FieldID,
			Name:        request.Name,
			Color:       request.Color,
			ActorUserID: actor.User.UserID,
		}
		if request.Position != nil {
			input.Position = *request.Position
			input.PositionSet = true
		}
		item, err := s.repo.CreateEntityField(input)
		if err != nil {
			writeEntityFieldError(w, err, "failed_to_create_entity_field")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"field": item})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleEntityFieldByID(w http.ResponseWriter, r *http.Request) {
	fieldID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/entity-fields/"), "/")
	if fieldID == "" || fieldID == "assignments" {
		writeError(w, http.StatusNotFound, "entity_field_not_found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var request struct {
			CompanyID string `json:"company_id"`
			Name      string `json:"name"`
			Color     string `json:"color"`
			Position  *int   `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		actor, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID)
		if !ok {
			return
		}
		input := store.EntityFieldInput{
			CompanyID:   request.CompanyID,
			FieldID:     fieldID,
			Name:        request.Name,
			Color:       request.Color,
			ActorUserID: actor.User.UserID,
		}
		if request.Position != nil {
			input.Position = *request.Position
			input.PositionSet = true
		}
		item, err := s.repo.UpdateEntityField(input)
		if err != nil {
			writeEntityFieldError(w, err, "failed_to_update_entity_field")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"field": item})
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		actor, ok := s.requireAccountCompanyAccess(w, r, companyID)
		if !ok {
			return
		}
		if err := s.repo.DeleteEntityField(companyID, fieldID, actor.User.UserID); err != nil {
			writeEntityFieldError(w, err, "failed_to_delete_entity_field")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted_field_id": fieldID})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleEntityFieldAssignments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var request struct {
		CompanyID    string   `json:"company_id"`
		ResourceType string   `json:"resource_type"`
		ResourceID   string   `json:"resource_id"`
		FieldIDs     []string `json:"field_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	resourceType, ok := store.NormalizeEntityType(request.ResourceType)
	if !ok || (resourceType != store.EntityTypeProject && resourceType != store.EntityTypeNode && resourceType != store.EntityTypeLogicGate) {
		writeError(w, http.StatusBadRequest, "invalid_entity_field_resource")
		return
	}
	if !s.requireEntityEdit(w, r, request.CompanyID, resourceType, request.ResourceID, "entity_field_resource_not_found") {
		return
	}
	actorUserID := ""
	if actor, authenticated := authenticatedActor(r); authenticated {
		actorUserID = actor.User.UserID
	}
	items, err := s.repo.SetEntityFieldAssignments(store.EntityFieldAssignmentInput{
		CompanyID:    request.CompanyID,
		ResourceType: resourceType,
		ResourceID:   request.ResourceID,
		FieldIDs:     request.FieldIDs,
		ActorUserID:  actorUserID,
	})
	if err != nil {
		writeEntityFieldError(w, err, "failed_to_set_entity_field_assignments")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"resource_type": resourceType,
		"resource_id":   request.ResourceID,
		"fields":        items,
	})
}

func writeEntityFieldError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_entity_field_request")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "entity_field_not_found")
	case errors.Is(err, store.ErrAlreadyExists):
		writeError(w, http.StatusConflict, "entity_field_already_exists")
	default:
		writeError(w, http.StatusInternalServerError, fallback)
	}
}
