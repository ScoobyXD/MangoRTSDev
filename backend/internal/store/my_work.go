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
	MyWorkActionItemGroupingHuddleProcess     = "huddle_process"
	MyWorkActionItemGroupingCompletionDueDate = "completion_due_date"
	MyWorkActionItemGroupingPersonInCharge    = "person_in_charge"
	MyWorkNodeGroupingPriority                = "priority"
	MyWorkNodeGroupingDueDate                 = "due_date"

	MyWorkDefaultActionItemGrouping          = "color:asc,huddle_process:asc"
	MyWorkDefaultDelegatedActionItemGrouping = "color:asc,person_in_charge:asc,huddle_process:asc"
	MyWorkDefaultActionItemOrdering          = "completion_due_date:asc"
	MyWorkDefaultDelegatedActionItemOrdering = MyWorkDefaultActionItemOrdering
	MyWorkDefaultNodeGrouping                = "priority:asc,due_date:asc"

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
	Ordering     string
	Limit        int
	Cursor       string
	History      bool
	grouping     []myWorkGroupingTerm
	ordering     []myWorkGroupingTerm
}

type myWorkGroupingTerm struct {
	Field     string
	Direction string
}

type myWorkCursor struct {
	Version            int    `json:"v"`
	CompanyID          string `json:"company_id"`
	SubjectUserID      string `json:"subject_user_id"`
	ViewerUserID       string `json:"viewer_user_id"`
	Section            string `json:"section"`
	Role               string `json:"role,omitempty"`
	Perspective        string `json:"perspective,omitempty"`
	Grouping           string `json:"grouping,omitempty"`
	Ordering           string `json:"ordering,omitempty"`
	GroupNull          bool   `json:"group_null,omitempty"`
	GroupInt           int    `json:"group_int,omitempty"`
	GroupText          string `json:"group_text,omitempty"`
	DateNull           bool   `json:"date_null,omitempty"`
	Date               string `json:"date,omitempty"`
	History            bool   `json:"history,omitempty"`
	CompletedTimestamp string `json:"completed_timestamp,omitempty"`
	Name               string `json:"name,omitempty"`
	PersonInChargeName string `json:"person_in_charge_name,omitempty"`
	PersonInChargeID   string `json:"person_in_charge_user_id,omitempty"`
	HuddleProcessNull  bool   `json:"huddle_process_null,omitempty"`
	HuddleProcessName  string `json:"huddle_process_name,omitempty"`
	HuddleProcessID    string `json:"huddle_process_id,omitempty"`
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
	query.Ordering = strings.ToLower(strings.TrimSpace(query.Ordering))
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
			if query.Grouping != "" || query.Ordering != "" {
				return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
			}
			break
		}
		grouping, terms, err := normalizeMyWorkGrouping(query.Section, query.Perspective, query.Grouping)
		if err != nil {
			return MyWorkQuery{}, myWorkCursor{}, err
		}
		query.Grouping = grouping
		query.grouping = terms
		if query.Section == MyWorkSectionActionItems {
			ordering, orderingTerms, err := normalizeMyWorkOrdering(query.Perspective, query.Ordering)
			if err != nil || myWorkTermsOverlap(terms, orderingTerms) {
				return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
			}
			query.Ordering = ordering
			query.ordering = orderingTerms
		} else if query.Ordering != "" {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
	case "", MyWorkSectionProcesses, MyWorkSectionProjects:
		if query.Grouping != "" || query.Ordering != "" {
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
	if err != nil || json.Unmarshal(payload, &cursor) != nil || cursor.Version != 3 ||
		cursor.CompanyID != query.CompanyID || cursor.SubjectUserID != query.UserID || cursor.ViewerUserID != query.ViewerUserID ||
		cursor.Section != query.Section || cleanUUIDText(cursor.ResourceID) == "" {
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
		if err != nil || completed.IsZero() || cursor.Grouping != "" || cursor.Ordering != "" || cursor.GroupNull || cursor.GroupInt != 0 || cursor.GroupText != "" || cursor.DateNull || cursor.Date != "" || cursor.Name != "" || cursor.PersonInChargeName != "" || cursor.PersonInChargeID != "" || cursor.HuddleProcessNull || cursor.HuddleProcessName != "" || cursor.HuddleProcessID != "" {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
		return query, cursor, nil
	}
	if cursor.CompletedTimestamp != "" {
		return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
	}
	switch query.Section {
	case MyWorkSectionActionItems:
		if cursor.Grouping != query.Grouping || cursor.Ordering != query.Ordering {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
		actionTerms := myWorkActionTerms(query)
		personGrouping := myWorkGroupingHasField(actionTerms, MyWorkActionItemGroupingPersonInCharge)
		personShapeValid := cursor.PersonInChargeName == "" && cursor.PersonInChargeID == ""
		if personGrouping {
			personShapeValid = cursor.PersonInChargeName != "" &&
				cleanUUIDText(cursor.PersonInChargeID) == cursor.PersonInChargeID
		}
		colorShapeValid := (cursor.GroupInt == 0 && cursor.GroupText == ActionItemColorRed) ||
			(cursor.GroupInt == 1 && cursor.GroupText == ActionItemColorYellow) ||
			(cursor.GroupInt == 2 && cursor.GroupText != "" && cursor.GroupText != ActionItemColorRed && cursor.GroupText != ActionItemColorYellow) ||
			(cursor.GroupInt == 3 && cursor.GroupText == "")
		huddleGrouping := myWorkGroupingHasField(actionTerms, MyWorkActionItemGroupingHuddleProcess)
		huddleShapeValid := !cursor.HuddleProcessNull && cursor.HuddleProcessName == "" && cursor.HuddleProcessID == ""
		if huddleGrouping {
			huddleShapeValid = (cursor.HuddleProcessNull && cursor.HuddleProcessName == "" && cursor.HuddleProcessID == "") ||
				(!cursor.HuddleProcessNull && strings.TrimSpace(cursor.HuddleProcessName) != "" && cleanUUIDText(cursor.HuddleProcessID) == cursor.HuddleProcessID)
		}
		if cursor.GroupNull != (cursor.GroupText == "") || cursor.Name != "" || !personShapeValid || !huddleShapeValid || !colorShapeValid || !validMyWorkCursorDate(cursor) {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
	case MyWorkSectionNodes:
		if cursor.Grouping != query.Grouping {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
		priorityShapeValid := (cursor.GroupNull && cursor.GroupInt == 0) || (!cursor.GroupNull && cursor.GroupInt >= 1 && cursor.GroupInt <= 5)
		if cursor.Ordering != "" || cursor.GroupText != "" || cursor.Name != "" || cursor.PersonInChargeName != "" || cursor.PersonInChargeID != "" || cursor.HuddleProcessNull || cursor.HuddleProcessName != "" || cursor.HuddleProcessID != "" || !priorityShapeValid || !validMyWorkCursorDate(cursor) {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
	case MyWorkSectionProcesses, MyWorkSectionProjects:
		if cursor.Grouping != "" || cursor.Ordering != "" || strings.TrimSpace(cursor.Name) == "" || cursor.GroupNull || cursor.GroupInt != 0 || cursor.GroupText != "" || cursor.DateNull || cursor.Date != "" || cursor.PersonInChargeName != "" || cursor.PersonInChargeID != "" || cursor.HuddleProcessNull || cursor.HuddleProcessName != "" || cursor.HuddleProcessID != "" {
			return MyWorkQuery{}, myWorkCursor{}, ErrInvalid
		}
	}
	return query, cursor, nil
}

func normalizeMyWorkGrouping(section, perspective, raw string) (string, []myWorkGroupingTerm, error) {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		switch section {
		case MyWorkSectionActionItems:
			if perspective == MyWorkActionItemPerspectiveDelegated {
				raw = MyWorkDefaultDelegatedActionItemGrouping
			} else {
				raw = MyWorkDefaultActionItemGrouping
			}
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
		allowed[MyWorkActionItemGroupingHuddleProcess] = true
		allowed[MyWorkActionItemGroupingCompletionDueDate] = true
		if perspective == MyWorkActionItemPerspectiveDelegated {
			allowed[MyWorkActionItemGroupingPersonInCharge] = true
		}
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

func normalizeMyWorkOrdering(perspective, raw string) (string, []myWorkGroupingTerm, error) {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		if perspective == MyWorkActionItemPerspectiveDelegated {
			raw = MyWorkDefaultDelegatedActionItemOrdering
		} else {
			raw = MyWorkDefaultActionItemOrdering
		}
	}
	return normalizeMyWorkGrouping(MyWorkSectionActionItems, perspective, raw)
}

func myWorkTermsOverlap(left, right []myWorkGroupingTerm) bool {
	for _, term := range left {
		if myWorkGroupingHasField(right, term.Field) {
			return true
		}
	}
	return false
}

func myWorkEffectiveGrouping(query MyWorkQuery, section string) (string, []myWorkGroupingTerm) {
	if query.Section == section && query.Grouping != "" {
		return query.Grouping, query.grouping
	}
	grouping, terms, _ := normalizeMyWorkGrouping(section, query.Perspective, "")
	return grouping, terms
}

func myWorkEffectiveOrdering(query MyWorkQuery) (string, []myWorkGroupingTerm) {
	if query.Section == MyWorkSectionActionItems && query.Ordering != "" {
		return query.Ordering, query.ordering
	}
	ordering, terms, _ := normalizeMyWorkOrdering(query.Perspective, "")
	return ordering, terms
}

func myWorkActionTerms(query MyWorkQuery) []myWorkGroupingTerm {
	_, grouping := myWorkEffectiveGrouping(query, MyWorkSectionActionItems)
	_, ordering := myWorkEffectiveOrdering(query)
	return append(append([]myWorkGroupingTerm{}, grouping...), ordering...)
}

func myWorkGroupingHasField(grouping []myWorkGroupingTerm, field string) bool {
	for _, term := range grouping {
		if term.Field == field {
			return true
		}
	}
	return false
}

func myWorkPersonInChargeName(displayName, email, userID string) string {
	if name := strings.TrimSpace(displayName); name != "" {
		return name
	}
	if email := strings.TrimSpace(email); email != "" {
		return email
	}
	return cleanUUIDText(userID)
}

func myWorkPersonInChargeSortName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func validMyWorkCursorDate(cursor myWorkCursor) bool {
	if cursor.DateNull {
		return cursor.Date == ""
	}
	parsed, err := time.Parse("2006-01-02", cursor.Date)
	return err == nil && parsed.Format("2006-01-02") == cursor.Date
}

func encodeMyWorkCursor(query MyWorkQuery, cursor myWorkCursor) string {
	cursor.Version = 3
	cursor.CompanyID = cleanUUIDText(query.CompanyID)
	cursor.SubjectUserID = cleanUUIDText(query.UserID)
	cursor.ViewerUserID = cleanUUIDText(query.ViewerUserID)
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
