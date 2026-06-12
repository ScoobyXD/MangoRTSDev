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
		DefaultAccess:    ResourceDefaultAccessEdit,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.applyProjectOwnershipLocked(&project, input.AccountIDs, input.TeamIDs)
	r.projects[key(input.CompanyID, input.ProjectID)] = project
	r.setProjectAccountAssignmentsLocked(input.CompanyID, input.ProjectID, input.AccountIDs)
	r.setProjectTeamAssignmentsLocked(input.CompanyID, input.ProjectID, input.TeamIDs)

	var folderItem *domain.CompanyExplorerFolderItem
	if activeFolder, ok := r.ensureCompanyExplorerSystemFolderLocked(input.CompanyID, CompanyExplorerSystemActiveProjectsKey); ok {
		item, _, err := r.assignCompanyExplorerFolderItemLocked(input.CompanyID, activeFolder.FolderID, EntityTypeProject, input.ProjectID, 0)
		if err != nil {
			return ProjectMutationResult{}, err
		}
		folderItem = &item
	}
	project = r.withProjectReadModelLocked(project)
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
	project.Name = input.Name
	project.Status = input.Status
	if input.AccountSet || input.AccountIDsSet {
		r.setProjectAccountAssignmentsLocked(input.CompanyID, input.ProjectID, input.AccountIDs)
	}
	if input.TeamSet || input.TeamIDsSet {
		r.setProjectTeamAssignmentsLocked(input.CompanyID, input.ProjectID, input.TeamIDs)
	}
	r.applyProjectOwnershipLocked(&project, r.projectAccountIDsLocked(input.CompanyID, input.ProjectID), r.projectTeamIDsLocked(input.CompanyID, input.ProjectID))
	project.UpdatedTimestamp = time.Now().UTC()
	r.projects[k] = project
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
	if err := r.deleteProjectLocked(companyID, projectID); err != nil {
		return ProjectMutationResult{}, err
	}
	return ProjectMutationResult{DeletedID: projectID}, nil
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
		if viewerUserID != "" && !r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, project.ProjectID, EntityPermissionView) {
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
	folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, EntityTypeProject)
	visible := map[string]bool{}
	for _, item := range r.folderItems {
		if item.CompanyID == companyID && item.ItemType == EntityTypeProject && folderIDs[item.FolderID] {
			visible[item.ItemID] = true
		}
	}
	items := make([]domain.Project, 0, len(visible))
	for _, project := range r.projects {
		if project.CompanyID != companyID || !visible[project.ProjectID] {
			continue
		}
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeProject, project.ProjectID, EntityPermissionView) {
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
	if viewerUserID != "" && !r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, projectID, EntityPermissionView) {
		return domain.ProjectView{}, ErrNotFound
	}
	projections := make([]domain.ProjectProjection, 0, len(r.projectText[key(companyID, projectID)]))
	for _, projection := range r.projectText[key(companyID, projectID)] {
		projections = append(projections, projection)
	}
	sort.Slice(projections, func(i, j int) bool {
		if !projections[i].CreatedTimestamp.Equal(projections[j].CreatedTimestamp) {
			return projections[i].CreatedTimestamp.After(projections[j].CreatedTimestamp)
		}
		return projections[i].InformationID < projections[j].InformationID
	})
	relationships := r.projectRelationshipProjectionsForViewerLocked(companyID, projectID, viewerUserID)
	project = r.withProjectReadModelLocked(project)
	view := domain.ProjectView{
		CompanyID:         companyID,
		ProjectID:         projectID,
		Project:           project,
		Information:       append([]domain.ProjectInformation{}, r.projectInfo[key(companyID, projectID)]...),
		Projections:       projections,
		Relationships:     relationships,
		InformationCount:  len(r.projectInfo[key(companyID, projectID)]),
		ProjectionCount:   len(projections),
		RelationshipCount: len(relationships),
	}
	if viewerUserID != "" {
		view.CanView = true
		view.CanEdit = r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, projectID, EntityPermissionEdit)
		view.CanAdmin = r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, projectID, EntityPermissionAdmin)
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
	previousProjection, hadProjection := r.projectText[k][projectionID]
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
	if eventInput, ok := EditorProjectionUpsertEventInput(input.CompanyID, input.ActorUserID, "", EditorProjectionRowFromProject(projection)); ok {
		if _, err := r.appendEventRowsLocked([]EventRowInput{eventInput}); err != nil {
			for index := range r.projectInfo[k] {
				if r.projectInfo[k][index].InformationID == item.InformationID {
					r.projectInfo[k] = append(r.projectInfo[k][:index], r.projectInfo[k][index+1:]...)
					break
				}
			}
			if hadProjection {
				r.projectText[k][projectionID] = previousProjection
			} else {
				delete(r.projectText[k], projectionID)
			}
			return domain.ProjectInformation{}, err
		}
	}
	return item, nil
}

