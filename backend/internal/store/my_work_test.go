package store

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestMemoryMyWorkActionItemsUseExactPersonExcludeDoneAndPageByColorThenDate(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000001"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-action-user")
	other := mustCreateMyWorkMember(t, repo, companyID, "my-work-action-other")

	red := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Red later", ActionItemColorRed, "2026-09-02", ActionItemStatusInProgress)
	yellow := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Yellow first", ActionItemColorYellow, "2026-09-01", ActionItemStatusInProgress)
	missing := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "No color", "", "", ActionItemStatusInProgress)
	mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Done", ActionItemColorRed, "2026-08-01", "done")
	mustCreateAssignedActionItem(t, repo, companyID, other.UserID, "Someone else's", ActionItemColorRed, "2026-08-01", ActionItemStatusInProgress)

	first, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if first.ActionItems == nil || len(first.ActionItems.Items) != 2 || !first.ActionItems.HasMore || first.ActionItems.NextCursor == "" {
		t.Fatalf("first action page = %+v", first.ActionItems)
	}
	if first.ActionItems.Items[0].EntityID != red.EntityID || first.ActionItems.Items[1].EntityID != yellow.EntityID {
		t.Fatalf("first action IDs = %+v, want red then yellow", first.ActionItems.Items)
	}
	second, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Limit: 2, Cursor: first.ActionItems.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if second.ActionItems == nil || len(second.ActionItems.Items) != 1 || second.ActionItems.Items[0].EntityID != missing.EntityID || second.ActionItems.HasMore {
		t.Fatalf("second action page = %+v, want no-color item", second.ActionItems)
	}
	if second.ActionItems.Items[0].Color != nil || second.ActionItems.Items[0].CompletionDueDate != nil {
		t.Fatalf("missing action grouping values leaked as non-nil: %+v", second.ActionItems.Items[0])
	}
}

func TestMemoryMyWorkHistoryReturnsOnlyCompletedAssignedWorkNewestFirst(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000012"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-history-user")
	other := mustCreateMyWorkMember(t, repo, companyID, "my-work-history-other")
	firstDoneAt := time.Date(2026, time.August, 26, 9, 0, 0, 0, time.UTC)
	olderAt := time.Date(2026, time.August, 27, 10, 0, 0, 0, time.UTC)
	newerAt := time.Date(2026, time.August, 28, 11, 0, 0, 0, time.UTC)
	laterSameDoneUpdateAt := time.Date(2026, time.August, 29, 12, 0, 0, 0, time.UTC)

	olderAction := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Older completed action", ActionItemColorYellow, "2026-09-03", "done")
	newerAction := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Newer completed action", ActionItemColorRed, "2026-09-04", "done")
	mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Still active", "", "", ActionItemStatusInProgress)
	mustCreateAssignedActionItem(t, repo, companyID, other.UserID, "Other person's completed action", "", "", "done")
	setMemoryMyWorkActionCompletedAt(t, repo, olderAction, olderAt)
	setMemoryMyWorkActionCompletedAt(t, repo, newerAction, newerAt)

	first, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, History: true, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if first.ActionItems == nil || len(first.ActionItems.Items) != 1 || first.ActionItems.Items[0].EntityID != newerAction.EntityID || !first.ActionItems.HasMore || first.ActionItems.NextCursor == "" {
		t.Fatalf("first Action Item history page = %+v", first.ActionItems)
	}
	if first.ActionItems.Items[0].CompletedTimestamp == nil || !first.ActionItems.Items[0].CompletedTimestamp.Equal(newerAt) || first.ActionItems.Items[0].CompletionDueDateFieldID == "" {
		t.Fatalf("newer Action Item history metadata = %+v", first.ActionItems.Items[0])
	}
	second, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, History: true, Limit: 1, Cursor: first.ActionItems.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if second.ActionItems == nil || len(second.ActionItems.Items) != 1 || second.ActionItems.Items[0].EntityID != olderAction.EntityID || second.ActionItems.HasMore {
		t.Fatalf("second Action Item history page = %+v", second.ActionItems)
	}

	gate, err := repo.CreateLogicGate(companyID, "History process")
	if err != nil {
		t.Fatal(err)
	}
	assignedNode, _, err := repo.CreateNodeWithWorkspaceEvent(companyID, "Assigned completed node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: assignedNode.NodeID, Status: "in progress"}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: assignedNode.NodeID, Status: "done"}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: assignedNode.NodeID, Status: "in progress"}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: assignedNode.NodeID, Status: "done"}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: assignedNode.NodeID, Status: "done", Position: 99}); err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, assignedNode.NodeID, user.UserID, domain.RACIRoleResponsible)
	setMemoryMyWorkNodeDoneSnapshotTimes(t, repo, assignedNode.NodeID, []time.Time{firstDoneAt, newerAt, laterSameDoneUpdateAt})

	rawNode, err := repo.CreateNode(companyID, "Legacy raw completed node")
	if err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, rawNode.NodeID, user.UserID, domain.RACIRoleResponsible)
	repo.mu.Lock()
	raw := repo.nodes[key(companyID, rawNode.NodeID)]
	raw.Status = stringPointer("done")
	raw.CreatedTimestamp = olderAt
	repo.nodes[key(companyID, rawNode.NodeID)] = raw
	repo.mu.Unlock()

	nodes, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, History: true})
	if err != nil {
		t.Fatal(err)
	}
	if nodes.Nodes == nil || len(nodes.Nodes.Items) != 2 || nodes.Nodes.Items[0].NodeID != assignedNode.NodeID || nodes.Nodes.Items[1].NodeID != rawNode.NodeID {
		t.Fatalf("Node history = %+v", nodes.Nodes)
	}
	if nodes.Nodes.Items[0].CompletedTimestamp == nil || !nodes.Nodes.Items[0].CompletedTimestamp.Equal(newerAt) {
		t.Fatalf("completed Node transition time = %+v, want %s despite later same-Done update", nodes.Nodes.Items[0], newerAt)
	}
	if nodes.Nodes.Items[1].CompletedTimestamp == nil || !nodes.Nodes.Items[1].CompletedTimestamp.Equal(olderAt) {
		t.Fatalf("raw Node created-time fallback = %+v", nodes.Nodes.Items[1])
	}
}

func TestMemoryMyWorkActionItemsUsePersonInChargeNotCreatorAndExposeNoContext(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000005"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-pic-user")
	other := mustCreateMyWorkMember(t, repo, companyID, "my-work-pic-other")
	mustCreateActionItemForPIC(t, repo, companyID, user.UserID, other.UserID, "Creator only", "", "", ActionItemStatusInProgress)
	assigned := mustCreateActionItemForPIC(t, repo, companyID, other.UserID, user.UserID, "Assigned only", "", "", ActionItemStatusInProgress)
	setMyWorkActionFieldRaw(t, repo, assigned, ActionItemPersonInChargeFieldTypeID, strings.ToUpper(user.UserID))

	response, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems})
	if err != nil {
		t.Fatal(err)
	}
	if response.ActionItems == nil || len(response.ActionItems.Items) != 1 || response.ActionItems.Items[0].EntityID != assigned.EntityID {
		t.Fatalf("action items = %+v, want exact PIC assignment only", response.ActionItems)
	}
	raw, err := json.Marshal(response.ActionItems.Items[0])
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"process", "project", "resource_type", "resource_id", "context"} {
		if _, exists := fields[forbidden]; exists {
			t.Fatalf("action item JSON leaked %q: %s", forbidden, raw)
		}
	}
}

