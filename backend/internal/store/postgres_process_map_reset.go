package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

var (
	ErrProcessMapResetStalePlan = errors.New("Process Map changed; run a new reset preview")
	ErrProcessMapResetSchema    = errors.New("apply 20260902_process_map_nested_layout_capacity.sql before resetting Process Map")
	ErrProcessMapResetVersion   = errors.New("Process Map reset supports PostgreSQL 17.x and 18.x")
	ErrProcessMapResetSource    = errors.New("Process Map placements do not match canonical Company Explorer resources")
)

type ProcessMapResetInput struct {
	CompanyID         string
	ActorUserID       string
	Apply             bool
	ExpectedPlanToken string
}

type ProcessMapResetResult struct {
	CompanyID         string `json:"company_id"`
	CompanyName       string `json:"company_name"`
	ServerVersion     string `json:"server_version"`
	PlanToken         string `json:"plan_token"`
	FolderCount       int    `json:"folder_count"`
	ProcessCount      int    `json:"process_count"`
	ChangedPlacements int    `json:"changed_placements"`
	RelationshipCount int    `json:"relationships_to_delete"`
	TraceCount        int    `json:"traces_to_delete"`
	MaxFolderDepth    int    `json:"max_folder_depth"`
	Applied           bool   `json:"applied"`
	ReadVersion       int64  `json:"read_version"`
}