func (r *MemoryRepo) ListProjectProjections(companyID, projectID string) ([]domain.ProjectProjection, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.projects[key(companyID, projectID)]; !ok {
		return nil, ErrNotFound
	}
	items := make([]domain.ProjectProjection, 0, len(r.projectText[key(companyID, projectID)]))
	for _, item := range r.projectText[key(companyID, projectID)] {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.After(items[j].CreatedTimestamp)
		}
		return items[i].InformationID < items[j].InformationID
	})
	return items, nil
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
	if existing, ok := r.projectText[k][input.InformationID]; ok {
		delete(r.projectText[k], input.InformationID)
		if eventInput, ok := EditorProjectionDeleteEventInput(input.CompanyID, input.ActorUserID, "", EntityTypeProject, input.ProjectID, input.InformationID); ok {
			if _, err := r.appendEventRowsLocked([]EventRowInput{eventInput}); err != nil {
				r.projectText[k][input.InformationID] = existing
				return err
			}
		}
	}
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
	if !r.entityExistsLocked(input.CompanyID, input.ResourceType, input.ResourceID) {
		return ProjectRelationshipMutationResult{}, ErrNotFound
	}
	relationshipKey := projectRelationshipKey(input.CompanyID, input.RelationshipID)
	for keyValue, relationship := range r.projectRelationships {
		if relationship.CompanyID == input.CompanyID &&
			relationship.ProjectID == input.ProjectID &&
			relationship.ResourceType == input.ResourceType &&
			relationship.ResourceID == input.ResourceID {
			relationshipKey = keyValue
			input.RelationshipID = relationship.RelationshipID
			break
		}
	}
	previousRelationship, hadPreviousRelationship := r.projectRelationships[relationshipKey]
	previousProjection, hadPreviousProjection := r.projectRelationshipProjection[relationshipKey]
	before := r.projectRelationshipProjectionRowsForRelationshipLocked(input.CompanyID, input.RelationshipID)
	now := time.Now().UTC()
	existing := r.projectRelationships[relationshipKey]
	created := now
	if !existing.CreatedTimestamp.IsZero() {
		created = existing.CreatedTimestamp
	}
	relationship := domain.ProjectRelationship{
		CompanyID:        input.CompanyID,
		RelationshipID:   input.RelationshipID,
		ProjectID:        input.ProjectID,
		ResourceType:     input.ResourceType,
		ResourceID:       input.ResourceID,
		Position:         input.Position,
		CreatedTimestamp: created,
		UpdatedTimestamp: now,
	}
	r.projectRelationships[relationshipKey] = relationship
	if err := r.syncProjectRelationshipProjectionLocked(input.CompanyID, input.RelationshipID); err != nil {
		if hadPreviousRelationship {
			r.projectRelationships[relationshipKey] = previousRelationship
		} else {
			delete(r.projectRelationships, relationshipKey)
		}
		if hadPreviousProjection {
			r.projectRelationshipProjection[relationshipKey] = previousProjection
		} else {
			delete(r.projectRelationshipProjection, relationshipKey)
		}
		return ProjectRelationshipMutationResult{}, err
	}
	after := r.projectRelationshipProjectionRowsForRelationshipLocked(input.CompanyID, input.RelationshipID)
	deltas := diffProjectRelationshipProjectionRows(before, after)
	if _, err := r.appendEventRowsLocked(ProjectRelationshipProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, "", deltas)); err != nil {
		if hadPreviousRelationship {
			r.projectRelationships[relationshipKey] = previousRelationship
		} else {
			delete(r.projectRelationships, relationshipKey)
		}
		if hadPreviousProjection {
			r.projectRelationshipProjection[relationshipKey] = previousProjection
		} else {
			delete(r.projectRelationshipProjection, relationshipKey)
		}
		return ProjectRelationshipMutationResult{}, err
	}
	projection := r.projectRelationshipProjection[relationshipKey]
	return ProjectRelationshipMutationResult{Relationship: &projection}, nil
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
	previousProjection, hadPreviousProjection := r.projectRelationshipProjection[relationshipKey]
	delete(r.projectRelationships, relationshipKey)
	delete(r.projectRelationshipProjection, relationshipKey)
	deltas := diffProjectRelationshipProjectionRows(before, nil)
	if _, err := r.appendEventRowsLocked(ProjectRelationshipProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, "", deltas)); err != nil {
		r.projectRelationships[relationshipKey] = relationship
		if hadPreviousProjection {
			r.projectRelationshipProjection[relationshipKey] = previousProjection
		}
		return ProjectRelationshipMutationResult{}, err
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
		if viewerUserID != "" && !r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, projection.ProjectID, EntityPermissionView) {
			continue
		}
		items = append(items, cloneProjectRelationshipProjection(projection))
	}
	sortProjectRelationshipProjections(items)
	return items, nil
}

