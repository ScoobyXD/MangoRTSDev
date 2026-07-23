package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type projectRequest struct {
	CompanyID                           string    `json:"company_id"`
	Name                                string    `json:"name"`
	Status                              string    `json:"status"`
	Health                              string    `json:"health"`
	AccountIDs                          *[]string `json:"account_ids"`
	TeamIDs                             *[]string `json:"team_ids"`
	SkipCompanyExplorerDefaultPlacement bool      `json:"skip_company_explorer_default_placement"`
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

type projectCriticalPathStepRequest struct {
	CompanyID      string `json:"company_id"`
	StepID         string `json:"step_id"`
	Name           string `json:"name"`
	RelationshipID string `json:"relationship_id"`
	DueDate        string `json:"due_date"`
	OwnerType      string `json:"owner_type"`
	OwnerID        string `json:"owner_id"`
	Position       int    `json:"position"`
	IsCurrent      bool   `json:"is_current"`
}

type projectInitialInformationRequest struct {
	Type          string `json:"type"`
	Information   string `json:"information"`
	InformationID string `json:"information_id"`
}

type projectScopedNodeCreateRequest struct {
	CompanyID          string                            `json:"company_id"`
	NodeID             string                            `json:"node_id"`
	Title              string                            `json:"title"`
	Position           int                               `json:"position"`
	InitialInformation *projectInitialInformationRequest `json:"initial_information"`
	InitialAssignment  *projectInitialAssignmentRequest  `json:"initial_assignment"`
}

type projectScopedLogicGateCreateRequest struct {
	CompanyID          string                            `json:"company_id"`
	LogicGateID        string                            `json:"logic_gate_id"`
	Header             string                            `json:"header"`
	Position           int                               `json:"position"`
	InitialInformation *projectInitialInformationRequest `json:"initial_information"`
}

type projectInitialAssignmentRequest struct {
	LogicGateID string `json:"logic_gate_id"`
	Status      string `json:"status"`
	ColumnID    string `json:"column_id"`
	Position    int    `json:"position"`
	Priority    *int   `json:"priority"`
	IsIssue     *bool  `json:"is_issue"`
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
			CompanyID:                       companyID,
			Name:                            req.Name,
			Status:                          req.Status,
			Health:                          req.Health,
			AccountIDs:                      stringSliceValue(req.AccountIDs),
			AccountIDsSet:                   req.AccountIDs != nil,
			TeamIDs:                         stringSliceValue(req.TeamIDs),
			TeamIDsSet:                      req.TeamIDs != nil,
			ActorUserID:                     actor.User.UserID,
			CompanyExplorerDefaultPlacement: !req.SkipCompanyExplorerDefaultPlacement,
		})
		if err != nil {
			s.writeProjectMutationError(w, err, "failed_to_create_project")
			return
		}
		if result.FolderItem != nil {
			s.publishWorkspaceEvent(companyID, "company_explorer_item_placed", map[string]any{"parent_entity_id": result.FolderItem.FolderID, "target_type": result.FolderItem.ItemType, "target_id": result.FolderItem.ItemID, "folder_item": result.FolderItem})
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
	case "permissions":
		if len(parts) != 2 {
			writeError(w, http.StatusNotFound, "not_found")
			return
		}
		s.handleEntityPermissions(w, r, store.EntityTypeProject, projectID, "project_not_found", "project_permissions_updated")
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
	case "critical-path":
		if len(parts) == 2 {
			s.handleProjectCriticalPath(w, r, projectID)
			return
		}
		if len(parts) == 3 {
			s.handleProjectCriticalPathStepByID(w, r, projectID, parts[2])
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
	case "nodes":
		if len(parts) != 2 {
			writeError(w, http.StatusNotFound, "not_found")
			return
		}
		s.handleProjectScopedNodeCreate(w, r, projectID)
	case "logic-gates":
		if len(parts) != 2 {
			writeError(w, http.StatusNotFound, "not_found")
			return
		}
		s.handleProjectScopedLogicGateCreate(w, r, projectID)
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
			CompanyID:     companyID,
			ProjectID:     projectID,
			Name:          req.Name,
			Status:        req.Status,
			Health:        req.Health,
			AccountIDs:    stringSliceValue(req.AccountIDs),
			AccountIDsSet: req.AccountIDs != nil,
			TeamIDs:       stringSliceValue(req.TeamIDs),
			TeamIDsSet:    req.TeamIDs != nil,
			ActorUserID:   actor.User.UserID,
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
		actor, ok := requireActorDisplayNameConfirmation(w, r, confirmationDisplayNameFromHeader(r))
		if !ok {
			return
		}
		deletedByUserID := actor.User.UserID
		result, err := s.repo.DeleteCompanyExplorerTargets(companyID, []store.CompanyExplorerDeleteTargetInput{{Kind: "project", ID: projectID}}, deletedByUserID)
		if err != nil {
			s.writeProjectMutationError(w, err, "failed_to_delete_project")
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		writeJSON(w, http.StatusOK, map[string]any{"deleted_project_id": projectID, "targets": result.Targets})
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
	if strings.EqualFold(strings.TrimSpace(req.Type), "Text box") {
		writeError(w, http.StatusConflict, "editor_collaboration_required")
		return
	}
	if strings.TrimSpace(req.InformationID) != "" {
		if projections, listErr := s.repo.ListProjectProjections(companyID, projectID); listErr != nil {
			s.writeProjectMutationError(w, listErr, "failed_to_load_chat_comment")
			return
		} else if _, exists := findProjectChatComment(projections, req.InformationID); exists {
			writeError(w, http.StatusConflict, "chat_comment_patch_required")
			return
		}
	}
	if rejectDurableInlineFileBytes(w, "project_information", req.Information) {
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
	if r.Method == http.MethodPatch {
		s.handleProjectChatCommentEdit(w, r, projectID, informationID)
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
	if !s.requireEntityEdit(w, r, companyID, store.EntityTypeProject, projectID, "project_not_found") {
		return
	}
	projections, listErr := s.repo.ListProjectProjections(companyID, projectID)
	if listErr != nil {
		s.writeProjectMutationError(w, listErr, "failed_to_load_chat_comment")
		return
	}
	for _, projection := range projections {
		if projection.InformationID == informationID && strings.EqualFold(strings.TrimSpace(projection.Type), "Text box") {
			writeError(w, http.StatusConflict, "editor_collaboration_required")
			return
		}
	}
	if chatComment, found := findProjectChatComment(projections, informationID); found {
		actor, ok := authenticatedActor(r)
		if !ok || !chatCommentOwnedBy(chatComment.Information, actor.User.UserID) {
			writeError(w, http.StatusForbidden, "chat_comment_author_required")
			return
		}
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

func (s *Server) handleProjectCriticalPath(w http.ResponseWriter, r *http.Request, projectID string) {
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
		viewerUserID := s.entityPermissionActorUserID(r, companyID)
		steps, err := s.repo.ListProjectCriticalPathSteps(companyID, projectID, viewerUserID)
		if err != nil {
			s.writeProjectMutationError(w, err, "failed_to_list_project_critical_path")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"project_id": projectID, "critical_path": steps})
	case http.MethodPost:
		var req projectCriticalPathStepRequest
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
		step, err := s.repo.UpsertProjectCriticalPathStep(store.ProjectCriticalPathStepInput{
			CompanyID:      companyID,
			ProjectID:      projectID,
			StepID:         req.StepID,
			Name:           req.Name,
			RelationshipID: req.RelationshipID,
			DueDate:        req.DueDate,
			OwnerType:      req.OwnerType,
			OwnerID:        req.OwnerID,
			Position:       req.Position,
			IsCurrent:      req.IsCurrent,
			ActorUserID:    actor.User.UserID,
		})
		if err != nil {
			s.writeProjectMutationError(w, err, "failed_to_save_project_critical_path")
			return
		}
		s.publishWorkspaceEvent(companyID, "project_updated", map[string]any{"project_id": projectID, "critical_path_step": step})
		writeJSON(w, http.StatusOK, map[string]any{"step": step})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleProjectCriticalPathStepByID(w http.ResponseWriter, r *http.Request, projectID, stepID string) {
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
	if err := s.repo.DeleteProjectCriticalPathStep(store.ProjectCriticalPathStepDeleteInput{
		CompanyID:   companyID,
		ProjectID:   projectID,
		StepID:      stepID,
		ActorUserID: actor.User.UserID,
	}); err != nil {
		s.writeProjectMutationError(w, err, "failed_to_delete_project_critical_path")
		return
	}
	s.publishWorkspaceEvent(companyID, "project_updated", map[string]any{"project_id": projectID, "deleted_critical_path_step_id": stepID})
	writeJSON(w, http.StatusOK, map[string]string{"deleted_step_id": stepID})
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
		viewerUserID := s.entityPermissionActorUserID(r, companyID)
		items, err := s.repo.ListProjectRelationshipProjectionsForViewer(companyID, projectID, viewerUserID)
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
		if ok && resourceType == store.EntityTypeLogicGate {
			writeError(w, http.StatusBadRequest, "direct_project_logic_gate_addition_not_allowed")
			return
		}
		if !ok || resourceType != store.EntityTypeNode || strings.TrimSpace(req.ResourceID) == "" {
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
		for _, relationship := range result.ImplicitRelationships {
			s.publishWorkspaceEvent(companyID, "project_relationship_upserted", map[string]any{
				"project_id": projectID, "relationship": relationship,
				"resource_type": relationship.ResourceType, "resource_id": relationship.ResourceID,
			})
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

func (s *Server) handleProjectScopedNodeCreate(w http.ResponseWriter, r *http.Request, projectID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var fields map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if _, present := fields["assignee_user_id"]; present {
		writeError(w, http.StatusBadRequest, "unsupported_assignee_user_id")
		return
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	var req projectScopedNodeCreateRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID := strings.TrimSpace(req.CompanyID)
	if companyID == "" || strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, "company_id_and_title_required")
		return
	}
	if !s.requireEntityEdit(w, r, companyID, store.EntityTypeProject, projectID, "project_not_found") {
		return
	}
	if req.InitialAssignment == nil || strings.TrimSpace(req.InitialAssignment.LogicGateID) == "" {
		writeError(w, http.StatusBadRequest, "project_node_logic_gate_required")
		return
	}
	logicGateID := strings.TrimSpace(req.InitialAssignment.LogicGateID)
	if !s.requireKanbanLogicGateEffectiveAccess(w, companyID, s.entityPermissionActorUserID(r, companyID), logicGateID, store.EntityPermissionEdit) {
		return
	}
	actor, _ := authenticatedActor(r)
	input := store.ProjectScopedNodeCreateInput{
		CompanyID:   companyID,
		ProjectID:   projectID,
		NodeID:      req.NodeID,
		Title:       req.Title,
		Position:    req.Position,
		ActorUserID: actor.User.UserID,
	}
	if req.InitialInformation != nil {
		if rejectDurableInlineFileBytes(w, "project_scoped_node_initial_information", req.InitialInformation.Information) {
			return
		}
		input.InitialInformation = &store.ProjectScopedInitialInformationInput{
			Type:          req.InitialInformation.Type,
			Information:   req.InitialInformation.Information,
			InformationID: req.InitialInformation.InformationID,
		}
	}
	if req.InitialAssignment != nil {
		input.InitialAssignment = &store.ProjectScopedNodeLogicGateAssignmentInput{
			LogicGateID: strings.TrimSpace(req.InitialAssignment.LogicGateID),
			Status:      req.InitialAssignment.Status,
			ColumnID:    req.InitialAssignment.ColumnID,
			Position:    req.InitialAssignment.Position,
			Priority:    req.InitialAssignment.Priority,
			IsIssue:     req.InitialAssignment.IsIssue,
		}
	}
	result, err := s.repo.CreateNodeAssociatedWithProject(input)
	if err != nil {
		s.writeProjectMutationError(w, err, "failed_to_create_project_node")
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) handleProjectScopedLogicGateCreate(w http.ResponseWriter, r *http.Request, projectID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	writeError(w, http.StatusBadRequest, "direct_project_logic_gate_addition_not_allowed")
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
	case errors.Is(err, store.ErrDirectProjectLogicGate):
		writeError(w, http.StatusBadRequest, "direct_project_logic_gate_addition_not_allowed")
	case errors.Is(err, store.ErrProjectNodeLogicGateRequired):
		writeError(w, http.StatusBadRequest, "project_node_logic_gate_required")
	case errors.Is(err, store.ErrProjectNodeInAnotherProject):
		writeError(w, http.StatusConflict, "project_node_already_in_another_project")
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_project")
	case errors.Is(err, store.ErrAlreadyExists):
		writeError(w, http.StatusConflict, "project_already_exists")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "project_not_found")
	case errors.Is(err, store.ErrPriorityRequired):
		writeError(w, http.StatusBadRequest, "priority_required")
	default:
		writeError(w, http.StatusInternalServerError, fallback)
	}
}

func stringSliceValue(value *[]string) []string {
	if value == nil {
		return nil
	}
	return append([]string{}, (*value)...)
}
