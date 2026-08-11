package store

import (
	"context"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"sync"
	"testing"
	"time"
)

func TestMemoryEmailCollaborationEnsureConvergesFallbackAndKnownThread(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000101"
	sharedInboxID := "11111111-1111-4111-8111-701300000102"
	otherSharedInboxID := "11111111-1111-4111-8111-701300000103"
	repo.EnsureCompany(companyID, "Email collaboration convergence")
	creator := mustEmailCollaborationGuardUser(t, repo, companyID, "convergence-creator", "creator-convergence@example.com", domain.RoleCompanyUser)
	peer := mustEmailCollaborationGuardUser(t, repo, companyID, "convergence-peer", "peer-convergence@example.com", domain.RoleCompanyUser)

	first, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{ID: "fallback-message", Subject: "Fallback first", Snippet: "initial", Date: 10},
	})
	if err != nil || !first.Created {
		t.Fatalf("first EnsureCommunicationsEmailCollaboration = %+v err=%v", first, err)
	}
	second, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: peer.UserID,
		Message: domain.EmailMessageSnapshot{ID: "fallback-message", ThreadID: "provider-thread"},
	})
	if err != nil {
		t.Fatalf("known-thread EnsureCommunicationsEmailCollaboration: %v", err)
	}
	if second.Created || second.Collaboration.CollaborationID != first.Collaboration.CollaborationID || second.Collaboration.NodeID != first.Collaboration.NodeID {
		t.Fatalf("known-thread ensure did not converge: first=%+v second=%+v", first, second)
	}
	if second.Collaboration.ProviderThreadID != "provider-thread" || second.Collaboration.Message.ThreadID != "provider-thread" {
		t.Fatalf("later-known thread was not reconciled: %+v", second.Collaboration)
	}
	if len(second.Collaboration.Participants) != 1 || second.Collaboration.Participants[0].UserID != creator.UserID {
		t.Fatalf("source-authorized ensure must not implicitly add a participant: %+v", second.Collaboration.Participants)
	}

	future, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: peer.UserID,
		Message: domain.EmailMessageSnapshot{ID: "future-message", ThreadID: "provider-thread", Subject: "Fallback first", Snippet: "new", Date: 20},
	})
	if err != nil || future.Created || future.Collaboration.NodeID != first.Collaboration.NodeID || future.Collaboration.CollaborationID == first.Collaboration.CollaborationID || future.Collaboration.Message.ID != "future-message" {
		t.Fatalf("thread ensure = %+v err=%v, want the same Node and a distinct exact-message relationship", future, err)
	}
	otherScope, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: otherSharedInboxID, AccountEmail: "other@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{ID: "fallback-message", ThreadID: "provider-thread", Subject: "Other mailbox", Date: 20},
	})
	if err != nil || !otherScope.Created || otherScope.Collaboration.CollaborationID == first.Collaboration.CollaborationID {
		t.Fatalf("other-scope ensure = %+v err=%v, want distinct collaboration", otherScope, err)
	}
}

func TestMemoryEmailCollaborationConcurrentFallbackAndKnownThreadEnsureConverge(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000121"
	sharedInboxID := "11111111-1111-4111-8111-701300000122"
	repo.EnsureCompany(companyID, "Concurrent collaboration convergence")
	creator := mustEmailCollaborationGuardUser(t, repo, companyID, "concurrent-creator", "concurrent-creator@example.com", domain.RoleCompanyUser)
	peer := mustEmailCollaborationGuardUser(t, repo, companyID, "concurrent-peer", "concurrent-peer@example.com", domain.RoleCompanyUser)
	inputs := []CommunicationsEmailCollaborationEnsureInput{
		{
			CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "concurrent@example.com", Provider: "google", CreatedByUserID: creator.UserID,
			Message: domain.EmailMessageSnapshot{ID: "concurrent-message", Subject: "Concurrent"},
		},
		{
			CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "concurrent@example.com", Provider: "google", CreatedByUserID: peer.UserID,
			Message: domain.EmailMessageSnapshot{ID: "concurrent-message", ThreadID: "concurrent-thread"},
		},
	}
	results := make([]CommunicationsEmailCollaborationEnsureResult, len(inputs))
	errs := make([]error, len(inputs))
	var wg sync.WaitGroup
	for index := range inputs {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			results[index], errs[index] = repo.EnsureCommunicationsEmailCollaboration(context.Background(), inputs[index])
		}(index)
	}
	wg.Wait()
	for index, err := range errs {
		if err != nil {
			t.Fatalf("concurrent ensure %d: %v", index, err)
		}
	}
	if results[0].Collaboration.CollaborationID != results[1].Collaboration.CollaborationID || results[0].Collaboration.NodeID != results[1].Collaboration.NodeID {
		t.Fatalf("concurrent ensures diverged: %+v", results)
	}
	participantUserID := results[0].Collaboration.Participants[0].UserID
	stored, err := repo.GetCommunicationsEmailCollaboration(companyID, results[0].Collaboration.CollaborationID, participantUserID)
	if err != nil || stored.ProviderThreadID != "concurrent-thread" || stored.Message.ThreadID != "concurrent-thread" {
		t.Fatalf("concurrent collaboration = %+v err=%v", stored, err)
	}
}

