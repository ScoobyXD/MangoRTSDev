package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const DomainEventListMaxLimit = 1000

type DomainEventReplayQuery struct {
	CompanyID     string
	StreamType    string
	StreamID      string
	AfterSequence int64
	Limit         int
}

type DomainEventStreamQuery struct {
	CompanyID     string
	StreamType    string
	StreamID      string
	EventTypes    []string
	PayloadEquals map[string]string
}

type DomainEventInput struct {
	CompanyID      string
	StreamType     string
	StreamID       string
	Type           string
	ActorUserID    string
	IdempotencyKey string
	Payload        map[string]any
	TimingRecorder TimingRecorder
}

func NormalizeDomainEventListLimit(limit int) int {
	if limit <= 0 || limit > DomainEventListMaxLimit {
		return 100
	}
	return limit
}

func normalizeDomainEventStreamQuery(query DomainEventStreamQuery) (DomainEventStreamQuery, error) {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.StreamType = strings.TrimSpace(query.StreamType)
	query.StreamID = strings.TrimSpace(query.StreamID)
	if query.CompanyID == "" || query.StreamType == "" || query.StreamID == "" {
		return DomainEventStreamQuery{}, ErrInvalid
	}
	if len(query.EventTypes) > 0 {
		eventTypes := make([]string, 0, len(query.EventTypes))
		for _, eventType := range query.EventTypes {
			eventType = strings.TrimSpace(eventType)
			if eventType != "" {
				eventTypes = append(eventTypes, eventType)
			}
		}
		query.EventTypes = eventTypes
	}
	if len(query.PayloadEquals) > 0 {
		payloadEquals := make(map[string]string, len(query.PayloadEquals))
		for key, value := range query.PayloadEquals {
			key = strings.TrimSpace(key)
			if key != "" {
				payloadEquals[key] = value
			}
		}
		query.PayloadEquals = payloadEquals
	}
	return query, nil
}

func domainEventMatchesStreamQuery(item domain.DomainEvent, query DomainEventStreamQuery) bool {
	if item.CompanyID != query.CompanyID || item.StreamType != query.StreamType || item.StreamID != query.StreamID {
		return false
	}
	if len(query.EventTypes) > 0 {
		matched := false
		for _, eventType := range query.EventTypes {
			if item.Type == eventType {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	for key, want := range query.PayloadEquals {
		got, ok := item.Payload[key].(string)
		if !ok || got != want {
			return false
		}
	}
	return true
}

func cloneDomainEventPayload(payload map[string]any) map[string]any {
	if len(payload) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(payload))
	for key, value := range payload {
		out[key] = value
	}
	return out
}

func cloneDomainEvent(item domain.DomainEvent) domain.DomainEvent {
	item.Payload = cloneDomainEventPayload(item.Payload)
	if item.ActorUserID != nil {
		actor := *item.ActorUserID
		item.ActorUserID = &actor
	}
	if item.PublishedTimestamp != nil {
		published := *item.PublishedTimestamp
		item.PublishedTimestamp = &published
	}
	return item
}
