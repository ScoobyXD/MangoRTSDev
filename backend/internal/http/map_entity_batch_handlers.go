package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

type mapEntityBatchItemRequest struct {
	ClientID string  `json:"client_id"`
	Title    string  `json:"title"`
	Header   string  `json:"header"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Position int     `json:"position"`
}

type mapEntityBatchRelationshipRequest struct {
	EntityIDA string `json:"entity_id_a"`
	EntityIDB string `json:"entity_id_b"`
	ClientIDA string `json:"client_id_a"`
	ClientIDB string `json:"client_id_b"`
	APosition string `json:"a_position"`
	BPosition string `json:"b_position"`
}

func (s *Server) handleMapEntityBatches(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	var req struct {
		CompanyID     string                              `json:"company_id"`
		EntityKind    string                              `json:"entity_kind"`
		FolderID      string                              `json:"folder_id"`
		Items         []mapEntityBatchItemRequest         `json:"items"`
		Relationships []mapEntityBatchRelationshipRequest `json:"relationships"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}

	input, ok := buildMapEntityBatchInput(req.CompanyID, req.EntityKind, req.FolderID, req.Items, req.Relationships)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_map_entity_batch")
		return
	}

	result, err := s.repo.CreateMapEntityBatch(input)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_map_entity_batch")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "map_entity_batch_reference_not_found")
		return
	}
	if err != nil {
		log.Printf(
			"failed to create map entity batch company_id=%s entity_kind=%s folder_id=%s items=%d relationships=%d: %v",
			input.CompanyID,
			input.EntityKind,
			input.FolderID,
			len(input.Items),
			len(input.Relationships),
			err,
		)
		writeError(w, http.StatusInternalServerError, "failed_to_create_map_entity_batch")
		return
	}

	publishMapEntityBatchEvents(s, result)
	writeJSON(w, http.StatusCreated, result)
}

func buildMapEntityBatchInput(
	companyID string,
	entityKind string,
	folderID string,
	items []mapEntityBatchItemRequest,
	relationships []mapEntityBatchRelationshipRequest,
) (store.MapEntityBatchInput, bool) {
	input := store.MapEntityBatchInput{
		CompanyID:  strings.TrimSpace(companyID),
		EntityKind: strings.TrimSpace(entityKind),
		FolderID:   strings.TrimSpace(folderID),
	}
	if input.CompanyID == "" || (input.EntityKind != "node" && input.EntityKind != "logic_gate") {
		return store.MapEntityBatchInput{}, false
	}
	if len(items) == 0 || len(items) > store.MapEntityBatchMaxItems || len(relationships) > store.MapEntityBatchMaxRelationships {
		return store.MapEntityBatchInput{}, false
	}

	clientIDs := make(map[string]struct{}, len(items))
	for _, item := range items {
		clientID := strings.TrimSpace(item.ClientID)
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = strings.TrimSpace(item.Header)
		}
		if clientID == "" || title == "" || !validMapLayoutCoordinate(item.X) || !validMapLayoutCoordinate(item.Y) {
			return store.MapEntityBatchInput{}, false
		}
		if _, exists := clientIDs[clientID]; exists {
			return store.MapEntityBatchInput{}, false
		}
		clientIDs[clientID] = struct{}{}
		input.Items = append(input.Items, store.MapEntityBatchItemInput{
			ClientID: clientID,
			Title:    title,
			X:        item.X,
			Y:        item.Y,
			Position: item.Position,
		})
	}

	for _, relationship := range relationships {
		item := store.MapEntityBatchRelationshipInput{
			EntityIDA: strings.TrimSpace(relationship.EntityIDA),
			EntityIDB: strings.TrimSpace(relationship.EntityIDB),
			ClientIDA: strings.TrimSpace(relationship.ClientIDA),
			ClientIDB: strings.TrimSpace(relationship.ClientIDB),
			APosition: strings.TrimSpace(relationship.APosition),
			BPosition: strings.TrimSpace(relationship.BPosition),
		}
		if (item.EntityIDA == "" && item.ClientIDA == "") || (item.EntityIDB == "" && item.ClientIDB == "") {
			return store.MapEntityBatchInput{}, false
		}
		if item.ClientIDA != "" {
			if _, exists := clientIDs[item.ClientIDA]; !exists {
				return store.MapEntityBatchInput{}, false
			}
		}
		if item.ClientIDB != "" {
			if _, exists := clientIDs[item.ClientIDB]; !exists {
				return store.MapEntityBatchInput{}, false
			}
		}
		if item.EntityIDA != "" && item.EntityIDA == item.EntityIDB {
			return store.MapEntityBatchInput{}, false
		}
		if item.ClientIDA != "" && item.ClientIDA == item.ClientIDB {
			return store.MapEntityBatchInput{}, false
		}
		if input.EntityKind == "node" {
			if !isLegalNodeRelationshipPositionPair(item.APosition, item.BPosition) {
				return store.MapEntityBatchInput{}, false
			}
		} else if !isLegalLogicGateRelationshipPositionPair(item.APosition, item.BPosition) {
			return store.MapEntityBatchInput{}, false
		}
		input.Relationships = append(input.Relationships, item)
	}

	return input, true
}

func publishMapEntityBatchEvents(s *Server, result store.MapEntityBatchResult) {
	for _, item := range result.FolderItems {
		s.publishWorkspaceEvent(result.CompanyID, "company_explorer_folder_item_assigned", map[string]any{"folder_item": item})
	}
	for _, item := range result.Nodes {
		s.publishWorkspaceEvent(result.CompanyID, "node_created", map[string]any{"node_id": item.NodeID, "node": item})
	}
	for _, item := range result.LogicGates {
		s.publishWorkspaceEvent(result.CompanyID, "logic_gate_created", map[string]any{"logic_gate_id": item.LogicGateID, "logic_gate": item})
	}
	if len(result.NodeMapPositions) > 0 {
		s.publishWorkspaceEvent(result.CompanyID, "node_map_positions_updated", map[string]any{"positions": result.NodeMapPositions})
	}
	if len(result.LogicGateMapPositions) > 0 {
		s.publishWorkspaceEvent(result.CompanyID, "logic_gate_map_positions_updated", map[string]any{"positions": result.LogicGateMapPositions})
	}
	for _, item := range result.Relationships {
		s.publishWorkspaceEvent(result.CompanyID, "relationship_created", map[string]any{
			"node_relationship_id": item.NodeRelationshipID,
			"node_id_a":            item.NodeIDA,
			"node_id_b":            item.NodeIDB,
			"relationship":         item,
		})
	}
	for _, item := range result.LogicGateRelationships {
		s.publishWorkspaceEvent(result.CompanyID, "logic_gate_relationship_created", map[string]any{
			"logic_gate_relationship_id": item.LogicGateRelationshipID,
			"logic_gate_id_a":            item.LogicGateIDA,
			"logic_gate_id_b":            item.LogicGateIDB,
			"logic_gate_relationship":    item,
		})
	}
}
