package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func listLogicGateRaciAssignmentsTx(ctx context.Context, tx *sql.Tx, companyID string, logicGateIDs []string) (map[string][]domain.LogicGateRaciAssignment, error) {
	assignmentsByGate := map[string][]domain.LogicGateRaciAssignment{}
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
			return nil, ErrRaciStorageUnavailable
		}
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item domain.LogicGateRaciAssignment
		var subjectName sql.NullString
		var displayName sql.NullString
		var email sql.NullString
		if err := rows.Scan(
			&item.CompanyID,
			&item.LogicGateID,
			&item.Role,
			&item.SubjectType,
			&item.SubjectID,
			&subjectName,
			&item.UserID,
			&displayName,
			&email,
			&item.CreatedTimestamp,
		); err != nil {
			return nil, err
		}
		if subjectName.Valid {
			item.SubjectName = subjectName.String
		}
		if displayName.Valid {
			item.UserDisplayName = displayName.String
		}
		if email.Valid {
			item.UserEmail = email.String
		}
		if item.SubjectType == EntityPermissionSubjectUser && item.UserID == "" {
			item.UserID = item.SubjectID
		}
		appendLogicGateRaciAssignment(assignmentsByGate, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for logicGateID := range assignmentsByGate {
		sortLogicGateRaciAssignments(assignmentsByGate[logicGateID])
	}
	return assignmentsByGate, nil
}

