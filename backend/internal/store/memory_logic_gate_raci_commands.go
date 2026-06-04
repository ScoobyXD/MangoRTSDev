package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

type memoryLogicGateRaciCommandSnapshot struct {
	logicGateRaci         map[string][]domain.LogicGateRaciAssignment
	entityPermissions     map[string]domain.EntityPermission
	effectiveAccess       map[string]domain.EffectiveResourceAccess
	racioProjectionRows   map[string]memoryRacioProjectionRow
	domainEvents          map[string]domain.DomainEvent
	eventRows             map[string]EventRow
	workspaceReadVersions map[string]int64
}

func (r *MemoryRepo) snapshotLogicGateRaciCommandStateLocked() memoryLogicGateRaciCommandSnapshot {
	return memoryLogicGateRaciCommandSnapshot{
		logicGateRaci:         cloneMemorySliceMap(r.logicGateRaci),
		entityPermissions:     cloneMemoryMap(r.entityPermissions),
		effectiveAccess:       cloneMemoryMap(r.effectiveAccess),
		racioProjectionRows:   cloneMemoryMap(r.racioProjectionRows),
		domainEvents:          cloneMemoryMap(r.domainEvents),
		eventRows:             cloneMemoryMap(r.eventRows),
		workspaceReadVersions: cloneMemoryMap(r.workspaceReadVersions),
	}
}

func (r *MemoryRepo) restoreLogicGateRaciCommandStateLocked(snapshot memoryLogicGateRaciCommandSnapshot) {
	r.logicGateRaci = snapshot.logicGateRaci
	r.entityPermissions = snapshot.entityPermissions
	r.effectiveAccess = snapshot.effectiveAccess
	r.racioProjectionRows = snapshot.racioProjectionRows
	r.domainEvents = snapshot.domainEvents
	r.eventRows = snapshot.eventRows
	r.workspaceReadVersions = snapshot.workspaceReadVersions
}

func (r *MemoryRepo) AddLogicGateRaciAssignments(input LogicGateRaciAssignmentCommandInput) (LogicGateRaciAssignmentCommandResult, error) {
	return r.applyLogicGateRaciAssignmentCommand(input, LogicGateRaciCommandAdd)
}

func (r *MemoryRepo) RemoveLogicGateRaciAssignments(input LogicGateRaciAssignmentCommandInput) (LogicGateRaciAssignmentCommandResult, error) {
	return r.applyLogicGateRaciAssignmentCommand(input, LogicGateRaciCommandRemove)
}

func (r *MemoryRepo) applyLogicGateRaciAssignmentCommand(input LogicGateRaciAssignmentCommandInput, operation string) (LogicGateRaciAssignmentCommandResult, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	logicGateID := strings.TrimSpace(input.LogicGateID)
	if companyID == "" || logicGateID == "" {
		return LogicGateRaciAssignmentCommandResult{}, ErrInvalid
	}
	commandAssignments, err := normalizeLogicGateRaciCommandAssignments(input.Assignments)
	if err != nil {
		return LogicGateRaciAssignmentCommandResult{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return LogicGateRaciAssignmentCommandResult{}, ErrNotFound
	}
	usersByID := map[string]domain.User{}
	for _, assignment := range commandAssignments {
		if _, ok := usersByID[assignment.userID]; ok {
			continue
		}
		user, ok := r.companyUserByIDLocked(companyID, assignment.userID)
		if !ok {
			return LogicGateRaciAssignmentCommandResult{}, ErrAssigneeNotInCompany
		}
		usersByID[assignment.userID] = user
	}

	raciKey := key(companyID, logicGateID)
	before := cloneLogicGateRaciAssignments(r.logicGateRaci[raciKey])
	sortLogicGateRaciAssignments(before)
	assignments := cloneLogicGateRaciAssignments(before)
	existing := map[string]bool{}
	for _, assignment := range assignments {
		existing[assignment.Role+":"+assignment.UserID] = true
	}

	changed := false
	switch operation {
	case LogicGateRaciCommandAdd:
		now := time.Now().UTC()
		for _, commandAssignment := range commandAssignments {
			assignmentKey := commandAssignment.role + ":" + commandAssignment.userID
			if existing[assignmentKey] {
				continue
			}
			user := usersByID[commandAssignment.userID]
			assignments = append(assignments, domain.LogicGateRaciAssignment{
				CompanyID:        companyID,
				LogicGateID:      logicGateID,
				Role:             commandAssignment.role,
				UserID:           user.UserID,
				UserDisplayName:  strings.TrimSpace(user.DisplayName),
				UserEmail:        strings.TrimSpace(user.Email),
				CreatedTimestamp: now,
			})
			existing[assignmentKey] = true
			changed = true
		}
	case LogicGateRaciCommandRemove:
		remove := map[string]bool{}
		for _, commandAssignment := range commandAssignments {
			remove[commandAssignment.role+":"+commandAssignment.userID] = true
		}
		filtered := assignments[:0]
		for _, assignment := range assignments {
			if remove[assignment.Role+":"+assignment.UserID] {
				changed = true
				continue
			}
			filtered = append(filtered, assignment)
		}
		assignments = filtered
	default:
		return LogicGateRaciAssignmentCommandResult{}, ErrInvalid
	}

	sortLogicGateRaciAssignments(assignments)
	result := LogicGateRaciAssignmentCommandResult{
		CompanyID:         companyID,
		LogicGateID:       logicGateID,
		Operation:         operation,
		Changed:           changed,
		RaciAssignments:   cloneLogicGateRaciAssignments(assignments),
		BeforeAssignments: before,
		Events:            []domain.DomainEvent{},
	}
	var snapshot memoryLogicGateRaciCommandSnapshot
	if changed {
		snapshot = r.snapshotLogicGateRaciCommandStateLocked()
	}
	if !changed {
		return result, nil
	}

	r.logicGateRaci[raciKey] = assignments
	result.ProjectionDeltas = r.syncRacioProjectionForLogicGateAssignmentsDeltasLocked(companyID, logicGateID, before, assignments)
	event, err := r.appendDomainEventLocked(logicGateRaciUpdatedWorkspaceEventInput(result, commandAssignments, input))
	if err != nil {
		r.restoreLogicGateRaciCommandStateLocked(snapshot)
		return LogicGateRaciAssignmentCommandResult{}, err
	}
	result.Events = []domain.DomainEvent{event}
	if _, err := r.appendEventRowsLocked(RacioProjectionDeltaEventInputs(companyID, input.ActorUserID, input.IdempotencyKey, result.ProjectionDeltas)); err != nil {
		r.restoreLogicGateRaciCommandStateLocked(snapshot)
		return LogicGateRaciAssignmentCommandResult{}, err
	}
	return result, nil
}
