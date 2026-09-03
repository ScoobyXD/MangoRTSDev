package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) GetLogicGateWork(companyID, logicGateID, userID string) (domain.LogicGateWorkView, error) {
	if cleanUUIDText(companyID) == "" || cleanUUIDText(logicGateID) == "" || userID != "" && cleanUUIDText(userID) == "" {
		return domain.LogicGateWorkView{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return domain.LogicGateWorkView{}, err
	}
	defer tx.Rollback()
	work := domain.LogicGateWorkView{Steps: []domain.ProcessStep{}, Relationships: []domain.ResourceOperationalRelationship{}, Nodes: []domain.LogicGateWorkNode{}}
	err = tx.QueryRowContext(ctx, `select gate.logic_gate_id::text,gate.header,source_setting.default_access,exists(select 1 from mangorts_v2_effective_gvic_assignments(gate.company_id,'logic_gate',gate.logic_gate_id) a where a.role='responsible' and a.user_id=nullif($3,'')::uuid) from logic_gates gate cross join lateral mangorts_v2_resolve_permission_policy(gate.company_id,'logic_gate',gate.logic_gate_id) resolved join resource_permission_settings source_setting on source_setting.company_id=gate.company_id and source_setting.resource_type=resolved.source_resource_type and source_setting.resource_id=resolved.source_resource_id where gate.company_id=$1::uuid and gate.logic_gate_id=$2::uuid`, companyID, logicGateID, userID).Scan(&work.LogicGate.LogicGateID, &work.LogicGate.Header, &work.LogicGate.DefaultAccess, &work.Permissions.CanResolveRequests)
	if errors.Is(err, sql.ErrNoRows) {
		return work, ErrNotFound
	}
	if err != nil {
		return work, err
	}
	rows, err := tx.QueryContext(ctx, `select `+processStepSelectColumns+` from process_steps where company_id=$1::uuid and logic_gate_id=$2::uuid order by position,process_step_id`, companyID, logicGateID)
	if err != nil {
		return work, err
	}
	for rows.Next() {
		step, err := scanProcessStep(rows)
		if err != nil {
			rows.Close()
			return work, err
		}
		work.Steps = append(work.Steps, step)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return work, err
	}
	rows, err = tx.QueryContext(ctx, `select edge.company_id::text,edge.resource_operational_relationship_id::text,edge.source_resource_type,edge.source_resource_id::text,edge.target_resource_type,edge.target_resource_id::text,edge.created_timestamp from resource_operational_relationships edge join process_steps source on source.company_id=edge.company_id and source.process_step_id=edge.source_resource_id join process_steps target on target.company_id=edge.company_id and target.process_step_id=edge.target_resource_id where edge.company_id=$1::uuid and edge.source_resource_type='process_step' and edge.target_resource_type='process_step' and source.logic_gate_id=$2::uuid and target.logic_gate_id=$2::uuid order by edge.resource_operational_relationship_id`, companyID, logicGateID)
	if err != nil {
		return work, err
	}
	for rows.Next() {
		edge, err := scanResourceOperationalRelationship(rows)
		if err != nil {
			rows.Close()
			return work, err
		}
		work.Relationships = append(work.Relationships, edge)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return work, err
	}
	rows, err = tx.QueryContext(ctx, `select n.node_id::text,n.name,coalesce(n.status,'Pending'),a.process_step_id::text,a.is_issue,a.position,coalesce(a.requested_by_user_id::text,''),coalesce(a.placed_by_user_id::text,''),n.due_date::text,n.priority,a.created_timestamp,coalesce(account_snapshot.accounts_json,'[]')::text,exists(select 1 from email_relationships e where e.company_id=n.company_id and e.resource_type='node' and e.resource_id=n.node_id),exists(select 1 from project_relationships p where p.company_id=n.company_id and p.resource_type='node' and p.resource_id=n.node_id) from node_logic_gate_assignments a join nodes n on n.company_id=a.company_id and n.node_id=a.node_id `+postgresAccountSnapshotsForNodeLateralSQL("n")+` where a.company_id=$1::uuid and a.logic_gate_id=$2::uuid and ($3='' or mangorts_user_can_access_resource(n.company_id,'node',n.node_id,nullif($3,'')::uuid,'edit')) order by a.position,a.created_timestamp,n.node_id`, companyID, logicGateID, userID)
	if err != nil {
		return work, err
	}
	for rows.Next() {
		var item domain.LogicGateWorkNode
		var accounts sql.NullString
		if err := rows.Scan(&item.NodeID, &item.NodeTitle, &item.Status, &item.ProcessStepID, &item.IsIssue, &item.Position, &item.RequestedByUserID, &item.PlacedByUserID, &item.DueDate, &item.Priority, &item.CreatedTimestamp, &accounts, &item.CreatedFromEmail, &item.HasProject); err != nil {
			rows.Close()
			return work, err
		}
		item.Accounts = scanAccountSnapshotsJSON(accounts)
		work.Nodes = append(work.Nodes, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return work, err
	}
	if err = tx.Commit(); err != nil {
		return work, err
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
