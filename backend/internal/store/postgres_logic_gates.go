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

func scanLogicGateGVICAssignment(row interface {
	Scan(dest ...any) error
}) (domain.LogicGateGVICAssignment, error) {
	var item domain.LogicGateGVICAssignment
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

func appendLogicGateGVICAssignment(assignmentsByGate map[string][]domain.LogicGateGVICAssignment, item domain.LogicGateGVICAssignment) {
	principalType, principalID := logicGateGVICAssignmentPrincipal(item)
	if item.LogicGateID == "" || item.Role == "" || principalID == "" {
		return
	}
	item.PrincipalType = principalType
	item.PrincipalID = principalID
	for _, existing := range assignmentsByGate[item.LogicGateID] {
		existingPrincipalType, existingPrincipalID := logicGateGVICAssignmentPrincipal(existing)
		if existing.Role == item.Role && existingPrincipalType == principalType && existingPrincipalID == principalID {
			return
		}
	}
	assignmentsByGate[item.LogicGateID] = append(assignmentsByGate[item.LogicGateID], item)
}

func (r *PostgresRepo) listLogicGateGVICAssignments(ctx context.Context, companyID string, logicGateIDs []string) (map[string][]domain.LogicGateGVICAssignment, error) {
	assignmentsByGate := map[string][]domain.LogicGateGVICAssignment{}
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
	defer genericRows.Close()
	for genericRows.Next() {
		var item domain.LogicGateGVICAssignment
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
		appendLogicGateGVICAssignment(assignmentsByGate, item)
	}
	if err := genericRows.Err(); err != nil {
		return nil, err
	}
	for logicGateID := range assignmentsByGate {
		sortLogicGateGVICAssignments(assignmentsByGate[logicGateID])
	}
	return assignmentsByGate, nil
}

func (r *PostgresRepo) attachLogicGateGVICAssignments(ctx context.Context, companyID string, gates []domain.LogicGate) ([]domain.LogicGate, error) {
	for index := range gates {
		gates[index].GVICAssignments = []domain.LogicGateGVICAssignment{}
		assignments, err := postgresResourceGVICAssignmentsForResource(ctx, r.db, resourceGVICKey{
			companyID:    companyID,
			resourceType: EntityTypeLogicGate,
			resourceID:   gates[index].LogicGateID,
		})
		if err != nil {
			return nil, err
		}
		gates[index].GVICAssignments = logicGateGVICAssignmentsFromResources(assignments)
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
	projectionDeltas, err := applyLogicGateProjectionDeltaDependenciesTx(ctx, tx, LogicGateProjectionDeltaDependencyInput{
		CompanyID:   item.CompanyID,
		LogicGateID: item.LogicGateID,
	})
	if err != nil {
		return domain.LogicGate{}, err
	}
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(item.CompanyID, "", "", projectionDeltas)); err != nil {
		return domain.LogicGate{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.LogicGate{}, err
	}
	items, err := r.attachLogicGateGVICAssignments(ctx, companyID, []domain.LogicGate{item})
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
	projectionDeltas, err := applyLogicGateProjectionDeltaDependenciesTx(ctx, tx, LogicGateProjectionDeltaDependencyInput{
		CompanyID:   companyID,
		LogicGateID: logicGateID,
	})
	if err != nil {
		return domain.LogicGate{}, err
	}
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(companyID, "", "", projectionDeltas)); err != nil {
		return domain.LogicGate{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.LogicGate{}, err
	}
	items, err := r.attachLogicGateGVICAssignments(ctx, companyID, []domain.LogicGate{item})
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
	return r.attachLogicGateGVICAssignments(ctx, companyID, items)
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
		companyID, userID, EntityPermissionView,
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
	items, err = r.attachLogicGateGVICAssignments(ctx, companyID, items)
	if err != nil {
		return nil, err
	}
	return r.attachLogicGateEffectiveAccessLevels(ctx, companyID, userID, items)
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
	return r.attachLogicGateGVICAssignments(ctx, companyID, items)
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
		companyID, folderID, userID, EntityPermissionView,
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
	items, err = r.attachLogicGateGVICAssignments(ctx, companyID, items)
	if err != nil {
		return nil, err
	}
	return r.attachLogicGateEffectiveAccessLevels(ctx, companyID, userID, items)
}

const postgresLogicGateMapWindowCTE = `
with recursive folder_scope as (
  select company_id, folder_id
  from company_explorer_folders
  where company_id=$1
    and folder_id=$2::uuid
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join folder_scope parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
), windowed_positions as (
  select position.company_id, position.logic_gate_id, position.x, position.y, position.updated_timestamp
  from logic_gate_map_positions position
  join company_explorer_items item
    on item.company_id=position.company_id
   and item.target_type='logic_gate'
   and item.target_id=position.logic_gate_id
  join folder_scope folder
    on folder.folder_id=item.parent_folder_id
  where position.company_id=$1
    and position.x >= $3
    and position.x <= $4
    and position.y >= $5
    and position.y <= $6
  order by position.x asc, position.y asc, position.logic_gate_id asc
  limit $7
)
`

func postgresLogicGateMapWindowArgs(query LogicGateMapWindowQuery) []any {
	return []any{query.CompanyID, query.FolderID, query.Window.MinX, query.Window.MaxX, query.Window.MinY, query.Window.MaxY, query.Limit}
}

func (r *PostgresRepo) logicGateMapWindowFolderExists(ctx context.Context, query LogicGateMapWindowQuery) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx, `
select exists(
  select 1
  from company_explorer_folders
  where company_id=$1
    and folder_id=$2::uuid
)`, query.CompanyID, query.FolderID).Scan(&exists)
	return exists, err
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
			from resource_gvic_effective_assignments assignment
			where assignment.company_id = logic_gate.company_id
			  and assignment.resource_type = 'logic_gate'
			  and assignment.resource_id = logic_gate.logic_gate_id
			  and assignment.user_id = $`+strconv.Itoa(placeholder)+`::uuid
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
		if assignedUserID != "" && isPostgresUndefinedTable(err, "resource_gvic_effective_assignments") {
			return []domain.LogicGate{}, nil
		}
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
	return r.attachLogicGateGVICAssignments(ctx, companyID, items)
}

