package httpapi

import (
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
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
	etag, err := s.nodeViewETag(companyID, nodeID, actorUserID, flags)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "node_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_read_node_view_version")
		return
	}
	if writeNotModifiedWithETag(w, r, etag) {
		return
	}
	view, err := s.repo.GetNodeView(store.NodeViewInput{CompanyID: companyID,
		NodeID: nodeID,
		UserID: actorUserID,
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
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, view, etag)
}

func (s *Server) nodeViewETag(companyID, nodeID, actorUserID string, flags domain.EffectiveAccessFlags) (string, error) {
	version, err := s.repo.CurrentNodeViewVersion(companyID, nodeID, actorUserID)
	if err != nil {
		return "", err
	}
	fingerprints, err := s.repo.ResourcePolicyFingerprints(companyID, store.EntityTypeNode, nodeID, actorUserID)
	if err != nil {
		return "", err
	}
	permissionKey := strconv.FormatBool(flags.CanEdit)
	return strongETagFromString(
		"node-view:v1:" + strings.TrimSpace(companyID) + ":" + strings.TrimSpace(nodeID) + ":" +
			strings.TrimSpace(actorUserID) + ":" + permissionKey + ":" +
			fingerprints.RACI + ":" + fingerprints.Permission + ":" +
			strconv.FormatInt(version.Shared, 10) + ":" + strconv.FormatInt(version.User, 10),
	), nil
}
func (s *Server) handleLogicGateViewV2(w http.ResponseWriter, r *http.Request, logicGateID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	flags, actorUserID, ok := s.requireV2RootEffectiveAccess(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found")
	if !ok {
		return
	}
	etag, err := s.consolidatedViewETag(r, companyID, "logic-gate-view:"+logicGateID, store.EntityTypeLogicGate, logicGateID, actorUserID)
	includeWork := strings.TrimSpace(r.URL.Query().Get("include_work")) == "1"
	if err == nil && includeWork {
		var workETag string
		workETag, err = s.logicGateWorkETag(r, companyID, logicGateID, actorUserID, flags)
		etag = strongETagFromString(etag + ":" + workETag)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_read_logic_gate_view_version")
		return
	}
	if writeNotModifiedWithETag(w, r, etag) {
		return
	}
	if includeWork {
		view, err := s.repo.GetLogicGateView(companyID, logicGateID, actorUserID)
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
		view.Work.Permissions.CanEdit = flags.CanEdit
		response := logicGateViewResponseWithWork(view)
		writeJSONWithPrecomputedETag(w, r, http.StatusOK, response, etag)
		return
	}
	details, err := s.repo.GetLogicGateDetails(companyID, logicGateID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_logic_gate_view_request")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "logic_gate_not_found")
		return
	}
	if err != nil {
		log.Printf("failed to load v2 logic gate details company_id=%s logic_gate_id=%s: %v", companyID, logicGateID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_view")
		return
	}
	projections, err := s.repo.ListLogicGateProjections(companyID, logicGateID)
	if err != nil {
		log.Printf("failed to load v2 logic gate projections company_id=%s logic_gate_id=%s: %v", companyID, logicGateID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_load_logic_gate_view")
		return
	}
	response := logicGateCoreViewResponse(companyID, logicGateID, details, projections, flags)
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, response, etag)
}

func (s *Server) consolidatedViewETag(r *http.Request, companyID, resource, resourceType, resourceID, actorUserID string) (string, error) {
	fingerprints, err := s.repo.ResourcePolicyFingerprints(companyID, resourceType, resourceID, actorUserID)
	if err != nil {
		return "", err
	}
	return s.workspaceEventETagWithReadVersion(r, companyID, resource+":"+fingerprints.RACI+":"+fingerprints.Permission, []store.DomainEventStreamQuery{{}}, store.WorkspaceReadVersionQuery{
		CompanyID: companyID,
		Scope:     "workspace-snapshot:full",
	})
}

type logicGateViewHTTPResponse struct {
	CompanyID           string                           `json:"company_id"`
	LogicGateID         string                           `json:"logic_gate_id"`
	LogicGate           domain.LogicGate                 `json:"logic_gate"`
	Information         []domain.LogicGateInformation    `json:"information"`
	Projections         []domain.LogicGateProjection     `json:"projections"`
	RACIAssignments     []domain.LogicGateRACIAssignment `json:"gvic_assignments"`
	Work                *domain.LogicGateWorkView        `json:"work,omitempty"`
	InformationCount    int                              `json:"information_count"`
	ProjectionCount     int                              `json:"projection_count"`
	RACIAssignmentCount int                              `json:"gvic_assignment_count"`
	AssignmentCount     int                              `json:"assignment_count,omitempty"`
	NodeCount           int                              `json:"node_count,omitempty"`
	domain.EffectiveAccessFlags
}

func logicGateCoreViewResponse(companyID, logicGateID string, details domain.LogicGateDetails, projections []domain.LogicGateProjection, flags domain.EffectiveAccessFlags) logicGateViewHTTPResponse {
	if details.Information == nil {
		details.Information = []domain.LogicGateInformation{}
	}
	if details.LogicGate.RACIAssignments == nil {
		details.LogicGate.RACIAssignments = []domain.LogicGateRACIAssignment{}
	}
	if projections == nil {
		projections = []domain.LogicGateProjection{}
	}
	return logicGateViewHTTPResponse{
		CompanyID:            companyID,
		LogicGateID:          logicGateID,
		LogicGate:            details.LogicGate,
		Information:          details.Information,
		Projections:          projections,
		RACIAssignments:      details.LogicGate.RACIAssignments,
		InformationCount:     len(details.Information),
		ProjectionCount:      len(projections),
		RACIAssignmentCount:  len(details.LogicGate.RACIAssignments),
		EffectiveAccessFlags: flags,
	}
}

func logicGateViewResponseWithWork(view domain.LogicGateView) logicGateViewHTTPResponse {
	work := view.Work
	return logicGateViewHTTPResponse{
		CompanyID:            view.CompanyID,
		LogicGateID:          view.LogicGateID,
		LogicGate:            view.LogicGate,
		Information:          view.Information,
		Projections:          view.Projections,
		RACIAssignments:      view.RACIAssignments,
		Work:                 &work,
		InformationCount:     view.InformationCount,
		ProjectionCount:      view.ProjectionCount,
		RACIAssignmentCount:  view.RACIAssignmentCount,
		AssignmentCount:      view.AssignmentCount,
		NodeCount:            view.NodeCount,
		EffectiveAccessFlags: view.EffectiveAccessFlags,
	}
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
			return domain.EffectiveAccessFlags{CanEdit: true}, "", true
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
		return domain.EffectiveAccessFlags{CanEdit: true}, actorUserID, true
	}
	canEdit, err := s.repo.UserHasEffectiveAccess(companyID, actorUserID, resourceType, resourceID, store.EntityPermissionEdit)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_effective_access_check")
		return domain.EffectiveAccessFlags{}, actorUserID, false
	}
	if err != nil {
		log.Printf("failed to check v2 root edit access company_id=%s resource_type=%s resource_id=%s user_id=%s: %v", companyID, resourceType, resourceID, actorUserID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_check_effective_access")
		return domain.EffectiveAccessFlags{}, actorUserID, false
	}
	if !canEdit {
		writeAccessResourceNotFound(w)
		return domain.EffectiveAccessFlags{}, actorUserID, false
	}
	return domain.EffectiveAccessFlags{CanEdit: true}, actorUserID, true
}
