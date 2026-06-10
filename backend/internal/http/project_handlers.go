package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type projectRequest struct {
	CompanyID string  `json:"company_id"`
	Name      string  `json:"name"`
	Status    string  `json:"status"`
	AccountID *string `json:"account_id"`
	TeamID    *string `json:"team_id"`
}

type projectInformationRequest struct {
	CompanyID     string `json:"company_id"`
	InformationID string `json:"information_id"`
	Type          string `json:"type"`
	Information   string `json:"information"`
}

type projectRelationshipRequest struct {
	CompanyID      string `json:"company_id"`
	RelationshipID string `json:"relationship_id"`
	ResourceType   string `json:"resource_type"`
	ResourceID     string `json:"resource_id"`
	Position       int    `json:"position"`
}

func (s *Server) handleProjects(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/projects" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		actor, ok := authenticatedActor(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if actorRoleForCompany(actor, companyID) == "" {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return
		}
		userID := s.entityPermissionActorUserID(r, companyID)
		projects, err := s.repo.ListProjects(companyID, userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_projects")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
			"company_id": companyID,
			"projects":   projects,
		})
	case http.MethodPost:
		var req projectRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		companyID := strings.TrimSpace(req.CompanyID)
		if companyID == "" || strings.TrimSpace(req.Name) == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_name_required")
			return
		}
		actor, ok := authenticatedActor(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if actorRoleForCompany(actor, companyID) == "" {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return
		}
		result, err := s.repo.CreateProject(store.ProjectInput{
			CompanyID:   companyID,
			Name:        req.Name,
			Status:      req.Status,
			AccountID:   req.AccountID,
			AccountSet:  req.AccountID != nil,
			TeamID:      req.TeamID,
			TeamSet:     req.TeamID != nil,
			ActorUserID: actor.User.UserID,
		})
		if err != nil {
			s.writeProjectMutationError(w, err, "failed_to_create_project")
			return
		}
		if result.Project != nil {
			s.publishWorkspaceEvent(companyID, "project_created", map[string]any{"project_id": result.Project.ProjectID, "project": result.Project})
		}
		writeJSON(w, http.StatusCreated, result)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleProjectSubresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/projects/"), "/")
	if trimmed == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	parts := strings.Split(trimmed, "/")
	if parts[0] == "relationships" {
		s.handleProjectRelationshipsForResource(w, r)
		return
	}
	projectID := strings.TrimSpace(parts[0])
	if projectID == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if len(parts) == 1 {
		s.handleProjectByID(w, r, projectID)
		return
	}
	switch parts[1] {
	case "information":
		if len(parts) != 2 {
			writeError(w, http.StatusNotFound, "not_found")
			return
		}
		s.handleProjectInformation(w, r, projectID)
	case "projection":
		if len(parts) == 2 && r.Method == http.MethodGet {
			s.handleProjectProjectionList(w, r, projectID)
			return
		}
		if len(parts) == 3 {
			s.handleProjectProjectionByID(w, r, projectID, parts[2])
			return
		}
		writeError(w, http.StatusNotFound, "not_found")
	case "relationships":
		if len(parts) == 2 {
			s.handleProjectRelationships(w, r, projectID)
			return
		}
		if len(parts) == 3 {
			s.handleProjectRelationshipByID(w, r, projectID, parts[2])
			return
		}
		writeError(w, http.StatusNotFound, "not_found")
	default:
		writeError(w, http.StatusNotFound, "not_found")
	}
}

