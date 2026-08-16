package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
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

func (r *emailParkingFailureRepo) ParkCommunicationsEmailIngestionAttemptContext(context.Context, string, string, string, string, []store.RealtimeOutboxInput) error {
	return errors.New("forced email parking status failure")
}

func (r *emailOutboxBoundaryRepo) EnqueueRealtimeOutbox(ctx context.Context, input store.RealtimeOutboxInput) (store.RealtimeOutboxEvent, error) {
	if r.recordRealtimeInputs([]store.RealtimeOutboxInput{input}) {
		return store.RealtimeOutboxEvent{}, errors.New("forced email outbox failure")
	}
	return r.Repository.EnqueueRealtimeOutbox(ctx, input)
}

func (r *emailOutboxBoundaryRepo) CompleteCommunicationsEmailIngestionAttemptContext(ctx context.Context, jobID, attemptToken string, inputs []store.RealtimeOutboxInput) error {
	if r.recordRealtimeInputs(inputs) {
		return errors.New("forced email outbox failure")
	}
	return r.Repository.CompleteCommunicationsEmailIngestionAttemptContext(ctx, jobID, attemptToken, inputs)
}

func (r *emailOutboxBoundaryRepo) recordRealtimeInputs(inputs []store.RealtimeOutboxInput) bool {
	r.mu.Lock()
	r.enqueues += len(inputs)
	r.inputs = append(r.inputs, inputs...)
	fail := r.fail
	r.mu.Unlock()
	return fail
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

func mustEnsureEmailIngestionJobForTest(
	t *testing.T,
	repo *store.MemoryRepo,
	connection domain.UserEmailConnection,
	created store.CommunicationsEmailCollaborationEnsureResult,
	providerMessageID string,
) store.CommunicationsEmailIngestionJob {
	t.Helper()
	job, _, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), store.CommunicationsEmailIngestionJobInput{
		CompanyID:         created.Collaboration.CompanyID,
		EmailConnectionID: connection.EmailConnectionID,
		EmailThreadID:     created.Collaboration.EmailThreadID,
		ProviderMessageID: providerMessageID,
		ProviderThreadID:  created.Collaboration.ProviderThreadID,
		Priority:          store.CommunicationsEmailIngestionPriorityVisible,
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailIngestionJobContext: %v", err)
	}
	return job
}

func newEmailOutboxBoundaryFixture(t *testing.T) (*store.MemoryRepo, store.CommunicationsEmailIngestionJob, *emailCollaborationThreadTestClient) {
	t.Helper()
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email, Scope: "personal", GrantID: "outbox-boundary-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	created, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{ID: "outbox-boundary-message", Subject: "Durable hint boundary", Body: "<p>selected</p>"},
	})
	if err != nil {
		t.Fatal(err)
	}
	job := mustEnsureEmailIngestionJobForTest(t, repo, connection, created, "outbox-boundary-message")
	client := newEmailCollaborationThreadTestClient()
	client.messagesByID["outbox-boundary-message"] = NylasMessage{
		ID: "outbox-boundary-message", Subject: "Durable hint boundary", Body: "<p>complete</p>", Date: time.Now().UTC().Unix(),
	}
	return repo, job, client
}

func TestEmailIngestionOutboxFailureRedeliveryRevalidatesProviderTruth(t *testing.T) {
	base, job, client := newEmailOutboxBoundaryFixture(t)
	repo := &emailOutboxBoundaryRepo{Repository: base, fail: true}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableRealtimeSpine: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	message := emailqueue.Message{JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID}

	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), message)
	if err == nil || acknowledged {
		t.Fatalf("failed durable outbox acknowledged=%v err=%v", acknowledged, err)
	}
	pendingStatus, err := base.GetCommunicationsEmailIngestionJobContext(context.Background(), job.IngestionJobID)
	if err != nil || pendingStatus.Status != store.CommunicationsEmailIngestionJobProcessing {
		t.Fatalf("rolled-back status/outbox transaction=%+v err=%v", pendingStatus, err)
	}
	thread, err := base.GetCommunicationsEmailThreadContext(context.Background(), job.CompanyID, job.EmailThreadID)
	storedMessage, stored := storedEmailMessageForProvider(thread, job.ProviderMessageID)
	if err != nil || !thread.HistoryComplete || !stored || !storedMessage.Message.DownloadComplete {
		t.Fatalf("durable provider truth=%+v err=%v", thread, err)
	}

	repo.setFail(false)
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), message)
	if err != nil || !acknowledged {
		t.Fatalf("outbox recovery acknowledged=%v err=%v", acknowledged, err)
	}
	_, _, _, messageIDs := client.calls()
	if len(messageIDs) != 2 || messageIDs[0] != "outbox-boundary-message" || messageIDs[1] != "outbox-boundary-message" {
		t.Fatalf("provider message calls=%v, want safe revalidation after unsettled completion", messageIDs)
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
	message := emailqueue.Message{JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID}

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
		JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
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
		JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
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
			created, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), store.CommunicationsEmailCollaborationEnsureInput{
				CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
				AccountEmail: owner.Email, Provider: "google", CreatedByUserID: owner.UserID,
				Message: domain.EmailMessageSnapshot{ID: test.message.ID, Subject: test.message.Subject, Body: "<p>selected</p>"},
			})
			if err != nil {
				t.Fatal(err)
			}
			job := mustEnsureEmailIngestionJobForTest(t, repo, connection, created, test.message.ID)
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
				JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
			})
			if err != nil || !acknowledged {
				t.Fatalf("permanent provider failure acknowledged=%v err=%v", acknowledged, err)
			}
			parked, err := repo.GetCommunicationsEmailIngestionJobContext(context.Background(), job.IngestionJobID)
			if err != nil || parked.Status != store.CommunicationsEmailIngestionJobParked || parked.ProviderAttemptCount != 1 {
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
		JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
	})
	if err == nil || acknowledged {
		t.Fatalf("status-write failure acknowledged=%v err=%v", acknowledged, err)
	}
	stored, err := base.GetCommunicationsEmailIngestionJobContext(context.Background(), job.IngestionJobID)
	if err != nil || stored.Status != store.CommunicationsEmailIngestionJobProcessing || stored.ProviderAttemptCount != 1 {
		t.Fatalf("unsettled job=%+v err=%v", stored, err)
	}
}

