package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func scanCommunicationsTriageItem(row interface {
	Scan(dest ...any) error
}) (domain.CommunicationsTriageItem, error) {
	var item domain.CommunicationsTriageItem
	var raw []byte
	err := row.Scan(
		&item.UserID,
		&item.MessageID,
		&raw,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if err != nil {
		return domain.CommunicationsTriageItem{}, err
	}
	if err := json.Unmarshal(raw, &item.Message); err != nil {
		return domain.CommunicationsTriageItem{}, err
	}
	item.Message = normalizeEmailMessageSnapshot(item.Message)
	return item, nil
}

func scanUserLogicGateShortcut(row interface {
	Scan(dest ...any) error
}) (domain.UserLogicGateShortcut, error) {
	var item domain.UserLogicGateShortcut
	err := row.Scan(
		&item.UserID,
		&item.CompanyID,
		&item.LogicGateID,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

func scanCommunicationsEmailPlacement(row interface {
	Scan(dest ...any) error
}) (domain.CommunicationsEmailPlacement, error) {
	var placement domain.CommunicationsEmailPlacement
	err := row.Scan(
		&placement.CompanyID,
		&placement.UserID,
		&placement.MessageID,
		&placement.NodeID,
		&placement.BoardID,
		&placement.CardID,
		&placement.LogicGateID,
		&placement.CreatedTimestamp,
		&placement.UpdatedTimestamp,
	)
	return placement, err
}

func (r *PostgresRepo) ListCommunicationsTriageItems(userID string) ([]domain.CommunicationsTriageItem, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalid
	}

	rows, err := r.db.Query(`
select user_id::text, message_id, message, created_timestamp, updated_timestamp
from communications_triage_items
where user_id=$1
order by created_timestamp desc, message_id asc`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CommunicationsTriageItem, 0)
	for rows.Next() {
		item, err := scanCommunicationsTriageItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) UpsertCommunicationsTriageItem(userID string, message domain.EmailMessageSnapshot) (domain.CommunicationsTriageItem, error) {
	userID = strings.TrimSpace(userID)
	message = normalizeEmailMessageSnapshot(message)
	if userID == "" || message.ID == "" {
		return domain.CommunicationsTriageItem{}, ErrInvalid
	}
	raw, err := json.Marshal(message)
	if err != nil {
		return domain.CommunicationsTriageItem{}, err
	}

	item, err := scanCommunicationsTriageItem(r.db.QueryRow(`
insert into communications_triage_items (user_id, message_id, message, created_timestamp, updated_timestamp)
select $1, $2, $3::jsonb, now(), now()
where exists (select 1 from users where user_id=$1)
on conflict (user_id, message_id)
do update set
  message=excluded.message,
  updated_timestamp=now()
returning user_id::text, message_id, message, created_timestamp, updated_timestamp`,
		userID, message.ID, string(raw),
	))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsTriageItem{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) DeleteCommunicationsTriageItem(userID, messageID string) error {
	userID = strings.TrimSpace(userID)
	messageID = strings.TrimSpace(messageID)
	if userID == "" || messageID == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(`
delete from communications_triage_items
where user_id=$1 and message_id=$2`, userID, messageID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) ConvertCommunicationsTriageItems(input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	messageIDs := normalizeUniqueStrings(input.MessageIDs, CommunicationsTriageBatchMaxItems)
	if input.UserID == "" || input.CompanyID == "" || input.LogicGateID == "" || len(messageIDs) == 0 {
		return CommunicationsTriageConversionResult{}, ErrInvalid
	}

	ctx := context.Background()
	if err := r.ensureCompanyExplorerSharedInboxSchema(ctx); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	defer tx.Rollback()

	var logicGateTitle string
	if err := tx.QueryRowContext(ctx, `
select header
from logic_gates
where company_id=$1 and logic_gate_id=$2`, input.CompanyID, input.LogicGateID).Scan(&logicGateTitle); errors.Is(err, sql.ErrNoRows) {
		return CommunicationsTriageConversionResult{}, ErrNotFound
	} else if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	if err := ensureLogicGateKanbanBoardSQL(ctx, tx, input.CompanyID, input.LogicGateID, logicGateTitle); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	activeNodeFolder, err := ensureCompanyExplorerSystemFolderSQL(ctx, tx, input.CompanyID, CompanyExplorerSystemActiveNodesKey)
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}

	board, err := scanKanbanBoard(tx.QueryRowContext(ctx, `
select company_id::text, board_id, logic_gate_id::text, title, position, created_timestamp, updated_timestamp
from kanban_boards
where company_id=$1 and board_id=$2`, input.CompanyID, LogicGateKanbanBoardID(input.LogicGateID)))
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}

	var pendingColumnID string
	if err := tx.QueryRowContext(ctx, `
select column_id::text
from kanban_columns
where company_id=$1 and board_id=$2 and lower(btrim(title))='pending'
order by position asc
limit 1`, input.CompanyID, board.BoardID).Scan(&pendingColumnID); errors.Is(err, sql.ErrNoRows) {
		return CommunicationsTriageConversionResult{}, ErrNotFound
	} else if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}

	var nextPosition int
	if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from kanban_cards
where company_id=$1 and board_id=$2 and column_id=$3`, input.CompanyID, board.BoardID, pendingColumnID).Scan(&nextPosition); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}

	result := CommunicationsTriageConversionResult{Board: board}
	for index, messageID := range messageIDs {
		var rawMessage []byte
		if err := tx.QueryRowContext(ctx, `
select message
from communications_triage_items
where user_id=$1 and message_id=$2
for update`, input.UserID, messageID).Scan(&rawMessage); errors.Is(err, sql.ErrNoRows) {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		} else if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}

		var message domain.EmailMessageSnapshot
		if err := json.Unmarshal(rawMessage, &message); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		message = normalizeEmailMessageSnapshot(message)
		rawMessage, err = json.Marshal(message)
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}

		nodeID := newUUIDv7String()
		nodeTitle := emailNodeTitle(message)
		if _, err := tx.ExecContext(ctx, `
insert into nodes (company_id, node_id, title, created_timestamp)
values ($1, $2, $3, now())`, input.CompanyID, nodeID, nodeTitle); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		folderItem, _, err := assignCompanyExplorerFolderItemSQL(ctx, tx, input.CompanyID, activeNodeFolder.FolderID, "node", nodeID, 0)
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `
insert into node_map_positions (company_id, node_id, x, y, updated_timestamp)
values ($1, $2, $3, $4, now())`, input.CompanyID, nodeID, 120+float64(index*28), 120+float64(index*28)); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		cardID := newUUIDv7String()
		card, err := scanKanbanCard(tx.QueryRowContext(ctx, `
insert into kanban_cards (
  company_id, board_id, card_id, column_id, node_id, logic_gate_id, node_title,
  description_snapshot, is_issue, position, created_timestamp, updated_timestamp
) values ($1, $2, $3, $4, $5, $6::uuid, $7, $8, false, $9, now(), now())
returning `+kanbanCardSelectColumns,
			input.CompanyID, board.BoardID, cardID, pendingColumnID, nodeID, input.LogicGateID, nodeTitle,
			emailDescriptionSnapshot(message), nextPosition+index*1000,
		))
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `
insert into communications_email_nodes (
  company_id, user_id, message_id, node_id, board_id, card_id, logic_gate_id,
  message, created_timestamp, updated_timestamp
) values ($1, $2, $3, $4, $5, $6, $7::uuid, $8::jsonb, now(), now())`,
			input.CompanyID, input.UserID, messageID, nodeID, board.BoardID, card.CardID, input.LogicGateID, string(rawMessage)); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if err := addEmailProjectionSQL(ctx, tx, input.CompanyID, nodeID, message, time.Now().UTC()); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `
delete from communications_triage_items
where user_id=$1 and message_id=$2`, input.UserID, messageID); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if err := syncNodeStatusFromKanbanCardSQL(ctx, tx, card); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if err := assignNodeToLogicGateResponsibleSQL(ctx, tx, input.CompanyID, input.LogicGateID, nodeID); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		node, err := scanNode(tx.QueryRowContext(ctx, `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1 and n.node_id=$2`, input.CompanyID, nodeID))
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.Nodes = append(result.Nodes, node)
		result.Cards = append(result.Cards, card)
		result.FolderItems = append(result.FolderItems, folderItem)
		result.DeletedMessageIDs = append(result.DeletedMessageIDs, messageID)
	}

	if err := tx.Commit(); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) ListCommunicationsEmailPlacements(userID, companyID string, messageIDs []string) ([]domain.CommunicationsEmailPlacement, error) {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	if userID == "" || companyID == "" {
		return nil, ErrInvalid
	}
	ids := normalizeUniqueStrings(messageIDs, 0)
	if len(ids) == 0 {
		return []domain.CommunicationsEmailPlacement{}, nil
	}

	args := []any{userID, companyID}
	placeholders := make([]string, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
	}
	rows, err := r.db.Query(`
select company_id::text, user_id::text, message_id, node_id::text, board_id, card_id, logic_gate_id::text, created_timestamp, updated_timestamp
from communications_email_nodes
where user_id=$1
  and company_id=$2
  and message_id in (`+strings.Join(placeholders, ",")+`)
order by created_timestamp desc, message_id asc, logic_gate_id asc`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	placements := make([]domain.CommunicationsEmailPlacement, 0)
	for rows.Next() {
		placement, err := scanCommunicationsEmailPlacement(rows)
		if err != nil {
			return nil, err
		}
		placements = append(placements, placement)
	}
	return placements, rows.Err()
}

func addEmailProjectionSQL(ctx context.Context, tx *sql.Tx, companyID, nodeID string, message domain.EmailMessageSnapshot, attachedAt time.Time) error {
	informationID := newUUIDv7String()
	information := attachedEmailProjectionInformation(message, attachedAt)
	if _, err := tx.ExecContext(ctx, `
insert into node_information (
  company_id, information_id, node_id, type, information, created_timestamp, updated_timestamp
) values ($1, $2, $3, 'Attached email'::information_type, $4, $5, $5)`,
		companyID, informationID, nodeID, information, attachedAt); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
insert into node_projection_table (
  company_id, node_id, information_id, type, information, created_timestamp, updated_timestamp
) values ($1, $2, $3, 'Attached email'::information_type, $4, $5, $5)
on conflict (company_id, node_id, information_id)
do update set
  type=excluded.type,
  information=excluded.information,
  updated_timestamp=excluded.updated_timestamp`,
		companyID, nodeID, informationID, information, attachedAt); err != nil {
		return err
	}
	return nil
}

func (r *PostgresRepo) RevertCommunicationsTriageNode(input CommunicationsTriageRevertInput) (CommunicationsTriageRevertResult, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.BoardID = strings.TrimSpace(input.BoardID)
	input.CardID = strings.TrimSpace(input.CardID)
	if input.UserID == "" || input.CompanyID == "" || input.BoardID == "" || input.CardID == "" {
		return CommunicationsTriageRevertResult{}, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	defer tx.Rollback()

	var link communicationsEmailNodeLink
	var rawMessage []byte
	if err := tx.QueryRowContext(ctx, `
select company_id::text, user_id::text, message_id, node_id::text, board_id, card_id::text, logic_gate_id::text,
       message, created_timestamp, updated_timestamp
from communications_email_nodes
where company_id=$1 and user_id=$2 and board_id=$3 and card_id=$4
for update`, input.CompanyID, input.UserID, input.BoardID, input.CardID).Scan(
		&link.CompanyID,
		&link.UserID,
		&link.MessageID,
		&link.NodeID,
		&link.BoardID,
		&link.CardID,
		&link.LogicGateID,
		&rawMessage,
		&link.CreatedTimestamp,
		&link.UpdatedTimestamp,
	); errors.Is(err, sql.ErrNoRows) {
		return CommunicationsTriageRevertResult{}, ErrNotFound
	} else if err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if err := json.Unmarshal(rawMessage, &link.Message); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	link.Message = normalizeEmailMessageSnapshot(link.Message)
	rawMessage, err = json.Marshal(link.Message)
	if err != nil {
		return CommunicationsTriageRevertResult{}, err
	}

	triageItem, err := scanCommunicationsTriageItem(tx.QueryRowContext(ctx, `
insert into communications_triage_items (user_id, message_id, message, created_timestamp, updated_timestamp)
values ($1, $2, $3::jsonb, now(), now())
on conflict (user_id, message_id)
do update set
  message=excluded.message,
  updated_timestamp=now()
returning user_id::text, message_id, message, created_timestamp, updated_timestamp`, input.UserID, link.MessageID, string(rawMessage)))
	if err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from communications_email_nodes
where company_id=$1 and board_id=$2 and card_id=$3`, input.CompanyID, input.BoardID, input.CardID); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from kanban_cards
where company_id=$1 and board_id=$2 and card_id=$3`, input.CompanyID, input.BoardID, input.CardID); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from node_relationships
where company_id=$1 and (node_id_a=$2 or node_id_b=$2)`, input.CompanyID, link.NodeID); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from company_explorer_folder_items
where company_id=$1 and item_type='node' and item_id=$2`, input.CompanyID, link.NodeID); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from node_information
where company_id=$1 and node_id=$2`, input.CompanyID, link.NodeID); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from node_projection_table
where company_id=$1 and node_id=$2`, input.CompanyID, link.NodeID); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from node_map_positions
where company_id=$1 and node_id=$2`, input.CompanyID, link.NodeID); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from nodes
where company_id=$1 and node_id=$2`, input.CompanyID, link.NodeID); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}

	if err := tx.Commit(); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	return CommunicationsTriageRevertResult{
		TriageItem:    triageItem,
		DeletedNodeID: link.NodeID,
		DeletedCardID: input.CardID,
		BoardID:       input.BoardID,
	}, nil
}

