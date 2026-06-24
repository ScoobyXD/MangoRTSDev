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

type postgresCommunicationsEmailNodeReference struct {
	CompanyID        string
	UserID           string
	MessageID        string
	NodeID           string
	Message          []byte
	CreatedTimestamp time.Time
}

func takePostgresCommunicationsEmailNodeReferenceForCardTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, boardID, cardID string) (postgresCommunicationsEmailNodeReference, bool, error) {
	var reference postgresCommunicationsEmailNodeReference
	err := tx.QueryRowContext(ctx, `
delete from communications_email_nodes
where company_id=$1::uuid
  and node_id=$2::uuid
  and board_id=$3
  and card_id=$4::uuid
returning company_id::text, user_id::text, message_id, node_id::text, message, created_timestamp`,
		companyID, nodeID, boardID, cardID,
	).Scan(
		&reference.CompanyID,
		&reference.UserID,
		&reference.MessageID,
		&reference.NodeID,
		&reference.Message,
		&reference.CreatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return postgresCommunicationsEmailNodeReference{}, false, nil
	}
	if err != nil {
		return postgresCommunicationsEmailNodeReference{}, false, err
	}
	return reference, true, nil
}

func restorePostgresCommunicationsEmailNodeReferenceTx(ctx context.Context, tx *sql.Tx, reference postgresCommunicationsEmailNodeReference, boardID, cardID, logicGateID string) error {
	_, err := tx.ExecContext(ctx, `
insert into communications_email_nodes (
  company_id, user_id, message_id, node_id, board_id, card_id, logic_gate_id,
  message, created_timestamp, updated_timestamp
) values ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::uuid, $7::uuid, $8::jsonb, $9, now())
on conflict (company_id, node_id)
do update set
  user_id=excluded.user_id,
  message_id=excluded.message_id,
  board_id=excluded.board_id,
  card_id=excluded.card_id,
  logic_gate_id=excluded.logic_gate_id,
  message=excluded.message,
  updated_timestamp=now()`,
		reference.CompanyID,
		reference.UserID,
		reference.MessageID,
		reference.NodeID,
		boardID,
		cardID,
		logicGateID,
		string(reference.Message),
		reference.CreatedTimestamp,
	)
	return err
}

func updatePostgresCommunicationsEmailNodeReferenceForNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, boardID, cardID, logicGateID string) error {
	_, err := tx.ExecContext(ctx, `
update communications_email_nodes
set board_id=$3,
    card_id=$4::uuid,
    logic_gate_id=$5::uuid,
    updated_timestamp=now()
where company_id=$1::uuid
  and node_id=$2::uuid`,
		companyID, nodeID, boardID, cardID, logicGateID,
	)
	return err
}

