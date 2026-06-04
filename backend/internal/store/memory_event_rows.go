package store

import (
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) AppendEventRow(input EventRowInput) (EventRow, error) {
	rows, err := r.AppendEventRows([]EventRowInput{input})
	if err != nil {
		return EventRow{}, err
	}
	if len(rows) == 0 {
		return EventRow{}, ErrInvalid
	}
	return rows[0], nil
}

func (r *MemoryRepo) AppendEventRows(inputs []EventRowInput) ([]EventRow, error) {
	if len(inputs) == 0 {
		return []EventRow{}, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.appendEventRowsLocked(inputs)
}

func (r *MemoryRepo) appendEventRowsLocked(inputs []EventRowInput) ([]EventRow, error) {
	rows := make([]EventRow, 0, len(inputs))
	for _, input := range inputs {
		row, err := r.appendEventRowLocked(input)
		if err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func (r *MemoryRepo) appendEventRowLocked(input EventRowInput) (EventRow, error) {
	if r.eventRowAppendErr != nil {
		return EventRow{}, r.eventRowAppendErr
	}
	input, err := NormalizeEventRowInput(input)
	if err != nil {
		return EventRow{}, err
	}
	if input.IdempotencyKey != "" {
		for _, row := range r.eventRows {
			if row.CompanyID == input.CompanyID && row.IdempotencyKey == input.IdempotencyKey {
				return cloneEventRow(row), nil
			}
		}
	}
	now := time.Now().UTC()
	availableAt := input.AvailableAt
	if availableAt.IsZero() {
		availableAt = now
	}
	sequence := r.nextEventRowSequenceLocked(input.CompanyID, input.SequenceScope)
	row := EventRow{
		EventID:          newUUIDv7String(),
		CompanyID:        input.CompanyID,
		EventType:        input.EventType,
		ResourceType:     input.ResourceType,
		ResourceID:       input.ResourceID,
		PrimaryScope:     input.PrimaryScope,
		AffectedScopes:   append([]string{}, input.AffectedScopes...),
		ActorUserID:      input.ActorUserID,
		IdempotencyKey:   input.IdempotencyKey,
		SequenceScope:    input.SequenceScope,
		Sequence:         sequence,
		Payload:          cloneEventPayload(input.Payload),
		CreatedTimestamp: now,
		AvailableAt:      availableAt,
	}
	r.eventRows[eventRowMemoryKey(row.CompanyID, row.EventID)] = row
	return cloneEventRow(row), nil
}

func (r *MemoryRepo) nextEventRowSequenceLocked(companyID, sequenceScope string) int64 {
	var sequence int64
	for _, row := range r.eventRows {
		if row.CompanyID == companyID && row.SequenceScope == sequenceScope && row.Sequence > sequence {
			sequence = row.Sequence
		}
	}
	return sequence + 1
}

func (r *MemoryRepo) ListEventRows(companyID string, limit int) ([]EventRow, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	limit = NormalizeEventRowListLimit(limit)
	r.mu.RLock()
	defer r.mu.RUnlock()

	rows := make([]EventRow, 0)
	for _, row := range r.eventRows {
		if row.CompanyID == companyID {
			rows = append(rows, cloneEventRow(row))
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if !rows[i].CreatedTimestamp.Equal(rows[j].CreatedTimestamp) {
			return rows[i].CreatedTimestamp.Before(rows[j].CreatedTimestamp)
		}
		return rows[i].EventID < rows[j].EventID
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

func (r *MemoryRepo) ClaimAvailableEventRows(limit int, processingLeaseTimeout time.Duration) ([]EventRow, error) {
	limit = NormalizeEventRowListLimit(limit)
	processingLeaseTimeout = NormalizeEventRowProcessingLeaseTimeout(processingLeaseTimeout)
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	staleBefore := now.Add(-processingLeaseTimeout)
	candidates := make([]EventRow, 0)
	for _, row := range r.eventRows {
		if row.ProcessedAt != nil || row.AvailableAt.After(now) {
			continue
		}
		if row.ProcessingStartedAt != nil && !row.ProcessingStartedAt.Before(staleBefore) {
			continue
		}
		candidates = append(candidates, row)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if !candidates[i].AvailableAt.Equal(candidates[j].AvailableAt) {
			return candidates[i].AvailableAt.Before(candidates[j].AvailableAt)
		}
		if !candidates[i].CreatedTimestamp.Equal(candidates[j].CreatedTimestamp) {
			return candidates[i].CreatedTimestamp.Before(candidates[j].CreatedTimestamp)
		}
		return candidates[i].EventID < candidates[j].EventID
	})
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	claimedAt := now
	rows := make([]EventRow, 0, len(candidates))
	for _, row := range candidates {
		row.ProcessingStartedAt = &claimedAt
		row.AttemptCount++
		r.eventRows[eventRowMemoryKey(row.CompanyID, row.EventID)] = row
		rows = append(rows, cloneEventRow(row))
	}
	return rows, nil
}

func (r *MemoryRepo) MarkEventRowProcessed(companyID, eventID string) error {
	companyID = strings.TrimSpace(companyID)
	eventID = strings.TrimSpace(eventID)
	if companyID == "" || eventID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	key := eventRowMemoryKey(companyID, eventID)
	row, ok := r.eventRows[key]
	if !ok {
		return ErrNotFound
	}
	processedAt := time.Now().UTC()
	row.ProcessedAt = &processedAt
	row.ProcessingStartedAt = nil
	row.LastError = ""
	r.eventRows[key] = row
	return nil
}

func (r *MemoryRepo) MarkEventRowFailed(companyID, eventID, lastError string, availableAt time.Time) error {
	companyID = strings.TrimSpace(companyID)
	eventID = strings.TrimSpace(eventID)
	if companyID == "" || eventID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	key := eventRowMemoryKey(companyID, eventID)
	row, ok := r.eventRows[key]
	if !ok {
		return ErrNotFound
	}
	if availableAt.IsZero() {
		availableAt = time.Now().UTC().Add(time.Second)
	}
	row.ProcessingStartedAt = nil
	row.AvailableAt = availableAt.UTC()
	row.LastError = strings.TrimSpace(lastError)
	r.eventRows[key] = row
	return nil
}

func eventRowMemoryKey(companyID, eventID string) string {
	return companyID + ":" + eventID
}

func cloneEventRow(row EventRow) EventRow {
	row.AffectedScopes = append([]string{}, row.AffectedScopes...)
	row.Payload = cloneEventPayload(row.Payload)
	if row.ProcessingStartedAt != nil {
		value := *row.ProcessingStartedAt
		row.ProcessingStartedAt = &value
	}
	if row.ProcessedAt != nil {
		value := *row.ProcessedAt
		row.ProcessedAt = &value
	}
	return row
}

func cloneEventPayload(payload map[string]any) map[string]any {
	if len(payload) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(payload))
	for key, value := range payload {
		out[key] = value
	}
	return out
}
