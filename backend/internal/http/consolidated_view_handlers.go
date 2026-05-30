package httpapi

import (
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleNodeViewV2Subresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v2/nodes/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || parts[1] != "view" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	s.handleNodeViewV2(w, r, strings.TrimSpace(parts[0]))
}

func (s *Server) handleNodeViewV2(w http.ResponseWriter, r *http.Request, nodeID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	flags, actorUserID, ok := s.requireV2RootEffectiveAccess(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found")
	if !ok {
		return
	}
	view, err := s.repo.GetNodeView(store.NodeViewInput{
		CompanyID: companyID,
		NodeID:    nodeID,
		UserID:    actorUserID,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_node_view_request")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "node_not_found")
		return
	}
	if err != nil {
		log.Printf("failed to load v2 node view company_id=%s node_id=%s user_id=%s: %v", companyID, nodeID, actorUserID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_load_node_view")
		return
	}
	view.EffectiveAccessFlags = flags
	writeJSONMaybeNotModified(w, r, http.StatusOK, view)
}

func (s *Server) handleLogicGateViewV2(w http.ResponseWriter, r *http.Request, logicGateID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	flags, _, ok := s.requireV2RootEffectiveAccess(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found")
	if !ok {
		return
	}
	view, err := s.repo.GetLogicGateView(companyID, logicGateID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_view_request")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return
	}
	if err != nil {
		log.Printf("failed to load v2 logic gate view company_id=%s logic_gate_id=%s: %v", companyID, logicGateID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_view")
		return
	}
	view.EffectiveAccessFlags = flags
	writeJSONMaybeNotModified(w, r, http.StatusOK, view)
}

func (s *Server) requireV2RootEffectiveAccess(w http.ResponseWriter, r *http.Request, companyID, resourceType, resourceID, notFoundCode string) (domain.EffectiveAccessFlags, string, bool) {
	companyID = strings.TrimSpace(companyID)
	resourceID = strings.TrimSpace(resourceID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return domain.EffectiveAccessFlags{}, "", false
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		if s.authValidator == nil {
			return domain.EffectiveAccessFlags{CanView: true, CanEdit: true, CanAdmin: true}, "", true
		}
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return domain.EffectiveAccessFlags{}, "", false
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return domain.EffectiveAccessFlags{}, "", false
	}
	actorUserID := strings.TrimSpace(actor.User.UserID)
	if actorCanManageCompany(actor, companyID) {
		return domain.EffectiveAccessFlags{CanView: true, CanEdit: true, CanAdmin: true}, actorUserID, true
	}
	canView, err := s.repo.UserHasEffectiveAccess(companyID, actorUserID, resourceType, resourceID, store.EntityPermissionView)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_effective_access_check")
		return domain.EffectiveAccessFlags{}, actorUserID, false
	}
	if err != nil {
		log.Printf("failed to check v2 root view access company_id=%s resource_type=%s resource_id=%s user_id=%s: %v", companyID, resourceType, resourceID, actorUserID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_check_effective_access")
		return domain.EffectiveAccessFlags{}, actorUserID, false
	}
	if !canView {
		writeAccessResourceNotFound(w)
		return domain.EffectiveAccessFlags{}, actorUserID, false
	}
	if resourceType == store.EntityTypeNode || resourceType == store.EntityTypeLogicGate {
		return domain.EffectiveAccessFlags{CanView: true, CanEdit: true, CanAdmin: false}, actorUserID, true
	}
	canEdit, err := s.repo.UserHasEffectiveAccess(companyID, actorUserID, resourceType, resourceID, store.EntityPermissionEdit)
	if err != nil {
		log.Printf("failed to check v2 root edit access company_id=%s resource_type=%s resource_id=%s user_id=%s: %v", companyID, resourceType, resourceID, actorUserID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_check_effective_access")
		return domain.EffectiveAccessFlags{}, actorUserID, false
	}
	canAdmin, err := s.repo.UserHasEffectiveAccess(companyID, actorUserID, resourceType, resourceID, store.EntityPermissionAdmin)
	if err != nil {
		log.Printf("failed to check v2 root admin access company_id=%s resource_type=%s resource_id=%s user_id=%s: %v", companyID, resourceType, resourceID, actorUserID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_check_effective_access")
		return domain.EffectiveAccessFlags{}, actorUserID, false
	}
	return domain.EffectiveAccessFlags{
		CanView:  canView,
		CanEdit:  canEdit,
		CanAdmin: canAdmin,
	}, actorUserID, true
}
