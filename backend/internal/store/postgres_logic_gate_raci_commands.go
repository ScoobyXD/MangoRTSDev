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
  assignment.logic_gate_id::text,
  assignment.role,
  assignment.user_id::text,
  nullif(app_user.display_name, ''),
  nullif(app_user.email, ''),
  assignment.created_timestamp
from logic_gate_raci_assignments assignment
join company_memberships membership
  on membership.company_id = assignment.company_id
 and membership.user_id = assignment.user_id
join users app_user
  on app_user.user_id = assignment.user_id
where assignment.company_id = $1::uuid
  and assignment.logic_gate_id = any(string_to_array($2, ',')::uuid[])
order by assignment.logic_gate_id::text asc,
  case assignment.role
    when 'responsible' then 1
    when 'accountable' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  lower(coalesce(nullif(app_user.display_name, ''), nullif(app_user.email, ''), assignment.user_id::text)) asc,
  assignment.user_id::text asc`,
		companyID, strings.Join(logicGateIDs, ","),
	)
	if err != nil {
		if isPostgresUndefinedTable(err, "logic_gate_raci_assignments") {
			return nil, ErrRaciStorageUnavailable
		}
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		item, err := scanLogicGateRaciAssignment(rows)
		if err != nil {
			return nil, err
		}
		assignmentsByGate[item.LogicGateID] = append(assignmentsByGate[item.LogicGateID], item)
	}
	return assignmentsByGate, rows.Err()
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
		var userInCompany bool
		if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where company_id=$1::uuid and user_id::text=$2
)`, companyID, assignment.userID).Scan(&userInCompany); err != nil {
			return LogicGateRaciAssignmentCommandResult{}, err
		}
		if !userInCompany {
			return LogicGateRaciAssignmentCommandResult{}, ErrAssigneeNotInCompany
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
insert into logic_gate_raci_assignments (
  company_id,
  logic_gate_id,
  role,
  user_id,
  created_timestamp
) values ($1::uuid, $2::uuid, $3, $4::uuid, now())
on conflict (company_id, logic_gate_id, role, user_id) do nothing`,
				companyID, logicGateID, assignment.role, assignment.userID,
			)
		case LogicGateRaciCommandRemove:
			result, err = tx.ExecContext(ctx, `
delete from logic_gate_raci_assignments
where company_id=$1::uuid
  and logic_gate_id=$2::uuid
  and role=$3
  and user_id::text=$4`,
				companyID, logicGateID, assignment.role, assignment.userID,
			)
		default:
			return LogicGateRaciAssignmentCommandResult{}, ErrInvalid
		}
		if err != nil {
			if isPostgresUndefinedTable(err, "logic_gate_raci_assignments") {
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
	if changed {
		if err := syncPostgresRacioProjectionForLogicGateAssignmentsTx(ctx, tx, companyID, logicGateID, before, assignments); err != nil {
			return LogicGateRaciAssignmentCommandResult{}, err
		}
	}
	result := LogicGateRaciAssignmentCommandResult{
		CompanyID:         companyID,
		LogicGateID:       logicGateID,
		Operation:         operation,
		Changed:           changed,
		RaciAssignments:   assignments,
		BeforeAssignments: before,
		Events:            []domain.DomainEvent{},
	}
	if changed {
		event, err := r.appendDomainEventTx(ctx, tx, logicGateRaciUpdatedWorkspaceEventInput(result, commandAssignments, input))
		if err != nil {
			return LogicGateRaciAssignmentCommandResult{}, err
		}
		result.Events = []domain.DomainEvent{event}
	}
	if err := tx.Commit(); err != nil {
		return LogicGateRaciAssignmentCommandResult{}, err
	}
	return result, nil
}
