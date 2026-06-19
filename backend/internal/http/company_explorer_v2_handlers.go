package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleCompanyExplorerV2Roots(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	query, ok := s.companyExplorerV2RowsQuery(w, r, false)
	if !ok {
		return
	}
	rows, err := s.repo.ListCompanyExplorerV2RootRows(query)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_view")
		return
	}
	if err != nil {
		log.Printf("company explorer v2 roots: failed company_id=%s view=%s: %v", query.CompanyID, query.View, err)
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_v2_roots")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, rows)
}

func (s *Server) handleCompanyExplorerV2Entities(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v2/company-explorer/entities/"), "/")
	parts := strings.Split(trimmed, "/")
	entityID := strings.TrimSpace(parts[0])
	if entityID == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if len(parts) == 2 && parts[1] == "children" {
		s.handleCompanyExplorerV2Children(w, r, entityID)
		return
	}
	if len(parts) == 2 && parts[1] == "permissions" {
		s.handleEntityPermissions(w, r, store.EntityTypeCompanyExplorerFolder, entityID, "company_explorer_folder_not_found", "company_explorer_v2_permissions_updated")
		return
	}
	if len(parts) != 1 {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		s.handleCompanyExplorerV2EntityUpdate(w, r, entityID)
	case http.MethodDelete:
		s.handleCompanyExplorerV2EntityDelete(w, r, entityID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleCompanyExplorerV2Children(w http.ResponseWriter, r *http.Request, parentEntityID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	query, ok := s.companyExplorerV2RowsQuery(w, r, true)
	if !ok {
		return
	}
	query.ParentEntityID = parentEntityID
	rows, err := s.repo.ListCompanyExplorerV2ChildRows(query)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_v2_child_query")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return
	}
	if err != nil {
		log.Printf("company explorer v2 children: failed company_id=%s view=%s parent_entity_id=%s: %v", query.CompanyID, query.View, parentEntityID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_list_company_explorer_v2_children")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, rows)
}

func (s *Server) companyExplorerV2RowsQuery(w http.ResponseWriter, r *http.Request, requireParent bool) (store.CompanyExplorerV2RowsQuery, bool) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return store.CompanyExplorerV2RowsQuery{}, false
	}
	viewValue := firstNonEmptyQueryValue(r, "view", "scope")
	view, ok := store.NormalizeCompanyExplorerV2View(viewValue)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_view")
		return store.CompanyExplorerV2RowsQuery{}, false
	}
	query := store.CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             view,
		PermissionUserID: s.entityPermissionActorUserID(r, companyID),
	}
	if requireParent {
		query.ParentEntityID = strings.TrimSpace(strings.TrimPrefix(strings.Trim(r.URL.Path, "/"), "v2/company-explorer/entities/"))
	}
	actor, hasActor := authenticatedActor(r)
	if hasActor {
		query.ScopeUserID = strings.TrimSpace(actor.User.UserID)
	}
	if view == store.CompanyExplorerLazyScopeMe || view == store.CompanyExplorerLazyScopeTeam {
		if !hasActor || strings.TrimSpace(actor.User.UserID) == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return store.CompanyExplorerV2RowsQuery{}, false
		}
		if actorRoleForCompany(actor, companyID) == "" {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return store.CompanyExplorerV2RowsQuery{}, false
		}
	}
	return query, true
}

