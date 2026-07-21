package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"strings"
)

type postgresEntityFieldQueryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func scanEntityField(row interface{ Scan(dest ...any) error }) (domain.EntityField, error) {
	var item domain.EntityField
	err := row.Scan(
		&item.CompanyID,
		&item.FieldID,
		&item.Name,
		&item.Color,
		&item.Position,
		&item.AssignmentCount,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

func (r *PostgresRepo) ListEntityFields(companyID string) ([]domain.EntityField, error) {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select field.company_id::text,
       field.field_id::text,
       field.name,
       field.color,
       field.position,
       count(assignment.field_id)::integer as assignment_count,
       field.created_timestamp,
       field.updated_timestamp
from entity_fields field
left join entity_field_assignments assignment
  on assignment.company_id=field.company_id
 and assignment.field_id=field.field_id
where field.company_id=$1::uuid
group by field.company_id, field.field_id
order by field.position asc, lower(field.name) asc, field.field_id asc`, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.EntityField, 0)
	for rows.Next() {
		item, err := scanEntityField(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CreateEntityField(input EntityFieldInput) (domain.EntityField, error) {
	normalized, err := NormalizeEntityFieldInput(input, false)
	if err != nil {
		return domain.EntityField{}, err
	}
	if normalized.FieldID == "" {
		normalized.FieldID = newUUIDv7String()
	}
	item, err := scanEntityField(r.db.QueryRowContext(context.Background(), `
insert into entity_fields (company_id, field_id, name, color, position, created_timestamp, updated_timestamp)
select $1::uuid, $2::uuid, $3::text, $4::text,
       case when $6::boolean then $5::integer else coalesce((
         select max(existing.position) + 1 from entity_fields existing where existing.company_id=$1::uuid
       ), 0) end,
       now(), now()
on conflict do nothing
returning company_id::text, field_id::text, name, color, position, 0::integer, created_timestamp, updated_timestamp`,
		normalized.CompanyID, normalized.FieldID, normalized.Name, normalized.Color, normalized.Position, normalized.PositionSet))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EntityField{}, ErrAlreadyExists
	}
	if err != nil {
		return domain.EntityField{}, mapEntityFieldPostgresError(err)
	}
	return item, nil
}

func (r *PostgresRepo) UpdateEntityField(input EntityFieldInput) (domain.EntityField, error) {
	normalized, err := NormalizeEntityFieldInput(input, true)
	if err != nil {
		return domain.EntityField{}, err
	}
	item, err := scanEntityField(r.db.QueryRowContext(context.Background(), `
update entity_fields
set name=$3::text,
    color=$4::text,
    position=case when $6::boolean then $5::integer else position end,
    updated_timestamp=now()
where company_id=$1::uuid
  and field_id=$2::uuid
returning company_id::text, field_id::text, name, color, position,
          (select count(*)::integer from entity_field_assignments assignment where assignment.company_id=entity_fields.company_id and assignment.field_id=entity_fields.field_id),
          created_timestamp, updated_timestamp`, normalized.CompanyID, normalized.FieldID, normalized.Name, normalized.Color, normalized.Position, normalized.PositionSet))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EntityField{}, ErrNotFound
	}
	if err != nil {
		return domain.EntityField{}, mapEntityFieldPostgresError(err)
	}
	return item, nil
}

func (r *PostgresRepo) DeleteEntityField(companyID, fieldID, actorUserID string) error {
	companyID = cleanUUIDText(companyID)
	fieldID = cleanUUIDText(fieldID)
	if companyID == "" || fieldID == "" {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `delete from entity_fields where company_id=$1::uuid and field_id=$2::uuid`, companyID, fieldID)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	_ = actorUserID
	return nil
}

func (r *PostgresRepo) SetEntityFieldAssignments(input EntityFieldAssignmentInput) ([]domain.EntityField, error) {
	normalized, err := NormalizeEntityFieldAssignmentInput(input)
	if err != nil {
		return nil, err
	}
	targetTable, targetIDColumn, assignmentIDColumn := entityFieldPostgresTarget(normalized.ResourceType)
	if targetTable == "" {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var resourceExists bool
	existsQuery := fmt.Sprintf(`select exists(select 1 from %s where company_id=$1::uuid and %s=$2::uuid)`, targetTable, targetIDColumn)
	if err := tx.QueryRowContext(ctx, existsQuery, normalized.CompanyID, normalized.ResourceID).Scan(&resourceExists); err != nil {
		return nil, err
	}
	if !resourceExists {
		return nil, ErrNotFound
	}
	for _, fieldID := range normalized.FieldIDs {
		var fieldExists bool
		if err := tx.QueryRowContext(ctx, `
select exists(
  select 1 from entity_fields where company_id=$1::uuid and field_id=$2::uuid
)`, normalized.CompanyID, fieldID).Scan(&fieldExists); err != nil {
			return nil, err
		}
		if !fieldExists {
			return nil, ErrNotFound
		}
	}
	if _, err := tx.ExecContext(ctx, `
delete from entity_field_assignments
where company_id=$1::uuid
  and resource_type=$2::text
  and resource_id=$3::uuid`, normalized.CompanyID, normalized.ResourceType, normalized.ResourceID); err != nil {
		return nil, err
	}
	insertQuery := fmt.Sprintf(`
insert into entity_field_assignments (company_id, field_id, resource_type, %s, created_timestamp)
values ($1::uuid, $2::uuid, $3::text, $4::uuid, now())
on conflict do nothing`, assignmentIDColumn)
	for _, fieldID := range normalized.FieldIDs {
		if _, err := tx.ExecContext(ctx, insertQuery, normalized.CompanyID, fieldID, normalized.ResourceType, normalized.ResourceID); err != nil {
			return nil, mapEntityFieldPostgresError(err)
		}
	}
	items, err := listEntityFieldsForResource(ctx, tx, normalized.CompanyID, normalized.ResourceType, normalized.ResourceID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return items, nil
}

func listEntityFieldsForResource(ctx context.Context, queryer postgresEntityFieldQueryer, companyID, resourceType, resourceID string) ([]domain.EntityField, error) {
	rows, err := queryer.QueryContext(ctx, `
select field.company_id::text,
       field.field_id::text,
       field.name,
       field.color,
       field.position,
       0::integer,
       field.created_timestamp,
       field.updated_timestamp
from entity_field_assignments assignment
join entity_fields field
  on field.company_id=assignment.company_id
 and field.field_id=assignment.field_id
where assignment.company_id=$1::uuid
  and assignment.resource_type=$2::text
  and assignment.resource_id=$3::uuid
order by field.position asc, lower(field.name) asc, field.field_id asc`, companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.EntityField, 0)
	for rows.Next() {
		item, err := scanEntityField(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func entityFieldPostgresTarget(resourceType string) (tableName, targetIDColumn, assignmentIDColumn string) {
	switch resourceType {
	case EntityTypeProject:
		return "projects", "project_id", "project_id"
	case EntityTypeNode:
		return "nodes", "node_id", "node_id"
	case EntityTypeLogicGate:
		return "logic_gates", "logic_gate_id", "logic_gate_id"
	default:
		return "", "", ""
	}
}

func mapEntityFieldPostgresError(err error) error {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "idx_entity_fields_company_name_unique") || strings.Contains(message, "duplicate key") {
		return ErrAlreadyExists
	}
	if strings.Contains(message, "foreign key") {
		return ErrNotFound
	}
	return err
}
