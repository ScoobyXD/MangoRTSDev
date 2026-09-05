package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

const (
	QDRatingMetricQuality      = "quality"
	QDRatingMetricCost         = "cost"
	QDRatingMetricDelivery     = "delivery"
	QDRatingRealtimeEventType  = "logic_gate_qd_rating_updated"
	QDRatingRealtimeDocumentID = "qd-ratings"
	QDRatingBusinessTimeZone   = "America/Los_Angeles"
)

type QDRatingMonthQuery struct {
	CompanyID   string
	LogicGateID string
	Year        int
	Month       time.Month
}

type QDRatingPutInput struct {
	CompanyID          string
	LogicGateID        string
	Metric             string
	Rating             *string
	RatedByUserID      string
	RatedByDisplayName string
	Now                time.Time
}

type QDRatingMutationResult struct {
	QDRating *domain.QDRating
	Changed  bool
}

func normalizeQDRatingMonthQuery(input QDRatingMonthQuery) (QDRatingMonthQuery, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.LogicGateID = cleanUUIDText(input.LogicGateID)
	if input.CompanyID == "" || input.LogicGateID == "" || input.Year < 1 || input.Month < time.January || input.Month > time.December {
		return QDRatingMonthQuery{}, ErrInvalid
	}
	return input, nil
}

func normalizeQDRatingPutInput(input QDRatingPutInput) (QDRatingPutInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.LogicGateID = cleanUUIDText(input.LogicGateID)
	input.Metric = strings.TrimSpace(input.Metric)
	input.RatedByUserID = cleanUUIDText(input.RatedByUserID)
	input.RatedByDisplayName = strings.TrimSpace(input.RatedByDisplayName)
	if input.CompanyID == "" || input.LogicGateID == "" || input.RatedByUserID == "" || input.RatedByDisplayName == "" {
		return QDRatingPutInput{}, ErrInvalid
	}
	if input.Metric != QDRatingMetricQuality && input.Metric != QDRatingMetricCost && input.Metric != QDRatingMetricDelivery {
		return QDRatingPutInput{}, ErrInvalid
	}
	if input.Rating != nil {
		value := strings.ToLower(strings.TrimSpace(*input.Rating))
		if value != "green" && value != "yellow" && value != "red" {
			return QDRatingPutInput{}, ErrInvalid
		}
		input.Rating = &value
	}
	if input.Now.IsZero() {
		input.Now = time.Now().UTC()
	} else {
		input.Now = input.Now.UTC()
	}
	return input, nil
}

func qdRatingBusinessLocation() (*time.Location, error) {
	return time.LoadLocation(QDRatingBusinessTimeZone)
}

func qdRatingBusinessDate(value time.Time) (string, error) {
	location, err := qdRatingBusinessLocation()
	if err != nil {
		return "", err
	}
	return value.In(location).Format("2006-01-02"), nil
}

func qdRatingMonthBounds(query QDRatingMonthQuery) (time.Time, time.Time, error) {
	location, err := qdRatingBusinessLocation()
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	start := time.Date(query.Year, query.Month, 1, 0, 0, 0, 0, location)
	return start, start.AddDate(0, 1, 0), nil
}

func qdRatingRealtimeOutboxInput(input QDRatingPutInput, eventID string) (RealtimeOutboxInput, error) {
	ref := EditorJSONDocumentRef{
		CompanyID: input.CompanyID, ResourceType: EntityTypeLogicGate,
		ResourceID: input.LogicGateID, DocumentID: QDRatingRealtimeDocumentID,
	}
	scope := EditorJSONRealtimeScope(ref)
	payload, err := json.Marshal(map[string]any{
		"type": QDRatingRealtimeEventType, "event_id": eventID,
		"company_id": input.CompanyID, "scope": scope,
		"logic_gate_id": input.LogicGateID,
	})
	if err != nil {
		return RealtimeOutboxInput{}, err
	}
	return normalizeRealtimeOutboxInput(RealtimeOutboxInput{
		EventID: eventID, CompanyID: input.CompanyID, Scope: scope,
		EventType: QDRatingRealtimeEventType, ResourceType: EntityTypeLogicGate,
		ResourceID: input.LogicGateID, Permission: EntityPermissionEdit, Payload: payload,
	})
}

func cloneQDRating(item domain.QDRating) domain.QDRating {
	if item.RatedByUserID != nil {
		value := *item.RatedByUserID
		item.RatedByUserID = &value
	}
	if item.QualityRating != nil {
		value := *item.QualityRating
		item.QualityRating = &value
	}
	if item.CostRating != nil {
		value := *item.CostRating
		item.CostRating = &value
	}
	if item.DeliveryRating != nil {
		value := *item.DeliveryRating
		item.DeliveryRating = &value
	}
	return item
}
