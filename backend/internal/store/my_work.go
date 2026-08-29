package store

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

const (
	MyWorkSectionActionItems = "action_items"
	MyWorkSectionNodes       = "nodes"
	MyWorkSectionProcesses   = "processes"
	MyWorkSectionProjects    = "projects"

	MyWorkGroupingNone = "none"

	MyWorkActionItemPerspectiveMine      = "mine"
	MyWorkActionItemPerspectiveDelegated = "delegated"

	MyWorkActionItemGroupingColor             = "color"
	MyWorkActionItemGroupingCompletionDueDate = "completion_due_date"
	MyWorkNodeGroupingPriority                = "priority"
	MyWorkNodeGroupingDueDate                 = "due_date"

	MyWorkDefaultActionItemGrouping = "color:asc,completion_due_date:asc"
	MyWorkDefaultNodeGrouping       = "priority:asc,due_date:asc"

	MyWorkDefaultLimit = 50
	MyWorkMaxLimit     = 200
)

type MyWorkQuery struct {
	CompanyID    string
	UserID       string
	ViewerUserID string
	Section      string
	Role         string
	Perspective  string
	Grouping     string
	Limit        int
	Cursor       string
	History      bool
	grouping     []myWorkGroupingTerm
}

type myWorkGroupingTerm struct {
	Field     string
	Direction string
}

type myWorkCursor struct {
	Version            int    `json:"v"`
	Section            string `json:"section"`
	Role               string `json:"role,omitempty"`
	Perspective        string `json:"perspective,omitempty"`
	Grouping           string `json:"grouping,omitempty"`
	GroupNull          bool   `json:"group_null,omitempty"`
	GroupInt           int    `json:"group_int,omitempty"`
	GroupText          string `json:"group_text,omitempty"`
	DateNull           bool   `json:"date_null,omitempty"`
	Date               string `json:"date,omitempty"`
	History            bool   `json:"history,omitempty"`
	CompletedTimestamp string `json:"completed_timestamp,omitempty"`
	Name               string `json:"name,omitempty"`
	ResourceID         string `json:"resource_id"`
}