func (r *PostgresRepo) ListUserLogicGateShortcuts(userID, companyID string) ([]domain.UserLogicGateShortcut, error) {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	if userID == "" || companyID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.Query(`
select user_id::text, company_id::text, logic_gate_id::text, position, created_timestamp, updated_timestamp
from user_logic_gate_shortcuts
where user_id=$1 and company_id=$2
order by position asc, created_timestamp asc, logic_gate_id asc`, userID, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.UserLogicGateShortcut, 0)
	for rows.Next() {
		item, err := scanUserLogicGateShortcut(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) UpsertUserLogicGateShortcuts(userID, companyID string, logicGateIDs []string) ([]domain.UserLogicGateShortcut, error) {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	ids := normalizeUniqueStrings(logicGateIDs, UserLogicGateShortcutBatchMaxItems)
	if userID == "" || companyID == "" || len(ids) == 0 {
		return nil, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var nextPosition int
	if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from user_logic_gate_shortcuts
where user_id=$1 and company_id=$2`, userID, companyID).Scan(&nextPosition); err != nil {
		return nil, err
	}

	items := make([]domain.UserLogicGateShortcut, 0, len(ids))
	for _, logicGateID := range ids {
		var exists bool
		if err := tx.QueryRowContext(ctx, `
select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`, companyID, logicGateID).Scan(&exists); err != nil {
			return nil, err
		}
		if !exists {
			return nil, ErrNotFound
		}

		var position int
		err := tx.QueryRowContext(ctx, `
select position
from user_logic_gate_shortcuts
where user_id=$1 and company_id=$2 and logic_gate_id=$3`, userID, companyID, logicGateID).Scan(&position)
		if errors.Is(err, sql.ErrNoRows) {
			position = nextPosition
			nextPosition += 1000
		} else if err != nil {
			return nil, err
		}

		item, err := scanUserLogicGateShortcut(tx.QueryRowContext(ctx, `
insert into user_logic_gate_shortcuts (user_id, company_id, logic_gate_id, position, created_timestamp, updated_timestamp)
values ($1, $2, $3, $4, now(), now())
on conflict (user_id, company_id, logic_gate_id)
do update set updated_timestamp=now()
returning user_id::text, company_id::text, logic_gate_id::text, position, created_timestamp, updated_timestamp`,
			userID, companyID, logicGateID, position))
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Position < items[j].Position })
	return items, nil
}

func (r *PostgresRepo) DeleteUserLogicGateShortcut(userID, companyID, logicGateID string) error {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if userID == "" || companyID == "" || logicGateID == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(`
delete from user_logic_gate_shortcuts
where user_id=$1 and company_id=$2 and logic_gate_id=$3`, userID, companyID, logicGateID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}
