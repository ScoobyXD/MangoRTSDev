package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
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
	input, err := NormalizeProjectScopedLogicGateCreateInput(input)
	if err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	defer tx.Rollback()

	result, err := r.createLogicGateAssociatedWithProjectTx(ctx, tx, input)
	if err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	items, err := r.attachLogicGateGVICAssignments(ctx, input.CompanyID, []domain.LogicGate{result.LogicGate})
	if err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	result.LogicGate = items[0]
	return result, nil
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
		projectRelationshipUpsertedWorkspaceEventInput(projection, input.ActorUserID),
	})
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	events = append(assignmentEvents, events...)
	return ProjectScopedNodeCreateResult{
		Node:         node,
		Relationship: &projection,
		Information:  information,
		Assignment:   assignment,
		Card:         card,
		Events:       events,
	}, nil
}

func (r *PostgresRepo) createLogicGateAssociatedWithProjectTx(ctx context.Context, tx *sql.Tx, input ProjectScopedLogicGateCreateInput) (ProjectScopedLogicGateCreateResult, error) {
	if err := ensureProjectExistsForScopedCreateTx(ctx, tx, input.CompanyID, input.ProjectID); err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	logicGate, err := createLogicGateAssociatedWithProjectSourceTx(ctx, tx, input)
	if err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	var information *domain.LogicGateInformation
	if input.InitialInformation != nil {
		item, err := r.addInitialLogicGateInformationTx(ctx, tx, input.CompanyID, logicGate.LogicGateID, *input.InitialInformation, input.ActorUserID)
		if err != nil {
			return ProjectScopedLogicGateCreateResult{}, err
		}
		information = &item
	}
	relationshipID, err := insertProjectRelationshipForScopedCreateTx(ctx, tx, ProjectRelationshipInput{
		CompanyID:    input.CompanyID,
		ProjectID:    input.ProjectID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Position:     input.Position,
	})
	if err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	err = syncLogicGateProjectionDependenciesTx(ctx, tx, LogicGateProjectionDependencyInput{
		CompanyID:   input.CompanyID,
		LogicGateID: logicGate.LogicGateID,
	})
	if err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	err = syncProjectRelationshipProjectionDependenciesTx(ctx, tx, ProjectRelationshipProjectionDependencyInput{
		CompanyID:      input.CompanyID,
		RelationshipID: relationshipID,
	})
	if err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	projection, err := projectRelationshipProjectionByIDTx(ctx, tx, input.CompanyID, relationshipID)
	if err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{
		logicGateCreatedWorkspaceEventInput(logicGate, meta),
		projectRelationshipUpsertedWorkspaceEventInput(projection, input.ActorUserID),
	})
	if err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	return ProjectScopedLogicGateCreateResult{
		LogicGate:    logicGate,
		Relationship: &projection,
		Information:  information,
		Events:       events,
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
	return relationshipID, nil
}

func createLogicGateAssociatedWithProjectSourceTx(ctx context.Context, tx *sql.Tx, input ProjectScopedLogicGateCreateInput) (domain.LogicGate, error) {
	logicGateID := input.LogicGateID
	if logicGateID == "" {
		logicGateID = newUUIDv7String()
	}
	item := domain.LogicGate{
		CompanyID:       input.CompanyID,
		LogicGateID:     logicGateID,
		Header:          input.Header,
		DefaultAccess:   ResourceDefaultAccessEdit,
		GVICAssignments: []domain.LogicGateGVICAssignment{},
	}
	err := tx.QueryRowContext(ctx,
		`insert into logic_gates (company_id, logic_gate_id, header, created_timestamp)
		 values ($1::uuid, $2::uuid, $3, now())
		 returning company_id::text, logic_gate_id::text, header, created_timestamp`,
		item.CompanyID, item.LogicGateID, item.Header,
	).Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp)
	if err != nil {
		return domain.LogicGate{}, err
	}
	return item, nil
}

