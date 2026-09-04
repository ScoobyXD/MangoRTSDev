package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
)

type ProcessStepMapPutInput struct {
	CompanyID    string
	LogicGateID  string
	BaseRevision int64
	Steps        []domain.ProcessStepMapRectangle
	Routes       []domain.ProcessStepMapRoute
	ActorUserID  string
}

type ProcessStepMapMutationResult struct {
	domain.ProcessStepMapLayout
	Events []domain.DomainEvent `json:"-"`
}

func emptyProcessStepMap(companyID, logicGateID string) domain.ProcessStepMapLayout {
	return domain.ProcessStepMapLayout{CompanyID: companyID, LogicGateID: logicGateID, Steps: []domain.ProcessStepMapRectangle{}, Routes: []domain.ProcessStepMapRoute{}}
}

func cloneProcessStepMap(layout domain.ProcessStepMapLayout) domain.ProcessStepMapLayout {
	layout.Steps = append([]domain.ProcessStepMapRectangle{}, layout.Steps...)
	layout.Routes = append([]domain.ProcessStepMapRoute{}, layout.Routes...)
	for i := range layout.Routes {
		layout.Routes[i].Points = append([]domain.ProcessMapRoutePoint{}, layout.Routes[i].Points...)
	}
	return layout
}

func normalizeProcessStepMap(input ProcessStepMapPutInput) (domain.ProcessStepMapLayout, error) {
	layout := cloneProcessStepMap(domain.ProcessStepMapLayout{CompanyID: cleanUUIDText(input.CompanyID), LogicGateID: cleanUUIDText(input.LogicGateID), Steps: input.Steps, Routes: input.Routes})
	if cleanUUIDText(input.CompanyID) == "" || cleanUUIDText(input.LogicGateID) == "" || input.BaseRevision < 0 || len(layout.Steps) > 10000 || len(layout.Routes) > 20000 {
		return layout, ErrInvalid
	}
	seenSteps, seenRoutes := map[string]bool{}, map[string]bool{}
	validCoordinate := func(value int) bool { return value >= -1000000 && value <= 1000000 }
	for i := range layout.Steps {
		layout.Steps[i].ProcessStepID = cleanUUIDText(layout.Steps[i].ProcessStepID)
		step := layout.Steps[i]
		if cleanUUIDText(step.ProcessStepID) == "" || seenSteps[step.ProcessStepID] || !validCoordinate(step.X) || !validCoordinate(step.Y) || step.Width < 40 || step.Width > 10000 || step.Height < 40 || step.Height > 10000 {
			return layout, ErrInvalid
		}
		seenSteps[step.ProcessStepID] = true
	}
	for i := range layout.Routes {
		layout.Routes[i].ResourceOperationalRelationshipID = cleanUUIDText(layout.Routes[i].ResourceOperationalRelationshipID)
		route := layout.Routes[i]
		if cleanUUIDText(route.ResourceOperationalRelationshipID) == "" || seenRoutes[route.ResourceOperationalRelationshipID] || len(route.Points) > 256 {
			return layout, ErrInvalid
		}
		seenRoutes[route.ResourceOperationalRelationshipID] = true
		for _, point := range route.Points {
			if !validCoordinate(point.X) || !validCoordinate(point.Y) {
				return layout, ErrInvalid
			}
		}
	}
	sort.Slice(layout.Steps, func(i, j int) bool { return layout.Steps[i].ProcessStepID < layout.Steps[j].ProcessStepID })
	sort.Slice(layout.Routes, func(i, j int) bool {
		return layout.Routes[i].ResourceOperationalRelationshipID < layout.Routes[j].ResourceOperationalRelationshipID
	})
	return layout, nil
}
