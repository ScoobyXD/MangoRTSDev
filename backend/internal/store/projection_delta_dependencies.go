package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

type NodeProjectionDeltaDependencyInput struct {
	CompanyID string
	NodeID    string
	Delete    bool
}

type LogicGateProjectionDeltaDependencyInput struct {
	CompanyID       string
	LogicGateID     string
	Delete          bool
	AffectedNodeIDs []string
}

type NodeLogicGateAssignmentProjectionDeltaDependencyInput struct {
	CompanyID    string
	AssignmentID string
	NodeID       string
}

type ProjectProjectionDeltaDependencyInput struct {
	CompanyID string
	ProjectID string
}

type ProjectRelationshipProjectionDeltaDependencyInput struct {
	CompanyID      string
	RelationshipID string
	NodeID         string
	LogicGateID    string
	AssignmentID   string
	Delete         bool
	BeforeRows     []ProjectRelationshipProjectionRow
}

type ResourcePermissionProjectionDeltaDependencyInput struct {
	CompanyID    string
	ResourceType string
	ResourceID   string
}

func applyNodeProjectionDeltaDependenciesTx(ctx context.Context, tx *sql.Tx, input NodeProjectionDeltaDependencyInput) ([]ProjectionDelta, error) {
	companyID := cleanUUIDText(input.CompanyID)
	nodeID := cleanUUIDText(input.NodeID)
	if companyID == "" || nodeID == "" {
		return nil, ErrInvalid
	}
	kanbanBefore, err := postgresKanbanProjectionRowsForNodeTx(ctx, tx, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	GVICMatrixBefore, err := postgresGVICMatrixProjectionRowsForResourcesTx(ctx, tx, companyID, []string{nodeID}, nil)
	if err != nil {
		return nil, err
	}
	gvicBeforeDomain, err := postgresResourceGVICEffectiveAssignmentsForResource(ctx, tx, resourceGVICKey{companyID: companyID, resourceType: EntityTypeNode, resourceID: nodeID})
	if err != nil {
		return nil, err
	}
	gvicBefore := make([]GVICEffectiveAssignmentProjectionRow, 0, len(gvicBeforeDomain))
	for _, item := range gvicBeforeDomain {
		gvicBefore = append(gvicBefore, gvicEffectiveProjectionRowFromDomain(item))
	}
	projectManagementBefore, err := projectManagementTimelineProjectionRowsForResource(ctx, tx, companyID, EntityTypeNode, nodeID)
	if err != nil {
		return nil, err
	}
	projectRelationshipBefore, err := projectRelationshipProjectionRowsForNodeTx(ctx, tx, companyID, nodeID)
	if err != nil {
		return nil, err
	}

	if input.Delete {
		if err := deleteKanbanBoardProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return nil, err
		}
		if err := deletePostgresGVICMatrixProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
delete from resource_gvic_effective_assignments
where company_id=$1::uuid
  and resource_type='node'
  and resource_id=$2::uuid`, companyID, nodeID); err != nil {
			return nil, err
		}
		if err := deleteProjectManagementTimelineProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return nil, err
		}
	} else {
		if err := syncKanbanBoardProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return nil, err
		}
		if _, err := syncResourceGVICEffectiveAssignmentsTx(ctx, tx, companyID, []resourceGVICKey{{companyID: companyID, resourceType: EntityTypeNode, resourceID: nodeID}}); err != nil {
			return nil, err
		}
		if err := syncPostgresGVICMatrixProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return nil, err
		}
		if err := syncProjectManagementTimelineProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return nil, err
		}
	}

	projectRelationshipDeltas, err := applyProjectRelationshipProjectionDeltaDependenciesTx(ctx, tx, ProjectRelationshipProjectionDeltaDependencyInput{
		CompanyID:  companyID,
		NodeID:     nodeID,
		Delete:     input.Delete,
		BeforeRows: projectRelationshipBefore,
	})
	if err != nil {
		return nil, err
	}

	kanbanAfter, err := postgresKanbanProjectionRowsForNodeTx(ctx, tx, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	GVICMatrixAfter, err := postgresGVICMatrixProjectionRowsForResourcesTx(ctx, tx, companyID, []string{nodeID}, nil)
	if err != nil {
		return nil, err
	}
	gvicAfterDomain, err := postgresResourceGVICEffectiveAssignmentsForResource(ctx, tx, resourceGVICKey{companyID: companyID, resourceType: EntityTypeNode, resourceID: nodeID})
	if err != nil {
		return nil, err
	}
	gvicAfter := make([]GVICEffectiveAssignmentProjectionRow, 0, len(gvicAfterDomain))
	for _, item := range gvicAfterDomain {
		gvicAfter = append(gvicAfter, gvicEffectiveProjectionRowFromDomain(item))
	}
	projectManagementAfter, err := projectManagementTimelineProjectionRowsForResource(ctx, tx, companyID, EntityTypeNode, nodeID)
	if err != nil {
		return nil, err
	}

	deltas := diffKanbanProjectionRows(kanbanBefore, kanbanAfter)
	deltas = append(deltas, diffGVICMatrixProjectionRows(GVICMatrixBefore, GVICMatrixAfter)...)
	deltas = append(deltas, diffGVICEffectiveProjectionRows(gvicBefore, gvicAfter)...)
	deltas = append(deltas, diffProjectManagementProjectionRows(projectManagementBefore, projectManagementAfter)...)
	deltas = append(deltas, projectRelationshipDeltas...)
	return deltas, nil
}

func applyNodeProjectionDeltaDependenciesForNodesTx(ctx context.Context, tx *sql.Tx, companyID string, nodeIDs []string) ([]ProjectionDelta, error) {
	deltas := make([]ProjectionDelta, 0)
	for _, nodeID := range cleanUUIDTextSlice(nodeIDs) {
		nodeDeltas, err := applyNodeProjectionDeltaDependenciesTx(ctx, tx, NodeProjectionDeltaDependencyInput{
			CompanyID: companyID,
			NodeID:    nodeID,
		})
		if err != nil {
			return nil, err
		}
		deltas = append(deltas, nodeDeltas...)
	}
	return deltas, nil
}

func applyLogicGateProjectionDeltaDependenciesTx(ctx context.Context, tx *sql.Tx, input LogicGateProjectionDeltaDependencyInput) ([]ProjectionDelta, error) {
	companyID := cleanUUIDText(input.CompanyID)
	logicGateID := cleanUUIDText(input.LogicGateID)
	if companyID == "" || logicGateID == "" {
		return nil, ErrInvalid
	}
	kanbanBefore, err := postgresKanbanProjectionRowsForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	GVICMatrixBefore, err := postgresGVICMatrixProjectionRowsForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	gvicBeforeDomain, err := postgresResourceGVICEffectiveAssignmentsForResource(ctx, tx, resourceGVICKey{companyID: companyID, resourceType: EntityTypeLogicGate, resourceID: logicGateID})
	if err != nil {
		return nil, err
	}
	gvicBefore := make([]GVICEffectiveAssignmentProjectionRow, 0, len(gvicBeforeDomain))
	for _, item := range gvicBeforeDomain {
		gvicBefore = append(gvicBefore, gvicEffectiveProjectionRowFromDomain(item))
	}
	projectManagementBefore, err := projectManagementTimelineProjectionRowsForResource(ctx, tx, companyID, EntityTypeLogicGate, logicGateID)
	if err != nil {
		return nil, err
	}
	projectRelationshipBefore, err := projectRelationshipProjectionRowsForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return nil, err
	}

	if input.Delete {
		if err := deleteKanbanBoardProjectionForLogicGateTx(ctx, tx, companyID, logicGateID); err != nil {
			return nil, err
		}
		if err := deletePostgresGVICMatrixProjectionForLogicGateTx(ctx, tx, companyID, logicGateID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
delete from resource_gvic_effective_assignments
where company_id=$1::uuid
  and source_resource_type='logic_gate'
  and source_resource_id=$2::uuid`, companyID, logicGateID); err != nil {
			return nil, err
		}
		if err := deleteProjectManagementTimelineProjectionForLogicGateTx(ctx, tx, companyID, logicGateID); err != nil {
			return nil, err
		}
	} else {
		affected, err := postgresAffectedGVICResourceKeysTx(ctx, tx, resourceGVICKey{companyID: companyID, resourceType: EntityTypeLogicGate, resourceID: logicGateID})
		if err != nil {
			return nil, err
		}
		if _, err := syncResourceGVICEffectiveAssignmentsTx(ctx, tx, companyID, affected); err != nil {
			return nil, err
		}
		if err := syncPostgresGVICMatrixProjectionForLogicGateTx(ctx, tx, companyID, logicGateID); err != nil {
			return nil, err
		}
		if err := syncProjectManagementTimelineProjectionForLogicGateTx(ctx, tx, companyID, logicGateID); err != nil {
			return nil, err
		}
	}

	projectRelationshipDeltas, err := applyProjectRelationshipProjectionDeltaDependenciesTx(ctx, tx, ProjectRelationshipProjectionDeltaDependencyInput{
		CompanyID:   companyID,
		LogicGateID: logicGateID,
		Delete:      input.Delete,
		BeforeRows:  projectRelationshipBefore,
	})
	if err != nil {
		return nil, err
	}

	kanbanAfter, err := postgresKanbanProjectionRowsForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	GVICMatrixAfter, err := postgresGVICMatrixProjectionRowsForLogicGateTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	gvicAfterDomain, err := postgresResourceGVICEffectiveAssignmentsForResource(ctx, tx, resourceGVICKey{companyID: companyID, resourceType: EntityTypeLogicGate, resourceID: logicGateID})
	if err != nil {
		return nil, err
	}
	gvicAfter := make([]GVICEffectiveAssignmentProjectionRow, 0, len(gvicAfterDomain))
	for _, item := range gvicAfterDomain {
		gvicAfter = append(gvicAfter, gvicEffectiveProjectionRowFromDomain(item))
	}
	projectManagementAfter, err := projectManagementTimelineProjectionRowsForResource(ctx, tx, companyID, EntityTypeLogicGate, logicGateID)
	if err != nil {
		return nil, err
	}

	deltas := diffKanbanProjectionRows(kanbanBefore, kanbanAfter)
	deltas = append(deltas, diffGVICMatrixProjectionRows(GVICMatrixBefore, GVICMatrixAfter)...)
	deltas = append(deltas, diffGVICEffectiveProjectionRows(gvicBefore, gvicAfter)...)
	deltas = append(deltas, diffProjectManagementProjectionRows(projectManagementBefore, projectManagementAfter)...)
	deltas = append(deltas, projectRelationshipDeltas...)
	for _, nodeID := range cleanUUIDTextSlice(input.AffectedNodeIDs) {
		nodeDeltas, err := applyNodeProjectionDeltaDependenciesTx(ctx, tx, NodeProjectionDeltaDependencyInput{
			CompanyID: companyID,
			NodeID:    nodeID,
		})
		if err != nil {
			return nil, err
		}
		deltas = append(deltas, nodeDeltas...)
	}
	return deltas, nil
}

func applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx(ctx context.Context, tx *sql.Tx, input NodeLogicGateAssignmentProjectionDeltaDependencyInput) ([]ProjectionDelta, error) {
	companyID := cleanUUIDText(input.CompanyID)
	nodeID := cleanUUIDText(input.NodeID)
	assignmentID := cleanUUIDText(input.AssignmentID)
	if companyID == "" || (nodeID == "" && assignmentID == "") {
		return nil, ErrInvalid
	}
	if nodeID != "" {
		return applyNodeProjectionDeltaDependenciesTx(ctx, tx, NodeProjectionDeltaDependencyInput{
			CompanyID: companyID,
			NodeID:    nodeID,
		})
	}
	projectRelationshipDeltas, err := applyProjectRelationshipProjectionDeltaDependenciesTx(ctx, tx, ProjectRelationshipProjectionDeltaDependencyInput{
		CompanyID:    companyID,
		AssignmentID: assignmentID,
	})
	if err != nil {
		return nil, err
	}
	return projectRelationshipDeltas, nil
}

func applyProjectProjectionDeltaDependenciesTx(ctx context.Context, tx *sql.Tx, input ProjectProjectionDeltaDependencyInput) ([]ProjectionDelta, error) {
	_ = ctx
	_ = tx
	if cleanUUIDText(input.CompanyID) == "" || cleanUUIDText(input.ProjectID) == "" {
		return nil, ErrInvalid
	}
	// Project editor information writes own their source row, project_projection_table row,
	// and editor projection event directly in the same transaction; there is no dependent
	// projection fanout to apply here yet.
	return nil, nil
}