func TestMemoryMyWorkActionItemPerspectivesUseExactPersonAndAssigner(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000013"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-perspective-user")
	other := mustCreateMyWorkMember(t, repo, companyID, "my-work-perspective-other")

	mine := mustCreateActionItemForPIC(t, repo, companyID, other.UserID, user.UserID, "Mine", ActionItemColorYellow, "2026-09-03", ActionItemStatusInProgress)
	setMyWorkActionField(t, repo, mine, ActionItemAssignedBySystemKey, other.UserID)
	selfAssigned := mustCreateActionItemForPIC(t, repo, companyID, user.UserID, user.UserID, "Self assigned", ActionItemColorRed, "2026-09-01", ActionItemStatusInProgress)
	setMyWorkActionField(t, repo, selfAssigned, ActionItemAssignedBySystemKey, user.UserID)
	delegated := mustCreateActionItemForPIC(t, repo, companyID, user.UserID, other.UserID, "Delegated", ActionItemColorRed, "2026-09-02", ActionItemStatusInProgress)
	setMyWorkActionField(t, repo, delegated, ActionItemAssignedBySystemKey, user.UserID)
	unassigned, err := repo.CreateActionItem(ActionItemInput{CompanyID: companyID, Name: "Unassigned", BodyText: "Unassigned", CreatedByUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	setMyWorkActionField(t, repo, unassigned, ActionItemAssignedBySystemKey, user.UserID)
	notDelegated := mustCreateActionItemForPIC(t, repo, companyID, other.UserID, other.UserID, "Assigned by other", "", "", ActionItemStatusInProgress)
	setMyWorkActionField(t, repo, notDelegated, ActionItemAssignedBySystemKey, other.UserID)
	doneDelegated := mustCreateActionItemForPIC(t, repo, companyID, user.UserID, other.UserID, "Done delegated", ActionItemColorRed, "2026-08-01", "done")
	setMyWorkActionField(t, repo, doneDelegated, ActionItemAssignedBySystemKey, user.UserID)

	mineResponse, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID,
		Section: MyWorkSectionActionItems,
	})
	if err != nil {
		t.Fatal(err)
	}
	if mineResponse.ActionItems == nil || mineResponse.ActionItems.Perspective != MyWorkActionItemPerspectiveMine {
		t.Fatalf("Mine page = %+v", mineResponse.ActionItems)
	}
	mineIDs := map[string]bool{}
	for _, item := range mineResponse.ActionItems.Items {
		mineIDs[item.EntityID] = true
	}
	if len(mineIDs) != 2 || !mineIDs[mine.EntityID] || !mineIDs[selfAssigned.EntityID] {
		t.Fatalf("Mine IDs = %+v, want exact PIC items including self-assignment", mineResponse.ActionItems.Items)
	}

	delegatedResponse, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID,
		Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveDelegated,
	})
	if err != nil {
		t.Fatal(err)
	}
	if delegatedResponse.ActionItems == nil || delegatedResponse.ActionItems.Perspective != MyWorkActionItemPerspectiveDelegated ||
		len(delegatedResponse.ActionItems.Items) != 1 || delegatedResponse.ActionItems.Items[0].EntityID != delegated.EntityID {
		t.Fatalf("Delegated page = %+v, want exact non-self, nonnull delegated item", delegatedResponse.ActionItems)
	}
}

func TestMemoryMyWorkDelegatedPersonGroupingPagesByAuthoritativeNameAndUser(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000014"
	delegator := mustCreateMyWorkMember(t, repo, companyID, "my-work-person-grouping-delegator")
	alphaFirst := mustCreateMyWorkMember(t, repo, companyID, "my-work-person-grouping-alpha-first")
	alphaSecond := mustCreateMyWorkMember(t, repo, companyID, "my-work-person-grouping-alpha-second")
	zulu := mustCreateMyWorkMember(t, repo, companyID, "my-work-person-grouping-zulu")
	setMemoryMyWorkUserProfile(t, repo, alphaFirst.UserID, "  alpha  ", alphaFirst.Email)
	setMemoryMyWorkUserProfile(t, repo, alphaSecond.UserID, "ALPHA", alphaSecond.Email)
	setMemoryMyWorkUserProfile(t, repo, zulu.UserID, "Zulu", zulu.Email)

	createDelegated := func(person domain.User, name string) domain.Entity {
		t.Helper()
		item := mustCreateActionItemForPIC(t, repo, companyID, delegator.UserID, person.UserID, name, ActionItemColorRed, "2026-09-01", ActionItemStatusInProgress)
		setMyWorkActionField(t, repo, item, ActionItemAssignedBySystemKey, delegator.UserID)
		return item
	}
	alphaFirstOne := createDelegated(alphaFirst, "Alpha first one")
	alphaFirstTwo := createDelegated(alphaFirst, "Alpha first two")
	alphaSecondItem := createDelegated(alphaSecond, "Alpha second")
	zuluItem := createDelegated(zulu, "Zulu")

	query := MyWorkQuery{
		CompanyID: companyID, UserID: delegator.UserID, ViewerUserID: delegator.UserID,
		Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveDelegated, Limit: 2,
	}
	first, err := repo.GetMyWork(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if first.ActionItems == nil || len(first.ActionItems.Items) != 2 || !first.ActionItems.HasMore || first.ActionItems.NextCursor == "" ||
		first.ActionItems.Items[0].EntityID != alphaFirstOne.EntityID || first.ActionItems.Items[1].EntityID != alphaFirstTwo.EntityID {
		t.Fatalf("first ascending delegated page = %+v", first.ActionItems)
	}
	for _, item := range first.ActionItems.Items {
		if item.PersonInChargeUserID != alphaFirst.UserID || item.PersonInChargeName != "alpha" {
			t.Fatalf("first ascending delegated identity = %+v", item)
		}
	}
	query.Cursor = first.ActionItems.NextCursor
	second, err := repo.GetMyWork(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if second.ActionItems == nil || len(second.ActionItems.Items) != 2 || second.ActionItems.HasMore ||
		second.ActionItems.Items[0].EntityID != alphaSecondItem.EntityID || second.ActionItems.Items[1].EntityID != zuluItem.EntityID ||
		second.ActionItems.Items[0].PersonInChargeUserID != alphaSecond.UserID || second.ActionItems.Items[0].PersonInChargeName != "ALPHA" ||
		second.ActionItems.Items[1].PersonInChargeUserID != zulu.UserID || second.ActionItems.Items[1].PersonInChargeName != "Zulu" {
		t.Fatalf("second ascending delegated page = %+v", second.ActionItems)
	}

	descendingQuery := MyWorkQuery{
		CompanyID: companyID, UserID: delegator.UserID, ViewerUserID: delegator.UserID,
		Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveDelegated,
		Grouping: "color:asc,huddle_process:asc", Ordering: "person_in_charge:desc", Limit: 2,
	}
	descendingFirst, err := repo.GetMyWork(context.Background(), descendingQuery)
	if err != nil {
		t.Fatal(err)
	}
	if descendingFirst.ActionItems == nil || len(descendingFirst.ActionItems.Items) != 2 || !descendingFirst.ActionItems.HasMore ||
		descendingFirst.ActionItems.Items[0].EntityID != zuluItem.EntityID || descendingFirst.ActionItems.Items[1].EntityID != alphaSecondItem.EntityID {
		t.Fatalf("first descending delegated page = %+v", descendingFirst.ActionItems)
	}
	descendingQuery.Cursor = descendingFirst.ActionItems.NextCursor
	descendingSecond, err := repo.GetMyWork(context.Background(), descendingQuery)
	if err != nil {
		t.Fatal(err)
	}
	if descendingSecond.ActionItems == nil || len(descendingSecond.ActionItems.Items) != 2 || descendingSecond.ActionItems.HasMore ||
		descendingSecond.ActionItems.Items[0].EntityID != alphaFirstOne.EntityID || descendingSecond.ActionItems.Items[1].EntityID != alphaFirstTwo.EntityID {
		t.Fatalf("second descending delegated page = %+v", descendingSecond.ActionItems)
	}
}

func TestMyWorkPersonInChargeNameUsesDisplayNameThenEmailThenUUID(t *testing.T) {
	userID := "20000000-0000-4000-8000-000000000014"
	for _, test := range []struct {
		name        string
		displayName string
		email       string
		userID      string
		want        string
	}{
		{name: "display name", displayName: "  Current Name  ", email: "person@example.test", userID: userID, want: "Current Name"},
		{name: "email", displayName: "  ", email: "  person@example.test  ", userID: userID, want: "person@example.test"},
		{name: "UUID", displayName: "", email: "", userID: strings.ToUpper(userID), want: userID},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := myWorkPersonInChargeName(test.displayName, test.email, test.userID); got != test.want {
				t.Fatalf("myWorkPersonInChargeName() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestMemoryMyWorkActionItemsPageByReorderedDescendingGrouping(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000009"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-action-grouping-user")
	red := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Red earliest", ActionItemColorRed, "2026-09-01", ActionItemStatusInProgress)
	redMiddle := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Red middle", ActionItemColorRed, "2026-09-02", ActionItemStatusInProgress)
	yellow := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Yellow later", ActionItemColorYellow, "2026-09-03", ActionItemStatusInProgress)
	missingDate := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Missing date", ActionItemColorRed, "", ActionItemStatusInProgress)
	grouping := "completion_due_date:desc,color:asc"

	first, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Grouping: grouping, Ordering: MyWorkGroupingNone, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if first.ActionItems == nil || len(first.ActionItems.Items) != 2 || first.ActionItems.Items[0].EntityID != yellow.EntityID || first.ActionItems.Items[1].EntityID != redMiddle.EntityID || !first.ActionItems.HasMore {
		t.Fatalf("first reordered action page = %+v", first.ActionItems)
	}
	second, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Grouping: grouping, Ordering: MyWorkGroupingNone, Limit: 2, Cursor: first.ActionItems.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if second.ActionItems == nil || len(second.ActionItems.Items) != 2 || second.ActionItems.Items[0].EntityID != red.EntityID || second.ActionItems.Items[1].EntityID != missingDate.EntityID || second.ActionItems.HasMore {
		t.Fatalf("second reordered action page = %+v", second.ActionItems)
	}
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Limit: 2, Cursor: first.ActionItems.NextCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-grouping cursor error = %v, want ErrInvalid", err)
	}
}

func TestMemoryMyWorkHuddleProcessGroupingUsesImmutableSourceAndCompactFields(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000015"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-huddle-source-user")
	alpha, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: companyID, Name: "Alpha Process"})
	if err != nil {
		t.Fatal(err)
	}
	zulu, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: companyID, Name: "Zulu Process"})
	if err != nil {
		t.Fatal(err)
	}
	alphaNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: companyID, OwnerID: alpha.HuddleLogicGateID, Name: "Alpha Huddle Node"})
	if err != nil {
		t.Fatal(err)
	}
	zuluNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: companyID, OwnerID: zulu.HuddleLogicGateID, Name: "Zulu Huddle Node"})
	if err != nil {
		t.Fatal(err)
	}

	alphaNodeItem := mustCreateSourcedMyWorkActionItem(t, repo, companyID, user.UserID, "Alpha node item", EntityTypeHuddleNode, alphaNode.HuddleNodeID, "2026-09-01")
	alphaDirectItem := mustCreateSourcedMyWorkActionItem(t, repo, companyID, user.UserID, "Alpha direct item", EntityTypeHuddleLogicGate, alpha.HuddleLogicGateID, "2026-09-02")
	zuluNodeItem := mustCreateSourcedMyWorkActionItem(t, repo, companyID, user.UserID, "Zulu node item", EntityTypeHuddleNode, zuluNode.HuddleNodeID, "2026-09-01")
	noSourceItem := mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "No Huddle process", ActionItemColorRed, "2026-09-01", ActionItemStatusInProgress)

	query := MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Limit: 2}
	first, err := repo.GetMyWork(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if first.ActionItems == nil || len(first.ActionItems.Items) != 2 || !first.ActionItems.HasMore ||
		first.ActionItems.Items[0].EntityID != alphaNodeItem.EntityID || first.ActionItems.Items[1].EntityID != alphaDirectItem.EntityID {
		t.Fatalf("first Huddle-process page = %+v", first.ActionItems)
	}
	alphaNodeRow := first.ActionItems.Items[0]
	if alphaNodeRow.HuddleProcess == nil || alphaNodeRow.HuddleProcess.HuddleLogicGateID != alpha.HuddleLogicGateID || alphaNodeRow.HuddleProcess.Name != alpha.Header {
		t.Fatalf("Alpha node Huddle process = %+v", alphaNodeRow.HuddleProcess)
	}
	if alphaNodeRow.Source == nil || alphaNodeRow.Source.ResourceType != EntityTypeHuddleNode || alphaNodeRow.Source.ResourceID != alphaNode.HuddleNodeID || alphaNodeRow.Source.Name != alphaNode.Name {
		t.Fatalf("Alpha node source = %+v", alphaNodeRow.Source)
	}
	if alphaNodeRow.AssignedByUserID != user.UserID || alphaNodeRow.AssignedByName == "" || alphaNodeRow.AnalysisDueDate == nil || *alphaNodeRow.AnalysisDueDate != "2026-08-31" || alphaNodeRow.Status != ActionItemStatusInProgress || alphaNodeRow.CreatedTimestamp.IsZero() {
		t.Fatalf("compact inline fields = %+v", alphaNodeRow)
	}

	query.Cursor = first.ActionItems.NextCursor
	second, err := repo.GetMyWork(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	if second.ActionItems == nil || len(second.ActionItems.Items) != 2 || second.ActionItems.HasMore ||
		second.ActionItems.Items[0].EntityID != zuluNodeItem.EntityID || second.ActionItems.Items[1].EntityID != noSourceItem.EntityID {
		t.Fatalf("second Huddle-process page = %+v", second.ActionItems)
	}
	if second.ActionItems.Items[0].HuddleProcess == nil || second.ActionItems.Items[0].HuddleProcess.HuddleLogicGateID != zulu.HuddleLogicGateID || second.ActionItems.Items[1].HuddleProcess != nil {
		t.Fatalf("second Huddle-process contexts = %+v", second.ActionItems.Items)
	}
}

func TestMemoryMyWorkHuddleProcessRequiresSourceAndOwnerAccess(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000016"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-hidden-huddle-source-user")
	gate, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: companyID, Name: "Visible owning process"})
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: companyID, OwnerID: gate.HuddleLogicGateID, Name: "Hidden source node"})
	if err != nil {
		t.Fatal(err)
	}
	hidden := mustCreateSourcedMyWorkActionItem(t, repo, companyID, user.UserID, "Hidden-source action", EntityTypeHuddleNode, node.HuddleNodeID, "2026-09-01")
	mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Other neutral action", ActionItemColorRed, "2026-09-01", ActionItemStatusInProgress)
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeHuddleNode, node.HuddleNodeID, user.UserID, EntityPermissionNoAccess)

	response, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	var hiddenRow *domain.MyWorkActionItem
	for index := range response.ActionItems.Items {
		if response.ActionItems.Items[index].EntityID == hidden.EntityID {
			hiddenRow = &response.ActionItems.Items[index]
		}
	}
	if hiddenRow == nil || hiddenRow.Source != nil || hiddenRow.HuddleProcess != nil {
		t.Fatalf("hidden source row leaked context: %+v", hiddenRow)
	}

	page, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Limit: 1})
	if err != nil || page.ActionItems == nil || page.ActionItems.NextCursor == "" {
		t.Fatalf("neutral cursor page = %+v err=%v", page.ActionItems, err)
	}
	payload, err := base64.RawURLEncoding.DecodeString(page.ActionItems.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	var cursor myWorkCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		t.Fatal(err)
	}
	if !cursor.HuddleProcessNull || cursor.HuddleProcessID != "" || cursor.HuddleProcessName != "" {
		t.Fatalf("neutral cursor leaked Huddle process: %+v", cursor)
	}
}

