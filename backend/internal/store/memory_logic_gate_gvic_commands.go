package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

type memoryLogicGateGVICCommandSnapshot struct {
	logicGateGVIC            map[string][]domain.LogicGateGVICAssignment
	gvicAssignments          map[string]domain.ResourceGVICAssignment
	gvicEffective            map[string]domain.ResourceGVICEffectiveAssignment
	entityPermissions        map[string]domain.EntityPermission
	effectiveAccess          map[string]domain.EffectiveResourceAccess
	GVICMatrixProjectionRows map[string]memoryGVICMatrixProjectionRow
	domainEvents             map[string]domain.DomainEvent
	eventRows                map[string]EventRow
	workspaceReadVersions    map[string]int64
}

func (r *MemoryRepo) snapshotLogicGateGVICCommandStateLocked() memoryLogicGateGVICCommandSnapshot {
	return memoryLogicGateGVICCommandSnapshot{
		logicGateGVIC:            cloneMemorySliceMap(r.logicGateGVIC),
		gvicAssignments:          cloneMemoryMap(r.gvicAssignments),
		gvicEffective:            cloneMemoryMap(r.gvicEffectiveAssignments),
		entityPermissions:        cloneMemoryMap(r.entityPermissions),
		effectiveAccess:          cloneMemoryMap(r.effectiveAccess),
		GVICMatrixProjectionRows: cloneMemoryMap(r.GVICMatrixProjectionRows),
		domainEvents:             cloneMemoryMap(r.domainEvents),
		eventRows:                cloneMemoryMap(r.eventRows),
		workspaceReadVersions:    cloneMemoryMap(r.workspaceReadVersions),
	}
}

func (r *MemoryRepo) restoreLogicGateGVICCommandStateLocked(snapshot memoryLogicGateGVICCommandSnapshot) {
	r.logicGateGVIC = snapshot.logicGateGVIC
	r.gvicAssignments = snapshot.gvicAssignments
	r.gvicEffectiveAssignments = snapshot.gvicEffective
	r.entityPermissions = snapshot.entityPermissions
	r.effectiveAccess = snapshot.effectiveAccess
	r.GVICMatrixProjectionRows = snapshot.GVICMatrixProjectionRows
	r.domainEvents = snapshot.domainEvents
	r.eventRows = snapshot.eventRows
	r.workspaceReadVersions = snapshot.workspaceReadVersions
}

func (r *MemoryRepo) AddLogicGateGVICAssignments(input LogicGateGVICAssignmentCommandInput) (LogicGateGVICAssignmentCommandResult, error) {
	return r.applyLogicGateGVICAssignmentCommand(input, LogicGateGVICCommandAdd)
}

func (r *MemoryRepo) RemoveLogicGateGVICAssignments(input LogicGateGVICAssignmentCommandInput) (LogicGateGVICAssignmentCommandResult, error) {
	return r.applyLogicGateGVICAssignmentCommand(input, LogicGateGVICCommandRemove)
}

