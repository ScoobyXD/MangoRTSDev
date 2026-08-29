package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
)

const myWorkRACICandidateCTE = `
with recursive subject_groups_raw(group_id,depth,path) as (
  select member.group_id,0,array[member.group_id]
  from company_user_group_members member
  where member.company_id=$1::uuid and member.user_id=$2::uuid
  union all
  select parent.parent_group_id,child.depth+1,child.path || parent.parent_group_id
  from subject_groups_raw child
  join company_user_groups parent
    on parent.company_id=$1::uuid and parent.group_id=child.group_id
  where parent.parent_group_id is not null
    and child.depth<100
    and not parent.parent_group_id=any(child.path)
), subject_groups(group_id,depth) as (
  select group_id,min(depth)
  from subject_groups_raw
  group by group_id
), subject_principals(principal_type,principal_id) as (
  select 'user'::text,$2::uuid
  where exists (
    select 1 from company_memberships membership
    where membership.company_id=$1::uuid and membership.user_id=$2::uuid
  )
  union all
  select 'group',group_id from subject_groups
), source_resources(resource_type,resource_id) as (
  select distinct assignment.resource_type,assignment.resource_id
  from subject_principals principal
  join resource_gvic_assignments assignment
    on assignment.company_id=$1::uuid
   and assignment.principal_type=principal.principal_type
   and assignment.principal_id=principal.principal_id
   and assignment.role=$3::text
), candidate_resources(resource_type,resource_id) as (
  select source.resource_type,source.resource_id from source_resources source
  union
  select child.resource_type,child.resource_id
  from candidate_resources parent
  cross join lateral (
    select 'company_explorer_folder'::text,folder.folder_id
    from company_explorer_folders folder
    where parent.resource_type='company_explorer_folder'
      and folder.company_id=$1::uuid and folder.parent_folder_id=parent.resource_id
    union all
    select item.target_type,item.target_id
    from company_explorer_items item
    where parent.resource_type='company_explorer_folder'
      and item.company_id=$1::uuid and item.parent_folder_id=parent.resource_id
      and item.target_type in ('logic_gate','project')
    union all
    select 'node'::text,assignment.node_id
    from node_logic_gate_assignments assignment
    where parent.resource_type='logic_gate'
      and assignment.company_id=$1::uuid and assignment.logic_gate_id=parent.resource_id
  ) child(resource_type,resource_id)
)
`

const myWorkViewerPermissionCTE = `
, viewer_company_actor as (
  select exists (
    select 1
    from company_memberships membership
    where membership.user_id=$4::uuid
      and (membership.role='dev_admin' or membership.company_id=$1::uuid)
  ) as allowed
), viewer_admin_actor as (
  select exists (
    select 1
    from company_memberships membership
    where membership.user_id=$4::uuid
      and (membership.role='dev_admin' or (membership.company_id=$1::uuid and membership.role='company_admin'))
  ) as allowed
), viewer_groups_raw(group_id,depth,path) as (
  select member.group_id,0,array[member.group_id]
  from company_user_group_members member
  where member.company_id=$1::uuid and member.user_id=$4::uuid
  union all
  select parent.parent_group_id,member.depth+1,member.path || parent.parent_group_id
  from viewer_groups_raw member
  join company_user_groups parent
    on parent.company_id=$1::uuid and parent.group_id=member.group_id
  where parent.parent_group_id is not null
    and member.depth<100
    and not parent.parent_group_id=any(member.path)
), viewer_groups as (
  select group_id,min(depth) as depth
  from viewer_groups_raw
  group by group_id
)
`

