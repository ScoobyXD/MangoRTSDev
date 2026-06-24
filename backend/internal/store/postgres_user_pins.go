package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) ListUserPins(input UserPinListInput) ([]domain.UserPin, error) {
	input, ok := normalizeUserPinListInput(input)
	if !ok {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select company_id::text, pin_id::text, user_id::text, resource_type, resource_id::text, name, position, created_timestamp
from pins
where company_id=$1::uuid and user_id=$2::uuid
order by position asc, created_timestamp asc, pin_id asc`, input.CompanyID, input.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanUserPins(rows)
}

func (r *PostgresRepo) UpsertUserPin(input UserPinInput) (domain.UserPin, error) {
	input, ok := normalizeUserPinInput(input)
	if !ok {
		return domain.UserPin{}, ErrInvalid
	}
	exists, err := r.userPinResourceExists(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return domain.UserPin{}, err
	}
	if !exists {
		return domain.UserPin{}, ErrNotFound
	}
	position := input.Position
	if position <= 0 {
		position, err = r.nextUserPinPosition(input.CompanyID, input.UserID, input.ResourceType, input.ResourceID)
		if err != nil {
			return domain.UserPin{}, err
		}
	}
	item, err := scanUserPin(r.db.QueryRowContext(context.Background(), `
insert into pins (
  company_id,
  pin_id,
  user_id,
  resource_type,
  resource_id,
  name,
  position,
  created_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7, now())
on conflict (company_id, user_id, resource_type, resource_id) do update
set name=excluded.name
returning company_id::text, pin_id::text, user_id::text, resource_type, resource_id::text, name, position, created_timestamp`,
		input.CompanyID,
		input.PinID,
		input.UserID,
		input.ResourceType,
		input.ResourceID,
		input.Name,
		position,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.UserPin{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) DeleteUserPin(input UserPinDeleteInput) error {
	input, ok := normalizeUserPinDeleteInput(input)
	if !ok {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `
delete from pins
where company_id=$1::uuid and user_id=$2::uuid and pin_id=$3::uuid`, input.CompanyID, input.UserID, input.PinID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) ReorderUserPins(input UserPinReorderInput) error {
	input, ok := normalizeUserPinReorderInput(input)
	if !ok {
		return ErrInvalid
	}
	tx, err := r.db.BeginTx(context.Background(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for index, pinID := range input.PinIDs {
		result, err := tx.ExecContext(context.Background(), `
update pins
set position=$4
where company_id=$1::uuid and user_id=$2::uuid and pin_id=$3::uuid`,
			input.CompanyID,
			input.UserID,
			pinID,
			(index+1)*userPinPositionStep,
		)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count == 0 {
			return ErrNotFound
		}
	}
	return tx.Commit()
}

func scanUserPins(rows *sql.Rows) ([]domain.UserPin, error) {
	items := make([]domain.UserPin, 0)
	for rows.Next() {
		item, err := scanUserPin(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanUserPin(row interface{ Scan(dest ...any) error }) (domain.UserPin, error) {
	var item domain.UserPin
	err := row.Scan(
		&item.CompanyID,
		&item.PinID,
		&item.UserID,
		&item.ResourceType,
		&item.ResourceID,
		&item.Name,
		&item.Position,
		&item.CreatedTimestamp,
	)
	return item, err
}

func (r *PostgresRepo) userPinResourceExists(companyID, resourceType, resourceID string) (bool, error) {
	var exists bool
	var query string
	switch resourceType {
	case EntityTypeNode:
		query = `select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)`
	case EntityTypeLogicGate:
		query = `select exists(select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid)`
	case EntityTypeProject:
		query = `select exists(select 1 from projects where company_id=$1::uuid and project_id=$2::uuid)`
	default:
		return false, ErrInvalid
	}
	if err := r.db.QueryRowContext(context.Background(), query, companyID, resourceID).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}

func (r *PostgresRepo) nextUserPinPosition(companyID, userID, resourceType, resourceID string) (int, error) {
	var existingPosition sql.NullInt64
	err := r.db.QueryRowContext(context.Background(), `
select position
from pins
where company_id=$1::uuid and user_id=$2::uuid and resource_type=$3 and resource_id=$4::uuid`, companyID, userID, resourceType, resourceID).Scan(&existingPosition)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	if existingPosition.Valid {
		return int(existingPosition.Int64), nil
	}
	var position int
	err = r.db.QueryRowContext(context.Background(), `
select coalesce(max(position), 0) + $3
from pins
where company_id=$1::uuid and user_id=$2::uuid`, companyID, userID, userPinPositionStep).Scan(&position)
	return position, err
}
