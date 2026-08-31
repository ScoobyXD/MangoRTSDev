package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
)

const (
	HuddleActionItemsRealtimeScopePrefix      = "huddle-action-items:"
	HuddleBoardActionItemsRealtimeScopePrefix = "huddle-board-action-items:"
	HuddleActionItemsChangedEventType         = "huddle_action_items.changed"
)

func huddleActionItemsRealtimeOutboxInput(companyID, huddleNodeID string) (RealtimeOutboxInput, error) {
	eventID := newUUIDv7String()
	scope := HuddleActionItemsRealtimeScopePrefix + huddleNodeID
	payload, err := json.Marshal(map[string]any{
		"type": HuddleActionItemsChangedEventType, "event_id": eventID,
		"company_id": companyID, "scope": scope, "huddle_node_id": huddleNodeID,
	})
	if err != nil {
		return RealtimeOutboxInput{}, err
	}
	return normalizeRealtimeOutboxInput(RealtimeOutboxInput{
		EventID: eventID, CompanyID: companyID, Scope: scope,
		EventType:    HuddleActionItemsChangedEventType,
		ResourceType: EntityTypeHuddleNode, ResourceID: huddleNodeID,
		Permission: EntityPermissionEdit, Payload: payload,
	})
}

func huddleBoardActionItemsRealtimeOutboxInput(companyID, huddleLogicGateID string) (RealtimeOutboxInput, error) {
	eventID := newUUIDv7String()
	scope := HuddleBoardActionItemsRealtimeScopePrefix + huddleLogicGateID
	payload, err := json.Marshal(map[string]any{
		"type": HuddleActionItemsChangedEventType, "event_id": eventID,
		"company_id": companyID, "scope": scope, "huddle_logic_gate_id": huddleLogicGateID,
	})
	if err != nil {
		return RealtimeOutboxInput{}, err
	}
	return normalizeRealtimeOutboxInput(RealtimeOutboxInput{
		EventID: eventID, CompanyID: companyID, Scope: scope,
		EventType:    HuddleActionItemsChangedEventType,
		ResourceType: EntityTypeHuddleLogicGate, ResourceID: huddleLogicGateID,
		Permission: EntityPermissionEdit, Payload: payload,
	})
}

func (r *MemoryRepo) memoryHuddleNodeIDsForBoardSetLocked(companyID string, boardIDs map[string]bool) []string {
	nodeIDs := []string{}
	for _, node := range r.huddleNodes {
		if node.CompanyID == companyID && boardIDs[node.HuddleLogicGateID] {
			nodeIDs = append(nodeIDs, node.HuddleNodeID)
		}
	}
	sort.Strings(nodeIDs)
	return nodeIDs
}

func (r *MemoryRepo) memoryHuddleActionItemBoardIDsLocked(companyID, entityID string) []string {
	entity, exists := r.entities[key(companyID, entityID)]
	if !exists || entity.EntityTypeID != ActionItemEntityTypeID {
		return nil
	}
	boardIDs := map[string]bool{}
	for _, field := range r.entityFields {
		if field.CompanyID != companyID || field.EntityID != entityID || optionalEntityIDValue(field.EntityFieldTypeID) != ActionItemSourceFieldTypeID {
			continue
		}
		resourceType, resourceID, ok := decodeActionItemSourceValue(field.Value)
		if !ok {
			continue
		}
		switch resourceType {
		case EntityTypeHuddleLogicGate:
			boardIDs[resourceID] = true
		case EntityTypeHuddleNode:
			if node, exists := r.huddleNodes[key(companyID, resourceID)]; exists {
				boardIDs[node.HuddleLogicGateID] = true
			}
		}
	}
	for _, relationship := range r.entityRelationships {
		if relationship.CompanyID != companyID || relationship.EntityID != entityID {
			continue
		}
		switch relationship.ResourceType {
		case EntityTypeHuddleLogicGate:
			boardIDs[relationship.ResourceID] = true
		case EntityTypeHuddleNode:
			if node, exists := r.huddleNodes[key(companyID, relationship.ResourceID)]; exists {
				boardIDs[node.HuddleLogicGateID] = true
			}
		}
	}
	result := make([]string, 0, len(boardIDs))
	for boardID := range boardIDs {
		result = append(result, boardID)
	}
	sort.Strings(result)
	return result
}

func (r *MemoryRepo) memoryHuddleActionItemBoardIDsForResourceLocked(companyID, resourceType, resourceID string) []string {
	boardIDs := map[string]bool{}
	switch resourceType {
	case EntityTypeHuddleLogicGate:
		boardIDs[resourceID] = true
	case EntityTypeHuddleNode:
		if node, exists := r.huddleNodes[key(companyID, resourceID)]; exists {
			boardIDs[node.HuddleLogicGateID] = true
		}
	}
	result := make([]string, 0, len(boardIDs))
	for boardID := range boardIDs {
		result = append(result, boardID)
	}
	sort.Strings(result)
	return result
}