func TestMemoryEmailCollaborationAppendsChatInExistingNodeWithoutConversionJob(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000131"
	sharedInboxID := "11111111-1111-4111-8111-701300000132"
	repo.EnsureCompany(companyID, "Exact email chat append")
	creator := mustEmailCollaborationGuardUser(t, repo, companyID, "append-creator", "append-creator@example.com", domain.RoleCompanyUser)
	textBlockID := NewUUIDv7String()
	firstChatID := NewUUIDv7String()
	secondChatID := NewUUIDv7String()
	placeholderMessageID := NewUUIDv7String()

	first, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{ID: "append-message", ThreadID: "append-thread", Subject: "Append chat"},
		LinkedTextBlock: &NodeInformationInput{
			InformationID: textBlockID, Type: "Text box", ActorUserID: creator.UserID,
			Information: editorTextBlockProjectionPrefix + `{"title":"Email","document":"","attachments":[],"email_message_id":"` + placeholderMessageID + `"}`,
		},
		InitialChat: &NodeInformationInput{
			InformationID: firstChatID, Type: CommunicationsEmailCollaborationChatInformationType, ActorUserID: creator.UserID,
			Information: `{"block_id":"` + textBlockID + `","selection_source":"email","selection_message_id":"` + placeholderMessageID + `","message":"first"}`,
		},
	})
	if err != nil || !first.Created {
		t.Fatalf("first ensure = %+v err=%v", first, err)
	}

	second, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		TargetNodeID: first.Collaboration.NodeID,
		Message:      domain.EmailMessageSnapshot{ID: "append-message", ThreadID: "append-thread", Subject: "Append chat"},
		InitialChat: &NodeInformationInput{
			InformationID: secondChatID, Type: CommunicationsEmailCollaborationChatInformationType, ActorUserID: creator.UserID,
			Information: `{"block_id":"` + textBlockID + `","selection_source":"email","selection_message_id":"` + placeholderMessageID + `","message":"second"}`,
		},
	})
	if err != nil || second.Created || second.Collaboration.NodeID != first.Collaboration.NodeID || second.Collaboration.CollaborationID != first.Collaboration.CollaborationID {
		t.Fatalf("second ensure = %+v err=%v, want the existing exact Node/message relationship", second, err)
	}
	nodes, err := repo.ListNodes(companyID)
	if err != nil || len(nodes) != 1 {
		t.Fatalf("nodes = %+v err=%v, want exactly one", nodes, err)
	}
	projections, err := repo.ListNodeProjections(companyID, first.Collaboration.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	textBoxCount, chatCount := 0, 0
	for _, projection := range projections {
		switch projection.Type {
		case "Text box":
			textBoxCount++
		case CommunicationsEmailCollaborationChatInformationType:
			chatCount++
		}
	}
	if textBoxCount != 1 || chatCount != 2 {
		t.Fatalf("projection counts text_boxes=%d chats=%d, want 1 and 2", textBoxCount, chatCount)
	}
	jobs, err := repo.ListCommunicationsEmailIngestionJobsForThreadContext(context.Background(), companyID, first.Collaboration.EmailThreadID)
	if err != nil || len(jobs) != 0 {
		t.Fatalf("chat ensure queued conversion jobs: %+v err=%v", jobs, err)
	}
}