func (r *PostgresRepo) addInitialNodeInformationTx(ctx context.Context, tx *sql.Tx, input NodeInformationInput) (domain.NodeInformation, error) {
	companyID := cleanUUIDText(input.CompanyID)
	nodeID := cleanUUIDText(input.NodeID)
	infoType := strings.TrimSpace(input.Type)
	if companyID == "" || nodeID == "" || infoType == "" || strings.TrimSpace(input.Information) == "" {
		return domain.NodeInformation{}, ErrInvalid
	}
	item := domain.NodeInformation{
		CompanyID:     companyID,
		InformationID: newUUIDv7String(),
		NodeID:        nodeID,
		Type:          infoType,
		Information:   input.Information,
	}
	if err := tx.QueryRowContext(ctx,
		`insert into node_information
		 (company_id, information_id, node_id, type, information, created_timestamp, updated_timestamp)
		 values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, now(), now())
		 returning company_id::text, information_id::text, node_id::text, type::text, information, created_timestamp, updated_timestamp`,
		item.CompanyID, item.InformationID, item.NodeID, item.Type, item.Information,
	).Scan(
		&item.CompanyID,
		&item.InformationID,
		&item.NodeID,
		&item.Type,
		&item.Information,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
		return domain.NodeInformation{}, err
	}
	keyValue := cleanUUIDText(input.InformationID)
	if keyValue == "" {
		keyValue = item.InformationID
	}
	previous, previousFound, err := postgresNodeProjectionTx(ctx, tx, companyID, nodeID, keyValue)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	var projection domain.NodeProjection
	if err := tx.QueryRowContext(ctx,
		`insert into node_projection_table
		 (company_id, node_id, information_id, type, information, created_timestamp, updated_timestamp)
		 values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, now(), now())
		 on conflict (company_id, node_id, information_id)
		 do update set
		   type=excluded.type,
		   information=excluded.information,
		   updated_timestamp=now()
		 returning company_id::text, node_id::text, information_id::text, type::text, information, created_timestamp, updated_timestamp`,
		item.CompanyID, item.NodeID, keyValue, item.Type, item.Information,
	).Scan(
		&projection.CompanyID,
		&projection.NodeID,
		&projection.InformationID,
		&projection.Type,
		&projection.Information,
		&projection.CreatedTimestamp,
		&projection.UpdatedTimestamp,
	); err != nil {
		return domain.NodeInformation{}, err
	}
	if strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "" {
		var previousPtr *domain.NodeProjection
		if previousFound {
			previousPtr = &previous
		}
		if err := insertNodeContentChangesTx(ctx, tx, buildNodeContentChanges(
			companyID,
			nodeID,
			keyValue,
			infoType,
			previousPtr,
			input.Information,
			normalizeNodeContentChangeActor(cleanUUIDText(input.ActorUserID), input.ActorDisplayName),
			time.Now().UTC(),
		)); err != nil {
			return domain.NodeInformation{}, err
		}
	}
	return item, nil
}

func (r *PostgresRepo) addInitialLogicGateInformationTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string, initial ProjectScopedInitialInformationInput, actorUserID string) (domain.LogicGateInformation, error) {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	infoType := strings.TrimSpace(initial.Type)
	if companyID == "" || logicGateID == "" || infoType == "" || strings.TrimSpace(initial.Information) == "" {
		return domain.LogicGateInformation{}, ErrInvalid
	}
	item := domain.LogicGateInformation{
		CompanyID:     companyID,
		InformationID: newUUIDv7String(),
		LogicGateID:   logicGateID,
		Type:          infoType,
		Information:   initial.Information,
	}
	if err := tx.QueryRowContext(ctx,
		`insert into logic_gate_information
		 (company_id, information_id, logic_gate_id, type, information, created_timestamp, updated_timestamp)
		 values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, now(), now())
		 returning company_id::text, information_id::text, logic_gate_id::text, type::text, information, created_timestamp, updated_timestamp`,
		item.CompanyID, item.InformationID, item.LogicGateID, item.Type, item.Information,
	).Scan(
		&item.CompanyID,
		&item.InformationID,
		&item.LogicGateID,
		&item.Type,
		&item.Information,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	); err != nil {
		return domain.LogicGateInformation{}, err
	}
	projectionID := cleanUUIDText(initial.InformationID)
	if projectionID == "" {
		projectionID = item.InformationID
	}
	var projection domain.LogicGateProjection
	query := `insert into logic_gate_projection_table
		 (company_id, logic_gate_id, information_id, type, information, created_timestamp, updated_timestamp)
		 values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, now(), now())
		 on conflict (company_id, logic_gate_id, information_id)
		 do update set
		   type=excluded.type,
		   information=excluded.information,
		   updated_timestamp=now()
		 returning company_id::text, logic_gate_id::text, information_id::text, type::text, information, created_timestamp, updated_timestamp`
	if isEditorTextBoxType(item.Type) {
		query = `insert into logic_gate_projection_table
		 (company_id, logic_gate_id, information_id, type, information, created_timestamp, updated_timestamp)
		 values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, now(), now())
		 on conflict (company_id, logic_gate_id, information_id)
		 do update set
		   information=excluded.information,
		   updated_timestamp=now()
		 returning company_id::text, logic_gate_id::text, information_id::text, type::text, information, created_timestamp, updated_timestamp`
	}
	if err := tx.QueryRowContext(ctx, query, item.CompanyID, item.LogicGateID, projectionID, item.Type, item.Information).Scan(
		&projection.CompanyID,
		&projection.LogicGateID,
		&projection.InformationID,
		&projection.Type,
		&projection.Information,
		&projection.CreatedTimestamp,
		&projection.UpdatedTimestamp,
	); err != nil {
		return domain.LogicGateInformation{}, err
	}
	return item, nil
}

func projectRelationshipUpsertedWorkspaceEventInput(item domain.ProjectRelationshipProjection, actorUserID string) DomainEventInput {
	input := workspaceDomainEventInput(item.CompanyID, "project_relationship_upserted", map[string]any{
		"project_id":    item.ProjectID,
		"relationship":  item,
		"resource_type": item.ResourceType,
		"resource_id":   item.ResourceID,
	})
	input.ActorUserID = strings.TrimSpace(actorUserID)
	return input
}