// ResetProcessMap is an explicit operator operation, never a startup hook or
// ordinary Explorer synchronization. Preview uses a database-enforced read-only
// snapshot. Apply rebuilds and verifies that same plan under the normal locks,
// then saves all geometry and removes operational connections in one commit.
func (r *PostgresRepo) ResetProcessMap(ctx context.Context, input ProcessMapResetInput) (ProcessMapResetResult, error) {
	result := ProcessMapResetResult{CompanyID: cleanUUIDText(input.CompanyID)}
	actorID := cleanUUIDText(input.ActorUserID)
	input.ExpectedPlanToken = strings.TrimSpace(input.ExpectedPlanToken)
	if r == nil || r.db == nil || result.CompanyID == "" || actorID == "" ||
		(input.Apply && len(input.ExpectedPlanToken) != sha256.Size*2) || (!input.Apply && input.ExpectedPlanToken != "") {
		return result, ErrInvalid
	}
	opts := &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead}
	if input.Apply {
		opts = nil
	}
	tx, err := r.db.BeginTx(ctx, opts)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()

	var versionNumber int
	if err := tx.QueryRowContext(ctx, `select current_setting('server_version'),current_setting('server_version_num')::integer`).Scan(&result.ServerVersion, &versionNumber); err != nil {
		return result, err
	}
	if versionNumber < 170000 || versionNumber >= 190000 {
		return result, ErrProcessMapResetVersion
	}
	var geometryConstraint string
	if err := tx.QueryRowContext(ctx, `
select pg_get_constraintdef(oid) from pg_constraint
where conrelid=to_regclass('public.process_map_placements')
  and conname='process_map_placements_geometry_chk' and convalidated`).Scan(&geometryConstraint); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return result, ErrProcessMapResetSchema
		}
		return result, err
	}
	if !strings.Contains(geometryConstraint, "grid_width <= 250000000") || !strings.Contains(geometryConstraint, "grid_height <= 250000000") {
		return result, ErrProcessMapResetSchema
	}

	if input.Apply {
		// Match the existing Explorer -> policy -> map order. The reset changes
		// no policy parent, so the shared policy lock is sufficient.
		if err := lockPostgresCompanyExplorerMutationTx(ctx, tx, result.CompanyID, actorID, false); err != nil {
			return result, err
		}
		if err := postgresLockProcessMapCompanyTx(ctx, tx, result.CompanyID); err != nil {
			return result, err
		}
	} else if err := postgresRequireProcessMapMembershipTx(ctx, tx, result.CompanyID, actorID); err != nil {
		return result, err
	}
	if err := tx.QueryRowContext(ctx, `select name from companies where company_id=$1::uuid`, result.CompanyID).Scan(&result.CompanyName); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return result, ErrNotFound
		}
		return result, err
	}
	resources, err := postgresProcessMapResetResourcesTx(ctx, tx, result.CompanyID)
	if err != nil {
		return result, err
	}
	current, err := postgresAutomaticProcessMapPlacementsTx(ctx, tx, result.CompanyID, input.Apply)
	if err != nil {
		return result, err
	}
	relationships, traces, err := postgresProcessMapResetConnectionsTx(ctx, tx, result.CompanyID, input.Apply)
	if err != nil {
		return result, err
	}

	refs := make([]domain.ProcessMapResourceRef, 0, len(resources)+2*len(relationships))
	for _, resource := range resources {
		refs = append(refs, domain.ProcessMapResourceRef{ResourceType: resource.ResourceType, ResourceID: resource.ResourceID})
	}
	for _, relationship := range relationships {
		refs = append(refs, relationship.Source, relationship.Target)
	}
	if err := postgresAuthorizeProcessMapResetTx(ctx, tx, result.CompanyID, actorID, refs, input.Apply); err != nil {
		return ProcessMapResetResult{CompanyID: result.CompanyID, ServerVersion: result.ServerVersion}, err
	}
	planned, err := planProcessMapReset(result.CompanyID, resources)
	if err != nil {
		return result, err
	}
	byKey := make(map[string]domain.ProcessMapPlacement, len(planned))
	folderParents := make(map[string]string)
	for _, item := range planned {
		byKey[processMapAutomaticPlacementKey(item.ResourceType, item.ResourceID)] = item
		if item.ResourceType == domain.ProcessMapResourceTypeFolder {
			result.FolderCount++
			folderParents[item.ResourceID] = processMapAutomaticParentID(item)
		} else {
			result.ProcessCount++
		}
	}
	for folderID := range folderParents {
		depth := 0
		for id := folderID; id != ""; id = folderParents[id] {
			depth++
		}
		result.MaxFolderDepth = max(result.MaxFolderDepth, depth)
	}
	unchanged := make(map[string]bool, len(current))
	for _, item := range current {
		key := processMapAutomaticPlacementKey(item.ResourceType, item.ResourceID)
		target, exists := byKey[key]
		if !exists {
			return result, ErrProcessMapResetSource
		}
		unchanged[key] = processMapAutomaticGeometryEqual(item, target)
	}
	changed := make([]domain.ProcessMapPlacement, 0, len(planned))
	for _, item := range planned {
		if !unchanged[processMapAutomaticPlacementKey(item.ResourceType, item.ResourceID)] {
			changed = append(changed, item)
		}
	}
	result.ChangedPlacements, result.RelationshipCount, result.TraceCount = len(changed), len(relationships), len(traces)
	var policyVersion int64
	result.ReadVersion, policyVersion, err = processMapVersionsTx(ctx, tx, result.CompanyID)
	if err != nil {
		return result, err
	}
	// Include source ordering, old and planned geometry, connections/routes,
	// actor and permission generation. A preview never authorizes a later state.
	snapshot, err := json.Marshal(struct {
		CompanyID, CompanyName, ActorID string
		Resources                       []processMapResetResource
		Current, Planned                []domain.ProcessMapPlacement
		Relationships                   []domain.ResourceOperationalRelationship
		Traces                          []domain.ProcessMapTrace
		ReadVersion, PolicyVersion      int64
	}{result.CompanyID, result.CompanyName, actorID, resources, current, planned, relationships, traces, result.ReadVersion, policyVersion})
	if err != nil {
		return result, err
	}
	digest := sha256.Sum256(snapshot)
	result.PlanToken = hex.EncodeToString(digest[:])
	if !input.Apply {
		return result, nil
	}
	if result.PlanToken != input.ExpectedPlanToken {
		return result, ErrProcessMapResetStalePlan
	}

	if err := postgresSaveAutomaticProcessMapPlacementsTx(ctx, tx, result.CompanyID, changed); err != nil {
		return result, err
	}
	deleted, err := tx.ExecContext(ctx, `delete from resource_operational_relationships where company_id=$1::uuid`, result.CompanyID)
	if err != nil {
		return result, err
	}
	count, err := deleted.RowsAffected()
	if err != nil {
		return result, err
	}
	if count != int64(len(relationships)) {
		return result, ErrProcessMapResetStalePlan
	}

	events := make([]DomainEventInput, 0, len(changed)+len(relationships))
	for _, item := range changed {
		events = append(events, processMapEventInput(result.CompanyID, actorID, ProcessMapPlacementSavedEvent, processMapResourceEventPayload(item.ResourceType, item.ResourceID)))
	}
	for _, relationship := range relationships {
		events = append(events, processMapEventInput(result.CompanyID, actorID, ResourceOperationalRelationshipDeletedEvent, processMapRelationshipEventPayload(relationship)))
	}
	// Keep each existing event batch below PostgreSQL's bind-parameter limit.
	for start := 0; start < len(events); start += 1000 {
		if _, err := r.appendDomainEventsTx(ctx, tx, events[start:min(start+1000, len(events))]); err != nil {
			return result, err
		}
	}
	result.ReadVersion, _, err = processMapVersionsTx(ctx, tx, result.CompanyID)
	if err != nil {
		return result, err
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	result.Applied = true
	return result, nil
}