func applyResourcePermissionProjectionDeltaDependenciesTx(ctx context.Context, tx *sql.Tx, input ResourcePermissionProjectionDeltaDependencyInput) ([]ProjectionDelta, error) {
	resourceType, ok := NormalizeEntityType(input.ResourceType)
	companyID := cleanUUIDText(input.CompanyID)
	resourceID := cleanUUIDText(input.ResourceID)
	if companyID == "" || resourceID == "" || !ok {
		return nil, ErrInvalid
	}
	var rows []ProjectRelationshipProjectionRow
	var err error
	switch resourceType {
	case EntityTypeNode:
		rows, err = projectRelationshipProjectionRowsForNodeTx(ctx, tx, companyID, resourceID)
	case EntityTypeLogicGate:
		rows, err = projectRelationshipProjectionRowsForLogicGateTx(ctx, tx, companyID, resourceID)
	case EntityTypeProject:
		rows, err = projectRelationshipProjectionRowsForProjectTx(ctx, tx, companyID, resourceID)
	default:
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return ProjectRelationshipProjectionUpsertDeltas(rows), nil
}

func applyProjectRelationshipProjectionDeltaDependenciesTx(ctx context.Context, tx *sql.Tx, input ProjectRelationshipProjectionDeltaDependencyInput) ([]ProjectionDelta, error) {
	companyID := cleanUUIDText(input.CompanyID)
	relationshipID := cleanUUIDText(input.RelationshipID)
	nodeID := cleanUUIDText(input.NodeID)
	logicGateID := cleanUUIDText(input.LogicGateID)
	assignmentID := cleanUUIDText(input.AssignmentID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	var before []ProjectRelationshipProjectionRow
	var err error
	if len(input.BeforeRows) > 0 {
		before = cloneProjectRelationshipProjectionRows(input.BeforeRows)
	} else {
		before, err = projectRelationshipProjectionRowsForDependencyKeyTx(ctx, tx, companyID, relationshipID, nodeID, logicGateID, assignmentID)
		if err != nil {
			return nil, err
		}
	}
	gvicNodeSet := map[string]bool{}
	gvicLogicGateSet := map[string]bool{}
	addProjectRelationshipGVICMatrixResourceIDs(gvicNodeSet, gvicLogicGateSet, before)
	if nodeID != "" {
		gvicNodeSet[nodeID] = true
	}
	if logicGateID != "" {
		gvicLogicGateSet[logicGateID] = true
	}
	if relationshipID != "" && !input.Delete {
		resourceType, resourceID, err := projectRelationshipSourceResourceTx(ctx, tx, companyID, relationshipID)
		if err != nil {
			return nil, err
		}
		switch resourceType {
		case EntityTypeNode:
			gvicNodeSet[resourceID] = true
		case EntityTypeLogicGate:
			gvicLogicGateSet[resourceID] = true
		}
	}
	gvicNodeIDs := mapKeys(gvicNodeSet)
	gvicLogicGateIDs := mapKeys(gvicLogicGateSet)
	gvicBefore, err := postgresGVICMatrixProjectionRowsForResourcesTx(ctx, tx, companyID, gvicNodeIDs, gvicLogicGateIDs)
	if err != nil {
		return nil, err
	}

	switch {
	case input.Delete:
		switch {
		case relationshipID != "":
			if err := deleteProjectRelationshipProjectionForRelationshipTx(ctx, tx, companyID, relationshipID); err != nil {
				return nil, err
			}
		case nodeID != "":
			if err := deleteProjectRelationshipProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
				return nil, err
			}
		case logicGateID != "":
			if err := deleteProjectRelationshipProjectionForLogicGateTx(ctx, tx, companyID, logicGateID); err != nil {
				return nil, err
			}
		case assignmentID != "":
			if err := deleteProjectRelationshipProjectionForAssignmentTx(ctx, tx, companyID, assignmentID); err != nil {
				return nil, err
			}
		default:
			return nil, ErrInvalid
		}
	case relationshipID != "":
		if err := syncProjectRelationshipProjectionForRelationshipTx(ctx, tx, companyID, relationshipID); err != nil {
			return nil, err
		}
	case nodeID != "":
		if err := syncProjectRelationshipProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return nil, err
		}
	case logicGateID != "":
		if err := syncProjectRelationshipProjectionForLogicGateTx(ctx, tx, companyID, logicGateID); err != nil {
			return nil, err
		}
	case assignmentID != "":
		if err := syncProjectRelationshipProjectionForNodeLogicGateAssignmentTx(ctx, tx, companyID, assignmentID); err != nil {
			return nil, err
		}
	default:
		return nil, ErrInvalid
	}

	after, err := projectRelationshipProjectionRowsAfterDependencyTx(ctx, tx, companyID, relationshipID, nodeID, logicGateID, assignmentID, before)
	if err != nil {
		return nil, err
	}
	addProjectRelationshipGVICMatrixResourceIDs(gvicNodeSet, gvicLogicGateSet, after)
	gvicNodeIDs = mapKeys(gvicNodeSet)
	gvicLogicGateIDs = mapKeys(gvicLogicGateSet)
	if err := syncPostgresGVICMatrixProjectionForProjectResourcesTx(ctx, tx, companyID, gvicNodeIDs, gvicLogicGateIDs); err != nil {
		return nil, err
	}
	gvicAfter, err := postgresGVICMatrixProjectionRowsForResourcesTx(ctx, tx, companyID, gvicNodeIDs, gvicLogicGateIDs)
	if err != nil {
		return nil, err
	}
	deltas := diffProjectRelationshipProjectionRows(before, after)
	deltas = append(deltas, diffGVICMatrixProjectionRows(gvicBefore, gvicAfter)...)
	return deltas, nil
}

