package store

import (
	"encoding/json"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestHuddleActionItemsRealtimeOutboxContractsAreExactAndPermissionScoped(t *testing.T) {
	const companyID = "11111111-1111-4111-8111-810000000001"
	const nodeID = "22222222-2222-4222-8222-810000000002"
	const boardID = "33333333-3333-4333-8333-810000000003"

	for _, test := range []struct {
		name         string
		input        RealtimeOutboxInput
		wantScope    string
		resourceType string
		resourceID   string
		payloadIDKey string
	}{
		{
			name: "node", input: mustHuddleNodeRealtimeInput(t, companyID, nodeID),
			wantScope:    HuddleActionItemsRealtimeScopePrefix + nodeID,
			resourceType: EntityTypeHuddleNode, resourceID: nodeID, payloadIDKey: "huddle_node_id",
		},
		{
			name: "board", input: mustHuddleBoardRealtimeInput(t, companyID, boardID),
			wantScope:    HuddleBoardActionItemsRealtimeScopePrefix + boardID,
			resourceType: EntityTypeHuddleLogicGate, resourceID: boardID, payloadIDKey: "huddle_logic_gate_id",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.input.Scope != test.wantScope || test.input.EventType != HuddleActionItemsChangedEventType ||
				test.input.ResourceType != test.resourceType || test.input.ResourceID != test.resourceID ||
				test.input.Permission != EntityPermissionEdit || test.input.AudienceRestricted {
				t.Fatalf("realtime input = %+v", test.input)
			}
			var payload map[string]any
			if err := json.Unmarshal(test.input.Payload, &payload); err != nil {
				t.Fatal(err)
			}
			if len(payload) != 5 || payload["type"] != HuddleActionItemsChangedEventType ||
				payload["company_id"] != companyID || payload["scope"] != test.wantScope ||
				payload[test.payloadIDKey] != test.resourceID || payload["event_id"] != test.input.EventID {
				t.Fatalf("realtime payload = %s", test.input.Payload)
			}
		})
	}
}

func TestMemoryHuddleLifecycleRealtimeEmitsBoardAndCurrentChildNodeScopes(t *testing.T) {
	repo := NewMemoryRepo()
	user, company := createActionItemTestCompany(t, repo, "huddle-lifecycle-realtime")
	gate, err := repo.CreateLogicGate(company.CompanyID, "Daily")
	if err != nil {
		t.Fatal(err)
	}
	board, err := repo.ConvertLogicGateToHuddle(company.CompanyID, gate.LogicGateID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: board.HuddleLogicGateID, Name: "First", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: board.HuddleLogicGateID, Name: "Second", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}

	resetHuddleActionItemRealtimeForTest(repo)
	if _, err := repo.UpdateHuddleLogicGate(HuddleUpdateInput{CompanyID: company.CompanyID, ResourceID: board.HuddleLogicGateID, Name: "Renamed"}); err != nil {
		t.Fatal(err)
	}
	assertHuddleActionItemRealtimeScopes(t, repo, company.CompanyID, board.HuddleLogicGateID, first.HuddleNodeID, second.HuddleNodeID)

	resetHuddleActionItemRealtimeForTest(repo)
	if err := repo.DeleteHuddleNode(company.CompanyID, first.HuddleNodeID, user.UserID); err != nil {
		t.Fatal(err)
	}
	assertHuddleActionItemRealtimeScopes(t, repo, company.CompanyID, board.HuddleLogicGateID, second.HuddleNodeID)

	recycleItems, err := repo.ListRecycleBinItems(company.CompanyID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	var recycleID string
	for _, item := range recycleItems {
		if item.ObjectKind == EntityTypeHuddleNode && item.ObjectID == first.HuddleNodeID {
			recycleID = item.RecycleBinItemID
		}
	}
	if recycleID == "" {
		t.Fatalf("deleted Huddle Node missing from recycle bin: %+v", recycleItems)
	}
	resetHuddleActionItemRealtimeForTest(repo)
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, user.UserID, []string{recycleID}); err != nil {
		t.Fatal(err)
	}
	assertHuddleActionItemRealtimeScopes(t, repo, company.CompanyID, board.HuddleLogicGateID, first.HuddleNodeID, second.HuddleNodeID)
}

