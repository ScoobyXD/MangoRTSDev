package store

import (
	"fmt"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestNodeV2Phase2EmailAggregateAtTargetScaleAndLazyBodies(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "73737373-7373-4737-8737-737373737373"
	repo.EnsureCompany(companyID, "Node v2 email scale")
	actor, err := repo.UpsertAuthUser("node-v2-email-scale", "email-scale@example.com", "Email Scale Actor")
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Email scale node")
	if err != nil {
		t.Fatal(err)
	}
	firstTextbox, err := repo.CreateNodeV2TextBox(NodeV2CreateTextBoxInput{CompanyID: companyID, NodeID: node.NodeID, ActorUserID: actor.UserID, IdempotencyKey: "email-textbox-1"})
	if err != nil {
		t.Fatal(err)
	}
	secondTextbox, err := repo.CreateNodeV2TextBox(NodeV2CreateTextBoxInput{CompanyID: companyID, NodeID: node.NodeID, ActorUserID: actor.UserID, IdempotencyKey: "email-textbox-2"})
	if err != nil {
		t.Fatal(err)
	}

	var target domain.CommunicationsEmailThread
	for index := 0; index < 200; index++ {
		providerThreadID := fmt.Sprintf("scale-thread-%03d", index)
		messages := []domain.EmailMessageSnapshot{
			{ID: providerThreadID + "-message-1", ThreadID: providerThreadID, Subject: "Scale email", Date: int64(index*2 + 1), Body: "<p>Durable HTML one</p>", Snippet: "One"},
			{ID: providerThreadID + "-message-2", ThreadID: providerThreadID, Subject: "Re: Scale email", Date: int64(index*2 + 2), Body: "<p>Durable HTML two</p>", Snippet: "Two"},
		}
		imported, importErr := repo.ImportCommunicationsEmailIntoNode(CommunicationsNodeEmailImportInput{
			CompanyID: companyID, NodeID: node.NodeID, CreatedByUserID: actor.UserID, InformationID: newUUIDv7String(),
			Thread: CommunicationsEmailThreadUpsertInput{
				CompanyID: companyID, PersonalUserID: actor.UserID, PersonalAccountEmail: "email-scale@example.com", AccountEmail: "email-scale@example.com",
				ProviderThreadID: providerThreadID, SelectedMessageID: messages[1].ID, Messages: messages, HistoryComplete: true, FetchedAt: time.Unix(int64(10_000+index), 0).UTC(),
			},
		})
		if importErr != nil {
			t.Fatalf("ImportCommunicationsEmailIntoNode %d: %v", index, importErr)
		}
		target = imported.EmailThread
	}

	if err := repo.SetNodeV2EmailLink(NodeV2EmailLinkInput{CompanyID: companyID, NodeID: node.NodeID, TextboxID: firstTextbox.Textbox.TextboxID, EmailThreadID: target.EmailThreadID, ActorUserID: actor.UserID, IdempotencyKey: "scale-link-1"}); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetNodeV2EmailLink(NodeV2EmailLinkInput{CompanyID: companyID, NodeID: node.NodeID, TextboxID: secondTextbox.Textbox.TextboxID, EmailThreadID: target.EmailThreadID, EmailMessageID: target.Messages[0].EmailMessageID, ActorUserID: actor.UserID, IdempotencyKey: "scale-link-2"}); err != nil {
		t.Fatal(err)
	}

	page, err := repo.ListNodeV2EmailThreads(NodeV2AggregateQuery{CompanyID: companyID, NodeID: node.NodeID, Limit: 30})
	if err != nil || len(page.Items) != 30 || page.NextCursor == nil {
		t.Fatalf("email page items=%d cursor=%v err=%v", len(page.Items), page.NextCursor, err)
	}
	secondPage, err := repo.ListNodeV2EmailThreads(NodeV2AggregateQuery{CompanyID: companyID, NodeID: node.NodeID, Limit: 30, Cursor: page.NextCursor})
	if err != nil || len(secondPage.Items) != 30 {
		t.Fatalf("second email page items=%d err=%v", len(secondPage.Items), err)
	}
	if page.Items[0].EmailThreadID != target.EmailThreadID || len(page.Items[0].LinkedTextboxIDs) != 2 || len(page.Items[0].LinkedMessageIDs) != 1 {
		t.Fatalf("deduplicated Node-wide target summary = %+v", page.Items[0])
	}

	metadataOnly, err := repo.ListNodeV2EmailMessages(NodeV2EmailMessageQuery{CompanyID: companyID, NodeID: node.NodeID, EmailThreadID: target.EmailThreadID, Limit: 1})
	if err != nil || len(metadataOnly.Items) != 1 || metadataOnly.Items[0].BodyHTML != "" || metadataOnly.NextCursor == nil {
		t.Fatalf("lazy message metadata page=%+v err=%v", metadataOnly, err)
	}
	withBody, err := repo.ListNodeV2EmailMessages(NodeV2EmailMessageQuery{CompanyID: companyID, NodeID: node.NodeID, EmailThreadID: target.EmailThreadID, Limit: 1, IncludeBody: true})
	if err != nil || len(withBody.Items) != 1 || withBody.Items[0].BodyHTML == "" {
		t.Fatalf("selected message body page=%+v err=%v", withBody, err)
	}
}