func (r *MemoryRepo) applyProjectOwnershipLocked(project *domain.Project, accountIDs, teamIDs []string) {
	project.AccountID = firstProjectIDPointer(accountIDs)
	project.TeamID = firstProjectIDPointer(teamIDs)
}

func (r *MemoryRepo) withProjectReadModelLocked(project domain.Project) domain.Project {
	project = cloneProject(project)
	accountIDs := r.projectAccountIDsLocked(project.CompanyID, project.ProjectID)
	if len(accountIDs) == 0 {
		accountIDs = projectIDListFromPointer(project.AccountID)
	}
	project.AccountID = firstProjectIDPointer(accountIDs)
	project.Accounts = make([]domain.Account, 0, len(accountIDs))
	for _, accountID := range accountIDs {
		account, ok := r.accounts[key(project.CompanyID, accountID)]
		if !ok {
			continue
		}
		project.Accounts = append(project.Accounts, account)
	}
	if len(project.Accounts) > 0 {
		name := project.Accounts[0].Name
		project.AccountName = &name
	} else {
		project.AccountName = nil
	}
	teamIDs := r.projectTeamIDsLocked(project.CompanyID, project.ProjectID)
	if len(teamIDs) == 0 {
		teamIDs = projectIDListFromPointer(project.TeamID)
	}
	project.TeamID = firstProjectIDPointer(teamIDs)
	project.Teams = make([]domain.CompanyUserGroup, 0, len(teamIDs))
	for _, teamID := range teamIDs {
		group, ok := r.userGroups[userGroupKey(project.CompanyID, teamID)]
		if !ok {
			continue
		}
		project.Teams = append(project.Teams, group)
	}
	if len(project.Teams) > 0 {
		name := project.Teams[0].Name
		project.TeamName = &name
	} else {
		project.TeamName = nil
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
				if !r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeProject, projection.ProjectID, EntityPermissionView) {
					continue
				}
				if !r.userHasEffectiveAccessLocked(companyID, viewerUserID, projection.ResourceType, projection.ResourceID, EntityPermissionView) {
					continue
				}
			}
			items = append(items, cloneProjectRelationshipProjection(projection))
		}
	}
	sortProjectRelationshipProjections(items)
	return items
}

func (r *MemoryRepo) projectRelationshipProjectionRowsForRelationshipLocked(companyID, relationshipID string) []ProjectRelationshipProjectionRow {
	relationshipKey := projectRelationshipKey(companyID, relationshipID)
	projection, ok := r.projectRelationshipProjection[relationshipKey]
	if !ok {
		return nil
	}
	return []ProjectRelationshipProjectionRow{projectRelationshipProjectionRowFromDomain(projection)}
}

func (r *MemoryRepo) projectRelationshipPermissionProjectionDeltasLocked(companyID, resourceType, resourceID string) []ProjectionDelta {
	rows := make([]ProjectRelationshipProjectionRow, 0)
	for _, projection := range r.projectRelationshipProjection {
		if projection.CompanyID != companyID {
			continue
		}
		switch resourceType {
		case EntityTypeProject:
			if projection.ProjectID != resourceID {
				continue
			}
		case EntityTypeNode:
			if projection.ResourceType != EntityTypeNode || projection.ResourceID != resourceID {
				continue
			}
		case EntityTypeLogicGate:
			logicGateID := strings.TrimSpace(pointerStringValue(projection.LogicGateID))
			if logicGateID != resourceID && !(projection.ResourceType == EntityTypeLogicGate && projection.ResourceID == resourceID) {
				continue
			}
		default:
			continue
		}
		rows = append(rows, projectRelationshipProjectionRowFromDomain(projection))
	}
	return ProjectRelationshipProjectionUpsertDeltas(rows)
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
		statusColor := "#8b5cf6"
		row.LogicGateID = &logicGateID
		row.DisplayTitle = gate.Header
		row.Status = &status
		row.StatusColor = &statusColor
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
		if assignment, ok := r.nodeLogicGateAssignmentLocked(relationship.CompanyID, relationship.ResourceID, ""); ok {
			logicGateID := assignment.LogicGateID
			row.LogicGateID = &logicGateID
			assignmentID := assignment.AssignmentID
			row.AssignmentID = &assignmentID
		}
		row.DisplayTitle = node.Title
		row.Status = cloneStringPointer(node.Status)
		row.StatusColor = cloneStringPointer(node.StatusColor)
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
	delete(r.projectInfo, k)
	delete(r.projectText, k)
	for relationshipKey, relationship := range r.projectRelationships {
		if relationship.CompanyID == companyID && relationship.ProjectID == projectID {
			delete(r.projectRelationships, relationshipKey)
			delete(r.projectRelationshipProjection, relationshipKey)
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
