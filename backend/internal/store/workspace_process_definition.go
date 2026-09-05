package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"strings"
)

// Creation uses the literal IDs of the saved Process, Steps, and relationships.
type WorkspaceProcessDefinitionInput struct {
	LogicGateID     string                                   `json:"logic_gate_id"`
	Steps           []WorkspaceProcessDefinitionStep         `json:"steps"`
	Relationships   []WorkspaceProcessDefinitionRelationship `json:"relationships"`
	Layout          *WorkspaceProcessDefinitionLayout        `json:"layout"`
	RACIAssignments []ResourceRACIAssignmentInput            `json:"gvic_assignments"`
	EditorDocument  json.RawMessage                          `json:"editor_document,omitempty"`
}

type WorkspaceProcessDefinitionStep struct {
	ProcessStepID string          `json:"process_step_id"`
	Name          string          `json:"name"`
	BodyJSON      json.RawMessage `json:"body_json,omitempty"`
}

type WorkspaceProcessDefinitionRelationship struct {
	ResourceOperationalRelationshipID string                       `json:"resource_operational_relationship_id"`
	Source                            domain.ProcessMapResourceRef `json:"source"`
	Target                            domain.ProcessMapResourceRef `json:"target"`
}

type WorkspaceProcessDefinitionLayout struct {
	Steps  []domain.ProcessStepMapRectangle `json:"steps"`
	Routes []domain.ProcessStepMapRoute     `json:"routes"`
}

func normalizeWorkspaceProcessDefinition(input WorkspaceEntityBatchInput) (WorkspaceEntityBatchInput, error) {
	definition := input.ProcessDefinition
	if definition == nil {
		return input, nil
	}
	input.CompanyID, input.FolderID = cleanUUIDText(input.CompanyID), cleanUUIDText(input.FolderID)
	if input.CompanyID == "" || input.FolderID == "" || input.EntityKind != EntityTypeLogicGate || len(input.Items) != 1 || len(input.Relationships) != 0 || NormalizeMutationOrigin(input.MutationOrigin) != MutationOriginCompanyExplorer || strings.TrimSpace(input.Items[0].ClientID) == "" || strings.TrimSpace(input.Items[0].Title) == "" {
		return input, ErrInvalid
	}
	if definition.Steps == nil || definition.Relationships == nil || definition.Layout == nil || definition.Layout.Steps == nil || definition.Layout.Routes == nil || len(definition.Steps) > WorkspaceEntityBatchMaxItems || len(definition.Relationships) > WorkspaceEntityBatchMaxRelationships {
		return input, ErrInvalid
	}
	if input.CreatorLogicGateRACIRole != "" {
		return input, ErrInvalid
	}
	copy := *definition
	copy.LogicGateID = cleanUUIDText(definition.LogicGateID)
	copy.Steps = append([]WorkspaceProcessDefinitionStep{}, definition.Steps...)
	copy.Relationships = append([]WorkspaceProcessDefinitionRelationship{}, definition.Relationships...)
	if definition.RACIAssignments != nil {
		assignments, err := normalizeResourceRACIAssignmentInputs(definition.RACIAssignments)
		if err != nil {
			return input, err
		}
		if err := validateResourceRACIAssignmentInputsForOperation(resourceRACIKey{companyID: input.CompanyID, resourceType: EntityTypeLogicGate, resourceID: copy.LogicGateID}, assignments, RACIAssignmentCommandSet); err != nil {
			return input, err
		}
		copy.RACIAssignments = make([]ResourceRACIAssignmentInput, 0, len(assignments))
		for _, assignment := range assignments {
			copy.RACIAssignments = append(copy.RACIAssignments, ResourceRACIAssignmentInput{Role: assignment.role, PrincipalType: assignment.principalType, PrincipalID: assignment.principalID})
		}
	}
	if definition.EditorDocument != nil {
		var err error
		copy.EditorDocument, err = validateMangoTiptapJSONForCommit(definition.EditorDocument)
		if err != nil {
			return input, err
		}
		if EditorOwnerTextLimitExceeded(0, int64(len(copy.EditorDocument))) {
			return input, ErrEditorOwnerTextLimit
		}
	}
	processTextBytes := int64(len(copy.EditorDocument))
	steps, relationships, pairs := map[string]bool{}, map[string]bool{}, map[[2]string]bool{}
	for index := range copy.Steps {
		step := &copy.Steps[index]
		step.ProcessStepID, step.Name = cleanUUIDText(step.ProcessStepID), strings.TrimSpace(step.Name)
		if step.ProcessStepID == "" || steps[step.ProcessStepID] || !validProcessStepName(step.Name) {
			return input, ErrInvalid
		}
		var err error
		step.BodyJSON, err = normalizeProcessStepBody(step.BodyJSON)
		if err != nil {
			return input, err
		}
		if EditorOwnerTextLimitExceeded(processTextBytes, int64(len(step.BodyJSON))) {
			return input, ErrEditorOwnerTextLimit
		}
		processTextBytes += int64(len(step.BodyJSON))
		steps[step.ProcessStepID] = true
	}
	for index := range copy.Relationships {
		edge := &copy.Relationships[index]
		edge.ResourceOperationalRelationshipID = cleanUUIDText(edge.ResourceOperationalRelationshipID)
		edge.Source.ResourceID, edge.Target.ResourceID = cleanUUIDText(edge.Source.ResourceID), cleanUUIDText(edge.Target.ResourceID)
		pair := [2]string{edge.Source.ResourceID, edge.Target.ResourceID}
		if edge.ResourceOperationalRelationshipID == "" || relationships[edge.ResourceOperationalRelationshipID] || pairs[pair] || !steps[pair[0]] || !steps[pair[1]] || !validProcessStepRelationship(ProcessStepRelationshipInput{CompanyID: input.CompanyID, LogicGateID: copy.LogicGateID, Source: edge.Source, Target: edge.Target}) {
			return input, ErrInvalid
		}
		relationships[edge.ResourceOperationalRelationshipID], pairs[pair] = true, true
	}
	layout, err := normalizeProcessStepMap(ProcessStepMapPutInput{CompanyID: input.CompanyID, LogicGateID: copy.LogicGateID, Steps: definition.Layout.Steps, Routes: definition.Layout.Routes})
	if err != nil {
		return input, err
	}
	for _, rectangle := range layout.Steps {
		if !steps[rectangle.ProcessStepID] {
			return input, ErrInvalid
		}
	}
	for _, route := range layout.Routes {
		if !relationships[route.ResourceOperationalRelationshipID] {
			return input, ErrInvalid
		}
	}
	copy.Layout = &WorkspaceProcessDefinitionLayout{Steps: layout.Steps, Routes: layout.Routes}
	input.ProcessDefinition = &copy
	return input, nil
}