func TestCommunicationsEmailIngestionWorkerStoresThreadAttachmentsAndLaterManualMessage(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email, Scope: "personal", GrantID: "worker-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	created, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), store.CommunicationsEmailCollaborationEnsureInput{
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

	job := mustEnsureEmailIngestionJobForTest(t, repo, connection, created, "worker-root")
	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
		JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
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
	laterJob, createdJob, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), store.CommunicationsEmailIngestionJobInput{
		CompanyID: thread.CompanyID, EmailConnectionID: thread.EmailConnectionID, EmailThreadID: thread.EmailThreadID,
		ProviderMessageID: "worker-later", ProviderThreadID: thread.ProviderThreadID, Priority: store.CommunicationsEmailIngestionPriorityVisible,
	})
	if err != nil || !createdJob {
		t.Fatalf("later selected-message job created=%v err=%v", createdJob, err)
	}
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{JobID: laterJob.IngestionJobID, CompanyID: laterJob.CompanyID, EmailConnectionID: laterJob.EmailConnectionID})
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
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{JobID: laterJob.IngestionJobID, CompanyID: laterJob.CompanyID, EmailConnectionID: laterJob.EmailConnectionID})
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
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{JobID: autoJob.IngestionJobID, CompanyID: autoJob.CompanyID, EmailConnectionID: autoJob.EmailConnectionID})
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

	orphan, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{ID: "worker-orphan", Subject: "No provider thread", Body: "<p>orphan</p>"},
	})
	if err != nil {
		t.Fatal(err)
	}
	client.messagesByID["worker-orphan"] = NylasMessage{ID: "worker-orphan", Subject: "No provider thread", Body: "<p>orphan complete</p>", Date: 40}
	orphanJob := mustEnsureEmailIngestionJobForTest(t, repo, connection, orphan, "worker-orphan")
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{JobID: orphanJob.IngestionJobID, CompanyID: orphanJob.CompanyID, EmailConnectionID: orphanJob.EmailConnectionID})
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

func TestCommunicationsEmailIngestionWorkerReconcilesSentTriggerIntoExistingThread(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		CompanyID: emailCollaborationThreadTestCompanyID, UserID: owner.UserID,
		Provider: "google", AccountEmail: owner.Email, Scope: "personal", GrantID: "sent-trigger-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	baseDate := time.Now().UTC().Add(time.Second).Unix()
	providerThreadID := "sent-trigger-thread"
	stored, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", ProviderThreadID: providerThreadID, SelectedMessageID: "sent-trigger-root",
		Messages: []domain.EmailMessageSnapshot{
			{ID: "sent-trigger-root", ThreadID: providerThreadID, Date: baseDate, Folders: []string{"INBOX"}, DownloadComplete: true},
			{ID: "sent-trigger-later", ThreadID: providerThreadID, Date: baseDate + 2, Folders: []string{"INBOX"}, DownloadComplete: true},
		},
		HistoryComplete: true, FetchedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}

	client := newEmailCollaborationThreadTestClient()
	client.folders = []NylasFolder{{ID: "sent-trigger-inbox", SystemFolder: "inbox"}}
	client.threadsByID[providerThreadID] = NylasThread{
		ID: providerThreadID, MessageIDs: []string{"sent-trigger-root", "sent-trigger-sent", "sent-trigger-later", "sent-trigger-sent"},
	}
	client.messagesByID["sent-trigger-sent"] = NylasMessage{
		ID: "sent-trigger-sent", ThreadID: providerThreadID, Date: baseDate + 1,
		Subject: "Re: Sent trigger", Body: "<p>sent</p>", Folders: []string{"SENT"},
	}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableRealtimeSpine: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)

	job, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), store.CommunicationsEmailIngestionJobInput{
		CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
		ProviderMessageID: "sent-trigger-sent", ProviderThreadID: providerThreadID,
		Priority: store.CommunicationsEmailIngestionPriorityLive,
	})
	if err != nil || !created || job.EmailThreadID != "" {
		t.Fatalf("sent trigger job=%+v created=%v err=%v", job, created, err)
	}
	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
		JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
	})
	if err != nil || !acknowledged {
		t.Fatalf("sent trigger acknowledged=%v err=%v", acknowledged, err)
	}

	thread, err := repo.GetCommunicationsEmailThreadContext(context.Background(), stored.CompanyID, stored.EmailThreadID)
	if err != nil {
		t.Fatal(err)
	}
	wantIDs := []string{"sent-trigger-root", "sent-trigger-sent", "sent-trigger-later"}
	if !thread.HistoryComplete || len(thread.Messages) != len(wantIDs) {
		t.Fatalf("reconciled thread=%+v", thread)
	}
	for index, wantID := range wantIDs {
		message := thread.Messages[index]
		if message.ProviderMessageID != wantID || message.MessageOrder != index || !message.Message.DownloadComplete {
			t.Fatalf("message[%d]=%+v, want provider=%s order=%d complete", index, message, wantID, index)
		}
		if message.EmailThreadID != stored.EmailThreadID {
			t.Fatalf("message[%d] thread=%s, want %s", index, message.EmailThreadID, stored.EmailThreadID)
		}
	}
	if got := thread.Messages[1].Message.Folders; len(got) != 1 || got[0] != "SENT" {
		t.Fatalf("stored sent folders=%v", got)
	}
	completedJob, err := repo.GetCommunicationsEmailIngestionJobContext(context.Background(), job.IngestionJobID)
	if err != nil || completedJob.EmailThreadID != stored.EmailThreadID || completedJob.Status != store.CommunicationsEmailIngestionJobCompleted {
		t.Fatalf("completed sent job=%+v err=%v", completedJob, err)
	}
	threadGrants, _, _, requestedMessageIDs := client.calls()
	if len(threadGrants) != 1 || len(requestedMessageIDs) != 1 || requestedMessageIDs[0] != "sent-trigger-sent" {
		t.Fatalf("provider calls thread_grants=%v message_ids=%v", threadGrants, requestedMessageIDs)
	}
}

