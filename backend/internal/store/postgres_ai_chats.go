package store

import (
	"context"
	"database/sql"
	"errors"
)

const aiChatColumns = `c.company_id::text,c.user_id::text,c.chat_id,c.name,c.created_timestamp`
const aiMessageColumns = `m.company_id::text,m.user_id::text,m.message_id,m.chat_id,coalesce(m.run_id::text,''),m.role,m.content,m.created_timestamp`

func scanAIChat(row interface{ Scan(...any) error }) (AIChat, error) {
	var chat AIChat
	err := row.Scan(&chat.CompanyID, &chat.UserID, &chat.ChatID, &chat.Name, &chat.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return AIChat{}, ErrNotFound
	}
	return chat, err
}

func scanAIMessage(row interface{ Scan(...any) error }) (AIMessage, error) {
	var message AIMessage
	err := row.Scan(&message.CompanyID, &message.UserID, &message.MessageID, &message.ChatID, &message.RunID, &message.Role, &message.Content, &message.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return AIMessage{}, ErrNotFound
	}
	return message, err
}

func aiChatTx(ctx context.Context, tx *sql.Tx, companyID, userID, chatID string) (AIChat, error) {
	return scanAIChat(tx.QueryRowContext(ctx, `select `+aiChatColumns+` from ai_chats c where c.company_id=$1::uuid and c.user_id=$2::uuid and c.chat_id=$3`, companyID, userID, chatID))
}

func (r *PostgresRepo) UpsertAIChat(ctx context.Context, chat AIChat) (AIChat, error) {
	chat, err := normalizeAIChat(chat)
	if err != nil {
		return AIChat{}, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AIChat{}, err
	}
	defer tx.Rollback()
	if err := lockAIMemberTx(ctx, tx, chat.CompanyID, chat.UserID); err != nil {
		return AIChat{}, err
	}
	chat, err = scanAIChat(tx.QueryRowContext(ctx, `insert into ai_chats as c(company_id,user_id,chat_id,name,created_timestamp) values($1::uuid,$2::uuid,$3,$4,$5) on conflict(company_id,user_id,chat_id) do update set name=excluded.name returning `+aiChatColumns, chat.CompanyID, chat.UserID, chat.ChatID, chat.Name, chat.CreatedAt))
	if err != nil {
		return AIChat{}, err
	}
	return chat, tx.Commit()
}

func (r *PostgresRepo) GetAIChat(ctx context.Context, companyID, userID, chatID string) (AIChat, error) {
	return scanAIChat(r.db.QueryRowContext(ctx, `select `+aiChatColumns+` from ai_chats c join company_memberships membership using(company_id,user_id) where c.company_id=$1::uuid and c.user_id=$2::uuid and c.chat_id=$3`, companyID, userID, chatID))
}

