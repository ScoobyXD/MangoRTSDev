package httpapi

import (
	"bytes"
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/emailqueue"
	"miraeopus/backend/internal/store"
	"strings"
	"sync"
	"testing"
	"time"
)

type emailOutboxBoundaryRepo struct {
	store.Repository
	mu       sync.Mutex
	fail     bool
	enqueues int
	inputs   []store.RealtimeOutboxInput
}

type emailParkingFailureRepo struct {
	store.Repository
}

func (r *emailParkingFailureRepo) ParkCommunicationsEmailIngestionAttemptContext(context.Context, string, string, string, string) error {
	return errors.New("forced email parking status failure")
}

func (r *emailOutboxBoundaryRepo) EnqueueRealtimeOutbox(ctx context.Context, input store.RealtimeOutboxInput) (store.RealtimeOutboxEvent, error) {
	r.mu.Lock()
	r.enqueues++
	r.inputs = append(r.inputs, input)
	fail := r.fail
	r.mu.Unlock()
	if fail {
		return store.RealtimeOutboxEvent{}, errors.New("forced email outbox failure")
	}
	return r.Repository.EnqueueRealtimeOutbox(ctx, input)
}

func (r *emailOutboxBoundaryRepo) outboxInputs() []store.RealtimeOutboxInput {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]store.RealtimeOutboxInput(nil), r.inputs...)
}

func (r *emailOutboxBoundaryRepo) setFail(fail bool) {
	r.mu.Lock()
	r.fail = fail
	r.mu.Unlock()
}

func (r *emailOutboxBoundaryRepo) enqueueCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.enqueues
}

func newEmailOutboxBoundaryFixture(t *testing.T) (*store.MemoryRepo, store.CommunicationsEmailThreadDownloadJob, *emailCollaborationThreadTestClient) {
	t.Helper()
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email, Scope: "personal", GrantID: "outbox-boundary-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	created, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{ID: "outbox-boundary-message", Subject: "Durable hint boundary", Body: "<p>selected</p>"},
	})
	if err != nil {
		t.Fatal(err)
	}
	jobs, err := repo.ListCommunicationsEmailThreadDownloadJobsContext(context.Background(), created.Collaboration.CompanyID, created.Collaboration.EmailThreadID)
	if err != nil || len(jobs) != 1 || jobs[0].EmailConnectionID != connection.EmailConnectionID {
		t.Fatalf("boundary jobs=%+v err=%v", jobs, err)
	}
	client := newEmailCollaborationThreadTestClient()
	client.messagesByID["outbox-boundary-message"] = NylasMessage{
		ID: "outbox-boundary-message", Subject: "Durable hint boundary", Body: "<p>complete</p>", Date: time.Now().UTC().Unix(),
	}
	return repo, jobs[0], client
}

func TestEmailIngestionOutboxFailureRedeliversHintWithoutRepeatingProviderWork(t *testing.T) {
	base, job, client := newEmailOutboxBoundaryFixture(t)
	repo := &emailOutboxBoundaryRepo{Repository: base, fail: true}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableRealtimeSpine: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	message := emailqueue.Message{JobID: job.DownloadJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID}

	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), message)
	if err == nil || acknowledged {
		t.Fatalf("failed durable outbox acknowledged=%v err=%v", acknowledged, err)
	}
	completed, err := base.GetCommunicationsEmailIngestionJobContext(context.Background(), job.DownloadJobID)
	if err != nil || completed.Status != store.CommunicationsEmailThreadDownloadJobCompleted {
		t.Fatalf("completed provider result=%+v err=%v", completed, err)
	}

	repo.setFail(false)
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), message)
	if err != nil || !acknowledged {
		t.Fatalf("outbox recovery acknowledged=%v err=%v", acknowledged, err)
	}
	_, _, _, messageIDs := client.calls()
	if len(messageIDs) != 1 || messageIDs[0] != "outbox-boundary-message" {
		t.Fatalf("provider message calls=%v, want exactly one", messageIDs)
	}
	if got := repo.enqueueCount(); got != 2 {
		t.Fatalf("outbox attempts=%d, want failed insert plus redelivery insert", got)
	}
}