func TestMemoryMyWorkHuddleProcessHidesDeniedOwnerButKeepsVisibleSource(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000017"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-hidden-huddle-owner-user")
	gate, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: companyID, Name: "Hidden owning process"})
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: companyID, OwnerID: gate.HuddleLogicGateID, Name: "Visible source node"})
	if err != nil {
		t.Fatal(err)
	}
	sourced := mustCreateSourcedMyWorkActionItem(t, repo, companyID, user.UserID, "Visible-source action", EntityTypeHuddleNode, node.HuddleNodeID, "2026-09-01")
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeHuddleLogicGate, gate.HuddleLogicGateID, user.UserID, EntityPermissionNoAccess)
	mustCreateAssignedActionItem(t, repo, companyID, user.UserID, "Later neutral action", ActionItemColorRed, "2026-09-01", ActionItemStatusInProgress)

	page, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID,
		Section: MyWorkSectionActionItems, Grouping: "huddle_process:asc", Ordering: MyWorkGroupingNone, Limit: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.ActionItems == nil || len(page.ActionItems.Items) != 1 || page.ActionItems.Items[0].EntityID != sourced.EntityID || !page.ActionItems.HasMore {
		t.Fatalf("owner-denied page = %+v", page.ActionItems)
	}
	row := page.ActionItems.Items[0]
	if row.Source == nil || row.Source.ResourceID != node.HuddleNodeID || row.HuddleProcess != nil {
		t.Fatalf("owner denial must preserve only the permitted Source: %+v", row)
	}
	payload, err := base64.RawURLEncoding.DecodeString(page.ActionItems.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	var cursor myWorkCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		t.Fatal(err)
	}
	if !cursor.HuddleProcessNull || cursor.HuddleProcessID != "" || cursor.HuddleProcessName != "" {
		t.Fatalf("owner-denied cursor leaked Huddle process: %+v", cursor)
	}
}

func TestMemoryMyWorkRACIInlineVisibilityAndCompletedExclusion(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000002"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-raci-user")
	parent, err := repo.CreateCompanyUserGroup(companyID, "", "Responsible parent")
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyUserGroup(companyID, parent.GroupID, "Responsible child")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, []string{user.UserID}); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Hidden process context")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, ActorUserID: user.UserID,
		Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: parent.GroupID}},
	}); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Visible assigned node")
	if err != nil {
		t.Fatal(err)
	}
	priority, due := 2, "2026-09-04"
	if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Priority: &priority, PrioritySet: true, DueDate: &due, DueDateSet: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: node.NodeID, Status: "in progress", Priority: &priority, PrioritySet: true}); err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkRACIInherited(t, repo, companyID, EntityTypeNode, node.NodeID)
	doneNode, err := repo.CreateNode(companyID, "Completed assigned node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: doneNode.NodeID, Status: "done"}); err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkRACIInherited(t, repo, companyID, EntityTypeNode, doneNode.NodeID)
	repo.mu.Lock()
	doneRaw := repo.nodes[key(companyID, doneNode.NodeID)]
	doneRaw.Status = stringPointer("In Progress")
	repo.nodes[key(companyID, doneNode.NodeID)] = doneRaw
	repo.mu.Unlock()
	project, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Hidden project context", Status: "active", Health: "on_track"})
	if err != nil || project.Project == nil {
		t.Fatalf("CreateProject: %+v %v", project, err)
	}
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{CompanyID: companyID, ProjectID: project.Project.ProjectID, ResourceType: EntityTypeNode, ResourceID: node.NodeID}); err != nil {
		t.Fatal(err)
	}
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeLogicGate, gate.LogicGateID, user.UserID, EntityPermissionNoAccess)
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeNode, node.NodeID, user.UserID, EntityPermissionEdit)
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeProject, project.Project.ProjectID, user.UserID, EntityPermissionNoAccess)
	effective, err := repo.ListResourceRACIEffectiveAssignments(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(effective) != 1 || effective[0].UserID != user.UserID || effective[0].Role != domain.RACIRoleResponsible {
		t.Fatalf("effective node RACI = %+v", effective)
	}
	allowed, err := repo.UserHasEffectiveAccess(companyID, user.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit)
	if err != nil || !allowed {
		t.Fatalf("node access = %t err=%v", allowed, err)
	}

	response, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes})
	if err != nil {
		t.Fatal(err)
	}
	if response.Nodes == nil || len(response.Nodes.Items) != 1 || response.Nodes.Items[0].NodeID != node.NodeID {
		t.Fatalf("nodes = %+v, want visible active node only", response.Nodes)
	}
	if response.Nodes.Items[0].Process != nil || response.Nodes.Items[0].Project != nil {
		t.Fatalf("hidden inline context leaked: %+v", response.Nodes.Items[0])
	}
}

