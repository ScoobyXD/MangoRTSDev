package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) processStepBelongsLocked(companyID, logicGateID string, stepID *string) bool {
	if stepID == nil {
		return true
	}
	step, ok := r.processSteps[key(companyID, *stepID)]
	return ok && step.LogicGateID == logicGateID
}

func (r *MemoryRepo) processStepsLocked(companyID, logicGateID string) []domain.ProcessStep {
	steps := []domain.ProcessStep{}
	for _, step := range r.processSteps {
		if step.CompanyID == companyID && step.LogicGateID == logicGateID {
			steps = append(steps, step)
		}
	}
	sort.Slice(steps, func(i, j int) bool {
		if steps[i].Position != steps[j].Position {
			return steps[i].Position < steps[j].Position
		}
		return steps[i].ProcessStepID < steps[j].ProcessStepID
	})
	return steps
}

func (r *MemoryRepo) processStepRelationshipsLocked(companyID, logicGateID string) []domain.ResourceOperationalRelationship {
	relationships := []domain.ResourceOperationalRelationship{}
	for _, edge := range r.resourceOperationalRelationships {
		if edge.CompanyID == companyID && edge.Source.ResourceType == "process_step" && edge.Target.ResourceType == "process_step" && r.processStepBelongsLocked(companyID, logicGateID, &edge.Source.ResourceID) && r.processStepBelongsLocked(companyID, logicGateID, &edge.Target.ResourceID) {
			relationships = append(relationships, edge)
		}
	}
	sort.Slice(relationships, func(i, j int) bool {
		return relationships[i].ResourceOperationalRelationshipID < relationships[j].ResourceOperationalRelationshipID
	})
	return relationships
}

func (r *MemoryRepo) CreateProcessStep(input ProcessStepCreateInput) (ProcessStepMutationResult, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.CompanyID == "" || input.LogicGateID == "" || !validProcessStepName(input.Name) {
		return ProcessStepMutationResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.logicGates[key(input.CompanyID, input.LogicGateID)]; !ok {
		return ProcessStepMutationResult{}, ErrNotFound
	}
	if !r.processStepBelongsLocked(input.CompanyID, input.LogicGateID, input.AfterProcessStepID) {
		return ProcessStepMutationResult{}, ErrInvalid
	}
	position := 1000
	for _, step := range r.processSteps {
		if step.CompanyID == input.CompanyID && step.LogicGateID == input.LogicGateID && step.Position >= position {
			position = step.Position + 1000
		}
	}
	now := time.Now().UTC()
	step := domain.ProcessStep{CompanyID: input.CompanyID, LogicGateID: input.LogicGateID, ProcessStepID: newUUIDv7String(), Name: input.Name, Position: position, CreatedTimestamp: now, UpdatedTimestamp: now}
	result := ProcessStepMutationResult{Step: &step}
	if input.AfterProcessStepID != nil {
		edge := domain.ResourceOperationalRelationship{CompanyID: input.CompanyID, ResourceOperationalRelationshipID: newUUIDv7String(), Source: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: *input.AfterProcessStepID}, Target: domain.ProcessMapResourceRef{ResourceType: "process_step", ResourceID: step.ProcessStepID}, CreatedTimestamp: now}
		result.Relationship = &edge
	}
	events, err := r.appendDomainEventsLocked([]DomainEventInput{processWorkChangedEvent(input.CompanyID, input.LogicGateID, input.ActorUserID)})
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	r.processSteps[key(input.CompanyID, step.ProcessStepID)] = step
	if result.Relationship != nil {
		r.resourceOperationalRelationships[key(input.CompanyID, result.Relationship.ResourceOperationalRelationshipID)] = *result.Relationship
	}
	result.Events = events
	return result, nil
}

