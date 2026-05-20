package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"

	"github.com/jackc/pgx/v5"
)

const postgresWorkspaceEventFanoutChannel = "mangorts_workspace_events"

type PostgresWorkspaceEventFanout struct {
	db         *sql.DB
	connString string
}

func NewPostgresWorkspaceEventFanout(db *sql.DB, connString string) *PostgresWorkspaceEventFanout {
	return &PostgresWorkspaceEventFanout{db: db, connString: connString}
}

func (f *PostgresWorkspaceEventFanout) NotifyWorkspaceEvent(ctx context.Context, event domain.DomainEvent) error {
	if f == nil || f.db == nil {
		return ErrInvalid
	}
	notification, ok := WorkspaceEventNotificationFromDomainEvent(event)
	if !ok {
		return nil
	}
	payload, err := encodeWorkspaceEventNotification(notification)
	if err != nil {
		return err
	}
	_, err = f.db.ExecContext(ctx, `select pg_notify($1, $2)`, postgresWorkspaceEventFanoutChannel, payload)
	return err
}

func (f *PostgresWorkspaceEventFanout) ListenWorkspaceEvents(ctx context.Context, notify func(WorkspaceEventNotification)) error {
	if f == nil || f.connString == "" || notify == nil {
		return ErrInvalid
	}
	conn, err := pgx.Connect(ctx, f.connString)
	if err != nil {
		return err
	}
	defer conn.Close(context.Background())

	if _, err := conn.Exec(ctx, "listen "+postgresWorkspaceEventFanoutChannel); err != nil {
		return err
	}
	for {
		pgNotification, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		notification, ok := decodeWorkspaceEventNotification(pgNotification.Payload)
		if !ok {
			continue
		}
		notify(notification)
	}
}
