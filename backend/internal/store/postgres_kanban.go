package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func scanKanbanBoard(row interface {
	Scan(dest ...any) error
}) (domain.KanbanBoard, error) {
	var item domain.KanbanBoard
	err := row.Scan(
		&item.CompanyID,
		&item.BoardID,
		&item.LogicGateID,
		&item.Title,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

func scanKanbanColumn(row interface {
	Scan(dest ...any) error
}) (domain.KanbanColumn, error) {
	var item domain.KanbanColumn
	err := row.Scan(
		&item.CompanyID,
		&item.BoardID,
		&item.ColumnID,
		&item.Title,
		&item.Position,
		&item.WidthPx,
		&item.HeightPx,
		&item.ItemColor,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	return item, err
}

func scanKanbanCard(row interface {
	Scan(dest ...any) error
}) (domain.KanbanCard, error) {
	var item domain.KanbanCard
	var dueDate sql.NullString
	var priority sql.NullInt64
	var accountsJSON sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.BoardID,
		&item.CardID,
		&item.ColumnID,
		&item.NodeID,
		&item.LogicGateID,
		&item.RequestedByUserID,
		&item.PlacedByUserID,
		&item.NodeTitle,
		&item.DescriptionSnapshot,
		&item.IsIssue,
		&item.Position,
		&dueDate,
		&priority,
		&item.ProjectionUpdatedTimestamp,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
		&accountsJSON,
	)
	if dueDate.Valid {
		item.DueDate = &dueDate.String
	}
	if priority.Valid {
		value := int(priority.Int64)
		item.Priority = &value
	}
	item.Accounts = scanAccountSnapshotsJSON(accountsJSON)
	return item, err
}

func synthesizeKanbanBoardFromLogicGate(logicGate domain.LogicGate, position int) domain.KanbanBoard {
	logicGateID := logicGate.LogicGateID
	boardID := LogicGateKanbanBoardID(logicGateID)
	if position <= 0 {
		position = 1000
	}
	return domain.KanbanBoard{
		CompanyID:        logicGate.CompanyID,
		BoardID:          boardID,
		LogicGateID:      &logicGateID,
		Title:            normalizeKanbanBoardTitle(boardID, logicGate.Header),
		Position:         position,
		CreatedTimestamp: logicGate.CreatedTimestamp,
		UpdatedTimestamp: logicGate.CreatedTimestamp,
	}
}

func scanLogicGateKanbanSource(row interface{ Scan(dest ...any) error }) (domain.LogicGate, error) {
	var logicGate domain.LogicGate
	err := row.Scan(&logicGate.CompanyID, &logicGate.LogicGateID, &logicGate.Header, &logicGate.CreatedTimestamp)
	return logicGate, err
}

func (r *PostgresRepo) ListKanbanBoards(companyID string, query KanbanBoardQuery) ([]domain.KanbanBoard, error) {
	ctx := context.Background()
	query = NormalizeKanbanBoardQuery(query)
	rows, err := r.db.QueryContext(ctx, `
select company_id::text, logic_gate_id::text, header, created_timestamp
from logic_gates
where company_id=$1
  and ($2 = '' or logic_gate_id=$2::uuid)
order by created_timestamp asc, logic_gate_id asc`, companyID, query.LogicGateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.KanbanBoard, 0)
	position := 0
	for rows.Next() {
		logicGate, err := scanLogicGateKanbanSource(rows)
		if err != nil {
			return nil, err
		}
		position += 1000
		if query.AfterPosition > 0 && position <= query.AfterPosition {
			continue
		}
		items = append(items, synthesizeKanbanBoardFromLogicGate(logicGate, position))
		if len(items) >= query.Limit {
			break
		}
	}
	return items, rows.Err()
}

func (r *PostgresRepo) EnsureLogicGateKanbanBoard(companyID, logicGateID, title string) (domain.KanbanBoard, error) {
	logicGate, err := r.GetLogicGate(strings.TrimSpace(companyID), strings.TrimSpace(logicGateID))
	if errors.Is(err, ErrNotFound) {
		return domain.KanbanBoard{}, ErrNotFound
	}
	if err != nil {
		return domain.KanbanBoard{}, err
	}
	return synthesizeKanbanBoardFromLogicGate(logicGate, 1000), nil
}

func (r *PostgresRepo) CreateKanbanBoard(companyID, boardID, title string, position int) (domain.KanbanBoard, error) {
	logicGateID := LogicGateIDFromKanbanBoardID(boardID)
	if logicGateID == "" {
		return domain.KanbanBoard{}, ErrInvalid
	}
	return r.EnsureLogicGateKanbanBoard(companyID, logicGateID, title)
}

func (r *PostgresRepo) UpdateKanbanBoard(companyID, boardID, title string, position int) (domain.KanbanBoard, error) {
	logicGateID := LogicGateIDFromKanbanBoardID(boardID)
	if logicGateID == "" {
		return domain.KanbanBoard{}, ErrInvalid
	}
	if strings.TrimSpace(title) != "" {
		if _, err := r.UpdateLogicGateHeader(companyID, logicGateID, title); err != nil {
			return domain.KanbanBoard{}, err
		}
	}
	return r.EnsureLogicGateKanbanBoard(companyID, logicGateID, title)
}

func (r *PostgresRepo) DeleteKanbanBoard(companyID, boardID string) error {
	if LogicGateIDFromKanbanBoardID(boardID) != "" {
		return ErrInvalid
	}
	return ErrNotFound
}

func (r *PostgresRepo) ListKanbanColumns(companyID, boardID string) ([]domain.KanbanColumn, error) {
	logicGateID := LogicGateIDFromKanbanBoardID(boardID)
	if logicGateID == "" {
		return nil, ErrNotFound
	}
	logicGate, err := r.GetLogicGate(companyID, logicGateID)
	if err != nil {
		return nil, err
	}
	return synthesizeLogicGateWorkColumns(logicGate.CompanyID, LogicGateKanbanBoardID(logicGate.LogicGateID), logicGate.CreatedTimestamp), nil
}

func (r *PostgresRepo) CreateKanbanColumn(companyID, boardID, title string, position int, widthPx int, heightPx int, itemColor string) (domain.KanbanColumn, error) {
	return domain.KanbanColumn{}, ErrInvalid
}

func (r *PostgresRepo) UpdateKanbanColumn(companyID, boardID, columnID, title string, position int, widthPx int, heightPx int, itemColor string) (domain.KanbanColumn, error) {
	return domain.KanbanColumn{}, ErrInvalid
}

func (r *PostgresRepo) DeleteKanbanColumn(companyID, boardID, columnID string) error {
	return ErrInvalid
}

func (r *PostgresRepo) ListKanbanCards(companyID, boardID string, query KanbanCardQuery) ([]domain.KanbanCard, error) {
	logicGateID := LogicGateIDFromKanbanBoardID(boardID)
	if logicGateID == "" {
		return nil, ErrNotFound
	}
	return listKanbanBoardProjectionCardsTx(context.Background(), r.db, companyID, logicGateID, query)
}

func (r *PostgresRepo) GetKanbanCard(companyID, boardID, cardID string) (domain.KanbanCard, error) {
	companyID = strings.TrimSpace(companyID)
	boardID = strings.TrimSpace(boardID)
	cardID = strings.TrimSpace(cardID)
	if companyID == "" || boardID == "" || cardID == "" {
		return domain.KanbanCard{}, ErrInvalid
	}
	ctx := context.Background()
	item, err := scanKanbanCard(r.db.QueryRowContext(ctx, `
select `+kanbanBoardProjectionCardSelectColumns+`
from kanban_board_projection projection
where projection.company_id=$1::uuid
  and projection.compatibility_board_id=$2
  and projection.compatibility_card_id=$3::uuid`, companyID, boardID, cardID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.KanbanCard{}, ErrNotFound
	}
	return item, err
}

func logicGateWorkColumnForCommand(companyID, boardID, columnID, status, fallbackStatus string) (domain.KanbanColumn, error) {
	statusKey := ""
	if strings.TrimSpace(columnID) != "" {
		key, ok := NormalizeLogicGateWorkStatusKey(columnID)
		if !ok || key == "" {
			return domain.KanbanColumn{}, ErrNotFound
		}
		statusKey = key
	}
	if statusKey == "" && strings.TrimSpace(status) != "" {
		key, ok := NormalizeLogicGateWorkStatusKey(status)
		if !ok || key == "" {
			return domain.KanbanColumn{}, ErrNotFound
		}
		statusKey = key
	}
	if statusKey == "" && strings.TrimSpace(fallbackStatus) != "" {
		statusKey = logicGateWorkStatusKeyOrDefault(fallbackStatus, LogicGateWorkStatusPending)
	}
	if statusKey == "" {
		statusKey = LogicGateWorkStatusPending
	}
	spec := logicGateWorkStatusSpecForKey(statusKey)
	return domain.KanbanColumn{
		CompanyID: companyID,
		BoardID:   boardID,
		ColumnID:  spec.Key,
		Title:     spec.Title,
		Position:  spec.Position,
		WidthPx:   normalizeKanbanColumnWidth(0),
		HeightPx:  normalizeKanbanColumnHeight(0),
		ItemColor: spec.Color,
	}, nil
}

func nextLogicGateAssignmentPositionTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID, statusKey string) (int, error) {
	var position int
	err := tx.QueryRowContext(ctx, `
select coalesce(max(position), 0) + 1000
from node_logic_gate_assignments
where company_id=$1::uuid
  and logic_gate_id=$2::uuid
  and lower(replace(replace(trim(status_key), '_', ' '), '-', ' ')) =
      lower(replace(replace(trim($3), '_', ' '), '-', ' '))`, companyID, logicGateID, statusKey).Scan(&position)
	return position, err
}

func syncNodeStatusFromLogicGateAssignmentTx(ctx context.Context, tx *sql.Tx, assignment domain.NodeLogicGateAssignment) error {
	status := LogicGateWorkStatusTitle(assignment.StatusKey)
	if assignment.IsIssue {
		status = "Issue"
	}
	_, err := tx.ExecContext(ctx, `
update nodes
set status=$3
where company_id=$1::uuid and node_id=$2::uuid`, assignment.CompanyID, assignment.NodeID, status)
	return err
}

func assignNodeToLogicGateResponsibleSQL(ctx context.Context, tx *sql.Tx, companyID, logicGateID, nodeID string) error {
	_ = ctx
	_ = tx
	_ = companyID
	_ = logicGateID
	_ = nodeID
	return nil
}

func nodeForLogicGateAssignmentResultTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) (domain.Node, error) {
	return scanNode(tx.QueryRowContext(ctx, `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1 and n.node_id=$2`, companyID, nodeID))
}

func (r *PostgresRepo) UpsertKanbanCard(input KanbanCardMutationInput) (domain.KanbanCard, error) {
	result, err := r.UpsertKanbanCardWithWorkspaceEvent(input)
	return result.Card, err
}

func (r *PostgresRepo) UpsertKanbanCardWithWorkspaceEvent(input KanbanCardMutationInput) (KanbanCardWorkspaceEventResult, error) {
	logicGateID := LogicGateIDFromKanbanBoardID(input.BoardID)
	if logicGateID == "" {
		return KanbanCardWorkspaceEventResult{}, ErrInvalid
	}
	result, err := r.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:           input.CompanyID,
		LogicGateID:         logicGateID,
		NodeID:              input.NodeID,
		ColumnID:            input.ColumnID,
		NodeTitle:           input.NodeTitle,
		DescriptionSnapshot: input.DescriptionSnapshot,
		Position:            input.Position,
		IsIssue:             input.IsIssue,
		IsIssueSet:          input.IsIssueSet,
	})
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	return KanbanCardWorkspaceEventResult{Card: result.Card, DerivedNode: &result.Node, Events: result.Events}, nil
}

