package httpapi

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"miraeopus/backend/internal/attachmentcleanup"
	"miraeopus/backend/internal/store"
)

func TestAttachmentDeletionCleanupFailureLogIncludesSafePreparedStatementCause(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:    "42601",
		Message: "cannot insert multiple commands into a prepared statement",
		Detail:  "private database row and provider payload must not appear",
	}
	logged := captureAttachmentDeletionCleanupLog(t, func() {
		logAttachmentDeletionCleanupFailure(
			"item_failed",
			"11111111-1111-1111-1111-111111111111",
			"019fcec9-fada-7001-9ba5-dfcea39eaa0f",
			"finalize_database",
			fmt.Errorf("finalize database cleanup: %w", pgErr),
		)
	})
	for _, required := range []string{
		"status=item_failed",
		"attachment_id=019fcec9-fada-7001-9ba5-dfcea39eaa0f",
		"stage=finalize_database",
		"error_category=invalid_sql_statement",
		"sqlstate=42601",
		`err="multiple commands are not allowed in one prepared statement"`,
	} {
		if !strings.Contains(logged, required) {
			t.Fatalf("safe cleanup log missing %q: %s", required, logged)
		}
	}
	if strings.Contains(logged, pgErr.Detail) {
		t.Fatalf("cleanup log leaked PostgreSQL detail: %s", logged)
	}
}

func TestAttachmentDeletionCleanupFailureLogDoesNotExposeProviderError(t *testing.T) {
	providerPayload := "provider response included a private signed URL and credential"
	logged := captureAttachmentDeletionCleanupLog(t, func() {
		logAttachmentDeletionCleanupFailure(
			"item_failed",
			"11111111-1111-1111-1111-111111111111",
			"019fcec9-fada-7001-9ba5-dfcea39eaa0f",
			"delete_storage_object",
			fmt.Errorf("delete attachment object: %w", errors.New(providerPayload)),
		)
	})
	if !strings.Contains(logged, "error_category=storage_error") ||
		!strings.Contains(logged, `err="attachment storage request failed"`) {
		t.Fatalf("cleanup log did not safely classify storage error: %s", logged)
	}
	if strings.Contains(logged, providerPayload) {
		t.Fatalf("cleanup log leaked provider payload: %s", logged)
	}
}

func TestAttachmentDeletionCleanupConsumerDoesNotPollWhileIdle(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	wake := make(chan struct{}, 1)
	calls := make(chan *attachmentcleanup.Cursor, 3)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runAttachmentDeletionCleanupConsumer(
			ctx,
			wake,
			5*time.Millisecond,
			5*time.Millisecond,
			5*time.Millisecond,
			func(_ context.Context, cursor *attachmentcleanup.Cursor) (attachmentcleanup.DrainResult, error) {
				calls <- cursor
				return attachmentcleanup.DrainResult{}, nil
			},
		)
	}()

	waitForCleanupCall(t, calls)
	select {
	case <-calls:
		t.Fatal("idle consumer ran without a wake or failed work")
	case <-time.After(25 * time.Millisecond):
	}
	wake <- struct{}{}
	waitForCleanupCall(t, calls)
	cancel()
	waitForCleanupStop(t, done)
}

func TestEmailWorkerStartsAttachmentDeletionConsumer(t *testing.T) {
	server := NewServerWithOptions(&store.PostgresRepo{}, ServerOptions{
		EmailWorkerOnly:   true,
		AttachmentStorage: newFakeAttachmentObjectStorage(),
	})
	if server.attachmentDeletionCleanupCancel == nil {
		server.Close()
		t.Fatal("email worker did not start attachment deletion cleanup")
	}
	server.Close()
}

func TestAttachmentDeletionCleanupConsumerRetriesOnlyAfterFailure(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := make(chan *attachmentcleanup.Cursor, 3)
	done := make(chan struct{})
	go func() {
		defer close(done)
		attempts := 0
		runAttachmentDeletionCleanupConsumer(
			ctx,
			make(chan struct{}),
			5*time.Millisecond,
			5*time.Millisecond,
			5*time.Millisecond,
			func(_ context.Context, cursor *attachmentcleanup.Cursor) (attachmentcleanup.DrainResult, error) {
				attempts++
				calls <- cursor
				if attempts == 1 {
					return attachmentcleanup.DrainResult{}, errors.New("temporary database failure")
				}
				return attachmentcleanup.DrainResult{}, nil
			},
		)
	}()

	waitForCleanupCall(t, calls)
	waitForCleanupCall(t, calls)
	select {
	case <-calls:
		t.Fatal("successful retry became an idle polling loop")
	case <-time.After(25 * time.Millisecond):
	}
	cancel()
	waitForCleanupStop(t, done)
}

