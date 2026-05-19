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

const postgresUndefinedTableCode = "42P01"

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

func scanLogicGateRaciAssignment(row interface {
	Scan(dest ...any) error
}) (domain.LogicGateRaciAssignment, error) {
	var item domain.LogicGateRaciAssignment
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
	return item, err
}

func (r *PostgresRepo) listLogicGateRaciAssignments(ctx context.Context, companyID string, logicGateIDs []string) (map[string][]domain.LogicGateRaciAssignment, error) {
	assignmentsByGate := map[string][]domain.LogicGateRaciAssignment{}
	if len(logicGateIDs) == 0 {
		return assignmentsByGate, nil
	}
	rows, err := r.db.QueryContext(ctx, `
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
where assignment.company_id = $1
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
			return assignmentsByGate, nil
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

func (r *PostgresRepo) attachLogicGateRaciAssignments(ctx context.Context, companyID string, gates []domain.LogicGate) ([]domain.LogicGate, error) {
	ids := make([]string, 0, len(gates))
	for _, gate := range gates {
		ids = append(ids, gate.LogicGateID)
	}
	assignments, err := r.listLogicGateRaciAssignments(ctx, companyID, ids)
	if err != nil {
		return nil, err
	}
	for index := range gates {
		gates[index].RaciAssignments = assignments[gates[index].LogicGateID]
		if gates[index].RaciAssignments == nil {
			gates[index].RaciAssignments = []domain.LogicGateRaciAssignment{}
		}
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

	item := domain.LogicGate{CompanyID: companyID, LogicGateID: newUUIDv7String(), Header: header}
	err = tx.QueryRowContext(ctx,
		`insert into logic_gates (company_id, logic_gate_id, header, created_timestamp)
		 values ($1, $2, $3, now())
		 returning company_id, logic_gate_id, header, created_timestamp`,
		item.CompanyID, item.LogicGateID, item.Header,
	).Scan(&item.CompanyID, &item.LogicGateID, &item.Header, &item.CreatedTimestamp)
	if err != nil {
		return domain.LogicGate{}, err
	}
	if err := ensureLogicGateKanbanBoardSQL(ctx, tx, companyID, item.LogicGateID, item.Header); err != nil {
		return domain.LogicGate{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.LogicGate{}, err
	}
	items, err := r.attachLogicGateRaciAssignments(ctx, companyID, []domain.LogicGate{item})
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
	if _, err := tx.ExecContext(ctx, `
update kanban_boards
set title=$3,
    updated_timestamp=now()
where company_id=$1 and logic_gate_id=$2::uuid`,
		companyID, logicGateID, normalizeKanbanBoardTitle(LogicGateKanbanBoardID(logicGateID), header)); err != nil {
		return domain.LogicGate{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.LogicGate{}, err
	}
	items, err := r.attachLogicGateRaciAssignments(ctx, companyID, []domain.LogicGate{item})
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
	return r.attachLogicGateRaciAssignments(ctx, companyID, items)
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
		   where company_id=$1 and folder_id=$2::uuid and folder_kind='logic_gate'
		   union all
		   select child.company_id, child.folder_id
		   from company_explorer_folders child
		   join folder_scope parent
		     on child.company_id=parent.company_id
		    and child.parent_folder_id=parent.folder_id
		   where child.folder_kind='logic_gate'
		 ), visible_gates as (
		   select item.item_id::uuid as logic_gate_id
		   from company_explorer_folder_items item
		   join folder_scope folder on folder.folder_id=item.folder_id
		   where item.company_id=$1 and item.item_type='logic_gate'
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
	return r.attachLogicGateRaciAssignments(ctx, companyID, items)
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
			from logic_gate_raci_assignments assignment
			where assignment.company_id = logic_gate.company_id
			  and assignment.logic_gate_id = logic_gate.logic_gate_id
			  and assignment.user_id = $`+strconv.Itoa(placeholder)+`
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
		if assignedUserID != "" && isPostgresUndefinedTable(err, "logic_gate_raci_assignments") {
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
	return r.attachLogicGateRaciAssignments(ctx, companyID, items)
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
	items, err := r.attachLogicGateRaciAssignments(ctx, companyID, []domain.LogicGate{item})
	if err != nil {
		return domain.LogicGate{}, err
	}
	return items[0], nil
}

func (r *PostgresRepo) SetLogicGateRaciAssignments(input LogicGateRaciAssignmentUpdateInput) ([]domain.LogicGateRaciAssignment, error) {
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

	var exists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`,
		companyID, logicGateID,
	).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}

	type normalizedAssignment struct {
		role   string
		userID string
	}
	normalized := make([]normalizedAssignment, 0, len(input.Assignments))
	seen := map[string]bool{}
	for _, assignment := range input.Assignments {
		role, ok := NormalizeLogicGateRaciRole(assignment.Role)
		userID := strings.TrimSpace(assignment.UserID)
		if !ok || userID == "" {
			return nil, ErrInvalid
		}
		key := role + ":" + userID
		if seen[key] {
			continue
		}
		seen[key] = true

		var userInCompany bool
		if err := tx.QueryRowContext(ctx, `
select exists(
  select 1
  from company_memberships
  where company_id=$1 and user_id::text=$2
)`, companyID, userID).Scan(&userInCompany); err != nil {
			return nil, err
		}
		if !userInCompany {
			return nil, ErrAssigneeNotInCompany
		}
		normalized = append(normalized, normalizedAssignment{role: role, userID: userID})
	}

	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_raci_assignments where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	); err != nil {
		if isPostgresUndefinedTable(err, "logic_gate_raci_assignments") {
			return nil, ErrRaciStorageUnavailable
		}
		return nil, err
	}
	for _, assignment := range normalized {
		if _, err := tx.ExecContext(ctx, `
insert into logic_gate_raci_assignments (
  company_id,
  logic_gate_id,
  role,
  user_id,
  created_timestamp
) values ($1, $2, $3, $4, now())
on conflict (company_id, logic_gate_id, role, user_id) do nothing`,
			companyID, logicGateID, assignment.role, assignment.userID,
		); err != nil {
			if isPostgresUndefinedTable(err, "logic_gate_raci_assignments") {
				return nil, ErrRaciStorageUnavailable
			}
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	assignmentsByGate, err := r.listLogicGateRaciAssignments(ctx, companyID, []string{logicGateID})
	if err != nil {
		if isPostgresUndefinedTable(err, "logic_gate_raci_assignments") {
			return nil, ErrRaciStorageUnavailable
		}
		return nil, err
	}
	assignments := assignmentsByGate[logicGateID]
	if assignments == nil {
		assignments = []domain.LogicGateRaciAssignment{}
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

	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_relationships
		 where company_id=$1 and (logic_gate_id_a=$2 or logic_gate_id_b=$2)`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from company_explorer_folder_items
		 where company_id=$1 and item_type='logic_gate' and item_id=$2`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	boardID := LogicGateKanbanBoardID(logicGateID)
	if _, err := tx.ExecContext(ctx,
		`with target_boards as (
		   select $3::text as board_id
		   union
		   select board_id
		   from kanban_boards
		   where company_id=$1 and logic_gate_id=$2::uuid
		 )
		 delete from company_explorer_folder_items
		 where company_id=$1
		   and item_type='kanban'
		   and item_id in (select board_id from target_boards)`,
		companyID, logicGateID, boardID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`with target_boards as (
		   select $3::text as board_id
		   union
		   select board_id
		   from kanban_boards
		   where company_id=$1 and logic_gate_id=$2::uuid
		 )
		 delete from kanban_cards
		 where company_id=$1
		   and board_id in (select board_id from target_boards)`,
		companyID, logicGateID, boardID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`with target_boards as (
		   select $3::text as board_id
		   union
		   select board_id
		   from kanban_boards
		   where company_id=$1 and logic_gate_id=$2::uuid
		 )
		 delete from kanban_columns
		 where company_id=$1
		   and board_id in (select board_id from target_boards)`,
		companyID, logicGateID, boardID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from kanban_boards
		 where company_id=$1
		   and (board_id=$3 or logic_gate_id=$2::uuid)`,
		companyID, logicGateID, boardID,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_information
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_raci_assignments
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	); err != nil {
		if !isPostgresUndefinedTable(err, "logic_gate_raci_assignments") {
			return err
		}
	}
	// Projection rows reference logic gates directly, so remove them before the gate.
	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_projection_table
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx,
		`delete from logic_gate_map_positions
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
	); err != nil {
		return err
	}

	deleted, err := tx.ExecContext(ctx,
		`delete from logic_gates
		 where company_id=$1 and logic_gate_id=$2`,
		companyID, logicGateID,
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
  where company_id=$1 and folder_id=$2::uuid and folder_kind='logic_gate'
  union all
  select child.company_id, child.folder_id
  from company_explorer_folders child
  join folder_scope parent
    on child.company_id=parent.company_id
   and child.parent_folder_id=parent.folder_id
  where child.folder_kind='logic_gate'
), visible_gates as (
  select item.item_id::uuid as logic_gate_id
  from company_explorer_folder_items item
  join folder_scope folder on folder.folder_id=item.folder_id
  where item.company_id=$1 and item.item_type='logic_gate'
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
func (r *PostgresRepo) UpsertLogicGateMapPositions(companyID string, positions []domain.LogicGateMapPosition) ([]domain.LogicGateMapPosition, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := make([]domain.LogicGateMapPosition, 0, len(positions))
	for _, position := range positions {
		var item domain.LogicGateMapPosition
		err := tx.QueryRowContext(ctx, `
insert into logic_gate_map_positions (company_id, logic_gate_id, x, y, updated_timestamp)
select $1, $2, $3, $4, now()
where exists (select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)
on conflict (company_id, logic_gate_id) do update
set x=excluded.x,
    y=excluded.y,
    updated_timestamp=now()
returning company_id, logic_gate_id, x, y, updated_timestamp`,
			companyID, position.LogicGateID, position.X, position.Y).Scan(
			&item.CompanyID, &item.LogicGateID, &item.X, &item.Y, &item.UpdatedTimestamp,
		)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
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
		   where company_id=$1 and folder_id=$2::uuid and folder_kind='logic_gate'
		   union all
		   select child.company_id, child.folder_id
		   from company_explorer_folders child
		   join folder_scope parent
		     on child.company_id=parent.company_id
		    and child.parent_folder_id=parent.folder_id
		   where child.folder_kind='logic_gate'
		 ), visible_gates as (
		   select item.item_id::uuid as logic_gate_id
		   from company_explorer_folder_items item
		   join folder_scope folder on folder.folder_id=item.folder_id
		   where item.company_id=$1 and item.item_type='logic_gate'
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
	if isEditorTextBoxType(item.Type) {
		// Logic gates keep the legacy one-document editor contract. The new
		// multi-block timeline/chat/email workspace is node-only.
		if _, err := tx.ExecContext(ctx,
			`insert into logic_gate_projection_table
			 (company_id, logic_gate_id, information_id, type, information, created_timestamp, updated_timestamp)
			 values ($1, $2, $3, $4::information_type, $5, now(), now())
			 on conflict (company_id, logic_gate_id, type) where type = 'Text box'::information_type
			 do update set
			   information=excluded.information,
			   updated_timestamp=now()`,
			item.CompanyID, item.LogicGateID, projectionID, item.Type, item.Information,
		); err != nil {
			return domain.LogicGateInformation{}, err
		}
	} else {
		if _, err := tx.ExecContext(ctx,
			`insert into logic_gate_projection_table
			 (company_id, logic_gate_id, information_id, type, information, created_timestamp, updated_timestamp)
			 values ($1, $2, $3, $4::information_type, $5, now(), now())
			 on conflict (company_id, logic_gate_id, information_id)
			 do update set
			   type=excluded.type,
			   information=excluded.information,
			   updated_timestamp=now()`,
			item.CompanyID, item.LogicGateID, projectionID, item.Type, item.Information,
		); err != nil {
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
	var exists bool
	if err := r.db.QueryRowContext(ctx,
		`select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`,
		companyID, logicGateID,
	).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	_, err := r.db.ExecContext(ctx,
		`delete from logic_gate_projection_table
		 where company_id=$1 and logic_gate_id=$2 and information_id=$3`,
		companyID, logicGateID, informationID,
	)
	return err
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
