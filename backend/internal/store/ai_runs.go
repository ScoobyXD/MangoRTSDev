package store

import (
	"bytes"
	"encoding/json"
	"time"
)

// AIRun archives the existing Send identity and its captured inspection events.
type AIRun struct {
	CompanyID      string
	UserID         string
	AIRunsID       string
	StartTime      time.Time
	FinishTime     time.Time
	InspectionJSON json.RawMessage
}

func normalizeAIRun(run AIRun) (AIRun, error) {
	run.CompanyID = cleanUUIDText(run.CompanyID)
	run.UserID = cleanUUIDText(run.UserID)
	run.AIRunsID = cleanUUIDText(run.AIRunsID)
	inspection := bytes.TrimSpace(run.InspectionJSON)
	if run.CompanyID == "" || run.UserID == "" || run.AIRunsID == "" ||
		run.StartTime.IsZero() || run.FinishTime.IsZero() || run.FinishTime.Before(run.StartTime) ||
		!json.Valid(inspection) || inspection[0] != '[' {
		return AIRun{}, ErrInvalid
	}
	return run, nil
}
