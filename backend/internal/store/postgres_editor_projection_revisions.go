package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func upsertPostgresNodeTextProjection(ctx context.Context, tx *sql.Tx, input NodeInformationInput, companyID, nodeID, informationID, infoType string) (domain.NodeProjection, error) {
	if input.ExpectedRevision == nil {
		return domain.NodeProjection{}, ErrProjectionRevisionRequired
	}
	if *input.ExpectedRevision < 0 {
		return domain.NodeProjection{}, ErrInvalid
	}
	previous, previousFound, err := postgresNodeProjectionTx(ctx, tx, companyID, nodeID, informationID)
	if err != nil {
		return domain.NodeProjection{}, err
	}
	var row *sql.Row
	if *input.ExpectedRevision == 0 {
		row = tx.QueryRowContext(ctx, `insert into node_projection_table
 (company_id, node_id, information_id, type, information, revision, created_timestamp, updated_timestamp)
 values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, 1, now(), now())
 on conflict (company_id, node_id, information_id) do update
 set type=excluded.type, information=excluded.information, is_deleted=false, revision=node_projection_table.revision+1, updated_timestamp=now()
 where node_projection_table.type='Text box'::information_type and node_projection_table.is_deleted
 returning company_id::text, node_id::text, information_id::text, type::text, information, is_deleted, revision, created_timestamp, updated_timestamp`,
			companyID, nodeID, informationID, infoType, input.Information)
	} else {
		row = tx.QueryRowContext(ctx, `update node_projection_table
 set type=$4::information_type, information=$5, is_deleted=false, revision=revision+1, updated_timestamp=now()
 where company_id=$1::uuid and node_id=$2::uuid and information_id=$3::uuid and revision=$6
 returning company_id::text, node_id::text, information_id::text, type::text, information, is_deleted, revision, created_timestamp, updated_timestamp`,
			companyID, nodeID, informationID, infoType, input.Information, *input.ExpectedRevision)
	}
	var projection domain.NodeProjection
	err = row.Scan(
		&projection.CompanyID,
		&projection.NodeID,
		&projection.InformationID,
		&projection.Type,
		&projection.Information,
		&projection.IsDeleted,
		&projection.Revision,
		&projection.CreatedTimestamp,
		&projection.UpdatedTimestamp,
	)
	if errorsIsNoRows(err) {
		current, found, lookupErr := postgresNodeProjectionTx(ctx, tx, companyID, nodeID, informationID)
		if lookupErr != nil {
			return domain.NodeProjection{}, lookupErr
		}
		if found {
			return domain.NodeProjection{}, &ProjectionRevisionConflictError{NodeCurrent: &current}
		}
		return domain.NodeProjection{}, &ProjectionRevisionConflictError{}
	}
	if err != nil {
		return domain.NodeProjection{}, err
	}
	if strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "" {
		var previousPtr *domain.NodeProjection
		if previousFound {
			previousPtr = &previous
		}
		if err := insertNodeContentChangesTx(ctx, tx, buildNodeContentChanges(
			companyID,
			nodeID,
			informationID,
			infoType,
			previousPtr,
			input.Information,
			normalizeNodeContentChangeActor(cleanUUIDText(input.ActorUserID), input.ActorDisplayName),
			time.Now().UTC(),
		)); err != nil {
			return domain.NodeProjection{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.NodeProjection{}, err
	}
	return projection, nil
}

func errorsIsNoRows(err error) bool {
	return err == sql.ErrNoRows
}

func deletePostgresNodeTextProjection(ctx context.Context, tx *sql.Tx, input NodeProjectionDeleteInput, previous domain.NodeProjection, previousFound bool) error {
	if input.ExpectedRevision == nil {
		return ErrProjectionRevisionRequired
	}
	if *input.ExpectedRevision < 1 {
		return ErrInvalid
	}
	if !previousFound {
		return &ProjectionRevisionConflictError{}
	}
	if previous.IsDeleted || previous.Revision != *input.ExpectedRevision {
		current := previous
		return &ProjectionRevisionConflictError{NodeCurrent: &current}
	}
	if strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "" {
		previousCopy := previous
		if err := insertNodeContentChangesTx(ctx, tx, buildNodeContentChanges(
			input.CompanyID,
			input.NodeID,
			input.InformationID,
			previous.Type,
			&previousCopy,
			"",
			normalizeNodeContentChangeActor(cleanUUIDText(input.ActorUserID), input.ActorDisplayName),
			time.Now().UTC(),
		)); err != nil {
			return err
		}
	}
	result, err := tx.ExecContext(ctx, `update node_projection_table set is_deleted=true, revision=revision+1, updated_timestamp=now()
 where company_id=$1::uuid and node_id=$2::uuid and information_id=$3::uuid and revision=$4 and not is_deleted`,
		input.CompanyID, input.NodeID, input.InformationID, *input.ExpectedRevision)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		current, found, lookupErr := postgresNodeProjectionTx(ctx, tx, input.CompanyID, input.NodeID, input.InformationID)
		if lookupErr != nil {
			return lookupErr
		}
		if found {
			return &ProjectionRevisionConflictError{NodeCurrent: &current}
		}
		return &ProjectionRevisionConflictError{}
	}
	return tx.Commit()
}
