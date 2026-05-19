package store

import "miraeopus/backend/internal/domain"

const DomainEventListMaxLimit = 1000

type DomainEventReplayQuery struct {
	CompanyID     string
	StreamType    string
	StreamID      string
	AfterSequence int64
	Limit         int
}

type DomainEventStreamQuery struct {
	CompanyID  string
	StreamType string
	StreamID   string
}

type DomainEventInput struct {
	CompanyID      string
	StreamType     string
	StreamID       string
	Type           string
	ActorUserID    string
	IdempotencyKey string
	Payload        map[string]any
}

func NormalizeDomainEventListLimit(limit int) int {
	if limit <= 0 || limit > DomainEventListMaxLimit {
		return 100
	}
	return limit
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