func (r *MemoryRepo) enqueueHuddleActionItemsRealtimeLocked(companyID string, huddleLogicGateIDs, huddleNodeIDs []string) error {
	for _, huddleLogicGateID := range huddleLogicGateIDs {
		input, err := huddleBoardActionItemsRealtimeOutboxInput(companyID, huddleLogicGateID)
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxLocked(input); err != nil {
			return err
		}
	}
	for _, huddleNodeID := range huddleNodeIDs {
		input, err := huddleActionItemsRealtimeOutboxInput(companyID, huddleNodeID)
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxLocked(input); err != nil {
			return err
		}
	}
	return nil
}

func postgresHuddleActionItemBoardIDsTx(ctx context.Context, tx *sql.Tx, companyID, entityID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `
with action_item as (
  select entity.entity_id
  from entities entity
  join entity_types entity_type
    on entity_type.company_id=entity.company_id and entity_type.entity_type_id=entity.entity_type_id
  where entity.company_id=$1::uuid and entity.entity_id=$2::uuid
    and entity_type.system_key=$3::text
), boards as (
  select source.value_jsonb->>'resource_id' as board_id
  from action_item
  join entity_fields source
    on source.company_id=$1::uuid and source.entity_id=action_item.entity_id
   and source.entity_field_type_id=$4::uuid
  where source.value_jsonb->>'resource_type'=$5::text
  union
  select node.huddle_logic_gate_id::text
  from action_item
  join entity_fields source
    on source.company_id=$1::uuid and source.entity_id=action_item.entity_id
   and source.entity_field_type_id=$4::uuid
  join huddle_nodes node
    on node.company_id=$1::uuid and node.huddle_node_id::text=source.value_jsonb->>'resource_id'
  where source.value_jsonb->>'resource_type'=$6::text
  union
  select relationship.resource_id::text
  from action_item
  join entity_relationships relationship
    on relationship.company_id=$1::uuid and relationship.entity_id=action_item.entity_id
  where relationship.resource_type=$5::text
  union
  select node.huddle_logic_gate_id::text
  from action_item
  join entity_relationships relationship
    on relationship.company_id=$1::uuid and relationship.entity_id=action_item.entity_id
  join huddle_nodes node
    on node.company_id=relationship.company_id and node.huddle_node_id=relationship.resource_id
  where relationship.resource_type=$6::text
)
select distinct boards.board_id
from boards
join huddle_logic_gates board
  on board.company_id=$1::uuid and board.huddle_logic_gate_id::text=boards.board_id
order by boards.board_id`, companyID, entityID, ActionItemEntityTypeSystemKey, ActionItemSourceFieldTypeID, EntityTypeHuddleLogicGate, EntityTypeHuddleNode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	boardIDs := []string{}
	for rows.Next() {
		var boardID string
		if err := rows.Scan(&boardID); err != nil {
			return nil, err
		}
		boardIDs = append(boardIDs, boardID)
	}
	return boardIDs, rows.Err()
}

func postgresHuddleActionItemBoardIDsForResourceTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) ([]string, error) {
	switch resourceType {
	case EntityTypeHuddleLogicGate:
		return []string{resourceID}, nil
	case EntityTypeHuddleNode:
		var boardID string
		err := tx.QueryRowContext(ctx, `
select huddle_logic_gate_id::text
from huddle_nodes
where company_id=$1::uuid and huddle_node_id=$2::uuid`, companyID, resourceID).Scan(&boardID)
		if err != nil {
			return nil, err
		}
		return []string{boardID}, nil
	default:
		return nil, nil
	}
}

func postgresHuddleNodeIDsForBoardsTx(ctx context.Context, tx *sql.Tx, companyID string, boardIDs []string) ([]string, error) {
	if len(boardIDs) == 0 {
		return nil, nil
	}
	rows, err := tx.QueryContext(ctx, `
select huddle_node_id::text
from huddle_nodes
where company_id=$1::uuid and huddle_logic_gate_id::text=any($2::text[])
order by huddle_node_id::text`, companyID, boardIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nodeIDs := []string{}
	for rows.Next() {
		var nodeID string
		if err := rows.Scan(&nodeID); err != nil {
			return nil, err
		}
		nodeIDs = append(nodeIDs, nodeID)
	}
	return nodeIDs, rows.Err()
}

func (r *PostgresRepo) enqueueHuddleActionItemsRealtimeTx(ctx context.Context, tx *sql.Tx, companyID string, huddleLogicGateIDs, huddleNodeIDs []string) error {
	for _, huddleLogicGateID := range huddleLogicGateIDs {
		input, err := huddleBoardActionItemsRealtimeOutboxInput(companyID, huddleLogicGateID)
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, input); err != nil {
			return err
		}
	}
	for _, huddleNodeID := range huddleNodeIDs {
		input, err := huddleActionItemsRealtimeOutboxInput(companyID, huddleNodeID)
		if err != nil {
			return err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, input); err != nil {
			return err
		}
	}
	return nil
}
