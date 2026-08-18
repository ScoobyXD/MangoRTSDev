package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) CreateProject(input ProjectInput) (ProjectMutationResult, error) {
	input, err := NormalizeProjectInput(input, false)
	if err != nil {
		return ProjectMutationResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	if input.ProjectID == "" {
		input.ProjectID = newUUIDv7String()
	}
	if _, ok := r.projects[key(input.CompanyID, input.ProjectID)]; ok {
		return ProjectMutationResult{}, ErrAlreadyExists
	}
	now := time.Now().UTC()
	project := domain.Project{
		CompanyID:        input.CompanyID,
		ProjectID:        input.ProjectID,
		Name:             input.Name,
		Status:           input.Status,
		Health:           input.Health,
		DefaultAccess:    ResourceDefaultAccessEdit,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.projects[key(input.CompanyID, input.ProjectID)] = project
	r.setProjectAccountAssignmentsLocked(input.CompanyID, input.ProjectID, input.AccountIDs)
	r.setProjectTeamAssignmentsLocked(input.CompanyID, input.ProjectID, input.TeamIDs)

	project = r.withProjectReadModelLocked(project)
	var folderItem *domain.CompanyExplorerFolderItem
	if input.CompanyExplorerDefaultPlacement {
		r.ensureCompanyExplorerV2CompanyGraphLocked(input.CompanyID)
		r.ensureCompanyExplorerDefaultFoldersLocked(input.CompanyID)
		if r.placeCompanyExplorerItemInDefaultFolderLocked(input.CompanyID, EntityTypeProject, project.ProjectID, true) {
			if item, ok := r.folderItems[folderItemKey(input.CompanyID, EntityTypeProject, project.ProjectID)]; ok {
				folderItem = &item
			}
		}
	}
	return ProjectMutationResult{Project: &project, FolderItem: folderItem}, nil
}

func (r *MemoryRepo) UpdateProject(input ProjectInput) (ProjectMutationResult, error) {
	input, err := NormalizeProjectInput(input, true)
	if err != nil {
		return ProjectMutationResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	k := key(input.CompanyID, input.ProjectID)
	project, ok := r.projects[k]
	if !ok {
		return ProjectMutationResult{}, ErrNotFound
	}
	gvicNodeIDs, gvicLogicGateIDs := r.gvicMatrixProjectAffectedResourceIDsLocked(input.CompanyID, input.ProjectID)
	project.Name = input.Name
	project.Status = input.Status
	project.Health = input.Health
	if input.AccountIDsSet {
		r.setProjectAccountAssignmentsLocked(input.CompanyID, input.ProjectID, input.AccountIDs)
	}
	if input.TeamIDsSet {
		r.setProjectTeamAssignmentsLocked(input.CompanyID, input.ProjectID, input.TeamIDs)
	}
	project.UpdatedTimestamp = time.Now().UTC()
	r.projects[k] = project
	r.syncRACIMatrixProjectionForProjectResourcesLocked(input.CompanyID, gvicNodeIDs, gvicLogicGateIDs)
	project = r.withProjectReadModelLocked(project)
	return ProjectMutationResult{Project: &project}, nil
}

func (r *MemoryRepo) DeleteProject(companyID, projectID, actorUserID string) (ProjectMutationResult, error) {
	companyID = strings.TrimSpace(companyID)
	projectID = strings.TrimSpace(projectID)
	if companyID == "" || projectID == "" {
		return ProjectMutationResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	gvicNodeIDs, gvicLogicGateIDs := r.gvicMatrixProjectAffectedResourceIDsLocked(companyID, projectID)
	if err := r.deleteProjectLocked(companyID, projectID); err != nil {
		return ProjectMutationResult{}, err
	}
	r.syncRACIMatrixProjectionForProjectResourcesLocked(companyID, gvicNodeIDs, gvicLogicGateIDs)
	return ProjectMutationResult{DeletedID: projectID}, nil
}

func (r *MemoryRepo) gvicMatrixProjectAffectedResourceIDsLocked(companyID, projectID string) ([]string, []string) {
	nodeSet := map[string]bool{}
	logicGateSet := map[string]bool{}
	for _, projection := range r.projectRelationshipProjection {
		if projection.CompanyID != companyID || projection.ProjectID != projectID {
			continue
		}
		if projection.NodeID != nil {
			if nodeID := strings.TrimSpace(*projection.NodeID); nodeID != "" {
				nodeSet[nodeID] = true
			}
		}
		if projection.LogicGateID != nil {
			if logicGateID := strings.TrimSpace(*projection.LogicGateID); logicGateID != "" {
				logicGateSet[logicGateID] = true
			}
		}
	}
	return mapKeys(nodeSet), mapKeys(logicGateSet)
}

func (r *MemoryRepo) syncRACIMatrixProjectionForProjectResourcesLocked(companyID string, nodeIDs, logicGateIDs []string) {
	for _, nodeID := range cleanUUIDTextSlice(nodeIDs) {
		r.syncRACIMatrixProjectionForNodeLocked(companyID, nodeID)
	}
	for _, logicGateID := range cleanUUIDTextSlice(logicGateIDs) {
		r.syncRACIMatrixProjectionForLogicGateLocked(companyID, logicGateID)
	}
}

func (r *MemoryRepo) GetProject(companyID, projectID string) (domain.Project, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	project, ok := r.projects[key(companyID, projectID)]
	if !ok {
		return domain.Project{}, ErrNotFound
	}
	return r.withProjectReadModelLocked(project), nil
}

func (r *MemoryRepo) ListProjects(companyID, viewerUserID string) ([]domain.Project, error) {
	companyID = strings.TrimSpace(companyID)
	viewerUserID = strings.TrimSpace(viewerUserID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]domain.Project, 0)
	for _, project := range r.projects {
		if project.CompanyID != companyID {
			continue
		}
		if viewerUserID != "" && !r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, project.ProjectID, EntityPermissionEdit) {
			continue
		}
		project = r.withProjectReadModelLocked(project)
		if viewerUserID != "" {
			project.EffectiveAccess = r.effectiveAccessLevelForUserLocked(companyID, viewerUserID, EntityTypeProject, project.ProjectID)
		}
		items = append(items, project)
	}
	sortProjects(items)
	return items, nil
}

func (r *MemoryRepo) ListCompanyExplorerProjectSummaries(companyID string) ([]domain.Project, error) {
	return r.ListProjects(companyID, "")
}

func (r *MemoryRepo) ListVisibleCompanyExplorerProjectSummaries(companyID, userID string) ([]domain.Project, error) {
	return r.ListProjects(companyID, userID)
}

func (r *MemoryRepo) ListCompanyExplorerProjectSummariesInFolderSubtree(companyID, folderID string) ([]domain.Project, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListCompanyExplorerProjectSummaries(companyID)
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, EntityTypeProject)
	visible := map[string]bool{}
	for _, item := range r.folderItems {
		if item.CompanyID == companyID && item.ItemType == EntityTypeProject && folderIDs[item.FolderID] {
			visible[item.ItemID] = true
		}
	}
	items := make([]domain.Project, 0, len(visible))
	for _, project := range r.projects {
		if project.CompanyID == companyID && visible[project.ProjectID] {
			items = append(items, r.withProjectReadModelLocked(project))
		}
	}
	sortProjects(items)
	return items, nil
}

func (r *MemoryRepo) ListVisibleCompanyExplorerProjectSummariesInFolderSubtree(companyID, folderID, userID string) ([]domain.Project, error) {
	folderID = strings.TrimSpace(folderID)
	userID = strings.TrimSpace(userID)
	if strings.TrimSpace(companyID) == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleCompanyExplorerProjectSummaries(companyID, userID)
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	folderIDs := r.visibleCompanyExplorerFolderSubtreeIDsLocked(companyID, folderID, EntityTypeProject, userID)
	visible := map[string]bool{}
	for _, item := range r.folderItems {
		if item.CompanyID == companyID && item.ItemType == EntityTypeProject && folderIDs[item.FolderID] && r.companyExplorerFolderItemVisibleLocked(companyID, userID, item) {
			visible[item.ItemID] = true
		}
	}
	items := make([]domain.Project, 0, len(visible))
	for _, project := range r.projects {
		if project.CompanyID != companyID || !visible[project.ProjectID] {
			continue
		}
		project = r.withProjectReadModelLocked(project)
		project.EffectiveAccess = r.effectiveAccessLevelForUserLocked(companyID, userID, EntityTypeProject, project.ProjectID)
		items = append(items, project)
	}
	sortProjects(items)
	return items, nil
}

func (r *MemoryRepo) GetProjectView(companyID, projectID, viewerUserID string) (domain.ProjectView, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	project, ok := r.projects[key(companyID, projectID)]
	if !ok {
		return domain.ProjectView{}, ErrNotFound
	}
	if viewerUserID != "" && !r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, projectID, EntityPermissionEdit) {
		return domain.ProjectView{}, ErrNotFound
	}
	projections := r.listMemoryProjectProjectionsLocked(companyID, projectID)
	relationships := r.projectRelationshipProjectionsForViewerLocked(companyID, projectID, viewerUserID)
	criticalPath := r.projectCriticalPathStepsForViewerLocked(companyID, projectID, viewerUserID)
	project = r.withProjectReadModelLocked(project)
	view := domain.ProjectView{
		CompanyID:         companyID,
		ProjectID:         projectID,
		Project:           project,
		Information:       append([]domain.ProjectInformation{}, r.projectInfo[key(companyID, projectID)]...),
		Projections:       projections,
		Relationships:     relationships,
		CriticalPath:      criticalPath,
		InformationCount:  len(r.projectInfo[key(companyID, projectID)]),
		ProjectionCount:   len(projections),
		RelationshipCount: len(relationships),
		CriticalPathCount: len(criticalPath),
	}
	if viewerUserID != "" {
		view.CanEdit = r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, projectID, EntityPermissionEdit)
		view.Project.EffectiveAccess = r.effectiveAccessLevelForUserLocked(companyID, viewerUserID, EntityTypeProject, projectID)
	}
	return view, nil
}