func addProjectRelationshipGVICMatrixResourceIDs(nodeSet, logicGateSet map[string]bool, rows []ProjectRelationshipProjectionRow) {
	for _, row := range rows {
		resourceType := strings.TrimSpace(row.ResourceType)
		resourceID := strings.TrimSpace(row.ResourceID)
		switch resourceType {
		case EntityTypeNode:
			if resourceID != "" {
				nodeSet[resourceID] = true
			}
		case EntityTypeLogicGate:
			if resourceID != "" {
				logicGateSet[resourceID] = true
			}
		}
	}
}

func projectRelationshipSourceResourceTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID string) (string, string, error) {
	var resourceType string
	var resourceID string
	err := tx.QueryRowContext(ctx, `
select resource_type, resource_id::text
from project_relationships
where company_id=$1::uuid
  and relationship_id=$2::uuid`, companyID, relationshipID).Scan(&resourceType, &resourceID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", err
	}
	return strings.TrimSpace(resourceType), strings.TrimSpace(resourceID), nil
}

func syncProjectRelationshipProjectionForRelationshipTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID string) error {
	companyID = cleanUUIDText(companyID)
	relationshipID = cleanUUIDText(relationshipID)
	if companyID == "" || relationshipID == "" {
		return ErrInvalid
	}
	return syncProjectRelationshipProjectionForPredicateTx(
		ctx,
		tx,
		companyID,
		"relationship.relationship_id=$2::uuid",
		"projection.relationship_id=$2::uuid",
		relationshipID,
	)
}

func syncProjectRelationshipProjectionForNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if companyID == "" || nodeID == "" {
		return ErrInvalid
	}
	return syncProjectRelationshipProjectionForPredicateTx(
		ctx,
		tx,
		companyID,
		"relationship.resource_type='node' and relationship.resource_id=$2::uuid",
		"projection.node_id=$2::uuid",
		nodeID,
	)
}

func syncProjectRelationshipProjectionForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" {
		return ErrInvalid
	}
	return syncProjectRelationshipProjectionForPredicateTx(
		ctx,
		tx,
		companyID,
		"(relationship.resource_type='logic_gate' and relationship.resource_id=$2::uuid) or (relationship.resource_type='node' and node_assignment.logic_gate_id=$2::uuid)",
		"projection.logic_gate_id=$2::uuid or (projection.resource_type='logic_gate' and projection.resource_id=$2::uuid)",
		logicGateID,
	)
}

func syncProjectRelationshipProjectionForNodeLogicGateAssignmentTx(ctx context.Context, tx *sql.Tx, companyID, assignmentID string) error {
	companyID = cleanUUIDText(companyID)
	assignmentID = cleanUUIDText(assignmentID)
	if companyID == "" || assignmentID == "" {
		return ErrInvalid
	}
	nodeIDs, err := projectRelationshipProjectionNodeIDsForAssignmentDependencyTx(ctx, tx, companyID, assignmentID)
	if err != nil {
		return err
	}
	for _, nodeID := range nodeIDs {
		if err := syncProjectRelationshipProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return err
		}
	}
	return nil
}