func TestEmailIngestionSuccessfulOutboxThenSQSDeleteFailureRedeliversWithoutDuplicateEvent(t *testing.T) {
	base, job, client := newEmailOutboxBoundaryFixture(t)
	repo := &emailOutboxBoundaryRepo{Repository: base}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableRealtimeSpine: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	message := emailqueue.Message{JobID: job.DownloadJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID}

	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), message)
	if err != nil || !acknowledged {
		t.Fatalf("first delivery acknowledged=%v err=%v", acknowledged, err)
	}
	deleteErr := errors.New("forced SQS delete failure")
	if err := (&deleteFailOnceReceiver{err: deleteErr}).Delete(context.Background(), "receipt-delete-fails"); !errors.Is(err, deleteErr) {
		t.Fatalf("SQS delete error=%v, want %v", err, deleteErr)
	}
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), message)
	if err != nil || !acknowledged {
		t.Fatalf("redelivery acknowledged=%v err=%v", acknowledged, err)
	}
	_, _, _, messageIDs := client.calls()
	if len(messageIDs) != 1 {
		t.Fatalf("provider work repeated after delete failure: %v", messageIDs)
	}
	inputs := repo.outboxInputs()
	if len(inputs) != 2 || inputs[0].EventID == "" || inputs[0].EventID != inputs[1].EventID {
		t.Fatalf("outbox inputs=%+v, want one deterministic event identity reused by redelivery", inputs)
	}
	claimed, err := base.ClaimRealtimeOutbox(context.Background(), store.RealtimeOutboxClaimQuery{Limit: 10, LeaseDuration: time.Minute})
	if err != nil || len(claimed) != 1 || claimed[0].EventID != inputs[0].EventID {
		t.Fatalf("durable outbox after delete-failure redelivery=%+v err=%v, want one exact event", claimed, err)
	}
}

func TestEmailIngestionPersonalCompletionTargetsOnlyJobCompany(t *testing.T) {
	base, job, client := newEmailOutboxBoundaryFixture(t)
	const otherCompanyID = "92929292-9292-4929-8929-929292929292"
	base.EnsureCompany(otherCompanyID, "Unrelated membership")
	if _, err := base.AddCompanyMembership("collaboration-thread-owner", otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	repo := &emailOutboxBoundaryRepo{Repository: base}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)

	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
		JobID: job.DownloadJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
	})
	if err != nil || !acknowledged {
		t.Fatalf("delivery acknowledged=%v err=%v", acknowledged, err)
	}
	inputs := repo.outboxInputs()
	if len(inputs) != 1 || inputs[0].CompanyID != job.CompanyID {
		t.Fatalf("personal completion outbox=%+v, want only job company %s", inputs, job.CompanyID)
	}
}

type deleteFailOnceReceiver struct {
	err error
}

type receiveFailureReceiver struct {
	mu    sync.Mutex
	calls int
	err   error
}

func (r *receiveFailureReceiver) Receive(context.Context) (emailqueue.Delivery, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls++
	return emailqueue.Delivery{}, false, r.err
}

func (r *receiveFailureReceiver) Delete(context.Context, string) error { return nil }

func (r *receiveFailureReceiver) callCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls
}

type emailWorkerSchemaFailureRepo struct {
	store.Repository
}

type emailWorkerReadyRepo struct {
	store.Repository
}

func (r *emailWorkerReadyRepo) CheckEmailSQSWorkerSchemaReadinessContext(ctx context.Context) error {
	return ctx.Err()
}

func (r *emailWorkerSchemaFailureRepo) CheckEmailSQSWorkerSchemaReadinessContext(context.Context) error {
	return errors.New("final email schema missing")
}

func readyEmailWorkerServer(repo store.Repository) *Server {
	ready := make(chan struct{})
	close(ready)
	return &Server{
		repo: &emailWorkerReadyRepo{Repository: repo}, nylasClient: &fakeNylasClient{}, emailQueue: &recordingEmailQueueSender{},
		emailWorkerExternalRealtime: true, realtimeBackplane: newControllableBackplane(false),
		realtimeSpineInitialBackplaneReady: ready,
	}
}

func TestEmailWorkerPersistentReceiveErrorExitsForECSRestart(t *testing.T) {
	receiver := &receiveFailureReceiver{err: errors.New("persistent SQS receive failure")}
	server := readyEmailWorkerServer(store.NewMemoryRepo())
	err := server.RunEmailWorker(context.Background(), receiver, 1)
	if err == nil || !strings.Contains(err.Error(), "email worker receive failed") {
		t.Fatalf("RunEmailWorker error=%v, want receive failure", err)
	}
	if calls := receiver.callCount(); calls != 1 {
		t.Fatalf("Receive calls=%d, want one before process exit", calls)
	}
}

