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
		`select user_id, provider, account_email, grant_id, status, created_timestamp, updated_timestamp
		 from user_email_connections
		 where user_id = $1
		   and account_email = (
		     select lower(btrim(email))
		     from users
		     where user_id = $1
		   )`,
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

func (r *PostgresRepo) GetCompanyEmailConnectionByAccountEmail(companyID, accountEmail string) (domain.UserEmailConnection, error) {
	companyID = strings.TrimSpace(companyID)
	accountEmail = normalizeEmail(accountEmail)
	if companyID == "" || accountEmail == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`select connection.user_id, connection.provider, connection.account_email, connection.grant_id, connection.status,
		        connection.created_timestamp, connection.updated_timestamp
		 from user_email_connections connection
		 join company_memberships membership
		   on membership.user_id = connection.user_id
		 where membership.company_id = $1
		   and connection.account_email = $2
		   and connection.status = 'connected'
		 order by connection.updated_timestamp desc
		 limit 1`,
		companyID,
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
	if err := r.ensureUserEmailConnectionsPerAccountSchema(); err != nil {
		return domain.UserEmailConnection{}, err
	}

	var connection domain.UserEmailConnection
	err := r.db.QueryRow(
		`insert into user_email_connections (user_id, provider, account_email, grant_id, status, created_timestamp, updated_timestamp)
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
	return connection, err
}

func (r *PostgresRepo) DeleteUserEmailConnection(userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(
		`delete from user_email_connections connection
		 using users user_row
		 where connection.user_id = $1
		   and user_row.user_id = connection.user_id
		   and connection.account_email = lower(btrim(user_row.email))`,
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