func postgresLogicGateRaciGroupUserIDsTx(ctx context.Context, tx *sql.Tx, companyID, groupID string) ([]string, error) {
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
		return nil, ErrAssigneeNotInCompany
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

func expandPostgresLogicGateRaciAssignmentsTx(ctx context.Context, tx *sql.Tx, companyID string, assignments []normalizedLogicGateRaciCommandAssignment) ([]normalizedLogicGateRaciCommandAssignment, error) {
	expanded := make([]normalizedLogicGateRaciCommandAssignment, 0, len(assignments))
	seen := map[string]bool{}
	for _, assignment := range assignments {
		switch assignment.subjectType {
		case EntityPermissionSubjectUser:
			var userInCompany bool
			if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where company_id=$1::uuid and user_id::text=$2
)`, companyID, assignment.subjectID).Scan(&userInCompany); err != nil {
				return nil, err
			}
			if !userInCompany {
				return nil, ErrAssigneeNotInCompany
			}
			key := assignment.role + ":" + assignment.subjectType + ":" + assignment.subjectID
			if seen[key] {
				continue
			}
			seen[key] = true
			expanded = append(expanded, assignment)
		case EntityPermissionSubjectGroup:
			userIDs, err := postgresLogicGateRaciGroupUserIDsTx(ctx, tx, companyID, assignment.subjectID)
			if err != nil {
				return nil, err
			}
			for _, userID := range userIDs {
				expandedAssignment := normalizedLogicGateRaciCommandAssignment{
					role:        assignment.role,
					subjectType: EntityPermissionSubjectUser,
					subjectID:   userID,
					userID:      userID,
				}
				key := expandedAssignment.role + ":" + expandedAssignment.subjectType + ":" + expandedAssignment.subjectID
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

func (r *PostgresRepo) AddLogicGateRaciAssignments(input LogicGateRaciAssignmentCommandInput) (LogicGateRaciAssignmentCommandResult, error) {
	return r.applyLogicGateRaciAssignmentCommand(input, LogicGateRaciCommandAdd)
}

func (r *PostgresRepo) RemoveLogicGateRaciAssignments(input LogicGateRaciAssignmentCommandInput) (LogicGateRaciAssignmentCommandResult, error) {
	return r.applyLogicGateRaciAssignmentCommand(input, LogicGateRaciCommandRemove)
}

func (r *PostgresRepo) applyLogicGateRaciAssignmentCommand(input LogicGateRaciAssignmentCommandInput, operation string) (LogicGateRaciAssignmentCommandResult, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	logicGateID := strings.TrimSpace(input.LogicGateID)
	if companyID == "" || logicGateID == "" {
		return LogicGateRaciAssignmentCommandResult{}, ErrInvalid
	}
	commandAssignments, err := normalizeLogicGateRaciCommandAssignments(input.Assignments)
	if err != nil {
		return LogicGateRaciAssignmentCommandResult{}, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateRaciAssignmentCommandResult{}, err
	}
	defer tx.Rollback()

	var lockedLogicGateID string
	if err := tx.QueryRowContext(ctx, `
select logic_gate_id::text
from logic_gates
where company_id=$1::uuid and logic_gate_id=$2::uuid
for update`, companyID, logicGateID).Scan(&lockedLogicGateID); errors.Is(err, sql.ErrNoRows) {
		return LogicGateRaciAssignmentCommandResult{}, ErrNotFound
	} else if err != nil {
		return LogicGateRaciAssignmentCommandResult{}, err
	}

	for _, assignment := range commandAssignments {
		switch assignment.subjectType {
		case EntityPermissionSubjectUser:
			var userInCompany bool
			if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where company_id=$1::uuid and user_id::text=$2
)`, companyID, assignment.subjectID).Scan(&userInCompany); err != nil {
				return LogicGateRaciAssignmentCommandResult{}, err
			}
			if !userInCompany {
				return LogicGateRaciAssignmentCommandResult{}, ErrAssigneeNotInCompany
			}
		case EntityPermissionSubjectGroup:
			var groupInCompany bool
			if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_user_groups
  where company_id=$1::uuid and group_id::text=$2
)`, companyID, assignment.subjectID).Scan(&groupInCompany); err != nil {
				return LogicGateRaciAssignmentCommandResult{}, err
			}
			if !groupInCompany {
				return LogicGateRaciAssignmentCommandResult{}, ErrAssigneeNotInCompany
			}
		default:
			return LogicGateRaciAssignmentCommandResult{}, ErrInvalid
		}
	}

	beforeByGate, err := listLogicGateRaciAssignmentsTx(ctx, tx, companyID, []string{logicGateID})
	if err != nil {
		return LogicGateRaciAssignmentCommandResult{}, err
	}
	before := cloneLogicGateRaciAssignments(beforeByGate[logicGateID])

	changed := false
	for _, assignment := range commandAssignments {
		var result sql.Result
		switch operation {
		case LogicGateRaciCommandAdd:
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
				companyID, EntityTypeLogicGate, logicGateID, assignment.role, assignment.subjectType, assignment.subjectID,
			)
		case LogicGateRaciCommandRemove:
			result, err = tx.ExecContext(ctx, `
delete from resource_gvic_assignments
where company_id=$1::uuid
  and resource_type=$2
  and resource_id=$3::uuid
  and role=$4
  and principal_type=$5
  and principal_id::text=$6`,
				companyID, EntityTypeLogicGate, logicGateID, assignment.role, assignment.subjectType, assignment.subjectID,
			)
		default:
			return LogicGateRaciAssignmentCommandResult{}, ErrInvalid
		}
		if err != nil {
			if isPostgresUndefinedTable(err, "resource_gvic_assignments") {
				return LogicGateRaciAssignmentCommandResult{}, ErrRaciStorageUnavailable
			}
			return LogicGateRaciAssignmentCommandResult{}, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return LogicGateRaciAssignmentCommandResult{}, err
		}
		if affected > 0 {
			changed = true
		}
	}
	assignmentsByGate, err := listLogicGateRaciAssignmentsTx(ctx, tx, companyID, []string{logicGateID})
	if err != nil {
		return LogicGateRaciAssignmentCommandResult{}, err
	}
	assignments := cloneLogicGateRaciAssignments(assignmentsByGate[logicGateID])
	projectionDeltas := []ProjectionDelta{}
	if changed {
		deltas, err := applyLogicGateProjectionDeltaDependenciesTx(ctx, tx, LogicGateProjectionDeltaDependencyInput{
			CompanyID:   companyID,
			LogicGateID: logicGateID,
		})
		if err != nil {
			return LogicGateRaciAssignmentCommandResult{}, err
		}
		projectionDeltas = deltas
	}
	result := LogicGateRaciAssignmentCommandResult{
		CompanyID:         companyID,
		LogicGateID:       logicGateID,
		Operation:         operation,
		Changed:           changed,
		RaciAssignments:   assignments,
		BeforeAssignments: before,
		ProjectionDeltas:  projectionDeltas,
		Events:            []domain.DomainEvent{},
	}
	if changed {
		event, err := r.appendDomainEventTx(ctx, tx, logicGateRaciUpdatedWorkspaceEventInput(result, commandAssignments, input))
		if err != nil {
			return LogicGateRaciAssignmentCommandResult{}, err
		}
		result.Events = []domain.DomainEvent{event}
		if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(companyID, input.ActorUserID, input.IdempotencyKey, projectionDeltas)); err != nil {
			return LogicGateRaciAssignmentCommandResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return LogicGateRaciAssignmentCommandResult{}, err
	}
	return result, nil
}
