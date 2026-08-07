package store

import (
	"sort"
	"strings"
	"time"
)

const (
	defaultCommunicationsEmailThreadDownloadClaimLimit = 10
	maxCommunicationsEmailThreadDownloadClaimLimit     = 100
	defaultCommunicationsEmailThreadDownloadLease      = 2 * time.Minute
)

func NormalizeCommunicationsEmailThreadDownloadClaimLimit(limit int) int {
	if limit <= 0 {
		return defaultCommunicationsEmailThreadDownloadClaimLimit
	}
	if limit > maxCommunicationsEmailThreadDownloadClaimLimit {
		return maxCommunicationsEmailThreadDownloadClaimLimit
	}
	return limit
}

func NormalizeCommunicationsEmailThreadDownloadLease(value time.Duration) time.Duration {
	if value <= 0 {
		return defaultCommunicationsEmailThreadDownloadLease
	}
	return value
}

func cloneCommunicationsEmailThreadDownloadJob(item CommunicationsEmailThreadDownloadJob) CommunicationsEmailThreadDownloadJob {
	if item.ProcessingStartedAt != nil {
		value := *item.ProcessingStartedAt
		item.ProcessingStartedAt = &value
	}
	if item.CompletedTimestamp != nil {
		value := *item.CompletedTimestamp
		item.CompletedTimestamp = &value
	}
	if item.FailedTimestamp != nil {
		value := *item.FailedTimestamp
		item.FailedTimestamp = &value
	}
	return item
}

func communicationsEmailThreadDownloadJobActive(status string) bool {
	switch status {
	case CommunicationsEmailThreadDownloadJobPending, CommunicationsEmailThreadDownloadJobProcessing, CommunicationsEmailThreadDownloadJobRetry:
		return true
	default:
		return false
	}
}

