package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
)

func memoryQDRatingDayKey(companyID, logicGateID, businessDate string) string {
	return companyID + ":" + logicGateID + ":" + businessDate
}

func clearMemoryQDRatingUserReferences(items map[string]domain.QDRating, userID string) bool {
	changed := false
	for itemKey, item := range items {
		if item.RatedByUserID == nil || *item.RatedByUserID != userID {
			continue
		}
		item.RatedByUserID = nil
		items[itemKey] = item
		changed = true
	}
	return changed
}

func (r *MemoryRepo) clearQDRatingUserReferencesLocked(userID string) {
	clearMemoryQDRatingUserReferences(r.qdRatings, userID)
	for recordKey, record := range r.recycleBin {
		changed := false
		if len(record.Snapshot.qdRatings) > 0 {
			ratings := cloneMemoryMap(record.Snapshot.qdRatings)
			if clearMemoryQDRatingUserReferences(ratings, userID) {
				record.Snapshot.qdRatings = ratings
				changed = true
			}
		}
		if len(record.Delta.qdRatings) > 0 {
			ratings := cloneMemoryMap(record.Delta.qdRatings)
			if clearMemoryQDRatingUserReferences(ratings, userID) {
				record.Delta.qdRatings = ratings
				changed = true
			}
		}
		if changed {
			r.recycleBin[recordKey] = record
		}
	}
}

func (r *MemoryRepo) ListLogicGateQDRatings(input QDRatingMonthQuery) ([]domain.QDRating, error) {
	input, err := normalizeQDRatingMonthQuery(input)
	if err != nil {
		return nil, err
	}
	start, end, err := qdRatingMonthBounds(input)
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.logicGates[key(input.CompanyID, input.LogicGateID)]; !ok {
		return nil, ErrNotFound
	}
	location, err := qdRatingBusinessLocation()
	if err != nil {
		return nil, err
	}
	items := make([]domain.QDRating, 0)
	for _, item := range r.qdRatings {
		if item.CompanyID != input.CompanyID || item.LogicGateID != input.LogicGateID {
			continue
		}
		created := item.RatedCreatedTimestamp.In(location)
		if !created.Before(start) && created.Before(end) {
			items = append(items, cloneQDRating(item))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].RatedCreatedTimestamp.Equal(items[j].RatedCreatedTimestamp) {
			return items[i].QDRatingID < items[j].QDRatingID
		}
		return items[i].RatedCreatedTimestamp.Before(items[j].RatedCreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) PutLogicGateQDRating(input QDRatingPutInput) (QDRatingMutationResult, error) {
	input, err := normalizeQDRatingPutInput(input)
	if err != nil {
		return QDRatingMutationResult{}, err
	}
	businessDate, err := qdRatingBusinessDate(input.Now)
	if err != nil {
		return QDRatingMutationResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	processMapSnapshot := r.snapshotProcessMapMutationLocked()
	qdSnapshot := cloneMap(r.qdRatings)
	restore := func(err error) (QDRatingMutationResult, error) {
		r.qdRatings = qdSnapshot
		r.restoreProcessMapMutationLocked(processMapSnapshot)
		return QDRatingMutationResult{}, err
	}
	if _, ok := r.logicGates[key(input.CompanyID, input.LogicGateID)]; !ok {
		return QDRatingMutationResult{}, ErrNotFound
	}
	dayKey := memoryQDRatingDayKey(input.CompanyID, input.LogicGateID, businessDate)
	current, exists := r.qdRatings[dayKey]
	if !exists && input.Rating == nil {
		return QDRatingMutationResult{}, nil
	}
	if exists {
		currentValue := current.QualityRating
		if input.Metric == QDRatingMetricCost {
			currentValue = current.CostRating
		} else if input.Metric == QDRatingMetricDelivery {
			currentValue = current.DeliveryRating
		}
		if (currentValue == nil && input.Rating == nil) ||
			(currentValue != nil && input.Rating != nil && *currentValue == *input.Rating) {
			item := cloneQDRating(current)
			return QDRatingMutationResult{QDRating: &item}, nil
		}
	}
	next := current
	if !exists {
		next = domain.QDRating{
			CompanyID: input.CompanyID, QDRatingID: newUUIDv7String(), LogicGateID: input.LogicGateID,
			RatedCreatedTimestamp: input.Now,
		}
	}
	if input.Metric == QDRatingMetricQuality {
		next.QualityRating = input.Rating
	} else if input.Metric == QDRatingMetricCost {
		next.CostRating = input.Rating
	} else {
		next.DeliveryRating = input.Rating
	}
	next.RatedByUserID = &input.RatedByUserID
	next.RatedByDisplayName = input.RatedByDisplayName
	next.RatedUpdatedTimestamp = input.Now
	if next.RatedCreatedTimestamp.IsZero() {
		next.RatedCreatedTimestamp = input.Now
	}
	eventID := newUUIDv7String()
	outbox, err := qdRatingRealtimeOutboxInput(input, eventID)
	if err != nil {
		return QDRatingMutationResult{}, err
	}
	if _, err := r.enqueueRealtimeOutboxLocked(outbox); err != nil {
		return restore(err)
	}
	eventInput := workspaceDomainEventInput(input.CompanyID, QDRatingRealtimeEventType, map[string]any{"logic_gate_id": input.LogicGateID})
	eventInput.ActorUserID = input.RatedByUserID
	if _, err := r.appendDomainEventLocked(eventInput); err != nil {
		return restore(err)
	}
	if next.QualityRating == nil && next.CostRating == nil && next.DeliveryRating == nil {
		delete(r.qdRatings, dayKey)
		return QDRatingMutationResult{Changed: true}, nil
	}
	r.qdRatings[dayKey] = cloneQDRating(next)
	result := cloneQDRating(next)
	return QDRatingMutationResult{QDRating: &result, Changed: true}, nil
}
