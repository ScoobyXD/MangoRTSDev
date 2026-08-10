package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) CreateNodeAssociatedWithProject(input ProjectScopedNodeCreateInput) (ProjectScopedNodeCreateResult, error) {
	input, err := NormalizeProjectScopedNodeCreateInput(input)
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	defer tx.Rollback()

	result, err := r.createNodeAssociatedWithProjectTx(ctx, tx, input)
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) CreateLogicGateAssociatedWithProject(input ProjectScopedLogicGateCreateInput) (ProjectScopedLogicGateCreateResult, error) {
	return ProjectScopedLogicGateCreateResult{}, ErrDirectProjectLogicGate
}
func (r *PostgresRepo) createNodeAssociatedWithProjectTx(ctx context.Context, tx *sql.Tx, input ProjectScopedNodeCreateInput) (ProjectScopedNodeCreateResult, error) {
	if err := ensureProjectExistsForScopedCreateTx(ctx, tx, input.CompanyID, input.ProjectID); err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	node, err := r.createNodeWithIDProjectionAndFolderTx(ctx, tx, input.CompanyID, input.NodeID, input.Title, false, true)
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	var information *domain.NodeInformation
	if input.InitialInformation != nil {
		item, err := r.addInitialNodeInformationTx(ctx, tx, NodeInformationInput{
			CompanyID:        input.CompanyID,
			NodeID:           node.NodeID,
			Type:             input.InitialInformation.Type,
			Information:      input.InitialInformation.Information,
			InformationID:    input.InitialInformation.InformationID,
			ActorUserID:      input.ActorUserID,
			ActorDisplayName: input.ActorDisplayName,
		})
		if err != nil {
			return ProjectScopedNodeCreateResult{}, err
		}
		information = &item
	}
	var assignment *domain.NodeLogicGateAssignment
	var card *domain.KanbanCard
	assignmentEvents := make([]domain.DomainEvent, 0)
	if input.InitialAssignment != nil {
		assignmentInput := LogicGateNodeAssignmentInput{
			CompanyID:      input.CompanyID,
			LogicGateID:    input.InitialAssignment.LogicGateID,
			NodeID:         node.NodeID,
			Status:         input.InitialAssignment.Status,
			ColumnID:       input.InitialAssignment.ColumnID,
			Position:       input.InitialAssignment.Position,
			Priority:       input.InitialAssignment.Priority,
			PrioritySet:    input.InitialAssignment.Priority != nil,
			ActorUserID:    input.ActorUserID,
			IdempotencyKey: input.IdempotencyKey,
		}
		if input.InitialAssignment.IsIssue != nil {
			assignmentInput.IsIssue = *input.InitialAssignment.IsIssue
			assignmentInput.IsIssueSet = true
		}
		assignmentInput, err = NormalizeLogicGateNodeAssignmentInput(assignmentInput)
		if err != nil {
			return ProjectScopedNodeCreateResult{}, err
		}
		assignmentResult, err := r.assignNodeToLogicGateStatusTx(ctx, tx, assignmentInput)
		if err != nil {
			return ProjectScopedNodeCreateResult{}, err
		}
		node = assignmentResult.Node
		assignment = &assignmentResult.Assignment
		cardValue := assignmentResult.Card
		card = &cardValue
		assignmentEvents = append(assignmentEvents, assignmentResult.Events...)
	}
	gateRelationshipID, err := upsertProjectRelationshipSourceTx(ctx, tx, ProjectRelationshipInput{
		CompanyID: input.CompanyID, ProjectID: input.ProjectID, ResourceType: EntityTypeLogicGate,
		ResourceID: input.InitialAssignment.LogicGateID, Position: input.Position,
	})
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	if err := syncProjectRelationshipProjectionDependenciesTx(ctx, tx, ProjectRelationshipProjectionDependencyInput{CompanyID: input.CompanyID, RelationshipID: gateRelationshipID}); err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	gateProjection, err := projectRelationshipProjectionByIDTx(ctx, tx, input.CompanyID, gateRelationshipID)
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	relationshipID, err := insertProjectRelationshipForScopedCreateTx(ctx, tx, ProjectRelationshipInput{
		CompanyID:    input.CompanyID,
		ProjectID:    input.ProjectID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Position:     input.Position,
	})
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	err = syncNodeProjectionDependenciesTx(ctx, tx, NodeProjectionDependencyInput{
		CompanyID: input.CompanyID,
		NodeID:    node.NodeID,
	})
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	err = syncProjectRelationshipProjectionDependenciesTx(ctx, tx, ProjectRelationshipProjectionDependencyInput{
		CompanyID:      input.CompanyID,
		RelationshipID: relationshipID,
	})
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	projection, err := projectRelationshipProjectionByIDTx(ctx, tx, input.CompanyID, relationshipID)
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{
		nodeCreatedWorkspaceEventInputWithMetadata(node, meta),
		projectRelationshipUpsertedWorkspaceEventInput(gateProjection, input.ActorUserID),
		projectRelationshipUpsertedWorkspaceEventInput(projection, input.ActorUserID),
	})
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	events = append(assignmentEvents, events...)
	return ProjectScopedNodeCreateResult{
		Node:                  node,
		Relationship:          &projection,
		ImplicitRelationships: []domain.ProjectRelationshipProjection{gateProjection},
		Information:           information,
		Assignment:            assignment,
		Card:                  card,
		Events:                events,
	}, nil
}