func (r *PostgresRepo) GetMyWork(ctx context.Context, query MyWorkQuery) (domain.MyWorkResponse, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return domain.MyWorkResponse{}, err
	}
	query, cursor, err := normalizeMyWorkQuery(query)
	if err != nil {
		return domain.MyWorkResponse{}, err
	}
	response := domain.MyWorkResponse{CompanyID: query.CompanyID, UserID: query.UserID}
	if myWorkIncludesSection(query, MyWorkSectionActionItems) {
		page, err := r.postgresMyWorkActionItems(ctx, query, cursor)
		if err != nil {
			return domain.MyWorkResponse{}, err
		}
		response.ActionItems = &page
	}
	if myWorkIncludesSection(query, MyWorkSectionNodes) {
		page, err := r.postgresMyWorkNodes(ctx, query, cursor)
		if err != nil {
			return domain.MyWorkResponse{}, err
		}
		response.Nodes = &page
	}
	if myWorkIncludesSection(query, MyWorkSectionProcesses) {
		page, err := r.postgresMyWorkProcesses(ctx, query, cursor)
		if err != nil {
			return domain.MyWorkResponse{}, err
		}
		response.Processes = &page
	}
	if myWorkIncludesSection(query, MyWorkSectionProjects) {
		page, err := r.postgresMyWorkProjects(ctx, query, cursor)
		if err != nil {
			return domain.MyWorkResponse{}, err
		}
		response.Projects = &page
	}
	return response, nil
}

func (r *PostgresRepo) postgresMyWorkActionItems(ctx context.Context, query MyWorkQuery, cursor myWorkCursor) (domain.MyWorkActionItemPage, error) {
	grouping, groupingTerms := myWorkEffectiveGrouping(query, MyWorkSectionActionItems)
	sortComponents := myWorkActionSQLSortComponents(groupingTerms)
	keyset := myWorkSQLKeysetPredicate("$7::boolean", sortComponents, "entity_id", "$13::uuid")
	orderBy := myWorkSQLOrderBy(sortComponents, "entity_id")
	if query.History {
		grouping = ""
		keyset = `(not $7::boolean or completed_timestamp < $16::timestamptz or (completed_timestamp = $16::timestamptz and entity_id > $13::uuid))`
		orderBy = "completed_timestamp desc,entity_id"
	}
	querySQL := fmt.Sprintf(`
with candidates as (
  select entity.entity_id,entity.name,
         lower(btrim(coalesce(color.value_jsonb #>> '{}',''))) as color_key,
         completion_due.value_jsonb #>> '{}' as completion_due_date,
         completion_due.entity_field_id,
         status.updated_timestamp as completed_timestamp,
         case lower(btrim(coalesce(color.value_jsonb #>> '{}','')))
           when 'red' then 0 when 'yellow' then 1 when '' then 3 else 2 end as color_rank
  from entity_fields person
  join entities entity
    on entity.company_id=person.company_id and entity.entity_id=person.entity_id
   and entity.entity_type_id=$3::uuid
  left join entity_fields status
    on status.company_id=entity.company_id and status.entity_id=entity.entity_id
   and status.entity_field_type_id=$4::uuid
  left join entity_fields assigned_by
    on assigned_by.company_id=entity.company_id and assigned_by.entity_id=entity.entity_id
   and assigned_by.entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
  left join entity_fields color
    on color.company_id=entity.company_id and color.entity_id=entity.entity_id
   and color.entity_field_type_id=$5::uuid
  left join entity_fields completion_due
    on completion_due.company_id=entity.company_id and completion_due.entity_id=entity.entity_id
   and completion_due.entity_field_type_id=$6::uuid
  where person.company_id=$1::uuid
    and person.entity_field_type_id='a17e0000-0000-4000-8000-000000000101'::uuid
    and (
      ($17::text='mine' and mangorts_try_uuid(person.value_jsonb #>> '{}')=$2::uuid)
      or ($17::text='delegated'
          and mangorts_try_uuid(assigned_by.value_jsonb #>> '{}')=$2::uuid
          and mangorts_try_uuid(person.value_jsonb #>> '{}') is not null
          and mangorts_try_uuid(person.value_jsonb #>> '{}')<>$2::uuid)
    )
    and ($15::boolean = (lower(btrim(coalesce(status.value_jsonb #>> '{}',''))) in ('done','complete','completed')))
)
select entity_id::text,name,nullif(color_key,''),completion_due_date,entity_field_id::text,completed_timestamp
from candidates
where $8::boolean is not null and $9::integer is not null and $10::text is not null
  and $11::boolean is not null and $12::text is not null and $13::uuid is not null
  and $16::timestamptz is not null
  and %s
order by %s
limit $14`, keyset, orderBy)
	rows, err := r.db.QueryContext(ctx, querySQL, query.CompanyID, query.UserID, ActionItemEntityTypeID, ActionItemStatusFieldTypeID,
		ActionItemColorFieldTypeID, ActionItemCompletionDueDateFieldTypeID,
		query.Cursor != "", cursor.GroupNull, cursor.GroupInt, cursor.GroupText, cursor.DateNull, cursor.Date, myWorkCursorUUID(cursor.ResourceID), query.Limit+1,
		query.History, myWorkCursorTimestamp(cursor.CompletedTimestamp), query.Perspective)
	if err != nil {
		return domain.MyWorkActionItemPage{}, err
	}
	defer rows.Close()
	items := make([]domain.MyWorkActionItem, 0, query.Limit+1)
	for rows.Next() {
		var item domain.MyWorkActionItem
		var color, due, dueFieldID sql.NullString
		var completedTimestamp sql.NullTime
		if err := rows.Scan(&item.EntityID, &item.Name, &color, &due, &dueFieldID, &completedTimestamp); err != nil {
			return domain.MyWorkActionItemPage{}, err
		}
		item.Color = nullStringPointer(color)
		item.CompletionDueDate = nullStringPointer(due)
		if dueFieldID.Valid {
			item.CompletionDueDateFieldID = dueFieldID.String
		}
		if query.History && completedTimestamp.Valid {
			item.CompletedTimestamp = &completedTimestamp.Time
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return domain.MyWorkActionItemPage{}, err
	}
	page := domain.MyWorkActionItemPage{Perspective: query.Perspective, Items: items, HasMore: len(items) > query.Limit}
	if page.HasMore {
		page.Items = items[:query.Limit]
		last := page.Items[len(page.Items)-1]
		if query.History {
			page.NextCursor = encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionActionItems, Perspective: query.Perspective, History: true, CompletedTimestamp: last.CompletedTimestamp.Format(time.RFC3339Nano), ResourceID: last.EntityID})
		} else {
			color := strings.ToLower(myWorkOptionalString(last.Color))
			page.NextCursor = encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionActionItems, Perspective: query.Perspective, Grouping: grouping, GroupNull: color == "", GroupInt: myWorkColorRank(color), GroupText: color, DateNull: last.CompletionDueDate == nil, Date: myWorkOptionalString(last.CompletionDueDate), ResourceID: last.EntityID})
		}
	}
	return page, nil
}

