package store

import (
	"context"
	"sort"
	"strings"
	"time"
)

func cloneCommunicationsEmailThreadDownloadJob(item CommunicationsEmailThreadDownloadJob) CommunicationsEmailThreadDownloadJob {
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
	case CommunicationsEmailThreadDownloadJobAccepted, CommunicationsEmailThreadDownloadJobProcessing:
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
	input.EnqueueSourceID = strings.TrimSpace(input.EnqueueSourceID)
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
			item.ProviderMessageID == input.ProviderMessageID {
			if communicationsEmailThreadDownloadJobActive(item.Status) {
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
			}
			return cloneCommunicationsEmailThreadDownloadJob(item), false, nil
		}
	}
	now := time.Now().UTC()
	item := CommunicationsEmailThreadDownloadJob{
		DownloadJobID: newUUIDv7String(), CompanyID: input.CompanyID,
		EmailConnectionID: input.EmailConnectionID, EmailThreadID: input.EmailThreadID,
		ProviderMessageID: input.ProviderMessageID, ProviderThreadID: input.ProviderThreadID,
		Priority: input.Priority, Status: CommunicationsEmailThreadDownloadJobAccepted,
		EnqueueSourceID:  input.EnqueueSourceID,
		CreatedTimestamp: now, UpdatedTimestamp: now,
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

func (r *MemoryRepo) EnsureCommunicationsEmailIngestionJobContext(_ context.Context, input CommunicationsEmailIngestionJobInput) (CommunicationsEmailThreadDownloadJob, bool, error) {
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

func (r *MemoryRepo) EnsureCommunicationsEmailThreadDownloadJobContext(_ context.Context, companyID, emailThreadID, downloadScope, requestedProviderMessageID, requestedByUserID string) (CommunicationsEmailThreadDownloadJob, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ensureCommunicationsEmailThreadDownloadJobLocked(companyID, emailThreadID, downloadScope, requestedProviderMessageID, requestedByUserID)
}

func (r *MemoryRepo) GetCommunicationsEmailIngestionJobContext(_ context.Context, jobID string) (CommunicationsEmailThreadDownloadJob, error) {
	jobID = cleanUUIDText(jobID)
	if jobID == "" {
		return CommunicationsEmailThreadDownloadJob{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.emailThreadDownloadJobs[jobID]
	if !ok {
		return CommunicationsEmailThreadDownloadJob{}, ErrNotFound
	}
	return cloneCommunicationsEmailThreadDownloadJob(item), nil
}

func (r *MemoryRepo) StartCommunicationsEmailIngestionAttemptContext(_ context.Context, jobID string) (CommunicationsEmailThreadDownloadJob, bool, error) {
	jobID = cleanUUIDText(jobID)
	if jobID == "" {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.emailThreadDownloadJobs[jobID]
	if !ok {
		return CommunicationsEmailThreadDownloadJob{}, false, ErrNotFound
	}
	if item.Status != CommunicationsEmailThreadDownloadJobAccepted && item.Status != CommunicationsEmailThreadDownloadJobProcessing {
		return cloneCommunicationsEmailThreadDownloadJob(item), false, nil
	}
	now := time.Now().UTC()
	if item.ProviderAttemptCount >= CommunicationsEmailProviderAttemptLimit {
		item.Status = CommunicationsEmailThreadDownloadJobExhausted
		item.AttemptToken = ""
		item.FailedTimestamp = &now
		item.UpdatedTimestamp = now
		r.emailThreadDownloadJobs[jobID] = item
		return cloneCommunicationsEmailThreadDownloadJob(item), false, nil
	}
	item.ProviderAttemptCount++
	item.Status = CommunicationsEmailThreadDownloadJobProcessing
	item.AttemptToken = newUUIDv7String()
	item.LastError = ""
	item.UpdatedTimestamp = now
	r.emailThreadDownloadJobs[jobID] = item
	return cloneCommunicationsEmailThreadDownloadJob(item), true, nil
}

func (r *MemoryRepo) CompleteCommunicationsEmailIngestionAttemptContext(_ context.Context, downloadJobID, attemptToken string) error {
	downloadJobID = cleanUUIDText(downloadJobID)
	attemptToken = cleanUUIDText(attemptToken)
	if downloadJobID == "" || attemptToken == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.emailThreadDownloadJobs[downloadJobID]
	if !ok {
		return ErrNotFound
	}
	if item.Status != CommunicationsEmailThreadDownloadJobProcessing || item.AttemptToken != attemptToken {
		return ErrNotFound
	}
	now := time.Now().UTC()
	item.Status = CommunicationsEmailThreadDownloadJobCompleted
	item.LastError = ""
	item.CompletedTimestamp = &now
	item.FailedTimestamp = nil
	item.AttemptToken = ""
	item.UpdatedTimestamp = now
	r.emailThreadDownloadJobs[downloadJobID] = item
	r.updateMemoryEmailThreadDownloadStatusLocked(item, now, false)
	return nil
}

func (r *MemoryRepo) FailCommunicationsEmailIngestionAttemptContext(_ context.Context, downloadJobID, attemptToken, lastError string) error {
	downloadJobID = cleanUUIDText(downloadJobID)
	attemptToken = cleanUUIDText(attemptToken)
	lastError = strings.TrimSpace(lastError)
	if downloadJobID == "" || attemptToken == "" || lastError == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.emailThreadDownloadJobs[downloadJobID]
	if !ok {
		return ErrNotFound
	}
	if item.Status != CommunicationsEmailThreadDownloadJobProcessing || item.AttemptToken != attemptToken {
		return ErrNotFound
	}
	now := time.Now().UTC()
	item.Status = CommunicationsEmailThreadDownloadJobAccepted
	item.LastError = lastError
	item.AttemptToken = ""
	item.UpdatedTimestamp = now
	final := item.ProviderAttemptCount >= CommunicationsEmailProviderAttemptLimit
	if final {
		item.Status = CommunicationsEmailThreadDownloadJobExhausted
		item.FailedTimestamp = &now
	}
	r.emailThreadDownloadJobs[downloadJobID] = item
	r.updateMemoryEmailThreadDownloadStatusLocked(item, now, final)
	return nil
}

func (r *MemoryRepo) ParkCommunicationsEmailIngestionAttemptContext(_ context.Context, jobID, attemptToken, connectionStatus, lastError string) error {
	jobID, attemptToken = cleanUUIDText(jobID), cleanUUIDText(attemptToken)
	connectionStatus, lastError = strings.TrimSpace(connectionStatus), strings.TrimSpace(lastError)
	if jobID == "" || attemptToken == "" || lastError == "" ||
		(connectionStatus != "reauth_required" && connectionStatus != "configuration_required") {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.emailThreadDownloadJobs[jobID]
	if !ok || item.Status != CommunicationsEmailThreadDownloadJobProcessing || item.AttemptToken != attemptToken {
		return ErrNotFound
	}
	updatedConnection := false
	for connectionKey, connection := range r.emailConnections {
		if connection.CompanyID == item.CompanyID && connection.EmailConnectionID == item.EmailConnectionID {
			connection.Status = connectionStatus
			connection.UpdatedTimestamp = time.Now().UTC()
			r.emailConnections[connectionKey] = connection
			updatedConnection = true
			break
		}
	}
	if !updatedConnection {
		for connectionKey, connection := range r.companyEmailConnections {
			if connection.CompanyID == item.CompanyID && connection.EmailConnectionID == item.EmailConnectionID {
				connection.Status = connectionStatus
				connection.UpdatedTimestamp = time.Now().UTC()
				r.companyEmailConnections[connectionKey] = connection
				updatedConnection = true
				break
			}
		}
	}
	if !updatedConnection {
		return ErrNotFound
	}
	now := time.Now().UTC()
	item.Status = CommunicationsEmailThreadDownloadJobParked
	item.LastError = lastError
	item.AttemptToken = ""
	item.FailedTimestamp = &now
	item.UpdatedTimestamp = now
	r.emailThreadDownloadJobs[jobID] = item
	r.updateMemoryEmailThreadDownloadStatusLocked(item, now, true)
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

func (r *MemoryRepo) ListCommunicationsEmailThreadDownloadJobsContext(ctx context.Context, companyID, emailThreadID string) ([]CommunicationsEmailThreadDownloadJob, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
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
