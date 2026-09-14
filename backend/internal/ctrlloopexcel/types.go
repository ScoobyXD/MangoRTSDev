// Package ctrlloopexcel exposes only the workbook operations needed by CtrlLoop.
// Workbook bytes and job access remain owned by the application's storage layer.
package ctrlloopexcel

import (
	"context"
	"time"
)

const (
	MaxFileBytes     = 25 << 20
	MaxExpandedBytes = 128 << 20
	MaxReadCells     = 2000
	MaxUpdates       = 500
)

type Stamp struct {
	ArrivalAt time.Time `json:"arrival_at"`
	Timezone  string    `json:"timezone"`
	SourceURL string    `json:"source_url"`
	// AppBaseURL comes only from the server's configured Mango application URL.
	AppBaseURL string `json:"-"`
}

type CellTarget struct {
	JobID string `json:"job_id"`
	Sheet string `json:"sheet"`
	Cell  string `json:"cell"`
}

type CellChange struct {
	CellTarget
	PreviousText string `json:"previous_text"`
	Text         string `json:"text"`
	Stamp
}

type Workbook struct {
	JobID        string `json:"job_id"`
	Name         string `json:"name"`
	Instructions string `json:"instructions"`
	Timezone     string `json:"timezone"`
}

type Scope struct {
	RunID     string     `json:"run_id"`
	CompanyID string     `json:"company_id"`
	TokenHash string     `json:"-"`
	Workbooks []Workbook `json:"workbooks"`
	Stamp     Stamp      `json:"stamp"`
}

// Backend must resolve bearer tokens against durable active-run state on every
// request. Load returns the current workbook including this run's staged cells.
// Stage must recheck the active run, validate all targets with Apply, and persist
// their union atomically. It does not publish a workbook or advance unseen counts.
type Backend interface {
	Authorize(context.Context, string) (Scope, error)
	Load(context.Context, Scope, string) ([]byte, error)
	Stage(context.Context, Scope, []CellTarget) ([]CellChange, error)
}

type SheetInfo struct {
	Name    string `json:"name"`
	Rows    int    `json:"rows"`
	Columns int    `json:"columns"`
}

type Cell struct {
	Address   string `json:"address"`
	Column    int    `json:"column"`
	Text      string `json:"text"`
	Formula   string `json:"formula,omitempty"`
	Hyperlink string `json:"hyperlink,omitempty"`
}

type Row struct {
	Row   int    `json:"row"`
	Cells []Cell `json:"cells"`
}

type SheetPage struct {
	Name        string `json:"name"`
	StartRow    int    `json:"start_row"`
	StartColumn int    `json:"start_column"`
	Rows        []Row  `json:"rows"`
}

type PreviewResult struct {
	Sheets []SheetInfo `json:"sheets"`
	Sheet  SheetPage   `json:"sheet"`
}

type SearchMatch struct {
	Sheet string `json:"sheet"`
	Row   int    `json:"row"`
	Cell
}

type SearchResult struct {
	Matches    []SearchMatch `json:"matches"`
	NextRow    int           `json:"next_row,omitempty"`
	NextColumn int           `json:"next_column,omitempty"`
}
