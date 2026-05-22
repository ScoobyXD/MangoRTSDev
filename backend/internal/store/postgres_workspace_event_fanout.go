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
	notifications := []WorkspaceEventNotification{notification}
	repo := &PostgresRepo{db: f.db}
	userIDs, err := repo.ListEffectiveUsersForWorkspaceEvent(event)
	if err != nil {
		return err
	}
	notifications = append(notifications, WorkspaceEventNotificationsForUsers(event, userIDs)...)
	for _, item := range notifications {
		payload, err := encodeWorkspaceEventNotification(item)
		if err != nil {
			return err
		}
		if _, err := f.db.ExecContext(ctx, `select pg_notify($1, $2)`, postgresWorkspaceEventFanoutChannel, payload); err != nil {
			return err
		}
	}
	return nil
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