func TestMemoryEmailThreadChatGroupsIncludeEveryNodeTextboxWithoutCreatingTextboxesForNewMessages(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000141"
	sharedInboxID := "11111111-1111-4111-8111-701300000142"
	repo.EnsureCompany(companyID, "Thread chat groups")
	creator := mustEmailCollaborationGuardUser(t, repo, companyID, "thread-chat-creator", "thread-chat@example.com", domain.RoleCompanyUser)

	firstBlockID, firstChatID := NewUUIDv7String(), NewUUIDv7String()
	first, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{ID: "thread-message-1", ThreadID: "thread-chat-groups", Subject: "First", DownloadComplete: true},
		LinkedTextBlock: &NodeInformationInput{InformationID: firstBlockID, Type: "Text box", ActorUserID: creator.UserID,
			Information: editorTextBlockProjectionPrefix + `{"title":"First","document":"","email_message_id":"` + NewUUIDv7String() + `"}`},
		InitialChat: &NodeInformationInput{InformationID: firstChatID, Type: CommunicationsEmailCollaborationChatInformationType, ActorUserID: creator.UserID,
			Information: `{"block_id":"` + firstBlockID + `","selection_source":"email","selection_message_id":"` + NewUUIDv7String() + `","message":"first node chat"}`},
	})
	if err != nil {
		t.Fatalf("first collaboration: %v", err)
	}
	secondNode, err := repo.CreateNode(companyID, "Second Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	secondBlockID, secondChatID := NewUUIDv7String(), NewUUIDv7String()
	second, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		TargetNodeID: secondNode.NodeID,
		Message:      domain.EmailMessageSnapshot{ID: "thread-message-2", ThreadID: "thread-chat-groups", Subject: "Second", DownloadComplete: true},
		LinkedTextBlock: &NodeInformationInput{InformationID: secondBlockID, Type: "Text box", ActorUserID: creator.UserID,
			Information: editorTextBlockProjectionPrefix + `{"title":"Second","document":"","email_message_id":"` + NewUUIDv7String() + `"}`},
		InitialChat: &NodeInformationInput{InformationID: secondChatID, Type: CommunicationsEmailCollaborationChatInformationType, ActorUserID: creator.UserID,
			Information: `{"block_id":"` + secondBlockID + `","selection_source":"email","selection_message_id":"` + NewUUIDv7String() + `","message":"second node chat"}`},
	})
	if err != nil {
		t.Fatalf("second collaboration: %v", err)
	}

	chatView, err := repo.ListCommunicationsEmailThreadChatGroups(CommunicationsEmailCollaborationListInput{
		CompanyID: companyID, ParticipantUserID: creator.UserID, SharedInboxID: sharedInboxID,
		MessageID: "thread-message-2", ThreadID: "thread-chat-groups",
	})
	if err != nil {
		t.Fatalf("ListCommunicationsEmailThreadChatGroups: %v", err)
	}
	groups := chatView.Groups
	if len(groups) != 2 {
		t.Fatalf("groups = %+v, want only the two explicitly created chat textboxes", groups)
	}
	chatCount := 0
	seenNodes := map[string]bool{}
	for _, group := range groups {
		seenNodes[group.NodeID] = true
		chatCount += len(group.Chats)
	}
	if chatCount != 2 || !seenNodes[first.Collaboration.NodeID] || !seenNodes[second.Collaboration.NodeID] {
		t.Fatalf("groups = %+v, want both Node sections and both chats", groups)
	}

	if _, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google",
		ProviderThreadID: "thread-chat-groups", SelectedMessageID: "thread-message-3",
		Messages: []domain.EmailMessageSnapshot{{ID: "thread-message-3", ThreadID: "thread-chat-groups", Subject: "Third", DownloadComplete: true}},
	}); err != nil {
		t.Fatalf("new message ingestion: %v", err)
	}
	chatView, err = repo.ListCommunicationsEmailThreadChatGroups(CommunicationsEmailCollaborationListInput{
		CompanyID: companyID, ParticipantUserID: creator.UserID, SharedInboxID: sharedInboxID,
		MessageID: "thread-message-3", ThreadID: "thread-chat-groups",
	})
	if err != nil {
		t.Fatalf("groups after new message: %v", err)
	}
	groups = chatView.Groups
	newMessageNodes := map[string]bool{}
	for _, group := range groups {
		for _, linkedMessage := range group.LinkedMessages {
			if linkedMessage.ProviderMessageID == "thread-message-3" {
				newMessageNodes[group.NodeID] = true
			}
		}
	}
	if len(groups) != 2 || len(newMessageNodes) != 0 {
		t.Fatalf("groups after ingestion = %+v, want no automatic textbox for the new thread message", groups)
	}

	thirdBlockID, thirdChatID := NewUUIDv7String(), NewUUIDv7String()
	if _, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		TargetNodeID: first.Collaboration.NodeID,
		Message:      domain.EmailMessageSnapshot{ID: "thread-message-3", ThreadID: "thread-chat-groups", Subject: "Third", DownloadComplete: true},
		LinkedTextBlock: &NodeInformationInput{InformationID: thirdBlockID, Type: "Text box", ActorUserID: creator.UserID,
			Information: editorTextBlockProjectionPrefix + `{"title":"Third","document":"","email_message_id":"` + NewUUIDv7String() + `"}`},
		InitialChat: &NodeInformationInput{InformationID: thirdChatID, Type: CommunicationsEmailCollaborationChatInformationType, ActorUserID: creator.UserID,
			Information: `{"block_id":"` + thirdBlockID + `","selection_source":"email","selection_message_id":"` + NewUUIDv7String() + `","message":"third message chat"}`},
	}); err != nil {
		t.Fatalf("first chat for new message: %v", err)
	}
	chatView, err = repo.ListCommunicationsEmailThreadChatGroups(CommunicationsEmailCollaborationListInput{
		CompanyID: companyID, ParticipantUserID: creator.UserID, SharedInboxID: sharedInboxID,
		MessageID: "thread-message-3", ThreadID: "thread-chat-groups",
	})
	if err != nil {
		t.Fatalf("groups after first chat: %v", err)
	}
	groups = chatView.Groups
	newMessageNodes = map[string]bool{}
	for _, group := range groups {
		for _, linkedMessage := range group.LinkedMessages {
			if linkedMessage.ProviderMessageID == "thread-message-3" {
				newMessageNodes[group.NodeID] = true
			}
		}
	}
	if len(groups) != 3 || len(newMessageNodes) != 1 || !newMessageNodes[first.Collaboration.NodeID] {
		t.Fatalf("groups after first chat = %+v, want one new textbox only in the chosen Node", groups)
	}
}