func (r *PostgresRepo) AssignNodeToLogicGateStatus(input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	ctx := ContextWithTimingRecorder(context.Background(), input.TimingRecorder)
	defer observeTiming(ctx, "repo.AssignNodeToLogicGateStatus.transaction")()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	defer tx.Rollback()

	result, err := r.assignNodeToLogicGateStatusTx(ctx, tx, input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	stopCommit := observeTiming(ctx, "repo.AssignNodeToLogicGateStatus.commit")
	if err := tx.Commit(); err != nil {
		stopCommit()
		return LogicGateNodeAssignmentResult{}, err
	}
	stopCommit()
	return result, nil
}

func (r *PostgresRepo) assignNodeToLogicGateStatusTx(ctx context.Context, tx *sql.Tx, input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error) {
	defer observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.total")()
	boardID := LogicGateKanbanBoardID(input.LogicGateID)

	stop := observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.logic_gate_read")
	logicGate, err := scanLogicGateKanbanSource(tx.QueryRowContext(ctx, `
select company_id::text, logic_gate_id::text, header, created_timestamp
from logic_gates
where company_id=$1::uuid and logic_gate_id=$2::uuid`, input.CompanyID, input.LogicGateID))
	stop()
	if errors.Is(err, sql.ErrNoRows) {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	_ = logicGate

	column, err := logicGateWorkColumnForCommand(input.CompanyID, boardID, input.ColumnID, input.Status, "")
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	var canonicalNodeTitle string
	var nodePriority sql.NullInt64
	var createdNode domain.Node
	deferCreatedNodeFolderItem := input.MutationOrigin == MutationOriginMatrix || input.MutationOrigin == MutationOriginKanban
	stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.node_read")
	if err := tx.QueryRowContext(ctx, `
select name, priority
from nodes
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID).Scan(&canonicalNodeTitle, &nodePriority); err != nil {
		stop()
		if errors.Is(err, sql.ErrNoRows) {
			if _, ok := logicGateAssignmentInputPriority(input); !ok {
				return LogicGateNodeAssignmentResult{}, ErrPriorityRequired
			}
			if input.CreateNodeTitle == "" {
				return LogicGateNodeAssignmentResult{}, ErrNotFound
			}
			stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.node_create")
			if deferCreatedNodeFolderItem {
				createdNode, err = r.createNodeWithIDWithoutProjectionOrFolderTx(ctx, tx, input.CompanyID, input.NodeID, input.CreateNodeTitle)
			} else {
				createdNode, err = r.createNodeWithIDWithoutProjectionTx(ctx, tx, input.CompanyID, input.NodeID, input.CreateNodeTitle)
			}
			stop()
			if err != nil {
				return LogicGateNodeAssignmentResult{}, err
			}
			canonicalNodeTitle = createdNode.Title
		} else {
			return LogicGateNodeAssignmentResult{}, err
		}
	} else if _, ok := logicGateAssignmentInputPriority(input); !ok && (!nodePriority.Valid || nodePriority.Int64 < 1 || nodePriority.Int64 > 5) {
		stop()
		return LogicGateNodeAssignmentResult{}, ErrPriorityRequired
	} else {
		stop()
	}

	if input.PrioritySet {
		priority, ok := logicGateAssignmentInputPriority(input)
		if !ok {
			return LogicGateNodeAssignmentResult{}, ErrPriorityRequired
		}
		stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.priority_write")
		if _, err := tx.ExecContext(ctx, `
update nodes
set priority=$3::smallint
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID, *priority); err != nil {
			stop()
			return LogicGateNodeAssignmentResult{}, err
		}
		stop()
	}

	stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.assignment_read")
	previousAssignment, previousAssignmentErr := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, "")
	stop()
	hadPreviousAssignment := previousAssignmentErr == nil
	if previousAssignmentErr != nil && !errors.Is(previousAssignmentErr, ErrNotFound) {
		return LogicGateNodeAssignmentResult{}, previousAssignmentErr
	}

	position := input.Position
	if position <= 0 {
		stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.assignment_position_read")
		position, err = nextLogicGateAssignmentPositionTx(ctx, tx, input.CompanyID, input.LogicGateID, column.ColumnID)
		stop()
		if err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}

	cardID := ""
	if hadPreviousAssignment && previousAssignment.LogicGateID == input.LogicGateID {
		cardID = previousAssignment.CompatibilityCardID
	}
	if cardID == "" {
		cardID = newUUIDv7String()
	}
	issueValue := false
	if input.IsIssueSet {
		issueValue = input.IsIssue
	} else if hadPreviousAssignment && previousAssignment.LogicGateID == input.LogicGateID {
		issueValue = previousAssignment.IsIssue
	}
	snapshotGVICFromLogicGate := !hadPreviousAssignment || previousAssignment.LogicGateID != input.LogicGateID
	placedByUserID := strings.TrimSpace(previousAssignment.PlacedByUserID)
	if !hadPreviousAssignment || previousAssignment.LogicGateID != input.LogicGateID {
		placedByUserID = strings.TrimSpace(input.ActorUserID)
	}

	stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.assignment_writes")
	assignment, err := upsertNodeLogicGateAssignmentSQL(ctx, tx, nodeLogicGateAssignmentSQLInput{
		CompanyID:            input.CompanyID,
		NodeID:               input.NodeID,
		LogicGateID:          input.LogicGateID,
		StatusKey:            column.ColumnID,
		ColumnID:             column.ColumnID,
		IsIssue:              issueValue,
		Position:             position,
		CompatibilityBoardID: boardID,
		CompatibilityCardID:  cardID,
		RequestedByUserID:    input.ActorUserID,
		PlacedByUserID:       placedByUserID,
	})
	stop()
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.node_assignment_writes")
	if err := syncNodeStatusFromLogicGateAssignmentTx(ctx, tx, assignment); err != nil {
		stop()
		return LogicGateNodeAssignmentResult{}, err
	}
	stop()
	if snapshotGVICFromLogicGate {
		stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.access_policy_copy")
		if _, err := snapshotPostgresResourceAccessPolicyTx(ctx, tx, input.CompanyID, EntityTypeLogicGate, input.LogicGateID, EntityTypeNode, input.NodeID); err != nil {
			stop()
			return LogicGateNodeAssignmentResult{}, err
		}
		stop()
	}
	if snapshotGVICFromLogicGate {
		stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.gvic_snapshot")
		if err := snapshotPostgresLogicGateGVICToNodeTx(ctx, tx, input.CompanyID, input.LogicGateID, input.NodeID); err != nil {
			stop()
			return LogicGateNodeAssignmentResult{}, err
		}
		stop()
	}
	stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.projection_dependencies")
	projectionDeltas, err := applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx(ctx, tx, NodeLogicGateAssignmentProjectionDeltaDependencyInput{
		CompanyID:    input.CompanyID,
		AssignmentID: assignment.AssignmentID,
		NodeID:       input.NodeID,
	})
	stop()
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.projection_reread")
	card, err := kanbanBoardProjectionCardByNodeTx(ctx, tx, input.CompanyID, input.NodeID, input.LogicGateID)
	if err != nil {
		stop()
		return LogicGateNodeAssignmentResult{}, err
	}
	node, err := nodeForLogicGateAssignmentResultTx(ctx, tx, input.CompanyID, input.NodeID)
	if err != nil {
		stop()
		return LogicGateNodeAssignmentResult{}, err
	}
	stop()
	result := LogicGateNodeAssignmentResult{Card: card, Node: node, Assignment: assignment, ProjectionDeltas: projectionDeltas}
	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	eventInputs := logicGateAssignmentSavedWorkspaceEventInputs(result, meta)
	if createdNode.CompanyID != "" {
		eventInputs = append([]DomainEventInput{nodeCreatedWorkspaceEventInputWithMetadata(createdNode, meta)}, eventInputs...)
	}
	stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.domain_event_append")
	events, err := r.appendDomainEventsTx(ctx, tx, eventInputs)
	stop()
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	stop = observeTiming(ctx, "repo.assignNodeToLogicGateStatusTx.projection_event_append")
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, projectionDeltas)); err != nil {
		stop()
		return LogicGateNodeAssignmentResult{}, err
	}
	stop()
	return result, nil
}

