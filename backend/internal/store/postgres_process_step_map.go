package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) GetProcessStepMap(companyID, logicGateID string) (domain.ProcessStepMapLayout, error) {
	layout := emptyProcessStepMap(companyID, logicGateID)
	if cleanUUIDText(companyID) == "" || cleanUUIDText(logicGateID) == "" {
		return layout, ErrInvalid
	}
	var steps, routes []byte
	err := r.db.QueryRowContext(context.Background(), `
select coalesce(layout.revision,0),coalesce(layout.steps,'[]'::jsonb),coalesce(layout.routes,'[]'::jsonb)
from logic_gates gate left join process_step_map_layouts layout
  on layout.company_id=gate.company_id and layout.logic_gate_id=gate.logic_gate_id
where gate.company_id=$1::uuid and gate.logic_gate_id=$2::uuid`, companyID, logicGateID).Scan(&layout.Revision, &steps, &routes)
	if errors.Is(err, sql.ErrNoRows) {
		return layout, ErrNotFound
	}
	if err != nil {
		return layout, err
	}
	if err := json.Unmarshal(steps, &layout.Steps); err != nil {
		return layout, err
	}
	err = json.Unmarshal(routes, &layout.Routes)
	return layout, err
}

func (r *PostgresRepo) PutProcessStepMap(input ProcessStepMapPutInput) (ProcessStepMapMutationResult, error) {
	layout, err := normalizeProcessStepMap(input)
	if err != nil {
		return ProcessStepMapMutationResult{}, err
	}
	input.CompanyID, input.LogicGateID = layout.CompanyID, layout.LogicGateID
	steps, err := json.Marshal(layout.Steps)
	if err != nil {
		return ProcessStepMapMutationResult{}, err
	}
	routes, err := json.Marshal(layout.Routes)
	if err != nil {
		return ProcessStepMapMutationResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessStepMapMutationResult{}, err
	}
	defer tx.Rollback()
	// Policy changes cannot revoke access between this check and the write.
	// The owner lock also serializes geometry with Step/edge create and delete.
	if err := lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, input.CompanyID, false); err != nil {
		return ProcessStepMapMutationResult{}, err
	}
	if err := lockPostgresCompanyExplorerResourceEditTx(ctx, tx, input.CompanyID, input.ActorUserID, EntityTypeLogicGate, input.LogicGateID); err != nil {
		return ProcessStepMapMutationResult{}, err
	}
	var currentRevision int64
	err = tx.QueryRowContext(ctx, `select revision from process_step_map_layouts where company_id=$1::uuid and logic_gate_id=$2::uuid for update`, input.CompanyID, input.LogicGateID).Scan(&currentRevision)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return ProcessStepMapMutationResult{}, err
	}
	if currentRevision != input.BaseRevision {
		return ProcessStepMapMutationResult{}, ErrVersionConflict
	}
	var invalid bool
	err = tx.QueryRowContext(ctx, `
select exists (
  select 1 from jsonb_to_recordset($3::jsonb) rectangle(process_step_id uuid)
  where not exists(select 1 from process_steps step where step.company_id=$1::uuid
    and step.logic_gate_id=$2::uuid and step.process_step_id=rectangle.process_step_id)
) or exists (
  select 1 from jsonb_to_recordset($4::jsonb) route(resource_operational_relationship_id uuid)
  where not exists(select 1 from resource_operational_relationships edge
    join process_steps source on source.company_id=edge.company_id and source.process_step_id=edge.source_resource_id
    join process_steps target on target.company_id=edge.company_id and target.process_step_id=edge.target_resource_id
    where edge.company_id=$1::uuid and edge.resource_operational_relationship_id=route.resource_operational_relationship_id
      and edge.source_resource_type='process_step' and edge.target_resource_type='process_step'
      and source.logic_gate_id=$2::uuid and target.logic_gate_id=$2::uuid)
)`, input.CompanyID, input.LogicGateID, string(steps), string(routes)).Scan(&invalid)
	if err != nil {
		return ProcessStepMapMutationResult{}, err
	}
	if invalid {
		return ProcessStepMapMutationResult{}, ErrInvalid
	}
	err = tx.QueryRowContext(ctx, `
insert into process_step_map_layouts(company_id,logic_gate_id,steps,routes)
values($1::uuid,$2::uuid,$3::jsonb,$4::jsonb)
on conflict(company_id,logic_gate_id) do update set steps=excluded.steps,routes=excluded.routes
returning revision`, input.CompanyID, input.LogicGateID, string(steps), string(routes)).Scan(&layout.Revision)
	if err != nil {
		return ProcessStepMapMutationResult{}, err
	}
	events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{processWorkChangedEvent(input.CompanyID, input.LogicGateID, input.ActorUserID)})
	if err != nil {
		return ProcessStepMapMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProcessStepMapMutationResult{}, err
	}
	return ProcessStepMapMutationResult{ProcessStepMapLayout: layout, Events: events}, nil
}
