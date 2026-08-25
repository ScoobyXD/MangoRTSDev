package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
)

func scanProcessMapPlacement(row interface{ Scan(...any) error }) (domain.ProcessMapPlacement, error) {
	var item domain.ProcessMapPlacement
	var parentID sql.NullString
	err := row.Scan(&item.CompanyID, &item.ResourceType, &item.ResourceID, &parentID, &item.GridX, &item.GridY, &item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ProcessMapPlacement{}, ErrNotFound
	}
	if err != nil {
		return domain.ProcessMapPlacement{}, err
	}
	if parentID.Valid {
		item.MapParentFolderID = &parentID.String
	}
	return item, nil
}

func scanResourceOperationalRelationship(row interface{ Scan(...any) error }) (domain.ResourceOperationalRelationship, error) {
	var item domain.ResourceOperationalRelationship
	err := row.Scan(
		&item.CompanyID, &item.ResourceOperationalRelationshipID,
		&item.Source.ResourceType, &item.Source.ResourceID,
		&item.Target.ResourceType, &item.Target.ResourceID,
		&item.CreatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ResourceOperationalRelationship{}, ErrNotFound
	}
	return item, err
}

func scanProcessMapTrace(row interface{ Scan(...any) error }) (domain.ProcessMapTrace, error) {
	var item domain.ProcessMapTrace
	var routeJSON []byte
	err := row.Scan(&item.CompanyID, &item.ResourceOperationalRelationshipID, &routeJSON, &item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ProcessMapTrace{}, ErrNotFound
	}
	if err != nil {
		return domain.ProcessMapTrace{}, err
	}
	if err := json.Unmarshal(routeJSON, &item.RoutePoints); err != nil {
		return domain.ProcessMapTrace{}, err
	}
	if item.RoutePoints == nil {
		item.RoutePoints = []domain.ProcessMapRoutePoint{}
	}
	return item, nil
}

func postgresProcessMapResourceQuery(resourceType string, forUpdate bool) (string, bool) {
	lock := ""
	if forUpdate {
		lock = " for update"
	}
	switch resourceType {
	case domain.ProcessMapResourceTypeFolder:
		return `select mangorts_user_can_access_resource(company_id,'company_explorer_folder',folder_id,$3::uuid,'edit')
from company_explorer_folders
where company_id=$1::uuid and folder_id=$2::uuid` + lock, true
	case domain.ProcessMapResourceTypeProcess:
		return `select mangorts_user_can_access_resource(company_id,'logic_gate',logic_gate_id,$3::uuid,'edit')
from logic_gates
where company_id=$1::uuid and logic_gate_id=$2::uuid` + lock, true
	default:
		return "", false
	}
}

func postgresRequireProcessMapResourceTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID, permissionUserID string) error {
	query, ok := postgresProcessMapResourceQuery(resourceType, true)
	if !ok {
		return ErrInvalid
	}
	var allowed bool
	err := tx.QueryRowContext(ctx, query, companyID, resourceID, permissionUserID).Scan(&allowed)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !allowed) {
		return ErrNotFound
	}
	return err
}

func (r *PostgresRepo) postgresRequireProcessMapResource(ctx context.Context, companyID, resourceType, resourceID, permissionUserID string) error {
	query, ok := postgresProcessMapResourceQuery(resourceType, false)
	if !ok {
		return ErrInvalid
	}
	var allowed bool
	err := r.db.QueryRowContext(ctx, query, companyID, resourceID, permissionUserID).Scan(&allowed)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !allowed) {
		return ErrNotFound
	}
	return err
}

func normalizePostgresProcessMapQueryIDs(companyID, resourceID, permissionUserID string) (string, string, string, error) {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	permissionUserID = cleanUUIDText(permissionUserID)
	if companyID == "" || resourceID == "" || permissionUserID == "" {
		return "", "", "", ErrInvalid
	}
	return companyID, resourceID, permissionUserID, nil
}

