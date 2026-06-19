package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *PostgresRepo) ListUpdateRootGroups(input UpdatesQuery) ([]UpdatesNestedGroup, error) {
	input.UserID = cleanUUIDText(input.UserID)
	input.CompanyID = cleanUUIDText(input.CompanyID)
	filter, ok := normalizeUpdatesFilter(input.Filter)
	if input.UserID == "" || input.CompanyID == "" || !ok {
		return nil, ErrInvalid
	}
	return r.listPostgresUpdateRootGroups(context.Background(), input, filter)
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

func (r *PostgresRepo) listPostgresUpdateRootGroups(ctx context.Context, input UpdatesQuery, filter string) ([]UpdatesNestedGroup, error) {
	rows, err := r.db.QueryContext(ctx, `
with visible as (
  select
    notifications.*,
    coalesce(nullif(btrim(notifications.node_id), ''), case when notifications.entity_type='node' then notifications.entity_id else '' end) as target_node_id,
    coalesce(nullif(btrim(notifications.logic_gate_id), ''), case when notifications.entity_type='logic_gate' then notifications.entity_id else '' end) as target_logic_gate_id,
    case when notifications.entity_type='project' then notifications.entity_id else '' end as target_project_id
  from notifications
  where notifications.recipient_user_id=$1::uuid
    and notifications.company_id=$2::uuid
    and (
      $3 = 'all'
      or ($3 = 'urgent' and notifications.notification_type = $4)
      or ($3 = 'mention' and notifications.notification_type = $5)
      or ($3 = 'update' and notifications.notification_type <> $4 and notifications.notification_type <> $5)
    )
    and (
      case
        when notifications.entity_type='project' then mangorts_user_can_access_resource(notifications.company_id, 'project', notifications.entity_id::uuid, notifications.recipient_user_id, 'view')
        when btrim(notifications.logic_gate_id) <> '' then mangorts_user_can_access_resource(notifications.company_id, 'logic_gate', notifications.logic_gate_id::uuid, notifications.recipient_user_id, 'view')
        when btrim(notifications.node_id) <> '' then mangorts_user_can_access_resource(notifications.company_id, 'node', notifications.node_id::uuid, notifications.recipient_user_id, 'view')
        when notifications.entity_type='logic_gate' then mangorts_user_can_access_resource(notifications.company_id, 'logic_gate', notifications.entity_id::uuid, notifications.recipient_user_id, 'view')
        when notifications.entity_type='node' then mangorts_user_can_access_resource(notifications.company_id, 'node', notifications.entity_id::uuid, notifications.recipient_user_id, 'view')
        else true
      end
    )
), node_context as (
  select
    visible.*,
    coalesce(nullif(visible.target_logic_gate_id, ''), assignment.logic_gate_id::text, '') as path_logic_gate_id
  from visible
  left join lateral (
    select assignment.logic_gate_id
    from node_logic_gate_assignments assignment
    where visible.target_node_id <> ''
      and assignment.company_id=visible.company_id
      and assignment.node_id=visible.target_node_id::uuid
    order by assignment.updated_timestamp desc, assignment.created_timestamp desc, assignment.assignment_id desc
    limit 1
  ) assignment on true
), project_context as (
  select
    node_context.notification_id,
    relationship.project_id::text as project_id,
    coalesce(nullif(project.name, ''), relationship.project_id::text) as project_name
  from node_context
  join project_relationship_projection relationship
    on relationship.company_id=node_context.company_id
   and (
     (node_context.target_node_id <> '' and relationship.node_id=node_context.target_node_id::uuid)
     or (node_context.path_logic_gate_id <> '' and relationship.logic_gate_id=node_context.path_logic_gate_id::uuid)
   )
  join projects project
    on project.company_id=relationship.company_id
   and project.project_id=relationship.project_id
  where mangorts_user_can_access_resource(relationship.company_id, 'project', relationship.project_id, $1::uuid, 'view')
), roots as (
  select 'project'::text as field, 'project'::text as resource_type, project_context.project_id as resource_id, project_context.project_name as label
  from project_context
  union all
  select 'project'::text, 'project'::text, node_context.target_project_id, coalesce(nullif(project.name, ''), node_context.title)
  from node_context
  left join projects project
    on node_context.target_project_id <> ''
   and project.company_id=node_context.company_id
   and project.project_id=node_context.target_project_id::uuid
  where node_context.target_project_id <> ''
    and not exists (select 1 from project_context where project_context.notification_id=node_context.notification_id)
  union all
  select 'logic_gate'::text, 'logic_gate'::text, node_context.path_logic_gate_id, coalesce(nullif(logic_gate.header, ''), node_context.title)
  from node_context
  left join logic_gates logic_gate
    on node_context.path_logic_gate_id <> ''
   and logic_gate.company_id=node_context.company_id
   and logic_gate.logic_gate_id=node_context.path_logic_gate_id::uuid
  where node_context.path_logic_gate_id <> ''
    and not exists (select 1 from project_context where project_context.notification_id=node_context.notification_id)
  union all
  select 'node'::text, 'node'::text, node_context.target_node_id, coalesce(nullif(node.name, ''), node_context.title)
  from node_context
  left join nodes node
    on node_context.target_node_id <> ''
   and node.company_id=node_context.company_id
   and node.node_id=node_context.target_node_id::uuid
  where node_context.target_node_id <> ''
    and node_context.path_logic_gate_id = ''
    and not exists (select 1 from project_context where project_context.notification_id=node_context.notification_id)
  union all
  select 'update'::text, ''::text, ''::text, 'Updates'::text
  from node_context
  where node_context.target_project_id = ''
    and node_context.target_node_id = ''
    and node_context.path_logic_gate_id = ''
)
select
  'updates/' || field || case when resource_id <> '' then ':' || resource_id else ':all' end as id,
  field || case when resource_id <> '' then ':' || resource_id else ':all' end as key,
  field,
  label,
  resource_type,
  resource_id
from roots
group by field, resource_type, resource_id, label
order by
  case field when 'project' then 1 when 'logic_gate' then 2 when 'node' then 3 else 4 end,
  lower(label),
  resource_id`, input.UserID, input.CompanyID, filter, domain.NotificationEventUrgentMentionCreated, domain.NotificationEventMentionCreated)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	roots := make([]UpdatesNestedGroup, 0)
	for rows.Next() {
		var item UpdatesNestedGroup
		if err := rows.Scan(&item.ID, &item.Key, &item.Field, &item.Label, &item.ResourceType, &item.ResourceID); err != nil {
			return nil, err
		}
		item.Depth = 0
		item.Groups = []UpdatesNestedGroup{}
		roots = append(roots, item)
	}
	return roots, rows.Err()
}

func (r *PostgresRepo) listPostgresUpdatesNotifications(ctx context.Context, input UpdatesQuery, filter string) ([]domain.Notification, error) {
	rootField, rootResourceID, hasRootFilter, err := parseUpdatesRootFilter(input.RootID)
	if err != nil {
		return nil, err
	}
	sqlRootResourceID := rootResourceID
	if sqlRootResourceID == "" {
		sqlRootResourceID = "00000000-0000-0000-0000-000000000000"
	}
	rows, err := r.db.QueryContext(ctx, `
with filtered as (
  select
    notifications.*,
    coalesce(nullif(btrim(notifications.node_id), ''), case when notifications.entity_type='node' then notifications.entity_id else '' end) as target_node_id,
    coalesce(nullif(btrim(notifications.logic_gate_id), ''), case when notifications.entity_type='logic_gate' then notifications.entity_id else '' end) as target_logic_gate_id,
    case when notifications.entity_type='project' then notifications.entity_id else '' end as target_project_id
  from notifications
  where notifications.recipient_user_id=$1::uuid
    and notifications.company_id=$2::uuid
    and (
      $3 = 'all'
      or ($3 = 'urgent' and notifications.notification_type = $4)
      or ($3 = 'mention' and notifications.notification_type = $5)
      or ($3 = 'update' and notifications.notification_type <> $4 and notifications.notification_type <> $5)
    )
), with_gate as (
  select
    filtered.*,
    coalesce(nullif(filtered.target_logic_gate_id, ''), assignment.logic_gate_id::text, '') as path_logic_gate_id
  from filtered
  left join lateral (
    select assignment.logic_gate_id
    from node_logic_gate_assignments assignment
    where filtered.target_node_id <> ''
      and assignment.company_id=filtered.company_id
      and assignment.node_id=filtered.target_node_id::uuid
    order by assignment.updated_timestamp desc, assignment.created_timestamp desc, assignment.assignment_id desc
    limit 1
  ) assignment on true
), branch_filtered as (
  select *
  from with_gate
  where (
    not $6::boolean
    or (
      $7 = 'project'
      and (
        with_gate.target_project_id = $8
        or exists (
          select 1
          from project_relationship_projection relationship
          where relationship.company_id=with_gate.company_id
            and relationship.project_id=$8::uuid
            and (
              (with_gate.target_node_id <> '' and relationship.node_id=with_gate.target_node_id::uuid)
              or (with_gate.path_logic_gate_id <> '' and relationship.logic_gate_id=with_gate.path_logic_gate_id::uuid)
            )
        )
      )
    )
    or ($7 = 'logic_gate' and with_gate.path_logic_gate_id = $8)
    or ($7 = 'node' and with_gate.target_node_id = $8)
    or ($7 = 'update' and with_gate.target_project_id = '' and with_gate.target_node_id = '' and with_gate.path_logic_gate_id = '')
  )
)
select `+notificationSelectColumns+`
from branch_filtered notifications
order by created_timestamp desc, notification_id desc`,
		input.UserID, input.CompanyID, filter, domain.NotificationEventUrgentMentionCreated, domain.NotificationEventMentionCreated, hasRootFilter, rootField, sqlRootResourceID)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return r.filterVisiblePostgresUpdateNotifications(ctx, input, items)
}

func parseUpdatesRootFilter(rootID string) (string, string, bool, error) {
	rootID = strings.TrimSpace(rootID)
	if rootID == "" {
		return "", "", false, nil
	}
	rootID = strings.TrimPrefix(rootID, "updates/")
	parts := strings.SplitN(rootID, ":", 2)
	if len(parts) != 2 {
		return "", "", false, ErrInvalid
	}
	field := strings.TrimSpace(parts[0])
	resourceID := cleanUUIDText(parts[1])
	if field == updatesGroupFieldUpdate && strings.TrimSpace(parts[1]) == "all" {
		return field, "", true, nil
	}
	switch field {
	case EntityTypeProject, EntityTypeLogicGate, EntityTypeNode:
		if resourceID == "" {
			return "", "", false, ErrInvalid
		}
		return field, resourceID, true, nil
	default:
		return "", "", false, ErrInvalid
	}
}

type postgresUpdateAccessTarget struct {
	ResourceType string
	ResourceID   string
}

func postgresUpdateNotificationAccessTarget(item domain.Notification) (postgresUpdateAccessTarget, bool) {
	for _, candidate := range NotificationAccessTargets(item.EntityType, item.EntityID, item.LogicGateID, item.NodeID) {
		resourceType, ok := NormalizeEntityType(candidate.EntityType)
		if !ok {
			continue
		}
		resourceID := cleanUUIDText(candidate.EntityID)
		if resourceID == "" {
			continue
		}
		return postgresUpdateAccessTarget{ResourceType: resourceType, ResourceID: resourceID}, true
	}
	return postgresUpdateAccessTarget{}, false
}

func (r *PostgresRepo) filterVisiblePostgresUpdateNotifications(ctx context.Context, input UpdatesQuery, items []domain.Notification) ([]domain.Notification, error) {
	if len(items) == 0 {
		return items, nil
	}

	targets := make([]postgresUpdateAccessTarget, len(items))
	targetOK := make([]bool, len(items))
	resourceIDsByType := map[string][]string{}
	for index, item := range items {
		itemCompanyID := cleanUUIDText(item.CompanyID)
		if itemCompanyID != "" && itemCompanyID != input.CompanyID {
			continue
		}
		target, ok := postgresUpdateNotificationAccessTarget(item)
		if !ok {
			continue
		}
		targets[index] = target
		targetOK[index] = true
		resourceIDsByType[target.ResourceType] = append(resourceIDsByType[target.ResourceType], target.ResourceID)
	}

	allowedByType := make(map[string]map[string]bool, len(resourceIDsByType))
	for resourceType, resourceIDs := range resourceIDsByType {
		allowed, err := r.ListEffectiveResourceIDsForUser(input.CompanyID, input.UserID, resourceType, EntityPermissionView, resourceIDs)
		if errors.Is(err, ErrInvalid) {
			allowed = map[string]bool{}
		} else if err != nil {
			return nil, err
		}
		allowedByType[resourceType] = allowed
	}

	visible := make([]domain.Notification, 0, len(items))
	for index, item := range items {
		itemCompanyID := cleanUUIDText(item.CompanyID)
		if itemCompanyID != "" && itemCompanyID != input.CompanyID {
			continue
		}
		if !targetOK[index] {
			visible = append(visible, item)
			continue
		}
		target := targets[index]
		if allowedByType[target.ResourceType][target.ResourceID] {
			visible = append(visible, item)
		}
	}
	return visible, nil
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
		entityType := strings.TrimSpace(item.EntityType)
		nodeID := cleanUUIDText(item.NodeID)
		if nodeID == "" && entityType == EntityTypeNode {
			nodeID = cleanUUIDText(item.EntityID)
		}
		if nodeID != "" {
			nodeIDs[nodeID] = true
		}
		logicGateID := cleanUUIDText(item.LogicGateID)
		if logicGateID == "" && entityType == EntityTypeLogicGate {
			logicGateID = cleanUUIDText(item.EntityID)
		}
		if logicGateID != "" {
			logicGateIDs[logicGateID] = true
		}
		projectID := ""
		if entityType == EntityTypeProject {
			projectID = cleanUUIDText(item.EntityID)
		}
		if projectID != "" {
			projectIDs[projectID] = true
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
  coalesce(nullif(project.name, ''), relationship.project_id::text),
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
order by relationship.position asc, lower(coalesce(nullif(project.name, ''), relationship.project_id::text)) asc, relationship.relationship_created_timestamp asc, relationship.relationship_id asc`,
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
