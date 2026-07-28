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

func communicationsEmailThreadDownloadJobMatches(item CommunicationsEmailThreadDownloadJob, companyID, emailThreadID, scope, messageID string) bool {
	return item.CompanyID == companyID && item.EmailThreadID == emailThreadID && item.DownloadScope == scope && item.RequestedProviderMessageID == messageID
}

func communicationsEmailThreadDownloadJobActive(status string) bool {
	switch status {
	case CommunicationsEmailThreadDownloadJobPending, CommunicationsEmailThreadDownloadJobProcessing, CommunicationsEmailThreadDownloadJobRetry:
		return true
	default:
		return false
	}
}

func (r *MemoryRepo) ensureCommunicationsEmailThreadDownloadJobLocked(companyID, emailThreadID, downloadScope, requestedProviderMessageID, requestedByUserID string) (CommunicationsEmailThreadDownloadJob, bool, error) {
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	downloadScope = normalizeCommunicationsEmailThreadDownloadScope(downloadScope)
	requestedProviderMessageID = strings.TrimSpace(requestedProviderMessageID)
	requestedByUserID = cleanUUIDText(requestedByUserID)
	if companyID == "" || emailThreadID == "" || downloadScope == "" || requestedByUserID == "" || (downloadScope == CommunicationsEmailThreadDownloadScopeMessage && requestedProviderMessageID == "") {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrInvalid
	}
	threadKey := key(companyID, emailThreadID)
	thread, ok := r.emailThreads[threadKey]
	if !ok {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrNotFound
	}
	for _, item := range r.emailThreadDownloadJobs {
		if communicationsEmailThreadDownloadJobMatches(item, companyID, emailThreadID, downloadScope, requestedProviderMessageID) && communicationsEmailThreadDownloadJobActive(item.Status) {
			return cloneCommunicationsEmailThreadDownloadJob(item), false, nil
		}
	}
	now := time.Now().UTC()
	item := CommunicationsEmailThreadDownloadJob{
		DownloadJobID: newUUIDv7String(), CompanyID: companyID, EmailThreadID: emailThreadID,
		DownloadScope: downloadScope, RequestedProviderMessageID: requestedProviderMessageID, RequestedByUserID: requestedByUserID,
		Status: CommunicationsEmailThreadDownloadJobPending, AvailableAt: now, CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	r.emailThreadDownloadJobs[item.DownloadJobID] = item
	thread.DownloadStatus = CommunicationsEmailThreadDownloadDownloading
	thread.LastDownloadError = ""
	thread.UpdatedTimestamp = now
	r.emailThreads[threadKey] = thread
	return cloneCommunicationsEmailThreadDownloadJob(item), true, nil
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
		if candidates[i].AvailableAt.Equal(candidates[j].AvailableAt) {
			return candidates[i].CreatedTimestamp.Before(candidates[j].CreatedTimestamp)
		}
		return candidates[i].AvailableAt.Before(candidates[j].AvailableAt)
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
	item.UpdatedTimestamp = now
	r.emailThreadDownloadJobs[downloadJobID] = item
	threadKey := key(item.CompanyID, item.EmailThreadID)
	thread := r.emailThreads[threadKey]
	thread.DownloadStatus = CommunicationsEmailThreadDownloadPartial
	if thread.HistoryComplete {
		thread.DownloadStatus = CommunicationsEmailThreadDownloadComplete
	}
	for _, candidate := range r.emailThreadDownloadJobs {
		if candidate.CompanyID == item.CompanyID &&
			candidate.EmailThreadID == item.EmailThreadID &&
			communicationsEmailThreadDownloadJobActive(candidate.Status) {
			thread.DownloadStatus = CommunicationsEmailThreadDownloadDownloading
			break
		}
	}
	thread.LastDownloadError = ""
	thread.UpdatedTimestamp = now
	r.emailThreads[threadKey] = thread
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
	if final {
		item.Status = CommunicationsEmailThreadDownloadJobFailed
		item.FailedTimestamp = &now
	}
	r.emailThreadDownloadJobs[downloadJobID] = item
	threadKey := key(item.CompanyID, item.EmailThreadID)
	thread := r.emailThreads[threadKey]
	thread.DownloadStatus = CommunicationsEmailThreadDownloadDownloading
	if final {
		thread.DownloadStatus = CommunicationsEmailThreadDownloadFailed
	}
	thread.LastDownloadError = lastError
	thread.UpdatedTimestamp = now
	r.emailThreads[threadKey] = thread
	return nil
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
