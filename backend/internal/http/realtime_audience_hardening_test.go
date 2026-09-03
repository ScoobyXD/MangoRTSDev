package httpapi

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type realtimeAudienceResolutionCall struct {
	candidateUserIDs  []string
	deadlineRemaining time.Duration
	hasDeadline       bool
}

type controlledRealtimeAudienceRepo struct {
	store.Repository
	mu         sync.Mutex
	calls      []realtimeAudienceResolutionCall
	exists     bool
	allowed    []string
	resolveErr error
}

func (r *controlledRealtimeAudienceRepo) ResolveEffectiveUsersForResource(
	ctx context.Context,
	companyID, resourceType, resourceID, accessLevel string,
	candidateUserIDs []string,
) (bool, []string, error) {
	deadline, hasDeadline := ctx.Deadline()
	call := realtimeAudienceResolutionCall{
		candidateUserIDs: slices.Clone(candidateUserIDs),
		hasDeadline:      hasDeadline,
	}
	if hasDeadline {
		call.deadlineRemaining = time.Until(deadline)
	}
	r.mu.Lock()
	r.calls = append(r.calls, call)
	r.mu.Unlock()
	if r.resolveErr != nil {
		return false, nil, r.resolveErr
	}
	return r.exists, slices.Clone(r.allowed), nil
}

func (r *controlledRealtimeAudienceRepo) snapshotCalls() []realtimeAudienceResolutionCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.calls)
}

func subscribeRecordingRealtimeConnection(t *testing.T, server *Server, id, companyID, userID, scope string) *recordingRealtimeNetConn {
	t.Helper()
	network := &recordingRealtimeNetConn{}
	conn := &realtimeConnection{id: id, companyID: companyID, userID: userID, conn: network}
	server.realtimeRegistry.subscribe(conn, scope)
	t.Cleanup(conn.close)
	return network
}

func TestRealtimeAudienceResolutionUsesOnlyExactLocalSubscribersWithDeadline(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &controlledRealtimeAudienceRepo{
		Repository: base,
		exists:     true,
		allowed:    []string{"11111111-1111-4111-8111-111111111111"},
	}
	server := NewServerWithOptions(repo, explicitLocalRealtimeTestOptions(ServerOptions{DisableNotificationCleanup: true}))
	defer server.Close()

	companyID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	nodeID := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	scope := realtimeChatScope(nodeID)
	allowedUserID := "11111111-1111-4111-8111-111111111111"
	deniedUserID := "22222222-2222-4222-8222-222222222222"
	unrelatedUserID := "33333333-3333-4333-8333-333333333333"
	allowedNetworkA := subscribeRecordingRealtimeConnection(t, server, "allowed-a", companyID, allowedUserID, scope)
	allowedNetworkB := subscribeRecordingRealtimeConnection(t, server, "allowed-b", companyID, allowedUserID, scope)
	deniedNetwork := subscribeRecordingRealtimeConnection(t, server, "denied", companyID, deniedUserID, scope)
	unrelatedNetwork := subscribeRecordingRealtimeConnection(t, server, "unrelated", companyID, unrelatedUserID, realtimeChatScope("cccccccc-cccc-4ccc-8ccc-cccccccccccc"))

	enqueueRealtimeEntityTestMessage(t, server, companyID, scope, store.EntityTypeNode, nodeID, store.EntityPermissionEdit,
		map[string]any{"type": "chat.created"},
	)
	waitForBackplaneCondition(t, func() bool {
		return len(repo.snapshotCalls()) == 1 && len(allowedNetworkA.messages(t)) == 1 && len(allowedNetworkB.messages(t)) == 1
	}, "deadline-bound audience resolution and asynchronous exact-scope fanout")
	calls := repo.snapshotCalls()
	if len(calls) != 1 {
		t.Fatalf("audience resolution calls = %d, want one", len(calls))
	}
	if got, want := calls[0].candidateUserIDs, []string{allowedUserID, deniedUserID}; !slices.Equal(got, want) {
		t.Fatalf("candidate users = %v, want exact-scope distinct local users %v", got, want)
	}
	if !calls[0].hasDeadline || calls[0].deadlineRemaining <= 0 || calls[0].deadlineRemaining > realtimePublicationAuthorizationTimeout+250*time.Millisecond {
		t.Fatalf("audience deadline remaining = %s present=%t, want bounded by %s", calls[0].deadlineRemaining, calls[0].hasDeadline, realtimePublicationAuthorizationTimeout)
	}
	if len(allowedNetworkA.messages(t)) != 1 || len(allowedNetworkB.messages(t)) != 1 {
		t.Fatal("allowed user's exact-scope connections did not both receive the hint")
	}
	if messages := deniedNetwork.messages(t); len(messages) != 0 {
		t.Fatalf("denied local subscriber received messages: %+v", messages)
	}
	if messages := unrelatedNetwork.messages(t); len(messages) != 0 {
		t.Fatalf("unrelated-scope subscriber received messages: %+v", messages)
	}
}

