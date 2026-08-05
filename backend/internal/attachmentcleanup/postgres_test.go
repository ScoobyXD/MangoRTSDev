package attachmentcleanup

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
)

var finalizeDriverSequence atomic.Uint64

type finalizePreparedDriver struct {
	state *finalizePreparedState
}

type finalizePreparedState struct {
	statements []string
	committed  bool
}

func (d *finalizePreparedDriver) Open(string) (driver.Conn, error) {
	return &finalizePreparedConn{state: d.state}, nil
}

type finalizePreparedConn struct {
	state *finalizePreparedState
}

func (c *finalizePreparedConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepared statements are not used by this test driver")
}

func (c *finalizePreparedConn) Close() error { return nil }

func (c *finalizePreparedConn) Begin() (driver.Tx, error) {
	return &finalizePreparedTx{state: c.state}, nil
}

func (c *finalizePreparedConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return c.Begin()
}

func (c *finalizePreparedConn) CheckNamedValue(*driver.NamedValue) error { return nil }

func (c *finalizePreparedConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	normalized := normalizeFinalizeTestSQL(query)
	switch {
	case strings.Contains(normalized, "select deleted_timestamp is not null"):
		return &finalizePreparedRows{columns: []string{"pending"}, values: [][]driver.Value{{true}}}, nil
	case strings.Contains(normalized, "select exists("):
		return &finalizePreparedRows{columns: []string{"owned"}, values: [][]driver.Value{{false}}}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", normalized)
	}
}

func (c *finalizePreparedConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	trimmed := strings.TrimSpace(query)
	withoutTrailingSemicolon := strings.TrimSuffix(trimmed, ";")
	if strings.Contains(withoutTrailingSemicolon, ";") {
		return nil, errors.New("cannot insert multiple commands into a prepared statement")
	}
	c.state.statements = append(c.state.statements, normalizeFinalizeTestSQL(query))
	return driver.RowsAffected(1), nil
}

type finalizePreparedTx struct {
	state *finalizePreparedState
}

func (t *finalizePreparedTx) Commit() error {
	t.state.committed = true
	return nil
}

func (*finalizePreparedTx) Rollback() error { return nil }

type finalizePreparedRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *finalizePreparedRows) Columns() []string { return r.columns }
func (r *finalizePreparedRows) Close() error      { return nil }
func (r *finalizePreparedRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}

func TestPostgresFinalizeUsesOnePreparedStatementPerDelete(t *testing.T) {
	state := &finalizePreparedState{}
	driverName := fmt.Sprintf("attachmentcleanup_finalize_%d", finalizeDriverSequence.Add(1))
	sql.Register(driverName, &finalizePreparedDriver{state: state})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	err = (PostgresRepository{DB: db}).Finalize(context.Background(), WorkItem{
		Kind:         WorkOrphanAttachment,
		CompanyID:    "11111111-1111-1111-1111-111111111111",
		AttachmentID: "019fcec9-fada-7001-9ba5-dfcea39eaa0f",
	})
	if err != nil {
		t.Fatalf("Finalize must support pgx prepared-statement mode: %v", err)
	}
	if !state.committed {
		t.Fatal("Finalize did not commit")
	}
	if len(state.statements) != 3 {
		t.Fatalf("delete statements=%d, want 3: %v", len(state.statements), state.statements)
	}
	for index, required := range []string{
		"delete from attachment_relationships",
		"delete from attachment_previews",
		"delete from attachments",
	} {
		if !strings.Contains(state.statements[index], required) {
			t.Fatalf("statement %d=%q, want %q", index, state.statements[index], required)
		}
	}
}

func normalizeFinalizeTestSQL(query string) string {
	return strings.ToLower(strings.Join(strings.Fields(query), " "))
}
