package store

import (
	"bytes"
	"encoding/json"
	"sort"
	"strings"
	"unicode/utf8"

	"miraeopus/backend/internal/domain"
)

const (
	ActionItemEntityTypeSystemKey = "action_item"
	ActionItemEntityTypeID        = "a17e0000-0000-4000-8000-000000000001"

	ActionItemPersonInChargeSystemKey    = "person_in_charge"
	ActionItemAssignedBySystemKey        = "assigned_by"
	ActionItemAnalysisDueDateSystemKey   = "analysis_due_date"
	ActionItemCompletionDueDateSystemKey = "completion_due_date"
	ActionItemStatusSystemKey            = "status"
	ActionItemColorSystemKey             = "color"
	ActionItemSourceSystemKey            = "source"

	ActionItemPersonInChargeFieldTypeID    = "a17e0000-0000-4000-8000-000000000101"
	ActionItemAssignedByFieldTypeID        = "a17e0000-0000-4000-8000-000000000106"
	ActionItemAnalysisDueDateFieldTypeID   = "a17e0000-0000-4000-8000-000000000102"
	ActionItemCompletionDueDateFieldTypeID = "a17e0000-0000-4000-8000-000000000103"
	ActionItemStatusFieldTypeID            = "a17e0000-0000-4000-8000-000000000104"
	ActionItemColorFieldTypeID             = "a17e0000-0000-4000-8000-000000000105"
	ActionItemSourceFieldTypeID            = "a17e0000-0000-4000-8000-000000000107"

	ActionItemStatusInProgress = "in_progress"
	ActionItemColorYellow      = "yellow"
	ActionItemColorRed         = "red"
)

var (
	actionItemStatusConfig = json.RawMessage(`{"default":"in_progress","options":[{"key":"in_progress","label":"In progress"},{"key":"pending","label":"Pending"},{"key":"done","label":"Done"}]}`)
	actionItemColorConfig  = json.RawMessage(`{"default":null,"options":[{"key":"yellow","label":"Yellow","color":"#facc15"},{"key":"red","label":"Red","color":"#ef4444"}]}`)
)

type ActionItemInput struct {
	CompanyID          string
	Name               string
	BodyText           string
	Color              *string
	CreatedByUserID    string
	SourceResourceType string
	SourceResourceID   string
	AnalysisDueDate    string
	CompletionDueDate  string
}

func normalizeActionItemInput(input ActionItemInput) (ActionItemInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.CreatedByUserID = cleanUUIDText(input.CreatedByUserID)
	input.SourceResourceType = strings.ToLower(strings.TrimSpace(input.SourceResourceType))
	input.SourceResourceID = cleanUUIDText(input.SourceResourceID)
	input.BodyText = strings.TrimSpace(input.BodyText)
	input.Name = strings.TrimSpace(input.Name)
	input.AnalysisDueDate = strings.TrimSpace(input.AnalysisDueDate)
	input.CompletionDueDate = strings.TrimSpace(input.CompletionDueDate)
	if input.CompanyID == "" || input.CreatedByUserID == "" || input.BodyText == "" || utf8.RuneCountInString(input.Name) > EntityNameMaxLength {
		return ActionItemInput{}, ErrInvalid
	}
	if (input.SourceResourceType == "") != (input.SourceResourceID == "") {
		return ActionItemInput{}, ErrInvalid
	}
	if input.SourceResourceType != "" {
		var ok bool
		input.SourceResourceType, ok = NormalizeActionItemSourceResourceType(input.SourceResourceType)
		if !ok {
			return ActionItemInput{}, ErrInvalid
		}
	}
	if input.Name == "" {
		input.Name = deriveActionItemName(input.BodyText)
	}
	if input.Color != nil {
		color := strings.ToLower(strings.TrimSpace(*input.Color))
		if color != ActionItemColorYellow && color != ActionItemColorRed {
			return ActionItemInput{}, ErrInvalid
		}
		input.Color = &color
	}
	if err := validateActionItemDueDates(input.AnalysisDueDate, input.CompletionDueDate); err != nil {
		return ActionItemInput{}, err
	}
	return input, nil
}

func actionItemDateValue(date string) json.RawMessage {
	if date == "" {
		return nil
	}
	value, _ := json.Marshal(date)
	return value
}

func validateActionItemDueDates(analysis, completion string) error {
	for _, date := range []string{analysis, completion} {
		if _, err := normalizeEntityFieldValue(EntityFieldTypeDate, actionItemDateValue(date)); err != nil {
			return err
		}
	}
	return nil
}

func deriveActionItemName(bodyText string) string {
	name := strings.TrimSpace(strings.SplitN(bodyText, "\n", 2)[0])
	if utf8.RuneCountInString(name) <= EntityNameMaxLength {
		return name
	}
	runes := []rune(name)
	return strings.TrimSpace(string(runes[:EntityNameMaxLength]))
}