func (r *PostgresRepo) postgresMyWorkNodes(ctx context.Context, query MyWorkQuery, cursor myWorkCursor) (domain.MyWorkNodePage, error) {
	grouping, groupingTerms := myWorkEffectiveGrouping(query, MyWorkSectionNodes)
	sortComponents := myWorkNodeSQLSortComponents(groupingTerms)
	keyset := myWorkSQLKeysetPredicate("$5::boolean", sortComponents, "node.node_id", "$10::uuid")
	orderBy := myWorkSQLOrderBy(sortComponents, "node.node_id")
	if query.History {
		grouping = ""
		keyset = `(not $5::boolean or node.completed_timestamp < $13::timestamptz or (node.completed_timestamp = $13::timestamptz and node.node_id > $10::uuid))`
		orderBy = "node.completed_timestamp desc,node.node_id"
	}
	querySQL := myWorkRACICandidateCTE + `
, node_raci_targets(resource_type,resource_id) as (
  select 'node'::text,resource_id
  from candidate_resources
  where resource_type='node'
)
` + myWorkSubjectRACIWinnerCTEs("node_raci_targets", "node_raci") + myWorkViewerPermissionCTE + `
, node_candidates as (
  select node.company_id,node.node_id,node.name,node.priority,node.due_date,
         coalesce(node.completion_transition_timestamp,node.created_timestamp) as completed_timestamp
  from node_raci_winners winner
  join nodes node on node.company_id=$1::uuid and node.node_id=winner.resource_id
  left join lateral (
    select candidate_assignment.*
    from node_logic_gate_assignments candidate_assignment
    where candidate_assignment.company_id=node.company_id and candidate_assignment.node_id=node.node_id
    order by candidate_assignment.updated_timestamp desc,candidate_assignment.created_timestamp desc,candidate_assignment.assignment_id desc
    limit 1
  ) assignment on true
  where winner.role=$3::text
    and $13::timestamptz is not null
    and $12::boolean = (lower(btrim(coalesce(
      case
        when assignment.is_issue then 'Issue'
        when assignment.assignment_id is not null then ` + postgresLogicGateAssignmentStatusTitleSQL + `
      end,
      nullif(node.status,''),
      ''
    ))) in ('done','complete','completed'))
), node_access_targets(resource_type,resource_id) as (
  select 'node'::text,node_id
  from node_candidates
)
` + myWorkPermissionAccessCTEs("node_access_targets", "node") + fmt.Sprintf(`
, visible_nodes as (
  select candidate.*
  from node_candidates candidate
  join node_access access
    on access.resource_type='node' and access.resource_id=candidate.node_id and access.allowed
), paged_nodes as (
  select *
  from visible_nodes node
  where $6::boolean is not null and $7::integer is not null and $8::boolean is not null
    and $9::text is not null and $10::uuid is not null
    and %s
  order by %s
  limit $11
), inline_access_targets(resource_type,resource_id) as (
  select 'logic_gate'::text,assignment.logic_gate_id
  from paged_nodes node
  join node_logic_gate_assignments assignment
    on assignment.company_id=node.company_id and assignment.node_id=node.node_id
  union
  select 'project'::text,relationship.project_id
  from paged_nodes node
  join project_relationships relationship
    on relationship.company_id=node.company_id
   and relationship.resource_type='node'
   and relationship.resource_id=node.node_id
)
`, keyset, orderBy) + myWorkPermissionAccessCTEs("inline_access_targets", "inline") + fmt.Sprintf(`
select node.node_id::text,node.name,node.priority,node.due_date::text,
       process.logic_gate_id::text,process.name,
       project.project_id::text,project.name,
       node.completed_timestamp
from paged_nodes node
left join lateral (
  select gate.logic_gate_id,gate.header as name
  from node_logic_gate_assignments assignment
  join logic_gates gate
    on gate.company_id=assignment.company_id and gate.logic_gate_id=assignment.logic_gate_id
  join inline_access access
    on access.resource_type='logic_gate' and access.resource_id=gate.logic_gate_id and access.allowed
  where assignment.company_id=node.company_id and assignment.node_id=node.node_id
  order by assignment.created_timestamp,assignment.assignment_id
  limit 1
) process on true
left join lateral (
  select related.project_id,related.name
  from project_relationships relationship
  join projects related
    on related.company_id=relationship.company_id and related.project_id=relationship.project_id
  join inline_access access
    on access.resource_type='project' and access.resource_id=related.project_id and access.allowed
  where relationship.company_id=node.company_id and relationship.resource_type='node' and relationship.resource_id=node.node_id
  order by relationship.position,relationship.created_timestamp,relationship.relationship_id
  limit 1
) project on true
order by %s
`, orderBy)
	rows, err := r.db.QueryContext(ctx, querySQL, query.CompanyID, query.UserID, query.Role, query.ViewerUserID, query.Cursor != "", cursor.GroupNull, cursor.GroupInt, cursor.DateNull, cursor.Date, myWorkCursorUUID(cursor.ResourceID), query.Limit+1, query.History, myWorkCursorTimestamp(cursor.CompletedTimestamp))
	if err != nil {
		return domain.MyWorkNodePage{}, err
	}
	defer rows.Close()
	items := make([]domain.MyWorkNode, 0, query.Limit+1)
	for rows.Next() {
		var item domain.MyWorkNode
		var priority sql.NullInt64
		var due, processID, processName, projectID, projectName sql.NullString
		var completedTimestamp time.Time
		if err := rows.Scan(&item.NodeID, &item.Name, &priority, &due, &processID, &processName, &projectID, &projectName, &completedTimestamp); err != nil {
			return domain.MyWorkNodePage{}, err
		}
		if priority.Valid {
			value := int(priority.Int64)
			item.Priority = &value
		}
		item.DueDate = nullStringPointer(due)
		if query.History {
			item.CompletedTimestamp = &completedTimestamp
		}
		if processID.Valid && processName.Valid {
			item.Process = &domain.MyWorkProcessReference{LogicGateID: processID.String, Name: processName.String}
		}
		if projectID.Valid && projectName.Valid {
			item.Project = &domain.MyWorkProjectReference{ProjectID: projectID.String, Name: projectName.String}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return domain.MyWorkNodePage{}, err
	}
	page := domain.MyWorkNodePage{Role: query.Role, Items: items, HasMore: len(items) > query.Limit}
	if page.HasMore {
		page.Items = items[:query.Limit]
		last := page.Items[len(page.Items)-1]
		if query.History {
			page.NextCursor = encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionNodes, Role: query.Role, History: true, CompletedTimestamp: last.CompletedTimestamp.Format(time.RFC3339Nano), ResourceID: last.NodeID})
		} else {
			page.NextCursor = encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionNodes, Role: query.Role, Grouping: grouping, GroupNull: last.Priority == nil, GroupInt: myWorkOptionalInt(last.Priority), DateNull: last.DueDate == nil, Date: myWorkOptionalString(last.DueDate), ResourceID: last.NodeID})
		}
	}
	return page, nil
}