func TestMemoryEmailChatSelectsExistingGroupingAtomicallyAndKeepsActivityOrder(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000151"
	sharedInboxID := "11111111-1111-4111-8111-701300000152"
	repo.EnsureCompany(companyID, "Existing email chat grouping")
	creator := mustEmailCollaborationGuardUser(t, repo, companyID, "existing-group-creator", "existing-group@example.com", domain.RoleCompanyUser)
	firstMessage := domain.EmailMessageSnapshot{ID: "existing-group-message-1", ThreadID: "existing-group-thread", Subject: "First", DownloadComplete: true}
	firstBlockID, firstChatID := NewUUIDv7String(), NewUUIDv7String()
	first, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		Message: firstMessage,
		LinkedTextBlock: &NodeInformationInput{InformationID: firstBlockID, Type: "Text box", ActorUserID: creator.UserID,
			Information: editorTextBlockProjectionPrefix + `{"title":"First grouping","document":"","email_message_id":"` + NewUUIDv7String() + `"}`},
		InitialChat: &NodeInformationInput{InformationID: firstChatID, Type: CommunicationsEmailCollaborationChatInformationType, ActorUserID: creator.UserID,
			Information: `{"block_id":"` + firstBlockID + `","selection_source":"email","selection_message_id":"` + NewUUIDv7String() + `","message":"first chat"}`},
	})
	if err != nil {
		t.Fatalf("first grouping: %v", err)
	}

	secondMessage := domain.EmailMessageSnapshot{ID: "existing-group-message-2", ThreadID: "existing-group-thread", Subject: "Second", DownloadComplete: true}
	if _, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google",
		ProviderThreadID: firstMessage.ThreadID, SelectedMessageID: secondMessage.ID, Messages: []domain.EmailMessageSnapshot{secondMessage},
	}); err != nil {
		t.Fatalf("store second exact message: %v", err)
	}
	secondChatID := NewUUIDv7String()
	if _, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		TargetNodeID: first.Collaboration.NodeID, Message: secondMessage,
		InitialChat: &NodeInformationInput{InformationID: secondChatID, Type: CommunicationsEmailCollaborationChatInformationType, ActorUserID: creator.UserID,
			Information: `{"block_id":"` + firstBlockID + `","selection_source":"email","selection_message_id":"` + NewUUIDv7String() + `","message":"second message in existing grouping"}`},
	}); err != nil {
		t.Fatalf("atomically link second message to existing grouping: %v", err)
	}

	chatView, err := repo.ListCommunicationsEmailThreadChatGroups(CommunicationsEmailCollaborationListInput{
		CompanyID: companyID, ParticipantUserID: creator.UserID, SharedInboxID: sharedInboxID,
		MessageID: secondMessage.ID, ThreadID: secondMessage.ThreadID,
	})
	if err != nil {
		t.Fatal(err)
	}
	groups := chatView.Groups
	if len(groups) != 1 || groups[0].TextboxID != firstBlockID || len(groups[0].LinkedMessages) != 2 || len(groups[0].Chats) != 2 {
		t.Fatalf("existing grouping after atomic link = %+v", groups)
	}

	thirdMessage := domain.EmailMessageSnapshot{ID: "existing-group-message-3", ThreadID: "existing-group-thread", Subject: "Third", DownloadComplete: true}
	secondBlockID, thirdChatID := NewUUIDv7String(), NewUUIDv7String()
	if _, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		TargetNodeID: first.Collaboration.NodeID, Message: thirdMessage,
		LinkedTextBlock: &NodeInformationInput{InformationID: secondBlockID, Type: "Text box", ActorUserID: creator.UserID,
			Information: editorTextBlockProjectionPrefix + `{"title":"Second grouping","document":"","email_message_id":"` + NewUUIDv7String() + `"}`},
		InitialChat: &NodeInformationInput{InformationID: thirdChatID, Type: CommunicationsEmailCollaborationChatInformationType, ActorUserID: creator.UserID,
			Information: `{"block_id":"` + secondBlockID + `","selection_source":"email","selection_message_id":"` + NewUUIDv7String() + `","message":"third message chat"}`},
	}); err != nil {
		t.Fatalf("second grouping: %v", err)
	}

	conflictingChatID := NewUUIDv7String()
	_, err = repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		TargetNodeID: first.Collaboration.NodeID, Message: secondMessage,
		InitialChat: &NodeInformationInput{InformationID: conflictingChatID, Type: CommunicationsEmailCollaborationChatInformationType, ActorUserID: creator.UserID,
			Information: `{"block_id":"` + secondBlockID + `","selection_source":"email","selection_message_id":"` + NewUUIDv7String() + `","message":"must not move"}`},
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("conflicting same-Node grouping err=%v, want ErrInvalid", err)
	}

	time.Sleep(2 * time.Millisecond)
	latestFirstGroupChatID := NewUUIDv7String()
	if _, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		TargetNodeID: first.Collaboration.NodeID, Message: firstMessage,
		InitialChat: &NodeInformationInput{InformationID: latestFirstGroupChatID, Type: CommunicationsEmailCollaborationChatInformationType, ActorUserID: creator.UserID,
			Information: `{"block_id":"` + firstBlockID + `","selection_source":"email","selection_message_id":"` + NewUUIDv7String() + `","message":"latest first-group chat"}`},
	}); err != nil {
		t.Fatalf("append latest chat to first grouping: %v", err)
	}

	chatView, err = repo.ListCommunicationsEmailThreadChatGroups(CommunicationsEmailCollaborationListInput{
		CompanyID: companyID, ParticipantUserID: creator.UserID, SharedInboxID: sharedInboxID,
		MessageID: firstMessage.ID, ThreadID: firstMessage.ThreadID,
	})
	if err != nil {
		t.Fatal(err)
	}
	groups = chatView.Groups
	if len(groups) != 2 || groups[0].TextboxID != secondBlockID || groups[1].TextboxID != firstBlockID {
		t.Fatalf("group latest-activity order = %+v, want second grouping then newly active first grouping", groups)
	}
	if len(groups[1].Chats) != 3 {
		t.Fatalf("first grouping chats=%d, want 3", len(groups[1].Chats))
	}
	for index := 1; index < len(groups[1].Chats); index++ {
		previous, current := groups[1].Chats[index-1], groups[1].Chats[index]
		if current.CreatedTimestamp.Before(previous.CreatedTimestamp) ||
			(current.CreatedTimestamp.Equal(previous.CreatedTimestamp) && current.InformationID < previous.InformationID) {
			t.Fatalf("first grouping chat order = %+v", groups[1].Chats)
		}
	}
	for _, chat := range groups[0].Chats {
		if chat.InformationID == conflictingChatID {
			t.Fatal("conflicting chat was persisted")
		}
	}
}

