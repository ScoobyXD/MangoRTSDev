package store

import (
	"bytes"
	"encoding/json"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
)

const (
	EntityFieldTypeText    = "text"
	EntityFieldTypeNumber  = "number"
	EntityFieldTypeDate    = "date"
	EntityFieldTypeBoolean = "boolean"
	EntityNameMaxLength    = 200
	EntitySearchMaxLength  = 200
	EntitySearchMaxLimit   = 50
)

type EntityTypeInput struct {
	CompanyID    string
	EntityTypeID string
	Name         string
	NameSet      bool
}

type EntityFolderInput struct {
	CompanyID            string
	EntityFolderID       string
	EntityTypeID         string
	ParentEntityFolderID *string
	ParentFolderSet      bool
	Name                 string
	NameSet              bool
	Position             int
	PositionSet          bool
}

type EntityFieldTypeInput struct {
	CompanyID         string
	EntityFieldTypeID string
	EntityTypeID      string
	EntityFolderID    *string
	EntityFolderSet   bool
	Name              string
	NameSet           bool
	FieldType         string
	FieldTypeSet      bool
	Position          int
	PositionSet       bool
}

type EntityListQuery struct {
	CompanyID      string
	Query          string
	EntityTypeID   string
	EntityFolderID *string
	Limit          int
	Offset         int
}

type EntityInput struct {
	CompanyID       string
	EntityID        string
	EntityTypeID    string
	EntityFolderID  *string
	EntityFolderSet bool
	Name            string
	NameSet         bool
	Position        int
	PositionSet     bool
	BodyJSON        json.RawMessage
	BodySet         bool
	BaseRevision    int64
	BaseRevisionSet bool
}

type EntityFieldInput struct {
	CompanyID     string
	EntityID      string
	EntityFieldID string
	Name          string
	NameSet       bool
	FieldType     string
	FieldTypeSet  bool
	Value         json.RawMessage
	ValueSet      bool
	Position      int
	PositionSet   bool
}

func normalizeEntityTypeInput(input EntityTypeInput, update bool) (EntityTypeInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.EntityTypeID = cleanUUIDText(input.EntityTypeID)
	input.Name = strings.TrimSpace(input.Name)
	if input.CompanyID == "" || (update && input.EntityTypeID == "") || (!update && input.Name == "") || len(input.Name) > EntityNameMaxLength {
		return EntityTypeInput{}, ErrInvalid
	}
	if update && (!input.NameSet || input.Name == "") {
		return EntityTypeInput{}, ErrInvalid
	}
	return input, nil
}

func normalizeEntityFolderInput(input EntityFolderInput, update bool) (EntityFolderInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.EntityFolderID = cleanUUIDText(input.EntityFolderID)
	input.EntityTypeID = cleanUUIDText(input.EntityTypeID)
	input.Name = strings.TrimSpace(input.Name)
	parent, err := normalizeOptionalEntityID(input.ParentEntityFolderID)
	if err != nil {
		return EntityFolderInput{}, err
	}
	input.ParentEntityFolderID = parent
	if input.CompanyID == "" || (update && input.EntityFolderID == "") || (!update && (input.EntityTypeID == "" || input.Name == "")) || len(input.Name) > EntityNameMaxLength || (input.PositionSet && input.Position < 0) {
		return EntityFolderInput{}, ErrInvalid
	}
	if update && !input.NameSet && !input.ParentFolderSet && !input.PositionSet {
		return EntityFolderInput{}, ErrInvalid
	}
	if input.NameSet && input.Name == "" {
		return EntityFolderInput{}, ErrInvalid
	}
	return input, nil
}

func normalizeEntityFieldTypeInput(input EntityFieldTypeInput, update bool) (EntityFieldTypeInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.EntityFieldTypeID = cleanUUIDText(input.EntityFieldTypeID)
	input.EntityTypeID = cleanUUIDText(input.EntityTypeID)
	input.Name = strings.TrimSpace(input.Name)
	input.FieldType = strings.ToLower(strings.TrimSpace(input.FieldType))
	folder, err := normalizeOptionalEntityID(input.EntityFolderID)
	if err != nil {
		return EntityFieldTypeInput{}, err
	}
	input.EntityFolderID = folder
	if input.CompanyID == "" || (update && input.EntityFieldTypeID == "") || (!update && (input.EntityTypeID == "" || input.Name == "" || !validEntityFieldType(input.FieldType))) || len(input.Name) > EntityNameMaxLength || (input.PositionSet && input.Position < 0) {
		return EntityFieldTypeInput{}, ErrInvalid
	}
	if update && !input.NameSet && !input.EntityFolderSet && !input.FieldTypeSet && !input.PositionSet {
		return EntityFieldTypeInput{}, ErrInvalid
	}
	if input.NameSet && input.Name == "" {
		return EntityFieldTypeInput{}, ErrInvalid
	}
	if input.FieldTypeSet && !validEntityFieldType(input.FieldType) {
		return EntityFieldTypeInput{}, ErrInvalid
	}
	return input, nil
}