func (r *PostgresRepo) postgresMyWorkProcesses(ctx context.Context, query MyWorkQuery, cursor myWorkCursor) (domain.MyWorkProcessPage, error) {
	querySQL := myWorkRACICandidateCTE + `
, process_raci_targets(resource_type,resource_id) as (
  select 'logic_gate'::text,resource_id
  from candidate_resources
  where resource_type='logic_gate'
)
` + myWorkSubjectRACIWinnerCTEs("process_raci_targets", "process_raci") + myWorkViewerPermissionCTE + `
, process_candidates as (
  select gate.logic_gate_id,gate.header
  from process_raci_winners winner
  join logic_gates gate on gate.company_id=$1::uuid and gate.logic_gate_id=winner.resource_id
  where winner.role=$3::text
), process_access_targets(resource_type,resource_id) as (
  select 'logic_gate'::text,logic_gate_id
  from process_candidates
)
` + myWorkPermissionAccessCTEs("process_access_targets", "process") + `
, visible_processes as (
  select candidate.*
  from process_candidates candidate
  join process_access access
    on access.resource_type='logic_gate' and access.resource_id=candidate.logic_gate_id and access.allowed
), visible_process_page as (
  select logic_gate_id,header
  from visible_processes
  where not $5::boolean or (lower(header) collate "C",logic_gate_id)>($6::text collate "C",$7::uuid)
  order by lower(header) collate "C",logic_gate_id
  limit $8
), process_counts as (
  select
    page.logic_gate_id,
    count(*) filter (where projection.status_rank=0)::integer as request_count,
    count(*) filter (where projection.status_rank=2)::integer as pending_count,
    count(*) filter (where projection.status_rank=3)::integer as in_progress_count,
    count(*) filter (where projection.status_rank=4)::integer as review_count
  from visible_process_page page
  left join kanban_board_projection projection
    on projection.company_id=$1::uuid and projection.logic_gate_id=page.logic_gate_id
  group by page.logic_gate_id
)
select page.logic_gate_id::text,page.header,lower(page.header),
       coalesce(counts.request_count,0),coalesce(counts.pending_count,0),
       coalesce(counts.in_progress_count,0),coalesce(counts.review_count,0)
from visible_process_page page
left join process_counts counts on counts.logic_gate_id=page.logic_gate_id
order by lower(page.header) collate "C",page.logic_gate_id`
	rows, err := r.db.QueryContext(ctx, querySQL, query.CompanyID, query.UserID, query.Role, query.ViewerUserID, query.Cursor != "", cursor.Name, myWorkCursorUUID(cursor.ResourceID), query.Limit+1)
	if err != nil {
		return domain.MyWorkProcessPage{}, err
	}
	defer rows.Close()
	type processRow struct {
		item    domain.MyWorkProcess
		sortKey string
	}
	resultRows := make([]processRow, 0, query.Limit+1)
	for rows.Next() {
		var row processRow
		if err := rows.Scan(
			&row.item.LogicGateID,
			&row.item.Name,
			&row.sortKey,
			&row.item.StatusCounts.Request,
			&row.item.StatusCounts.Pending,
			&row.item.StatusCounts.InProgress,
			&row.item.StatusCounts.Review,
		); err != nil {
			return domain.MyWorkProcessPage{}, err
		}
		resultRows = append(resultRows, row)
	}
	if err := rows.Err(); err != nil {
		return domain.MyWorkProcessPage{}, err
	}
	page := domain.MyWorkProcessPage{Role: query.Role, Items: []domain.MyWorkProcess{}, HasMore: len(resultRows) > query.Limit}
	if page.HasMore {
		resultRows = resultRows[:query.Limit]
	}
	for _, row := range resultRows {
		page.Items = append(page.Items, row.item)
	}
	if page.HasMore {
		last := resultRows[len(resultRows)-1]
		page.NextCursor = encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionProcesses, Role: query.Role, Name: last.sortKey, ResourceID: last.item.LogicGateID})
	}
	return page, nil
}

