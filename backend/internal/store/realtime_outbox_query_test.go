package store

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestRealtimeOutboxRecoverySQLIsBoundedAndAggregateFree(t *testing.T) {
	combined := strings.ToLower(realtimeOutboxContiguousPublishedSequenceSQL + "\n" + listPublishedRealtimeOutboxAfterSQL + "\n" + currentPublishedRealtimeOutboxSequenceSQL)
	for _, forbidden := range []string{"min(", "max(", "count(", "context.background"} {
		if strings.Contains(combined, forbidden) {
			t.Fatalf("realtime recovery SQL contains unbounded aggregate or detached context marker %q", forbidden)
		}
	}
	for _, required := range []string{
		"where pending.published_timestamp is null",
		"order by pending.outbox_sequence",
		"order by latest.outbox_sequence desc",
		"outbox_sequence > $1",
		"limit $2",
	} {
		if !strings.Contains(combined, required) {
			t.Fatalf("realtime recovery SQL missing bounded indexed shape %q", required)
		}
	}

	schemaRaw, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	schema := strings.ToLower(string(schemaRaw))
	for _, index := range []string{"idx_realtime_outbox_claim", "idx_realtime_outbox_published_sequence"} {
		if !strings.Contains(schema, index) {
			t.Fatalf("canonical schema missing recovery index %s", index)
		}
	}
}

