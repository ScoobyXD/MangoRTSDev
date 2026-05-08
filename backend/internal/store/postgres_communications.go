package store

import (
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) GetUserEmailConnection(userID string) (domain.UserEmailConnection, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`select user_id, provider, account_email, grant_id, status, created_timestamp, updated_timestamp
		 from user_email_connections
		 where user_id = $1`,
		userID,
	).Scan(
		&connection.UserID,
		&connection.Provider,
		&connection.AccountEmail,
		&connection.GrantID,
		&connection.Status,
		&connection.CreatedTimestamp,
		&connection.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.UserEmailConnection{}, ErrNotFound
	}
	return connection, err
}

func (r *PostgresRepo) UpsertUserEmailConnection(input UserEmailConnectionInput) (domain.UserEmailConnection, error) {
	userID := strings.TrimSpace(input.UserID)
	provider := normalizeEmailProvider(input.Provider)
	accountEmail := normalizeEmail(input.AccountEmail)
	grantID := strings.TrimSpace(input.GrantID)
	status := normalizeEmailConnectionStatus(input.Status)
	if userID == "" || provider == "" || accountEmail == "" || grantID == "" || status == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`insert into user_email_connections (user_id, provider, account_email, grant_id, status, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, $5, now(), now())
		 on conflict (user_id) do update set
		   provider = excluded.provider,
		   account_email = excluded.account_email,
		   grant_id = excluded.grant_id,
		   status = excluded.status,
		   updated_timestamp = now()
		 returning user_id, provider, account_email, grant_id, status, created_timestamp, updated_timestamp`,
		userID,
		provider,
		accountEmail,
		grantID,
		status,
	).Scan(
		&connection.UserID,
		&connection.Provider,
		&connection.AccountEmail,
		&connection.GrantID,
		&connection.Status,
		&connection.CreatedTimestamp,
		&connection.UpdatedTimestamp,
	)
	return connection, err
}

func (r *PostgresRepo) UpdateUserEmailConnectionStatus(userID, status string) (domain.UserEmailConnection, error) {
	userID = strings.TrimSpace(userID)
	status = normalizeEmailConnectionStatus(status)
	if userID == "" || status == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`update user_email_connections
		 set status = $2,
		     updated_timestamp = now()
		 where user_id = $1
		 returning user_id, provider, account_email, grant_id, status, created_timestamp, updated_timestamp`,
		userID,
		status,
	).Scan(
		&connection.UserID,
		&connection.Provider,
		&connection.AccountEmail,
		&connection.GrantID,
		&connection.Status,
		&connection.CreatedTimestamp,
		&connection.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.UserEmailConnection{}, ErrNotFound
	}
	return connection, err
}

func (r *PostgresRepo) DeleteUserEmailConnection(userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(`delete from user_email_connections where user_id = $1`, userID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}