func normalizeEntityListQuery(query EntityListQuery) (EntityListQuery, error) {
	query.CompanyID = cleanUUIDText(query.CompanyID)
	query.Query = strings.TrimSpace(query.Query)
	rawEntityTypeID := strings.TrimSpace(query.EntityTypeID)
	query.EntityTypeID = cleanUUIDText(rawEntityTypeID)
	if query.CompanyID == "" || len(query.Query) > EntitySearchMaxLength || query.Offset < 0 {
		return EntityListQuery{}, ErrInvalid
	}
	if rawEntityTypeID != "" && query.EntityTypeID == "" {
		return EntityListQuery{}, ErrInvalid
	}
	if query.EntityFolderID != nil {
		clean := strings.TrimSpace(*query.EntityFolderID)
		if clean != "" {
			clean = cleanUUIDText(clean)
			if clean == "" {
				return EntityListQuery{}, ErrInvalid
			}
		}
		query.EntityFolderID = &clean
	}
	if query.Limit <= 0 {
		query.Limit = EntitySearchMaxLimit
	}
	if query.Limit > EntitySearchMaxLimit {
		query.Limit = EntitySearchMaxLimit
	}
	return query, nil
}

func normalizeEntityInput(input EntityInput, update bool) (EntityInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.EntityID = cleanUUIDText(input.EntityID)
	input.EntityTypeID = cleanUUIDText(input.EntityTypeID)
	input.Name = strings.TrimSpace(input.Name)
	folder, err := normalizeOptionalEntityID(input.EntityFolderID)
	if err != nil {
		return EntityInput{}, err
	}
	input.EntityFolderID = folder
	if input.CompanyID == "" || (update && input.EntityID == "") || (!update && (input.EntityTypeID == "" || input.Name == "")) || len(input.Name) > EntityNameMaxLength || (input.PositionSet && input.Position < 0) || input.BaseRevision < 0 {
		return EntityInput{}, ErrInvalid
	}
	if update && !input.NameSet && !input.EntityFolderSet && !input.PositionSet && !input.BodySet {
		return EntityInput{}, ErrInvalid
	}
	if input.NameSet && input.Name == "" {
		return EntityInput{}, ErrInvalid
	}
	if input.BodySet {
		if update && !input.BaseRevisionSet {
			return EntityInput{}, ErrInvalid
		}
		document, annotations, err := decodeEditorTextboxBody(input.BodyJSON)
		if err != nil {
			return EntityInput{}, err
		}
		body, err := encodeEditorTextboxBody(document, annotations)
		if err != nil {
			return EntityInput{}, err
		}
		input.BodyJSON = body
	} else if !update {
		input.BodyJSON = emptyEditorTextboxBody()
	}
	return input, nil
}

func normalizeEntityFieldInput(input EntityFieldInput, update bool) (EntityFieldInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.EntityID = cleanUUIDText(input.EntityID)
	input.EntityFieldID = cleanUUIDText(input.EntityFieldID)
	input.Name = strings.TrimSpace(input.Name)
	input.FieldType = strings.ToLower(strings.TrimSpace(input.FieldType))
	if input.CompanyID == "" || input.EntityID == "" || (update && input.EntityFieldID == "") || (!update && (input.Name == "" || !validEntityFieldType(input.FieldType))) || len(input.Name) > EntityNameMaxLength || (input.PositionSet && input.Position < 0) {
		return EntityFieldInput{}, ErrInvalid
	}
	if update && !input.NameSet && !input.FieldTypeSet && !input.ValueSet && !input.PositionSet {
		return EntityFieldInput{}, ErrInvalid
	}
	if input.NameSet && input.Name == "" {
		return EntityFieldInput{}, ErrInvalid
	}
	if input.FieldTypeSet && !validEntityFieldType(input.FieldType) {
		return EntityFieldInput{}, ErrInvalid
	}
	if !update && input.ValueSet {
		value, err := normalizeEntityFieldValue(input.FieldType, input.Value)
		if err != nil {
			return EntityFieldInput{}, err
		}
		input.Value = value
	}
	return input, nil
}

func normalizeOptionalEntityID(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	if strings.TrimSpace(*value) == "" {
		return nil, ErrInvalid
	}
	clean := cleanUUIDText(*value)
	if clean == "" {
		return nil, ErrInvalid
	}
	return &clean, nil
}