func normalizeMyWorkQuery(query MyWorkQuery) (MyWorkQuery, myWorkCursor, error) {
	query.CompanyID = cleanUUIDText(query.CompanyID)
	query.UserID = cleanUUIDText(query.UserID)
	query.ViewerUserID = cleanUUIDText(query.ViewerUserID)
	query.Section = strings.ToLower(strings.TrimSpace(query.Section))
	rawRole := strings.TrimSpace(query.Role)
	query.Role = strings.ToLower(rawRole)
	rawPerspective := strings.TrimSpace(query.Perspective)
	query.Perspective = strings.ToLower(rawPerspective)
	query.Grouping = strings.ToLower(strings.TrimSpace(query.Grouping))
	query.Cursor = strings.TrimSpace(query.Cursor)
	if query.CompanyID == "" || query.UserID == "" || query.ViewerUserID == "" {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	switch query.Section {
	case "", MyWorkSectionActionItems, MyWorkSectionNodes, MyWorkSectionProcesses, MyWorkSectionProjects:
	default:
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	if query.History && query.Section != MyWorkSectionActionItems && query.Section != MyWorkSectionNodes {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	if query.Role == "" {
		query.Role = "responsible"
	}
	if role, ok := NormalizeRACIRole(query.Role); ok {
		query.Role = role
	} else {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	if rawRole != "" && query.Section != MyWorkSectionNodes && query.Section != MyWorkSectionProcesses {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	if query.Perspective == "" {
		query.Perspective = MyWorkActionItemPerspectiveMine
	}
	if query.Perspective != MyWorkActionItemPerspectiveMine && query.Perspective != MyWorkActionItemPerspectiveDelegated {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	if rawPerspective != "" && query.Section != MyWorkSectionActionItems {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	switch query.Section {
	case MyWorkSectionActionItems, MyWorkSectionNodes:
		if query.History {
			if query.Grouping != "" {
				return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
			}
			break
		}
		grouping, terms, err := normalizeMyWorkGrouping(query.Section, query.Grouping)
		if err != nil {
			return MyWorkQuery{}, myWorkCursor{}, err
		}
		query.Grouping = grouping
		query.grouping = terms
	case "", MyWorkSectionProcesses, MyWorkSectionProjects:
		if query.Grouping != "" {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
	}
	if query.Limit <= 0 {
		query.Limit = MyWorkDefaultLimit
	}
	if query.Limit > MyWorkMaxLimit {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	if query.Cursor != "" && query.Section == "" {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	cursor := myWorkCursor{}
	if query.Cursor == "" {
		return query, cursor, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(query.Cursor)
	if err != nil || json.Unmarshal(payload, &cursor) != nil || cursor.Version != 1 || cursor.Section != query.Section || cleanUUIDText(cursor.ResourceID) == "" {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	if query.Section == MyWorkSectionProcesses || query.Section == MyWorkSectionNodes {
		if cursor.Role != query.Role {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
	} else if cursor.Role != "" {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	if query.Section == MyWorkSectionActionItems {
		if cursor.Perspective != query.Perspective {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
	} else if cursor.Perspective != "" {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	if cursor.History != query.History {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	if query.History {
		completed, err := time.Parse(time.RFC3339Nano, cursor.CompletedTimestamp)
		if err != nil || completed.IsZero() || cursor.Grouping != "" || cursor.GroupNull || cursor.GroupInt != 0 || cursor.GroupText != "" || cursor.DateNull || cursor.Date != "" || cursor.Name != "" {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
		return query, cursor, nil
	}
	if cursor.CompletedTimestamp != "" {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	switch query.Section {
	case MyWorkSectionActionItems:
		if cursor.Grouping != query.Grouping {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
		colorShapeValid := (cursor.GroupInt == 0 && cursor.GroupText == ActionItemColorRed) ||
			(cursor.GroupInt == 1 && cursor.GroupText == ActionItemColorYellow) ||
			(cursor.GroupInt == 2 && cursor.GroupText != "" && cursor.GroupText != ActionItemColorRed && cursor.GroupText != ActionItemColorYellow) ||
			(cursor.GroupInt == 3 && cursor.GroupText == "")
		if cursor.GroupNull != (cursor.GroupText == "") || cursor.Name != "" || !colorShapeValid || !validMyWorkCursorDate(cursor) {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
	case MyWorkSectionNodes:
		if cursor.Grouping != query.Grouping {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
		priorityShapeValid := (cursor.GroupNull && cursor.GroupInt == 0) || (!cursor.GroupNull && cursor.GroupInt >= 1 && cursor.GroupInt <= 5)
		if cursor.GroupText != "" || cursor.Name != "" || !priorityShapeValid || !validMyWorkCursorDate(cursor) {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
	case MyWorkSectionProcesses, MyWorkSectionProjects:
		if cursor.Grouping != "" || strings.TrimSpace(cursor.Name) == "" || cursor.GroupNull || cursor.GroupInt != 0 || cursor.GroupText != "" || cursor.DateNull || cursor.Date != "" {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
	}
	return query, cursor, nil
}

func normalizeMyWorkGrouping(section, raw string) (string, []myWorkGroupingTerm, error) {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		switch section {
		case MyWorkSectionActionItems:
			raw = MyWorkDefaultActionItemGrouping
		case MyWorkSectionNodes:
			raw = MyWorkDefaultNodeGrouping
		default:
			return "", nil, ErrInvalid
		}
	}
	if raw == MyWorkGroupingNone {
		return MyWorkGroupingNone, nil, nil
	}
	allowed := map[string]bool{}
	switch section {
	case MyWorkSectionActionItems:
		allowed[MyWorkActionItemGroupingColor] = true
		allowed[MyWorkActionItemGroupingCompletionDueDate] = true
	case MyWorkSectionNodes:
		allowed[MyWorkNodeGroupingPriority] = true
		allowed[MyWorkNodeGroupingDueDate] = true
	default:
		return "", nil, ErrInvalid
	}
	parts := strings.Split(raw, ",")
	if len(parts) == 0 || len(parts) > len(allowed) {
		return "", nil, ErrInvalid
	}
	terms := make([]myWorkGroupingTerm, 0, len(parts))
	seen := map[string]bool{}
	canonical := make([]string, 0, len(parts))
	for _, part := range parts {
		pair := strings.Split(strings.TrimSpace(part), ":")
		if len(pair) != 2 {
			return "", nil, ErrInvalid
		}
		field := strings.TrimSpace(pair[0])
		direction := strings.TrimSpace(pair[1])
		if !allowed[field] || seen[field] || (direction != "asc" && direction != "desc") {
			return "", nil, ErrInvalid
		}
		seen[field] = true
		terms = append(terms, myWorkGroupingTerm{Field: field, Direction: direction})
		canonical = append(canonical, field+":"+direction)
	}
	return strings.Join(canonical, ","), terms, nil
}

func myWorkEffectiveGrouping(query MyWorkQuery, section string) (string, []myWorkGroupingTerm) {
	if query.Section == section && query.Grouping != "" {
		return query.Grouping, query.grouping
	}
	grouping, terms, _ := normalizeMyWorkGrouping(section, "")
	return grouping, terms
}

func validMyWorkCursorDate(cursor myWorkCursor) bool {
	if cursor.DateNull {
		return cursor.Date == ""
	}
	parsed, err := time.Parse("2006-01-02", cursor.Date)
	return err == nil && parsed.Format("2006-01-02") == cursor.Date
}

func encodeMyWorkCursor(cursor myWorkCursor) string {
	cursor.Version = 1
	payload, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(payload)
}

func myWorkIncludesSection(query MyWorkQuery, section string) bool {
	return query.Section == "" || query.Section == section
}

func myWorkStatusDone(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "done", "complete", "completed":
		return true
	default:
		return false
	}
}

func compareMyWorkHistoryItems(leftCompleted time.Time, leftID string, rightCompleted time.Time, rightID string) int {
	if !leftCompleted.Equal(rightCompleted) {
		if leftCompleted.After(rightCompleted) {
			return -1
		}
		return 1
	}
	return strings.Compare(leftID, rightID)
}

func myWorkHistoryItemAfter(completed time.Time, resourceID string, cursor myWorkCursor) bool {
	cursorCompleted, err := time.Parse(time.RFC3339Nano, cursor.CompletedTimestamp)
	if err != nil {
		return false
	}
	return compareMyWorkHistoryItems(completed, resourceID, cursorCompleted, cursor.ResourceID) > 0
}

func myWorkCursorTimestamp(raw string) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return time.Unix(0, 0).UTC()
	}
	return parsed
}
