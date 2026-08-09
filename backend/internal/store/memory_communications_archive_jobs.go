package store

import (
	"context"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) CreateCommunicationsArchiveJobContext(_ context.Context, input CommunicationsArchiveJobInput) (CommunicationsArchiveJob, error) {
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
		if existing, ok := r.activeCommunicationsArchiveJobItemLocked(job, messageID); ok {
			job.Items = append(job.Items, existing)
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

func (r *MemoryRepo) activeCommunicationsArchiveJobItemLocked(job CommunicationsArchiveJob, messageID string) (CommunicationsArchiveJobItem, bool) {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return CommunicationsArchiveJobItem{}, false
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
			return CloneCommunicationsArchiveJobItem(item), true
		}
	}
	return CommunicationsArchiveJobItem{}, false
}

func (r *MemoryRepo) GetCommunicationsArchiveJobItemContext(_ context.Context, jobItemID string) (CommunicationsArchiveJobItem, error) {
	jobItemID = cleanUUIDText(jobItemID)
	if jobItemID == "" {
		return CommunicationsArchiveJobItem{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.communicationsArchiveJobItems[jobItemID]
	if !ok {
		return CommunicationsArchiveJobItem{}, ErrNotFound
	}
	return CloneCommunicationsArchiveJobItem(item), nil
}

func (r *MemoryRepo) StartCommunicationsArchiveJobItemAttemptContext(_ context.Context, jobItemID string) (CommunicationsArchiveJobItem, bool, error) {
	jobItemID = cleanUUIDText(jobItemID)
	if jobItemID == "" {
		return CommunicationsArchiveJobItem{}, false, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.communicationsArchiveJobItems[jobItemID]
	if !ok {
		return CommunicationsArchiveJobItem{}, false, ErrNotFound
	}
	if (item.Status != CommunicationsArchiveJobItemStatusPending && item.Status != CommunicationsArchiveJobItemStatusProcessing) || item.AttemptCount >= 3 {
		return CloneCommunicationsArchiveJobItem(item), false, nil
	}
	now := time.Now().UTC()
	item.Status = CommunicationsArchiveJobItemStatusProcessing
	item.AttemptCount++
	item.AttemptToken = newUUIDv7String()
	item.LastError = ""
	item.UpdatedTimestamp = now
	r.communicationsArchiveJobItems[jobItemID] = item
	return CloneCommunicationsArchiveJobItem(item), true, nil
}

func (r *MemoryRepo) CompleteCommunicationsArchiveJobItemAttemptContext(_ context.Context, jobItemID, attemptToken string) error {
	jobItemID, attemptToken = cleanUUIDText(jobItemID), cleanUUIDText(attemptToken)
	if jobItemID == "" || attemptToken == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.communicationsArchiveJobItems[jobItemID]
	if !ok || item.Status != CommunicationsArchiveJobItemStatusProcessing || item.AttemptToken != attemptToken {
		return ErrNotFound
	}
	now := time.Now().UTC()
	item.Status = CommunicationsArchiveJobItemStatusArchived
	item.ArchivedTimestamp = &now
	item.LastError = ""
	item.UpdatedTimestamp = now
	r.communicationsArchiveJobItems[jobItemID] = item
	r.updateCommunicationsArchiveJobStatusLocked(item.JobID, now)
	return nil
}

func (r *MemoryRepo) FailCommunicationsArchiveJobItemAttemptContext(_ context.Context, jobItemID, attemptToken, lastError string) error {
	jobItemID, attemptToken = cleanUUIDText(jobItemID), cleanUUIDText(attemptToken)
	lastError = trimCommunicationsArchiveJobLastError(lastError)
	if jobItemID == "" || attemptToken == "" || lastError == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.communicationsArchiveJobItems[jobItemID]
	if !ok || item.Status != CommunicationsArchiveJobItemStatusProcessing || item.AttemptToken != attemptToken {
		return ErrNotFound
	}
	now := time.Now().UTC()
	item.Status = CommunicationsArchiveJobItemStatusPending
	item.LastError = lastError
	item.AttemptToken = ""
	item.UpdatedTimestamp = now
	if item.AttemptCount >= 3 {
		item.Status = CommunicationsArchiveJobItemStatusFailed
		item.FailedTimestamp = &now
	}
	r.communicationsArchiveJobItems[jobItemID] = item
	r.updateCommunicationsArchiveJobStatusLocked(item.JobID, now)
	return nil
}

func (r *MemoryRepo) ParkCommunicationsArchiveJobItemAttemptContext(_ context.Context, jobItemID, attemptToken, companyID, emailConnectionID, connectionStatus, lastError string) error {
	jobItemID, attemptToken = cleanUUIDText(jobItemID), cleanUUIDText(attemptToken)
	companyID, emailConnectionID = cleanUUIDText(companyID), cleanUUIDText(emailConnectionID)
	connectionStatus, lastError = normalizeEmailConnectionStatus(connectionStatus), trimCommunicationsArchiveJobLastError(lastError)
	if jobItemID == "" || attemptToken == "" || companyID == "" || emailConnectionID == "" || lastError == "" ||
		(connectionStatus != "reauth_required" && connectionStatus != "configuration_required") {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.communicationsArchiveJobItems[jobItemID]
	if !ok || item.CompanyID != companyID || item.Status != CommunicationsArchiveJobItemStatusProcessing || item.AttemptToken != attemptToken {
		return ErrNotFound
	}
	updated := false
	for key, connection := range r.emailConnections {
		if connection.CompanyID == companyID && connection.EmailConnectionID == emailConnectionID {
			connection.Status = connectionStatus
			connection.UpdatedTimestamp = time.Now().UTC()
			r.emailConnections[key] = connection
			updated = true
			break
		}
	}
	if !updated {
		key := companyEmailConnectionKey(companyID, emailConnectionID)
		connection, exists := r.companyEmailConnections[key]
		if !exists {
			return ErrNotFound
		}
		connection.Status = connectionStatus
		connection.UpdatedTimestamp = time.Now().UTC()
		r.companyEmailConnections[key] = connection
	}
	now := time.Now().UTC()
	item.Status = CommunicationsArchiveJobItemStatusFailed
	item.LastError = lastError
	item.AttemptToken = ""
	item.FailedTimestamp = &now
	item.UpdatedTimestamp = now
	r.communicationsArchiveJobItems[jobItemID] = item
	r.updateCommunicationsArchiveJobStatusLocked(item.JobID, now)
	return nil
}

func (r *MemoryRepo) ListCommunicationsArchiveJobItemsContext(ctx context.Context, jobID string) ([]CommunicationsArchiveJobItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
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
