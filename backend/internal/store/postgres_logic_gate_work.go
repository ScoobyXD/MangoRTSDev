package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) GetLogicGateWork(companyID, logicGateID string) (domain.LogicGateWorkView, error) {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" {
		return domain.LogicGateWorkView{}, ErrInvalid
	}

	rows, err := r.db.QueryContext(context.Background(), `
with gate_metadata as (
  select
    gate.company_id::text as company_id,
    gate.logic_gate_id::text as logic_gate_id,
    gate.header,
    source_setting.default_access,
    coalesce((
      select assignment.user_id::text
      from mangorts_v2_effective_gvic_assignments(gate.company_id,'logic_gate',gate.logic_gate_id) assignment
      where assignment.role='generated'
      order by assignment.user_id
      limit 1
    ), '') as request_owner_user_id,
    gate.created_timestamp
  from logic_gates gate
  cross join lateral mangorts_v2_resolve_permission_policy(gate.company_id,'logic_gate',gate.logic_gate_id) resolved
  join resource_permission_settings source_setting
    on source_setting.company_id=gate.company_id
   and source_setting.resource_type=resolved.source_resource_type
   and source_setting.resource_id=resolved.source_resource_id
  where gate.company_id=$1::uuid
    and gate.logic_gate_id=$2::uuid
)select
  gate.company_id,
  gate.logic_gate_id,
  gate.header,
  gate.default_access,
  gate.request_owner_user_id,
  gate.created_timestamp,
  projection.compatibility_card_id::text,
  `+kanbanProjectionCanonicalStatusSQL+`,
  projection.node_id::text,
  projection.title,
  coalesce(projection.requested_by_user_id::text, ''),
  coalesce(projection.placed_by_user_id::text, ''),
  projection.is_issue,
  projection.position,
  projection.due_date::text,
  projection.priority,
  exists (
    select 1
    from email_relationships relationship
    where relationship.company_id=projection.company_id
      and relationship.resource_type='node'
      and relationship.resource_id=projection.node_id
  ) as created_from_email,
  exists (
    select 1 from project_relationships relationship
    where relationship.company_id=projection.company_id
      and relationship.resource_type='node'
      and relationship.resource_id=projection.node_id
  ) as has_project,
  projection.projection_updated_timestamp,
  projection.assignment_created_timestamp,
  projection.accounts::text
from gate_metadata gate
left join kanban_board_projection projection
  on projection.company_id=$1::uuid
 and projection.logic_gate_id=$2::uuid
order by
  projection.status_rank asc nulls last,
  projection.position asc nulls last,
  projection.assignment_created_timestamp asc nulls last,
  projection.assignment_id asc nulls last`,
		companyID,
		logicGateID,
	)
	if err != nil {
		return domain.LogicGateWorkView{}, err
	}
	defer rows.Close()

	var work domain.LogicGateWorkView
	var found bool
	for rows.Next() {
		var (
			gateCompanyID     string
			gateID            string
			gateHeader        string
			defaultAccess     string
			requestOwnerID    string
			gateCreated       sql.NullTime
			cardID            sql.NullString
			columnID          sql.NullString
			nodeID            sql.NullString
			nodeTitle         sql.NullString
			requestedByUserID sql.NullString
			placedByUserID    sql.NullString
			isIssue           sql.NullBool
			position          sql.NullInt64
			dueDate           sql.NullString
			priority          sql.NullInt64
			createdFromEmail  bool
			hasProject        bool
			projectionUpdated sql.NullTime
			cardCreated       sql.NullTime
			accountsJSON      sql.NullString
		)
		if err := rows.Scan(
			&gateCompanyID,
			&gateID,
			&gateHeader,
			&defaultAccess,
			&requestOwnerID,
			&gateCreated,
			&cardID,
			&columnID,
			&nodeID,
			&nodeTitle,
			&requestedByUserID,
			&placedByUserID,
			&isIssue,
			&position,
			&dueDate,
			&priority,
			&createdFromEmail,
			&hasProject,
			&projectionUpdated,
			&cardCreated,
			&accountsJSON,
		); err != nil {
			return domain.LogicGateWorkView{}, err
		}
		if !found {
			logicGate := domain.LogicGate{
				CompanyID:        gateCompanyID,
				LogicGateID:      gateID,
				Header:           gateHeader,
				DefaultAccess:    defaultAccess,
				CreatedTimestamp: gateCreated.Time,
			}
			board := synthesizeLogicGateWorkBoard(logicGate)
			work = domain.LogicGateWorkView{
				LogicGate: domain.LogicGateWorkHeader{
					LogicGateID:        gateID,
					Header:             gateHeader,
					DefaultAccess:      defaultResourceAccessOrEdit(defaultAccess),
					RequestOwnerUserID: requestOwnerID,
				},
				Board:   board,
				Columns: synthesizeLogicGateWorkColumns(gateCompanyID, board.BoardID, gateCreated.Time),
				Cards:   []domain.LogicGateWorkCard{},
			}
			found = true
		}
		if !cardID.Valid {
			continue
		}
		card := domain.LogicGateWorkCard{
			CardID:                     cardID.String,
			ColumnID:                   columnID.String,
			NodeID:                     nodeID.String,
			NodeTitle:                  nodeTitle.String,
			RequestedByUserID:          requestedByUserID.String,
			PlacedByUserID:             placedByUserID.String,
			IsIssue:                    isIssue.Bool,
			Position:                   int(position.Int64),
			CreatedFromEmail:           createdFromEmail,
			HasProject:                 hasProject,
			ProjectionUpdatedTimestamp: projectionUpdated.Time,
			CreatedTimestamp:           cardCreated.Time,
			Accounts:                   scanAccountSnapshotsJSON(accountsJSON),
		}
		if dueDate.Valid {
			card.DueDate = &dueDate.String
		}
		if priority.Valid {
			value := int(priority.Int64)
			card.Priority = &value
		}
		work.Cards = append(work.Cards, card)
	}
	if err := rows.Err(); err != nil {
		return domain.LogicGateWorkView{}, err
	}
	if !found {
		return domain.LogicGateWorkView{}, ErrNotFound
	}
	return work, nil
}

func (r *PostgresRepo) LogicGateWorkAccessFlags(companyID, userID, logicGateID string) (domain.EffectiveAccessFlags, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || userID == "" || logicGateID == "" {
		return domain.EffectiveAccessFlags{}, ErrInvalid
	}
	var canEdit bool
	err := r.db.QueryRowContext(context.Background(), `
select
  mangorts_user_can_access_resource($1::uuid, 'logic_gate', $2::uuid, $3::uuid, 'edit')
from logic_gates
where company_id=$1::uuid and logic_gate_id=$2::uuid`,
		companyID,
		logicGateID,
		userID,
	).Scan(&canEdit)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EffectiveAccessFlags{}, ErrNotFound
	}
	return domain.EffectiveAccessFlags{CanEdit: canEdit}, err
}

func (r *PostgresRepo) CurrentLogicGateWorkVersion(companyID, logicGateID string) (int64, error) {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" {
		return 0, ErrInvalid
	}
	var version int64
	err := r.db.QueryRowContext(context.Background(), `
select version
from logic_gate_work_versions
where company_id=$1::uuid and logic_gate_id=$2::uuid`, companyID, logicGateID).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return version, err
}