func deleteProjectRelationshipProjectionForRelationshipTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID string) error {
	companyID = cleanUUIDText(companyID)
	relationshipID = cleanUUIDText(relationshipID)
	if companyID == "" || relationshipID == "" {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `
delete from project_relationship_projection
where company_id=$1::uuid
  and relationship_id=$2::uuid`, companyID, relationshipID)
	return err
}

func deleteProjectRelationshipProjectionForNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if companyID == "" || nodeID == "" {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `
delete from project_relationship_projection
where company_id=$1::uuid
  and node_id=$2::uuid`, companyID, nodeID)
	return err
}

func deleteProjectRelationshipProjectionForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `
delete from project_relationship_projection
where company_id=$1::uuid
  and logic_gate_id=$2::uuid`, companyID, logicGateID)
	return err
}

func deleteProjectRelationshipProjectionForAssignmentTx(ctx context.Context, tx *sql.Tx, companyID, assignmentID string) error {
	companyID = cleanUUIDText(companyID)
	assignmentID = cleanUUIDText(assignmentID)
	if companyID == "" || assignmentID == "" {
		return ErrInvalid
	}
	_, err := tx.ExecContext(ctx, `
delete from project_relationship_projection
where company_id=$1::uuid
  and assignment_id=$2::uuid`, companyID, assignmentID)
	return err
}

func syncProjectRelationshipProjectionForPredicateTx(ctx context.Context, tx *sql.Tx, companyID, sourcePredicate, projectionPredicate string, keyValue string) error {
	query := `
with source as (
  select
    relationship.company_id,
    relationship.project_id,
    relationship.relationship_id,
    relationship.resource_type,
    relationship.resource_id,
    case
      when relationship.resource_type='logic_gate' then relationship.resource_id
      else node_assignment.logic_gate_id
    end as logic_gate_id,
    case when relationship.resource_type='node' then relationship.resource_id end as node_id,
    case when relationship.resource_type='node' then node_assignment.assignment_id end as assignment_id,
    coalesce(nullif(gate.header, ''), nullif(node_row.name, ''), relationship.resource_id::text) as display_title,
    case when relationship.resource_type='logic_gate' then 'Logic Gate' else nullif(node_row.status, '') end as status,
    relationship.position,
    coalesce(gate.created_timestamp, node_row.created_timestamp) as resource_created_timestamp,
    relationship.created_timestamp as relationship_created_timestamp,
    relationship.updated_timestamp as relationship_updated_timestamp
  from project_relationships relationship
  left join logic_gates gate
    on gate.company_id=relationship.company_id
   and gate.logic_gate_id=relationship.resource_id
   and relationship.resource_type='logic_gate'
  left join nodes node_row
    on node_row.company_id=relationship.company_id
   and node_row.node_id=relationship.resource_id
   and relationship.resource_type='node'
  left join lateral (
    select assignment.assignment_id, assignment.logic_gate_id
    from node_logic_gate_assignments assignment
    where assignment.company_id=relationship.company_id
      and assignment.node_id=relationship.resource_id
    order by assignment.updated_timestamp desc, assignment.created_timestamp desc, assignment.assignment_id desc
    limit 1
  ) node_assignment on relationship.resource_type='node'
  where relationship.company_id=$1::uuid
    and (` + sourcePredicate + `)
    and (
      (relationship.resource_type='logic_gate' and gate.logic_gate_id is not null)
      or (relationship.resource_type='node' and node_row.node_id is not null)
    )
),
deleted_stale as (
  delete from project_relationship_projection projection
  where projection.company_id=$1::uuid
    and (` + projectionPredicate + `)
    and not exists (
      select 1
      from source
      where source.relationship_id=projection.relationship_id
    )
)
insert into project_relationship_projection (
  company_id,
  project_id,
  relationship_id,
  resource_type,
  resource_id,
  logic_gate_id,
  node_id,
  assignment_id,
  display_title,
  status,
  position,
  resource_created_timestamp,
  relationship_created_timestamp,
  relationship_updated_timestamp,
  projection_updated_timestamp
)
select
  company_id,
  project_id,
  relationship_id,
  resource_type,
  resource_id,
  logic_gate_id,
  node_id,
  assignment_id,
  display_title,
  status,
  position,
  resource_created_timestamp,
  relationship_created_timestamp,
  relationship_updated_timestamp,
  now()
from source
on conflict (company_id, relationship_id)
do update set
  project_id=excluded.project_id,
  resource_type=excluded.resource_type,
  resource_id=excluded.resource_id,
  logic_gate_id=excluded.logic_gate_id,
  node_id=excluded.node_id,
  assignment_id=excluded.assignment_id,
  display_title=excluded.display_title,
  status=excluded.status,
  position=excluded.position,
  resource_created_timestamp=excluded.resource_created_timestamp,
  relationship_created_timestamp=excluded.relationship_created_timestamp,
  relationship_updated_timestamp=excluded.relationship_updated_timestamp,
  projection_updated_timestamp=now()`
	_, err := tx.ExecContext(ctx, query, companyID, keyValue)
	return err
}

