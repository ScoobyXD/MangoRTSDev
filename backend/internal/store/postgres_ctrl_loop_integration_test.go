package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func TestPostgresCtrlLoopLifecycle(t *testing.T) {
	dsn := os.Getenv("MANGORTS_CTRL_LOOP_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("run node scripts/test_ctrl_loop_postgres.mjs for an isolated disposable database")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.Database != "mangorts_ctrl_loop_test" || config.Host != os.Getenv("MANGORTS_CTRL_LOOP_TEST_PRIVATE_HOST_ACK") {
		t.Fatal("refusing database outside the explicitly acknowledged disposable fixture")
	}
	config.RuntimeParams["client_encoding"] = "UTF8"
	db := stdlib.OpenDB(*config)
	defer db.Close()
	var version int
	if err := db.QueryRow("select current_setting('server_version_num')::integer").Scan(&version); err != nil || version < 170000 || version >= 190000 {
		t.Fatalf("unsupported isolated PostgreSQL version=%d err=%v", version, err)
	}
	t.Logf("isolated PostgreSQL server_version_num=%d", version)
	schema, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	// Install the canonical pre-CtrlLoop tables, then the exact forward schema
	// migration. Attachment functions are already canonical and table-independent
	// until invoked; this verifies both the real migration and final owner rules.
	prefix, _, ok := strings.Cut(string(schema), "CREATE TABLE ctrl_loop_jobs (")
	if !ok {
		t.Fatal("CtrlLoop canonical schema section is missing")
	}
	if _, err := db.Exec(prefix); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260913_ctrl_loop.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("CtrlLoop forward migration: %v", err)
	}
	// Restore the prior attachment constraint shape in this empty fixture so
	// the exact second forward migration runs without a duplicate constraint.
	if _, err := db.Exec("ALTER TABLE attachment_relationships DROP CONSTRAINT attachment_relationships_ctrl_loop_shape_chk"); err != nil {
		t.Fatal(err)
	}
	attachmentMigration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260913_z_ctrl_loop_attachments.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(attachmentMigration)); err != nil {
		t.Fatalf("CtrlLoop attachment migration: %v", err)
	}
	repo := NewPostgresRepo(db)
	ctx := context.Background()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	company, err := repo.CreateCompany("CtrlLoop fixture")
	must(err)
	otherCompany, err := repo.CreateCompany("Other CtrlLoop fixture")
	must(err)
	owner, err := repo.UpsertAuthUser("ctrl-loop-fixture", "loop@example.test", "Loop fixture")
	must(err)
	stranger, err := repo.UpsertAuthUser("ctrl-loop-other", "other-loop@example.test", "Other fixture")
	must(err)
	_, err = repo.AddCompanyMembership(owner.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin)
	must(err)
	_, err = repo.AddCompanyMembership(stranger.CognitoSubject, company.CompanyID, domain.RoleCompanyUser)
	must(err)
	_, err = repo.AddCompanyMembership(stranger.CognitoSubject, otherCompany.CompanyID, domain.RoleCompanyAdmin)
	must(err)
	_, err = db.Exec("UPDATE users SET mailbox_enabled=true WHERE user_id IN ($1,$2)", owner.UserID, stranger.UserID)
	must(err)
	makeMailbox := func(c, user, account string) string {
		t.Helper()
		id := NewUUIDv7String()
		_, err := db.Exec(`INSERT INTO email_connections(email_connection_id,company_id,connection_type,personal_user_id,provider,account_email,grant_id,connected_by_user_id) VALUES($1::uuid,$2,'personal',$3,'google',$4,$1::text,$3)`, id, c, user, account)
		must(err)
		return id
	}
	mailbox := makeMailbox(company.CompanyID, owner.UserID, "loop@example.test")
	secondMailbox := makeMailbox(company.CompanyID, owner.UserID, "loop-second@example.test")
	otherMailbox := makeMailbox(otherCompany.CompanyID, stranger.UserID, "other-loop@example.test")
	newJob := func(connection, name string) CtrlLoopJob {
		t.Helper()
		j, err := repo.SaveCtrlLoopJob(ctx, CtrlLoopJob{CompanyID: company.CompanyID, UserID: owner.UserID, EmailConnectionID: connection, Name: name, Instructions: "Stamp the PO receipt cell", TimeZone: "America/Los_Angeles"})
		must(err)
		return j
	}
	makeAttachment := func(job CtrlLoopJob) string {
		t.Helper()
		id := NewUUIDv7String()
		a, _, err := repo.CreateAttachmentWithResourceLink(AttachmentCreateInput{CompanyID: job.CompanyID, AttachmentID: id, OriginalFilename: "fixture.xlsx", MimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ByteSize: 100, SHA256: strings.Repeat("a", 64), StorageBucket: "disposable-ctrl-loop", StorageKey: id + "/original", SourceKind: AttachmentSourceUserUpload, ResourceLink: ResourceAttachmentInput{CompanyID: job.CompanyID, ResourceType: "ctrl_loop_job", ResourceID: job.ID, RelationshipKind: AttachmentRelationshipFileAttachment}})
		must(err)
		return a.AttachmentID
	}
	attach := func(job CtrlLoopJob) CtrlLoopJob {
		t.Helper()
		id := makeAttachment(job)
		must(repo.AttachCtrlLoopWorkbook(ctx, job.CompanyID, job.UserID, job.ID, job.Revision, id))
		j, err := repo.GetCtrlLoopJob(ctx, job.CompanyID, job.UserID, job.ID)
		must(err)
		return j
	}
	job := newJob(mailbox, "Factory receipt")
	if job.Status != "Awaiting file" || job.UnseenUpdates != 0 {
		t.Fatalf("initial status: %+v", job)
	}
	job = attach(job)
	secondJob := attach(newJob(mailbox, "Packing receipt"))
	otherConnectionJob := attach(newJob(secondMailbox, "Other mailbox receipt"))
	if job.Status != "Listening" || job.OriginalAttachmentID != job.CurrentAttachmentID {
		t.Fatalf("upload activation: %+v", job)
	}
	if exists, err := repo.HasCtrlLoopJobsForConnection(ctx, company.CompanyID, mailbox); err != nil || !exists {
		t.Fatalf("configured connection not found: %v", err)
	}
	if exists, err := repo.HasCtrlLoopJobsForConnection(ctx, otherCompany.CompanyID, mailbox); err != nil || exists {
		t.Fatalf("configured connection crossed company: %v", err)
	}
	makeMessage := func(connection string, arrival time.Time) CommunicationsEmailIngestionJob {
		t.Helper()
		thread, message := NewUUIDv7String(), NewUUIDv7String()
		provider := "provider-" + message
		_, err := db.Exec(`INSERT INTO email_threads(company_id,email_thread_id,email_connection_id,provider_thread_key,provider_thread_id,root_provider_message_id) VALUES($1,$2,$3,$4,$4,$5)`, company.CompanyID, thread, connection, "thread-"+thread, provider)
		must(err)
		_, err = db.Exec(`INSERT INTO email_messages(company_id,email_message_id,email_thread_id,provider_message_id,message_order,message_timestamp,download_complete,folder_snapshot) VALUES($1,$2,$3,$4,0,$5,true,'["inbox"]')`, company.CompanyID, message, thread, provider, arrival)
		must(err)
		return CommunicationsEmailIngestionJob{CompanyID: company.CompanyID, EmailConnectionID: connection, ProviderMessageID: provider}
	}
	arrival := time.Now().UTC().Add(time.Minute).Truncate(time.Microsecond)
	mail := makeMessage(mailbox, arrival)
	var run CtrlLoopRun
	t.Run("activation cutoff duplicate receipts and mailbox scope", func(t *testing.T) {
		old := makeMessage(mailbox, job.ActivatedAt.Add(-time.Second))
		if _, accepted, err := repo.AcceptCtrlLoopRun(ctx, old, "inbox-fixture"); err != nil || accepted {
			t.Fatalf("historical email accepted=%v err=%v", accepted, err)
		}
		var accepted bool
		run, accepted, err = repo.AcceptCtrlLoopRun(ctx, mail, "inbox-fixture")
		must(err)
		if !accepted || !run.ArrivalAt.Equal(arrival) {
			t.Fatalf("arrival not retained: %+v", run)
		}
		var expectedThread string
		must(db.QueryRow(`SELECT email_thread_id::text FROM email_messages WHERE company_id=$1 AND email_message_id=$2`, company.CompanyID, run.EmailMessageID).Scan(&expectedThread))
		if run.EmailThreadID != expectedThread {
			t.Fatalf("accepted run lost exact source thread: %q want %q", run.EmailThreadID, expectedThread)
		}
		duplicate, accepted, err := repo.AcceptCtrlLoopRun(ctx, mail, "inbox-fixture")
		must(err)
		if !accepted || duplicate.ID != run.ID {
			t.Fatal("duplicate incoming mail created another run")
		}
		sent := makeMessage(mailbox, arrival)
		_, err = db.Exec(`UPDATE email_messages SET folder_snapshot='["sent"]' WHERE company_id=$1 AND provider_message_id=$2`, company.CompanyID, sent.ProviderMessageID)
		must(err)
		if _, accepted, err := repo.AcceptCtrlLoopRun(ctx, sent, "inbox-fixture"); err != nil || accepted {
			t.Fatalf("outgoing Sent mail accepted=%v err=%v", accepted, err)
		}
		_, err = db.Exec(`UPDATE email_messages SET folder_snapshot='[]' WHERE company_id=$1 AND provider_message_id=$2`, company.CompanyID, mail.ProviderMessageID)
		must(err)
		archived, accepted, err := repo.AcceptCtrlLoopRun(ctx, mail, "inbox-fixture")
		must(err)
		if !accepted || archived.ID != run.ID {
			t.Fatal("accepted arrival lost retry eligibility after archive")
		}
		if _, err := repo.GetCtrlLoopJob(ctx, company.CompanyID, stranger.UserID, job.ID); !errors.Is(err, ErrNotFound) {
			t.Fatal("another user can read job")
		}
		bad := CtrlLoopJob{CompanyID: company.CompanyID, UserID: owner.UserID, EmailConnectionID: otherMailbox, Name: "Wrong mailbox", Instructions: "test", TimeZone: "UTC"}
		if _, err := repo.SaveCtrlLoopJob(ctx, bad); err == nil {
			t.Fatal("cross-company mailbox accepted")
		}
		bad.EmailConnectionID = mailbox
		bad.UserID = stranger.UserID
		if _, err := repo.SaveCtrlLoopJob(ctx, bad); err == nil {
			t.Fatal("another user's mailbox accepted")
		}
		if _, err := db.Exec(`UPDATE ctrl_loop_jobs SET original_attachment_id=$3 WHERE company_id=$1 AND job_id=$2`, company.CompanyID, job.ID, secondJob.OriginalAttachmentID); err == nil {
			t.Fatal("original workbook identity can change")
		}
	})
	t.Run("company serialization spans mailbox connections", func(t *testing.T) {
		db2 := stdlib.OpenDB(*config)
		defer db2.Close()
		r2 := NewPostgresRepo(db2)
		must(repo.WithCtrlLoopCompanyLock(ctx, company.CompanyID, func() error {
			if err := r2.WithCtrlLoopCompanyLock(ctx, otherConnectionJob.CompanyID, func() error { t.Error("same company entered twice"); return nil }); !errors.Is(err, ErrConflict) {
				t.Fatalf("same-company lock error: %v", err)
			}
			if err := r2.WithCtrlLoopCompanyLock(ctx, otherCompany.CompanyID, func() error { return nil }); err != nil {
				t.Fatalf("different company blocked: %v", err)
			}
			if err := r2.DeleteCtrlLoopJob(ctx, company.CompanyID, owner.UserID, otherConnectionJob.ID); !errors.Is(err, ErrConflict) {
				t.Fatalf("delete bypassed active workbook lock: %v", err)
			}
			return nil
		}))
		must(r2.WithCtrlLoopCompanyLock(ctx, company.CompanyID, func() error { return nil }))
	})
	t.Run("accepted run survives instruction and mailbox edits before queue handoff", func(t *testing.T) {
		connection := makeMailbox(company.CompanyID, owner.UserID, "handoff-loop@example.test")
		configured := attach(newJob(connection, "Handoff recovery"))
		var arrived time.Time
		must(db.QueryRow(`SELECT clock_timestamp()`).Scan(&arrived))
		incoming := makeMessage(connection, arrived)
		acceptedRun, accepted, err := repo.AcceptCtrlLoopRun(ctx, incoming, "inbox-fixture")
		must(err)
		if !accepted {
			t.Fatal("initial eligible arrival was not accepted")
		}
		configured.Instructions = "Stamp the revised receipt cell"
		configured, err = repo.SaveCtrlLoopJob(ctx, configured)
		must(err)
		if !configured.ActivatedAt.After(arrived) {
			t.Fatal("instruction edit did not restart future eligibility")
		}
		_, err = db.Exec(`UPDATE email_messages SET folder_snapshot='[]' WHERE company_id=$1 AND provider_message_id=$2`, company.CompanyID, incoming.ProviderMessageID)
		must(err)
		recovered, accepted, err := repo.AcceptCtrlLoopRun(ctx, incoming, "inbox-fixture")
		must(err)
		if !accepted || recovered.ID != acceptedRun.ID {
			t.Fatal("instruction edit stranded an accepted run")
		}
		earlier := makeMessage(connection, arrived)
		if _, accepted, err := repo.AcceptCtrlLoopRun(ctx, earlier, "inbox-fixture"); err != nil || accepted {
			t.Fatalf("instruction edit backfilled an unaccepted old arrival=%v err=%v", accepted, err)
		}
		configured.EmailConnectionID = mailbox
		configured, err = repo.SaveCtrlLoopJob(ctx, configured)
		must(err)
		if countPostgresRows(t, db, `SELECT count(*) FROM ctrl_loop_jobs WHERE company_id=$1 AND email_connection_id=$2`, company.CompanyID, connection) != 0 {
			t.Fatal("fixture still has an old-connection job")
		}
		if eligible, err := repo.HasCtrlLoopJobsForConnection(ctx, company.CompanyID, connection); err != nil || !eligible {
			t.Fatalf("queue recovery gate skipped accepted run after mailbox edit: %v", err)
		}
		recovered, accepted, err = repo.AcceptCtrlLoopRun(ctx, incoming, "inbox-fixture")
		must(err)
		if !accepted || recovered.ID != acceptedRun.ID {
			t.Fatal("mailbox edit stranded an accepted run")
		}
		token := strings.Repeat("5", 64)
		books, err := repo.StartCtrlLoopRun(ctx, company.CompanyID, acceptedRun.ID, token, time.Now().Add(time.Hour))
		must(err)
		if len(books) != 0 {
			t.Fatal("moved job remained eligible for the earlier mailbox run")
		}
		_, err = repo.FreezeCtrlLoopRun(ctx, company.CompanyID, acceptedRun.ID, token)
		must(err)
		must(repo.CompleteCtrlLoopRun(ctx, company.CompanyID, acceptedRun.ID, token, nil))
		if eligible, err := repo.HasCtrlLoopJobsForConnection(ctx, company.CompanyID, connection); err != nil || eligible {
			t.Fatalf("terminal run kept unnecessary provider lookup alive: %v", err)
		}
		after, err := repo.GetCtrlLoopJob(ctx, company.CompanyID, owner.UserID, configured.ID)
		must(err)
		if after.CurrentAttachmentID != configured.CurrentAttachmentID || after.UnseenUpdates != 0 || after.LastUpdated != nil {
			t.Fatal("recovered ineligible run changed workbook or count")
		}
		must(repo.DeleteCtrlLoopJob(ctx, company.CompanyID, owner.UserID, configured.ID))
	})
	hash := strings.Repeat("1", 64)
	work, err := repo.StartCtrlLoopRun(ctx, company.CompanyID, run.ID, hash, time.Now().Add(time.Hour))
	must(err)
	if len(work) != 2 {
		t.Fatalf("run crossed mailbox scope or omitted job: %+v", work)
	}
	link := "https://mail.google.com/mail/?authuser=loop%40example.test#all/native-thread"
	must(repo.SetCtrlLoopSource(ctx, company.CompanyID, run.ID, hash, link, "session-fixture"))
	stage := func(j CtrlLoopJob, cell string) json.RawMessage {
		b, _ := json.Marshal([]map[string]string{{"sheet": "WIP", "cell": cell}})
		return b
	}
	t.Run("atomic staging deduplication and freeze fencing", func(t *testing.T) {
		must(repo.StageCtrlLoopTargets(ctx, hash, map[string]json.RawMessage{job.ID: stage(job, "C2")}))
		must(repo.StageCtrlLoopTargets(ctx, hash, map[string]json.RawMessage{job.ID: stage(job, "C2")}))
		invalid := map[string]json.RawMessage{job.ID: stage(job, "C3"), otherConnectionJob.ID: stage(otherConnectionJob, "C2")}
		if err := repo.StageCtrlLoopTargets(ctx, hash, invalid); err == nil {
			t.Fatal("non-run workbook staged")
		}
		if err := repo.StageCtrlLoopTargets(ctx, hash, map[string]json.RawMessage{job.ID: json.RawMessage(`[{"sheet":"WIP","cell":"C3","job_id":"surrogate"}]`)}); !errors.Is(err, ErrInvalid) {
			t.Fatal("staged target accepted redundant identity")
		}
		tooMany := make([]map[string]string, 500)
		for i := range tooMany {
			tooMany[i] = map[string]string{"sheet": "Other sheet", "cell": fmt.Sprintf("A%d", i+1)}
		}
		tooManyJSON, _ := json.Marshal(tooMany)
		if err := repo.StageCtrlLoopTargets(ctx, hash, map[string]json.RawMessage{job.ID: tooManyJSON}); err == nil {
			t.Fatal("500-cell durable union limit not enforced")
		}
		var wg sync.WaitGroup
		errs := make(chan error, 2)
		for _, cell := range []string{"C4", "C5"} {
			wg.Add(1)
			go func(cell string) {
				defer wg.Done()
				errs <- repo.StageCtrlLoopTargets(ctx, hash, map[string]json.RawMessage{secondJob.ID: stage(secondJob, cell)})
			}(cell)
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			must(err)
		}
		_, books, err := repo.AuthorizeCtrlLoopToken(ctx, hash)
		must(err)
		for _, book := range books {
			var targets []map[string]string
			must(json.Unmarshal(book.Targets, &targets))
			if book.ID == job.ID && len(targets) != 1 {
				t.Fatal("duplicate or rolled-back cell remained")
			}
			if book.ID == secondJob.ID && len(targets) != 2 {
				t.Fatal("concurrent stage lost an earlier cell")
			}
		}
		before, err := repo.GetCtrlLoopJob(ctx, company.CompanyID, owner.UserID, job.ID)
		must(err)
		if before.UnseenUpdates != 0 || before.LastUpdated != nil || before.CurrentAttachmentID != job.CurrentAttachmentID {
			t.Fatal("stage published workbook/count prematurely")
		}
		_, err = repo.FreezeCtrlLoopRun(ctx, company.CompanyID, run.ID, hash)
		must(err)
		if err := repo.StageCtrlLoopTargets(ctx, hash, map[string]json.RawMessage{job.ID: stage(job, "C6")}); !errors.Is(err, ErrConflict) {
			t.Fatalf("write after freeze accepted: %v", err)
		}
		if _, _, err := repo.AuthorizeCtrlLoopToken(ctx, hash); err == nil {
			t.Fatal("frozen bearer remains authorized")
		}
	})
	t.Run("publication rolls back as one unit and persists unseen cells", func(t *testing.T) {
		version1, version2 := makeAttachment(job), makeAttachment(secondJob)
		change := func(j CtrlLoopJob, cell string) CtrlLoopChange {
			return CtrlLoopChange{JobID: j.ID, Sheet: "WIP", Cell: cell, PreviousText: "pending", Text: "9/13/26 2:31PM", SourceURL: link, ArrivalAt: arrival}
		}
		bad := []CtrlLoopSavedWorkbook{{JobID: job.ID, AttachmentID: version1, Changes: []CtrlLoopChange{change(job, "C2")}}, {JobID: secondJob.ID, AttachmentID: version1, Changes: []CtrlLoopChange{change(secondJob, "C4")}}}
		if err := repo.CompleteCtrlLoopRun(ctx, company.CompanyID, run.ID, hash, bad); err == nil {
			t.Fatal("workbook owned by different job published")
		}
		before, err := repo.GetCtrlLoopJob(ctx, company.CompanyID, owner.UserID, job.ID)
		must(err)
		if before.UnseenUpdates != 0 || before.CurrentAttachmentID != job.CurrentAttachmentID || before.LastUpdated != nil {
			t.Fatal("failed save partially published")
		}
		saved := []CtrlLoopSavedWorkbook{{JobID: job.ID, AttachmentID: version1, Changes: []CtrlLoopChange{change(job, "C2")}}, {JobID: secondJob.ID, AttachmentID: version2, Changes: []CtrlLoopChange{change(secondJob, "C4"), change(secondJob, "C5")}}}
		must(repo.CompleteCtrlLoopRun(ctx, company.CompanyID, run.ID, hash, saved))
		fresh := NewPostgresRepo(db)
		after, err := fresh.GetCtrlLoopJob(ctx, company.CompanyID, owner.UserID, job.ID)
		must(err)
		if after.Status != "Listening" || after.UnseenUpdates != 1 || after.LastUpdated == nil || after.CurrentAttachmentID != version1 || after.OriginalAttachmentID != job.OriginalAttachmentID {
			t.Fatalf("wrong durable publication: %+v", after)
		}
		if err := repo.CompleteCtrlLoopRun(ctx, company.CompanyID, run.ID, hash, saved); !errors.Is(err, ErrConflict) {
			t.Fatalf("duplicate completion accepted: %v", err)
		}
		if _, accepted, err := repo.AcceptCtrlLoopRun(ctx, mail, "inbox-fixture"); err != nil || accepted {
			t.Fatalf("completed duplicate reaccepted=%v err=%v", accepted, err)
		}
		changes, runs, more, err := fresh.ListCtrlLoopHistory(ctx, company.CompanyID, owner.UserID, job.ID, "")
		must(err)
		if more || len(changes) != 1 || len(runs) != 1 || runs[0].ChangedCells != 3 || !changes[0].ArrivalAt.Equal(arrival) {
			t.Fatalf("wrong history: %+v %+v", changes, runs)
		}
		otherChanges, _, _, err := fresh.ListCtrlLoopHistory(ctx, company.CompanyID, owner.UserID, secondJob.ID, "")
		must(err)
		must(fresh.MarkCtrlLoopSeen(ctx, company.CompanyID, owner.UserID, job.ID, []string{changes[0].ID, otherChanges[0].ID}))
		after, err = fresh.GetCtrlLoopJob(ctx, company.CompanyID, owner.UserID, job.ID)
		must(err)
		other, err := fresh.GetCtrlLoopJob(ctx, company.CompanyID, owner.UserID, secondJob.ID)
		must(err)
		if after.UnseenUpdates != 0 || other.UnseenUpdates != 2 {
			t.Fatal("mark-seen changed entries outside displayed job")
		}
	})
	t.Run("failed attempt expires and retry starts from latest workbook", func(t *testing.T) {
		mail2 := makeMessage(mailbox, arrival.Add(time.Minute))
		r, _, err := repo.AcceptCtrlLoopRun(ctx, mail2, "inbox-fixture")
		must(err)
		oldHash, newHash := strings.Repeat("2", 64), strings.Repeat("3", 64)
		_, err = repo.StartCtrlLoopRun(ctx, company.CompanyID, r.ID, oldHash, time.Now().Add(-time.Second))
		must(err)
		if _, _, err := repo.AuthorizeCtrlLoopToken(ctx, oldHash); err == nil {
			t.Fatal("expired token accepted")
		}
		must(repo.FailCtrlLoopRun(ctx, company.CompanyID, r.ID, oldHash, "fixture storage unavailable"))
		failed, err := repo.GetCtrlLoopJob(ctx, company.CompanyID, owner.UserID, job.ID)
		must(err)
		if failed.Status != "Error" || failed.Error != "fixture storage unavailable" {
			t.Fatalf("failure state lost: %+v", failed)
		}
		books, err := repo.StartCtrlLoopRun(ctx, company.CompanyID, r.ID, newHash, time.Now().Add(time.Hour))
		must(err)
		for _, book := range books {
			if book.BaseAttachmentID != book.CurrentAttachmentID || book.BaseAttachmentID == book.OriginalAttachmentID {
				t.Fatal("retry did not load latest published workbook")
			}
		}
		if err := repo.StageCtrlLoopTargets(ctx, oldHash, map[string]json.RawMessage{job.ID: stage(job, "C7")}); !errors.Is(err, ErrConflict) {
			t.Fatal("old attempt can stage into new attempt")
		}
		must(repo.SetCtrlLoopSource(ctx, company.CompanyID, r.ID, newHash, link, "retry-session"))
		_, err = repo.FreezeCtrlLoopRun(ctx, company.CompanyID, r.ID, newHash)
		must(err)
		must(repo.CompleteCtrlLoopRun(ctx, company.CompanyID, r.ID, newHash, nil))
		after, err := repo.GetCtrlLoopJob(ctx, company.CompanyID, owner.UserID, job.ID)
		must(err)
		if !after.LastUpdated.Equal(*failed.LastUpdated) || after.UnseenUpdates != failed.UnseenUpdates || after.CurrentAttachmentID != failed.CurrentAttachmentID {
			t.Fatal("unrelated retry advanced workbook/count")
		}
	})
	t.Run("owner deletion retires only exact job files", func(t *testing.T) {
		privateVersion, currentVersion := makeAttachment(otherConnectionJob), makeAttachment(otherConnectionJob)
		incoming := makeMessage(secondMailbox, arrival.Add(3*time.Minute))
		completedRun, _, err := repo.AcceptCtrlLoopRun(ctx, incoming, "inbox-fixture")
		must(err)
		token := strings.Repeat("6", 64)
		books, err := repo.StartCtrlLoopRun(ctx, company.CompanyID, completedRun.ID, token, time.Now().Add(time.Hour))
		must(err)
		if len(books) != 1 || books[0].ID != otherConnectionJob.ID {
			t.Fatal("deletion fixture has unexpected workbooks")
		}
		must(repo.SetCtrlLoopSource(ctx, company.CompanyID, completedRun.ID, token, link, "delete-fixture"))
		must(repo.StageCtrlLoopTargets(ctx, token, map[string]json.RawMessage{otherConnectionJob.ID: stage(otherConnectionJob, "C2")}))
		_, err = repo.FreezeCtrlLoopRun(ctx, company.CompanyID, completedRun.ID, token)
		must(err)
		must(repo.CompleteCtrlLoopRun(ctx, company.CompanyID, completedRun.ID, token, []CtrlLoopSavedWorkbook{{
			JobID: otherConnectionJob.ID, AttachmentID: currentVersion,
			Changes: []CtrlLoopChange{{Sheet: "WIP", Cell: "C2", Text: "9/13/26 2:31PM", SourceURL: link, ArrivalAt: completedRun.ArrivalAt}},
		}}))
		_, err = repo.LinkResourceAttachment(ResourceAttachmentInput{CompanyID: company.CompanyID, ResourceType: "ctrl_loop_job", ResourceID: job.ID, AttachmentID: currentVersion, RelationshipKind: AttachmentRelationshipFileAttachment})
		must(err)
		queuedMail := makeMessage(secondMailbox, arrival.Add(4*time.Minute))
		queuedRun, accepted, err := repo.AcceptCtrlLoopRun(ctx, queuedMail, "inbox-fixture")
		must(err)
		if !accepted {
			t.Fatal("deletion fixture did not queue an incoming email")
		}
		if err := repo.DeleteCtrlLoopJob(ctx, company.CompanyID, stranger.UserID, otherConnectionJob.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("another owner can delete job: %v", err)
		}
		if err := repo.DeleteCtrlLoopJob(ctx, otherCompany.CompanyID, owner.UserID, otherConnectionJob.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("another company can delete job: %v", err)
		}
		must(repo.DeleteCtrlLoopJob(ctx, company.CompanyID, owner.UserID, otherConnectionJob.ID))
		if err := repo.DeleteCtrlLoopJob(ctx, company.CompanyID, owner.UserID, otherConnectionJob.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("repeated deletion did not report missing job: %v", err)
		}
		for _, attachment := range []string{otherConnectionJob.OriginalAttachmentID, privateVersion} {
			var retired bool
			must(db.QueryRow(`SELECT deleted_timestamp IS NOT NULL FROM attachments WHERE company_id=$1 AND attachment_id=$2`, company.CompanyID, attachment).Scan(&retired))
			if !retired {
				t.Fatal("deleted job leaked an owned workbook version")
			}
		}
		for _, attachment := range []string{job.OriginalAttachmentID, currentVersion} {
			var preserved bool
			must(db.QueryRow(`SELECT deleted_timestamp IS NULL FROM attachments WHERE company_id=$1 AND attachment_id=$2`, company.CompanyID, attachment).Scan(&preserved))
			if !preserved {
				t.Fatal("another job's owned file was retired")
			}
		}
		if countPostgresRows(t, db, `SELECT count(*) FROM attachment_relationships WHERE company_id=$1 AND resource_type='ctrl_loop_job' AND resource_id=$2 AND deleted_timestamp IS NULL`, company.CompanyID, otherConnectionJob.ID) != 0 {
			t.Fatal("deleted job left a live attachment owner")
		}
		if countPostgresRows(t, db, `SELECT count(*) FROM ctrl_loop_run_jobs WHERE company_id=$1 AND job_id=$2`, company.CompanyID, otherConnectionJob.ID) != 0 || countPostgresRows(t, db, `SELECT count(*) FROM ctrl_loop_changes WHERE company_id=$1 AND job_id=$2`, company.CompanyID, otherConnectionJob.ID) != 0 {
			t.Fatal("deleted job left work or change history")
		}
		if countPostgresRows(t, db, `SELECT count(*) FROM email_messages WHERE company_id=$1 AND email_message_id IN ($2,$3)`, company.CompanyID, completedRun.EmailMessageID, queuedRun.EmailMessageID) != 2 {
			t.Fatal("job deletion removed a stored source email")
		}
		books, err = repo.StartCtrlLoopRun(ctx, company.CompanyID, queuedRun.ID, token, time.Now().Add(time.Hour))
		must(err)
		if len(books) != 0 {
			t.Fatal("queued email recreated a deleted workbook")
		}
		_, err = repo.FreezeCtrlLoopRun(ctx, company.CompanyID, queuedRun.ID, token)
		must(err)
		must(repo.CompleteCtrlLoopRun(ctx, company.CompanyID, queuedRun.ID, token, nil))
	})
	t.Run("missing owner rejects storage and mailbox cascade preserves shared files", func(t *testing.T) {
		for _, scope := range []struct{ company, job string }{{company.CompanyID, NewUUIDv7String()}, {otherCompany.CompanyID, job.ID}} {
			called := false
			id := NewUUIDv7String()
			_, _, err := repo.CreateAttachmentWithResourceLink(AttachmentCreateInput{CompanyID: scope.company, AttachmentID: id, OriginalFilename: "fixture.xlsx", MimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ByteSize: 100, SHA256: strings.Repeat("a", 64), StorageBucket: "disposable-ctrl-loop", StorageKey: id, SourceKind: AttachmentSourceUserUpload, ResourceLink: ResourceAttachmentInput{CompanyID: scope.company, ResourceType: "ctrl_loop_job", ResourceID: scope.job, RelationshipKind: AttachmentRelationshipFileAttachment}, StoreObject: func(context.Context) error { called = true; return nil }})
			if !errors.Is(err, ErrNotFound) || called {
				t.Fatalf("unavailable owner reached storage: called=%v err=%v", called, err)
			}
		}
		retiring := attach(newJob(secondMailbox, "Mailbox retirement"))
		privateVersion := makeAttachment(retiring)
		_, err := repo.LinkResourceAttachment(ResourceAttachmentInput{CompanyID: company.CompanyID, ResourceType: "ctrl_loop_job", ResourceID: job.ID, AttachmentID: retiring.OriginalAttachmentID, RelationshipKind: AttachmentRelationshipFileAttachment})
		must(err)
		if _, err := db.Exec(`UPDATE attachment_relationships SET editor_surface='editor' WHERE company_id=$1 AND resource_type='ctrl_loop_job' AND resource_id=$2`, company.CompanyID, retiring.ID); err == nil {
			t.Fatal("CtrlLoop file accepted editor attachment shape")
		}
		_, err = db.Exec(`DELETE FROM email_connections WHERE company_id=$1 AND email_connection_id=$2`, company.CompanyID, secondMailbox)
		must(err)
		if _, err := repo.GetCtrlLoopJob(ctx, company.CompanyID, owner.UserID, retiring.ID); !errors.Is(err, ErrNotFound) {
			t.Fatal("mailbox deletion left job")
		}
		var pending, sharedLive bool
		must(db.QueryRow(`SELECT deleted_timestamp IS NOT NULL FROM attachments WHERE company_id=$1 AND attachment_id=$2`, company.CompanyID, privateVersion).Scan(&pending))
		must(db.QueryRow(`SELECT deleted_timestamp IS NULL FROM attachments WHERE company_id=$1 AND attachment_id=$2`, company.CompanyID, retiring.OriginalAttachmentID).Scan(&sharedLive))
		if !pending || !sharedLive {
			t.Fatalf("cascade pending=%v shared live=%v", pending, sharedLive)
		}
		if countPostgresRows(t, db, `SELECT count(*) FROM attachment_relationships WHERE company_id=$1 AND resource_type='ctrl_loop_job' AND resource_id=$2 AND deleted_timestamp IS NULL`, company.CompanyID, retiring.ID) != 0 {
			t.Fatal("mailbox cascade left live attachment edge")
		}
		strangerMailbox := makeMailbox(company.CompanyID, stranger.UserID, "membership-loop@example.test")
		strangerJob, err := repo.SaveCtrlLoopJob(ctx, CtrlLoopJob{CompanyID: company.CompanyID, UserID: stranger.UserID, EmailConnectionID: strangerMailbox, Name: "Membership retirement", Instructions: "Stamp receipt", TimeZone: "UTC"})
		must(err)
		strangerJob = attach(strangerJob)
		_, err = db.Exec(`DELETE FROM company_memberships WHERE company_id=$1 AND user_id=$2`, company.CompanyID, stranger.UserID)
		must(err)
		if countPostgresRows(t, db, `SELECT count(*) FROM ctrl_loop_jobs WHERE company_id=$1 AND job_id=$2`, company.CompanyID, strangerJob.ID) != 0 {
			t.Fatal("membership removal left job")
		}
		must(db.QueryRow(`SELECT deleted_timestamp IS NOT NULL FROM attachments WHERE company_id=$1 AND attachment_id=$2`, company.CompanyID, strangerJob.OriginalAttachmentID).Scan(&pending))
		if !pending {
			t.Fatal("membership cascade leaked workbook")
		}
	})
	t.Run("mailbox disable can report failure and deleted source does not block queue", func(t *testing.T) {
		mail3 := makeMessage(mailbox, arrival.Add(2*time.Minute))
		r, _, err := repo.AcceptCtrlLoopRun(ctx, mail3, "inbox-fixture")
		must(err)
		token := strings.Repeat("4", 64)
		_, err = repo.StartCtrlLoopRun(ctx, company.CompanyID, r.ID, token, time.Now().Add(time.Hour))
		must(err)
		_, err = db.Exec(`UPDATE users SET mailbox_enabled=false WHERE user_id=$1`, owner.UserID)
		must(err)
		must(repo.FailCtrlLoopRun(ctx, company.CompanyID, r.ID, token, "Mailbox was disabled."))
		failed, err := repo.GetCtrlLoopJob(ctx, company.CompanyID, owner.UserID, job.ID)
		must(err)
		if failed.Status != "Error" || failed.Error != "Mailbox was disabled." {
			t.Fatal("eligibility trigger blocked useful error reporting")
		}
		_, err = db.Exec(`UPDATE users SET mailbox_enabled=true WHERE user_id=$1`, owner.UserID)
		must(err)
		_, err = db.Exec(`DELETE FROM email_messages WHERE company_id=$1 AND email_message_id=$2`, company.CompanyID, r.EmailMessageID)
		must(err)
		deleted, err := repo.GetCtrlLoopRun(ctx, company.CompanyID, r.ID)
		must(err)
		if deleted.EmailMessageID != "" || deleted.EmailThreadID != "" {
			t.Fatal("source deletion left stale email identity")
		}
		must(repo.DismissCtrlLoopRun(ctx, company.CompanyID, r.ID, "Source email was deleted before processing."))
		dismissed, err := repo.GetCtrlLoopRun(ctx, company.CompanyID, r.ID)
		must(err)
		after, err := repo.GetCtrlLoopJob(ctx, company.CompanyID, owner.UserID, job.ID)
		must(err)
		if dismissed.Status != "completed" || dismissed.ChangedCells != 0 || dismissed.Error == "" || after.UnseenUpdates != failed.UnseenUpdates || after.CurrentAttachmentID != failed.CurrentAttachmentID || !after.LastUpdated.Equal(*failed.LastUpdated) {
			t.Fatal("deleted-source dismissal changed workbook/count or remained retryable")
		}
	})
}