func TestMemoryMyWorkProcessesRoleAndNestedProjectTeamRemainPermissionFiltered(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000003"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-process-user")
	parent, err := repo.CreateCompanyUserGroup(companyID, "", "Project parent")
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyUserGroup(companyID, parent.GroupID, "Project child")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, []string{user.UserID}); err != nil {
		t.Fatal(err)
	}
	grandchild, err := repo.CreateCompanyUserGroup(companyID, child.GroupID, "Project grandchild")
	if err != nil {
		t.Fatal(err)
	}
	sibling, err := repo.CreateCompanyUserGroup(companyID, parent.GroupID, "Project sibling")
	if err != nil {
		t.Fatal(err)
	}
	responsibleGate := mustCreateMyWorkGateWithRole(t, repo, companyID, user.UserID, "Responsible", domain.RACIRoleResponsible)
	accountableGate := mustCreateMyWorkGateWithRole(t, repo, companyID, user.UserID, "Accountable", domain.RACIRoleAccountable)
	for index, status := range []string{"requested", "pending", "in_progress", "review", "done"} {
		node, createErr := repo.CreateNode(companyID, "Counted process node "+status)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, assignErr := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
			CompanyID: companyID, LogicGateID: responsibleGate.LogicGateID, NodeID: node.NodeID, Status: status, Position: index,
		}); assignErr != nil {
			t.Fatal(assignErr)
		}
	}
	visibleProject, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Visible nested team", Status: "active", Health: "on_track", TeamIDs: []string{parent.GroupID}, TeamIDsSet: true})
	if err != nil || visibleProject.Project == nil {
		t.Fatal(err)
	}
	hiddenProject, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Hidden nested team", Status: "active", Health: "on_track", TeamIDs: []string{parent.GroupID}, TeamIDsSet: true})
	if err != nil || hiddenProject.Project == nil {
		t.Fatal(err)
	}
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeProject, hiddenProject.Project.ProjectID, user.UserID, EntityPermissionNoAccess)
	if _, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Ancestor does not qualify", Status: "active", Health: "on_track", TeamIDs: []string{grandchild.GroupID}, TeamIDsSet: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Unrelated team", Status: "active", Health: "on_track", TeamIDs: []string{sibling.GroupID}, TeamIDsSet: true}); err != nil {
		t.Fatal(err)
	}

	responsible, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProcesses})
	if err != nil {
		t.Fatal(err)
	}
	if responsible.Processes == nil || responsible.Processes.Role != domain.RACIRoleResponsible || len(responsible.Processes.Items) != 1 || responsible.Processes.Items[0].LogicGateID != responsibleGate.LogicGateID {
		t.Fatalf("responsible processes = %+v", responsible.Processes)
	}
	if counts := responsible.Processes.Items[0].StatusCounts; counts != (domain.MyWorkProcessStatusCounts{Request: 1, Pending: 1, InProgress: 1, Review: 1}) {
		t.Fatalf("responsible process counts = %+v", counts)
	}
	accountable, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProcesses, Role: domain.RACIRoleAccountable})
	if err != nil {
		t.Fatal(err)
	}
	if accountable.Processes == nil || len(accountable.Processes.Items) != 1 || accountable.Processes.Items[0].LogicGateID != accountableGate.LogicGateID {
		t.Fatalf("accountable processes = %+v", accountable.Processes)
	}
	if accountable.Processes.Items[0].StatusCounts != (domain.MyWorkProcessStatusCounts{}) {
		t.Fatalf("empty accountable process counts = %+v", accountable.Processes.Items[0].StatusCounts)
	}
	projects, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProjects})
	if err != nil {
		t.Fatal(err)
	}
	if projects.Projects == nil || len(projects.Projects.Items) != 1 || projects.Projects.Items[0].ProjectID != visibleProject.Project.ProjectID {
		t.Fatalf("projects = %+v, want nested visible team project only", projects.Projects)
	}
}

