package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

func upsertPostgresNodeTextProjection(context.Context, *sql.Tx, NodeInformationInput, string, string, string, string) (domain.NodeProjection, error) {
	return domain.NodeProjection{}, ErrInvalid
}

func deletePostgresNodeTextProjection(ctx context.Context, tx *sql.Tx, input NodeProjectionDeleteInput, _ domain.NodeProjection, _ bool) error {
	if input.ExpectedRevision == nil {
		return ErrProjectionRevisionRequired
	}
	if *input.ExpectedRevision < 1 {
		return ErrInvalid
	}
	var currentRevision int64
	var currentDeleted bool
	if err := tx.QueryRowContext(ctx, `select revision,deleted_timestamp is not null
from node_textboxes
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid
for update`, input.CompanyID, input.NodeID, input.InformationID).Scan(&currentRevision, &currentDeleted); errors.Is(err, sql.ErrNoRows) {
		return &ProjectionRevisionConflictError{}
	} else if err != nil {
		return err
	}
	if currentDeleted || currentRevision != *input.ExpectedRevision {
		if !currentDeleted {
			current, found, err := postgresNodeProjectionTx(ctx, tx, input.CompanyID, input.NodeID, input.InformationID)
			if err != nil {
				return err
			}
			if found {
				return &ProjectionRevisionConflictError{NodeCurrent: &current}
			}
		}
		return &ProjectionRevisionConflictError{}
	}
	if err := retireNodeTextboxAttachmentRelationshipsTx(ctx, tx, input.CompanyID, input.NodeID, input.InformationID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `delete from node_textbox_chats
 where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, input.CompanyID, input.NodeID, input.InformationID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `delete from email_relationships
 where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid
   and resource_textbox_id=$3::text`, input.CompanyID, input.NodeID, input.InformationID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `update node_textboxes set deleted_timestamp=now(), revision=revision+1, updated_timestamp=now()
 where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and revision=$4 and deleted_timestamp is null`,
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