func TestMemoryEmailChatUsesAuthoritativeChatFreeTextboxLink(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000161"
	sharedInboxID := "11111111-1111-4111-8111-701300000162"
	repo.EnsureCompany(companyID, "Chat-free email textbox")
	creator := mustEmailCollaborationGuardUser(t, repo, companyID, "chat-free-creator", "chat-free@example.com", domain.RoleCompanyUser)
	message := domain.EmailMessageSnapshot{ID: "chat-free-message", ThreadID: "chat-free-thread", Subject: "Chat free", DownloadComplete: true}
	textboxID := NewUUIDv7String()
	created, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		Message: message,
		LinkedTextBlock: &NodeInformationInput{InformationID: textboxID, Type: "Text box", ActorUserID: creator.UserID,
			Information: editorTextBlockProjectionPrefix + `{"title":"Chat-free grouping","document":"","email_message_id":"` + NewUUIDv7String() + `"}`},
	})
	if err != nil {
		t.Fatal(err)
	}
	input := CommunicationsEmailCollaborationListInput{
		CompanyID: companyID, ParticipantUserID: creator.UserID, SharedInboxID: sharedInboxID,
		MessageID: message.ID, ThreadID: message.ThreadID,
	}
	chatView, err := repo.ListCommunicationsEmailThreadChatGroups(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(chatView.Groups) != 0 || len(chatView.TextboxLinks) != 1 || chatView.TextboxLinks[0].TextboxID != textboxID {
		t.Fatalf("chat-free view = %+v", chatView)
	}

	chatID := NewUUIDv7String()
	if _, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: "support@example.com", Provider: "google", CreatedByUserID: creator.UserID,
		TargetNodeID: created.Collaboration.NodeID, Message: message,
		InitialChat: &NodeInformationInput{InformationID: chatID, Type: CommunicationsEmailCollaborationChatInformationType, ActorUserID: creator.UserID,
			Information: `{"block_id":"` + textboxID + `","selection_source":"email","selection_message_id":"` + NewUUIDv7String() + `","message":"first chat"}`},
	}); err != nil {
		t.Fatal(err)
	}
	chatView, err = repo.ListCommunicationsEmailThreadChatGroups(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(chatView.Groups) != 1 || chatView.Groups[0].TextboxID != textboxID || len(chatView.TextboxLinks) != 1 {
		t.Fatalf("first chat reused chat-free textbox = %+v", chatView)
	}
	projections, err := repo.ListNodeProjections(companyID, created.Collaboration.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	textboxCount := 0
	for _, projection := range projections {
		if isEditorTextBoxType(projection.Type) {
			textboxCount++
		}
	}
	if textboxCount != 1 {
		t.Fatalf("textboxes=%d, want exactly one", textboxCount)
	}
}

func TestMemoryEmailCollaborationAtomicInformationWriteSnapshotsGroup(t *testing.T) {
	repo, companyID, creator, participant, collaboration := setupAtomicEmailCollaboration(t)
	parent, err := repo.CreateCompanyUserGroup(companyID, "", "Support")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup parent: %v", err)
	}
	child, err := repo.CreateCompanyUserGroup(companyID, parent.GroupID, "Escalations")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup child: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, child.GroupID, []string{participant.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers: %v", err)
	}
	payload := emailCollaborationChatPayload(t, "hello group", nil, []string{parent.GroupID})
	chatID := NewUUIDv7String()
	result, err := repo.AddEmailCollaborationNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, Type: CommunicationsEmailCollaborationChatInformationType,
		Information: payload, InformationID: chatID, ActorUserID: creator.UserID, ActorDisplayName: creator.DisplayName,
	})
	if err != nil {
		t.Fatalf("AddEmailCollaborationNodeInformationWithActor: %v", err)
	}
	if result.CollaborationID != collaboration.CollaborationID || len(result.MentionedUserIDs) != 1 || result.MentionedUserIDs[0] != participant.UserID {
		t.Fatalf("atomic information result = %+v", result)
	}
	details, err := repo.GetNodeDetails(companyID, collaboration.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails: %v", err)
	}
	foundHistory := false
	for _, item := range details.Information {
		if item.InformationID == result.Information.InformationID && item.Information == payload {
			foundHistory = true
		}
	}
	if !foundHistory {
		t.Fatalf("chat history item missing from %+v", details.Information)
	}
	projections, err := repo.ListNodeProjections(companyID, collaboration.NodeID)
	if err != nil || !hasNodeProjection(projections, chatID, payload) {
		t.Fatalf("chat projection missing from %+v err=%v", projections, err)
	}
	stored, err := repo.GetCommunicationsEmailCollaboration(companyID, collaboration.CollaborationID, participant.UserID)
	if err != nil || len(stored.Participants) != 2 {
		t.Fatalf("participant snapshot = %+v err=%v", stored.Participants, err)
	}
	if allowed, err := repo.UserHasEffectiveAccess(companyID, participant.UserID, EntityTypeNode, collaboration.NodeID, EntityPermissionEdit); err != nil || !allowed {
		t.Fatalf("participant edit access = %v err=%v", allowed, err)
	}

	ordinary, err := repo.CreateNode(companyID, "Ordinary")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.AddEmailCollaborationNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: ordinary.NodeID, Type: CommunicationsEmailCollaborationChatInformationType,
		Information: payload, ActorUserID: creator.UserID,
	}); !errors.Is(err, ErrNotEmailCollaboration) {
		t.Fatalf("ordinary node atomic write error = %v, want ErrNotEmailCollaboration", err)
	}
	ordinaryDetails, err := repo.GetNodeDetails(companyID, ordinary.NodeID)
	if err != nil || ordinaryDetails.InformationCount != 0 {
		t.Fatalf("ordinary node was mutated: %+v err=%v", ordinaryDetails, err)
	}
}

