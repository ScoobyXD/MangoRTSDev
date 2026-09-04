package store

import (
	"miraeopus/backend/internal/domain"
	"sync/atomic"
)

// Like the database sequence, this is never rewound by transaction rollback or
// recycle restore, so a pre-delete save cannot match a restored layout revision.
var memoryProcessStepMapRevision atomic.Int64

func (r *MemoryRepo) GetProcessStepMap(companyID, logicGateID string) (domain.ProcessStepMapLayout, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, exists := r.logicGates[key(companyID, logicGateID)]; !exists {
		return domain.ProcessStepMapLayout{}, ErrNotFound
	}
	if layout, exists := r.processStepMaps[key(companyID, logicGateID)]; exists {
		return cloneProcessStepMap(layout), nil
	}
	return emptyProcessStepMap(companyID, logicGateID), nil
}

func (r *MemoryRepo) PutProcessStepMap(input ProcessStepMapPutInput) (ProcessStepMapMutationResult, error) {
	layout, err := normalizeProcessStepMap(input)
	if err != nil {
		return ProcessStepMapMutationResult{}, err
	}
	input.CompanyID, input.LogicGateID = layout.CompanyID, layout.LogicGateID
	r.mu.Lock()
	defer r.mu.Unlock()
	ownerKey := key(input.CompanyID, input.LogicGateID)
	if _, exists := r.logicGates[ownerKey]; !exists {
		return ProcessStepMapMutationResult{}, ErrNotFound
	}
	if input.ActorUserID != "" && !r.userHasEffectiveAccessLocked(input.CompanyID, input.ActorUserID, EntityTypeLogicGate, input.LogicGateID, EntityPermissionEdit) {
		return ProcessStepMapMutationResult{}, ErrNotFound
	}
	if r.processStepMaps[ownerKey].Revision != input.BaseRevision {
		return ProcessStepMapMutationResult{}, ErrVersionConflict
	}
	for _, step := range layout.Steps {
		if !r.processStepBelongsLocked(input.CompanyID, input.LogicGateID, &step.ProcessStepID) {
			return ProcessStepMapMutationResult{}, ErrInvalid
		}
	}
	for _, route := range layout.Routes {
		edge, exists := r.resourceOperationalRelationships[key(input.CompanyID, route.ResourceOperationalRelationshipID)]
		if !exists || edge.Source.ResourceType != "process_step" || edge.Target.ResourceType != "process_step" || !r.processStepBelongsLocked(input.CompanyID, input.LogicGateID, &edge.Source.ResourceID) || !r.processStepBelongsLocked(input.CompanyID, input.LogicGateID, &edge.Target.ResourceID) {
			return ProcessStepMapMutationResult{}, ErrInvalid
		}
	}
	events, err := r.appendDomainEventsLocked([]DomainEventInput{processWorkChangedEvent(input.CompanyID, input.LogicGateID, input.ActorUserID)})
	if err != nil {
		return ProcessStepMapMutationResult{}, err
	}
	layout.Revision = memoryProcessStepMapRevision.Add(1)
	r.processStepMaps[ownerKey] = layout
	return ProcessStepMapMutationResult{ProcessStepMapLayout: cloneProcessStepMap(layout), Events: events}, nil
}

func (r *MemoryRepo) pruneProcessStepMapsLocked(companyID string) {
	for ownerKey, original := range r.processStepMaps {
		if original.CompanyID != companyID {
			continue
		}
		if _, exists := r.logicGates[ownerKey]; !exists {
			delete(r.processStepMaps, ownerKey)
			continue
		}
		layout := emptyProcessStepMap(companyID, original.LogicGateID)
		for _, step := range original.Steps {
			if r.processStepBelongsLocked(companyID, original.LogicGateID, &step.ProcessStepID) {
				layout.Steps = append(layout.Steps, step)
			}
		}
		for _, route := range original.Routes {
			if _, exists := r.resourceOperationalRelationships[key(companyID, route.ResourceOperationalRelationshipID)]; exists {
				layout.Routes = append(layout.Routes, route)
			}
		}
		if len(layout.Steps) != len(original.Steps) || len(layout.Routes) != len(original.Routes) {
			layout.Revision = memoryProcessStepMapRevision.Add(1)
			r.processStepMaps[ownerKey] = cloneProcessStepMap(layout)
		}
	}
}
