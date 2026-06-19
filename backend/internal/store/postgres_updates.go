package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *PostgresRepo) ListUpdateRootGroups(input UpdatesQuery) ([]UpdatesNestedGroup, error) {
	items, ctx, err := r.listPostgresUpdatesForQuery(input)
	if err != nil {
		return nil, err
	}
	return buildUpdateRootGroups(items, ctx), nil
}

func (r *PostgresRepo) ListUpdateBranch(input UpdatesQuery) (UpdatesNestedGroup, error) {
	items, ctx, err := r.listPostgresUpdatesForQuery(input)
	if err != nil {
		return UpdatesNestedGroup{}, err
	}
	return buildUpdateBranch(items, ctx, input.RootID)
}

func (r *PostgresRepo) listPostgresUpdatesForQuery(input UpdatesQuery) ([]domain.Notification, updatesBuildContext, error) {
	input.UserID = cleanUUIDText(input.UserID)
	input.CompanyID = cleanUUIDText(input.CompanyID)
	filter, ok := normalizeUpdatesFilter(input.Filter)
	if input.UserID == "" || input.CompanyID == "" || !ok {
		return nil, updatesBuildContext{}, ErrInvalid
	}
	items, err := r.listPostgresUpdatesNotifications(context.Background(), input, filter)
	if err != nil {
		return nil, updatesBuildContext{}, err
	}
	ctx, err := r.postgresUpdatesBuildContext(context.Background(), input, items)
	if err != nil {
		return nil, updatesBuildContext{}, err
	}
	return items, ctx, nil
}

func (r *PostgresRepo) listPostgresUpdatesNotifications(ctx context.Context, input UpdatesQuery, filter string) ([]domain.Notification, error) {
	rows, err := r.db.QueryContext(ctx, `
select `+notificationSelectColumns+`
from notifications
where recipient_user_id=$1::uuid
  and company_id=$2::uuid
  and (
    $3 = 'all'
    or ($3 = 'urgent' and notification_type = $4)
    or ($3 = 'mention' and notification_type = $5)
    or ($3 = 'update' and notification_type <> $4 and notification_type <> $5)
  )`+notificationRecipientVisibilityWhereSQL+`
order by created_timestamp desc, notification_id desc`,
		input.UserID, input.CompanyID, filter, domain.NotificationEventUrgentMentionCreated, domain.NotificationEventMentionCreated)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.Notification, 0)
	for rows.Next() {
		item, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) postgresUpdatesBuildContext(ctx context.Context, input UpdatesQuery, items []domain.Notification) (updatesBuildContext, error) {
	build := updatesBuildContext{
		NodeLabels:               map[string]string{},
		LogicGateLabels:          map[string]string{},
		ProjectLabels:            map[string]string{},
		NodeLogicGateIDs:         map[string]string{},
		NodeProjectContexts:      map[string][]updatesProjectContext{},
		LogicGateProjectContexts: map[string][]updatesProjectContext{},
	}
	nodeIDs, logicGateIDs, projectIDs := collectUpdateResourceIDs(items)
	if err := r.addPostgresUpdateNodeAssignments(ctx, input.CompanyID, nodeIDs, logicGateIDs, build.NodeLogicGateIDs); err != nil {
		return updatesBuildContext{}, err
	}
	if err := r.addPostgresUpdateNodeLabels(ctx, input.CompanyID, nodeIDs, build.NodeLabels); err != nil {
		return updatesBuildContext{}, err
	}
	if err := r.addPostgresUpdateLogicGateLabels(ctx, input.CompanyID, logicGateIDs, build.LogicGateLabels); err != nil {
		return updatesBuildContext{}, err
	}
	if err := r.addPostgresUpdateProjectLabels(ctx, input.CompanyID, projectIDs, build.ProjectLabels); err != nil {
		return updatesBuildContext{}, err
	}
	if err := r.addPostgresUpdateProjectContexts(ctx, input.CompanyID, input.UserID, nodeIDs, logicGateIDs, build); err != nil {
		return updatesBuildContext{}, err
	}
	return build, nil
}

func collectUpdateResourceIDs(items []domain.Notification) (map[string]bool, map[string]bool, map[string]bool) {
	nodeIDs := map[string]bool{}
	logicGateIDs := map[string]bool{}
	projectIDs := map[string]bool{}
	for _, item := range items {
		nodeID := strings.TrimSpace(item.NodeID)
		if nodeID == "" && strings.TrimSpace(item.EntityType) == EntityTypeNode {
			nodeID = strings.TrimSpace(item.EntityID)
		}
		if nodeID != "" {
			nodeIDs[nodeID] = true
		}
		logicGateID := strings.TrimSpace(item.LogicGateID)
		if logicGateID == "" && strings.TrimSpace(item.EntityType) == EntityTypeLogicGate {
			logicGateID = strings.TrimSpace(item.EntityID)
		}
		if logicGateID != "" {
			logicGateIDs[logicGateID] = true
		}
		if strings.TrimSpace(item.EntityType) == EntityTypeProject && strings.TrimSpace(item.EntityID) != "" {
			projectIDs[strings.TrimSpace(item.EntityID)] = true
		}
	}
	return nodeIDs, logicGateIDs, projectIDs
}

