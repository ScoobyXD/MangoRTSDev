package store

import (
	"database/sql"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

const postgresEmailConnectionColumns = `
email_connection_id::text,company_id::text,connection_type,
coalesce(personal_user_id::text,''),provider,account_email,grant_id,status,
coalesce(connected_by_user_id::text,''),ingestion_started_at,last_successful_scan_at,
created_timestamp,updated_timestamp`

type postgresEmailConnectionScanner interface{ Scan(...any) error }

func scanPostgresEmailConnection(row postgresEmailConnectionScanner) (domain.UserEmailConnection, error) {
	var connection domain.UserEmailConnection
	var connectionType, connectedByUserID string
	err := row.Scan(
		&connection.EmailConnectionID, &connection.CompanyID, &connectionType,
		&connection.UserID, &connection.Provider, &connection.AccountEmail,
		&connection.GrantID, &connection.Status, &connectedByUserID,
		&connection.IngestionStartedAt, &connection.LastSuccessfulScanAt,
		&connection.CreatedTimestamp, &connection.UpdatedTimestamp,
	)
	if err != nil {
		return domain.UserEmailConnection{}, err
	}
	connection.Scope = connectionType
	if connectionType == "shared" {
		connection.CompanyEmailConnectionID = connection.EmailConnectionID
		connection.UserID = connectedByUserID
	}
	return connection, nil
}

func companyEmailConnectionFromUserConnection(connection domain.UserEmailConnection) domain.CompanyEmailConnection {
	return domain.CompanyEmailConnection{
		EmailConnectionID: connection.EmailConnectionID, CompanyEmailConnectionID: connection.EmailConnectionID,
		CompanyID: connection.CompanyID, Provider: connection.Provider, AccountEmail: connection.AccountEmail,
		GrantID: connection.GrantID, Status: connection.Status, ConnectedByUserID: connection.UserID,
		IngestionStartedAt: connection.IngestionStartedAt, LastSuccessfulScanAt: connection.LastSuccessfulScanAt,
		CreatedTimestamp: connection.CreatedTimestamp, UpdatedTimestamp: connection.UpdatedTimestamp,
	}
}

func scanCompanyEmailConnectionAsUser(connection domain.CompanyEmailConnection) domain.UserEmailConnection {
	return domain.UserEmailConnection{
		EmailConnectionID: connection.EmailConnectionID,
		UserID:            connection.ConnectedByUserID, Provider: connection.Provider,
		AccountEmail: connection.AccountEmail, Scope: "shared", CompanyID: connection.CompanyID,
		CompanyEmailConnectionID: connection.CompanyEmailConnectionID, GrantID: connection.GrantID,
		Status: connection.Status, IngestionStartedAt: connection.IngestionStartedAt,
		LastSuccessfulScanAt: connection.LastSuccessfulScanAt,
		CreatedTimestamp:     connection.CreatedTimestamp, UpdatedTimestamp: connection.UpdatedTimestamp,
	}
}

func (r *PostgresRepo) GetUserEmailConnection(userID string) (domain.UserEmailConnection, error) {
	userID = cleanUUIDText(userID)
	if userID == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}
	connection, err := scanPostgresEmailConnection(r.db.QueryRow(
		`select `+postgresEmailConnectionColumns+`
		 from email_connections connection
		 where connection.connection_type='personal'
		   and connection.personal_user_id=$1::uuid
		   and exists (
		     select 1 from users app_user
		     where app_user.user_id=connection.personal_user_id
		       and connection.account_email=lower(btrim(app_user.email))
		   )
		 order by connection.updated_timestamp desc
		 limit 1`, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.UserEmailConnection{}, ErrNotFound
	}
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
		`select `+postgresEmailConnectionColumns+`
		 from email_connections
		 where connection_type='personal' and personal_user_id=$1::uuid
		 order by updated_timestamp desc, account_email asc`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	connections := make([]domain.UserEmailConnection, 0)
	for rows.Next() {
		connection, err := scanPostgresEmailConnection(rows)
		if err != nil {
			return nil, err
		}
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

	connection, err := scanPostgresEmailConnection(r.db.QueryRow(
		`select `+postgresEmailConnectionColumns+`
		 from email_connections connection
		 where company_id = $1::uuid
		   and connection_type='shared'
		   and account_email = $2
		 limit 1`, companyID, accountEmail))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyEmailConnection{}, ErrNotFound
	}
	return companyEmailConnectionFromUserConnection(connection), err
}

func (r *PostgresRepo) GetCompanyEmailConnectionByID(companyID, connectionID string) (domain.CompanyEmailConnection, error) {
	companyID = strings.TrimSpace(companyID)
	connectionID = strings.TrimSpace(connectionID)
	if companyID == "" || connectionID == "" {
		return domain.CompanyEmailConnection{}, ErrInvalid
	}

	connection, err := scanPostgresEmailConnection(r.db.QueryRow(
		`select `+postgresEmailConnectionColumns+`
		 from email_connections
		 where company_id = $1::uuid
		   and connection_type='shared'
		   and email_connection_id = $2::uuid
		 limit 1`, companyID, connectionID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyEmailConnection{}, ErrNotFound
	}
	return companyEmailConnectionFromUserConnection(connection), err
}

func (r *PostgresRepo) GetCompanyEmailConnectionByGrantID(grantID string) (domain.CompanyEmailConnection, error) {
	grantID = strings.TrimSpace(grantID)
	if grantID == "" {
		return domain.CompanyEmailConnection{}, ErrInvalid
	}

	connection, err := scanPostgresEmailConnection(r.db.QueryRow(
		`select `+postgresEmailConnectionColumns+`
		 from email_connections
		 where grant_id = $1
		   and connection_type='shared'
		 limit 1`, grantID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyEmailConnection{}, ErrNotFound
	}
	return companyEmailConnectionFromUserConnection(connection), err
}

func (r *PostgresRepo) GetUserEmailConnectionByGrantID(grantID string) (domain.UserEmailConnection, error) {
	grantID = strings.TrimSpace(grantID)
	if grantID == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	connection, err := scanPostgresEmailConnection(r.db.QueryRow(
		`select `+postgresEmailConnectionColumns+`
		 from email_connections
		 where grant_id=$1 and connection_type='personal'`, grantID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.UserEmailConnection{}, ErrNotFound
	}
	return connection, err
}

func (r *PostgresRepo) GetEmailConnectionByID(companyID, connectionID string) (domain.UserEmailConnection, error) {
	companyID, connectionID = cleanUUIDText(companyID), cleanUUIDText(connectionID)
	if companyID == "" || connectionID == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}
	connection, err := scanPostgresEmailConnection(r.db.QueryRow(
		`select `+postgresEmailConnectionColumns+`
		 from email_connections
		 where company_id=$1::uuid and email_connection_id=$2::uuid`,
		companyID, connectionID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.UserEmailConnection{}, ErrNotFound
	}
	return connection, err
}

func (r *PostgresRepo) ListConnectedEmailConnections() ([]domain.UserEmailConnection, error) {
	rows, err := r.db.Query(`select ` + postgresEmailConnectionColumns + `
		from email_connections where status='connected'
		order by last_successful_scan_at,email_connection_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.UserEmailConnection{}
	for rows.Next() {
		item, scanErr := scanPostgresEmailConnection(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) UpsertUserEmailConnection(input UserEmailConnectionInput) (domain.UserEmailConnection, error) {
	companyID := cleanUUIDText(input.CompanyID)
	userID := cleanUUIDText(input.UserID)
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
	if companyID == "" {
		rows, err := r.db.Query(`select company_id::text from company_memberships where user_id=$1::uuid order by company_id`, userID)
		if err != nil {
			return domain.UserEmailConnection{}, err
		}
		defer rows.Close()
		companyIDs := []string{}
		for rows.Next() {
			var candidate string
			if err := rows.Scan(&candidate); err != nil {
				return domain.UserEmailConnection{}, err
			}
			companyIDs = append(companyIDs, candidate)
		}
		if err := rows.Err(); err != nil {
			return domain.UserEmailConnection{}, err
		}
		if len(companyIDs) == 0 {
			return domain.UserEmailConnection{}, ErrNotFound
		}
		if len(companyIDs) != 1 {
			return domain.UserEmailConnection{}, ErrInvalid
		}
		companyID = companyIDs[0]
	}
	var member bool
	if err := r.db.QueryRow(`select exists(select 1 from company_memberships where company_id=$1::uuid and user_id=$2::uuid)`, companyID, userID).Scan(&member); err != nil {
		return domain.UserEmailConnection{}, err
	}
	if !member {
		return domain.UserEmailConnection{}, ErrPrincipalNotInCompany
	}

	if scope == "shared" {
		shared, err := r.UpsertCompanyEmailConnection(CompanyEmailConnectionInput{
			CompanyID: companyID, Provider: provider, AccountEmail: accountEmail,
			GrantID: grantID, Status: status, ConnectedByUserID: userID,
		})
		if err != nil {
			return domain.UserEmailConnection{}, err
		}
		return scanCompanyEmailConnectionAsUser(shared), nil
	}

	connection, err := scanPostgresEmailConnection(r.db.QueryRow(
		`insert into email_connections (
		   email_connection_id,company_id,connection_type,personal_user_id,
		   provider,account_email,grant_id,status,connected_by_user_id,
		   ingestion_started_at,last_successful_scan_at,created_timestamp,updated_timestamp
		 )
		 values ($1::uuid,$2::uuid,'personal',$3::uuid,$4,$5,$6,$7,$3::uuid,now(),now(),now(),now())
		 on conflict (company_id,personal_user_id,account_email) where connection_type='personal'
		 do update set
		   provider = excluded.provider,
		   grant_id = excluded.grant_id,
		   status = excluded.status,
		   connected_by_user_id = excluded.connected_by_user_id,
		   updated_timestamp = now()
		 returning `+postgresEmailConnectionColumns,
		newUUIDv7String(), companyID, userID, provider, accountEmail, grantID, status))
	if err == nil && status == "connected" {
		_, err = r.db.Exec(`update email_ingestion_jobs set available_at=now(),updated_timestamp=now()
where company_id=$1::uuid and email_connection_id=$2::uuid
  and status in ('pending','retry')`, connection.CompanyID, connection.EmailConnectionID)
	}
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

	connection, err := scanPostgresEmailConnection(r.db.QueryRow(
		`with existing_connection as (
		   select email_connection_id
		   from email_connections
		   where company_id = $1::uuid and account_email = $4
		     and connection_type='shared'
		   limit 1
		 )
		 insert into email_connections (
		   email_connection_id,
		   company_id,
		   connection_type,
		   personal_user_id,
		   provider,
		   account_email,
		   grant_id,
		   status,
		   connected_by_user_id,
		   ingestion_started_at,
		   last_successful_scan_at,
		   created_timestamp,
		   updated_timestamp
		 )
		 values (coalesce((select email_connection_id from existing_connection), $2::uuid),
		   $1::uuid,'shared',null,$3,$4,$5,$6,nullif($7,'')::uuid,now(),now(),now(),now())
		 on conflict (company_id, account_email) where connection_type='shared' do update set
		   provider = excluded.provider,
		   grant_id = excluded.grant_id,
		   status = excluded.status,
		   connected_by_user_id = excluded.connected_by_user_id,
		   updated_timestamp = now()
		 returning `+postgresEmailConnectionColumns,
		companyID,
		connectionID,
		provider,
		accountEmail,
		grantID,
		status,
		connectedByUserID,
	))
	if err == nil && status == "connected" {
		_, err = r.db.Exec(`update email_ingestion_jobs set available_at=now(),updated_timestamp=now()
where company_id=$1::uuid and email_connection_id=$2::uuid
  and status in ('pending','retry')`, connection.CompanyID, connection.EmailConnectionID)
	}
	return companyEmailConnectionFromUserConnection(connection), err
}

func (r *PostgresRepo) UpdateCompanyEmailConnectionStatus(companyID, connectionID, status string) (domain.CompanyEmailConnection, error) {
	companyID = strings.TrimSpace(companyID)
	connectionID = cleanUUIDText(connectionID)
	status = normalizeEmailConnectionStatus(status)
	if companyID == "" || connectionID == "" || status == "" {
		return domain.CompanyEmailConnection{}, ErrInvalid
	}

	connection, err := scanPostgresEmailConnection(r.db.QueryRow(
		`update email_connections
		 set status = $3,
		     updated_timestamp = now()
		 where company_id = $1::uuid
		   and connection_type='shared'
		   and email_connection_id = $2::uuid
		 returning `+postgresEmailConnectionColumns,
		companyID,
		connectionID,
		status,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyEmailConnection{}, ErrNotFound
	}
	if err == nil && status == "connected" {
		_, err = r.db.Exec(`update email_ingestion_jobs set available_at=now(),updated_timestamp=now()
where company_id=$1::uuid and email_connection_id=$2::uuid
  and status in ('pending','retry')`, connection.CompanyID, connection.EmailConnectionID)
	}
	return companyEmailConnectionFromUserConnection(connection), err
}

func (r *PostgresRepo) UpdateUserEmailConnectionStatus(userID, accountEmail, status string) (domain.UserEmailConnection, error) {
	userID = strings.TrimSpace(userID)
	accountEmail = normalizeEmail(accountEmail)
	status = normalizeEmailConnectionStatus(status)
	if userID == "" || accountEmail == "" || status == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	connection, err := scanPostgresEmailConnection(r.db.QueryRow(
		`update email_connections
		 set status = $2,
		     updated_timestamp = now()
		 where connection_type='personal'
		   and personal_user_id = $1::uuid
		   and account_email = $3
		 returning `+postgresEmailConnectionColumns,
		userID,
		status,
		accountEmail,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.UserEmailConnection{}, ErrNotFound
	}
	if err == nil && status == "connected" {
		_, err = r.db.Exec(`update email_ingestion_jobs set available_at=now(),updated_timestamp=now()
where company_id=$1::uuid and email_connection_id=$2::uuid
  and status in ('pending','retry')`, connection.CompanyID, connection.EmailConnectionID)
	}
	return connection, err
}

func (r *PostgresRepo) DeleteUserEmailConnection(userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(
		`update email_connections connection
		 set status='disconnected',updated_timestamp=now()
		 from users app_user
		 where app_user.user_id=connection.personal_user_id
		   and connection.connection_type='personal'
		   and connection.personal_user_id=$1::uuid
		   and connection.account_email=lower(btrim(app_user.email))`,
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

func (r *PostgresRepo) UpdateEmailConnectionScanCheckpoint(companyID, connectionID string, checkpoint time.Time) error {
	companyID, connectionID = cleanUUIDText(companyID), cleanUUIDText(connectionID)
	if companyID == "" || connectionID == "" || checkpoint.IsZero() {
		return ErrInvalid
	}
	result, err := r.db.Exec(`update email_connections
		set last_successful_scan_at=greatest(last_successful_scan_at,$3),updated_timestamp=now()
		where company_id=$1::uuid and email_connection_id=$2::uuid and status='connected'`,
		companyID, connectionID, checkpoint.UTC())
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
