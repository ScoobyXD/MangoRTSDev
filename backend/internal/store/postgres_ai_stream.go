package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/binary"
	"sync"
	"time"
)

func (r *PostgresRepo) AcquireAIStream(ctx context.Context, companyID, userID, runID string) (func(), error) {
	if _, err := r.GetAIRun(ctx, companyID, userID, runID); err != nil {
		return nil, err
	}
	conn, err := r.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	// A stable, namespaced key coordinates independent API replicas. A hash
	// collision only refuses an unrelated stream; it never shares stream data.
	hash := sha256.Sum256([]byte("mangorts-ai-stream\x00" + aiScopeKey(companyID, userID, runID)))
	lockID := int64(binary.BigEndian.Uint64(hash[:8]))
	var acquired bool
	if err := conn.QueryRowContext(ctx, `select pg_try_advisory_lock($1::bigint)`, lockID).Scan(&acquired); err != nil {
		discardAIStreamConnection(conn)
		return nil, err
	}
	if !acquired {
		_ = conn.Close()
		return nil, ErrConflict
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			// Request cancellation must not cancel the unlock. If its outcome is
			// uncertain, discard the physical connection instead of pooling a lock.
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			var unlocked bool
			if err := conn.QueryRowContext(cleanup, `select pg_advisory_unlock($1::bigint)`, lockID).Scan(&unlocked); err != nil || !unlocked {
				discardAIStreamConnection(conn)
				return
			}
			_ = conn.Close()
		})
	}, nil
}

func discardAIStreamConnection(conn *sql.Conn) {
	_ = conn.Raw(func(any) error { return driver.ErrBadConn })
	_ = conn.Close()
}