func TestEmailWorkerFailsClosedBeforeReceiveWhenDependencyIsMissing(t *testing.T) {
	tests := []struct {
		name      string
		configure func(*Server)
	}{
		{name: "PostgreSQL repository", configure: func(server *Server) { server.repo = nil }},
		{name: "Nylas", configure: func(server *Server) { server.nylasClient = nil }},
		{name: "SQS sender", configure: func(server *Server) { server.emailQueue = nil }},
		{name: "external Valkey", configure: func(server *Server) { server.emailWorkerExternalRealtime = false }},
		{name: "final PostgreSQL schema", configure: func(server *Server) {
			server.repo = &emailWorkerSchemaFailureRepo{Repository: store.NewMemoryRepo()}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			receiver := &receiveFailureReceiver{}
			server := readyEmailWorkerServer(store.NewMemoryRepo())
			test.configure(server)
			if err := server.RunEmailWorker(context.Background(), receiver, 1); err == nil {
				t.Fatal("worker startup unexpectedly succeeded")
			}
			if calls := receiver.callCount(); calls != 0 {
				t.Fatalf("Receive calls=%d, want zero before failed readiness", calls)
			}
		})
	}
}

func TestEmailReconciliationWithoutNylasReturnsErrorInsteadOfPanicking(t *testing.T) {
	server := &Server{repo: store.NewMemoryRepo()}
	acknowledged, err := server.processEmailReconciliationConnection(context.Background(), emailqueue.Message{})
	if err == nil || acknowledged {
		t.Fatalf("nil-Nylas reconciliation acknowledged=%v err=%v, want safe failure", acknowledged, err)
	}
}

func (r *deleteFailOnceReceiver) Receive(context.Context) (emailqueue.Delivery, bool, error) {
	return emailqueue.Delivery{}, false, nil
}

func (r *deleteFailOnceReceiver) Delete(context.Context, string) error {
	err := r.err
	r.err = nil
	return err
}

func TestEmailIngestionValkeyOutageAcknowledgesAfterDurableOutboxAndSpineRecovers(t *testing.T) {
	base, job, client := newEmailOutboxBoundaryFixture(t)
	repo := &emailOutboxBoundaryRepo{Repository: base}
	backplane := newControllableBackplane(true)
	options := realtimeBackplaneTestOptions(backplane)
	options.NylasClient = client
	options.NylasConfig = testNylasConfig()
	server := NewServerWithOptions(repo, options)
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)

	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
		JobID: job.DownloadJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
	})
	if err != nil || !acknowledged {
		t.Fatalf("Valkey outage acknowledged=%v err=%v", acknowledged, err)
	}
	_, _, _, messageIDs := client.calls()
	if len(messageIDs) != 1 {
		t.Fatalf("provider message calls=%v, want exactly one", messageIDs)
	}
	waitForBackplaneCondition(t, func() bool { return backplane.publishCalls.Load() >= 1 }, "failed email hint Valkey publish")
	if sequence, err := base.CurrentPublishedRealtimeOutboxSequence(context.Background()); err != nil || sequence != 0 {
		t.Fatalf("published sequence during outage=%d err=%v", sequence, err)
	}

	backplane.reconnect()
	waitForBackplaneCondition(t, func() bool {
		sequence, sequenceErr := base.CurrentPublishedRealtimeOutboxSequence(context.Background())
		return sequenceErr == nil && sequence == 1
	}, "email hint recovery through realtime spine")
	_, _, _, messageIDs = client.calls()
	if len(messageIDs) != 1 {
		t.Fatalf("provider work repeated after Valkey recovery: %v", messageIDs)
	}
}

