package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

const (
	postgresUndefinedTableCode            = "42P01"
	postgresUndefinedColumnCode           = "42703"
	postgresInvalidTextRepresentationCode = "22P02"
)

func isPostgresUndefinedTable(err error, tableName string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != postgresUndefinedTableCode {
		return false
	}
	if tableName == "" {
		return true
	}
	return strings.Contains(pgErr.Message, tableName)
}

func isPostgresUndefinedColumn(err error, columnName string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != postgresUndefinedColumnCode {
		return false
	}
	if columnName == "" {
		return true
	}
	return strings.Contains(pgErr.Message, columnName)
}

func isPostgresInvalidTextRepresentation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == postgresInvalidTextRepresentationCode
}

func scanLogicGateRACIAssignment(row interface {
	Scan(dest ...any) error
}) (domain.LogicGateRACIAssignment, error) {
	var item domain.LogicGateRACIAssignment
	var displayName sql.NullString
	var email sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.LogicGateID,
		&item.Role,
		&item.UserID,
		&displayName,
		&email,
		&item.CreatedTimestamp,
	)
	if displayName.Valid {
		item.UserDisplayName = displayName.String
	}
	if email.Valid {
		item.UserEmail = email.String
	}
	item.PrincipalType = EntityPermissionSubjectUser
	item.PrincipalID = strings.TrimSpace(item.UserID)
	item.PrincipalName = strings.TrimSpace(item.UserDisplayName)
	if item.PrincipalName == "" {
		item.PrincipalName = strings.TrimSpace(item.UserEmail)
	}
	return item, err
}

func appendLogicGateRACIAssignment(assignmentsByGate map[string][]domain.LogicGateRACIAssignment, item domain.LogicGateRACIAssignment) {
	principalType, principalID := logicGateRACIAssignmentPrincipal(item)
	if item.LogicGateID == "" || item.Role == "" || principalID == "" {
		return
	}
	item.PrincipalType = principalType
	item.PrincipalID = principalID
	for _, existing := range assignmentsByGate[item.LogicGateID] {
		existingPrincipalType, existingPrincipalID := logicGateRACIAssignmentPrincipal(existing)
		if existing.Role == item.Role && existingPrincipalType == principalType && existingPrincipalID == principalID {
			return
		}
	}
	assignmentsByGate[item.LogicGateID] = append(assignmentsByGate[item.LogicGateID], item)
}

