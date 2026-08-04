package store

import (
	"database/sql"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *PostgresRepo) GetUserEmailConnection(userID string) (domain.UserEmailConnection, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`select connection.user_id, connection.provider, connection.account_email, connection.grant_id,
		        connection.status, connection.created_timestamp, connection.updated_timestamp
		 from user_email_connections connection
		 join users app_user
		   on app_user.user_id = connection.user_id
		  and connection.account_email = lower(btrim(app_user.email))
		 where connection.user_id = $1
		 limit 1`,
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
	connection.Scope = "personal"
	return connection, err
}

func (r *PostgresRepo) ListUserEmailConnections(userID string) ([]domain.UserEmailConnection, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalid
	}

	var userExists bool
	if err := r.db.QueryRow(`select exists(select 1 from users where user_id = $1::uuid)`, userID).Scan(&userExists); err != nil {
		return nil, err
	}
	if !userExists {
		return nil, ErrNotFound
	}

	rows, err := r.db.Query(
		`select user_id, provider, account_email, grant_id, status, created_timestamp, updated_timestamp
		 from user_email_connections
		 where user_id = $1::uuid
		 order by updated_timestamp desc, account_email asc`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	connections := make([]domain.UserEmailConnection, 0)
	for rows.Next() {
		var connection domain.UserEmailConnection
		if err := rows.Scan(
			&connection.UserID,
			&connection.Provider,
			&connection.AccountEmail,
			&connection.GrantID,
			&connection.Status,
			&connection.CreatedTimestamp,
			&connection.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		connection.Scope = "personal"
		connections = append(connections, connection)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return connections, nil
}

func (r *PostgresRepo) GetCompanyEmailConnectionByAccountEmail(companyID, accountEmail string) (domain.CompanyEmailConnection, error) {
	companyID = strings.TrimSpace(companyID)
	accountEmail = normalizeEmail(accountEmail)
	if companyID == "" || accountEmail == "" {
		return domain.CompanyEmailConnection{}, ErrInvalid
	}

	var connection domain.CompanyEmailConnection
	var connectedBy sql.NullString
	err := r.db.QueryRow(
		`select company_email_connection_id::text, company_id::text, provider, account_email, grant_id, status,
		        connected_by_user_id::text,
		        connection.created_timestamp, connection.updated_timestamp
		 from company_email_connections connection
		 where company_id = $1::uuid
		   and account_email = $2
		 limit 1`,
		companyID,
		accountEmail,
	).Scan(
		&connection.CompanyEmailConnectionID,
		&connection.CompanyID,
		&connection.Provider,
		&connection.AccountEmail,
		&connection.GrantID,
		&connection.Status,
		&connectedBy,
		&connection.CreatedTimestamp,
		&connection.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyEmailConnection{}, ErrNotFound
	}
	if connectedBy.Valid {
		connection.ConnectedByUserID = connectedBy.String
	}
	return connection, err
}

func (r *PostgresRepo) GetCompanyEmailConnectionByID(companyID, connectionID string) (domain.CompanyEmailConnection, error) {
	companyID = strings.TrimSpace(companyID)
	connectionID = strings.TrimSpace(connectionID)
	if companyID == "" || connectionID == "" {
		return domain.CompanyEmailConnection{}, ErrInvalid
	}

	var connection domain.CompanyEmailConnection
	var connectedBy sql.NullString
	err := r.db.QueryRow(
		`select company_email_connection_id::text, company_id::text, provider, account_email, grant_id, status,
		        connected_by_user_id::text, created_timestamp, updated_timestamp
		 from company_email_connections
		 where company_id = $1::uuid
		   and company_email_connection_id = $2::uuid
		 limit 1`,
		companyID,
		connectionID,
	).Scan(
		&connection.CompanyEmailConnectionID,
		&connection.CompanyID,
		&connection.Provider,
		&connection.AccountEmail,
		&connection.GrantID,
		&connection.Status,
		&connectedBy,
		&connection.CreatedTimestamp,
		&connection.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyEmailConnection{}, ErrNotFound
	}
	if connectedBy.Valid {
		connection.ConnectedByUserID = connectedBy.String
	}
	return connection, err
}

func (r *PostgresRepo) GetCompanyEmailConnectionByGrantID(grantID string) (domain.CompanyEmailConnection, error) {
	grantID = strings.TrimSpace(grantID)
	if grantID == "" {
		return domain.CompanyEmailConnection{}, ErrInvalid
	}

	var connection domain.CompanyEmailConnection
	var connectedBy sql.NullString
	err := r.db.QueryRow(
		`select company_email_connection_id::text, company_id::text, provider, account_email, grant_id, status,
		        connected_by_user_id::text, created_timestamp, updated_timestamp
		 from company_email_connections
		 where grant_id = $1
		 order by updated_timestamp desc
		 limit 1`,
		grantID,
	).Scan(
		&connection.CompanyEmailConnectionID,
		&connection.CompanyID,
		&connection.Provider,
		&connection.AccountEmail,
		&connection.GrantID,
		&connection.Status,
		&connectedBy,
		&connection.CreatedTimestamp,
		&connection.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyEmailConnection{}, ErrNotFound
	}
	if connectedBy.Valid {
		connection.ConnectedByUserID = connectedBy.String
	}
	return connection, err
}

func (r *PostgresRepo) GetUserEmailConnectionByGrantID(grantID string) (domain.UserEmailConnection, error) {
	grantID = strings.TrimSpace(grantID)
	if grantID == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`select user_id, provider, account_email, grant_id, status, created_timestamp, updated_timestamp
		 from user_email_connections
		 where grant_id = $1`,
		grantID,
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
	connection.Scope = "personal"
	return connection, err
}

func (r *PostgresRepo) UpsertUserEmailConnection(input UserEmailConnectionInput) (domain.UserEmailConnection, error) {
	userID := strings.TrimSpace(input.UserID)
	provider := normalizeEmailProvider(input.Provider)
	accountEmail := normalizeEmail(input.AccountEmail)
	scope := normalizeEmailConnectionScope(input.Scope)
	grantID := strings.TrimSpace(input.GrantID)
	status := normalizeEmailConnectionStatus(input.Status)
	if userID == "" || provider == "" || accountEmail == "" || scope == "" || grantID == "" || status == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}
	var userExists bool
	if err := r.db.QueryRow(`select exists(select 1 from users where user_id = $1::uuid)`, userID).Scan(&userExists); err != nil {
		return domain.UserEmailConnection{}, err
	}
	if !userExists {
		return domain.UserEmailConnection{}, ErrNotFound
	}

	if scope == "shared" {
		if _, bridgeErr := r.db.Exec(`
insert into company_email_connections (
  company_email_connection_id,
  company_id,
  provider,
  account_email,
  grant_id,
  status,
  connected_by_user_id,
  created_timestamp,
  updated_timestamp
)
select
  md5('company_email_connection:' || membership.company_id::text || ':' || $3)::uuid,
  membership.company_id,
  $2,
  $3,
  $4,
  $5,
  $1::uuid,
  now(),
  now()
from company_memberships membership
where membership.user_id = $1::uuid
on conflict (company_id, account_email) do update set
  provider = excluded.provider,
  grant_id = excluded.grant_id,
  status = excluded.status,
  connected_by_user_id = excluded.connected_by_user_id,
  updated_timestamp = now()`,
			userID,
			provider,
			accountEmail,
			grantID,
			status,
		); bridgeErr != nil && !isPostgresUndefinedTable(bridgeErr, "company_email_connections") {
			return domain.UserEmailConnection{}, bridgeErr
		}
		now := time.Now().UTC()
		return domain.UserEmailConnection{
			UserID:           userID,
			Provider:         provider,
			AccountEmail:     accountEmail,
			Scope:            "shared",
			GrantID:          grantID,
			Status:           status,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}, nil
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`with cleared_duplicate_grant as (
		   delete from user_email_connections
		   where grant_id = $4
		     and (user_id <> $1::uuid or account_email <> $3)
		 )
		 insert into user_email_connections (user_id, provider, account_email, grant_id, status, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, $5, now(), now())
		 on conflict (user_id, account_email) do update set
		   provider = excluded.provider,
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
	connection.Scope = "personal"
	return connection, err
}

func (r *PostgresRepo) UpsertCompanyEmailConnection(input CompanyEmailConnectionInput) (domain.CompanyEmailConnection, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	connectionID := cleanUUIDText(input.CompanyEmailConnectionID)
	provider := normalizeEmailProvider(input.Provider)
	accountEmail := normalizeEmail(input.AccountEmail)
	grantID := strings.TrimSpace(input.GrantID)
	status := normalizeEmailConnectionStatus(input.Status)
	connectedByUserID := cleanUUIDText(input.ConnectedByUserID)
	if companyID == "" || provider == "" || accountEmail == "" || grantID == "" || status == "" {
		return domain.CompanyEmailConnection{}, ErrInvalid
	}
	if connectionID == "" {
		connectionID = newUUIDv7String()
	}

	var companyExists bool
	if err := r.db.QueryRow(`select exists(select 1 from companies where company_id = $1::uuid)`, companyID).Scan(&companyExists); err != nil {
		return domain.CompanyEmailConnection{}, err
	}
	if !companyExists {
		return domain.CompanyEmailConnection{}, ErrNotFound
	}
	if connectedByUserID != "" {
		var userExists bool
		if err := r.db.QueryRow(`select exists(select 1 from users where user_id = $1::uuid)`, connectedByUserID).Scan(&userExists); err != nil {
			return domain.CompanyEmailConnection{}, err
		}
		if !userExists {
			return domain.CompanyEmailConnection{}, ErrNotFound
		}
	}

	var connection domain.CompanyEmailConnection
	var connectedBy sql.NullString
	err := r.db.QueryRow(
		`with existing_connection as (
		   select company_email_connection_id
		   from company_email_connections
		   where company_id = $1::uuid and account_email = $4
		   limit 1
		 ), cleared_duplicate_grant as (
		   delete from company_email_connections
		   where company_id = $1::uuid
		     and grant_id = $5
		     and company_email_connection_id <> coalesce((select company_email_connection_id from existing_connection), $2::uuid)
		 )
		 insert into company_email_connections (
		   company_email_connection_id,
		   company_id,
		   provider,
		   account_email,
		   grant_id,
		   status,
		   connected_by_user_id,
		   created_timestamp,
		   updated_timestamp
		 )
		 values (coalesce((select company_email_connection_id from existing_connection), $2::uuid), $1::uuid, $3, $4, $5, $6, nullif($7, '')::uuid, now(), now())
		 on conflict (company_id, account_email) do update set
		   provider = excluded.provider,
		   grant_id = excluded.grant_id,
		   status = excluded.status,
		   connected_by_user_id = excluded.connected_by_user_id,
		   updated_timestamp = now()
		 returning company_email_connection_id::text, company_id::text, provider, account_email, grant_id, status,
		           connected_by_user_id::text, created_timestamp, updated_timestamp`,
		companyID,
		connectionID,
		provider,
		accountEmail,
		grantID,
		status,
		connectedByUserID,
	).Scan(
		&connection.CompanyEmailConnectionID,
		&connection.CompanyID,
		&connection.Provider,
		&connection.AccountEmail,
		&connection.GrantID,
		&connection.Status,
		&connectedBy,
		&connection.CreatedTimestamp,
		&connection.UpdatedTimestamp,
	)
	if connectedBy.Valid {
		connection.ConnectedByUserID = connectedBy.String
	}
	return connection, err
}

func (r *PostgresRepo) UpdateCompanyEmailConnectionStatus(companyID, connectionID, status string) (domain.CompanyEmailConnection, error) {
	companyID = strings.TrimSpace(companyID)
	connectionID = cleanUUIDText(connectionID)
	status = normalizeEmailConnectionStatus(status)
	if companyID == "" || connectionID == "" || status == "" {
		return domain.CompanyEmailConnection{}, ErrInvalid
	}

	var connection domain.CompanyEmailConnection
	var connectedBy sql.NullString
	err := r.db.QueryRow(
		`update company_email_connections
		 set status = $3,
		     updated_timestamp = now()
		 where company_id = $1::uuid
		   and company_email_connection_id = $2::uuid
		 returning company_email_connection_id::text, company_id::text, provider, account_email, grant_id, status,
		           connected_by_user_id::text, created_timestamp, updated_timestamp`,
		companyID,
		connectionID,
		status,
	).Scan(
		&connection.CompanyEmailConnectionID,
		&connection.CompanyID,
		&connection.Provider,
		&connection.AccountEmail,
		&connection.GrantID,
		&connection.Status,
		&connectedBy,
		&connection.CreatedTimestamp,
		&connection.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyEmailConnection{}, ErrNotFound
	}
	if connectedBy.Valid {
		connection.ConnectedByUserID = connectedBy.String
	}
	return connection, err
}

func (r *PostgresRepo) UpdateUserEmailConnectionStatus(userID, accountEmail, status string) (domain.UserEmailConnection, error) {
	userID = strings.TrimSpace(userID)
	accountEmail = normalizeEmail(accountEmail)
	status = normalizeEmailConnectionStatus(status)
	if userID == "" || accountEmail == "" || status == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`update user_email_connections
		 set status = $2,
		     updated_timestamp = now()
		 where user_id = $1
		   and account_email = $3
		 returning user_id, provider, account_email, grant_id, status, created_timestamp, updated_timestamp`,
		userID,
		status,
		accountEmail,
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
	connection.Scope = "personal"
	return connection, err
}

func (r *PostgresRepo) DeleteUserEmailConnection(userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(
		`delete from user_email_connections connection
		 using users app_user
		 where app_user.user_id = connection.user_id
		   and connection.user_id = $1
		   and connection.account_email = lower(btrim(app_user.email))`,
		userID,
	)
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

func (r *PostgresRepo) UpsertCommunicationsMessageReadStatus(input CommunicationsMessageReadStatusInput) (domain.CommunicationsMessageReadStatus, error) {
	scope, ok := communicationsMessageReadStatusScope(input.ScopeType, input.UserID, input.PersonalAccountEmail, input.CompanyID, input.CompanyEmailConnectionID, input.SharedInboxID)
	if !ok {
		return domain.CommunicationsMessageReadStatus{}, ErrInvalid
	}
	messageID := strings.TrimSpace(input.MessageID)
	threadID := strings.TrimSpace(input.ThreadID)
	status := normalizeCommunicationsMessageReadStatus(input.Status)
	if messageID == "" || status == "" {
		return domain.CommunicationsMessageReadStatus{}, ErrInvalid
	}
	signalAt := input.SignalTimestamp.UTC()
	if signalAt.IsZero() {
		signalAt = time.Now().UTC()
	}
	signalCount := input.SignalCount
	if signalCount < 0 {
		signalCount = 0
	}
	initialCount := signalCount
	if initialCount <= 0 {
		initialCount = 1
	}
	signalTimestamps := normalizeCommunicationsMessageReadSignalTimestamps(signalAt, input.SignalTimestamps)
	tx, err := r.db.Begin()
	if err != nil {
		return domain.CommunicationsMessageReadStatus{}, err
	}

	result, err := scanCommunicationsMessageReadReceiptSummary(tx.QueryRow(`
insert into communications_message_read_receipt_summaries (
  receipt_scope_type,
  receipt_scope_id,
  user_id,
  company_id,
  company_email_connection_id,
  shared_inbox_id,
  message_id,
  thread_id,
  status,
  signal_count,
  first_signal_timestamp,
  last_signal_timestamp,
  created_timestamp,
  updated_timestamp
) values ($1, $2, nullif($3, '')::uuid, nullif($4, '')::uuid, nullif($5, '')::uuid, nullif($6, '')::uuid, $7, $8, $9, $10, $11, $11, now(), now())
on conflict (receipt_scope_type, receipt_scope_id, message_id) do update set
  thread_id = case
    when excluded.thread_id <> '' then excluded.thread_id
    else communications_message_read_receipt_summaries.thread_id
  end,
  status = case
    when communications_message_read_receipt_summaries.status = 'read' or excluded.status = 'read' then 'read'
    else 'likely_read'
  end,
  signal_count = case
    when $12::integer > 0 then greatest(communications_message_read_receipt_summaries.signal_count, excluded.signal_count)
    when communications_message_read_receipt_summaries.last_signal_timestamp = excluded.last_signal_timestamp then communications_message_read_receipt_summaries.signal_count
    else communications_message_read_receipt_summaries.signal_count + 1
  end,
  first_signal_timestamp = least(communications_message_read_receipt_summaries.first_signal_timestamp, excluded.first_signal_timestamp),
  last_signal_timestamp = greatest(communications_message_read_receipt_summaries.last_signal_timestamp, excluded.last_signal_timestamp),
  updated_timestamp = now()
returning receipt_scope_type, receipt_scope_id, coalesce(user_id::text, ''), coalesce(company_id::text, ''), coalesce(company_email_connection_id::text, ''), coalesce(shared_inbox_id::text, ''), message_id, thread_id, status, signal_count, first_signal_timestamp, last_signal_timestamp, created_timestamp, updated_timestamp`,
		scope.ScopeType,
		scope.ScopeID,
		scope.UserID,
		scope.CompanyID,
		scope.CompanyEmailConnectionID,
		scope.SharedInboxID,
		messageID,
		threadID,
		status,
		initialCount,
		signalAt,
		signalCount,
	))
	if err != nil {
		_ = tx.Rollback()
		return domain.CommunicationsMessageReadStatus{}, err
	}
	for _, timestamp := range signalTimestamps {
		if _, err := tx.Exec(`
insert into communications_message_read_receipt_signals (receipt_scope_type, receipt_scope_id, message_id, signal_timestamp)
values ($1, $2, $3, $4)
on conflict do nothing`, scope.ScopeType, scope.ScopeID, messageID, timestamp); err != nil {
			_ = tx.Rollback()
			return domain.CommunicationsMessageReadStatus{}, err
		}
	}
	signalRows, err := tx.Query(`
select signal_timestamp
from communications_message_read_receipt_signals
where receipt_scope_type = $1 and receipt_scope_id = $2 and message_id = $3
order by signal_timestamp asc`, scope.ScopeType, scope.ScopeID, messageID)
	if err != nil {
		_ = tx.Rollback()
		return domain.CommunicationsMessageReadStatus{}, err
	}
	for signalRows.Next() {
		var signal domain.CommunicationsMessageReadSignal
		if err := signalRows.Scan(&signal.Timestamp); err != nil {
			_ = signalRows.Close()
			_ = tx.Rollback()
			return domain.CommunicationsMessageReadStatus{}, err
		}
		result.Signals = append(result.Signals, signal)
	}
	if err := signalRows.Err(); err != nil {
		_ = signalRows.Close()
		_ = tx.Rollback()
		return domain.CommunicationsMessageReadStatus{}, err
	}
	if err := signalRows.Close(); err != nil {
		_ = tx.Rollback()
		return domain.CommunicationsMessageReadStatus{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CommunicationsMessageReadStatus{}, err
	}
	result.PersonalAccountEmail = scope.PersonalAccountEmail
	return result, nil
}

func (r *PostgresRepo) ListCommunicationsMessageReadStatuses(input CommunicationsMessageReadStatusListInput) ([]domain.CommunicationsMessageReadStatus, error) {
	scope, ok := communicationsMessageReadStatusScope(input.ScopeType, input.UserID, input.PersonalAccountEmail, input.CompanyID, input.CompanyEmailConnectionID, "")
	if !ok {
		return nil, ErrInvalid
	}
	ids := normalizeUniqueStrings(input.MessageIDs, 0)
	if len(ids) == 0 {
		return []domain.CommunicationsMessageReadStatus{}, nil
	}

	args := []any{scope.ScopeType, scope.ScopeID}
	placeholders := make([]string, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
	}
	rows, err := r.db.Query(`
select receipt_scope_type, receipt_scope_id, coalesce(user_id::text, ''), coalesce(company_id::text, ''), coalesce(company_email_connection_id::text, ''), coalesce(shared_inbox_id::text, ''), message_id, thread_id, status, signal_count, first_signal_timestamp, last_signal_timestamp, created_timestamp, updated_timestamp
from communications_message_read_receipt_summaries
where receipt_scope_type = $1
  and receipt_scope_id = $2
  and message_id in (`+strings.Join(placeholders, ",")+`)
order by last_signal_timestamp desc, message_id asc`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	statusIndexByMessageID := make(map[string]int, len(ids))
	statuses := make([]domain.CommunicationsMessageReadStatus, 0, len(ids))
	for rows.Next() {
		status, err := scanCommunicationsMessageReadReceiptSummary(rows)
		if err != nil {
			return nil, err
		}
		status.PersonalAccountEmail = scope.PersonalAccountEmail
		statusIndexByMessageID[status.MessageID] = len(statuses)
		statuses = append(statuses, status)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	signalRows, err := r.db.Query(`
select message_id, signal_timestamp
from communications_message_read_receipt_signals
where receipt_scope_type = $1
  and receipt_scope_id = $2
  and message_id in (`+strings.Join(placeholders, ",")+`)
order by message_id asc, signal_timestamp asc`, args...)
	if err != nil {
		return nil, err
	}
	defer signalRows.Close()
	for signalRows.Next() {
		var messageID string
		var signal domain.CommunicationsMessageReadSignal
		if err := signalRows.Scan(&messageID, &signal.Timestamp); err != nil {
			return nil, err
		}
		if index, ok := statusIndexByMessageID[messageID]; ok {
			statuses[index].Signals = append(statuses[index].Signals, signal)
		}
	}
	return statuses, signalRows.Err()
}

func scanCommunicationsMessageReadReceiptSummary(row interface {
	Scan(dest ...any) error
}) (domain.CommunicationsMessageReadStatus, error) {
	var status domain.CommunicationsMessageReadStatus
	err := row.Scan(
		&status.ScopeType,
		&status.ScopeID,
		&status.UserID,
		&status.CompanyID,
		&status.CompanyEmailConnectionID,
		&status.SharedInboxID,
		&status.MessageID,
		&status.ThreadID,
		&status.Status,
		&status.SignalCount,
		&status.FirstSignalTimestamp,
		&status.LastSignalTimestamp,
		&status.CreatedTimestamp,
		&status.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsMessageReadStatus{}, ErrNotFound
	}
	return status, err
}