func projectRelationshipProjectionRowsForDependencyKeyTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID, nodeID, logicGateID, assignmentID string) ([]ProjectRelationshipProjectionRow, error) {
	switch {
	case relationshipID != "":
		return projectRelationshipProjectionRowsForRelationshipTx(ctx, tx, companyID, relationshipID)
	case nodeID != "":
		return projectRelationshipProjectionRowsForNodeTx(ctx, tx, companyID, nodeID)
	case logicGateID != "":
		return projectRelationshipProjectionRowsForLogicGateTx(ctx, tx, companyID, logicGateID)
	case assignmentID != "":
		return projectRelationshipProjectionRowsForAssignmentTx(ctx, tx, companyID, assignmentID)
	default:
		return nil, ErrInvalid
	}
}

func projectRelationshipProjectionRowsAfterDependencyTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID, nodeID, logicGateID, assignmentID string, before []ProjectRelationshipProjectionRow) ([]ProjectRelationshipProjectionRow, error) {
	if assignmentID == "" {
		return projectRelationshipProjectionRowsForDependencyKeyTx(ctx, tx, companyID, relationshipID, nodeID, logicGateID, assignmentID)
	}
	nodeIDs := map[string]bool{}
	for _, row := range before {
		if row.NodeID != "" {
			nodeIDs[row.NodeID] = true
		}
	}
	currentNodeIDs, err := projectRelationshipProjectionNodeIDsForAssignmentDependencyTx(ctx, tx, companyID, assignmentID)
	if err != nil {
		return nil, err
	}
	for _, currentNodeID := range currentNodeIDs {
		nodeIDs[currentNodeID] = true
	}
	ordered := make([]string, 0, len(nodeIDs))
	for currentNodeID := range nodeIDs {
		ordered = append(ordered, currentNodeID)
	}
	sort.Strings(ordered)
	rows := make([]ProjectRelationshipProjectionRow, 0)
	for _, currentNodeID := range ordered {
		nodeRows, err := projectRelationshipProjectionRowsForNodeTx(ctx, tx, companyID, currentNodeID)
		if err != nil {
			return nil, err
		}
		rows = append(rows, nodeRows...)
	}
	return rows, nil
}

func projectRelationshipProjectionRowsForRelationshipTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID string) ([]ProjectRelationshipProjectionRow, error) {
	return projectRelationshipProjectionRowsForQueryTx(ctx, tx, projectRelationshipProjectionSelectSQL+`
where projection.company_id=$1::uuid
  and projection.relationship_id=$2::uuid
order by projection.project_id, projection.relationship_id`, companyID, relationshipID)
}

