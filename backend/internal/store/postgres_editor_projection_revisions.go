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

func upsertPostgresLogicGateTextProjection(ctx context.Context, tx *sql.Tx, input LogicGateProjectionInput, companyID, logicGateID, informationID string) (domain.LogicGateProjection, error) {
	if input.ExpectedRevision == nil {
		return domain.LogicGateProjection{}, ErrProjectionRevisionRequired
	}
	if *input.ExpectedRevision < 0 {
		return domain.LogicGateProjection{}, ErrInvalid
	}
	var row *sql.Row
	if *input.ExpectedRevision == 0 {
		row = tx.QueryRowContext(ctx, `insert into logic_gate_projection_table
 (company_id, logic_gate_id, information_id, type, information, revision, created_timestamp, updated_timestamp)
 values ($1::uuid, $2::uuid, $3::uuid, 'Text box'::information_type, $4, 1, now(), now())
 on conflict (company_id, logic_gate_id, type) where type = 'Text box'::information_type do update
 set information_id=excluded.information_id, information=excluded.information, is_deleted=false, revision=logic_gate_projection_table.revision+1, updated_timestamp=now()
 where logic_gate_projection_table.is_deleted
 returning company_id::text, logic_gate_id::text, information_id::text, type::text, information, is_deleted, revision, created_timestamp, updated_timestamp`,
			companyID, logicGateID, informationID, input.Information)
	} else {
		row = tx.QueryRowContext(ctx, `update logic_gate_projection_table
 set information=$3, is_deleted=false, revision=revision+1, updated_timestamp=now()
 where company_id=$1::uuid and logic_gate_id=$2::uuid and type='Text box'::information_type and revision=$4
 returning company_id::text, logic_gate_id::text, information_id::text, type::text, information, is_deleted, revision, created_timestamp, updated_timestamp`,
			companyID, logicGateID, input.Information, *input.ExpectedRevision)
	}
	var projection domain.LogicGateProjection
	err := row.Scan(
		&projection.CompanyID,
		&projection.LogicGateID,
		&projection.InformationID,
		&projection.Type,
		&projection.Information,
		&projection.IsDeleted,
		&projection.Revision,
		&projection.CreatedTimestamp,
		&projection.UpdatedTimestamp,
	)
	if errorsIsNoRows(err) {
		current, found, lookupErr := postgresLogicGateTextProjectionTx(ctx, tx, companyID, logicGateID)
		if lookupErr != nil {
			return domain.LogicGateProjection{}, lookupErr
		}
		if found {
			return domain.LogicGateProjection{}, &ProjectionRevisionConflictError{LogicGateCurrent: &current}
		}
		return domain.LogicGateProjection{}, &ProjectionRevisionConflictError{}
	}
	if err != nil {
		return domain.LogicGateProjection{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.LogicGateProjection{}, err
	}
	return projection, nil
}

func postgresLogicGateTextProjectionTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) (domain.LogicGateProjection, bool, error) {
	var item domain.LogicGateProjection
	err := tx.QueryRowContext(ctx, `select company_id::text, logic_gate_id::text, information_id::text, type::text, information, is_deleted, revision, created_timestamp, updated_timestamp
 from logic_gate_projection_table
 where company_id=$1::uuid and logic_gate_id=$2::uuid and type='Text box'::information_type`, companyID, logicGateID).Scan(
		&item.CompanyID,
		&item.LogicGateID,
		&item.InformationID,
		&item.Type,
		&item.Information,
		&item.IsDeleted,
		&item.Revision,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if errorsIsNoRows(err) {
		return domain.LogicGateProjection{}, false, nil
	}
	if err != nil {
		return domain.LogicGateProjection{}, false, err
	}
	return item, true, nil
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

func deletePostgresLogicGateTextProjection(ctx context.Context, tx *sql.Tx, input LogicGateProjectionDeleteInput, previous domain.LogicGateProjection, previousFound bool) error {
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
		return &ProjectionRevisionConflictError{LogicGateCurrent: &current}
	}
	result, err := tx.ExecContext(ctx, `update logic_gate_projection_table set is_deleted=true, revision=revision+1, updated_timestamp=now()
 where company_id=$1::uuid and logic_gate_id=$2::uuid and information_id=$3::uuid and revision=$4 and not is_deleted`,
		input.CompanyID, input.LogicGateID, input.InformationID, *input.ExpectedRevision)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		current, found, lookupErr := postgresLogicGateProjectionTx(ctx, tx, input.CompanyID, input.LogicGateID, input.InformationID)
		if lookupErr != nil {
			return lookupErr
		}
		if found {
			return &ProjectionRevisionConflictError{LogicGateCurrent: &current}
		}
		return &ProjectionRevisionConflictError{}
	}
	return tx.Commit()
}

func postgresLogicGateProjectionTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID, informationID string) (domain.LogicGateProjection, bool, error) {
	var item domain.LogicGateProjection
	err := tx.QueryRowContext(ctx, `select company_id::text, logic_gate_id::text, information_id::text, type::text, information, is_deleted, revision, created_timestamp, updated_timestamp
 from logic_gate_projection_table
 where company_id=$1::uuid and logic_gate_id=$2::uuid and information_id=$3::uuid`, companyID, logicGateID, informationID).Scan(
		&item.CompanyID,
		&item.LogicGateID,
		&item.InformationID,
		&item.Type,
		&item.Information,
		&item.IsDeleted,
		&item.Revision,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if errorsIsNoRows(err) {
		return domain.LogicGateProjection{}, false, nil
	}
	if err != nil {
		return domain.LogicGateProjection{}, false, err
	}
	return item, true, nil
}
