package emailqueue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

const (
	SchemaVersion = 1

	KindIngestion                = "email_ingestion"
	KindCtrlLoop                 = "ctrl_loop"
	KindArchiveItem              = "email_archive_item"
	KindReconciliationControl    = "reconciliation_control"
	KindReconciliationConnection = "reconciliation_connection"

	ReconciliationControlGroup = "reconciliation-control"
	ReceiveWaitTime            = 20 * time.Second
	AttemptDeadline            = 8 * time.Minute
)

// Message contains only stable identifiers and bounded reconciliation cursors.
// Provider credentials and message content are deliberately excluded.
type Message struct {
	SchemaVersion     int       `json:"schema_version"`
	Kind              string    `json:"kind"`
	JobID             string    `json:"job_id,omitempty"`
	CompanyID         string    `json:"company_id,omitempty"`
	EmailConnectionID string    `json:"email_connection_id,omitempty"`
	EnqueueSourceID   string    `json:"enqueue_source_id,omitempty"`
	ReconciliationID  string    `json:"reconciliation_id,omitempty"`
	ScanStartedAt     time.Time `json:"scan_started_at,omitempty"`
	LowerBound        time.Time `json:"lower_bound,omitempty"`
	ConnectionCursor  string    `json:"connection_cursor,omitempty"`
	ProviderPageToken string    `json:"provider_page_token,omitempty"`
}

func (m Message) Validate() error {
	if m.SchemaVersion != SchemaVersion {
		return errors.New("unsupported email work message schema")
	}
	switch m.Kind {
	case KindIngestion, KindArchiveItem, KindCtrlLoop:
		if strings.TrimSpace(m.JobID) == "" || strings.TrimSpace(m.CompanyID) == "" || strings.TrimSpace(m.EmailConnectionID) == "" {
			return errors.New("email work message is missing a stable identity")
		}
	case KindReconciliationControl:
		if strings.TrimSpace(m.ReconciliationID) == "" || m.ScanStartedAt.IsZero() {
			return errors.New("reconciliation control message is incomplete")
		}
	case KindReconciliationConnection:
		if strings.TrimSpace(m.ReconciliationID) == "" || strings.TrimSpace(m.CompanyID) == "" || strings.TrimSpace(m.EmailConnectionID) == "" || m.ScanStartedAt.IsZero() {
			return errors.New("reconciliation connection message is incomplete")
		}
	default:
		return errors.New("unknown email work message kind")
	}
	return nil
}

func (m Message) GroupID() string {
	if m.Kind == KindCtrlLoop {
		return "ctrl-loop:" + strings.TrimSpace(m.CompanyID)
	}
	if m.Kind == KindReconciliationControl {
		return ReconciliationControlGroup
	}
	return strings.TrimSpace(m.EmailConnectionID)
}

func (m Message) DeduplicationID() string {
	identity := strings.Join([]string{
		m.Kind,
		m.JobID,
		m.ReconciliationID,
		m.EmailConnectionID,
		m.EnqueueSourceID,
		m.ConnectionCursor,
		m.ProviderPageToken,
	}, "\x1f")
	sum := sha256.Sum256([]byte(identity))
	return hex.EncodeToString(sum[:])
}

type Delivery struct {
	Message       Message
	ReceiptHandle string
	ReceiveCount  int
}

type Sender interface {
	Send(ctx context.Context, message Message) error
}

type Receiver interface {
	Receive(ctx context.Context) (Delivery, bool, error)
	Delete(ctx context.Context, receiptHandle string) error
}
