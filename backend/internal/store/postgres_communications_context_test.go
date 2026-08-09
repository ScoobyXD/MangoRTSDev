package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"testing"
	"time"
)

type blockedContextDriver struct {
	started chan struct{}
}

func (d *blockedContextDriver) Open(string) (driver.Conn, error) {
	return &blockedContextConn{started: d.started}, nil
}

type blockedContextConn struct {
	started chan struct{}
}

func (c *blockedContextConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected contextless prepare")
}
func (c *blockedContextConn) Close() error              { return nil }
func (c *blockedContextConn) Begin() (driver.Tx, error) { return nil, errors.New("unexpected begin") }
func (c *blockedContextConn) QueryContext(ctx context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	select {
	case <-c.started:
	default:
		close(c.started)
	}
	<-ctx.Done()
	return nil, ctx.Err()
}

var _ driver.QueryerContext = (*blockedContextConn)(nil)

type unreachableRows struct{}

func (unreachableRows) Columns() []string         { return nil }
func (unreachableRows) Close() error              { return nil }
func (unreachableRows) Next([]driver.Value) error { return io.EOF }

func TestPostgresWebhookGrantLookupStopsWhenRequestContextIsCanceled(t *testing.T) {
	started := make(chan struct{})
	driverName := fmt.Sprintf("mangorts-blocked-webhook-%d", time.Now().UnixNano())
	sql.Register(driverName, &blockedContextDriver{started: started})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewPostgresRepo(db)
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, lookupErr := repo.GetUserEmailConnectionByGrantIDContext(ctx, "grant-blocked-by-database")
		result <- lookupErr
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("PostgreSQL grant lookup did not begin")
	}
	cancel()
	select {
	case lookupErr := <-result:
		if !errors.Is(lookupErr, context.Canceled) {
			t.Fatalf("canceled PostgreSQL lookup error=%v, want context.Canceled", lookupErr)
		}
	case <-time.After(time.Second):
		t.Fatal("PostgreSQL grant lookup continued after request cancellation")
	}
}
