package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

type nodeViewLoader interface {
	GetNodeDetailsSummary(companyID, nodeID string) (domain.NodeDetails, error)
	ListNodeProjections(companyID, nodeID string) ([]domain.NodeProjection, error)
	ListNodeLogicGateAssignments(companyID, nodeID string) ([]domain.NodeLogicGateAssignment, error)
	ListUnseenNodeContentChanges(input NodeContentChangeListInput) ([]domain.NodeContentChange, error)
	MarkNodeContentChangeSeen(input NodeContentChangeSeenInput) (int, error)
}

type logicGateViewLoader interface {
	GetLogicGateDetails(companyID, logicGateID string) (domain.LogicGateDetails, error)
	ListLogicGateProjections(companyID, logicGateID string) ([]domain.LogicGateProjection, error)
	GetLogicGateWork(companyID, logicGateID string) (domain.LogicGateWorkView, error)
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

	details, err := loader.GetNodeDetailsSummary(companyID, nodeID)
	if err != nil {
		return domain.NodeView{}, err
	}
	projections, err := loader.ListNodeProjections(companyID, nodeID)
	if err != nil {
		return domain.NodeView{}, err
	}
	assignments, err := loader.ListNodeLogicGateAssignments(companyID, nodeID)
	if err != nil {
		return domain.NodeView{}, err
	}

	contentChanges := []domain.NodeContentChange{}
	if userID := strings.TrimSpace(input.UserID); userID != "" {
		contentChanges, err = loader.ListUnseenNodeContentChanges(NodeContentChangeListInput{
			CompanyID: companyID,
			NodeID:    nodeID,
			UserID:    userID,
		})
		if err != nil {
			return domain.NodeView{}, err
		}
		changedProjectionIDs := map[string]bool{}
		for _, change := range contentChanges {
			changedProjectionIDs[change.InformationID] = true
		}
		for _, projection := range projections {
			if projection.Type != "Text box" || changedProjectionIDs[projection.InformationID] {
				continue
			}
			if _, err := loader.MarkNodeContentChangeSeen(NodeContentChangeSeenInput{
				CompanyID: companyID,
				NodeID:    nodeID,
				ChangeID:  nodeProjectionContentChangeID(projection.InformationID, NodeContentChangeAddition),
				UserID:    userID,
			}); err != nil {
				return domain.NodeView{}, err
			}
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

	return domain.NodeView{
		CompanyID:            companyID,
		NodeID:               nodeID,
		Node:                 details.Node,
		Information:          details.Information,
		Projections:          projections,
		Relationships:        details.Relationships,
		LogicGateAssignments: assignments,
		ContentChanges:       contentChanges,
		InformationCount:     details.InformationCount,
		ProjectionCount:      len(projections),
		RelationshipsCount:   details.RelationshipsCount,
		AssignmentCount:      len(assignments),
		ContentChangeCount:   len(contentChanges),
	}, nil
}

func (r *MemoryRepo) GetLogicGateView(companyID, logicGateID string) (domain.LogicGateView, error) {
	return loadLogicGateView(r, companyID, logicGateID)
}

func (r *PostgresRepo) GetLogicGateView(companyID, logicGateID string) (domain.LogicGateView, error) {
	return loadLogicGateView(r, companyID, logicGateID)
}

func loadLogicGateView(loader logicGateViewLoader, companyID, logicGateID string) (domain.LogicGateView, error) {
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
	work, err := loader.GetLogicGateWork(companyID, logicGateID)
	if err != nil {
		return domain.LogicGateView{}, err
	}

	if details.Information == nil {
		details.Information = []domain.LogicGateInformation{}
	}
	if details.Relationships == nil {
		details.Relationships = []domain.LogicGateRelationship{}
	}
	if details.LogicGate.GVICAssignments == nil {
		details.LogicGate.GVICAssignments = []domain.LogicGateGVICAssignment{}
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
		GVICAssignments:     details.LogicGate.GVICAssignments,
		Relationships:       details.Relationships,
		Work:                work,
		InformationCount:    len(details.Information),
		ProjectionCount:     len(projections),
		GVICAssignmentCount: len(details.LogicGate.GVICAssignments),
		RelationshipsCount:  len(details.Relationships),
		AssignmentCount:     len(work.Cards),
		NodeCount:           len(work.Cards),
	}, nil
}