func TestMemoryEmailCollaborationAtomicProjectionRejectsInvalidMentionsWithoutWriting(t *testing.T) {
	repo, companyID, creator, participant, collaboration := setupAtomicEmailCollaboration(t)
	chatID := NewUUIDv7String()
	initialPayload := emailCollaborationChatPayload(t, "before", nil, nil)
	if _, err := repo.UpsertEmailCollaborationNodeProjectionWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, Type: CommunicationsEmailCollaborationChatInformationType,
		Information: initialPayload, InformationID: chatID, ActorUserID: creator.UserID,
	}); err != nil {
		t.Fatalf("initial atomic projection: %v", err)
	}
	nonParticipantChatID := NewUUIDv7String()
	if _, err := repo.UpsertEmailCollaborationNodeProjectionWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, Type: CommunicationsEmailCollaborationChatInformationType,
		Information: emailCollaborationChatPayload(t, "not yet shared", nil, nil), InformationID: nonParticipantChatID, ActorUserID: participant.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("nonparticipant projection error = %v, want ErrNotFound", err)
	}
	projections, err := repo.ListNodeProjections(companyID, collaboration.NodeID)
	if err != nil || hasNodeProjectionID(projections, nonParticipantChatID) {
		t.Fatalf("nonparticipant write changed projections: %+v err=%v", projections, err)
	}
	invalidPayload := emailCollaborationChatPayload(t, "must not commit", nil, []string{"11111111-1111-4111-8111-701300000199"})
	if _, err := repo.UpsertEmailCollaborationNodeProjectionWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, Type: CommunicationsEmailCollaborationChatInformationType,
		Information: invalidPayload, InformationID: chatID, ActorUserID: creator.UserID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid group projection error = %v, want ErrInvalid", err)
	}
	projections, err = repo.ListNodeProjections(companyID, collaboration.NodeID)
	if err != nil || !hasNodeProjection(projections, chatID, initialPayload) {
		t.Fatalf("invalid mention changed projection: %+v err=%v", projections, err)
	}
	if _, err := repo.GetCommunicationsEmailCollaboration(companyID, collaboration.CollaborationID, participant.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("invalid mention added participant: %v", err)
	}

	validPayload := emailCollaborationChatPayload(t, "now shared", []string{participant.UserID}, nil)
	result, err := repo.UpsertEmailCollaborationNodeProjectionWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, Type: CommunicationsEmailCollaborationChatInformationType,
		Information: validPayload, InformationID: chatID, ActorUserID: creator.UserID,
	})
	if err != nil || result.CollaborationID != collaboration.CollaborationID || len(result.MentionedUserIDs) != 1 || result.MentionedUserIDs[0] != participant.UserID {
		t.Fatalf("valid atomic projection = %+v err=%v", result, err)
	}
	projections, err = repo.ListNodeProjections(companyID, collaboration.NodeID)
	if err != nil || !hasNodeProjection(projections, chatID, validPayload) {
		t.Fatalf("valid mention projection missing: %+v err=%v", projections, err)
	}
	peerPayload := emailCollaborationChatPayload(t, "participant reply", nil, nil)
	if _, err := repo.UpsertEmailCollaborationNodeProjectionWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: collaboration.NodeID, Type: CommunicationsEmailCollaborationChatInformationType,
		Information: peerPayload, InformationID: NewUUIDv7String(), ActorUserID: participant.UserID,
	}); err != nil {
		t.Fatalf("snapshotted participant chat: %v", err)
	}
}

