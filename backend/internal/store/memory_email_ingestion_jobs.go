package store

import (
	"context"
	"sort"
	"strings"
	"time"
)

func cloneCommunicationsEmailIngestionJob(item CommunicationsEmailIngestionJob) CommunicationsEmailIngestionJob {
	if item.CompletedTimestamp != nil {
		value := *item.CompletedTimestamp
		item.CompletedTimestamp = &value
	}
	if item.FailedTimestamp != nil {
		value := *item.FailedTimestamp
		item.FailedTimestamp = &value
	}
	if item.SQSAcceptedTimestamp != nil {
		value := *item.SQSAcceptedTimestamp
		item.SQSAcceptedTimestamp = &value
	}
	return item
}

func communicationsEmailIngestionJobActive(status string) bool {
	switch status {
	case CommunicationsEmailIngestionJobAccepted, CommunicationsEmailIngestionJobProcessing:
		return true
	default:
		return false
	}
}

func (r *MemoryRepo) ensureCommunicationsEmailIngestionJobLocked(input CommunicationsEmailIngestionJobInput) (CommunicationsEmailIngestionJob, bool, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.EmailConnectionID = cleanUUIDText(input.EmailConnectionID)
	input.EmailThreadID = cleanUUIDText(input.EmailThreadID)
	input.ProviderMessageID = strings.TrimSpace(input.ProviderMessageID)
	input.ProviderThreadID = strings.TrimSpace(input.ProviderThreadID)
	input.EnqueueSourceID = strings.TrimSpace(input.EnqueueSourceID)
	input.Priority = normalizeCommunicationsEmailIngestionPriority(input.Priority)
	if input.CompanyID == "" || input.EmailConnectionID == "" || input.ProviderMessageID == "" || input.Priority == 0 {
		return CommunicationsEmailIngestionJob{}, false, ErrInvalid
	}
	if input.EmailThreadID != "" {
		thread, ok := r.emailThreads[key(input.CompanyID, input.EmailThreadID)]
		if !ok {
			return CommunicationsEmailIngestionJob{}, false, ErrNotFound
		}
		if input.ProviderThreadID == "" {
			input.ProviderThreadID = thread.ProviderThreadID
		}
	}
	for jobID, item := range r.emailIngestionJobs {
		if item.CompanyID == input.CompanyID && item.EmailConnectionID == input.EmailConnectionID &&
			item.ProviderMessageID == input.ProviderMessageID {
			if communicationsEmailIngestionJobActive(item.Status) {
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
				r.emailIngestionJobs[jobID] = item
			}
			return cloneCommunicationsEmailIngestionJob(item), false, nil
		}
	}
	now := time.Now().UTC()
	item := CommunicationsEmailIngestionJob{
		IngestionJobID: newUUIDv7String(), CompanyID: input.CompanyID,
		EmailConnectionID: input.EmailConnectionID, EmailThreadID: input.EmailThreadID,
		ProviderMessageID: input.ProviderMessageID, ProviderThreadID: input.ProviderThreadID,
		Priority: input.Priority, Status: CommunicationsEmailIngestionJobAccepted, EnqueueSourceID: input.EnqueueSourceID,
		CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	r.emailIngestionJobs[item.IngestionJobID] = item
	if input.EmailThreadID != "" {
		threadKey := key(input.CompanyID, input.EmailThreadID)
		thread := r.emailThreads[threadKey]
		thread.DownloadStatus = CommunicationsEmailThreadDownloadDownloading
		thread.LastDownloadError = ""
		thread.UpdatedTimestamp = now
		r.emailThreads[threadKey] = thread
	}
	return cloneCommunicationsEmailIngestionJob(item), true, nil
}

func (r *MemoryRepo) MarkCommunicationsEmailIngestionJobSQSAcceptedContext(ctx context.Context, jobID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	jobID = cleanUUIDText(jobID)
	if jobID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.emailIngestionJobs[jobID]
	if !ok {
		return ErrNotFound
	}
	if item.SQSAcceptedTimestamp == nil {
		now := time.Now().UTC()
		item.SQSAcceptedTimestamp = &now
		item.UpdatedTimestamp = now
		r.emailIngestionJobs[jobID] = item
	}
	return nil
}

func (r *MemoryRepo) EnsureCommunicationsEmailIngestionJobContext(ctx context.Context, input CommunicationsEmailIngestionJobInput) (CommunicationsEmailIngestionJob, bool, error) {
	if err := ctx.Err(); err != nil {
		return CommunicationsEmailIngestionJob{}, false, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ensureCommunicationsEmailIngestionJobLocked(input)
}

func (r *MemoryRepo) GetCommunicationsEmailIngestionJobContext(_ context.Context, jobID string) (CommunicationsEmailIngestionJob, error) {
	jobID = cleanUUIDText(jobID)
	if jobID == "" {
		return CommunicationsEmailIngestionJob{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.emailIngestionJobs[jobID]
	if !ok {
		return CommunicationsEmailIngestionJob{}, ErrNotFound
	}
	return cloneCommunicationsEmailIngestionJob(item), nil
}

func (r *MemoryRepo) StartCommunicationsEmailIngestionAttemptContext(_ context.Context, jobID string) (CommunicationsEmailIngestionJob, bool, error) {
	jobID = cleanUUIDText(jobID)
	if jobID == "" {
		return CommunicationsEmailIngestionJob{}, false, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.emailIngestionJobs[jobID]
	if !ok {
		return CommunicationsEmailIngestionJob{}, false, ErrNotFound
	}
	if item.Status != CommunicationsEmailIngestionJobAccepted && item.Status != CommunicationsEmailIngestionJobProcessing {
		return cloneCommunicationsEmailIngestionJob(item), false, nil
	}
	now := time.Now().UTC()
	if item.ProviderAttemptCount >= CommunicationsEmailProviderAttemptLimit {
		item.Status = CommunicationsEmailIngestionJobExhausted
		item.AttemptToken = ""
		item.FailedTimestamp = &now
		item.UpdatedTimestamp = now
		r.emailIngestionJobs[jobID] = item
		return cloneCommunicationsEmailIngestionJob(item), false, nil
	}
	item.ProviderAttemptCount++
	item.Status = CommunicationsEmailIngestionJobProcessing
	item.AttemptToken = newUUIDv7String()
	item.LastError = ""
	item.UpdatedTimestamp = now
	r.emailIngestionJobs[jobID] = item
	return cloneCommunicationsEmailIngestionJob(item), true, nil
}

func (r *MemoryRepo) CompleteCommunicationsEmailIngestionAttemptContext(ctx context.Context, downloadJobID, attemptToken string, realtimeInputs []RealtimeOutboxInput) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	realtimeInputs, err := normalizeRealtimeOutboxInputs(realtimeInputs)
	if err != nil {
		return err
	}
	downloadJobID = cleanUUIDText(downloadJobID)
	attemptToken = cleanUUIDText(attemptToken)
	if downloadJobID == "" || attemptToken == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.emailIngestionJobs[downloadJobID]
	if !ok {
		return ErrNotFound
	}
	if item.Status != CommunicationsEmailIngestionJobProcessing || item.AttemptToken != attemptToken {
		return ErrNotFound
	}
	if r.realtimeOutboxErr != nil {
		return r.realtimeOutboxErr
	}
	now := time.Now().UTC()
	item.Status = CommunicationsEmailIngestionJobCompleted
	item.LastError = ""
	item.CompletedTimestamp = &now
	item.FailedTimestamp = nil
	item.AttemptToken = ""
	item.UpdatedTimestamp = now
	r.emailIngestionJobs[downloadJobID] = item
	r.updateMemoryEmailThreadDownloadStatusLocked(item, now, false)
	return r.enqueueRealtimeOutboxInputsLocked(realtimeInputs)
}

func (r *MemoryRepo) FailCommunicationsEmailIngestionAttemptContext(ctx context.Context, downloadJobID, attemptToken, lastError string, realtimeInputs []RealtimeOutboxInput) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	realtimeInputs, err := normalizeRealtimeOutboxInputs(realtimeInputs)
	if err != nil {
		return err
	}
	downloadJobID = cleanUUIDText(downloadJobID)
	attemptToken = cleanUUIDText(attemptToken)
	lastError = strings.TrimSpace(lastError)
	if downloadJobID == "" || attemptToken == "" || lastError == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.emailIngestionJobs[downloadJobID]
	if !ok {
		return ErrNotFound
	}
	if item.Status != CommunicationsEmailIngestionJobProcessing || item.AttemptToken != attemptToken {
		return ErrNotFound
	}
	if r.realtimeOutboxErr != nil {
		return r.realtimeOutboxErr
	}
	now := time.Now().UTC()
	item.Status = CommunicationsEmailIngestionJobAccepted
	item.LastError = lastError
	item.AttemptToken = ""
	item.UpdatedTimestamp = now
	final := item.ProviderAttemptCount >= CommunicationsEmailProviderAttemptLimit
	if final {
		item.Status = CommunicationsEmailIngestionJobExhausted
		item.FailedTimestamp = &now
	}
	r.emailIngestionJobs[downloadJobID] = item
	r.updateMemoryEmailThreadDownloadStatusLocked(item, now, final)
	return r.enqueueRealtimeOutboxInputsLocked(realtimeInputs)
}

func (r *MemoryRepo) ParkCommunicationsEmailIngestionAttemptContext(ctx context.Context, jobID, attemptToken, connectionStatus, lastError string, realtimeInputs []RealtimeOutboxInput) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	realtimeInputs, err := normalizeRealtimeOutboxInputs(realtimeInputs)
	if err != nil {
		return err
	}
	jobID, attemptToken = cleanUUIDText(jobID), cleanUUIDText(attemptToken)
	connectionStatus, lastError = strings.TrimSpace(connectionStatus), strings.TrimSpace(lastError)
	if jobID == "" || attemptToken == "" || lastError == "" ||
		(connectionStatus != "reauth_required" && connectionStatus != "configuration_required") {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.emailIngestionJobs[jobID]
	if !ok || item.Status != CommunicationsEmailIngestionJobProcessing || item.AttemptToken != attemptToken {
		return ErrNotFound
	}
	if r.realtimeOutboxErr != nil {
		return r.realtimeOutboxErr
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
	item.Status = CommunicationsEmailIngestionJobParked
	item.LastError = lastError
	item.AttemptToken = ""
	item.FailedTimestamp = &now
	item.UpdatedTimestamp = now
	r.emailIngestionJobs[jobID] = item
	r.updateMemoryEmailThreadDownloadStatusLocked(item, now, true)
	return r.enqueueRealtimeOutboxInputsLocked(realtimeInputs)
}

func (r *MemoryRepo) updateMemoryEmailThreadDownloadStatusLocked(item CommunicationsEmailIngestionJob, now time.Time, final bool) {
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
	for _, candidate := range r.emailIngestionJobs {
		if candidate.CompanyID == item.CompanyID && candidate.EmailThreadID == item.EmailThreadID && communicationsEmailIngestionJobActive(candidate.Status) {
			thread.DownloadStatus = CommunicationsEmailThreadDownloadDownloading
			break
		}
	}
	thread.LastDownloadError = item.LastError
	if item.Status == CommunicationsEmailIngestionJobCompleted {
		thread.LastDownloadError = ""
	}
	thread.UpdatedTimestamp = now
	r.emailThreads[threadKey] = thread
}

func (r *MemoryRepo) ListCommunicationsEmailIngestionJobsForThreadContext(ctx context.Context, companyID, emailThreadID string) ([]CommunicationsEmailIngestionJob, error) {
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
	out := []CommunicationsEmailIngestionJob{}
	for _, item := range r.emailIngestionJobs {
		if item.CompanyID == companyID && item.EmailThreadID == emailThreadID {
			out = append(out, cloneCommunicationsEmailIngestionJob(item))
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
