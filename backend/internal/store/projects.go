package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const (
	ProjectDefaultStatus = "Active"
	ProjectMaxStatusLen  = 80
)

func NormalizeProjectInput(input ProjectInput, requireProjectID bool) (ProjectInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ProjectID = cleanUUIDText(input.ProjectID)
	input.Name = strings.TrimSpace(input.Name)
	input.Status = NormalizeProjectStatus(input.Status)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	if input.AccountSet && input.AccountID != nil {
		accountID := cleanUUIDText(*input.AccountID)
		if accountID == "" {
			input.AccountID = nil
		} else {
			input.AccountID = &accountID
		}
	}
	if input.TeamSet && input.TeamID != nil {
		teamID := cleanUUIDText(*input.TeamID)
		if teamID == "" {
			input.TeamID = nil
		} else {
			input.TeamID = &teamID
		}
	}
	if input.CompanyID == "" || input.Name == "" || (requireProjectID && input.ProjectID == "") {
		return ProjectInput{}, ErrInvalid
	}
	return input, nil
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
	if !ok || (resourceType != EntityTypeLogicGate && resourceType != EntityTypeNode) {
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

func cloneProject(item domain.Project) domain.Project {
	item.AccountID = cloneStringPointer(item.AccountID)
	item.AccountName = cloneStringPointer(item.AccountName)
	item.TeamID = cloneStringPointer(item.TeamID)
	item.TeamName = cloneStringPointer(item.TeamName)
	return item
}

func cloneProjectRelationshipProjection(item domain.ProjectRelationshipProjection) domain.ProjectRelationshipProjection {
	item.LogicGateID = cloneStringPointer(item.LogicGateID)
	item.NodeID = cloneStringPointer(item.NodeID)
	item.AssignmentID = cloneStringPointer(item.AssignmentID)
	item.Status = cloneStringPointer(item.Status)
	item.StatusColor = cloneStringPointer(item.StatusColor)
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
