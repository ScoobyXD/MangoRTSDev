package store

import (
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryEmailConversionAtomicallyPersistsEmailThreadTextBoxAndInitialChat(t *testing.T) {
	repo, companyID, user, node, message := setupAtomicEmailConversion(t, "11111111-1111-4111-8111-111111111192")
	textBlockID := "44444444-4444-4444-8444-444444444492"
	chatID := "55555555-5555-4555-8555-555555555592"

	result, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID, PermissionUserID: user.UserID,
		Target:     CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs: []string{message.ID},
		LinkedTextBlock: &NodeInformationInput{
			InformationID: textBlockID, Type: "Text box",
			Information: `{"title":"Imported email","document":"","attachments":[],"email_message_id":"mail-atomic","email_accent":"#4f46e5"}`,
			ActorUserID: user.UserID,
		},
		InitialChat: &NodeInformationInput{
			InformationID: chatID, Type: CommunicationsEmailCollaborationChatInformationType,
			Information: `{"block_id":"44444444-4444-4444-8444-444444444492","message":"Imported email for review"}`,
			ActorUserID: user.UserID,
		},
	})
	if err != nil {
		t.Fatalf("ConvertCommunicationsTriageItems atomic import: %v", err)
	}
	if result.LinkedTextBlockID != textBlockID || result.InitialChatID != chatID ||
		len(result.AttachedEmailInformationIDs) != 1 || len(result.EmailThreadIDs) != 1 {
		t.Fatalf("atomic identifiers = %+v", result)
	}
	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections: %v", err)
	}
	types := map[string]bool{}
	for _, projection := range projections {
		types[projection.Type] = true
	}
	for _, required := range []string{"Attached email", "Text box", CommunicationsEmailCollaborationChatInformationType} {
		if !types[required] {
			t.Fatalf("node projections missing %q: %+v", required, projections)
		}
	}
	stored, err := repo.GetCommunicationsNodeEmailThread(companyID, node.NodeID, result.EmailThreadIDs[0])
	if err != nil {
		t.Fatalf("GetCommunicationsNodeEmailThread: %v", err)
	}
	if stored.SelectedMessageID != stored.Thread.Messages[0].EmailMessageID || len(stored.Thread.Messages) != 1 ||
		stored.Thread.Messages[0].Message.Body != message.Body {
		t.Fatalf("stored imported thread = %+v", stored)
	}
	if len(communicationsTriageItemsForTest(repo, user.UserID)) != 0 {
		t.Fatal("successful atomic import left the source triage item behind")
	}
}

func TestMemoryEmailConversionRollsBackEveryAtomicImportWrite(t *testing.T) {
	repo, companyID, user, node, message := setupAtomicEmailConversion(t, "11111111-1111-4111-8111-111111111193")
	forced := errors.New("forced initial chat outbox failure")
	repo.realtimeOutboxErr = forced

	_, err := repo.ConvertCommunicationsTriageItems(CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID,
		Target:      CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs:  []string{message.ID},
		LinkedTextBlock: &NodeInformationInput{
			InformationID: "66666666-6666-4666-8666-666666666693", Type: "Text box",
			Information: `{"title":"Imported email","document":"","attachments":[],"email_message_id":"mail-atomic"}`,
			ActorUserID: user.UserID,
		},
		InitialChat: &NodeInformationInput{
			InformationID: "77777777-7777-4777-8777-777777777793", Type: CommunicationsEmailCollaborationChatInformationType,
			Information: `{"block_id":"66666666-6666-4666-8666-666666666693","message":"Imported email for review"}`,
			ActorUserID: user.UserID,
		},
	})
	if !errors.Is(err, forced) {
		t.Fatalf("atomic import error = %v, want forced outbox failure", err)
	}
	projections, listErr := repo.ListNodeProjections(companyID, node.NodeID)
	if listErr != nil || len(projections) != 0 {
		t.Fatalf("partial node projections after rollback = %+v err=%v", projections, listErr)
	}
	if items := communicationsTriageItemsForTest(repo, user.UserID); len(items) != 1 || items[0].MessageID != message.ID {
		t.Fatalf("source triage item after rollback = %+v", items)
	}
	if len(repo.emailThreads) != 0 || len(repo.emailThreadScopeIDs) != 0 || len(repo.nodeEmailThreads) != 0 || len(repo.realtimeOutbox) != 0 {
		t.Fatalf("partial durable state after rollback: threads=%d scopes=%d links=%d outbox=%d",
			len(repo.emailThreads), len(repo.emailThreadScopeIDs), len(repo.nodeEmailThreads), len(repo.realtimeOutbox))
	}
}

func setupAtomicEmailConversion(t *testing.T, companyID string) (*MemoryRepo, string, domain.User, domain.Node, domain.EmailMessageSnapshot) {
	t.Helper()
	repo := NewMemoryRepo()
	repo.EnsureCompany(companyID, "Atomic Email Import Company")
	user, _ := setupEmailConversionUserAndGate(t, repo, companyID)
	node, err := repo.CreateNode(companyID, "Existing import target")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	message := domain.EmailMessageSnapshot{
		ID: "mail-atomic", ThreadID: "thread-atomic", Subject: "Atomic import",
		Body: "<p><strong>Stored rich body</strong></p>", Snippet: "Stored rich body", Date: 42,
	}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
	}
	return repo, companyID, user, node, message
}
