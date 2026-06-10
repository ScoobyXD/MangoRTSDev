package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

type NodeProjectionDeltaDependencyInput struct {
	CompanyID string
	NodeID    string
}

type LogicGateProjectionDeltaDependencyInput struct {
	CompanyID   string
	LogicGateID string
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
	return applyProjectRelationshipProjectionDeltaDependenciesTx(ctx, tx, ProjectRelationshipProjectionDeltaDependencyInput{
		CompanyID: input.CompanyID,
		NodeID:    input.NodeID,
	})
}

func applyLogicGateProjectionDeltaDependenciesTx(ctx context.Context, tx *sql.Tx, input LogicGateProjectionDeltaDependencyInput) ([]ProjectionDelta, error) {
	return applyProjectRelationshipProjectionDeltaDependenciesTx(ctx, tx, ProjectRelationshipProjectionDeltaDependencyInput{
		CompanyID:   input.CompanyID,
		LogicGateID: input.LogicGateID,
	})
}

func applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx(ctx context.Context, tx *sql.Tx, input NodeLogicGateAssignmentProjectionDeltaDependencyInput) ([]ProjectionDelta, error) {
	if strings.TrimSpace(input.NodeID) != "" {
		return applyProjectRelationshipProjectionDeltaDependenciesTx(ctx, tx, ProjectRelationshipProjectionDeltaDependencyInput{
			CompanyID: input.CompanyID,
			NodeID:    input.NodeID,
		})
	}
	return applyProjectRelationshipProjectionDeltaDependenciesTx(ctx, tx, ProjectRelationshipProjectionDeltaDependencyInput{
		CompanyID:    input.CompanyID,
		AssignmentID: input.AssignmentID,
	})
}

func applyProjectProjectionDeltaDependenciesTx(ctx context.Context, tx *sql.Tx, input ProjectProjectionDeltaDependencyInput) ([]ProjectionDelta, error) {
	_ = ctx
	_ = tx
	if cleanUUIDText(input.CompanyID) == "" || cleanUUIDText(input.ProjectID) == "" {
		return nil, ErrInvalid
	}
	return nil, nil
}

func applyResourcePermissionProjectionDeltaDependenciesTx(ctx context.Context, tx *sql.Tx, input ResourcePermissionProjectionDeltaDependencyInput) ([]ProjectionDelta, error) {
	_ = ctx
	_ = tx
	resourceType, ok := NormalizeEntityType(input.ResourceType)
	if cleanUUIDText(input.CompanyID) == "" || cleanUUIDText(input.ResourceID) == "" || !ok {
		return nil, ErrInvalid
	}
	input.ResourceType = resourceType
	return nil, nil
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

	switch {
	case input.Delete:
		if relationshipID == "" {
			return nil, ErrInvalid
		}
		if err := deleteProjectRelationshipProjectionForRelationshipTx(ctx, tx, companyID, relationshipID); err != nil {
			return nil, err
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
	return diffProjectRelationshipProjectionRows(before, after), nil
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
    coalesce(nullif(gate.header, ''), nullif(node_row.title, ''), relationship.resource_id::text) as display_title,
    case when relationship.resource_type='logic_gate' then 'Logic Gate' else nullif(node_row.status, '') end as status,
    case when relationship.resource_type='logic_gate' then '#8b5cf6' else nullif(node_row.status_color, '') end as status_color,
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
  status_color,
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
  status_color,
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
  status_color=excluded.status_color,
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
		StatusColor:                  cloneStringPointer(item.StatusColor),
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