func TestMemoryMyWorkSelectedSubjectSectionsUseViewerPermissionsAndBoundCursor(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000018"
	subject := mustCreateMyWorkMember(t, repo, companyID, "my-work-section-subject")
	viewer := mustCreateMyWorkMember(t, repo, companyID, "my-work-section-viewer")
	privateToSubject := func(resourceType, resourceID string) {
		t.Helper()
		if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
			CompanyID: companyID, EntityType: resourceType, EntityID: resourceID,
			DefaultAccess: EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: subject.UserID,
			Permissions: []EntityPermissionInput{{SubjectType: EntityPermissionSubjectUser, SubjectID: subject.UserID, AccessLevel: EntityPermissionEdit}},
		}); err != nil {
			t.Fatal(err)
		}
	}

	visibleHuddle, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: companyID, Name: "Visible Action Process"})
	if err != nil {
		t.Fatal(err)
	}
	visibleHuddleNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: companyID, OwnerID: visibleHuddle.HuddleLogicGateID, Name: "Visible Action Source"})
	if err != nil {
		t.Fatal(err)
	}
	hiddenHuddle, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: companyID, Name: "Hidden Action Process"})
	if err != nil {
		t.Fatal(err)
	}
	hiddenHuddleNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: companyID, OwnerID: hiddenHuddle.HuddleLogicGateID, Name: "Hidden Action Source"})
	if err != nil {
		t.Fatal(err)
	}
	privateToSubject(EntityTypeHuddleLogicGate, hiddenHuddle.HuddleLogicGateID)
	privateToSubject(EntityTypeHuddleNode, hiddenHuddleNode.HuddleNodeID)
	visibleAction := mustCreateSourcedMyWorkActionItem(t, repo, companyID, subject.UserID, "Visible subject action", EntityTypeHuddleNode, visibleHuddleNode.HuddleNodeID, "2026-09-01")
	hiddenContextAction := mustCreateSourcedMyWorkActionItem(t, repo, companyID, subject.UserID, "Hidden-context subject action", EntityTypeHuddleNode, hiddenHuddleNode.HuddleNodeID, "2026-09-02")
	mustCreateAssignedActionItem(t, repo, companyID, viewer.UserID, "Viewer-only action", ActionItemColorRed, "2026-09-03", ActionItemStatusInProgress)

	actionQuery := MyWorkQuery{
		CompanyID: companyID, UserID: subject.UserID, ViewerUserID: viewer.UserID,
		Section: MyWorkSectionActionItems, Limit: 1,
	}
	firstActionPage, err := repo.GetMyWork(context.Background(), actionQuery)
	if err != nil {
		t.Fatal(err)
	}
	if firstActionPage.ActionItems == nil || len(firstActionPage.ActionItems.Items) != 1 || firstActionPage.ActionItems.Items[0].EntityID != visibleAction.EntityID || !firstActionPage.ActionItems.HasMore || firstActionPage.ActionItems.NextCursor == "" {
		t.Fatalf("selected-subject first Action Item page = %+v", firstActionPage.ActionItems)
	}
	if row := firstActionPage.ActionItems.Items[0]; row.Source == nil || row.Source.ResourceID != visibleHuddleNode.HuddleNodeID || row.HuddleProcess == nil || row.HuddleProcess.HuddleLogicGateID != visibleHuddle.HuddleLogicGateID {
		t.Fatalf("viewer-visible Action Item context = %+v", row)
	}
	payload, err := base64.RawURLEncoding.DecodeString(firstActionPage.ActionItems.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	var generatedCursor myWorkCursor
	if err := json.Unmarshal(payload, &generatedCursor); err != nil {
		t.Fatal(err)
	}
	if generatedCursor.CompanyID != companyID || generatedCursor.SubjectUserID != subject.UserID || generatedCursor.ViewerUserID != viewer.UserID {
		t.Fatalf("selected-subject cursor identity = %+v", generatedCursor)
	}
	actionQuery.Cursor = firstActionPage.ActionItems.NextCursor
	secondActionPage, err := repo.GetMyWork(context.Background(), actionQuery)
	if err != nil {
		t.Fatal(err)
	}
	if secondActionPage.ActionItems == nil || len(secondActionPage.ActionItems.Items) != 1 || secondActionPage.ActionItems.Items[0].EntityID != hiddenContextAction.EntityID || secondActionPage.ActionItems.HasMore {
		t.Fatalf("selected-subject second Action Item page = %+v", secondActionPage.ActionItems)
	}
	if row := secondActionPage.ActionItems.Items[0]; row.Source != nil || row.HuddleProcess != nil {
		t.Fatalf("viewer-hidden Action Item context leaked = %+v", row)
	}
	wrongViewer := actionQuery
	wrongViewer.ViewerUserID = subject.UserID
	if _, err := repo.GetMyWork(context.Background(), wrongViewer); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-viewer generated cursor error = %v, want ErrInvalid", err)
	}
	wrongSubject := actionQuery
	wrongSubject.UserID = viewer.UserID
	if _, err := repo.GetMyWork(context.Background(), wrongSubject); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-subject generated cursor error = %v, want ErrInvalid", err)
	}
	subjectActions, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: companyID, UserID: subject.UserID, ViewerUserID: subject.UserID, Section: MyWorkSectionActionItems,
	})
	if err != nil {
		t.Fatal(err)
	}
	foundHiddenContext := false
	for _, row := range subjectActions.ActionItems.Items {
		if row.EntityID == hiddenContextAction.EntityID {
			foundHiddenContext = row.Source != nil && row.HuddleProcess != nil
		}
	}
	if len(subjectActions.ActionItems.Items) != 2 || !foundHiddenContext {
		t.Fatalf("selected subject's own Action Items = %+v, want both subject rows and private context", subjectActions.ActionItems)
	}

	subjectTeam, err := repo.CreateCompanyUserGroup(companyID, "", "Subject team")
	if err != nil {
		t.Fatal(err)
	}
	viewerTeam, err := repo.CreateCompanyUserGroup(companyID, "", "Viewer team")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, subjectTeam.GroupID, []string{subject.UserID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, viewerTeam.GroupID, []string{viewer.UserID}); err != nil {
		t.Fatal(err)
	}
	createTeamProject := func(name, teamID string) domain.Project {
		t.Helper()
		result, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: name, Status: "active", Health: "on_track", TeamIDs: []string{teamID}, TeamIDsSet: true})
		if err != nil || result.Project == nil {
			t.Fatalf("CreateProject %q: %+v %v", name, result, err)
		}
		return *result.Project
	}
	visibleProject := createTeamProject("Visible subject project", subjectTeam.GroupID)
	hiddenProject := createTeamProject("Hidden subject project", subjectTeam.GroupID)
	viewerOnlyProject := createTeamProject("Viewer-only project", viewerTeam.GroupID)
	privateToSubject(EntityTypeProject, hiddenProject.ProjectID)

	hiddenInlineProcess, err := repo.CreateLogicGate(companyID, "Hidden inline process")
	if err != nil {
		t.Fatal(err)
	}
	privateToSubject(EntityTypeLogicGate, hiddenInlineProcess.LogicGateID)
	visibleNode, err := repo.CreateNode(companyID, "Visible subject Node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{CompanyID: companyID, LogicGateID: hiddenInlineProcess.LogicGateID, NodeID: visibleNode.NodeID, Status: LogicGateWorkStatusPending}); err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, visibleNode.NodeID, subject.UserID, domain.RACIRoleResponsible)
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeNode, visibleNode.NodeID, subject.UserID, EntityPermissionEdit)
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{CompanyID: companyID, ProjectID: hiddenProject.ProjectID, ResourceType: EntityTypeNode, ResourceID: visibleNode.NodeID}); err != nil {
		t.Fatal(err)
	}
	hiddenNode, err := repo.CreateNode(companyID, "Hidden subject Node")
	if err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, hiddenNode.NodeID, subject.UserID, domain.RACIRoleResponsible)
	privateToSubject(EntityTypeNode, hiddenNode.NodeID)
	viewerOnlyNode, err := repo.CreateNode(companyID, "Viewer-only Node")
	if err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, viewerOnlyNode.NodeID, viewer.UserID, domain.RACIRoleResponsible)

	viewerNodes, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: companyID, UserID: subject.UserID, ViewerUserID: viewer.UserID, Section: MyWorkSectionNodes,
	})
	if err != nil {
		t.Fatal(err)
	}
	if viewerNodes.Nodes == nil || len(viewerNodes.Nodes.Items) != 1 || viewerNodes.Nodes.Items[0].NodeID != visibleNode.NodeID {
		t.Fatalf("selected-subject viewer Nodes = %+v, want only visible subject-qualified Node", viewerNodes.Nodes)
	}
	if row := viewerNodes.Nodes.Items[0]; row.Process != nil || row.Project != nil {
		t.Fatalf("viewer-hidden inline Node references leaked = %+v", row)
	}
	subjectNodes, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: companyID, UserID: subject.UserID, ViewerUserID: subject.UserID, Section: MyWorkSectionNodes,
	})
	if err != nil {
		t.Fatal(err)
	}
	foundVisibleNode, foundHiddenNode := false, false
	for _, row := range subjectNodes.Nodes.Items {
		switch row.NodeID {
		case visibleNode.NodeID:
			foundVisibleNode = row.Process != nil && row.Process.LogicGateID == hiddenInlineProcess.LogicGateID && row.Project != nil && row.Project.ProjectID == hiddenProject.ProjectID
		case hiddenNode.NodeID:
			foundHiddenNode = true
		case viewerOnlyNode.NodeID:
			t.Fatalf("viewer-qualified Node leaked into subject's work: %+v", row)
		}
	}
	if len(subjectNodes.Nodes.Items) != 2 || !foundVisibleNode || !foundHiddenNode {
		t.Fatalf("selected subject's own Nodes = %+v", subjectNodes.Nodes)
	}

	viewerProjects, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: companyID, UserID: subject.UserID, ViewerUserID: viewer.UserID, Section: MyWorkSectionProjects,
	})
	if err != nil {
		t.Fatal(err)
	}
	if viewerProjects.Projects == nil || len(viewerProjects.Projects.Items) != 1 || viewerProjects.Projects.Items[0].ProjectID != visibleProject.ProjectID {
		t.Fatalf("selected-subject viewer Projects = %+v, want only visible subject-team Project", viewerProjects.Projects)
	}
	subjectProjects, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: companyID, UserID: subject.UserID, ViewerUserID: subject.UserID, Section: MyWorkSectionProjects,
	})
	if err != nil {
		t.Fatal(err)
	}
	projectIDs := map[string]bool{}
	for _, row := range subjectProjects.Projects.Items {
		projectIDs[row.ProjectID] = true
	}
	if len(subjectProjects.Projects.Items) != 2 || !projectIDs[visibleProject.ProjectID] || !projectIDs[hiddenProject.ProjectID] || projectIDs[viewerOnlyProject.ProjectID] {
		t.Fatalf("selected subject's own Projects = %+v, want only subject-team Projects", subjectProjects.Projects)
	}
}

func TestMemoryMyWorkSelectedSubjectProcessCountsExcludeViewerHiddenNodes(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000009"
	subject := mustCreateMyWorkMember(t, repo, companyID, "my-work-count-subject")
	viewer := mustCreateMyWorkMember(t, repo, companyID, "my-work-count-viewer")
	gate := mustCreateMyWorkGateWithRole(t, repo, companyID, subject.UserID, "Selected subject counts", domain.RACIRoleResponsible)
	visibleNode, err := repo.CreateNode(companyID, "Visible counted node")
	if err != nil {
		t.Fatal(err)
	}
	hiddenNode, err := repo.CreateNode(companyID, "Hidden counted node")
	if err != nil {
		t.Fatal(err)
	}
	for _, assignment := range []LogicGateNodeAssignmentInput{
		{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: visibleNode.NodeID, Status: LogicGateWorkStatusPending},
		{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: hiddenNode.NodeID, Status: LogicGateWorkStatusReview},
	} {
		if _, err := repo.AssignNodeToLogicGateStatus(assignment); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: EntityTypeNode, EntityID: hiddenNode.NodeID,
		DefaultAccess: EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: subject.UserID,
		Permissions: []EntityPermissionInput{{SubjectType: EntityPermissionSubjectUser, SubjectID: subject.UserID, AccessLevel: EntityPermissionEdit}},
	}); err != nil {
		t.Fatal(err)
	}

	viewerResult, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: companyID, UserID: subject.UserID, ViewerUserID: viewer.UserID,
		Section: MyWorkSectionProcesses, Role: domain.RACIRoleResponsible,
	})
	if err != nil {
		t.Fatal(err)
	}
	if viewerResult.Processes == nil || len(viewerResult.Processes.Items) != 1 {
		t.Fatalf("selected-subject viewer processes = %+v", viewerResult.Processes)
	}
	if counts := viewerResult.Processes.Items[0].StatusCounts; counts != (domain.MyWorkProcessStatusCounts{Pending: 1}) {
		t.Fatalf("selected-subject viewer counts = %+v, want only visible Node", counts)
	}
	subjectResult, err := repo.GetMyWork(context.Background(), MyWorkQuery{
		CompanyID: companyID, UserID: subject.UserID, ViewerUserID: subject.UserID,
		Section: MyWorkSectionProcesses, Role: domain.RACIRoleResponsible,
	})
	if err != nil {
		t.Fatal(err)
	}
	if subjectResult.Processes == nil || len(subjectResult.Processes.Items) != 1 || subjectResult.Processes.Items[0].StatusCounts != (domain.MyWorkProcessStatusCounts{Pending: 1, Review: 1}) {
		t.Fatalf("selected subject's own counts = %+v, want both Nodes", subjectResult.Processes)
	}
}

