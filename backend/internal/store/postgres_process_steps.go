package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

const processStepSelectColumns = `company_id::text,process_step_id::text,logic_gate_id::text,name,position,created_timestamp,updated_timestamp`

func scanProcessStep(row interface{ Scan(...any) error }) (domain.ProcessStep, error) {
	var step domain.ProcessStep
	err := row.Scan(&step.CompanyID, &step.ProcessStepID, &step.LogicGateID, &step.Name, &step.Position, &step.CreatedTimestamp, &step.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return step, ErrNotFound
	}
	return step, err
}
func listProcessStepsTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) ([]domain.ProcessStep, error) {
	rows, err := tx.QueryContext(ctx, `select `+processStepSelectColumns+` from process_steps where company_id=$1::uuid and logic_gate_id=$2::uuid order by position,process_step_id`, companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	steps := []domain.ProcessStep{}
	for rows.Next() {
		step, scanErr := scanProcessStep(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		steps = append(steps, step)
	}
	return steps, rows.Err()
}
func lockProcessStepsTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	if cleanUUIDText(companyID) == "" || cleanUUIDText(logicGateID) == "" {
		return ErrInvalid
	}
	var id string
	err := tx.QueryRowContext(ctx, `select logic_gate_id::text from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid for update`, companyID, logicGateID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
func validateProcessStepTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string, stepID *string) error {
	if stepID == nil {
		return nil
	}
	if cleanUUIDText(*stepID) == "" {
		return ErrInvalid
	}
	var exists bool
	err := tx.QueryRowContext(ctx, `select exists(select 1 from process_steps where company_id=$1::uuid and logic_gate_id=$2::uuid and process_step_id=$3::uuid)`, companyID, logicGateID, *stepID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalid
	}
	return nil
}
func createProcessStepRelationshipTx(ctx context.Context, tx *sql.Tx, input ProcessStepRelationshipInput, relationshipID string) (domain.ResourceOperationalRelationship, error) {
	if !validProcessStepRelationship(input) {
		return domain.ResourceOperationalRelationship{}, ErrInvalid
	}
	if err := validateProcessStepTx(ctx, tx, input.CompanyID, input.LogicGateID, &input.Source.ResourceID); err != nil {
		return domain.ResourceOperationalRelationship{}, err
	}
	if err := validateProcessStepTx(ctx, tx, input.CompanyID, input.LogicGateID, &input.Target.ResourceID); err != nil {
		return domain.ResourceOperationalRelationship{}, err
	}
	return scanResourceOperationalRelationship(tx.QueryRowContext(ctx, `insert into resource_operational_relationships(company_id,resource_operational_relationship_id,source_resource_type,source_resource_id,target_resource_type,target_resource_id) values($1::uuid,$2::uuid,'process_step',$3::uuid,'process_step',$4::uuid) on conflict(company_id,source_resource_type,source_resource_id,target_resource_type,target_resource_id) do update set source_resource_id=excluded.source_resource_id returning company_id::text,resource_operational_relationship_id::text,source_resource_type,source_resource_id::text,target_resource_type,target_resource_id::text,created_timestamp`, input.CompanyID, relationshipID, input.Source.ResourceID, input.Target.ResourceID))
}
func (r *PostgresRepo) commitProcessStepMutation(ctx context.Context, tx *sql.Tx, companyID, logicGateID, actorID string, result ProcessStepMutationResult) (ProcessStepMutationResult, error) {
	events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{processWorkChangedEvent(companyID, logicGateID, actorID)})
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return ProcessStepMutationResult{}, err
	}
	result.Events = events
	return result, nil
}
func (r *PostgresRepo) CreateProcessStep(input ProcessStepCreateInput) (ProcessStepMutationResult, error) {
	input.Name = strings.TrimSpace(input.Name)
	if !validProcessStepName(input.Name) {
		return ProcessStepMutationResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	defer tx.Rollback()
	if err = lockProcessStepsTx(ctx, tx, input.CompanyID, input.LogicGateID); err != nil {
		return ProcessStepMutationResult{}, err
	}
	if err = validateProcessStepTx(ctx, tx, input.CompanyID, input.LogicGateID, input.AfterProcessStepID); err != nil {
		return ProcessStepMutationResult{}, err
	}
	steps, err := listProcessStepsTx(ctx, tx, input.CompanyID, input.LogicGateID)
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	position, positionUpdates, ok := planProcessStepInsertion(steps, input.AfterProcessStepID)
	if !ok {
		return ProcessStepMutationResult{}, ErrInvalid
	}
	for stepID, updatedPosition := range positionUpdates {
		if _, err = tx.ExecContext(ctx, `update process_steps set position=$4,updated_timestamp=now() where company_id=$1::uuid and logic_gate_id=$2::uuid and process_step_id=$3::uuid`, input.CompanyID, input.LogicGateID, stepID, updatedPosition); err != nil {
			return ProcessStepMutationResult{}, err
		}
	}
	step, err := scanProcessStep(tx.QueryRowContext(ctx, `insert into process_steps(company_id,process_step_id,logic_gate_id,name,position) values($1::uuid,$2::uuid,$3::uuid,$4,$5) returning `+processStepSelectColumns, input.CompanyID, newUUIDv7String(), input.LogicGateID, input.Name, position))
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	result := ProcessStepMutationResult{Step: &step, PositionUpdates: positionUpdates}
	if input.AfterProcessStepID != nil {
		edge, err := createProcessStepRelationshipTx(ctx, tx, ProcessStepRelationshipInput{CompanyID: input.CompanyID, LogicGateID: input.LogicGateID, Source: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: *input.AfterProcessStepID}, Target: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: step.ProcessStepID}}, newUUIDv7String())
		if err != nil {
			return ProcessStepMutationResult{}, err
		}
		result.Relationship = &edge
	}
	return r.commitProcessStepMutation(ctx, tx, input.CompanyID, input.LogicGateID, input.ActorUserID, result)
}
func (r *PostgresRepo) UpdateProcessStep(input ProcessStepUpdateInput) (ProcessStepMutationResult, error) {
	if input.Name != nil && !validProcessStepName(*input.Name) || input.Position != nil && *input.Position < 0 || cleanUUIDText(input.ProcessStepID) == "" {
		return ProcessStepMutationResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	defer tx.Rollback()
	if err = lockProcessStepsTx(ctx, tx, input.CompanyID, input.LogicGateID); err != nil {
		return ProcessStepMutationResult{}, err
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		input.Name = &name
	}
	step, err := scanProcessStep(tx.QueryRowContext(ctx, `update process_steps set name=coalesce($4,name),position=coalesce($5,position),updated_timestamp=now() where company_id=$1::uuid and logic_gate_id=$2::uuid and process_step_id=$3::uuid returning `+processStepSelectColumns, input.CompanyID, input.LogicGateID, input.ProcessStepID, input.Name, input.Position))
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	return r.commitProcessStepMutation(ctx, tx, input.CompanyID, input.LogicGateID, input.ActorUserID, ProcessStepMutationResult{Step: &step})
}
func (r *PostgresRepo) DeleteProcessStep(input ProcessStepDeleteInput) (ProcessStepMutationResult, error) {
	if cleanUUIDText(input.ProcessStepID) == "" {
		return ProcessStepMutationResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	defer tx.Rollback()
	if err = lockProcessStepsTx(ctx, tx, input.CompanyID, input.LogicGateID); err != nil {
		return ProcessStepMutationResult{}, err
	}
	deleted, err := tx.ExecContext(ctx, `delete from process_steps where company_id=$1::uuid and logic_gate_id=$2::uuid and process_step_id=$3::uuid`, input.CompanyID, input.LogicGateID, input.ProcessStepID)
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	count, err := deleted.RowsAffected()
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	if count == 0 {
		return ProcessStepMutationResult{}, ErrNotFound
	}
	return r.commitProcessStepMutation(ctx, tx, input.CompanyID, input.LogicGateID, input.ActorUserID, ProcessStepMutationResult{})
}
func (r *PostgresRepo) CreateProcessStepRelationship(input ProcessStepRelationshipInput) (ProcessStepMutationResult, error) {
	if !validProcessStepRelationship(input) {
		return ProcessStepMutationResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	defer tx.Rollback()
	if err = lockProcessStepsTx(ctx, tx, input.CompanyID, input.LogicGateID); err != nil {
		return ProcessStepMutationResult{}, err
	}
	edge, err := createProcessStepRelationshipTx(ctx, tx, input, newUUIDv7String())
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	return r.commitProcessStepMutation(ctx, tx, input.CompanyID, input.LogicGateID, input.ActorUserID, ProcessStepMutationResult{Relationship: &edge})
}
func (r *PostgresRepo) DeleteProcessStepRelationship(input ProcessStepRelationshipDeleteInput) (ProcessStepMutationResult, error) {
	if cleanUUIDText(input.RelationshipID) == "" {
		return ProcessStepMutationResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	defer tx.Rollback()
	if err = lockProcessStepsTx(ctx, tx, input.CompanyID, input.LogicGateID); err != nil {
		return ProcessStepMutationResult{}, err
	}
	deleted, err := tx.ExecContext(ctx, `delete from resource_operational_relationships edge using process_steps source,process_steps target where edge.company_id=$1::uuid and edge.resource_operational_relationship_id=$3::uuid and edge.source_resource_type='process_step' and edge.target_resource_type='process_step' and source.company_id=edge.company_id and source.process_step_id=edge.source_resource_id and source.logic_gate_id=$2::uuid and target.company_id=edge.company_id and target.process_step_id=edge.target_resource_id and target.logic_gate_id=$2::uuid`, input.CompanyID, input.LogicGateID, input.RelationshipID)
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	count, err := deleted.RowsAffected()
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	if count == 0 {
		return ProcessStepMutationResult{}, ErrNotFound
	}
	return r.commitProcessStepMutation(ctx, tx, input.CompanyID, input.LogicGateID, input.ActorUserID, ProcessStepMutationResult{})
}