func TestCommunicationsEmailIngestionWorkerReconcilesMissingSentMemberFromPreviouslyStoredTrigger(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		CompanyID: emailCollaborationThreadTestCompanyID, UserID: owner.UserID,
		Provider: "google", AccountEmail: owner.Email, Scope: "personal", GrantID: "stored-trigger-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	baseDate := time.Now().UTC().Add(time.Second).Unix()
	providerThreadID := "stored-trigger-thread"
	stored, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", ProviderThreadID: providerThreadID, SelectedMessageID: "stored-trigger-root",
		Messages: []domain.EmailMessageSnapshot{
			{ID: "stored-trigger-root", ThreadID: providerThreadID, Date: baseDate, DownloadComplete: true},
			{ID: "stored-trigger-known", ThreadID: providerThreadID, Date: baseDate + 2, Folders: []string{"SENT"}, DownloadComplete: true},
		},
		HistoryComplete: true, FetchedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}

	client := newEmailCollaborationThreadTestClient()
	client.folders = []NylasFolder{{ID: "stored-trigger-inbox", SystemFolder: "inbox"}}
	client.threadsByID[providerThreadID] = NylasThread{
		ID: providerThreadID, MessageIDs: []string{"stored-trigger-root", "stored-trigger-missing-sent", "stored-trigger-known"},
	}
	client.messagesByID["stored-trigger-known"] = NylasMessage{
		ID: "stored-trigger-known", ThreadID: providerThreadID, Date: baseDate + 2, Folders: []string{"SENT"},
	}
	client.messagesByID["stored-trigger-missing-sent"] = NylasMessage{
		ID: "stored-trigger-missing-sent", ThreadID: providerThreadID, Date: baseDate + 1, Folders: []string{"SENT"},
	}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableRealtimeSpine: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)

	job, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), store.CommunicationsEmailIngestionJobInput{
		CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
		ProviderMessageID: "stored-trigger-known", ProviderThreadID: providerThreadID,
		Priority: store.CommunicationsEmailIngestionPriorityLive,
	})
	if err != nil || !created || job.EmailThreadID != "" {
		t.Fatalf("previously stored trigger job=%+v created=%v err=%v", job, created, err)
	}
	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
		JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
	})
	if err != nil || !acknowledged {
		t.Fatalf("previously stored trigger acknowledged=%v err=%v", acknowledged, err)
	}
	thread, err := repo.GetCommunicationsEmailThreadContext(context.Background(), stored.CompanyID, stored.EmailThreadID)
	if err != nil || len(thread.Messages) != 3 || thread.Messages[1].ProviderMessageID != "stored-trigger-missing-sent" {
		t.Fatalf("previously stored trigger reconciliation=%+v err=%v", thread, err)
	}
}

func TestCommunicationsEmailIngestionWorkerStoresUnknownSentThreadWithoutCrossingConnections(t *testing.T) {
	repo, owner, otherOwner, _ := newEmailCollaborationThreadTestRepo(t)
	currentConnection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		CompanyID: emailCollaborationThreadTestCompanyID, UserID: owner.UserID,
		Provider: "google", AccountEmail: owner.Email, Scope: "personal", GrantID: "current-sent-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	otherConnection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		CompanyID: emailCollaborationThreadTestCompanyID, UserID: otherOwner.UserID,
		Provider: "google", AccountEmail: otherOwner.Email, Scope: "personal", GrantID: "other-sent-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	baseDate := time.Now().UTC().Add(time.Second).Unix()
	providerThreadID := "cross-connection-sent-thread"
	otherThread, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: otherOwner.UserID, PersonalAccountEmail: otherOwner.Email,
		AccountEmail: otherOwner.Email, Provider: "google", ProviderThreadID: providerThreadID, SelectedMessageID: "cross-connection-root",
		Messages: []domain.EmailMessageSnapshot{{
			ID: "cross-connection-root", ThreadID: providerThreadID, Date: baseDate, DownloadComplete: true,
		}},
		HistoryComplete: true, FetchedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}

	client := newEmailCollaborationThreadTestClient()
	client.folders = []NylasFolder{
		{ID: "cross-connection-inbox", SystemFolder: "inbox"},
		{ID: "cross-connection-sent-folder", SystemFolder: "sent"},
	}
	client.threadsByID[providerThreadID] = NylasThread{
		ID: providerThreadID, MessageIDs: []string{"cross-connection-root", "cross-connection-sent", "cross-connection-root"},
	}
	client.messagesByID["cross-connection-root"] = NylasMessage{
		ID: "cross-connection-root", ThreadID: providerThreadID, Date: baseDate,
	}
	client.messagesByID["cross-connection-sent"] = NylasMessage{
		ID: "cross-connection-sent", ThreadID: providerThreadID, Date: baseDate + 1, FolderIDs: []string{"cross-connection-sent-folder"},
	}
	client.messagesByID["cross-connection-unrelated"] = NylasMessage{ID: "cross-connection-unrelated", Date: baseDate + 2, Folders: []string{"SENT"}}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableRealtimeSpine: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)

	job, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), store.CommunicationsEmailIngestionJobInput{
		CompanyID: currentConnection.CompanyID, EmailConnectionID: currentConnection.EmailConnectionID,
		ProviderMessageID: "cross-connection-sent", ProviderThreadID: providerThreadID,
		Priority: store.CommunicationsEmailIngestionPriorityLive,
	})
	if err != nil || !created {
		t.Fatalf("unknown sent job created=%v err=%v", created, err)
	}
	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
		JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
	})
	if err != nil || !acknowledged {
		t.Fatalf("unknown sent acknowledged=%v err=%v", acknowledged, err)
	}
	identities, err := repo.ResolveCommunicationsEmailMessageIdentitiesForConnectionContext(
		context.Background(), currentConnection.CompanyID, currentConnection.EmailConnectionID,
		[]string{"cross-connection-root", "cross-connection-sent", "cross-connection-unrelated"},
	)
	if err != nil || len(identities) != 2 || identities["cross-connection-root"].EmailThreadID == "" ||
		identities["cross-connection-root"].EmailThreadID != identities["cross-connection-sent"].EmailThreadID {
		t.Fatalf("current connection sent identities=%v err=%v", identities, err)
	}
	currentThread, err := repo.GetCommunicationsEmailThreadContext(context.Background(), currentConnection.CompanyID, identities["cross-connection-sent"].EmailThreadID)
	if err != nil || currentThread.EmailConnectionID != currentConnection.EmailConnectionID || len(currentThread.Messages) != 2 ||
		currentThread.Messages[0].ProviderMessageID != "cross-connection-root" || currentThread.Messages[1].ProviderMessageID != "cross-connection-sent" {
		t.Fatalf("current connection thread=%+v err=%v", currentThread, err)
	}
	unchangedOtherThread, err := repo.GetCommunicationsEmailThreadContext(context.Background(), otherThread.CompanyID, otherThread.EmailThreadID)
	if err != nil || len(unchangedOtherThread.Messages) != 1 || unchangedOtherThread.EmailConnectionID != otherConnection.EmailConnectionID ||
		unchangedOtherThread.EmailThreadID == currentThread.EmailThreadID {
		t.Fatalf("other connection thread changed=%+v err=%v", unchangedOtherThread, err)
	}
	completedJob, err := repo.GetCommunicationsEmailIngestionJobContext(context.Background(), job.IngestionJobID)
	if err != nil || completedJob.Status != store.CommunicationsEmailIngestionJobCompleted || completedJob.EmailThreadID != currentThread.EmailThreadID {
		t.Fatalf("unknown sent completed job=%+v err=%v", completedJob, err)
	}
	_, _, _, beforeDuplicate := client.calls()
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
		JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
	})
	if err != nil || !acknowledged {
		t.Fatalf("duplicate sent delivery acknowledged=%v err=%v", acknowledged, err)
	}
	_, _, _, afterDuplicate := client.calls()
	if len(afterDuplicate) != len(beforeDuplicate) {
		t.Fatalf("completed duplicate repeated provider work before=%v after=%v", beforeDuplicate, afterDuplicate)
	}
}

