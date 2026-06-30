package store

import (
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) CreateCommunicationsArchiveJob(input CommunicationsArchiveJobInput) (CommunicationsArchiveJob, error) {
	input, err := NormalizeCommunicationsArchiveJobInput(input)
	if err != nil {
		return CommunicationsArchiveJob{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.userIDExistsLocked(input.ActorUserID) {
		return CommunicationsArchiveJob{}, ErrNotFound
	}

	now := time.Now().UTC()
	job := CommunicationsArchiveJob{
		JobID:                    newUUIDv7String(),
		ActorUserID:              input.ActorUserID,
		CompanyID:                input.CompanyID,
		SharedInboxID:            input.SharedInboxID,
		ConnectionScope:          input.Connection.Scope,
		Provider:                 input.Connection.Provider,
		AccountEmail:             input.Connection.AccountEmail,
		GrantID:                  input.Connection.GrantID,
		CompanyEmailConnectionID: input.Connection.CompanyEmailConnectionID,
		Status:                   CommunicationsArchiveJobStatusPending,
		RequestedCount:           len(input.MessageIDs),
		AcceptedMessageIDs:       append([]string(nil), input.MessageIDs...),
		CreatedTimestamp:         now,
		UpdatedTimestamp:         now,
	}
	r.communicationsArchiveJobs[job.JobID] = job

	for _, messageID := range input.MessageIDs {
		if r.activeCommunicationsArchiveJobItemExistsLocked(job, messageID) {
			continue
		}
		item := CommunicationsArchiveJobItem{
			JobItemID:                newUUIDv7String(),
			JobID:                    job.JobID,
			ActorUserID:              job.ActorUserID,
			CompanyID:                job.CompanyID,
			SharedInboxID:            job.SharedInboxID,
			ConnectionScope:          job.ConnectionScope,
			Provider:                 job.Provider,
			AccountEmail:             job.AccountEmail,
			GrantID:                  job.GrantID,
			CompanyEmailConnectionID: job.CompanyEmailConnectionID,
			MessageID:                messageID,
			Status:                   CommunicationsArchiveJobItemStatusPending,
			AvailableAt:              now,
			CreatedTimestamp:         now,
			UpdatedTimestamp:         now,
		}
		r.communicationsArchiveJobItems[item.JobItemID] = item
		job.Items = append(job.Items, CloneCommunicationsArchiveJobItem(item))
		job.CreatedItemCount++
	}
	if job.CreatedItemCount == 0 {
		completedAt := now
		job.Status = CommunicationsArchiveJobStatusCompleted
		job.CompletedTimestamp = &completedAt
	}
	r.communicationsArchiveJobs[job.JobID] = job
	return CloneCommunicationsArchiveJob(job), nil
}

func (r *MemoryRepo) activeCommunicationsArchiveJobItemExistsLocked(job CommunicationsArchiveJob, messageID string) bool {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return false
	}
	for _, item := range r.communicationsArchiveJobItems {
		if item.MessageID != messageID || !CommunicationsArchiveJobItemStatusIsActive(item.Status) {
			continue
		}
		if item.ActorUserID == job.ActorUserID &&
			item.CompanyID == job.CompanyID &&
			item.SharedInboxID == job.SharedInboxID &&
			item.ConnectionScope == job.ConnectionScope &&
			item.AccountEmail == job.AccountEmail {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) ClaimCommunicationsArchiveJobItems(limit int, processingLeaseTimeout time.Duration) ([]CommunicationsArchiveJobItem, error) {
	limit = NormalizeCommunicationsArchiveJobClaimLimit(limit)
	processingLeaseTimeout = NormalizeCommunicationsArchiveJobProcessingLeaseTimeout(processingLeaseTimeout)

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	staleBefore := now.Add(-processingLeaseTimeout)
	candidates := make([]CommunicationsArchiveJobItem, 0)
	for _, item := range r.communicationsArchiveJobItems {
		if item.Status != CommunicationsArchiveJobItemStatusPending && item.Status != CommunicationsArchiveJobItemStatusRetry && item.Status != CommunicationsArchiveJobItemStatusProcessing {
			continue
		}
		if item.AvailableAt.After(now) {
			continue
		}
		if item.Status == CommunicationsArchiveJobItemStatusProcessing && item.ProcessingStartedAt != nil && !item.ProcessingStartedAt.Before(staleBefore) {
			continue
		}
		candidates = append(candidates, item)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if !candidates[i].AvailableAt.Equal(candidates[j].AvailableAt) {
			return candidates[i].AvailableAt.Before(candidates[j].AvailableAt)
		}
		if !candidates[i].CreatedTimestamp.Equal(candidates[j].CreatedTimestamp) {
			return candidates[i].CreatedTimestamp.Before(candidates[j].CreatedTimestamp)
		}
		return candidates[i].JobItemID < candidates[j].JobItemID
	})
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	claimed := make([]CommunicationsArchiveJobItem, 0, len(candidates))
	for _, item := range candidates {
		claimedAt := now
		item.Status = CommunicationsArchiveJobItemStatusProcessing
		item.ProcessingStartedAt = &claimedAt
		item.AttemptCount++
		item.UpdatedTimestamp = now
		r.communicationsArchiveJobItems[item.JobItemID] = item
		claimed = append(claimed, CloneCommunicationsArchiveJobItem(item))
	}
	return claimed, nil
}

func (r *MemoryRepo) MarkCommunicationsArchiveJobItemArchived(jobItemID string) error {
	jobItemID = strings.TrimSpace(jobItemID)
	if jobItemID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.communicationsArchiveJobItems[jobItemID]
	if !ok {
		return ErrNotFound
	}
	now := time.Now().UTC()
	item.Status = CommunicationsArchiveJobItemStatusArchived
	item.LastError = ""
	item.ProcessingStartedAt = nil
	item.ArchivedTimestamp = &now
	item.UpdatedTimestamp = now
	r.communicationsArchiveJobItems[jobItemID] = item
	r.updateCommunicationsArchiveJobStatusLocked(item.JobID, now)
	return nil
}

func (r *MemoryRepo) MarkCommunicationsArchiveJobItemFailed(jobItemID, lastError string, availableAt time.Time, final bool) error {
	jobItemID = strings.TrimSpace(jobItemID)
	if jobItemID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.communicationsArchiveJobItems[jobItemID]
	if !ok {
		return ErrNotFound
	}
	now := time.Now().UTC()
	item.ProcessingStartedAt = nil
	item.LastError = trimEventLastError(lastError)
	item.UpdatedTimestamp = now
	if final {
		item.Status = CommunicationsArchiveJobItemStatusFailed
		item.FailedTimestamp = &now
	} else {
		if availableAt.IsZero() {
			availableAt = now.Add(time.Second)
		}
		item.Status = CommunicationsArchiveJobItemStatusRetry
		item.AvailableAt = availableAt.UTC()
	}
	r.communicationsArchiveJobItems[jobItemID] = item
	r.updateCommunicationsArchiveJobStatusLocked(item.JobID, now)
	return nil
}

func (r *MemoryRepo) ListCommunicationsArchiveJobItems(jobID string) ([]CommunicationsArchiveJobItem, error) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	if _, ok := r.communicationsArchiveJobs[jobID]; !ok {
		return nil, ErrNotFound
	}
	items := make([]CommunicationsArchiveJobItem, 0)
	for _, item := range r.communicationsArchiveJobItems {
		if item.JobID == jobID {
			items = append(items, CloneCommunicationsArchiveJobItem(item))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].JobItemID < items[j].JobItemID
	})
	return items, nil
}

func (r *MemoryRepo) updateCommunicationsArchiveJobStatusLocked(jobID string, now time.Time) {
	job, ok := r.communicationsArchiveJobs[jobID]
	if !ok {
		return
	}
	active := false
	failed := false
	for _, item := range r.communicationsArchiveJobItems {
		if item.JobID != jobID {
			continue
		}
		if CommunicationsArchiveJobItemStatusIsActive(item.Status) {
			active = true
		}
		if item.Status == CommunicationsArchiveJobItemStatusFailed {
			failed = true
		}
	}
	switch {
	case active:
		job.Status = CommunicationsArchiveJobStatusProcessing
		job.CompletedTimestamp = nil
	case failed:
		job.Status = CommunicationsArchiveJobStatusFailed
		if job.CompletedTimestamp == nil {
			completedAt := now
			job.CompletedTimestamp = &completedAt
		}
	default:
		job.Status = CommunicationsArchiveJobStatusCompleted
		if job.CompletedTimestamp == nil {
			completedAt := now
			job.CompletedTimestamp = &completedAt
		}
	}
	job.UpdatedTimestamp = now
	r.communicationsArchiveJobs[jobID] = job
}