func (r *PostgresRepo) postgresMyWorkProjects(ctx context.Context, query MyWorkQuery, cursor myWorkCursor) (domain.MyWorkProjectPage, error) {
	querySQL := `
with recursive subject_groups(group_id,parent_group_id) as (
  select member.group_id,member_group.parent_group_id
  from company_user_group_members member
  join company_user_groups member_group
    on member_group.company_id=member.company_id and member_group.group_id=member.group_id
  where member.company_id=$1::uuid and member.user_id=$2::uuid
  union
  select parent.group_id,parent.parent_group_id
  from subject_groups child
  join company_user_groups parent
    on parent.company_id=$1::uuid and parent.group_id=child.parent_group_id
), candidate_projects as (
  select distinct assignment.project_id
  from subject_groups membership
  join project_team_assignments assignment
    on assignment.company_id=$1::uuid and assignment.team_id=membership.group_id
), project_candidates as (
  select project.project_id,project.name
  from candidate_projects candidate
  join projects project on project.company_id=$1::uuid and project.project_id=candidate.project_id
), project_access_targets(resource_type,resource_id) as (
  select 'project'::text,project_id
  from project_candidates
)
` + myWorkViewerPermissionCTE + myWorkPermissionAccessCTEs("project_access_targets", "project") + `
, visible_projects as (
  select candidate.*
  from project_candidates candidate
  join project_access access
    on access.resource_type='project' and access.resource_id=candidate.project_id and access.allowed
)
select project_id::text,name,lower(name)
from visible_projects
where not $3::boolean or (lower(name) collate "C",project_id)>($5::text collate "C",$6::uuid)
order by lower(name) collate "C",project_id
limit $7`
	rows, err := r.db.QueryContext(ctx, querySQL, query.CompanyID, query.UserID, query.Cursor != "", query.ViewerUserID, cursor.Name, myWorkCursorUUID(cursor.ResourceID), query.Limit+1)
	if err != nil {
		return domain.MyWorkProjectPage{}, err
	}
	defer rows.Close()
	type projectRow struct {
		item    domain.MyWorkProject
		sortKey string
	}
	resultRows := make([]projectRow, 0, query.Limit+1)
	for rows.Next() {
		var row projectRow
		if err := rows.Scan(&row.item.ProjectID, &row.item.Name, &row.sortKey); err != nil {
			return domain.MyWorkProjectPage{}, err
		}
		resultRows = append(resultRows, row)
	}
	if err := rows.Err(); err != nil {
		return domain.MyWorkProjectPage{}, err
	}
	page := domain.MyWorkProjectPage{Items: []domain.MyWorkProject{}, HasMore: len(resultRows) > query.Limit}
	if page.HasMore {
		resultRows = resultRows[:query.Limit]
	}
	for _, row := range resultRows {
		page.Items = append(page.Items, row.item)
	}
	if page.HasMore {
		last := resultRows[len(resultRows)-1]
		page.NextCursor = encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionProjects, Name: last.sortKey, ResourceID: last.item.ProjectID})
	}
	return page, nil
}