func ensureProjectExistsForScopedCreateTx(ctx context.Context, tx *sql.Tx, companyID, projectID string) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from projects
  where company_id=$1::uuid
    and project_id=$2::uuid
)`, companyID, projectID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func insertProjectRelationshipForScopedCreateTx(ctx context.Context, tx *sql.Tx, input ProjectRelationshipInput) (string, error) {
	relationshipID := newUUIDv7String()
	if err := tx.QueryRowContext(ctx, `
insert into project_relationships (
  company_id, relationship_id, project_id, resource_type, resource_id, position, created_timestamp, updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, now(), now())
returning relationship_id::text`, input.CompanyID, relationshipID, input.ProjectID, input.ResourceType, input.ResourceID, input.Position).Scan(&relationshipID); err != nil {
		return "", err
	}
	if input.ResourceType == EntityTypeNode {
		if _, err := tx.ExecContext(ctx, `select mangorts_bump_logic_gate_work_versions_for_node($1::uuid, $2::uuid)`, input.CompanyID, input.ResourceID); err != nil {
			return "", err
		}
	}
	return relationshipID, nil
}
func (r *PostgresRepo) addInitialNodeInformationTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput) (domain.NodeInformation, error) {
	companyID := cleanUUIDText(input.CompanyID)
	nodeID := cleanUUIDText(input.NodeID)
	if companyID == "" || nodeID == "" || !isEditorTextBoxType(input.Type) {
		return domain.NodeInformation{}, ErrInvalid
	}
	keyValue := cleanUUIDText(input.InformationID)
	if keyValue == "" {
		keyValue = newUUIDv7String()
	}
	body, title, color, err := nodeTextboxFromProjectionInformation(input.Information)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	if _, err := tx.ExecContext(ctx, `insert into node_textboxes(
  company_id,node_id,textbox_id,body_json,title,color,revision,display_order,created_timestamp,updated_timestamp
) values($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5,$6,1,0,now(),now())`, companyID, nodeID, keyValue, body, title, color); err != nil {
		return domain.NodeInformation{}, err
	}
	projection, found, err := postgresNodeFinalProjectionTx(ctx, tx, companyID, nodeID, keyValue)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	if !found {
		return domain.NodeInformation{}, ErrNotFound
	}
	return nodeProjectionAsInformation(projection), nil
}

func projectRelationshipUpsertedWorkspaceEventInput(item domain.ProjectRelationshipProjection, actorUserID string) DomainEventInput {
	nodeID := ""
	if item.NodeID != nil {
		nodeID = strings.TrimSpace(*item.NodeID)
	}
	logicGateID := ""
	if item.LogicGateID != nil {
		logicGateID = strings.TrimSpace(*item.LogicGateID)
	}
	input := workspaceDomainEventInput(item.CompanyID, "project_relationship_upserted", map[string]any{
		"project_id":    item.ProjectID,
		"relationship":  item,
		"resource_type": item.ResourceType,
		"resource_id":   item.ResourceID,
		"node_id":       nodeID,
		"logic_gate_id": logicGateID,
	})
	input.ActorUserID = strings.TrimSpace(actorUserID)
	return input
}