func setupAtomicEmailCollaboration(t *testing.T) (*MemoryRepo, string, domain.User, domain.User, domain.CommunicationsEmailCollaboration) {
	t.Helper()
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000111"
	repo.EnsureCompany(companyID, "Atomic collaboration")
	creator := mustEmailCollaborationGuardUser(t, repo, companyID, "atomic-creator", "atomic-creator@example.com", domain.RoleCompanyUser)
	participant := mustEmailCollaborationGuardUser(t, repo, companyID, "atomic-participant", "atomic-participant@example.com", domain.RoleCompanyUser)
	created, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email, Provider: "google",
		AccountEmail: creator.Email, CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{ID: "atomic-message", ThreadID: "atomic-thread", Subject: "Atomic chat"},
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailCollaboration: %v", err)
	}
	return repo, companyID, creator, participant, created.Collaboration
}

func emailCollaborationChatPayload(t *testing.T, content string, userIDs, groupIDs []string) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"block_id": NewUUIDv7String(), "content": content,
		"mentioned_user_ids": userIDs, "mentioned_group_ids": groupIDs,
	})
	if err != nil {
		t.Fatalf("json.Marshal chat payload: %v", err)
	}
	return string(raw)
}

func hasNodeProjection(items []domain.NodeProjection, informationID, information string) bool {
	for _, item := range items {
		if item.InformationID == informationID && item.Information == information {
			return true
		}
	}
	return false
}

func hasNodeProjectionID(items []domain.NodeProjection, informationID string) bool {
	for _, item := range items {
		if item.InformationID == informationID {
			return true
		}
	}
	return false
}