func (s *Server) handleCompanyExplorerV2Folders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID      string `json:"company_id"`
		ParentEntityID string `json:"parent_entity_id"`
		Name           string `json:"name"`
		Position       int    `json:"position"`
		DefaultAccess  string `json:"default_access"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.ParentEntityID = strings.TrimSpace(req.ParentEntityID)
	req.Name = strings.TrimSpace(req.Name)
	if !requireCompanyAccess(w, r, req.CompanyID) {
		return
	}
	actor, _ := authenticatedActor(r)
	row, err := s.repo.CreateCompanyExplorerV2Folder(store.CompanyExplorerV2FolderInput{
		CompanyID:        req.CompanyID,
		ParentEntityID:   req.ParentEntityID,
		Name:             req.Name,
		Position:         req.Position,
		DefaultAccess:    req.DefaultAccess,
		ActorUserID:      strings.TrimSpace(actor.User.UserID),
		PermissionUserID: s.entityPermissionActorUserID(r, req.CompanyID),
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_v2_folder")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_company_explorer_v2_folder")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "company_explorer_v2_entity_created", map[string]any{"entity_id": row.EntityID, "entity_type": row.EntityType, "parent_entity_id": row.ParentEntityID, "edge_id": row.EdgeID, "entity": row})
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) handleCompanyExplorerV2EntityUpdate(w http.ResponseWriter, r *http.Request, entityID string) {
	var req struct {
		CompanyID      string `json:"company_id"`
		Name           string `json:"name"`
		EdgeID         string `json:"edge_id"`
		ParentEntityID string `json:"parent_entity_id"`
		Position       int    `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if !requireCompanyAccess(w, r, req.CompanyID) {
		return
	}
	actor, _ := authenticatedActor(r)
	permissionUserID := s.entityPermissionActorUserID(r, req.CompanyID)
	var row store.CompanyExplorerV2Row
	var err error
	changed := false
	if strings.TrimSpace(req.Name) != "" {
		row, err = s.repo.UpdateCompanyExplorerV2Folder(store.CompanyExplorerV2FolderUpdateInput{
			CompanyID:        req.CompanyID,
			EntityID:         entityID,
			Name:             req.Name,
			ActorUserID:      strings.TrimSpace(actor.User.UserID),
			PermissionUserID: permissionUserID,
		})
		if err != nil {
			s.writeCompanyExplorerV2WriteError(w, err, "failed_to_update_company_explorer_v2_folder")
			return
		}
		changed = true
		s.publishWorkspaceEvent(req.CompanyID, "company_explorer_v2_entity_updated", map[string]any{"entity_id": row.EntityID, "entity_type": row.EntityType, "entity": row})
	}
	if strings.TrimSpace(req.EdgeID) != "" || strings.TrimSpace(req.ParentEntityID) != "" || req.Position > 0 {
		row, err = s.repo.MoveCompanyExplorerV2Edge(store.CompanyExplorerV2MoveEdgeInput{
			CompanyID:        req.CompanyID,
			EdgeID:           req.EdgeID,
			ParentEntityID:   req.ParentEntityID,
			Position:         req.Position,
			ActorUserID:      strings.TrimSpace(actor.User.UserID),
			PermissionUserID: permissionUserID,
		})
		if err != nil {
			s.writeCompanyExplorerV2WriteError(w, err, "failed_to_move_company_explorer_v2_edge")
			return
		}
		changed = true
		s.publishWorkspaceEvent(req.CompanyID, "company_explorer_v2_edge_moved", map[string]any{"entity_id": row.EntityID, "entity_type": row.EntityType, "parent_entity_id": row.ParentEntityID, "edge_id": row.EdgeID, "entity": row})
	}
	if !changed {
		writeError(w, http.StatusBadRequest, "company_explorer_v2_entity_update_required")
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (s *Server) handleCompanyExplorerV2EntityDelete(w http.ResponseWriter, r *http.Request, entityID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if !requireCompanyAccess(w, r, companyID) {
		return
	}
	if !s.requireEntityEdit(w, r, companyID, store.EntityTypeCompanyExplorerFolder, entityID, "company_explorer_folder_not_found") {
		return
	}
	if err := s.repo.DeleteCompanyExplorerV2Folder(companyID, entityID); errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_v2_folder")
		return
	} else if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "company_explorer_folder_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_company_explorer_v2_folder")
		return
	}
	s.publishWorkspaceEvent(companyID, "company_explorer_v2_entity_deleted", map[string]any{"entity_id": entityID, "entity_type": store.CompanyExplorerV2EntityFolder})
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleCompanyExplorerV2Subscriptions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID      string `json:"company_id"`
		OwnerType      string `json:"owner_type"`
		OwnerID        string `json:"owner_id"`
		AnchorEntityID string `json:"anchor_entity_id"`
		Position       int    `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if !requireCompanyAccess(w, r, req.CompanyID) {
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok || strings.TrimSpace(actor.User.UserID) == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	subscription, err := s.repo.UpsertCompanyExplorerV2Subscription(store.CompanyExplorerV2SubscriptionInput{
		CompanyID:        req.CompanyID,
		OwnerType:        req.OwnerType,
		OwnerID:          req.OwnerID,
		AnchorEntityID:   req.AnchorEntityID,
		Position:         req.Position,
		ActorUserID:      strings.TrimSpace(actor.User.UserID),
		PermissionUserID: s.entityPermissionActorUserID(r, req.CompanyID),
	})
	if err != nil {
		s.writeCompanyExplorerV2WriteError(w, err, "failed_to_upsert_company_explorer_v2_subscription")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "company_explorer_v2_subscription_upserted", map[string]any{
		"subscription_id":  subscription.SubscriptionID,
		"owner_type":       subscription.OwnerType,
		"owner_id":         subscription.OwnerID,
		"anchor_entity_id": subscription.AnchorEntityID,
		"subscription":     subscription,
	})
	writeJSON(w, http.StatusOK, subscription)
}

func (s *Server) handleCompanyExplorerV2SubscriptionByID(w http.ResponseWriter, r *http.Request) {
	subscriptionID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v2/company-explorer/subscriptions/"), "/")
	if subscriptionID == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if !requireCompanyAccess(w, r, companyID) {
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok || strings.TrimSpace(actor.User.UserID) == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if err := s.repo.DeleteCompanyExplorerV2Subscription(companyID, subscriptionID, strings.TrimSpace(actor.User.UserID)); errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_v2_subscription")
		return
	} else if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_company_explorer_v2_subscription")
		return
	}
	s.publishWorkspaceEvent(companyID, "company_explorer_v2_subscription_deleted", map[string]any{"subscription_id": subscriptionID})
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
func (s *Server) handleCompanyExplorerV2Edges(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID       string `json:"company_id"`
		ParentEntityID  string `json:"parent_entity_id"`
		ChildEntityID   string `json:"child_entity_id"`
		ChildEntityType string `json:"child_entity_type"`
		ChildResourceID string `json:"child_resource_id"`
		Position        int    `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if !requireCompanyAccess(w, r, req.CompanyID) {
		return
	}
	actor, _ := authenticatedActor(r)
	row, err := s.repo.UpsertCompanyExplorerV2Edge(store.CompanyExplorerV2EdgeInput{
		CompanyID:        req.CompanyID,
		ParentEntityID:   req.ParentEntityID,
		ChildEntityID:    req.ChildEntityID,
		ChildEntityType:  req.ChildEntityType,
		ChildResourceID:  req.ChildResourceID,
		Position:         req.Position,
		ActorUserID:      strings.TrimSpace(actor.User.UserID),
		PermissionUserID: s.entityPermissionActorUserID(r, req.CompanyID),
	})
	if err != nil {
		s.writeCompanyExplorerV2WriteError(w, err, "failed_to_upsert_company_explorer_v2_edge")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "company_explorer_v2_edge_upserted", map[string]any{"entity_id": row.EntityID, "entity_type": row.EntityType, "parent_entity_id": row.ParentEntityID, "edge_id": row.EdgeID, "entity": row})
	writeJSON(w, http.StatusOK, row)
}