func (r *MemoryRepo) ensureCommunicationsEmailIngestionJobLocked(input CommunicationsEmailIngestionJobInput) (CommunicationsEmailThreadDownloadJob, bool, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.EmailConnectionID = cleanUUIDText(input.EmailConnectionID)
	input.EmailThreadID = cleanUUIDText(input.EmailThreadID)
	input.ProviderMessageID = strings.TrimSpace(input.ProviderMessageID)
	input.ProviderThreadID = strings.TrimSpace(input.ProviderThreadID)
	input.Priority = normalizeCommunicationsEmailIngestionPriority(input.Priority)
	if input.CompanyID == "" || input.EmailConnectionID == "" || input.ProviderMessageID == "" || input.Priority == 0 {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrInvalid
	}
	if input.EmailThreadID != "" {
		thread, ok := r.emailThreads[key(input.CompanyID, input.EmailThreadID)]
		if !ok {
			return CommunicationsEmailThreadDownloadJob{}, false, ErrNotFound
		}
		if input.ProviderThreadID == "" {
			input.ProviderThreadID = thread.ProviderThreadID
		}
	}
	for jobID, item := range r.emailThreadDownloadJobs {
		if item.CompanyID == input.CompanyID && item.EmailConnectionID == input.EmailConnectionID &&
			item.ProviderMessageID == input.ProviderMessageID && communicationsEmailThreadDownloadJobActive(item.Status) {
			if input.Priority < item.Priority {
				item.Priority = input.Priority
			}
			if item.EmailThreadID == "" {
				item.EmailThreadID = input.EmailThreadID
			}
			if item.ProviderThreadID == "" {
				item.ProviderThreadID = input.ProviderThreadID
			}
			item.UpdatedTimestamp = time.Now().UTC()
			r.emailThreadDownloadJobs[jobID] = item
			return cloneCommunicationsEmailThreadDownloadJob(item), false, nil
		}
	}
	var completed *CommunicationsEmailThreadDownloadJob
	for _, item := range r.emailThreadDownloadJobs {
		if item.CompanyID != input.CompanyID || item.EmailConnectionID != input.EmailConnectionID ||
			item.ProviderMessageID != input.ProviderMessageID || item.Status != CommunicationsEmailThreadDownloadJobCompleted {
			continue
		}
		if completed == nil || item.UpdatedTimestamp.After(completed.UpdatedTimestamp) {
			copy := item
			completed = &copy
		}
	}
	if completed != nil {
		return cloneCommunicationsEmailThreadDownloadJob(*completed), false, nil
	}
	now := time.Now().UTC()
	item := CommunicationsEmailThreadDownloadJob{
		DownloadJobID: newUUIDv7String(), CompanyID: input.CompanyID,
		EmailConnectionID: input.EmailConnectionID, EmailThreadID: input.EmailThreadID,
		ProviderMessageID: input.ProviderMessageID, ProviderThreadID: input.ProviderThreadID,
		Priority: input.Priority, Status: CommunicationsEmailThreadDownloadJobPending,
		AvailableAt: now, CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	r.emailThreadDownloadJobs[item.DownloadJobID] = item
	if input.EmailThreadID != "" {
		threadKey := key(input.CompanyID, input.EmailThreadID)
		thread := r.emailThreads[threadKey]
		thread.DownloadStatus = CommunicationsEmailThreadDownloadDownloading
		thread.LastDownloadError = ""
		thread.UpdatedTimestamp = now
		r.emailThreads[threadKey] = thread
	}
	return cloneCommunicationsEmailThreadDownloadJob(item), true, nil
}

func (r *MemoryRepo) EnsureCommunicationsEmailIngestionJob(input CommunicationsEmailIngestionJobInput) (CommunicationsEmailThreadDownloadJob, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ensureCommunicationsEmailIngestionJobLocked(input)
}

func (r *MemoryRepo) ensureCommunicationsEmailThreadDownloadJobLocked(companyID, emailThreadID, downloadScope, requestedProviderMessageID, requestedByUserID string) (CommunicationsEmailThreadDownloadJob, bool, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	downloadScope = normalizeCommunicationsEmailThreadDownloadScope(downloadScope)
	requestedProviderMessageID = strings.TrimSpace(requestedProviderMessageID)
	requestedByUserID = cleanUUIDText(requestedByUserID)
	if companyID == "" || emailThreadID == "" || downloadScope == "" || requestedByUserID == "" {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrInvalid
	}
	thread, ok := r.emailThreads[key(companyID, emailThreadID)]
	if !ok {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrNotFound
	}
	if requestedProviderMessageID == "" {
		requestedProviderMessageID = thread.RootProviderMessageID
	}
	if requestedProviderMessageID == "" {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrInvalid
	}
	connectionID := thread.EmailConnectionID
	if connectionID == "" {
		connectionID = r.emailConnectionIDForThreadLocked(thread)
	}
	return r.ensureCommunicationsEmailIngestionJobLocked(CommunicationsEmailIngestionJobInput{
		CompanyID: companyID, EmailConnectionID: connectionID, EmailThreadID: emailThreadID,
		ProviderMessageID: requestedProviderMessageID, ProviderThreadID: thread.ProviderThreadID,
		Priority: CommunicationsEmailIngestionPriorityVisible,
	})
}

func (r *MemoryRepo) EnsureCommunicationsEmailThreadDownloadJob(companyID, emailThreadID, downloadScope, requestedProviderMessageID, requestedByUserID string) (CommunicationsEmailThreadDownloadJob, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ensureCommunicationsEmailThreadDownloadJobLocked(companyID, emailThreadID, downloadScope, requestedProviderMessageID, requestedByUserID)
}

func (r *MemoryRepo) ClaimCommunicationsEmailThreadDownloadJobs(limit int, processingLeaseTimeout time.Duration) ([]CommunicationsEmailThreadDownloadJob, error) {
	limit = NormalizeCommunicationsEmailThreadDownloadClaimLimit(limit)
	processingLeaseTimeout = NormalizeCommunicationsEmailThreadDownloadLease(processingLeaseTimeout)
	now := time.Now().UTC()
	staleBefore := now.Add(-processingLeaseTimeout)
	r.mu.Lock()
	defer r.mu.Unlock()
	candidates := make([]CommunicationsEmailThreadDownloadJob, 0)
	for _, item := range r.emailThreadDownloadJobs {
		claimable := (item.Status == CommunicationsEmailThreadDownloadJobPending || item.Status == CommunicationsEmailThreadDownloadJobRetry) && !item.AvailableAt.After(now)
		claimable = claimable || (item.Status == CommunicationsEmailThreadDownloadJobProcessing && item.ProcessingStartedAt != nil && item.ProcessingStartedAt.Before(staleBefore))
		if claimable {
			candidates = append(candidates, item)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Priority != candidates[j].Priority {
			return candidates[i].Priority < candidates[j].Priority
		}
		if !candidates[i].AvailableAt.Equal(candidates[j].AvailableAt) {
			return candidates[i].AvailableAt.Before(candidates[j].AvailableAt)
		}
		return candidates[i].CreatedTimestamp.Before(candidates[j].CreatedTimestamp)
	})
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	out := make([]CommunicationsEmailThreadDownloadJob, 0, len(candidates))
	for _, item := range candidates {
		item.Status = CommunicationsEmailThreadDownloadJobProcessing
		item.AttemptCount++
		item.ProcessingStartedAt = &now
		item.UpdatedTimestamp = now
		r.emailThreadDownloadJobs[item.DownloadJobID] = item
		out = append(out, cloneCommunicationsEmailThreadDownloadJob(item))
	}
	return out, nil
}

func (r *MemoryRepo) MarkCommunicationsEmailThreadDownloadJobCompleted(downloadJobID string) error {
	downloadJobID = cleanUUIDText(downloadJobID)
	if downloadJobID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.emailThreadDownloadJobs[downloadJobID]
	if !ok {
		return ErrNotFound
	}
	now := time.Now().UTC()
	item.Status = CommunicationsEmailThreadDownloadJobCompleted
	item.LastError = ""
	item.CompletedTimestamp = &now
	item.FailedTimestamp = nil
	item.ProcessingStartedAt = nil
	item.UpdatedTimestamp = now
	r.emailThreadDownloadJobs[downloadJobID] = item
	r.updateMemoryEmailThreadDownloadStatusLocked(item, now, false)
	return nil
}

func (r *MemoryRepo) MarkCommunicationsEmailThreadDownloadJobFailed(downloadJobID, lastError string, availableAt time.Time, final bool) error {
	downloadJobID = cleanUUIDText(downloadJobID)
	lastError = strings.TrimSpace(lastError)
	if downloadJobID == "" || lastError == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.emailThreadDownloadJobs[downloadJobID]
	if !ok {
		return ErrNotFound
	}
	now := time.Now().UTC()
	item.Status = CommunicationsEmailThreadDownloadJobRetry
	item.AvailableAt = availableAt.UTC()
	item.LastError = lastError
	item.ProcessingStartedAt = nil
	item.UpdatedTimestamp = now
	if lastError == "email_connection_reauth_required" && item.AttemptCount > 0 {
		item.AttemptCount--
	}
	if final {
		item.Status = CommunicationsEmailThreadDownloadJobFailed
		item.FailedTimestamp = &now
	}
	r.emailThreadDownloadJobs[downloadJobID] = item
	r.updateMemoryEmailThreadDownloadStatusLocked(item, now, final)
	return nil
}

func (r *MemoryRepo) updateMemoryEmailThreadDownloadStatusLocked(item CommunicationsEmailThreadDownloadJob, now time.Time, final bool) {
	if item.EmailThreadID == "" {
		return
	}
	threadKey := key(item.CompanyID, item.EmailThreadID)
	thread, ok := r.emailThreads[threadKey]
	if !ok {
		return
	}
	thread.DownloadStatus = CommunicationsEmailThreadDownloadPartial
	if thread.HistoryComplete {
		thread.DownloadStatus = CommunicationsEmailThreadDownloadComplete
	}
	if final {
		thread.DownloadStatus = CommunicationsEmailThreadDownloadFailed
	}
	for _, candidate := range r.emailThreadDownloadJobs {
		if candidate.CompanyID == item.CompanyID && candidate.EmailThreadID == item.EmailThreadID && communicationsEmailThreadDownloadJobActive(candidate.Status) {
			thread.DownloadStatus = CommunicationsEmailThreadDownloadDownloading
			break
		}
	}
	thread.LastDownloadError = item.LastError
	if item.Status == CommunicationsEmailThreadDownloadJobCompleted {
		thread.LastDownloadError = ""
	}
	thread.UpdatedTimestamp = now
	r.emailThreads[threadKey] = thread
}

func (r *MemoryRepo) ListCommunicationsEmailThreadDownloadJobs(companyID, emailThreadID string) ([]CommunicationsEmailThreadDownloadJob, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	if companyID == "" || emailThreadID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.emailThreads[key(companyID, emailThreadID)]; !ok {
		return nil, ErrNotFound
	}
	out := []CommunicationsEmailThreadDownloadJob{}
	for _, item := range r.emailThreadDownloadJobs {
		if item.CompanyID == companyID && item.EmailThreadID == emailThreadID {
			out = append(out, cloneCommunicationsEmailThreadDownloadJob(item))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedTimestamp.Before(out[j].CreatedTimestamp) })
	return out, nil
}

func (r *MemoryRepo) ListCommunicationsEmailThreadNodeIDs(companyID, emailThreadID string) ([]string, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	if companyID == "" || emailThreadID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	seen := map[string]bool{}
	out := []string{}
	for _, item := range r.nodeEmailThreads {
		if item.CompanyID == companyID && item.EmailThreadID == emailThreadID && !seen[item.NodeID] {
			seen[item.NodeID] = true
			out = append(out, item.NodeID)
		}
	}
	if len(out) == 0 {
		return nil, ErrNotFound
	}
	sort.Strings(out)
	return out, nil
}
