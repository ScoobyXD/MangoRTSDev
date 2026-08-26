package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
)

const processMapRealtimeConnectionIDHeader = "X-Mango-Realtime-Connection-ID"
const processMapTileETagContract = "process-map-tile-v5"

func decodeProcessMapJSON(r *http.Request, destination any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func (s *Server) processMapActor(r *http.Request, companyID string) (string, string, bool, error) {
	actor, ok := authenticatedActor(r)
	if !ok {
		return "", "", false, nil
	}
	actorUserID := strings.TrimSpace(actor.User.UserID)
	role, err := s.currentActorRoleForCompanyContext(r.Context(), actor, companyID)
	return actorUserID, role, actorUserID != "" && role != "", err
}

func (s *Server) processMapETag(r *http.Request, companyID, actorUserID, actorRole, contract string) (string, error) {
	processVersion, groupVersion, err := s.repo.CurrentProcessMapVersions(r.Context(), companyID)
	if err != nil {
		return "", err
	}
	return strongETagFromString(contract + ":" + companyID + ":" + actorUserID + ":" + actorRole + ":" + r.URL.Path + "?" + r.URL.Query().Encode() + ":" + strconv.FormatInt(processVersion, 10) + ":" + strconv.FormatInt(groupVersion, 10)), nil
}

func (s *Server) authorizeProcessMapRead(w http.ResponseWriter, r *http.Request, companyID, resourceType, resourceID string) (string, string, bool) {
	actorUserID, actorRole, ok, err := s.processMapActor(r, companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_check_company_access")
		return "", "", false
	}
	if !ok {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return "", "", false
	}
	if resourceID != "" {
		allowed, err := s.repo.UserHasEffectiveAccessContext(r.Context(), companyID, actorUserID, resourceType, resourceID, store.EntityPermissionEdit)
		if errors.Is(err, store.ErrNotFound) || (err == nil && !allowed) {
			writeAccessResourceNotFound(w)
			return "", "", false
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_process_map_request")
			return "", "", false
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_check_process_map_access")
			return "", "", false
		}
	}
	return actorUserID, actorRole, true
}

func (s *Server) handleProcessMapScene(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	actorUserID, actorRole, ok := s.authorizeProcessMapRead(w, r, companyID, "", "")
	if !ok {
		return
	}
	etag, err := s.processMapETag(r, companyID, actorUserID, actorRole, "process-map-scene-v3")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_read_process_map_version")
		return
	}
	if writeNotModifiedWithETag(w, r, etag) {
		return
	}
	scene, err := s.repo.GetProcessMapScene(r.Context(), store.ProcessMapSceneQuery{CompanyID: companyID, PermissionUserID: actorUserID})
	if err != nil {
		writeProcessMapError(w, err, "failed_to_read_process_map_scene")
		return
	}
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, scene, etag)
}

func processMapTilePath(path string) (int, int, int, bool) {
	remainder := strings.Trim(strings.TrimPrefix(path, "/v1/process-map/tiles/"), "/")
	parts := strings.Split(remainder, "/")
	if len(parts) != 3 {
		return 0, 0, 0, false
	}
	values := [3]int{}
	for index, part := range parts {
		value, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil {
			return 0, 0, 0, false
		}
		values[index] = value
	}
	return values[0], values[1], values[2], true
}

func (s *Server) handleProcessMapTile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	z, x, y, ok := processMapTilePath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	actorUserID, actorRole, ok := s.authorizeProcessMapRead(w, r, companyID, "", "")
	if !ok {
		return
	}
	etag, err := s.processMapETag(r, companyID, actorUserID, actorRole, processMapTileETagContract)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_read_process_map_version")
		return
	}
	if writeNotModifiedWithETag(w, r, etag) {
		return
	}
	tile, err := s.repo.GetProcessMapTile(r.Context(), store.ProcessMapTileQuery{
		CompanyID: companyID, PermissionUserID: actorUserID, Z: z, X: x, Y: y,
	})
	if err != nil {
		writeProcessMapError(w, err, "failed_to_read_process_map_tile")
		return
	}
	writeJSONWithPrecomputedETag(w, r, http.StatusOK, tile, etag)
}

func processMapPlacementPath(path string) (string, string, bool) {
	remainder := strings.Trim(strings.TrimPrefix(path, "/v1/process-map/placements/"), "/")
	parts := strings.Split(remainder, "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", "", false
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), true
}

func (s *Server) processMapMutationActor(w http.ResponseWriter, r *http.Request, companyID string) (string, bool) {
	actorUserID, _, ok, err := s.processMapActor(r, companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_check_company_access")
		return "", false
	}
	if !ok {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return "", false
	}
	return actorUserID, true
}

