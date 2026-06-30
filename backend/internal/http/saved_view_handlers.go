package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type savedViewRequest struct {
	CompanyID   string                     `json:"company_id"`
	SavedViewID string                     `json:"saved_view_id"`
	Surface     string                     `json:"surface"`
	Principal   string                     `json:"principal"`
	PrincipalID string                     `json:"principal_id"`
	Name        string                     `json:"name"`
	Groupings   []domain.SavedViewGrouping `json:"groupings"`
	Settings    domain.SavedViewSettings   `json:"settings"`
	Position    int                        `json:"position"`
}

type savedViewPreferenceRequest struct {
	CompanyID           string `json:"company_id"`
	Surface             string `json:"surface"`
	SelectedSavedViewID string `json:"selected_saved_view_id"`
}

func (s *Server) handleSavedViews(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/saved-views" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleSavedViewsList(w, r)
	case http.MethodPost:
		s.handleSavedViewsCreate(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleSavedViewPreferences(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/saved-view-preferences" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleSavedViewPreferenceGet(w, r)
	case http.MethodPut:
		s.handleSavedViewPreferencePut(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleSavedViewByID(w http.ResponseWriter, r *http.Request) {
	savedViewID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/saved-views/"), "/")
	if savedViewID == "" || strings.Contains(savedViewID, "/") {
		writeError(w, http.StatusNotFound, "saved_view_not_found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		s.handleSavedViewUpsert(w, r, savedViewID)
	case http.MethodDelete:
		s.handleSavedViewDelete(w, r, savedViewID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleSavedViewsList(w http.ResponseWriter, r *http.Request) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	surface := strings.TrimSpace(r.URL.Query().Get("surface"))
	actor, ok := s.requireSavedViewCompanyAccess(w, r, companyID)
	if !ok {
		return
	}
	items, err := s.repo.ListSavedViews(store.SavedViewListInput{
		CompanyID:    companyID,
		ViewerUserID: actor.User.UserID,
		Surface:      surface,
	})
	if err != nil {
		writeSavedViewStoreError(w, err, "failed_to_list_saved_views")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"saved_views": items})
}

func (s *Server) handleSavedViewPreferenceGet(w http.ResponseWriter, r *http.Request) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	surface := strings.TrimSpace(r.URL.Query().Get("surface"))
	actor, ok := s.requireSavedViewCompanyAccess(w, r, companyID)
	if !ok {
		return
	}
	item, err := s.repo.GetSavedViewPreference(store.SavedViewPreferenceInput{
		CompanyID: companyID,
		Surface:   surface,
		UserID:    actor.User.UserID,
	})
	if err != nil {
		writeSavedViewStoreError(w, err, "failed_to_read_saved_view_preference")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, item)
}

func (s *Server) handleSavedViewPreferencePut(w http.ResponseWriter, r *http.Request) {
	var req savedViewPreferenceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	actor, ok := s.requireSavedViewCompanyAccess(w, r, req.CompanyID)
	if !ok {
		return
	}
	item, err := s.repo.UpsertSavedViewPreference(store.SavedViewPreferenceInput{
		CompanyID:           req.CompanyID,
		Surface:             req.Surface,
		UserID:              actor.User.UserID,
		SelectedSavedViewID: req.SelectedSavedViewID,
	})
	if err != nil {
		writeSavedViewStoreError(w, err, "failed_to_save_saved_view_preference")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleSavedViewsCreate(w http.ResponseWriter, r *http.Request) {
	var req savedViewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	actor, ok := s.requireSavedViewCompanyAccess(w, r, req.CompanyID)
	if !ok {
		return
	}
	if !s.authorizeSavedViewPrincipal(w, actor, req.CompanyID, req.Principal, req.PrincipalID) {
		return
	}
	item, err := s.repo.UpsertSavedView(store.SavedViewInput{
		CompanyID:   req.CompanyID,
		SavedViewID: req.SavedViewID,
		Surface:     req.Surface,
		Principal:   req.Principal,
		PrincipalID: req.PrincipalID,
		Name:        req.Name,
		Groupings:   req.Groupings,
		Settings:    req.Settings,
		Position:    req.Position,
	})
	if err != nil {
		writeSavedViewStoreError(w, err, "failed_to_save_saved_view")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleSavedViewUpsert(w http.ResponseWriter, r *http.Request, savedViewID string) {
	var req savedViewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	actor, ok := s.requireSavedViewCompanyAccess(w, r, req.CompanyID)
	if !ok {
		return
	}
	existing, err := s.repo.GetSavedView(req.CompanyID, savedViewID)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeSavedViewStoreError(w, err, "failed_to_read_saved_view")
		return
	}
	if err == nil && !s.authorizeSavedViewPrincipal(w, actor, existing.CompanyID, existing.Principal, existing.PrincipalID) {
		return
	}
	if !s.authorizeSavedViewPrincipal(w, actor, req.CompanyID, req.Principal, req.PrincipalID) {
		return
	}
	item, err := s.repo.UpsertSavedView(store.SavedViewInput{
		CompanyID:   req.CompanyID,
		SavedViewID: savedViewID,
		Surface:     req.Surface,
		Principal:   req.Principal,
		PrincipalID: req.PrincipalID,
		Name:        req.Name,
		Groupings:   req.Groupings,
		Settings:    req.Settings,
		Position:    req.Position,
	})
	if err != nil {
		writeSavedViewStoreError(w, err, "failed_to_save_saved_view")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleSavedViewDelete(w http.ResponseWriter, r *http.Request, savedViewID string) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	actor, ok := s.requireSavedViewCompanyAccess(w, r, companyID)
	if !ok {
		return
	}
	existing, err := s.repo.GetSavedView(companyID, savedViewID)
	if err != nil {
		writeSavedViewStoreError(w, err, "failed_to_read_saved_view")
		return
	}
	if !s.authorizeSavedViewPrincipal(w, actor, existing.CompanyID, existing.Principal, existing.PrincipalID) {
		return
	}
	if err := s.repo.DeleteSavedView(store.SavedViewDeleteInput{CompanyID: companyID, SavedViewID: savedViewID}); err != nil {
		writeSavedViewStoreError(w, err, "failed_to_delete_saved_view")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s *Server) requireSavedViewCompanyAccess(w http.ResponseWriter, r *http.Request, companyID string) (ActorContext, bool) {
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

func (s *Server) authorizeSavedViewPrincipal(w http.ResponseWriter, actor ActorContext, companyID, principal, principalID string) bool {
	companyID = strings.TrimSpace(companyID)
	principal, ok := store.NormalizeSavedViewPrincipal(principal)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_saved_view_principal")
		return false
	}
	principalID = strings.TrimSpace(principalID)
	if principalID == "" {
		writeError(w, http.StatusBadRequest, "invalid_saved_view_principal")
		return false
	}
	if principal == store.SavedViewPrincipalUser {
		if principalID != actor.User.UserID {
			writeError(w, http.StatusForbidden, "saved_view_principal_denied")
			return false
		}
		return true
	}
	if !s.savedViewGroupExists(w, companyID, principalID) {
		return false
	}
	if actorCanManageCompany(actor, companyID) {
		return true
	}
	members, err := s.repo.ListCompanyUserGroupMembers(companyID)
	if err != nil {
		log.Printf("failed_to_list_saved_view_group_members company_id=%s group_id=%s user_id=%s err=%v", companyID, principalID, actor.User.UserID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_check_saved_view_principal")
		return false
	}
	for _, member := range members {
		if member.GroupID == principalID && member.UserID == actor.User.UserID {
			return true
		}
	}
	writeError(w, http.StatusForbidden, "saved_view_principal_denied")
	return false
}

func (s *Server) savedViewGroupExists(w http.ResponseWriter, companyID, groupID string) bool {
	groups, err := s.repo.ListCompanyUserGroups(companyID)
	if err != nil {
		log.Printf("failed_to_list_saved_view_groups company_id=%s group_id=%s err=%v", companyID, groupID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_check_saved_view_principal")
		return false
	}
	for _, group := range groups {
		if group.GroupID == groupID {
			return true
		}
	}
	writeError(w, http.StatusBadRequest, "invalid_saved_view_principal")
	return false
}

func writeSavedViewStoreError(w http.ResponseWriter, err error, fallback string) {
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_saved_view")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "saved_view_not_found")
		return
	}
	writeError(w, http.StatusInternalServerError, fallback)
}
