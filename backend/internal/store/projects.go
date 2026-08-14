package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const (
	ProjectDefaultStatus  = "Active"
	ProjectHealthOnTrack  = "On Track"
	ProjectHealthAtRisk   = "AT RISK"
	ProjectHealthOffTrack = "Off Track"
	ProjectMaxStatusLen   = 80
)

func NormalizeProjectInput(input ProjectInput, requireProjectID bool) (ProjectInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ProjectID = cleanUUIDText(input.ProjectID)
	input.Name = strings.TrimSpace(input.Name)
	input.Status = NormalizeProjectStatus(input.Status)
	input.Health = NormalizeProjectHealth(input.Health)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.AccountIDs = cleanProjectIDList(input.AccountIDs)
	input.TeamIDs = cleanProjectIDList(input.TeamIDs)
	if input.CompanyID == "" || input.Name == "" || (requireProjectID && input.ProjectID == "") {
		return ProjectInput{}, ErrInvalid
	}
	return input, nil
}

func cleanProjectIDList(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		id := cleanUUIDText(value)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func NormalizeProjectStatus(status string) string {
	status = strings.TrimSpace(status)
	if status == "" {
		return ProjectDefaultStatus
	}
	if len(status) > ProjectMaxStatusLen {
		return status[:ProjectMaxStatusLen]
	}
	return status
}

func NormalizeProjectHealth(health string) string {
	switch strings.TrimSpace(health) {
	case "", ProjectHealthOnTrack:
		return ProjectHealthOnTrack
	case ProjectHealthAtRisk:
		return ProjectHealthAtRisk
	case ProjectHealthOffTrack:
		return ProjectHealthOffTrack
	default:
		return ProjectHealthOnTrack
	}
}

func NormalizeProjectCriticalPathStepInput(input ProjectCriticalPathStepInput) (ProjectCriticalPathStepInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ProjectID = cleanUUIDText(input.ProjectID)
	input.StepID = cleanUUIDText(input.StepID)
	input.Name = strings.TrimSpace(input.Name)
	input.RelationshipID = cleanUUIDText(input.RelationshipID)
	input.DueDate = strings.TrimSpace(input.DueDate)
	input.OwnerType = strings.TrimSpace(input.OwnerType)
	input.OwnerID = cleanUUIDText(input.OwnerID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	if input.CompanyID == "" || input.ProjectID == "" {
		return ProjectCriticalPathStepInput{}, ErrInvalid
	}
	if input.StepID == "" {
		input.StepID = newUUIDv7String()
	}
	if input.DueDate != "" && !validISODate(input.DueDate) {
		return ProjectCriticalPathStepInput{}, ErrInvalid
	}
	if input.OwnerType == "" {
		input.OwnerID = ""
	} else if input.OwnerType != "user" && input.OwnerType != "group" {
		return ProjectCriticalPathStepInput{}, ErrInvalid
	} else if input.OwnerID == "" {
		return ProjectCriticalPathStepInput{}, ErrInvalid
	}
	return input, nil
}

func NormalizeProjectCriticalPathStepDeleteInput(input ProjectCriticalPathStepDeleteInput) (ProjectCriticalPathStepDeleteInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ProjectID = cleanUUIDText(input.ProjectID)
	input.StepID = cleanUUIDText(input.StepID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	if input.CompanyID == "" || input.ProjectID == "" || input.StepID == "" {
		return ProjectCriticalPathStepDeleteInput{}, ErrInvalid
	}
	return input, nil
}

func validISODate(value string) bool {
	if len(value) != 10 {
		return false
	}
	for index, ch := range value {
		switch index {
		case 4, 7:
			if ch != '-' {
				return false
			}
		default:
			if ch < '0' || ch > '9' {
				return false
			}
		}
	}
	return true
}

func NormalizeProjectInformationInput(input ProjectInformationInput) (ProjectInformationInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ProjectID = cleanUUIDText(input.ProjectID)
	input.InformationID = cleanUUIDText(input.InformationID)
	input.Type = strings.TrimSpace(input.Type)
	input.Information = strings.TrimSpace(input.Information)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	if input.CompanyID == "" || input.ProjectID == "" || input.Type == "" || input.Information == "" {
		return ProjectInformationInput{}, ErrInvalid
	}
	if input.InformationID == "" {
		input.InformationID = newUUIDv7String()
	}
	return input, nil
}

func NormalizeProjectProjectionDeleteInput(input ProjectProjectionDeleteInput) (ProjectProjectionDeleteInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ProjectID = cleanUUIDText(input.ProjectID)
	input.InformationID = cleanUUIDText(input.InformationID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	if input.CompanyID == "" || input.ProjectID == "" || input.InformationID == "" {
		return ProjectProjectionDeleteInput{}, ErrInvalid
	}
	return input, nil
}

func NormalizeProjectRelationshipInput(input ProjectRelationshipInput) (ProjectRelationshipInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ProjectID = cleanUUIDText(input.ProjectID)
	input.RelationshipID = cleanUUIDText(input.RelationshipID)
	input.ResourceID = cleanUUIDText(input.ResourceID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	resourceType, ok := NormalizeEntityType(input.ResourceType)
	if !ok {
		return ProjectRelationshipInput{}, ErrInvalid
	}
	if resourceType != EntityTypeNode && resourceType != EntityTypeLogicGate {
		return ProjectRelationshipInput{}, ErrInvalid
	}
	input.ResourceType = resourceType
	if input.CompanyID == "" || input.ProjectID == "" || input.ResourceID == "" {
		return ProjectRelationshipInput{}, ErrInvalid
	}
	if input.RelationshipID == "" {
		input.RelationshipID = newUUIDv7String()
	}
	return input, nil
}

func NormalizeProjectRelationshipDeleteInput(input ProjectRelationshipDeleteInput) (ProjectRelationshipDeleteInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ProjectID = cleanUUIDText(input.ProjectID)
	input.RelationshipID = cleanUUIDText(input.RelationshipID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	if input.CompanyID == "" || input.ProjectID == "" || input.RelationshipID == "" {
		return ProjectRelationshipDeleteInput{}, ErrInvalid
	}
	return input, nil
}

func NormalizeProjectScopedNodeCreateInput(input ProjectScopedNodeCreateInput) (ProjectScopedNodeCreateInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ProjectID = cleanUUIDText(input.ProjectID)
	input.NodeID = cleanUUIDText(input.NodeID)
	input.Title = strings.TrimSpace(input.Title)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.ActorDisplayName = strings.TrimSpace(input.ActorDisplayName)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.CompanyID == "" || input.ProjectID == "" || input.Title == "" {
		return ProjectScopedNodeCreateInput{}, ErrInvalid
	}
	normalized, err := normalizeProjectScopedInitialInformation(input.InitialInformation)
	if err != nil {
		return ProjectScopedNodeCreateInput{}, err
	}
	input.InitialInformation = normalized
	assignment, err := normalizeProjectScopedNodeLogicGateAssignment(input.InitialAssignment)
	if err != nil {
		return ProjectScopedNodeCreateInput{}, err
	}
	input.InitialAssignment = assignment
	return input, nil
}

func NormalizeProjectScopedLogicGateCreateInput(input ProjectScopedLogicGateCreateInput) (ProjectScopedLogicGateCreateInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ProjectID = cleanUUIDText(input.ProjectID)
	input.LogicGateID = cleanUUIDText(input.LogicGateID)
	input.Header = strings.TrimSpace(input.Header)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.CompanyID == "" || input.ProjectID == "" || input.Header == "" {
		return ProjectScopedLogicGateCreateInput{}, ErrInvalid
	}
	normalized, err := normalizeProjectScopedInitialInformation(input.InitialInformation)
	if err != nil {
		return ProjectScopedLogicGateCreateInput{}, err
	}
	input.InitialInformation = normalized
	return input, nil
}

func normalizeProjectScopedInitialInformation(input *ProjectScopedInitialInformationInput) (*ProjectScopedInitialInformationInput, error) {
	if input == nil {
		return nil, nil
	}
	item := ProjectScopedInitialInformationInput{
		Type:          strings.TrimSpace(input.Type),
		Information:   strings.TrimSpace(input.Information),
		InformationID: cleanUUIDText(input.InformationID),
	}
	if item.Type == "" && item.Information == "" && item.InformationID == "" {
		return nil, nil
	}
	if item.Type == "" || item.Information == "" {
		return nil, ErrInvalid
	}
	return &item, nil
}

func normalizeProjectScopedNodeLogicGateAssignment(input *ProjectScopedNodeLogicGateAssignmentInput) (*ProjectScopedNodeLogicGateAssignmentInput, error) {
	if input == nil {
		return nil, nil
	}
	item := ProjectScopedNodeLogicGateAssignmentInput{
		LogicGateID: cleanUUIDText(input.LogicGateID),
		Status:      strings.TrimSpace(input.Status),
		ColumnID:    strings.TrimSpace(input.ColumnID),
		Position:    input.Position,
		Priority:    cloneIntPointer(input.Priority),
		IsIssue:     cloneBoolPointer(input.IsIssue),
	}
	if item.LogicGateID == "" && item.Status == "" && item.ColumnID == "" && item.Priority == nil && item.IsIssue == nil {
		return nil, nil
	}
	if item.LogicGateID == "" {
		return nil, ErrInvalid
	}
	if item.Priority != nil && (*item.Priority < 1 || *item.Priority > 5) {
		return nil, ErrInvalid
	}
	return &item, nil
}

func cloneBoolPointer(value *bool) *bool {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func cloneProject(item domain.Project) domain.Project {
	item.Accounts = append([]domain.Account{}, item.Accounts...)
	item.Teams = append([]domain.CompanyUserGroup{}, item.Teams...)
	item.Fields = append([]domain.EntityField{}, item.Fields...)
	return item
}

func cloneProjectCriticalPathStep(item domain.ProjectCriticalPathStep) domain.ProjectCriticalPathStep {
	item.RelationshipID = cloneStringPointer(item.RelationshipID)
	item.LogicGateID = cloneStringPointer(item.LogicGateID)
	item.NodeID = cloneStringPointer(item.NodeID)
	item.Status = cloneStringPointer(item.Status)
	item.DueDate = cloneStringPointer(item.DueDate)
	item.OwnerID = cloneStringPointer(item.OwnerID)
	return item
}

func cloneProjectRelationshipProjection(item domain.ProjectRelationshipProjection) domain.ProjectRelationshipProjection {
	item.LogicGateID = cloneStringPointer(item.LogicGateID)
	item.NodeID = cloneStringPointer(item.NodeID)
	item.AssignmentID = cloneStringPointer(item.AssignmentID)
	item.Status = cloneStringPointer(item.Status)
	return item
}

func sortProjects(items []domain.Project) {
	sort.Slice(items, func(i, j int) bool {
		left := strings.ToLower(strings.TrimSpace(items[i].Name))
		right := strings.ToLower(strings.TrimSpace(items[j].Name))
		if left != right {
			return left < right
		}
		return items[i].ProjectID < items[j].ProjectID
	})
}

func sortProjectRelationshipProjections(items []domain.ProjectRelationshipProjection) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		if items[i].ResourceType != items[j].ResourceType {
			return items[i].ResourceType < items[j].ResourceType
		}
		left := strings.ToLower(strings.TrimSpace(items[i].DisplayTitle))
		right := strings.ToLower(strings.TrimSpace(items[j].DisplayTitle))
		if left != right {
			return left < right
		}
		return items[i].RelationshipID < items[j].RelationshipID
	})
}
