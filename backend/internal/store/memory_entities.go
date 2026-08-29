package store

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
)

func (r *MemoryRepo) ListEntityTypes(companyID string) ([]domain.EntityType, error) {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := []domain.EntityType{}
	for _, item := range r.entityTypes {
		if item.CompanyID == companyID {
			items = append(items, item)
		}
	}
	sortEntityTypes(items)
	return items, nil
}

func (r *MemoryRepo) CreateEntityType(input EntityTypeInput) (domain.EntityType, error) {
	normalized, err := normalizeEntityTypeInput(input, false)
	if err != nil {
		return domain.EntityType{}, err
	}
	if normalized.EntityTypeID == "" {
		normalized.EntityTypeID = newUUIDv7String()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.entityTypes[key(normalized.CompanyID, normalized.EntityTypeID)]; exists {
		return domain.EntityType{}, ErrAlreadyExists
	}
	for _, item := range r.entityTypes {
		if item.CompanyID == normalized.CompanyID && strings.EqualFold(strings.TrimSpace(item.Name), normalized.Name) {
			return domain.EntityType{}, ErrAlreadyExists
		}
	}
	now := time.Now().UTC()
	item := domain.EntityType{CompanyID: normalized.CompanyID, EntityTypeID: normalized.EntityTypeID, Name: normalized.Name, CreatedTimestamp: now, UpdatedTimestamp: now}
	r.entityTypes[key(item.CompanyID, item.EntityTypeID)] = item
	return item, nil
}

func (r *MemoryRepo) UpdateEntityType(input EntityTypeInput) (domain.EntityType, error) {
	normalized, err := normalizeEntityTypeInput(input, true)
	if err != nil {
		return domain.EntityType{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	itemKey := key(normalized.CompanyID, normalized.EntityTypeID)
	item, exists := r.entityTypes[itemKey]
	if !exists {
		return domain.EntityType{}, ErrNotFound
	}
	if item.SystemKey == ActionItemEntityTypeSystemKey {
		return domain.EntityType{}, ErrConflict
	}
	for _, candidate := range r.entityTypes {
		if candidate.CompanyID == normalized.CompanyID && candidate.EntityTypeID != normalized.EntityTypeID && strings.EqualFold(strings.TrimSpace(candidate.Name), normalized.Name) {
			return domain.EntityType{}, ErrAlreadyExists
		}
	}
	item.Name = normalized.Name
	item.UpdatedTimestamp = time.Now().UTC()
	r.entityTypes[itemKey] = item
	return item, nil
}

func (r *MemoryRepo) DeleteEntityType(companyID, entityTypeID string) error {
	companyID, entityTypeID = cleanUUIDText(companyID), cleanUUIDText(entityTypeID)
	if companyID == "" || entityTypeID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	itemKey := key(companyID, entityTypeID)
	if _, exists := r.entityTypes[itemKey]; !exists {
		return ErrNotFound
	}
	if r.entityTypes[itemKey].SystemKey == ActionItemEntityTypeSystemKey {
		return ErrConflict
	}
	for _, entity := range r.entities {
		if entity.CompanyID == companyID && entity.EntityTypeID == entityTypeID {
			return ErrConflict
		}
	}
	for itemKey, folder := range r.entityFolders {
		if folder.CompanyID == companyID && folder.EntityTypeID == entityTypeID {
			delete(r.entityFolders, itemKey)
		}
	}
	for itemKey, fieldType := range r.entityFieldTypes {
		if fieldType.CompanyID == companyID && fieldType.EntityTypeID == entityTypeID {
			delete(r.entityFieldTypes, itemKey)
		}
	}
	delete(r.entityTypes, itemKey)
	return nil
}

func (r *MemoryRepo) ListEntityFolders(companyID, entityTypeID string) ([]domain.EntityFolder, error) {
	companyID, entityTypeID = cleanUUIDText(companyID), cleanUUIDText(entityTypeID)
	if companyID == "" || entityTypeID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, exists := r.entityTypes[key(companyID, entityTypeID)]; !exists {
		return nil, ErrNotFound
	}
	items := []domain.EntityFolder{}
	for _, item := range r.entityFolders {
		if item.CompanyID == companyID && item.EntityTypeID == entityTypeID {
			items = append(items, cloneEntityFolder(item))
		}
	}
	sortEntityFolders(items)
	return items, nil
}

func (r *MemoryRepo) CreateEntityFolder(input EntityFolderInput) (domain.EntityFolder, error) {
	normalized, err := normalizeEntityFolderInput(input, false)
	if err != nil {
		return domain.EntityFolder{}, err
	}
	if normalized.EntityFolderID == "" {
		normalized.EntityFolderID = newUUIDv7String()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.entityTypes[key(normalized.CompanyID, normalized.EntityTypeID)]; !exists {
		return domain.EntityFolder{}, ErrNotFound
	}
	if _, exists := r.entityFolders[key(normalized.CompanyID, normalized.EntityFolderID)]; exists {
		return domain.EntityFolder{}, ErrAlreadyExists
	}
	if normalized.ParentEntityFolderID != nil {
		parent, exists := r.entityFolders[key(normalized.CompanyID, *normalized.ParentEntityFolderID)]
		if !exists || parent.EntityTypeID != normalized.EntityTypeID {
			return domain.EntityFolder{}, ErrNotFound
		}
	}
	if !normalized.PositionSet {
		normalized.Position = r.nextEntityFolderPositionLocked(normalized.CompanyID, normalized.EntityTypeID, normalized.ParentEntityFolderID)
	}
	now := time.Now().UTC()
	item := domain.EntityFolder{CompanyID: normalized.CompanyID, EntityFolderID: normalized.EntityFolderID, EntityTypeID: normalized.EntityTypeID, ParentEntityFolderID: cloneStringPointer(normalized.ParentEntityFolderID), Name: normalized.Name, Position: normalized.Position, CreatedTimestamp: now, UpdatedTimestamp: now}
	r.entityFolders[key(item.CompanyID, item.EntityFolderID)] = item
	return cloneEntityFolder(item), nil
}

func (r *MemoryRepo) UpdateEntityFolder(input EntityFolderInput) (domain.EntityFolder, error) {
	normalized, err := normalizeEntityFolderInput(input, true)
	if err != nil {
		return domain.EntityFolder{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	itemKey := key(normalized.CompanyID, normalized.EntityFolderID)
	item, exists := r.entityFolders[itemKey]
	if !exists {
		return domain.EntityFolder{}, ErrNotFound
	}
	if normalized.ParentFolderSet {
		if err := r.validateEntityFolderParentLocked(item, normalized.ParentEntityFolderID); err != nil {
			return domain.EntityFolder{}, err
		}
		item.ParentEntityFolderID = cloneStringPointer(normalized.ParentEntityFolderID)
	}
	if normalized.NameSet {
		item.Name = normalized.Name
	}
	if normalized.PositionSet {
		item.Position = normalized.Position
	}
	item.UpdatedTimestamp = time.Now().UTC()
	r.entityFolders[itemKey] = item
	return cloneEntityFolder(item), nil
}

func (r *MemoryRepo) DeleteEntityFolder(companyID, entityFolderID string) error {
	companyID, entityFolderID = cleanUUIDText(companyID), cleanUUIDText(entityFolderID)
	if companyID == "" || entityFolderID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	itemKey := key(companyID, entityFolderID)
	if _, exists := r.entityFolders[itemKey]; !exists {
		return ErrNotFound
	}
	for _, folder := range r.entityFolders {
		if folder.CompanyID == companyID && optionalEntityIDValue(folder.ParentEntityFolderID) == entityFolderID {
			return ErrConflict
		}
	}
	for _, entity := range r.entities {
		if entity.CompanyID == companyID && optionalEntityIDValue(entity.EntityFolderID) == entityFolderID {
			return ErrConflict
		}
	}
	for fieldTypeKey, fieldType := range r.entityFieldTypes {
		if fieldType.CompanyID == companyID && optionalEntityIDValue(fieldType.EntityFolderID) == entityFolderID {
			delete(r.entityFieldTypes, fieldTypeKey)
		}
	}
	delete(r.entityFolders, itemKey)
	return nil
}

func (r *MemoryRepo) ListEntityFieldTypes(companyID, entityTypeID string) ([]domain.EntityFieldType, error) {
	companyID, entityTypeID = cleanUUIDText(companyID), cleanUUIDText(entityTypeID)
	if companyID == "" || entityTypeID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, exists := r.entityTypes[key(companyID, entityTypeID)]; !exists {
		return nil, ErrNotFound
	}
	items := []domain.EntityFieldType{}
	for _, item := range r.entityFieldTypes {
		if item.CompanyID == companyID && item.EntityTypeID == entityTypeID {
			items = append(items, cloneEntityFieldType(item))
		}
	}
	sortEntityFieldTypes(items)
	return items, nil
}

func (r *MemoryRepo) CreateEntityFieldType(input EntityFieldTypeInput) (domain.EntityFieldType, error) {
	normalized, err := normalizeEntityFieldTypeInput(input, false)
	if err != nil {
		return domain.EntityFieldType{}, err
	}
	if normalized.EntityFieldTypeID == "" {
		normalized.EntityFieldTypeID = newUUIDv7String()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.entityTypes[key(normalized.CompanyID, normalized.EntityTypeID)]; !exists {
		return domain.EntityFieldType{}, ErrNotFound
	}
	if _, exists := r.entityFieldTypes[key(normalized.CompanyID, normalized.EntityFieldTypeID)]; exists {
		return domain.EntityFieldType{}, ErrAlreadyExists
	}
	if err := r.validateEntityFieldTypeFolderLocked(normalized.CompanyID, normalized.EntityTypeID, normalized.EntityFolderID); err != nil {
		return domain.EntityFieldType{}, err
	}
	if normalized.EntityTypeID == ActionItemEntityTypeID && isReservedActionItemFieldName(normalized.Name) {
		return domain.EntityFieldType{}, ErrConflict
	}
	if r.entityFieldTypeNameExistsLocked(normalized.CompanyID, normalized.EntityTypeID, normalized.EntityFolderID, normalized.Name, "") {
		return domain.EntityFieldType{}, ErrAlreadyExists
	}
	if !normalized.PositionSet {
		normalized.Position = r.nextEntityFieldTypePositionLocked(normalized.CompanyID, normalized.EntityTypeID, normalized.EntityFolderID)
	}
	now := time.Now().UTC()
	item := domain.EntityFieldType{CompanyID: normalized.CompanyID, EntityFieldTypeID: normalized.EntityFieldTypeID, EntityTypeID: normalized.EntityTypeID, EntityFolderID: cloneStringPointer(normalized.EntityFolderID), Name: normalized.Name, FieldType: normalized.FieldType, Config: append([]byte(nil), normalized.Config...), Position: normalized.Position, CreatedTimestamp: now, UpdatedTimestamp: now}
	r.entityFieldTypes[key(item.CompanyID, item.EntityFieldTypeID)] = item
	return cloneEntityFieldType(item), nil
}

func (r *MemoryRepo) UpdateEntityFieldType(input EntityFieldTypeInput) (domain.EntityFieldType, error) {
	normalized, err := normalizeEntityFieldTypeInput(input, true)
	if err != nil {
		return domain.EntityFieldType{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	itemKey := key(normalized.CompanyID, normalized.EntityFieldTypeID)
	item, exists := r.entityFieldTypes[itemKey]
	if !exists {
		return domain.EntityFieldType{}, ErrNotFound
	}
	if item.FieldType == EntityFieldTypeResource {
		return domain.EntityFieldType{}, ErrConflict
	}
	isRequiredActionItemFieldType := item.EntityTypeID == ActionItemEntityTypeID && isRequiredActionItemFieldSystemKey(item.SystemKey)
	if isRequiredActionItemFieldType && (normalized.NameSet || normalized.FieldTypeSet || normalized.EntityFolderSet) {
		return domain.EntityFieldType{}, ErrConflict
	}
	nextFolder := item.EntityFolderID
	if normalized.EntityFolderSet {
		if err := r.validateEntityFieldTypeFolderLocked(item.CompanyID, item.EntityTypeID, normalized.EntityFolderID); err != nil {
			return domain.EntityFieldType{}, err
		}
		nextFolder = normalized.EntityFolderID
	}
	nextName := item.Name
	if normalized.NameSet {
		nextName = normalized.Name
	}
	if item.EntityTypeID == ActionItemEntityTypeID && !isRequiredActionItemFieldSystemKey(item.SystemKey) && isReservedActionItemFieldName(nextName) {
		return domain.EntityFieldType{}, ErrConflict
	}
	if r.entityFieldTypeNameExistsLocked(item.CompanyID, item.EntityTypeID, nextFolder, nextName, item.EntityFieldTypeID) {
		return domain.EntityFieldType{}, ErrAlreadyExists
	}
	nextFieldType := item.FieldType
	if normalized.FieldTypeSet {
		nextFieldType = normalized.FieldType
	}
	fieldTypeChanged := nextFieldType != item.FieldType
	nextConfig := item.Config
	if normalized.ConfigSet {
		nextConfig = normalized.Config
	}
	canonicalConfig, err := normalizeEntityFieldTypeConfig(nextFieldType, nextConfig)
	if err != nil {
		return domain.EntityFieldType{}, err
	}
	if isRequiredActionItemFieldType {
		if err := validateRequiredActionItemFieldConfig(item.SystemKey, nextFieldType, canonicalConfig); err != nil {
			return domain.EntityFieldType{}, err
		}
	}
	item.EntityFolderID = cloneStringPointer(nextFolder)
	item.Name = nextName
	item.FieldType = nextFieldType
	item.Config = canonicalConfig
	if normalized.PositionSet {
		item.Position = normalized.Position
	}
	item.UpdatedTimestamp = time.Now().UTC()
	r.entityFieldTypes[itemKey] = item
	defaultValue, err := entityFieldTypeDefaultValue(item.FieldType, item.Config)
	if err != nil {
		return domain.EntityFieldType{}, err
	}
	for fieldKey, field := range r.entityFields {
		if field.CompanyID != item.CompanyID || optionalEntityIDValue(field.EntityFieldTypeID) != item.EntityFieldTypeID {
			continue
		}
		if fieldTypeChanged {
			field.EntityFieldTypeID = nil
			field.SystemKey = ""
			field.Config = json.RawMessage(`{}`)
			field.UpdatedTimestamp = item.UpdatedTimestamp
			r.entityFields[fieldKey] = field
			continue
		}
		if field.Value == nil || (field.FieldType != EntityFieldTypeChoice && field.FieldType != EntityFieldTypeColor) {
			continue
		}
		if _, err := normalizeEntityFieldValueForConfig(field.FieldType, field.Value, item.Config); err == nil {
			continue
		}
		field.Value = append([]byte(nil), defaultValue...)
		field.UpdatedTimestamp = item.UpdatedTimestamp
		r.entityFields[fieldKey] = field
	}
	return cloneEntityFieldType(item), nil
}

func (r *MemoryRepo) DeleteEntityFieldType(companyID, entityFieldTypeID string) error {
	companyID, entityFieldTypeID = cleanUUIDText(companyID), cleanUUIDText(entityFieldTypeID)
	if companyID == "" || entityFieldTypeID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	itemKey := key(companyID, entityFieldTypeID)
	item, exists := r.entityFieldTypes[itemKey]
	if !exists {
		return ErrNotFound
	}
	if item.EntityTypeID == ActionItemEntityTypeID && isRequiredActionItemFieldSystemKey(item.SystemKey) {
		return ErrConflict
	}
	for fieldKey, field := range r.entityFields {
		if field.CompanyID == companyID && optionalEntityIDValue(field.EntityFieldTypeID) == entityFieldTypeID {
			field.EntityFieldTypeID = nil
			field.SystemKey = ""
			field.Config = json.RawMessage(`{}`)
			r.entityFields[fieldKey] = field
		}
	}
	delete(r.entityFieldTypes, itemKey)
	return nil
}

func (r *MemoryRepo) ListEntities(ctx context.Context, query EntityListQuery) ([]domain.EntitySummary, error) {
	normalized, err := normalizeEntityListQuery(query)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	needle := strings.ToLower(normalized.Query)
	items := []domain.EntitySummary{}
	for _, item := range r.entities {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if item.CompanyID != normalized.CompanyID || (normalized.EntityTypeID != "" && item.EntityTypeID != normalized.EntityTypeID) {
			continue
		}
		typeItem, exists := r.entityTypes[key(item.CompanyID, item.EntityTypeID)]
		if !exists || (needle != "" && !strings.Contains(strings.ToLower(item.Name), needle) && !strings.Contains(strings.ToLower(typeItem.Name), needle)) {
			continue
		}
		if normalized.EntityFolderID != nil && optionalEntityIDValue(item.EntityFolderID) != *normalized.EntityFolderID {
			continue
		}
		items = append(items, domain.EntitySummary{CompanyID: item.CompanyID, EntityID: item.EntityID, EntityTypeID: item.EntityTypeID, EntityTypeName: typeItem.Name, EntityFolderID: cloneStringPointer(item.EntityFolderID), Name: item.Name, Position: item.Position, Revision: item.Revision, CreatedByUserID: item.CreatedByUserID, CreatedTimestamp: item.CreatedTimestamp, UpdatedTimestamp: item.UpdatedTimestamp})
	}
	sortEntitySummaries(items)
	if normalized.AllForType {
		return items, nil
	}
	if normalized.Offset >= len(items) {
		return []domain.EntitySummary{}, nil
	}
	items = items[normalized.Offset:]
	if len(items) > normalized.Limit {
		items = items[:normalized.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) CreateEntity(input EntityInput) (domain.Entity, error) {
	normalized, err := normalizeEntityInput(input, false)
	if err != nil {
		return domain.Entity{}, err
	}
	if normalized.EntityID == "" {
		normalized.EntityID = newUUIDv7String()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	typeItem, exists := r.entityTypes[key(normalized.CompanyID, normalized.EntityTypeID)]
	if !exists {
		return domain.Entity{}, ErrNotFound
	}
	if _, exists := r.entities[key(normalized.CompanyID, normalized.EntityID)]; exists {
		return domain.Entity{}, ErrAlreadyExists
	}
	if normalized.CreatedByUserID != "" {
		if _, exists := r.memberships[membershipKey(normalized.CompanyID, normalized.CreatedByUserID)]; !exists {
			return domain.Entity{}, ErrPrincipalNotInCompany
		}
	}
	if err := r.validateEntityFolderForTypeLocked(normalized.CompanyID, normalized.EntityTypeID, normalized.EntityFolderID); err != nil {
		return domain.Entity{}, err
	}
	if !normalized.PositionSet {
		normalized.Position = r.nextEntityPositionLocked(normalized.CompanyID, normalized.EntityTypeID, normalized.EntityFolderID)
	}
	resolvedFieldTypes, err := r.resolveEntityFieldTypesLocked(normalized.CompanyID, normalized.EntityTypeID, normalized.EntityFolderID)
	if err != nil {
		return domain.Entity{}, err
	}
	now := time.Now().UTC()
	item := domain.Entity{CompanyID: normalized.CompanyID, EntityID: normalized.EntityID, EntityTypeID: normalized.EntityTypeID, EntityTypeName: typeItem.Name, EntityFolderID: cloneStringPointer(normalized.EntityFolderID), Name: normalized.Name, Position: normalized.Position, BodyJSON: append([]byte(nil), normalized.BodyJSON...), Revision: 0, CreatedByUserID: normalized.CreatedByUserID, CreatedTimestamp: now, UpdatedTimestamp: now}
	r.entities[key(item.CompanyID, item.EntityID)] = item
	for position, fieldType := range resolvedFieldTypes {
		value, err := entityFieldTypeDefaultValue(fieldType.FieldType, fieldType.Config)
		if err != nil {
			delete(r.entities, key(item.CompanyID, item.EntityID))
			return domain.Entity{}, err
		}
		fieldTypeID := fieldType.EntityFieldTypeID
		field := domain.EntityField{CompanyID: item.CompanyID, EntityFieldID: newUUIDv7String(), EntityID: item.EntityID, EntityFieldTypeID: &fieldTypeID, SystemKey: fieldType.SystemKey, Name: fieldType.Name, FieldType: fieldType.FieldType, Config: append([]byte(nil), fieldType.Config...), Value: append([]byte(nil), value...), Position: position, CreatedTimestamp: now, UpdatedTimestamp: now}
		r.entityFields[key(field.CompanyID, field.EntityFieldID)] = field
	}
	return r.entityDetailLocked(item), nil
}

func (r *MemoryRepo) GetEntity(companyID, entityID string) (domain.Entity, error) {
	companyID, entityID = cleanUUIDText(companyID), cleanUUIDText(entityID)
	if companyID == "" || entityID == "" {
		return domain.Entity{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, exists := r.entities[key(companyID, entityID)]
	if !exists {
		return domain.Entity{}, ErrNotFound
	}
	return r.entityDetailLocked(item), nil
}

func (r *MemoryRepo) UpdateEntity(input EntityInput) (domain.Entity, error) {
	normalized, err := normalizeEntityInput(input, true)
	if err != nil {
		return domain.Entity{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	itemKey := key(normalized.CompanyID, normalized.EntityID)
	item, exists := r.entities[itemKey]
	if !exists {
		return domain.Entity{}, ErrNotFound
	}
	if normalized.EntityFolderSet {
		if err := r.validateEntityFolderForTypeLocked(item.CompanyID, item.EntityTypeID, normalized.EntityFolderID); err != nil {
			return domain.Entity{}, err
		}
		item.EntityFolderID = cloneStringPointer(normalized.EntityFolderID)
	}
	if normalized.NameSet {
		item.Name = normalized.Name
	}
	if normalized.PositionSet {
		item.Position = normalized.Position
	}
	if normalized.BodySet {
		if item.Revision != normalized.BaseRevision {
			return domain.Entity{}, ErrVersionConflict
		}
		item.BodyJSON = append([]byte(nil), normalized.BodyJSON...)
		item.Revision++
	}
	item.UpdatedTimestamp = time.Now().UTC()
	r.entities[itemKey] = item
	return r.entityDetailLocked(item), nil
}

func (r *MemoryRepo) DeleteEntity(companyID, entityID string) error {
	companyID, entityID = cleanUUIDText(companyID), cleanUUIDText(entityID)
	if companyID == "" || entityID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	itemKey := key(companyID, entityID)
	item, exists := r.entities[itemKey]
	if !exists {
		return ErrNotFound
	}
	if item.EntityTypeID == ActionItemEntityTypeID {
		return ErrConflict
	}
	for fieldKey, field := range r.entityFields {
		if field.CompanyID == companyID && field.EntityID == entityID {
			delete(r.entityFields, fieldKey)
		}
	}
	for relationshipKey, relationship := range r.entityRelationships {
		if relationship.CompanyID == companyID && relationship.EntityID == entityID {
			delete(r.entityRelationships, relationshipKey)
		}
	}
	delete(r.entities, itemKey)
	return nil
}

func (r *MemoryRepo) CreateEntityField(input EntityFieldInput) (domain.EntityField, error) {
	normalized, err := normalizeEntityFieldInput(input, false)
	if err != nil {
		return domain.EntityField{}, err
	}
	if normalized.EntityFieldID == "" {
		normalized.EntityFieldID = newUUIDv7String()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.entities[key(normalized.CompanyID, normalized.EntityID)]; !exists {
		return domain.EntityField{}, ErrNotFound
	}
	if _, exists := r.entityFields[key(normalized.CompanyID, normalized.EntityFieldID)]; exists {
		return domain.EntityField{}, ErrAlreadyExists
	}
	if r.entityFieldNameExistsLocked(normalized.CompanyID, normalized.EntityID, normalized.Name, "") {
		return domain.EntityField{}, ErrAlreadyExists
	}
	if !normalized.PositionSet {
		normalized.Position = r.nextEntityFieldPositionLocked(normalized.CompanyID, normalized.EntityID)
	}
	now := time.Now().UTC()
	value, err := normalizeEntityFieldValueForConfig(normalized.FieldType, normalized.Value, json.RawMessage(`{}`))
	if err != nil {
		return domain.EntityField{}, err
	}
	if normalized.FieldType == EntityFieldTypePerson && value != nil && !r.entityPersonValueExistsLocked(normalized.CompanyID, value) {
		return domain.EntityField{}, ErrNotFound
	}
	item := domain.EntityField{CompanyID: normalized.CompanyID, EntityFieldID: normalized.EntityFieldID, EntityID: normalized.EntityID, Name: normalized.Name, FieldType: normalized.FieldType, Config: json.RawMessage(`{}`), Value: append([]byte(nil), value...), Position: normalized.Position, CreatedTimestamp: now, UpdatedTimestamp: now}
	r.entityFields[key(item.CompanyID, item.EntityFieldID)] = item
	return cloneEntityField(item), nil
}

func (r *MemoryRepo) UpdateEntityField(input EntityFieldInput) (domain.EntityField, error) {
	normalized, err := normalizeEntityFieldInput(input, true)
	if err != nil {
		return domain.EntityField{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.entities[key(normalized.CompanyID, normalized.EntityID)]; !exists {
		return domain.EntityField{}, ErrNotFound
	}
	itemKey := key(normalized.CompanyID, normalized.EntityFieldID)
	item, exists := r.entityFields[itemKey]
	if !exists || item.EntityID != normalized.EntityID {
		return domain.EntityField{}, ErrNotFound
	}
	if item.FieldType == EntityFieldTypeResource {
		return domain.EntityField{}, ErrConflict
	}
	if isRequiredActionItemFieldTypeID(optionalEntityIDValue(item.EntityFieldTypeID)) && (normalized.NameSet || normalized.FieldTypeSet) {
		return domain.EntityField{}, ErrConflict
	}
	if normalized.NameSet {
		if r.entityFieldNameExistsLocked(normalized.CompanyID, normalized.EntityID, normalized.Name, normalized.EntityFieldID) {
			return domain.EntityField{}, ErrAlreadyExists
		}
		item.Name = normalized.Name
	}
	if normalized.FieldTypeSet && normalized.FieldType != item.FieldType {
		item.EntityFieldTypeID = nil
		item.SystemKey = ""
		item.Config = json.RawMessage(`{}`)
		item.FieldType = normalized.FieldType
		item.Value = nil
	} else if normalized.ValueSet {
		config := item.Config
		if item.EntityFieldTypeID != nil {
			if fieldType, exists := r.entityFieldTypes[key(item.CompanyID, *item.EntityFieldTypeID)]; exists {
				config = fieldType.Config
			}
		}
		value, err := normalizeEntityFieldValueForConfig(item.FieldType, normalized.Value, config)
		if err != nil {
			return domain.EntityField{}, err
		}
		if item.FieldType == EntityFieldTypePerson && value != nil && !r.entityPersonValueExistsLocked(item.CompanyID, value) {
			return domain.EntityField{}, ErrNotFound
		}
		item.Value = value
	}
	if normalized.PositionSet {
		item.Position = normalized.Position
	}
	item.UpdatedTimestamp = time.Now().UTC()
	r.entityFields[itemKey] = item
	return cloneEntityField(item), nil
}

func (r *MemoryRepo) DeleteEntityField(companyID, entityID, entityFieldID string) error {
	companyID, entityID, entityFieldID = cleanUUIDText(companyID), cleanUUIDText(entityID), cleanUUIDText(entityFieldID)
	if companyID == "" || entityID == "" || entityFieldID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	itemKey := key(companyID, entityFieldID)
	item, exists := r.entityFields[itemKey]
	if !exists || item.EntityID != entityID {
		return ErrNotFound
	}
	if isRequiredActionItemFieldTypeID(optionalEntityIDValue(item.EntityFieldTypeID)) {
		return ErrConflict
	}
	delete(r.entityFields, itemKey)
	return nil
}

func (r *MemoryRepo) validateEntityFolderParentLocked(item domain.EntityFolder, parentID *string) error {
	current := parentID
	seen := map[string]bool{}
	for current != nil {
		if *current == item.EntityFolderID || seen[*current] {
			return ErrConflict
		}
		seen[*current] = true
		parent, exists := r.entityFolders[key(item.CompanyID, *current)]
		if !exists || parent.EntityTypeID != item.EntityTypeID {
			return ErrNotFound
		}
		current = parent.ParentEntityFolderID
	}
	return nil
}

func (r *MemoryRepo) validateEntityFolderForTypeLocked(companyID, entityTypeID string, folderID *string) error {
	if folderID == nil {
		return nil
	}
	folder, exists := r.entityFolders[key(companyID, *folderID)]
	if !exists || folder.EntityTypeID != entityTypeID {
		return ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) validateEntityFieldTypeFolderLocked(companyID, entityTypeID string, folderID *string) error {
	return r.validateEntityFolderForTypeLocked(companyID, entityTypeID, folderID)
}

func (r *MemoryRepo) entityFieldTypeNameExistsLocked(companyID, entityTypeID string, folderID *string, name, excludingID string) bool {
	for _, item := range r.entityFieldTypes {
		if item.CompanyID == companyID && item.EntityTypeID == entityTypeID && item.EntityFieldTypeID != excludingID && optionalEntityIDValue(item.EntityFolderID) == optionalEntityIDValue(folderID) && strings.EqualFold(strings.TrimSpace(item.Name), strings.TrimSpace(name)) {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) entityFieldNameExistsLocked(companyID, entityID, name, excludingID string) bool {
	for _, item := range r.entityFields {
		if item.CompanyID == companyID && item.EntityID == entityID && item.EntityFieldID != excludingID && strings.EqualFold(strings.TrimSpace(item.Name), strings.TrimSpace(name)) {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) resolveEntityFieldTypesLocked(companyID, entityTypeID string, folderID *string) ([]domain.EntityFieldType, error) {
	layers := [][]domain.EntityFieldType{r.entityFieldTypesInFolderLocked(companyID, entityTypeID, nil)}
	ancestorIDs := []string{}
	seen := map[string]bool{}
	current := folderID
	for current != nil {
		if seen[*current] {
			return nil, ErrConflict
		}
		seen[*current] = true
		ancestorIDs = append(ancestorIDs, *current)
		folder, exists := r.entityFolders[key(companyID, *current)]
		if !exists || folder.EntityTypeID != entityTypeID {
			return nil, ErrNotFound
		}
		current = folder.ParentEntityFolderID
	}
	for index := len(ancestorIDs) - 1; index >= 0; index-- {
		folder := ancestorIDs[index]
		layers = append(layers, r.entityFieldTypesInFolderLocked(companyID, entityTypeID, &folder))
	}
	return resolveEntityFieldTypeLayers(layers), nil
}

func (r *MemoryRepo) entityFieldTypesInFolderLocked(companyID, entityTypeID string, folderID *string) []domain.EntityFieldType {
	items := []domain.EntityFieldType{}
	for _, item := range r.entityFieldTypes {
		if item.CompanyID == companyID && item.EntityTypeID == entityTypeID && optionalEntityIDValue(item.EntityFolderID) == optionalEntityIDValue(folderID) {
			items = append(items, cloneEntityFieldType(item))
		}
	}
	sortEntityFieldTypes(items)
	return items
}

func (r *MemoryRepo) entityDetailLocked(item domain.Entity) domain.Entity {
	if typeItem, exists := r.entityTypes[key(item.CompanyID, item.EntityTypeID)]; exists {
		item.EntityTypeName = typeItem.Name
	}
	item.EntityFields = []domain.EntityField{}
	for _, field := range r.entityFields {
		if field.CompanyID == item.CompanyID && field.EntityID == item.EntityID {
			if field.EntityFieldTypeID != nil {
				if fieldType, exists := r.entityFieldTypes[key(field.CompanyID, *field.EntityFieldTypeID)]; exists {
					field.SystemKey = fieldType.SystemKey
					field.Config = append([]byte(nil), fieldType.Config...)
				} else {
					field.EntityFieldTypeID = nil
					field.SystemKey = ""
					field.Config = json.RawMessage(`{}`)
				}
			} else if len(field.Config) == 0 {
				field.Config = json.RawMessage(`{}`)
			}
			item.EntityFields = append(item.EntityFields, cloneEntityField(field))
		}
	}
	sortEntityFields(item.EntityFields)
	return cloneEntity(item)
}

func (r *MemoryRepo) entityPersonValueExistsLocked(companyID string, raw json.RawMessage) bool {
	var userID string
	if err := json.Unmarshal(raw, &userID); err != nil {
		return false
	}
	_, exists := r.memberships[membershipKey(companyID, userID)]
	return exists
}

func (r *MemoryRepo) clearEntityMemberReferencesLocked(companyID, userID string) {
	now := time.Now().UTC()
	for fieldKey, field := range r.entityFields {
		if field.CompanyID != companyID || field.FieldType != EntityFieldTypePerson || field.Value == nil {
			continue
		}
		var assignedUserID string
		if json.Unmarshal(field.Value, &assignedUserID) != nil || cleanUUIDText(assignedUserID) != userID {
			continue
		}
		field.Value = nil
		field.UpdatedTimestamp = now
		r.entityFields[fieldKey] = field
	}
	for entityKey, entity := range r.entities {
		if entity.CompanyID == companyID && entity.CreatedByUserID == userID {
			entity.CreatedByUserID = ""
			r.entities[entityKey] = entity
		}
	}
}

func (r *MemoryRepo) nextEntityFolderPositionLocked(companyID, entityTypeID string, parentID *string) int {
	next := 0
	for _, item := range r.entityFolders {
		if item.CompanyID == companyID && item.EntityTypeID == entityTypeID && optionalEntityIDValue(item.ParentEntityFolderID) == optionalEntityIDValue(parentID) && item.Position >= next {
			next = item.Position + 1
		}
	}
	return next
}

func (r *MemoryRepo) nextEntityFieldTypePositionLocked(companyID, entityTypeID string, folderID *string) int {
	next := 0
	for _, item := range r.entityFieldTypes {
		if item.CompanyID == companyID && item.EntityTypeID == entityTypeID && optionalEntityIDValue(item.EntityFolderID) == optionalEntityIDValue(folderID) && item.Position >= next {
			next = item.Position + 1
		}
	}
	return next
}

func (r *MemoryRepo) nextEntityPositionLocked(companyID, entityTypeID string, folderID *string) int {
	next := 0
	for _, item := range r.entities {
		if item.CompanyID == companyID && item.EntityTypeID == entityTypeID && optionalEntityIDValue(item.EntityFolderID) == optionalEntityIDValue(folderID) && item.Position >= next {
			next = item.Position + 1
		}
	}
	return next
}

func (r *MemoryRepo) nextEntityFieldPositionLocked(companyID, entityID string) int {
	next := 0
	for _, item := range r.entityFields {
		if item.CompanyID == companyID && item.EntityID == entityID && item.Position >= next {
			next = item.Position + 1
		}
	}
	return next
}
