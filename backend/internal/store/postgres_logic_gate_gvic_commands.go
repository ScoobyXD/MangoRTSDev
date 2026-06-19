package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func listLogicGateGVICAssignmentsTx(ctx context.Context, tx *sql.Tx, companyID string, logicGateIDs []string) (map[string][]domain.LogicGateGVICAssignment, error) {
	assignmentsByGate := map[string][]domain.LogicGateGVICAssignment{}
	if len(logicGateIDs) == 0 {
		return assignmentsByGate, nil
	}
	rows, err := tx.QueryContext(ctx, `
select
  assignment.company_id::text,
  assignment.resource_id::text,
  assignment.role,
  assignment.principal_type,
  assignment.principal_id::text,
  coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, '')),
  coalesce(app_user.user_id::text, ''),
  nullif(app_user.display_name, ''),
  nullif(app_user.email, ''),
  assignment.created_timestamp
from resource_gvic_assignments assignment
left join company_memberships membership
  on assignment.principal_type='user'
 and membership.company_id=assignment.company_id
 and membership.user_id=assignment.principal_id
left join users app_user
  on assignment.principal_type='user'
 and app_user.user_id=assignment.principal_id
left join company_user_groups user_group
  on assignment.principal_type='group'
 and user_group.company_id=assignment.company_id
 and user_group.group_id=assignment.principal_id
where assignment.company_id=$1::uuid
  and assignment.resource_type=$3
  and assignment.resource_id=any(string_to_array($2, ',')::uuid[])
  and (
    (assignment.principal_type='user' and membership.user_id is not null)
    or (assignment.principal_type='group' and user_group.group_id is not null)
  )
order by assignment.resource_id::text asc,
  case assignment.role
    when 'generated' then 1
    when 'verified' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  assignment.principal_type asc,
  lower(coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, ''), assignment.principal_id::text)) asc,
  assignment.principal_id::text asc`,
		companyID, strings.Join(logicGateIDs, ","), EntityTypeLogicGate,
	)
	if err != nil {
		if isPostgresUndefinedTable(err, "resource_gvic_assignments") {
			return nil, ErrGVICStorageUnavailable
		}
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item domain.LogicGateGVICAssignment
		var principalName sql.NullString
		var displayName sql.NullString
		var email sql.NullString
		if err := rows.Scan(
			&item.CompanyID,
			&item.LogicGateID,
			&item.Role,
			&item.PrincipalType,
			&item.PrincipalID,
			&principalName,
			&item.UserID,
			&displayName,
			&email,
			&item.CreatedTimestamp,
		); err != nil {
			return nil, err
		}
		if principalName.Valid {
			item.PrincipalName = principalName.String
		}
		if displayName.Valid {
			item.UserDisplayName = displayName.String
		}
		if email.Valid {
			item.UserEmail = email.String
		}
		if item.PrincipalType == EntityPermissionSubjectUser && item.UserID == "" {
			item.UserID = item.PrincipalID
		}
		appendLogicGateGVICAssignment(assignmentsByGate, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for logicGateID := range assignmentsByGate {
		sortLogicGateGVICAssignments(assignmentsByGate[logicGateID])
	}
	return assignmentsByGate, nil
}

func postgresLogicGateGVICGroupUserIDsTx(ctx context.Context, tx *sql.Tx, companyID, groupID string) ([]string, error) {
	var groupInCompany bool
	if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_user_groups
  where company_id=$1::uuid and group_id::text=$2
)`, companyID, groupID).Scan(&groupInCompany); err != nil {
		return nil, err
	}
	if !groupInCompany {
		return nil, ErrPrincipalNotInCompany
	}
	rows, err := tx.QueryContext(ctx, `
with recursive group_scope(group_id) as (
  select group_id
  from company_user_groups
  where company_id=$1::uuid and group_id::text=$2
  union
  select child.group_id
  from company_user_groups child
  join group_scope parent on child.parent_group_id=parent.group_id
  where child.company_id=$1::uuid
)
select distinct member.user_id::text
from company_user_group_members member
join group_scope scope on scope.group_id=member.group_id
join company_memberships membership
  on membership.company_id=member.company_id
 and membership.user_id=member.user_id
where member.company_id=$1::uuid
order by member.user_id::text asc`, companyID, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	userIDs := []string{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		userID = strings.TrimSpace(userID)
		if userID != "" {
			userIDs = append(userIDs, userID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return userIDs, nil
}

func expandPostgresLogicGateGVICAssignmentsTx(ctx context.Context, tx *sql.Tx, companyID string, assignments []normalizedLogicGateGVICCommandAssignment) ([]normalizedLogicGateGVICCommandAssignment, error) {
	expanded := make([]normalizedLogicGateGVICCommandAssignment, 0, len(assignments))
	seen := map[string]bool{}
	for _, assignment := range assignments {
		switch assignment.principalType {
		case EntityPermissionSubjectUser:
			var userInCompany bool
			if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where company_id=$1::uuid and user_id::text=$2
)`, companyID, assignment.principalID).Scan(&userInCompany); err != nil {
				return nil, err
			}
			if !userInCompany {
				return nil, ErrPrincipalNotInCompany
			}
			key := assignment.role + ":" + assignment.principalType + ":" + assignment.principalID
			if seen[key] {
				continue
			}
			seen[key] = true
			expanded = append(expanded, assignment)
		case EntityPermissionSubjectGroup:
			userIDs, err := postgresLogicGateGVICGroupUserIDsTx(ctx, tx, companyID, assignment.principalID)
			if err != nil {
				return nil, err
			}
			for _, userID := range userIDs {
				expandedAssignment := normalizedLogicGateGVICCommandAssignment{
					role:          assignment.role,
					principalType: EntityPermissionSubjectUser,
					principalID:   userID,
					userID:        userID,
				}
				key := expandedAssignment.role + ":" + expandedAssignment.principalType + ":" + expandedAssignment.principalID
				if seen[key] {
					continue
				}
				seen[key] = true
				expanded = append(expanded, expandedAssignment)
			}
		default:
			return nil, ErrInvalid
		}
	}
	return expanded, nil
}

