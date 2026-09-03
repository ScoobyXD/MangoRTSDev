package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"strings"
	"sync"
)

type nodeViewLoader interface {
	GetNodeDetailsSummary(companyID, nodeID string) (domain.NodeDetails, error)
	ListNodeProjectionSummaries(companyID, nodeID string) ([]domain.NodeProjection, error)
	ListNodeLogicGateAssignments(companyID, nodeID string) ([]domain.NodeLogicGateAssignment, error)
	ListResourceRACIAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceRACIAssignment, error)
	ListNodeTimelineEvents(companyID, nodeID string) ([]domain.NodeTimelineEvent, error)
}

type logicGateViewLoader interface {
	GetLogicGateDetails(companyID, logicGateID string) (domain.LogicGateDetails, error)
	ListLogicGateProjections(companyID, logicGateID string) ([]domain.LogicGateProjection, error)
	GetLogicGateWork(companyID, logicGateID, userID string) (domain.LogicGateWorkView, error)
}

func (r *MemoryRepo) GetNodeView(input NodeViewInput) (domain.NodeView, error) {
	return loadNodeView(r, input)
}

func (r *PostgresRepo) GetNodeView(input NodeViewInput) (domain.NodeView, error) {
	return loadNodeView(r, input)
}

func loadNodeView(loader nodeViewLoader, input NodeViewInput) (domain.NodeView, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.NodeID)
	if companyID == "" || nodeID == "" {
		return domain.NodeView{}, ErrInvalid
	}

	var (
		details         domain.NodeDetails
		projections     []domain.NodeProjection
		assignments     []domain.NodeLogicGateAssignment
		gvicAssignments []domain.ResourceRACIAssignment
		timelineEvents  = []domain.NodeTimelineEvent{}
		detailsErr      error
		projectionsErr  error
		assignmentsErr  error
		gvicErr         error
		timelineErr     error
		waitGroup       sync.WaitGroup
	)
	waitGroup.Add(5)
	go func() {
		defer waitGroup.Done()
		details, detailsErr = loader.GetNodeDetailsSummary(companyID, nodeID)
	}()
	go func() {
		defer waitGroup.Done()
		projections, projectionsErr = loader.ListNodeProjectionSummaries(companyID, nodeID)
	}()
	go func() {
		defer waitGroup.Done()
		assignments, assignmentsErr = loader.ListNodeLogicGateAssignments(companyID, nodeID)
	}()
	go func() {
		defer waitGroup.Done()
		gvicAssignments, gvicErr = loader.ListResourceRACIAssignments(companyID, EntityTypeNode, nodeID)
	}()
	go func() {
		defer waitGroup.Done()
		timelineEvents, timelineErr = loader.ListNodeTimelineEvents(companyID, nodeID)
	}()
	waitGroup.Wait()
	for _, err := range []error{detailsErr, projectionsErr, assignmentsErr, gvicErr, timelineErr} {
		if err != nil {
			return domain.NodeView{}, err
		}
	}
	if details.Information == nil {
		details.Information = []domain.NodeInformation{}
	}
	if details.Relationships == nil {
		details.Relationships = []domain.NodeRelationship{}
	}
	if projections == nil {
		projections = []domain.NodeProjection{}
	}
	if assignments == nil {
		assignments = []domain.NodeLogicGateAssignment{}
	}
	if gvicAssignments == nil {
		gvicAssignments = []domain.ResourceRACIAssignment{}
	}

	return domain.NodeView{
		CompanyID:            companyID,
		NodeID:               nodeID,
		Node:                 details.Node,
		Information:          details.Information,
		Projections:          projections,
		Relationships:        details.Relationships,
		LogicGateAssignments: assignments,
		RACIAssignments:      gvicAssignments,
		InformationCount:     details.InformationCount,
		TimelineEvents:       timelineEvents,
		TimelineEventCount:   len(timelineEvents),
		ProjectionCount:      len(projections),
		RelationshipsCount:   details.RelationshipsCount,
		AssignmentCount:      len(assignments),
	}, nil
}

func nodeProjectionSummaryInformation(information string) string {
	if !strings.HasPrefix(information, editorTextBlockProjectionPrefix) {
		return information
	}
	var payload map[string]any
	if json.Unmarshal([]byte(strings.TrimPrefix(information, editorTextBlockProjectionPrefix)), &payload) != nil {
		return information
	}
	payload["document"] = ""
	encoded, err := json.Marshal(payload)
	if err != nil {
		return information
	}
	return editorTextBlockProjectionPrefix + string(encoded)
}

func (r *MemoryRepo) GetLogicGateView(companyID, logicGateID, userID string) (domain.LogicGateView, error) {
	return loadLogicGateView(r, companyID, logicGateID, userID)
}

func (r *PostgresRepo) GetLogicGateView(companyID, logicGateID, userID string) (domain.LogicGateView, error) {
	return loadLogicGateView(r, companyID, logicGateID, userID)
}

func loadLogicGateView(loader logicGateViewLoader, companyID, logicGateID, userID string) (domain.LogicGateView, error) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return domain.LogicGateView{}, ErrInvalid
	}

	details, err := loader.GetLogicGateDetails(companyID, logicGateID)
	if err != nil {
		return domain.LogicGateView{}, err
	}
	projections, err := loader.ListLogicGateProjections(companyID, logicGateID)
	if err != nil {
		return domain.LogicGateView{}, err
	}
	work, err := loader.GetLogicGateWork(companyID, logicGateID, userID)
	if err != nil {
		return domain.LogicGateView{}, err
	}

	if details.Information == nil {
		details.Information = []domain.LogicGateInformation{}
	}
	if details.LogicGate.RACIAssignments == nil {
		details.LogicGate.RACIAssignments = []domain.LogicGateRACIAssignment{}
	}
	if projections == nil {
		projections = []domain.LogicGateProjection{}
	}

	return domain.LogicGateView{
		CompanyID:           companyID,
		LogicGateID:         logicGateID,
		LogicGate:           details.LogicGate,
		Information:         details.Information,
		Projections:         projections,
		RACIAssignments:     details.LogicGate.RACIAssignments,
		Work:                work,
		InformationCount:    len(details.Information),
		ProjectionCount:     len(projections),
		RACIAssignmentCount: len(details.LogicGate.RACIAssignments),
		AssignmentCount:     len(work.Nodes),
		NodeCount:           len(work.Nodes),
	}, nil
}