func TestMemoryHuddleRelationshipRemovalAndBoardMoveInvalidateOldAndNewBoards(t *testing.T) {
	repo := NewMemoryRepo()
	user, company := createActionItemTestCompany(t, repo, "huddle-membership-realtime")
	createBoardAndNode := func(name string) (domain.HuddleLogicGate, domain.HuddleNode) {
		t.Helper()
		gate, err := repo.CreateLogicGate(company.CompanyID, name)
		if err != nil {
			t.Fatal(err)
		}
		board, err := repo.ConvertLogicGateToHuddle(company.CompanyID, gate.LogicGateID, user.UserID)
		if err != nil {
			t.Fatal(err)
		}
		node, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: board.HuddleLogicGateID, Name: name + " Node", ActorID: user.UserID})
		if err != nil {
			t.Fatal(err)
		}
		return board, node
	}
	oldBoard, oldNode := createBoardAndNode("Old")
	newBoard, newNode := createBoardAndNode("New")
	item, err := repo.CreateActionItem(ActionItemInput{AnalysisDueDate: "2026-08-01", CompanyID: company.CompanyID, BodyText: "Move me", CreatedByUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	oldRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, oldNode.HuddleNodeID, "Old reference")
	newRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, newNode.HuddleNodeID, "New reference")
	oldCommit := commitActionItemEditorTestDocument(t, repo, oldRef, user.UserID, 0, "old-add", actionItemEditorReference{EntityID: item.EntityID})

	resetHuddleActionItemRealtimeForTest(repo)
	commitActionItemEditorTestDocument(t, repo, oldRef, user.UserID, oldCommit.Revision, "old-remove")
	assertHuddleActionItemRealtimeScopes(t, repo, company.CompanyID, oldBoard.HuddleLogicGateID, oldNode.HuddleNodeID)

	resetHuddleActionItemRealtimeForTest(repo)
	commitActionItemEditorTestDocument(t, repo, newRef, user.UserID, 0, "new-add", actionItemEditorReference{EntityID: item.EntityID})
	assertHuddleActionItemRealtimeScopes(t, repo, company.CompanyID, newBoard.HuddleLogicGateID, newNode.HuddleNodeID)
}

func mustHuddleNodeRealtimeInput(t *testing.T, companyID, nodeID string) RealtimeOutboxInput {
	t.Helper()
	input, err := huddleActionItemsRealtimeOutboxInput(companyID, nodeID)
	if err != nil {
		t.Fatal(err)
	}
	return input
}

func mustHuddleBoardRealtimeInput(t *testing.T, companyID, boardID string) RealtimeOutboxInput {
	t.Helper()
	input, err := huddleBoardActionItemsRealtimeOutboxInput(companyID, boardID)
	if err != nil {
		t.Fatal(err)
	}
	return input
}

func resetHuddleActionItemRealtimeForTest(repo *MemoryRepo) {
	repo.realtimeOutbox = map[string]RealtimeOutboxEvent{}
	repo.realtimeOutboxSequence = 0
}

func assertHuddleActionItemRealtimeScopes(t *testing.T, repo *MemoryRepo, companyID, boardID string, nodeIDs ...string) {
	t.Helper()
	want := map[string]struct {
		resourceType string
		resourceID   string
	}{
		HuddleBoardActionItemsRealtimeScopePrefix + boardID: {resourceType: EntityTypeHuddleLogicGate, resourceID: boardID},
	}
	for _, nodeID := range nodeIDs {
		want[HuddleActionItemsRealtimeScopePrefix+nodeID] = struct {
			resourceType string
			resourceID   string
		}{resourceType: EntityTypeHuddleNode, resourceID: nodeID}
	}
	got := map[string]bool{}
	for _, event := range repo.realtimeOutbox {
		if event.EventType != HuddleActionItemsChangedEventType {
			continue
		}
		expected, exists := want[event.Scope]
		if !exists || got[event.Scope] {
			t.Fatalf("unexpected or duplicate Huddle realtime event: %+v", event)
		}
		if event.CompanyID != companyID || event.ResourceType != expected.resourceType ||
			event.ResourceID != expected.resourceID || event.Permission != EntityPermissionEdit || event.AudienceRestricted {
			t.Fatalf("Huddle realtime event metadata = %+v", event)
		}
		var payload map[string]any
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if payload["type"] != HuddleActionItemsChangedEventType || payload["company_id"] != companyID || payload["scope"] != event.Scope {
			t.Fatalf("Huddle realtime payload = %s", event.Payload)
		}
		got[event.Scope] = true
	}
	if len(got) != len(want) {
		t.Fatalf("Huddle realtime scopes = %v, want %v", got, want)
	}
}