func (r *PostgresRepo) MoveLogicGateNodeAssignment(input LogicGateNodeAssignmentMoveInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentMoveInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	ctx := ContextWithTimingRecorder(context.Background(), input.TimingRecorder)
	defer observeTiming(ctx, "repo.MoveLogicGateNodeAssignment.transaction")()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	defer tx.Rollback()

	sourceLogicGateID := input.LogicGateID
	if input.FromLogicGateID != "" {
		sourceLogicGateID = input.FromLogicGateID
	}
	assignment, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, sourceLogicGateID)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if _, err := scanLogicGateKanbanSource(tx.QueryRowContext(ctx, `
select company_id::text, logic_gate_id::text, header, created_timestamp
from logic_gates
where company_id=$1::uuid and logic_gate_id=$2::uuid`, input.CompanyID, input.LogicGateID)); errors.Is(err, sql.ErrNoRows) {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	} else if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	targetBoardID := LogicGateKanbanBoardID(input.LogicGateID)
	crossLogicGateMove := assignment.LogicGateID != input.LogicGateID
	column, err := logicGateWorkColumnForCommand(input.CompanyID, targetBoardID, input.ColumnID, input.Status, assignment.StatusKey)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	var nodePriority sql.NullInt64
	if err := tx.QueryRowContext(ctx, `
select priority
from nodes
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID).Scan(&nodePriority); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if input.PrioritySet {
		priority, ok := logicGateAssignmentInputPriority(LogicGateNodeAssignmentInput{Priority: input.Priority, PrioritySet: true})
		if !ok {
			return LogicGateNodeAssignmentResult{}, ErrPriorityRequired
		}
		if _, err := tx.ExecContext(ctx, `
update nodes
set priority=$3::smallint
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID, *priority); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	} else if !nodePriority.Valid || nodePriority.Int64 < 1 || nodePriority.Int64 > 5 {
		return LogicGateNodeAssignmentResult{}, ErrPriorityRequired
	}

	position := assignment.Position
	if input.Position > 0 {
		position = input.Position
	} else if crossLogicGateMove || column.ColumnID != logicGateWorkStatusKeyOrDefault(assignment.StatusKey, LogicGateWorkStatusPending) {
		position, err = nextLogicGateAssignmentPositionTx(ctx, tx, input.CompanyID, input.LogicGateID, column.ColumnID)
		if err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}
	cardID := strings.TrimSpace(assignment.CompatibilityCardID)
	if cardID == "" {
		cardID = newUUIDv7String()
	}
	placedByUserID := strings.TrimSpace(assignment.PlacedByUserID)
	if crossLogicGateMove {
		placedByUserID = strings.TrimSpace(input.ActorUserID)
	}

	assignment, err = upsertNodeLogicGateAssignmentSQL(ctx, tx, nodeLogicGateAssignmentSQLInput{
		AssignmentID:         assignment.AssignmentID,
		CompanyID:            input.CompanyID,
		NodeID:               input.NodeID,
		LogicGateID:          input.LogicGateID,
		StatusKey:            column.ColumnID,
		ColumnID:             column.ColumnID,
		IsIssue:              assignment.IsIssue,
		Position:             position,
		CompatibilityBoardID: targetBoardID,
		CompatibilityCardID:  cardID,
		RequestedByUserID:    input.ActorUserID,
		PlacedByUserID:       placedByUserID,
	})
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if err := syncNodeStatusFromLogicGateAssignmentTx(ctx, tx, assignment); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if crossLogicGateMove {
		if _, err := snapshotPostgresResourceAccessPolicyTx(ctx, tx, input.CompanyID, EntityTypeLogicGate, input.LogicGateID, EntityTypeNode, input.NodeID); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
		if err := updatePostgresCommunicationsEmailNodeReferenceForNodeTx(ctx, tx, input.CompanyID, input.NodeID, targetBoardID, cardID, input.LogicGateID); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
		if err := updatePostgresCommunicationsEmailAttachmentReferencesForNodeTx(ctx, tx, input.CompanyID, input.NodeID, targetBoardID, cardID, input.LogicGateID); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
		if err := snapshotPostgresLogicGateGVICToNodeTx(ctx, tx, input.CompanyID, input.LogicGateID, input.NodeID); err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
	}
	projectionDeltas, err := applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx(ctx, tx, NodeLogicGateAssignmentProjectionDeltaDependencyInput{
		CompanyID:    input.CompanyID,
		AssignmentID: assignment.AssignmentID,
		NodeID:       input.NodeID,
	})
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	card, err := kanbanBoardProjectionCardByNodeTx(ctx, tx, input.CompanyID, input.NodeID, input.LogicGateID)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	node, err := nodeForLogicGateAssignmentResultTx(ctx, tx, input.CompanyID, input.NodeID)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result := LogicGateNodeAssignmentResult{Card: card, Node: node, Assignment: assignment, ProjectionDeltas: projectionDeltas}
	events, err := r.appendDomainEventsTx(ctx, tx, logicGateAssignmentMovedWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, projectionDeltas)); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) RemoveLogicGateNodeAssignment(input LogicGateNodeAssignmentRemoveInput) (LogicGateNodeAssignmentRemoveResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentRemoveInput(input)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	defer tx.Rollback()

	assignment, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, input.LogicGateID)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	card, err := nodeLogicGateAssignmentCardSQL(ctx, tx, assignment)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from node_logic_gate_assignments
