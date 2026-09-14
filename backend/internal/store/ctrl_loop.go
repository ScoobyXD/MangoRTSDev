package store

import (
	"context"
	"encoding/json"
	"time"
)

// CtrlLoop keeps exact job, mailbox, email and attachment identities. Workbook
// version pointers select content; attachment_relationships owns file lifetime.
type CtrlLoopJob struct {
	ID                   string     `json:"id"`
	CompanyID            string     `json:"-"`
	UserID               string     `json:"-"`
	Name                 string     `json:"name"`
	Instructions         string     `json:"instructions"`
	EmailConnectionID    string     `json:"email_connection_id"`
	TimeZone             string     `json:"time_zone"`
	Status               string     `json:"status"`
	Error                string     `json:"error"`
	OriginalAttachmentID string     `json:"-"`
	CurrentAttachmentID  string     `json:"-"`
	FileName             string     `json:"file_name"`
	UnseenUpdates        int        `json:"unseen_updates"`
	LastUpdated          *time.Time `json:"last_updated"`
	ActivatedAt          time.Time  `json:"-"`
	Revision             int64      `json:"revision"`
}

type CtrlLoopRun struct {
	ID                string     `json:"id"`
	CompanyID         string     `json:"-"`
	EmailConnectionID string     `json:"-"`
	EmailThreadID     string     `json:"-"`
	EmailMessageID    string     `json:"-"`
	ProviderMessageID string     `json:"-"`
	Status            string     `json:"status"`
	Error             string     `json:"error"`
	ArrivalAt         time.Time  `json:"arrival_at"`
	SourceURL         string     `json:"source_url"`
	SessionID         string     `json:"-"`
	CreatedAt         time.Time  `json:"created_at"`
	CompletedAt       *time.Time `json:"completed_at"`
	ChangedCells      int        `json:"changed_cells"`
}

type CtrlLoopWork struct {
	CtrlLoopJob
	BaseAttachmentID string
	BaseRevision     int64
	Targets          json.RawMessage
}

type CtrlLoopChange struct {
	ID           string    `json:"id"`
	RunID        string    `json:"run_id"`
	JobID        string    `json:"job_id"`
	Sheet        string    `json:"sheet"`
	Cell         string    `json:"cell"`
	PreviousText string    `json:"previous_text"`
	Text         string    `json:"text"`
	SourceURL    string    `json:"source_url"`
	ArrivalAt    time.Time `json:"arrival_at"`
	SavedAt      time.Time `json:"saved_at"`
	Seen         bool      `json:"seen"`
}

type CtrlLoopSavedWorkbook struct {
	JobID        string
	AttachmentID string
	Changes      []CtrlLoopChange
}

// Background automation requires PostgreSQL durability. MemoryRepo deliberately
// has no pretend listening/queue implementation.
type CtrlLoopRepository interface {
	ListCtrlLoopJobs(context.Context, string, string) ([]CtrlLoopJob, error)
	GetCtrlLoopJob(context.Context, string, string, string) (CtrlLoopJob, error)
	SaveCtrlLoopJob(context.Context, CtrlLoopJob) (CtrlLoopJob, error)
	AttachCtrlLoopWorkbook(context.Context, string, string, string, int64, string) error
	WithCtrlLoopCompanyLock(context.Context, string, func() error) error
	HasCtrlLoopJobsForConnection(context.Context, string, string) (bool, error)
	AcceptCtrlLoopRun(context.Context, CommunicationsEmailIngestionJob, string) (CtrlLoopRun, bool, error)
	GetCtrlLoopRun(context.Context, string, string) (CtrlLoopRun, error)
	StartCtrlLoopRun(context.Context, string, string, string, time.Time) ([]CtrlLoopWork, error)
	SetCtrlLoopSource(context.Context, string, string, string, string, string) error
	AuthorizeCtrlLoopToken(context.Context, string) (CtrlLoopRun, []CtrlLoopWork, error)
	StageCtrlLoopTargets(context.Context, string, map[string]json.RawMessage) error
	FreezeCtrlLoopRun(context.Context, string, string, string) ([]CtrlLoopWork, error)
	CompleteCtrlLoopRun(context.Context, string, string, string, []CtrlLoopSavedWorkbook) error
	FailCtrlLoopRun(context.Context, string, string, string, string) error
	DismissCtrlLoopRun(context.Context, string, string, string) error
	ListCtrlLoopHistory(context.Context, string, string, string, string) ([]CtrlLoopChange, []CtrlLoopRun, bool, error)
	MarkCtrlLoopSeen(context.Context, string, string, string, []string) error
}
