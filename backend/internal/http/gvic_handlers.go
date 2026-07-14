package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type resourceGVICAssignmentsRequest struct {
	CompanyID          string                              `json:"company_id"`
	GVICAssignments    []store.ResourceGVICAssignmentInput `json:"gvic_assignments"`
	IdempotencyKey     string                              `json:"idempotency_key"`
	ApplyToDescendants bool                                `json:"apply_to_descendants"`
}

func (s *Server) handleResourceSubresource(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/resources/")
	parts := strings.Split(trimmed, "/")
	if len(parts) >= 3 && strings.TrimSpace(parts[0]) != "" && strings.TrimSpace(parts[1]) != "" && parts[2] == "attachments" {
		resourceType := store.NormalizeAttachmentResourceType(parts[0])
		if resourceType == "" {
			writeError(w, http.StatusBadRequest, "invalid_resource_type")
			return
		}
		resourceID := strings.TrimSpace(parts[1])
		if resourceID == "" {
			writeError(w, http.StatusBadRequest, "resource_id_required")
			return
		}
		s.handleResourceAttachments(w, r, resourceType, resourceID, parts)
		return
	}
	if len(parts) < 3 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" || parts[2] != "gvic" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	resourceType, ok := store.NormalizeGVICResourceType(parts[0])
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_resource_type")
		return
	}
	resourceID := strings.TrimSpace(parts[1])
	if resourceID == "" {
		writeError(w, http.StatusBadRequest, "resource_id_required")
		return
	}

	if len(parts) == 3 {
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
			assignments, err := s.repo.ListResourceGVICAssignments(companyID, resourceType, resourceID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "resource_not_found")
				return
			}
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusBadRequest, "invalid_gvic_resource")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_load_gvic")
				return
			}
			payload := map[string]any{"company_id": companyID, "resource_type": resourceType, "resource_id": resourceID, "gvic_assignments": assignments}
			writeJSON(w, http.StatusOK, payload)
			return
		case http.MethodPut:
			req, ok := decodeGVICAssignmentsRequest(w, r)
			if !ok {
				return
			}
			if !s.requireEntityEdit(w, r, req.CompanyID, resourceType, resourceID, "resource_not_found") {
				return
			}
			actorUserID := ""
			if actor, ok := authenticatedActor(r); ok {
				actorUserID = strings.TrimSpace(actor.User.UserID)
			}
			result, err := s.repo.SetResourceGVICAssignments(store.ResourceGVICAssignmentUpdateInput{
				CompanyID:          req.CompanyID,
				ResourceType:       resourceType,
				ResourceID:         resourceID,
				Assignments:        req.GVICAssignments,
				ActorUserID:        actorUserID,
				IdempotencyKey:     req.IdempotencyKey,
				ApplyToDescendants: req.ApplyToDescendants,
			})
			writeGVICMutationResult(w, err, result)
			return
		default:
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
	}

	if len(parts) == 4 && parts[3] == "effective" && r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if companyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if !s.requireEntityView(w, r, companyID, resourceType, resourceID, "resource_not_found") {
			return
		}
		assignments, err := s.repo.ListResourceGVICEffectiveAssignments(companyID, resourceType, resourceID)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "resource_not_found")
			return
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_gvic_resource")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_effective_gvic")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"company_id": companyID, "resource_type": resourceType, "resource_id": resourceID, "effective_assignments": assignments})
		return
	}

	if len(parts) == 4 && (parts[3] == "add" || parts[3] == "remove") && r.Method == http.MethodPost {
		req, ok := decodeGVICAssignmentsRequest(w, r)
		if !ok {
			return
		}
		if !s.requireEntityEdit(w, r, req.CompanyID, resourceType, resourceID, "resource_not_found") {
			return
		}
		actorUserID := ""
		if actor, ok := authenticatedActor(r); ok {
			actorUserID = strings.TrimSpace(actor.User.UserID)
		}
		input := store.ResourceGVICAssignmentCommandInput{
			CompanyID:          req.CompanyID,
			ResourceType:       resourceType,
			ResourceID:         resourceID,
			Assignments:        req.GVICAssignments,
			ActorUserID:        actorUserID,
			IdempotencyKey:     req.IdempotencyKey,
			ApplyToDescendants: req.ApplyToDescendants,
		}
		var result store.ResourceGVICAssignmentMutationResult
		var err error
		if parts[3] == "add" {
			result, err = s.repo.AddResourceGVICAssignments(input)
		} else {
			result, err = s.repo.RemoveResourceGVICAssignments(input)
		}
		writeGVICMutationResult(w, err, result)
		return
	}

	writeError(w, http.StatusNotFound, "not_found")
}

func decodeGVICAssignmentsRequest(w http.ResponseWriter, r *http.Request) (resourceGVICAssignmentsRequest, bool) {
	var req resourceGVICAssignmentsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return resourceGVICAssignmentsRequest{}, false
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.CompanyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return resourceGVICAssignmentsRequest{}, false
	}
	return req, true
}

func writeGVICMutationResult(w http.ResponseWriter, err error, result store.ResourceGVICAssignmentMutationResult) {
	if errors.Is(err, store.ErrProtectedEmailCollaborationResource) {
		writeError(w, http.StatusConflict, "email_collaboration_node_managed")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "resource_not_found")
		return
	}
	if errors.Is(err, store.ErrGVICInherited) {
		writeError(w, http.StatusConflict, "gvic_inherited_from_logic_gate")
		return
	}
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_gvic_assignments")
		return
	}
	if errors.Is(err, store.ErrPrincipalNotInCompany) {
		writeError(w, http.StatusBadRequest, "gvic_principal_not_in_company")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_update_gvic")
		return
	}
	writeJSON(w, http.StatusOK, result)
}
