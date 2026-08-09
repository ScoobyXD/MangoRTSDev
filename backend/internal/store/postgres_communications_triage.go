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
select relationship.company_id::text,'',message.provider_message_id,
       relationship.resource_id::text,
       jsonb_build_object(
        'id',message.provider_message_id,'thread_id',thread.provider_thread_id,
        'subject',message.subject,'snippet',message.snippet,
        'body',case when btrim(message.rich_html_body)<>'' then message.rich_html_body else message.text_fallback end,
        'date',coalesce(floor(extract(epoch from message.message_timestamp)*1000)::bigint,0),
        'unread',message.unread,'starred',message.starred,
        'from',message.sender_snapshot,'to',message.to_snapshot,'cc',message.cc_snapshot,
        'bcc',message.bcc_snapshot,'reply_to',message.reply_to_snapshot,
        'attachments',message.attachment_metadata,'folders',message.folder_snapshot,
        'folder_ids',message.folder_id_snapshot,'download_complete',message.download_complete),
       relationship.created_timestamp
from email_relationships relationship
join email_threads thread on thread.company_id=relationship.company_id and thread.email_thread_id=relationship.email_thread_id
join email_messages message on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id and message.email_message_id=relationship.email_message_id
join node_logic_gate_assignments assignment on assignment.company_id=relationship.company_id
 and assignment.node_id=relationship.resource_id
where relationship.company_id=$1::uuid and relationship.resource_type='node'
 and relationship.resource_id=$2::uuid and relationship.resource_textbox_id is null
 and assignment.compatibility_board_id=$3 and assignment.compatibility_card_id=$4::uuid
