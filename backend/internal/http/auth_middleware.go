package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type authClaimsContextKey struct{}
type actorContextKey struct{}

type ActorContext struct {
	Claims      auth.Claims                `json:"-"`
	User        domain.User                `json:"user"`
	Memberships []domain.CompanyMembership `json:"memberships"`
	CompanyID   string                     `json:"company_id,omitempty"`
	CompanyRole string                     `json:"company_role,omitempty"`
	IsDevAdmin  bool                       `json:"is_dev_admin"`
}

func (s *Server) withAuth(next http.Handler) http.Handler {
	if s.authValidator == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/v1/") {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		claims, err := s.authValidator.Validate(r.Context(), bearerToken(r.Header.Get("Authorization")))
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		user, err := s.repo.UpsertAuthUser(claims.Subject, claims.Email, claims.Name)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_record_authenticated_user")
			return
		}
		memberships, err := s.repo.ListUserMemberships(user.UserID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_memberships")
			return
		}
		actor := ActorContext{
			Claims:      claims,
			User:        user,
			Memberships: normalizeMembershipRoles(memberships),
		}
		for _, membership := range actor.Memberships {
			if membership.Role == domain.RoleDevAdmin {
				actor.IsDevAdmin = true
				break
			}
		}

		companyID, err := requestCompanyID(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_company_id_payload")
			return
		}
		if companyID != "" {
			role := actorRoleForCompany(actor, companyID)
			if !actor.IsDevAdmin && role == "" {
				writeError(w, http.StatusForbidden, "company_access_denied")
				return
			}
			actor.CompanyID = companyID
			actor.CompanyRole = role
			if !s.authorizeCompanyRequest(w, r, actor, companyID, role) {
				return
			}
		}

		ctx := context.WithValue(r.Context(), authClaimsContextKey{}, claims)
		ctx = context.WithValue(ctx, actorContextKey{}, actor)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func bearerToken(header string) string {
	header = strings.TrimSpace(header)
	if header == "" {
		return ""
	}
	prefix := "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}

func requestCompanyID(r *http.Request) (string, error) {
	if r.Body == nil || (r.Method != http.MethodPost && r.Method != http.MethodPut && r.Method != http.MethodPatch) {
		return strings.TrimSpace(r.URL.Query().Get("company_id")), nil
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return "", err
	}
	_ = r.Body.Close()
	r.Body = io.NopCloser(bytes.NewReader(body))
	if len(bytes.TrimSpace(body)) == 0 {
		return "", nil
	}
	var payload struct {
		CompanyID string `json:"company_id"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", err
	}
	if value := strings.TrimSpace(payload.CompanyID); value != "" {
		return value, nil
	}
	return strings.TrimSpace(r.URL.Query().Get("company_id")), nil
}

func authenticatedClaims(r *http.Request) (auth.Claims, bool) {
	claims, ok := r.Context().Value(authClaimsContextKey{}).(auth.Claims)
	return claims, ok
}

func authenticatedActor(r *http.Request) (ActorContext, bool) {
	actor, ok := r.Context().Value(actorContextKey{}).(ActorContext)
	return actor, ok
}

func normalizeMembershipRoles(memberships []domain.CompanyMembership) []domain.CompanyMembership {
	normalized := make([]domain.CompanyMembership, 0, len(memberships))
	for _, membership := range memberships {
		role := domain.NormalizeRole(membership.Role)
		if role == "" {
			role = domain.RoleCompanyUser
		}
		membership.Role = role
		normalized = append(normalized, membership)
	}
	return normalized
}

func actorRoleForCompany(actor ActorContext, companyID string) string {
	companyID = strings.TrimSpace(companyID)
	for _, membership := range actor.Memberships {
		if membership.CompanyID == companyID {
			return membership.Role
		}
	}
	if actor.IsDevAdmin {
		return domain.RoleDevAdmin
	}
	return ""
}

func (s *Server) authorizeCompanyRequest(w http.ResponseWriter, r *http.Request, actor ActorContext, companyID, role string) bool {
	if actor.IsDevAdmin || role == domain.RoleCompanyAdmin {
		return true
	}
	if role == domain.RoleCompanyViewer {
		if r.Method == http.MethodGet {
			return true
		}
		writeError(w, http.StatusForbidden, "company_read_only")
		return false
	}
	if role != domain.RoleCompanyUser {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return false
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusForbidden, "company_user_write_denied")
		return false
	}
	resourceType, resourceID := companyResourceFromRequest(r)
	if resourceType == "" || resourceID == "" {
		return true
	}
	ok, err := s.repo.UserHasResourceAssignment(companyID, actor.User.UserID, resourceType, resourceID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusForbidden, "resource_assignment_required")
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_check_resource_assignment")
		return false
	}
	if !ok {
		writeError(w, http.StatusForbidden, "resource_assignment_required")
		return false
	}
	return true
}

func companyResourceFromRequest(r *http.Request) (string, string) {
	path := strings.TrimSpace(r.URL.Path)
	if id := pathID(path, "/v1/nodes/"); id != "" {
		return domain.ResourceTypeNode, id
	}
	if id := pathID(path, "/v1/logic-gates/"); id != "" {
		return domain.ResourceTypeLogicGate, id
	}
	if id := pathID(path, "/v1/kanban/boards/"); id != "" {
		return domain.ResourceTypeKanbanBoard, id
	}
	if strings.HasPrefix(path, "/v1/kanban/columns") || strings.HasPrefix(path, "/v1/kanban/cards") {
		if boardID := strings.TrimSpace(r.URL.Query().Get("board_id")); boardID != "" {
			return domain.ResourceTypeKanbanBoard, boardID
		}
	}
	if id := pathID(path, "/v1/company-explorer/folders/"); id != "" {
		return domain.ResourceTypeFolder, id
	}
	if strings.HasPrefix(path, "/v1/company-explorer/folder-items") {
		if folderID := strings.TrimSpace(r.URL.Query().Get("folder_id")); folderID != "" {
			return domain.ResourceTypeFolder, folderID
		}
	}
	return "", ""
}

func pathID(path, prefix string) string {
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	trimmed := strings.Trim(strings.TrimPrefix(path, prefix), "/")
	if trimmed == "" {
		return ""
	}
	if index := strings.Index(trimmed, "/"); index >= 0 {
		return strings.TrimSpace(trimmed[:index])
	}
	return strings.TrimSpace(trimmed)
}