func projectRelationshipProjectionRowsForProjectTx(ctx context.Context, tx *sql.Tx, companyID, projectID string) ([]ProjectRelationshipProjectionRow, error) {
	return projectRelationshipProjectionRowsForQueryTx(ctx, tx, projectRelationshipProjectionSelectSQL+`
where projection.company_id=$1::uuid
  and projection.project_id=$2::uuid
order by projection.project_id, projection.relationship_id`, companyID, projectID)
}

func projectRelationshipProjectionRowsForNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) ([]ProjectRelationshipProjectionRow, error) {
	return projectRelationshipProjectionRowsForQueryTx(ctx, tx, projectRelationshipProjectionSelectSQL+`
where projection.company_id=$1::uuid
  and projection.node_id=$2::uuid
order by projection.project_id, projection.relationship_id`, companyID, nodeID)
}

func projectRelationshipProjectionRowsForLogicGateTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) ([]ProjectRelationshipProjectionRow, error) {
	return projectRelationshipProjectionRowsForQueryTx(ctx, tx, projectRelationshipProjectionSelectSQL+`
where projection.company_id=$1::uuid
  and projection.logic_gate_id=$2::uuid
order by projection.project_id, projection.relationship_id`, companyID, logicGateID)
}

func projectRelationshipProjectionRowsForAssignmentTx(ctx context.Context, tx *sql.Tx, companyID, assignmentID string) ([]ProjectRelationshipProjectionRow, error) {
	return projectRelationshipProjectionRowsForQueryTx(ctx, tx, projectRelationshipProjectionSelectSQL+`
where projection.company_id=$1::uuid
  and projection.assignment_id=$2::uuid
order by projection.project_id, projection.relationship_id`, companyID, assignmentID)
}

func projectRelationshipProjectionRowsForQueryTx(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]ProjectRelationshipProjectionRow, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ProjectRelationshipProjectionRow, 0)
	for rows.Next() {
		item, err := scanProjectRelationshipProjection(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, projectRelationshipProjectionRowFromDomain(item))
	}
	return items, rows.Err()
}

func projectRelationshipProjectionNodeIDsForAssignmentDependencyTx(ctx context.Context, tx *sql.Tx, companyID, assignmentID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `
select node_id::text
from node_logic_gate_assignments
where company_id=$1::uuid
  and assignment_id=$2::uuid
union
select node_id::text
from project_relationship_projection
where company_id=$1::uuid
  and assignment_id=$2::uuid
  and node_id is not null
order by 1`, companyID, assignmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nodeIDs := make([]string, 0)
	for rows.Next() {
		var nodeID string
		if err := rows.Scan(&nodeID); err != nil {
			return nil, err
		}
		nodeID = strings.TrimSpace(nodeID)
		if nodeID != "" {
			nodeIDs = append(nodeIDs, nodeID)
		}
	}
	return nodeIDs, rows.Err()
}

func projectRelationshipProjectionRowFromDomain(item domain.ProjectRelationshipProjection) ProjectRelationshipProjectionRow {
	row := ProjectRelationshipProjectionRow{
		CompanyID:                    strings.TrimSpace(item.CompanyID),
		ProjectID:                    strings.TrimSpace(item.ProjectID),
		ProjectName:                  strings.TrimSpace(item.ProjectName),
		RelationshipID:               strings.TrimSpace(item.RelationshipID),
		ResourceType:                 strings.TrimSpace(item.ResourceType),
		ResourceID:                   strings.TrimSpace(item.ResourceID),
		LogicGateID:                  cloneStringPointer(item.LogicGateID),
		NodeID:                       strings.TrimSpace(pointerStringValue(item.NodeID)),
		AssignmentID:                 strings.TrimSpace(pointerStringValue(item.AssignmentID)),
		DisplayTitle:                 strings.TrimSpace(item.DisplayTitle),
		Status:                       cloneStringPointer(item.Status),
		Position:                     item.Position,
		ResourceCreatedTimestamp:     item.ResourceCreatedTimestamp,
		RelationshipCreatedTimestamp: item.RelationshipCreatedTimestamp,
		RelationshipUpdatedTimestamp: item.RelationshipUpdatedTimestamp,
		ProjectionUpdatedTimestamp:   item.ProjectionUpdatedTimestamp,
	}
	row.CreatedTimestamp = item.RelationshipCreatedTimestamp
	row.UpdatedTimestamp = item.RelationshipUpdatedTimestamp
	return row
}