func TestSharedMailboxPublicationAcknowledgesDurableEnqueueBeforeAudienceRetry(t *testing.T) {
	transient := errors.New("temporary audience lookup failure")
	repo := &controlledRealtimeAudienceRepo{
		Repository: store.NewMemoryRepo(),
		resolveErr: transient,
	}
	server := NewServerWithOptions(repo, explicitLocalRealtimeTestOptions(ServerOptions{DisableNotificationCleanup: true}))
	defer server.Close()

	companyID := "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
	sharedInboxID := "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
	scope := realtimeSharedMailboxScope(sharedInboxID)
	subscribeRecordingRealtimeConnection(t, server, "shared-audience-error", companyID, "44444444-4444-4444-8444-444444444444", scope)

	err := server.publishSharedMailboxWebhookHintContext(context.Background(), companyID, sharedInboxID, "", nylasWebhookChange{
		Trigger:   "message.created",
		MessageID: "message-1",
	})
	if err != nil {
		t.Fatalf("shared publication acknowledgement waited for audience lookup: %v", err)
	}
	waitForBackplaneCondition(t, func() bool { return len(repo.snapshotCalls()) == 1 }, "asynchronous audience lookup failure")
	if calls := repo.snapshotCalls(); len(calls) != 1 || !calls[0].hasDeadline {
		t.Fatalf("audience calls after failure = %+v, want one deadline-bound lookup", calls)
	}

	server.realtimeRegistry.removeConnection("shared-audience-error")
	if err := server.publishSharedMailboxWebhookHintContext(context.Background(), companyID, sharedInboxID, "", nylasWebhookChange{
		Trigger:   "message.created",
		MessageID: "message-2",
	}); err != nil {
		t.Fatalf("no-subscriber shared publication = %v, want successful no-op", err)
	}
	if calls := repo.snapshotCalls(); len(calls) != 1 {
		t.Fatalf("no-subscriber publication performed another lookup: %+v", calls)
	}
}