func validEntityFieldType(value string) bool {
	switch value {
	case EntityFieldTypeText, EntityFieldTypeNumber, EntityFieldTypeDate, EntityFieldTypeBoolean:
		return true
	default:
		return false
	}
}

func normalizeEntityFieldValue(fieldType string, raw json.RawMessage) (json.RawMessage, error) {
	if len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, ErrInvalid
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, ErrInvalid
	}
	var valid bool
	switch fieldType {
	case EntityFieldTypeText:
		_, valid = value.(string)
	case EntityFieldTypeNumber:
		number, ok := value.(json.Number)
		if ok {
			_, err := strconv.ParseFloat(number.String(), 64)
			valid = err == nil
		}
	case EntityFieldTypeDate:
		text, ok := value.(string)
		if ok {
			parsed, err := time.Parse("2006-01-02", text)
			valid = err == nil && parsed.Format("2006-01-02") == text
		}
	case EntityFieldTypeBoolean:
		_, valid = value.(bool)
	}
	if !valid {
		return nil, ErrInvalid
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return nil, ErrInvalid
	}
	return canonical, nil
}

func resolveEntityFieldTypeLayers(layers [][]domain.EntityFieldType) []domain.EntityFieldType {
	resolved := make([]domain.EntityFieldType, 0)
	indexes := map[string]int{}
	for _, layer := range layers {
		sortEntityFieldTypes(layer)
		for _, fieldType := range layer {
			nameKey := strings.ToLower(strings.TrimSpace(fieldType.Name))
			if index, exists := indexes[nameKey]; exists {
				resolved[index] = fieldType
				continue
			}
			indexes[nameKey] = len(resolved)
			resolved = append(resolved, fieldType)
		}
	}
	return resolved
}

func sortEntityTypes(items []domain.EntityType) {
	sort.Slice(items, func(i, j int) bool {
		left, right := strings.ToLower(items[i].Name), strings.ToLower(items[j].Name)
		return left < right || (left == right && items[i].EntityTypeID < items[j].EntityTypeID)
	})
}

func sortEntityFolders(items []domain.EntityFolder) {
	sort.Slice(items, func(i, j int) bool {
		leftParent, rightParent := optionalEntityIDValue(items[i].ParentEntityFolderID), optionalEntityIDValue(items[j].ParentEntityFolderID)
		if leftParent != rightParent {
			return leftParent < rightParent
		}
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		left, right := strings.ToLower(items[i].Name), strings.ToLower(items[j].Name)
		return left < right || (left == right && items[i].EntityFolderID < items[j].EntityFolderID)
	})
}

func sortEntityFieldTypes(items []domain.EntityFieldType) {
	sort.Slice(items, func(i, j int) bool {
		leftFolder, rightFolder := optionalEntityIDValue(items[i].EntityFolderID), optionalEntityIDValue(items[j].EntityFolderID)
		if leftFolder != rightFolder {
			return leftFolder < rightFolder
		}
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		left, right := strings.ToLower(items[i].Name), strings.ToLower(items[j].Name)
		return left < right || (left == right && items[i].EntityFieldTypeID < items[j].EntityFieldTypeID)
	})
}

func sortEntitySummaries(items []domain.EntitySummary) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		left, right := strings.ToLower(items[i].Name), strings.ToLower(items[j].Name)
		return left < right || (left == right && items[i].EntityID < items[j].EntityID)
	})
}

func sortEntityFields(items []domain.EntityField) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		left, right := strings.ToLower(items[i].Name), strings.ToLower(items[j].Name)
		return left < right || (left == right && items[i].EntityFieldID < items[j].EntityFieldID)
	})
}

func optionalEntityIDValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func cloneEntityFolder(item domain.EntityFolder) domain.EntityFolder {
	item.ParentEntityFolderID = cloneStringPointer(item.ParentEntityFolderID)
	return item
}

func cloneEntityFieldType(item domain.EntityFieldType) domain.EntityFieldType {
	item.EntityFolderID = cloneStringPointer(item.EntityFolderID)
	return item
}

func cloneEntityField(item domain.EntityField) domain.EntityField {
	item.Value = append(json.RawMessage(nil), item.Value...)
	return item
}

func cloneEntity(item domain.Entity) domain.Entity {
	item.EntityFolderID = cloneStringPointer(item.EntityFolderID)
	item.BodyJSON = append(json.RawMessage(nil), item.BodyJSON...)
	item.EntityFields = append([]domain.EntityField(nil), item.EntityFields...)
	for index := range item.EntityFields {
		item.EntityFields[index] = cloneEntityField(item.EntityFields[index])
	}
	return item
}