func TestMemoryMyWorkUsesWinningRACIRole(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000006"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-winning-user")
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Winning group")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{user.UserID}); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Winning Responsible node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, ActorUserID: user.UserID,
		Assignments: []ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID},
			{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID},
		},
	}); err != nil {
		t.Fatal(err)
	}
	response, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes})
	if err != nil {
		t.Fatal(err)
	}
	if response.Nodes == nil || len(response.Nodes.Items) != 1 || response.Nodes.Items[0].NodeID != node.NodeID {
		t.Fatalf("winning-role nodes = %+v", response.Nodes)
	}
}

func TestMemoryMyWorkNodesSelectIndependentEffectiveRACIRoles(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000014"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-node-role-user")
	wantByRole := map[string]string{}
	for _, role := range []string{
		domain.RACIRoleResponsible,
		domain.RACIRoleAccountable,
		domain.RACIRoleConsulted,
		domain.RACIRoleInformed,
	} {
		node, err := repo.CreateNode(companyID, role+" node")
		if err != nil {
			t.Fatal(err)
		}
		mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, node.NodeID, user.UserID, role)
		wantByRole[role] = node.NodeID
	}

	for role, wantNodeID := range wantByRole {
		response, err := repo.GetMyWork(context.Background(), MyWorkQuery{
			CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID,
			Section: MyWorkSectionNodes, Role: role,
		})
		if err != nil {
			t.Fatalf("role %s: %v", role, err)
		}
		if response.Nodes == nil || response.Nodes.Role != role || len(response.Nodes.Items) != 1 || response.Nodes.Items[0].NodeID != wantNodeID {
			t.Fatalf("role %s nodes = %+v, want %s", role, response.Nodes, wantNodeID)
		}
	}
}

func TestMemoryMyWorkFiltersPermissionBeforeNodeLimit(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000007"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-limit-user")
	hidden, err := repo.CreateNode(companyID, "Hidden first")
	if err != nil {
		t.Fatal(err)
	}
	visible, err := repo.CreateNode(companyID, "Visible second")
	if err != nil {
		t.Fatal(err)
	}
	hiddenPriority, visiblePriority := 1, 2
	if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: hidden.NodeID, Priority: &hiddenPriority, PrioritySet: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: visible.NodeID, Priority: &visiblePriority, PrioritySet: true}); err != nil {
		t.Fatal(err)
	}
	mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, hidden.NodeID, user.UserID, domain.RACIRoleResponsible)
	mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, visible.NodeID, user.UserID, domain.RACIRoleResponsible)
	setMyWorkDefaultAccess(t, repo, companyID, EntityTypeNode, hidden.NodeID, user.UserID, EntityPermissionNoAccess)
	response, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if response.Nodes == nil || len(response.Nodes.Items) != 1 || response.Nodes.Items[0].NodeID != visible.NodeID || response.Nodes.HasMore || response.Nodes.NextCursor != "" {
		t.Fatalf("permission-filtered page = %+v, want only visible candidate with no next page", response.Nodes)
	}
}

func TestMemoryMyWorkNodesPageByReorderedDescendingGrouping(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000010"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-node-grouping-user")
	createNode := func(name string, priority *int, due *string) domain.Node {
		t.Helper()
		node, err := repo.CreateNode(companyID, name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.UpdateNode(UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Priority: priority, PrioritySet: true, DueDate: due, DueDateSet: true}); err != nil {
			t.Fatal(err)
		}
		mustSetMyWorkDirectRACI(t, repo, companyID, EntityTypeNode, node.NodeID, user.UserID, domain.RACIRoleResponsible)
		return node
	}
	priorityOne, priorityFive := 1, 5
	dueEarly, dueMiddle, dueLate := "2026-09-01", "2026-09-02", "2026-09-03"
	early := createNode("Early", &priorityOne, &dueEarly)
	middle := createNode("Middle", &priorityFive, &dueMiddle)
	late := createNode("Late", &priorityOne, &dueLate)
	missingDue := createNode("Missing due", &priorityOne, nil)
	grouping := "due_date:desc,priority:asc"

	first, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Grouping: grouping, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if first.Nodes == nil || len(first.Nodes.Items) != 2 || first.Nodes.Items[0].NodeID != late.NodeID || first.Nodes.Items[1].NodeID != middle.NodeID || !first.Nodes.HasMore {
		t.Fatalf("first reordered node page = %+v", first.Nodes)
	}
	second, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Grouping: grouping, Limit: 2, Cursor: first.Nodes.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if second.Nodes == nil || len(second.Nodes.Items) != 2 || second.Nodes.Items[0].NodeID != early.NodeID || second.Nodes.Items[1].NodeID != missingDue.NodeID || second.Nodes.HasMore {
		t.Fatalf("second reordered node page = %+v", second.Nodes)
	}
}

func TestMyWorkQueryShapesAndCursorBinding(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000008"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-shape-user")
	all, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	if all.ActionItems == nil || all.Nodes == nil || all.Processes == nil || all.Projects == nil {
		t.Fatalf("initial response pointers = %+v", all)
	}
	nodes, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes})
	if err != nil {
		t.Fatal(err)
	}
	if nodes.Nodes == nil || nodes.ActionItems != nil || nodes.Processes != nil || nodes.Projects != nil {
		t.Fatalf("section response pointers = %+v", nodes)
	}
	resourceID := "40000000-0000-4000-8000-000000000001"
	cursorQuery := MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID}
	nodeCursor := encodeMyWorkCursor(cursorQuery, myWorkCursor{Section: MyWorkSectionNodes, Role: domain.RACIRoleResponsible, Grouping: MyWorkDefaultNodeGrouping, GroupInt: 1, Date: "2026-09-01", ResourceID: resourceID})
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProjects, Cursor: nodeCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-section cursor error = %v, want ErrInvalid", err)
	}
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Role: domain.RACIRoleAccountable, Cursor: nodeCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-Node-role cursor error = %v, want ErrInvalid", err)
	}
	processCursor := encodeMyWorkCursor(cursorQuery, myWorkCursor{Section: MyWorkSectionProcesses, Role: domain.RACIRoleResponsible, Name: "process", ResourceID: resourceID})
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionProcesses, Role: domain.RACIRoleAccountable, Cursor: processCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-role cursor error = %v, want ErrInvalid", err)
	}
	actionCursor := encodeMyWorkCursor(cursorQuery, myWorkCursor{
		Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveDelegated,
		Grouping: MyWorkDefaultActionItemGrouping, Ordering: MyWorkDefaultActionItemOrdering, GroupNull: true, GroupInt: 3, HuddleProcessNull: true, DateNull: true,
		ResourceID: resourceID,
	})
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveMine, Cursor: actionCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-perspective cursor error = %v, want ErrInvalid", err)
	}
	delegatedPersonCursor := myWorkCursor{
		Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveDelegated,
		Grouping: MyWorkDefaultDelegatedActionItemGrouping, Ordering: MyWorkDefaultDelegatedActionItemOrdering, GroupNull: true, GroupInt: 3, HuddleProcessNull: true, DateNull: true,
		PersonInChargeName: "person", PersonInChargeID: user.UserID, ResourceID: resourceID,
	}
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveDelegated, Cursor: encodeMyWorkCursor(cursorQuery, delegatedPersonCursor)}); err != nil {
		t.Fatalf("valid delegated Person-in-charge cursor error = %v", err)
	}
	delegatedPersonCursor.PersonInChargeName = ""
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionActionItems, Perspective: MyWorkActionItemPerspectiveDelegated, Cursor: encodeMyWorkCursor(cursorQuery, delegatedPersonCursor)}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing Person-in-charge cursor name error = %v, want ErrInvalid", err)
	}
	badDate := encodeMyWorkCursor(cursorQuery, myWorkCursor{Section: MyWorkSectionNodes, Role: domain.RACIRoleResponsible, Grouping: MyWorkDefaultNodeGrouping, GroupInt: 1, Date: "not-a-date", ResourceID: resourceID})
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Cursor: badDate}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("malformed date cursor error = %v, want ErrInvalid", err)
	}
	otherSubjectID := "20000000-0000-4000-8000-000000000081"
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: otherSubjectID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Cursor: nodeCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-subject cursor error = %v, want ErrInvalid", err)
	}
	otherViewerID := "20000000-0000-4000-8000-000000000082"
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: otherViewerID, Section: MyWorkSectionNodes, Cursor: nodeCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-viewer cursor error = %v, want ErrInvalid", err)
	}
	otherCompanyID := "10000000-0000-4000-8000-000000000081"
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: otherCompanyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Cursor: nodeCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-company cursor error = %v, want ErrInvalid", err)
	}
	legacyPayload, err := json.Marshal(myWorkCursor{
		Version: 2, Section: MyWorkSectionNodes, Role: domain.RACIRoleResponsible,
		Grouping: MyWorkDefaultNodeGrouping, GroupInt: 1, Date: "2026-09-01", ResourceID: resourceID,
	})
	if err != nil {
		t.Fatal(err)
	}
	legacyCursor := base64.RawURLEncoding.EncodeToString(legacyPayload)
	if _, err := repo.GetMyWork(context.Background(), MyWorkQuery{CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID, Section: MyWorkSectionNodes, Cursor: legacyCursor}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("legacy cursor version error = %v, want ErrInvalid", err)
	}
}