func TestCommunicationsEmailIngestionWorkerRetriesMissingSiblingAfterPartialFailure(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		CompanyID: emailCollaborationThreadTestCompanyID, UserID: owner.UserID,
		Provider: "google", AccountEmail: owner.Email, Scope: "personal", GrantID: "sent-retry-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	baseDate := time.Now().UTC().Add(time.Second).Unix()
	const providerThreadID = "sent-retry-thread"
	stored, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", ProviderThreadID: providerThreadID, SelectedMessageID: "sent-retry-trigger",
		Messages: []domain.EmailMessageSnapshot{{
			ID: "sent-retry-trigger", ThreadID: providerThreadID, Date: baseDate, Folders: []string{"SENT"}, DownloadComplete: true,
		}},
		HistoryComplete: true, FetchedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}

	client := newEmailCollaborationThreadTestClient()
	client.folders = []NylasFolder{{ID: "sent-retry-inbox", SystemFolder: "inbox"}, {ID: "sent-retry-sent", SystemFolder: "sent"}}
	client.threadsByID[providerThreadID] = NylasThread{ID: providerThreadID, MessageIDs: []string{"sent-retry-trigger", "sent-retry-missing"}}
	client.messagesByID["sent-retry-trigger"] = NylasMessage{
		ID: "sent-retry-trigger", ThreadID: providerThreadID, Date: baseDate, FolderIDs: []string{"sent-retry-sent"},
	}
	client.messagesByID["sent-retry-missing"] = NylasMessage{
		ID: "sent-retry-missing", ThreadID: providerThreadID, Date: baseDate + 1, Folders: []string{"INBOX"},
	}
	client.messageErrorsByID["sent-retry-missing"] = errors.New("temporary sibling fetch failure")
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableRealtimeSpine: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)

	job, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), store.CommunicationsEmailIngestionJobInput{
		CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
		ProviderMessageID: "sent-retry-trigger", ProviderThreadID: providerThreadID,
		Priority: store.CommunicationsEmailIngestionPriorityLive,
	})
	if err != nil || !created {
		t.Fatalf("retry job created=%v err=%v", created, err)
	}
	delivery := emailqueue.Message{JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID}
	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), delivery)
	if err == nil || acknowledged {
		t.Fatalf("partial failure acknowledged=%v err=%v", acknowledged, err)
	}
	failedJob, err := repo.GetCommunicationsEmailIngestionJobContext(context.Background(), job.IngestionJobID)
	if err != nil || failedJob.Status != store.CommunicationsEmailIngestionJobAccepted || failedJob.EmailThreadID != stored.EmailThreadID {
		t.Fatalf("retryable attached job=%+v err=%v", failedJob, err)
	}
	partial, err := repo.GetCommunicationsEmailThreadContext(context.Background(), stored.CompanyID, stored.EmailThreadID)
	if err != nil || len(partial.Messages) != 1 {
		t.Fatalf("partial thread=%+v err=%v", partial, err)
	}
	delete(client.messageErrorsByID, "sent-retry-missing")
	acknowledged, err = server.processEmailIngestionDelivery(context.Background(), delivery)
	if err != nil || !acknowledged {
		t.Fatalf("retry acknowledged=%v err=%v", acknowledged, err)
	}
	completed, err := repo.GetCommunicationsEmailThreadContext(context.Background(), stored.CompanyID, stored.EmailThreadID)
	if err != nil || len(completed.Messages) != 2 || completed.Messages[1].ProviderMessageID != "sent-retry-missing" ||
		!completed.Messages[1].Message.DownloadComplete {
		t.Fatalf("completed retry thread=%+v err=%v", completed, err)
	}
	completedJob, err := repo.GetCommunicationsEmailIngestionJobContext(context.Background(), job.IngestionJobID)
	if err != nil || completedJob.Status != store.CommunicationsEmailIngestionJobCompleted || completedJob.ProviderAttemptCount != 2 {
		t.Fatalf("completed retry job=%+v err=%v", completedJob, err)
	}
}

