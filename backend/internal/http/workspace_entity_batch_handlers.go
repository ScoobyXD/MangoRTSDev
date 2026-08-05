package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type workspaceEntityBatchItemRequest struct {
	ClientID string `json:"client_id"`
	Name     string `json:"name"`
	Title    string `json:"title"`
	Header   string `json:"header"`
	Position int    `json:"position"`
}

type workspaceEntityBatchRelationshipRequest struct {
	EntityIDA string `json:"entity_id_a"`
	EntityIDB string `json:"entity_id_b"`
	ClientIDA string `json:"client_id_a"`
	ClientIDB string `json:"client_id_b"`
	APosition string `json:"a_position"`
	BPosition string `json:"b_position"`
}

func (s *Server) handleWorkspaceEntityBatches(w http.ResponseWriter, r *http.Request) {
	var timings *requestTimingRecorder
	if r.URL.Path == "/v1/workspace/entity-batches" {
		timedWriter, requestTimings := startTimedRequest(w)
		w = timedWriter
		timings = requestTimings
		defer func() {
			timings.log(r, timedWriter.status)
		}()
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	var req struct {
		CompanyID                string                                    `json:"company_id"`
		EntityKind               string                                    `json:"entity_kind"`
		FolderID                 string                                    `json:"folder_id"`
		MutationOrigin           string                                    `json:"mutation_origin"`
		CreatorLogicGateGVICRole string                                    `json:"creator_logic_gate_gvic_role"`
		Items                    []workspaceEntityBatchItemRequest         `json:"items"`
		Relationships            []workspaceEntityBatchRelationshipRequest `json:"relationships"`
	}
	stop := timings.observeAccounted("request.decode")
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	stop()
	stop = timings.observeAccounted("request.validate")
	input, ok := buildWorkspaceEntityBatchInput(req.CompanyID, req.EntityKind, req.FolderID, req.MutationOrigin, req.CreatorLogicGateGVICRole, req.Items, req.Relationships)
	if !ok {
		stop()
		writeError(w, http.StatusBadRequest, "invalid_workspace_entity_batch")
		return
	}
	stop()
	stop = timings.observeAccounted("request.auth")
	if actor, ok := authenticatedActor(r); ok {
		input.CreatorUserID = strings.TrimSpace(actor.User.UserID)
	}
	stop()
	stop = timings.observeAccounted("request.access_check")
	for _, relationship := range input.Relationships {
		entityType := store.EntityTypeNode
		notFoundCode := "node_not_found"
		if input.EntityKind == "logic_gate" {
			entityType = store.EntityTypeLogicGate
			notFoundCode = "logic_gate_not_found"
		}
		if relationship.EntityIDA != "" && !s.requireEntityView(w, r, input.CompanyID, entityType, relationship.EntityIDA, notFoundCode) {
			stop()
			return
		}
		if relationship.EntityIDB != "" && !s.requireEntityView(w, r, input.CompanyID, entityType, relationship.EntityIDB, notFoundCode) {
			stop()
			return
		}
	}
	stop()

	input.TimingRecorder = timings
	stop = timings.observeAccounted("source.transaction")
	result, err := s.repo.CreateWorkspaceEntityBatch(input)
	stop()
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_workspace_entity_batch")
		return
	}
	if errors.Is(err, store.ErrPrincipalNotInCompany) {
		writeError(w, http.StatusBadRequest, "principal_user_not_in_company")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "workspace_entity_batch_reference_not_found")
		return
	}
	if err != nil {
		log.Printf(
			"failed to create workspace entity batch company_id=%s entity_kind=%s folder_id=%s items=%d relationships=%d: %v",
			input.CompanyID,
			input.EntityKind,
			input.FolderID,
			len(input.Items),
			len(input.Relationships),
			err,
		)
		writeError(w, http.StatusInternalServerError, "failed_to_create_workspace_entity_batch")
		return
	}

	publishWorkspaceEntityBatchEvents(s, result, timings)
	writeJSON(w, http.StatusCreated, result)
}

