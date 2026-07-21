package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func entityFieldKey(companyID, fieldID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(fieldID)
}

func entityFieldAssignmentKey(companyID, resourceType, resourceID, fieldID string) string {
	return strings.Join([]string{strings.TrimSpace(companyID), strings.TrimSpace(resourceType), strings.TrimSpace(resourceID), strings.TrimSpace(fieldID)}, ":")
}

func splitEntityFieldAssignmentKey(value string) (companyID, resourceType, resourceID, fieldID string, ok bool) {
	parts := strings.Split(value, ":")
	if len(parts) != 4 {
		return "", "", "", "", false
	}
	return parts[0], parts[1], parts[2], parts[3], true
}

func (r *MemoryRepo) ListEntityFields(companyID string) ([]domain.EntityField, error) {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]domain.EntityField, 0)
	for _, field := range r.entityFields {
		if field.CompanyID != companyID {
			continue
		}
		field.AssignmentCount = r.entityFieldAssignmentCountLocked(companyID, field.FieldID)
		items = append(items, field)
	}
	sortEntityFields(items)
	return items, nil
}

func (r *MemoryRepo) CreateEntityField(input EntityFieldInput) (domain.EntityField, error) {
	normalized, err := NormalizeEntityFieldInput(input, false)
	if err != nil {
		return domain.EntityField{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, field := range r.entityFields {
		if field.CompanyID == normalized.CompanyID && strings.EqualFold(strings.TrimSpace(field.Name), normalized.Name) {
			return domain.EntityField{}, ErrAlreadyExists
		}
	}
	if normalized.FieldID == "" {
		normalized.FieldID = newUUIDv7String()
	}
	if _, exists := r.entityFields[entityFieldKey(normalized.CompanyID, normalized.FieldID)]; exists {
		return domain.EntityField{}, ErrAlreadyExists
	}
	if !normalized.PositionSet {
		normalized.Position = r.nextEntityFieldPositionLocked(normalized.CompanyID)
	}
	now := time.Now().UTC()
	item := domain.EntityField{
		CompanyID: normalized.CompanyID, FieldID: normalized.FieldID, Name: normalized.Name,
		Color: normalized.Color, Position: normalized.Position, CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	r.entityFields[entityFieldKey(item.CompanyID, item.FieldID)] = item
	return item, nil
}

func (r *MemoryRepo) UpdateEntityField(input EntityFieldInput) (domain.EntityField, error) {
	normalized, err := NormalizeEntityFieldInput(input, true)
	if err != nil {
		return domain.EntityField{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	keyValue := entityFieldKey(normalized.CompanyID, normalized.FieldID)
	item, exists := r.entityFields[keyValue]
	if !exists {
		return domain.EntityField{}, ErrNotFound
	}
	for _, field := range r.entityFields {
		if field.CompanyID == normalized.CompanyID && field.FieldID != normalized.FieldID && strings.EqualFold(strings.TrimSpace(field.Name), normalized.Name) {
			return domain.EntityField{}, ErrAlreadyExists
		}
	}
	item.Name = normalized.Name
	item.Color = normalized.Color
	if normalized.PositionSet {
		item.Position = normalized.Position
	}
	item.UpdatedTimestamp = time.Now().UTC()
	item.AssignmentCount = r.entityFieldAssignmentCountLocked(item.CompanyID, item.FieldID)
	r.entityFields[keyValue] = item
	return item, nil
}

func (r *MemoryRepo) DeleteEntityField(companyID, fieldID, actorUserID string) error {
	companyID = cleanUUIDText(companyID)
	fieldID = cleanUUIDText(fieldID)
	if companyID == "" || fieldID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	keyValue := entityFieldKey(companyID, fieldID)
	if _, exists := r.entityFields[keyValue]; !exists {
		return ErrNotFound
	}
	delete(r.entityFields, keyValue)
	for assignmentKey := range r.entityFieldAssignments {
		assignmentCompanyID, _, _, assignmentFieldID, ok := splitEntityFieldAssignmentKey(assignmentKey)
		if ok && assignmentCompanyID == companyID && assignmentFieldID == fieldID {
			delete(r.entityFieldAssignments, assignmentKey)
		}
	}
	_ = actorUserID
	return nil
}

func (r *MemoryRepo) SetEntityFieldAssignments(input EntityFieldAssignmentInput) ([]domain.EntityField, error) {
	normalized, err := NormalizeEntityFieldAssignmentInput(input)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.entityFieldResourceExistsLocked(normalized.CompanyID, normalized.ResourceType, normalized.ResourceID) {
		return nil, ErrNotFound
	}
	for _, fieldID := range normalized.FieldIDs {
		if _, exists := r.entityFields[entityFieldKey(normalized.CompanyID, fieldID)]; !exists {
			return nil, ErrNotFound
		}
	}
	r.deleteEntityFieldAssignmentsForResourceLocked(normalized.CompanyID, normalized.ResourceType, normalized.ResourceID)
	for _, fieldID := range normalized.FieldIDs {
		r.entityFieldAssignments[entityFieldAssignmentKey(normalized.CompanyID, normalized.ResourceType, normalized.ResourceID, fieldID)] = true
	}
	return r.entityFieldsForResourceLocked(normalized.CompanyID, normalized.ResourceType, normalized.ResourceID), nil
}

func (r *MemoryRepo) entityFieldsForResourceLocked(companyID, resourceType, resourceID string) []domain.EntityField {
	items := make([]domain.EntityField, 0)
	for assignmentKey := range r.entityFieldAssignments {
		assignmentCompanyID, assignmentResourceType, assignmentResourceID, fieldID, ok := splitEntityFieldAssignmentKey(assignmentKey)
		if !ok || assignmentCompanyID != companyID || assignmentResourceType != resourceType || assignmentResourceID != resourceID {
			continue
		}
		if field, exists := r.entityFields[entityFieldKey(companyID, fieldID)]; exists {
			items = append(items, field)
		}
	}
	sortEntityFields(items)
	return cloneEntityFields(items)
}

func (r *MemoryRepo) deleteEntityFieldAssignmentsForResourceLocked(companyID, resourceType, resourceID string) {
	for assignmentKey := range r.entityFieldAssignments {
		assignmentCompanyID, assignmentResourceType, assignmentResourceID, _, ok := splitEntityFieldAssignmentKey(assignmentKey)
		if ok && assignmentCompanyID == companyID && assignmentResourceType == resourceType && assignmentResourceID == resourceID {
			delete(r.entityFieldAssignments, assignmentKey)
		}
	}
}

func (r *MemoryRepo) entityFieldResourceExistsLocked(companyID, resourceType, resourceID string) bool {
	switch resourceType {
	case EntityTypeProject:
		_, exists := r.projects[key(companyID, resourceID)]
		return exists
	case EntityTypeNode:
		_, exists := r.nodes[key(companyID, resourceID)]
		return exists
	case EntityTypeLogicGate:
		_, exists := r.logicGates[key(companyID, resourceID)]
		return exists
	default:
		return false
	}
}

func (r *MemoryRepo) entityFieldAssignmentCountLocked(companyID, fieldID string) int {
	count := 0
	for assignmentKey := range r.entityFieldAssignments {
		assignmentCompanyID, _, _, assignmentFieldID, ok := splitEntityFieldAssignmentKey(assignmentKey)
		if ok && assignmentCompanyID == companyID && assignmentFieldID == fieldID {
			count++
		}
	}
	return count
}

func (r *MemoryRepo) nextEntityFieldPositionLocked(companyID string) int {
	next := 0
	for _, field := range r.entityFields {
		if field.CompanyID == companyID && field.Position >= next {
			next = field.Position + 1
		}
	}
	return next
}