func (s *Server) handleCompanyExplorerV2EdgeByID(w http.ResponseWriter, r *http.Request) {
	edgeID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v2/company-explorer/edges/"), "/")
	if edgeID == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		s.handleCompanyExplorerV2EdgeMove(w, r, edgeID)
	case http.MethodDelete:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if !requireCompanyAccess(w, r, companyID) {
			return
		}
		if err := s.repo.DeleteCompanyExplorerV2Edge(companyID, edgeID); errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_company_explorer_v2_edge")
			return
		} else if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "company_explorer_v2_edge_not_found")
			return
		} else if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_delete_company_explorer_v2_edge")
			return
		}
		s.publishWorkspaceEvent(companyID, "company_explorer_v2_edge_deleted", map[string]any{"edge_id": edgeID})
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleCompanyExplorerV2Drag(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID      string `json:"company_id"`
		EdgeID         string `json:"edge_id"`
		ParentEntityID string `json:"parent_entity_id"`
		Position       int    `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	s.moveCompanyExplorerV2EdgeFromRequest(w, r, req.CompanyID, req.EdgeID, req.ParentEntityID, req.Position)
}

func (s *Server) handleCompanyExplorerV2EdgeMove(w http.ResponseWriter, r *http.Request, edgeID string) {
	var req struct {
		CompanyID      string `json:"company_id"`
		ParentEntityID string `json:"parent_entity_id"`
		Position       int    `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	s.moveCompanyExplorerV2EdgeFromRequest(w, r, req.CompanyID, edgeID, req.ParentEntityID, req.Position)
}

func (s *Server) moveCompanyExplorerV2EdgeFromRequest(w http.ResponseWriter, r *http.Request, companyID, edgeID, parentEntityID string, position int) {
	companyID = strings.TrimSpace(companyID)
	if !requireCompanyAccess(w, r, companyID) {
		return
	}
	actor, _ := authenticatedActor(r)
	row, err := s.repo.MoveCompanyExplorerV2Edge(store.CompanyExplorerV2MoveEdgeInput{
		CompanyID:        companyID,
		EdgeID:           edgeID,
		ParentEntityID:   parentEntityID,
		Position:         position,
		ActorUserID:      strings.TrimSpace(actor.User.UserID),
		PermissionUserID: s.entityPermissionActorUserID(r, companyID),
	})
	if err != nil {
		s.writeCompanyExplorerV2WriteError(w, err, "failed_to_move_company_explorer_v2_edge")
		return
	}
	s.publishWorkspaceEvent(companyID, "company_explorer_v2_edge_moved", map[string]any{"entity_id": row.EntityID, "entity_type": row.EntityType, "parent_entity_id": row.ParentEntityID, "edge_id": row.EdgeID, "entity": row})
	writeJSON(w, http.StatusOK, row)
}

func (s *Server) writeCompanyExplorerV2WriteError(w http.ResponseWriter, err error, fallback string) {
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_company_explorer_v2_write")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return
	}
	writeError(w, http.StatusInternalServerError, fallback)
}
