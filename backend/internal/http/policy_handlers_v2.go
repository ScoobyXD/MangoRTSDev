package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
)

type v2RACIPolicyRequest struct {
	CompanyID        string                               `json:"company_id"`
	AssignmentMode   string                               `json:"assignment_mode"`
	RACIAssignments  *[]store.ResourceRACIAssignmentInput `json:"gvic_assignments"`
	DescendantAction string                               `json:"descendant_action"`
	IdempotencyKey   string                               `json:"idempotency_key"`
}

type v2PermissionPolicyRequest struct {
	CompanyID        string                        `json:"company_id"`
	PermissionMode   string                        `json:"permission_mode"`
	DefaultAccess    *string                       `json:"default_access"`
	Permissions      []store.EntityPermissionInput `json:"permissions"`
	DescendantAction string                        `json:"descendant_action"`
	IdempotencyKey   string                        `json:"idempotency_key"`
}

type v2PermissionPolicyResponse struct {
	store.ResourcePermissionPolicy
	CanEditPermissions        bool `json:"can_edit_permissions"`
	CanEditManagerPermissions bool `json:"can_edit_manager_permissions"`
}

func policyETag(revision string) string {

	revision = strings.Trim(strings.TrimSpace(revision), "\"")
	if revision == "" {
		return ""
	}
	return `"` + revision + `"`
}

func policyIdempotencyKey(r *http.Request, bodyValue string) string {
	if value := strings.TrimSpace(r.Header.Get("Idempotency-Key")); value != "" {
		return value
	}
	return strings.TrimSpace(bodyValue)
}

func (s *Server) handleResourceSubresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/resources/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) >= 3 && strings.TrimSpace(parts[0]) != "" && strings.TrimSpace(parts[1]) != "" && parts[2] == "attachments" {
		resourceType := store.NormalizeAttachmentResourceType(parts[0])
		if resourceType == "" {
			writeError(w, http.StatusBadRequest, "invalid_resource_type")
			return
		}
		s.handleResourceAttachments(w, r, resourceType, strings.TrimSpace(parts[1]), parts)
		return
	}
	if len(parts) == 3 && parts[2] == "permissions" {
		resourceType, ok := store.NormalizeEntityType(parts[0])
		resourceID := strings.TrimSpace(parts[1])
		if !ok || resourceID == "" {
			writeError(w, http.StatusBadRequest, "invalid_resource_type")
			return
		}
		s.handleEntityPermissions(w, r, resourceType, resourceID, "resource_not_found", "")
		return
	}
	if len(parts) != 3 || parts[2] != "gvic" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	resourceType, ok := store.NormalizeRACIResourceType(parts[0])
	resourceID := strings.TrimSpace(parts[1])
	if !ok || resourceID == "" {
		writeError(w, http.StatusBadRequest, "invalid_resource_type")
		return
	}
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireEntityView(w, r, companyID, resourceType, resourceID, "resource_not_found") {
			return
		}
		policy, err := s.repo.GetResourceRACIPolicy(companyID, resourceType, resourceID)
		if writeV2PolicyError(w, err, "failed_to_load_gvic_policy") {
			return
		}
		writeJSONWithPrecomputedETag(w, r, http.StatusOK, policy, policyETag(policy.Revision))
	case http.MethodPut:
		var req v2RACIPolicyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		if req.CompanyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireEntityEdit(w, r, req.CompanyID, resourceType, resourceID, "resource_not_found") {
			return
		}
		actorUserID := ""
		if actor, ok := authenticatedActor(r); ok {
			actorUserID = strings.TrimSpace(actor.User.UserID)
		}
		var assignments []store.ResourceRACIAssignmentInput
		if req.RACIAssignments != nil {
			assignments = *req.RACIAssignments
		}
		policy, events, err := s.repo.PutResourceRACIPolicy(store.ResourceRACIPolicyUpdateInput{
			CompanyID: req.CompanyID, ResourceType: resourceType, ResourceID: resourceID,
			AssignmentMode: req.AssignmentMode, Assignments: assignments, DescendantAction: req.DescendantAction,
			ExpectedRevision: r.Header.Get("If-Match"), ActorUserID: actorUserID,
			IdempotencyKey: policyIdempotencyKey(r, req.IdempotencyKey),
		})
		if err != nil {
			log.Printf("failed to update v2 gvic policy company_id=%s resource_type=%s resource_id=%s: %v", req.CompanyID, resourceType, resourceID, err)
		}
		if writeV2PolicyError(w, err, "failed_to_update_gvic_policy") {
			return
		}
		s.projectCommittedNotificationEvents(events)
		writeJSONWithPrecomputedETag(w, r, http.StatusOK, policy, policyETag(policy.Revision))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleEntityPermissions(w http.ResponseWriter, r *http.Request, entityType, entityID, notFoundCode, _ string) {
	entityType, ok := store.NormalizeEntityType(entityType)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_resource_type")
		return
	}
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireEntityView(w, r, companyID, entityType, entityID, notFoundCode) {
			return
		}
		actor, authenticated := authenticatedActor(r)
		if !authenticated {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if !actorCanManageCompanyUsers(actor, companyID) {
			writeError(w, http.StatusForbidden, "company_manager_required")
			return
		}
		canEdit, err := s.actorCanEditEntityPermissions(actor, companyID, entityType, entityID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_check_entity_permission")
			return
		}
		if !canEdit {
			writeAccessActionDenied(w)
			return
		}
		policy, err := s.repo.GetResourcePermissionPolicy(companyID, entityType, entityID)
		if writeV2PolicyErrorWithNotFound(w, err, "failed_to_load_permission_policy", notFoundCode) {
			return
		}
		canEditManagers := actorCanManageCompanyUsers(actor, companyID)
		response := v2PermissionPolicyResponse{
			ResourcePermissionPolicy: policy, CanEditPermissions: true,
			CanEditManagerPermissions: canEditManagers,
		}
		actorETag := policyETag(policy.Revision + ":" + strings.TrimSpace(actor.User.UserID) + ":" + strconv.FormatBool(canEditManagers))
		writeJSONWithPrecomputedETag(w, r, http.StatusOK, response, actorETag)
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req v2PermissionPolicyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if req.CompanyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	actor, authenticated := authenticatedActor(r)
	if !authenticated {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !actorCanManageCompanyUsers(actor, req.CompanyID) {
		writeError(w, http.StatusForbidden, "company_manager_required")
		return
	}
	canEdit, err := s.actorCanEditEntityPermissions(actor, req.CompanyID, entityType, entityID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_check_entity_permission")
		return
	}
	if !canEdit {
		writeAccessActionDenied(w)
		return
	}
	allowedSubjects, err := s.actorCanWritePermissionSubjects(actor, req.CompanyID, req.Permissions)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_validate_permission_policy")
		return
	}
	if !allowedSubjects {
		writeError(w, http.StatusForbidden, "company_admin_required")
		return
	}
	policy, events, err := s.repo.PutResourcePermissionPolicy(store.ResourcePermissionPolicyUpdateInput{
		CompanyID: req.CompanyID, ResourceType: entityType, ResourceID: entityID,
		PermissionMode: req.PermissionMode, DefaultAccess: req.DefaultAccess, Permissions: req.Permissions,
		DescendantAction: req.DescendantAction, ExpectedRevision: r.Header.Get("If-Match"),
		ActorUserID: actor.User.UserID, PreserveActorEdit: actor.CompanyRole == domain.RoleCompanyManager,
		IdempotencyKey: policyIdempotencyKey(r, req.IdempotencyKey),
	})
	if err != nil {
		log.Printf("failed to update v2 permission policy company_id=%s resource_type=%s resource_id=%s: %v", req.CompanyID, entityType, entityID, err)
	}
	if writeV2PolicyErrorWithNotFound(w, err, "failed_to_update_permission_policy", notFoundCode) {
		return
	}
	s.projectCommittedNotificationEvents(events)
	canEditManagers := actorCanManageCompanyUsers(actor, req.CompanyID)
	response := v2PermissionPolicyResponse{
		ResourcePermissionPolicy: policy, CanEditPermissions: true,
		CanEditManagerPermissions: canEditManagers,
	}
	actorETag := policyETag(policy.Revision + ":" + strings.TrimSpace(actor.User.UserID) + ":" + strconv.FormatBool(canEditManagers))
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, response, actorETag)
}

