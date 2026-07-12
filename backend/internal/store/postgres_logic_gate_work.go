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
with recursive requested(company_id, resource_type, resource_id) as (
  select $1::uuid, 'logic_gate'::text, $2::uuid
),
direct_sequence(policy_sequence) as (
  select coalesce((
    select revision.policy_sequence
    from resource_permission_policy_revisions revision
    join requested req
      on revision.company_id=req.company_id
     and revision.resource_type=req.resource_type
     and revision.resource_id=req.resource_id
  ), 0)
),
`+postgresResourcePolicyAncestorsCTE+`,
latest_default_application as (
  select app.access_level
  from resource_permission_subtree_applications app
  join resource_policy_ancestors ancestor
    on ancestor.resource_type=app.ancestor_resource_type
   and ancestor.resource_id=app.ancestor_resource_id
  join requested req on app.company_id=req.company_id
  join direct_sequence cutoff on app.policy_sequence > cutoff.policy_sequence
  where app.rule_key=$3
  order by app.policy_sequence desc, app.application_id desc
  limit 1
),
gate_metadata as (
  select
    gate.company_id::text as company_id,
    gate.logic_gate_id::text as logic_gate_id,
    gate.header,
    coalesce(
      (select access_level from latest_default_application),
      nullif(trim(gate.default_access), ''),
      'edit'
    ) as default_access,
    coalesce((
      select assignment.principal_id::text
      from resource_gvic_assignments assignment
      join company_memberships membership
        on membership.company_id=assignment.company_id
       and membership.user_id=assignment.principal_id
      where assignment.company_id=gate.company_id
        and assignment.resource_type='logic_gate'
        and assignment.resource_id=gate.logic_gate_id
        and assignment.role='generated'
        and assignment.principal_type='user'
      order by assignment.principal_id
      limit 1
    ), '') as request_owner_user_id,
    gate.created_timestamp,
    coalesce((
      select sequence.sequence
      from company_projection_sequences sequence
      where sequence.company_id=gate.company_id
        and sequence.projection_name=$4
        and sequence.projection_scope='board:' || 'logic-gate:' || gate.logic_gate_id::text
    ), 0) as projection_sequence
  from logic_gates gate
  where gate.company_id=$1::uuid
    and gate.logic_gate_id=$2::uuid
)
select
  gate.company_id,
  gate.logic_gate_id,
  gate.header,
  gate.default_access,
  gate.request_owner_user_id,
  gate.created_timestamp,
  gate.projection_sequence,
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
    from communications_email_nodes email_node
    where email_node.company_id=projection.company_id
      and email_node.node_id=projection.node_id
      and email_node.board_id=projection.compatibility_board_id
      and email_node.card_id=projection.compatibility_card_id
  ) as created_from_email,
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
		resourcePermissionDefaultRuleKey,
		ProjectionNameKanbanBoard,
	)
	if err != nil {
		return domain.LogicGateWorkView{}, err
	}
	defer rows.Close()

	var work domain.LogicGateWorkView
	var found bool
	for rows.Next() {
		var (
			gateCompanyID      string
			gateID             string
			gateHeader         string
			defaultAccess      string
			requestOwnerID     string
			gateCreated        sql.NullTime
			projectionSequence int64
			cardID             sql.NullString
			columnID           sql.NullString
			nodeID             sql.NullString
			nodeTitle          sql.NullString
			requestedByUserID  sql.NullString
			placedByUserID     sql.NullString
			isIssue            sql.NullBool
			position           sql.NullInt64
			dueDate            sql.NullString
			priority           sql.NullInt64
			createdFromEmail   bool
			projectionUpdated  sql.NullTime
			cardCreated        sql.NullTime
			accountsJSON       sql.NullString
		)
		if err := rows.Scan(
			&gateCompanyID,
			&gateID,
			&gateHeader,
			&defaultAccess,
			&requestOwnerID,
			&gateCreated,
			&projectionSequence,
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
				Board:              board,
				Columns:            synthesizeLogicGateWorkColumns(gateCompanyID, board.BoardID, gateCreated.Time),
				Cards:              []domain.LogicGateWorkCard{},
				ProjectionSequence: projectionSequence,
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
	var flags domain.EffectiveAccessFlags
	err := r.db.QueryRowContext(context.Background(), `
select
  mangorts_user_can_access_resource($1::uuid, 'logic_gate', $2::uuid, $3::uuid, 'view'),
  mangorts_user_can_access_resource($1::uuid, 'logic_gate', $2::uuid, $3::uuid, 'edit'),
  mangorts_user_can_access_resource($1::uuid, 'logic_gate', $2::uuid, $3::uuid, 'admin')
from logic_gates
where company_id=$1::uuid and logic_gate_id=$2::uuid`,
		companyID,
		logicGateID,
		userID,
	).Scan(&flags.CanView, &flags.CanEdit, &flags.CanAdmin)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.EffectiveAccessFlags{}, ErrNotFound
	}
	return flags, err
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