func TestCommunicationsEmailIngestionWorkerUpgradesBlankProviderThreadWithoutForking(t *testing.T) {
	for _, test := range []struct {
		name      string
		storedID  string
		triggerID string
	}{
		{name: "stored trigger", storedID: "blank-thread-trigger", triggerID: "blank-thread-trigger"},
		{name: "stored sibling", storedID: "blank-thread-sibling", triggerID: "blank-thread-new-sent"},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
			connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
				CompanyID: emailCollaborationThreadTestCompanyID, UserID: owner.UserID,
				Provider: "google", AccountEmail: owner.Email, Scope: "personal", GrantID: "blank-thread-grant-" + test.name, Status: "connected",
			})
			if err != nil {
				t.Fatal(err)
			}
			baseDate := time.Now().UTC().Add(time.Second).Unix()
			stored, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
				CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
				AccountEmail: owner.Email, Provider: "google", SelectedMessageID: test.storedID,
				Messages:        []domain.EmailMessageSnapshot{{ID: test.storedID, Date: baseDate, DownloadComplete: true}},
				HistoryComplete: true, FetchedAt: time.Now().UTC(),
			})
			if err != nil {
				t.Fatal(err)
			}
			storedMessageID := stored.Messages[0].EmailMessageID
			const providerThreadID = "upgraded-provider-thread"
			otherID := "blank-thread-new-member"
			if test.triggerID != test.storedID {
				otherID = test.storedID
			}
			client := newEmailCollaborationThreadTestClient()
			client.folders = []NylasFolder{{ID: "blank-thread-inbox", SystemFolder: "inbox"}, {ID: "blank-thread-sent", SystemFolder: "sent"}}
			client.threadsByID[providerThreadID] = NylasThread{ID: providerThreadID, MessageIDs: []string{test.storedID, test.triggerID, otherID}}
			client.messagesByID[test.triggerID] = NylasMessage{
				ID: test.triggerID, ThreadID: providerThreadID, Date: baseDate + 1, FolderIDs: []string{"blank-thread-sent"},
			}
			client.messagesByID[otherID] = NylasMessage{ID: otherID, ThreadID: providerThreadID, Date: baseDate + 2, Folders: []string{"INBOX"}}
			server := NewServerWithOptions(repo, ServerOptions{
				NylasClient: client, NylasConfig: testNylasConfig(),
				DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableRealtimeSpine: true,
			})
			defer server.Close()
			server.nylasGate = newNylasRequestGate(0)
			job, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), store.CommunicationsEmailIngestionJobInput{
				CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
				ProviderMessageID: test.triggerID, ProviderThreadID: providerThreadID, Priority: store.CommunicationsEmailIngestionPriorityLive,
			})
			if err != nil || !created {
				t.Fatalf("blank provider job created=%v err=%v", created, err)
			}
			acknowledged, err := server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
				JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
			})
			if err != nil || !acknowledged {
				t.Fatalf("blank provider delivery acknowledged=%v err=%v", acknowledged, err)
			}
			identities, err := repo.ResolveCommunicationsEmailMessageIdentitiesForConnectionContext(
				context.Background(), connection.CompanyID, connection.EmailConnectionID, []string{test.storedID, test.triggerID, otherID},
			)
			if err != nil {
				t.Fatal(err)
			}
			for providerMessageID, identity := range identities {
				if identity.EmailThreadID != stored.EmailThreadID {
					t.Fatalf("identity %s forked to %s, want %s", providerMessageID, identity.EmailThreadID, stored.EmailThreadID)
				}
			}
			upgraded, err := repo.GetCommunicationsEmailThreadContext(context.Background(), stored.CompanyID, stored.EmailThreadID)
			if err != nil || upgraded.ProviderThreadID != providerThreadID || len(upgraded.Messages) != len(identities) {
				t.Fatalf("upgraded thread=%+v identities=%v err=%v", upgraded, identities, err)
			}
			if identity := identities[test.storedID]; identity.EmailMessageID != storedMessageID {
				t.Fatalf("stored message ID changed=%+v, want %s", identity, storedMessageID)
			}
		})
	}
}

func TestCommunicationsEmailIngestionWorkerRejectsUnknownNonInboxOrSentTriggers(t *testing.T) {
	for _, folder := range []string{"ARCHIVE", "DRAFT", "TRASH"} {
		t.Run(strings.ToLower(folder), func(t *testing.T) {
			repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
			connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
				CompanyID: emailCollaborationThreadTestCompanyID, UserID: owner.UserID,
				Provider: "google", AccountEmail: owner.Email, Scope: "personal", GrantID: "noneligible-" + strings.ToLower(folder), Status: "connected",
			})
			if err != nil {
				t.Fatal(err)
			}
			messageID := "noneligible-" + strings.ToLower(folder)
			client := newEmailCollaborationThreadTestClient()
			client.folders = []NylasFolder{{ID: "noneligible-inbox", SystemFolder: "inbox"}, {ID: "noneligible-sent", SystemFolder: "sent"}}
			client.messagesByID[messageID] = NylasMessage{
				ID: messageID, ThreadID: "noneligible-thread", Date: time.Now().UTC().Add(time.Second).Unix(), Folders: []string{folder},
			}
			server := NewServerWithOptions(repo, ServerOptions{
				NylasClient: client, NylasConfig: testNylasConfig(),
				DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableRealtimeSpine: true,
			})
			defer server.Close()
			server.nylasGate = newNylasRequestGate(0)
			job, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), store.CommunicationsEmailIngestionJobInput{
				CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
				ProviderMessageID: messageID, ProviderThreadID: "noneligible-thread", Priority: store.CommunicationsEmailIngestionPriorityLive,
			})
			if err != nil || !created {
				t.Fatalf("noneligible job created=%v err=%v", created, err)
			}
			acknowledged, err := server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
				JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
			})
			if err != nil || !acknowledged {
				t.Fatalf("noneligible delivery acknowledged=%v err=%v", acknowledged, err)
			}
			completed, err := repo.GetCommunicationsEmailIngestionJobContext(context.Background(), job.IngestionJobID)
			if err != nil || completed.EmailThreadID != "" || completed.Status != store.CommunicationsEmailIngestionJobCompleted {
				t.Fatalf("noneligible completed job=%+v err=%v", completed, err)
			}
			threadGrants, _, _, _ := client.calls()
			if len(threadGrants) != 0 {
				t.Fatalf("noneligible trigger fetched provider thread grants=%v", threadGrants)
			}
			if folder == "DRAFT" {
				updated := client.messagesByID[messageID]
				updated.Folders = []string{"SENT"}
				client.messagesByID[messageID] = updated
				client.threadsByID[updated.ThreadID] = NylasThread{ID: updated.ThreadID, MessageIDs: []string{messageID}}
				reopened, reopenedForQueue, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), store.CommunicationsEmailIngestionJobInput{
					CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
					ProviderMessageID: messageID, ProviderThreadID: updated.ThreadID,
					Priority: store.CommunicationsEmailIngestionPriorityLive, EnqueueSourceID: "webhook:sent-update",
				})
				if err != nil || !reopenedForQueue || reopened.IngestionJobID != job.IngestionJobID ||
					reopened.Status != store.CommunicationsEmailIngestionJobAccepted || reopened.ProviderAttemptCount != 0 {
					t.Fatalf("sent transition reopened job=%+v queue=%v err=%v", reopened, reopenedForQueue, err)
				}
				acknowledged, err = server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
					JobID: reopened.IngestionJobID, CompanyID: reopened.CompanyID, EmailConnectionID: reopened.EmailConnectionID,
				})
				if err != nil || !acknowledged {
					t.Fatalf("sent transition acknowledged=%v err=%v", acknowledged, err)
				}
				storedJob, err := repo.GetCommunicationsEmailIngestionJobContext(context.Background(), job.IngestionJobID)
				if err != nil || storedJob.Status != store.CommunicationsEmailIngestionJobCompleted || storedJob.EmailThreadID == "" ||
					storedJob.ProviderAttemptCount != 1 {
					t.Fatalf("sent transition completed job=%+v err=%v", storedJob, err)
				}
				storedThread, err := repo.GetCommunicationsEmailThreadContext(context.Background(), connection.CompanyID, storedJob.EmailThreadID)
				if err != nil || len(storedThread.Messages) != 1 || storedThread.Messages[0].ProviderMessageID != messageID {
					t.Fatalf("sent transition durable thread=%+v err=%v", storedThread, err)
				}
			}
		})
	}
}