func updatePostgresCommunicationsEmailAttachmentReferencesForNodeTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, boardID, cardID, logicGateID string) error {
	_, err := tx.ExecContext(ctx, `
update communications_email_node_attachments
set board_id=$3,
    card_id=$4::uuid,
    logic_gate_id=$5::uuid,
    updated_timestamp=now()
where company_id=$1::uuid
  and node_id=$2::uuid`,
		companyID, nodeID, boardID, cardID, logicGateID,
	)
	return err
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
	input, err := NormalizeCommunicationsTriageConversionInput(input)
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	defer tx.Rollback()

	switch input.Target.Mode {
	case CommunicationsEmailConversionTargetExistingNode:
		if input.LogicGateID == "" {
			result, err := r.attachCommunicationsTriageItemsToStandaloneNodeTx(ctx, tx, input)
			if err != nil {
				return CommunicationsTriageConversionResult{}, err
			}
			return r.finishCommunicationsTriageConversionTx(ctx, tx, input, result)
		}
	case CommunicationsEmailConversionTargetFolder, CommunicationsEmailConversionTargetProject:
		result, err := r.convertCommunicationsTriageItemsToExplorerTargetTx(ctx, tx, input)
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		return r.finishCommunicationsTriageConversionTx(ctx, tx, input, result)
	}

	var logicGate domain.LogicGate
	createdLogicGate := false
	switch input.Target.Mode {
	case CommunicationsEmailConversionTargetExistingLogicGate:
		err := tx.QueryRowContext(ctx, `
select company_id::text, logic_gate_id::text, header, created_timestamp
from logic_gates
where company_id=$1 and logic_gate_id=$2`, input.CompanyID, input.LogicGateID).Scan(
			&logicGate.CompanyID,
			&logicGate.LogicGateID,
			&logicGate.Header,
			&logicGate.CreatedTimestamp,
		)
		if errors.Is(err, sql.ErrNoRows) {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
	case CommunicationsEmailConversionTargetNewLogicGate:
		logicGate = domain.LogicGate{CompanyID: input.CompanyID, LogicGateID: newUUIDv7String(), Header: input.NewLogicGateHeader}
		if err := tx.QueryRowContext(ctx, `
insert into logic_gates (company_id, logic_gate_id, header, created_timestamp)
values ($1, $2, $3, now())
returning company_id::text, logic_gate_id::text, header, created_timestamp`, logicGate.CompanyID, logicGate.LogicGateID, logicGate.Header).Scan(
			&logicGate.CompanyID,
			&logicGate.LogicGateID,
			&logicGate.Header,
			&logicGate.CreatedTimestamp,
		); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		input.LogicGateID = logicGate.LogicGateID
		input.Target.LogicGateID = logicGate.LogicGateID
		createdLogicGate = true
	case CommunicationsEmailConversionTargetExistingNode:
		err := tx.QueryRowContext(ctx, `
select company_id::text, logic_gate_id::text, header, created_timestamp
from logic_gates
where company_id=$1 and logic_gate_id=$2`, input.CompanyID, input.LogicGateID).Scan(
			&logicGate.CompanyID,
			&logicGate.LogicGateID,
			&logicGate.Header,
			&logicGate.CreatedTimestamp,
		)
		if errors.Is(err, sql.ErrNoRows) {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
	default:
		return CommunicationsTriageConversionResult{}, ErrInvalid
	}
	input.Target.Header = logicGate.Header
	if logicGate.GVICAssignments == nil {
		logicGate.GVICAssignments = []domain.LogicGateGVICAssignment{}
	}
	logicGate.DefaultAccess = defaultResourceAccessOrEdit(logicGate.DefaultAccess)
	if input.Target.Mode == CommunicationsEmailConversionTargetExistingNode {
		result, err := r.attachCommunicationsTriageItemsToExistingNodeTx(ctx, tx, input, logicGate)
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		events, err := r.appendDomainEventsTx(ctx, tx, communicationsEmailConversionWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.Events = events
		if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, result.ProjectionDeltas)); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if err := tx.Commit(); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		return result, nil
	}
	board := synthesizeKanbanBoardFromLogicGate(logicGate, 1000)
	columns := synthesizeLogicGateWorkColumns(input.CompanyID, board.BoardID, logicGate.CreatedTimestamp)
	column, err := resolveLogicGateAssignmentColumn(columns, input.ColumnID, input.Status)
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}

	var nextPosition int
	if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from node_logic_gate_assignments
where company_id=$1 and compatibility_board_id=$2 and column_id=$3`, input.CompanyID, board.BoardID, column.ColumnID).Scan(&nextPosition); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}

	result := CommunicationsTriageConversionResult{
		Target:           input.Target,
		LogicGate:        logicGate,
		CreatedLogicGate: createdLogicGate,
		Board:            board,
	}
	for index, messageID := range input.MessageIDs {
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
insert into nodes (company_id, node_id, name, priority, created_timestamp)
values ($1, $2, $3, $4::smallint, now())`, input.CompanyID, nodeID, nodeTitle, *input.Priority); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `
insert into node_map_positions (company_id, node_id, x, y, updated_timestamp)
values ($1, $2, $3, $4, now())`, input.CompanyID, nodeID, 120+float64(index*28), 120+float64(index*28)); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}

		cardID := newUUIDv7String()
		position := nextPosition + index*1000
		assignment, err := upsertNodeLogicGateAssignmentSQL(ctx, tx, nodeLogicGateAssignmentSQLInput{
			CompanyID:            input.CompanyID,
			NodeID:               nodeID,
			LogicGateID:          input.LogicGateID,
			StatusKey:            logicGateAssignmentStatusKey(column.Title),
			ColumnID:             column.ColumnID,
			IsIssue:              false,
			Position:             position,
			CompatibilityBoardID: board.BoardID,
			CompatibilityCardID:  cardID,
			RequestedByUserID:    input.ActorUserID,
		})
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if err := syncNodeStatusFromLogicGateAssignmentTx(ctx, tx, assignment); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if err := snapshotPostgresLogicGateGVICToNodeTx(ctx, tx, input.CompanyID, input.LogicGateID, nodeID); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		card, err := nodeLogicGateAssignmentCardSQL(ctx, tx, assignment)
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		placement, err := scanCommunicationsEmailPlacement(tx.QueryRowContext(ctx, `
insert into communications_email_nodes (
  company_id, user_id, message_id, node_id, board_id, card_id, logic_gate_id,
  message, created_timestamp, updated_timestamp
) values ($1, $2, $3, $4, $5, $6, $7::uuid, $8::jsonb, now(), now())
returning company_id::text, user_id::text, message_id, node_id::text, board_id, card_id::text, logic_gate_id::text, created_timestamp, updated_timestamp`,
			input.CompanyID, input.UserID, messageID, nodeID, board.BoardID, card.CardID, input.LogicGateID, string(rawMessage)))
		if err != nil {
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
		projectionDeltas, err := applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx(ctx, tx, NodeLogicGateAssignmentProjectionDeltaDependencyInput{
			CompanyID:    input.CompanyID,
			AssignmentID: assignment.AssignmentID,
			NodeID:       nodeID,
		})
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.ProjectionDeltas = append(result.ProjectionDeltas, projectionDeltas...)
		if projectedCard, err := kanbanBoardProjectionCardByNodeTx(ctx, tx, input.CompanyID, nodeID, input.LogicGateID); err == nil {
			card = projectedCard
		} else {
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
		provenance := CommunicationsEmailConversionProvenance{
			CompanyID:   placement.CompanyID,
			UserID:      placement.UserID,
			MessageID:   placement.MessageID,
			ThreadID:    strings.TrimSpace(message.ThreadID),
			NodeID:      placement.NodeID,
			BoardID:     placement.BoardID,
			CardID:      placement.CardID,
			LogicGateID: placement.LogicGateID,
		}
		result.Nodes = append(result.Nodes, node)
		result.Cards = append(result.Cards, card)
		result.Assignments = append(result.Assignments, assignment)
		result.EmailPlacements = append(result.EmailPlacements, placement)
		result.EmailProvenance = append(result.EmailProvenance, provenance)
		result.DeletedMessageIDs = append(result.DeletedMessageIDs, messageID)
	}

	events, err := r.appendDomainEventsTx(ctx, tx, communicationsEmailConversionWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	result.Events = events
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, result.ProjectionDeltas)); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) finishCommunicationsTriageConversionTx(ctx context.Context, tx *sql.Tx, input CommunicationsTriageConversionInput, result CommunicationsTriageConversionResult) (CommunicationsTriageConversionResult, error) {
	events, err := r.appendDomainEventsTx(ctx, tx, communicationsEmailConversionWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	result.Events = events
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, result.ProjectionDeltas)); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) attachCommunicationsTriageItemsToStandaloneNodeTx(ctx context.Context, tx *sql.Tx, input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error) {
	updateResult, err := tx.ExecContext(ctx, `
update nodes
set priority=$3::smallint
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID, *input.Priority)
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	if affected, err := updateResult.RowsAffected(); err != nil {
		return CommunicationsTriageConversionResult{}, err
	} else if affected == 0 {
		return CommunicationsTriageConversionResult{}, ErrNotFound
	}

	result := CommunicationsTriageConversionResult{Target: input.Target}
	for _, messageID := range input.MessageIDs {
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
		if err := addEmailProjectionSQL(ctx, tx, input.CompanyID, input.NodeID, message, time.Now().UTC()); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `
delete from communications_triage_items
where user_id=$1 and message_id=$2`, input.UserID, messageID); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		node, err := scanNode(tx.QueryRowContext(ctx, `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1 and n.node_id=$2`, input.CompanyID, input.NodeID))
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.Nodes = append(result.Nodes, node)
		result.EmailProvenance = append(result.EmailProvenance, CommunicationsEmailConversionProvenance{
			CompanyID: input.CompanyID,
			UserID:    input.UserID,
			MessageID: messageID,
			ThreadID:  strings.TrimSpace(message.ThreadID),
			NodeID:    input.NodeID,
		})
		result.DeletedMessageIDs = append(result.DeletedMessageIDs, messageID)
	}
	return result, nil
}

func (r *PostgresRepo) convertCommunicationsTriageItemsToExplorerTargetTx(ctx context.Context, tx *sql.Tx, input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error) {
	targetParentEntityID := communicationsExplorerTargetParentEntityID(input.Target)
	if targetParentEntityID != "" {
		input.Target.ParentEntityID = targetParentEntityID
	}
	if input.Target.Mode == CommunicationsEmailConversionTargetProject {
		var projectExists bool
		if err := tx.QueryRowContext(ctx, `select exists (select 1 from projects where company_id=$1::uuid and project_id=$2::uuid)`, input.CompanyID, input.Target.ProjectID).Scan(&projectExists); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if !projectExists {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
	}
	if targetParentEntityID != "" {
		if err := postgresCompanyExplorerV2ParentExistsAndCanEdit(ctx, tx, input.CompanyID, targetParentEntityID, input.PermissionUserID); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
	}

	result := CommunicationsTriageConversionResult{Target: input.Target}
	for index, messageID := range input.MessageIDs {
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
		nodeID := newUUIDv7String()
		nodeTitle := emailNodeTitle(message)
		if _, err := tx.ExecContext(ctx, `
insert into nodes (company_id, node_id, name, priority, created_timestamp)
values ($1, $2, $3, $4::smallint, now())`, input.CompanyID, nodeID, nodeTitle, *input.Priority); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `
insert into node_map_positions (company_id, node_id, x, y, updated_timestamp)
values ($1, $2, $3, $4, now())`, input.CompanyID, nodeID, 120+float64(index*28), 120+float64(index*28)); err != nil {
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
		if targetParentEntityID != "" {
			row, err := upsertCommunicationsExplorerV2NodeEdgeTx(ctx, tx, input, nodeID, nodeTitle)
			if err != nil {
				return CommunicationsTriageConversionResult{}, err
			}
			if row.EntityID != "" {
				result.ExplorerV2Rows = append(result.ExplorerV2Rows, row)
			}
		}
		if input.Target.Mode == CommunicationsEmailConversionTargetProject {
			relationship, deltas, err := upsertCommunicationsTriageProjectRelationshipTx(ctx, tx, input, nodeID)
			if err != nil {
				return CommunicationsTriageConversionResult{}, err
			}
			result.ProjectRelationships = append(result.ProjectRelationships, relationship)
			result.ProjectionDeltas = append(result.ProjectionDeltas, deltas...)
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
		result.EmailProvenance = append(result.EmailProvenance, CommunicationsEmailConversionProvenance{
			CompanyID: input.CompanyID,
			UserID:    input.UserID,
			MessageID: messageID,
			ThreadID:  strings.TrimSpace(message.ThreadID),
			NodeID:    nodeID,
		})
		result.DeletedMessageIDs = append(result.DeletedMessageIDs, messageID)
	}
	return result, nil
}

func postgresCompanyExplorerV2ParentExistsAndCanEdit(ctx context.Context, tx *sql.Tx, companyID, parentEntityID, userID string) error {
	var exists bool
	if parentEntityID == companyID {
		exists = true
	} else if err := tx.QueryRowContext(ctx, `
select exists (
  select 1
  from company_explorer_folders
  where company_id=$1::uuid and folder_id=$2::uuid
)`, companyID, parentEntityID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return postgresCompanyExplorerV2ParentCanEdit(ctx, tx, companyID, parentEntityID, userID)
}

func upsertCommunicationsExplorerV2NodeEdgeTx(ctx context.Context, tx *sql.Tx, input CommunicationsTriageConversionInput, nodeID, nodeTitle string) (CompanyExplorerV2Row, error) {
	parentEntityID := communicationsExplorerTargetParentEntityID(input.Target)
	var parentFolderID any
	if parentEntityID == "" || parentEntityID == input.CompanyID {
		parentEntityID = input.CompanyID
	} else {
		var folderExists bool
		if err := tx.QueryRowContext(ctx, `
select exists(select 1 from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid)`,
			input.CompanyID, parentEntityID).Scan(&folderExists); err != nil {
			return CompanyExplorerV2Row{}, err
		}
		if !folderExists {
			return CompanyExplorerV2Row{}, nil
		}
		parentFolderID = parentEntityID
	}
	position := input.Target.Position
	if position <= 0 {
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from company_explorer_items
where company_id=$1::uuid
  and (($2::uuid is null and parent_folder_id is null) or parent_folder_id=$2::uuid)`,
			input.CompanyID, parentFolderID).Scan(&position); err != nil {
			return CompanyExplorerV2Row{}, err
		}
	}
	itemID := newUUIDv7String()
	var createdTimestamp time.Time
	var updatedTimestamp time.Time
	if err := tx.QueryRowContext(ctx, `
insert into company_explorer_items (company_id, item_id, parent_folder_id, target_type, target_id, position, created_by_user_id, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, 'node', $4::uuid, $5, nullif($6, '')::uuid, now(), now())
on conflict (company_id, target_type, target_id) do update set
  parent_folder_id=excluded.parent_folder_id,
  position=excluded.position,
  updated_timestamp=now()
returning item_id::text, created_timestamp, updated_timestamp`,
		input.CompanyID, itemID, parentFolderID, nodeID, position, input.ActorUserID).Scan(&itemID, &createdTimestamp, &updatedTimestamp); err != nil {
		return CompanyExplorerV2Row{}, err
	}
	return CompanyExplorerV2Row{
		CompanyID:        input.CompanyID,
		EntityID:         nodeID,
		EntityType:       CompanyExplorerV2EntityNode,
		ResourceID:       nodeID,
		Name:             nodeTitle,
		ParentEntityID:   parentEntityID,
		EdgeID:           itemID,
		Position:         position,
		HasChildren:      false,
		EffectiveAccess:  EntityPermissionEdit,
		NativeContext:    companyExplorerV2NativeContext(CompanyExplorerV2EntityNode, nodeID, nodeID),
		CreatedTimestamp: createdTimestamp,
		UpdatedTimestamp: updatedTimestamp,
	}, nil
}

