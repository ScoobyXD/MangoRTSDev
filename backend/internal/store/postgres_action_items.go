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
	if err := validatePostgresActionItemSourceTx(ctx, tx, normalized); err != nil {
		return domain.Entity{}, err
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
	sourceValue := actionItemSourceValue(normalized.SourceResourceType, normalized.SourceResourceID)
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
	         when 'source' then $6::jsonb
	         else null
       end,
       template.position
from unnest($3::text[], $4::text[]) as input(entity_field_id, entity_field_type_id)
join entity_field_types template
  on template.company_id=$1::uuid and template.entity_field_type_id=input.entity_field_type_id::uuid`, normalized.CompanyID, entityID, fieldIDs, fieldTypeIDs, colorValue, sourceValue)
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
	boardIDs, err := postgresHuddleActionItemBoardIDsTx(ctx, tx, normalized.CompanyID, entityID)
	if err != nil {
		return domain.Entity{}, err
	}
	nodeIDs, err := postgresHuddleNodeIDsForBoardsTx(ctx, tx, normalized.CompanyID, boardIDs)
	if err != nil {
		return domain.Entity{}, err
	}
	if err := r.enqueueHuddleActionItemsRealtimeTx(ctx, tx, normalized.CompanyID, boardIDs, nodeIDs); err != nil {
		return domain.Entity{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Entity{}, err
	}
	return item, nil
}

func validatePostgresActionItemSourceTx(ctx context.Context, tx *sql.Tx, input ActionItemInput) error {
	if input.SourceResourceType == "" {
		return nil
	}
	var lockQuery string
	accessType, accessID := input.SourceResourceType, input.SourceResourceID
	switch input.SourceResourceType {
	case EntityTypeNode:
		lockQuery = `select node_id::text,node_id::text from nodes where company_id=$1::uuid and node_id=$2::uuid for key share`
	case EntityTypeLogicGate:
		lockQuery = `select logic_gate_id::text,logic_gate_id::text from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid for key share`
	case EntityTypeProject:
		lockQuery = `select project_id::text,project_id::text from projects where company_id=$1::uuid and project_id=$2::uuid for key share`
	case EntityTypeHuddleNode:
		lockQuery = `select huddle_node_id::text,huddle_node_id::text from huddle_nodes where company_id=$1::uuid and huddle_node_id=$2::uuid for key share`
	case EntityTypeHuddleLogicGate:
		lockQuery = `select huddle_logic_gate_id::text,huddle_logic_gate_id::text from huddle_logic_gates where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid and deleted_timestamp is null for key share`
	case EntityTypeKPI:
		lockQuery = `select kpi_id::text,logic_gate_id::text from kpis where company_id=$1::uuid and kpi_id=$2::uuid and deleted_timestamp is null for key share`
		accessType = EntityTypeLogicGate
	default:
		return ErrInvalid
	}
	var lockedResourceID string
	if err := tx.QueryRowContext(ctx, lockQuery, input.CompanyID, input.SourceResourceID).Scan(&lockedResourceID, &accessID); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	var allowed bool
	if err := tx.QueryRowContext(ctx, `select mangorts_user_can_access_resource($1::uuid,$2::text,$3::uuid,$4::uuid,'edit')`, input.CompanyID, accessType, accessID, input.CreatedByUserID).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) GetActionItemSource(companyID, entityID string) (domain.ActionItemSource, error) {
	companyID, entityID = cleanUUIDText(companyID), cleanUUIDText(entityID)
	if companyID == "" || entityID == "" {
		return domain.ActionItemSource{}, ErrInvalid
	}
	var source domain.ActionItemSource
	var value json.RawMessage
	err := r.db.QueryRowContext(context.Background(), `
select field.company_id::text,field.entity_id::text,field.value_jsonb,field.created_timestamp
from entity_fields field
join entities entity
  on entity.company_id=field.company_id and entity.entity_id=field.entity_id
join entity_types entity_type
  on entity_type.company_id=entity.company_id and entity_type.entity_type_id=entity.entity_type_id
where field.company_id=$1::uuid and field.entity_id=$2::uuid
  and field.entity_field_type_id=$3::uuid
  and entity_type.system_key=$4::text
  and field.value_jsonb is not null`, companyID, entityID, ActionItemSourceFieldTypeID, ActionItemEntityTypeSystemKey).Scan(
		&source.CompanyID,
		&source.EntityID,
		&value,
		&source.CreatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ActionItemSource{}, ErrNotFound
	}
	if err != nil {
		return domain.ActionItemSource{}, err
	}
	var ok bool
	source.ResourceType, source.ResourceID, ok = decodeActionItemSourceValue(value)
	if !ok {
		return domain.ActionItemSource{}, ErrNotFound
	}
	return source, nil
}

func (r *PostgresRepo) ListVisibleActionItemSources(companyID, viewerUserID string, entityIDs []string) (map[string]domain.ActionItemSourceView, error) {
	companyID, viewerUserID = cleanUUIDText(companyID), cleanUUIDText(viewerUserID)
	if companyID == "" || viewerUserID == "" {
		return nil, ErrInvalid
	}
	entityIDs = cleanUUIDTextSlice(entityIDs)
	visible := make(map[string]domain.ActionItemSourceView)
	if len(entityIDs) == 0 {
		return visible, nil
	}
	rows, err := r.db.QueryContext(context.Background(), `
with recursive action_source_base as (
  select field.entity_id,
         lower(btrim(coalesce(field.value_jsonb ->> 'resource_type',''))) as resource_type,
         mangorts_try_uuid(field.value_jsonb ->> 'resource_id') as resource_id
  from entity_fields field
  join entities entity
    on entity.company_id=field.company_id and entity.entity_id=field.entity_id
  join entity_types entity_type
    on entity_type.company_id=entity.company_id and entity_type.entity_type_id=entity.entity_type_id
  where field.company_id=$1::uuid
    and field.entity_id::text=any($2::text[])
    and field.entity_field_type_id=$3::uuid
    and field.value_jsonb is not null
    and entity_type.system_key=$5::text
), action_source_resolved as (
  select base.entity_id,base.resource_type,base.resource_id,
         case base.resource_type
           when 'node' then source_node.name
           when 'logic_gate' then source_logic_gate.header
           when 'project' then source_project.name
           when 'huddle_node' then source_huddle_node.name
           when 'huddle_logic_gate' then source_huddle_gate.header
           when 'kpi' then source_kpi.name
           else null
         end as source_name,
         case base.resource_type
           when 'kpi' then case when source_kpi.kpi_id is not null then 'logic_gate'::text end
           when 'node' then case when source_node.node_id is not null then 'node'::text end
           when 'logic_gate' then case when source_logic_gate.logic_gate_id is not null then 'logic_gate'::text end
           when 'project' then case when source_project.project_id is not null then 'project'::text end
           when 'huddle_node' then case when source_huddle_node.huddle_node_id is not null then 'huddle_node'::text end
           when 'huddle_logic_gate' then case when source_huddle_gate.huddle_logic_gate_id is not null then 'huddle_logic_gate'::text end
           else null
         end as access_resource_type,
         case base.resource_type
           when 'kpi' then source_kpi.logic_gate_id
           when 'node' then source_node.node_id
           when 'logic_gate' then source_logic_gate.logic_gate_id
           when 'project' then source_project.project_id
           when 'huddle_node' then source_huddle_node.huddle_node_id
           when 'huddle_logic_gate' then source_huddle_gate.huddle_logic_gate_id
           else null
         end as access_resource_id,
         case when base.resource_type='kpi' then source_kpi.logic_gate_id end as parent_resource_id
  from action_source_base base
  left join nodes source_node
    on base.resource_type='node' and source_node.company_id=$1::uuid and source_node.node_id=base.resource_id
  left join logic_gates source_logic_gate
    on base.resource_type='logic_gate' and source_logic_gate.company_id=$1::uuid and source_logic_gate.logic_gate_id=base.resource_id
  left join projects source_project
    on base.resource_type='project' and source_project.company_id=$1::uuid and source_project.project_id=base.resource_id
  left join huddle_nodes source_huddle_node
    on base.resource_type='huddle_node' and source_huddle_node.company_id=$1::uuid and source_huddle_node.huddle_node_id=base.resource_id
  left join huddle_logic_gates source_huddle_gate
    on base.resource_type='huddle_logic_gate' and source_huddle_gate.company_id=$1::uuid and source_huddle_gate.huddle_logic_gate_id=base.resource_id
  left join kpis source_kpi
    on base.resource_type='kpi' and source_kpi.company_id=$1::uuid and source_kpi.kpi_id=base.resource_id
), action_source_access_targets(resource_type,resource_id) as (
  select distinct access_resource_type,access_resource_id
  from action_source_resolved
  where access_resource_type is not null and access_resource_id is not null
)
`+myWorkViewerPermissionCTE+myWorkPermissionAccessCTEs("action_source_access_targets", "action_source")+`
select source.entity_id::text,source.resource_type,source.resource_id::text,source.source_name,source.parent_resource_id::text
from action_source_resolved source
join action_source_access access
  on access.resource_type=source.access_resource_type and access.resource_id=source.access_resource_id
where source.source_name is not null and access.allowed
order by source.entity_id`, companyID, entityIDs, ActionItemSourceFieldTypeID, viewerUserID, ActionItemEntityTypeSystemKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var entityID string
		var source domain.ActionItemSourceView
		var parentResourceID sql.NullString
		if err := rows.Scan(&entityID, &source.ResourceType, &source.ResourceID, &source.Name, &parentResourceID); err != nil {
			return nil, err
		}
		if parentResourceID.Valid {
			source.ParentResourceID = parentResourceID.String
		}
		visible[entityID] = source
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return visible, nil
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

func syncPostgresHuddleActionItemRelationshipsTx(ctx context.Context, tx *sql.Tx, ref EditorJSONDocumentRef) (bool, error) {
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
			return false, ErrInvalid
		}
		rows, err = tx.QueryContext(ctx, `
select body_json
from huddle_logic_gates
where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid and deleted_timestamp is null`, ref.CompanyID, ref.ResourceID)
	default:
		return false, nil
	}
	if err != nil {
		return false, err
	}
	documents := make([]json.RawMessage, 0)
	for rows.Next() {
		var body []byte
		if err := rows.Scan(&body); err != nil {
			rows.Close()
			return false, err
		}
		documents = append(documents, append(json.RawMessage(nil), body...))
	}
	if err := rows.Close(); err != nil {
		return false, err
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	actionItemIDs := entityReferenceIDsFromEditorDocuments(documents)
	deleteResult, err := tx.ExecContext(ctx, `
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
  and not (relationship.entity_id::text=any($5::text[]))`, ref.CompanyID, ref.ResourceType, ref.ResourceID, ActionItemEntityTypeSystemKey, actionItemIDs)
	if err != nil {
		return false, mapEntitiesPostgresError(err)
	}
	deleted, err := deleteResult.RowsAffected()
	if err != nil {
		return false, err
	}
	changed := deleted > 0
	if len(actionItemIDs) > 0 {
		insertResult, err := tx.ExecContext(ctx, `
insert into entity_relationships (company_id, entity_id, resource_type, resource_id)
select $1::uuid, entity.entity_id, $2::text, $3::uuid
from unnest($4::text[]) as input(entity_id)
join entities entity
  on entity.company_id=$1::uuid and entity.entity_id=input.entity_id::uuid
join entity_types entity_type
  on entity_type.company_id=entity.company_id and entity_type.entity_type_id=entity.entity_type_id
where entity_type.system_key=$5::text
on conflict (company_id, entity_id, resource_type, resource_id) do nothing`, ref.CompanyID, ref.ResourceType, ref.ResourceID, actionItemIDs, ActionItemEntityTypeSystemKey)
		if err != nil {
			return false, mapEntitiesPostgresError(err)
		}
		inserted, err := insertResult.RowsAffected()
		if err != nil {
			return false, err
		}
		changed = changed || inserted > 0
	}
	return changed, nil
}

func (r *PostgresRepo) ListHuddleNodeCreatedActionItems(companyID, huddleNodeID string) ([]domain.Entity, error) {
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
	var exists bool
	err = tx.QueryRowContext(ctx, `select exists(select 1 from huddle_nodes where company_id=$1::uuid and huddle_node_id=$2::uuid)`, companyID, huddleNodeID).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	rows, err := tx.QueryContext(ctx, `
select entity.entity_id::text
from entities entity
join entity_types entity_type
  on entity_type.company_id=entity.company_id and entity_type.entity_type_id=entity.entity_type_id
join entity_fields source
  on source.company_id=entity.company_id and source.entity_id=entity.entity_id
 and source.entity_field_type_id=$3::uuid
where entity.company_id=$1::uuid
  and entity_type.system_key=$4::text
  and source.value_jsonb=jsonb_build_object('resource_type',$5::text,'resource_id',$2::text)
order by entity.created_timestamp,entity.entity_id`, companyID, huddleNodeID, ActionItemSourceFieldTypeID, ActionItemEntityTypeSystemKey, EntityTypeHuddleNode)
	if err != nil {
		return nil, err
	}
	entityIDs := []string{}
	for rows.Next() {
		var entityID string
		if err := rows.Scan(&entityID); err != nil {
			rows.Close()
			return nil, err
		}
		entityIDs = append(entityIDs, entityID)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items := make([]domain.Entity, 0, len(entityIDs))
	for _, entityID := range entityIDs {
		item, loadErr := getPostgresEntity(ctx, tx, companyID, entityID)
		if loadErr != nil {
			return nil, loadErr
		}
		items = append(items, item)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) ListHuddleNodeDueActionItems(companyID, huddleNodeID, viewingDate string) ([]domain.Entity, error) {
	companyID, huddleNodeID = cleanUUIDText(companyID), cleanUUIDText(huddleNodeID)
	viewingDate, dateErr := normalizeHuddleDate(viewingDate)
	if companyID == "" || huddleNodeID == "" || dateErr != nil {
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
	filtered := items[:0]
	for _, item := range items {
		if actionItemSourceMatches(item, EntityTypeHuddleNode, huddleNodeID) {
			continue
		}
		dueDate := actionItemFieldText(item, ActionItemCompletionDueDateSystemKey)
		status := actionItemFieldText(item, ActionItemStatusSystemKey)
		if dueDate == "" || dueDate > viewingDate || myWorkStatusDone(status) {
			continue
		}
		filtered = append(filtered, item)
	}
	sortHuddleDueActionItems(filtered)
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return filtered, nil
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