func TestMyWorkGroupingValidation(t *testing.T) {
	base := MyWorkQuery{CompanyID: "10000000-0000-4000-8000-000000000011", UserID: "20000000-0000-4000-8000-000000000011", ViewerUserID: "20000000-0000-4000-8000-000000000011", Section: MyWorkSectionActionItems}
	defaultMine, _, err := normalizeMyWorkQuery(base)
	if err != nil || defaultMine.Grouping != MyWorkDefaultActionItemGrouping || defaultMine.Ordering != MyWorkDefaultActionItemOrdering {
		t.Fatalf("default Mine query = grouping %q ordering %q err=%v", defaultMine.Grouping, defaultMine.Ordering, err)
	}
	valid := []struct {
		raw       string
		canonical string
	}{
		{"", MyWorkDefaultActionItemGrouping},
		{"none", MyWorkGroupingNone},
		{" COMPLETION_DUE_DATE:DESC , COLOR:ASC ", "completion_due_date:desc,color:asc"},
	}
	for _, test := range valid {
		query := base
		query.Grouping = test.raw
		query.Ordering = MyWorkGroupingNone
		normalized, _, err := normalizeMyWorkQuery(query)
		if err != nil || normalized.Grouping != test.canonical {
			t.Errorf("grouping %q normalized to %q err=%v, want %q", test.raw, normalized.Grouping, err, test.canonical)
		}
	}
	for _, raw := range []string{"color", "color:up", "color:asc,color:desc", "priority:asc", "none,color:asc"} {
		query := base
		query.Grouping = raw
		if _, _, err := normalizeMyWorkQuery(query); !errors.Is(err, ErrInvalid) {
			t.Errorf("grouping %q error = %v, want ErrInvalid", raw, err)
		}
	}
	for _, raw := range []string{"person_in_charge:asc", "color:asc,person_in_charge:desc"} {
		query := base
		query.Grouping = raw
		if _, _, err := normalizeMyWorkQuery(query); !errors.Is(err, ErrInvalid) {
			t.Errorf("Mine grouping %q error = %v, want ErrInvalid", raw, err)
		}
	}
	explicitOrdering := base
	explicitOrdering.Grouping = "color:asc"
	explicitOrdering.Ordering = "completion_due_date:desc"
	normalized, _, err := normalizeMyWorkQuery(explicitOrdering)
	if err != nil || normalized.Grouping != "color:asc" || normalized.Ordering != "completion_due_date:desc" {
		t.Fatalf("separate grouping and ordering = %+v err=%v", normalized, err)
	}
	overlap := explicitOrdering
	overlap.Ordering = "color:desc"
	if _, _, err := normalizeMyWorkQuery(overlap); !errors.Is(err, ErrInvalid) {
		t.Fatalf("overlapping grouping and ordering error = %v, want ErrInvalid", err)
	}
	delegated := base
	delegated.Perspective = MyWorkActionItemPerspectiveDelegated
	normalized, _, err = normalizeMyWorkQuery(delegated)
	if err != nil || normalized.Grouping != MyWorkDefaultDelegatedActionItemGrouping || normalized.Ordering != MyWorkDefaultDelegatedActionItemOrdering {
		t.Fatalf("default Delegated query = grouping %q ordering %q err=%v", normalized.Grouping, normalized.Ordering, err)
	}
	delegated.Grouping = " PERSON_IN_CHARGE:DESC "
	delegated.Ordering = MyWorkGroupingNone
	normalized, _, err = normalizeMyWorkQuery(delegated)
	if err != nil || normalized.Grouping != "person_in_charge:desc" {
		t.Fatalf("explicit Delegated grouping = %q err=%v", normalized.Grouping, err)
	}
}

func TestPostgresMyWorkQueriesKeepSubjectAndViewerResolutionSetBased(t *testing.T) {
	raw, err := os.ReadFile("postgres_my_work.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, forbidden := range []string{"mangorts_v2_effective_gvic_assignments", "mangorts_user_can_access_resource"} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("My Work PostgreSQL query must not call per-candidate helper %q", forbidden)
		}
	}
	for _, required := range []string{
		"subject_groups_raw(group_id,depth,path)",
		"viewer_groups_raw(group_id,depth,path)",
		"myWorkSubjectRACIWinnerCTEs",
		"myWorkPermissionAccessCTEs",
		"select distinct source_resource_type,source_resource_id",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("My Work PostgreSQL query missing set-based contract %q", required)
		}
	}
	actionQueryStart := strings.Index(source, "func (r *PostgresRepo) postgresMyWorkActionItems")
	actionQueryEnd := strings.Index(source, "func (r *PostgresRepo) postgresMyWorkNodes")
	if actionQueryStart < 0 || actionQueryEnd <= actionQueryStart {
		t.Fatal("could not isolate the PostgreSQL My Work Action Items query")
	}
	actionQuery := source[actionQueryStart:actionQueryEnd]
	if strings.Contains(actionQuery, "entity_relationships") {
		t.Fatal("My Work Huddle grouping must derive only from immutable Action Item Source")
	}
	for _, required := range []string{
		"source_huddle_node.huddle_logic_gate_id",
		"base.source_resource_type='huddle_node'",
		"base.source_resource_type='huddle_logic_gate'",
		"coalesce(source_access.allowed,false) and coalesce(huddle_access.allowed,false)",
	} {
		if !strings.Contains(actionQuery, required) {
			t.Fatalf("My Work Action Item query missing Source/Huddle access contract %q", required)
		}
	}
	nodeQueryStart := strings.Index(source, "func (r *PostgresRepo) postgresMyWorkNodes")
	nodeQueryEnd := strings.Index(source, "func (r *PostgresRepo) postgresMyWorkProcesses")
	if nodeQueryStart < 0 || nodeQueryEnd <= nodeQueryStart {
		t.Fatal("could not isolate the PostgreSQL My Work Nodes query")
	}
	nodeQuery := source[nodeQueryStart:nodeQueryEnd]
	if strings.Contains(nodeQuery, "domain_events") {
		t.Fatal("My Work Node History must use the persisted completion transition instead of scanning domain_events")
	}
	permissionIndex := strings.Index(nodeQuery, ", visible_nodes as (")
	pageIndex := strings.Index(nodeQuery, "), paged_nodes as (")
	if permissionIndex < 0 || pageIndex < 0 || permissionIndex >= pageIndex {
		t.Fatal("My Work Node permission filtering must remain before paged_nodes")
	}
	processQueryStart := strings.Index(source, "func (r *PostgresRepo) postgresMyWorkProcesses")
	processQueryEnd := strings.Index(source, "func (r *PostgresRepo) postgresMyWorkProjects")
	if processQueryStart < 0 || processQueryEnd <= processQueryStart {
		t.Fatal("could not isolate the PostgreSQL My Work Processes query")
	}
	processQuery := source[processQueryStart:processQueryEnd]
	for _, required := range []string{
		"process_count_node_targets(resource_type,resource_id)",
		`myWorkPermissionAccessCTEs("process_count_node_targets", "process_count_node")`,
		"node_access.resource_id=projection.node_id and node_access.allowed",
	} {
		if !strings.Contains(processQuery, required) {
			t.Fatalf("My Work Process counts missing viewer-visible Node contract %q", required)
		}
	}
}

func TestMyWorkNodeCompletionTransitionSchemaContract(t *testing.T) {
	canonical, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../db/migrations/20260829_my_work_node_completion_transition.sql")
	if err != nil {
		t.Fatal(err)
	}
	for name, source := range map[string]string{"canonical schema": string(canonical), "migration": string(migration)} {
		for _, required := range []string{"completion_transition_timestamp", "idx_nodes_completion_transition"} {
			if !strings.Contains(source, required) {
				t.Fatalf("%s missing %q", name, required)
			}
		}
	}
	for _, required := range []string{
		"lag(snapshot.status)",
		"snapshot.previous_status not in ('done', 'complete', 'completed')",
		"event.stream_id = event.company_id::text",
		"(event.payload -> 'node') ? 'status'",
		"left join latest_node_completions completion",
		"is distinct from projected.transition_timestamp",
	} {
		if !strings.Contains(string(migration), required) {
			t.Fatalf("completion-transition backfill missing %q", required)
		}
	}
}