func writeV2PolicyError(w http.ResponseWriter, err error, failureCode string) bool {
	return writeV2PolicyErrorWithNotFound(w, err, failureCode, "resource_not_found")
}

func writeV2PolicyErrorWithNotFound(w http.ResponseWriter, err error, failureCode, notFoundCode string) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, notFoundCode)
	case errors.Is(err, store.ErrVersionConflict):
		writeError(w, http.StatusConflict, "policy_revision_conflict")
	case errors.Is(err, store.ErrPrincipalNotInCompany):
		writeError(w, http.StatusBadRequest, "policy_principal_not_in_company")
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_policy")
	default:
		writeError(w, http.StatusInternalServerError, failureCode)
	}
	return true
}

func (s *Server) actorCanWritePermissionSubjects(actor ActorContext, companyID string, permissions []store.EntityPermissionInput) (bool, error) {
	if actorCanManageCompany(actor, companyID) {
		return true, nil
	}
	users, err := s.repo.ListCompanyUsers(companyID)
	if err != nil {
		return false, err
	}
	roles := make(map[string]string, len(users))
	for _, user := range users {
		roles[strings.TrimSpace(user.UserID)] = domain.NormalizeRole(user.Role)
	}
	for _, permission := range permissions {
		subjectType, ok := store.NormalizeEntityPermissionSubjectType(permission.SubjectType)
		if !ok {
			continue
		}
		if subjectType == store.EntityPermissionSubjectGroup {
			continue
		}
		role, exists := roles[strings.TrimSpace(permission.SubjectID)]
		if !exists {
			continue
		}
		if domain.CanBypassResourcePermissions(role) {
			return false, nil
		}
	}
	return true, nil
}