func nullStringPointer(value sql.NullString) *string {
	if !value.Valid || value.String == "" {
		return nil
	}
	result := value.String
	return &result
}

func myWorkCursorUUID(value string) string {
	if value = cleanUUIDText(value); value != "" {
		return value
	}
	return "00000000-0000-0000-0000-000000000000"
}

type myWorkSQLSortComponent struct {
	expression       string
	cursorExpression string
	direction        string
}

func myWorkPermissionAccessCTEs(targetsCTE, prefix string) string {
	return fmt.Sprintf(`
, %[1]s_resolved_targets as (
  select target.resource_type,target.resource_id,resolved.source_resource_type,resolved.source_resource_id
  from %[2]s target
  left join lateral mangorts_v2_resolve_permission_policy($1::uuid,target.resource_type,target.resource_id) resolved on true
), %[1]s_sources as (
  select distinct source_resource_type,source_resource_id
  from %[1]s_resolved_targets
  where source_resource_type is not null and source_resource_id is not null
), %[1]s_direct_rules as (
  select source.source_resource_type,source.source_resource_id,access.access_level
  from %[1]s_sources source
  join resource_permissions access
    on access.company_id=$1::uuid
   and access.resource_type=source.source_resource_type
   and access.resource_id=source.source_resource_id
   and access.subject_type='user'
   and access.subject_id=$4::uuid
), %[1]s_ranked_group_rules as (
  select source.source_resource_type,source.source_resource_id,access.access_level,
         row_number() over (
           partition by source.source_resource_type,source.source_resource_id
           order by membership.depth,
                    case access.access_level when 'no_access' then 0 else 1 end,
                    access.subject_id
         ) as access_rank
  from %[1]s_sources source
  join resource_permissions access
    on access.company_id=$1::uuid
   and access.resource_type=source.source_resource_type
   and access.resource_id=source.source_resource_id
   and access.subject_type='group'
  join viewer_groups membership on membership.group_id=access.subject_id
), %[1]s_group_rules as (
  select source_resource_type,source_resource_id,access_level
  from %[1]s_ranked_group_rules
  where access_rank=1
), %[1]s_source_access as (
  select source.source_resource_type,source.source_resource_id,
         coalesce(direct_rule.access_level,group_rule.access_level,setting.default_access)='edit' as allowed
  from %[1]s_sources source
  join resource_permission_settings setting
    on setting.company_id=$1::uuid
   and setting.resource_type=source.source_resource_type
   and setting.resource_id=source.source_resource_id
  left join %[1]s_direct_rules direct_rule
    on direct_rule.source_resource_type=source.source_resource_type
   and direct_rule.source_resource_id=source.source_resource_id
  left join %[1]s_group_rules group_rule
    on group_rule.source_resource_type=source.source_resource_type
   and group_rule.source_resource_id=source.source_resource_id
), %[1]s_access as (
  select target.resource_type,target.resource_id,
         case
           when not (select allowed from viewer_company_actor) then false
           when (select allowed from viewer_admin_actor) then true
           else coalesce(access.allowed,false)
         end as allowed
  from %[1]s_resolved_targets target
  left join %[1]s_source_access access
    on access.source_resource_type=target.source_resource_type
   and access.source_resource_id=target.source_resource_id
)
`, prefix, targetsCTE)
}