func TestCommunicationsEmailIngestionWorkerPreservesCompleteMangoSentAttachment(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		CompanyID: emailCollaborationThreadTestCompanyID, UserID: owner.UserID,
		Provider: "google", AccountEmail: owner.Email, Scope: "personal", GrantID: "sent-attachment-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	baseDate := time.Now().UTC().Add(time.Second).Unix()
	const providerThreadID = "sent-attachment-thread"
	attachmentID := store.NewUUIDv7String()
	thread, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: connection.CompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", ProviderThreadID: providerThreadID, SelectedMessageID: "sent-attachment-root",
		Messages: []domain.EmailMessageSnapshot{
			{ID: "sent-attachment-root", ThreadID: providerThreadID, Date: baseDate, DownloadComplete: true},
			{
				ID: "sent-attachment-trigger", ThreadID: providerThreadID, Date: baseDate + 1, Folders: []string{"SENT"}, DownloadComplete: true,
				Attachments: []domain.EmailAttachmentSnapshot{{ID: "provider-sent-file", AttachmentID: attachmentID, Filename: "sent.txt", ContentType: "text/plain"}},
			},
		},
		HistoryComplete: true, FetchedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	sentMessage, ok := storedEmailMessageForProvider(thread, "sent-attachment-trigger")
	if !ok {
		t.Fatal("stored sent attachment message missing")
	}
	storage := newFakeAttachmentObjectStorage()
	body := []byte("sent attachment")
	storageKey := attachmentOriginalObjectKey(connection.CompanyID, attachmentID)
	storage.objects[storageKey] = fakeAttachmentObject{contentType: "text/plain", body: body}
	digest := sha256.Sum256(body)
	if _, _, err := repo.CreateAttachmentWithResourceLink(store.AttachmentCreateInput{
		CompanyID: connection.CompanyID, AttachmentID: attachmentID, UploadedByUserID: owner.UserID,
		OriginalFilename: "sent.txt", MimeType: "text/plain", ByteSize: int64(len(body)), SHA256: fmt.Sprintf("%x", digest[:]),
		SHA256VerificationMethod: "server_stream", StorageBucket: storage.bucket, StorageKey: storageKey, SourceKind: store.AttachmentSourceEmailOutgoing,
		ResourceLink: store.ResourceAttachmentInput{
			CompanyID: connection.CompanyID, ResourceType: "email_message", ResourceID: sentMessage.EmailMessageID,
			AttachmentID: attachmentID, RelationshipKind: store.AttachmentRelationshipEmailAttachment, CreatedByUserID: owner.UserID,
		},
	}); err != nil {
		t.Fatal(err)
	}
	redundantAttachmentID := store.ImportedEmailAttachmentID(
		connection.CompanyID, thread.EmailThreadID, "sent-attachment-trigger", "provider-sent-file", "", "sent.txt",
	)
	redundantBody := []byte("interrupted worker duplicate")
	redundantStorageKey := attachmentOriginalObjectKey(connection.CompanyID, redundantAttachmentID)
	storage.objects[redundantStorageKey] = fakeAttachmentObject{contentType: "text/plain", body: redundantBody}
	redundantDigest := sha256.Sum256(redundantBody)
	if _, _, err := repo.CreateAttachmentWithResourceLink(store.AttachmentCreateInput{
		CompanyID: connection.CompanyID, AttachmentID: redundantAttachmentID, UploadedByUserID: owner.UserID,
		OriginalFilename: "sent.txt", MimeType: "text/plain", ByteSize: int64(len(redundantBody)), SHA256: fmt.Sprintf("%x", redundantDigest[:]),
		SHA256VerificationMethod: "server_stream", StorageBucket: storage.bucket, StorageKey: redundantStorageKey, SourceKind: store.AttachmentSourceEmailIncoming,
		ResourceLink: store.ResourceAttachmentInput{
			CompanyID: connection.CompanyID, ResourceType: "email_message", ResourceID: sentMessage.EmailMessageID,
			AttachmentID: redundantAttachmentID, RelationshipKind: store.AttachmentRelationshipEmailAttachment, CreatedByUserID: owner.UserID,
		},
	}); err != nil {
		t.Fatal(err)
	}

	client := newEmailCollaborationThreadTestClient()
	client.folders = []NylasFolder{{ID: "sent-attachment-inbox", SystemFolder: "inbox"}, {ID: "sent-attachment-sent", SystemFolder: "sent"}}
	client.threadsByID[providerThreadID] = NylasThread{
		ID: providerThreadID, MessageIDs: []string{"sent-attachment-root", "sent-attachment-trigger", "sent-attachment-sibling"},
	}
	client.messagesByID["sent-attachment-trigger"] = NylasMessage{
		ID: "sent-attachment-trigger", ThreadID: providerThreadID, Date: baseDate + 1, FolderIDs: []string{"sent-attachment-sent"},
		Attachments: []NylasAttachment{{ID: "provider-sent-file", Filename: "sent.txt", ContentType: "text/plain"}},
	}
	client.messagesByID["sent-attachment-sibling"] = NylasMessage{
		ID: "sent-attachment-sibling", ThreadID: providerThreadID, Date: baseDate + 2, FolderIDs: []string{"sent-attachment-inbox"},
	}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(), AttachmentStorage: storage,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableRealtimeSpine: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	job, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), store.CommunicationsEmailIngestionJobInput{
		CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
		ProviderMessageID: "sent-attachment-trigger", ProviderThreadID: providerThreadID, Priority: store.CommunicationsEmailIngestionPriorityLive,
	})
	if err != nil || !created {
		t.Fatalf("sent attachment job created=%v err=%v", created, err)
	}
	acknowledged, err := server.processEmailIngestionDelivery(context.Background(), emailqueue.Message{
		JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID,
	})
	if err != nil || !acknowledged {
		t.Fatalf("sent attachment delivery acknowledged=%v err=%v", acknowledged, err)
	}
	completed, err := repo.GetCommunicationsEmailThreadContext(context.Background(), thread.CompanyID, thread.EmailThreadID)
	if err != nil || len(completed.Messages) != 3 {
		t.Fatalf("completed sent attachment thread=%+v err=%v", completed, err)
	}
	preserved, ok := storedEmailMessageForProvider(completed, "sent-attachment-trigger")
	if !ok || !preserved.Message.DownloadComplete || len(preserved.Message.Attachments) != 1 || preserved.Message.Attachments[0].AttachmentID != attachmentID {
		t.Fatalf("preserved sent attachment message=%+v present=%v", preserved, ok)
	}
	links, err := repo.ListResourceAttachments(connection.CompanyID, "email_message", sentMessage.EmailMessageID)
	if err != nil || len(links) != 1 || links[0].AttachmentID != attachmentID {
		t.Fatalf("sent attachment links=%+v err=%v", links, err)
	}
	if _, err := repo.GetAttachment(connection.CompanyID, redundantAttachmentID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("interrupted worker duplicate remains live: %v", err)
	}
	client.mu.Lock()
	downloadedAttachmentID := client.lastDownloadAttachmentID
	client.mu.Unlock()
	if downloadedAttachmentID != "" {
		t.Fatalf("complete Mango sent attachment was downloaded again: %s", downloadedAttachmentID)
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
		folders: []NylasFolder{{ID: "scan-inbox", SystemFolder: "inbox"}, {ID: "scan-sent", SystemFolder: "sent"}},
		messagePagesByToken: map[string]NylasMessagePage{
			"": {Messages: []NylasMessage{
				{ID: "scan-old", ThreadID: "scan-old-thread", Date: connection.IngestionStartedAt.Add(-time.Minute).Unix(), FolderIDs: []string{"scan-inbox"}},
				{ID: "scan-new-inbox", ThreadID: "scan-new-inbox-thread", Date: scanStarted.Add(-time.Second).Unix(), FolderIDs: []string{"scan-inbox"}},
				{ID: "scan-new-sent", ThreadID: "scan-new-sent-thread", Date: scanStarted.Add(-time.Second).Unix(), FolderIDs: []string{"scan-sent"}},
				{ID: "scan-new-archive", ThreadID: "scan-new-archive-thread", Date: scanStarted.Add(-time.Second).Unix(), Folders: []string{"ARCHIVE"}},
			}},
		},
	}
	previouslySkipped, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), store.CommunicationsEmailIngestionJobInput{
		CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
		ProviderMessageID: "scan-new-sent", ProviderThreadID: "scan-new-sent-thread",
		Priority: store.CommunicationsEmailIngestionPriorityLive, EnqueueSourceID: "webhook:before-sent",
	})
	if err != nil || !created {
		t.Fatalf("seed skipped sent job created=%v err=%v", created, err)
	}
	previousAttempt, started, err := repo.StartCommunicationsEmailIngestionAttemptContext(context.Background(), previouslySkipped.IngestionJobID)
	if err != nil || !started {
		t.Fatalf("seed skipped sent attempt started=%v err=%v", started, err)
	}
	if err := repo.CompleteCommunicationsEmailIngestionAttemptContext(
		context.Background(), previouslySkipped.IngestionJobID, previousAttempt.AttemptToken, nil,
	); err != nil {
		t.Fatal(err)
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
	if len(sender.messages) != 2 || sender.messages[0].Kind != emailqueue.KindIngestion || sender.messages[1].Kind != emailqueue.KindIngestion {
		t.Fatalf("queued messages = %+v", sender.messages)
	}
	if sender.messages[1].JobID != previouslySkipped.IngestionJobID {
		t.Fatalf("Sent repair created a replacement job: queued=%+v previous=%s", sender.messages[1], previouslySkipped.IngestionJobID)
	}
	if sender.messages[1].EnqueueSourceID != "reconciliation:scheduled-test" {
		t.Fatalf("Sent repair queue generation = %q", sender.messages[1].EnqueueSourceID)
	}
	priorDelivery := sender.messages[1]
	priorDelivery.EnqueueSourceID = "webhook:before-sent"
	if sender.messages[1].DeduplicationID() == priorDelivery.DeduplicationID() {
		t.Fatal("Sent repair reused the skipped delivery's FIFO deduplication ID")
	}
	client.mu.Lock()
	query := client.lastQuery
	client.mu.Unlock()
	if query.FolderID != "" || query.ReceivedAfter > connection.IngestionStartedAt.Unix()-1 || query.ReceivedBefore != scanStarted.Unix() {
		t.Fatalf("scan query = %+v activation=%s scan=%s", query, connection.IngestionStartedAt, scanStarted)
	}
	updated, err := repo.GetEmailConnectionByIDContext(context.Background(), connection.CompanyID, connection.EmailConnectionID)
	if err != nil || !updated.LastSuccessfulScanAt.Equal(scanStarted) {
		t.Fatalf("scan checkpoint = %s err=%v, want %s", updated.LastSuccessfulScanAt, err, scanStarted)
	}
}

