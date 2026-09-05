package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func huddleActor(w http.ResponseWriter, r *http.Request, companyID string) (ActorContext, bool) {
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

func (s *Server) actorCanViewHuddleResource(actor ActorContext, companyID, resourceType, resourceID string) (bool, error) {
	if actorCanManageCompany(actor, companyID) {
		return true, nil
	}
	return s.repo.UserHasEffectiveAccess(companyID, actor.User.UserID, resourceType, resourceID, store.EntityPermissionEdit)
}

func writeHuddleError(w http.ResponseWriter, err error) {
	var blocked *store.LogicGateConversionBlockedError
	switch {
	case errors.As(err, &blocked):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "logic_gate_conversion_blocked", "blockers": blocked.Blockers})
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "resource_not_found")
	case errors.Is(err, store.ErrConflict):
		writeError(w, http.StatusConflict, "resource_has_children")
	case errors.Is(err, store.ErrVersionConflict):
		writeError(w, http.StatusConflict, "version_conflict")
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_request")
	default:
		writeError(w, http.StatusInternalServerError, "huddle_request_failed")
	}
}

func (s *Server) handleHuddleLogicGates(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var req struct {
			CompanyID string `json:"company_id"`
			Header    string `json:"header"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&req) != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		if req.CompanyID == "" {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		actor, ok := huddleActor(w, r, req.CompanyID)
		if !ok {
			return
		}
		item, err := s.repo.CreateHuddleLogicGate(store.HuddleCreateInput{
			CompanyID: req.CompanyID, Name: req.Header, ActorID: actor.User.UserID,
		})
		if err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"huddle_logic_gate": item})
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	actor, ok := huddleActor(w, r, companyID)
	if !ok {
		return
	}
	items, err := s.repo.ListHuddleLogicGates(companyID)
	if err != nil {
		writeHuddleError(w, err)
		return
	}
	visible := items[:0]
	for _, item := range items {
		allowed, accessErr := s.actorCanViewHuddleResource(actor, companyID, store.EntityTypeHuddleLogicGate, item.HuddleLogicGateID)
		if accessErr != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_check_entity_permission")
			return
		}
		if allowed {
			visible = append(visible, item)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"huddle_logic_gates": visible})
}

func (s *Server) handleHuddleLogicGateByID(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/huddle-logic-gates/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	id := parts[0]
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if len(parts) >= 2 && parts[1] == "logic-gates" {
		if len(parts) == 2 && r.Method == http.MethodGet {
			if !s.requireEntityView(w, r, companyID, store.EntityTypeHuddleLogicGate, id, "huddle_logic_gate_not_found") {
				return
			}
			items, err := s.repo.ListHuddleLogicGateCards(companyID, id)
			if err != nil {
				writeHuddleError(w, err)
				return
			}
			actor, _ := authenticatedActor(r)
			visible := items[:0]
			for _, item := range items {
				allowed, accessErr := s.actorCanViewHuddleResource(actor, companyID, store.EntityTypeLogicGate, item.LogicGateID)
				if accessErr != nil {
					writeError(w, http.StatusInternalServerError, "failed_to_check_entity_permission")
					return
				}
				if allowed {
					visible = append(visible, item)
				}
			}
			writeJSON(w, http.StatusOK, map[string]any{"logic_gates": visible})
			return
		}
		if len(parts) != 3 || (r.Method != http.MethodPut && r.Method != http.MethodDelete) {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		logicGateID := parts[2]
		if r.Method == http.MethodPut {
			var req struct {
				CompanyID string `json:"company_id"`
			}
			if json.NewDecoder(r.Body).Decode(&req) != nil {
				writeError(w, http.StatusBadRequest, "invalid_json")
				return
			}
			companyID = strings.TrimSpace(req.CompanyID)
		}
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeHuddleLogicGate, id, "huddle_logic_gate_not_found") {
			return
		}
		if r.Method == http.MethodPut && !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, logicGateID, "logic_gate_not_found") {
			return
		}
		input := store.HuddleLogicGateRelationshipInput{CompanyID: companyID, HuddleLogicGateID: id, LogicGateID: logicGateID}
		var err error
		if r.Method == http.MethodPut {
			err = s.repo.CreateHuddleLogicGateRelationship(input)
		} else {
			err = s.repo.DeleteHuddleLogicGateRelationship(input)
		}
		if err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
		return
	}
	if len(parts) == 1 && r.Method == http.MethodPut {
		var req struct {
			CompanyID string `json:"company_id"`
			Header    string `json:"header"`
		}
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		companyID = strings.TrimSpace(req.CompanyID)
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeHuddleLogicGate, id, "huddle_logic_gate_not_found") {
			return
		}
		item, err := s.repo.UpdateHuddleLogicGate(store.HuddleUpdateInput{CompanyID: companyID, ResourceID: id, Name: req.Header})
		if err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if len(parts) == 2 && parts[1] == "nodes" {
		if !s.requireEntityView(w, r, companyID, store.EntityTypeHuddleLogicGate, id, "huddle_logic_gate_not_found") {
			return
		}
		items, err := s.repo.ListHuddleNodes(companyID, id)
		if err != nil {
			writeHuddleError(w, err)
			return
		}
		actor, _ := authenticatedActor(r)
		visible := items[:0]
		for _, item := range items {
			allowed, accessErr := s.actorCanViewHuddleResource(actor, companyID, store.EntityTypeHuddleNode, item.HuddleNodeID)
			if accessErr != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_check_entity_permission")
				return
			}
			if allowed {
				visible = append(visible, item)
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"huddle_nodes": visible})
		return
	}
	if len(parts) != 1 {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		if !s.requireEntityView(w, r, companyID, store.EntityTypeHuddleLogicGate, id, "huddle_logic_gate_not_found") {
			return
		}
		item, err := s.repo.GetHuddleLogicGate(companyID, id)
		if err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
	case http.MethodDelete:
		if !s.requireEntityAdmin(w, r, companyID, store.EntityTypeHuddleLogicGate, id, "huddle_logic_gate_not_found") {
			return
		}
		actor, ok := authenticatedActor(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if err := s.repo.DeleteHuddleLogicGate(companyID, id, actor.User.UserID); err != nil {
			writeHuddleError(w, err)
			return
		}
		s.wakeAttachmentDeletionCleanup()
		writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleHuddleNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID         string `json:"company_id"`
		HuddleLogicGateID string `json:"huddle_logic_gate_id"`
		Name              string `json:"name"`
	}
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeHuddleLogicGate, req.HuddleLogicGateID, "huddle_logic_gate_not_found") {
		return
	}
	actor, _ := authenticatedActor(r)
	item, err := s.repo.CreateHuddleNode(store.HuddleCreateInput{CompanyID: req.CompanyID, OwnerID: req.HuddleLogicGateID, Name: req.Name, ActorID: actor.User.UserID})
	if err != nil {
		writeHuddleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleHuddleNodeByID(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/huddle-nodes/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	id := parts[0]
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if s.handleHuddleNodeActionItems(w, r, id, parts) {
		return
	}
	if s.handleHuddleNodeWorkspaceSubresource(w, r, id, parts) {
		return
	}
	if len(parts) == 2 && parts[1] == "logic-gates" && r.Method == http.MethodGet {
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeHuddleNode, id, "huddle_node_not_found") {
			return
		}
		items, err := s.repo.ListHuddleNodeLogicGateCards(companyID, id)
		if err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"logic_gates": items})
		return
	}
	if len(parts) != 1 {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method == http.MethodPut {
		var req struct {
			CompanyID  string  `json:"company_id"`
			Name       string  `json:"name"`
			HuddleDate *string `json:"huddle_date"`
		}
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		companyID = req.CompanyID
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeHuddleNode, id, "huddle_node_not_found") {
			return
		}
		item, err := s.repo.UpdateHuddleNode(store.HuddleUpdateInput{CompanyID: companyID, ResourceID: id, Name: req.Name, HuddleDate: req.HuddleDate})
		if err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	switch r.Method {
	case http.MethodGet:
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeHuddleNode, id, "huddle_node_not_found") {
			return
		}
		item, err := s.repo.GetHuddleNode(companyID, id)
		if err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
	case http.MethodDelete:
		if !s.requireEntityAdmin(w, r, companyID, store.EntityTypeHuddleNode, id, "huddle_node_not_found") {
			return
		}
		actor, _ := authenticatedActor(r)
		if err := s.repo.DeleteHuddleNode(companyID, id, actor.User.UserID); err != nil {
			writeHuddleError(w, err)
			return
		}
		s.wakeAttachmentDeletionCleanup()
		writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleKPIs(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		ownerID := strings.TrimSpace(r.URL.Query().Get("logic_gate_id"))
		if !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, ownerID, "logic_gate_not_found") {
			return
		}
		items, err := s.repo.ListKPIs(companyID, ownerID)
		if err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"kpis": items})
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID   string `json:"company_id"`
		LogicGateID string `json:"logic_gate_id"`
		Name        string `json:"name"`
	}
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeLogicGate, req.LogicGateID, "logic_gate_not_found") {
		return
	}
	actor, _ := authenticatedActor(r)
	item, err := s.repo.CreateKPI(store.HuddleCreateInput{CompanyID: req.CompanyID, OwnerID: req.LogicGateID, Name: req.Name, ActorID: actor.User.UserID})
	if err != nil {
		writeHuddleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleKPIByID(w http.ResponseWriter, r *http.Request) {
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/kpis/"), "/")
	if id == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if r.Method == http.MethodPut {
		var req struct {
			CompanyID string `json:"company_id"`
			Name      string `json:"name"`
		}
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		companyID = req.CompanyID
		kpi, err := s.repo.GetKPI(companyID, id)
		if err != nil {
			writeHuddleError(w, err)
			return
		}
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeLogicGate, kpi.LogicGateID, "logic_gate_not_found") {
			return
		}
		item, err := s.repo.UpdateKPI(store.HuddleUpdateInput{CompanyID: companyID, ResourceID: id, Name: req.Name})
		if err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	kpi, err := s.repo.GetKPI(companyID, id)
	if err != nil {
		writeHuddleError(w, err)
		return
	}
	switch r.Method {
	case http.MethodGet:
		if !s.requireEntityView(w, r, companyID, store.EntityTypeLogicGate, kpi.LogicGateID, "logic_gate_not_found") {
			return
		}
		writeJSON(w, http.StatusOK, kpi)
	case http.MethodDelete:
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeLogicGate, kpi.LogicGateID, "logic_gate_not_found") {
			return
		}
		actor, _ := authenticatedActor(r)
		if err = s.repo.DeleteKPI(companyID, id, actor.User.UserID); err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleHuddleExplorer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	actor, ok := huddleActor(w, r, companyID)
	if !ok {
		return
	}
	tree, err := s.repo.ListHuddleExplorer(companyID)
	if err != nil {
		writeHuddleError(w, err)
		return
	}
	visible := tree.Items[:0]
	for _, item := range tree.Items {
		allowed, accessErr := s.actorCanViewHuddleResource(actor, companyID, item.ResourceType, item.ResourceID)
		if accessErr != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_check_entity_permission")
			return
		}
		if allowed {
			visible = append(visible, item)
		}
	}
	tree.Items = visible
	writeJSON(w, http.StatusOK, tree)
}

func (s *Server) handleHuddleExplorerLocationPath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	resourceType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("resource_type")))
	resourceID := strings.TrimSpace(r.URL.Query().Get("resource_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if resourceID == "" {
		writeError(w, http.StatusBadRequest, "resource_id_required")
		return
	}
	if resourceType != store.EntityTypeHuddleLogicGate && resourceType != store.EntityTypeHuddleNode {
		writeError(w, http.StatusBadRequest, "invalid_resource_type")
		return
	}
	if _, ok := huddleActor(w, r, companyID); !ok {
		return
	}
	path, err := s.repo.GetHuddleExplorerHierarchyPath(store.HuddleExplorerHierarchyPathQuery{
		Context:          r.Context(),
		CompanyID:        companyID,
		ResourceType:     resourceType,
		ResourceID:       resourceID,
		PermissionUserID: s.entityPermissionActorUserID(r, companyID),
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_huddle_explorer_location_path_query")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeAccessResourceNotFound(w)
		return
	}
	if err != nil {
		log.Printf("huddle explorer location path: failed company_id=%s resource_type=%s resource_id=%s: %v", companyID, resourceType, resourceID, err)
		writeError(w, http.StatusInternalServerError, "failed_to_get_huddle_explorer_location_path")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, path)
}

func (s *Server) handleHuddleExplorerFolders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var req struct {
		CompanyID      string `json:"company_id"`
		ParentFolderID string `json:"parent_folder_id"`
		Name           string `json:"name"`
	}
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	actor, ok := huddleActor(w, r, req.CompanyID)
	if !ok {
		return
	}
	item, err := s.repo.CreateHuddleExplorerFolder(store.HuddleCreateInput{CompanyID: req.CompanyID, OwnerID: req.ParentFolderID, Name: req.Name, ActorID: actor.User.UserID})
	if err != nil {
		writeHuddleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}
func (s *Server) handleHuddleExplorerFolderByID(w http.ResponseWriter, r *http.Request) {
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/huddle-explorer/folders/"), "/")
	var req struct {
		CompanyID      string `json:"company_id"`
		ParentFolderID string `json:"parent_folder_id"`
		Name           string `json:"name"`
	}
	if r.Method == http.MethodPut {
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if _, ok := huddleActor(w, r, req.CompanyID); !ok {
			return
		}
		if strings.TrimSpace(req.Name) != "" {
			item, err := s.repo.UpdateHuddleExplorerFolder(store.HuddleUpdateInput{CompanyID: req.CompanyID, ResourceID: id, Name: req.Name})
			if err != nil {
				writeHuddleError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, item)
			return
		}
		err := s.repo.MoveHuddleExplorerFolder(store.HuddleMoveInput{CompanyID: req.CompanyID, ResourceID: id, ParentFolderID: req.ParentFolderID})
		if err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "moved"})
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	actor, ok := huddleActor(w, r, companyID)
	if !ok {
		return
	}
	if r.Method == http.MethodDelete {
		if err := s.repo.DeleteHuddleExplorerFolder(companyID, id, actor.User.UserID); err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
		return
	}
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}
func (s *Server) handleHuddleExplorerItemByID(w http.ResponseWriter, r *http.Request) {
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/huddle-explorer/items/"), "/")
	if r.Method == http.MethodPut {
		var req struct {
			CompanyID      string `json:"company_id"`
			ParentFolderID string `json:"parent_folder_id"`
		}
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		if _, ok := huddleActor(w, r, req.CompanyID); !ok {
			return
		}
		if !s.requireHuddleExplorerItemEdit(w, r, req.CompanyID, id) {
			return
		}
		if err := s.repo.MoveHuddleExplorerItem(store.HuddleMoveInput{CompanyID: req.CompanyID, ResourceID: id, ParentFolderID: req.ParentFolderID}); err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "moved"})
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	actor, ok := huddleActor(w, r, companyID)
	if !ok {
		return
	}
	if r.Method == http.MethodDelete {
		if !s.requireHuddleExplorerItemEdit(w, r, companyID, id) {
			return
		}
		if err := s.repo.DeleteHuddleExplorerItem(companyID, id, actor.User.UserID); err != nil {
			writeHuddleError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
		return
	}
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func (s *Server) requireHuddleExplorerItemEdit(w http.ResponseWriter, r *http.Request, companyID, itemID string) bool {
	explorer, err := s.repo.ListHuddleExplorer(companyID)
	if err != nil {
		writeHuddleError(w, err)
		return false
	}
	for _, item := range explorer.Items {
		if item.ItemID == itemID {
			return s.requireEntityEdit(w, r, companyID, item.ResourceType, item.ResourceID, "huddle_resource_not_found")
		}
	}
	writeHuddleError(w, store.ErrNotFound)
	return false
}
