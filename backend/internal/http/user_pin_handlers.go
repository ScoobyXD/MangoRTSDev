package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type userPinRequest struct {
	CompanyID    string `json:"company_id"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
}

type userPinOrderRequest struct {
	CompanyID string   `json:"company_id"`
	PinIDs    []string `json:"pin_ids"`
}

func (s *Server) handleUserPins(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/user-pins" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleUserPinsList(w, r)
	case http.MethodPost:
		s.handleUserPinsCreate(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleUserPinByID(w http.ResponseWriter, r *http.Request) {
	pinID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/user-pins/"), "/")
	if pinID == "" || strings.Contains(pinID, "/") {
		writeError(w, http.StatusNotFound, "user_pin_not_found")
		return
	}
	switch r.Method {
	case http.MethodDelete:
		s.handleUserPinDelete(w, r, pinID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleUserPinsList(w http.ResponseWriter, r *http.Request) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	actor, ok := s.requireUserPinCompanyAccess(w, r, companyID)
	if !ok {
		return
	}
	items, err := s.repo.ListUserPins(store.UserPinListInput{
		CompanyID: companyID,
		UserID:    actor.User.UserID,
	})
	if err != nil {
		writeUserPinStoreError(w, err, "failed_to_list_user_pins")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"user_pins": items})
}

func (s *Server) handleUserPinsCreate(w http.ResponseWriter, r *http.Request) {
	var req userPinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID := strings.TrimSpace(req.CompanyID)
	actor, ok := s.requireUserPinCompanyAccess(w, r, companyID)
	if !ok {
		return
	}
	resourceType, ok := store.NormalizeUserPinResourceType(req.ResourceType)
	resourceID := strings.ToLower(strings.TrimSpace(req.ResourceID))
	if !ok || !isUUIDText(resourceID) {
		writeError(w, http.StatusBadRequest, "invalid_user_pin")
		return
	}
	name, ok := s.resolveUserPinResourceName(w, companyID, resourceType, resourceID)
	if !ok {
		return
	}
	if name == "" {
		name = resourceID
	}
	if !s.authorizeUserPinResourceView(w, actor, companyID, resourceType, resourceID) {
		return
	}
	item, err := s.repo.UpsertUserPin(store.UserPinInput{
		CompanyID:    companyID,
		UserID:       actor.User.UserID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Name:         name,
	})
	if err != nil {
		writeUserPinStoreError(w, err, "failed_to_save_user_pin")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUserPinDelete(w http.ResponseWriter, r *http.Request, pinID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	actor, ok := s.requireUserPinCompanyAccess(w, r, companyID)
	if !ok {
		return
	}
	if err := s.repo.DeleteUserPin(store.UserPinDeleteInput{CompanyID: companyID, UserID: actor.User.UserID, PinID: pinID}); err != nil {
		writeUserPinStoreError(w, err, "failed_to_delete_user_pin")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s *Server) handleUserPinsOrder(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/user-pins/order" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req userPinOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID := strings.TrimSpace(req.CompanyID)
	actor, ok := s.requireUserPinCompanyAccess(w, r, companyID)
	if !ok {
		return
	}
	if err := s.repo.ReorderUserPins(store.UserPinReorderInput{CompanyID: companyID, UserID: actor.User.UserID, PinIDs: req.PinIDs}); err != nil {
		writeUserPinStoreError(w, err, "failed_to_reorder_user_pins")
		return
	}
	items, err := s.repo.ListUserPins(store.UserPinListInput{CompanyID: companyID, UserID: actor.User.UserID})
	if err != nil {
		writeUserPinStoreError(w, err, "failed_to_list_user_pins")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user_pins": items})
}

func (s *Server) requireUserPinCompanyAccess(w http.ResponseWriter, r *http.Request, companyID string) (ActorContext, bool) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return ActorContext{}, false
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return ActorContext{}, false
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return ActorContext{}, false
	}
	return actor, true
}

func (s *Server) resolveUserPinResourceName(w http.ResponseWriter, companyID, resourceType, resourceID string) (string, bool) {
	switch resourceType {
	case store.EntityTypeNode:
		node, err := s.repo.GetNode(companyID, resourceID)
		if err != nil {
			writeUserPinResourceReadError(w, err)
			return "", false
		}
		return strings.TrimSpace(node.Title), true
	case store.EntityTypeLogicGate:
		logicGate, err := s.repo.GetLogicGate(companyID, resourceID)
		if err != nil {
			writeUserPinResourceReadError(w, err)
			return "", false
		}
		return strings.TrimSpace(logicGate.Header), true
	case store.EntityTypeProject:
		project, err := s.repo.GetProject(companyID, resourceID)
		if err != nil {
			writeUserPinResourceReadError(w, err)
			return "", false
		}
		return strings.TrimSpace(project.Name), true
	default:
		writeError(w, http.StatusBadRequest, "invalid_user_pin")
		return "", false
	}
}

func (s *Server) authorizeUserPinResourceView(w http.ResponseWriter, actor ActorContext, companyID, resourceType, resourceID string) bool {
	if actorCanManageCompany(actor, companyID) {
		return true
	}
	allowed, err := s.repo.UserHasEffectiveAccess(companyID, actor.User.UserID, resourceType, resourceID, store.EntityPermissionEdit)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_entity_permission_check")
		return false
	}
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return false
	}
	if err != nil {
		log.Printf("failed_to_check_user_pin_resource_access company_id=%s user_id=%s resource_type=%s resource_id=%s err=%v", companyID, actor.User.UserID, resourceType, resourceID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_check_entity_permission")
		return false
	}
	if !allowed {
		writeAccessResourceNotFound(w)
		return false
	}
	return true
}

func writeUserPinResourceReadError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_user_pin")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return
	}
	writeError(w, http.StatusInternalServerError, "failed_to_read_user_pin_resource")
}

func writeUserPinStoreError(w http.ResponseWriter, err error, fallback string) {
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_user_pin")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "user_pin_not_found")
		return
	}
	writeError(w, http.StatusInternalServerError, fallback)
}

func isUUIDText(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, char := range value {
		switch index {
		case 8, 13, 18, 23:
			if char != '-' {
				return false
			}
		default:
			if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
				return false
			}
		}
	}
	return true
}