func TestEmailIngestionParksPermanentProviderFailuresFromAttachmentRecovery(t *testing.T) {
	tests := []struct {
		name      string
		message   NylasMessage
		configure func(*emailCollaborationThreadTestClient)
	}{
		{
			name: "provider attachment download",
			message: NylasMessage{
				ID: "attachment-provider-failure", Subject: "Attachment", Body: "<p>body</p>", Date: time.Now().UTC().Unix(),
				Attachments: []NylasAttachment{{ID: "provider-attachment", Filename: "report.pdf", ContentType: "application/pdf"}},
			},
			configure: func(client *emailCollaborationThreadTestClient) {
				client.downloadErr = NylasAPIError{StatusCode: 401, Code: "unauthorized"}
			},
		},
		{
			name: "raw MIME recovery",
			message: NylasMessage{
				ID: "attachment-provider-failure", Subject: "Inline attachment", Body: `<p><img src="cid:logo"></p>`, Date: time.Now().UTC().Unix(),
			},
			configure: func(client *emailCollaborationThreadTestClient) {
				client.rawMIMEErr = NylasAPIError{StatusCode: 403, Code: "forbidden"}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
			connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
				UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email, Scope: "personal", GrantID: "attachment-failure-grant", Status: "connected",
			})
			if err != nil {
				t.Fatal(err)
			}
			created, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
				CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
				AccountEmail: owner.Email, Provider: "google", CreatedByUserID: owner.UserID,
				Message: domain.EmailMessageSnapshot{ID: test.message.ID, Subject: test.message.Subject, Body: "<p>selected</p>"},
			})
			if err != nil {
				t.Fatal(err)
			}
			jobs, err := repo.ListCommunicationsEmailThreadDownloadJobsContext(context.Background(), created.Collaboration.CompanyID, created.Collaboration.EmailThreadID)
			if err != nil || len(jobs) != 1 {
				t.Fatalf("jobs=%+v err=%v", jobs, err)
			}
			client := newEmailCollaborationThreadTestClient()
			client.messagesByID[test.message.ID] = test.message
			test.configure(client)
			server := NewServerWithOptions(repo, ServerOptions{
				NylasClient: client, NylasConfig: testNylasConfig(), AttachmentStorage: newFakeAttachmentObjectStorage(),
				DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
			})
			defer server.Close()
			server.nylasGate = newNylasRequestGate(0)

			acknowledged, err := server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
				JobID: jobs[0].DownloadJobID, CompanyID: jobs[0].CompanyID, EmailConnectionID: jobs[0].EmailConnectionID,
			})
			if err != nil || !acknowledged {
				t.Fatalf("permanent provider failure acknowledged=%v err=%v", acknowledged, err)
			}
			parked, err := repo.GetCommunicationsEmailIngestionJobContext(context.Background(), jobs[0].DownloadJobID)
			if err != nil || parked.Status != store.CommunicationsEmailThreadDownloadJobParked || parked.ProviderAttemptCount != 1 {
				t.Fatalf("parked job=%+v err=%v", parked, err)
			}
			updated, err := repo.GetEmailConnectionByIDContext(context.Background(), connection.CompanyID, connection.EmailConnectionID)
			if err != nil || updated.Status != "reauth_required" {
				t.Fatalf("connection=%+v err=%v", updated, err)
			}
		})
	}
}