func (r *PostgresRepo) QueryVisibleLogicGates(companyID, userID string, query LogicGateQuery) ([]domain.LogicGate, error) {
	ctx := context.Background()
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

	args := []any{companyID, userID, EntityPermissionView}
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
			from resource_gvic_effective_assignments assignment
			where assignment.company_id = logic_gate.company_id
			  and assignment.resource_type = 'logic_gate'
			  and assignment.resource_id = logic_gate.logic_gate_id
			  and assignment.user_id = $`+strconv.Itoa(placeholder)+`::uuid
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
		if assignedUserID != "" && isPostgresUndefinedTable(err, "resource_gvic_effective_assignments") {
			return []domain.LogicGate{}, nil
		}
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
	items, err = r.attachLogicGateGVICAssignments(ctx, companyID, items)
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
	items, err := r.attachLogicGateGVICAssignments(ctx, companyID, []domain.LogicGate{item})
	if err != nil {
		return domain.LogicGate{}, err
	}
	return items[0], nil
}

func (r *PostgresRepo) SetLogicGateGVICAssignments(input LogicGateGVICAssignmentUpdateInput) ([]domain.LogicGateGVICAssignment, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	logicGateID := strings.TrimSpace(input.LogicGateID)
	if companyID == "" || logicGateID == "" {
		return nil, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var lockedLogicGateID string
	if err := tx.QueryRowContext(ctx,
		`select logic_gate_id::text
		 from logic_gates
		 where company_id=$1 and logic_gate_id=$2
		 for update`,
		companyID, logicGateID,
	).Scan(&lockedLogicGateID); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	normalized := make([]normalizedLogicGateGVICCommandAssignment, 0, len(input.Assignments))
	seen := map[string]bool{}
	for _, assignment := range input.Assignments {
		normalizedAssignment, err := normalizeLogicGateGVICAssignmentInput(assignment)
		if err != nil {
			return nil, err
		}
		key := normalizedAssignment.role + ":" + normalizedAssignment.principalType + ":" + normalizedAssignment.principalID
		if seen[key] {
			continue
		}
		seen[key] = true
		normalized = append(normalized, normalizedAssignment)
	}
	if err := validateLogicGateGVICCommandAssignments(normalized, GVICAssignmentCommandSet); err != nil {
		return nil, err
	}
	normalized, err = expandPostgresLogicGateGVICAssignmentsTx(ctx, tx, companyID, normalized)
	if err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `
delete from resource_gvic_assignments
where company_id=$1 and resource_type=$2 and resource_id=$3`,
		companyID, EntityTypeLogicGate, logicGateID,
	); err != nil {
		if isPostgresUndefinedTable(err, "resource_gvic_assignments") {
			return nil, ErrGVICStorageUnavailable
		}
		return nil, err
	}
	for _, assignment := range normalized {
		if _, err := tx.ExecContext(ctx, `
insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
) values ($1, $2, $3, $4, $5, $6, now(), now())
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id) do nothing`,
			companyID, EntityTypeLogicGate, logicGateID, assignment.role, assignment.principalType, assignment.principalID,
		); err != nil {
			if isPostgresUndefinedTable(err, "resource_gvic_assignments") {
				return nil, ErrGVICStorageUnavailable
			}
			return nil, err
		}
	}
	assignmentsByGate, err := listLogicGateGVICAssignmentsTx(ctx, tx, companyID, []string{logicGateID})
	if err != nil {
		return nil, err
	}
	assignments := cloneLogicGateGVICAssignments(assignmentsByGate[logicGateID])
	keyValue := resourceGVICKey{companyID: companyID, resourceType: EntityTypeLogicGate, resourceID: logicGateID}
	projectionDeltas, err := syncResourceGVICEffectiveAssignmentsTx(ctx, tx, companyID, []resourceGVICKey{keyValue})
	if err != nil {
		return nil, err
	}
	logicGateDeltas, err := syncPostgresGVICMatrixProjectionForLogicGateAssignmentsDeltasTx(ctx, tx, companyID, logicGateID, nil, assignments)
	if err != nil {
		return nil, err
	}
	projectionDeltas = append(projectionDeltas, logicGateDeltas...)
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(companyID, "", "", projectionDeltas)); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	assignmentsByGate, err = r.listLogicGateGVICAssignments(ctx, companyID, []string{logicGateID})
	if err != nil {
		return nil, err
	}
	assignments = assignmentsByGate[logicGateID]
	if assignments == nil {
		assignments = []domain.LogicGateGVICAssignment{}
	}
	return assignments, nil
}