func upsertCommunicationsTriageProjectRelationshipTx(ctx context.Context, tx *sql.Tx, input CommunicationsTriageConversionInput, nodeID string) (domain.ProjectRelationshipProjection, []ProjectionDelta, error) {
	position := input.Target.Position
	if position <= 0 {
		if err := tx.QueryRowContext(ctx, `select coalesce(max(position), 0) + 1000 from project_relationships where company_id=$1::uuid and project_id=$2::uuid`, input.CompanyID, input.Target.ProjectID).Scan(&position); err != nil {
			return domain.ProjectRelationshipProjection{}, nil, err
		}
	}
	relationshipID := newUUIDv7String()
	var returnedID string
	err := tx.QueryRowContext(ctx, `
insert into project_relationships (
  company_id, relationship_id, project_id, resource_type, resource_id, position, created_timestamp, updated_timestamp
) values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, now(), now())
on conflict (company_id, resource_type, resource_id)
do update set
  project_id=excluded.project_id,
  position=excluded.position,
  updated_timestamp=now()
returning relationship_id::text`, input.CompanyID, relationshipID, input.Target.ProjectID, EntityTypeNode, nodeID, position).Scan(&returnedID)
	if err != nil {
		return domain.ProjectRelationshipProjection{}, nil, err
	}
	deltas, err := applyProjectRelationshipProjectionDeltaDependenciesTx(ctx, tx, ProjectRelationshipProjectionDeltaDependencyInput{
		CompanyID:      input.CompanyID,
		RelationshipID: returnedID,
	})
	if err != nil {
		return domain.ProjectRelationshipProjection{}, nil, err
	}
	projection, err := projectRelationshipProjectionByIDTx(ctx, tx, input.CompanyID, returnedID)
	if err != nil {
		return domain.ProjectRelationshipProjection{}, nil, err
	}
	return projection, deltas, nil
}
func (r *PostgresRepo) attachCommunicationsTriageItemsToExistingNodeTx(ctx context.Context, tx *sql.Tx, input CommunicationsTriageConversionInput, logicGate domain.LogicGate) (CommunicationsTriageConversionResult, error) {
	assignment, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, input.LogicGateID)
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	card, err := nodeLogicGateAssignmentCardSQL(ctx, tx, assignment)
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	board := synthesizeKanbanBoardFromLogicGate(logicGate, 1000)
	updateResult, err := tx.ExecContext(ctx, `
update nodes
set priority=$3::smallint
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID, *input.Priority)
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	if affected, err := updateResult.RowsAffected(); err != nil {
		return CommunicationsTriageConversionResult{}, err
	} else if affected == 0 {
		return CommunicationsTriageConversionResult{}, ErrNotFound
	}

	result := CommunicationsTriageConversionResult{
		Target:    input.Target,
		LogicGate: logicGate,
		Board:     board,
	}
	result.Target.Header = logicGate.Header
	projectionDeltas, err := applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx(ctx, tx, NodeLogicGateAssignmentProjectionDeltaDependencyInput{
		CompanyID:    input.CompanyID,
		AssignmentID: assignment.AssignmentID,
		NodeID:       input.NodeID,
	})
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	result.ProjectionDeltas = append(result.ProjectionDeltas, projectionDeltas...)
	if projectedCard, err := kanbanBoardProjectionCardByNodeTx(ctx, tx, input.CompanyID, input.NodeID, input.LogicGateID); err == nil {
		card = projectedCard
	} else {
		return CommunicationsTriageConversionResult{}, err
	}
	for _, messageID := range input.MessageIDs {
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

		placement, err := scanCommunicationsEmailPlacement(tx.QueryRowContext(ctx, `
insert into communications_email_node_attachments (
  company_id, user_id, message_id, node_id, board_id, card_id, logic_gate_id,
  message, created_timestamp, updated_timestamp
) values ($1, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::jsonb, now(), now())
on conflict (company_id, user_id, message_id, node_id)
do update set
  board_id=excluded.board_id,
  card_id=excluded.card_id,
  logic_gate_id=excluded.logic_gate_id,
  message=excluded.message,
  updated_timestamp=now()
returning company_id::text, user_id::text, message_id, node_id::text, board_id, card_id::text, logic_gate_id::text, created_timestamp, updated_timestamp`,
			input.CompanyID, input.UserID, messageID, input.NodeID, card.BoardID, card.CardID, input.LogicGateID, string(rawMessage)))
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if err := addEmailProjectionSQL(ctx, tx, input.CompanyID, input.NodeID, message, time.Now().UTC()); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `
delete from communications_triage_items
where user_id=$1 and message_id=$2`, input.UserID, messageID); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		node, err := scanNode(tx.QueryRowContext(ctx, `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1 and n.node_id=$2`, input.CompanyID, input.NodeID))
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		provenance := CommunicationsEmailConversionProvenance{
			CompanyID:   placement.CompanyID,
			UserID:      placement.UserID,
			MessageID:   placement.MessageID,
			ThreadID:    strings.TrimSpace(message.ThreadID),
			NodeID:      placement.NodeID,
			BoardID:     placement.BoardID,
			CardID:      placement.CardID,
			LogicGateID: placement.LogicGateID,
		}
		result.Nodes = append(result.Nodes, node)
		result.Cards = append(result.Cards, card)
		result.Assignments = append(result.Assignments, assignment)
		result.EmailPlacements = append(result.EmailPlacements, placement)
		result.EmailProvenance = append(result.EmailProvenance, provenance)
		result.DeletedMessageIDs = append(result.DeletedMessageIDs, messageID)
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
select company_id, user_id, message_id, node_id, board_id, card_id, logic_gate_id, created_timestamp, updated_timestamp
from (
  select company_id::text, user_id::text, message_id, node_id::text, board_id, card_id::text, logic_gate_id::text, created_timestamp, updated_timestamp
  from communications_email_nodes
  where user_id=$1
    and company_id=$2
    and message_id in (`+strings.Join(placeholders, ",")+`)
  union all
  select company_id::text, user_id::text, message_id, node_id::text, board_id, card_id::text, logic_gate_id::text, created_timestamp, updated_timestamp
  from communications_email_node_attachments
  where user_id=$1
    and company_id=$2
    and message_id in (`+strings.Join(placeholders, ",")+`)
) placements
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
delete from node_logic_gate_assignments
where company_id=$1
  and node_id=$2
  and compatibility_board_id=$3
  and compatibility_card_id=$4`, input.CompanyID, link.NodeID, input.BoardID, input.CardID); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if err := deleteKanbanBoardProjectionForNodeTx(ctx, tx, input.CompanyID, link.NodeID); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from node_relationships
where company_id=$1 and (node_id_a=$2 or node_id_b=$2)`, input.CompanyID, link.NodeID); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from company_explorer_items
where company_id=$1::uuid and target_type='node' and target_id=$2::uuid`, input.CompanyID, link.NodeID); err != nil {
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