func TestAttachmentDeletionCleanupConsumerContinuesFromCap(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := make(chan *attachmentcleanup.Cursor, 3)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runAttachmentDeletionCleanupConsumer(
			ctx,
			make(chan struct{}),
			20*time.Millisecond,
			20*time.Millisecond,
			time.Millisecond,
			func(_ context.Context, cursor *attachmentcleanup.Cursor) (attachmentcleanup.DrainResult, error) {
				calls <- cursor
				if cursor == nil {
					return attachmentcleanup.DrainResult{NextCursor: &attachmentcleanup.Cursor{
						CompanyID: "company", AttachmentID: "attachment-1000",
					}}, nil
				}
				return attachmentcleanup.DrainResult{}, nil
			},
		)
	}()

	if cursor := waitForCleanupCall(t, calls); cursor != nil {
		t.Fatalf("startup cursor=%+v", cursor)
	}
	if cursor := waitForCleanupCall(t, calls); cursor == nil || cursor.AttachmentID != "attachment-1000" {
		t.Fatalf("continuation cursor=%+v", cursor)
	}
	select {
	case <-calls:
		t.Fatal("completed continuation became an idle polling loop")
	case <-time.After(25 * time.Millisecond):
	}
	cancel()
	waitForCleanupStop(t, done)
}

func TestAttachmentDeletionFailureBackoffIsBoundedAndResettable(t *testing.T) {
	backoff := newAttachmentDeletionFailureBackoff(time.Minute, time.Hour)
	want := []time.Duration{time.Minute, 2 * time.Minute, 4 * time.Minute, 8 * time.Minute,
		16 * time.Minute, 32 * time.Minute, time.Hour, time.Hour}
	for index, expected := range want {
		if got := backoff.NextDelay(); got != expected {
			t.Fatalf("delay %d=%s, want %s", index, got, expected)
		}
	}
	backoff.Reset()
	if got := backoff.NextDelay(); got != time.Minute {
		t.Fatalf("reset delay=%s, want %s", got, time.Minute)
	}
}

func TestAttachmentDeletionFailureBackoffSurvivesFrequentWakes(t *testing.T) {
	for _, failure := range []string{"drain error", "item failure"} {
		t.Run(failure, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			wake := make(chan struct{}, 1)
			calls := make(chan time.Time, 4)
			done := make(chan struct{})
			producerDone := make(chan struct{})
			go func() {
				defer close(producerDone)
				ticker := time.NewTicker(time.Millisecond)
				defer ticker.Stop()
				for {
					select {
					case <-ctx.Done():
						return
					case <-ticker.C:
						select {
						case wake <- struct{}{}:
						default:
						}
					}
				}
			}()
			go func() {
				defer close(done)
				runAttachmentDeletionCleanupConsumer(ctx, wake, 20*time.Millisecond, 40*time.Millisecond, time.Millisecond,
					func(context.Context, *attachmentcleanup.Cursor) (attachmentcleanup.DrainResult, error) {
						select {
						case calls <- time.Now():
						case <-ctx.Done():
						}
						if failure == "drain error" {
							return attachmentcleanup.DrainResult{}, errors.New("database failed")
						}
						return attachmentcleanup.DrainResult{Result: attachmentcleanup.Result{
							Items: []attachmentcleanup.ItemResult{{Err: errors.New("storage failed")}},
						}}, nil
					})
			}()
			previous := waitForCleanupAttemptTime(t, calls)
			for _, minimum := range []time.Duration{20 * time.Millisecond, 40 * time.Millisecond} {
				current := waitForCleanupAttemptTime(t, calls)
				if elapsed := current.Sub(previous); elapsed < minimum {
					t.Fatalf("producer wake shortened failure retry to %s; want at least %s", elapsed, minimum)
				}
				previous = current
			}
			cancel()
			waitForCleanupStop(t, done)
			waitForCleanupStop(t, producerDone)
		})
	}
}

func TestAttachmentDeletionFailedSweepWakeHonorsRetryDelay(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	wake := make(chan struct{}, 1)
	calls := make(chan *attachmentcleanup.Cursor, 4)
	attemptTimes := make(chan time.Time, 4)
	done := make(chan struct{})
	go func() {
		defer close(done)
		attempt := 0
		runAttachmentDeletionCleanupConsumer(ctx, wake, 20*time.Millisecond, 40*time.Millisecond, time.Millisecond,
			func(_ context.Context, cursor *attachmentcleanup.Cursor) (attachmentcleanup.DrainResult, error) {
				attempt++
				attemptTimes <- time.Now()
				calls <- cursor
				if attempt == 1 {
					wake <- struct{}{}
					return attachmentcleanup.DrainResult{
						Result:     attachmentcleanup.Result{Items: []attachmentcleanup.ItemResult{{Err: errors.New("storage failed")}}},
						NextCursor: &attachmentcleanup.Cursor{CompanyID: "company", AttachmentID: "1000"},
					}, nil
				}
				return attachmentcleanup.DrainResult{}, nil
			})
	}()
	waitForCleanupCall(t, calls)
	waitForCleanupAttemptTime(t, attemptTimes)
	if cursor := waitForCleanupCall(t, calls); cursor == nil {
		t.Fatal("failed early item blocked later backlog")
	}
	second := waitForCleanupAttemptTime(t, attemptTimes)
	if cursor := waitForCleanupCall(t, calls); cursor != nil {
		t.Fatal("retry did not revisit failed early work")
	}
	if elapsed := waitForCleanupAttemptTime(t, attemptTimes).Sub(second); elapsed < 20*time.Millisecond {
		t.Fatalf("backlog wake bypassed failure retry delay: %s", elapsed)
	}
	select {
	case <-calls:
		t.Fatal("settled retry kept scanning")
	case <-time.After(25 * time.Millisecond):
	}
	cancel()
	waitForCleanupStop(t, done)
}