func (r *MemoryRepo) UpdateProcessStep(input ProcessStepUpdateInput) (ProcessStepMutationResult, error) {
	if input.Name != nil && !validProcessStepName(*input.Name) || input.Position != nil && *input.Position < 0 {
		return ProcessStepMutationResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	step, ok := r.processSteps[key(input.CompanyID, input.ProcessStepID)]
	if !ok || step.LogicGateID != input.LogicGateID {
		return ProcessStepMutationResult{}, ErrNotFound
	}
	if input.Name != nil {
		step.Name = strings.TrimSpace(*input.Name)
	}
	if input.Position != nil {
		step.Position = *input.Position
	}
	step.UpdatedTimestamp = time.Now().UTC()
	events, err := r.appendDomainEventsLocked([]DomainEventInput{processWorkChangedEvent(input.CompanyID, input.LogicGateID, input.ActorUserID)})
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	r.processSteps[key(input.CompanyID, input.ProcessStepID)] = step
	return ProcessStepMutationResult{Step: &step, Events: events}, nil
}

func (r *MemoryRepo) deleteProcessStepLocked(companyID, stepID string) {
	delete(r.processSteps, key(companyID, stepID))
	for assignmentKey, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID == companyID && assignment.ProcessStepID != nil && *assignment.ProcessStepID == stepID {
			assignment.ProcessStepID = nil
			assignment.Version++
			assignment.UpdatedTimestamp = time.Now().UTC()
			r.nodeLogicGateAssignments[assignmentKey] = assignment
			r.bumpNodeViewVersionLocked(companyID, assignment.NodeID)
		}
	}
	for edgeKey, edge := range r.resourceOperationalRelationships {
		if edge.CompanyID == companyID && (edge.Source.ResourceType == "process_step" && edge.Source.ResourceID == stepID || edge.Target.ResourceType == "process_step" && edge.Target.ResourceID == stepID) {
			delete(r.resourceOperationalRelationships, edgeKey)
		}
	}
}

func (r *MemoryRepo) DeleteProcessStep(input ProcessStepDeleteInput) (ProcessStepMutationResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	step, ok := r.processSteps[key(input.CompanyID, input.ProcessStepID)]
	if !ok || step.LogicGateID != input.LogicGateID {
		return ProcessStepMutationResult{}, ErrNotFound
	}
	events, err := r.appendDomainEventsLocked([]DomainEventInput{processWorkChangedEvent(input.CompanyID, input.LogicGateID, input.ActorUserID)})
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	r.deleteProcessStepLocked(input.CompanyID, input.ProcessStepID)
	return ProcessStepMutationResult{Events: events}, nil
}

func (r *MemoryRepo) CreateProcessStepRelationship(input ProcessStepRelationshipInput) (ProcessStepMutationResult, error) {
	if !validProcessStepRelationship(input) {
		return ProcessStepMutationResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.processStepBelongsLocked(input.CompanyID, input.LogicGateID, &input.Source.ResourceID) || !r.processStepBelongsLocked(input.CompanyID, input.LogicGateID, &input.Target.ResourceID) {
		return ProcessStepMutationResult{}, ErrInvalid
	}
	if edge, ok := r.processMapRelationshipBySemanticLocked(input.CompanyID, input.Source, input.Target); ok {
		return ProcessStepMutationResult{Relationship: &edge}, nil
	}
	edge := domain.ResourceOperationalRelationship{CompanyID: input.CompanyID, ResourceOperationalRelationshipID: newUUIDv7String(), Source: input.Source, Target: input.Target, CreatedTimestamp: time.Now().UTC()}
	events, err := r.appendDomainEventsLocked([]DomainEventInput{processWorkChangedEvent(input.CompanyID, input.LogicGateID, input.ActorUserID)})
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	r.resourceOperationalRelationships[key(input.CompanyID, edge.ResourceOperationalRelationshipID)] = edge
	return ProcessStepMutationResult{Relationship: &edge, Events: events}, nil
}

func (r *MemoryRepo) DeleteProcessStepRelationship(input ProcessStepRelationshipDeleteInput) (ProcessStepMutationResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	edge, ok := r.resourceOperationalRelationships[key(input.CompanyID, input.RelationshipID)]
	if !ok || edge.Source.ResourceType != "process_step" || edge.Target.ResourceType != "process_step" || !r.processStepBelongsLocked(input.CompanyID, input.LogicGateID, &edge.Source.ResourceID) || !r.processStepBelongsLocked(input.CompanyID, input.LogicGateID, &edge.Target.ResourceID) {
		return ProcessStepMutationResult{}, ErrNotFound
	}
	events, err := r.appendDomainEventsLocked([]DomainEventInput{processWorkChangedEvent(input.CompanyID, input.LogicGateID, input.ActorUserID)})
	if err != nil {
		return ProcessStepMutationResult{}, err
	}
	delete(r.resourceOperationalRelationships, key(input.CompanyID, input.RelationshipID))
	return ProcessStepMutationResult{Events: events}, nil
}
