package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func workspaceProcessDefinitionWriteError(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" {
		return ErrConflict
	}
	return err
}

func (r *PostgresRepo) createWorkspaceProcessDefinitionTx(ctx context.Context, tx *sql.Tx, input WorkspaceEntityBatchInput, result *WorkspaceEntityBatchResult) error {
	definition := input.ProcessDefinition
	if err := ensureV2PolicySettingsTx(ctx, tx); err != nil {
		return err
	}
	policyKey := resourceRACIKey{companyID: input.CompanyID, resourceType: EntityTypeLogicGate, resourceID: definition.LogicGateID}
	policy, err := postgresV2RACIPolicy(ctx, tx, policyKey)
	if err != nil {
		return err
	}
	if definition.RACIAssignments != nil {
		normalized, err := normalizeResourceRACIAssignmentInputs(definition.RACIAssignments)
		if err != nil {
			return err
		}
		for _, assignment := range normalized {
			if err := validatePostgresRACIPrincipalTx(ctx, tx, input.CompanyID, assignment.principalType, assignment.principalID); err != nil {
				return err
			}
		}
		if policy.ParentPolicy == nil || !normalizedRACIAssignmentsMatch(normalized, policy.ParentPolicy.Assignments) {
			policy, err = customizeResourceRACIPolicyTx(ctx, tx, policyKey, definition.RACIAssignments)
			if err != nil {
				return err
			}
		}
	}
	result.LogicGates[0].RACIAssignments = logicGateRACIAssignmentsFromResources(policy.RACIAssignments)
	if definition.EditorDocument != nil {
		ref := EditorJSONDocumentRef{CompanyID: input.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: definition.LogicGateID, DocumentID: "logic-gate-overview"}
		storage, _ := postgresEditorTextboxStorageFor(ref)
		body, err := encodeEditorTextboxBody(definition.EditorDocument, []EditorJSONAnnotation{})
		if err != nil {
			return err
		}
		if err := insertEmptyPostgresEditorTextboxTx(ctx, tx, storage, ref); err != nil {
			return err
		}
		if err := updatePostgresEditorTextboxTx(ctx, tx, storage, ref, body, 1, time.Now().UTC()); err != nil {
			return err
		}
	}
	result.ProcessSteps = make([]domain.ProcessStep, 0, len(definition.Steps))
	result.StepRelationships = make([]domain.ResourceOperationalRelationship, 0, len(definition.Relationships))
	for index, source := range definition.Steps {
		step, err := scanProcessStep(tx.QueryRowContext(ctx, `insert into process_steps(company_id,process_step_id,logic_gate_id,name,position,body_json) values($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb) returning `+processStepSelectColumns, input.CompanyID, source.ProcessStepID, definition.LogicGateID, source.Name, (index+1)*processStepPositionStride, source.BodyJSON))
		if err != nil {
			return mapEditorOwnerTextLimitError(err)
		}
		result.ProcessSteps = append(result.ProcessSteps, step)
	}
	for _, source := range definition.Relationships {
		edge, err := createProcessStepRelationshipTx(ctx, tx, ProcessStepRelationshipInput{CompanyID: input.CompanyID, LogicGateID: definition.LogicGateID, Source: source.Source, Target: source.Target}, source.ResourceOperationalRelationshipID)
		if err != nil {
			return err
		}
		result.StepRelationships = append(result.StepRelationships, edge)
	}
	layout := domain.ProcessStepMapLayout{CompanyID: input.CompanyID, LogicGateID: definition.LogicGateID, Steps: definition.Layout.Steps, Routes: definition.Layout.Routes}
	steps, err := json.Marshal(layout.Steps)
	if err != nil {
		return err
	}
	routes, err := json.Marshal(layout.Routes)
	if err != nil {
		return err
	}
	layout.Revision, err = writeProcessStepMapLayoutTx(ctx, tx, input.CompanyID, definition.LogicGateID, steps, routes)
	if err != nil {
		return err
	}
	result.StepMap = &layout
	inputs := append(WorkspaceEntityBatchEventInputs(*result, input.TimingRecorder), processWorkChangedEvent(input.CompanyID, definition.LogicGateID, input.CreatorUserID))
	result.Events, err = r.appendDomainEventsTx(ctx, tx, inputs)
	return err
}
