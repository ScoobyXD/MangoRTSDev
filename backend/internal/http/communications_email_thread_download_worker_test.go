package httpapi

import (
	"bytes"
	"context"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"testing"
	"time"
)

func TestCommunicationsEmailThreadDownloadWorkerStoresThreadAttachmentsAndLaterManualMessage(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email, Scope: "personal", GrantID: "worker-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	created, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{ID: "worker-root", ThreadID: "worker-thread", Subject: "Stored immediately", Body: "<p>selected</p>"},
	})
	if err != nil {
		t.Fatal(err)
	}

	client := newEmailCollaborationThreadTestClient()
	client.downloadContent = []byte("report bytes")
	client.threadsByID["worker-thread"] = NylasThread{ID: "worker-thread", MessageIDs: []string{"worker-root", "worker-reply", "worker-root"}}
	client.messagesByID["worker-root"] = NylasMessage{ID: "worker-root", ThreadID: "worker-thread", Subject: "Thread", Body: "<p>root</p>", Date: 10}
	client.messagesByID["worker-reply"] = NylasMessage{
		ID: "worker-reply", ThreadID: "worker-thread", Subject: "Re: Thread", Body: "<p>reply</p>", Date: 20,
		Attachments: []NylasAttachment{{ID: "provider-file", Filename: "report.pdf", ContentType: "application/pdf", Size: 12}},
	}
	storage := newFakeAttachmentObjectStorage()
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(), AttachmentStorage: storage,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableCommunicationsArchiveWorker: true,
		DisableCommunicationsEmailThreadDownloadWorker: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)

	processed, err := server.processAvailableCommunicationsEmailThreadDownloadJobs(context.Background(), 10)
	if err != nil || processed != 1 {
		t.Fatalf("initial processed=%d err=%v", processed, err)
	}
	thread, err := repo.GetCommunicationsEmailThread(emailCollaborationThreadTestCompanyID, created.Collaboration.EmailThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if !thread.HistoryComplete || thread.DownloadStatus != store.CommunicationsEmailThreadDownloadComplete || len(thread.Messages) != 2 {
		t.Fatalf("downloaded thread = %+v", thread)
	}
	if !thread.Messages[0].Message.DownloadComplete || !thread.Messages[1].Message.DownloadComplete {
		t.Fatalf("messages incomplete: %+v", thread.Messages)
	}
	attachments := thread.Messages[1].Message.Attachments
	if len(attachments) != 1 || attachments[0].AttachmentID == "" {
		t.Fatalf("stored attachment metadata = %+v", attachments)
	}
	storedMessageID := thread.Messages[1].EmailMessageID
	links, err := repo.ListResourceAttachments(emailCollaborationThreadTestCompanyID, "email_message", storedMessageID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, link := range links {
		if link.AttachmentID == attachments[0].AttachmentID && link.ResourceID == storedMessageID {
			found = true
		}
	}
	if !found || len(storage.objects) != 1 {
		t.Fatalf("attachment links=%+v objects=%d", links, len(storage.objects))
	}
	for _, object := range storage.objects {
		if !bytes.Equal(object.body, []byte("report bytes")) {
			t.Fatalf("stored attachment bytes = %q", object.body)
		}
	}

	// The established explicit-import path still reconciles a selected reply
	// through the same durable ingestion queue.
	laterSnapshot := domain.EmailMessageSnapshot{ID: "worker-later", ThreadID: "worker-thread", Subject: "Re: Thread", Body: "<p>later selected</p>", Date: 30}
	thread, err = repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: thread.CompanyID, PersonalUserID: thread.PersonalUserID, PersonalAccountEmail: thread.PersonalAccountEmail,
		AccountEmail: thread.AccountEmail, ProviderThreadID: thread.ProviderThreadID, SelectedMessageID: laterSnapshot.ID,
		Messages: []domain.EmailMessageSnapshot{laterSnapshot}, HistoryComplete: true, FetchedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	client.messagesByID["worker-later"] = NylasMessage{ID: "worker-later", ThreadID: "worker-thread", Subject: "Re: Thread", Body: "<p>later complete</p>", Date: 30}
	if _, createdJob, err := repo.EnsureCommunicationsEmailThreadDownloadJob(thread.CompanyID, thread.EmailThreadID, store.CommunicationsEmailThreadDownloadScopeMessage, "worker-later", owner.UserID); err != nil || !createdJob {
		t.Fatalf("later selected-message job created=%v err=%v", createdJob, err)
	}
	processed, err = server.processAvailableCommunicationsEmailThreadDownloadJobs(context.Background(), 10)
	if err != nil || processed != 1 {
		t.Fatalf("later processed=%d err=%v", processed, err)
	}
	thread, err = repo.GetCommunicationsEmailThread(thread.CompanyID, thread.EmailThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if len(thread.Messages) != 3 || thread.Messages[2].ProviderMessageID != "worker-later" || !thread.Messages[2].Message.DownloadComplete {
		t.Fatalf("later message result = %+v", thread.Messages)
	}
	processed, err = server.processAvailableCommunicationsEmailThreadDownloadJobs(context.Background(), 10)
	if err != nil || processed != 0 {
		t.Fatalf("duplicate processing=%d err=%v", processed, err)
	}
	threadGrants, _, messageGrants, requestedIDs := client.calls()
	if len(threadGrants) != 2 || len(messageGrants) != 3 || len(requestedIDs) != 3 {
		t.Fatalf("provider calls threads=%v message_grants=%v message_ids=%v", threadGrants, messageGrants, requestedIDs)
	}

	// A qualifying live Inbox reply is discovered without a Mango thread ID,
	// appended to the stored thread, and inherits its existing Node placement.
	autoDate := time.Now().UTC().Add(time.Second).Unix()
	client.folders = []NylasFolder{{ID: "worker-inbox", SystemFolder: "inbox"}}
	client.threadsByID["worker-thread"] = NylasThread{ID: "worker-thread", MessageIDs: []string{"worker-root", "worker-reply", "worker-later", "worker-auto"}}
	client.messagesByID["worker-auto"] = NylasMessage{
		ID: "worker-auto", ThreadID: "worker-thread", Subject: "Re: Thread",
		Body: "<p>automatic</p>", Date: autoDate, Folders: []string{"worker-inbox"},
	}
	if _, createdJob, err := repo.EnsureCommunicationsEmailIngestionJob(store.CommunicationsEmailIngestionJobInput{
		CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
		ProviderMessageID: "worker-auto", ProviderThreadID: "worker-thread",
		Priority: store.CommunicationsEmailIngestionPriorityLive,
	}); err != nil || !createdJob {
		t.Fatalf("automatic ingestion job created=%v err=%v", createdJob, err)
	}
	processed, err = server.processAvailableCommunicationsEmailThreadDownloadJobs(context.Background(), 10)
	if err != nil || processed != 1 {
		t.Fatalf("automatic processed=%d err=%v", processed, err)
	}
	thread, err = repo.GetCommunicationsEmailThread(thread.CompanyID, thread.EmailThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if len(thread.Messages) != 4 || thread.Messages[3].ProviderMessageID != "worker-auto" || !thread.Messages[3].Message.DownloadComplete {
		t.Fatalf("automatic message result = %+v", thread.Messages)
	}
	placements, err := repo.ListCommunicationsEmailPlacements(owner.UserID, thread.CompanyID, []string{"worker-auto"})
	if err != nil || len(placements) != 1 || placements[0].NodeID != created.Collaboration.NodeID {
		t.Fatalf("automatic Node placement = %+v err=%v", placements, err)
	}

	orphan, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{ID: "worker-orphan", Subject: "No provider thread", Body: "<p>orphan</p>"},
	})
	if err != nil {
		t.Fatal(err)
	}
	client.messagesByID["worker-orphan"] = NylasMessage{ID: "worker-orphan", Subject: "No provider thread", Body: "<p>orphan complete</p>", Date: 40}
	processed, err = server.processAvailableCommunicationsEmailThreadDownloadJobs(context.Background(), 10)
	if err != nil || processed != 1 {
		t.Fatalf("orphan processed=%d err=%v", processed, err)
	}
	orphanThread, err := repo.GetCommunicationsEmailThread(emailCollaborationThreadTestCompanyID, orphan.Collaboration.EmailThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if !orphanThread.HistoryComplete || orphanThread.DownloadStatus != store.CommunicationsEmailThreadDownloadComplete || len(orphanThread.Messages) != 1 || !orphanThread.Messages[0].Message.DownloadComplete {
		t.Fatalf("orphan message download result = %+v", orphanThread)
	}
}

func TestEmailMessageHasUnresolvedCIDAttachmentsIgnoresRecoveryAttemptFlag(t *testing.T) {
	unresolved := NylasMessage{Body: "<p>Signature</p><img src=\"cid:signature-logo\">", RawMIMEAttachmentsRecovered: true}
	if !emailMessageHasUnresolvedCIDAttachments(unresolved) {
		t.Fatal("unresolved signature CID was treated as complete")
	}
	unresolved.Attachments = []NylasAttachment{{ID: "provider-inline", ContentID: "signature-logo"}}
	if emailMessageHasUnresolvedCIDAttachments(unresolved) {
		t.Fatal("provider-downloadable signature CID was treated as unresolved")
	}
}

func TestCommunicationsEmailConnectionScanStartsAtActivationAndQueuesRoutineWork(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		CompanyID: emailCollaborationThreadTestCompanyID, UserID: owner.UserID,
		Provider: "google", AccountEmail: owner.Email, GrantID: "scan-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	scanStarted := connection.LastSuccessfulScanAt.Add(time.Minute)
	client := &fakeNylasClient{
		folders: []NylasFolder{{ID: "scan-inbox", SystemFolder: "inbox"}},
		messagePagesByToken: map[string]NylasMessagePage{
			"": {Messages: []NylasMessage{
				{ID: "scan-old", ThreadID: "scan-old-thread", Date: connection.IngestionStartedAt.Add(-time.Minute).Unix()},
				{ID: "scan-new", ThreadID: "scan-new-thread", Date: scanStarted.Add(-time.Second).Unix()},
			}},
		},
	}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		DisableCommunicationsEmailThreadDownloadWorker: true,
		DisableCommunicationsArchiveWorker:             true, DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)

	if err := server.scanConnectedCommunicationsEmailConnection(context.Background(), connection, scanStarted); err != nil {
		t.Fatal(err)
	}
	jobs, err := repo.ClaimCommunicationsEmailThreadDownloadJobs(10, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 || jobs[0].ProviderMessageID != "scan-new" || jobs[0].Priority != store.CommunicationsEmailIngestionPriorityScan {
		t.Fatalf("scan jobs = %+v", jobs)
	}
	client.mu.Lock()
	query := client.lastQuery
	client.mu.Unlock()
	if query.FolderID != "scan-inbox" || query.ReceivedAfter > connection.IngestionStartedAt.Unix()-1 || query.ReceivedBefore != scanStarted.Unix() {
		t.Fatalf("scan query = %+v activation=%s scan=%s", query, connection.IngestionStartedAt, scanStarted)
	}
	updated, err := repo.GetEmailConnectionByID(connection.CompanyID, connection.EmailConnectionID)
	if err != nil || !updated.LastSuccessfulScanAt.Equal(scanStarted) {
		t.Fatalf("scan checkpoint = %s err=%v, want %s", updated.LastSuccessfulScanAt, err, scanStarted)
	}
}
