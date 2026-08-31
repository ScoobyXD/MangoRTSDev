package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type huddleActionItemView struct {
	domain.Entity
	Source *domain.ActionItemSourceView `json:"source,omitempty"`
}

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
			Source    *struct {
				ResourceType string `json:"resource_type"`
				ResourceID   string `json:"resource_id"`
			} `json:"source"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		companyID := strings.TrimSpace(request.CompanyID)
		actor, ok := s.requireAccountCompanyAccess(w, r, companyID)
		if !ok {
			return
		}
		sourceType, sourceID := "", ""
		if request.Source != nil {
			var valid bool
			sourceType, valid = store.NormalizeActionItemSourceResourceType(request.Source.ResourceType)
			sourceID = strings.TrimSpace(request.Source.ResourceID)
			if !valid || !isCanonicalUUID(sourceID) {
				writeError(w, http.StatusBadRequest, "invalid_action_item_source")
				return
			}
		}
		item, err := s.repo.CreateActionItem(store.ActionItemInput{
			CompanyID: companyID, Name: request.Name, BodyText: request.BodyText,
			Color: request.Color, CreatedByUserID: actor.User.UserID,
			SourceResourceType: sourceType, SourceResourceID: sourceID,
		})
		if errors.Is(err, store.ErrPrincipalNotInCompany) {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return
		}
		if err != nil {
			writeEntityError(w, err, "failed_to_create_action_item")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"action_item": redactActionItemSourceEntity(item)})
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		actor, ok := s.requireAccountCompanyAccess(w, r, companyID)
		if !ok {
			return
		}
		huddleNodeID := strings.TrimSpace(r.URL.Query().Get("huddle_node_id"))
		huddleLogicGateID := strings.TrimSpace(r.URL.Query().Get("huddle_logic_gate_id"))
		if (huddleNodeID == "") == (huddleLogicGateID == "") {
			writeError(w, http.StatusBadRequest, "exactly_one_huddle_scope_required")
			return
		}
		var itemsErr error
		var items []domain.Entity
		if huddleNodeID != "" {
			if !s.requireEntityEdit(w, r, companyID, store.EntityTypeHuddleNode, huddleNodeID, "huddle_node_not_found") {
				return
			}
			items, itemsErr = s.repo.ListHuddleNodeActionItems(companyID, huddleNodeID)
		} else {
			if !s.requireEntityEdit(w, r, companyID, store.EntityTypeHuddleLogicGate, huddleLogicGateID, "huddle_logic_gate_not_found") {
				return
			}
			items, itemsErr = s.repo.ListHuddleLogicGateActionItems(companyID, huddleLogicGateID)
		}
		if itemsErr != nil {
			writeEntityError(w, itemsErr, "failed_to_list_action_items")
			return
		}
		views, err := s.huddleActionItemViews(companyID, actor.User.UserID, items)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_resolve_action_item_sources")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"action_items": views})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) huddleActionItemViews(companyID, viewerUserID string, items []domain.Entity) ([]huddleActionItemView, error) {
	entityIDs := make([]string, 0, len(items))
	for _, item := range items {
		entityIDs = append(entityIDs, item.EntityID)
	}
	sources, err := s.repo.ListVisibleActionItemSources(companyID, viewerUserID, entityIDs)
	if err != nil {
		return nil, err
	}
	views := make([]huddleActionItemView, 0, len(items))
	for _, item := range items {
		view := huddleActionItemView{Entity: redactActionItemSourceEntity(item)}
		if source, ok := sources[item.EntityID]; ok {
			view.Source = &source
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Server) handleActionItemSource(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/action-items/"), "/"), "/")
	if len(parts) != 2 || parts[1] != "source" {
		writeError(w, http.StatusNotFound, "action_item_source_not_found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	entityID := strings.TrimSpace(parts[0])
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if !isCanonicalUUID(entityID) || !isCanonicalUUID(companyID) {
		writeError(w, http.StatusBadRequest, "invalid_action_item_source_request")
		return
	}
	actor, ok := s.requireAccountCompanyAccess(w, r, companyID)
	if !ok {
		return
	}
	source, err := s.repo.GetActionItemSource(companyID, entityID)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"source": nil})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_action_item_source")
		return
	}
	view, err := s.visibleActionItemSource(companyID, actor.User.UserID, source)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_resolve_action_item_source")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"source": view})
}

func (s *Server) visibleActionItemSource(companyID, viewerUserID string, source domain.ActionItemSource) (*domain.ActionItemSourceView, error) {
	resourceType, valid := store.NormalizeActionItemSourceResourceType(source.ResourceType)
	resourceID := strings.TrimSpace(source.ResourceID)
	if !valid || !isCanonicalUUID(resourceID) {
		return nil, nil
	}
	name, accessType, accessID, parentResourceID := "", resourceType, resourceID, ""
	switch resourceType {
	case store.EntityTypeNode:
		item, err := s.repo.GetNode(companyID, resourceID)
		if errors.Is(err, store.ErrNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		name = item.Title
	case store.EntityTypeLogicGate:
		item, err := s.repo.GetLogicGate(companyID, resourceID)
		if errors.Is(err, store.ErrNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		name = item.Header
	case store.EntityTypeProject:
		item, err := s.repo.GetProject(companyID, resourceID)
		if errors.Is(err, store.ErrNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		name = item.Name
	case store.EntityTypeHuddleNode:
		item, err := s.repo.GetHuddleNode(companyID, resourceID)
		if errors.Is(err, store.ErrNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		name = item.Name
	case store.EntityTypeHuddleLogicGate:
		item, err := s.repo.GetHuddleLogicGate(companyID, resourceID)
		if errors.Is(err, store.ErrNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		name = item.Header
	case store.EntityTypeKPI:
		item, err := s.repo.GetKPI(companyID, resourceID)
		if errors.Is(err, store.ErrNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		name = item.Name
		accessType, accessID, parentResourceID = store.EntityTypeLogicGate, item.LogicGateID, item.LogicGateID
	}
	allowed, err := s.repo.UserHasEffectiveAccess(companyID, viewerUserID, accessType, accessID, store.EntityPermissionEdit)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, nil
	}
	return &domain.ActionItemSourceView{
		ResourceType: resourceType, ResourceID: resourceID, Name: name, ParentResourceID: parentResourceID,
	}, nil
}