func actionItemBodyJSON(bodyText string) (json.RawMessage, error) {
	paragraphs := make([]map[string]any, 0)
	for _, line := range strings.Split(bodyText, "\n") {
		paragraph := map[string]any{"type": "paragraph"}
		if line != "" {
			paragraph["content"] = []map[string]any{{"type": "text", "text": line}}
		}
		paragraphs = append(paragraphs, paragraph)
	}
	document, err := json.Marshal(map[string]any{
		"format": MangoTiptapFormat, "schema_version": MangoTiptapSchemaVersion,
		"document": map[string]any{"type": "doc", "content": paragraphs},
	})
	if err != nil {
		return nil, err
	}
	return encodeEditorTextboxBody(document, []EditorJSONAnnotation{})
}

func actionItemFieldTypes(companyID string) []domain.EntityFieldType {
	return []domain.EntityFieldType{
		{CompanyID: companyID, EntityFieldTypeID: ActionItemPersonInChargeFieldTypeID, EntityTypeID: ActionItemEntityTypeID, SystemKey: ActionItemPersonInChargeSystemKey, Name: "Person in charge", FieldType: EntityFieldTypePerson, Config: json.RawMessage(`{}`), Position: 0},
		{CompanyID: companyID, EntityFieldTypeID: ActionItemAssignedByFieldTypeID, EntityTypeID: ActionItemEntityTypeID, SystemKey: ActionItemAssignedBySystemKey, Name: "Assigned by", FieldType: EntityFieldTypePerson, Config: json.RawMessage(`{}`), Position: 1},
		{CompanyID: companyID, EntityFieldTypeID: ActionItemAnalysisDueDateFieldTypeID, EntityTypeID: ActionItemEntityTypeID, SystemKey: ActionItemAnalysisDueDateSystemKey, Name: "Analysis due date", FieldType: EntityFieldTypeDate, Config: json.RawMessage(`{}`), Position: 2},
		{CompanyID: companyID, EntityFieldTypeID: ActionItemCompletionDueDateFieldTypeID, EntityTypeID: ActionItemEntityTypeID, SystemKey: ActionItemCompletionDueDateSystemKey, Name: "Completion due date", FieldType: EntityFieldTypeDate, Config: json.RawMessage(`{}`), Position: 3},
		{CompanyID: companyID, EntityFieldTypeID: ActionItemStatusFieldTypeID, EntityTypeID: ActionItemEntityTypeID, SystemKey: ActionItemStatusSystemKey, Name: "Status", FieldType: EntityFieldTypeChoice, Config: append(json.RawMessage(nil), actionItemStatusConfig...), Position: 4},
		{CompanyID: companyID, EntityFieldTypeID: ActionItemColorFieldTypeID, EntityTypeID: ActionItemEntityTypeID, SystemKey: ActionItemColorSystemKey, Name: "Color", FieldType: EntityFieldTypeColor, Config: append(json.RawMessage(nil), actionItemColorConfig...), Position: 5},
		{CompanyID: companyID, EntityFieldTypeID: ActionItemSourceFieldTypeID, EntityTypeID: ActionItemEntityTypeID, SystemKey: ActionItemSourceSystemKey, Name: "Source", FieldType: EntityFieldTypeResource, Config: json.RawMessage(`{}`), Position: 6},
	}
}

func isRequiredActionItemFieldSystemKey(systemKey string) bool {
	switch strings.TrimSpace(systemKey) {
	case ActionItemPersonInChargeSystemKey, ActionItemAssignedBySystemKey, ActionItemAnalysisDueDateSystemKey, ActionItemCompletionDueDateSystemKey, ActionItemStatusSystemKey, ActionItemColorSystemKey, ActionItemSourceSystemKey:
		return true
	default:
		return false
	}
}

func isRequiredActionItemFieldTypeID(entityFieldTypeID string) bool {
	switch strings.TrimSpace(entityFieldTypeID) {
	case ActionItemPersonInChargeFieldTypeID, ActionItemAssignedByFieldTypeID, ActionItemAnalysisDueDateFieldTypeID, ActionItemCompletionDueDateFieldTypeID, ActionItemStatusFieldTypeID, ActionItemColorFieldTypeID, ActionItemSourceFieldTypeID:
		return true
	default:
		return false
	}
}

func NormalizeActionItemSourceResourceType(resourceType string) (string, bool) {
	resourceType = strings.ToLower(strings.TrimSpace(resourceType))
	switch resourceType {
	case EntityTypeNode, EntityTypeLogicGate, EntityTypeProject, EntityTypeHuddleNode, EntityTypeHuddleLogicGate, EntityTypeKPI:
		return resourceType, true
	default:
		return "", false
	}
}

