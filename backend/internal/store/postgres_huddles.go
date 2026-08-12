package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) ConvertLogicGateToHuddle(companyID, logicGateID, actorID string) (domain.HuddleLogicGate, error) {
	companyID, logicGateID = strings.TrimSpace(companyID), strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return domain.HuddleLogicGate{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return domain.HuddleLogicGate{}, err
	}
	defer tx.Rollback()
	var item domain.HuddleLogicGate
	err = tx.QueryRowContext(ctx, `select company_id::text,logic_gate_id::text,header,created_timestamp,statement_timestamp() from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid for update`, companyID, logicGateID).Scan(&item.CompanyID, &item.HuddleLogicGateID, &item.Header, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.HuddleLogicGate{}, ErrNotFound
	}
	if err != nil {
		return domain.HuddleLogicGate{}, err
	}
	blockers := LogicGateConversionBlockers{}
	if err = tx.QueryRowContext(ctx, `select exists(select 1 from logic_gate_textboxes where company_id=$1::uuid and logic_gate_id=$2::uuid and deleted_timestamp is null and (body_json->'document'->'content' <> '[{"type":"paragraph"}]'::jsonb or body_json->'annotations' <> '[]'::jsonb))`, companyID, logicGateID).Scan(&blockers.Editor); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	if err = tx.QueryRowContext(ctx, `select exists(select 1 from node_logic_gate_assignments where company_id=$1::uuid and logic_gate_id=$2::uuid)`, companyID, logicGateID).Scan(&blockers.KanbanWork); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	if err = tx.QueryRowContext(ctx, `select exists(select 1 from kpis where company_id=$1::uuid and logic_gate_id=$2::uuid)`, companyID, logicGateID).Scan(&blockers.KPIs); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	if blockers.Any() {
		return domain.HuddleLogicGate{}, &LogicGateConversionBlockedError{Blockers: blockers}
	}
	var gvicSourceType, gvicSourceID, permissionSourceType, permissionSourceID string
	if err = tx.QueryRowContext(ctx, `select source_resource_type,source_resource_id::text from mangorts_v2_resolve_gvic_policy($1::uuid,'logic_gate',$2::uuid)`, companyID, logicGateID).Scan(&gvicSourceType, &gvicSourceID); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	if err = tx.QueryRowContext(ctx, `select source_resource_type,source_resource_id::text from mangorts_v2_resolve_permission_policy($1::uuid,'logic_gate',$2::uuid)`, companyID, logicGateID).Scan(&permissionSourceType, &permissionSourceID); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	if _, err = tx.ExecContext(ctx, `insert into huddle_logic_gates(company_id,huddle_logic_gate_id,header,created_timestamp,updated_timestamp) values($1::uuid,$2::uuid,$3,$4,$5)`, companyID, logicGateID, item.Header, item.CreatedTimestamp, item.UpdatedTimestamp); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	if _, err = tx.ExecContext(ctx, `insert into huddle_explorer_items(company_id,huddle_explorer_item_id,huddle_type,resource_huddle_resource_id) values($1::uuid,$2::uuid,'huddle_logic_gate',$3::uuid)`, companyID, newUUIDv7String(), logicGateID); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	var permissionDefault string
	if err = tx.QueryRowContext(ctx, `select default_access from resource_permission_settings where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, permissionSourceType, permissionSourceID).Scan(&permissionDefault); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	var gvicSequence, permissionSequence int64
	if err = tx.QueryRowContext(ctx, `select nextval('resource_gvic_change_sequence'),nextval('resource_permission_change_sequence')`).Scan(&gvicSequence, &permissionSequence); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	if _, err = tx.ExecContext(ctx, `insert into resource_gvic_settings(company_id,resource_type,resource_id,assignment_mode,customized_sequence,parent_link_sequence) values($1::uuid,'huddle_logic_gate',$2::uuid,'customized',$3,0)`, companyID, logicGateID, gvicSequence); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	if _, err = tx.ExecContext(ctx, `insert into resource_permission_settings(company_id,resource_type,resource_id,permission_mode,default_access,customized_sequence,parent_link_sequence) values($1::uuid,'huddle_logic_gate',$2::uuid,'customized',$3,$4,0)`, companyID, logicGateID, permissionDefault, permissionSequence); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	if _, err = tx.ExecContext(ctx, `insert into resource_gvic_assignments(company_id,resource_type,resource_id,role,principal_type,principal_id,created_timestamp,updated_timestamp) select company_id,'huddle_logic_gate',$3::uuid,role,principal_type,principal_id,created_timestamp,statement_timestamp() from resource_gvic_assignments where company_id=$1::uuid and resource_type=$2 and resource_id=$4::uuid`, companyID, gvicSourceType, logicGateID, gvicSourceID); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	if _, err = tx.ExecContext(ctx, `insert into resource_permissions(company_id,resource_type,resource_id,subject_type,subject_id,access_level,created_timestamp,updated_timestamp) select company_id,'huddle_logic_gate',$3::uuid,subject_type,subject_id,access_level,created_timestamp,statement_timestamp() from resource_permissions where company_id=$1::uuid and resource_type=$2 and resource_id=$4::uuid`, companyID, permissionSourceType, logicGateID, permissionSourceID); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	// The Explorer detach trigger resolves the old Logic Gate policy, so remove
	// the placement before deleting those policy settings.
	if _, err = tx.ExecContext(ctx, `delete from company_explorer_items where company_id=$1::uuid and target_type='logic_gate' and target_id=$2::uuid`, companyID, logicGateID); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	for _, table := range []string{"resource_gvic_assignments", "resource_permissions", "resource_gvic_settings", "resource_permission_settings"} {
		if _, err = tx.ExecContext(ctx, `delete from `+table+` where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, companyID, logicGateID); err != nil {
			return domain.HuddleLogicGate{}, err
		}
	}
	for _, query := range []string{
		`delete from project_relationship_projection where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`,
		`delete from project_relationships where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`,
		`delete from logic_gate_relationships where company_id=$1::uuid and (logic_gate_id_a=$2::uuid or logic_gate_id_b=$2::uuid)`,
		`delete from email_relationships where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`,
		`delete from attachment_relationships where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2`,
		`delete from user_logic_gate_shortcuts where company_id=$1::uuid and logic_gate_id=$2::uuid`,
		`delete from pins where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`,
		`delete from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid`,
	} {
		if _, err = tx.ExecContext(ctx, query, companyID, logicGateID); err != nil {
			return domain.HuddleLogicGate{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return domain.HuddleLogicGate{}, err
	}
	return item, nil
}

func scanHuddleLogicGate(row interface{ Scan(...any) error }) (domain.HuddleLogicGate, error) {
	var v domain.HuddleLogicGate
	err := row.Scan(&v.CompanyID, &v.HuddleLogicGateID, &v.Header, &v.CreatedTimestamp, &v.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return v, err
}
func scanHuddleNode(row interface{ Scan(...any) error }) (domain.HuddleNode, error) {
	var v domain.HuddleNode
	err := row.Scan(&v.CompanyID, &v.HuddleNodeID, &v.HuddleLogicGateID, &v.Name, &v.CreatedTimestamp, &v.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return v, err
}
func scanKPI(row interface{ Scan(...any) error }) (domain.KPI, error) {
	var v domain.KPI
	err := row.Scan(&v.CompanyID, &v.KPIID, &v.LogicGateID, &v.Name, &v.CreatedTimestamp, &v.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return v, err
}

func (r *PostgresRepo) ListHuddleLogicGates(companyID string) ([]domain.HuddleLogicGate, error) {
	rows, err := r.db.Query(`select company_id::text,huddle_logic_gate_id::text,header,created_timestamp,updated_timestamp from huddle_logic_gates where company_id=$1::uuid order by lower(header),huddle_logic_gate_id`, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.HuddleLogicGate{}
	for rows.Next() {
		v, e := scanHuddleLogicGate(rows)
		if e != nil {
			return nil, e
		}
		items = append(items, v)
	}
	return items, rows.Err()
}
func (r *PostgresRepo) GetHuddleLogicGate(companyID, id string) (domain.HuddleLogicGate, error) {
	return scanHuddleLogicGate(r.db.QueryRow(`select company_id::text,huddle_logic_gate_id::text,header,created_timestamp,updated_timestamp from huddle_logic_gates where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid`, companyID, id))
}
func (r *PostgresRepo) UpdateHuddleLogicGate(input HuddleUpdateInput) (domain.HuddleLogicGate, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.HuddleLogicGate{}, ErrInvalid
	}
	return scanHuddleLogicGate(r.db.QueryRow(`update huddle_logic_gates set header=$3,updated_timestamp=statement_timestamp() where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid returning company_id::text,huddle_logic_gate_id::text,header,created_timestamp,updated_timestamp`, input.CompanyID, input.ResourceID, input.Name))
}

func scanHuddleLogicGateCards(rows *sql.Rows) ([]domain.HuddleLogicGateCard, error) {
	items := []domain.HuddleLogicGateCard{}
	for rows.Next() {
		var companyID, logicGateID, header string
		var kpiID, kpiName sql.NullString
		var kpiCreated, kpiUpdated sql.NullTime
		if err := rows.Scan(&companyID, &logicGateID, &header, &kpiID, &kpiName, &kpiCreated, &kpiUpdated); err != nil {
			return nil, err
		}
		if len(items) == 0 || items[len(items)-1].LogicGateID != logicGateID {
			items = append(items, domain.HuddleLogicGateCard{CompanyID: companyID, LogicGateID: logicGateID, Header: header, KPIs: []domain.KPI{}})
		}
		if kpiID.Valid {
			items[len(items)-1].KPIs = append(items[len(items)-1].KPIs, domain.KPI{
				CompanyID: companyID, KPIID: kpiID.String, LogicGateID: logicGateID, Name: kpiName.String,
				CreatedTimestamp: kpiCreated.Time, UpdatedTimestamp: kpiUpdated.Time,
			})
		}
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListHuddleLogicGateCards(companyID, huddleLogicGateID string) ([]domain.HuddleLogicGateCard, error) {
	rows, err := r.db.Query(`
select gate.company_id::text,gate.logic_gate_id::text,gate.header,
       kpi.kpi_id::text,kpi.name,kpi.created_timestamp,kpi.updated_timestamp
from huddle_logic_gate_relationships relationship
join logic_gates gate
  on gate.company_id=relationship.company_id and gate.logic_gate_id=relationship.logic_gate_id
left join kpis kpi
  on kpi.company_id=relationship.company_id and kpi.logic_gate_id=relationship.logic_gate_id
where relationship.company_id=$1::uuid and relationship.huddle_logic_gate_id=$2::uuid
order by lower(gate.header),gate.logic_gate_id,kpi.created_timestamp,kpi.kpi_id`, companyID, huddleLogicGateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanHuddleLogicGateCards(rows)
}

func (r *PostgresRepo) CreateHuddleLogicGateRelationship(input HuddleLogicGateRelationshipInput) error {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.HuddleLogicGateID = cleanUUIDText(input.HuddleLogicGateID)
	input.LogicGateID = cleanUUIDText(input.LogicGateID)
	if input.CompanyID == "" || input.HuddleLogicGateID == "" || input.LogicGateID == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(`
insert into huddle_logic_gate_relationships(company_id,huddle_logic_gate_id,logic_gate_id)
select huddle.company_id,huddle.huddle_logic_gate_id,gate.logic_gate_id
from huddle_logic_gates huddle
join logic_gates gate on gate.company_id=huddle.company_id
where huddle.company_id=$1::uuid and huddle.huddle_logic_gate_id=$2::uuid and gate.logic_gate_id=$3::uuid
on conflict(company_id,huddle_logic_gate_id,logic_gate_id) do nothing`, input.CompanyID, input.HuddleLogicGateID, input.LogicGateID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected > 0 {
		return nil
	}
	var exists bool
	if err = r.db.QueryRow(`select exists(select 1 from huddle_logic_gate_relationships where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid and logic_gate_id=$3::uuid)`, input.CompanyID, input.HuddleLogicGateID, input.LogicGateID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) DeleteHuddleLogicGateRelationship(input HuddleLogicGateRelationshipInput) error {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.HuddleLogicGateID = cleanUUIDText(input.HuddleLogicGateID)
	input.LogicGateID = cleanUUIDText(input.LogicGateID)
	if input.CompanyID == "" || input.HuddleLogicGateID == "" || input.LogicGateID == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(`delete from huddle_logic_gate_relationships where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid and logic_gate_id=$3::uuid`, input.CompanyID, input.HuddleLogicGateID, input.LogicGateID)
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

func (r *PostgresRepo) ListHuddleNodes(companyID, ownerID string) ([]domain.HuddleNode, error) {
	rows, err := r.db.Query(`select company_id::text,huddle_node_id::text,huddle_logic_gate_id::text,name,created_timestamp,updated_timestamp from huddle_nodes where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid order by created_timestamp,huddle_node_id`, companyID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.HuddleNode{}
	for rows.Next() {
		v, e := scanHuddleNode(rows)
		if e != nil {
			return nil, e
		}
		items = append(items, v)
	}
	return items, rows.Err()
}
func (r *PostgresRepo) CreateHuddleNode(input HuddleCreateInput) (domain.HuddleNode, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.HuddleNode{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return domain.HuddleNode{}, err
	}
	defer tx.Rollback()
	id := newUUIDv7String()
	v, err := scanHuddleNode(tx.QueryRowContext(ctx, `insert into huddle_nodes(company_id,huddle_node_id,huddle_logic_gate_id,name) values($1::uuid,$2::uuid,$3::uuid,$4) returning company_id::text,huddle_node_id::text,huddle_logic_gate_id::text,name,created_timestamp,updated_timestamp`, input.CompanyID, id, input.OwnerID, input.Name))
	if err != nil {
		return domain.HuddleNode{}, err
	}
	if err = postgresCreateDirectPolicyTx(ctx, tx, input.CompanyID, EntityTypeHuddleNode, id); err != nil {
		return domain.HuddleNode{}, err
	}
	if _, err = tx.ExecContext(ctx, `
insert into huddle_node_logic_gate_relationships(company_id,huddle_node_id,logic_gate_id)
select company_id,$3::uuid,logic_gate_id
from huddle_logic_gate_relationships
where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid`, input.CompanyID, input.OwnerID, id); err != nil {
		return domain.HuddleNode{}, err
	}
	if _, err = tx.ExecContext(ctx, `
insert into huddle_node_kpi_relationships(company_id,huddle_node_id,logic_gate_id,kpi_id)
select relationship.company_id,$3::uuid,relationship.logic_gate_id,kpi.kpi_id
from huddle_logic_gate_relationships relationship
join kpis kpi on kpi.company_id=relationship.company_id and kpi.logic_gate_id=relationship.logic_gate_id
where relationship.company_id=$1::uuid and relationship.huddle_logic_gate_id=$2::uuid`, input.CompanyID, input.OwnerID, id); err != nil {
		return domain.HuddleNode{}, err
	}
	if err = tx.Commit(); err != nil {
		return domain.HuddleNode{}, err
	}
	return v, nil
}
func (r *PostgresRepo) GetHuddleNode(companyID, id string) (domain.HuddleNode, error) {
	return scanHuddleNode(r.db.QueryRow(`select company_id::text,huddle_node_id::text,huddle_logic_gate_id::text,name,created_timestamp,updated_timestamp from huddle_nodes where company_id=$1::uuid and huddle_node_id=$2::uuid`, companyID, id))
}

func (r *PostgresRepo) ListHuddleNodeLogicGateCards(companyID, huddleNodeID string) ([]domain.HuddleLogicGateCard, error) {
	rows, err := r.db.Query(`
select gate.company_id::text,gate.logic_gate_id::text,gate.header,
       kpi.kpi_id::text,kpi.name,kpi.created_timestamp,kpi.updated_timestamp
from huddle_node_logic_gate_relationships relationship
join logic_gates gate
  on gate.company_id=relationship.company_id and gate.logic_gate_id=relationship.logic_gate_id
left join huddle_node_kpi_relationships snapshot_kpi
  on snapshot_kpi.company_id=relationship.company_id
 and snapshot_kpi.huddle_node_id=relationship.huddle_node_id
 and snapshot_kpi.logic_gate_id=relationship.logic_gate_id
left join kpis kpi
  on kpi.company_id=snapshot_kpi.company_id
 and kpi.logic_gate_id=snapshot_kpi.logic_gate_id
 and kpi.kpi_id=snapshot_kpi.kpi_id
where relationship.company_id=$1::uuid and relationship.huddle_node_id=$2::uuid
order by lower(gate.header),gate.logic_gate_id,kpi.created_timestamp,kpi.kpi_id`, companyID, huddleNodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanHuddleLogicGateCards(rows)
}
func (r *PostgresRepo) UpdateHuddleNode(input HuddleUpdateInput) (domain.HuddleNode, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.HuddleNode{}, ErrInvalid
	}
	return scanHuddleNode(r.db.QueryRow(`update huddle_nodes set name=$3,updated_timestamp=statement_timestamp() where company_id=$1::uuid and huddle_node_id=$2::uuid returning company_id::text,huddle_node_id::text,huddle_logic_gate_id::text,name,created_timestamp,updated_timestamp`, input.CompanyID, input.ResourceID, input.Name))
}
func (r *PostgresRepo) ListKPIs(companyID, ownerID string) ([]domain.KPI, error) {
	rows, err := r.db.Query(`select company_id::text,kpi_id::text,logic_gate_id::text,name,created_timestamp,updated_timestamp from kpis where company_id=$1::uuid and logic_gate_id=$2::uuid order by created_timestamp,kpi_id`, companyID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.KPI{}
	for rows.Next() {
		v, e := scanKPI(rows)
		if e != nil {
			return nil, e
		}
		items = append(items, v)
	}
	return items, rows.Err()
}
func (r *PostgresRepo) CreateKPI(input HuddleCreateInput) (domain.KPI, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.KPI{}, ErrInvalid
	}
	return scanKPI(r.db.QueryRow(`insert into kpis(company_id,kpi_id,logic_gate_id,name) values($1::uuid,$2::uuid,$3::uuid,$4) returning company_id::text,kpi_id::text,logic_gate_id::text,name,created_timestamp,updated_timestamp`, input.CompanyID, newUUIDv7String(), input.OwnerID, input.Name))
}
func (r *PostgresRepo) GetKPI(companyID, id string) (domain.KPI, error) {
	return scanKPI(r.db.QueryRow(`select company_id::text,kpi_id::text,logic_gate_id::text,name,created_timestamp,updated_timestamp from kpis where company_id=$1::uuid and kpi_id=$2::uuid`, companyID, id))
}
func (r *PostgresRepo) UpdateKPI(input HuddleUpdateInput) (domain.KPI, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.KPI{}, ErrInvalid
	}
	return scanKPI(r.db.QueryRow(`update kpis set name=$3,updated_timestamp=statement_timestamp() where company_id=$1::uuid and kpi_id=$2::uuid returning company_id::text,kpi_id::text,logic_gate_id::text,name,created_timestamp,updated_timestamp`, input.CompanyID, input.ResourceID, input.Name))
}

func postgresCreateDirectPolicyTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	var g, p int64
	if err := tx.QueryRowContext(ctx, `select nextval('resource_gvic_change_sequence'),nextval('resource_permission_change_sequence')`).Scan(&g, &p); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `insert into resource_gvic_settings(company_id,resource_type,resource_id,assignment_mode,customized_sequence,parent_link_sequence) values($1::uuid,$2,$3::uuid,'customized',$4,0)`, companyID, resourceType, resourceID, g); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `insert into resource_permission_settings(company_id,resource_type,resource_id,permission_mode,default_access,customized_sequence,parent_link_sequence) values($1::uuid,$2,$3::uuid,'customized','edit',$4,0)`, companyID, resourceType, resourceID, p)
	return err
}

func (r *PostgresRepo) ListHuddleExplorer(companyID string) (domain.HuddleExplorer, error) {
	result := domain.HuddleExplorer{Folders: []domain.HuddleExplorerFolder{}, Items: []domain.HuddleExplorerItem{}}
	rows, err := r.db.Query(`select company_id::text,folder_id::text,parent_folder_id::text,name,created_date,updated_date from huddle_explorer_folders where company_id=$1::uuid order by created_date,folder_id`, companyID)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var v domain.HuddleExplorerFolder
		var parent sql.NullString
		if err = rows.Scan(&v.CompanyID, &v.FolderID, &parent, &v.Name, &v.CreatedTimestamp, &v.UpdatedTimestamp); err != nil {
			rows.Close()
			return result, err
		}
		if parent.Valid {
			v.ParentFolderID = &parent.String
		}
		result.Folders = append(result.Folders, v)
	}
	if err = rows.Close(); err != nil {
		return result, err
	}
	rows, err = r.db.Query(`select item.company_id::text,item.huddle_explorer_item_id::text,item.parent_folder_id::text,item.huddle_type,item.resource_huddle_resource_id::text,gate.header,item.created_date,item.updated_date from huddle_explorer_items item join huddle_logic_gates gate on gate.company_id=item.company_id and gate.huddle_logic_gate_id=item.resource_huddle_resource_id where item.company_id=$1::uuid order by item.created_date,item.huddle_explorer_item_id`, companyID)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var v domain.HuddleExplorerItem
		var parent sql.NullString
		if err = rows.Scan(&v.CompanyID, &v.ItemID, &parent, &v.ResourceType, &v.ResourceID, &v.Name, &v.CreatedTimestamp, &v.UpdatedTimestamp); err != nil {
			return result, err
		}
		if parent.Valid {
			v.ParentFolderID = &parent.String
		}
		result.Items = append(result.Items, v)
	}
	return result, rows.Err()
}
func (r *PostgresRepo) CreateHuddleExplorerFolder(input HuddleCreateInput) (domain.HuddleExplorerFolder, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.HuddleExplorerFolder{}, ErrInvalid
	}
	var v domain.HuddleExplorerFolder
	var parent sql.NullString
	err := r.db.QueryRow(`insert into huddle_explorer_folders(company_id,folder_id,parent_folder_id,name) values($1::uuid,$2::uuid,nullif($3,'')::uuid,$4) returning company_id::text,folder_id::text,parent_folder_id::text,name,created_date,updated_date`, input.CompanyID, newUUIDv7String(), input.OwnerID, input.Name).Scan(&v.CompanyID, &v.FolderID, &parent, &v.Name, &v.CreatedTimestamp, &v.UpdatedTimestamp)
	if parent.Valid {
		v.ParentFolderID = &parent.String
	}
	return v, err
}
func (r *PostgresRepo) UpdateHuddleExplorerFolder(input HuddleUpdateInput) (domain.HuddleExplorerFolder, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.HuddleExplorerFolder{}, ErrInvalid
	}
	var v domain.HuddleExplorerFolder
	var parent sql.NullString
	err := r.db.QueryRow(`update huddle_explorer_folders set name=$3,updated_date=statement_timestamp() where company_id=$1::uuid and folder_id=$2::uuid returning company_id::text,folder_id::text,parent_folder_id::text,name,created_date,updated_date`, input.CompanyID, input.ResourceID, input.Name).Scan(&v.CompanyID, &v.FolderID, &parent, &v.Name, &v.CreatedTimestamp, &v.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	if parent.Valid {
		v.ParentFolderID = &parent.String
	}
	return v, err
}
func (r *PostgresRepo) MoveHuddleExplorerFolder(input HuddleMoveInput) error {
	result, err := r.db.Exec(`update huddle_explorer_folders set parent_folder_id=nullif($3,'')::uuid,updated_date=statement_timestamp() where company_id=$1::uuid and folder_id=$2::uuid`, input.CompanyID, input.ResourceID, input.ParentFolderID)
	return rowsAffectedError(result, err)
}
func (r *PostgresRepo) MoveHuddleExplorerItem(input HuddleMoveInput) error {
	result, err := r.db.Exec(`update huddle_explorer_items set parent_folder_id=nullif($3,'')::uuid,updated_date=statement_timestamp() where company_id=$1::uuid and huddle_explorer_item_id=$2::uuid`, input.CompanyID, input.ResourceID, input.ParentFolderID)
	return rowsAffectedError(result, err)
}
func rowsAffectedError(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) DeleteHuddleLogicGate(companyID, id, userID string) error {
	return r.deleteHuddleObject(companyID, "huddle_logic_gate", id, userID)
}
func (r *PostgresRepo) DeleteHuddleNode(companyID, id, userID string) error {
	return r.deleteHuddleObject(companyID, "huddle_node", id, userID)
}
func (r *PostgresRepo) DeleteKPI(companyID, id, userID string) error {
	return r.deleteHuddleObject(companyID, "kpi", id, userID)
}
func (r *PostgresRepo) DeleteHuddleExplorerFolder(companyID, id, userID string) error {
	return r.deleteHuddleObject(companyID, "huddle_explorer_folder", id, userID)
}
func (r *PostgresRepo) DeleteHuddleExplorerItem(companyID, id, userID string) error {
	return r.deleteHuddleObject(companyID, "huddle_explorer_item", id, userID)
}

func (r *PostgresRepo) deleteHuddleObject(companyID, kind, id, userID string) error {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	table, labelExpression, where := "", "", ""
	switch kind {
	case "huddle_logic_gate":
		table = "huddle_logic_gates"
		labelExpression = "header"
		where = `company_id=$1::uuid and huddle_logic_gate_id=$2::uuid`
		var children bool
		if err = tx.QueryRowContext(ctx, `select exists(select 1 from huddle_nodes where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid)`, companyID, id).Scan(&children); err != nil {
			return err
		}
		if children {
			return ErrConflict
		}
	case "huddle_node":
		table = "huddle_nodes"
		labelExpression = "name"
		where = `company_id=$1::uuid and huddle_node_id=$2::uuid`
	case "kpi":
		table = "kpis"
		labelExpression = "name"
		where = `company_id=$1::uuid and kpi_id=$2::uuid`
	case "huddle_explorer_folder":
		table = "huddle_explorer_folders"
		labelExpression = "name"
		where = `company_id=$1::uuid and folder_id=$2::uuid`
		var children bool
		if err = tx.QueryRowContext(ctx, `select exists(select 1 from huddle_explorer_folders where company_id=$1::uuid and parent_folder_id=$2::uuid union all select 1 from huddle_explorer_items where company_id=$1::uuid and parent_folder_id=$2::uuid)`, companyID, id).Scan(&children); err != nil {
			return err
		}
		if children {
			return ErrConflict
		}
	case "huddle_explorer_item":
		table = "huddle_explorer_items"
		labelExpression = `(select header from huddle_logic_gates where company_id=$1::uuid and huddle_logic_gate_id=resource_huddle_resource_id)`
		where = `company_id=$1::uuid and huddle_explorer_item_id=$2::uuid`
	default:
		return ErrInvalid
	}
	var label string
	if err = tx.QueryRowContext(ctx, `select `+labelExpression+` from `+table+` where `+where, companyID, id).Scan(&label); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	payload := map[string]json.RawMessage{}
	add := func(name, clause string, args ...any) error {
		rows, e := postgresSnapshotRowsTx(ctx, tx, name, clause, args...)
		if e == nil && len(rows) > 0 && string(rows) != "[]" {
			payload[name] = rows
		}
		return e
	}
	if err = add(table, where, companyID, id); err != nil {
		return err
	}
	if kind == "huddle_logic_gate" {
		if err = add("huddle_explorer_items", `company_id=$1::uuid and huddle_type='huddle_logic_gate' and resource_huddle_resource_id=$2::uuid`, companyID, id); err != nil {
			return err
		}
		if err = add("huddle_logic_gate_relationships", `company_id=$1::uuid and huddle_logic_gate_id=$2::uuid`, companyID, id); err != nil {
			return err
		}
	}
	if kind == "huddle_node" {
		if err = add("huddle_node_logic_gate_relationships", `company_id=$1::uuid and huddle_node_id=$2::uuid`, companyID, id); err != nil {
			return err
		}
		if err = add("huddle_node_kpi_relationships", `company_id=$1::uuid and huddle_node_id=$2::uuid`, companyID, id); err != nil {
			return err
		}
	}
	if kind == "kpi" {
		if err = add("huddle_node_kpi_relationships", `company_id=$1::uuid and kpi_id=$2::uuid`, companyID, id); err != nil {
			return err
		}
	}
	if kind == "huddle_logic_gate" || kind == "huddle_node" {
		for _, policyTable := range []string{"resource_gvic_settings", "resource_permission_settings", "resource_gvic_assignments", "resource_permissions"} {
			if err = add(policyTable, `company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, kind, id); err != nil {
				return err
			}
		}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `insert into recycle_bin_items(company_id,recycle_bin_item_id,object_kind,object_id,object_label,restore_payload,deleted_by_user_id) values($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,nullif($7,'')::uuid)`, companyID, newUUIDv7String(), kind, id, label, string(encoded), userID); err != nil {
		return err
	}
	if kind == "huddle_logic_gate" || kind == "huddle_node" {
		for _, policyTable := range []string{"resource_gvic_assignments", "resource_permissions", "resource_gvic_settings", "resource_permission_settings"} {
			if _, err = tx.ExecContext(ctx, `delete from `+policyTable+` where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, kind, id); err != nil {
				return err
			}
		}
	}
	if kind == "huddle_logic_gate" {
		if _, err = tx.ExecContext(ctx, `delete from huddle_explorer_items where company_id=$1::uuid and huddle_type='huddle_logic_gate' and resource_huddle_resource_id=$2::uuid`, companyID, id); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, `delete from `+table+` where `+where, companyID, id); err != nil {
		return err
	}
	return tx.Commit()
}
