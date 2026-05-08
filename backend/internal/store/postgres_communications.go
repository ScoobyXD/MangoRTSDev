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

func scanCommunicationsMessageState(row interface {
	Scan(dest ...any) error
}) (domain.CommunicationsMessageState, error) {
	var item domain.CommunicationsMessageState
	var assignedUserID sql.NullString
	var linkedNodeID sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.MessageID,
		&item.SharedInbox,
		&item.Status,
		&assignedUserID,
		&linkedNodeID,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if assignedUserID.Valid {
		value := assignedUserID.String
		item.AssignedUserID = &value
	}
	if linkedNodeID.Valid {
		value := linkedNodeID.String
		item.LinkedNodeID = &value
	}
	return item, err
}

func (r *PostgresRepo) GetCommunicationsMessageState(companyID, messageID string) (domain.CommunicationsMessageState, error) {
	companyID = strings.TrimSpace(companyID)
	messageID = strings.TrimSpace(messageID)
	if companyID == "" || messageID == "" {
		return domain.CommunicationsMessageState{}, ErrInvalid
	}
	item, err := scanCommunicationsMessageState(r.db.QueryRow(
		`select company_id::text, message_id, shared_inbox, status, assigned_user_id::text, linked_node_id::text, created_timestamp, updated_timestamp
		 from communications_message_state
		 where company_id=$1 and message_id=$2`,
		companyID, messageID,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return defaultCommunicationsMessageState(companyID, messageID), nil
	}
	return item, err
}

func (r *PostgresRepo) UpsertCommunicationsMessageState(input CommunicationsMessageStateInput) (domain.CommunicationsMessageState, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	messageID := strings.TrimSpace(input.MessageID)
	if companyID == "" || messageID == "" {
		return domain.CommunicationsMessageState{}, ErrInvalid
	}
	status := ""
	if input.StatusSet {
		status = normalizeCommunicationsMessageStatus(input.Status)
		if status == "" {
			return domain.CommunicationsMessageState{}, ErrInvalid
		}
	}
	assignedUserID := ""
	if input.AssignedUserID != nil {
		assignedUserID = strings.TrimSpace(*input.AssignedUserID)
	}
	linkedNodeID := ""
	if input.LinkedNodeID != nil {
		linkedNodeID = strings.TrimSpace(*input.LinkedNodeID)
	}

	return scanCommunicationsMessageState(r.db.QueryRow(
		`insert into communications_message_state (
		   company_id, message_id, shared_inbox, status, assigned_user_id, linked_node_id, created_timestamp, updated_timestamp
		 )
		 values (
		   $1, $2,
		   case when $3 then $4 else false end,
		   case when $5 then $6 else 'open' end,
		   case when $7 then nullif($8, '')::uuid else null end,
		   case when $9 then nullif($10, '')::uuid else null end,
		   now(), now()
		 )
		 on conflict (company_id, message_id) do update set
		   shared_inbox = case when $3 then excluded.shared_inbox else communications_message_state.shared_inbox end,
		   status = case when $5 then excluded.status else communications_message_state.status end,
		   assigned_user_id = case when $7 then excluded.assigned_user_id else communications_message_state.assigned_user_id end,
		   linked_node_id = case when $9 then excluded.linked_node_id else communications_message_state.linked_node_id end,
		   updated_timestamp = now()
		 returning company_id::text, message_id, shared_inbox, status, assigned_user_id::text, linked_node_id::text, created_timestamp, updated_timestamp`,
		companyID,
		messageID,
		input.SharedInboxSet,
		input.SharedInbox,
		input.StatusSet,
		status,
		input.AssignedUserIDSet,
		assignedUserID,
		input.LinkedNodeIDSet,
		linkedNodeID,
	))
}

func (r *PostgresRepo) ensureCommunicationsMessageState(companyID, messageID string) error {
	_, err := r.db.Exec(
		`insert into communications_message_state (company_id, message_id, created_timestamp, updated_timestamp)
		 values ($1, $2, now(), now())
		 on conflict (company_id, message_id) do nothing`,
		companyID, messageID,
	)
	return err
}

func (r *PostgresRepo) ListCommunicationsMessageComments(companyID, messageID string) ([]domain.CommunicationsMessageComment, error) {
	companyID = strings.TrimSpace(companyID)
	messageID = strings.TrimSpace(messageID)
	if companyID == "" || messageID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.Query(
		`select company_id::text, message_id, comment_id::text, user_id::text, body, created_timestamp, updated_timestamp
		 from communications_message_comments
		 where company_id=$1 and message_id=$2
		 order by created_timestamp asc, comment_id asc`,
		companyID, messageID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CommunicationsMessageComment, 0)
	for rows.Next() {
		var item domain.CommunicationsMessageComment
		if err := rows.Scan(&item.CompanyID, &item.MessageID, &item.CommentID, &item.UserID, &item.Body, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CreateCommunicationsMessageComment(input CommunicationsMessageCommentInput) (domain.CommunicationsMessageComment, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	messageID := strings.TrimSpace(input.MessageID)
	userID := strings.TrimSpace(input.UserID)
	body := strings.TrimSpace(input.Body)
	if companyID == "" || messageID == "" || userID == "" || body == "" {
		return domain.CommunicationsMessageComment{}, ErrInvalid
	}
	if err := r.ensureCommunicationsMessageState(companyID, messageID); err != nil {
		return domain.CommunicationsMessageComment{}, err
	}
	var item domain.CommunicationsMessageComment
	err := r.db.QueryRow(
		`insert into communications_message_comments (company_id, message_id, comment_id, user_id, body, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, $5, now(), now())
		 returning company_id::text, message_id, comment_id::text, user_id::text, body, created_timestamp, updated_timestamp`,
		companyID, messageID, newUUIDv7String(), userID, body,
	).Scan(&item.CompanyID, &item.MessageID, &item.CommentID, &item.UserID, &item.Body, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}

func (r *PostgresRepo) ListCommunicationsSharedDrafts(companyID, messageID string) ([]domain.CommunicationsSharedDraft, error) {
	companyID = strings.TrimSpace(companyID)
	messageID = strings.TrimSpace(messageID)
	if companyID == "" || messageID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.Query(
		`select company_id::text, message_id, draft_id::text, user_id::text, subject, body, created_timestamp, updated_timestamp
		 from communications_shared_drafts
		 where company_id=$1 and message_id=$2
		 order by updated_timestamp desc, draft_id asc`,
		companyID, messageID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CommunicationsSharedDraft, 0)
	for rows.Next() {
		var item domain.CommunicationsSharedDraft
		if err := rows.Scan(&item.CompanyID, &item.MessageID, &item.DraftID, &item.UserID, &item.Subject, &item.Body, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) UpsertCommunicationsSharedDraft(input CommunicationsSharedDraftInput) (domain.CommunicationsSharedDraft, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	messageID := strings.TrimSpace(input.MessageID)
	userID := strings.TrimSpace(input.UserID)
	subject := strings.TrimSpace(input.Subject)
	body := strings.TrimSpace(input.Body)
	if companyID == "" || messageID == "" || userID == "" || (subject == "" && body == "") {
		return domain.CommunicationsSharedDraft{}, ErrInvalid
	}
	if err := r.ensureCommunicationsMessageState(companyID, messageID); err != nil {
		return domain.CommunicationsSharedDraft{}, err
	}
	var item domain.CommunicationsSharedDraft
	err := r.db.QueryRow(
		`insert into communications_shared_drafts (company_id, message_id, user_id, draft_id, subject, body, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, $5, $6, now(), now())
		 on conflict (company_id, message_id, user_id) do update set
		   subject=excluded.subject,
		   body=excluded.body,
		   updated_timestamp=now()
		 returning company_id::text, message_id, draft_id::text, user_id::text, subject, body, created_timestamp, updated_timestamp`,
		companyID, messageID, userID, newUUIDv7String(), subject, body,
	).Scan(&item.CompanyID, &item.MessageID, &item.DraftID, &item.UserID, &item.Subject, &item.Body, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	return item, err
}

func (r *PostgresRepo) ListCommunicationsReadReceipts(companyID, messageID string) ([]domain.CommunicationsReadReceipt, error) {
	companyID = strings.TrimSpace(companyID)
	messageID = strings.TrimSpace(messageID)
	if companyID == "" || messageID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.Query(
		`select company_id::text, message_id, user_id::text, read_timestamp
		 from communications_read_receipts
		 where company_id=$1 and message_id=$2
		 order by read_timestamp desc, user_id asc`,
		companyID, messageID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CommunicationsReadReceipt, 0)
	for rows.Next() {
		var item domain.CommunicationsReadReceipt
		if err := rows.Scan(&item.CompanyID, &item.MessageID, &item.UserID, &item.ReadTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) UpsertCommunicationsReadReceipt(companyID, messageID, userID string) (domain.CommunicationsReadReceipt, error) {
	companyID = strings.TrimSpace(companyID)
	messageID = strings.TrimSpace(messageID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || messageID == "" || userID == "" {
		return domain.CommunicationsReadReceipt{}, ErrInvalid
	}
	if err := r.ensureCommunicationsMessageState(companyID, messageID); err != nil {
		return domain.CommunicationsReadReceipt{}, err
	}
	var item domain.CommunicationsReadReceipt
	err := r.db.QueryRow(
		`insert into communications_read_receipts (company_id, message_id, user_id, read_timestamp)
		 values ($1, $2, $3, now())
		 on conflict (company_id, message_id, user_id) do update set read_timestamp=now()
		 returning company_id::text, message_id, user_id::text, read_timestamp`,
		companyID, messageID, userID,
	).Scan(&item.CompanyID, &item.MessageID, &item.UserID, &item.ReadTimestamp)
	return item, err
}