func TestCapturedKanbanDeletePublishesAfterResourceIsGone(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "ffffffff-ffff-4fff-8fff-ffffffffffff"
	repo.EnsureCompany(companyID, "Delete tombstone company")
	allowed := mustRealtimeAuthUser(t, repo, companyID, "delete-board-allowed", domain.RoleCompanyUser)
	denied := mustRealtimeAuthUser(t, repo, companyID, "delete-board-denied", domain.RoleCompanyUser)
	gate, err := repo.CreateLogicGate(companyID, "Delete me")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeLogicGate,
		EntityID:         gate.LogicGateID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   allowed.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	server := NewServerWithOptions(repo, explicitLocalRealtimeTestOptions(ServerOptions{DisableNotificationCleanup: true}))
	defer server.Close()

	boardID := store.LogicGateKanbanBoardID(gate.LogicGateID)
	scope := realtimeBoardScope(boardID)
	allowedNetwork := subscribeRecordingRealtimeConnection(t, server, "delete-board-allowed", companyID, allowed.UserID, scope)
	deniedNetwork := subscribeRecordingRealtimeConnection(t, server, "delete-board-denied", companyID, denied.UserID, scope)

	result, err := repo.DeleteCompanyExplorerTargets(companyID, []store.CompanyExplorerDeleteTargetInput{{
		Kind: "logic_gate",
		ID:   gate.LogicGateID,
	}}, allowed.UserID)
	if err != nil {
		t.Fatalf("DeleteCompanyExplorerTargets: %v", err)
	}
	server.publishCommittedWorkspaceEvents(result.Events)

	messages := waitForRecordingRealtimeMessages(t, allowedNetwork, 1)
	if len(messages) != 1 || messages[0]["type"] != realtimeMessageKanbanChanged || messages[0]["change_type"] != "resource_deleted" {
		t.Fatalf("authorized deletion messages = %+v, want one resource_deleted tombstone", messages)
	}
	if messages := deniedNetwork.messages(t); len(messages) != 0 {
		t.Fatalf("unauthorized subscriber received deletion tombstone: %+v", messages)
	}
	publishKanbanChangedForTest(t, server, companyID, boardID, "ordinary_post_delete_change")
	if messages := allowedNetwork.messages(t); len(messages) != 1 {
		t.Fatalf("ordinary post-delete publication bypassed existence reauthorization: %+v", messages)
	}

}
func TestNodeDeleteBoardRefreshReauthorizesTheSurvivingLogicGate(t *testing.T) {
	base := store.NewMemoryRepo()
	companyID := "abababab-abab-4bab-8bab-abababababab"
	base.EnsureCompany(companyID, "Node delete audience company")
	beforeCapture := mustRealtimeAuthUser(t, base, companyID, "node-delete-before", domain.RoleCompanyUser)
	afterCapture := mustRealtimeAuthUser(t, base, companyID, "node-delete-after", domain.RoleCompanyUser)
	gate, err := base.CreateLogicGate(companyID, "Surviving gate")
	if err != nil {
		t.Fatal(err)
	}
	node, err := base.CreateNode(companyID, "Deleted node")
	if err != nil {
		t.Fatal(err)
	}
	priority := 1
	if _, err := base.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatal(err)
	}
	repo := &controlledRealtimeAudienceRepo{
		Repository: base,
		exists:     true,
		allowed:    []string{beforeCapture.UserID},
	}
	server := NewServerWithOptions(repo, explicitLocalRealtimeTestOptions(ServerOptions{DisableNotificationCleanup: true}))
	defer server.Close()
	waitForBackplaneCondition(t, func() bool {
		server.realtimeSpinePublishMu.Lock()
		defer server.realtimeSpinePublishMu.Unlock()
		publishedSequence, err := repo.CurrentPublishedRealtimeOutboxSequence(context.Background())
		if err != nil {
			t.Fatalf("CurrentPublishedRealtimeOutboxSequence: %v", err)
		}
		server.realtimeSpineMu.Lock()
		cursor := server.realtimeSpineCursor
		server.realtimeSpineMu.Unlock()
		return publishedSequence > 0 && cursor >= publishedSequence
	}, "initial assignment batch accepted before subscription")

	boardID := store.LogicGateKanbanBoardID(gate.LogicGateID)
	scope := realtimeBoardScope(boardID)
	beforeNetwork := subscribeRecordingRealtimeConnection(t, server, "node-delete-before", companyID, beforeCapture.UserID, scope)
	afterNetwork := subscribeRecordingRealtimeConnection(t, server, "node-delete-after", companyID, afterCapture.UserID, scope)

	if calls := repo.snapshotCalls(); len(calls) != 0 {
		t.Fatalf("node delete resolved an audience before publication: %+v", calls)
	}

	repo.mu.Lock()
	repo.allowed = []string{afterCapture.UserID}
	repo.mu.Unlock()
	result, err := repo.DeleteCompanyExplorerTargets(companyID, []store.CompanyExplorerDeleteTargetInput{{Kind: "node", ID: node.NodeID}}, beforeCapture.UserID)
	if err != nil {
		t.Fatalf("DeleteCompanyExplorerTargets: %v", err)
	}
	server.publishCommittedWorkspaceEvents(result.Events)

	if messages := beforeNetwork.messages(t); len(messages) != 0 {
		t.Fatalf("viewer removed after capture received surviving-board refresh: %+v", messages)
	}
	messages := waitForRecordingRealtimeMessages(t, afterNetwork, 1)
	if len(messages) != 1 || messages[0]["change_type"] != "resource_deleted" {
		t.Fatalf("current viewer messages = %+v, want one reauthorized board refresh", messages)
	}
	if calls := repo.snapshotCalls(); len(calls) != 1 {
		t.Fatalf("node delete publication audience calls = %+v, want one post-delete lookup", calls)
	}
}

func waitForRecordingRealtimeMessages(t *testing.T, connection *recordingRealtimeNetConn, count int) []map[string]any {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		messages := connection.messages(t)
		if len(messages) >= count {
			return messages
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d realtime messages", count)
	return nil
}
