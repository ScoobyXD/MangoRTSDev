package store

import (
	"slices"
	"strings"
	"time"
)

func (r *MemoryRepo) EnqueueRealtimeOutbox(input RealtimeOutboxInput) (RealtimeOutboxEvent, error) {
	input, err := normalizeRealtimeOutboxInput(input)
	if err != nil {
		return RealtimeOutboxEvent{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.enqueueRealtimeOutboxLocked(input)
}

func (r *MemoryRepo) enqueueRealtimeOutboxLocked(input RealtimeOutboxInput) (RealtimeOutboxEvent, error) {
	if input.EventID == "" {
		input.EventID = newUUIDv7String()
	}
	if existing, ok := r.realtimeOutbox[input.EventID]; ok {
		return cloneRealtimeOutboxEvent(existing), nil
	}
	r.realtimeOutboxSequence++
	item := RealtimeOutboxEvent{
		Sequence: r.realtimeOutboxSequence, EventID: input.EventID, CompanyID: input.CompanyID,
		Scope: input.Scope, EventType: input.EventType, ResourceType: input.ResourceType,
		ResourceID: input.ResourceID, Permission: input.Permission, ResourceRevision: input.ResourceRevision,
		Payload: append([]byte(nil), input.Payload...), AllowedUserIDs: append([]string(nil), input.AllowedUserIDs...), AudienceRestricted: input.AudienceRestricted,
		CreatedTimestamp: time.Now().UTC(),
	}
	r.realtimeOutbox[item.EventID] = item
	return cloneRealtimeOutboxEvent(item), nil
}

func (r *MemoryRepo) ClaimRealtimeOutbox(query RealtimeOutboxClaimQuery) ([]RealtimeOutboxEvent, error) {
	query = normalizeRealtimeOutboxClaimQuery(query)
	now := time.Now().UTC()
	r.mu.Lock()
	defer r.mu.Unlock()
	candidates := make([]RealtimeOutboxEvent, 0)
	for _, item := range r.realtimeOutbox {
		if item.PublishedTimestamp != nil || (item.ClaimExpiresAt != nil && item.ClaimExpiresAt.After(now)) {
			continue
		}
		candidates = append(candidates, item)
	}
	slices.SortFunc(candidates, func(left, right RealtimeOutboxEvent) int {
		if left.Sequence < right.Sequence {
			return -1
		}
		if left.Sequence > right.Sequence {
			return 1
		}
		return strings.Compare(left.EventID, right.EventID)
	})
	if len(candidates) > query.Limit {
		candidates = candidates[:query.Limit]
	}
	claimed := make([]RealtimeOutboxEvent, 0, len(candidates))
	for _, item := range candidates {
		item.ClaimToken = newUUIDv7String()
		expires := now.Add(query.LeaseDuration)
		item.ClaimExpiresAt = &expires
		item.AttemptCount++
		r.realtimeOutbox[item.EventID] = item
		claimed = append(claimed, cloneRealtimeOutboxEvent(item))
	}
	return claimed, nil
}

func (r *MemoryRepo) MarkRealtimeOutboxPublished(eventID, claimToken string) error {
	eventID, claimToken = strings.TrimSpace(eventID), strings.TrimSpace(claimToken)
	if eventID == "" || claimToken == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.realtimeOutbox[eventID]
	if !ok {
		return ErrNotFound
	}
	if item.ClaimToken != claimToken {
		return ErrVersionConflict
	}
	now := time.Now().UTC()
	item.PublishedTimestamp, item.ClaimToken, item.ClaimExpiresAt, item.LastErrorCategory = &now, "", nil, ""
	r.realtimeOutbox[eventID] = item
	return nil
}

func (r *MemoryRepo) MarkRealtimeOutboxFailed(eventID, claimToken, category string) error {
	eventID, claimToken, category = strings.TrimSpace(eventID), strings.TrimSpace(claimToken), strings.TrimSpace(category)
	if eventID == "" || claimToken == "" {
		return ErrInvalid
	}
	if len(category) > 120 {
		category = category[:120]
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.realtimeOutbox[eventID]
	if !ok {
		return ErrNotFound
	}
	if item.ClaimToken != claimToken {
		return ErrVersionConflict
	}
	item.ClaimToken, item.ClaimExpiresAt, item.LastErrorCategory = "", nil, category
	r.realtimeOutbox[eventID] = item
	return nil
}

func (r *MemoryRepo) ListPublishedRealtimeOutboxAfter(sequence int64, limit int) ([]RealtimeOutboxEvent, error) {
	if sequence < 0 {
		return nil, ErrInvalid
	}
	if limit <= 0 || limit > RealtimeOutboxClaimMaxLimit {
		limit = 100
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	safeSequence := r.contiguousPublishedRealtimeOutboxSequenceLocked()
	items := make([]RealtimeOutboxEvent, 0)
	for _, item := range r.realtimeOutbox {
		if item.Sequence > sequence && item.Sequence <= safeSequence && item.PublishedTimestamp != nil {
			items = append(items, cloneRealtimeOutboxEvent(item))
		}
	}
	slices.SortFunc(items, func(left, right RealtimeOutboxEvent) int {
		if left.Sequence < right.Sequence {
			return -1
		}
		if left.Sequence > right.Sequence {
			return 1
		}
		return strings.Compare(left.EventID, right.EventID)
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (r *MemoryRepo) CurrentPublishedRealtimeOutboxSequence() (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.contiguousPublishedRealtimeOutboxSequenceLocked(), nil
}

func (r *MemoryRepo) contiguousPublishedRealtimeOutboxSequenceLocked() int64 {
	if r.realtimeOutboxSequence == 0 {
		return 0
	}
	safeSequence := r.realtimeOutboxSequence
	for _, item := range r.realtimeOutbox {
		if item.PublishedTimestamp == nil && item.Sequence <= safeSequence {
			safeSequence = item.Sequence - 1
		}
	}
	return safeSequence
}
