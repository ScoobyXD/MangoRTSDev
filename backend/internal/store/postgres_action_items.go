package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) ensureActionItemDefaultsTx(ctx context.Context, tx *sql.Tx, companyID string) error {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return ErrInvalid
	}
	if _, err := tx.ExecContext(ctx, `
insert into entity_types (company_id, entity_type_id, system_key, name)
values ($1::uuid, $2::uuid, $3::text, 'Action Item')
on conflict (company_id, entity_type_id) do nothing`, companyID, ActionItemEntityTypeID, ActionItemEntityTypeSystemKey); err != nil {
		return mapEntitiesPostgresError(err)
	}
	required := actionItemFieldTypes(companyID)
	requiredByID := make(map[string]domain.EntityFieldType, len(required))
	fieldTypeIDs := make([]string, len(required))
	systemKeys := make([]string, len(required))
	names := make([]string, len(required))
	fieldTypes := make([]string, len(required))
	configs := make([]string, len(required))
	for index, fieldType := range required {
		requiredByID[fieldType.EntityFieldTypeID] = fieldType
		fieldTypeIDs[index] = fieldType.EntityFieldTypeID
		systemKeys[index] = fieldType.SystemKey
		names[index] = fieldType.Name
		fieldTypes[index] = fieldType.FieldType
		configs[index] = string(fieldType.Config)
	}
	if _, err := tx.ExecContext(ctx, `
insert into entity_field_types (
  company_id, entity_field_type_id, entity_type_id, entity_folder_id,
  system_key, name, field_type, config_jsonb, position
)

select $1::uuid, definition.entity_field_type_id::uuid, $2::uuid, null,
       definition.system_key, definition.name, definition.field_type,
       definition.config_json::jsonb, (definition.ordinality-1)::integer
from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
     with ordinality as definition(entity_field_type_id, system_key, name, field_type, config_json, ordinality)
on conflict (company_id, entity_field_type_id) do nothing`, companyID, ActionItemEntityTypeID, fieldTypeIDs, systemKeys, names, fieldTypes, configs); err != nil {
		return mapEntitiesPostgresError(err)
	}
	rows, err := tx.QueryContext(ctx, `
select field_type.company_id::text, field_type.entity_field_type_id::text, field_type.entity_type_id::text,
       field_type.entity_folder_id::text, coalesce(field_type.system_key, ''), field_type.name,
       field_type.field_type, field_type.config_jsonb, field_type.position,
       field_type.created_timestamp, field_type.updated_timestamp
from entity_types entity_type
join entity_field_types field_type
  on field_type.company_id=entity_type.company_id and field_type.entity_type_id=entity_type.entity_type_id
where entity_type.company_id=$1::uuid
  and entity_type.entity_type_id=$2::uuid
  and entity_type.system_key=$3::text
  and entity_type.name='Action Item'
  and field_type.entity_field_type_id::text=any($4::text[])`, companyID, ActionItemEntityTypeID, ActionItemEntityTypeSystemKey, fieldTypeIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		current, err := scanEntityFieldType(rows)
		if err != nil {
			return err
		}
		expected, exists := requiredByID[current.EntityFieldTypeID]
		if !exists || current.EntityTypeID != ActionItemEntityTypeID || current.EntityFolderID != nil || current.SystemKey != expected.SystemKey || current.Name != expected.Name || current.FieldType != expected.FieldType {
			return ErrConflict
		}
		if err := validateRequiredActionItemFieldConfig(current.SystemKey, current.FieldType, current.Config); err != nil {
			return ErrConflict
		}
		seen[current.EntityFieldTypeID] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(seen) != len(required) {
		return ErrConflict
	}
	return nil
}