func TestEmailIngestionStatusWriteFailureRemainsUnacknowledged(t *testing.T) {
	base, job, client := newEmailOutboxBoundaryFixture(t)
	client.messageErrorsByID["outbox-boundary-message"] = NylasAPIError{StatusCode: 401, Code: "unauthorized"}
	server := NewServerWithOptions(&emailParkingFailureRepo{Repository: base}, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)

	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
		JobID: job.DownloadJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
	})
	if err == nil || acknowledged {
		t.Fatalf("status-write failure acknowledged=%v err=%v", acknowledged, err)
	}
	stored, err := base.GetCommunicationsEmailIngestionJobContext(context.Background(), job.DownloadJobID)
	if err != nil || stored.Status != store.CommunicationsEmailThreadDownloadJobProcessing || stored.ProviderAttemptCount != 1 {
		t.Fatalf("unsettled job=%+v err=%v", stored, err)
	}
}

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
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)

	jobs, err := repo.ListCommunicationsEmailThreadDownloadJobsContext(context.Background(), emailCollaborationThreadTestCompanyID, created.Collaboration.EmailThreadID)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("initial jobs=%+v err=%v", jobs, err)
	}
	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
		JobID: jobs[0].DownloadJobID, CompanyID: jobs[0].CompanyID, EmailConnectionID: jobs[0].EmailConnectionID,
	})
	if err != nil || !acknowledged {
		t.Fatalf("initial acknowledged=%v err=%v", acknowledged, err)
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
	laterJob, createdJob, err := repo.EnsureCommunicationsEmailThreadDownloadJobContext(context.Background(), thread.CompanyID, thread.EmailThreadID, store.CommunicationsEmailThreadDownloadScopeMessage, "worker-later", owner.UserID)
	if err != nil || !createdJob {
		t.Fatalf("later selected-message job created=%v err=%v", createdJob, err)
	}
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{JobID: laterJob.DownloadJobID, CompanyID: laterJob.CompanyID, EmailConnectionID: laterJob.EmailConnectionID})
	if err != nil || !acknowledged {
		t.Fatalf("later acknowledged=%v err=%v", acknowledged, err)
	}
	thread, err = repo.GetCommunicationsEmailThread(thread.CompanyID, thread.EmailThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if len(thread.Messages) != 3 || thread.Messages[2].ProviderMessageID != "worker-later" || !thread.Messages[2].Message.DownloadComplete {
		t.Fatalf("later message result = %+v", thread.Messages)
	}
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{JobID: laterJob.DownloadJobID, CompanyID: laterJob.CompanyID, EmailConnectionID: laterJob.EmailConnectionID})
	if err != nil || !acknowledged {
		t.Fatalf("duplicate acknowledged=%v err=%v", acknowledged, err)
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
	autoJob, createdJob, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), store.CommunicationsEmailIngestionJobInput{
		CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
		ProviderMessageID: "worker-auto", ProviderThreadID: "worker-thread",
		Priority: store.CommunicationsEmailIngestionPriorityLive,
	})
	if err != nil || !createdJob {
		t.Fatalf("automatic ingestion job created=%v err=%v", createdJob, err)
	}
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{JobID: autoJob.DownloadJobID, CompanyID: autoJob.CompanyID, EmailConnectionID: autoJob.EmailConnectionID})
	if err != nil || !acknowledged {
		t.Fatalf("automatic acknowledged=%v err=%v", acknowledged, err)
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
	orphanJobs, err := repo.ListCommunicationsEmailThreadDownloadJobsContext(context.Background(), emailCollaborationThreadTestCompanyID, orphan.Collaboration.EmailThreadID)
	if err != nil || len(orphanJobs) != 1 {
		t.Fatalf("orphan jobs=%+v err=%v", orphanJobs, err)
	}
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{JobID: orphanJobs[0].DownloadJobID, CompanyID: orphanJobs[0].CompanyID, EmailConnectionID: orphanJobs[0].EmailConnectionID})
	if err != nil || !acknowledged {
		t.Fatalf("orphan acknowledged=%v err=%v", acknowledged, err)
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

func TestNormalizeCommunicationsEmailProviderErrorUsesExactPermanentParkingRules(t *testing.T) {
	google := domain.UserEmailConnection{Provider: "google"}
	microsoft := domain.UserEmailConnection{Provider: "microsoft"}
	tests := []struct {
		name       string
		connection domain.UserEmailConnection
		provider   error
		want       error
	}{
		{name: "unauthorized", connection: google, provider: NylasAPIError{StatusCode: 401}, want: errCommunicationsEmailConnectionReauthRequired},
		{name: "forbidden", connection: google, provider: NylasAPIError{StatusCode: 403}, want: errCommunicationsEmailConnectionReauthRequired},
		{name: "exact missing grant", connection: google, provider: NylasAPIError{StatusCode: 404, Code: "grant.not_found"}, want: errCommunicationsEmailConnectionReauthRequired},
		{name: "ordinary not found stays transient", connection: google, provider: NylasAPIError{StatusCode: 404, Code: "not_found"}},
		{name: "google precondition", connection: google, provider: NylasAPIError{StatusCode: 400, Message: "Precondition check failed for Gmail"}, want: errCommunicationsEmailConnectionConfigurationRequired},
		{name: "microsoft precondition is not google configuration", connection: microsoft, provider: NylasAPIError{StatusCode: 400, Message: "Precondition check failed"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := normalizeCommunicationsEmailProviderError(test.connection, test.provider)
			if test.want != nil {
				if !errors.Is(got, test.want) {
					t.Fatalf("normalized error=%v, want %v", got, test.want)
				}
				return
			}
			if !errors.Is(got, test.provider) {
				t.Fatalf("normalized error=%v, want original %v", got, test.provider)
			}
		})
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
	sender := &recordingEmailQueueSender{}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		EmailQueue: sender, DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)

	acknowledged, err := server.processEmailReconciliationConnection(context.Background(), emailqueue.Message{
		SchemaVersion: emailqueue.SchemaVersion, Kind: emailqueue.KindReconciliationConnection,
		CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
		ReconciliationID: "scheduled-test", ScanStartedAt: scanStarted,
		LowerBound: connection.IngestionStartedAt.Add(-time.Second),
	})
	if err != nil || !acknowledged {
		t.Fatalf("reconciliation acknowledged=%v err=%v", acknowledged, err)
	}
	if len(sender.messages) != 1 || sender.messages[0].Kind != emailqueue.KindIngestion {
		t.Fatalf("queued messages = %+v", sender.messages)
	}
	client.mu.Lock()
	query := client.lastQuery
	client.mu.Unlock()
	if query.FolderID != "scan-inbox" || query.ReceivedAfter > connection.IngestionStartedAt.Unix()-1 || query.ReceivedBefore != scanStarted.Unix() {
		t.Fatalf("scan query = %+v activation=%s scan=%s", query, connection.IngestionStartedAt, scanStarted)
	}
	updated, err := repo.GetEmailConnectionByIDContext(context.Background(), connection.CompanyID, connection.EmailConnectionID)
	if err != nil || !updated.LastSuccessfulScanAt.Equal(scanStarted) {
		t.Fatalf("scan checkpoint = %s err=%v, want %s", updated.LastSuccessfulScanAt, err, scanStarted)
	}
}

func TestEmailReconciliationRedeliveryResendsExistingAcceptedMarkerAfterSendFailure(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		CompanyID: emailCollaborationThreadTestCompanyID, UserID: owner.UserID,
		Provider: "google", AccountEmail: owner.Email, GrantID: "scan-send-retry-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	scanStarted := connection.LastSuccessfulScanAt.Add(time.Minute)
	client := &fakeNylasClient{
		folders: []NylasFolder{{ID: "scan-send-retry-inbox", SystemFolder: "inbox"}},
		messagePagesByToken: map[string]NylasMessagePage{"": {Messages: []NylasMessage{{
			ID: "scan-send-retry-message", ThreadID: "scan-send-retry-thread", Date: scanStarted.Add(-time.Second).Unix(),
		}}}},
	}
	sender := &recordingEmailQueueSender{err: errors.New("temporary SQS send failure")}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(), EmailQueue: sender,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	message := emailqueue.Message{
		SchemaVersion: emailqueue.SchemaVersion, Kind: emailqueue.KindReconciliationConnection,
		CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
		ReconciliationID: "scheduled-send-retry", ScanStartedAt: scanStarted,
		LowerBound: connection.IngestionStartedAt.Add(-time.Second),
	}

	if acknowledged, processErr := server.processEmailReconciliationConnection(context.Background(), message); processErr == nil || acknowledged {
		t.Fatalf("failed send acknowledged=%v err=%v", acknowledged, processErr)
	}
	sender.err = nil
	if acknowledged, processErr := server.processEmailReconciliationConnection(context.Background(), message); processErr != nil || !acknowledged {
		t.Fatalf("redelivery acknowledged=%v err=%v", acknowledged, processErr)
	}
	if sender.attempts != 2 || len(sender.messages) != 1 || sender.messages[0].JobID == "" {
		t.Fatalf("SQS sends attempts=%d messages=%+v", sender.attempts, sender.messages)
	}
	laterSchedule := message
	laterSchedule.ReconciliationID = "scheduled-send-retry-later"
	laterSchedule.ScanStartedAt = scanStarted.Add(10 * time.Minute)
	if acknowledged, processErr := server.processEmailReconciliationConnection(context.Background(), laterSchedule); processErr != nil || !acknowledged {
		t.Fatalf("later schedule acknowledged=%v err=%v", acknowledged, processErr)
	}
	if sender.attempts != 2 || len(sender.messages) != 1 {
		t.Fatalf("later schedule resent prior accepted marker: attempts=%d messages=%+v", sender.attempts, sender.messages)
	}
}

type recordingEmailQueueSender struct {
	messages []emailqueue.Message
	attempts int
	err      error
}

func (s *recordingEmailQueueSender) Send(_ context.Context, message emailqueue.Message) error {
	s.attempts++
	if s.err != nil {
		return s.err
	}
	s.messages = append(s.messages, message)
	return nil
}
