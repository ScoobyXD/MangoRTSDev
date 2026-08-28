package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"miraeopus/backend/internal/domain"
)

type postgresEntityQueryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func scanEntityType(row interface{ Scan(...any) error }) (domain.EntityType, error) {
	var item domain.EntityType
	err := row.Scan(&item.CompanyID, &item.EntityTypeID, &item.Name, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}

func scanEntityFolder(row interface{ Scan(...any) error }) (domain.EntityFolder, error) {
	var item domain.EntityFolder
	err := row.Scan(&item.CompanyID, &item.EntityFolderID, &item.EntityTypeID, &item.ParentEntityFolderID, &item.Name, &item.Position, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}

func scanEntityFieldType(row interface{ Scan(...any) error }) (domain.EntityFieldType, error) {
	var item domain.EntityFieldType
	err := row.Scan(&item.CompanyID, &item.EntityFieldTypeID, &item.EntityTypeID, &item.EntityFolderID, &item.Name, &item.FieldType, &item.Position, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}

func scanEntityField(row interface{ Scan(...any) error }) (domain.EntityField, error) {
	var item domain.EntityField
	var value []byte
	err := row.Scan(&item.CompanyID, &item.EntityFieldID, &item.EntityID, &item.Name, &item.FieldType, &value, &item.Position, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	item.Value = append(item.Value, value...)
	return item, err
}

func scanEntity(row interface{ Scan(...any) error }) (domain.Entity, error) {
	var item domain.Entity
	var body []byte
	err := row.Scan(&item.CompanyID, &item.EntityID, &item.EntityTypeID, &item.EntityTypeName, &item.EntityFolderID, &item.Name, &item.Position, &body, &item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	item.BodyJSON = append(item.BodyJSON, body...)
	return item, err
}

func scanEntitySummary(row interface{ Scan(...any) error }) (domain.EntitySummary, error) {
	var item domain.EntitySummary
	err := row.Scan(&item.CompanyID, &item.EntityID, &item.EntityTypeID, &item.EntityTypeName, &item.EntityFolderID, &item.Name, &item.Position, &item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}

func (r *PostgresRepo) ListEntityTypes(companyID string) ([]domain.EntityType, error) {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select company_id::text, entity_type_id::text, name, created_timestamp, updated_timestamp
from entity_types
where company_id=$1::uuid
order by lower(name), entity_type_id`, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.EntityType{}
	for rows.Next() {
		item, err := scanEntityType(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CreateEntityType(input EntityTypeInput) (domain.EntityType, error) {
	normalized, err := normalizeEntityTypeInput(input, false)
	if err != nil {
		return domain.EntityType{}, err
	}
	if normalized.EntityTypeID == "" {
		normalized.EntityTypeID = newUUIDv7String()
	}
	item, err := scanEntityType(r.db.QueryRowContext(context.Background(), `
insert into entity_types (company_id, entity_type_id, name)
values ($1::uuid, $2::uuid, $3::text)
on conflict do nothing
returning company_id::text, entity_type_id::text, name, created_timestamp, updated_timestamp`, normalized.CompanyID, normalized.EntityTypeID, normalized.Name))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EntityType{}, ErrAlreadyExists
	}
	if err != nil {
		return domain.EntityType{}, mapEntitiesPostgresError(err)
	}
	return item, nil
}

func (r *PostgresRepo) UpdateEntityType(input EntityTypeInput) (domain.EntityType, error) {
	normalized, err := normalizeEntityTypeInput(input, true)
	if err != nil {
		return domain.EntityType{}, err
	}
	item, err := scanEntityType(r.db.QueryRowContext(context.Background(), `
update entity_types
set name=$3::text, updated_timestamp=now()
where company_id=$1::uuid and entity_type_id=$2::uuid
returning company_id::text, entity_type_id::text, name, created_timestamp, updated_timestamp`, normalized.CompanyID, normalized.EntityTypeID, normalized.Name))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EntityType{}, ErrNotFound
	}
	if err != nil {
		return domain.EntityType{}, mapEntitiesPostgresError(err)
	}
	return item, nil
}

func (r *PostgresRepo) DeleteEntityType(companyID, entityTypeID string) error {
	companyID, entityTypeID = cleanUUIDText(companyID), cleanUUIDText(entityTypeID)
	if companyID == "" || entityTypeID == "" {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists, hasEntities bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from entity_types where company_id=$1::uuid and entity_type_id=$2::uuid)`, companyID, entityTypeID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from entities where company_id=$1::uuid and entity_type_id=$2::uuid)`, companyID, entityTypeID).Scan(&hasEntities); err != nil {
		return err
	}
	if hasEntities {
		return ErrConflict
	}
	if _, err := tx.ExecContext(ctx, `delete from entity_types where company_id=$1::uuid and entity_type_id=$2::uuid`, companyID, entityTypeID); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "foreign key") {
			return ErrConflict
		}
		return mapEntitiesPostgresError(err)
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListEntityFolders(companyID, entityTypeID string) ([]domain.EntityFolder, error) {
	companyID, entityTypeID = cleanUUIDText(companyID), cleanUUIDText(entityTypeID)
	if companyID == "" || entityTypeID == "" {
		return nil, ErrInvalid
	}
	var exists bool
	if err := r.db.QueryRowContext(context.Background(), `select exists(select 1 from entity_types where company_id=$1::uuid and entity_type_id=$2::uuid)`, companyID, entityTypeID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	rows, err := r.db.QueryContext(context.Background(), `
select company_id::text, entity_folder_id::text, entity_type_id::text, parent_entity_folder_id::text, name, position, created_timestamp, updated_timestamp
from entity_folders
where company_id=$1::uuid and entity_type_id=$2::uuid
order by parent_entity_folder_id nulls first, position, lower(name), entity_folder_id`, companyID, entityTypeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.EntityFolder{}
	for rows.Next() {
		item, err := scanEntityFolder(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CreateEntityFolder(input EntityFolderInput) (domain.EntityFolder, error) {
	normalized, err := normalizeEntityFolderInput(input, false)
	if err != nil {
		return domain.EntityFolder{}, err
	}
	if normalized.EntityFolderID == "" {
		normalized.EntityFolderID = newUUIDv7String()
	}
	item, err := scanEntityFolder(r.db.QueryRowContext(context.Background(), `
insert into entity_folders (company_id, entity_folder_id, entity_type_id, parent_entity_folder_id, name, position)
select $1::uuid, $2::uuid, $3::uuid, nullif($4::text, '')::uuid, $5::text,
       case when $7::boolean then $6::integer else coalesce((
         select max(position)+1 from entity_folders
         where company_id=$1::uuid and entity_type_id=$3::uuid
           and parent_entity_folder_id is not distinct from nullif($4::text, '')::uuid
       ), 0) end
where exists(select 1 from entity_types where company_id=$1::uuid and entity_type_id=$3::uuid)
returning company_id::text, entity_folder_id::text, entity_type_id::text, parent_entity_folder_id::text, name, position, created_timestamp, updated_timestamp`, normalized.CompanyID, normalized.EntityFolderID, normalized.EntityTypeID, optionalEntityIDValue(normalized.ParentEntityFolderID), normalized.Name, normalized.Position, normalized.PositionSet))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EntityFolder{}, ErrNotFound
	}
	if err != nil {
		return domain.EntityFolder{}, mapEntitiesPostgresError(err)
	}
	return item, nil
}

func (r *PostgresRepo) UpdateEntityFolder(input EntityFolderInput) (domain.EntityFolder, error) {
	normalized, err := normalizeEntityFolderInput(input, true)
	if err != nil {
		return domain.EntityFolder{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.EntityFolder{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended('entity-folder-tree:' || $1::text, 0))`, normalized.CompanyID); err != nil {
		return domain.EntityFolder{}, err
	}
	current, err := scanEntityFolder(tx.QueryRowContext(ctx, `
select company_id::text, entity_folder_id::text, entity_type_id::text, parent_entity_folder_id::text, name, position, created_timestamp, updated_timestamp
from entity_folders where company_id=$1::uuid and entity_folder_id=$2::uuid for update`, normalized.CompanyID, normalized.EntityFolderID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EntityFolder{}, ErrNotFound
	}
	if err != nil {
		return domain.EntityFolder{}, err
	}
	if normalized.ParentFolderSet {
		if err := validatePostgresEntityFolderParent(ctx, tx, current, normalized.ParentEntityFolderID); err != nil {
			return domain.EntityFolder{}, err
		}
	}
	item, err := scanEntityFolder(tx.QueryRowContext(ctx, `
update entity_folders
set parent_entity_folder_id=case when $3::boolean then nullif($4::text, '')::uuid else parent_entity_folder_id end,
    name=case when $5::boolean then $6::text else name end,
    position=case when $7::boolean then $8::integer else position end,
    updated_timestamp=now()
where company_id=$1::uuid and entity_folder_id=$2::uuid
returning company_id::text, entity_folder_id::text, entity_type_id::text, parent_entity_folder_id::text, name, position, created_timestamp, updated_timestamp`, normalized.CompanyID, normalized.EntityFolderID, normalized.ParentFolderSet, optionalEntityIDValue(normalized.ParentEntityFolderID), normalized.NameSet, normalized.Name, normalized.PositionSet, normalized.Position))
	if err != nil {
		return domain.EntityFolder{}, mapEntitiesPostgresError(err)
	}
	if err := tx.Commit(); err != nil {
		return domain.EntityFolder{}, err
	}
	return item, nil
}

func validatePostgresEntityFolderParent(ctx context.Context, tx *sql.Tx, item domain.EntityFolder, parentID *string) error {
	ancestors, err := postgresEntityFolderAncestry(ctx, tx, item.CompanyID, item.EntityTypeID, parentID)
	if err != nil {
		return err
	}
	for _, ancestorID := range ancestors {
		if ancestorID == item.EntityFolderID {
			return ErrConflict
		}
	}
	return nil
}

func postgresEntityFolderAncestry(ctx context.Context, queryer postgresEntityQueryer, companyID, entityTypeID string, folderID *string) ([]string, error) {
	if folderID == nil {
		return []string{}, nil
	}
	rows, err := queryer.QueryContext(ctx, `
with recursive ancestry as (
  select entity_folder_id, parent_entity_folder_id, array[entity_folder_id] as path, false as cycle, 0 as depth
  from entity_folders
  where company_id=$1::uuid and entity_type_id=$2::uuid and entity_folder_id=$3::uuid
  union all
  select parent.entity_folder_id, parent.parent_entity_folder_id,
         ancestry.path || parent.entity_folder_id,
         parent.entity_folder_id=any(ancestry.path), ancestry.depth+1
  from ancestry
  join entity_folders parent
    on parent.company_id=$1::uuid
   and parent.entity_type_id=$2::uuid
   and parent.entity_folder_id=ancestry.parent_entity_folder_id
  where not ancestry.cycle
)
select entity_folder_id::text, cycle
from ancestry
order by depth desc`, companyID, entityTypeID, *folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ancestors := []string{}
	cycle := false
	for rows.Next() {
		var entityFolderID string
		var rowCycle bool
		if err := rows.Scan(&entityFolderID, &rowCycle); err != nil {
			return nil, err
		}
		ancestors = append(ancestors, entityFolderID)
		cycle = cycle || rowCycle
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ancestors) == 0 {
		return nil, ErrNotFound
	}
	if cycle {
		return nil, ErrConflict
	}
	return ancestors, nil
}

func (r *PostgresRepo) DeleteEntityFolder(companyID, entityFolderID string) error {
	companyID, entityFolderID = cleanUUIDText(companyID), cleanUUIDText(entityFolderID)
	if companyID == "" || entityFolderID == "" {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists, occupied bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from entity_folders where company_id=$1::uuid and entity_folder_id=$2::uuid)`, companyID, entityFolderID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	if err := tx.QueryRowContext(ctx, `select exists(
  select 1 from entity_folders where company_id=$1::uuid and parent_entity_folder_id=$2::uuid
  union all
  select 1 from entities where company_id=$1::uuid and entity_folder_id=$2::uuid
)`, companyID, entityFolderID).Scan(&occupied); err != nil {
		return err
	}
	if occupied {
		return ErrConflict
	}
	if _, err := tx.ExecContext(ctx, `delete from entity_folders where company_id=$1::uuid and entity_folder_id=$2::uuid`, companyID, entityFolderID); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "foreign key") {
			return ErrConflict
		}
		return mapEntitiesPostgresError(err)
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListEntityFieldTypes(companyID, entityTypeID string) ([]domain.EntityFieldType, error) {
	companyID, entityTypeID = cleanUUIDText(companyID), cleanUUIDText(entityTypeID)
	if companyID == "" || entityTypeID == "" {
		return nil, ErrInvalid
	}
	var exists bool
	if err := r.db.QueryRowContext(context.Background(), `select exists(select 1 from entity_types where company_id=$1::uuid and entity_type_id=$2::uuid)`, companyID, entityTypeID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	rows, err := r.db.QueryContext(context.Background(), `
select company_id::text, entity_field_type_id::text, entity_type_id::text, entity_folder_id::text, name, field_type, position, created_timestamp, updated_timestamp
from entity_field_types
where company_id=$1::uuid and entity_type_id=$2::uuid
order by entity_folder_id nulls first, position, lower(name), entity_field_type_id`, companyID, entityTypeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.EntityFieldType{}
	for rows.Next() {
		item, err := scanEntityFieldType(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CreateEntityFieldType(input EntityFieldTypeInput) (domain.EntityFieldType, error) {
	normalized, err := normalizeEntityFieldTypeInput(input, false)
	if err != nil {
		return domain.EntityFieldType{}, err
	}
	if normalized.EntityFieldTypeID == "" {
		normalized.EntityFieldTypeID = newUUIDv7String()
	}
	item, err := scanEntityFieldType(r.db.QueryRowContext(context.Background(), `
insert into entity_field_types (company_id, entity_field_type_id, entity_type_id, entity_folder_id, name, field_type, position)
select $1::uuid, $2::uuid, $3::uuid, nullif($4::text, '')::uuid, $5::text, $6::text,
       case when $8::boolean then $7::integer else coalesce((
         select max(position)+1 from entity_field_types
         where company_id=$1::uuid and entity_type_id=$3::uuid
           and entity_folder_id is not distinct from nullif($4::text, '')::uuid
       ), 0) end
where exists(select 1 from entity_types where company_id=$1::uuid and entity_type_id=$3::uuid)
returning company_id::text, entity_field_type_id::text, entity_type_id::text, entity_folder_id::text, name, field_type, position, created_timestamp, updated_timestamp`, normalized.CompanyID, normalized.EntityFieldTypeID, normalized.EntityTypeID, optionalEntityIDValue(normalized.EntityFolderID), normalized.Name, normalized.FieldType, normalized.Position, normalized.PositionSet))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EntityFieldType{}, ErrNotFound
	}
	if err != nil {
		return domain.EntityFieldType{}, mapEntitiesPostgresError(err)
	}
	return item, nil
}

func (r *PostgresRepo) UpdateEntityFieldType(input EntityFieldTypeInput) (domain.EntityFieldType, error) {
	normalized, err := normalizeEntityFieldTypeInput(input, true)
	if err != nil {
		return domain.EntityFieldType{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.EntityFieldType{}, err
	}
	defer tx.Rollback()
	current, err := scanEntityFieldType(tx.QueryRowContext(ctx, `
select company_id::text, entity_field_type_id::text, entity_type_id::text, entity_folder_id::text, name, field_type, position, created_timestamp, updated_timestamp
from entity_field_types where company_id=$1::uuid and entity_field_type_id=$2::uuid for update`, normalized.CompanyID, normalized.EntityFieldTypeID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EntityFieldType{}, ErrNotFound
	}
	if err != nil {
		return domain.EntityFieldType{}, err
	}
	if normalized.EntityFolderSet {
		if err := validatePostgresEntityFolderForType(ctx, tx, current.CompanyID, current.EntityTypeID, normalized.EntityFolderID); err != nil {
			return domain.EntityFieldType{}, err
		}
	}
	item, err := scanEntityFieldType(tx.QueryRowContext(ctx, `
update entity_field_types
set entity_folder_id=case when $3::boolean then nullif($4::text, '')::uuid else entity_folder_id end,
    name=case when $5::boolean then $6::text else name end,
    field_type=case when $7::boolean then $8::text else field_type end,
    position=case when $9::boolean then $10::integer else position end,
    updated_timestamp=now()
where company_id=$1::uuid and entity_field_type_id=$2::uuid
returning company_id::text, entity_field_type_id::text, entity_type_id::text, entity_folder_id::text, name, field_type, position, created_timestamp, updated_timestamp`, normalized.CompanyID, normalized.EntityFieldTypeID, normalized.EntityFolderSet, optionalEntityIDValue(normalized.EntityFolderID), normalized.NameSet, normalized.Name, normalized.FieldTypeSet, normalized.FieldType, normalized.PositionSet, normalized.Position))
	if err != nil {
		return domain.EntityFieldType{}, mapEntitiesPostgresError(err)
	}
	if err := tx.Commit(); err != nil {
		return domain.EntityFieldType{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteEntityFieldType(companyID, entityFieldTypeID string) error {
	companyID, entityFieldTypeID = cleanUUIDText(companyID), cleanUUIDText(entityFieldTypeID)
	if companyID == "" || entityFieldTypeID == "" {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `delete from entity_field_types where company_id=$1::uuid and entity_field_type_id=$2::uuid`, companyID, entityFieldTypeID)
	if err != nil {
		return mapEntitiesPostgresError(err)
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

func (r *PostgresRepo) ListEntities(ctx context.Context, query EntityListQuery) ([]domain.EntitySummary, error) {
	normalized, err := normalizeEntityListQuery(query)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	folderFilter := normalized.EntityFolderID != nil
	rows, err := r.db.QueryContext(ctx, `
select entity.company_id::text, entity.entity_id::text, entity.entity_type_id::text, entity_type.name,
       entity.entity_folder_id::text, entity.name, entity.position, entity.revision, entity.created_timestamp, entity.updated_timestamp
from entities entity
join entity_types entity_type on entity_type.company_id=entity.company_id and entity_type.entity_type_id=entity.entity_type_id
where entity.company_id=$1::uuid
  and ($2::text='' or entity.entity_type_id=nullif($2::text, '')::uuid)
  and ($3::text='' or lower(entity.name) like '%' || lower($3::text) || '%')
  and (not $4::boolean or entity.entity_folder_id is not distinct from nullif($5::text, '')::uuid)
order by entity.position, lower(entity.name), entity.entity_id
limit case when $8::boolean then null else $6::integer end offset $7::integer`, normalized.CompanyID, normalized.EntityTypeID, normalized.Query, folderFilter, optionalEntityIDValue(normalized.EntityFolderID), normalized.Limit, normalized.Offset, normalized.AllForType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.EntitySummary{}
	for rows.Next() {
		item, err := scanEntitySummary(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CreateEntity(input EntityInput) (domain.Entity, error) {
	normalized, err := normalizeEntityInput(input, false)
	if err != nil {
		return domain.Entity{}, err
	}
	if normalized.EntityID == "" {
		normalized.EntityID = newUUIDv7String()
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Entity{}, err
	}
	defer tx.Rollback()
	var typeName string
	if err := tx.QueryRowContext(ctx, `select name from entity_types where company_id=$1::uuid and entity_type_id=$2::uuid`, normalized.CompanyID, normalized.EntityTypeID).Scan(&typeName); errors.Is(err, sql.ErrNoRows) {
		return domain.Entity{}, ErrNotFound
	} else if err != nil {
		return domain.Entity{}, err
	}
	if err := validatePostgresEntityFolderForType(ctx, tx, normalized.CompanyID, normalized.EntityTypeID, normalized.EntityFolderID); err != nil {
		return domain.Entity{}, err
	}
	item, err := scanEntity(tx.QueryRowContext(ctx, `
insert into entities (company_id, entity_id, entity_type_id, entity_folder_id, name, position, body_json, revision)
values ($1::uuid, $2::uuid, $3::uuid, nullif($4::text, '')::uuid, $5::text,
        case when $8::boolean then $7::integer else coalesce((
          select max(position)+1 from entities
          where company_id=$1::uuid and entity_type_id=$3::uuid
            and entity_folder_id is not distinct from nullif($4::text, '')::uuid
        ), 0) end,
        $6::jsonb, 0)
returning company_id::text, entity_id::text, entity_type_id::text, $9::text, entity_folder_id::text, name, position, body_json, revision, created_timestamp, updated_timestamp`, normalized.CompanyID, normalized.EntityID, normalized.EntityTypeID, optionalEntityIDValue(normalized.EntityFolderID), normalized.Name, normalized.BodyJSON, normalized.Position, normalized.PositionSet, typeName))
	if err != nil {
		return domain.Entity{}, mapEntitiesPostgresError(err)
	}
	resolved, err := resolvePostgresEntityFieldTypes(ctx, tx, item.CompanyID, item.EntityTypeID, item.EntityFolderID)
	if err != nil {
		return domain.Entity{}, err
	}
	if len(resolved) > 0 {
		fieldIDs := make([]string, len(resolved))
		fieldNames := make([]string, len(resolved))
		fieldTypes := make([]string, len(resolved))
		for index, fieldType := range resolved {
			fieldIDs[index] = newUUIDv7String()
			fieldNames[index] = fieldType.Name
			fieldTypes[index] = fieldType.FieldType
		}
		if _, err := tx.ExecContext(ctx, `
insert into entity_fields (company_id, entity_field_id, entity_id, name, field_type, value_jsonb, position)
select $1::uuid, input.entity_field_id::uuid, $2::uuid, input.name, input.field_type, null, (input.position-1)::integer
from unnest($3::text[], $4::text[], $5::text[]) with ordinality as input(entity_field_id, name, field_type, position)`, item.CompanyID, item.EntityID, fieldIDs, fieldNames, fieldTypes); err != nil {
			return domain.Entity{}, mapEntitiesPostgresError(err)
		}
	}
	item, err = getPostgresEntity(ctx, tx, item.CompanyID, item.EntityID)
	if err != nil {
		return domain.Entity{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Entity{}, err
	}
	return item, nil
}

func validatePostgresEntityFolderForType(ctx context.Context, queryer postgresEntityQueryer, companyID, entityTypeID string, folderID *string) error {
	if folderID == nil {
		return nil
	}
	var exists bool
	if err := queryer.QueryRowContext(ctx, `select exists(select 1 from entity_folders where company_id=$1::uuid and entity_type_id=$2::uuid and entity_folder_id=$3::uuid)`, companyID, entityTypeID, *folderID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func resolvePostgresEntityFieldTypes(ctx context.Context, queryer postgresEntityQueryer, companyID, entityTypeID string, folderID *string) ([]domain.EntityFieldType, error) {
	ancestors, err := postgresEntityFolderAncestry(ctx, queryer, companyID, entityTypeID, folderID)
	if err != nil {
		return nil, err
	}
	rows, err := queryer.QueryContext(ctx, `
select company_id::text, entity_field_type_id::text, entity_type_id::text, entity_folder_id::text,
       name, field_type, position, created_timestamp, updated_timestamp,
       case when entity_folder_id is null then 0 else array_position($3::text[], entity_folder_id::text) end as layer
from entity_field_types
where company_id=$1::uuid and entity_type_id=$2::uuid
  and (entity_folder_id is null or entity_folder_id::text=any($3::text[]))
order by layer, position, lower(name), entity_field_type_id`, companyID, entityTypeID, ancestors)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	layers := make([][]domain.EntityFieldType, len(ancestors)+1)
	for rows.Next() {
		var item domain.EntityFieldType
		var layer int
		if err := rows.Scan(&item.CompanyID, &item.EntityFieldTypeID, &item.EntityTypeID, &item.EntityFolderID, &item.Name, &item.FieldType, &item.Position, &item.CreatedTimestamp, &item.UpdatedTimestamp, &layer); err != nil {
			return nil, err
		}
		if layer < 0 || layer >= len(layers) {
			return nil, ErrConflict
		}
		layers[layer] = append(layers[layer], item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return resolveEntityFieldTypeLayers(layers), nil
}

func (r *PostgresRepo) GetEntity(companyID, entityID string) (domain.Entity, error) {
	companyID, entityID = cleanUUIDText(companyID), cleanUUIDText(entityID)
	if companyID == "" || entityID == "" {
		return domain.Entity{}, ErrInvalid
	}
	return getPostgresEntity(context.Background(), r.db, companyID, entityID)
}

func getPostgresEntity(ctx context.Context, queryer postgresEntityQueryer, companyID, entityID string) (domain.Entity, error) {
	item, err := scanEntity(queryer.QueryRowContext(ctx, `
select entity.company_id::text, entity.entity_id::text, entity.entity_type_id::text, entity_type.name,
       entity.entity_folder_id::text, entity.name, entity.position, entity.body_json, entity.revision, entity.created_timestamp, entity.updated_timestamp
from entities entity
join entity_types entity_type on entity_type.company_id=entity.company_id and entity_type.entity_type_id=entity.entity_type_id
where entity.company_id=$1::uuid and entity.entity_id=$2::uuid`, companyID, entityID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Entity{}, ErrNotFound
	}
	if err != nil {
		return domain.Entity{}, err
	}
	rows, err := queryer.QueryContext(ctx, `
select company_id::text, entity_field_id::text, entity_id::text, name, field_type, value_jsonb, position, created_timestamp, updated_timestamp
from entity_fields
where company_id=$1::uuid and entity_id=$2::uuid
order by position, lower(name), entity_field_id`, companyID, entityID)
	if err != nil {
		return domain.Entity{}, err
	}
	defer rows.Close()
	item.EntityFields = []domain.EntityField{}
	for rows.Next() {
		field, err := scanEntityField(rows)
		if err != nil {
			return domain.Entity{}, err
		}
		item.EntityFields = append(item.EntityFields, field)
	}
	return item, rows.Err()
}

func (r *PostgresRepo) UpdateEntity(input EntityInput) (domain.Entity, error) {
	normalized, err := normalizeEntityInput(input, true)
	if err != nil {
		return domain.Entity{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Entity{}, err
	}
	defer tx.Rollback()
	var entityTypeID string
	var revision int64
	err = tx.QueryRowContext(ctx, `select entity_type_id::text, revision from entities where company_id=$1::uuid and entity_id=$2::uuid for update`, normalized.CompanyID, normalized.EntityID).Scan(&entityTypeID, &revision)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Entity{}, ErrNotFound
	}
	if err != nil {
		return domain.Entity{}, err
	}
	if normalized.EntityFolderSet {
		if err := validatePostgresEntityFolderForType(ctx, tx, normalized.CompanyID, entityTypeID, normalized.EntityFolderID); err != nil {
			return domain.Entity{}, err
		}
	}
	if normalized.BodySet && revision != normalized.BaseRevision {
		return domain.Entity{}, ErrVersionConflict
	}
	_, err = tx.ExecContext(ctx, `
update entities
set entity_folder_id=case when $3::boolean then nullif($4::text, '')::uuid else entity_folder_id end,
    name=case when $5::boolean then $6::text else name end,
    position=case when $7::boolean then $8::integer else position end,
    body_json=case when $9::boolean then $10::jsonb else body_json end,
    revision=case when $9::boolean then revision+1 else revision end,
    updated_timestamp=now()
where company_id=$1::uuid and entity_id=$2::uuid`, normalized.CompanyID, normalized.EntityID, normalized.EntityFolderSet, optionalEntityIDValue(normalized.EntityFolderID), normalized.NameSet, normalized.Name, normalized.PositionSet, normalized.Position, normalized.BodySet, normalized.BodyJSON)
	if err != nil {
		return domain.Entity{}, mapEntitiesPostgresError(err)
	}
	item, err := getPostgresEntity(ctx, tx, normalized.CompanyID, normalized.EntityID)
	if err != nil {
		return domain.Entity{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Entity{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteEntity(companyID, entityID string) error {
	companyID, entityID = cleanUUIDText(companyID), cleanUUIDText(entityID)
	if companyID == "" || entityID == "" {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `delete from entities where company_id=$1::uuid and entity_id=$2::uuid`, companyID, entityID)
	if err != nil {
		return mapEntitiesPostgresError(err)
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

func (r *PostgresRepo) CreateEntityField(input EntityFieldInput) (domain.EntityField, error) {
	normalized, err := normalizeEntityFieldInput(input, false)
	if err != nil {
		return domain.EntityField{}, err
	}
	if normalized.EntityFieldID == "" {
		normalized.EntityFieldID = newUUIDv7String()
	}
	item, err := scanEntityField(r.db.QueryRowContext(context.Background(), `
insert into entity_fields (company_id, entity_field_id, entity_id, name, field_type, value_jsonb, position)
select $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::jsonb,
       case when $8::boolean then $7::integer else coalesce((select max(position)+1 from entity_fields where company_id=$1::uuid and entity_id=$3::uuid), 0) end
where exists(select 1 from entities where company_id=$1::uuid and entity_id=$3::uuid)
returning company_id::text, entity_field_id::text, entity_id::text, name, field_type, value_jsonb, position, created_timestamp, updated_timestamp`, normalized.CompanyID, normalized.EntityFieldID, normalized.EntityID, normalized.Name, normalized.FieldType, normalized.Value, normalized.Position, normalized.PositionSet))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EntityField{}, ErrNotFound
	}
	if err != nil {
		return domain.EntityField{}, mapEntitiesPostgresError(err)
	}
	return item, nil
}

func (r *PostgresRepo) UpdateEntityField(input EntityFieldInput) (domain.EntityField, error) {
	normalized, err := normalizeEntityFieldInput(input, true)
	if err != nil {
		return domain.EntityField{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.EntityField{}, err
	}
	defer tx.Rollback()
	current, err := scanEntityField(tx.QueryRowContext(ctx, `
select company_id::text, entity_field_id::text, entity_id::text, name, field_type, value_jsonb, position, created_timestamp, updated_timestamp
from entity_fields where company_id=$1::uuid and entity_id=$2::uuid and entity_field_id=$3::uuid for update`, normalized.CompanyID, normalized.EntityID, normalized.EntityFieldID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EntityField{}, ErrNotFound
	}
	if err != nil {
		return domain.EntityField{}, err
	}
	fieldType := current.FieldType
	value := current.Value
	if normalized.FieldTypeSet && normalized.FieldType != current.FieldType {
		fieldType = normalized.FieldType
		value = nil
	} else if normalized.ValueSet {
		value, err = normalizeEntityFieldValue(fieldType, normalized.Value)
		if err != nil {
			return domain.EntityField{}, err
		}
	}
	item, err := scanEntityField(tx.QueryRowContext(ctx, `
update entity_fields
set name=case when $4::boolean then $5::text else name end,
    field_type=$6::text,
    value_jsonb=$7::jsonb,
    position=case when $8::boolean then $9::integer else position end,
    updated_timestamp=now()
where company_id=$1::uuid and entity_id=$2::uuid and entity_field_id=$3::uuid
returning company_id::text, entity_field_id::text, entity_id::text, name, field_type, value_jsonb, position, created_timestamp, updated_timestamp`, normalized.CompanyID, normalized.EntityID, normalized.EntityFieldID, normalized.NameSet, normalized.Name, fieldType, value, normalized.PositionSet, normalized.Position))
	if err != nil {
		return domain.EntityField{}, mapEntitiesPostgresError(err)
	}
	if err := tx.Commit(); err != nil {
		return domain.EntityField{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteEntityField(companyID, entityID, entityFieldID string) error {
	companyID, entityID, entityFieldID = cleanUUIDText(companyID), cleanUUIDText(entityID), cleanUUIDText(entityFieldID)
	if companyID == "" || entityID == "" || entityFieldID == "" {
		return ErrInvalid
	}
	result, err := r.db.ExecContext(context.Background(), `delete from entity_fields where company_id=$1::uuid and entity_id=$2::uuid and entity_field_id=$3::uuid`, companyID, entityID, entityFieldID)
	if err != nil {
		return mapEntitiesPostgresError(err)
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

func mapEntitiesPostgresError(err error) error {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "duplicate key"), strings.Contains(message, "unique constraint"):
		return ErrAlreadyExists
	case strings.Contains(message, "check constraint"), strings.Contains(message, "invalid input syntax"):
		return ErrInvalid
	case strings.Contains(message, "foreign key"):
		return ErrNotFound
	default:
		return err
	}
}