func isReservedActionItemFieldName(name string) bool {
	name = strings.ToLower(strings.TrimSpace(name))
	for _, required := range actionItemFieldTypes("") {
		if name == strings.ToLower(required.Name) {
			return true
		}
	}
	return false
}

func validateRequiredActionItemFieldConfig(systemKey, fieldType string, configJSON json.RawMessage) error {
	if systemKey != ActionItemStatusSystemKey && systemKey != ActionItemColorSystemKey {
		return nil
	}
	canonical, err := normalizeEntityFieldTypeConfig(fieldType, configJSON)
	if err != nil {
		return err
	}
	var config entityFieldTypeConfig
	if err := json.Unmarshal(canonical, &config); err != nil {
		return ErrInvalid
	}
	keys := map[string]bool{}
	for _, option := range config.Options {
		keys[option.Key] = true
	}
	switch systemKey {
	case ActionItemStatusSystemKey:
		var defaultKey string
		if fieldType != EntityFieldTypeChoice || len(config.Options) != 3 || json.Unmarshal(config.Default, &defaultKey) != nil || defaultKey != ActionItemStatusInProgress || !keys[ActionItemStatusInProgress] || !keys["pending"] || !keys["done"] {
			return ErrInvalid
		}
	case ActionItemColorSystemKey:
		if fieldType != EntityFieldTypeColor || len(config.Default) == 0 || !bytes.Equal(bytes.TrimSpace(config.Default), []byte("null")) || !keys[ActionItemColorYellow] || !keys[ActionItemColorRed] {
			return ErrInvalid
		}
	}
	return nil
}

func actionItemInitialFieldValue(systemKey string, color *string) json.RawMessage {
	switch systemKey {
	case ActionItemStatusSystemKey:
		return json.RawMessage(`"in_progress"`)
	case ActionItemColorSystemKey:
		if color != nil {
			encoded, _ := json.Marshal(*color)
			return encoded
		}
	}
	return nil
}

func actionItemSourceValue(resourceType, resourceID string) json.RawMessage {
	if resourceType == "" || resourceID == "" {
		return nil
	}
	encoded, _ := json.Marshal(map[string]string{"resource_type": resourceType, "resource_id": resourceID})
	return encoded
}

func decodeActionItemSourceValue(value json.RawMessage) (resourceType, resourceID string, ok bool) {
	canonical, err := normalizeEntityFieldValue(EntityFieldTypeResource, value)
	if err != nil || canonical == nil {
		return "", "", false
	}
	var resource struct {
		ResourceType string `json:"resource_type"`
		ResourceID   string `json:"resource_id"`
	}
	if json.Unmarshal(canonical, &resource) != nil {
		return "", "", false
	}
	resource.ResourceType, ok = NormalizeActionItemSourceResourceType(resource.ResourceType)
	resource.ResourceID = cleanUUIDText(resource.ResourceID)
	return resource.ResourceType, resource.ResourceID, ok && resource.ResourceID != ""
}

func entityRelationshipKey(companyID, entityID, resourceType, resourceID string) string {
	return companyID + "|" + entityID + "|" + resourceType + "|" + resourceID
}

func entityReferenceIDsFromEditorDocuments(documents []json.RawMessage) []string {
	ids := map[string]struct{}{}
	var visit func(any)
	visit = func(value any) {
		switch current := value.(type) {
		case []any:
			for _, child := range current {
				visit(child)
			}
		case map[string]any:
			if current["type"] == "mangoEntityLink" {
				attrs, _ := current["attrs"].(map[string]any)
				entityType, _ := attrs["entityType"].(string)
				entityID, _ := attrs["entityId"].(string)
				if entityType == "entity" {
					if cleanID := cleanUUIDText(entityID); cleanID != "" {
						ids[cleanID] = struct{}{}
					}
				}
			}
			for _, child := range current {
				visit(child)
			}
		}
	}
	for _, document := range documents {
		var value any
		if json.Unmarshal(document, &value) == nil {
			visit(value)
		}
	}
	result := make([]string, 0, len(ids))
	for entityID := range ids {
		result = append(result, entityID)
	}
	sort.Strings(result)
	return result
}

func entityReferenceIDsFromChatLinks(chatLinks []json.RawMessage) []string {
	ids := []string{}
	for _, raw := range chatLinks {
		var links []struct {
			EntityType string `json:"entity_type"`
			EntityID   string `json:"entity_id"`
		}
		if json.Unmarshal(raw, &links) != nil {
			continue
		}
		for _, link := range links {
			if link.EntityType == "entity" {
				ids = append(ids, link.EntityID)
			}
		}
	}
	return normalizeUniqueUUIDs(ids)
}
