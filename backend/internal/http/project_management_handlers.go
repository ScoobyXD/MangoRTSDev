package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type projectManagementTimelineItemRequest struct {
	CompanyID    string `json:"company_id"`
	TargetUserID string `json:"target_user_id"`
	UserID       string `json:"user_id"`
	EntityType   string `json:"entity_type"`
	EntityID     string `json:"entity_id"`
	StartDate    string `json:"start_date"`
	DurationDays int    `json:"duration_days"`
	Position     int    `json:"position"`
}

type projectManagementTimelineItemUpdateRequest struct {
	CompanyID    string `json:"company_id"`
	StartDate    string `json:"start_date"`
	DurationDays int    `json:"duration_days"`
	Position     int    `json:"position"`
}

func (s *Server) handleProjectManagementTimelineProjection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	query, ok := s.parseProjectManagementReadQuery(w, r)
	if !ok {
		return
	}
	rows, err := s.repo.ListProjectManagementTimelineProjectionRows(query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_project_management_timeline")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"company_id": query.CompanyID,
		"user_id":    query.UserID,
		"limit":      query.Limit,
		"projection": "project_management_timeline",
		"rows":       rows,
	})
}

func (s *Server) handleProjectManagementTimelineItems(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/project-management/timeline-items" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req projectManagementTimelineItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID := strings.TrimSpace(req.CompanyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	actor, targetUserID, ok := s.authorizeProjectManagementTargetUser(w, r, companyID, strings.TrimSpace(req.TargetUserID), strings.TrimSpace(req.UserID))
	if !ok {
		return
	}
	entityType, entityID, ok := s.authorizeProjectManagementEntity(w, actor.User.UserID, companyID, req.EntityType, req.EntityID)
	if !ok {
		return
	}
	result, err := s.repo.UpsertProjectManagementTimelineItem(store.ProjectManagementTimelineItemInput{
		CompanyID:    companyID,
		UserID:       targetUserID,
		ViewerUserID: actor.User.UserID,
		ActorUserID:  actor.User.UserID,
		EntityType:   entityType,
		EntityID:     entityID,
		StartDate:    req.StartDate,
		DurationDays: req.DurationDays,
		Position:     req.Position,
	})
	if err != nil {
		s.writeProjectManagementMutationError(w, err, "failed_to_create_project_management_timeline_item")
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) handleProjectManagementTimelineItemByID(w http.ResponseWriter, r *http.Request) {
	itemID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/project-management/timeline-items/"), "/")
	if itemID == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		s.handleProjectManagementTimelineItemUpdate(w, r, itemID)
	case http.MethodDelete:
		s.handleProjectManagementTimelineItemDelete(w, r, itemID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleProjectManagementTimelineItemUpdate(w http.ResponseWriter, r *http.Request, itemID string) {
	var req projectManagementTimelineItemUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID := strings.TrimSpace(req.CompanyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	actor, ownerUserID, ok := s.authorizeProjectManagementTimelineItemOwner(w, r, companyID, itemID)
	if !ok {
		return
	}
	result, err := s.repo.UpdateProjectManagementTimelineItem(store.ProjectManagementTimelineItemUpdateInput{
		CompanyID:    companyID,
		ViewerUserID: actor.User.UserID,
		ActorUserID:  actor.User.UserID,
		ItemID:       itemID,
		StartDate:    req.StartDate,
		DurationDays: req.DurationDays,
		Position:     req.Position,
	})
	if err != nil {
		s.writeProjectManagementMutationError(w, err, "failed_to_update_project_management_timeline_item")
		return
	}
	if result.UserID == "" {
		result.UserID = ownerUserID
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleProjectManagementTimelineItemDelete(w http.ResponseWriter, r *http.Request, itemID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	actor, ownerUserID, ok := s.authorizeProjectManagementTimelineItemOwner(w, r, companyID, itemID)
	if !ok {
		return
	}
	result, err := s.repo.DeleteProjectManagementTimelineItem(store.ProjectManagementTimelineItemDeleteInput{
		CompanyID:    companyID,
		ViewerUserID: actor.User.UserID,
		ActorUserID:  actor.User.UserID,
		ItemID:       itemID,
	})
	if err != nil {
		s.writeProjectManagementMutationError(w, err, "failed_to_delete_project_management_timeline_item")
		return
	}
	if result.UserID == "" {
		result.UserID = ownerUserID
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) parseProjectManagementReadQuery(w http.ResponseWriter, r *http.Request) (store.ProjectManagementTimelineQuery, bool) {
	query, ok := s.parseWorkItemInboxReadQuery(w, r)
	if !ok {
		return store.ProjectManagementTimelineQuery{}, false
	}
	return store.NormalizeProjectManagementTimelineQuery(store.ProjectManagementTimelineQuery{
		CompanyID:    query.CompanyID,
		UserID:       query.UserID,
		ViewerUserID: query.ViewerUserID,
		Limit:        query.Limit,
	}), true
}

func (s *Server) authorizeProjectManagementTargetUser(w http.ResponseWriter, r *http.Request, companyID, targetUserID, userIDAlias string) (ActorContext, string, bool) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return ActorContext{}, "", false
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return ActorContext{}, "", false
	}
	viewerUserID := strings.TrimSpace(actor.User.UserID)
	if viewerUserID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return ActorContext{}, "", false
	}
	if targetUserID == "" {
		targetUserID = strings.TrimSpace(userIDAlias)
	}
	if targetUserID == "" {
		targetUserID = viewerUserID
	}
	if !isCanonicalUUID(targetUserID) {
		writeError(w, http.StatusBadRequest, "invalid_user_id")
		return ActorContext{}, "", false
	}
	if targetUserID != viewerUserID && !actorCanManageCompany(actor, companyID) {
		writeError(w, http.StatusForbidden, "company_admin_required")
		return ActorContext{}, "", false
	}
	if _, err := s.repo.GetCompanyUser(companyID, targetUserID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "target_user_not_found")
		return ActorContext{}, "", false
	} else if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_user_id")
		return ActorContext{}, "", false
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_target_user")
		return ActorContext{}, "", false
	}
	return actor, targetUserID, true
}

func (s *Server) authorizeProjectManagementTimelineItemOwner(w http.ResponseWriter, r *http.Request, companyID, itemID string) (ActorContext, string, bool) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return ActorContext{}, "", false
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return ActorContext{}, "", false
	}
	ownerUserID, err := s.repo.GetProjectManagementTimelineItemOwner(companyID, itemID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "timeline_item_not_found")
		return ActorContext{}, "", false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_timeline_item")
		return ActorContext{}, "", false
	}
	if ownerUserID != strings.TrimSpace(actor.User.UserID) && !actorCanManageCompany(actor, companyID) {
		writeError(w, http.StatusForbidden, "company_admin_required")
		return ActorContext{}, "", false
	}
	return actor, ownerUserID, true
}

func (s *Server) authorizeProjectManagementEntity(w http.ResponseWriter, viewerUserID, companyID, entityType, entityID string) (string, string, bool) {
	normalizedType, typeOK := store.NormalizeEntityType(entityType)
	entityID = strings.TrimSpace(entityID)
	if !typeOK || (normalizedType != store.EntityTypeNode && normalizedType != store.EntityTypeLogicGate) || entityID == "" {
		writeError(w, http.StatusBadRequest, "invalid_entity")
		return "", "", false
	}
	allowed, err := s.repo.UserHasEffectiveAccess(companyID, viewerUserID, normalizedType, entityID, store.EntityPermissionView)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_check_entity_access")
		return "", "", false
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "entity_access_denied")
		return "", "", false
	}
	return normalizedType, entityID, true
}

func (s *Server) writeProjectManagementMutationError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_timeline_item")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "timeline_item_not_found")
	case errors.Is(err, store.ErrPrincipalNotInCompany):
		writeError(w, http.StatusBadRequest, "target_user_not_found")
	default:
		writeError(w, http.StatusInternalServerError, fallback)
	}
}