func postgresProcessMapResetResourcesTx(ctx context.Context, tx *sql.Tx, companyID string) ([]processMapResetResource, error) {
	rows, err := tx.QueryContext(ctx, `
select resource_type,resource_id::text,coalesce(parent_id::text,'')
from (
  select 'company_explorer_folder'::text resource_type,folder_id resource_id,parent_folder_id parent_id,
         position,created_timestamp,name
  from company_explorer_folders where company_id=$1::uuid
  union all
  select 'logic_gate',item.target_id,item.parent_folder_id,item.position,item.created_timestamp,
         coalesce(gate.header,item.target_id::text)
  from company_explorer_items item
  left join logic_gates gate on gate.company_id=item.company_id and gate.logic_gate_id=item.target_id
  where item.company_id=$1::uuid and item.target_type='logic_gate'
) resources
order by position,created_timestamp,name,resource_id,resource_type`, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	resources := []processMapResetResource{}
	for rows.Next() {
		var item processMapResetResource
		if err := rows.Scan(&item.ResourceType, &item.ResourceID, &item.ParentID); err != nil {
			return nil, err
		}
		resources = append(resources, item)
	}
	return resources, rows.Err()
}

func postgresProcessMapResetConnectionsTx(ctx context.Context, tx *sql.Tx, companyID string, forUpdate bool) ([]domain.ResourceOperationalRelationship, []domain.ProcessMapTrace, error) {
	lock := ""
	if forUpdate {
		lock = " for update"
	}
	rows, err := tx.QueryContext(ctx, `
select company_id::text,resource_operational_relationship_id::text,source_resource_type,source_resource_id::text,
       target_resource_type,target_resource_id::text,created_timestamp
from resource_operational_relationships where company_id=$1::uuid
order by resource_operational_relationship_id`+lock, companyID)
	if err != nil {
		return nil, nil, err
	}
	relationships := []domain.ResourceOperationalRelationship{}
	for rows.Next() {
		item, err := scanResourceOperationalRelationship(rows)
		if err != nil {
			rows.Close()
			return nil, nil, err
		}
		relationships = append(relationships, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	rows, err = tx.QueryContext(ctx, `
select company_id::text,resource_operational_relationship_id::text,route_points,revision,created_timestamp,updated_timestamp
from process_map_traces where company_id=$1::uuid
order by resource_operational_relationship_id`+lock, companyID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	traces := []domain.ProcessMapTrace{}
	for rows.Next() {
		item, err := scanProcessMapTrace(rows)
		if err != nil {
			return nil, nil, err
		}
		traces = append(traces, item)
	}
	return relationships, traces, rows.Err()
}

func postgresAuthorizeProcessMapResetTx(ctx context.Context, tx *sql.Tx, companyID, actorID string, refs []domain.ProcessMapResourceRef, forUpdate bool) error {
	if forUpdate {
		return postgresRequireProcessMapResourcesTx(ctx, tx, companyID, actorID, refs)
	}
	sort.Slice(refs, func(i, j int) bool {
		if refs[i].ResourceType == refs[j].ResourceType {
			return refs[i].ResourceID < refs[j].ResourceID
		}
		return refs[i].ResourceType < refs[j].ResourceType
	})
	for i, ref := range refs {
		if i > 0 && ref == refs[i-1] {
			continue
		}
		query, ok := postgresProcessMapResourceQuery(ref.ResourceType, false)
		if !ok {
			return ErrInvalid
		}
		var allowed bool
		err := tx.QueryRowContext(ctx, query, companyID, ref.ResourceID, actorID).Scan(&allowed)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && !allowed) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
	}
	return nil
}
