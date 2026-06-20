package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) ListSavedViews(input SavedViewListInput) ([]domain.SavedView, error) {
	input, ok := normalizeSavedViewListInput(input)
	if !ok {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select
  view.company_id::text,
  view.saved_view_id::text,
  view.surface,
  view.principal,
  view.principal_id::text,
  view.name,
  view.groupings::text,
  view.position,
  view.created_timestamp,
  view.updated_timestamp
from saved_views view
where view.company_id=$1::uuid
  and view.surface=$2
  and (
    (view.principal='user' and view.principal_id=$3::uuid)
    or (
      view.principal='group'
      and (
        exists (
          select 1
          from company_user_group_members member
          where member.company_id=view.company_id
            and member.group_id=view.principal_id
            and member.user_id=$3::uuid
        )
        or exists (
          select 1
          from company_memberships membership
          where membership.user_id=$3::uuid
            and (
              membership.role='dev_admin'
              or (membership.company_id=view.company_id and membership.role='company_admin')
            )
        )
      )
    )
  )
order by view.position asc, lower(view.name) asc, view.created_timestamp asc, view.saved_view_id asc`, input.CompanyID, input.Surface, input.ViewerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSavedViews(rows)
}

func (r *PostgresRepo) GetSavedView(companyID, savedViewID string) (domain.SavedView, error) {
	companyID = cleanUUIDText(companyID)
	savedViewID = cleanUUIDText(savedViewID)
	if companyID == "" || savedViewID == "" {
		return domain.SavedView{}, ErrInvalid
	}
	item, err := scanSavedView(r.db.QueryRowContext(context.Background(), `
select company_id::text, saved_view_id::text, surface, principal, principal_id::text, name, groupings::text, position, created_timestamp, updated_timestamp
from saved_views
where company_id=$1::uuid and saved_view_id=$2::uuid`, companyID, savedViewID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.SavedView{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) UpsertSavedView(input SavedViewInput) (domain.SavedView, error) {
	input, ok := normalizeSavedViewInput(input)
	if !ok {
		return domain.SavedView{}, ErrInvalid
	}
	if ok, err := r.savedViewPrincipalExists(input.CompanyID, input.Principal, input.PrincipalID); err != nil {
		return domain.SavedView{}, err
	} else if !ok {
		return domain.SavedView{}, ErrInvalid
	}
	position := input.Position
	if position <= 0 {
		nextPosition, err := r.nextSavedViewPosition(input)
		if err != nil {
			return domain.SavedView{}, err
		}
		position = nextPosition
	}
	groupingsJSON, err := json.Marshal(input.Groupings)
	if err != nil {
		return domain.SavedView{}, err
	}
	item, err := scanSavedView(r.db.QueryRowContext(context.Background(), `
insert into saved_views (
  company_id,
  saved_view_id,
  surface,
  principal,
  principal_id,
  name,
  groupings,
  position,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7::jsonb, $8, now(), now())
on conflict (company_id, saved_view_id) do update
set surface=excluded.surface,
    principal=excluded.principal,
    principal_id=excluded.principal_id,
    name=excluded.name,
    groupings=excluded.groupings,
    position=case when $8 > 0 then excluded.position else saved_views.position end,
    updated_timestamp=now()
returning company_id::text, saved_view_id::text, surface, principal, principal_id::text, name, groupings::text, position, created_timestamp, updated_timestamp`,
		input.CompanyID,
		input.SavedViewID,
		input.Surface,
		input.Principal,
		input.PrincipalID,
		input.Name,
		string(groupingsJSON),
		position,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.SavedView{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) DeleteSavedView(input SavedViewDeleteInput) error {
	input, ok := normalizeSavedViewDeleteInput(input)
	if !ok {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `delete from saved_views where company_id=$1::uuid and saved_view_id=$2::uuid`, input.CompanyID, input.SavedViewID)
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

func scanSavedViews(rows *sql.Rows) ([]domain.SavedView, error) {
	items := make([]domain.SavedView, 0)
	for rows.Next() {
		item, err := scanSavedView(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanSavedView(row interface{ Scan(dest ...any) error }) (domain.SavedView, error) {
	var item domain.SavedView
	var groupingsJSON string
	err := row.Scan(
		&item.CompanyID,
		&item.SavedViewID,
		&item.Surface,
		&item.Principal,
		&item.PrincipalID,
		&item.Name,
		&groupingsJSON,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if err != nil {
		return domain.SavedView{}, err
	}
	if err := json.Unmarshal([]byte(groupingsJSON), &item.Groupings); err != nil {
		return domain.SavedView{}, err
	}
	if item.Groupings == nil {
		item.Groupings = []domain.SavedViewGrouping{}
	}
	return item, nil
}

func (r *PostgresRepo) savedViewPrincipalExists(companyID, principal, principalID string) (bool, error) {
	var exists bool
	var query string
	if principal == SavedViewPrincipalUser {
		query = `select exists(select 1 from company_memberships where company_id=$1::uuid and user_id=$2::uuid)`
	} else {
		query = `select exists(select 1 from company_user_groups where company_id=$1::uuid and group_id=$2::uuid)`
	}
	if err := r.db.QueryRowContext(context.Background(), query, companyID, principalID).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}

func (r *PostgresRepo) nextSavedViewPosition(input SavedViewInput) (int, error) {
	var existingPosition sql.NullInt64
	if err := r.db.QueryRowContext(context.Background(), `
select position
from saved_views
where company_id=$1::uuid and saved_view_id=$2::uuid`, input.CompanyID, input.SavedViewID).Scan(&existingPosition); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	if existingPosition.Valid {
		return int(existingPosition.Int64), nil
	}
	var position int
	err := r.db.QueryRowContext(context.Background(), `
select coalesce(max(position), 0) + 1000
from saved_views
where company_id=$1::uuid
  and surface=$2
  and principal=$3
  and principal_id=$4::uuid`, input.CompanyID, input.Surface, input.Principal, input.PrincipalID).Scan(&position)
	return position, err
}
