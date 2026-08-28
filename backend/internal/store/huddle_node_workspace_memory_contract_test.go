package store

import (
	"encoding/json"
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func createMemoryHuddleNodeWorkspaceFixture(t *testing.T) (*MemoryRepo, domain.User, domain.Company, domain.HuddleNode) {
	t.Helper()
	repo := NewMemoryRepo()
	const subject = "huddle-node-workspace-memory-owner"
	user, err := repo.UpsertAuthUser(subject, "workspace-memory@example.test", "Workspace Owner")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Memory Huddle Node Workspace")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Daily Huddle")
	if err != nil {
		t.Fatal(err)
	}
	huddle, err := repo.ConvertLogicGateToHuddle(company.CompanyID, gate.LogicGateID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateHuddleNode(HuddleCreateInput{
		CompanyID: company.CompanyID,
		OwnerID:   huddle.HuddleLogicGateID,
		Name:      "Monday",
		ActorID:   user.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return repo, user, company, node
}

func TestMemoryHuddleNodeWorkspaceCreateReadChatRevisionAndDelete(t *testing.T) {
	repo, user, company, node := createMemoryHuddleNodeWorkspaceFixture(t)

	initial, err := repo.GetHuddleNodeWorkspace(company.CompanyID, node.HuddleNodeID)
	if err != nil {
		t.Fatal(err)
	}
	if initial.Textboxes == nil || initial.Chats == nil || len(initial.Textboxes) != 1 || len(initial.Chats) != 0 {
		t.Fatalf("initial workspace=%+v, want one canonical empty textbox", initial)
	}
	defaultTextbox := initial.Textboxes[0]
	if defaultTextbox.TextboxID == "" || defaultTextbox.Title != "New text box" || defaultTextbox.DisplayOrder != 0 || defaultTextbox.Revision != 0 {
		t.Fatalf("default textbox=%+v", defaultTextbox)
	}

	const firstTextboxID = "10000000-0000-4000-8000-000000000001"
	firstTextbox, err := repo.CreateHuddleNodeTextbox(HuddleNodeTextboxCreateInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: firstTextboxID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if firstTextbox.Title != "New text box" || firstTextbox.DisplayOrder != 1 || firstTextbox.Revision != 0 {
		t.Fatalf("first textbox=%+v", firstTextbox)
	}
	const secondTextboxID = "10000000-0000-4000-8000-000000000002"
	secondTextbox, err := repo.CreateHuddleNodeTextbox(HuddleNodeTextboxCreateInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: secondTextboxID, Title: "  Risks  ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if secondTextbox.Title != "Risks" || secondTextbox.DisplayOrder != 2 {
		t.Fatalf("second textbox=%+v", secondTextbox)
	}
	if _, err := repo.CreateHuddleNodeTextbox(HuddleNodeTextboxCreateInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: firstTextboxID,
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate textbox error=%v, want ErrConflict", err)
	}

	selectionStart, selectionEnd := 3, 12
	const rootChatID = "20000000-0000-4000-8000-000000000001"
	rootChat, err := repo.UpsertHuddleNodeTextboxChat(HuddleNodeTextboxChatInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: firstTextboxID,
		ChatID: rootChatID, SelectionQuote: "  delayed shipment  ", SelectionStart: &selectionStart, SelectionEnd: &selectionEnd,
		AuthorUserID: user.UserID, AuthorDisplayName: "  Workspace Owner  ", ActorUserID: user.UserID, Message: "  Escalate this risk  ",
		EntityLinks:      json.RawMessage(`[{"entity_type":"entity","entity_id":"action-item-1"}]`),
		MentionedUserIDs: []string{user.UserID, user.UserID, "not-a-uuid"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if rootChat.Revision != 1 || rootChat.Message != "Escalate this risk" || rootChat.SelectionQuote != "delayed shipment" || rootChat.EditedTimestamp != nil {
		t.Fatalf("created root chat=%+v", rootChat)
	}
	if len(rootChat.MentionedUserIDs) != 1 || rootChat.MentionedUserIDs[0] != user.UserID {
		t.Fatalf("normalized mentioned users=%v", rootChat.MentionedUserIDs)
	}

	const childChatID = "20000000-0000-4000-8000-000000000002"
	childChat, err := repo.UpsertHuddleNodeTextboxChat(HuddleNodeTextboxChatInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: firstTextboxID,
		ChatID: childChatID, ParentChatID: rootChatID, AuthorUserID: user.UserID,
		AuthorDisplayName: user.DisplayName, ActorUserID: user.UserID, Message: "I will own it",
	})
	if err != nil {
		t.Fatal(err)
	}
	if childChat.Revision != 1 || childChat.ParentChatID != rootChatID {
		t.Fatalf("created child chat=%+v", childChat)
	}

	oneRevision := int64(1)
	if _, err := repo.UpsertHuddleNodeTextboxChat(HuddleNodeTextboxChatInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: firstTextboxID,
		ChatID: rootChatID, AuthorUserID: user.UserID, ActorUserID: user.UserID, Message: "Must not overwrite",
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("create over existing chat error=%v, want ErrConflict", err)
	}
	if _, err := repo.UpsertHuddleNodeTextboxChat(HuddleNodeTextboxChatInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: firstTextboxID,
		ChatID: "20000000-0000-4000-8000-000000000099", ActorUserID: user.UserID,
		Message: "Must already exist", ExpectedRevision: &oneRevision,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("update missing chat error=%v, want ErrNotFound", err)
	}
	const otherUserID = "20000000-0000-4000-8000-000000000098"
	if _, err := repo.UpsertHuddleNodeTextboxChat(HuddleNodeTextboxChatInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: firstTextboxID,
		ChatID: rootChatID, ActorUserID: otherUserID, Message: "Must not change another author's chat", ExpectedRevision: &oneRevision,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-author update error=%v, want ErrNotFound", err)
	}
	if err := repo.DeleteHuddleNodeTextboxChat(HuddleNodeTextboxChatDeleteInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, ChatID: rootChatID,
		ActorUserID: otherUserID, ExpectedRevision: &oneRevision,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-author delete error=%v, want ErrNotFound", err)
	}
	if err := repo.DeleteHuddleNodeTextboxChat(HuddleNodeTextboxChatDeleteInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, ChatID: rootChatID, ActorUserID: user.UserID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("delete without revision error=%v, want ErrInvalid", err)
	}
	updatedRoot, err := repo.UpsertHuddleNodeTextboxChat(HuddleNodeTextboxChatInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: firstTextboxID,
		ChatID: rootChatID, AuthorUserID: otherUserID, AuthorDisplayName: "Spoofed author",
		ActorUserID: user.UserID, Message: "Escalated to operations", ExpectedRevision: &oneRevision,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updatedRoot.Revision != 2 || updatedRoot.EditedTimestamp == nil || !updatedRoot.CreatedTimestamp.Equal(rootChat.CreatedTimestamp) || updatedRoot.AuthorUserID != rootChat.AuthorUserID || updatedRoot.AuthorDisplayName != rootChat.AuthorDisplayName {
		t.Fatalf("updated root chat=%+v", updatedRoot)
	}
	if _, err := repo.UpsertHuddleNodeTextboxChat(HuddleNodeTextboxChatInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: firstTextboxID,
		ChatID: rootChatID, ActorUserID: user.UserID, Message: "stale update", ExpectedRevision: &oneRevision,
	}); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale update error=%v, want ErrVersionConflict", err)
	}

	workspace, err := repo.GetHuddleNodeWorkspace(company.CompanyID, node.HuddleNodeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace.Textboxes) != 3 || workspace.Textboxes[0].TextboxID != defaultTextbox.TextboxID || workspace.Textboxes[1].TextboxID != firstTextboxID || workspace.Textboxes[2].TextboxID != secondTextboxID {
		t.Fatalf("ordered workspace textboxes=%+v", workspace.Textboxes)
	}
	if len(workspace.Chats) != 2 {
		t.Fatalf("workspace chats=%+v, want root and child", workspace.Chats)
	}

	if err := repo.DeleteHuddleNodeTextboxChat(HuddleNodeTextboxChatDeleteInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, ChatID: rootChatID, ActorUserID: user.UserID, ExpectedRevision: &oneRevision,
	}); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale delete error=%v, want ErrVersionConflict", err)
	}
	twoRevision := int64(2)
	if err := repo.DeleteHuddleNodeTextboxChat(HuddleNodeTextboxChatDeleteInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, ChatID: rootChatID, ActorUserID: user.UserID, ExpectedRevision: &twoRevision,
	}); err != nil {
		t.Fatal(err)
	}
	workspace, err = repo.GetHuddleNodeWorkspace(company.CompanyID, node.HuddleNodeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace.Chats) != 0 {
		t.Fatalf("deleting parent left descendant chats=%+v", workspace.Chats)
	}
	if err := repo.DeleteHuddleNodeTextboxChat(HuddleNodeTextboxChatDeleteInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, ChatID: rootChatID, ActorUserID: user.UserID, ExpectedRevision: &twoRevision,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("repeat delete error=%v, want ErrNotFound", err)
	}
}