func (r *PostgresRepo) listLogicGateRACIAssignments(ctx context.Context, companyID string, logicGateIDs []string) (map[string][]domain.LogicGateRACIAssignment, error) {
	assignmentsByGate := map[string][]domain.LogicGateRACIAssignment{}
	if len(logicGateIDs) == 0 {
		return assignmentsByGate, nil
	}
	genericRows, err := r.db.QueryContext(ctx, `
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
    when 'responsible' then 1
    when 'consulted' then 2
    when 'accountable' then 3
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
			return nil, ErrRACIStorageUnavailable
		}
		return nil, err
	}
	defer genericRows.Close()
	for genericRows.Next() {
		var item domain.LogicGateRACIAssignment
		var principalName sql.NullString
		var displayName sql.NullString
		var email sql.NullString
		if err := genericRows.Scan(
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
		appendLogicGateRACIAssignment(assignmentsByGate, item)
	}
	if err := genericRows.Err(); err != nil {
		return nil, err
	}
	for logicGateID := range assignmentsByGate {
		sortLogicGateRACIAssignments(assignmentsByGate[logicGateID])
	}
	return assignmentsByGate, nil
}

func (r *PostgresRepo) attachLogicGateRACIAssignments(ctx context.Context, companyID string, gates []domain.LogicGate) ([]domain.LogicGate, error) {
	for index := range gates {
		gates[index].RACIAssignments = []domain.LogicGateRACIAssignment{}
		policy, err := r.GetResourceRACIPolicy(companyID, EntityTypeLogicGate, gates[index].LogicGateID)
		if err != nil {
			return nil, err
		}
		assignments := make([]domain.ResourceRACIAssignment, 0, len(policy.EffectiveAssignments))
		for _, effective := range policy.EffectiveAssignments {
			assignments = append(assignments, domain.ResourceRACIAssignment{Role: effective.Role, PrincipalType: EntityPermissionSubjectUser, PrincipalID: effective.UserID})
		}
		gates[index].RACIAssignments = logicGateRACIAssignmentsFromResources(assignments)
	}
	return gates, nil
}

func (r *PostgresRepo) CreateLogicGate(companyID, header string) (domain.LogicGate, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.LogicGate{}, err
	}
	defer tx.Rollback()

	item := domain.LogicGate{CompanyID: companyID, LogicGateID: newUUIDv7String(), Header: header, DefaultAccess: ResourceDefaultAccessEdit}
	err = tx.QueryRowContext(ctx,
		`insert into logic_gates (company_id, logic_gate_id, header, created_timestamp)
		 values ($1, $2, $3, now())
		 returning company_id, logic_gate_id, header, created_timestamp`,
		item.CompanyID, item.LogicGateID, item.Header,
	).Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp)
	if err != nil {
		return domain.LogicGate{}, err
	}
	err = syncLogicGateProjectionDependenciesTx(ctx, tx, LogicGateProjectionDependencyInput{
		CompanyID:   item.CompanyID,
		LogicGateID: item.LogicGateID,
	})
	if err != nil {
		return domain.LogicGate{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.LogicGate{}, err
	}
	items, err := r.attachLogicGateRACIAssignments(ctx, companyID, []domain.LogicGate{item})
	if err != nil {
		return domain.LogicGate{}, err
	}
	return items[0], nil
}

func (r *PostgresRepo) UpdateLogicGateHeader(companyID, logicGateID, header string) (domain.LogicGate, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.LogicGate{}, err
	}
	defer tx.Rollback()

	const q = `
UPDATE logic_gates
SET header = $3
WHERE company_id = $1 AND logic_gate_id = $2
RETURNING company_id, logic_gate_id, header, created_timestamp
`
	var item domain.LogicGate
	if err := tx.QueryRowContext(ctx, q, companyID, logicGateID, header).Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.LogicGate{}, ErrNotFound
		}
		return domain.LogicGate{}, err
	}
	err = syncLogicGateProjectionDependenciesTx(ctx, tx, LogicGateProjectionDependencyInput{
		CompanyID:   companyID,
		LogicGateID: logicGateID,
	})
	if err != nil {
		return domain.LogicGate{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.LogicGate{}, err
	}
	items, err := r.attachLogicGateRACIAssignments(ctx, companyID, []domain.LogicGate{item})
	if err != nil {
		return domain.LogicGate{}, err
	}
	return items[0], nil
}

func (r *PostgresRepo) ListLogicGates(companyID string) ([]domain.LogicGate, error) {
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`select company_id, logic_gate_id, header, created_timestamp
		 from logic_gates
		 where company_id=$1
		 order by created_timestamp asc`,
		companyID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.LogicGate, 0)
	for rows.Next() {
		var item domain.LogicGate
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return r.attachLogicGateRACIAssignments(ctx, companyID, items)
}

func (r *PostgresRepo) ListVisibleLogicGates(companyID, userID string) ([]domain.LogicGate, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
		 from logic_gates gate
		 where gate.company_id=$1::uuid
		   and mangorts_user_can_access_resource(gate.company_id, 'logic_gate', gate.logic_gate_id, $2::uuid, $3::text)
		 order by gate.created_timestamp asc, gate.logic_gate_id::text asc`,
		companyID, userID, EntityPermissionEdit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.LogicGate, 0)
	for rows.Next() {
		var item domain.LogicGate
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items, err = r.attachLogicGateRACIAssignments(ctx, companyID, items)
	if err != nil {
		return nil, err
	}
	return r.attachLogicGateEffectiveAccessLevels(ctx, companyID, userID, items)
}

func (r *PostgresRepo) ListLogicGateSummaries(companyID string) ([]domain.LogicGate, error) {
	return r.listLogicGateSummaries(companyID, "")
}

func (r *PostgresRepo) ListVisibleLogicGateSummaries(companyID, userID string) ([]domain.LogicGate, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	return r.listLogicGateSummaries(companyID, userID)
}

func (r *PostgresRepo) listLogicGateSummaries(companyID, userID string) ([]domain.LogicGate, error) {
	ctx := context.Background()
	query := `select company_id, logic_gate_id, header, created_timestamp
		from logic_gates
		where company_id=$1
		order by created_timestamp asc, logic_gate_id::text asc`
	args := []any{companyID}
	if userID != "" {
		query = `select company_id, logic_gate_id, header, created_timestamp
			from logic_gates
			where company_id=$1::uuid
			  and mangorts_user_can_access_resource(company_id, 'logic_gate', logic_gate_id, $2::uuid, $3::text)
			order by created_timestamp asc, logic_gate_id::text asc`
		args = []any{companyID, userID, EntityPermissionEdit}
	}
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.LogicGate, 0)
	for rows.Next() {
		var item domain.LogicGate
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListLogicGatesInFolderSubtree(companyID, folderID string) ([]domain.LogicGate, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListLogicGates(companyID)
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`with recursive folder_scope as (
		   select company_id, folder_id
		   from company_explorer_folders
		   where company_id=$1 and folder_id=$2::uuid
		   union all
		   select child.company_id, child.folder_id
		   from company_explorer_folders child
		   join folder_scope parent
		     on child.company_id=parent.company_id
		    and child.parent_folder_id=parent.folder_id
		 ), visible_gates as (
		   select item.target_id as logic_gate_id
		   from company_explorer_items item
		   join folder_scope folder on folder.folder_id=item.parent_folder_id
		   where item.company_id=$1::uuid and item.target_type='logic_gate'
		 )
		 select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
		 from logic_gates gate
		 join visible_gates visible on visible.logic_gate_id=gate.logic_gate_id
		 where gate.company_id=$1
		 order by gate.created_timestamp asc`,
		companyID, folderID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.LogicGate, 0)
	for rows.Next() {
		var item domain.LogicGate
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return r.attachLogicGateRACIAssignments(ctx, companyID, items)
}

func (r *PostgresRepo) ListVisibleLogicGatesInFolderSubtree(companyID, folderID, userID string) ([]domain.LogicGate, error) {
	companyID = cleanUUIDText(companyID)
	folderID = strings.TrimSpace(folderID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleLogicGates(companyID, userID)
	}

	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`with recursive folder_scope as (
		   select company_id, folder_id
		   from company_explorer_folders
		   where company_id=$1::uuid and folder_id=$2::uuid
		   union all
		   select child.company_id, child.folder_id
		   from company_explorer_folders child
		   join folder_scope parent
		     on child.company_id=parent.company_id
		    and child.parent_folder_id=parent.folder_id
		 ), folder_gates as (
		   select distinct item.target_id as logic_gate_id
		   from company_explorer_items item
		   join folder_scope folder on folder.folder_id=item.parent_folder_id
		   where item.company_id=$1::uuid and item.target_type='logic_gate'
		 )
		 select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
		 from logic_gates gate
		 join folder_gates visible on visible.logic_gate_id=gate.logic_gate_id
		 where gate.company_id=$1::uuid
		   and mangorts_user_can_access_resource(gate.company_id, 'logic_gate', gate.logic_gate_id, $3::uuid, $4::text)
		 order by gate.created_timestamp asc, gate.logic_gate_id::text asc`,
		companyID, folderID, userID, EntityPermissionEdit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.LogicGate, 0)
	for rows.Next() {
		var item domain.LogicGate
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items, err = r.attachLogicGateRACIAssignments(ctx, companyID, items)
	if err != nil {
		return nil, err
	}
	return r.attachLogicGateEffectiveAccessLevels(ctx, companyID, userID, items)
}

func (r *PostgresRepo) QueryLogicGates(companyID string, query LogicGateQuery) ([]domain.LogicGate, error) {
	ctx := context.Background()
	companyID = strings.TrimSpace(companyID)
	args := []any{companyID}
	conditions := []string{"logic_gate.company_id = $1"}
	search := strings.ToLower(strings.TrimSpace(query.Search))
	if search != "" {
		args = append(args, "%"+search+"%")
		placeholder := len(args)
		conditions = append(conditions, "(lower(logic_gate.header) like $"+strconv.Itoa(placeholder)+" or logic_gate.logic_gate_id::text like $"+strconv.Itoa(placeholder)+")")
	}
	assignedUserID := strings.TrimSpace(query.AssignedUserID)
	if assignedUserID != "" {
		args = append(args, assignedUserID)
		placeholder := len(args)
		conditions = append(conditions, `exists (
			select 1
			from mangorts_v2_effective_gvic_assignments(logic_gate.company_id, 'logic_gate', logic_gate.logic_gate_id) assignment
			where assignment.user_id = $`+strconv.Itoa(placeholder)+`::uuid
		)`)
	}
	sqlText := `select logic_gate.company_id, logic_gate.logic_gate_id, logic_gate.header, logic_gate.created_timestamp
from logic_gates logic_gate
where ` + strings.Join(conditions, " and ") + `
order by lower(logic_gate.header) asc, logic_gate.logic_gate_id::text asc`
	if query.Limit > 0 {
		args = append(args, query.Limit)
		sqlText += "\nlimit $" + strconv.Itoa(len(args))
	}
	rows, err := r.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.LogicGate, 0)
	for rows.Next() {
		var item domain.LogicGate
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return r.attachLogicGateRACIAssignments(ctx, companyID, items)
}

func (r *PostgresRepo) QueryVisibleLogicGates(companyID, userID string, query LogicGateQuery) ([]domain.LogicGate, error) {
	ctx := context.Background()
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

	args := []any{companyID, userID, EntityPermissionEdit}
	conditions := []string{"logic_gate.company_id = $1::uuid"}
	search := strings.ToLower(strings.TrimSpace(query.Search))
	if search != "" {
		args = append(args, "%"+search+"%")
		placeholder := len(args)
		conditions = append(conditions, "(lower(logic_gate.header) like $"+strconv.Itoa(placeholder)+" or logic_gate.logic_gate_id::text like $"+strconv.Itoa(placeholder)+")")
	}
	assignedUserID := strings.TrimSpace(query.AssignedUserID)
	if assignedUserID != "" {
		args = append(args, assignedUserID)
		placeholder := len(args)
		conditions = append(conditions, `exists (
			select 1
			from mangorts_v2_effective_gvic_assignments(logic_gate.company_id, 'logic_gate', logic_gate.logic_gate_id) assignment
			where assignment.user_id = $`+strconv.Itoa(placeholder)+`::uuid
		)`)
	}
	sqlText := `select logic_gate.company_id, logic_gate.logic_gate_id, logic_gate.header, logic_gate.created_timestamp
from logic_gates logic_gate
where ` + strings.Join(conditions, " and ") + `
  and mangorts_user_can_access_resource(logic_gate.company_id, 'logic_gate', logic_gate.logic_gate_id, $2::uuid, $3::text)
order by lower(logic_gate.header) asc, logic_gate.logic_gate_id::text asc`
	if query.Limit > 0 {
		args = append(args, query.Limit)
		sqlText += "\nlimit $" + strconv.Itoa(len(args))
	}
	rows, err := r.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.LogicGate, 0)
	for rows.Next() {
		var item domain.LogicGate
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items, err = r.attachLogicGateRACIAssignments(ctx, companyID, items)
	if err != nil {
		return nil, err
	}
	return r.attachLogicGateEffectiveAccessLevels(ctx, companyID, userID, items)
}

func (r *PostgresRepo) attachLogicGateEffectiveAccessLevels(ctx context.Context, companyID, userID string, items []domain.LogicGate) ([]domain.LogicGate, error) {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.LogicGateID)
	}
	levels, err := r.effectiveAccessLevelsForUser(ctx, companyID, userID, EntityTypeLogicGate, ids)
	if err != nil {
		return nil, err
	}
	for index := range items {
		items[index].EffectiveAccess = levels[items[index].LogicGateID]
	}
	return items, nil
}