func (r *MemoryRepo) AddProjectInformation(input ProjectInformationInput) (domain.ProjectInformation, error) {
	input, err := NormalizeProjectInformationInput(input)
	if err != nil {
		return domain.ProjectInformation{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.projects[key(input.CompanyID, input.ProjectID)]; !ok {
		return domain.ProjectInformation{}, ErrNotFound
	}
	if strings.EqualFold(input.Type, "Attached email") {
		projection, err := r.addMemoryProjectEmailRelationshipLocked(input)
		if err != nil {
			return domain.ProjectInformation{}, err
		}
		return memoryProjectProjectionAsInformation(projection), nil
	}
	if isTextboxChatType(input.Type) {
		projection, err := r.addMemoryProjectTextboxChatLocked(input)
		if err != nil {
			return domain.ProjectInformation{}, err
		}
		return memoryProjectProjectionAsInformation(projection), nil
	}
	now := time.Now().UTC()
	item := domain.ProjectInformation{
		CompanyID:        input.CompanyID,
		InformationID:    newUUIDv7String(),
		ProjectID:        input.ProjectID,
		Type:             input.Type,
		Information:      input.Information,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	k := key(input.CompanyID, input.ProjectID)
	r.projectInfo[k] = append(r.projectInfo[k], item)
	sort.Slice(r.projectInfo[k], func(i, j int) bool {
		return r.projectInfo[k][i].CreatedTimestamp.Before(r.projectInfo[k][j].CreatedTimestamp)
	})
	projectionID := input.InformationID
	created := item.CreatedTimestamp
	if r.projectText[k] == nil {
		r.projectText[k] = map[string]domain.ProjectProjection{}
	}
	if existing, ok := r.projectText[k][projectionID]; ok {
		created = existing.CreatedTimestamp
	}
	projection := domain.ProjectProjection{
		CompanyID:        input.CompanyID,
		ProjectID:        input.ProjectID,
		Type:             input.Type,
		Information:      input.Information,
		InformationID:    projectionID,
		CreatedTimestamp: created,
		UpdatedTimestamp: item.UpdatedTimestamp,
	}
	r.projectText[k][projectionID] = projection

	return item, nil
}

func (r *MemoryRepo) ListProjectProjections(companyID, projectID string) ([]domain.ProjectProjection, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.projects[key(companyID, projectID)]; !ok {
		return nil, ErrNotFound
	}
	return r.listMemoryProjectProjectionsLocked(companyID, projectID), nil
}

func (r *MemoryRepo) DeleteProjectProjection(input ProjectProjectionDeleteInput) error {
	input, err := NormalizeProjectProjectionDeleteInput(input)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.projects[key(input.CompanyID, input.ProjectID)]; !ok {
		return ErrNotFound
	}
	k := key(input.CompanyID, input.ProjectID)
	if relationship, ok := r.projectEmailRelationships[memoryProjectEmailRelationshipKey(input.CompanyID, input.InformationID)]; ok &&
		relationship.ProjectID == input.ProjectID {
		return r.deleteMemoryProjectEmailRelationshipLocked(input, relationship)
	}
	if _, ok := r.projectText[k][input.InformationID]; ok {
		delete(r.projectText[k], input.InformationID)
	}
	return nil
}

func (r *MemoryRepo) ListProjectCriticalPathSteps(companyID, projectID, viewerUserID string) ([]domain.ProjectCriticalPathStep, error) {
	companyID = strings.TrimSpace(companyID)
	projectID = strings.TrimSpace(projectID)
	viewerUserID = strings.TrimSpace(viewerUserID)
	if companyID == "" || projectID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.projects[key(companyID, projectID)]; !ok {
		return nil, ErrNotFound
	}
	return r.projectCriticalPathStepsForViewerLocked(companyID, projectID, viewerUserID), nil
}

func (r *MemoryRepo) UpsertProjectCriticalPathStep(input ProjectCriticalPathStepInput) (domain.ProjectCriticalPathStep, error) {
	input, err := NormalizeProjectCriticalPathStepInput(input)
	if err != nil {
		return domain.ProjectCriticalPathStep{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.projects[key(input.CompanyID, input.ProjectID)]; !ok {
		return domain.ProjectCriticalPathStep{}, ErrNotFound
	}
	if input.RelationshipID != "" {
		relationship, ok := r.projectRelationships[projectRelationshipKey(input.CompanyID, input.RelationshipID)]
		if !ok || relationship.ProjectID != input.ProjectID {
			return domain.ProjectCriticalPathStep{}, ErrNotFound
		}
	}
	if input.IsCurrent {
		for stepKey, step := range r.projectCriticalPathSteps {
			if step.CompanyID == input.CompanyID && step.ProjectID == input.ProjectID && step.StepID != input.StepID && step.IsCurrent {
				step.IsCurrent = false
				step.UpdatedTimestamp = time.Now().UTC()
				r.projectCriticalPathSteps[stepKey] = step
			}
		}
	}
	now := time.Now().UTC()
	stepKey := projectCriticalPathStepKey(input.CompanyID, input.ProjectID, input.StepID)
	existing := r.projectCriticalPathSteps[stepKey]
	created := now
	if !existing.CreatedTimestamp.IsZero() {
		created = existing.CreatedTimestamp
	}
	item := domain.ProjectCriticalPathStep{
		CompanyID:        input.CompanyID,
		ProjectID:        input.ProjectID,
		StepID:           input.StepID,
		Name:             input.Name,
		OwnerType:        input.OwnerType,
		Position:         input.Position,
		IsCurrent:        input.IsCurrent,
		CreatedTimestamp: created,
		UpdatedTimestamp: now,
	}
	if input.RelationshipID != "" {
		item.RelationshipID = stringPointer(input.RelationshipID)
	}
	if input.DueDate != "" {
		item.DueDate = stringPointer(input.DueDate)
	}
	if input.OwnerID != "" {
		item.OwnerID = stringPointer(input.OwnerID)
	}
	r.projectCriticalPathSteps[stepKey] = item
	item = r.withProjectCriticalPathReadModelLocked(item, "")
	return cloneProjectCriticalPathStep(item), nil
}

func (r *MemoryRepo) DeleteProjectCriticalPathStep(input ProjectCriticalPathStepDeleteInput) error {
	input, err := NormalizeProjectCriticalPathStepDeleteInput(input)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	stepKey := projectCriticalPathStepKey(input.CompanyID, input.ProjectID, input.StepID)
	if _, ok := r.projectCriticalPathSteps[stepKey]; !ok {
		return ErrNotFound
	}
	delete(r.projectCriticalPathSteps, stepKey)
	return nil
}

func (r *MemoryRepo) UpsertProjectRelationship(input ProjectRelationshipInput) (ProjectRelationshipMutationResult, error) {
	input, err := NormalizeProjectRelationshipInput(input)
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.projects[key(input.CompanyID, input.ProjectID)]; !ok {
		return ProjectRelationshipMutationResult{}, ErrNotFound
	}
	if input.ResourceType == EntityTypeLogicGate {
		gateProjection, err := r.upsertProjectRelationshipSourceLocked(input)
		if err != nil {
			return ProjectRelationshipMutationResult{}, err
		}
		r.syncRACIMatrixProjectionForProjectResourcesLocked(input.CompanyID, nil, []string{input.ResourceID})
		return ProjectRelationshipMutationResult{
			Relationship: &gateProjection,
		}, nil
	}

	if _, ok := r.nodes[key(input.CompanyID, input.ResourceID)]; !ok {
		return ProjectRelationshipMutationResult{}, ErrNotFound
	}
	assignment, hasAssignment := r.nodeLogicGateAssignmentLocked(input.CompanyID, input.ResourceID, "")
	hasAssignment = hasAssignment && strings.TrimSpace(assignment.LogicGateID) != ""
	alreadyRelated := false
	for _, relationship := range r.projectRelationships {
		if relationship.CompanyID == input.CompanyID && relationship.ProjectID == input.ProjectID &&
			relationship.ResourceType == EntityTypeNode && relationship.ResourceID == input.ResourceID {
			alreadyRelated = true
			break
		}
	}

	previousRelationships := cloneMemoryMap(r.projectRelationships)
	previousProjections := cloneMemoryMap(r.projectRelationshipProjection)
	previousRACIRows := cloneMemoryMap(r.RACIMatrixProjectionRows)
	previousReadVersions := cloneMemoryMap(r.workspaceReadVersions)
	previousTimelineEvents := cloneMemoryMap(r.nodeTimelineEvents)
	rollback := func() {
		r.projectRelationships = previousRelationships
		r.projectRelationshipProjection = previousProjections
		r.RACIMatrixProjectionRows = previousRACIRows
		r.workspaceReadVersions = previousReadVersions
		r.nodeTimelineEvents = previousTimelineEvents
	}

	implicitRelationships := make([]domain.ProjectRelationshipProjection, 0, 1)
	logicGateIDs := make([]string, 0, 1)
	if hasAssignment {
		gateProjection, err := r.upsertProjectRelationshipSourceLocked(ProjectRelationshipInput{
			CompanyID: input.CompanyID, ProjectID: input.ProjectID, ResourceType: EntityTypeLogicGate,
			ResourceID: assignment.LogicGateID, Position: input.Position,
		})
		if err != nil {
			rollback()
			return ProjectRelationshipMutationResult{}, err
		}
		implicitRelationships = append(implicitRelationships, gateProjection)
		logicGateIDs = append(logicGateIDs, assignment.LogicGateID)
	}
	nodeProjection, err := r.upsertProjectRelationshipSourceLocked(input)
	if err != nil {
		rollback()
		return ProjectRelationshipMutationResult{}, err
	}
	r.syncRACIMatrixProjectionForProjectResourcesLocked(input.CompanyID, []string{input.ResourceID}, logicGateIDs)
	if !alreadyRelated {
		r.appendProjectAssignmentTimelineEventLocked(input.CompanyID, input.ResourceID, input.ActorUserID, input.ProjectID, time.Now().UTC())
	}
	return ProjectRelationshipMutationResult{
		Relationship:          &nodeProjection,
		ImplicitRelationships: implicitRelationships,
	}, nil
}

func (r *MemoryRepo) upsertProjectRelationshipSourceLocked(input ProjectRelationshipInput) (domain.ProjectRelationshipProjection, error) {
	resourceType, ok := NormalizeEntityType(input.ResourceType)
	if !ok || (resourceType != EntityTypeNode && resourceType != EntityTypeLogicGate) {
		return domain.ProjectRelationshipProjection{}, ErrInvalid
	}
	if !r.entityExistsLocked(input.CompanyID, resourceType, input.ResourceID) {
		return domain.ProjectRelationshipProjection{}, ErrNotFound
	}
	relationshipID := cleanUUIDText(input.RelationshipID)
	for _, relationship := range r.projectRelationships {
		if relationship.CompanyID != input.CompanyID ||
			relationship.ResourceType != resourceType ||
			relationship.ResourceID != input.ResourceID {
			continue
		}
		if resourceType == EntityTypeNode && relationship.ProjectID != input.ProjectID {
			return domain.ProjectRelationshipProjection{}, ErrProjectNodeInAnotherProject
		}
		if relationship.ProjectID == input.ProjectID {
			relationshipID = relationship.RelationshipID
			break
		}
	}
	if relationshipID == "" {
		relationshipID = newUUIDv7String()
	}
	relationshipKey := projectRelationshipKey(input.CompanyID, relationshipID)
	now := time.Now().UTC()
	created := now
	if existing, ok := r.projectRelationships[relationshipKey]; ok && !existing.CreatedTimestamp.IsZero() {
		created = existing.CreatedTimestamp
	}
	r.projectRelationships[relationshipKey] = domain.ProjectRelationship{
		CompanyID: input.CompanyID, RelationshipID: relationshipID, ProjectID: input.ProjectID,
		ResourceType: resourceType, ResourceID: input.ResourceID, Position: input.Position,
		CreatedTimestamp: created, UpdatedTimestamp: now,
	}
	if err := r.syncProjectRelationshipProjectionLocked(input.CompanyID, relationshipID); err != nil {
		return domain.ProjectRelationshipProjection{}, err
	}
	if resourceType == EntityTypeNode {
		for _, assignment := range r.nodeLogicGateAssignments {
			if assignment.CompanyID == input.CompanyID && assignment.NodeID == input.ResourceID {
				r.bumpLogicGateWorkReadVersionLocked(input.CompanyID, assignment.LogicGateID)
			}
		}
	}
	projection, ok := r.projectRelationshipProjection[relationshipKey]
	if !ok {
		return domain.ProjectRelationshipProjection{}, ErrNotFound
	}
	return projection, nil
}
func (r *MemoryRepo) DeleteProjectRelationship(input ProjectRelationshipDeleteInput) (ProjectRelationshipMutationResult, error) {
	input, err := NormalizeProjectRelationshipDeleteInput(input)
	if err != nil {
		return ProjectRelationshipMutationResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	relationshipKey := projectRelationshipKey(input.CompanyID, input.RelationshipID)
	relationship, ok := r.projectRelationships[relationshipKey]
	if !ok || relationship.ProjectID != input.ProjectID {
		return ProjectRelationshipMutationResult{}, ErrNotFound
	}
	before := r.projectRelationshipProjectionRowsForRelationshipLocked(input.CompanyID, input.RelationshipID)
	gvicNodeSet := map[string]bool{}
	gvicLogicGateSet := map[string]bool{}
	addProjectRelationshipRACIMatrixResourceIDs(gvicNodeSet, gvicLogicGateSet, before)
	gvicNodeIDs := mapKeys(gvicNodeSet)
	gvicLogicGateIDs := mapKeys(gvicLogicGateSet)
	delete(r.projectRelationships, relationshipKey)
	delete(r.projectRelationshipProjection, relationshipKey)
	r.syncRACIMatrixProjectionForProjectResourcesLocked(input.CompanyID, gvicNodeIDs, gvicLogicGateIDs)
	if relationship.ResourceType == EntityTypeNode {
		for _, assignment := range r.nodeLogicGateAssignments {
			if assignment.CompanyID == input.CompanyID && assignment.NodeID == relationship.ResourceID {
				r.bumpLogicGateWorkReadVersionLocked(input.CompanyID, assignment.LogicGateID)
			}
		}
	}

	return ProjectRelationshipMutationResult{DeletedRelationshipID: input.RelationshipID}, nil
}

func (r *MemoryRepo) ListProjectRelationshipProjections(companyID, projectID string) ([]domain.ProjectRelationshipProjection, error) {
	return r.ListProjectRelationshipProjectionsForViewer(companyID, projectID, "")
}

func (r *MemoryRepo) ListProjectRelationshipProjectionsForViewer(companyID, projectID, viewerUserID string) ([]domain.ProjectRelationshipProjection, error) {
	companyID = strings.TrimSpace(companyID)
	projectID = strings.TrimSpace(projectID)
	viewerUserID = strings.TrimSpace(viewerUserID)
	if companyID == "" || projectID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.projects[key(companyID, projectID)]; !ok {
		return nil, ErrNotFound
	}
	return r.projectRelationshipProjectionsForViewerLocked(companyID, projectID, viewerUserID), nil
}

func (r *MemoryRepo) ListProjectRelationshipsForResource(companyID, resourceType, resourceID, viewerUserID string) ([]domain.ProjectRelationshipProjection, error) {
	resourceType, ok := NormalizeEntityType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	viewerUserID = strings.TrimSpace(viewerUserID)
	if strings.TrimSpace(companyID) == "" || resourceID == "" || !ok {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]domain.ProjectRelationshipProjection, 0)
	for _, projection := range r.projectRelationshipProjection {
		if projection.CompanyID != companyID || projection.ResourceType != resourceType || projection.ResourceID != resourceID {
			continue
		}
		if viewerUserID != "" && !r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, projection.ProjectID, EntityPermissionEdit) {
			continue
		}
		items = append(items, cloneProjectRelationshipProjection(projection))
	}
	sortProjectRelationshipProjections(items)
	return items, nil
}

func (r *MemoryRepo) withProjectReadModelLocked(project domain.Project) domain.Project {
	project = cloneProject(project)
	project.Fields = r.entityFieldsForResourceLocked(project.CompanyID, EntityTypeProject, project.ProjectID)
	accountIDs := r.projectAccountIDsLocked(project.CompanyID, project.ProjectID)
	project.Accounts = make([]domain.Account, 0, len(accountIDs))
	for _, accountID := range accountIDs {
		account, ok := r.accounts[key(project.CompanyID, accountID)]
		if !ok {
			continue
		}
		project.Accounts = append(project.Accounts, account)
	}
	teamIDs := r.projectTeamIDsLocked(project.CompanyID, project.ProjectID)
	project.Teams = make([]domain.CompanyUserGroup, 0, len(teamIDs))
	for _, teamID := range teamIDs {
		group, ok := r.userGroups[userGroupKey(project.CompanyID, teamID)]
		if !ok {
			continue
		}
		project.Teams = append(project.Teams, group)
	}
	return project
}

func projectAccountAssignmentKey(companyID, projectID, accountID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(projectID) + ":" + strings.TrimSpace(accountID)
}

func projectTeamAssignmentKey(companyID, projectID, teamID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(projectID) + ":" + strings.TrimSpace(teamID)
}

func splitProjectAssignmentKey(value string) (string, string, string, bool) {
	parts := strings.Split(value, ":")
	if len(parts) != 3 {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}

func (r *MemoryRepo) setProjectAccountAssignmentsLocked(companyID, projectID string, accountIDs []string) {
	for assignmentKey := range r.projectAccountAssignments {
		kCompanyID, kProjectID, _, ok := splitProjectAssignmentKey(assignmentKey)
		if ok && kCompanyID == companyID && kProjectID == projectID {
			delete(r.projectAccountAssignments, assignmentKey)
		}
	}
	for _, accountID := range cleanProjectIDList(accountIDs) {
		r.projectAccountAssignments[projectAccountAssignmentKey(companyID, projectID, accountID)] = true
	}
}

func (r *MemoryRepo) setProjectTeamAssignmentsLocked(companyID, projectID string, teamIDs []string) {
	for assignmentKey := range r.projectTeamAssignments {
		kCompanyID, kProjectID, _, ok := splitProjectAssignmentKey(assignmentKey)
		if ok && kCompanyID == companyID && kProjectID == projectID {
			delete(r.projectTeamAssignments, assignmentKey)
		}
	}
	for _, teamID := range cleanProjectIDList(teamIDs) {
		r.projectTeamAssignments[projectTeamAssignmentKey(companyID, projectID, teamID)] = true
	}
}

func (r *MemoryRepo) projectAccountIDsLocked(companyID, projectID string) []string {
	ids := make([]string, 0)
	for assignmentKey := range r.projectAccountAssignments {
		kCompanyID, kProjectID, accountID, ok := splitProjectAssignmentKey(assignmentKey)
		if ok && kCompanyID == companyID && kProjectID == projectID {
			ids = append(ids, accountID)
		}
	}
	sort.Strings(ids)
	return ids
}

func (r *MemoryRepo) projectTeamIDsLocked(companyID, projectID string) []string {
	ids := make([]string, 0)
	for assignmentKey := range r.projectTeamAssignments {
		kCompanyID, kProjectID, teamID, ok := splitProjectAssignmentKey(assignmentKey)
		if ok && kCompanyID == companyID && kProjectID == projectID {
			ids = append(ids, teamID)
		}
	}
	sort.Strings(ids)
	return ids
}

func (r *MemoryRepo) projectRelationshipProjectionsLocked(companyID, projectID string) []domain.ProjectRelationshipProjection {
	return r.projectRelationshipProjectionsForViewerLocked(companyID, projectID, "")
}

func (r *MemoryRepo) projectRelationshipProjectionsForViewerLocked(companyID, projectID, viewerUserID string) []domain.ProjectRelationshipProjection {
	items := make([]domain.ProjectRelationshipProjection, 0)
	for _, projection := range r.projectRelationshipProjection {
		if projection.CompanyID == companyID && projection.ProjectID == projectID {
			if viewerUserID != "" {
				if !r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, projection.ProjectID, EntityPermissionEdit) {
					continue
				}
				if !r.userHasEffectiveAccessLocked(companyID, viewerUserID, projection.ResourceType, projection.ResourceID, EntityPermissionEdit) {
					continue
				}
			}
			items = append(items, cloneProjectRelationshipProjection(projection))
		}
	}
	sortProjectRelationshipProjections(items)
	return items
}

func (r *MemoryRepo) projectCriticalPathStepsForViewerLocked(companyID, projectID, viewerUserID string) []domain.ProjectCriticalPathStep {
	items := make([]domain.ProjectCriticalPathStep, 0)
	for _, step := range r.projectCriticalPathSteps {
		if step.CompanyID != companyID || step.ProjectID != projectID {
			continue
		}
		items = append(items, r.withProjectCriticalPathReadModelLocked(step, viewerUserID))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].StepID < items[j].StepID
	})
	return items
}

func (r *MemoryRepo) withProjectCriticalPathReadModelLocked(step domain.ProjectCriticalPathStep, viewerUserID string) domain.ProjectCriticalPathStep {
	step = cloneProjectCriticalPathStep(step)
	if step.RelationshipID != nil {
		if projection, ok := r.projectRelationshipProjection[projectRelationshipKey(step.CompanyID, *step.RelationshipID)]; ok {
			canAttach := true
			if viewerUserID != "" {
				canAttach = r.userHasEffectiveAccessLocked(step.CompanyID, viewerUserID, projection.ResourceType, projection.ResourceID, EntityPermissionEdit)
			}
			if canAttach {
				step.ResourceType = projection.ResourceType
				step.ResourceID = projection.ResourceID
				step.LogicGateID = cloneStringPointer(projection.LogicGateID)
				step.NodeID = cloneStringPointer(projection.NodeID)
				step.DisplayTitle = projection.DisplayTitle
				step.Status = cloneStringPointer(projection.Status)
			}
		}
	}
	if step.OwnerID != nil {
		switch step.OwnerType {
		case "user":
			if user, ok := r.users[*step.OwnerID]; ok {
				step.OwnerLabel = strings.TrimSpace(user.DisplayName)
				if step.OwnerLabel == "" {
					step.OwnerLabel = strings.TrimSpace(user.Email)
				}
			}
		case "group":
			if group, ok := r.userGroups[userGroupKey(step.CompanyID, *step.OwnerID)]; ok {
				step.OwnerLabel = strings.TrimSpace(group.Name)
			}
		}
	}
	return step
}

func (r *MemoryRepo) projectRelationshipProjectionRowsForRelationshipLocked(companyID, relationshipID string) []ProjectRelationshipProjectionRow {
	relationshipKey := projectRelationshipKey(companyID, relationshipID)
	projection, ok := r.projectRelationshipProjection[relationshipKey]
	if !ok {
		return nil
	}
	return []ProjectRelationshipProjectionRow{projectRelationshipProjectionRowFromDomain(projection)}
}

func (r *MemoryRepo) syncProjectRelationshipProjectionLocked(companyID, relationshipID string) error {
	relationshipKey := projectRelationshipKey(companyID, relationshipID)
	relationship, ok := r.projectRelationships[relationshipKey]
	if !ok {
		delete(r.projectRelationshipProjection, relationshipKey)
		return nil
	}
	row := domain.ProjectRelationshipProjection{
		CompanyID:                    relationship.CompanyID,
		ProjectID:                    relationship.ProjectID,
		ProjectName:                  relationship.ProjectID,
		RelationshipID:               relationship.RelationshipID,
		ResourceType:                 relationship.ResourceType,
		ResourceID:                   relationship.ResourceID,
		Position:                     relationship.Position,
		RelationshipCreatedTimestamp: relationship.CreatedTimestamp,
		RelationshipUpdatedTimestamp: relationship.UpdatedTimestamp,
		ProjectionUpdatedTimestamp:   time.Now().UTC(),
	}
	if project, ok := r.projects[key(relationship.CompanyID, relationship.ProjectID)]; ok && strings.TrimSpace(project.Name) != "" {
		row.ProjectName = project.Name
	}
	switch relationship.ResourceType {
	case EntityTypeLogicGate:
		gate, ok := r.logicGates[key(relationship.CompanyID, relationship.ResourceID)]
		if !ok {
			delete(r.projectRelationshipProjection, relationshipKey)
			return ErrNotFound
		}
		logicGateID := gate.LogicGateID
		status := "Logic Gate"
		row.LogicGateID = &logicGateID
		row.DisplayTitle = gate.Header
		row.Status = &status
		row.ResourceCreatedTimestamp = gate.CreatedTimestamp
	case EntityTypeNode:
		node, ok := r.nodes[key(relationship.CompanyID, relationship.ResourceID)]
		if !ok {
			delete(r.projectRelationshipProjection, relationshipKey)
			return ErrNotFound
		}
		node = r.withNodeReadModelLocked(node)
		nodeID := node.NodeID
		row.NodeID = &nodeID
		for _, projection := range r.nodeText[key(relationship.CompanyID, relationship.ResourceID)] {
			if strings.EqualFold(strings.TrimSpace(projection.Type), "Attached email") &&
				strings.Contains(projection.Information, `"created_from_email":true`) {
				row.CreatedFromEmail = true
				break
			}
		}
		for _, link := range r.emailNodeLinks {
			if link.CompanyID == relationship.CompanyID && link.NodeID == relationship.ResourceID {
				row.CreatedFromEmail = true
				break
			}
		}
		if assignment, ok := r.nodeLogicGateAssignmentLocked(relationship.CompanyID, relationship.ResourceID, ""); ok {
			logicGateID := assignment.LogicGateID
			row.LogicGateID = &logicGateID
			assignmentID := assignment.AssignmentID
			row.AssignmentID = &assignmentID
		}
		row.DisplayTitle = node.Title
		row.Status = cloneStringPointer(node.Status)
		row.ResourceCreatedTimestamp = node.CreatedTimestamp
	default:
		delete(r.projectRelationshipProjection, relationshipKey)
		return ErrInvalid
	}
	if strings.TrimSpace(row.DisplayTitle) == "" {
		row.DisplayTitle = row.ResourceID
	}
	r.projectRelationshipProjection[relationshipKey] = row
	return nil
}

func projectRelationshipKey(companyID, relationshipID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(relationshipID)
}

func projectCriticalPathStepKey(companyID, projectID, stepID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(projectID) + ":" + strings.TrimSpace(stepID)
}

func (r *MemoryRepo) deleteProjectLocked(companyID, projectID string) error {
	k := key(companyID, projectID)
	if _, ok := r.projects[k]; !ok {
		return ErrNotFound
	}
	delete(r.projects, k)
	for assignmentKey := range r.projectAccountAssignments {
		kCompanyID, kProjectID, _, ok := splitProjectAssignmentKey(assignmentKey)
		if ok && kCompanyID == companyID && kProjectID == projectID {
			delete(r.projectAccountAssignments, assignmentKey)
		}
	}
	for assignmentKey := range r.projectTeamAssignments {
		kCompanyID, kProjectID, _, ok := splitProjectAssignmentKey(assignmentKey)
		if ok && kCompanyID == companyID && kProjectID == projectID {
			delete(r.projectTeamAssignments, assignmentKey)
		}
	}
	r.deleteEntityFieldAssignmentsForResourceLocked(companyID, EntityTypeProject, projectID)
	delete(r.projectInfo, k)
	delete(r.projectText, k)
	for relationshipKey, relationship := range r.projectEmailRelationships {
		if relationship.CompanyID == companyID && relationship.ProjectID == projectID {
			delete(r.projectEmailRelationships, relationshipKey)
		}
	}
	for relationshipKey, relationship := range r.projectRelationships {
		if relationship.CompanyID == companyID && relationship.ProjectID == projectID {
			delete(r.projectRelationships, relationshipKey)
			delete(r.projectRelationshipProjection, relationshipKey)
		}
	}
	for stepKey, step := range r.projectCriticalPathSteps {
		if step.CompanyID == companyID && step.ProjectID == projectID {
			delete(r.projectCriticalPathSteps, stepKey)
		}
	}
	delete(r.folderItems, folderItemKey(companyID, EntityTypeProject, projectID))
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.EntityType == EntityTypeProject && permission.EntityID == projectID {
			delete(r.entityPermissions, permissionKey)
		}
	}
	return nil
}