func myWorkSubjectRACIWinnerCTEs(targetsCTE, prefix string) string {
	return fmt.Sprintf(`
, %[1]s_resolved_targets as (
  select target.resource_type,target.resource_id,resolved.source_resource_type,resolved.source_resource_id
  from %[2]s target
  cross join lateral mangorts_v2_resolve_gvic_policy($1::uuid,target.resource_type,target.resource_id) resolved
), %[1]s_role_candidates as (
  select source.source_resource_type,source.source_resource_id,assignment.role,assignment.principal_type,assignment.principal_id,
         case assignment.principal_type when 'user' then -1 else membership.depth end as group_depth
  from (
    select distinct source_resource_type,source_resource_id
    from %[1]s_resolved_targets
  ) source
  join resource_gvic_assignments assignment
    on assignment.company_id=$1::uuid
   and assignment.resource_type=source.source_resource_type
   and assignment.resource_id=source.source_resource_id
  left join subject_groups membership
    on assignment.principal_type='group' and membership.group_id=assignment.principal_id
  where (assignment.principal_type='user' and assignment.principal_id=$2::uuid and exists (
           select 1 from company_memberships company_member
           where company_member.company_id=$1::uuid and company_member.user_id=$2::uuid
         ))
     or (assignment.principal_type='group' and membership.group_id is not null)
), %[1]s_ranked_roles as (
  select candidate.*,
         row_number() over (
           partition by candidate.source_resource_type,candidate.source_resource_id
           order by case candidate.role when 'responsible' then 1 when 'accountable' then 2 when 'consulted' then 3 else 4 end,
                    case candidate.principal_type when 'user' then 0 else 1 end,
                    candidate.group_depth,
                    candidate.principal_id
         ) as role_rank
  from %[1]s_role_candidates candidate
), %[1]s_winners as (
  select target.resource_type,target.resource_id,winner.role
  from %[1]s_resolved_targets target
  join %[1]s_ranked_roles winner
    on winner.source_resource_type=target.source_resource_type
   and winner.source_resource_id=target.source_resource_id
   and winner.role_rank=1
)
`, prefix, targetsCTE)
}

