package store

import (
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"miraeopus/backend/internal/domain"
)

var ErrNotFound = errors.New("not found")

type Repository interface {
	CreateCase(title, owner string, parentID *string) (domain.Case, error)
	GetCase(id string) (domain.CaseWithRelations, error)
	AddArtifact(caseID string, in AddArtifactInput) (domain.Artifact, error)
	DeleteArtifact(caseID, artifactID string) error
}

type AddArtifactInput struct {
	Type      domain.ArtifactType
	SourceRef string
	Content   string
	CreatedBy string
}

type MemoryRepo struct {
	mu         sync.RWMutex
	cases      map[string]domain.Case
	artifacts  map[string]domain.Artifact
	activities map[string][]domain.Activity
	caseSeq    int
	artifactSeq int
	activitySeq int
}

func NewMemoryRepo() *MemoryRepo {
	return &MemoryRepo{
		cases:      map[string]domain.Case{},
		artifacts:  map[string]domain.Artifact{},
		activities: map[string][]domain.Activity{},
	}
}

func (r *MemoryRepo) nextCaseID() string {
	r.caseSeq++
	return fmt.Sprintf("case_%06d", r.caseSeq)
}

func (r *MemoryRepo) nextArtifactID() string {
	r.artifactSeq++
	return fmt.Sprintf("artifact_%06d", r.artifactSeq)
}

func (r *MemoryRepo) nextActivityID() string {
	r.activitySeq++
	return fmt.Sprintf("activity_%06d", r.activitySeq)
}

func (r *MemoryRepo) CreateCase(title, owner string, parentID *string) (domain.Case, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if parentID != nil {
		if _, ok := r.cases[*parentID]; !ok {
			return domain.Case{}, ErrNotFound
		}
	}

	now := time.Now().UTC()
	c := domain.Case{
		ID:        r.nextCaseID(),
		Title:     title,
		Owner:     owner,
		Status:    domain.CaseStatusNew,
		ParentID:  parentID,
		CreatedAt: now,
		UpdatedAt: now,
	}
	r.cases[c.ID] = c
	r.appendActivityLocked(c.ID, "case_created", fmt.Sprintf("title=%q", title), owner)
	if parentID != nil {
		r.appendActivityLocked(*parentID, "child_case_created", c.ID, owner)
	}
	return c, nil
}

func (r *MemoryRepo) GetCase(id string) (domain.CaseWithRelations, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	c, ok := r.cases[id]
	if !ok {
		return domain.CaseWithRelations{}, ErrNotFound
	}

	children := make([]domain.Case, 0)
	for _, candidate := range r.cases {
		if candidate.ParentID != nil && *candidate.ParentID == id {
			children = append(children, candidate)
		}
	}
	sort.Slice(children, func(i, j int) bool { return children[i].CreatedAt.Before(children[j].CreatedAt) })

	artifacts := make([]domain.Artifact, 0)
	for _, artifact := range r.artifacts {
		if artifact.CaseID == id {
			artifacts = append(artifacts, artifact)
		}
	}
	sort.Slice(artifacts, func(i, j int) bool { return artifacts[i].CreatedAt.Before(artifacts[j].CreatedAt) })

	activities := append([]domain.Activity(nil), r.activities[id]...)

	return domain.CaseWithRelations{Case: c, Children: children, Artifacts: artifacts, Activities: activities}, nil
}

func (r *MemoryRepo) AddArtifact(caseID string, in AddArtifactInput) (domain.Artifact, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	c, ok := r.cases[caseID]
	if !ok {
		return domain.Artifact{}, ErrNotFound
	}

	now := time.Now().UTC()
	a := domain.Artifact{
		ID:        r.nextArtifactID(),
		CaseID:    caseID,
		Type:      in.Type,
		SourceRef: in.SourceRef,
		Content:   in.Content,
		CreatedBy: in.CreatedBy,
		CreatedAt: now,
	}
	r.artifacts[a.ID] = a
	c.UpdatedAt = now
	r.cases[caseID] = c
	r.appendActivityLocked(caseID, "artifact_added", fmt.Sprintf("%s:%s", a.Type, a.ID), in.CreatedBy)
	return a, nil
}

func (r *MemoryRepo) DeleteArtifact(caseID, artifactID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	c, ok := r.cases[caseID]
	if !ok {
		return ErrNotFound
	}
	a, ok := r.artifacts[artifactID]
	if !ok || a.CaseID != caseID {
		return ErrNotFound
	}
	delete(r.artifacts, artifactID)
	c.UpdatedAt = time.Now().UTC()
	r.cases[caseID] = c
	r.appendActivityLocked(caseID, "artifact_deleted", artifactID, "system")
	return nil
}

func (r *MemoryRepo) appendActivityLocked(caseID, eventType, payload, createdBy string) {
	activity := domain.Activity{
		ID:        r.nextActivityID(),
		CaseID:    caseID,
		EventType: eventType,
		Payload:   payload,
		CreatedBy: createdBy,
		CreatedAt: time.Now().UTC(),
	}
	r.activities[caseID] = append(r.activities[caseID], activity)
}