func buildWorkspaceEntityBatchInput(
	companyID string,
	entityKind string,
	folderID string,
	mutationOrigin string,
	creatorLogicGateGVICRole string,
	items []workspaceEntityBatchItemRequest,
	relationships []workspaceEntityBatchRelationshipRequest,
) (store.WorkspaceEntityBatchInput, bool) {
	input := store.WorkspaceEntityBatchInput{
		CompanyID:                strings.TrimSpace(companyID),
		EntityKind:               strings.TrimSpace(entityKind),
		FolderID:                 strings.TrimSpace(folderID),
		MutationOrigin:           store.NormalizeMutationOrigin(mutationOrigin),
		CreatorLogicGateGVICRole: strings.TrimSpace(creatorLogicGateGVICRole),
	}
	if strings.TrimSpace(mutationOrigin) != "" && input.MutationOrigin == "" {
		return store.WorkspaceEntityBatchInput{}, false
	}
	if input.CompanyID == "" || (input.EntityKind != "node" && input.EntityKind != "logic_gate") {
		return store.WorkspaceEntityBatchInput{}, false
	}
	if input.CreatorLogicGateGVICRole != "" {
		if input.EntityKind != "logic_gate" {
			return store.WorkspaceEntityBatchInput{}, false
		}
		role, ok := store.NormalizeGVICRole(input.CreatorLogicGateGVICRole)
		if !ok {
			return store.WorkspaceEntityBatchInput{}, false
		}
		input.CreatorLogicGateGVICRole = role
	}
	if len(items) == 0 || len(items) > store.WorkspaceEntityBatchMaxItems || len(relationships) > store.WorkspaceEntityBatchMaxRelationships {
		return store.WorkspaceEntityBatchInput{}, false
	}

	clientIDs := make(map[string]struct{}, len(items))
	for _, item := range items {
		clientID := strings.TrimSpace(item.ClientID)
		title := ""
		if input.EntityKind == "node" {
			if strings.TrimSpace(item.Title) != "" || strings.TrimSpace(item.Header) != "" {
				return store.WorkspaceEntityBatchInput{}, false
			}
			title = strings.TrimSpace(item.Name)
		} else {
			title = strings.TrimSpace(item.Title)
			if title == "" {
				title = strings.TrimSpace(item.Header)
			}
		}
		if clientID == "" || title == "" {
			return store.WorkspaceEntityBatchInput{}, false
		}
		if _, exists := clientIDs[clientID]; exists {
			return store.WorkspaceEntityBatchInput{}, false
		}
		clientIDs[clientID] = struct{}{}
		input.Items = append(input.Items, store.WorkspaceEntityBatchItemInput{
			ClientID: clientID,
			Title:    title,
			Position: item.Position,
		})
	}

	for _, relationship := range relationships {
		item := store.WorkspaceEntityBatchRelationshipInput{
			EntityIDA: strings.TrimSpace(relationship.EntityIDA),
			EntityIDB: strings.TrimSpace(relationship.EntityIDB),
			ClientIDA: strings.TrimSpace(relationship.ClientIDA),
			ClientIDB: strings.TrimSpace(relationship.ClientIDB),
			APosition: strings.TrimSpace(relationship.APosition),
			BPosition: strings.TrimSpace(relationship.BPosition),
		}
		if (item.EntityIDA == "" && item.ClientIDA == "") || (item.EntityIDB == "" && item.ClientIDB == "") {
			return store.WorkspaceEntityBatchInput{}, false
		}
		if item.ClientIDA != "" {
			if _, exists := clientIDs[item.ClientIDA]; !exists {
				return store.WorkspaceEntityBatchInput{}, false
			}
		}
		if item.ClientIDB != "" {
			if _, exists := clientIDs[item.ClientIDB]; !exists {
				return store.WorkspaceEntityBatchInput{}, false
			}
		}
		if item.EntityIDA != "" && item.EntityIDA == item.EntityIDB {
			return store.WorkspaceEntityBatchInput{}, false
		}
		if item.ClientIDA != "" && item.ClientIDA == item.ClientIDB {
			return store.WorkspaceEntityBatchInput{}, false
		}
		if input.EntityKind == "node" {
			if !isLegalNodeRelationshipPositionPair(item.APosition, item.BPosition) {
				return store.WorkspaceEntityBatchInput{}, false
			}
		} else if !isLegalLogicGateRelationshipPositionPair(item.APosition, item.BPosition) {
			return store.WorkspaceEntityBatchInput{}, false
		}
		input.Relationships = append(input.Relationships, item)
	}

	return input, true
}

func publishWorkspaceEntityBatchEvents(s *Server, result store.WorkspaceEntityBatchResult, timings *requestTimingRecorder) {
	inputs := make([]store.DomainEventInput, 0,
		len(result.FolderItems)+len(result.Nodes)+len(result.LogicGates)+len(result.Relationships)+len(result.LogicGateRelationships)+2,
	)
	appendEvent := func(eventType string, payload map[string]any) {
		inputs = append(inputs, store.DomainEventInput{
			CompanyID:      result.CompanyID,
			StreamType:     workspaceDomainStreamType,
			StreamID:       result.CompanyID,
			Type:           eventType,
			Payload:        payload,
			TimingRecorder: timings,
		})
	}
	for _, item := range result.FolderItems {
		appendEvent("company_explorer_item_placed", map[string]any{"parent_entity_id": item.FolderID, "target_type": item.ItemType, "target_id": item.ItemID, "folder_item": item})
	}
	for _, item := range result.Nodes {
		appendEvent("node_created", map[string]any{"node_id": item.NodeID, "node": item})
	}
	for _, item := range result.LogicGates {
		appendEvent("logic_gate_created", map[string]any{"logic_gate_id": item.LogicGateID, "logic_gate": item})
	}
	deferredTasks := make([]store.WorkspaceDerivedProjectionTask, 0,
		len(result.DeferredFolderItems),
	)
	for _, item := range result.DeferredFolderItems {
		deferredTasks = append(deferredTasks, store.DeferredCompanyExplorerFolderItemAssignTask(item.FolderID, item.SystemFolderKey, item.ItemType, item.ItemID, item.Position))
	}
	if len(deferredTasks) > 0 {
		inputs = append(inputs, store.WorkspaceDerivedProjectionRequestedEventInput(result.CompanyID, deferredTasks, ""))
	}
	for _, item := range result.Relationships {
		appendEvent("relationship_created", map[string]any{
			"node_relationship_id": item.NodeRelationshipID,
			"node_id_a":            item.NodeIDA,
			"node_id_b":            item.NodeIDB,
			"relationship":         item,
		})
	}
	for _, item := range result.LogicGateRelationships {
		appendEvent("logic_gate_relationship_created", map[string]any{
			"logic_gate_relationship_id": item.LogicGateRelationshipID,
			"logic_gate_id_a":            item.LogicGateIDA,
			"logic_gate_id_b":            item.LogicGateIDB,
			"logic_gate_relationship":    item,
		})
	}
	if len(inputs) == 0 {
		return
	}
	stop := timings.observeAccounted("events.append.total")
	events, err := s.repo.AppendDomainEvents(inputs)
	stop()
	if err != nil {
		log.Printf("failed to append workspace entity batch domain events company_id=%s count=%d: %v", result.CompanyID, len(inputs), err)
		return
	}
	s.projectCommittedWorkspaceDerivedEventsWithTiming(events, timings)
	s.publishCommittedWorkspaceEventsWithTiming(events, timings)
}