func waitForCleanupAttemptTime(t *testing.T, calls <-chan time.Time) time.Time {
	t.Helper()
	select {
	case at := <-calls:
		return at
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for attachment cleanup attempt")
		return time.Time{}
	}
}

func TestAttachmentDeletionCleanupWakeDuringBacklogRevisitsEarlierIDs(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	wake := make(chan struct{}, 1)
	calls := make(chan *attachmentcleanup.Cursor, 4)
	done := make(chan struct{})
	go func() {
		defer close(done)
		attempt := 0
		runAttachmentDeletionCleanupConsumer(ctx, wake, time.Millisecond, time.Millisecond, time.Millisecond,
			func(_ context.Context, cursor *attachmentcleanup.Cursor) (attachmentcleanup.DrainResult, error) {
				attempt++
				calls <- cursor
				if attempt == 1 {
					// Another deletion commits at an earlier ID while this pass runs.
					wake <- struct{}{}
					return attachmentcleanup.DrainResult{NextCursor: &attachmentcleanup.Cursor{CompanyID: "company", AttachmentID: "1000"}}, nil
				}
				return attachmentcleanup.DrainResult{}, nil
			})
	}()
	if cursor := waitForCleanupCall(t, calls); cursor != nil {
		t.Fatal("startup must start from the beginning")
	}
	if cursor := waitForCleanupCall(t, calls); cursor == nil {
		t.Fatal("wake discarded known later backlog")
	}
	if cursor := waitForCleanupCall(t, calls); cursor != nil {
		t.Fatal("wake did not revisit earlier committed IDs")
	}
	select {
	case <-calls:
		t.Fatal("settled consumer kept scanning")
	case <-time.After(25 * time.Millisecond):
	}
	cancel()
	waitForCleanupStop(t, done)
}

func TestAttachmentDeletionCleanupRetriesFailedItemAfterLaterBacklog(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := make(chan *attachmentcleanup.Cursor, 4)
	done := make(chan struct{})
	go func() {
		defer close(done)
		attempt := 0
		runAttachmentDeletionCleanupConsumer(ctx, make(chan struct{}), time.Millisecond, time.Millisecond, time.Millisecond,
			func(_ context.Context, cursor *attachmentcleanup.Cursor) (attachmentcleanup.DrainResult, error) {
				attempt++
				calls <- cursor
				if attempt == 1 {
					return attachmentcleanup.DrainResult{
						Result:     attachmentcleanup.Result{Items: []attachmentcleanup.ItemResult{{Err: errors.New("storage failure")}}},
						NextCursor: &attachmentcleanup.Cursor{CompanyID: "company", AttachmentID: "1000"},
					}, nil
				}
				return attachmentcleanup.DrainResult{}, nil
			})
	}()
	waitForCleanupCall(t, calls)
	if cursor := waitForCleanupCall(t, calls); cursor == nil {
		t.Fatal("failed early item blocked later backlog")
	}
	if cursor := waitForCleanupCall(t, calls); cursor != nil {
		t.Fatal("failed early item was lost after continuation")
	}
	select {
	case <-calls:
		t.Fatal("settled retry kept scanning")
	case <-time.After(25 * time.Millisecond):
	}
	cancel()
	waitForCleanupStop(t, done)
}

func waitForCleanupCall(t *testing.T, calls <-chan *attachmentcleanup.Cursor) *attachmentcleanup.Cursor {
	t.Helper()
	select {
	case cursor := <-calls:
		return cursor
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for attachment cleanup call")
		return nil
	}
}

func waitForCleanupStop(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("attachment cleanup consumer did not stop after cancellation")
	}
}

func captureAttachmentDeletionCleanupLog(t *testing.T, write func()) string {
	t.Helper()
	var logs bytes.Buffer
	previousWriter, previousFlags, previousPrefix := log.Writer(), log.Flags(), log.Prefix()
	log.SetOutput(&logs)
	log.SetFlags(0)
	log.SetPrefix("")
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
		log.SetPrefix(previousPrefix)
	})
	write()
	return logs.String()
}
