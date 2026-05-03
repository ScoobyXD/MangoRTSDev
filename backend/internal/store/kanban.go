package store

import (
	"sort"
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
)

const KanbanMaxCardsLimit = 500

type KanbanCardFilter struct {
	Field string
	Op    string
	Value string
}

type KanbanCardSort struct {
	Field     string
	Direction string
}

type KanbanCardQuery struct {
	ColumnID      string
	AfterPosition int
	Limit         int
	Filters       []KanbanCardFilter
	Sort          []KanbanCardSort
}

type KanbanCardMetadataInput struct {
	Status              string
	WorkType            string
	AssignedTo          string
	AssignedBy          string
	ActorID             string
	DescriptionSnapshot string
	LastActivity        string
}

type KanbanCardMutationInput struct {
	CompanyID     string
	BoardID       string
	ColumnID      string
	ItemType      string
	ItemID        string
	TitleSnapshot string
	Position      int
	Metadata      KanbanCardMetadataInput
}

type KanbanCardMoveInput struct {
	CompanyID string
	BoardID   string
	CardID    string
	ColumnID  string
	Position  int
	Metadata  KanbanCardMetadataInput
}

func NormalizeKanbanCardQuery(query KanbanCardQuery) KanbanCardQuery {
	query.ColumnID = strings.TrimSpace(query.ColumnID)
	if query.AfterPosition < 0 {
		query.AfterPosition = 0
	}
	if query.Limit <= 0 || query.Limit > KanbanMaxCardsLimit {
		query.Limit = 200
	}
	nextFilters := make([]KanbanCardFilter, 0, len(query.Filters))
	for _, filter := range query.Filters {
		filter.Field = strings.TrimSpace(filter.Field)
		filter.Op = strings.TrimSpace(filter.Op)
		filter.Value = strings.TrimSpace(filter.Value)
		if filter.Op == "" {
			filter.Op = "eq"
		}
		if filter.Field == "" {
			continue
		}
		nextFilters = append(nextFilters, filter)
	}
	query.Filters = nextFilters

	nextSort := make([]KanbanCardSort, 0, len(query.Sort))
	for _, sortSpec := range query.Sort {
		sortSpec.Field = strings.TrimSpace(sortSpec.Field)
		sortSpec.Direction = strings.ToLower(strings.TrimSpace(sortSpec.Direction))
		if sortSpec.Direction != "desc" {
			sortSpec.Direction = "asc"
		}
		if sortSpec.Field == "" {
			continue
		}
		nextSort = append(nextSort, sortSpec)
	}
	query.Sort = nextSort
	return query
}

func IsKanbanCardQueryField(field string) bool {
	switch field {
	case "column_id", "item_type", "item_id", "title_snapshot", "description_snapshot",
		"status", "work_type", "assigned_to", "assigned_by", "created_by", "updated_by",
		"last_activity", "created_timestamp", "updated_timestamp", "status_entered_timestamp":
		return true
	default:
		return false
	}
}

func IsKanbanCardFilterSupported(filter KanbanCardFilter) bool {
	if !IsKanbanCardQueryField(filter.Field) {
		return false
	}
	if filter.Op == "" || filter.Op == "eq" {
		return true
	}
	return filter.Op == "prefix" && (filter.Field == "title_snapshot" || filter.Field == "description_snapshot")
}

func IsKanbanCardSortField(field string) bool {
	switch field {
	case "column_id", "item_type", "item_id", "title_snapshot", "status", "work_type",
		"assigned_to", "assigned_by", "created_timestamp", "updated_timestamp",
		"status_entered_timestamp", "position":
		return true
	default:
		return false
	}
}

func KanbanCardFieldValue(card domain.KanbanCard, field string) string {
	switch field {
	case "column_id":
		return card.ColumnID
	case "item_type":
		return card.ItemType
	case "item_id":
		return card.ItemID
	case "title_snapshot":
		return card.TitleSnapshot
	case "description_snapshot":
		return card.DescriptionSnapshot
	case "status":
		return card.Status
	case "work_type":
		return card.WorkType
	case "assigned_to":
		return card.AssignedTo
	case "assigned_by":
		return card.AssignedBy
	case "created_by":
		return card.CreatedBy
	case "updated_by":
		return card.UpdatedBy
	case "last_activity":
		return card.LastActivity
	case "created_timestamp":
		return card.CreatedTimestamp.Format(time.RFC3339)
	case "updated_timestamp":
		return card.UpdatedTimestamp.Format(time.RFC3339)
	case "status_entered_timestamp":
		return card.StatusEnteredTimestamp.Format(time.RFC3339)
	default:
		return ""
	}
}

func KanbanCardMatchesFilters(card domain.KanbanCard, filters []KanbanCardFilter) bool {
	for _, filter := range filters {
		if !IsKanbanCardFilterSupported(filter) {
			return false
		}
		value := KanbanCardFieldValue(card, filter.Field)
		if filter.Op == "prefix" {
			if !strings.HasPrefix(strings.ToLower(value), strings.ToLower(filter.Value)) {
				return false
			}
			continue
		}
		if !strings.EqualFold(value, filter.Value) {
			return false
		}
	}
	return true
}

func NormalizeKanbanCardStatus(inputStatus, columnTitle string) string {
	status := strings.TrimSpace(inputStatus)
	if status != "" {
		return status
	}
	status = strings.TrimSpace(columnTitle)
	if status != "" {
		return status
	}
	return "Unspecified"
}

func NormalizeKanbanCardWorkType(inputWorkType, itemType string) string {
	workType := strings.TrimSpace(inputWorkType)
	if workType != "" {
		return workType
	}
	if itemType == "logic_gate" {
		return "Logic Gate"
	}
	return "Node"
}

func NormalizeKanbanLastActivity(inputActivity, fallback string) string {
	activity := strings.TrimSpace(inputActivity)
	if activity != "" {
		return activity
	}
	return fallback
}

func SortKanbanCardsForQuery(items []domain.KanbanCard, sortSpecs []KanbanCardSort) {
	sort.Slice(items, func(i, j int) bool {
		for _, spec := range sortSpecs {
			cmp := compareKanbanCardField(items[i], items[j], spec.Field)
			if cmp == 0 {
				continue
			}
			if spec.Direction == "desc" {
				return cmp > 0
			}
			return cmp < 0
		}
		if items[i].ColumnID != items[j].ColumnID {
			return items[i].ColumnID < items[j].ColumnID
		}
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].CardID < items[j].CardID
	})
}

func compareKanbanCardField(a, b domain.KanbanCard, field string) int {
	switch field {
	case "position":
		return compareInt(a.Position, b.Position)
	case "created_timestamp":
		return compareTime(a.CreatedTimestamp, b.CreatedTimestamp)
	case "updated_timestamp":
		return compareTime(a.UpdatedTimestamp, b.UpdatedTimestamp)
	case "status_entered_timestamp":
		return compareTime(a.StatusEnteredTimestamp, b.StatusEnteredTimestamp)
	default:
		return strings.Compare(
			strings.ToLower(KanbanCardFieldValue(a, field)),
			strings.ToLower(KanbanCardFieldValue(b, field)),
		)
	}
}

func compareInt(a, b int) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}

func compareTime(a, b time.Time) int {
	if a.Before(b) {
		return -1
	}
	if a.After(b) {
		return 1
	}
	return 0
}