func (r *MemoryRepo) applyLogicGateGVICAssignmentCommand(input LogicGateGVICAssignmentCommandInput, operation string) (LogicGateGVICAssignmentCommandResult, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	logicGateID := strings.TrimSpace(input.LogicGateID)
	if companyID == "" || logicGateID == "" {
		return LogicGateGVICAssignmentCommandResult{}, ErrInvalid
	}
	commandAssignments, err := normalizeLogicGateGVICCommandAssignments(input.Assignments)
	if err != nil {
		return LogicGateGVICAssignmentCommandResult{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return LogicGateGVICAssignmentCommandResult{}, ErrNotFound
	}
	assignmentsByKey := map[string]domain.LogicGateGVICAssignment{}
	now := time.Now().UTC()
	for _, assignment := range commandAssignments {
		assignmentKey := assignment.role + ":" + assignment.principalType + ":" + assignment.principalID
		if _, ok := assignmentsByKey[assignmentKey]; ok {
			continue
		}
		item, err := r.logicGateGVICAssignmentForPrincipalLocked(companyID, logicGateID, assignment.role, assignment.principalType, assignment.principalID, now)
		if err != nil {
			return LogicGateGVICAssignmentCommandResult{}, err
		}
		assignmentsByKey[assignmentKey] = item
	}

	GVICKey := key(companyID, logicGateID)
	before := r.logicGateGVICAssignmentsAsLogicGateGVICLocked(companyID, logicGateID)
	sortLogicGateGVICAssignments(before)
	assignments := cloneLogicGateGVICAssignments(before)
	existing := map[string]bool{}
	for _, assignment := range assignments {
		existing[logicGateGVICAssignmentPrincipalKey(assignment)] = true
	}

	changed := false
	switch operation {
	case LogicGateGVICCommandAdd:
		for _, commandAssignment := range commandAssignments {
			principalKey := commandAssignment.principalType + ":" + commandAssignment.principalID
			filtered := assignments[:0]
			for _, existingAssignment := range assignments {
				existingPrincipalType, existingPrincipalID := logicGateGVICAssignmentPrincipal(existingAssignment)
				if existingPrincipalType+":"+existingPrincipalID == principalKey && existingAssignment.Role != commandAssignment.role {
					changed = true
					continue
				}
				filtered = append(filtered, existingAssignment)
			}
			assignments = filtered
			assignmentKey := commandAssignment.role + ":" + commandAssignment.principalType + ":" + commandAssignment.principalID
			if existing[assignmentKey] {
				continue
			}
			assignments = append(assignments, assignmentsByKey[assignmentKey])
			existing[assignmentKey] = true
			changed = true
		}
	case LogicGateGVICCommandRemove:
		remove := map[string]bool{}
		for _, commandAssignment := range commandAssignments {
			remove[commandAssignment.role+":"+commandAssignment.principalType+":"+commandAssignment.principalID] = true
		}
		filtered := assignments[:0]
		for _, assignment := range assignments {
			if remove[logicGateGVICAssignmentPrincipalKey(assignment)] {
				changed = true
				continue
			}
			filtered = append(filtered, assignment)
		}
		assignments = filtered
	default:
		return LogicGateGVICAssignmentCommandResult{}, ErrInvalid
	}

	sortLogicGateGVICAssignments(assignments)
	result := LogicGateGVICAssignmentCommandResult{
		CompanyID:         companyID,
		LogicGateID:       logicGateID,
		Operation:         operation,
		Changed:           changed,
		GVICAssignments:   cloneLogicGateGVICAssignments(assignments),
		BeforeAssignments: before,
		Events:            []domain.DomainEvent{},
	}
	var snapshot memoryLogicGateGVICCommandSnapshot
	if changed {
		snapshot = r.snapshotLogicGateGVICCommandStateLocked()
	}
	if !changed {
		return result, nil
	}

	for sourceKey, assignment := range r.gvicAssignments {
		if assignment.CompanyID == companyID && assignment.ResourceType == EntityTypeLogicGate && assignment.ResourceID == logicGateID {
			delete(r.gvicAssignments, sourceKey)
		}
	}
	sourceKeyValue := resourceGVICKey{companyID: companyID, resourceType: EntityTypeLogicGate, resourceID: logicGateID}
	for _, assignment := range assignments {
		principalType, principalID := logicGateGVICAssignmentPrincipal(assignment)
		item := r.resourceGVICAssignmentForPrincipalLocked(sourceKeyValue, normalizedGVICAssignmentInput{
			role:          assignment.Role,
			principalType: principalType,
			principalID:   principalID,
		}, now)
		r.gvicAssignments[gvicSourceAssignmentKey(item.CompanyID, item.ResourceType, item.ResourceID, item.Role, item.PrincipalType, item.PrincipalID)] = item
	}
	r.logicGateGVIC[GVICKey] = assignments
	result.ProjectionDeltas = r.syncGVICMatrixProjectionForLogicGateAssignmentsDeltasLocked(companyID, logicGateID, before, assignments)
	event, err := r.appendDomainEventLocked(logicGateGVICUpdatedWorkspaceEventInput(result, commandAssignments, input))
	if err != nil {
		r.restoreLogicGateGVICCommandStateLocked(snapshot)
		return LogicGateGVICAssignmentCommandResult{}, err
	}
	result.Events = []domain.DomainEvent{event}
	if _, err := r.appendEventRowsLocked(GVICMatrixProjectionDeltaEventInputs(companyID, input.ActorUserID, input.IdempotencyKey, result.ProjectionDeltas)); err != nil {
		r.restoreLogicGateGVICCommandStateLocked(snapshot)
		return LogicGateGVICAssignmentCommandResult{}, err
	}
	return result, nil
}