// The authored save appends these before committing. Ordinary batches retain
// their existing HTTP append boundary and use the same event payloads.
func WorkspaceEntityBatchEventInputs(result WorkspaceEntityBatchResult, timings TimingRecorder) []DomainEventInput {
	inputs := make([]DomainEventInput, 0, len(result.FolderItems)+len(result.Nodes)+len(result.LogicGates)+len(result.Relationships)+1)
	appendEvent := func(eventType string, payload map[string]any) {
		inputs = append(inputs, DomainEventInput{CompanyID: result.CompanyID, StreamType: workspaceDomainStreamType, StreamID: result.CompanyID, Type: eventType, Payload: payload, TimingRecorder: timings})
	}
	for _, item := range result.FolderItems {
		appendEvent("company_explorer_item_placed", map[string]any{"parent_entity_id": item.FolderID, "target_type": item.ItemType, "target_id": item.ItemID, "folder_item": item})
	}
	for _, item := range result.Nodes {
		appendEvent("node_created", map[string]any{"node_id": item.NodeID, "node": item})
	}
	for _, item := range result.LogicGates {
		appendEvent("logic_gate_created", map[string]any{"logic_gate_id": item.LogicGateID, "logic_gate": item})
	}
	for _, item := range result.Relationships {
		appendEvent("relationship_created", map[string]any{"node_relationship_id": item.NodeRelationshipID, "node_id_a": item.NodeIDA, "node_id_b": item.NodeIDB, "relationship": item})
	}
	return inputs
}