func myWorkActionSQLSortComponents(grouping []myWorkGroupingTerm) []myWorkSQLSortComponent {
	components := make([]myWorkSQLSortComponent, 0, len(grouping)*3)
	for _, term := range grouping {
		switch term.Field {
		case MyWorkActionItemGroupingColor:
			components = append(components,
				myWorkSQLSortComponent{expression: "(color_key = '')", cursorExpression: "$8::boolean", direction: "asc"},
				myWorkSQLSortComponent{expression: "color_rank", cursorExpression: "$9::integer", direction: term.Direction},
				myWorkSQLSortComponent{expression: `color_key collate "C"`, cursorExpression: `$10::text collate "C"`, direction: term.Direction},
			)
		case MyWorkActionItemGroupingCompletionDueDate:
			components = append(components,
				myWorkSQLSortComponent{expression: "(completion_due_date is null)", cursorExpression: "$11::boolean", direction: "asc"},
				myWorkSQLSortComponent{expression: "coalesce(completion_due_date::date,date '9999-12-31')", cursorExpression: "coalesce(nullif($12::text,'')::date,date '9999-12-31')", direction: term.Direction},
			)
		}
	}
	return components
}

func myWorkNodeSQLSortComponents(grouping []myWorkGroupingTerm) []myWorkSQLSortComponent {
	components := make([]myWorkSQLSortComponent, 0, len(grouping)*2)
	for _, term := range grouping {
		switch term.Field {
		case MyWorkNodeGroupingPriority:
			components = append(components,
				myWorkSQLSortComponent{expression: "(node.priority is null)", cursorExpression: "$6::boolean", direction: "asc"},
				myWorkSQLSortComponent{expression: "coalesce(node.priority,0)", cursorExpression: "$7::integer", direction: term.Direction},
			)
		case MyWorkNodeGroupingDueDate:
			components = append(components,
				myWorkSQLSortComponent{expression: "(node.due_date is null)", cursorExpression: "$8::boolean", direction: "asc"},
				myWorkSQLSortComponent{expression: "coalesce(node.due_date,date '9999-12-31')", cursorExpression: "coalesce(nullif($9::text,'')::date,date '9999-12-31')", direction: term.Direction},
			)
		}
	}
	return components
}

func myWorkSQLOrderBy(components []myWorkSQLSortComponent, resourceIDExpression string) string {
	parts := make([]string, 0, len(components)+1)
	for _, component := range components {
		parts = append(parts, component.expression+" "+component.direction)
	}
	parts = append(parts, resourceIDExpression+" asc")
	return strings.Join(parts, ",")
}

func myWorkSQLKeysetPredicate(hasCursorExpression string, components []myWorkSQLSortComponent, resourceIDExpression, resourceIDCursorExpression string) string {
	clauses := make([]string, 0, len(components)+1)
	equalities := make([]string, 0, len(components))
	for _, component := range components {
		operator := ">"
		if component.direction == "desc" {
			operator = "<"
		}
		parts := append([]string{}, equalities...)
		parts = append(parts, fmt.Sprintf("(%s %s %s)", component.expression, operator, component.cursorExpression))
		clauses = append(clauses, "("+strings.Join(parts, " and ")+")")
		equalities = append(equalities, fmt.Sprintf("(%s is not distinct from %s)", component.expression, component.cursorExpression))
	}
	parts := append([]string{}, equalities...)
	parts = append(parts, fmt.Sprintf("(%s > %s)", resourceIDExpression, resourceIDCursorExpression))
	clauses = append(clauses, "("+strings.Join(parts, " and ")+")")
	return fmt.Sprintf("(not %s or (%s))", hasCursorExpression, strings.Join(clauses, " or "))
}
