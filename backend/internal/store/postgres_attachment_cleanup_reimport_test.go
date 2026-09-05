package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"miraeopus/backend/internal/attachmentcleanup"
	"miraeopus/backend/internal/domain"
)

type reimportCleanupStorage struct {
	mu            sync.Mutex
	objects       map[string]string
	deleteCalls   int
	deleteEntered chan struct{}
	releaseDelete chan struct{}
}

func (*reimportCleanupStorage) Bucket() string { return "disposable-cleanup-bucket" }

func (s *reimportCleanupStorage) DeleteObject(ctx context.Context, key string) error {
	s.mu.Lock()
	s.deleteCalls++
	first := s.deleteCalls == 1
	s.mu.Unlock()
	if first && s.deleteEntered != nil {
		close(s.deleteEntered)
		select {
		case <-s.releaseDelete:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.objects[key]; !exists {
		return attachmentcleanup.ErrObjectNotFound
	}
	delete(s.objects, key)
	return nil
}

func (s *reimportCleanupStorage) put(key, body string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.objects[key] = body
}

func (s *reimportCleanupStorage) state(key string) (string, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.objects[key], s.deleteCalls
}

// Called only from the guarded disposable-database lifecycle fixture.
func testPostgresAttachmentCleanupReimport(t *testing.T, db *sql.DB, repo *PostgresRepo, companyID, actorID string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	account := "cleanup-reimport@example.test"
	if _, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		CompanyID: companyID, UserID: actorID, Provider: "google", AccountEmail: account, GrantID: "disposable-reimport-grant",
	}); err != nil {
		t.Fatal(err)
	}
	thread, err := repo.UpsertCommunicationsEmailThreadContext(ctx, CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: actorID, PersonalAccountEmail: account, AccountEmail: account,
		Provider: "google", ProviderThreadID: "reimport-thread", SelectedMessageID: "reimport-message",
		Messages: []domain.EmailMessageSnapshot{{ID: "reimport-message", ThreadID: "reimport-thread", Subject: "Cleanup reimport"}},
	})
	if err != nil || len(thread.Messages) != 1 {
		t.Fatalf("create reimport email owner: messages=%d err=%v", len(thread.Messages), err)
	}
	emailMessageID := thread.Messages[0].EmailMessageID
	newInput := func(label string, storage *reimportCleanupStorage) AttachmentCreateInput {
		id := ImportedEmailAttachmentID(companyID, thread.EmailThreadID, "reimport-message", label, "", label+".txt")
		return AttachmentCreateInput{
			CompanyID: companyID, AttachmentID: id, UploadedByUserID: actorID,
			OriginalFilename: label + ".txt", MimeType: "text/plain", ByteSize: 3, SHA256: strings.Repeat("a", 64),
			StorageBucket: storage.Bucket(), StorageKey: "companies/" + companyID + "/attachments/" + id + "/original",
			SourceKind: AttachmentSourceEmailIncoming, SourceProvider: "google",
			ResourceLink: ResourceAttachmentInput{
				CompanyID: companyID, ResourceType: "email_message", ResourceID: emailMessageID,
				RelationshipKind: AttachmentRelationshipEmailAttachment, CreatedByUserID: actorID,
			},
		}
	}
	retire := func(t *testing.T, input AttachmentCreateInput) {
		t.Helper()
		if err := repo.SoftDeleteResourceAttachment(ResourceAttachmentDeleteInput{
			CompanyID: companyID, ResourceType: "email_message", ResourceID: emailMessageID, AttachmentID: input.AttachmentID,
		}); err != nil {
			t.Fatal(err)
		}
	}
	itemFor := func(input AttachmentCreateInput) attachmentcleanup.WorkItem {
		return attachmentcleanup.WorkItem{Kind: attachmentcleanup.WorkOrphanAttachment, CompanyID: companyID, AttachmentID: input.AttachmentID}
	}

	t.Run("pending reimport does not overwrite bytes", func(t *testing.T) {
		storage := &reimportCleanupStorage{objects: map[string]string{}}
		input := newInput("pending-reimport", storage)
		if _, _, err := repo.CreateAttachmentWithResourceLinkContext(ctx, input); err != nil {
			t.Fatal(err)
		}
		storage.put(input.StorageKey, "old")
		retire(t, input)
		puts := 0
		input.StoreObject = func(context.Context) error {
			puts++
			storage.put(input.StorageKey, "replacement")
			return nil
		}
		if _, _, err := repo.CreateAttachmentWithResourceLinkContext(ctx, input); !errors.Is(err, ErrNotFound) || puts != 0 {
			t.Fatalf("pending reimport puts=%d err=%v", puts, err)
		}
		if body, _ := storage.state(input.StorageKey); body != "old" {
			t.Fatalf("pending import overwrote bytes: %q", body)
		}
		result := (attachmentcleanup.Service{Repository: repo, Storage: storage}).RunItem(ctx, itemFor(input), true)
		if result.Err != nil || !result.Finalized {
			t.Fatalf("pending original failed cleanup: %+v", result)
		}
	})

	t.Run("reimport and duplicate cleaner cannot race old object deletion", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		var workers sync.WaitGroup
		storage := &reimportCleanupStorage{
			objects: map[string]string{}, deleteEntered: make(chan struct{}), releaseDelete: make(chan struct{}),
		}
		var releaseOnce sync.Once
		release := func() { releaseOnce.Do(func() { close(storage.releaseDelete) }) }
		defer func() {
			cancel()
			release()
			workers.Wait()
		}()
		input := newInput("concurrent-reimport", storage)
		if _, _, err := repo.CreateAttachmentWithResourceLinkContext(ctx, input); err != nil {
			t.Fatal(err)
		}
		storage.put(input.StorageKey, "old")
		retire(t, input)
		item := itemFor(input)
		service := attachmentcleanup.Service{Repository: repo, Storage: storage}
		firstDone := make(chan attachmentcleanup.ItemResult, 1)
		workers.Add(1)
		go func() {
			defer workers.Done()
			firstDone <- service.RunItem(ctx, item, true)
		}()
		select {
		case <-storage.deleteEntered:
		case <-ctx.Done():
			t.Fatal("first cleanup never reached storage deletion")
		}
		putEntered := make(chan struct{}, 1)
		input.StoreObject = func(callCtx context.Context) error {
			var oldRows int
			if err := db.QueryRowContext(callCtx, "select count(*) from attachments where company_id=$1::uuid and attachment_id=$2::uuid", companyID, input.AttachmentID).Scan(&oldRows); err != nil {
				return err
			}
			if oldRows != 0 {
				return fmt.Errorf("replacement upload started before old attachment finalization: rows=%d", oldRows)
			}
			putEntered <- struct{}{}
			storage.put(input.StorageKey, "replacement")
			return nil
		}
		importDone := make(chan error, 1)
		workers.Add(1)
		go func() {
			defer workers.Done()
			_, _, err := repo.CreateAttachmentWithResourceLinkContext(ctx, input)
			importDone <- err
		}()
		duplicateDone := make(chan attachmentcleanup.ItemResult, 1)
		workers.Add(1)
		go func() {
			defer workers.Done()
			duplicateDone <- service.RunItem(ctx, item, true)
		}()

		// Observe actual PostgreSQL lock contention, not a timing assumption about goroutine start.
		waitCtx, stopWaiting := context.WithTimeout(ctx, 5*time.Second)
		defer stopWaiting()
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			var waiters int
			if err := db.QueryRowContext(waitCtx, "select count(*) from pg_locks where locktype='advisory' and not granted").Scan(&waiters); err != nil {
				t.Fatalf("inspect disposable advisory waiters: %v", err)
			}
			if waiters >= 2 {
				break
			}
			select {
			case <-putEntered:
				t.Fatal("replacement upload ran while old cleanup still owned the object")
			case <-waitCtx.Done():
				t.Fatal("duplicate cleanup and reimport did not both wait on the attachment lock")
			case <-ticker.C:
			}
		}
		if body, calls := storage.state(input.StorageKey); body != "old" || calls != 1 {
			t.Fatalf("contenders changed locked object: body=%q delete_calls=%d", body, calls)
		}
		release()
		select {
		case result := <-firstDone:
			if result.Err != nil || !result.Finalized {
				t.Fatalf("first cleanup=%+v", result)
			}
		case <-ctx.Done():
			t.Fatal("first cleanup did not finish")
		}
		select {
		case err := <-importDone:
			if err != nil {
				t.Fatalf("replacement import: %v", err)
			}
		case <-ctx.Done():
			t.Fatal("replacement import did not finish")
		}
		select {
		case result := <-duplicateDone:
			if result.Err != nil || !result.Skipped {
				t.Fatalf("contending duplicate cleanup=%+v", result)
			}
		case <-ctx.Done():
			t.Fatal("duplicate cleanup did not finish")
		}
		// Exercise the stale item again after the replacement is certainly committed.
		if result := service.RunItem(ctx, item, true); result.Err != nil || !result.Skipped {
			t.Fatalf("stale cleanup removed replacement: %+v", result)
		}
		if body, calls := storage.state(input.StorageKey); body != "replacement" || calls != 1 {
			t.Fatalf("replacement bytes lost: body=%q delete_calls=%d", body, calls)
		}
		var live bool
		if err := db.QueryRowContext(ctx, `select exists(
select 1 from attachments a join attachment_relationships r on r.company_id=a.company_id and r.attachment_id=a.attachment_id
where a.company_id=$1::uuid and a.attachment_id=$2::uuid and a.deleted_timestamp is null
  and r.resource_type='email_message' and r.resource_id=$3 and r.deleted_timestamp is null
)`, companyID, input.AttachmentID, emailMessageID).Scan(&live); err != nil || !live {
			t.Fatalf("replacement lost live exact email owner: live=%v err=%v", live, err)
		}
	})

	t.Run("failed upload retries and active imports reuse one pooled connection", func(t *testing.T) {
		db.SetMaxOpenConns(1)
		defer db.SetMaxOpenConns(0)
		storage := &reimportCleanupStorage{objects: map[string]string{}}
		input := newInput("retry-reimport", storage)
		failure := errors.New("mock import PUT failed")
		input.StoreObject = func(context.Context) error { return failure }
		if _, _, err := repo.CreateAttachmentWithResourceLinkContext(ctx, input); !errors.Is(err, failure) {
			t.Fatalf("failed upload returned %v", err)
		}
		var count int
		if err := db.QueryRowContext(ctx, "select count(*) from attachments where company_id=$1::uuid and attachment_id=$2::uuid", companyID, input.AttachmentID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("failed upload left row count=%d err=%v", count, err)
		}
		puts := 0
		input.StoreObject = func(context.Context) error {
			puts++
			storage.put(input.StorageKey, "retry succeeded")
			return nil
		}
		if _, _, err := repo.CreateAttachmentWithResourceLinkContext(ctx, input); err != nil {
			t.Fatalf("failed-upload retry: %v", err)
		}
		if _, _, err := repo.CreateAttachmentWithResourceLinkContext(ctx, input); err != nil || puts != 1 {
			t.Fatalf("active import must reuse stored bytes: puts=%d err=%v", puts, err)
		}
		retire(t, input)
		if result := (attachmentcleanup.Service{Repository: repo, Storage: storage}).RunItem(ctx, itemFor(input), true); result.Err != nil || !result.Finalized {
			t.Fatalf("single-connection cleanup failed: %+v", result)
		}
	})

	t.Run("cleanup transaction commit failure preserves pending retry", func(t *testing.T) {
		storage := &reimportCleanupStorage{objects: map[string]string{}}
		input := newInput("commit-failure", storage)
		if _, _, err := repo.CreateAttachmentWithResourceLinkContext(ctx, input); err != nil {
			t.Fatal(err)
		}
		storage.put(input.StorageKey, "old")
		retire(t, input)
		if _, err := db.ExecContext(ctx, `create function cleanup_reimport_fail_commit() returns trigger language plpgsql as $$ begin raise exception 'fixture deferred cleanup failure'; end $$;
create constraint trigger cleanup_reimport_fail_commit after delete on attachments deferrable initially deferred for each row execute function cleanup_reimport_fail_commit()`); err != nil {
			t.Fatal(err)
		}
		defer func() {
			if _, err := db.ExecContext(ctx, "drop trigger if exists cleanup_reimport_fail_commit on attachments; drop function if exists cleanup_reimport_fail_commit()"); err != nil {
				t.Error(err)
			}
		}()
		service := attachmentcleanup.Service{Repository: repo, Storage: storage}
		if result := service.RunItem(ctx, itemFor(input), true); result.Err == nil || result.Finalized || result.FailureStage != "finalize_database" {
			t.Fatalf("failed transaction commit reported successful cleanup: %+v", result)
		}
		var pending bool
		if err := db.QueryRowContext(ctx, "select deleted_timestamp is not null from attachments where company_id=$1::uuid and attachment_id=$2::uuid", companyID, input.AttachmentID).Scan(&pending); err != nil || !pending {
			t.Fatalf("commit failure lost pending state: pending=%v err=%v", pending, err)
		}
		if _, err := db.ExecContext(ctx, "drop trigger cleanup_reimport_fail_commit on attachments; drop function cleanup_reimport_fail_commit()"); err != nil {
			t.Fatal(err)
		}
		if result := service.RunItem(ctx, itemFor(input), true); result.Err != nil || !result.Finalized || result.AlreadyMissing != 1 {
			t.Fatalf("commit failure did not recover missing bytes: %+v", result)
		}
	})
}
