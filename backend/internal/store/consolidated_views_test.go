package store

import (
	"os"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestMemoryConsolidatedNodeViewIncludesDetailsProjectionAndAssignments(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555501"
	repo.EnsureCompany(companyID, "Phase 5 Node View Store Co")

	actor, err := repo.UpsertAuthUser("phase5-node-actor", "node-actor@example.com", "Node Actor")
	if err != nil {
		t.Fatalf("UpsertAuthUser actor: %v", err)
	}
	if _, err := repo.AddCompanyMembership("phase5-node-actor", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership actor: %v", err)
	}
	viewer, err := repo.UpsertAuthUser("phase5-node-viewer", "node-viewer@example.com", "Node Viewer")
	if err != nil {
		t.Fatalf("UpsertAuthUser viewer: %v", err)
	}
	if _, err := repo.AddCompanyMembership("phase5-node-viewer", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership viewer: %v", err)
	}

	logicGate, err := repo.CreateLogicGate(companyID, "Node View Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Node View Item")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		Type:             "Text box",
		Information:      "current node document",
		InformationID:    "55555555-5555-4555-8555-555555555502",
		ActorUserID:      actor.UserID,
		ActorDisplayName: "Node Actor",
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "in_progress",
		Position:    20,
		Priority:    testPriority(3),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	view, err := repo.GetNodeView(NodeViewInput{CompanyID: companyID, NodeID: node.NodeID, UserID: viewer.UserID})
	if err != nil {
		t.Fatalf("GetNodeView: %v", err)
	}
	if view.Node.NodeID != node.NodeID || view.InformationCount != 1 || len(view.Information) != 0 {
		t.Fatalf("node view details = %+v, want node summary without append-only history rows", view)
	}
	if view.ProjectionCount != 1 || len(view.Projections) != 1 || view.Projections[0].Information != "current node document" {
		t.Fatalf("node view projections = %+v, want current editor projection", view.Projections)
	}
	if view.AssignmentCount != 1 || len(view.LogicGateAssignments) != 1 || view.LogicGateAssignments[0].LogicGateID != logicGate.LogicGateID {
		t.Fatalf("node view assignments = %+v, want logic gate assignment", view.LogicGateAssignments)
	}
}

func TestMemoryConsolidatedNodeViewOmitsCanonicalTextboxDocumentBody(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555591"
	repo.EnsureCompany(companyID, "Node projection summary company")
	node, err := repo.CreateNode(companyID, "Projection summary Node")
	if err != nil {
		t.Fatal(err)
	}
	information := editorTextBlockProjectionPrefix + `{"title":"Notes","document":"private canonical body","attachments":[],"color":"#0EA5E9"}`
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", information, "55555555-5555-4555-8555-555555555592"); err != nil {
		t.Fatal(err)
	}

	full, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil || len(full) != 1 || !strings.Contains(full[0].Information, "private canonical body") {
		t.Fatalf("full projections=%+v err=%v", full, err)
	}
	view, err := repo.GetNodeView(NodeViewInput{CompanyID: companyID, NodeID: node.NodeID})
	if err != nil || len(view.Projections) != 1 {
		t.Fatalf("view=%+v err=%v", view, err)
	}
	if strings.Contains(view.Projections[0].Information, "private canonical body") || !strings.Contains(view.Projections[0].Information, `"title":"Notes"`) {
		t.Fatalf("summary projection carried the wrong payload: %s", view.Projections[0].Information)
	}
}