func (r *PostgresRepo) GetLogicGate(companyID, logicGateID string) (domain.LogicGate, error) {
	ctx := context.Background()
	var item domain.LogicGate
	err := r.db.QueryRowContext(ctx,
		`select company_id, logic_gate_id, header, created_timestamp
		 from logic_gates where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	).Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.LogicGate{}, ErrNotFound
	}
	if err != nil {
		return domain.LogicGate{}, err
	}
	if defaultAccess, err := postgresResourceDefaultAccess(ctx, r.db, companyID, EntityTypeLogicGate, logicGateID); err == nil {
		item.DefaultAccess = defaultAccess
	} else if err != nil && !errors.Is(err, ErrNotFound) {
		return domain.LogicGate{}, err
	}
	items, err := r.attachLogicGateRACIAssignments(ctx, companyID, []domain.LogicGate{item})
	if err != nil {
		return domain.LogicGate{}, err
	}
	return items[0], nil
}

func (r *PostgresRepo) SetLogicGateRACIAssignments(input LogicGateRACIAssignmentUpdateInput) ([]domain.LogicGateRACIAssignment, error) {
	current, err := r.GetResourceRACIPolicy(input.CompanyID, EntityTypeLogicGate, input.LogicGateID)
	if err != nil {
		return nil, err
	}
	assignments := make([]ResourceRACIAssignmentInput, 0, len(input.Assignments))
	for _, item := range input.Assignments {
		normalized, err := normalizeLogicGateRACIAssignmentInput(item)
		if err != nil {
			return nil, err
		}
		assignments = append(assignments, ResourceRACIAssignmentInput{Role: normalized.role, PrincipalType: normalized.principalType, PrincipalID: normalized.principalID})
	}
	policy, _, err := r.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: input.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: input.LogicGateID,
		AssignmentMode: PolicyModeCustomized, Assignments: assignments, DescendantAction: PolicyDescendantActionInheritedOnly,
		ExpectedRevision: current.Revision,
	})
	if err != nil {
		return nil, err
	}
	return logicGateRACIAssignmentsFromResources(policy.RACIAssignments), nil
}

func (r *PostgresRepo) DeleteLogicGate(companyID, logicGateID string) error {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	err = postgresDeleteLogicGateWithDependentProjectionsTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListLogicGateRelationships(companyID string) ([]domain.LogicGateRelationship, error) {
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`select company_id, logic_gate_relationship_id, logic_gate_id_a, logic_gate_id_b, a_position::text, b_position::text, created_timestamp
		 from logic_gate_relationships
		 where company_id=$1
		 order by created_timestamp asc`,
		companyID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.LogicGateRelationship, 0)
	for rows.Next() {
		var item domain.LogicGateRelationship
		if err := rows.Scan(
			&item.CompanyID,
			&item.LogicGateRelationshipID,
			&item.LogicGateIDA,
			&item.LogicGateIDB,
			&item.APosition,
			&item.BPosition,
			&item.CreatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListLogicGateRelationshipsInFolderSubtree(companyID, folderID string) ([]domain.LogicGateRelationship, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListLogicGateRelationships(companyID)
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx,
		`with recursive folder_scope as (
		   select company_id, folder_id
		   from company_explorer_folders
		   where company_id=$1 and folder_id=$2::uuid
		   union all
		   select child.company_id, child.folder_id
		   from company_explorer_folders child
		   join folder_scope parent
		     on child.company_id=parent.company_id
		    and child.parent_folder_id=parent.folder_id
		 ), visible_gates as (
		   select item.target_id as logic_gate_id
		   from company_explorer_items item
		   join folder_scope folder on folder.folder_id=item.parent_folder_id
		   where item.company_id=$1::uuid and item.target_type='logic_gate'
		 )
		 select rel.company_id, rel.logic_gate_relationship_id, rel.logic_gate_id_a, rel.logic_gate_id_b, rel.a_position::text, rel.b_position::text, rel.created_timestamp
		 from logic_gate_relationships rel
		 join visible_gates a on a.logic_gate_id=rel.logic_gate_id_a
		 join visible_gates b on b.logic_gate_id=rel.logic_gate_id_b
		 where rel.company_id=$1
		 order by rel.created_timestamp asc`,
		companyID, folderID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.LogicGateRelationship, 0)
	for rows.Next() {
		var item domain.LogicGateRelationship
		if err := rows.Scan(
			&item.CompanyID,
			&item.LogicGateRelationshipID,
			&item.LogicGateIDA,
			&item.LogicGateIDB,
			&item.APosition,
			&item.BPosition,
			&item.CreatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (r *PostgresRepo) CreateLogicGateRelationship(companyID, logicGateIDA, logicGateIDB, aPosition, bPosition string) (domain.LogicGateRelationship, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.LogicGateRelationship{}, err
	}
	defer tx.Rollback()

	for _, candidate := range []string{logicGateIDA, logicGateIDB} {
		var exists bool
		if err := tx.QueryRowContext(ctx,
			`select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`,
			companyID, candidate,
		).Scan(&exists); err != nil {
			return domain.LogicGateRelationship{}, err
		}
		if !exists {
			return domain.LogicGateRelationship{}, ErrNotFound
		}
	}

	item := domain.LogicGateRelationship{
		CompanyID:               companyID,
		LogicGateRelationshipID: newUUIDv7String(),
		LogicGateIDA:            logicGateIDA,
		LogicGateIDB:            logicGateIDB,
		APosition:               aPosition,
		BPosition:               bPosition,
	}
	if err := tx.QueryRowContext(ctx,
		`insert into logic_gate_relationships
		 (company_id, logic_gate_relationship_id, logic_gate_id_a, logic_gate_id_b, a_position, b_position, created_timestamp)
		 values ($1, $2, $3, $4, $5::logic_gate_relationship_position, $6::logic_gate_relationship_position, now())
		 returning company_id, logic_gate_relationship_id, logic_gate_id_a, logic_gate_id_b, a_position::text, b_position::text, created_timestamp`,
		item.CompanyID, item.LogicGateRelationshipID, item.LogicGateIDA, item.LogicGateIDB, item.APosition, item.BPosition,
	).Scan(
		&item.CompanyID,
		&item.LogicGateRelationshipID,
		&item.LogicGateIDA,
		&item.LogicGateIDB,
		&item.APosition,
		&item.BPosition,
		&item.CreatedTimestamp,
	); err != nil {
		return domain.LogicGateRelationship{}, err
	}

	if err := tx.Commit(); err != nil {
		return domain.LogicGateRelationship{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteLogicGateRelationship(companyID, relationshipID string) error {
	ctx := context.Background()
	deleted, err := r.db.ExecContext(ctx,
		`delete from logic_gate_relationships
		 where company_id=$1 and logic_gate_relationship_id=$2`,
		companyID, relationshipID,
	)
	if err != nil {
		return err
	}
	affected, err := deleted.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) AddLogicGateInformation(companyID, logicGateID, infoType, information, informationID string) (domain.LogicGateInformation, error) {
	return domain.LogicGateInformation{}, ErrInvalid
}
func (r *PostgresRepo) ListLogicGateProjections(companyID, logicGateID string) ([]domain.LogicGateProjection, error) {
	ctx := context.Background()
	var exists bool
	if err := r.db.QueryRowContext(ctx,
		`select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`,
		companyID, logicGateID,
	).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	return listPostgresLogicGateFinalProjections(ctx, r.db, companyID, logicGateID)
}
func (r *PostgresRepo) DeleteLogicGateProjection(input LogicGateProjectionDeleteInput) error {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	companyID := strings.TrimSpace(input.CompanyID)
	logicGateID := strings.TrimSpace(input.LogicGateID)
	informationID := strings.TrimSpace(input.InformationID)

	var exists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`,
		companyID, logicGateID,
	).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	deleted, err := tx.ExecContext(ctx,
		`delete from email_relationships
		 where company_id=$1::uuid and resource_type='logic_gate'
		   and resource_id=$2::uuid and email_relationship_id=$3::uuid`,
		companyID, logicGateID, informationID,
	)
	if err != nil {
		return err
	}
	if affected, err := deleted.RowsAffected(); err != nil {
		return err
	} else if affected == 0 {
		return ErrInvalid
	}
	return tx.Commit()
}
func (r *PostgresRepo) GetLogicGateDetails(companyID, logicGateID string) (domain.LogicGateDetails, error) {
	logicGate, err := r.GetLogicGate(companyID, logicGateID)
	if err != nil {
		return domain.LogicGateDetails{}, err
	}

	ctx := context.Background()
	projections, err := listPostgresLogicGateFinalProjections(ctx, r.db, companyID, logicGateID)
	if err != nil {
		return domain.LogicGateDetails{}, err
	}
	information := make([]domain.LogicGateInformation, 0, len(projections))
	for _, projection := range projections {
		information = append(information, logicGateProjectionAsInformation(projection))
	}

	relRows, err := r.db.QueryContext(ctx,
		`select company_id, logic_gate_relationship_id, logic_gate_id_a, logic_gate_id_b, a_position::text, b_position::text, created_timestamp
		 from logic_gate_relationships
		 where company_id=$1 and (logic_gate_id_a=$2 or logic_gate_id_b=$2)
		 order by created_timestamp asc`,
		companyID, logicGateID,
	)
	if err != nil {
		return domain.LogicGateDetails{}, err
	}
	defer relRows.Close()

	relationships := make([]domain.LogicGateRelationship, 0)
	for relRows.Next() {
		var item domain.LogicGateRelationship
		if err := relRows.Scan(
			&item.CompanyID,
			&item.LogicGateRelationshipID,
			&item.LogicGateIDA,
			&item.LogicGateIDB,
			&item.APosition,
			&item.BPosition,
			&item.CreatedTimestamp,
		); err != nil {
			return domain.LogicGateDetails{}, err
		}
		relationships = append(relationships, item)
	}
	if err := relRows.Err(); err != nil {
		return domain.LogicGateDetails{}, err
	}

	return domain.LogicGateDetails{
		LogicGate:     logicGate,
		Information:   information,
		Relationships: relationships,
	}, nil
}

// Explorer folders and items are stored in separate tables but render as one
// sibling list. Append positions must therefore inspect both tables.
