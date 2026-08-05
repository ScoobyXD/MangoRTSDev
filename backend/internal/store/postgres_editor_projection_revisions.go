package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func upsertPostgresNodeTextProjection(context.Context, *sql.Tx, NodeInformationInput, string, string, string, string) (domain.NodeProjection, error) {
	return domain.NodeProjection{}, ErrInvalid
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
			input.CompanyID, input.NodeID, input.InformationID, previous.Type, &previousCopy, "",
			normalizeNodeContentChangeActor(cleanUUIDText(input.ActorUserID), input.ActorDisplayName), time.Now().UTC(),
		)); err != nil {
			return err
		}
	}
	if err := retireNodeTextboxAttachmentRelationshipsTx(ctx, tx, input.CompanyID, input.NodeID, input.InformationID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `delete from node_textbox_chats
 where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, input.CompanyID, input.NodeID, input.InformationID); err != nil {
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
