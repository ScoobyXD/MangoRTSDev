package domain

import "time"

type CaseStatus string

const (
	CaseStatusNew        CaseStatus = "new"
	CaseStatusInProgress CaseStatus = "in_progress"
	CaseStatusBlocked    CaseStatus = "blocked"
	CaseStatusDone       CaseStatus = "done"
)

type Case struct {
	ID        string     `json:"id"`
	ParentID  *string    `json:"parent_id,omitempty"`
	Title     string     `json:"title"`
	Owner     string     `json:"owner"`
	Status    CaseStatus `json:"status"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type ArtifactType string

const (
	ArtifactEmail   ArtifactType = "email"
	ArtifactMessage ArtifactType = "message"
	ArtifactDoc     ArtifactType = "doc"
	ArtifactURL     ArtifactType = "url"
	ArtifactNote    ArtifactType = "note"
)

type Artifact struct {
	ID         string       `json:"id"`
	CaseID     string       `json:"case_id"`
	Type       ArtifactType `json:"type"`
	SourceRef  string       `json:"source_ref"`
	Content    string       `json:"content"`
	CreatedBy  string       `json:"created_by"`
	CreatedAt  time.Time    `json:"created_at"`
}

type Activity struct {
	ID        string    `json:"id"`
	CaseID    string    `json:"case_id"`
	EventType string    `json:"event_type"`
	Payload   string    `json:"payload"`
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

type CaseWithRelations struct {
	Case       Case       `json:"case"`
	Children   []Case     `json:"children"`
	Artifacts  []Artifact `json:"artifacts"`
	Activities []Activity `json:"activities"`
}
