package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"miraeopus/backend/internal/store"
)

func (s *Server) handleEntityTypes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		items, err := s.repo.ListEntityTypes(companyID)
		if err != nil {
			writeEntityError(w, err, "failed_to_list_entity_types")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entity_types": items})
	case http.MethodPost:
		var request struct {
			CompanyID    string `json:"company_id"`
			EntityTypeID string `json:"entity_type_id"`
			Name         string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if _, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID); !ok {
			return
		}
		item, err := s.repo.CreateEntityType(store.EntityTypeInput{CompanyID: request.CompanyID, EntityTypeID: request.EntityTypeID, Name: request.Name})
		if err != nil {
			writeEntityError(w, err, "failed_to_create_entity_type")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"entity_type": item})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleEntityTypeByID(w http.ResponseWriter, r *http.Request) {
	entityTypeID := singleEntityPathID(r.URL.Path, "/v1/entity-types/")
	if entityTypeID == "" {
		writeError(w, http.StatusNotFound, "entity_type_not_found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var request struct {
			CompanyID string  `json:"company_id"`
			Name      *string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if _, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID); !ok {
			return
		}
		input := store.EntityTypeInput{CompanyID: request.CompanyID, EntityTypeID: entityTypeID}
		if request.Name != nil {
			input.Name, input.NameSet = *request.Name, true
		}
		item, err := s.repo.UpdateEntityType(input)
		if err != nil {
			writeEntityError(w, err, "failed_to_update_entity_type")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entity_type": item})
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		if err := s.repo.DeleteEntityType(companyID, entityTypeID); err != nil {
			writeEntityError(w, err, "failed_to_delete_entity_type")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted_entity_type_id": entityTypeID})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleEntityFolders(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		items, err := s.repo.ListEntityFolders(companyID, r.URL.Query().Get("entity_type_id"))
		if err != nil {
			writeEntityError(w, err, "failed_to_list_entity_folders")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entity_folders": items})
	case http.MethodPost:
		var request struct {
			CompanyID            string          `json:"company_id"`
			EntityFolderID       string          `json:"entity_folder_id"`
			EntityTypeID         string          `json:"entity_type_id"`
			ParentEntityFolderID json.RawMessage `json:"parent_entity_folder_id"`
			Name                 string          `json:"name"`
			Position             *int            `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if _, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID); !ok {
			return
		}
		parentID, _, err := decodeNullableEntityID(request.ParentEntityFolderID)
		if err != nil {
			writeEntityError(w, store.ErrInvalid, "invalid_entity_folder_request")
			return
		}
		input := store.EntityFolderInput{CompanyID: request.CompanyID, EntityFolderID: request.EntityFolderID, EntityTypeID: request.EntityTypeID, ParentEntityFolderID: parentID, Name: request.Name}
		if request.Position != nil {
			input.Position, input.PositionSet = *request.Position, true
		}
		item, err := s.repo.CreateEntityFolder(input)
		if err != nil {
			writeEntityError(w, err, "failed_to_create_entity_folder")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"entity_folder": item})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleEntityFolderByID(w http.ResponseWriter, r *http.Request) {
	folderID := singleEntityPathID(r.URL.Path, "/v1/entity-folders/")
	if folderID == "" {
		writeError(w, http.StatusNotFound, "entity_folder_not_found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var request struct {
			CompanyID            string          `json:"company_id"`
			ParentEntityFolderID json.RawMessage `json:"parent_entity_folder_id"`
			Name                 *string         `json:"name"`
			Position             *int            `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if _, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID); !ok {
			return
		}
		parentID, parentSet, err := decodeNullableEntityID(request.ParentEntityFolderID)
		if err != nil {
			writeEntityError(w, store.ErrInvalid, "invalid_entity_folder_request")
			return
		}
		input := store.EntityFolderInput{CompanyID: request.CompanyID, EntityFolderID: folderID, ParentEntityFolderID: parentID, ParentFolderSet: parentSet}
		if request.Name != nil {
			input.Name, input.NameSet = *request.Name, true
		}
		if request.Position != nil {
			input.Position, input.PositionSet = *request.Position, true
		}
		item, err := s.repo.UpdateEntityFolder(input)
		if err != nil {
			writeEntityError(w, err, "failed_to_update_entity_folder")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entity_folder": item})
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		if err := s.repo.DeleteEntityFolder(companyID, folderID); err != nil {
			writeEntityError(w, err, "failed_to_delete_entity_folder")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted_entity_folder_id": folderID})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleEntityFieldTypes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		items, err := s.repo.ListEntityFieldTypes(companyID, r.URL.Query().Get("entity_type_id"))
		if err != nil {
			writeEntityError(w, err, "failed_to_list_entity_field_types")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entity_field_types": items})
	case http.MethodPost:
		var request struct {
			CompanyID         string          `json:"company_id"`
			EntityFieldTypeID string          `json:"entity_field_type_id"`
			EntityTypeID      string          `json:"entity_type_id"`
			EntityFolderID    json.RawMessage `json:"entity_folder_id"`
			Name              string          `json:"name"`
			FieldType         string          `json:"field_type"`
			Config            json.RawMessage `json:"config"`
			Position          *int            `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if _, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID); !ok {
			return
		}
		folderID, _, err := decodeNullableEntityID(request.EntityFolderID)
		if err != nil {
			writeEntityError(w, store.ErrInvalid, "invalid_entity_field_type_request")
			return
		}
		input := store.EntityFieldTypeInput{CompanyID: request.CompanyID, EntityFieldTypeID: request.EntityFieldTypeID, EntityTypeID: request.EntityTypeID, EntityFolderID: folderID, Name: request.Name, FieldType: request.FieldType}
		if len(request.Config) > 0 {
			input.Config, input.ConfigSet = request.Config, true
		}
		if request.Position != nil {
			input.Position, input.PositionSet = *request.Position, true
		}
		item, err := s.repo.CreateEntityFieldType(input)
		if err != nil {
			writeEntityError(w, err, "failed_to_create_entity_field_type")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"entity_field_type": item})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleEntityFieldTypeByID(w http.ResponseWriter, r *http.Request) {
	fieldTypeID := singleEntityPathID(r.URL.Path, "/v1/entity-field-types/")
	if fieldTypeID == "" {
		writeError(w, http.StatusNotFound, "entity_field_type_not_found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var request struct {
			CompanyID      string          `json:"company_id"`
			EntityFolderID json.RawMessage `json:"entity_folder_id"`
			Name           *string         `json:"name"`
			FieldType      *string         `json:"field_type"`
			Config         json.RawMessage `json:"config"`
			Position       *int            `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if _, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID); !ok {
			return
		}
		folderID, folderSet, err := decodeNullableEntityID(request.EntityFolderID)
		if err != nil {
			writeEntityError(w, store.ErrInvalid, "invalid_entity_field_type_request")
			return
		}
		input := store.EntityFieldTypeInput{CompanyID: request.CompanyID, EntityFieldTypeID: fieldTypeID, EntityFolderID: folderID, EntityFolderSet: folderSet}
		if request.Name != nil {
			input.Name, input.NameSet = *request.Name, true
		}
		if request.FieldType != nil {
			input.FieldType, input.FieldTypeSet = *request.FieldType, true
		}
		if len(request.Config) > 0 {
			input.Config, input.ConfigSet = request.Config, true
		}
		if request.Position != nil {
			input.Position, input.PositionSet = *request.Position, true
		}
		item, err := s.repo.UpdateEntityFieldType(input)
		if err != nil {
			writeEntityError(w, err, "failed_to_update_entity_field_type")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entity_field_type": item})
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		if err := s.repo.DeleteEntityFieldType(companyID, fieldTypeID); err != nil {
			writeEntityError(w, err, "failed_to_delete_entity_field_type")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted_entity_field_type_id": fieldTypeID})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleEntities(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		allForType := false
		if values, present := r.URL.Query()["all_for_type"]; present {
			if len(values) != 1 || values[0] != "true" {
				writeEntityError(w, store.ErrInvalid, "invalid_entity_request")
				return
			}
			allForType = true
		}
		limit, err := optionalNonnegativeQueryInt(r, "limit")
		if err != nil {
			writeEntityError(w, store.ErrInvalid, "invalid_entity_request")
			return
		}
		offset, err := optionalNonnegativeQueryInt(r, "offset")
		if err != nil {
			writeEntityError(w, store.ErrInvalid, "invalid_entity_request")
			return
		}
		var folderID *string
		if values, present := r.URL.Query()["entity_folder_id"]; present {
			value := ""
			if len(values) > 0 {
				value = values[0]
			}
			folderID = &value
		}
		items, err := s.repo.ListEntities(r.Context(), store.EntityListQuery{CompanyID: companyID, Query: r.URL.Query().Get("q"), EntityTypeID: r.URL.Query().Get("entity_type_id"), EntityFolderID: folderID, Limit: limit, Offset: offset, AllForType: allForType})
		if err != nil {
			writeEntityError(w, err, "failed_to_list_entities")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entities": items})
	case http.MethodPost:
		var request struct {
			CompanyID      string          `json:"company_id"`
			EntityID       string          `json:"entity_id"`
			EntityTypeID   string          `json:"entity_type_id"`
			EntityFolderID json.RawMessage `json:"entity_folder_id"`
			Name           string          `json:"name"`
			Position       *int            `json:"position"`
			BodyJSON       json.RawMessage `json:"body_json"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		actor, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID)
		if !ok {
			return
		}
		folderID, _, err := decodeNullableEntityID(request.EntityFolderID)
		if err != nil {
			writeEntityError(w, store.ErrInvalid, "invalid_entity_request")
			return
		}
		input := store.EntityInput{CompanyID: request.CompanyID, EntityID: request.EntityID, EntityTypeID: request.EntityTypeID, EntityFolderID: folderID, Name: request.Name, CreatedByUserID: actor.User.UserID}
		if request.Position != nil {
			input.Position, input.PositionSet = *request.Position, true
		}
		if len(request.BodyJSON) > 0 {
			input.BodyJSON, input.BodySet = request.BodyJSON, true
		}
		item, err := s.repo.CreateEntity(input)
		if err != nil {
			writeEntityError(w, err, "failed_to_create_entity")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"entity": item})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleEntityByID(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/entities/"), "/"), "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "entity_not_found")
		return
	}
	entityID := parts[0]
	if len(parts) == 2 && parts[1] == "fields" {
		s.handleEntityFields(w, r, entityID)
		return
	}
	if len(parts) == 3 && parts[1] == "fields" && parts[2] != "" {
		s.handleEntityFieldByID(w, r, entityID, parts[2])
		return
	}
	if len(parts) != 1 {
		writeError(w, http.StatusNotFound, "entity_not_found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		item, err := s.repo.GetEntity(companyID, entityID)
		if err != nil {
			writeEntityError(w, err, "failed_to_get_entity")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entity": item})
	case http.MethodPut:
		var request struct {
			CompanyID      string          `json:"company_id"`
			EntityFolderID json.RawMessage `json:"entity_folder_id"`
			Name           *string         `json:"name"`
			Position       *int            `json:"position"`
			BodyJSON       json.RawMessage `json:"body_json"`
			BaseRevision   *int64          `json:"base_revision"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if _, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID); !ok {
			return
		}
		folderID, folderSet, err := decodeNullableEntityID(request.EntityFolderID)
		if err != nil {
			writeEntityError(w, store.ErrInvalid, "invalid_entity_request")
			return
		}
		input := store.EntityInput{CompanyID: request.CompanyID, EntityID: entityID, EntityFolderID: folderID, EntityFolderSet: folderSet}
		if request.Name != nil {
			input.Name, input.NameSet = *request.Name, true
		}
		if request.Position != nil {
			input.Position, input.PositionSet = *request.Position, true
		}
		if len(request.BodyJSON) > 0 {
			input.BodyJSON, input.BodySet = request.BodyJSON, true
		}
		if request.BaseRevision != nil {
			input.BaseRevision, input.BaseRevisionSet = *request.BaseRevision, true
		}
		item, err := s.repo.UpdateEntity(input)
		if err != nil {
			writeEntityError(w, err, "failed_to_update_entity")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entity": item})
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		if err := s.repo.DeleteEntity(companyID, entityID); err != nil {
			writeEntityError(w, err, "failed_to_delete_entity")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted_entity_id": entityID})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleEntityFields(w http.ResponseWriter, r *http.Request, entityID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var request struct {
		CompanyID string          `json:"company_id"`
		Name      string          `json:"name"`
		FieldType string          `json:"field_type"`
		Value     json.RawMessage `json:"value"`
		Position  *int            `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if _, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID); !ok {
		return
	}
	input := store.EntityFieldInput{CompanyID: request.CompanyID, EntityID: entityID, Name: request.Name, FieldType: request.FieldType}
	if len(request.Value) > 0 {
		input.Value, input.ValueSet = request.Value, true
	}
	if request.Position != nil {
		input.Position, input.PositionSet = *request.Position, true
	}
	item, err := s.repo.CreateEntityField(input)
	if err != nil {
		writeEntityError(w, err, "failed_to_create_entity_field")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"entity_field": item})
}

func (s *Server) handleEntityFieldByID(w http.ResponseWriter, r *http.Request, entityID, fieldID string) {
	switch r.Method {
	case http.MethodPut:
		var request struct {
			CompanyID string          `json:"company_id"`
			Name      *string         `json:"name"`
			FieldType *string         `json:"field_type"`
			Value     json.RawMessage `json:"value"`
			Position  *int            `json:"position"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if _, ok := s.requireAccountCompanyAccess(w, r, request.CompanyID); !ok {
			return
		}
		input := store.EntityFieldInput{CompanyID: request.CompanyID, EntityID: entityID, EntityFieldID: fieldID}
		if request.Name != nil {
			input.Name, input.NameSet = *request.Name, true
		}
		if request.FieldType != nil {
			input.FieldType, input.FieldTypeSet = *request.FieldType, true
		}
		if len(request.Value) > 0 {
			input.Value, input.ValueSet = request.Value, true
		}
		if request.Position != nil {
			input.Position, input.PositionSet = *request.Position, true
		}
		item, err := s.repo.UpdateEntityField(input)
		if err != nil {
			writeEntityError(w, err, "failed_to_update_entity_field")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entity_field": item})
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if _, ok := s.requireAccountCompanyAccess(w, r, companyID); !ok {
			return
		}
		if err := s.repo.DeleteEntityField(companyID, entityID, fieldID); err != nil {
			writeEntityError(w, err, "failed_to_delete_entity_field")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted_entity_field_id": fieldID})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func singleEntityPathID(path, prefix string) string {
	value := strings.Trim(strings.TrimPrefix(path, prefix), "/")
	if value == "" || strings.Contains(value, "/") {
		return ""
	}
	return value
}

func decodeNullableEntityID(raw json.RawMessage) (*string, bool, error) {
	if len(raw) == 0 {
		return nil, false, nil
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, true, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, true, err
	}
	return &value, true, nil
}

func optionalNonnegativeQueryInt(r *http.Request, name string) (int, error) {
	value := strings.TrimSpace(r.URL.Query().Get(name))
	if value == "" {
		return 0, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return 0, store.ErrInvalid
	}
	return parsed, nil
}

func writeEntityError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_entity_request")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "entity_not_found")
	case errors.Is(err, store.ErrAlreadyExists):
		writeError(w, http.StatusConflict, "entity_already_exists")
	case errors.Is(err, store.ErrConflict):
		writeError(w, http.StatusConflict, "entity_conflict")
	case errors.Is(err, store.ErrVersionConflict):
		writeError(w, http.StatusConflict, "entity_version_conflict")
	default:
		writeError(w, http.StatusInternalServerError, fallback)
	}
}