func (r *PostgresRepo) AddLogicGateGVICAssignments(input LogicGateGVICAssignmentCommandInput) (LogicGateGVICAssignmentCommandResult, error) {
	return r.applyLogicGateGVICAssignmentCommand(input, LogicGateGVICCommandAdd)
}

func (r *PostgresRepo) RemoveLogicGateGVICAssignments(input LogicGateGVICAssignmentCommandInput) (LogicGateGVICAssignmentCommandResult, error) {
	return r.applyLogicGateGVICAssignmentCommand(input, LogicGateGVICCommandRemove)
}

func (r *PostgresRepo) applyLogicGateGVICAssignmentCommand(input LogicGateGVICAssignmentCommandInput, operation string) (LogicGateGVICAssignmentCommandResult, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	logicGateID := strings.TrimSpace(input.LogicGateID)
	if companyID == "" || logicGateID == "" {
		return LogicGateGVICAssignmentCommandResult{}, ErrInvalid
	}
	commandAssignments, err := normalizeLogicGateGVICCommandAssignments(input.Assignments)
	if err != nil {
		return LogicGateGVICAssignmentCommandResult{}, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateGVICAssignmentCommandResult{}, err
	}
	defer tx.Rollback()

	var lockedLogicGateID string
	if err := tx.QueryRowContext(ctx, `
select logic_gate_id::text
from logic_gates
where company_id=$1::uuid and logic_gate_id=$2::uuid
for update`, companyID, logicGateID).Scan(&lockedLogicGateID); errors.Is(err, sql.ErrNoRows) {
		return LogicGateGVICAssignmentCommandResult{}, ErrNotFound
	} else if err != nil {
		return LogicGateGVICAssignmentCommandResult{}, err
	}

	for _, assignment := range commandAssignments {
		switch assignment.principalType {
		case EntityPermissionSubjectUser:
			var userInCompany bool
			if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where company_id=$1::uuid and user_id::text=$2
)`, companyID, assignment.principalID).Scan(&userInCompany); err != nil {
				return LogicGateGVICAssignmentCommandResult{}, err
			}
			if !userInCompany {
				return LogicGateGVICAssignmentCommandResult{}, ErrPrincipalNotInCompany
			}
		case EntityPermissionSubjectGroup:
			var groupInCompany bool
			if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_user_groups
  where company_id=$1::uuid and group_id::text=$2
)`, companyID, assignment.principalID).Scan(&groupInCompany); err != nil {
				return LogicGateGVICAssignmentCommandResult{}, err
			}
			if !groupInCompany {
				return LogicGateGVICAssignmentCommandResult{}, ErrPrincipalNotInCompany
			}
		default:
			return LogicGateGVICAssignmentCommandResult{}, ErrInvalid
		}
	}

	beforeByGate, err := listLogicGateGVICAssignmentsTx(ctx, tx, companyID, []string{logicGateID})
	if err != nil {
		return LogicGateGVICAssignmentCommandResult{}, err
	}
	before := cloneLogicGateGVICAssignments(beforeByGate[logicGateID])

	changed := false
	for _, assignment := range commandAssignments {
		var result sql.Result
		switch operation {
		case LogicGateGVICCommandAdd:
			result, err = tx.ExecContext(ctx, `
insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid, now(), now())
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id) do nothing`,
				companyID, EntityTypeLogicGate, logicGateID, assignment.role, assignment.principalType, assignment.principalID,
			)
		case LogicGateGVICCommandRemove:
			result, err = tx.ExecContext(ctx, `
delete from resource_gvic_assignments
where company_id=$1::uuid
  and resource_type=$2
  and resource_id=$3::uuid
  and role=$4
  and principal_type=$5
  and principal_id::text=$6`,
				companyID, EntityTypeLogicGate, logicGateID, assignment.role, assignment.principalType, assignment.principalID,
			)
		default:
			return LogicGateGVICAssignmentCommandResult{}, ErrInvalid
		}
		if err != nil {
			if isPostgresUndefinedTable(err, "resource_gvic_assignments") {
				return LogicGateGVICAssignmentCommandResult{}, ErrGVICStorageUnavailable
			}
			return LogicGateGVICAssignmentCommandResult{}, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return LogicGateGVICAssignmentCommandResult{}, err
		}
		if affected > 0 {
			changed = true
		}
	}
	assignmentsByGate, err := listLogicGateGVICAssignmentsTx(ctx, tx, companyID, []string{logicGateID})
	if err != nil {
		return LogicGateGVICAssignmentCommandResult{}, err
	}
	assignments := cloneLogicGateGVICAssignments(assignmentsByGate[logicGateID])
	projectionDeltas := []ProjectionDelta{}
	if changed {
		deltas, err := applyLogicGateProjectionDeltaDependenciesTx(ctx, tx, LogicGateProjectionDeltaDependencyInput{
			CompanyID:   companyID,
			LogicGateID: logicGateID,
		})
		if err != nil {
			return LogicGateGVICAssignmentCommandResult{}, err
		}
		projectionDeltas = deltas
	}
	result := LogicGateGVICAssignmentCommandResult{
		CompanyID:         companyID,
		LogicGateID:       logicGateID,
		Operation:         operation,
		Changed:           changed,
		GVICAssignments:   assignments,
		BeforeAssignments: before,
		ProjectionDeltas:  projectionDeltas,
		Events:            []domain.DomainEvent{},
	}
	if changed {
		event, err := r.appendDomainEventTx(ctx, tx, logicGateGVICUpdatedWorkspaceEventInput(result, commandAssignments, input))
		if err != nil {
			return LogicGateGVICAssignmentCommandResult{}, err
		}
		result.Events = []domain.DomainEvent{event}
		if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(companyID, input.ActorUserID, input.IdempotencyKey, projectionDeltas)); err != nil {
			return LogicGateGVICAssignmentCommandResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return LogicGateGVICAssignmentCommandResult{}, err
	}
	return result, nil
}