func (r *PostgresRepo) postgresProcessMapLayerAncestors(ctx context.Context, companyID, folderID, permissionUserID string) ([]domain.ProcessMapLayerAncestor, error) {
	rows, err := r.db.QueryContext(ctx, `
with recursive ancestor_path(folder_id,depth,visited,cycle) as (
  select placement.map_parent_folder_id,1,
         array[placement.resource_id,placement.map_parent_folder_id],
         placement.map_parent_folder_id=placement.resource_id
  from process_map_placements placement
  where placement.company_id=$1::uuid
    and placement.resource_type='company_explorer_folder'
    and placement.resource_id=$2::uuid
    and placement.map_parent_folder_id is not null
  union all
  select parent_placement.map_parent_folder_id,path.depth+1,
         path.visited || parent_placement.map_parent_folder_id,
         parent_placement.map_parent_folder_id=any(path.visited)
  from ancestor_path path
  join process_map_placements parent_placement
    on parent_placement.company_id=$1::uuid
   and parent_placement.resource_type='company_explorer_folder'
   and parent_placement.resource_id=path.folder_id
  where not path.cycle
    and path.depth < $4
    and parent_placement.map_parent_folder_id is not null
)
select path.folder_id::text,folder.name,
       case when folder.folder_id is null then false
            else mangorts_user_can_access_resource($1::uuid,'company_explorer_folder',path.folder_id,$3::uuid,'edit') end,
       path.depth,path.cycle
from ancestor_path path
left join company_explorer_folders folder
  on folder.company_id=$1::uuid and folder.folder_id=path.folder_id
order by path.depth desc`, companyID, folderID, permissionUserID, processMapMaxLayerAncestors+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ancestors := []domain.ProcessMapLayerAncestor{}
	valid := true
	for rows.Next() {
		var item domain.ProcessMapLayerAncestor
		var name sql.NullString
		var allowed, cycle bool
		var depth int
		if err := rows.Scan(&item.FolderID, &name, &allowed, &depth, &cycle); err != nil {
			return nil, err
		}
		if !name.Valid || !allowed || cycle || depth > processMapMaxLayerAncestors {
			valid = false
			continue
		}
		item.Name = name.String
		ancestors = append(ancestors, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !valid {
		return []domain.ProcessMapLayerAncestor{}, nil
	}
	return ancestors, nil
}

func (r *PostgresRepo) GetProcessMapLayer(input ProcessMapLayerQuery) (domain.ProcessMapLayerView, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.FolderID = cleanUUIDText(input.FolderID)
	input.PermissionUserID = cleanUUIDText(input.PermissionUserID)
	if input.CompanyID == "" || input.PermissionUserID == "" {
		return domain.ProcessMapLayerView{}, ErrInvalid
	}
	ctx := context.Background()
	view := domain.ProcessMapLayerView{Layer: domain.ProcessMapLayer{Kind: "root", Ancestors: []domain.ProcessMapLayerAncestor{}}, Placements: []domain.ProcessMapLayerPlacement{}, Traces: []domain.ProcessMapLayerTrace{}}
	if input.FolderID != "" {
		if err := r.postgresRequireProcessMapResource(ctx, input.CompanyID, domain.ProcessMapResourceTypeFolder, input.FolderID, input.PermissionUserID); err != nil {
			return domain.ProcessMapLayerView{}, err
		}
		var name string
		if err := r.db.QueryRowContext(ctx, `select name from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid`, input.CompanyID, input.FolderID).Scan(&name); err != nil {
			return domain.ProcessMapLayerView{}, err
		}
		ancestors, err := r.postgresProcessMapLayerAncestors(ctx, input.CompanyID, input.FolderID, input.PermissionUserID)
		if err != nil {
			return domain.ProcessMapLayerView{}, err
		}
		view.Layer = domain.ProcessMapLayer{Kind: "folder", FolderID: input.FolderID, Name: name, Ancestors: ancestors}
	}

	rows, err := r.db.QueryContext(ctx, `
select placement.company_id::text,placement.resource_type,placement.resource_id::text,
       placement.grid_x,placement.grid_y,placement.revision,placement.created_timestamp,placement.updated_timestamp,
       case placement.resource_type when 'company_explorer_folder' then folder.name else process.header end as resource_name,
       mangorts_user_can_access_resource(placement.company_id,placement.resource_type,placement.resource_id,$3::uuid,'edit') as allowed
from process_map_placements placement
left join company_explorer_folders folder
  on placement.resource_type='company_explorer_folder' and folder.company_id=placement.company_id and folder.folder_id=placement.resource_id
left join logic_gates process
  on placement.resource_type='logic_gate' and process.company_id=placement.company_id and process.logic_gate_id=placement.resource_id
where placement.company_id=$1::uuid
  and placement.map_parent_folder_id is not distinct from nullif($2,'')::uuid
order by placement.grid_y,placement.grid_x,placement.resource_type,placement.resource_id`, input.CompanyID, input.FolderID, input.PermissionUserID)
	if err != nil {
		return domain.ProcessMapLayerView{}, err
	}
	visiblePlacements := map[string]bool{}
	for rows.Next() {
		var companyID, resourceType, resourceID, name string
		var gridX, gridY int
		var revision int64
		var createdTimestamp, updatedTimestamp sql.NullTime
		var allowed bool
		if err := rows.Scan(&companyID, &resourceType, &resourceID, &gridX, &gridY, &revision, &createdTimestamp, &updatedTimestamp, &name, &allowed); err != nil {
			rows.Close()
			return domain.ProcessMapLayerView{}, err
		}
		if !allowed {
			view.Placements = append(view.Placements, domain.ProcessMapRestrictedPlacement{Restricted: true, GridX: gridX, GridY: gridY})
			continue
		}
		visiblePlacements[resourceType+":"+resourceID] = true
		view.Placements = append(view.Placements, domain.ProcessMapVisiblePlacement{
			Restricted: false, ResourceType: resourceType, ResourceID: resourceID, Name: name,
			GridX: gridX, GridY: gridY, Revision: revision,
			CreatedTimestamp: createdTimestamp.Time, UpdatedTimestamp: updatedTimestamp.Time,
		})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return domain.ProcessMapLayerView{}, err
	}
	if err := rows.Close(); err != nil {
		return domain.ProcessMapLayerView{}, err
	}

	traceRows, err := r.db.QueryContext(ctx, `
select relationship.resource_operational_relationship_id::text,
       relationship.source_resource_type,relationship.source_resource_id::text,
       relationship.target_resource_type,relationship.target_resource_id::text,
       trace.route_points,trace.revision,trace.created_timestamp,trace.updated_timestamp
from process_map_traces trace
join resource_operational_relationships relationship
  on relationship.company_id=trace.company_id and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
join process_map_placements source_placement
  on source_placement.company_id=relationship.company_id and source_placement.resource_type=relationship.source_resource_type and source_placement.resource_id=relationship.source_resource_id
join process_map_placements target_placement
  on target_placement.company_id=relationship.company_id and target_placement.resource_type=relationship.target_resource_type and target_placement.resource_id=relationship.target_resource_id
where trace.company_id=$1::uuid
  and source_placement.map_parent_folder_id is not distinct from nullif($2,'')::uuid
  and target_placement.map_parent_folder_id is not distinct from nullif($2,'')::uuid
  and mangorts_user_can_access_resource(relationship.company_id,relationship.source_resource_type,relationship.source_resource_id,$3::uuid,'edit')
  and mangorts_user_can_access_resource(relationship.company_id,relationship.target_resource_type,relationship.target_resource_id,$3::uuid,'edit')
order by relationship.resource_operational_relationship_id`, input.CompanyID, input.FolderID, input.PermissionUserID)
	if err != nil {
		return domain.ProcessMapLayerView{}, err
	}
	defer traceRows.Close()
	for traceRows.Next() {
		var item domain.ProcessMapLayerTrace
		var routeJSON []byte
		if err := traceRows.Scan(&item.ResourceOperationalRelationshipID, &item.Source.ResourceType, &item.Source.ResourceID, &item.Target.ResourceType, &item.Target.ResourceID, &routeJSON, &item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			return domain.ProcessMapLayerView{}, err
		}
		if err := json.Unmarshal(routeJSON, &item.RoutePoints); err != nil {
			return domain.ProcessMapLayerView{}, err
		}
		if !visiblePlacements[item.Source.ResourceType+":"+item.Source.ResourceID] || !visiblePlacements[item.Target.ResourceType+":"+item.Target.ResourceID] {
			continue
		}
		if item.RoutePoints == nil {
			item.RoutePoints = []domain.ProcessMapRoutePoint{}
		}
		view.Traces = append(view.Traces, item)
	}
	return view, traceRows.Err()
}

func (r *PostgresRepo) ListResourceOperationalRelationshipsForResource(input ResourceOperationalRelationshipQuery) ([]domain.ResourceOperationalRelationship, error) {
	resourceType, typeOK := normalizeProcessMapResourceType(input.ResourceType)
	direction, directionOK := normalizeProcessMapDirection(input.Direction)
	companyID, resourceID, permissionUserID, err := normalizePostgresProcessMapQueryIDs(input.CompanyID, input.ResourceID, input.PermissionUserID)
	if err != nil || !typeOK || !directionOK {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	if err := r.postgresRequireProcessMapResource(ctx, companyID, resourceType, resourceID, permissionUserID); err != nil {
		return nil, err
	}
	directionClause := `((relationship.source_resource_type=$2 and relationship.source_resource_id=$3::uuid) or (relationship.target_resource_type=$2 and relationship.target_resource_id=$3::uuid))`
	if direction == "outgoing" {
		directionClause = `(relationship.source_resource_type=$2 and relationship.source_resource_id=$3::uuid)`
	} else if direction == "incoming" {
		directionClause = `(relationship.target_resource_type=$2 and relationship.target_resource_id=$3::uuid)`
	}
	rows, err := r.db.QueryContext(ctx, `
select relationship.company_id::text,relationship.resource_operational_relationship_id::text,
       relationship.source_resource_type,relationship.source_resource_id::text,
       relationship.target_resource_type,relationship.target_resource_id::text,relationship.created_timestamp
from resource_operational_relationships relationship
where relationship.company_id=$1::uuid and `+directionClause+`
  and mangorts_user_can_access_resource(relationship.company_id,relationship.source_resource_type,relationship.source_resource_id,$4::uuid,'edit')
  and mangorts_user_can_access_resource(relationship.company_id,relationship.target_resource_type,relationship.target_resource_id,$4::uuid,'edit')
order by relationship.resource_operational_relationship_id`, companyID, resourceType, resourceID, permissionUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.ResourceOperationalRelationship{}
	for rows.Next() {
		item, err := scanResourceOperationalRelationship(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func normalizePostgresProcessMapMutation(companyID, actorUserID, permissionUserID string) (string, string, string, error) {
	companyID = cleanUUIDText(companyID)
	actorUserID = cleanUUIDText(actorUserID)
	permissionUserID = cleanUUIDText(permissionUserID)
	if companyID == "" || actorUserID == "" || permissionUserID == "" {
		return "", "", "", ErrInvalid
	}
	return companyID, actorUserID, permissionUserID, nil
}

func processMapPlacementByResourceTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string, forUpdate bool) (domain.ProcessMapPlacement, error) {
	lock := ""
	if forUpdate {
		lock = " for update"
	}
	return scanProcessMapPlacement(tx.QueryRowContext(ctx, `
select company_id::text,resource_type,resource_id::text,map_parent_folder_id::text,grid_x,grid_y,revision,created_timestamp,updated_timestamp
from process_map_placements
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`+lock, companyID, resourceType, resourceID))
}

func processMapRelationshipByIDTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID string, forUpdate bool) (domain.ResourceOperationalRelationship, error) {
	lock := ""
	if forUpdate {
		lock = " for update"
	}
	return scanResourceOperationalRelationship(tx.QueryRowContext(ctx, `
select company_id::text,resource_operational_relationship_id::text,source_resource_type,source_resource_id::text,target_resource_type,target_resource_id::text,created_timestamp
from resource_operational_relationships
where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`+lock, companyID, relationshipID))
}

func (r *PostgresRepo) PutProcessMapPlacement(input ProcessMapPlacementPutInput) (ProcessMapPlacementMutationResult, error) {
	companyID, actorUserID, permissionUserID, err := normalizePostgresProcessMapMutation(input.CompanyID, input.ActorUserID, input.PermissionUserID)
	resourceType, typeOK := normalizeProcessMapResourceType(input.ResourceType)
	resourceID := cleanUUIDText(input.ResourceID)
	parentID := ""
	if input.MapParentFolderID != nil {
		parentID = cleanUUIDText(*input.MapParentFolderID)
	}
	if err != nil || !typeOK || resourceID == "" || (input.MapParentFolderID != nil && parentID == "") || !validProcessMapCoordinate(input.GridX) || !validProcessMapCoordinate(input.GridY) {
		return ProcessMapPlacementMutationResult{}, ErrInvalid
	}
	if resourceType == domain.ProcessMapResourceTypeProcess && parentID == "" {
		return ProcessMapPlacementMutationResult{}, ErrProcessMapRootProcess
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessMapPlacementMutationResult{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, false); err != nil {
		return ProcessMapPlacementMutationResult{}, err
	}

	// Folder parentage is serialized before any row lock. All Process Map
	// mutations then lock canonical resources in typed-ID order before map rows.
	// That one order prevents placement moves from deadlocking trace writes.
	if resourceType == domain.ProcessMapResourceTypeFolder {
		if _, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended('process-map-parent:' || $1,0))`, companyID); err != nil {
			return ProcessMapPlacementMutationResult{}, err
		}
	}
	resources := []domain.ProcessMapResourceRef{{ResourceType: resourceType, ResourceID: resourceID}}
	if parentID != "" {
		resources = append(resources, domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: parentID})
	}
	sort.Slice(resources, func(i, j int) bool {
		if resources[i].ResourceType == resources[j].ResourceType {
			return resources[i].ResourceID < resources[j].ResourceID
		}
		return resources[i].ResourceType < resources[j].ResourceType
	})
	for index, resource := range resources {
		if index > 0 && resource == resources[index-1] {
			continue
		}
		if err := postgresRequireProcessMapResourceTx(ctx, tx, companyID, resource.ResourceType, resource.ResourceID, permissionUserID); err != nil {
			return ProcessMapPlacementMutationResult{}, err
		}
	}
	if resourceType == domain.ProcessMapResourceTypeFolder && parentID == resourceID {
		return ProcessMapPlacementMutationResult{}, ErrProcessMapCycle
	}
	current, currentErr := processMapPlacementByResourceTx(ctx, tx, companyID, resourceType, resourceID, true)
	exists := currentErr == nil
	if currentErr != nil && !errors.Is(currentErr, ErrNotFound) {
		return ProcessMapPlacementMutationResult{}, currentErr
	}
	parentChanged := !exists || !sameProcessMapLayer(current.MapParentFolderID, input.MapParentFolderID)
	if resourceType == domain.ProcessMapResourceTypeFolder && parentID != "" {
		var cycle bool
		if err := tx.QueryRowContext(ctx, `
with recursive ancestors(folder_id) as (
  select $3::uuid
  union
  select placement.map_parent_folder_id
  from process_map_placements placement
  join ancestors on placement.company_id=$1::uuid and placement.resource_type='company_explorer_folder' and placement.resource_id=ancestors.folder_id
  where placement.map_parent_folder_id is not null
)
select exists(select 1 from ancestors where folder_id=$2::uuid)`, companyID, resourceID, parentID).Scan(&cycle); err != nil {
			return ProcessMapPlacementMutationResult{}, err
		}
		if cycle {
			return ProcessMapPlacementMutationResult{}, ErrProcessMapCycle
		}
	}
	placement, err := scanProcessMapPlacement(tx.QueryRowContext(ctx, `
insert into process_map_placements(company_id,resource_type,resource_id,map_parent_folder_id,grid_x,grid_y,revision,created_timestamp,updated_timestamp)
values($1::uuid,$2,$3::uuid,nullif($4,'')::uuid,$5,$6,1,statement_timestamp(),statement_timestamp())
on conflict(company_id,resource_type,resource_id) do update
set map_parent_folder_id=excluded.map_parent_folder_id,grid_x=excluded.grid_x,grid_y=excluded.grid_y,
    revision=process_map_placements.revision+1,updated_timestamp=statement_timestamp()
returning company_id::text,resource_type,resource_id::text,map_parent_folder_id::text,grid_x,grid_y,revision,created_timestamp,updated_timestamp`, companyID, resourceType, resourceID, parentID, input.GridX, input.GridY))
	if err != nil {
		return ProcessMapPlacementMutationResult{}, err
	}
	if exists && parentChanged {
		if _, err := tx.ExecContext(ctx, `
delete from process_map_traces trace
using resource_operational_relationships relationship
where trace.company_id=$1::uuid and relationship.company_id=trace.company_id
  and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
  and ((relationship.source_resource_type=$2 and relationship.source_resource_id=$3::uuid)
    or (relationship.target_resource_type=$2 and relationship.target_resource_id=$3::uuid))`, companyID, resourceType, resourceID); err != nil {
			return ProcessMapPlacementMutationResult{}, err
		}
	}
	events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{processMapMutationEventInput(companyID, actorUserID, input.RealtimeConnectionID, ProcessMapPlacementSavedEvent, processMapResourceEventPayload(resourceType, resourceID))})
	if err != nil {
		return ProcessMapPlacementMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProcessMapPlacementMutationResult{}, err
	}
	return ProcessMapPlacementMutationResult{Placement: placement, Created: !exists, Events: events}, nil
}

func (r *PostgresRepo) DeleteProcessMapPlacement(input ProcessMapPlacementDeleteInput) (ProcessMapPlacementDeleteResult, error) {
	companyID, actorUserID, permissionUserID, err := normalizePostgresProcessMapMutation(input.CompanyID, input.ActorUserID, input.PermissionUserID)
	resourceType, typeOK := normalizeProcessMapResourceType(input.ResourceType)
	resourceID := cleanUUIDText(input.ResourceID)
	if err != nil || !typeOK || resourceID == "" {
		return ProcessMapPlacementDeleteResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessMapPlacementDeleteResult{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, false); err != nil {
		return ProcessMapPlacementDeleteResult{}, err
	}
	if err := postgresRequireProcessMapResourceTx(ctx, tx, companyID, resourceType, resourceID, permissionUserID); err != nil {
		return ProcessMapPlacementDeleteResult{}, err
	}
	if _, err := processMapPlacementByResourceTx(ctx, tx, companyID, resourceType, resourceID, true); err != nil {
		return ProcessMapPlacementDeleteResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from process_map_traces trace using resource_operational_relationships relationship
where trace.company_id=$1::uuid and relationship.company_id=trace.company_id and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
  and ((relationship.source_resource_type=$2 and relationship.source_resource_id=$3::uuid) or (relationship.target_resource_type=$2 and relationship.target_resource_id=$3::uuid))`, companyID, resourceType, resourceID); err != nil {
		return ProcessMapPlacementDeleteResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `delete from process_map_placements where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, resourceType, resourceID); err != nil {
		return ProcessMapPlacementDeleteResult{}, err
	}
	events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{processMapMutationEventInput(companyID, actorUserID, input.RealtimeConnectionID, ProcessMapPlacementDeletedEvent, processMapResourceEventPayload(resourceType, resourceID))})
	if err != nil {
		return ProcessMapPlacementDeleteResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProcessMapPlacementDeleteResult{}, err
	}
	return ProcessMapPlacementDeleteResult{Events: events}, nil
}

func sortProcessMapEndpoints(source, target domain.ProcessMapResourceRef) []domain.ProcessMapResourceRef {
	items := []domain.ProcessMapResourceRef{source, target}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ResourceType == items[j].ResourceType {
			return items[i].ResourceID < items[j].ResourceID
		}
		return items[i].ResourceType < items[j].ResourceType
	})
	return items
}

func postgresRequireProcessMapEndpointsTx(ctx context.Context, tx *sql.Tx, companyID, permissionUserID string, source, target domain.ProcessMapResourceRef) error {
	for _, endpoint := range sortProcessMapEndpoints(source, target) {
		if err := postgresRequireProcessMapResourceTx(ctx, tx, companyID, endpoint.ResourceType, endpoint.ResourceID, permissionUserID); err != nil {
			return err
		}
	}
	return nil
}

func processMapTraceByRelationshipTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID string, forUpdate bool) (domain.ProcessMapTrace, error) {
	lock := ""
	if forUpdate {
		lock = " for update"
	}
	return scanProcessMapTrace(tx.QueryRowContext(ctx, `
select company_id::text,resource_operational_relationship_id::text,route_points,revision,created_timestamp,updated_timestamp
from process_map_traces where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`+lock, companyID, relationshipID))
}

func validatePostgresProcessMapTraceEndpointsTx(ctx context.Context, tx *sql.Tx, companyID string, relationship domain.ResourceOperationalRelationship) error {
	placements := make([]domain.ProcessMapPlacement, 0, 2)
	for _, endpoint := range sortProcessMapEndpoints(relationship.Source, relationship.Target) {
		placement, err := processMapPlacementByResourceTx(ctx, tx, companyID, endpoint.ResourceType, endpoint.ResourceID, true)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				return ErrProcessMapLayerMismatch
			}
			return err
		}
		placements = append(placements, placement)
	}
	if len(placements) != 2 || !sameProcessMapLayer(placements[0].MapParentFolderID, placements[1].MapParentFolderID) {
		return ErrProcessMapLayerMismatch
	}
	return nil
}

func upsertPostgresProcessMapTraceTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID string, points []domain.ProcessMapRoutePoint) (domain.ProcessMapTrace, bool, error) {
	current, err := processMapTraceByRelationshipTx(ctx, tx, companyID, relationshipID, true)
	exists := err == nil
	if err != nil && !errors.Is(err, ErrNotFound) {
		return domain.ProcessMapTrace{}, false, err
	}
	if exists && processMapRoutePointsEqual(current.RoutePoints, points) {
		return current, false, nil
	}
	routeJSON, err := json.Marshal(points)
	if err != nil {
		return domain.ProcessMapTrace{}, false, err
	}
	if !exists {
		current, err = scanProcessMapTrace(tx.QueryRowContext(ctx, `
insert into process_map_traces(company_id,resource_operational_relationship_id,route_points,revision,created_timestamp,updated_timestamp)
values($1::uuid,$2::uuid,$3::jsonb,1,statement_timestamp(),statement_timestamp())
returning company_id::text,resource_operational_relationship_id::text,route_points,revision,created_timestamp,updated_timestamp`, companyID, relationshipID, string(routeJSON)))
	} else {
		current, err = scanProcessMapTrace(tx.QueryRowContext(ctx, `
update process_map_traces set route_points=$3::jsonb,revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid
returning company_id::text,resource_operational_relationship_id::text,route_points,revision,created_timestamp,updated_timestamp`, companyID, relationshipID, string(routeJSON)))
	}
	return current, true, err
}

func (r *PostgresRepo) CreateResourceOperationalRelationship(input ResourceOperationalRelationshipCreateInput) (ResourceOperationalRelationshipMutationResult, error) {
	companyID, actorUserID, permissionUserID, err := normalizePostgresProcessMapMutation(input.CompanyID, input.ActorUserID, input.PermissionUserID)
	sourceType, sourceOK := normalizeProcessMapResourceType(input.Source.ResourceType)
	targetType, targetOK := normalizeProcessMapResourceType(input.Target.ResourceType)
	input.Source = domain.ProcessMapResourceRef{ResourceType: sourceType, ResourceID: cleanUUIDText(input.Source.ResourceID)}
	input.Target = domain.ProcessMapResourceRef{ResourceType: targetType, ResourceID: cleanUUIDText(input.Target.ResourceID)}
	if err != nil || !sourceOK || !targetOK || input.Source.ResourceID == "" || input.Target.ResourceID == "" || input.Source == input.Target || (input.Trace != nil && !validProcessMapRoutePoints(input.Trace.RoutePoints)) {
		return ResourceOperationalRelationshipMutationResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ResourceOperationalRelationshipMutationResult{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, false); err != nil {
		return ResourceOperationalRelationshipMutationResult{}, err
	}
	if err := postgresRequireProcessMapEndpointsTx(ctx, tx, companyID, permissionUserID, input.Source, input.Target); err != nil {
		return ResourceOperationalRelationshipMutationResult{}, err
	}
	inserted, err := tx.ExecContext(ctx, `
insert into resource_operational_relationships(company_id,resource_operational_relationship_id,source_resource_type,source_resource_id,target_resource_type,target_resource_id,created_timestamp)
values($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::uuid,statement_timestamp())
on conflict(company_id,source_resource_type,source_resource_id,target_resource_type,target_resource_id) do nothing`, companyID, newUUIDv7String(), input.Source.ResourceType, input.Source.ResourceID, input.Target.ResourceType, input.Target.ResourceID)
	if err != nil {
		return ResourceOperationalRelationshipMutationResult{}, err
	}
	affected, err := inserted.RowsAffected()
	if err != nil {
		return ResourceOperationalRelationshipMutationResult{}, err
	}
	created := affected == 1
	relationship, err := scanResourceOperationalRelationship(tx.QueryRowContext(ctx, `
select company_id::text,resource_operational_relationship_id::text,source_resource_type,source_resource_id::text,target_resource_type,target_resource_id::text,created_timestamp
from resource_operational_relationships
where company_id=$1::uuid and source_resource_type=$2 and source_resource_id=$3::uuid and target_resource_type=$4 and target_resource_id=$5::uuid
for update`, companyID, input.Source.ResourceType, input.Source.ResourceID, input.Target.ResourceType, input.Target.ResourceID))
	if err != nil {
		return ResourceOperationalRelationshipMutationResult{}, err
	}
	result := ResourceOperationalRelationshipMutationResult{Relationship: relationship, RelationshipCreated: created}
	eventInputs := []DomainEventInput{}
	if created {
		eventInputs = append(eventInputs, processMapMutationEventInput(companyID, actorUserID, input.RealtimeConnectionID, ResourceOperationalRelationshipCreatedEvent, map[string]any{"resource_operational_relationship_id": relationship.ResourceOperationalRelationshipID}))
	}
	if input.Trace != nil {
		if err := validatePostgresProcessMapTraceEndpointsTx(ctx, tx, companyID, relationship); err != nil {
			return ResourceOperationalRelationshipMutationResult{}, err
		}
		trace, changed, err := upsertPostgresProcessMapTraceTx(ctx, tx, companyID, relationship.ResourceOperationalRelationshipID, input.Trace.RoutePoints)
		if err != nil {
			return ResourceOperationalRelationshipMutationResult{}, err
		}
		result.Trace = &trace
		result.TraceChanged = changed
		if changed {
			eventInputs = append(eventInputs, processMapMutationEventInput(companyID, actorUserID, input.RealtimeConnectionID, ProcessMapTraceSavedEvent, map[string]any{"resource_operational_relationship_id": relationship.ResourceOperationalRelationshipID}))
		}
	}
	result.Events, err = r.appendDomainEventsTx(ctx, tx, eventInputs)
	if err != nil {
		return ResourceOperationalRelationshipMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ResourceOperationalRelationshipMutationResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) PutProcessMapTrace(input ProcessMapTracePutInput) (ProcessMapTraceMutationResult, error) {
	companyID, actorUserID, permissionUserID, err := normalizePostgresProcessMapMutation(input.CompanyID, input.ActorUserID, input.PermissionUserID)
	relationshipID := cleanUUIDText(input.ResourceOperationalRelationshipID)
	if err != nil || relationshipID == "" || !validProcessMapRoutePoints(input.RoutePoints) {
		return ProcessMapTraceMutationResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessMapTraceMutationResult{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, false); err != nil {
		return ProcessMapTraceMutationResult{}, err
	}
	relationship, err := processMapRelationshipByIDTx(ctx, tx, companyID, relationshipID, false)
	if err != nil {
		return ProcessMapTraceMutationResult{}, err
	}
	if err := postgresRequireProcessMapEndpointsTx(ctx, tx, companyID, permissionUserID, relationship.Source, relationship.Target); err != nil {
		return ProcessMapTraceMutationResult{}, err
	}
	relationship, err = processMapRelationshipByIDTx(ctx, tx, companyID, relationshipID, true)
	if err != nil {
		return ProcessMapTraceMutationResult{}, err
	}
	if err := validatePostgresProcessMapTraceEndpointsTx(ctx, tx, companyID, relationship); err != nil {
		return ProcessMapTraceMutationResult{}, err
	}
	trace, changed, err := upsertPostgresProcessMapTraceTx(ctx, tx, companyID, relationshipID, input.RoutePoints)
	if err != nil {
		return ProcessMapTraceMutationResult{}, err
	}
	result := ProcessMapTraceMutationResult{Trace: trace, Changed: changed}
	if changed {
		result.Events, err = r.appendDomainEventsTx(ctx, tx, []DomainEventInput{processMapMutationEventInput(companyID, actorUserID, input.RealtimeConnectionID, ProcessMapTraceSavedEvent, map[string]any{"resource_operational_relationship_id": relationshipID})})
		if err != nil {
			return ProcessMapTraceMutationResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return ProcessMapTraceMutationResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) DeleteResourceOperationalRelationship(input ResourceOperationalRelationshipDeleteInput) (ResourceOperationalRelationshipDeleteResult, error) {
	companyID, actorUserID, permissionUserID, err := normalizePostgresProcessMapMutation(input.CompanyID, input.ActorUserID, input.PermissionUserID)
	relationshipID := cleanUUIDText(input.ResourceOperationalRelationshipID)
	if err != nil || relationshipID == "" {
		return ResourceOperationalRelationshipDeleteResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ResourceOperationalRelationshipDeleteResult{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, false); err != nil {
		return ResourceOperationalRelationshipDeleteResult{}, err
	}
	relationship, err := processMapRelationshipByIDTx(ctx, tx, companyID, relationshipID, false)
	if err != nil {
		return ResourceOperationalRelationshipDeleteResult{}, err
	}
	if err := postgresRequireProcessMapEndpointsTx(ctx, tx, companyID, permissionUserID, relationship.Source, relationship.Target); err != nil {
		return ResourceOperationalRelationshipDeleteResult{}, err
	}
	if _, err := processMapRelationshipByIDTx(ctx, tx, companyID, relationshipID, true); err != nil {
		return ResourceOperationalRelationshipDeleteResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `delete from resource_operational_relationships where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`, companyID, relationshipID); err != nil {
		return ResourceOperationalRelationshipDeleteResult{}, err
	}
	events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{processMapMutationEventInput(companyID, actorUserID, input.RealtimeConnectionID, ResourceOperationalRelationshipDeletedEvent, map[string]any{"resource_operational_relationship_id": relationshipID})})
	if err != nil {
		return ResourceOperationalRelationshipDeleteResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ResourceOperationalRelationshipDeleteResult{}, err
	}
	return ResourceOperationalRelationshipDeleteResult{Events: events}, nil
}

// postgresDeleteProcessMapResourceTx is the one typed permanent-source cleanup
// path. Folder-owned child placements lose geometry, while their operational
// relationships remain because those endpoint resources still exist.
func postgresDeleteProcessMapResourceTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	var locked int
	var err error
	switch resourceType {
	case domain.ProcessMapResourceTypeFolder:
		err = tx.QueryRowContext(ctx, `select 1 from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid for update`, companyID, resourceID).Scan(&locked)
	case domain.ProcessMapResourceTypeProcess:
		err = tx.QueryRowContext(ctx, `select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid for update`, companyID, resourceID).Scan(&locked)
	default:
		return ErrInvalid
	}
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if resourceType == domain.ProcessMapResourceTypeFolder {
		if _, err := tx.ExecContext(ctx, `
delete from process_map_traces trace using resource_operational_relationships relationship
where trace.company_id=$1::uuid and relationship.company_id=trace.company_id and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
  and (exists(select 1 from process_map_placements placement where placement.company_id=$1::uuid and placement.map_parent_folder_id=$2::uuid and placement.resource_type=relationship.source_resource_type and placement.resource_id=relationship.source_resource_id)
    or exists(select 1 from process_map_placements placement where placement.company_id=$1::uuid and placement.map_parent_folder_id=$2::uuid and placement.resource_type=relationship.target_resource_type and placement.resource_id=relationship.target_resource_id))`, companyID, resourceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `delete from process_map_placements where company_id=$1::uuid and map_parent_folder_id=$2::uuid`, companyID, resourceID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `delete from process_map_placements where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, resourceType, resourceID); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
delete from resource_operational_relationships
where company_id=$1::uuid and ((source_resource_type=$2 and source_resource_id=$3::uuid) or (target_resource_type=$2 and target_resource_id=$3::uuid))`, companyID, resourceType, resourceID)
	return err
}
