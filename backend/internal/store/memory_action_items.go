package store

import (
	"sort"
	"time"

	"miraeopus/backend/internal/domain"
)

func (r *MemoryRepo) ensureActionItemDefaultsLocked(companyID string) error {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return ErrInvalid
	}
	now := time.Now().UTC()
	typeKey := key(companyID, ActionItemEntityTypeID)
	if current, exists := r.entityTypes[typeKey]; exists {
		if current.SystemKey != ActionItemEntityTypeSystemKey || current.Name != "Action Item" {
			return ErrConflict
		}
	} else {
		for _, current := range r.entityTypes {
			if current.CompanyID == companyID && (current.SystemKey == ActionItemEntityTypeSystemKey || current.Name == "Action Item") {
				return ErrConflict
			}
		}
		r.entityTypes[typeKey] = domain.EntityType{CompanyID: companyID, EntityTypeID: ActionItemEntityTypeID, SystemKey: ActionItemEntityTypeSystemKey, Name: "Action Item", CreatedTimestamp: now, UpdatedTimestamp: now}
	}
	for _, required := range actionItemFieldTypes(companyID) {
		fieldKey := key(companyID, required.EntityFieldTypeID)
		if current, exists := r.entityFieldTypes[fieldKey]; exists {
			if current.EntityTypeID != required.EntityTypeID || current.EntityFolderID != nil || current.SystemKey != required.SystemKey || current.Name != required.Name || current.FieldType != required.FieldType {
				return ErrConflict
			}
			continue
		}
		for _, current := range r.entityFieldTypes {
			if current.CompanyID == companyID && current.EntityTypeID == ActionItemEntityTypeID && (current.SystemKey == required.SystemKey || current.Name == required.Name) {
				return ErrConflict
			}
		}
		required.CreatedTimestamp = now
		required.UpdatedTimestamp = now
		r.entityFieldTypes[fieldKey] = cloneEntityFieldType(required)
	}
	return r.verifyActionItemDefaultsLocked(companyID)
}

func (r *MemoryRepo) verifyActionItemDefaultsLocked(companyID string) error {
	currentType, exists := r.entityTypes[key(companyID, ActionItemEntityTypeID)]
	if !exists || currentType.SystemKey != ActionItemEntityTypeSystemKey || currentType.Name != "Action Item" {
		return ErrConflict
	}
	for _, required := range actionItemFieldTypes(companyID) {
		current, exists := r.entityFieldTypes[key(companyID, required.EntityFieldTypeID)]
		if !exists || current.EntityTypeID != ActionItemEntityTypeID || current.EntityFolderID != nil || current.SystemKey != required.SystemKey || current.Name != required.Name || current.FieldType != required.FieldType {
			return ErrConflict
		}
		if err := validateRequiredActionItemFieldConfig(current.SystemKey, current.FieldType, current.Config); err != nil {
			return ErrConflict
		}
	}
	return nil
}

func (r *MemoryRepo) CreateActionItem(input ActionItemInput) (domain.Entity, error) {
	normalized, err := normalizeActionItemInput(input)
	if err != nil {
		return domain.Entity{}, err
	}
	bodyJSON, err := actionItemBodyJSON(normalized.BodyText)
	if err != nil {
		return domain.Entity{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.companies[normalized.CompanyID]; !exists {
		return domain.Entity{}, ErrNotFound
	}
	if _, exists := r.memberships[membershipKey(normalized.CompanyID, normalized.CreatedByUserID)]; !exists {
		return domain.Entity{}, ErrPrincipalNotInCompany
	}
	if err := r.verifyActionItemDefaultsLocked(normalized.CompanyID); err != nil {
		return domain.Entity{}, err
	}
	var huddleLogicGateID string
	if normalized.HuddleNodeID != "" {
		node, exists := r.huddleNodes[key(normalized.CompanyID, normalized.HuddleNodeID)]
		if !exists {
			return domain.Entity{}, ErrNotFound
		}
		huddleLogicGateID = node.HuddleLogicGateID
	}
	now := time.Now().UTC()
	entity := domain.Entity{
		CompanyID: normalized.CompanyID, EntityID: newUUIDv7String(), EntityTypeID: ActionItemEntityTypeID,
		EntityTypeName: "Action Item", Name: normalized.Name, Position: r.nextEntityPositionLocked(normalized.CompanyID, ActionItemEntityTypeID, nil),
		BodyJSON: append([]byte(nil), bodyJSON...), CreatedByUserID: normalized.CreatedByUserID, CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	fields := actionItemFieldTypes(normalized.CompanyID)
	for _, template := range fields {
		current, exists := r.entityFieldTypes[key(normalized.CompanyID, template.EntityFieldTypeID)]
		if !exists || current.SystemKey != template.SystemKey {
			return domain.Entity{}, ErrConflict
		}
		value := actionItemInitialFieldValue(template.SystemKey, normalized.Color)
		if template.SystemKey == ActionItemStatusSystemKey {
			value, err = entityFieldTypeDefaultValue(current.FieldType, current.Config)
		}
		if err != nil {
			return domain.Entity{}, err
		}
		value, err = normalizeEntityFieldValueForConfig(template.FieldType, value, current.Config)
		if err != nil {
			return domain.Entity{}, err
		}
		fieldTypeID := current.EntityFieldTypeID
		field := domain.EntityField{
			CompanyID: normalized.CompanyID, EntityFieldID: newUUIDv7String(), EntityID: entity.EntityID,
			EntityFieldTypeID: &fieldTypeID, SystemKey: current.SystemKey, Name: current.Name, FieldType: current.FieldType,
			Config: append([]byte(nil), current.Config...), Value: append([]byte(nil), value...), Position: current.Position,
			CreatedTimestamp: now, UpdatedTimestamp: now,
		}
		entity.EntityFields = append(entity.EntityFields, field)
	}
	r.entities[key(entity.CompanyID, entity.EntityID)] = entity
	for _, field := range entity.EntityFields {
		r.entityFields[key(field.CompanyID, field.EntityFieldID)] = field
	}
	if huddleLogicGateID != "" {
		relationship := domain.ActionItemHuddleRelationship{CompanyID: entity.CompanyID, EntityID: entity.EntityID, HuddleLogicGateID: huddleLogicGateID, CreatedTimestamp: now}
		r.actionItemHuddleRelationships[actionItemHuddleRelationshipKey(entity.CompanyID, entity.EntityID)] = relationship
	}
	return r.entityDetailLocked(entity), nil
}

func (r *MemoryRepo) ListHuddleNodeActionItems(companyID, huddleNodeID string) ([]domain.Entity, error) {
	companyID, huddleNodeID = cleanUUIDText(companyID), cleanUUIDText(huddleNodeID)
	if companyID == "" || huddleNodeID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	node, exists := r.huddleNodes[key(companyID, huddleNodeID)]
	if !exists {
		return nil, ErrNotFound
	}
	seen := map[string]bool{}
	items := []domain.Entity{}
	for _, relationship := range r.actionItemHuddleRelationships {
		if relationship.CompanyID != companyID || relationship.HuddleLogicGateID != node.HuddleLogicGateID || seen[relationship.EntityID] {
			continue
		}
		entity, exists := r.entities[key(companyID, relationship.EntityID)]
		if !exists || entity.EntityTypeID != ActionItemEntityTypeID {
			continue
		}
		seen[relationship.EntityID] = true
		items = append(items, r.entityDetailLocked(entity))
	}
	sortActionItems(items)
	return items, nil
}

func sortActionItems(items []domain.Entity) {
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].EntityID < items[j].EntityID
	})
}