func TestRealtimeOutboxRecoveryPlansStayIndexedAtScaleAndCrossRolledBackSequenceGap(t *testing.T) {
	db := startDisposableRealtimePlanPostgres(t)
	_, err := db.Exec(`
drop table if exists realtime_outbox;
create unlogged table realtime_outbox (
  outbox_sequence bigserial primary key,
  event_id uuid unique,
  company_id uuid,
  scope text,
  event_type text,
  resource_type text,
  resource_id text,
  permission text,
  resource_revision bigint not null default 0,
  payload jsonb not null default '{}'::jsonb,
  allowed_user_ids jsonb not null default '[]'::jsonb,
  audience_restricted boolean not null default false,
  attempt_count integer not null default 0,
  claim_token uuid,
  claim_expires_at timestamptz,
  published_timestamp timestamptz,
  created_timestamp timestamptz not null default now(),
  last_error_category text
);
create index idx_realtime_outbox_claim
  on realtime_outbox(outbox_sequence)
  where published_timestamp is null;
create index idx_realtime_outbox_published_sequence
  on realtime_outbox(outbox_sequence)
  where published_timestamp is not null;
insert into realtime_outbox(outbox_sequence, published_timestamp)
select value, now() from generate_series(1, 200000) value;
select setval(pg_get_serial_sequence('realtime_outbox', 'outbox_sequence'), 200000, true);
update realtime_outbox set published_timestamp=null where outbox_sequence=199901;
analyze realtime_outbox;`)
	if err != nil {
		t.Fatal(err)
	}

	currentPlan := explainRealtimeQuery(t, db, currentPublishedRealtimeOutboxSequenceSQL)
	assertRealtimePlanUsesIndex(t, currentPlan, "idx_realtime_outbox_claim")
	assertRealtimePlanUsesIndex(t, currentPlan, "realtime_outbox_pkey")
	listPlan := explainRealtimeQuery(t, db, listPublishedRealtimeOutboxAfterSQL, int64(199800), 100)
	assertRealtimePlanUsesIndex(t, listPlan, "idx_realtime_outbox_published_sequence")
	assertRealtimePlanUsesIndex(t, listPlan, "idx_realtime_outbox_claim")
	claimPlan := explainRealtimeQuery(t, db, `
select outbox_sequence
from realtime_outbox
where published_timestamp is null
  and (claim_expires_at is null or claim_expires_at <= now())
order by outbox_sequence
for update skip locked
limit $1`, 100)
	assertRealtimePlanUsesIndex(t, claimPlan, "idx_realtime_outbox_claim")

	// BIGSERIAL values are not transactional. Burn one inside a rolled-back
	// insert, then prove bounded recovery returns the next committed event and
	// the one after it in published order without waiting for the absent value.
	if _, err := db.Exec(`update realtime_outbox set published_timestamp=now() where outbox_sequence=199901`); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	var burnedSequence int64
	if err := tx.QueryRow(`
insert into realtime_outbox(event_id, company_id, scope, event_type, payload, published_timestamp)
values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'notifications:test', 'test.burned', '{}'::jsonb, now())
returning outbox_sequence`).Scan(&burnedSequence); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	repo := NewPostgresRepo(db)
	first, err := repo.EnqueueRealtimeOutbox(context.Background(), RealtimeOutboxInput{
		EventID: "10000000-0000-4000-8000-000000000002", CompanyID: "20000000-0000-4000-8000-000000000001",
		Scope: "notifications:test", EventType: "test.next", Payload: []byte(`{"type":"test.next"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.EnqueueRealtimeOutbox(context.Background(), RealtimeOutboxInput{
		EventID: "10000000-0000-4000-8000-000000000003", CompanyID: "20000000-0000-4000-8000-000000000001",
		Scope: "notifications:test", EventType: "test.later", Payload: []byte(`{"type":"test.later"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`update realtime_outbox set published_timestamp=now() where event_id in ($1::uuid, $2::uuid)`, first.EventID, second.EventID); err != nil {
		t.Fatal(err)
	}
	events, err := repo.ListPublishedRealtimeOutboxAfter(context.Background(), burnedSequence-1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if first.Sequence != burnedSequence+1 || second.Sequence != burnedSequence+2 {
		t.Fatalf("burned=%d next=%d later=%d", burnedSequence, first.Sequence, second.Sequence)
	}
	if len(events) != 2 || events[0].Sequence != first.Sequence || events[1].Sequence != second.Sequence {
		t.Fatalf("recovered sequences after rolled-back BIGSERIAL value = %+v, want %d then %d", events, first.Sequence, second.Sequence)
	}
	assertRealtimeRecoveryLockDeadline(t, db, repo, second.Sequence)
}

func assertRealtimeRecoveryLockDeadline(t *testing.T, db *sql.DB, repo *PostgresRepo, expectedCursor int64) {
	t.Helper()
	writer, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	writerOpen := true
	defer func() {
		if writerOpen {
			_ = writer.Rollback()
		}
	}()
	if _, err := writer.Exec(`
insert into realtime_outbox(event_id, company_id, scope, event_type, payload)
values ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'notifications:test', 'test.open-writer', '{}'::jsonb)`); err != nil {
		t.Fatal(err)
	}

	cursorCtx, cancelCursor := context.WithTimeout(context.Background(), 150*time.Millisecond)
	started := time.Now()
	cursor, cursorErr := repo.CurrentPublishedRealtimeOutboxSequence(cursorCtx)
	cancelCursor()
	if cursorErr == nil || cursor != 0 {
		t.Fatalf("blocked current cursor result=%d err=%v, want no cursor and a deadline error", cursor, cursorErr)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("blocked current cursor ignored its short deadline: %s", elapsed)
	}

	listCtx, cancelList := context.WithTimeout(context.Background(), 150*time.Millisecond)
	started = time.Now()
	blockedEvents, listErr := repo.ListPublishedRealtimeOutboxAfter(listCtx, expectedCursor, 10)
	cancelList()
	if listErr == nil || len(blockedEvents) != 0 {
		t.Fatalf("blocked recovery events=%d err=%v, want no replay and a deadline error", len(blockedEvents), listErr)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("blocked published-list recovery ignored its short deadline: %s", elapsed)
	}

	if err := writer.Rollback(); err != nil {
		t.Fatal(err)
	}
	writerOpen = false
	readyCtx, cancelReady := context.WithTimeout(context.Background(), time.Second)
	defer cancelReady()
	readyCursor, err := repo.CurrentPublishedRealtimeOutboxSequence(readyCtx)
	if err != nil || readyCursor != expectedCursor {
		t.Fatalf("cursor after writer rollback=%d err=%v want %d", readyCursor, err, expectedCursor)
	}
	if _, err := db.ExecContext(readyCtx, `update realtime_outbox set last_error_category='lock-released' where outbox_sequence=1`); err != nil {
		t.Fatalf("timed-out recovery left realtime_outbox locked: %v", err)
	}
}

func assertRealtimePlanUsesIndex(t *testing.T, plan string, acceptableIndexes ...string) {
	t.Helper()
	normalized := strings.ToLower(plan)
	if strings.Contains(normalized, "seq scan on realtime_outbox") {
		t.Fatalf("scaled realtime recovery used a table scan:\n%s", plan)
	}
	for _, index := range acceptableIndexes {
		if strings.Contains(normalized, strings.ToLower(index)) {
			return
		}
	}
	t.Fatalf("scaled realtime recovery plan did not use one of %v:\n%s", acceptableIndexes, plan)
}

func explainRealtimeQuery(t *testing.T, db *sql.DB, query string, args ...any) string {
	t.Helper()
	rows, err := db.Query("explain (analyze, buffers, format text) "+query, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, line)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return strings.Join(lines, "\n")
}

func startDisposableRealtimePlanPostgres(t *testing.T) *sql.DB {
	t.Helper()
	if dsn := strings.TrimSpace(os.Getenv("MANGORTS_REALTIME_PLAN_DATABASE_URL")); dsn != "" {
		db, err := sql.Open("pgx", dsn)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = db.Close() })
		var databaseName string
		var version int
		if err := db.QueryRow("select current_database(), current_setting('server_version_num')::int").Scan(&databaseName, &version); err != nil {
			t.Fatal(err)
		}
		if databaseName != "mangorts_realtime_plan_test" || version < 170000 || version >= 190000 {
			t.Fatalf("refusing non-disposable PostgreSQL database/version %q/%d", databaseName, version)
		}
		return db
	}
	postgresBin := strings.TrimSpace(os.Getenv("POSTGRES_BIN"))
	if postgresBin == "" {
		if initdb, err := exec.LookPath("initdb"); err == nil {
			postgresBin = filepath.Dir(initdb)
		} else {
			t.Skip("PostgreSQL server tools are unavailable; CI supplies POSTGRES_BIN")
		}
	}
	executable := func(name string) string {
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		return filepath.Join(postgresBin, name)
	}
	dataDir := filepath.Join(t.TempDir(), "data")
	if output, err := exec.Command(executable("initdb"), "-D", dataDir, "--no-locale", "--encoding=UTF8", "--auth=trust").CombinedOutput(); err != nil {
		t.Fatalf("init disposable PostgreSQL: %v\n%s", err, output)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	logPath := filepath.Join(filepath.Dir(dataDir), "postgres.log")
	options := fmt.Sprintf("-F -p %d -h 127.0.0.1", port)
	if output, err := exec.Command(executable("pg_ctl"), "-D", dataDir, "-l", logPath, "-o", options, "-w", "start").CombinedOutput(); err != nil {
		t.Fatalf("start disposable PostgreSQL: %v\n%s", err, output)
	}
	t.Cleanup(func() {
		_, _ = exec.Command(executable("pg_ctl"), "-D", dataDir, "-m", "fast", "-w", "stop").CombinedOutput()
	})
	dsn := fmt.Sprintf("host=127.0.0.1 port=%d dbname=postgres sslmode=disable", port)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	return db
}