func (r *PostgresRepo) addPostgresUpdateNodeAssignments(ctx context.Context, companyID string, nodeIDs, logicGateIDs map[string]bool, out map[string]string) error {
	nodeIDList := strings.Join(mapKeys(nodeIDs), ",")
	if nodeIDList == "" {
		return nil
	}
	rows, err := r.db.QueryContext(ctx, `
select distinct on (node_id) node_id::text, logic_gate_id::text
from node_logic_gate_assignments
where company_id=$1::uuid
  and node_id = any(string_to_array($2, ',')::uuid[])
order by node_id, updated_timestamp desc, created_timestamp desc, assignment_id desc`, companyID, nodeIDList)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var nodeID, logicGateID string
		if err := rows.Scan(&nodeID, &logicGateID); err != nil {
			return err
		}
		out[nodeID] = logicGateID
		if logicGateID != "" {
			logicGateIDs[logicGateID] = true
		}
	}
	return rows.Err()
}

func (r *PostgresRepo) addPostgresUpdateNodeLabels(ctx context.Context, companyID string, nodeIDs map[string]bool, out map[string]string) error {
	nodeIDList := strings.Join(mapKeys(nodeIDs), ",")
	if nodeIDList == "" {
		return nil
	}
	rows, err := r.db.QueryContext(ctx, `
select node_id::text, name
from nodes
where company_id=$1::uuid
  and node_id = any(string_to_array($2, ',')::uuid[])`, companyID, nodeIDList)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, label string
		if err := rows.Scan(&id, &label); err != nil {
			return err
		}
		out[id] = label
	}
	return rows.Err()
}

func (r *PostgresRepo) addPostgresUpdateLogicGateLabels(ctx context.Context, companyID string, logicGateIDs map[string]bool, out map[string]string) error {
	logicGateIDList := strings.Join(mapKeys(logicGateIDs), ",")
	if logicGateIDList == "" {
		return nil
	}
	rows, err := r.db.QueryContext(ctx, `
select logic_gate_id::text, header
from logic_gates
where company_id=$1::uuid
  and logic_gate_id = any(string_to_array($2, ',')::uuid[])`, companyID, logicGateIDList)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, label string
		if err := rows.Scan(&id, &label); err != nil {
			return err
		}
		out[id] = label
	}
	return rows.Err()
}

func (r *PostgresRepo) addPostgresUpdateProjectLabels(ctx context.Context, companyID string, projectIDs map[string]bool, out map[string]string) error {
	projectIDList := strings.Join(mapKeys(projectIDs), ",")
	if projectIDList == "" {
		return nil
	}
	rows, err := r.db.QueryContext(ctx, `
select project_id::text, name
from projects
where company_id=$1::uuid
  and project_id = any(string_to_array($2, ',')::uuid[])`, companyID, projectIDList)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, label string
		if err := rows.Scan(&id, &label); err != nil {
			return err
		}
		out[id] = label
	}
	return rows.Err()
}

func (r *PostgresRepo) addPostgresUpdateProjectContexts(ctx context.Context, companyID, userID string, nodeIDs, logicGateIDs map[string]bool, build updatesBuildContext) error {
	nodeIDList := strings.Join(mapKeys(nodeIDs), ",")
	logicGateIDList := strings.Join(mapKeys(logicGateIDs), ",")
	if nodeIDList == "" && logicGateIDList == "" {
		return nil
	}
	rows, err := r.db.QueryContext(ctx, `
select
  relationship.project_id::text,
  coalesce(nullif(project.name, ''), relationship.project_name),
  relationship.relationship_id::text,
  relationship.node_id::text,
  relationship.logic_gate_id::text,
  relationship.position,
  relationship.relationship_created_timestamp
from project_relationship_projection relationship
join projects project
  on project.company_id=relationship.company_id
 and project.project_id=relationship.project_id
where relationship.company_id=$1::uuid
  and (
    ($2 <> '' and relationship.node_id = any(string_to_array($2, ',')::uuid[]))
    or ($3 <> '' and relationship.logic_gate_id = any(string_to_array($3, ',')::uuid[]))
  )
  and mangorts_user_can_access_resource(relationship.company_id, 'project', relationship.project_id, $4::uuid, 'view')
order by relationship.position asc, lower(coalesce(nullif(project.name, ''), relationship.project_name)) asc, relationship.relationship_created_timestamp asc, relationship.relationship_id asc`,
		companyID, nodeIDList, logicGateIDList, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var projectID, projectName, relationshipID string
		var nodeID, logicGateID sql.NullString
		var position int
		var created time.Time
		if err := rows.Scan(&projectID, &projectName, &relationshipID, &nodeID, &logicGateID, &position, &created); err != nil {
			return err
		}
		project := updatesProjectContext{
			ProjectID:    projectID,
			ProjectName:  projectName,
			Position:     position,
			Created:      created,
			Relationship: relationshipID,
		}
		build.ProjectLabels[projectID] = projectName
		if nodeID.Valid && strings.TrimSpace(nodeID.String) != "" {
			keyValue := strings.TrimSpace(nodeID.String)
			build.NodeProjectContexts[keyValue] = append(build.NodeProjectContexts[keyValue], project)
		}
		if logicGateID.Valid && strings.TrimSpace(logicGateID.String) != "" {
			keyValue := strings.TrimSpace(logicGateID.String)
			build.LogicGateProjectContexts[keyValue] = append(build.LogicGateProjectContexts[keyValue], project)
		}
	}
	return rows.Err()
}