where company_id=$1 and node_id=$2 and assignment_id=$3`, assignment.CompanyID, assignment.NodeID, assignment.AssignmentID); err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	var fallbackStatus any
	if input.FallbackStatus != nil {
		fallbackStatus = *input.FallbackStatus
	}
	if _, err := tx.ExecContext(ctx, `
update nodes
set status=$3::text
where company_id=$1 and node_id=$2`, input.CompanyID, input.NodeID, fallbackStatus); err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	projectionDeltas, err := applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx(ctx, tx, NodeLogicGateAssignmentProjectionDeltaDependencyInput{
		CompanyID:    input.CompanyID,
		AssignmentID: assignment.AssignmentID,
		NodeID:       input.NodeID,
	})
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	node, err := nodeForLogicGateAssignmentResultTx(ctx, tx, input.CompanyID, input.NodeID)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	result := LogicGateNodeAssignmentRemoveResult{Card: card, Node: node, Assignment: assignment, ProjectionDeltas: projectionDeltas}
	events, err := r.appendDomainEventsTx(ctx, tx, logicGateAssignmentRemovedWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	result.Events = events
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, projectionDeltas)); err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) SetLogicGateNodeAssignmentIssue(input LogicGateNodeAssignmentIssueInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentIssueInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	defer tx.Rollback()

	assignment, err := nodeLogicGateAssignmentByNodeSQL(ctx, tx, input.CompanyID, input.NodeID, input.LogicGateID)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}

	assignment, err = upsertNodeLogicGateAssignmentSQL(ctx, tx, nodeLogicGateAssignmentSQLInput{
		AssignmentID:         assignment.AssignmentID,
		CompanyID:            input.CompanyID,
		NodeID:               input.NodeID,
		LogicGateID:          assignment.LogicGateID,
		StatusKey:            assignment.StatusKey,
		ColumnID:             assignment.ColumnID,
		IsIssue:              input.IsIssue,
		Position:             assignment.Position,
		CompatibilityBoardID: assignment.CompatibilityBoardID,
		CompatibilityCardID:  assignment.CompatibilityCardID,
		RequestedByUserID:    assignment.RequestedByUserID,
		PlacedByUserID:       assignment.PlacedByUserID,
	})
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if err := syncNodeStatusFromLogicGateAssignmentTx(ctx, tx, assignment); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	projectionDeltas, err := applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx(ctx, tx, NodeLogicGateAssignmentProjectionDeltaDependencyInput{
		CompanyID:    input.CompanyID,
		AssignmentID: assignment.AssignmentID,
		NodeID:       input.NodeID,
	})
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	card, err := kanbanBoardProjectionCardByNodeTx(ctx, tx, input.CompanyID, input.NodeID, input.LogicGateID)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	node, err := nodeForLogicGateAssignmentResultTx(ctx, tx, input.CompanyID, input.NodeID)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result := LogicGateNodeAssignmentResult{Card: card, Node: node, Assignment: assignment, ProjectionDeltas: projectionDeltas}
	events, err := r.appendDomainEventsTx(ctx, tx, logicGateAssignmentIssueWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	if _, err := r.appendEventRowsTx(ctx, tx, ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, projectionDeltas)); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) MoveKanbanCard(input KanbanCardMoveInput) (domain.KanbanCard, error) {
	result, err := r.MoveKanbanCardWithWorkspaceEvent(input)
	return result.Card, err
}

func (r *PostgresRepo) MoveKanbanCardWithWorkspaceEvent(input KanbanCardMoveInput) (KanbanCardWorkspaceEventResult, error) {
	card, err := r.GetKanbanCard(input.CompanyID, input.BoardID, input.CardID)
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	if card.LogicGateID == nil || strings.TrimSpace(*card.LogicGateID) == "" {
		return KanbanCardWorkspaceEventResult{}, ErrInvalid
	}
	var events []domain.DomainEvent
	var node domain.Node
	if strings.TrimSpace(input.ColumnID) != "" {
		moveResult, err := r.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
			CompanyID:   input.CompanyID,
			LogicGateID: *card.LogicGateID,
			NodeID:      card.NodeID,
			ColumnID:    input.ColumnID,
			Position:    input.Position,
		})
		if err != nil {
			return KanbanCardWorkspaceEventResult{}, err
		}
		card = moveResult.Card
		node = moveResult.Node
		events = append(events, moveResult.Events...)
	}
	if input.IsIssue != nil {
		issueResult, err := r.SetLogicGateNodeAssignmentIssue(LogicGateNodeAssignmentIssueInput{
			CompanyID:   input.CompanyID,
			LogicGateID: *card.LogicGateID,
			NodeID:      card.NodeID,
			IsIssue:     *input.IsIssue,
		})
		if err != nil {
			return KanbanCardWorkspaceEventResult{}, err
		}
		card = issueResult.Card
		node = issueResult.Node
		events = append(events, issueResult.Events...)
	}
	if len(events) == 0 {
		return KanbanCardWorkspaceEventResult{}, ErrInvalid
	}
	return KanbanCardWorkspaceEventResult{Card: card, DerivedNode: &node, Events: events}, nil
}

func (r *PostgresRepo) DeleteKanbanCard(companyID, boardID, cardID string) error {
	_, err := r.DeleteKanbanCardWithWorkspaceEvent(companyID, boardID, cardID)
	return err
}

func (r *PostgresRepo) DeleteKanbanCardWithWorkspaceEvent(companyID, boardID, cardID string) (KanbanCardWorkspaceEventResult, error) {
	card, err := r.GetKanbanCard(companyID, boardID, cardID)
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	if card.LogicGateID == nil || strings.TrimSpace(*card.LogicGateID) == "" {
		return KanbanCardWorkspaceEventResult{}, ErrInvalid
	}
	result, err := r.RemoveLogicGateNodeAssignment(LogicGateNodeAssignmentRemoveInput{
		CompanyID:   companyID,
		LogicGateID: *card.LogicGateID,
		NodeID:      card.NodeID,
	})
	if err != nil {
		return KanbanCardWorkspaceEventResult{}, err
	}
	return KanbanCardWorkspaceEventResult{Card: result.Card, DerivedNode: &result.Node, Events: result.Events}, nil
}

func (r *PostgresRepo) CreateKanbanBoardWithWorkspaceEvent(companyID, boardID, title string, position int) (KanbanBoardWorkspaceEventResult, error) {
	board, err := r.CreateKanbanBoard(companyID, boardID, title, position)
	if err != nil {
		return KanbanBoardWorkspaceEventResult{}, err
	}
	return KanbanBoardWorkspaceEventResult{Board: board}, nil
}

func (r *PostgresRepo) UpdateKanbanBoardWithWorkspaceEvent(companyID, boardID, title string, position int) (KanbanBoardWorkspaceEventResult, error) {
	board, err := r.UpdateKanbanBoard(companyID, boardID, title, position)
	if err != nil {
		return KanbanBoardWorkspaceEventResult{}, err
	}
	return KanbanBoardWorkspaceEventResult{Board: board}, nil
}

func (r *PostgresRepo) DeleteKanbanBoardWithWorkspaceEvent(companyID, boardID string) (KanbanWorkspaceEventResult, error) {
	return KanbanWorkspaceEventResult{}, r.DeleteKanbanBoard(companyID, boardID)
}

func (r *PostgresRepo) CreateKanbanColumnWithWorkspaceEvent(companyID, boardID, title string, position int, widthPx int, heightPx int, itemColor string) (KanbanColumnWorkspaceEventResult, error) {
	return KanbanColumnWorkspaceEventResult{}, ErrInvalid
}

func (r *PostgresRepo) UpdateKanbanColumnWithWorkspaceEvent(companyID, boardID, columnID, title string, position int, widthPx int, heightPx int, itemColor string) (KanbanColumnWorkspaceEventResult, error) {
	return KanbanColumnWorkspaceEventResult{}, ErrInvalid
}

func (r *PostgresRepo) DeleteKanbanColumnWithWorkspaceEvent(companyID, boardID, columnID string) (KanbanWorkspaceEventResult, error) {
	return KanbanWorkspaceEventResult{}, ErrInvalid
}