order by relationship.created_timestamp limit 1`, companyID, nodeID, boardID, cardID).Scan(
		&reference.CompanyID, &reference.UserID, &reference.MessageID, &reference.NodeID,
		&reference.Message, &reference.CreatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return postgresCommunicationsEmailNodeReference{}, false, nil
	}
	if err != nil {
		return postgresCommunicationsEmailNodeReference{}, false, err
	}
	return reference, true, nil
}

func restorePostgresCommunicationsEmailNodeReferenceTx(ctx context.Context, tx *sql.Tx, reference postgresCommunicationsEmailNodeReference, boardID, cardID, logicGateID string) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `
select exists(select 1 from email_relationships
 where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid)`,
		reference.CompanyID, reference.NodeID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
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
	case CommunicationsEmailConversionTargetProject:
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
	if logicGate.RACIAssignments == nil {
		logicGate.RACIAssignments = []domain.LogicGateRACIAssignment{}
	}
	logicGate.DefaultAccess = defaultResourceAccessOrEdit(logicGate.DefaultAccess)
	if input.Target.ProjectID != "" {
		var projectExists bool
		if err := tx.QueryRowContext(ctx, `select exists (select 1 from projects where company_id=$1::uuid and project_id=$2::uuid)`, input.CompanyID, input.Target.ProjectID).Scan(&projectExists); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if !projectExists {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
	}
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
values ($1, $2, $3, $4::smallint, now())`, input.CompanyID, nodeID, nodeTitle, input.Priority); err != nil {
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
		card, err := nodeLogicGateAssignmentCardSQL(ctx, tx, assignment)
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		now := time.Now().UTC()
		placement := domain.CommunicationsEmailPlacement{
			CompanyID: input.CompanyID, UserID: input.UserID, MessageID: messageID, NodeID: nodeID,
			BoardID: board.BoardID, CardID: card.CardID, LogicGateID: input.LogicGateID,
			CreatedTimestamp: now, UpdatedTimestamp: now,
		}
		emailInput := input
		emailInput.NodeID = nodeID
		informationID, emailThreadID, emailMessageID, err := r.persistCommunicationsConversionEmailTx(ctx, tx, emailInput, message, time.Now().UTC())
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.AttachedEmailInformationIDs = append(result.AttachedEmailInformationIDs, informationID)
		result.EmailThreadIDs = append(result.EmailThreadIDs, emailThreadID)
		result.EmailMessageIDs = append(result.EmailMessageIDs, emailMessageID)
		if _, err := tx.ExecContext(ctx, `
delete from communications_triage_items
where user_id=$1 and message_id=$2`, input.UserID, messageID); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		err = syncNodeLogicGateAssignmentProjectionDependenciesTx(ctx, tx, NodeLogicGateAssignmentProjectionDependencyInput{
			CompanyID:    input.CompanyID,
			AssignmentID: assignment.AssignmentID,
			NodeID:       nodeID,
		})
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if projectedCard, err := kanbanBoardProjectionCardByNodeTx(ctx, tx, input.CompanyID, nodeID, input.LogicGateID); err == nil {
			card = projectedCard
		} else {
			return CommunicationsTriageConversionResult{}, err
		}
		card.CreatedFromEmail = true
		if input.Target.ProjectID != "" {
			relationships, err := upsertCommunicationsTriageProjectRelationshipTx(ctx, tx, input, nodeID)
			if err != nil {
				return CommunicationsTriageConversionResult{}, err
			}
			result.ProjectRelationships = append(result.ProjectRelationships, relationships...)
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
	if err := tx.Commit(); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) attachCommunicationsTriageItemsToStandaloneNodeTx(ctx context.Context, tx *sql.Tx, input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error) {
	updateResult, err := tx.ExecContext(ctx, `
update nodes
set priority=case when $3::boolean then $4::smallint else priority end
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID, input.PrioritySet, input.Priority)
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
		informationID, emailThreadID, emailMessageID, err := r.persistCommunicationsConversionEmailTx(ctx, tx, input, message, time.Now().UTC())
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.AttachedEmailInformationIDs = append(result.AttachedEmailInformationIDs, informationID)
		result.EmailThreadIDs = append(result.EmailThreadIDs, emailThreadID)
		result.EmailMessageIDs = append(result.EmailMessageIDs, emailMessageID)
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
	if err := r.addCommunicationsConversionAtomicWritesTx(ctx, tx, input, &result); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) convertCommunicationsTriageItemsToExplorerTargetTx(ctx context.Context, tx *sql.Tx, input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error) {
	if input.Target.ProjectID != "" {
		var projectExists bool
		if err := tx.QueryRowContext(ctx, `select exists (select 1 from projects where company_id=$1::uuid and project_id=$2::uuid)`, input.CompanyID, input.Target.ProjectID).Scan(&projectExists); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if !projectExists {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
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
		nodeID := newUUIDv7String()
		nodeTitle := emailNodeTitle(message)
		if _, err := tx.ExecContext(ctx, `
insert into nodes (company_id, node_id, name, priority, created_timestamp)
values ($1, $2, $3, $4::smallint, now())`, input.CompanyID, nodeID, nodeTitle, input.Priority); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		emailInput := input
		emailInput.NodeID = nodeID
		informationID, emailThreadID, emailMessageID, err := r.persistCommunicationsConversionEmailTx(ctx, tx, emailInput, message, time.Now().UTC())
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.AttachedEmailInformationIDs = append(result.AttachedEmailInformationIDs, informationID)
		result.EmailThreadIDs = append(result.EmailThreadIDs, emailThreadID)
		result.EmailMessageIDs = append(result.EmailMessageIDs, emailMessageID)
		if _, err := tx.ExecContext(ctx, `
delete from communications_triage_items
where user_id=$1 and message_id=$2`, input.UserID, messageID); err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		if input.Target.ProjectID != "" {
			relationships, err := upsertCommunicationsTriageProjectRelationshipTx(ctx, tx, input, nodeID)
			if err != nil {
				return CommunicationsTriageConversionResult{}, err
			}
			result.ProjectRelationships = append(result.ProjectRelationships, relationships...)
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

func upsertCommunicationsTriageProjectRelationshipTx(ctx context.Context, tx *sql.Tx, input CommunicationsTriageConversionInput, nodeID string) ([]domain.ProjectRelationshipProjection, error) {
	position := input.Target.Position
	if position <= 0 {
		if err := tx.QueryRowContext(ctx, `select coalesce(max(position), 0) + 1000 from project_relationships where company_id=$1::uuid and project_id=$2::uuid`, input.CompanyID, input.Target.ProjectID).Scan(&position); err != nil {
			return nil, err
		}
	}
	if strings.TrimSpace(input.LogicGateID) == "" {
		return nil, ErrProjectNodeLogicGateRequired
	}
	gateRelationshipID, err := upsertProjectRelationshipSourceTx(ctx, tx, ProjectRelationshipInput{
		CompanyID: input.CompanyID, ProjectID: input.Target.ProjectID, ResourceType: EntityTypeLogicGate,
		ResourceID: input.LogicGateID, Position: position,
	})
	if err != nil {
		return nil, err
	}
	nodeRelationshipID, err := upsertProjectRelationshipSourceTx(ctx, tx, ProjectRelationshipInput{
		CompanyID: input.CompanyID, ProjectID: input.Target.ProjectID, ResourceType: EntityTypeNode,
		ResourceID: nodeID, Position: position,
	})
	if err != nil {
		return nil, err
	}
	projections := make([]domain.ProjectRelationshipProjection, 0, 2)
	for _, relationshipID := range []string{gateRelationshipID, nodeRelationshipID} {
		if err := syncProjectRelationshipProjectionDependenciesTx(ctx, tx, ProjectRelationshipProjectionDependencyInput{CompanyID: input.CompanyID, RelationshipID: relationshipID}); err != nil {
			return nil, err
		}
		projection, err := projectRelationshipProjectionByIDTx(ctx, tx, input.CompanyID, relationshipID)
		if err != nil {
			return nil, err
		}
		projections = append(projections, projection)
	}
	return projections, nil
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
set priority=case when $3::boolean then $4::smallint else priority end
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID, input.PrioritySet, input.Priority)
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
	err = syncNodeLogicGateAssignmentProjectionDependenciesTx(ctx, tx, NodeLogicGateAssignmentProjectionDependencyInput{
		CompanyID:    input.CompanyID,
		AssignmentID: assignment.AssignmentID,
		NodeID:       input.NodeID,
	})
	if err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
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

		now := time.Now().UTC()
		placement := domain.CommunicationsEmailPlacement{
			CompanyID: input.CompanyID, UserID: input.UserID, MessageID: messageID, NodeID: input.NodeID,
			BoardID: card.BoardID, CardID: card.CardID, LogicGateID: input.LogicGateID,
			CreatedTimestamp: now, UpdatedTimestamp: now,
		}
		informationID, emailThreadID, emailMessageID, err := r.persistCommunicationsConversionEmailTx(ctx, tx, input, message, time.Now().UTC())
		if err != nil {
			return CommunicationsTriageConversionResult{}, err
		}
		result.AttachedEmailInformationIDs = append(result.AttachedEmailInformationIDs, informationID)
		result.EmailThreadIDs = append(result.EmailThreadIDs, emailThreadID)
		result.EmailMessageIDs = append(result.EmailMessageIDs, emailMessageID)
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
	if err := r.addCommunicationsConversionAtomicWritesTx(ctx, tx, input, &result); err != nil {
		return CommunicationsTriageConversionResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) ListCommunicationsEmailPlacements(userID, companyID string, messageIDs []string) ([]domain.CommunicationsEmailPlacement, error) {
	userID, companyID = cleanUUIDText(userID), cleanUUIDText(companyID)
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
select relationship.company_id::text,$1::text,message.provider_message_id,
       relationship.resource_id::text,
       coalesce(assignment.compatibility_board_id,''),
       coalesce(assignment.compatibility_card_id::text,''),
       coalesce(assignment.logic_gate_id::text,''),
       relationship.created_timestamp,
       greatest(relationship.created_timestamp,message.updated_timestamp)
from email_relationships relationship
join email_messages message on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id
 and message.email_message_id=relationship.email_message_id
left join node_logic_gate_assignments assignment on assignment.company_id=relationship.company_id
 and assignment.node_id=relationship.resource_id
where relationship.company_id=$2::uuid and relationship.resource_type='node'
 and relationship.resource_textbox_id is null
 and message.provider_message_id in (`+strings.Join(placeholders, ",")+`)
 and mangorts_user_can_access_resource(relationship.company_id,'node',
     relationship.resource_id,$1::uuid,'edit')
order by relationship.created_timestamp desc,message.provider_message_id,relationship.resource_id`, args...)
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

func (r *PostgresRepo) ListCommunicationsEmailPlacementsForConnection(userID, companyID, emailConnectionID string, messageIDs []string) ([]domain.CommunicationsEmailPlacement, error) {
	userID, companyID, emailConnectionID = cleanUUIDText(userID), cleanUUIDText(companyID), cleanUUIDText(emailConnectionID)
	if userID == "" || companyID == "" || emailConnectionID == "" {
		return nil, ErrInvalid
	}
	ids := normalizeUniqueStrings(messageIDs, 0)
	if len(ids) == 0 {
		return []domain.CommunicationsEmailPlacement{}, nil
	}
	args := []any{userID, companyID, emailConnectionID}
	placeholders := make([]string, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
	}
	rows, err := r.db.Query(`
select relationship.company_id::text,$1::text,message.provider_message_id,
       relationship.resource_id::text,
       coalesce(assignment.compatibility_board_id,''),
       coalesce(assignment.compatibility_card_id::text,''),
       coalesce(assignment.logic_gate_id::text,''),
       relationship.created_timestamp,
       greatest(relationship.created_timestamp,message.updated_timestamp)
from email_relationships relationship
join email_threads thread on thread.company_id=relationship.company_id
 and thread.email_thread_id=relationship.email_thread_id
join email_messages message on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id
 and message.email_message_id=relationship.email_message_id
left join node_logic_gate_assignments assignment on assignment.company_id=relationship.company_id
 and assignment.node_id=relationship.resource_id
where relationship.company_id=$2::uuid
 and thread.email_connection_id=$3::uuid
 and relationship.resource_type='node'
 and relationship.resource_textbox_id is null
 and message.provider_message_id in (`+strings.Join(placeholders, ",")+`)
 and mangorts_user_can_access_resource(relationship.company_id,'node',
     relationship.resource_id,$1::uuid,'edit')
order by relationship.created_timestamp desc,message.provider_message_id,relationship.resource_id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	placements := make([]domain.CommunicationsEmailPlacement, 0)
	for rows.Next() {
		placement, scanErr := scanCommunicationsEmailPlacement(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		placements = append(placements, placement)
	}
	return placements, rows.Err()
}

func emailProjectionMailboxScopeSQL(ctx context.Context, tx *sql.Tx, companyID, nodeID, messageID string) (string, string, error) {
	var sharedInboxID, accountEmail string
	err := tx.QueryRowContext(ctx, `
select coalesce(inbox.shared_inbox_id::text,''),connection.account_email
from email_relationships relationship
join email_threads thread on thread.company_id=relationship.company_id
 and thread.email_thread_id=relationship.email_thread_id
join email_connections connection on connection.company_id=thread.company_id
 and connection.email_connection_id=thread.email_connection_id
left join shared_inboxes inbox on inbox.company_id=thread.company_id
 and inbox.company_email_connection_id=thread.email_connection_id
join email_messages message on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id
 and message.email_message_id=relationship.email_message_id
where relationship.company_id=$1::uuid and relationship.resource_type='node'
 and relationship.resource_id=$2::uuid and message.provider_message_id=$3
order by relationship.created_timestamp desc limit 1`, companyID, nodeID, messageID).Scan(&sharedInboxID, &accountEmail)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", nil
	}
	return sharedInboxID, accountEmail, err
}

func addEmailProjectionSQL(ctx context.Context, tx *sql.Tx, companyID, nodeID, sharedInboxID, accountEmail string, message domain.EmailMessageSnapshot, attachedAt time.Time, createdFromEmail bool) error {
	var emailThreadID string
	if err := tx.QueryRowContext(ctx, `
select email_thread_id::text from email_messages
where company_id=$1::uuid and provider_message_id=$2
order by updated_timestamp desc limit 1`, companyID, message.ID).Scan(&emailThreadID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	_, err := addEmailProjectionSQLWithThread(ctx, tx, companyID, nodeID, sharedInboxID, accountEmail, message, emailThreadID, attachedAt, createdFromEmail)
	return err
}

func addEmailProjectionSQLWithThread(ctx context.Context, tx *sql.Tx, companyID, nodeID, sharedInboxID, accountEmail string, message domain.EmailMessageSnapshot, emailThreadID string, attachedAt time.Time, createdFromEmail bool) (string, error) {
	companyID, nodeID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(nodeID), cleanUUIDText(emailThreadID)
	if companyID == "" || nodeID == "" || emailThreadID == "" || strings.TrimSpace(message.ID) == "" {
		return "", ErrInvalid
	}
	relationshipID := newUUIDv7String()
	if err := linkPostgresCommunicationsEmailThreadToNodeTx(ctx, tx, companyID, nodeID, relationshipID, emailThreadID, message.ID, ""); err != nil {
		return "", err
	}
	if err := tx.QueryRowContext(ctx, `
select relationship.email_relationship_id::text
from email_relationships relationship
join email_messages email_message on email_message.company_id=relationship.company_id
 and email_message.email_thread_id=relationship.email_thread_id
 and email_message.email_message_id=relationship.email_message_id
where relationship.company_id=$1::uuid and relationship.resource_type='node'
 and relationship.resource_id=$2::uuid and relationship.email_thread_id=$3::uuid
 and relationship.resource_textbox_id is null and email_message.provider_message_id=$4`,
		companyID, nodeID, emailThreadID, message.ID).Scan(&relationshipID); err != nil {
		return "", err
	}
	return relationshipID, nil
}

func deletePostgresCommunicationsEmailSourceNodeTx(ctx context.Context, tx *sql.Tx, companyID string, link communicationsEmailNodeLink) error {
	if err := retireNodeChatAttachmentRelationshipsTx(ctx, tx, companyID, link.NodeID); err != nil {
		return err
	}
	if err := retireAttachmentOwnerRelationshipsTx(ctx, tx, companyID, EntityTypeNode, link.NodeID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `delete from email_relationships where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid`, companyID, link.NodeID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `delete from nodes where company_id=$1::uuid and node_id=$2::uuid`, companyID, link.NodeID)
	if err != nil {
		return err
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return ErrNotFound
	}
	return nil
}

func loadPostgresCommunicationsEmailNodeLinkForCardTx(ctx context.Context, tx *sql.Tx, companyID, userID, boardID, cardID string) (communicationsEmailNodeLink, error) {
	var link communicationsEmailNodeLink
	var raw []byte
	err := tx.QueryRowContext(ctx, `
select relationship.company_id::text,$2::text,message.provider_message_id,
       relationship.resource_id::text,assignment.compatibility_board_id,
       assignment.compatibility_card_id::text,assignment.logic_gate_id::text,
       jsonb_build_object(
        'id',message.provider_message_id,'thread_id',thread.provider_thread_id,
        'subject',message.subject,'snippet',message.snippet,
        'body',case when btrim(message.rich_html_body)<>'' then message.rich_html_body else message.text_fallback end,
        'date',coalesce(floor(extract(epoch from message.message_timestamp)*1000)::bigint,0),
        'unread',message.unread,'starred',message.starred,
        'from',message.sender_snapshot,'to',message.to_snapshot,'cc',message.cc_snapshot,
        'bcc',message.bcc_snapshot,'reply_to',message.reply_to_snapshot,
        'attachments',message.attachment_metadata,'folders',message.folder_snapshot,
        'folder_ids',message.folder_id_snapshot,'download_complete',message.download_complete),
       relationship.created_timestamp,greatest(message.updated_timestamp,relationship.created_timestamp)
from email_relationships relationship
join email_threads thread on thread.company_id=relationship.company_id and thread.email_thread_id=relationship.email_thread_id
join email_messages message on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id and message.email_message_id=relationship.email_message_id
join node_logic_gate_assignments assignment on assignment.company_id=relationship.company_id
 and assignment.node_id=relationship.resource_id
where relationship.company_id=$1::uuid and relationship.resource_type='node'
 and relationship.resource_textbox_id is null
 and assignment.compatibility_board_id=$3 and assignment.compatibility_card_id=$4::uuid
 and ($2='' or mangorts_user_can_access_resource(relationship.company_id,'node',
     relationship.resource_id,$2::uuid,'edit'))
order by relationship.created_timestamp limit 1
for update of relationship`, companyID, userID, boardID, cardID).Scan(
		&link.CompanyID, &link.UserID, &link.MessageID, &link.NodeID, &link.BoardID, &link.CardID,
		&link.LogicGateID, &raw, &link.CreatedTimestamp, &link.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return communicationsEmailNodeLink{}, ErrNotFound
	}
	if err != nil {
		return communicationsEmailNodeLink{}, err
	}
	if err := json.Unmarshal(raw, &link.Message); err != nil {
		return communicationsEmailNodeLink{}, err
	}
	link.Message = normalizeEmailMessageSnapshot(link.Message)
	return link, nil
}

func (r *PostgresRepo) TransferCommunicationsEmailNode(input CommunicationsEmailNodeTransferInput) (CommunicationsEmailNodeTransferResult, error) {
	input, err := NormalizeCommunicationsEmailNodeTransferInput(input)
	if err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}
	defer tx.Rollback()
	link, err := loadPostgresCommunicationsEmailNodeLinkForCardTx(ctx, tx, input.CompanyID, input.UserID, input.SourceBoardID, input.SourceCardID)
	if err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}
	targetCard, err := scanKanbanCard(tx.QueryRowContext(ctx, `
select `+kanbanBoardProjectionCardSelectColumns+`
from kanban_board_projection projection
where projection.company_id=$1::uuid and projection.compatibility_board_id=$2
 and projection.compatibility_card_id=$3::uuid
for update`, input.CompanyID, input.TargetBoardID, input.TargetCardID))
	if errors.Is(err, sql.ErrNoRows) {
		return CommunicationsEmailNodeTransferResult{}, ErrNotFound
	}
	if err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}
	targetLogicGateID := ""
	if targetCard.LogicGateID != nil {
		targetLogicGateID = strings.TrimSpace(*targetCard.LogicGateID)
	}
	if targetLogicGateID == "" || targetCard.NodeID == link.NodeID {
		return CommunicationsEmailNodeTransferResult{}, ErrInvalid
	}
	sharedInboxID, accountEmail, err := emailProjectionMailboxScopeSQL(ctx, tx, input.CompanyID, link.NodeID, link.MessageID)
	if err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}
	if err := addEmailProjectionSQL(ctx, tx, input.CompanyID, targetCard.NodeID, sharedInboxID, accountEmail, link.Message, time.Now().UTC(), false); err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}
	if err := deletePostgresCommunicationsEmailSourceNodeTx(ctx, tx, input.CompanyID, link); err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}
	now := time.Now().UTC()
	placement := domain.CommunicationsEmailPlacement{CompanyID: input.CompanyID, UserID: link.UserID,
		MessageID: link.MessageID, NodeID: targetCard.NodeID, BoardID: targetCard.BoardID,
		CardID: targetCard.CardID, LogicGateID: targetLogicGateID, CreatedTimestamp: now, UpdatedTimestamp: now}
	events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{
		workspaceDomainEventInput(input.CompanyID, "kanban_card_deleted", map[string]any{"board_id": link.BoardID, "card_id": link.CardID}),
		nodeDeletedWorkspaceEventInput(input.CompanyID, link.NodeID),
		workspaceDomainEventInput(input.CompanyID, "node_updated", map[string]any{"node_id": targetCard.NodeID}),
	})
	if err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsEmailNodeTransferResult{}, err
	}
	return CommunicationsEmailNodeTransferResult{EmailPlacement: placement, DeletedNodeID: link.NodeID,
		DeletedCardID: link.CardID, SourceBoardID: link.BoardID, TargetNodeID: targetCard.NodeID,
		TargetBoardID: targetCard.BoardID, TargetCardID: targetCard.CardID, Events: events}, nil
}

func (r *PostgresRepo) RevertCommunicationsTriageNode(input CommunicationsTriageRevertInput) (CommunicationsTriageRevertResult, error) {
	input.UserID = cleanUUIDText(input.UserID)
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.BoardID = strings.TrimSpace(input.BoardID)
	input.CardID = cleanUUIDText(input.CardID)
	if input.UserID == "" || input.CompanyID == "" || input.BoardID == "" || input.CardID == "" {
		return CommunicationsTriageRevertResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	defer tx.Rollback()
	link, err := loadPostgresCommunicationsEmailNodeLinkForCardTx(ctx, tx, input.CompanyID, input.UserID, input.BoardID, input.CardID)
	if err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	rawMessage, err := json.Marshal(link.Message)
	if err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	triageItem, err := scanCommunicationsTriageItem(tx.QueryRowContext(ctx, `
insert into communications_triage_items(user_id,message_id,message,created_timestamp,updated_timestamp)
values($1::uuid,$2,$3::jsonb,now(),now())
on conflict(user_id,message_id) do update set message=excluded.message,updated_timestamp=now()
returning user_id::text,message_id,message,created_timestamp,updated_timestamp`,
		input.UserID, link.MessageID, string(rawMessage)))
	if err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if err := deletePostgresCommunicationsEmailSourceNodeTx(ctx, tx, input.CompanyID, link); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{
		workspaceDomainEventInput(input.CompanyID, "kanban_card_deleted", map[string]any{"board_id": input.BoardID, "card_id": input.CardID}),
		nodeDeletedWorkspaceEventInput(input.CompanyID, link.NodeID),
	})
	if err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CommunicationsTriageRevertResult{}, err
	}
	return CommunicationsTriageRevertResult{TriageItem: triageItem, DeletedNodeID: link.NodeID,
		DeletedCardID: input.CardID, BoardID: input.BoardID, Events: events}, nil
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
