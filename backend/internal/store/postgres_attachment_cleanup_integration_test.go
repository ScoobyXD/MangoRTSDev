package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"miraeopus/backend/internal/attachmentcleanup"
	"miraeopus/backend/internal/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

type cleanupFixtureStorage struct {
	mu      sync.Mutex
	objects map[string]bool
	failKey string
	calls   int
}

func (*cleanupFixtureStorage) Bucket() string { return "disposable-cleanup-bucket" }
func (s *cleanupFixtureStorage) DeleteObject(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	if key == s.failKey {
		return errors.New("temporary mock storage failure")
	}
	if !s.objects[key] {
		return attachmentcleanup.ErrObjectNotFound
	}
	delete(s.objects, key)
	return nil
}

func TestPostgresAttachmentCleanupLifecycle(t *testing.T) {
	dsn := os.Getenv("MANGORTS_ATTACHMENT_CLEANUP_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("run node scripts/test_attachment_cleanup_postgres.mjs for a disposable database")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.Database != "mangorts_attachment_cleanup_test" || config.Host != os.Getenv("MANGORTS_ATTACHMENT_CLEANUP_TEST_PRIVATE_HOST_ACK") {
		t.Fatal("refusing database outside explicitly acknowledged disposable fixture")
	}
	config.RuntimeParams["client_encoding"] = "UTF8"
	db := stdlib.OpenDB(*config)
	defer db.Close()
	var version int
	if err := db.QueryRow("select current_setting('server_version_num')::integer").Scan(&version); err != nil || version < 170000 || version >= 190000 {
		t.Fatalf("unsupported isolated PostgreSQL version=%d err=%v", version, err)
	}
	t.Logf("isolated PostgreSQL server_version_num=%d", version)
	// The runner creates a new empty database, so no DROP or live-state reset is needed.
	schema, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(schema)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("drop index idx_attachments_pending_deletion"); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260905_attachment_pending_deletion_index.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("apply pending-deletion index migration: %v", err)
	}
	repo := NewPostgresRepo(db)
	ctx := context.Background()
	company, err := repo.CreateCompany("Attachment cleanup fixture")
	if err != nil {
		t.Fatal(err)
	}
	actor, err := repo.UpsertAuthUser("attachment-cleanup-fixture", "cleanup@example.test", "Cleanup fixture")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	storage := &cleanupFixtureStorage{objects: map[string]bool{}}
	service := attachmentcleanup.Service{Repository: repo, Storage: storage}
	makeGate := func() string {
		t.Helper()
		gate, err := repo.CreateLogicGate(company.CompanyID, "Cleanup owner")
		if err != nil {
			t.Fatal(err)
		}
		return gate.LogicGateID
	}
	makeAttachment := func(resourceType, resourceID string) domain.Attachment {
		t.Helper()
		id := NewUUIDv7String()
		attachment, _, err := repo.CreateAttachmentWithResourceLink(AttachmentCreateInput{
			CompanyID: company.CompanyID, AttachmentID: id, OriginalFilename: "fixture.png", MimeType: "image/png",
			ByteSize: 1, SHA256: strings.Repeat("a", 64), StorageBucket: storage.Bucket(), StorageKey: id + "/original",
			SourceKind:   AttachmentSourceUserUpload,
			ResourceLink: ResourceAttachmentInput{CompanyID: company.CompanyID, ResourceType: resourceType, ResourceID: resourceID, RelationshipKind: AttachmentRelationshipInlineImage},
		})
		if err != nil {
			t.Fatal(err)
		}
		storage.objects[attachment.StorageKey] = true
		return attachment
	}
	run := func() attachmentcleanup.Result {
		t.Helper()
		result, err := service.Run(ctx, attachmentcleanup.Options{CompanyID: company.CompanyID, Limit: 100, Apply: true})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	retire := func(attachmentID, ownerID string) {
		t.Helper()
		if err := repo.SoftDeleteResourceAttachment(ResourceAttachmentDeleteInput{CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: ownerID, AttachmentID: attachmentID}); err != nil {
			t.Fatal(err)
		}
	}
	t.Run("last owner partial storage and database failure recover after restart", func(t *testing.T) {
		firstOwner, secondOwner := makeGate(), makeGate()
		attachment := makeAttachment(EntityTypeLogicGate, firstOwner)
		if _, err := repo.LinkResourceAttachment(ResourceAttachmentInput{CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: secondOwner, AttachmentID: attachment.AttachmentID, RelationshipKind: AttachmentRelationshipInlineImage}); err != nil {
			t.Fatal(err)
		}
		preview := attachment.AttachmentID + "/preview"
		digest, generation := strings.Repeat("b", 64), AttachmentVariantGenerationVersion
		if _, err := repo.UpsertAttachmentVariants(ctx, company.CompanyID, []AttachmentVariantInput{{AttachmentID: attachment.AttachmentID, VariantType: AttachmentVariantDisplay, MimeType: "image/png", ByteSize: 1, SHA256: &digest, GenerationVersion: &generation, StorageBucket: storage.Bucket(), StorageKey: preview}}); err != nil {
			t.Fatal(err)
		}
		storage.objects[preview] = true
		retire(attachment.AttachmentID, firstOwner)
		if result := run(); len(result.Items) != 0 || !storage.objects[attachment.StorageKey] {
			t.Fatalf("surviving owner lost attachment: %+v", result)
		}
		retire(attachment.AttachmentID, secondOwner)
		// A new consumer sees committed work even though no process-local wake exists.
		storage.failKey = preview
		if result := run(); result.FailureCount() != 1 || result.FinalizedCount() != 0 {
			t.Fatalf("partial failure=%+v", result)
		}
		var pending bool
		var originalKey, previewKey string
		if err := db.QueryRow(`select a.deleted_timestamp is not null,a.storage_key,p.storage_key from attachments a join attachment_previews p using(attachment_id) where a.attachment_id=$1::uuid`, attachment.AttachmentID).Scan(&pending, &originalKey, &previewKey); err != nil || !pending || originalKey != attachment.StorageKey || previewKey != preview {
			t.Fatalf("partial failure lost durable keys pending=%v original=%s preview=%s err=%v", pending, originalKey, previewKey, err)
		}
		storage.failKey = ""
		if _, err := db.Exec(`create function cleanup_fixture_fail_delete() returns trigger language plpgsql as $$ begin raise exception 'temporary fixture database failure'; end $$;
create trigger cleanup_fixture_fail_delete before delete on attachments for each row execute function cleanup_fixture_fail_delete()`); err != nil {
			t.Fatal(err)
		}
		service.Repository = NewPostgresRepo(db)
		if result := run(); result.FailureCount() != 1 || result.Items[0].FailureStage != "finalize_database" || result.Items[0].AlreadyMissing != 1 {
			t.Fatalf("database failure=%+v", result)
		}
		if _, err := db.Exec(`drop trigger cleanup_fixture_fail_delete on attachments; drop function cleanup_fixture_fail_delete()`); err != nil {
			t.Fatal(err)
		}
		if result := run(); result.FinalizedCount() != 1 || result.Items[0].AlreadyMissing != 2 {
			t.Fatalf("restart recovery=%+v", result)
		}
		if result := run(); len(result.Items) != 0 {
			t.Fatalf("settled work remained=%+v", result)
		}
	})
	t.Run("recycle restore and purge retain exact bytes", func(t *testing.T) {
		huddle, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: company.CompanyID, Name: "Recycle owner", ActorID: actor.UserID})
		if err != nil {
			t.Fatal(err)
		}
		attachment := makeAttachment(EntityTypeHuddleLogicGate, huddle.HuddleLogicGateID)
		for attempt := 0; attempt < 2; attempt++ {
			if err := repo.DeleteHuddleLogicGate(company.CompanyID, huddle.HuddleLogicGateID, actor.UserID); err != nil {
				t.Fatal(err)
			}
			if result := run(); len(result.Items) != 0 || !storage.objects[attachment.StorageKey] {
				t.Fatalf("recycle must protect bytes=%+v", result)
			}
			if shared, err := repo.SharedWithRetained(ctx, attachmentcleanup.WorkItem{}, attachmentcleanup.ObjectRef{Bucket: attachment.StorageBucket, Key: attachment.StorageKey}); err != nil || !shared {
				t.Fatalf("recycled attachment must protect shared object key: shared=%v err=%v", shared, err)
			}
			items, err := repo.ListRecycleBinItems(company.CompanyID, actor.UserID)
			if err != nil || len(items) != 1 {
				t.Fatalf("recycle items=%v err=%v", items, err)
			}
			if attempt == 0 {
				if _, err := repo.RestoreRecycleBinItems(company.CompanyID, actor.UserID, []string{items[0].RecycleBinItemID}); err != nil {
					t.Fatal(err)
				}
				if _, err := repo.GetAttachment(company.CompanyID, attachment.AttachmentID); err != nil {
					t.Fatalf("restored file=%v", err)
				}
			} else if err := repo.PermanentlyDeleteRecycleBinItems(company.CompanyID, actor.UserID, []string{items[0].RecycleBinItemID}); err != nil {
				t.Fatal(err)
			}
		}
		if result := run(); result.FinalizedCount() != 1 || storage.objects[attachment.StorageKey] {
			t.Fatalf("purged file=%+v", result)
		}
	})
	t.Run("conversion retires only final owner", func(t *testing.T) {
		owner := makeGate()
		attachment := makeAttachment(EntityTypeLogicGate, owner)
		if _, err := repo.ConvertLogicGateToHuddle(company.CompanyID, owner, actor.UserID); err != nil {
			t.Fatal(err)
		}
		if result := run(); result.FinalizedCount() != 1 || storage.objects[attachment.StorageKey] {
			t.Fatalf("converted owner's orphan=%+v", result)
		}
	})
	t.Run("active and failed upload keys remain protected", func(t *testing.T) {
		node, err := repo.CreateNode(company.CompanyID, "Upload owner")
		if err != nil {
			t.Fatal(err)
		}
		now := time.Now().UTC()
		input := testAttachmentUploadIntentInput(company.CompanyID, now, domain.AttachmentUploadStrategySingle)
		input.ActorUserID, input.ResourceID = actor.UserID, node.NodeID
		input.StorageBucket, input.StorageKey = storage.Bucket(), "active-upload/original"
		intent, _, err := repo.CreateAttachmentUploadIntent(input)
		if err != nil {
			t.Fatal(err)
		}
		object := attachmentcleanup.ObjectRef{Bucket: input.StorageBucket, Key: input.StorageKey}
		assertProtected := func(want bool) {
			t.Helper()
			if shared, err := repo.SharedWithRetained(ctx, attachmentcleanup.WorkItem{}, object); err != nil || shared != want {
				t.Fatalf("upload object protection=%v want=%v err=%v", shared, want, err)
			}
		}
		assertProtected(true)
		transition := AttachmentUploadTransitionInput{CompanyID: company.CompanyID, ActorUserID: actor.UserID, UploadIntentID: intent.UploadIntentID, Now: now.Add(time.Minute)}
		if _, claimed, err := repo.BeginAttachmentUploadCompletion(transition); err != nil || !claimed {
			t.Fatalf("claim completion=%v err=%v", claimed, err)
		}
		if _, err := repo.FailAttachmentUploadIntent(transition, "mock_failure"); err != nil {
			t.Fatal(err)
		}
		assertProtected(true)
		if _, err := repo.AbortAttachmentUploadIntent(transition); err != nil {
			t.Fatal(err)
		}
		assertProtected(false)
	})
	t.Run("history restore notifies committed removals before later failure", func(t *testing.T) {
		node, err := repo.CreateNode(company.CompanyID, "Restore owner")
		if err != nil {
			t.Fatal(err)
		}
		keptID, removedID := NewUUIDv7String(), NewUUIDv7String()
		commit := func(id, text string, revision int64) {
			t.Helper()
			document := editorMergeTestDocument(t, fmt.Sprintf(`{"type":"paragraph","content":[{"type":"text","text":%q}]}`, text))
			if _, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
				Document:    EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: id},
				OperationID: NewUUIDv7String(), ClientID: "cleanup-fixture", BaseRevision: revision, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
			}); err != nil {
				t.Fatal(err)
			}
		}
		commit(keptID, "saved", 0)
		saved, err := repo.CreateNodeEditorSaveVersion(EditorSaveVersionInput{CompanyID: company.CompanyID, ResourceID: node.NodeID, SaveKind: editorSaveKindManual})
		if err != nil {
			t.Fatal(err)
		}
		commit(keptID, "changed", 1)
		commit(removedID, "remove this textbox", 0)
		if _, err := db.Exec(fmt.Sprintf(`create function cleanup_fixture_fail_restore() returns trigger language plpgsql as $$ begin raise exception 'fixture restore failure'; end $$;
create trigger cleanup_fixture_fail_restore before update on node_textboxes for each row when (old.textbox_id='%s'::uuid) execute function cleanup_fixture_fail_restore()`, keptID)); err != nil {
			t.Fatal(err)
		}
		defer func() {
			if _, err := db.Exec("drop trigger cleanup_fixture_fail_restore on node_textboxes; drop function cleanup_fixture_fail_restore()"); err != nil {
				t.Error(err)
			}
		}()
		calls := 0
		input := EditorSaveVersionRestoreInput{CompanyID: company.CompanyID, ResourceID: node.NodeID, SaveID: saved.SaveID, AfterDeleteCommit: func() {
			calls++
			var deleted bool
			if err := db.QueryRow("select deleted_timestamp is not null from node_textboxes where company_id=$1::uuid and textbox_id=$2::uuid", company.CompanyID, removedID).Scan(&deleted); err != nil || !deleted {
				t.Errorf("wake must see committed textbox deletion: deleted=%v err=%v", deleted, err)
			}
		}}
		if _, err := repo.RestoreNodeEditorSaveVersion(input); err == nil || !strings.Contains(err.Error(), "fixture restore failure") || calls != 1 {
			t.Fatalf("partial restore wake calls=%d err=%v", calls, err)
		}
		input.SaveID = NewUUIDv7String()
		if _, err := repo.RestoreNodeEditorSaveVersion(input); !errors.Is(err, ErrNotFound) || calls != 1 {
			t.Fatalf("precommit failure emitted wake calls=%d err=%v", calls, err)
		}
	})
	t.Run("duplicate consumers are safe", func(t *testing.T) {
		owner := makeGate()
		attachment := makeAttachment(EntityTypeLogicGate, owner)
		retire(attachment.AttachmentID, owner)
		work, err := repo.ListWork(ctx, company.CompanyID, "", 100)
		if err != nil || len(work) != 1 {
			t.Fatalf("work=%v err=%v", work, err)
		}
		results := make(chan attachmentcleanup.ItemResult, 2)
		for consumer := 0; consumer < 2; consumer++ {
			go func() { results <- service.RunItem(ctx, work[0], true) }()
		}
		for consumer := 0; consumer < 2; consumer++ {
			if result := <-results; result.Err != nil {
				t.Fatalf("duplicate consumer=%+v", result)
			}
		}
		var count int
		if err := db.QueryRow("select count(*) from attachments where attachment_id=$1::uuid", attachment.AttachmentID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("duplicate consumers left row count=%d err=%v", count, err)
		}
	})
	t.Run("same identity reimport waits for cleanup", func(t *testing.T) {
		testPostgresAttachmentCleanupReimport(t, db, repo, company.CompanyID, actor.UserID)
	})
	t.Run("pending index avoids active rows and keyset drains past failures", func(t *testing.T) {
		if _, err := db.Exec(`insert into attachments(attachment_id,company_id,original_filename,mime_type,byte_size,sha256,storage_bucket,storage_key,source_kind,deleted_timestamp)
select md5('cleanup-fixture-'||n)::uuid,$1::uuid,'fixture','application/octet-stream',1,repeat('a',64),$2,'bulk/'||n,'user_upload',case when n<=251 then now() end
from generate_series(1,87270) n`, company.CompanyID, storage.Bucket()); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec("analyze attachments; analyze attachment_relationships; analyze recycle_bin_items"); err != nil {
			t.Fatal(err)
		}
		source, err := os.ReadFile("../attachmentcleanup/postgres.go")
		if err != nil {
			t.Fatal(err)
		}
		query := regexp.MustCompile("(?s)func .*ListPendingAttachmentDeletionCompanyIDs.*?queryContext\\(ctx, `([^`]+)`").FindSubmatch(source)
		if len(query) != 2 {
			t.Fatal("missing canonical pending discovery query")
		}
		rows, err := db.Query("explain (analyze, buffers) " + string(query[1]))
		if err != nil {
			t.Fatal(err)
		}
		var plan strings.Builder
		for rows.Next() {
			var line string
			if err := rows.Scan(&line); err != nil {
				t.Fatal(err)
			}
			fmt.Fprintln(&plan, line)
		}
		rows.Close()
		if err := rows.Err(); err != nil || !strings.Contains(plan.String(), "idx_attachments_pending_deletion") || strings.Contains(plan.String(), "Seq Scan on attachments") {
			t.Fatalf("pending discovery must use partial index err=%v\n%s", err, plan.String())
		}
		t.Logf("87,270-row pending discovery plan:\n%s", plan.String())
		work, err := repo.ListWork(ctx, company.CompanyID, "", 1)
		if err != nil || len(work) != 1 {
			t.Fatal(err)
		}
		objects, err := repo.LoadObjects(ctx, work[0])
		if err != nil {
			t.Fatal(err)
		}
		storage.failKey = objects[0].Key
		result, err := attachmentcleanup.DrainPending(ctx, repo, storage, attachmentcleanup.DrainOptions{BatchSize: 100, MaxItems: 1000, Apply: true})
		if err != nil || result.Scanned != 251 || result.FinalizedCount() != 250 || result.FailureCount() != 1 || result.Capped() {
			t.Fatalf("multi-batch cleanup=%+v err=%v", result, err)
		}
		storage.failKey = ""
		if result := run(); result.FinalizedCount() != 1 {
			t.Fatalf("failed first item did not recover=%+v", result)
		}
	})
}

var _ attachmentcleanup.Storage = (*cleanupFixtureStorage)(nil)
