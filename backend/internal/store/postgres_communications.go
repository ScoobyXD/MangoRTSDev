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
	if err := r.ensureUserEmailConnectionsPerAccountSchema(); err != nil {
		return domain.UserEmailConnection{}, err
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`select connection.user_id, connection.provider, connection.account_email, connection.connection_scope, connection.grant_id,
		        connection.status, connection.created_timestamp, connection.updated_timestamp
		 from user_email_connections connection
		 join users app_user
		   on app_user.user_id = connection.user_id
		  and connection.account_email = lower(btrim(app_user.email))
		 where connection.user_id = $1
		   and connection.connection_scope = 'personal'
		 limit 1`,
		userID,
	).Scan(
		&connection.UserID,
		&connection.Provider,
		&connection.AccountEmail,
		&connection.Scope,
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

func (r *PostgresRepo) ListUserEmailConnections(userID string) ([]domain.UserEmailConnection, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalid
	}
	if err := r.ensureUserEmailConnectionsPerAccountSchema(); err != nil {
		return nil, err
	}

	var userExists bool
	if err := r.db.QueryRow(`select exists(select 1 from users where user_id = $1::uuid)`, userID).Scan(&userExists); err != nil {
		return nil, err
	}
	if !userExists {
		return nil, ErrNotFound
	}

	rows, err := r.db.Query(
		`select user_id, provider, account_email, connection_scope, grant_id, status, created_timestamp, updated_timestamp
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
			&connection.Scope,
			&connection.GrantID,
			&connection.Status,
			&connection.CreatedTimestamp,
			&connection.UpdatedTimestamp,
		); err != nil {
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

func (r *PostgresRepo) GetUserEmailConnectionByGrantID(grantID string) (domain.UserEmailConnection, error) {
	grantID = strings.TrimSpace(grantID)
	if grantID == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}
	if err := r.ensureUserEmailConnectionsPerAccountSchema(); err != nil {
		return domain.UserEmailConnection{}, err
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`select user_id, provider, account_email, connection_scope, grant_id, status, created_timestamp, updated_timestamp
		 from user_email_connections
		 where grant_id = $1`,
		grantID,
	).Scan(
		&connection.UserID,
		&connection.Provider,
		&connection.AccountEmail,
		&connection.Scope,
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
	scope := normalizeEmailConnectionScope(input.Scope)
	grantID := strings.TrimSpace(input.GrantID)
	status := normalizeEmailConnectionStatus(input.Status)
	if userID == "" || provider == "" || accountEmail == "" || scope == "" || grantID == "" || status == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}
	if err := r.ensureUserEmailConnectionsPerAccountSchema(); err != nil {
		return domain.UserEmailConnection{}, err
	}
	var userExists bool
	if err := r.db.QueryRow(`select exists(select 1 from users where user_id = $1::uuid)`, userID).Scan(&userExists); err != nil {
		return domain.UserEmailConnection{}, err
	}
	if !userExists {
		return domain.UserEmailConnection{}, ErrNotFound
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`with cleared_duplicate_grant as (
		   delete from user_email_connections
		   where grant_id = $5
		     and (user_id <> $1::uuid or account_email <> $3)
		 )
		 insert into user_email_connections (user_id, provider, account_email, connection_scope, grant_id, status, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, $5, $6, now(), now())
		 on conflict (user_id, account_email) do update set
		   provider = excluded.provider,
		   connection_scope = excluded.connection_scope,
		   grant_id = excluded.grant_id,
		   status = excluded.status,
		   updated_timestamp = now()
		 returning user_id, provider, account_email, connection_scope, grant_id, status, created_timestamp, updated_timestamp`,
		userID,
		provider,
		accountEmail,
		scope,
		grantID,
		status,
	).Scan(
		&connection.UserID,
		&connection.Provider,
		&connection.AccountEmail,
		&connection.Scope,
		&connection.GrantID,
		&connection.Status,
		&connection.CreatedTimestamp,
		&connection.UpdatedTimestamp,
	)
	if err == nil && scope == "shared" {
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
	if err := r.ensureUserEmailConnectionsPerAccountSchema(); err != nil {
		return domain.UserEmailConnection{}, err
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`update user_email_connections
		 set status = $2,
		     updated_timestamp = now()
		 where user_id = $1
		   and account_email = $3
		 returning user_id, provider, account_email, connection_scope, grant_id, status, created_timestamp, updated_timestamp`,
		userID,
		status,
		accountEmail,
	).Scan(
		&connection.UserID,
		&connection.Provider,
		&connection.AccountEmail,
		&connection.Scope,
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
	if err := r.ensureUserEmailConnectionsPerAccountSchema(); err != nil {
		return err
	}
	result, err := r.db.Exec(
		`delete from user_email_connections connection
		 using users app_user
		 where app_user.user_id = connection.user_id
		   and connection.user_id = $1
		   and connection.connection_scope = 'personal'
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

func (r *PostgresRepo) ensureUserEmailConnectionsPerAccountSchema() error {
	if r == nil || r.db == nil {
		return ErrInvalid
	}
	r.userEmailConnectionsPerAccountSchemaOnce.Do(func() {
		_, r.userEmailConnectionsPerAccountSchemaErr = r.db.Exec(`
do $$
declare
  pk_name text;
  pk_def text;
begin
  if to_regclass('public.user_email_connections') is null then
    return;
  end if;

  alter table public.user_email_connections
    add column if not exists connection_scope text not null default 'personal';

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_email_connections'::regclass
      and conname = 'user_email_connections_scope_chk'
  ) then
    alter table public.user_email_connections
      add constraint user_email_connections_scope_chk check (connection_scope in ('personal', 'shared'));
  end if;

  select conname, pg_get_constraintdef(oid)
    into pk_name, pk_def
  from pg_constraint
  where conrelid = 'public.user_email_connections'::regclass
    and contype = 'p'
  limit 1;

  if pk_name is not null and pk_def <> 'PRIMARY KEY (user_id, account_email)' then
    execute format('alter table public.user_email_connections drop constraint %I', pk_name);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_email_connections'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, account_email)'
  ) then
    alter table public.user_email_connections add primary key (user_id, account_email);
  end if;

  create unique index if not exists idx_user_email_connections_grant_id
    on public.user_email_connections(grant_id);

  create index if not exists idx_user_email_connections_user_updated
    on public.user_email_connections(user_id, updated_timestamp desc);
end $$;`)
	})
	return r.userEmailConnectionsPerAccountSchemaErr
}

func (r *PostgresRepo) UpsertCommunicationsMessageReadStatus(input CommunicationsMessageReadStatusInput) (domain.CommunicationsMessageReadStatus, error) {
	if err := r.ensureCommunicationsMessageReadStatusSchema(); err != nil {
		return domain.CommunicationsMessageReadStatus{}, err
	}
	userID := strings.TrimSpace(input.UserID)
	messageID := strings.TrimSpace(input.MessageID)
	threadID := strings.TrimSpace(input.ThreadID)
	status := normalizeCommunicationsMessageReadStatus(input.Status)
	if userID == "" || messageID == "" || status == "" {
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

	return scanCommunicationsMessageReadStatus(r.db.QueryRow(`
insert into communications_message_read_statuses (
  user_id,
  message_id,
  thread_id,
  status,
  signal_count,
  first_signal_timestamp,
  last_signal_timestamp,
  created_timestamp,
  updated_timestamp
) values ($1, $2, $3, $4, $5, $6, $6, now(), now())
on conflict (user_id, message_id) do update set
  thread_id = case
    when excluded.thread_id <> '' then excluded.thread_id
    else communications_message_read_statuses.thread_id
  end,
  status = case
    when communications_message_read_statuses.status = 'read' or excluded.status = 'read' then 'read'
    else 'likely_read'
  end,
  signal_count = case
    when $7::integer > 0 then greatest(communications_message_read_statuses.signal_count, excluded.signal_count)
    else communications_message_read_statuses.signal_count + 1
  end,
  first_signal_timestamp = least(communications_message_read_statuses.first_signal_timestamp, excluded.first_signal_timestamp),
  last_signal_timestamp = greatest(communications_message_read_statuses.last_signal_timestamp, excluded.last_signal_timestamp),
  updated_timestamp = now()
returning user_id::text, message_id, thread_id, status, signal_count, first_signal_timestamp, last_signal_timestamp, created_timestamp, updated_timestamp`,
		userID,
		messageID,
		threadID,
		status,
		initialCount,
		signalAt,
		signalCount,
	))
}

func (r *PostgresRepo) ListCommunicationsMessageReadStatuses(userID string, messageIDs []string) ([]domain.CommunicationsMessageReadStatus, error) {
	if err := r.ensureCommunicationsMessageReadStatusSchema(); err != nil {
		return nil, err
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalid
	}
	ids := normalizeUniqueStrings(messageIDs, 0)
	if len(ids) == 0 {
		return []domain.CommunicationsMessageReadStatus{}, nil
	}

	args := []any{userID}
	placeholders := make([]string, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
	}
	rows, err := r.db.Query(`
select user_id::text, message_id, thread_id, status, signal_count, first_signal_timestamp, last_signal_timestamp, created_timestamp, updated_timestamp
from communications_message_read_statuses
where user_id = $1
  and message_id in (`+strings.Join(placeholders, ",")+`)
order by last_signal_timestamp desc, message_id asc`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	statuses := make([]domain.CommunicationsMessageReadStatus, 0, len(ids))
	for rows.Next() {
		status, err := scanCommunicationsMessageReadStatus(rows)
		if err != nil {
			return nil, err
		}
		statuses = append(statuses, status)
	}
	return statuses, rows.Err()
}

func (r *PostgresRepo) ensureCommunicationsMessageReadStatusSchema() error {
	if r == nil || r.db == nil {
		return ErrInvalid
	}
	r.communicationsMessageReadStatusSchemaOnce.Do(func() {
		_, r.communicationsMessageReadStatusSchemaErr = r.db.Exec(`
create table if not exists communications_message_read_statuses (
  user_id uuid not null references users(user_id) on delete cascade,
  message_id text not null,
  thread_id text not null default '',
  status text not null default 'likely_read',
  signal_count integer not null default 0,
  first_signal_timestamp timestamptz not null,
  last_signal_timestamp timestamptz not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (user_id, message_id),
  constraint communications_message_read_statuses_message_id_chk check (btrim(message_id) <> ''),
  constraint communications_message_read_statuses_status_chk check (status in ('likely_read', 'read')),
  constraint communications_message_read_statuses_signal_count_chk check (signal_count >= 0)
);

create index if not exists idx_communications_message_read_statuses_user_thread
  on communications_message_read_statuses(user_id, thread_id)
  where thread_id <> '';

create index if not exists idx_communications_message_read_statuses_user_latest
  on communications_message_read_statuses(user_id, last_signal_timestamp desc);`)
	})
	return r.communicationsMessageReadStatusSchemaErr
}

func scanCommunicationsMessageReadStatus(row interface {
	Scan(dest ...any) error
}) (domain.CommunicationsMessageReadStatus, error) {
	var status domain.CommunicationsMessageReadStatus
	err := row.Scan(
		&status.UserID,
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
