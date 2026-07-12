package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

const CommunicationsArchiveJobClaimMaxLimit = 100
const DefaultCommunicationsArchiveJobProcessingLeaseTimeout = 5 * time.Minute

const (
	CommunicationsArchiveJobStatusPending    = "pending"
	CommunicationsArchiveJobStatusProcessing = "processing"
	CommunicationsArchiveJobStatusCompleted  = "completed"
	CommunicationsArchiveJobStatusFailed     = "failed"
)

const (
	CommunicationsArchiveJobItemStatusPending    = "pending"
	CommunicationsArchiveJobItemStatusProcessing = "processing"
	CommunicationsArchiveJobItemStatusRetry      = "retry"
	CommunicationsArchiveJobItemStatusArchived   = "archived"
	CommunicationsArchiveJobItemStatusFailed     = "failed"
)

type CommunicationsArchiveJobInput struct {
	ActorUserID   string
	CompanyID     string
	SharedInboxID string
	Connection    domain.UserEmailConnection
	MessageIDs    []string
}

type CommunicationsArchiveJob struct {
	JobID                    string                         `json:"job_id"`
	ActorUserID              string                         `json:"actor_user_id"`
	CompanyID                string                         `json:"company_id,omitempty"`
	SharedInboxID            string                         `json:"shared_inbox_id,omitempty"`
	ConnectionScope          string                         `json:"connection_scope"`
	Provider                 string                         `json:"provider"`
	AccountEmail             string                         `json:"account_email"`
	GrantID                  string                         `json:"-"`
	CompanyEmailConnectionID string                         `json:"company_email_connection_id,omitempty"`
	Status                   string                         `json:"status"`
	RequestedCount           int                            `json:"requested_count"`
	AcceptedMessageIDs       []string                       `json:"accepted_message_ids"`
	CreatedItemCount         int                            `json:"created_item_count"`
	Items                    []CommunicationsArchiveJobItem `json:"items,omitempty"`
	CreatedTimestamp         time.Time                      `json:"created_timestamp"`
	UpdatedTimestamp         time.Time                      `json:"updated_timestamp"`
	CompletedTimestamp       *time.Time                     `json:"completed_timestamp,omitempty"`
}

type CommunicationsArchiveJobItem struct {
	JobItemID                string     `json:"job_item_id"`
	JobID                    string     `json:"job_id"`
	ActorUserID              string     `json:"actor_user_id"`
	CompanyID                string     `json:"company_id,omitempty"`
	SharedInboxID            string     `json:"shared_inbox_id,omitempty"`
	ConnectionScope          string     `json:"connection_scope"`
	Provider                 string     `json:"provider"`
	AccountEmail             string     `json:"account_email"`
	GrantID                  string     `json:"-"`
	CompanyEmailConnectionID string     `json:"company_email_connection_id,omitempty"`
	MessageID                string     `json:"message_id"`
	Status                   string     `json:"status"`
	AttemptCount             int        `json:"attempt_count"`
	LastError                string     `json:"last_error,omitempty"`
	AvailableAt              time.Time  `json:"available_at"`
	ProcessingStartedAt      *time.Time `json:"processing_started_at,omitempty"`
	ArchivedTimestamp        *time.Time `json:"archived_timestamp,omitempty"`
	FailedTimestamp          *time.Time `json:"failed_timestamp,omitempty"`
	CreatedTimestamp         time.Time  `json:"created_timestamp"`
	UpdatedTimestamp         time.Time  `json:"updated_timestamp"`
}

func trimCommunicationsArchiveJobLastError(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 2000 {
		return value[:2000]
	}
	return value
}

func NormalizeCommunicationsArchiveJobInput(input CommunicationsArchiveJobInput) (CommunicationsArchiveJobInput, error) {
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.SharedInboxID = strings.TrimSpace(input.SharedInboxID)
	input.MessageIDs = cleanStringList(input.MessageIDs)
	connection := input.Connection
	connection.UserID = strings.TrimSpace(firstNonBlank(connection.UserID, input.ActorUserID))
	connection.Provider = normalizeEmailProvider(connection.Provider)
	connection.AccountEmail = normalizeEmail(connection.AccountEmail)
	connection.Scope = strings.TrimSpace(connection.Scope)
	if connection.Scope == "" {
		connection.Scope = "personal"
	}
	if input.SharedInboxID != "" {
		connection.Scope = "shared"
	}
	connection.CompanyID = strings.TrimSpace(firstNonBlank(connection.CompanyID, input.CompanyID))
	connection.CompanyEmailConnectionID = strings.TrimSpace(connection.CompanyEmailConnectionID)
	connection.GrantID = strings.TrimSpace(connection.GrantID)
	connection.Status = normalizeEmailConnectionStatus(connection.Status)
	if input.ActorUserID == "" || connection.UserID == "" || connection.Provider == "" || connection.AccountEmail == "" || connection.GrantID == "" || len(input.MessageIDs) == 0 {
		return CommunicationsArchiveJobInput{}, ErrInvalid
	}
	if input.SharedInboxID != "" && input.CompanyID == "" {
		return CommunicationsArchiveJobInput{}, ErrInvalid
	}
	if connection.Scope != "personal" && connection.Scope != "shared" {
		return CommunicationsArchiveJobInput{}, ErrInvalid
	}
	input.Connection = connection
	return input, nil
}

func NormalizeCommunicationsArchiveJobClaimLimit(limit int) int {
	if limit <= 0 || limit > CommunicationsArchiveJobClaimMaxLimit {
		return 25
	}
	return limit
}

func NormalizeCommunicationsArchiveJobProcessingLeaseTimeout(timeout time.Duration) time.Duration {
	if timeout <= 0 {
		return DefaultCommunicationsArchiveJobProcessingLeaseTimeout
	}
	return timeout
}

func CommunicationsArchiveJobItemStatusIsActive(status string) bool {
	switch strings.TrimSpace(status) {
	case CommunicationsArchiveJobItemStatusPending, CommunicationsArchiveJobItemStatusProcessing, CommunicationsArchiveJobItemStatusRetry:
		return true
	default:
		return false
	}
}

func CloneCommunicationsArchiveJob(item CommunicationsArchiveJob) CommunicationsArchiveJob {
	item.AcceptedMessageIDs = append([]string(nil), item.AcceptedMessageIDs...)
	item.Items = CloneCommunicationsArchiveJobItems(item.Items)
	item.CompletedTimestamp = cloneTimePointer(item.CompletedTimestamp)
	return item
}

func CloneCommunicationsArchiveJobItems(items []CommunicationsArchiveJobItem) []CommunicationsArchiveJobItem {
	out := make([]CommunicationsArchiveJobItem, 0, len(items))
	for _, item := range items {
		out = append(out, CloneCommunicationsArchiveJobItem(item))
	}
	return out
}

func CloneCommunicationsArchiveJobItem(item CommunicationsArchiveJobItem) CommunicationsArchiveJobItem {
	item.ProcessingStartedAt = cloneTimePointer(item.ProcessingStartedAt)
	item.ArchivedTimestamp = cloneTimePointer(item.ArchivedTimestamp)
	item.FailedTimestamp = cloneTimePointer(item.FailedTimestamp)
	return item
}

func cloneTimePointer(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if clean := strings.TrimSpace(value); clean != "" {
			return clean
		}
	}
	return ""
}