func TestEmailReconciliationRetriesOnlyTheExactOriginalDiscoverySource(t *testing.T) {
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
			ID: "scan-send-retry-message", ThreadID: "scan-send-retry-thread", Date: scanStarted.Add(-time.Second).Unix(), FolderIDs: []string{"scan-send-retry-inbox"},
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
	job, err := repo.GetCommunicationsEmailIngestionJobContext(context.Background(), sender.messages[0].JobID)
	if err != nil || job.EnqueueSourceID != "reconciliation:"+message.ReconciliationID || job.SQSAcceptedTimestamp == nil {
		t.Fatalf("exact source retry job=%+v err=%v", job, err)
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

func TestEmailReconciliationDoesNotResendActiveDurableOrTerminalJobs(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		CompanyID: emailCollaborationThreadTestCompanyID, UserID: owner.UserID,
		Provider: "google", AccountEmail: owner.Email, GrantID: "existing-jobs-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	archiveJob, err := repo.CreateCommunicationsArchiveJobContext(context.Background(), store.CommunicationsArchiveJobInput{
		ActorUserID: owner.UserID, CompanyID: connection.CompanyID, Connection: connection,
		MessageIDs: []string{"existing-archive-message"},
	})
	if err != nil {
		t.Fatal(err)
	}
	statuses := []string{"accepted", "accepted-recorded", "processing", "completed", "parked", "exhausted"}
	providerMessages := make([]NylasMessage, 0, len(statuses))
	scanStarted := time.Now().UTC().Add(time.Minute)
	for _, status := range statuses {
		providerMessageID := "existing-" + status
		providerMessages = append(providerMessages, NylasMessage{
			ID: providerMessageID, ThreadID: "thread-" + status, Date: scanStarted.Add(-time.Second).Unix(), FolderIDs: []string{"existing-jobs-inbox"},
		})
		jobInput := store.CommunicationsEmailIngestionJobInput{
			CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
			ProviderMessageID: providerMessageID, ProviderThreadID: "thread-" + status,
			Priority: store.CommunicationsEmailIngestionPriorityScan,
		}
		if status == "completed" {
			stored, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
				CompanyID: connection.CompanyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
				AccountEmail: owner.Email, Provider: "google", ProviderThreadID: jobInput.ProviderThreadID,
				SelectedMessageID: providerMessageID, Messages: []domain.EmailMessageSnapshot{{
					ID: providerMessageID, ThreadID: jobInput.ProviderThreadID, DownloadComplete: true,
				}}, HistoryComplete: true,
			})
			if err != nil {
				t.Fatal(err)
			}
			jobInput.EmailThreadID = stored.EmailThreadID
		}
		job, created, ensureErr := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), jobInput)
		if ensureErr != nil || !created {
			t.Fatalf("ensure %s created=%v err=%v", status, created, ensureErr)
		}
		switch status {
		case "accepted-recorded":
			if err := repo.MarkCommunicationsEmailIngestionJobSQSAcceptedContext(context.Background(), job.IngestionJobID); err != nil {
				t.Fatal(err)
			}
		case "processing":
			if _, started, err := repo.StartCommunicationsEmailIngestionAttemptContext(context.Background(), job.IngestionJobID); err != nil || !started {
				t.Fatalf("start processing job started=%v err=%v", started, err)
			}
		case "completed":
			started, ok, err := repo.StartCommunicationsEmailIngestionAttemptContext(context.Background(), job.IngestionJobID)
			if err != nil || !ok {
				t.Fatalf("start completed job started=%v err=%v", ok, err)
			}
			if err := repo.CompleteCommunicationsEmailIngestionAttemptContext(context.Background(), job.IngestionJobID, started.AttemptToken, nil); err != nil {
				t.Fatal(err)
			}
		case "parked":
			started, ok, err := repo.StartCommunicationsEmailIngestionAttemptContext(context.Background(), job.IngestionJobID)
			if err != nil || !ok {
				t.Fatalf("start parked job started=%v err=%v", ok, err)
			}
			if err := repo.ParkCommunicationsEmailIngestionAttemptContext(context.Background(), job.IngestionJobID, started.AttemptToken, "reauth_required", "provider_auth", nil); err != nil {
				t.Fatal(err)
			}
			connection, err = repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
				CompanyID: connection.CompanyID, UserID: owner.UserID, Provider: "google",
				AccountEmail: owner.Email, GrantID: "existing-jobs-grant", Status: "connected",
			})
			if err != nil {
				t.Fatal(err)
			}
		case "exhausted":
			for attempt := 1; attempt <= store.CommunicationsEmailProviderAttemptLimit; attempt++ {
				started, ok, err := repo.StartCommunicationsEmailIngestionAttemptContext(context.Background(), job.IngestionJobID)
				if err != nil || !ok {
					t.Fatalf("start exhausted job attempt=%d started=%v err=%v", attempt, ok, err)
				}
				if err := repo.FailCommunicationsEmailIngestionAttemptContext(context.Background(), job.IngestionJobID, started.AttemptToken, "temporary_provider_failure", nil); err != nil {
					t.Fatal(err)
				}
			}
			if fourth, started, err := repo.StartCommunicationsEmailIngestionAttemptContext(context.Background(), job.IngestionJobID); err != nil || started || fourth.ProviderAttemptCount != store.CommunicationsEmailProviderAttemptLimit {
				t.Fatalf("provider attempt 4 was not refused: job=%+v started=%v err=%v", fourth, started, err)
			}
		}
	}
	client := &fakeNylasClient{
		folders:             []NylasFolder{{ID: "existing-jobs-inbox", SystemFolder: "inbox"}},
		messagePagesByToken: map[string]NylasMessagePage{"": {Messages: providerMessages}},
	}
	sender := &recordingEmailQueueSender{}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(), EmailQueue: sender,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	message := emailqueue.Message{
		SchemaVersion: emailqueue.SchemaVersion, Kind: emailqueue.KindReconciliationConnection,
		CompanyID: connection.CompanyID, EmailConnectionID: connection.EmailConnectionID,
		ReconciliationID: "existing-jobs-must-not-resend", ScanStartedAt: scanStarted,
		LowerBound: connection.IngestionStartedAt.Add(-time.Second),
	}
	if acknowledged, processErr := server.processEmailReconciliationConnection(context.Background(), message); processErr != nil || !acknowledged {
		t.Fatalf("recovery acknowledged=%v err=%v", acknowledged, processErr)
	}
	if sender.attempts != 0 || len(sender.messages) != 0 {
		t.Fatalf("reconciliation resent existing jobs: attempts=%d messages=%+v", sender.attempts, sender.messages)
	}
	if len(archiveJob.Items) != 1 || archiveJob.Items[0].Status != store.CommunicationsArchiveJobItemStatusPending {
		t.Fatalf("archive item changed during reconciliation: %+v", archiveJob.Items)
	}
	later := message
	later.ScanStartedAt = scanStarted.Add(10 * time.Minute)
	later.ReconciliationID = "do-not-resurrect-dlq-or-terminal-work"
	if acknowledged, processErr := server.processEmailReconciliationConnection(context.Background(), later); processErr != nil || !acknowledged {
		t.Fatalf("later reconciliation acknowledged=%v err=%v", acknowledged, processErr)
	}
	if sender.attempts != 0 || len(sender.messages) != 0 {
		t.Fatalf("later reconciliation resurrected existing work: attempts=%d messages=%+v", sender.attempts, sender.messages)
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
