package store

import (
	"bytes"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"miraeopus/backend/internal/domain"
)

const (
	ActionItemEntityTypeSystemKey = "action_item"
	ActionItemEntityTypeID        = "a17e0000-0000-4000-8000-000000000001"

	ActionItemPersonInChargeSystemKey    = "person_in_charge"
	ActionItemAnalysisDueDateSystemKey   = "analysis_due_date"
	ActionItemCompletionDueDateSystemKey = "completion_due_date"
	ActionItemStatusSystemKey            = "status"
	ActionItemColorSystemKey             = "color"

	ActionItemPersonInChargeFieldTypeID    = "a17e0000-0000-4000-8000-000000000101"
	ActionItemAnalysisDueDateFieldTypeID   = "a17e0000-0000-4000-8000-000000000102"
	ActionItemCompletionDueDateFieldTypeID = "a17e0000-0000-4000-8000-000000000103"
	ActionItemStatusFieldTypeID            = "a17e0000-0000-4000-8000-000000000104"
	ActionItemColorFieldTypeID             = "a17e0000-0000-4000-8000-000000000105"

	ActionItemStatusInProgress = "in_progress"
	ActionItemColorYellow      = "yellow"
	ActionItemColorRed         = "red"
)

var (
	actionItemStatusConfig = json.RawMessage(`{"default":"in_progress","options":[{"key":"in_progress","label":"In progress"},{"key":"pending","label":"Pending"},{"key":"done","label":"Done"}]}`)
	actionItemColorConfig  = json.RawMessage(`{"default":null,"options":[{"key":"yellow","label":"Yellow","color":"#facc15"},{"key":"red","label":"Red","color":"#ef4444"}]}`)
)

type ActionItemInput struct {
	CompanyID       string
	Name            string
	BodyText        string
	Color           *string
	HuddleNodeID    string
	CreatedByUserID string
}

func normalizeActionItemInput(input ActionItemInput) (ActionItemInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.CreatedByUserID = cleanUUIDText(input.CreatedByUserID)
	rawHuddleNodeID := strings.TrimSpace(input.HuddleNodeID)
	input.HuddleNodeID = rawHuddleNodeID
	if rawHuddleNodeID != "" {
		input.HuddleNodeID = cleanUUIDText(rawHuddleNodeID)
	}
	input.BodyText = strings.TrimSpace(input.BodyText)
	input.Name = strings.TrimSpace(input.Name)
	if input.CompanyID == "" || input.CreatedByUserID == "" || input.BodyText == "" || (rawHuddleNodeID != "" && input.HuddleNodeID == "") || len(input.Name) > EntityNameMaxLength {
		return ActionItemInput{}, ErrInvalid
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
	return input, nil
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
		{CompanyID: companyID, EntityFieldTypeID: ActionItemAnalysisDueDateFieldTypeID, EntityTypeID: ActionItemEntityTypeID, SystemKey: ActionItemAnalysisDueDateSystemKey, Name: "Analysis due date", FieldType: EntityFieldTypeDate, Config: json.RawMessage(`{}`), Position: 1},
		{CompanyID: companyID, EntityFieldTypeID: ActionItemCompletionDueDateFieldTypeID, EntityTypeID: ActionItemEntityTypeID, SystemKey: ActionItemCompletionDueDateSystemKey, Name: "Completion due date", FieldType: EntityFieldTypeDate, Config: json.RawMessage(`{}`), Position: 2},
		{CompanyID: companyID, EntityFieldTypeID: ActionItemStatusFieldTypeID, EntityTypeID: ActionItemEntityTypeID, SystemKey: ActionItemStatusSystemKey, Name: "Status", FieldType: EntityFieldTypeChoice, Config: append(json.RawMessage(nil), actionItemStatusConfig...), Position: 3},
		{CompanyID: companyID, EntityFieldTypeID: ActionItemColorFieldTypeID, EntityTypeID: ActionItemEntityTypeID, SystemKey: ActionItemColorSystemKey, Name: "Color", FieldType: EntityFieldTypeColor, Config: append(json.RawMessage(nil), actionItemColorConfig...), Position: 4},
	}
}

func isRequiredActionItemFieldSystemKey(systemKey string) bool {
	switch strings.TrimSpace(systemKey) {
	case ActionItemPersonInChargeSystemKey, ActionItemAnalysisDueDateSystemKey, ActionItemCompletionDueDateSystemKey, ActionItemStatusSystemKey, ActionItemColorSystemKey:
		return true
	default:
		return false
	}
}

func isRequiredActionItemFieldTypeID(entityFieldTypeID string) bool {
	switch strings.TrimSpace(entityFieldTypeID) {
	case ActionItemPersonInChargeFieldTypeID, ActionItemAnalysisDueDateFieldTypeID, ActionItemCompletionDueDateFieldTypeID, ActionItemStatusFieldTypeID, ActionItemColorFieldTypeID:
		return true
	default:
		return false
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

func actionItemHuddleRelationshipKey(companyID, entityID string) string {
	return companyID + "|" + entityID
}