func TestMemoryConsolidatedLogicGateViewIncludesDetailsProjectionRACIAndAssignmentBackedWork(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555511"
	repo.EnsureCompany(companyID, "Phase 5 Logic Gate View Store Co")

	responsible, err := repo.UpsertAuthUser("phase5-gate-responsible", "gate-responsible@example.com", "Gate Responsible")
	if err != nil {
		t.Fatalf("UpsertAuthUser responsible: %v", err)
	}
	if _, err := repo.AddCompanyMembership("phase5-gate-responsible", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership responsible: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Logic Gate View")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Assigned Logic Gate Work")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "current logic gate document", "55555555-5555-4555-8555-555555555512"); err != nil {
		t.Fatalf("AddLogicGateInformation: %v", err)
	}
	if _, err := repo.SetLogicGateRACIAssignments(LogicGateRACIAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{
			Role:   domain.RACIRoleResponsible,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRACIAssignments: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "done",
		Position:    10,
		Priority:    testPriority(2),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	view, err := repo.GetLogicGateView(companyID, logicGate.LogicGateID, "")
	if err != nil {
		t.Fatalf("GetLogicGateView: %v", err)
	}
	if view.LogicGate.LogicGateID != logicGate.LogicGateID || view.InformationCount != 1 {
		t.Fatalf("logic gate view details = %+v, want one history row", view)
	}
	if view.ProjectionCount != 1 || len(view.Projections) != 1 || view.Projections[0].Information != "current logic gate document" {
		t.Fatalf("logic gate view projections = %+v, want current editor projection", view.Projections)
	}
	if view.RACIAssignmentCount != 1 || len(view.RACIAssignments) != 1 || view.RACIAssignments[0].UserID != responsible.UserID {
		t.Fatalf("logic gate view RACI = %+v, want responsible assignment", view.RACIAssignments)
	}
	if view.AssignmentCount != 1 || len(view.Work.Nodes) != 1 || view.Work.Nodes[0].NodeID != node.NodeID {
		t.Fatalf("logic gate view work = %+v, want assignment-backed work card", view.Work.Nodes)
	}
	if len(view.Work.Nodes) != 1 || view.Work.Nodes[0].Status != "Done" {
		t.Fatalf("logic gate synthesized cards = %+v, want done card from assignment", view.Work.Nodes)
	}
}

func TestPhase5ConsolidatedViewSourceShape(t *testing.T) {
	storeSource := strings.ToLower(readPhase5SourceForTest(t, "consolidated_views.go"))
	for _, required := range []string{"getlogicgatework", "listnodelogicgateassignments", "getnodedetailssummary"} {
		if !strings.Contains(storeSource, required) {
			t.Fatalf("consolidated view store source missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"getnodedetails(companyid, nodeid)",
		"listaccessibleentityids",
		"mangorts_user_can_access_resource",
		"usercanaccessentity",
		"listkanbanboards",
		"listkanbancolumns",
		"listkanbancards",
	} {
		if strings.Contains(storeSource, forbidden) {
			t.Fatalf("consolidated view store source contains forbidden path %q", forbidden)
		}
	}

	handlerSource := strings.ToLower(readPhase5SourceForTest(t, "../http/consolidated_view_handlers.go"))
	for _, forbidden := range []string{
		"listaccessibleentityids",
		"mangorts_user_can_access_resource",
		"usercanaccessentity",
		"requireentityview",
		"requireentityedit",
		"requirekanbanboardview",
		"requirekanbancardview",
		"listkanbanboards",
		"listkanbancolumns",
		"listkanbancards",
	} {
		if strings.Contains(handlerSource, forbidden) {
			t.Fatalf("consolidated view handler source contains forbidden path %q", forbidden)
		}
	}
}

func readPhase5SourceForTest(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile %s: %v", path, err)
	}
	return string(content)
}

type blockingNodeViewLoader struct {
	entered chan string
	release chan struct{}
}

func (loader *blockingNodeViewLoader) enter(name string) {
	loader.entered <- name
	<-loader.release
}

func (loader *blockingNodeViewLoader) GetNodeDetailsSummary(companyID, nodeID string) (domain.NodeDetails, error) {
	loader.enter("details")
	return domain.NodeDetails{Node: domain.Node{CompanyID: companyID, NodeID: nodeID}}, nil
}

func (loader *blockingNodeViewLoader) ListNodeProjectionSummaries(_, _ string) ([]domain.NodeProjection, error) {
	loader.enter("projections")
	return []domain.NodeProjection{}, nil
}

func (loader *blockingNodeViewLoader) ListNodeLogicGateAssignments(_, _ string) ([]domain.NodeLogicGateAssignment, error) {
	loader.enter("assignments")
	return []domain.NodeLogicGateAssignment{}, nil
}
func (loader *blockingNodeViewLoader) ListResourceRACIAssignments(_, _, _ string) ([]domain.ResourceRACIAssignment, error) {
	loader.enter("gvic")
	return []domain.ResourceRACIAssignment{}, nil
}

func (loader *blockingNodeViewLoader) ListNodeTimelineEvents(_, _ string) ([]domain.NodeTimelineEvent, error) {
	loader.enter("timeline")
	return []domain.NodeTimelineEvent{}, nil
}

func TestLoadNodeViewRunsIndependentReadsConcurrently(t *testing.T) {
	loader := &blockingNodeViewLoader{
		entered: make(chan string, 5),
		release: make(chan struct{}),
	}
	done := make(chan error, 1)
	go func() {
		_, err := loadNodeView(loader, NodeViewInput{
			CompanyID: "55555555-5555-4555-8555-555555555591",
			NodeID:    "55555555-5555-4555-8555-555555555592",
			UserID:    "55555555-5555-4555-8555-555555555593",
		})
		done <- err
	}()

	entered := map[string]bool{}
	for len(entered) < 5 {
		select {
		case name := <-loader.entered:
			entered[name] = true
		case <-time.After(time.Second):
			close(loader.release)
			t.Fatalf("node view reads did not overlap; entered=%v", entered)
		}
	}
	close(loader.release)
	if err := <-done; err != nil {
		t.Fatalf("loadNodeView: %v", err)
	}
}
