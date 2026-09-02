package store

import (
	"encoding/json"
	"sort"
	"strings"
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
	if normalized.SourceResourceType != "" && !r.actionItemSourceResourceExistsLocked(
		normalized.CompanyID,
		normalized.SourceResourceType,
		normalized.SourceResourceID,
	) {
		return domain.Entity{}, ErrNotFound
	}
	if normalized.SourceResourceType != "" {
		accessType, accessID := normalized.SourceResourceType, normalized.SourceResourceID
		if normalized.SourceResourceType == EntityTypeKPI {
			accessType = EntityTypeLogicGate
			accessID = r.kpis[key(normalized.CompanyID, normalized.SourceResourceID)].LogicGateID
		}
		if !r.userHasEffectiveAccessLocked(normalized.CompanyID, normalized.CreatedByUserID, accessType, accessID, EntityPermissionEdit) {
			return domain.Entity{}, ErrNotFound
		}
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
		if template.SystemKey == ActionItemAnalysisDueDateSystemKey {
			value = actionItemDateValue(normalized.AnalysisDueDate)
		}
		if template.SystemKey == ActionItemCompletionDueDateSystemKey {
			value = actionItemDateValue(normalized.CompletionDueDate)
		}
		if template.SystemKey == ActionItemSourceSystemKey {
			value = actionItemSourceValue(normalized.SourceResourceType, normalized.SourceResourceID)
		}
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
	boardIDs := r.memoryHuddleActionItemBoardIDsLocked(entity.CompanyID, entity.EntityID)
	nodeIDs := r.memoryHuddleNodeIDsForBoardSetLocked(entity.CompanyID, stringSet(boardIDs))
	if err := r.enqueueHuddleActionItemsRealtimeLocked(entity.CompanyID, boardIDs, nodeIDs); err != nil {
		delete(r.entities, key(entity.CompanyID, entity.EntityID))
		for _, field := range entity.EntityFields {
			delete(r.entityFields, key(field.CompanyID, field.EntityFieldID))
		}
		return domain.Entity{}, err
	}
	return r.entityDetailLocked(entity), nil
}

func (r *MemoryRepo) GetActionItemSource(companyID, entityID string) (domain.ActionItemSource, error) {
	companyID, entityID = cleanUUIDText(companyID), cleanUUIDText(entityID)
	if companyID == "" || entityID == "" {
		return domain.ActionItemSource{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, field := range r.entityFields {
		if field.CompanyID != companyID || field.EntityID != entityID || optionalEntityIDValue(field.EntityFieldTypeID) != ActionItemSourceFieldTypeID {
			continue
		}
		resourceType, resourceID, ok := decodeActionItemSourceValue(field.Value)
		if !ok {
			return domain.ActionItemSource{}, ErrNotFound
		}
		return domain.ActionItemSource{
			CompanyID: companyID, EntityID: entityID, ResourceType: resourceType,
			ResourceID: resourceID, CreatedTimestamp: field.CreatedTimestamp,
		}, nil
	}
	return domain.ActionItemSource{}, ErrNotFound
}

func (r *MemoryRepo) ListVisibleActionItemSources(companyID, viewerUserID string, entityIDs []string) (map[string]domain.ActionItemSourceView, error) {
	companyID, viewerUserID = cleanUUIDText(companyID), cleanUUIDText(viewerUserID)
	if companyID == "" || viewerUserID == "" {
		return nil, ErrInvalid
	}
	entityIDs = cleanUUIDTextSlice(entityIDs)
	visible := make(map[string]domain.ActionItemSourceView)
	if len(entityIDs) == 0 {
		return visible, nil
	}
	wanted := make(map[string]bool, len(entityIDs))
	for _, entityID := range entityIDs {
		wanted[entityID] = true
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	for _, field := range r.entityFields {
		if field.CompanyID != companyID || !wanted[field.EntityID] || optionalEntityIDValue(field.EntityFieldTypeID) != ActionItemSourceFieldTypeID {
			continue
		}
		resourceType, resourceID, ok := decodeActionItemSourceValue(field.Value)
		if !ok {
			continue
		}
		source, _ := r.memoryMyWorkActionItemContextLocked(companyID, viewerUserID, resourceType, resourceID)
		if source != nil {
			visible[field.EntityID] = *source
		}
	}
	return visible, nil
}

func (r *MemoryRepo) actionItemSourceResourceExistsLocked(companyID, resourceType, resourceID string) bool {
	resourceKey := key(companyID, resourceID)
	switch resourceType {
	case EntityTypeNode:
		_, exists := r.nodes[resourceKey]
		return exists
	case EntityTypeLogicGate:
		_, exists := r.logicGates[resourceKey]
		return exists
	case EntityTypeProject:
		_, exists := r.projects[resourceKey]
		return exists
	case EntityTypeHuddleNode:
		_, exists := r.huddleNodes[resourceKey]
		return exists
	case EntityTypeHuddleLogicGate:
		_, exists := r.huddleLogicGates[resourceKey]
		return exists
	case EntityTypeKPI:
		_, exists := r.kpis[resourceKey]
		return exists
	default:
		return false
	}
}

func (r *MemoryRepo) clearEntityResourceFieldsForResourceLocked(companyID, resourceType, resourceID string) {
	for fieldKey, field := range r.entityFields {
		if field.CompanyID != companyID || field.FieldType != EntityFieldTypeResource {
			continue
		}
		currentType, currentID, ok := decodeActionItemSourceValue(field.Value)
		if ok && currentType == resourceType && currentID == resourceID {
			field.Value = nil
			field.UpdatedTimestamp = time.Now().UTC()
			r.entityFields[fieldKey] = field
		}
	}
}

func (r *MemoryRepo) clearEntityResourceFieldsForMissingResourceLocked(companyID, resourceType, resourceID string) {
	if r.actionItemSourceResourceExistsLocked(companyID, resourceType, resourceID) {
		return
	}
	r.clearEntityResourceFieldsForResourceLocked(companyID, resourceType, resourceID)
}

func (r *MemoryRepo) syncHuddleActionItemRelationshipsLocked(companyID, resourceType, resourceID string) error {
	if resourceType != EntityTypeHuddleNode && resourceType != EntityTypeHuddleLogicGate {
		return nil
	}
	changed := false
	documents := make([]json.RawMessage, 0)
	for _, document := range r.editorJSONDocuments {
		if document.Deleted || document.Ref.CompanyID != companyID || document.Ref.ResourceType != resourceType || document.Ref.ResourceID != resourceID {
			continue
		}
		documents = append(documents, document.JSONDocument)
	}
	desiredIDs := entityReferenceIDsFromEditorDocuments(documents)
	if resourceType == EntityTypeHuddleNode {
		chatLinks := []json.RawMessage{}
		for _, chat := range r.huddleNodeTextboxChats[key(companyID, resourceID)] {
			ref := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, DocumentID: chat.TextboxID}
			if r.editorJSONDocuments[editorJSONMemoryKey(ref)].Deleted {
				continue
			}
			chatLinks = append(chatLinks, chat.EntityLinks)
		}
		desiredIDs = append(desiredIDs, entityReferenceIDsFromChatLinks(chatLinks)...)
	}
	desired := make(map[string]bool, len(desiredIDs))
	for _, entityID := range desiredIDs {
		entity, exists := r.entities[key(companyID, entityID)]
		if exists && entity.EntityTypeID == ActionItemEntityTypeID {
			desired[entityID] = true
		}
	}
	for relationshipKey, relationship := range r.entityRelationships {
		if relationship.CompanyID != companyID || relationship.ResourceType != resourceType || relationship.ResourceID != resourceID || desired[relationship.EntityID] {
			continue
		}
		entity, exists := r.entities[key(companyID, relationship.EntityID)]
		if exists && entity.EntityTypeID == ActionItemEntityTypeID {
			delete(r.entityRelationships, relationshipKey)
			changed = true
		}
	}
	now := time.Now().UTC()
	for entityID := range desired {
		relationshipKey := entityRelationshipKey(companyID, entityID, resourceType, resourceID)
		if _, exists := r.entityRelationships[relationshipKey]; exists {
			continue
		}
		r.entityRelationships[relationshipKey] = domain.EntityRelationship{
			CompanyID: companyID, EntityID: entityID,
			ResourceType: resourceType, ResourceID: resourceID, CreatedTimestamp: now,
		}
		changed = true
	}
	if changed {
		boardIDs := r.memoryHuddleActionItemBoardIDsForResourceLocked(companyID, resourceType, resourceID)
		nodeIDs := r.memoryHuddleNodeIDsForBoardSetLocked(companyID, stringSet(boardIDs))
		return r.enqueueHuddleActionItemsRealtimeLocked(companyID, boardIDs, nodeIDs)
	}
	return nil
}

func (r *MemoryRepo) ListHuddleNodeCreatedActionItems(companyID, huddleNodeID string) ([]domain.Entity, error) {
	companyID, huddleNodeID = cleanUUIDText(companyID), cleanUUIDText(huddleNodeID)
	if companyID == "" || huddleNodeID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, exists := r.huddleNodes[key(companyID, huddleNodeID)]; !exists {
		return nil, ErrNotFound
	}
	items := []domain.Entity{}
	for _, entity := range r.entities {
		if entity.CompanyID != companyID || entity.EntityTypeID != ActionItemEntityTypeID {
			continue
		}
		fields := r.memoryActionItemFieldsLocked(companyID, entity.EntityID)
		if fields.sourceResourceType == EntityTypeHuddleNode && fields.sourceResourceID == huddleNodeID {
			items = append(items, r.entityDetailLocked(entity))
		}
	}
	sortActionItems(items)
	return items, nil
}

func (r *MemoryRepo) ListHuddleNodeDueActionItems(companyID, huddleNodeID, viewingDate string) ([]domain.Entity, error) {
	companyID, huddleNodeID = cleanUUIDText(companyID), cleanUUIDText(huddleNodeID)
	viewingDate, err := normalizeHuddleDate(viewingDate)
	if companyID == "" || huddleNodeID == "" || err != nil {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	node, exists := r.huddleNodes[key(companyID, huddleNodeID)]
	if !exists {
		return nil, ErrNotFound
	}
	items := r.listHuddleLogicGateActionItemsLocked(companyID, node.HuddleLogicGateID)
	filtered := items[:0]
	for _, item := range items {
		fields := r.memoryActionItemFieldsLocked(companyID, item.EntityID)
		if fields.sourceResourceType == EntityTypeHuddleNode && fields.sourceResourceID == huddleNodeID {
			continue
		}
		if fields.completionDueDate == "" || fields.completionDueDate > viewingDate || myWorkStatusDone(fields.status) {
			continue
		}
		filtered = append(filtered, item)
	}
	sortHuddleDueActionItems(filtered)
	return filtered, nil
}

func (r *MemoryRepo) ListHuddleLogicGateActionItems(companyID, huddleLogicGateID string) ([]domain.Entity, error) {
	companyID, huddleLogicGateID = cleanUUIDText(companyID), cleanUUIDText(huddleLogicGateID)
	if companyID == "" || huddleLogicGateID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, exists := r.huddleLogicGates[key(companyID, huddleLogicGateID)]; !exists {
		return nil, ErrNotFound
	}
	return r.listHuddleLogicGateActionItemsLocked(companyID, huddleLogicGateID), nil
}

func (r *MemoryRepo) listHuddleLogicGateActionItemsLocked(companyID, huddleLogicGateID string) []domain.Entity {
	seen := map[string]bool{}
	items := []domain.Entity{}
	for _, relationship := range r.entityRelationships {
		if relationship.CompanyID != companyID || seen[relationship.EntityID] {
			continue
		}
		belongsToProcess := relationship.ResourceType == EntityTypeHuddleLogicGate && relationship.ResourceID == huddleLogicGateID
		if relationship.ResourceType == EntityTypeHuddleNode {
			linkedNode, exists := r.huddleNodes[key(companyID, relationship.ResourceID)]
			belongsToProcess = exists && linkedNode.HuddleLogicGateID == huddleLogicGateID
		}
		if !belongsToProcess {
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
	return items
}

func sortActionItems(items []domain.Entity) {
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].EntityID < items[j].EntityID
	})
}

func actionItemFieldText(item domain.Entity, systemKey string) string {
	for _, field := range item.EntityFields {
		if field.SystemKey == systemKey {
			return strings.TrimSpace(myWorkJSONText(field.Value))
		}
	}
	return ""
}

func actionItemSourceMatches(item domain.Entity, resourceType, resourceID string) bool {
	for _, field := range item.EntityFields {
		if field.SystemKey != ActionItemSourceSystemKey {
			continue
		}
		currentType, currentID, ok := decodeActionItemSourceValue(field.Value)
		return ok && currentType == resourceType && currentID == resourceID
	}
	return false
}

func sortHuddleDueActionItems(items []domain.Entity) {
	sort.Slice(items, func(i, j int) bool {
		left := actionItemFieldText(items[i], ActionItemCompletionDueDateSystemKey)
		right := actionItemFieldText(items[j], ActionItemCompletionDueDateSystemKey)
		if left != right {
			return left < right
		}
		return items[i].EntityID < items[j].EntityID
	})
}