func (r *PostgresRepo) DeleteLogicGate(companyID, logicGateID string) error {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	projectionDeltas, err := postgresDeleteLogicGateWithProjectionDeltasTx(ctx, tx, companyID, logicGateID)
	if err != nil {
		return err
	}
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(companyID, "", "", projectionDeltas)); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListLogicGateMapPositions(companyID string) ([]domain.LogicGateMapPosition, error) {
	rows, err := r.db.Query(`
select company_id, logic_gate_id, x, y, updated_timestamp
from logic_gate_map_positions
where company_id=$1
order by logic_gate_id asc`, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.LogicGateMapPosition, 0)
	for rows.Next() {
		var item domain.LogicGateMapPosition
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.X, &item.Y, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListLogicGateMapPositionsInFolderSubtree(companyID, folderID string) ([]domain.LogicGateMapPosition, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListLogicGateMapPositions(companyID)
	}
	rows, err := r.db.Query(`
with recursive folder_scope as (
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
select position.company_id, position.logic_gate_id, position.x, position.y, position.updated_timestamp
from logic_gate_map_positions position
join visible_gates visible on visible.logic_gate_id=position.logic_gate_id
where position.company_id=$1
order by position.logic_gate_id asc`, companyID, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.LogicGateMapPosition, 0)
	for rows.Next() {
		var item domain.LogicGateMapPosition
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.X, &item.Y, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (r *PostgresRepo) ListLogicGateMapPositionsWindow(query LogicGateMapWindowQuery) ([]domain.LogicGateMapPosition, error) {
	query, err := NormalizeLogicGateMapWindowQuery(query)
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	exists, err := r.logicGateMapWindowFolderExists(ctx, query)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	rows, err := r.db.QueryContext(ctx, postgresLogicGateMapWindowCTE+`
select company_id, logic_gate_id, x, y, updated_timestamp
from windowed_positions
order by x asc, y asc, logic_gate_id asc`, postgresLogicGateMapWindowArgs(query)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.LogicGateMapPosition, 0)
	for rows.Next() {
		var item domain.LogicGateMapPosition
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.X, &item.Y, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListLogicGateMapWindow(query LogicGateMapWindowQuery) (LogicGateMapWindowResult, error) {
	query, err := NormalizeLogicGateMapWindowQuery(query)
	if err != nil {
		return LogicGateMapWindowResult{}, err
	}
	folders, err := r.ListCompanyExplorerFolderSubtree(query.CompanyID, query.FolderID, "logic_gate")
	if err != nil {
		return LogicGateMapWindowResult{}, err
	}
	if len(folders) == 0 {
		return LogicGateMapWindowResult{}, ErrNotFound
	}
	positions, err := r.ListLogicGateMapPositionsWindow(query)
	if err != nil {
		return LogicGateMapWindowResult{}, err
	}
	result := LogicGateMapWindowResult{
		CompanyID:             query.CompanyID,
		FolderID:              query.FolderID,
		Window:                query.Window,
		Limit:                 query.Limit,
		LogicGates:            []domain.LogicGate{},
		Relationships:         []domain.LogicGateRelationship{},
		Folders:               folders,
		FolderItems:           []domain.CompanyExplorerFolderItem{},
		LogicGateMapPositions: positions,
	}
	args := postgresLogicGateMapWindowArgs(query)
	ctx := context.Background()

	gateRows, err := r.db.QueryContext(ctx, postgresLogicGateMapWindowCTE+`
select gate.company_id, gate.logic_gate_id, gate.header, gate.created_timestamp
from logic_gates gate
join windowed_positions visible on visible.logic_gate_id=gate.logic_gate_id
where gate.company_id=$1
order by gate.created_timestamp asc`, args...)
	if err != nil {
		return LogicGateMapWindowResult{}, err
	}
	defer gateRows.Close()
	for gateRows.Next() {
		var item domain.LogicGate
		if err := gateRows.Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp); err != nil {
			return LogicGateMapWindowResult{}, err
		}
		result.LogicGates = append(result.LogicGates, item)
	}
	if err := gateRows.Err(); err != nil {
		return LogicGateMapWindowResult{}, err
	}
	result.LogicGates, err = r.attachLogicGateGVICAssignments(ctx, query.CompanyID, result.LogicGates)
	if err != nil {
		return LogicGateMapWindowResult{}, err
	}

	relationshipRows, err := r.db.QueryContext(ctx, postgresLogicGateMapWindowCTE+`
select rel.company_id, rel.logic_gate_relationship_id, rel.logic_gate_id_a, rel.logic_gate_id_b, rel.a_position::text, rel.b_position::text, rel.created_timestamp
from logic_gate_relationships rel
join windowed_positions a on a.logic_gate_id=rel.logic_gate_id_a
join windowed_positions b on b.logic_gate_id=rel.logic_gate_id_b
where rel.company_id=$1
order by rel.created_timestamp asc`, args...)
	if err != nil {
		return LogicGateMapWindowResult{}, err
	}
	defer relationshipRows.Close()
	for relationshipRows.Next() {
		var item domain.LogicGateRelationship
		if err := relationshipRows.Scan(
			&item.CompanyID,
			&item.LogicGateRelationshipID,
			&item.LogicGateIDA,
			&item.LogicGateIDB,
			&item.APosition,
			&item.BPosition,
			&item.CreatedTimestamp,
		); err != nil {
			return LogicGateMapWindowResult{}, err
		}
		result.Relationships = append(result.Relationships, item)
	}
	if err := relationshipRows.Err(); err != nil {
		return LogicGateMapWindowResult{}, err
	}

	itemRows, err := r.db.QueryContext(ctx, postgresLogicGateMapWindowCTE+`
select item.company_id::text, coalesce(item.parent_folder_id::text, '') as folder_id, item.target_type, item.target_id::text, item.position, item.created_timestamp, item.updated_timestamp
from company_explorer_items item
join windowed_positions visible on visible.logic_gate_id=item.target_id
where item.company_id=$1::uuid
  and item.target_type='logic_gate'
order by item.position asc, item.created_timestamp asc`, args...)
	if err != nil {
		return LogicGateMapWindowResult{}, err
	}
	defer itemRows.Close()
	for itemRows.Next() {
		var item domain.CompanyExplorerFolderItem
		if err := itemRows.Scan(
			&item.CompanyID,
			&item.FolderID,
			&item.ItemType,
			&item.ItemID,
			&item.Position,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return LogicGateMapWindowResult{}, err
		}
		result.FolderItems = append(result.FolderItems, item)
	}
	if err := itemRows.Err(); err != nil {
		return LogicGateMapWindowResult{}, err
	}
	return result, nil
}
func (r *PostgresRepo) UpsertLogicGateMapPositions(companyID string, positions []domain.LogicGateMapPosition) ([]domain.LogicGateMapPosition, error) {
	ctx := context.Background()
	out := make([]domain.LogicGateMapPosition, 0, len(positions))
	if len(positions) == 0 {
		return out, nil
	}

	logicGateIDs := make([]string, len(positions))
	xs := make([]float64, len(positions))
	ys := make([]float64, len(positions))
	for index, position := range positions {
		logicGateIDs[index] = position.LogicGateID
		xs[index] = position.X
		ys[index] = position.Y
	}

	rows, err := r.db.QueryContext(ctx, `
with input as (
  select logic_gate_id::uuid as logic_gate_id, x, y, ordinality
  from unnest($2::text[], $3::double precision[], $4::double precision[])
       with ordinality as input(logic_gate_id, x, y, ordinality)
),
missing as (
  select 1
  from input
  where not exists (
    select 1
    from logic_gates
    where company_id=$1 and logic_gate_id=input.logic_gate_id
  )
  limit 1
),
latest_input as (
  select distinct on (logic_gate_id) logic_gate_id, x, y
  from input
  order by logic_gate_id, ordinality desc
),
upserted as (
  insert into logic_gate_map_positions (company_id, logic_gate_id, x, y, updated_timestamp)
  select $1, latest_input.logic_gate_id, latest_input.x, latest_input.y, now()
  from latest_input
  where not exists (select 1 from missing)
  on conflict (company_id, logic_gate_id) do update
  set x=excluded.x,
      y=excluded.y,
      updated_timestamp=now()
  returning company_id, logic_gate_id, updated_timestamp
)
select upserted.company_id, input.logic_gate_id, input.x, input.y, upserted.updated_timestamp
from input
join upserted on upserted.logic_gate_id=input.logic_gate_id
order by input.ordinality`,
		companyID, logicGateIDs, xs, ys,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item domain.LogicGateMapPosition
		if err := rows.Scan(&item.CompanyID, &item.LogicGateID, &item.X, &item.Y, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) != len(positions) {
		return nil, ErrNotFound
	}
	return out, nil
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
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.LogicGateInformation{}, err
	}
	defer tx.Rollback()

	var exists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`,
		companyID, logicGateID,
	).Scan(&exists); err != nil {
		return domain.LogicGateInformation{}, err
	}
	if !exists {
		return domain.LogicGateInformation{}, ErrNotFound
	}

	item := domain.LogicGateInformation{
		CompanyID:     companyID,
		InformationID: newUUIDv7String(),
		LogicGateID:   logicGateID,
		Type:          infoType,
		Information:   information,
	}
	if err := tx.QueryRowContext(ctx,
		`insert into logic_gate_information
		 (company_id, information_id, logic_gate_id, type, information, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4::information_type, $5, now(), now())
		 returning company_id, information_id, logic_gate_id, type::text, information, created_timestamp, updated_timestamp`,
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

	projectionID := informationID
	if projectionID == "" {
		projectionID = item.InformationID
	}
	var projection domain.LogicGateProjection
	if isEditorTextBoxType(item.Type) {
		// Logic gates keep the legacy one-document editor contract. The new
		// multi-block timeline/chat/email workspace is node-only.
		if err := tx.QueryRowContext(ctx,
			`insert into logic_gate_projection_table
			 (company_id, logic_gate_id, information_id, type, information, created_timestamp, updated_timestamp)
			 values ($1, $2, $3, $4::information_type, $5, now(), now())
			 on conflict (company_id, logic_gate_id, type) where type = 'Text box'::information_type
			 do update set
			   information=excluded.information,
			   updated_timestamp=now()
			 returning company_id, logic_gate_id, information_id, type::text, information, created_timestamp, updated_timestamp`,
			item.CompanyID, item.LogicGateID, projectionID, item.Type, item.Information,
		).Scan(
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
	} else {
		if err := tx.QueryRowContext(ctx,
			`insert into logic_gate_projection_table
			 (company_id, logic_gate_id, information_id, type, information, created_timestamp, updated_timestamp)
			 values ($1, $2, $3, $4::information_type, $5, now(), now())
			 on conflict (company_id, logic_gate_id, information_id)
			 do update set
			   type=excluded.type,
			   information=excluded.information,
			   updated_timestamp=now()
			 returning company_id, logic_gate_id, information_id, type::text, information, created_timestamp, updated_timestamp`,
			item.CompanyID, item.LogicGateID, projectionID, item.Type, item.Information,
		).Scan(
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
	}
	if eventInput, ok := EditorProjectionUpsertEventInput(companyID, "", "", EditorProjectionRowFromLogicGate(projection)); ok {
		if _, err := r.appendEventRowsTx(ctx, tx, []EventRowInput{eventInput}); err != nil {
			return domain.LogicGateInformation{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return domain.LogicGateInformation{}, err
	}
	return item, nil
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

	rows, err := r.db.QueryContext(ctx,
		`with ranked as (
		   select company_id, logic_gate_id, information_id, type, information, created_timestamp, updated_timestamp,
		          row_number() over (
		            partition by type
		            order by updated_timestamp desc, created_timestamp desc, information_id desc
		          ) as rn
		   from logic_gate_projection_table
		   where company_id=$1 and logic_gate_id=$2
		 )
		 select company_id, logic_gate_id, information_id, type::text, information, created_timestamp, updated_timestamp
		 from ranked
		 where type <> 'Text box'::information_type or rn = 1
		 order by updated_timestamp asc`,
		companyID, logicGateID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.LogicGateProjection, 0)
	for rows.Next() {
		var item domain.LogicGateProjection
		if err := rows.Scan(
			&item.CompanyID,
			&item.LogicGateID,
			&item.InformationID,
			&item.Type,
			&item.Information,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) DeleteLogicGateProjection(companyID, logicGateID, informationID string) error {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

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
		`delete from logic_gate_projection_table
		 where company_id=$1 and logic_gate_id=$2 and information_id=$3`,
		companyID, logicGateID, informationID,
	)
	if err != nil {
		return err
	}
	if affected, err := deleted.RowsAffected(); err != nil {
		return err
	} else if affected > 0 {
		if eventInput, ok := EditorProjectionDeleteEventInput(companyID, "", "", EntityTypeLogicGate, logicGateID, informationID); ok {
			if _, err := r.appendEventRowsTx(ctx, tx, []EventRowInput{eventInput}); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func (r *PostgresRepo) GetLogicGateDetails(companyID, logicGateID string) (domain.LogicGateDetails, error) {
	logicGate, err := r.GetLogicGate(companyID, logicGateID)
	if err != nil {
		return domain.LogicGateDetails{}, err
	}

	ctx := context.Background()
	infoRows, err := r.db.QueryContext(ctx,
		`select company_id, information_id, logic_gate_id, type::text, information, created_timestamp, updated_timestamp
		 from logic_gate_information
		 where company_id=$1 and logic_gate_id=$2
		 order by created_timestamp asc`,
		companyID, logicGateID,
	)
	if err != nil {
		return domain.LogicGateDetails{}, err
	}
	defer infoRows.Close()

	information := make([]domain.LogicGateInformation, 0)
	for infoRows.Next() {
		var item domain.LogicGateInformation
		if err := infoRows.Scan(
			&item.CompanyID,
			&item.InformationID,
			&item.LogicGateID,
			&item.Type,
			&item.Information,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return domain.LogicGateDetails{}, err
		}
		information = append(information, item)
	}
	if err := infoRows.Err(); err != nil {
		return domain.LogicGateDetails{}, err
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