func (r *PostgresRepo) CreateActionItem(input ActionItemInput) (domain.Entity, error) {
	normalized, err := normalizeActionItemInput(input)
	if err != nil {
		return domain.Entity{}, err
	}
	bodyJSON, err := actionItemBodyJSON(normalized.BodyText)
	if err != nil {
		return domain.Entity{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return domain.Entity{}, err
	}
	defer tx.Rollback()
	var companyExists, creatorIsMember bool
	if err := tx.QueryRowContext(ctx, `
select exists(select 1 from companies where company_id=$1::uuid),
       exists(select 1 from company_memberships where company_id=$1::uuid and user_id=$2::uuid)`, normalized.CompanyID, normalized.CreatedByUserID).Scan(&companyExists, &creatorIsMember); err != nil {
		return domain.Entity{}, err
	}
	if !companyExists {
		return domain.Entity{}, ErrNotFound
	}
	if !creatorIsMember {
		return domain.Entity{}, ErrPrincipalNotInCompany
	}
	requiredByID := map[string]domain.EntityFieldType{}
	requiredIDs := make([]string, 0, len(actionItemFieldTypes(normalized.CompanyID)))
	for _, required := range actionItemFieldTypes(normalized.CompanyID) {
		requiredByID[required.EntityFieldTypeID] = required
		requiredIDs = append(requiredIDs, required.EntityFieldTypeID)
	}
	rows, err := tx.QueryContext(ctx, `
select field_type.company_id::text, field_type.entity_field_type_id::text, field_type.entity_type_id::text,
       field_type.entity_folder_id::text, coalesce(field_type.system_key, ''), field_type.name,
       field_type.field_type, field_type.config_jsonb, field_type.position,
       field_type.created_timestamp, field_type.updated_timestamp
from entity_types entity_type
join entity_field_types field_type
  on field_type.company_id=entity_type.company_id and field_type.entity_type_id=entity_type.entity_type_id
where entity_type.company_id=$1::uuid
  and entity_type.entity_type_id=$2::uuid
  and entity_type.system_key=$3::text
  and entity_type.name='Action Item'
  and field_type.entity_field_type_id::text=any($4::text[])
order by field_type.position, field_type.entity_field_type_id`, normalized.CompanyID, ActionItemEntityTypeID, ActionItemEntityTypeSystemKey, requiredIDs)
	if err != nil {
		return domain.Entity{}, err
	}
	currentTemplates := make([]domain.EntityFieldType, 0, len(requiredIDs))
	for rows.Next() {
		current, err := scanEntityFieldType(rows)
		if err != nil {
			rows.Close()
			return domain.Entity{}, err
		}
		required, exists := requiredByID[current.EntityFieldTypeID]
		if !exists || current.EntityTypeID != ActionItemEntityTypeID || current.EntityFolderID != nil || current.SystemKey != required.SystemKey || current.Name != required.Name || current.FieldType != required.FieldType {
			rows.Close()
			return domain.Entity{}, ErrConflict
		}
		if err := validateRequiredActionItemFieldConfig(current.SystemKey, current.FieldType, current.Config); err != nil {
			rows.Close()
			return domain.Entity{}, ErrConflict
		}
		value := actionItemInitialFieldValue(current.SystemKey, normalized.Color)
		if current.SystemKey == ActionItemStatusSystemKey {
			value, err = entityFieldTypeDefaultValue(current.FieldType, current.Config)
		}
		if err != nil {
			rows.Close()
			return domain.Entity{}, err
		}
		if _, err := normalizeEntityFieldValueForConfig(current.FieldType, value, current.Config); err != nil {
			rows.Close()
			return domain.Entity{}, err
		}
		currentTemplates = append(currentTemplates, current)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return domain.Entity{}, err
	}
	if err := rows.Close(); err != nil {
		return domain.Entity{}, err
	}
	if len(currentTemplates) != len(requiredIDs) {
		return domain.Entity{}, ErrConflict
	}
	entityID := newUUIDv7String()
	if _, err := tx.ExecContext(ctx, `
insert into entities (
  company_id, entity_id, entity_type_id, entity_folder_id, name,
  position, body_json, revision, created_by_user_id
)
values (
  $1::uuid, $2::uuid, $3::uuid, null, $4::text,
  coalesce((select max(position)+1 from entities where company_id=$1::uuid and entity_type_id=$3::uuid and entity_folder_id is null), 0),
  $5::jsonb, 0, $6::uuid
)`, normalized.CompanyID, entityID, ActionItemEntityTypeID, normalized.Name, bodyJSON, normalized.CreatedByUserID); err != nil {
		return domain.Entity{}, mapEntitiesPostgresError(err)
	}
	fieldIDs := make([]string, len(currentTemplates))
	fieldTypeIDs := make([]string, len(currentTemplates))
	for index, current := range currentTemplates {
		fieldIDs[index] = newUUIDv7String()
		fieldTypeIDs[index] = current.EntityFieldTypeID
	}
	colorValue := actionItemInitialFieldValue(ActionItemColorSystemKey, normalized.Color)
	result, err := tx.ExecContext(ctx, `
insert into entity_fields (
  company_id, entity_field_id, entity_id, entity_field_type_id,
  name, field_type, value_jsonb, position
)
select $1::uuid, input.entity_field_id::uuid, $2::uuid, template.entity_field_type_id,
       template.name, template.field_type,
       case template.system_key
         when 'status' then template.config_jsonb->'default'
         when 'color' then $5::jsonb
         else null
       end,
       template.position
from unnest($3::text[], $4::text[]) as input(entity_field_id, entity_field_type_id)
join entity_field_types template
  on template.company_id=$1::uuid and template.entity_field_type_id=input.entity_field_type_id::uuid`, normalized.CompanyID, entityID, fieldIDs, fieldTypeIDs, colorValue)
	if err != nil {
		return domain.Entity{}, mapEntitiesPostgresError(err)
	}
	if count, err := result.RowsAffected(); err != nil {
		return domain.Entity{}, err
	} else if count != int64(len(currentTemplates)) {
		return domain.Entity{}, ErrConflict
	}
	item, err := getPostgresEntity(ctx, tx, normalized.CompanyID, entityID)
	if err != nil {
		return domain.Entity{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Entity{}, err
	}
	return item, nil
}

func lockPostgresHuddleActionItemRelationshipsTx(ctx context.Context, tx *sql.Tx, ref EditorJSONDocumentRef) error {
	var query string
	switch ref.ResourceType {
	case EntityTypeHuddleNode:
		query = `select huddle_node_id::text from huddle_nodes where company_id=$1::uuid and huddle_node_id=$2::uuid for update`
	case EntityTypeHuddleLogicGate:
		query = `select huddle_logic_gate_id::text from huddle_logic_gates where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid for update`
	default:
		return nil
	}
	var resourceID string
	err := tx.QueryRowContext(ctx, query, ref.CompanyID, ref.ResourceID).Scan(&resourceID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func syncPostgresHuddleActionItemRelationshipsTx(ctx context.Context, tx *sql.Tx, ref EditorJSONDocumentRef) error {
	var rows *sql.Rows
	var err error
	switch ref.ResourceType {
	case EntityTypeHuddleNode:
		rows, err = tx.QueryContext(ctx, `
select body_json
from huddle_node_textboxes
where company_id=$1::uuid and huddle_node_id=$2::uuid and deleted_timestamp is null`, ref.CompanyID, ref.ResourceID)
	case EntityTypeHuddleLogicGate:
		if ref.DocumentID != ref.ResourceID {
			return ErrInvalid
		}
		rows, err = tx.QueryContext(ctx, `
select body_json
from huddle_logic_gates
where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid and deleted_timestamp is null`, ref.CompanyID, ref.ResourceID)
	default:
		return nil
	}
	if err != nil {
		return err
	}
	documents := make([]json.RawMessage, 0)
	for rows.Next() {
		var body []byte
		if err := rows.Scan(&body); err != nil {
			rows.Close()
			return err
		}
		documents = append(documents, append(json.RawMessage(nil), body...))
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}
	actionItemIDs := entityReferenceIDsFromEditorDocuments(documents)
	if _, err := tx.ExecContext(ctx, `
delete from entity_relationships relationship
using entities entity, entity_types entity_type
where relationship.company_id=$1::uuid
  and relationship.resource_type=$2::text
  and relationship.resource_id=$3::uuid
  and entity.company_id=relationship.company_id
  and entity.entity_id=relationship.entity_id
  and entity_type.company_id=entity.company_id
  and entity_type.entity_type_id=entity.entity_type_id
  and entity_type.system_key=$4::text
  and not (relationship.entity_id::text=any($5::text[]))`, ref.CompanyID, ref.ResourceType, ref.ResourceID, ActionItemEntityTypeSystemKey, actionItemIDs); err != nil {
		return mapEntitiesPostgresError(err)
	}
	if len(actionItemIDs) > 0 {
		if _, err := tx.ExecContext(ctx, `
insert into entity_relationships (company_id, entity_id, resource_type, resource_id)
select $1::uuid, entity.entity_id, $2::text, $3::uuid
from unnest($4::text[]) as input(entity_id)
join entities entity
  on entity.company_id=$1::uuid and entity.entity_id=input.entity_id::uuid
join entity_types entity_type
  on entity_type.company_id=entity.company_id and entity_type.entity_type_id=entity.entity_type_id
where entity_type.system_key=$5::text
on conflict (company_id, entity_id, resource_type, resource_id) do nothing`, ref.CompanyID, ref.ResourceType, ref.ResourceID, actionItemIDs, ActionItemEntityTypeSystemKey); err != nil {
			return mapEntitiesPostgresError(err)
		}
	}
	return nil
}

func (r *PostgresRepo) ListHuddleNodeActionItems(companyID, huddleNodeID string) ([]domain.Entity, error) {
	companyID, huddleNodeID = cleanUUIDText(companyID), cleanUUIDText(huddleNodeID)
	if companyID == "" || huddleNodeID == "" {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var ownerID string
	err = tx.QueryRowContext(ctx, `
select huddle_logic_gate_id::text
from huddle_nodes
where company_id=$1::uuid and huddle_node_id=$2::uuid`, companyID, huddleNodeID).Scan(&ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	items, err := listHuddleLogicGateActionItemsTx(ctx, tx, companyID, ownerID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) ListHuddleLogicGateActionItems(companyID, huddleLogicGateID string) ([]domain.Entity, error) {
	companyID, huddleLogicGateID = cleanUUIDText(companyID), cleanUUIDText(huddleLogicGateID)
	if companyID == "" || huddleLogicGateID == "" {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var exists bool
	if err = tx.QueryRowContext(ctx, `
select exists(
  select 1 from huddle_logic_gates
  where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid
)`, companyID, huddleLogicGateID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	items, err := listHuddleLogicGateActionItemsTx(ctx, tx, companyID, huddleLogicGateID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return items, nil
}

func listHuddleLogicGateActionItemsTx(ctx context.Context, tx *sql.Tx, companyID, huddleLogicGateID string) ([]domain.Entity, error) {
	rows, err := tx.QueryContext(ctx, `
select entity.company_id::text, entity.entity_id::text, entity.entity_type_id::text, entity_type.name,
       entity.entity_folder_id::text, entity.name, entity.position, entity.body_json, entity.revision,
       coalesce(entity.created_by_user_id::text, ''), entity.created_timestamp, entity.updated_timestamp
from (
  select relationship.entity_id
  from entity_relationships relationship
  where relationship.company_id=$1::uuid
    and relationship.resource_type=$3::text
    and relationship.resource_id=$2::uuid
  union
  select relationship.entity_id
  from entity_relationships relationship
  join huddle_nodes linked_node
    on linked_node.company_id=relationship.company_id
   and linked_node.huddle_node_id=relationship.resource_id
  where relationship.company_id=$1::uuid
    and relationship.resource_type=$4::text
    and linked_node.huddle_logic_gate_id=$2::uuid
) relationship
join entities entity
  on entity.company_id=$1::uuid and entity.entity_id=relationship.entity_id
join entity_types entity_type
  on entity_type.company_id=entity.company_id and entity_type.entity_type_id=entity.entity_type_id
where entity_type.system_key=$5::text
order by entity.created_timestamp, entity.entity_id`, companyID, huddleLogicGateID, EntityTypeHuddleLogicGate, EntityTypeHuddleNode, ActionItemEntityTypeSystemKey)
	if err != nil {
		return nil, err
	}
	items := []domain.Entity{}
	entityIDs := []string{}
	itemIndexByID := map[string]int{}
	for rows.Next() {
		item, err := scanEntity(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		item.EntityFields = []domain.EntityField{}
		itemIndexByID[item.EntityID] = len(items)
		entityIDs = append(entityIDs, item.EntityID)
		items = append(items, item)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(entityIDs) > 0 {
		fieldRows, err := tx.QueryContext(ctx, `
select field.company_id::text, field.entity_field_id::text, field.entity_id::text, field.entity_field_type_id::text,
       coalesce(field_type.system_key, ''), field.name, field.field_type, coalesce(field_type.config_jsonb, '{}'::jsonb),
       field.value_jsonb, field.position, field.created_timestamp, field.updated_timestamp
from entity_fields field
left join entity_field_types field_type
  on field_type.company_id=field.company_id and field_type.entity_field_type_id=field.entity_field_type_id
where field.company_id=$1::uuid and field.entity_id::text=any($2::text[])
order by field.entity_id, field.position, lower(field.name), field.entity_field_id`, companyID, entityIDs)
		if err != nil {
			return nil, err
		}
		for fieldRows.Next() {
			field, err := scanEntityField(fieldRows)
			if err != nil {
				fieldRows.Close()
				return nil, err
			}
			index, exists := itemIndexByID[field.EntityID]
			if !exists {
				fieldRows.Close()
				return nil, ErrConflict
			}
			items[index].EntityFields = append(items[index].EntityFields, field)
		}
		if err := fieldRows.Err(); err != nil {
			fieldRows.Close()
			return nil, err
		}
		if err := fieldRows.Close(); err != nil {
			return nil, err
		}
	}
	return items, nil
}
