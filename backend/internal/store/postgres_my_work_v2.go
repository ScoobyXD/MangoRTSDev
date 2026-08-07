package store

import (
	"context"
	"database/sql"
	"strings"
)

type postgresPolicyRowsQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func (r *PostgresRepo) ListRACIMatrixProjectionRowsForResources(companyID string, nodeIDs, logicGateIDs []string) ([]RACIMatrixProjectionRow, error) {
	return queryPostgresV2RACIRows(context.Background(), r.db, companyID, "", "", nodeIDs, logicGateIDs, 0)
}

func (r *PostgresRepo) ListRACIMatrixProjectionRowsForLogicGate(companyID, logicGateID string) ([]RACIMatrixProjectionRow, error) {
	return queryPostgresV2RACIRows(context.Background(), r.db, companyID, "", "", nil, []string{logicGateID}, 0)
}

func (r *PostgresRepo) ListRACIMatrixProjectionRowsForUser(query WorkItemInboxQuery) ([]RACIMatrixProjectionRow, error) {
	query = NormalizeWorkItemInboxQuery(query)
	return queryPostgresV2RACIRows(context.Background(), r.db, query.CompanyID, query.UserID, query.ViewerUserID, nil, nil, query.Limit)
}

func (r *PostgresRepo) ListMyWorkMatrixRows(query WorkItemInboxQuery) ([]RACIMatrixProjectionRow, error) {
	query = NormalizeWorkItemInboxQuery(query)
	return queryPostgresV2RACIRows(context.Background(), r.db, query.CompanyID, query.UserID, query.ViewerUserID, nil, nil, query.Limit)
}

func (r *PostgresRepo) ListMyWorkMatrix(query WorkItemInboxQuery) (MyWorkMatrixResponse, error) {
	query = NormalizeWorkItemInboxQuery(query)
	rows, err := r.ListMyWorkMatrixRows(query)
	if err != nil {
		return MyWorkMatrixResponse{}, err
	}
	return MyWorkMatrixResponse{CompanyID: query.CompanyID, UserID: query.UserID, Rows: rows}, nil
}

func queryPostgresV2RACIRows(ctx context.Context, queryer postgresPolicyRowsQueryer, companyID, userID, viewerUserID string, nodeIDs, logicGateIDs []string, limit int) ([]RACIMatrixProjectionRow, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	viewerUserID = cleanUUIDText(viewerUserID)
	nodeIDs = cleanUUIDTextSlice(nodeIDs)
	logicGateIDs = cleanUUIDTextSlice(logicGateIDs)
	if ctx == nil || queryer == nil || companyID == "" || limit < 0 || (userID == "") != (viewerUserID == "") {
		return nil, ErrInvalid
	}
	if limit > WorkItemInboxMaxLimit {
		limit = WorkItemInboxMaxLimit
	}
	rows, err := queryer.QueryContext(ctx, `
with candidates as (
  select node.company_id,node.node_id as resource_id,'node'::text as resource_type,node.title as display_title,
         assignment.role,assignment.user_id,assignment.source_resource_type,assignment.source_resource_id,
         assignment.source_principal_type,assignment.source_principal_id,assignment.inheritance_type,
         node.status,node.due_date,node.priority,node.created_timestamp,node.updated_timestamp
  from nodes node
  join lateral mangorts_v2_effective_gvic_assignments(node.company_id,'node',node.node_id) assignment on true
  where node.company_id=$1::uuid
    and (cardinality($4::text[])=0 or node.node_id::text=any($4::text[]))
    and cardinality($5::text[])=0
  union all
  select gate.company_id,gate.logic_gate_id,'logic_gate',gate.header,
         assignment.role,assignment.user_id,assignment.source_resource_type,assignment.source_resource_id,
         assignment.source_principal_type,assignment.source_principal_id,assignment.inheritance_type,
         null::text,null::date,null::integer,gate.created_timestamp,gate.updated_timestamp
  from logic_gates gate
  join lateral mangorts_v2_effective_gvic_assignments(gate.company_id,'logic_gate',gate.logic_gate_id) assignment on true
  where gate.company_id=$1::uuid
    and (cardinality($5::text[])=0 or gate.logic_gate_id::text=any($5::text[]))
    and cardinality($4::text[])=0
), selected as (
  select * from candidates candidate
  where ($2='' or candidate.user_id=$2::uuid)
    and ($3='' or mangorts_user_can_access_resource(candidate.company_id,candidate.resource_type,candidate.resource_id,$3::uuid,'edit'))
)
select company_id::text,resource_type,resource_id::text,display_title,role,user_id::text,
       source_resource_type,source_resource_id::text,source_principal_type,source_principal_id::text,inheritance_type,
       status,due_date::text,priority,created_timestamp,updated_timestamp
from selected
order by case role when 'responsible' then 1 when 'accountable' then 2 when 'consulted' then 3 else 4 end,
         coalesce(priority,6),created_timestamp,resource_type,resource_id::text,user_id::text
limit nullif($6,0)`, companyID, userID, viewerUserID, nodeIDs, logicGateIDs, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]RACIMatrixProjectionRow, 0)
	for rows.Next() {
		var item RACIMatrixProjectionRow
		var status, dueDate sql.NullString
		var priority sql.NullInt64
		if err := rows.Scan(&item.CompanyID, &item.ResourceType, &item.ResourceID, &item.DisplayTitle, &item.Role, &item.UserID,
			&item.SourceResourceType, &item.SourceResourceID, &item.SourcePrincipalType, &item.SourcePrincipalID, &item.InheritanceType,
			&status, &dueDate, &priority, &item.ResourceCreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		item.RACIAssignment = item.Role
		item.ProjectionRowID = strings.Join([]string{item.ResourceType, item.ResourceID, item.UserID}, ":")
		item.CreatedTimestamp = item.ResourceCreatedTimestamp
		if status.Valid {
			value := status.String
			item.Status = &value
		}
		if dueDate.Valid {
			value := dueDate.String
			item.DueDate = &value
		}
		if priority.Valid {
			value := int(priority.Int64)
			item.Priority = &value
		}
		if item.ResourceType == EntityTypeNode {
			item.NodeID = item.ResourceID
			item.NodeName = item.DisplayTitle
		} else {
			value := item.ResourceID
			item.LogicGateID = &value
			item.LogicGateName = item.DisplayTitle
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