func (s *Server) handleProjectByID(w http.ResponseWriter, r *http.Request, projectID string) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireEntityView(w, r, companyID, store.EntityTypeProject, projectID, "project_not_found") {
			return
		}
		userID := s.entityPermissionActorUserID(r, companyID)
		view, err := s.repo.GetProjectView(companyID, projectID, userID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "project_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_project")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, view)
	case http.MethodPut:
		var req projectRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		companyID := strings.TrimSpace(req.CompanyID)
		if companyID == "" || strings.TrimSpace(req.Name) == "" {
			writeError(w, http.StatusBadRequest, "company_id_and_name_required")
			return
		}
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeProject, projectID, "project_not_found") {
			return
		}
		actor, _ := authenticatedActor(r)
		result, err := s.repo.UpdateProject(store.ProjectInput{
			CompanyID:   companyID,
			ProjectID:   projectID,
			Name:        req.Name,
			Status:      req.Status,
			AccountID:   req.AccountID,
			AccountSet:  true,
			TeamID:      req.TeamID,
			TeamSet:     true,
			ActorUserID: actor.User.UserID,
		})
		if err != nil {
			s.writeProjectMutationError(w, err, "failed_to_update_project")
			return
		}
		s.publishWorkspaceEvent(companyID, "project_updated", map[string]any{"project_id": projectID, "project": result.Project})
		writeJSON(w, http.StatusOK, result)
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireEntityAdmin(w, r, companyID, store.EntityTypeProject, projectID, "project_not_found") {
			return
		}
		actor, _ := authenticatedActor(r)
		result, err := s.repo.DeleteProject(companyID, projectID, actor.User.UserID)
		if err != nil {
			s.writeProjectMutationError(w, err, "failed_to_delete_project")
			return
		}
		s.publishWorkspaceEvent(companyID, "project_deleted", map[string]any{"project_id": projectID})
		writeJSON(w, http.StatusOK, result)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleProjectInformation(w http.ResponseWriter, r *http.Request, projectID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req projectInformationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID := strings.TrimSpace(req.CompanyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireEntityEdit(w, r, companyID, store.EntityTypeProject, projectID, "project_not_found") {
		return
	}
	actor, _ := authenticatedActor(r)
	item, err := s.repo.AddProjectInformation(store.ProjectInformationInput{
		CompanyID:     companyID,
		ProjectID:     projectID,
		InformationID: req.InformationID,
		Type:          req.Type,
		Information:   req.Information,
		ActorUserID:   actor.User.UserID,
	})
	if err != nil {
		s.writeProjectMutationError(w, err, "failed_to_save_project_information")
		return
	}
	s.publishWorkspaceEvent(companyID, "project_information_created", map[string]any{"project_id": projectID, "information_id": item.InformationID})
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleProjectProjectionList(w http.ResponseWriter, r *http.Request, projectID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireEntityView(w, r, companyID, store.EntityTypeProject, projectID, "project_not_found") {
		return
	}
	items, err := s.repo.ListProjectProjections(companyID, projectID)
	if err != nil {
		s.writeProjectMutationError(w, err, "failed_to_list_project_projection")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"project_id": projectID, "projections": items})
}

func (s *Server) handleProjectProjectionByID(w http.ResponseWriter, r *http.Request, projectID, informationID string) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireEntityEdit(w, r, companyID, store.EntityTypeProject, projectID, "project_not_found") {
		return
	}
	actor, _ := authenticatedActor(r)
	if err := s.repo.DeleteProjectProjection(store.ProjectProjectionDeleteInput{
		CompanyID:     companyID,
		ProjectID:     projectID,
		InformationID: informationID,
		ActorUserID:   actor.User.UserID,
	}); err != nil {
		s.writeProjectMutationError(w, err, "failed_to_delete_project_projection")
		return
	}
	s.publishWorkspaceEvent(companyID, "project_information_deleted", map[string]any{"project_id": projectID, "information_id": informationID})
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleProjectRelationships(w http.ResponseWriter, r *http.Request, projectID string) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireEntityView(w, r, companyID, store.EntityTypeProject, projectID, "project_not_found") {
			return
		}
		items, err := s.repo.ListProjectRelationshipProjections(companyID, projectID)
		if err != nil {
			s.writeProjectMutationError(w, err, "failed_to_list_project_relationships")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"project_id": projectID, "relationships": items})
	case http.MethodPost:
		var req projectRelationshipRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		companyID := strings.TrimSpace(req.CompanyID)
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeProject, projectID, "project_not_found") {
			return
		}
		resourceType, ok := store.NormalizeEntityType(req.ResourceType)
		if !ok || (resourceType != store.EntityTypeLogicGate && resourceType != store.EntityTypeNode) || strings.TrimSpace(req.ResourceID) == "" {
			writeError(w, http.StatusBadRequest, "invalid_project_relationship")
			return
		}
		if !s.requireEntityView(w, r, companyID, resourceType, req.ResourceID, "relationship_target_not_found") {
			return
		}
		actor, _ := authenticatedActor(r)
		result, err := s.repo.UpsertProjectRelationship(store.ProjectRelationshipInput{
			CompanyID:      companyID,
			ProjectID:      projectID,
			RelationshipID: req.RelationshipID,
			ResourceType:   resourceType,
			ResourceID:     req.ResourceID,
			Position:       req.Position,
			ActorUserID:    actor.User.UserID,
		})
		if err != nil {
			s.writeProjectMutationError(w, err, "failed_to_save_project_relationship")
			return
		}
		s.publishWorkspaceEvent(companyID, "project_relationship_upserted", map[string]any{
			"project_id":    projectID,
			"relationship":  result.Relationship,
			"resource_type": resourceType,
			"resource_id":   req.ResourceID,
		})
		writeJSON(w, http.StatusOK, result)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleProjectRelationshipByID(w http.ResponseWriter, r *http.Request, projectID, relationshipID string) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireEntityEdit(w, r, companyID, store.EntityTypeProject, projectID, "project_not_found") {
		return
	}
	actor, _ := authenticatedActor(r)
	result, err := s.repo.DeleteProjectRelationship(store.ProjectRelationshipDeleteInput{
		CompanyID:      companyID,
		ProjectID:      projectID,
		RelationshipID: relationshipID,
		ActorUserID:    actor.User.UserID,
	})
	if err != nil {
		s.writeProjectMutationError(w, err, "failed_to_delete_project_relationship")
		return
	}
	s.publishWorkspaceEvent(companyID, "project_relationship_deleted", map[string]any{"project_id": projectID, "relationship_id": relationshipID})
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleProjectRelationshipsForResource(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	resourceType, ok := store.NormalizeEntityType(r.URL.Query().Get("resource_type"))
	resourceID := strings.TrimSpace(r.URL.Query().Get("resource_id"))
	if companyID == "" || resourceID == "" || !ok || (resourceType != store.EntityTypeLogicGate && resourceType != store.EntityTypeNode) {
		writeError(w, http.StatusBadRequest, "invalid_project_relationship_query")
		return
	}
	if !s.requireEntityView(w, r, companyID, resourceType, resourceID, "relationship_target_not_found") {
		return
	}
	viewerUserID := s.entityPermissionActorUserID(r, companyID)
	items, err := s.repo.ListProjectRelationshipsForResource(companyID, resourceType, resourceID, viewerUserID)
	if err != nil {
		s.writeProjectMutationError(w, err, "failed_to_list_project_relationships")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"relationships": items})
}

func (s *Server) writeProjectMutationError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_project")
	case errors.Is(err, store.ErrAlreadyExists):
		writeError(w, http.StatusConflict, "project_already_exists")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "project_not_found")
	default:
		writeError(w, http.StatusInternalServerError, fallback)
	}
}
