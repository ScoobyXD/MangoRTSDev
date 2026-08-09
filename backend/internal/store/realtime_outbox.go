package store

import (
	"encoding/json"
	"strings"
	"time"
)

const (
	RealtimeOutboxPayloadMaxBytes = 256 * 1024
	RealtimeOutboxClaimMaxLimit   = 250
)

type RealtimeOutboxInput struct {
	EventID            string
	CompanyID          string
	Scope              string
	EventType          string
	ResourceType       string
	ResourceID         string
	Permission         string
	ResourceRevision   int64
	Payload            json.RawMessage
	AllowedUserIDs     []string
	AudienceRestricted bool
}

type RealtimeOutboxEvent struct {
	Sequence           int64
	EventID            string
	CompanyID          string
	Scope              string
	EventType          string
	ResourceType       string
	ResourceID         string
	Permission         string
	ResourceRevision   int64
	Payload            json.RawMessage
	AllowedUserIDs     []string
	AudienceRestricted bool
	AttemptCount       int
	ClaimToken         string
	ClaimExpiresAt     *time.Time
	PublishedTimestamp *time.Time
	CreatedTimestamp   time.Time
	LastErrorCategory  string
}

type RealtimeOutboxClaimQuery struct {
	Limit         int
	LeaseDuration time.Duration
}

func normalizeRealtimeOutboxInput(input RealtimeOutboxInput) (RealtimeOutboxInput, error) {
	input.EventID = strings.TrimSpace(input.EventID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.Scope = strings.TrimSpace(input.Scope)
	input.EventType = strings.TrimSpace(input.EventType)
	input.ResourceType = strings.TrimSpace(input.ResourceType)
	input.ResourceID = strings.TrimSpace(input.ResourceID)
	input.Permission = strings.TrimSpace(input.Permission)
	if input.CompanyID == "" || input.Scope == "" || input.EventType == "" || len(input.Scope) > 384 ||
		input.ResourceRevision < 0 || len(input.Payload) == 0 || len(input.Payload) > RealtimeOutboxPayloadMaxBytes || !json.Valid(input.Payload) {
		return RealtimeOutboxInput{}, ErrInvalid
	}
	seen := map[string]struct{}{}
	allowed := make([]string, 0, len(input.AllowedUserIDs))
	for _, userID := range input.AllowedUserIDs {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			continue
		}
		if _, exists := seen[userID]; exists {
			continue
		}
		seen[userID] = struct{}{}
		allowed = append(allowed, userID)
	}
	input.AllowedUserIDs = allowed
	input.Payload = append(json.RawMessage(nil), input.Payload...)
	return input, nil
}

func normalizeRealtimeOutboxInputs(inputs []RealtimeOutboxInput) ([]RealtimeOutboxInput, error) {
	normalized := make([]RealtimeOutboxInput, 0, len(inputs))
	for _, input := range inputs {
		item, err := normalizeRealtimeOutboxInput(input)
		if err != nil {
			return nil, err
		}
		normalized = append(normalized, item)
	}
	return normalized, nil
}

func normalizeRealtimeOutboxClaimQuery(query RealtimeOutboxClaimQuery) RealtimeOutboxClaimQuery {
	if query.Limit <= 0 || query.Limit > RealtimeOutboxClaimMaxLimit {
		query.Limit = 100
	}
	if query.LeaseDuration <= 0 {
		query.LeaseDuration = 15 * time.Second
	}
	return query
}

func cloneRealtimeOutboxEvent(item RealtimeOutboxEvent) RealtimeOutboxEvent {
	item.Payload = append(json.RawMessage(nil), item.Payload...)
	item.AllowedUserIDs = append([]string(nil), item.AllowedUserIDs...)
	if item.ClaimExpiresAt != nil {
		value := *item.ClaimExpiresAt
		item.ClaimExpiresAt = &value
	}
	if item.PublishedTimestamp != nil {
		value := *item.PublishedTimestamp
		item.PublishedTimestamp = &value
	}
	return item
}
