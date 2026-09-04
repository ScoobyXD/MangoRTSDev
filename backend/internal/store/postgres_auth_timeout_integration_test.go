package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestPostgresProcessMapAuthRequestCancellationRollsBackAndRecoversPool(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Auth cancellation test")
	if err != nil {
		t.Fatal(err)
	}
	const subject = "auth-request-cancellation"
	const originalEmail = "auth-cancel-original@example.com"
	const originalName = "Auth Cancel Original"
	user, err := repo.UpsertAuthUser(subject, originalEmail, originalName)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}

	holderCtx, cancelHolder := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelHolder()
	holder, err := db.Conn(holderCtx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Close()
	holderTx, err := holder.BeginTx(holderCtx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer holderTx.Rollback()
	if _, err := holderTx.ExecContext(holderCtx, `lock table domain_events in access exclusive mode`); err != nil {
		t.Fatal(err)
	}

	requestCtx, cancelRequest := context.WithCancel(context.Background())
	requestDone := make(chan error, 1)
	go func() {
		_, resolveErr := repo.ResolveAuthUserContext(
			requestCtx,
			subject,
			"auth-cancel-updated@example.com",
			"Auth Cancel Updated",
		)
		requestDone <- resolveErr
	}()
	waitForPostgresAuthQueryLock(t, db, "insert into domain_events")
	cancelRequest()

	select {
	case resolveErr := <-requestDone:
		if !errors.Is(resolveErr, context.Canceled) {
			t.Fatalf("canceled auth resolution error = %v, want context.Canceled", resolveErr)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("canceled auth resolution did not return")
	}
	waitForPostgresAuthPoolInUse(t, db, 1)

	stored, err := repo.GetAuthUserContext(context.Background(), subject)
	if err != nil {
		t.Fatal(err)
	}
	if stored.UserID != user.UserID || stored.Email != originalEmail || stored.DisplayName != originalName {
		t.Fatalf("canceled auth transaction persisted user = %+v, want original identity", stored)
	}

	if err := holderTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := holder.Close(); err != nil {
		t.Fatal(err)
	}
	waitForPostgresAuthPoolInUse(t, db, 0)

	recoveryCtx, cancelRecovery := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelRecovery()
	recovered, err := repo.ResolveAuthUserContext(
		recoveryCtx,
		subject,
		"auth-cancel-recovered@example.com",
		"Auth Cancel Recovered",
	)
	if err != nil {
		t.Fatalf("auth resolution after cancellation: %v", err)
	}
	if recovered.Email != "auth-cancel-recovered@example.com" || recovered.DisplayName != "Auth Cancel Recovered" {
		t.Fatalf("recovered auth user = %+v", recovered)
	}
	waitForPostgresAuthPoolInUse(t, db, 0)
}

func TestPostgresProcessMapAuthAdvisoryLockTimeoutRollsBackAndRecoversPool(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	const subject = "auth-advisory-lock-timeout"
	const originalEmail = "auth-lock-original@example.com"
	const originalName = "Auth Lock Original"
	user, err := repo.UpsertAuthUser(subject, originalEmail, originalName)
	if err != nil {
		t.Fatal(err)
	}

	holderCtx, cancelHolder := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelHolder()
	holder, err := db.Conn(holderCtx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Close()
	holderTx, err := holder.BeginTx(holderCtx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer holderTx.Rollback()
	if _, err := holderTx.ExecContext(holderCtx,
		`select pg_advisory_xact_lock(hashtextextended('auth-user:' || $1, 0))`,
		subject,
	); err != nil {
		t.Fatal(err)
	}

	unchangedCtx, cancelUnchanged := context.WithTimeout(context.Background(), 500*time.Millisecond)
	unchanged, err := repo.ResolveAuthUserContext(unchangedCtx, subject, originalEmail, originalName)
	cancelUnchanged()
	if err != nil {
		t.Fatalf("unchanged auth resolution waited on the advisory lock: %v", err)
	}
	if unchanged.UserID != user.UserID || unchanged.Email != originalEmail || unchanged.DisplayName != originalName {
		t.Fatalf("unchanged auth resolution = %+v, want original identity", unchanged)
	}
	waitForPostgresAuthPoolInUse(t, db, 1)

	started := time.Now()
	_, err = repo.ResolveAuthUserContext(
		context.Background(),
		subject,
		"auth-lock-updated@example.com",
		"Auth Lock Updated",
	)
	elapsed := time.Since(started)
	var postgresErr *pgconn.PgError
	if !errors.As(err, &postgresErr) || postgresErr.Code != "55P03" {
		t.Fatalf("blocked auth resolution error = %v, want PostgreSQL lock timeout 55P03", err)
	}
	if elapsed < 750*time.Millisecond || elapsed > 3*time.Second {
		t.Fatalf("PostgreSQL auth lock timeout elapsed = %s, want near one second", elapsed)
	}
	waitForPostgresAuthPoolInUse(t, db, 1)

	stored, err := repo.GetAuthUserContext(context.Background(), subject)
	if err != nil {
		t.Fatal(err)
	}
	if stored.UserID != user.UserID || stored.Email != originalEmail || stored.DisplayName != originalName {
		t.Fatalf("timed-out auth transaction persisted user = %+v, want original identity", stored)
	}

	if err := holderTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := holder.Close(); err != nil {
		t.Fatal(err)
	}
	waitForPostgresAuthPoolInUse(t, db, 0)

	recoveryCtx, cancelRecovery := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelRecovery()
	recovered, err := repo.ResolveAuthUserContext(
		recoveryCtx,
		subject,
		"auth-lock-recovered@example.com",
		"Auth Lock Recovered",
	)
	if err != nil {
		t.Fatalf("auth resolution after lock timeout: %v", err)
	}
	if recovered.Email != "auth-lock-recovered@example.com" || recovered.DisplayName != "Auth Lock Recovered" {
		t.Fatalf("recovered auth user = %+v", recovered)
	}
	waitForPostgresAuthPoolInUse(t, db, 0)
}

func TestPostgresProcessMapDevAdminBootstrapIsAtomicAcrossCallers(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	const subject = "atomic-dev-admin-bootstrap"
	const companyName = "Atomic Dev Admin Bootstrap"
	if _, err := repo.UpsertAuthUser(subject, "atomic-bootstrap@example.com", "Atomic Bootstrap"); err != nil {
		t.Fatal(err)
	}
	type bootstrapResult struct {
		created bool
		err     error
	}
	start := make(chan struct{})
	results := make(chan bootstrapResult, 2)
	for index := 0; index < 2; index++ {
		go func() {
			<-start
			ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
			defer cancel()
			_, created, err := repo.BootstrapDevAdminContext(ctx, subject, companyName)
			results <- bootstrapResult{created: created, err: err}
		}()
	}
	close(start)
	createdCount := 0
	for index := 0; index < 2; index++ {
		result := <-results
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.created {
			createdCount++
		}
	}
	if createdCount != 1 {
		t.Fatalf("atomic bootstrap creations = %d, want 1", createdCount)
	}
	memberships, err := repo.ListUserMembershipsContext(context.Background(), mustPostgresAuthUserID(t, repo, subject))
	if err != nil {
		t.Fatal(err)
	}
	if len(memberships) != 1 || memberships[0].Role != domain.RoleDevAdmin || memberships[0].CompanyName != companyName {
		t.Fatalf("atomic bootstrap memberships = %+v, want one dev-admin membership", memberships)
	}
	var companyCount int
	if err := db.QueryRow(`select count(*) from companies where name=$1`, companyName).Scan(&companyCount); err != nil {
		t.Fatal(err)
	}
	if companyCount != 1 {
		t.Fatalf("atomic bootstrap companies = %d, want 1", companyCount)
	}
	waitForPostgresAuthPoolInUse(t, db, 0)
}

func TestPostgresProcessMapDevAdminBootstrapCancellationLeavesNoOrphanAndRetries(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	const subject = "canceled-dev-admin-bootstrap"
	const companyName = "Canceled Dev Admin Bootstrap"
	user, err := repo.UpsertAuthUser(subject, "canceled-bootstrap@example.com", "Canceled Bootstrap")
	if err != nil {
		t.Fatal(err)
	}

	holderCtx, cancelHolder := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelHolder()
	holder, err := db.Conn(holderCtx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Close()
	holderTx, err := holder.BeginTx(holderCtx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer holderTx.Rollback()
	if _, err := holderTx.ExecContext(holderCtx, `lock table domain_events in access exclusive mode`); err != nil {
		t.Fatal(err)
	}

	requestCtx, cancelRequest := context.WithCancel(context.Background())
	requestDone := make(chan error, 1)
	go func() {
		_, _, bootstrapErr := repo.BootstrapDevAdminContext(requestCtx, subject, companyName)
		requestDone <- bootstrapErr
	}()
	waitForPostgresAuthQueryLock(t, db, "insert into domain_events")
	cancelRequest()
	select {
	case bootstrapErr := <-requestDone:
		if !errors.Is(bootstrapErr, context.Canceled) {
			t.Fatalf("canceled bootstrap error = %v, want context.Canceled", bootstrapErr)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("canceled bootstrap did not return")
	}
	waitForPostgresAuthPoolInUse(t, db, 1)
	var companyCount int
	if err := db.QueryRow(`select count(*) from companies where name=$1`, companyName).Scan(&companyCount); err != nil {
		t.Fatal(err)
	}
	if companyCount != 0 {
		t.Fatalf("companies after canceled bootstrap = %d, want 0", companyCount)
	}
	memberships, err := repo.ListUserMembershipsContext(context.Background(), user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if len(memberships) != 0 {
		t.Fatalf("memberships after canceled bootstrap = %+v, want none", memberships)
	}

	if err := holderTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := holder.Close(); err != nil {
		t.Fatal(err)
	}
	waitForPostgresAuthPoolInUse(t, db, 0)
	retryCtx, cancelRetry := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancelRetry()
	_, created, err := repo.BootstrapDevAdminContext(retryCtx, subject, companyName)
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("bootstrap retry did not create the company and membership")
	}
	waitForPostgresAuthPoolInUse(t, db, 0)
}

func mustPostgresAuthUserID(t *testing.T, repo *PostgresRepo, subject string) string {
	t.Helper()
	user, err := repo.GetAuthUserContext(context.Background(), subject)
	if err != nil {
		t.Fatal(err)
	}
	return user.UserID
}

func waitForPostgresAuthQueryLock(t *testing.T, db *sql.DB, queryFragment string) {
	t.Helper()
	deadline := time.Now().Add(900 * time.Millisecond)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
		var waiting bool
		err := db.QueryRowContext(ctx, `
select exists (
  select 1
  from pg_stat_activity
  where datname=current_database()
    and pid<>pg_backend_pid()
    and wait_event_type='Lock'
    and position(lower($1) in lower(query))>0
)`, queryFragment).Scan(&waiting)
		cancel()
		if err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("auth query containing %q did not reach the expected lock wait", queryFragment)
}

func waitForPostgresAuthPoolInUse(t *testing.T, db *sql.DB, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if got := db.Stats().InUse; got == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("PostgreSQL pool in-use connections = %d, want %d", db.Stats().InUse, want)
}