func (s *Server) processMapMutationRealtimeConnectionID(r *http.Request, companyID, actorUserID string) string {
	correlation := strings.TrimSpace(r.Header.Get(processMapRealtimeConnectionIDHeader))
	if correlation == "" {
		return ""
	}
	if connectionID, ok := s.realtimeTickets.validateRealtimeConnectionCorrelation(correlation, companyID, actorUserID); ok {
		return connectionID
	}
	if s.realtimeRegistry.ownsConnection(correlation, companyID, actorUserID) {
		return correlation
	}
	return ""
}

func (s *Server) handleProcessMapPlacement(w http.ResponseWriter, r *http.Request) {
	resourceType, resourceID, ok := processMapPlacementPath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	actorUserID, ok := s.processMapMutationActor(w, r, companyID)
	if !ok {
		return
	}
	realtimeConnectionID := s.processMapMutationRealtimeConnectionID(r, companyID, actorUserID)
	switch r.Method {
	case http.MethodPut:
		var request struct {
			MapParentFolderID json.RawMessage `json:"map_parent_folder_id"`
			GridX             *int            `json:"grid_x"`
			GridY             *int            `json:"grid_y"`
			GridWidth         *int            `json:"grid_width"`
			GridHeight        *int            `json:"grid_height"`
		}
		if err := decodeProcessMapJSON(r, &request); err != nil || request.MapParentFolderID == nil ||
			request.GridX == nil || request.GridY == nil || request.GridWidth == nil || request.GridHeight == nil {
			writeError(w, http.StatusBadRequest, "invalid_process_map_placement")
			return
		}
		var parentID *string
		if strings.TrimSpace(string(request.MapParentFolderID)) != "null" {
			var value string
			if err := json.Unmarshal(request.MapParentFolderID, &value); err != nil || strings.TrimSpace(value) == "" {
				writeError(w, http.StatusBadRequest, "invalid_process_map_placement")
				return
			}
			value = strings.TrimSpace(value)
			parentID = &value
		}
		result, err := s.repo.PutProcessMapPlacement(r.Context(), store.ProcessMapPlacementPutInput{
			CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID,
			MapParentFolderID: parentID, GridX: *request.GridX, GridY: *request.GridY,
			GridWidth: *request.GridWidth, GridHeight: *request.GridHeight,
			ActorUserID: actorUserID, PermissionUserID: actorUserID, RealtimeConnectionID: realtimeConnectionID,
		})
		if err != nil {
			writeProcessMapError(w, err, "failed_to_save_process_map_placement")
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		status := http.StatusOK
		if result.Created {
			status = http.StatusCreated
		}
		writeJSON(w, status, result)
	case http.MethodDelete:
		result, err := s.repo.DeleteProcessMapPlacement(r.Context(), store.ProcessMapPlacementDeleteInput{
			CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID,
			ActorUserID: actorUserID, PermissionUserID: actorUserID, RealtimeConnectionID: realtimeConnectionID,
		})
		if err != nil {
			writeProcessMapError(w, err, "failed_to_delete_process_map_placement")
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		writeJSON(w, http.StatusOK, result)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

type processMapResourceRefRequest struct {
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
}

func routePointsFromRaw(raw json.RawMessage) ([]domain.ProcessMapRoutePoint, bool) {
	if raw == nil || strings.TrimSpace(string(raw)) == "null" {
		return nil, false
	}
	var objects []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &objects); err != nil || objects == nil || len(objects) > store.ProcessMapMaxRoutePoints {
		return nil, false
	}
	points := make([]domain.ProcessMapRoutePoint, 0, len(objects))
	for _, object := range objects {
		if len(object) != 2 || object["x"] == nil || object["y"] == nil {
			return nil, false
		}
		var point domain.ProcessMapRoutePoint
		if err := json.Unmarshal(object["x"], &point.X); err != nil {
			return nil, false
		}
		if err := json.Unmarshal(object["y"], &point.Y); err != nil {
			return nil, false
		}
		points = append(points, point)
	}
	return points, true
}

func (s *Server) handleProcessMapOperationalRelationships(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		resourceType := strings.TrimSpace(r.URL.Query().Get("resource_type"))
		resourceID := strings.TrimSpace(r.URL.Query().Get("resource_id"))
		direction := strings.TrimSpace(r.URL.Query().Get("direction"))
		if companyID == "" || resourceType == "" || resourceID == "" {
			writeError(w, http.StatusBadRequest, "company_id_resource_required")
			return
		}
		actorUserID, actorRole, ok := s.authorizeProcessMapRead(w, r, companyID, resourceType, resourceID)
		if !ok {
			return
		}
		etag, err := s.processMapETag(r, companyID, actorUserID, actorRole, "operational-relationships-v1")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_read_process_map_version")
			return
		}
		if writeNotModifiedWithETag(w, r, etag) {
			return
		}
		items, err := s.repo.ListResourceOperationalRelationshipsForResource(r.Context(), store.ResourceOperationalRelationshipQuery{
			CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, Direction: direction, PermissionUserID: actorUserID,
		})
		if err != nil {
			writeProcessMapError(w, err, "failed_to_read_operational_relationships")
			return
		}
		writeJSONWithPrecomputedETag(w, r, http.StatusOK, map[string]any{"resource_operational_relationships": items}, etag)
	case http.MethodPost:
		var request struct {
			CompanyID string                       `json:"company_id"`
			Source    processMapResourceRefRequest `json:"source"`
			Target    processMapResourceRefRequest `json:"target"`
			Trace     *struct {
				RoutePoints json.RawMessage `json:"route_points"`
			} `json:"trace"`
		}
		if err := decodeProcessMapJSON(r, &request); err != nil || strings.TrimSpace(request.CompanyID) == "" {
			writeError(w, http.StatusBadRequest, "invalid_operational_relationship")
			return
		}
		actorUserID, ok := s.processMapMutationActor(w, r, request.CompanyID)
		if !ok {
			return
		}
		realtimeConnectionID := s.processMapMutationRealtimeConnectionID(r, request.CompanyID, actorUserID)
		var trace *store.ProcessMapTraceInput
		if request.Trace != nil {
			points, ok := routePointsFromRaw(request.Trace.RoutePoints)
			if !ok {
				writeError(w, http.StatusBadRequest, "invalid_process_map_trace")
				return
			}
			trace = &store.ProcessMapTraceInput{RoutePoints: points}
		}
		result, err := s.repo.CreateResourceOperationalRelationship(r.Context(), store.ResourceOperationalRelationshipCreateInput{
			CompanyID: request.CompanyID,
			Source:    domain.ProcessMapResourceRef{ResourceType: request.Source.ResourceType, ResourceID: request.Source.ResourceID},
			Target:    domain.ProcessMapResourceRef{ResourceType: request.Target.ResourceType, ResourceID: request.Target.ResourceID},
			Trace:     trace, ActorUserID: actorUserID, PermissionUserID: actorUserID,
			RealtimeConnectionID: realtimeConnectionID,
		})
		if err != nil {
			writeProcessMapError(w, err, "failed_to_save_operational_relationship")
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		status := http.StatusOK
		if result.Created {
			status = http.StatusCreated
		}
		writeJSON(w, status, result)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleProcessMapOperationalRelationshipByID(w http.ResponseWriter, r *http.Request) {
	remainder := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/process-map/operational-relationships/"), "/")
	parts := strings.Split(remainder, "/")
	if len(parts) == 0 || len(parts) > 2 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	actorUserID, ok := s.processMapMutationActor(w, r, companyID)
	if !ok {
		return
	}
	realtimeConnectionID := s.processMapMutationRealtimeConnectionID(r, companyID, actorUserID)
	relationshipID := strings.TrimSpace(parts[0])
	if len(parts) == 2 {
		if parts[1] != "trace" || r.Method != http.MethodPut {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		var request struct {
			RoutePoints json.RawMessage `json:"route_points"`
		}
		if err := decodeProcessMapJSON(r, &request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_process_map_trace")
			return
		}
		points, ok := routePointsFromRaw(request.RoutePoints)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_process_map_trace")
			return
		}
		result, err := s.repo.PutProcessMapTrace(r.Context(), store.ProcessMapTracePutInput{
			CompanyID: companyID, ResourceOperationalRelationshipID: relationshipID, RoutePoints: points,
			ActorUserID: actorUserID, PermissionUserID: actorUserID, RealtimeConnectionID: realtimeConnectionID,
		})
		if err != nil {
			writeProcessMapError(w, err, "failed_to_save_process_map_trace")
			return
		}
		s.publishCommittedWorkspaceEvents(result.Events)
		writeJSON(w, http.StatusOK, result)
		return
	}
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	result, err := s.repo.DeleteResourceOperationalRelationship(r.Context(), store.ResourceOperationalRelationshipDeleteInput{
		CompanyID: companyID, ResourceOperationalRelationshipID: relationshipID,
		ActorUserID: actorUserID, PermissionUserID: actorUserID, RealtimeConnectionID: realtimeConnectionID,
	})
	if err != nil {
		writeProcessMapError(w, err, "failed_to_delete_operational_relationship")
		return
	}
	s.publishCommittedWorkspaceEvents(result.Events)
	writeJSON(w, http.StatusOK, result)
}

func writeProcessMapError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_process_map_request")
	case errors.Is(err, store.ErrProcessMapCycle):
		writeError(w, http.StatusConflict, "process_map_cycle")
	case errors.Is(err, store.ErrProcessMapContainment):
		writeError(w, http.StatusConflict, "process_map_containment")
	case errors.Is(err, store.ErrNotFound):
		writeAccessResourceNotFound(w)
	default:
		writeError(w, http.StatusInternalServerError, fallback)
	}
}
