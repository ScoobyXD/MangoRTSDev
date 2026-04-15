package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"miraeopus/backend/internal/domain"
)

type PostgresRepo struct {
	db *sql.DB
}

func NewPostgresRepo(db *sql.DB) *PostgresRepo {
	return &PostgresRepo{db: db}
}

func (r *PostgresRepo) CreateCase(title, owner string, parentID *string) (domain.Case, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Case{}, err
	}
	defer tx.Rollback()

	if parentID != nil {
		var exists bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from cases where id=$1)`, *parentID).Scan(&exists); err != nil {
			return domain.Case{}, err
		}
		if !exists {
			return domain.Case{}, ErrNotFound
		}
	}

	id := newID("case")
	var created domain.Case
	var parent sql.NullString
	if parentID != nil {
		parent = sql.NullString{String: *parentID, Valid: true}
	}

	err = tx.QueryRowContext(
		ctx,
		`insert into cases (id, parent_id, title, owner, status) values ($1,$2,$3,$4,$5)
		 returning id, parent_id, title, owner, status, created_at, updated_at`,
		id,
		parent,
		title,
		owner,
		domain.CaseStatusNew,
	).Scan(&created.ID, &parent, &created.Title, &created.Owner, &created.Status, &created.CreatedAt, &created.UpdatedAt)
	if err != nil {
		return domain.Case{}, err
	}
	if parent.Valid {
		created.ParentID = &parent.String
	}

	if err := r.appendActivityTx(ctx, tx, created.ID, "case_created", fmt.Sprintf("title=%q", title), owner); err != nil {
		return domain.Case{}, err
	}
	if parentID != nil {
		if err := r.appendActivityTx(ctx, tx, *parentID, "child_case_created", created.ID, owner); err != nil {
			return domain.Case{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return domain.Case{}, err
	}
	return created, nil
}

func (r *PostgresRepo) GetCase(id string) (domain.CaseWithRelations, error) {
	ctx := context.Background()

	var c domain.Case
	var parent sql.NullString
	err := r.db.QueryRowContext(ctx,
		`select id, parent_id, title, owner, status, created_at, updated_at from cases where id=$1`, id,
	).Scan(&c.ID, &parent, &c.Title, &c.Owner, &c.Status, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CaseWithRelations{}, ErrNotFound
	}
	if err != nil {
		return domain.CaseWithRelations{}, err
	}
	if parent.Valid {
		c.ParentID = &parent.String
	}

	childrenRows, err := r.db.QueryContext(ctx,
		`select id, parent_id, title, owner, status, created_at, updated_at
		 from cases where parent_id=$1 order by created_at asc`, id)
	if err != nil {
		return domain.CaseWithRelations{}, err
	}
	defer childrenRows.Close()

	children := make([]domain.Case, 0)
	for childrenRows.Next() {
		var child domain.Case
		var childParent sql.NullString
		if err := childrenRows.Scan(&child.ID, &childParent, &child.Title, &child.Owner, &child.Status, &child.CreatedAt, &child.UpdatedAt); err != nil {
			return domain.CaseWithRelations{}, err
		}
		if childParent.Valid {
			child.ParentID = &childParent.String
		}
		children = append(children, child)
	}

	artifactRows, err := r.db.QueryContext(ctx,
		`select id, case_id, type, source_ref, content, created_by, created_at
		 from case_artifacts where case_id=$1 order by created_at asc`, id)
	if err != nil {
		return domain.CaseWithRelations{}, err
	}
	defer artifactRows.Close()

	artifacts := make([]domain.Artifact, 0)
	for artifactRows.Next() {
		var a domain.Artifact
		if err := artifactRows.Scan(&a.ID, &a.CaseID, &a.Type, &a.SourceRef, &a.Content, &a.CreatedBy, &a.CreatedAt); err != nil {
			return domain.CaseWithRelations{}, err
		}
		artifacts = append(artifacts, a)
	}

	activityRows, err := r.db.QueryContext(ctx,
		`select id, case_id, event_type, payload, created_by, created_at
		 from case_activities where case_id=$1 order by created_at asc`, id)
	if err != nil {
		return domain.CaseWithRelations{}, err
	}
	defer activityRows.Close()

	activities := make([]domain.Activity, 0)
	for activityRows.Next() {
		var a domain.Activity
		if err := activityRows.Scan(&a.ID, &a.CaseID, &a.EventType, &a.Payload, &a.CreatedBy, &a.CreatedAt); err != nil {
			return domain.CaseWithRelations{}, err
		}
		activities = append(activities, a)
	}

	return domain.CaseWithRelations{Case: c, Children: children, Artifacts: artifacts, Activities: activities}, nil
}

func (r *PostgresRepo) AddArtifact(caseID string, in AddArtifactInput) (domain.Artifact, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Artifact{}, err
	}
	defer tx.Rollback()

	var exists bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from cases where id=$1)`, caseID).Scan(&exists); err != nil {
		return domain.Artifact{}, err
	}
	if !exists {
		return domain.Artifact{}, ErrNotFound
	}

	artifactID := newID("artifact")
	var artifact domain.Artifact
	err = tx.QueryRowContext(ctx,
		`insert into case_artifacts (id, case_id, type, source_ref, content, created_by)
		 values ($1,$2,$3,$4,$5,$6)
		 returning id, case_id, type, source_ref, content, created_by, created_at`,
		artifactID,
		caseID,
		in.Type,
		in.SourceRef,
		in.Content,
		in.CreatedBy,
	).Scan(&artifact.ID, &artifact.CaseID, &artifact.Type, &artifact.SourceRef, &artifact.Content, &artifact.CreatedBy, &artifact.CreatedAt)
	if err != nil {
		return domain.Artifact{}, err
	}

	if _, err := tx.ExecContext(ctx, `update cases set updated_at=now() where id=$1`, caseID); err != nil {
		return domain.Artifact{}, err
	}
	if err := r.appendActivityTx(ctx, tx, caseID, "artifact_added", fmt.Sprintf("%s:%s", artifact.Type, artifact.ID), in.CreatedBy); err != nil {
		return domain.Artifact{}, err
	}

	if err := tx.Commit(); err != nil {
		return domain.Artifact{}, err
	}

	return artifact, nil
}

func (r *PostgresRepo) DeleteArtifact(caseID, artifactID string) error {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var caseExists bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from cases where id=$1)`, caseID).Scan(&caseExists); err != nil {
		return err
	}
	if !caseExists {
		return ErrNotFound
	}

	res, err := tx.ExecContext(ctx, `delete from case_artifacts where id=$1 and case_id=$2`, artifactID, caseID)
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}

	if _, err := tx.ExecContext(ctx, `update cases set updated_at=now() where id=$1`, caseID); err != nil {
		return err
	}
	if err := r.appendActivityTx(ctx, tx, caseID, "artifact_deleted", artifactID, "system"); err != nil {
		return err
	}

	return tx.Commit()
}

func (r *PostgresRepo) appendActivityTx(ctx context.Context, tx *sql.Tx, caseID, eventType, payload, createdBy string) error {
	_, err := tx.ExecContext(ctx,
		`insert into case_activities (id, case_id, event_type, payload, created_by)
		 values ($1,$2,$3,$4,$5)`,
		newID("activity"),
		caseID,
		eventType,
		payload,
		createdBy,
	)
	return err
}

func newID(prefix string) string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%s_%d", prefix, time.Now().UTC().UnixNano())
	}
	return fmt.Sprintf("%s_%d_%s", prefix, time.Now().UTC().UnixMilli(), hex.EncodeToString(buf))
}