func (r *PostgresRepo) ListAIChats(ctx context.Context, companyID, userID string, limit, offset int) ([]AIChat, error) {
	if !aiValidPage(limit, offset) {
		return nil, ErrInvalid
	}
	var member bool
	if err := r.db.QueryRowContext(ctx, `select exists(select 1 from company_memberships where company_id=$1::uuid and user_id=$2::uuid)`, companyID, userID).Scan(&member); err != nil {
		return nil, err
	}
	if !member {
		return nil, ErrNotFound
	}
	rows, err := r.db.QueryContext(ctx, `select `+aiChatColumns+` from ai_chats c join company_memberships membership using(company_id,user_id) where c.company_id=$1::uuid and c.user_id=$2::uuid order by c.created_timestamp desc,c.chat_id desc limit $3 offset $4`, companyID, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	chats := []AIChat{}
	for rows.Next() {
		chat, err := scanAIChat(rows)
		if err != nil {
			return nil, err
		}
		chats = append(chats, chat)
	}
	return chats, rows.Err()
}

func (r *PostgresRepo) ImportAIMessages(ctx context.Context, companyID, userID string, messages []AIMessage) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := lockAIMemberTx(ctx, tx, companyID, userID); err != nil {
		return err
	}
	for _, input := range messages {
		message, err := normalizeAIMessage(companyID, userID, input)
		if err != nil {
			return err
		}
		if _, err := aiChatTx(ctx, tx, companyID, userID, message.ChatID); err != nil {
			return err
		}
		if message.RunID != "" {
			var chatID string
			err := tx.QueryRowContext(ctx, `select coalesce(chat_id,'') from ai_runs where company_id=$1::uuid and user_id=$2::uuid and run_id=$3::uuid`, companyID, userID, message.RunID).Scan(&chatID)
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			if err != nil {
				return err
			}
			if chatID != message.ChatID {
				return ErrConflict
			}
		}
		saved, err := scanAIMessage(tx.QueryRowContext(ctx, `select `+aiMessageColumns+` from ai_messages m where m.company_id=$1::uuid and m.user_id=$2::uuid and m.message_id=$3 for update`, companyID, userID, message.MessageID))
		if err == nil {
			merged, err := mergeAIMessage(saved, message)
			if err != nil {
				return err
			}
			if merged.RunID != saved.RunID {
				if _, err := tx.ExecContext(ctx, `update ai_messages set run_id=$4::uuid where company_id=$1::uuid and user_id=$2::uuid and message_id=$3`, companyID, userID, message.MessageID, merged.RunID); err != nil {
					return err
				}
			}
			continue
		}
		if !errors.Is(err, ErrNotFound) {
			return err
		}
		if _, err := tx.ExecContext(ctx, `insert into ai_messages(company_id,user_id,message_id,chat_id,run_id,role,content,created_timestamp) values($1::uuid,$2::uuid,$3,$4,nullif($5,'')::uuid,$6,$7,$8)`, companyID, userID, message.MessageID, message.ChatID, message.RunID, message.Role, message.Content, message.CreatedAt); err != nil {
			return aiStoreError(err)
		}
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListAIMessages(ctx context.Context, companyID, userID, chatID string, limit, offset int) ([]AIMessage, error) {
	if !aiValidPage(limit, offset) {
		return nil, ErrInvalid
	}
	if _, err := r.GetAIChat(ctx, companyID, userID, chatID); err != nil {
		return nil, err
	}
	rows, err := r.db.QueryContext(ctx, `select `+aiMessageColumns+` from (select m.* from ai_messages m join company_memberships membership using(company_id,user_id) where m.company_id=$1::uuid and m.user_id=$2::uuid and m.chat_id=$3 order by m.message_id desc limit $4 offset $5) m order by m.message_id`, companyID, userID, chatID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := []AIMessage{}
	for rows.Next() {
		message, err := scanAIMessage(rows)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

func (r *PostgresRepo) PruneAIMessages(ctx context.Context, companyID, userID, chatID string, keepIDs []int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := lockAIMemberTx(ctx, tx, companyID, userID); err != nil {
		return err
	}
	if _, err := aiChatTx(ctx, tx, companyID, userID, chatID); err != nil {
		return err
	}
	keep := make(map[int64]bool, len(keepIDs))
	for _, id := range keepIDs {
		if id <= 0 || keep[id] {
			return ErrInvalid
		}
		keep[id] = true
	}
	if len(keepIDs) > 0 {
		var found int
		if err := tx.QueryRowContext(ctx, `select count(*) from ai_messages where company_id=$1::uuid and user_id=$2::uuid and chat_id=$3 and message_id=any($4::bigint[])`, companyID, userID, chatID, keepIDs).Scan(&found); err != nil {
			return err
		}
		if found != len(keepIDs) {
			return ErrConflict
		}
	} else {
		keepIDs = []int64{}
	}
	if _, err := tx.ExecContext(ctx, `delete from ai_messages where company_id=$1::uuid and user_id=$2::uuid and chat_id=$3 and not(message_id=any($4::bigint[]))`, companyID, userID, chatID, keepIDs); err != nil {
		return err
	}
	return tx.Commit()
}