func TestMemoryMyWorkPermissionResolutionFailureReturnsNoPartialResponse(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "10000000-0000-4000-8000-000000000004"
	user := mustCreateMyWorkMember(t, repo, companyID, "my-work-error-user")
	sentinel := errors.New("permission resolution failed")
	repo.mu.Lock()
	repo.effectiveAccessErr = sentinel
	repo.mu.Unlock()
	for _, test := range []struct {
		name    string
		section string
		history bool
	}{
		{name: "all sections"},
		{name: "active Action Items only", section: MyWorkSectionActionItems},
		{name: "Action Item History only", section: MyWorkSectionActionItems, history: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			response, err := repo.GetMyWork(context.Background(), MyWorkQuery{
				CompanyID: companyID, UserID: user.UserID, ViewerUserID: user.UserID,
				Section: test.section, History: test.history,
			})
			if !errors.Is(err, sentinel) {
				t.Fatalf("error = %v, want %v", err, sentinel)
			}
			if response.ActionItems != nil || response.Nodes != nil || response.Processes != nil || response.Projects != nil {
				t.Fatalf("partial response returned on permission failure: %+v", response)
			}
		})
	}
}

func mustCreateMyWorkMember(t *testing.T, repo *MemoryRepo, companyID, subject string) domain.User {
	t.Helper()
	repo.EnsureCompany(companyID, "My Work Company")
	user, err := repo.UpsertAuthUser(subject, subject+"@example.com", subject)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	return user
}

func setMemoryMyWorkUserProfile(t *testing.T, repo *MemoryRepo, userID, displayName, email string) {
	t.Helper()
	repo.mu.Lock()
	defer repo.mu.Unlock()
	for subject, user := range repo.users {
		if user.UserID != userID {
			continue
		}
		user.DisplayName = displayName
		user.Email = email
		repo.users[subject] = user
		return
	}
	t.Fatalf("My Work user %q not found", userID)
}

func mustCreateAssignedActionItem(t *testing.T, repo *MemoryRepo, companyID, userID, name, color, due, status string) domain.Entity {
	t.Helper()
	return mustCreateActionItemForPIC(t, repo, companyID, userID, userID, name, color, due, status)
}

func mustCreateActionItemForPIC(t *testing.T, repo *MemoryRepo, companyID, creatorUserID, personInChargeUserID, name, color, due, status string) domain.Entity {
	t.Helper()
	item, err := repo.CreateActionItem(ActionItemInput{CompanyID: companyID, Name: name, BodyText: name, CreatedByUserID: creatorUserID})
	if err != nil {
		t.Fatal(err)
	}
	setMyWorkActionField(t, repo, item, ActionItemPersonInChargeSystemKey, personInChargeUserID)
	setMyWorkActionField(t, repo, item, ActionItemStatusSystemKey, status)
	if color != "" {
		setMyWorkActionField(t, repo, item, ActionItemColorSystemKey, color)
	}
	if due != "" {
		setMyWorkActionField(t, repo, item, ActionItemCompletionDueDateSystemKey, due)
	}
	return item
}

func mustCreateSourcedMyWorkActionItem(t *testing.T, repo *MemoryRepo, companyID, userID, name, sourceType, sourceID, completionDueDate string) domain.Entity {
	t.Helper()
	color := ActionItemColorRed
	item, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: companyID, Name: name, BodyText: name, Color: &color, CreatedByUserID: userID,
		SourceResourceType: sourceType, SourceResourceID: sourceID,
	})
	if err != nil {
		t.Fatal(err)
	}
	setMyWorkActionField(t, repo, item, ActionItemPersonInChargeSystemKey, userID)
	setMyWorkActionField(t, repo, item, ActionItemAssignedBySystemKey, userID)
	setMyWorkActionField(t, repo, item, ActionItemAnalysisDueDateSystemKey, "2026-08-31")
	setMyWorkActionField(t, repo, item, ActionItemCompletionDueDateSystemKey, completionDueDate)
	setMyWorkActionField(t, repo, item, ActionItemStatusSystemKey, ActionItemStatusInProgress)
	return item
}

func mustSetMyWorkDirectRACI(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID, userID, role string) {
	t.Helper()
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, ActorUserID: userID,
		Assignments: []ResourceRACIAssignmentInput{{Role: role, PrincipalType: EntityPermissionSubjectUser, PrincipalID: userID}},
	}); err != nil {
		t.Fatal(err)
	}
}

func setMyWorkActionField(t *testing.T, repo *MemoryRepo, item domain.Entity, systemKey string, value string) {
	t.Helper()
	current, err := repo.GetEntity(item.CompanyID, item.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range current.EntityFields {
		if field.SystemKey != systemKey {
			continue
		}
		raw, _ := json.Marshal(value)
		if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: item.CompanyID, EntityID: item.EntityID, EntityFieldID: field.EntityFieldID, Value: raw, ValueSet: true}); err != nil {
			t.Fatal(err)
		}
		return
	}
	t.Fatalf("action item field %q not found", systemKey)
}

func setMyWorkActionFieldRaw(t *testing.T, repo *MemoryRepo, item domain.Entity, fieldTypeID, value string) {
	t.Helper()
	raw, _ := json.Marshal(value)
	repo.mu.Lock()
	defer repo.mu.Unlock()
	for fieldKey, field := range repo.entityFields {
		if field.CompanyID == item.CompanyID && field.EntityID == item.EntityID && field.EntityFieldTypeID != nil && *field.EntityFieldTypeID == fieldTypeID {
			field.Value = raw
			repo.entityFields[fieldKey] = field
			return
		}
	}
	t.Fatalf("action item field type %q not found", fieldTypeID)
}

func setMemoryMyWorkActionCompletedAt(t *testing.T, repo *MemoryRepo, item domain.Entity, completedAt time.Time) {
	t.Helper()
	repo.mu.Lock()
	defer repo.mu.Unlock()
	for fieldKey, field := range repo.entityFields {
		if field.CompanyID == item.CompanyID && field.EntityID == item.EntityID && field.EntityFieldTypeID != nil && *field.EntityFieldTypeID == ActionItemStatusFieldTypeID {
			field.UpdatedTimestamp = completedAt
			repo.entityFields[fieldKey] = field
			return
		}
	}
	t.Fatalf("Action Item status field not found")
}

func setMemoryMyWorkNodeDoneSnapshotTimes(t *testing.T, repo *MemoryRepo, nodeID string, timestamps []time.Time) {
	t.Helper()
	repo.mu.Lock()
	defer repo.mu.Unlock()
	type snapshot struct {
		key   string
		event domain.DomainEvent
	}
	snapshots := make([]snapshot, 0, len(timestamps))
	for eventKey, event := range repo.domainEvents {
		node, ok := event.Payload["node"].(domain.Node)
		if !ok || node.NodeID != nodeID || !myWorkStatusDone(myWorkOptionalString(node.Status)) {
			continue
		}
		snapshots = append(snapshots, snapshot{key: eventKey, event: event})
	}
	sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].event.Sequence < snapshots[j].event.Sequence })
	if len(snapshots) != len(timestamps) {
		t.Fatalf("completed Node snapshots = %d, want %d", len(snapshots), len(timestamps))
	}
	for index, snapshot := range snapshots {
		snapshot.event.CreatedTimestamp = timestamps[index]
		repo.domainEvents[snapshot.key] = snapshot.event
	}
	allSnapshots := make([]domain.DomainEvent, 0)
	for _, event := range repo.domainEvents {
		node, ok := event.Payload["node"].(domain.Node)
		if ok && node.NodeID == nodeID {
			allSnapshots = append(allSnapshots, event)
		}
	}
	sort.Slice(allSnapshots, func(i, j int) bool { return allSnapshots[i].Sequence < allSnapshots[j].Sequence })
	delete(repo.nodeCompletionTransitions, key(allSnapshots[0].CompanyID, nodeID))
	repo.applyNodeCompletionTransitionUpdatesLocked(allSnapshots)
}

func mustCreateMyWorkGateWithRole(t *testing.T, repo *MemoryRepo, companyID, userID, name, role string) domain.LogicGate {
	t.Helper()
	gate, err := repo.CreateLogicGate(companyID, name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID, ActorUserID: userID,
		Assignments: []ResourceRACIAssignmentInput{{Role: role, PrincipalType: EntityPermissionSubjectUser, PrincipalID: userID}},
	}); err != nil {
		t.Fatal(err)
	}
	return gate
}

func setMyWorkDefaultAccess(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID, actorUserID, access string) {
	t.Helper()
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: resourceType, EntityID: resourceID,
		DefaultAccess: access, DefaultAccessSet: true, ActorUserID: actorUserID,
	}); err != nil {
		t.Fatal(err)
	}
}

func mustSetMyWorkRACIInherited(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID string) {
	t.Helper()
	current, err := repo.GetResourceRACIPolicy(companyID, resourceType, resourceID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID,
		AssignmentMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly,
		ExpectedRevision: current.Revision,
	}); err != nil {
		t.Fatal(err)
	}
}
