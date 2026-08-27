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
	err := row.Scan(
		&item.CompanyID, &item.ResourceType, &item.ResourceID, &parentID,
		&item.GridX, &item.GridY, &item.GridWidth, &item.GridHeight,
		&item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp,
	)
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

func processMapVersionsQueryRow(row interface{ Scan(...any) error }) (int64, int64, error) {
	var processVersion, permissionVersion int64
	err := row.Scan(&processVersion, &permissionVersion)
	return processVersion, permissionVersion, err
}

func (r *PostgresRepo) CurrentProcessMapVersions(ctx context.Context, companyID string) (int64, int64, error) {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return 0, 0, ErrInvalid
	}
	return processMapVersionsQueryRow(r.db.QueryRowContext(ctx, `
select
  coalesce(max(version) filter (where scope='process-map' and resource_key=''),0),
  coalesce(max(version) filter (where scope='policy-group-membership' and resource_key=''),0)
from workspace_read_versions
where company_id=$1::uuid
  and scope in ('process-map','policy-group-membership')`, companyID))
}

func processMapVersionsTx(ctx context.Context, tx *sql.Tx, companyID string) (int64, int64, error) {
	return processMapVersionsQueryRow(tx.QueryRowContext(ctx, `
select
  coalesce(max(version) filter (where scope='process-map' and resource_key=''),0),
  coalesce(max(version) filter (where scope='policy-group-membership' and resource_key=''),0)
from workspace_read_versions
where company_id=$1::uuid
  and scope in ('process-map','policy-group-membership')`, companyID))
}

func postgresRequireProcessMapMembershipTx(ctx context.Context, tx *sql.Tx, companyID, permissionUserID string) error {
	var allowed bool
	if err := tx.QueryRowContext(ctx, `
select exists (
  select 1 from company_memberships membership
  where membership.user_id=$2::uuid
    and (membership.company_id=$1::uuid or membership.role='dev_admin')
)`, companyID, permissionUserID).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return ErrNotFound
	}
	return nil
}

func normalizePostgresProcessMapRead(companyID, permissionUserID string) (string, string, error) {
	companyID = cleanUUIDText(companyID)
	permissionUserID = cleanUUIDText(permissionUserID)
	if companyID == "" || permissionUserID == "" {
		return "", "", ErrInvalid
	}
	return companyID, permissionUserID, nil
}

func (r *PostgresRepo) GetProcessMapScene(ctx context.Context, input ProcessMapSceneQuery) (domain.ProcessMapScene, error) {
	companyID, permissionUserID, err := normalizePostgresProcessMapRead(input.CompanyID, input.PermissionUserID)
	if err != nil {
		return domain.ProcessMapScene{}, err
	}
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return domain.ProcessMapScene{}, err
	}
	defer tx.Rollback()
	if err := postgresRequireProcessMapMembershipTx(ctx, tx, companyID, permissionUserID); err != nil {
		return domain.ProcessMapScene{}, err
	}
	var minX, minY, maxX, maxY sql.NullInt64
	err = tx.QueryRowContext(ctx, `
select min(placement.grid_x),min(placement.grid_y),
       max(placement.grid_x + case when allowed then placement.grid_width else $3 end),
       max(placement.grid_y + case when allowed then placement.grid_height else $4 end)
from (
  select placement.*,
         mangorts_user_can_access_resource(placement.company_id,placement.resource_type,placement.resource_id,$2::uuid,'edit') allowed
  from process_map_placements placement
  left join company_explorer_folders folder
    on placement.resource_type='company_explorer_folder'
   and folder.company_id=placement.company_id and folder.folder_id=placement.resource_id
  left join logic_gates process
    on placement.resource_type='logic_gate'
   and process.company_id=placement.company_id and process.logic_gate_id=placement.resource_id
  where placement.company_id=$1::uuid
    and ((placement.resource_type='company_explorer_folder' and folder.folder_id is not null)
      or (placement.resource_type='logic_gate' and process.logic_gate_id is not null))
) placement`, companyID, permissionUserID, ProcessMapRestrictedWidth, ProcessMapRestrictedHeight).Scan(&minX, &minY, &maxX, &maxY)
	if err != nil {
		return domain.ProcessMapScene{}, err
	}
	processVersion, _, err := processMapVersionsTx(ctx, tx, companyID)
	if err != nil {
		return domain.ProcessMapScene{}, err
	}
	result := domain.ProcessMapScene{
		ProcessMapReadVersion: processVersion, TileSize: ProcessMapTileSize,
		MinTileZoom: ProcessMapMinTileZoom, MaxTileZoom: ProcessMapMaxTileZoom,
	}
	if minX.Valid && minY.Valid && maxX.Valid && maxY.Valid {
		result.Bounds = &domain.ProcessMapBounds{MinX: int(minX.Int64), MinY: int(minY.Int64), MaxX: int(maxX.Int64), MaxY: int(maxY.Int64)}
	}
	if err := tx.Commit(); err != nil {
		return domain.ProcessMapScene{}, err
	}
	return result, nil
}

func (r *PostgresRepo) GetProcessMapTile(ctx context.Context, input ProcessMapTileQuery) (domain.ProcessMapTile, error) {
	companyID, permissionUserID, err := normalizePostgresProcessMapRead(input.CompanyID, input.PermissionUserID)
	if err != nil {
		return domain.ProcessMapTile{}, err
	}
	tileBounds, ok := processMapTileBounds(input.Z, input.X, input.Y)
	if !ok {
		return domain.ProcessMapTile{}, ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return domain.ProcessMapTile{}, err
	}
	defer tx.Rollback()
	if err := postgresRequireProcessMapMembershipTx(ctx, tx, companyID, permissionUserID); err != nil {
		return domain.ProcessMapTile{}, err
	}
	processVersion, _, err := processMapVersionsTx(ctx, tx, companyID)
	if err != nil {
		return domain.ProcessMapTile{}, err
	}
	result := domain.ProcessMapTile{
		Z: input.Z, X: input.X, Y: input.Y, ProcessMapReadVersion: processVersion,
		Placements: []domain.ProcessMapTilePlacement{}, Traces: []domain.ProcessMapTileTrace{},
	}
	editingZoomExponent := input.Z - ProcessMapMaxTileZoom
	if input.Z == ProcessMapMaxTileZoom {
		editingZoomExponent = ProcessMapMaxCameraZoom
	}
	rows, err := tx.QueryContext(ctx, `
with base as (
  select placement.*,
         case placement.resource_type when 'company_explorer_folder' then folder.name else process.header end resource_name,
         mangorts_user_can_access_resource(placement.company_id,placement.resource_type,placement.resource_id,$2::uuid,'edit') allowed,
         case when placement.map_parent_folder_id is null then true else
           mangorts_user_can_access_resource(placement.company_id,'company_explorer_folder',placement.map_parent_folder_id,$2::uuid,'edit') end parent_allowed
  from process_map_placements placement
  left join company_explorer_folders folder
    on placement.resource_type='company_explorer_folder'
   and folder.company_id=placement.company_id and folder.folder_id=placement.resource_id
  left join logic_gates process
    on placement.resource_type='logic_gate'
   and process.company_id=placement.company_id and process.logic_gate_id=placement.resource_id
  where placement.company_id=$1::uuid
    and ((placement.resource_type='company_explorer_folder' and folder.folder_id is not null)
      or (placement.resource_type='logic_gate' and process.logic_gate_id is not null))
), candidate as (
  select placement.*
  from base placement
  where (placement.allowed
    and box(
        point(placement.grid_x::double precision,placement.grid_y::double precision),
        point((placement.grid_x::bigint+placement.grid_width)::double precision,(placement.grid_y::bigint+placement.grid_height)::double precision)
      ) && box(point($3::double precision,$4::double precision),point($5::double precision,$6::double precision))
    and placement.grid_x < $5 and placement.grid_x::bigint+placement.grid_width > $3
    and placement.grid_y < $6 and placement.grid_y::bigint+placement.grid_height > $4)
   or (not placement.allowed
    and placement.grid_x < $5 and placement.grid_x::bigint+$7 > $3
    and placement.grid_y < $6 and placement.grid_y::bigint+$8 > $4)
), enriched as (
  select candidate.*,
         score_card.quality_rating,score_card.cost_rating,score_card.delivery_rating,
         coalesce(raci.responsible_names,'[]'::jsonb)::text responsible_names,
         coalesce(raci.accountable_names,'[]'::jsonb)::text accountable_names
  from candidate
  left join score_cards score_card
    on candidate.allowed and candidate.resource_type='logic_gate'
   and least(candidate.grid_width,candidate.grid_height)::double precision
       * power(2::double precision,$9::integer) >= $10::double precision
   and score_card.company_id=candidate.company_id and score_card.logic_gate_id=candidate.resource_id
   and (score_card.rated_created_timestamp at time zone 'America/Los_Angeles')::date =
       (statement_timestamp() at time zone 'America/Los_Angeles')::date
  left join lateral (
    select
      coalesce(jsonb_agg(distinct assignment_name order by assignment_name)
        filter (where assignment_role='responsible'),'[]'::jsonb) responsible_names,
      coalesce(jsonb_agg(distinct assignment_name order by assignment_name)
        filter (where assignment_role='accountable'),'[]'::jsonb) accountable_names
    from (
      select assignment.role assignment_role,
             coalesce(
               nullif(btrim(user_group.name),''),
               nullif(btrim(app_user.display_name),''),
               nullif(btrim(app_user.email),''),
               'Unknown principal'
             ) assignment_name
      from mangorts_v2_resolve_gvic_policy(candidate.company_id,'logic_gate',candidate.resource_id) resolved
      join resource_gvic_assignments assignment
        on assignment.company_id=candidate.company_id
       and assignment.resource_type=resolved.source_resource_type
       and assignment.resource_id=resolved.source_resource_id
      left join company_memberships membership
        on assignment.principal_type='user'
       and membership.company_id=assignment.company_id
       and membership.user_id=assignment.principal_id
      left join users app_user
        on assignment.principal_type='user'
       and app_user.user_id=assignment.principal_id
      left join company_user_groups user_group
        on assignment.principal_type='group'
       and user_group.company_id=assignment.company_id
       and user_group.group_id=assignment.principal_id
      where assignment.role in ('responsible','accountable')
        and (
          (assignment.principal_type='user' and membership.user_id is not null)
          or (assignment.principal_type='group' and user_group.group_id is not null)
        )
    ) assignment_names
  ) raci on candidate.allowed and candidate.resource_type='logic_gate'
    and least(candidate.grid_width,candidate.grid_height)::double precision
        * power(2::double precision,$9::integer) >= $10::double precision
)
select placement.company_id::text,placement.resource_type,placement.resource_id::text,
       placement.map_parent_folder_id::text,placement.grid_x,placement.grid_y,
       placement.grid_width,placement.grid_height,placement.revision,
       placement.created_timestamp,placement.updated_timestamp,
       placement.resource_name,placement.allowed,placement.parent_allowed,
       placement.quality_rating,placement.cost_rating,placement.delivery_rating,
       placement.responsible_names,placement.accountable_names
from enriched placement
order by placement.grid_y,placement.grid_x,placement.resource_type,placement.resource_id`,
		companyID, permissionUserID, tileBounds.MinX, tileBounds.MinY, tileBounds.MaxX, tileBounds.MaxY,
		ProcessMapRestrictedWidth, ProcessMapRestrictedHeight,
		editingZoomExponent, ProcessMapEditingLODMinPX)
	if err != nil {
		return domain.ProcessMapTile{}, err
	}
	for rows.Next() {
		var placement domain.ProcessMapPlacement
		var parentID, name, qualityRating, costRating, deliveryRating sql.NullString
		var responsibleNamesJSON, accountableNamesJSON string
		var allowed, parentAllowed bool
		if err := rows.Scan(
			&placement.CompanyID, &placement.ResourceType, &placement.ResourceID, &parentID,
			&placement.GridX, &placement.GridY, &placement.GridWidth, &placement.GridHeight,
			&placement.Revision, &placement.CreatedTimestamp, &placement.UpdatedTimestamp,
			&name, &allowed, &parentAllowed,
			&qualityRating, &costRating, &deliveryRating,
			&responsibleNamesJSON, &accountableNamesJSON,
		); err != nil {
			rows.Close()
			return domain.ProcessMapTile{}, err
		}
		if !allowed {
			restrictedBounds := domain.ProcessMapBounds{MinX: placement.GridX, MinY: placement.GridY, MaxX: placement.GridX + ProcessMapRestrictedWidth, MaxY: placement.GridY + ProcessMapRestrictedHeight}
			if processMapBoundsIntersect(restrictedBounds, tileBounds) {
				result.Placements = append(result.Placements, domain.ProcessMapRestrictedPlacement{Restricted: true, GridX: placement.GridX, GridY: placement.GridY})
			}
			continue
		}
		if parentID.Valid && parentAllowed {
			placement.MapParentFolderID = &parentID.String
		}
		presentation := processMapPlacementPresentationAtTileZoom(placement.GridWidth, placement.GridHeight, input.Z)
		visibleName := name.String
		if presentation == domain.ProcessMapPresentationWhole {
			visibleName = ""
		}
		visible := domain.ProcessMapVisiblePlacement{
			Restricted: false, Presentation: presentation, ResourceType: placement.ResourceType, ResourceID: placement.ResourceID, Name: visibleName,
			MapParentFolderID: placement.MapParentFolderID, GridX: placement.GridX, GridY: placement.GridY,
			GridWidth: placement.GridWidth, GridHeight: placement.GridHeight, Revision: placement.Revision,
			CreatedTimestamp: placement.CreatedTimestamp, UpdatedTimestamp: placement.UpdatedTimestamp, CanEdit: true,
		}
		if placement.ResourceType == domain.ProcessMapResourceTypeProcess && presentation == domain.ProcessMapPresentationEditing {
			if qualityRating.Valid || costRating.Valid || deliveryRating.Valid {
				visible.ScoreCard = &domain.ProcessMapScoreCardSummary{}
				if qualityRating.Valid {
					visible.ScoreCard.QualityRating = &qualityRating.String
				}
				if costRating.Valid {
					visible.ScoreCard.CostRating = &costRating.String
				}
				if deliveryRating.Valid {
					visible.ScoreCard.DeliveryRating = &deliveryRating.String
				}
			}
			if err := json.Unmarshal([]byte(responsibleNamesJSON), &visible.ResponsibleNames); err != nil {
				rows.Close()
				return domain.ProcessMapTile{}, err
			}
			if err := json.Unmarshal([]byte(accountableNamesJSON), &visible.AccountableNames); err != nil {
				rows.Close()
				return domain.ProcessMapTile{}, err
			}
		}
		result.Placements = append(result.Placements, visible)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return domain.ProcessMapTile{}, err
	}
	if err := rows.Close(); err != nil {
		return domain.ProcessMapTile{}, err
	}

	traceRows, err := tx.QueryContext(ctx, `
select relationship.company_id::text,relationship.resource_operational_relationship_id::text,
       relationship.source_resource_type,relationship.source_resource_id::text,
       relationship.target_resource_type,relationship.target_resource_id::text,
       trace.route_points,trace.revision,trace.created_timestamp,trace.updated_timestamp,
       source_placement.grid_x,source_placement.grid_y,source_placement.grid_width,source_placement.grid_height,
       target_placement.grid_x,target_placement.grid_y,target_placement.grid_width,target_placement.grid_height
from process_map_traces trace
join resource_operational_relationships relationship
  on relationship.company_id=trace.company_id and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
join process_map_placements source_placement
  on source_placement.company_id=relationship.company_id and source_placement.resource_type=relationship.source_resource_type and source_placement.resource_id=relationship.source_resource_id
join process_map_placements target_placement
  on target_placement.company_id=relationship.company_id and target_placement.resource_type=relationship.target_resource_type and target_placement.resource_id=relationship.target_resource_id
cross join lateral (
  select min(point_x) min_x,min(point_y) min_y,max(point_x) max_x,max(point_y) max_y
  from (
    select (source_placement.grid_x+source_placement.grid_width)::double precision point_x,
           (source_placement.grid_y::double precision+source_placement.grid_height::double precision/2) point_y
    union all
    select target_placement.grid_x::double precision,
           (target_placement.grid_y::double precision+target_placement.grid_height::double precision/2)
    union all
    select (point->>'x')::double precision,(point->>'y')::double precision
    from jsonb_array_elements(trace.route_points) point
  ) path_point
) path_bounds
where trace.company_id=$1::uuid
  and path_bounds.min_x < $5 and path_bounds.max_x >= $3
  and path_bounds.min_y < $6 and path_bounds.max_y >= $4
  and mangorts_user_can_access_resource(relationship.company_id,relationship.source_resource_type,relationship.source_resource_id,$2::uuid,'edit')
  and mangorts_user_can_access_resource(relationship.company_id,relationship.target_resource_type,relationship.target_resource_id,$2::uuid,'edit')
order by relationship.resource_operational_relationship_id`,
		companyID, permissionUserID, tileBounds.MinX, tileBounds.MinY, tileBounds.MaxX, tileBounds.MaxY)
	if err != nil {
		return domain.ProcessMapTile{}, err
	}
	defer traceRows.Close()
	for traceRows.Next() {
		var relationship domain.ResourceOperationalRelationship
		var trace domain.ProcessMapTrace
		var routeJSON []byte
		var source, target domain.ProcessMapPlacement
		if err := traceRows.Scan(
			&relationship.CompanyID, &relationship.ResourceOperationalRelationshipID,
			&relationship.Source.ResourceType, &relationship.Source.ResourceID,
			&relationship.Target.ResourceType, &relationship.Target.ResourceID,
			&routeJSON, &trace.Revision, &trace.CreatedTimestamp, &trace.UpdatedTimestamp,
			&source.GridX, &source.GridY, &source.GridWidth, &source.GridHeight,
			&target.GridX, &target.GridY, &target.GridWidth, &target.GridHeight,
		); err != nil {
			return domain.ProcessMapTile{}, err
		}
		trace.CompanyID = relationship.CompanyID
		trace.ResourceOperationalRelationshipID = relationship.ResourceOperationalRelationshipID
		if err := json.Unmarshal(routeJSON, &trace.RoutePoints); err != nil {
			return domain.ProcessMapTile{}, err
		}
		if trace.RoutePoints == nil {
			trace.RoutePoints = []domain.ProcessMapRoutePoint{}
		}
		fragments := processMapClipPath(processMapTracePath(source, target, trace.RoutePoints), tileBounds)
		if len(fragments) == 0 {
			continue
		}
		presentation := processMapMaxPresentation(
			processMapPlacementPresentationAtTileZoom(source.GridWidth, source.GridHeight, input.Z),
			processMapPlacementPresentationAtTileZoom(target.GridWidth, target.GridHeight, input.Z),
		)
		routePoints := []domain.ProcessMapRoutePoint{}
		if presentation == domain.ProcessMapPresentationEditing {
			routePoints = trace.RoutePoints
		}
		result.Traces = append(result.Traces, domain.ProcessMapTileTrace{
			ResourceOperationalRelationshipID: relationship.ResourceOperationalRelationshipID,
			Presentation:                      presentation,
			Source:                            relationship.Source, Target: relationship.Target, RoutePoints: routePoints,
			PathFragments: fragments, Revision: trace.Revision,
			CreatedTimestamp: trace.CreatedTimestamp, UpdatedTimestamp: trace.UpdatedTimestamp,
		})
	}
	if err := traceRows.Err(); err != nil {
		return domain.ProcessMapTile{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.ProcessMapTile{}, err
	}
	return result, nil
}

func (r *PostgresRepo) ListResourceOperationalRelationshipsForResource(ctx context.Context, input ResourceOperationalRelationshipQuery) ([]domain.ResourceOperationalRelationship, error) {
	resourceType, typeOK := normalizeProcessMapResourceType(input.ResourceType)
	direction, directionOK := normalizeProcessMapDirection(input.Direction)
	companyID, resourceID, permissionUserID, err := normalizePostgresProcessMapQueryIDs(input.CompanyID, input.ResourceID, input.PermissionUserID)
	if err != nil || !typeOK || !directionOK {
		return nil, ErrInvalid
	}
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
select company_id::text,resource_type,resource_id::text,map_parent_folder_id::text,
       grid_x,grid_y,grid_width,grid_height,revision,created_timestamp,updated_timestamp
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

func processMapTraceByRelationshipTx(ctx context.Context, tx *sql.Tx, companyID, relationshipID string, forUpdate bool) (domain.ProcessMapTrace, error) {
	lock := ""
	if forUpdate {
		lock = " for update"
	}
	return scanProcessMapTrace(tx.QueryRowContext(ctx, `
select company_id::text,resource_operational_relationship_id::text,route_points,revision,created_timestamp,updated_timestamp
from process_map_traces where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`+lock, companyID, relationshipID))
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

func postgresRequireMappedProcessMapParentTx(ctx context.Context, tx *sql.Tx, companyID, parentID, permissionUserID string) (domain.ProcessMapPlacement, error) {
	if err := postgresRequireProcessMapResourceTx(ctx, tx, companyID, domain.ProcessMapResourceTypeFolder, parentID, permissionUserID); err != nil {
		return domain.ProcessMapPlacement{}, err
	}
	return processMapPlacementByResourceTx(ctx, tx, companyID, domain.ProcessMapResourceTypeFolder, parentID, true)
}

func postgresProcessMapDescendantsTx(ctx context.Context, tx *sql.Tx, companyID, folderID string, forUpdate bool) ([]domain.ProcessMapPlacement, error) {
	lock := ""
	if forUpdate {
		lock = " for update of placement"
	}
	rows, err := tx.QueryContext(ctx, `
with recursive descendants(resource_type,resource_id,depth,path,cycle) as (
  select placement.resource_type,placement.resource_id,1,array[$2::uuid,placement.resource_id],placement.resource_id=$2::uuid
  from process_map_placements placement
  where placement.company_id=$1::uuid and placement.map_parent_folder_id=$2::uuid
  union all
  select placement.resource_type,placement.resource_id,descendants.depth+1,
         descendants.path || placement.resource_id,placement.resource_id=any(descendants.path)
  from descendants
  join process_map_placements placement
    on placement.company_id=$1::uuid
   and descendants.resource_type='company_explorer_folder'
   and placement.map_parent_folder_id=descendants.resource_id
  where not descendants.cycle and descendants.depth<1000
)
select placement.company_id::text,placement.resource_type,placement.resource_id::text,placement.map_parent_folder_id::text,
       placement.grid_x,placement.grid_y,placement.grid_width,placement.grid_height,
       placement.revision,placement.created_timestamp,placement.updated_timestamp,
       descendants.depth,descendants.cycle
from descendants
join process_map_placements placement
  on placement.company_id=$1::uuid and placement.resource_type=descendants.resource_type and placement.resource_id=descendants.resource_id
order by descendants.depth,placement.resource_type,placement.resource_id`+lock, companyID, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.ProcessMapPlacement{}
	for rows.Next() {
		var item domain.ProcessMapPlacement
		var parentID sql.NullString
		var depth int
		var cycle bool
		if err := rows.Scan(&item.CompanyID, &item.ResourceType, &item.ResourceID, &parentID,
			&item.GridX, &item.GridY, &item.GridWidth, &item.GridHeight,
			&item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp, &depth, &cycle); err != nil {
			return nil, err
		}
		if cycle || depth >= 1000 {
			return nil, ErrProcessMapCycle
		}
		if parentID.Valid {
			item.MapParentFolderID = &parentID.String
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresProcessMapFolderCycleTx(ctx context.Context, tx *sql.Tx, companyID, folderID, parentID string) (bool, error) {
	if parentID == "" {
		return false, nil
	}
	var cycle bool
	err := tx.QueryRowContext(ctx, `
with recursive ancestors(folder_id,path,cycle) as (
  select $3::uuid,array[$3::uuid],$3::uuid=$2::uuid
  union all
  select placement.map_parent_folder_id,ancestors.path || placement.map_parent_folder_id,
         placement.map_parent_folder_id=any(ancestors.path)
  from ancestors
  join process_map_placements placement
    on placement.company_id=$1::uuid and placement.resource_type='company_explorer_folder' and placement.resource_id=ancestors.folder_id
  where placement.map_parent_folder_id is not null and not ancestors.cycle and cardinality(ancestors.path)<1000
)
select exists(select 1 from ancestors where folder_id=$2::uuid or cycle)`, companyID, folderID, parentID).Scan(&cycle)
	return cycle, err
}

func postgresUpdateProcessMapPlacementTx(ctx context.Context, tx *sql.Tx, item domain.ProcessMapPlacement) (domain.ProcessMapPlacement, error) {
	parentID := ""
	if item.MapParentFolderID != nil {
		parentID = *item.MapParentFolderID
	}
	return scanProcessMapPlacement(tx.QueryRowContext(ctx, `
update process_map_placements
set map_parent_folder_id=nullif($4,'')::uuid,grid_x=$5,grid_y=$6,grid_width=$7,grid_height=$8,
    revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid
returning company_id::text,resource_type,resource_id::text,map_parent_folder_id::text,
          grid_x,grid_y,grid_width,grid_height,revision,created_timestamp,updated_timestamp`,
		item.CompanyID, item.ResourceType, item.ResourceID, parentID, item.GridX, item.GridY, item.GridWidth, item.GridHeight))
}

func postgresInsertProcessMapPlacementTx(ctx context.Context, tx *sql.Tx, item domain.ProcessMapPlacement) (domain.ProcessMapPlacement, error) {
	parentID := ""
	if item.MapParentFolderID != nil {
		parentID = *item.MapParentFolderID
	}
	return scanProcessMapPlacement(tx.QueryRowContext(ctx, `
insert into process_map_placements(company_id,resource_type,resource_id,map_parent_folder_id,grid_x,grid_y,grid_width,grid_height,revision,created_timestamp,updated_timestamp)
values($1::uuid,$2,$3::uuid,nullif($4,'')::uuid,$5,$6,$7,$8,1,statement_timestamp(),statement_timestamp())
returning company_id::text,resource_type,resource_id::text,map_parent_folder_id::text,
          grid_x,grid_y,grid_width,grid_height,revision,created_timestamp,updated_timestamp`,
		item.CompanyID, item.ResourceType, item.ResourceID, parentID, item.GridX, item.GridY, item.GridWidth, item.GridHeight))
}

const (
	postgresAutomaticProcessMapRootFolderWidth    = 120
	postgresAutomaticProcessMapRootFolderHeight   = 80
	postgresAutomaticProcessMapNestedFolderWidth  = 80
	postgresAutomaticProcessMapNestedFolderHeight = 50
	postgresAutomaticProcessMapProcessWidth       = 14
	postgresAutomaticProcessMapProcessHeight      = 8
	postgresAutomaticProcessMapPadding            = 2
	postgresAutomaticProcessMapGap                = 2
	postgresAutomaticProcessMapRootGap            = 8
)

func postgresProcessMapParentMatches(item domain.ProcessMapPlacement, parentID string) bool {
	if item.MapParentFolderID == nil {
		return parentID == ""
	}
	return *item.MapParentFolderID == parentID
}

func postgresAutomaticProcessMapPositionTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, resourceType, resourceID, parentID string,
) (int, int, error) {
	if parentID == "" {
		var nextX int64
		if err := tx.QueryRowContext(ctx, `
select coalesce(max(grid_x::bigint+grid_width),$4::bigint*-1)+$4
from process_map_placements
where company_id=$1::uuid and map_parent_folder_id is null
  and not (resource_type=$2 and resource_id=$3::uuid)`,
			companyID, resourceType, resourceID, postgresAutomaticProcessMapRootGap).Scan(&nextX); err != nil {
			return 0, 0, err
		}
		if nextX < ProcessMapMinCoordinate || nextX > ProcessMapMaxCoordinate {
			return 0, 0, ErrInvalid
		}
		return int(nextX), 0, nil
	}
	parent, err := processMapPlacementByResourceTx(ctx, tx, companyID, domain.ProcessMapResourceTypeFolder, parentID, true)
	if err != nil {
		return 0, 0, err
	}
	var nextY int64
	if err := tx.QueryRowContext(ctx, `
select coalesce(max(grid_y::bigint+grid_height),$4::bigint)+$5
from process_map_placements
where company_id=$1::uuid and map_parent_folder_id=$6::uuid
  and not (resource_type=$2 and resource_id=$3::uuid)`,
		companyID, resourceType, resourceID, parent.GridY, postgresAutomaticProcessMapGap, parentID).Scan(&nextY); err != nil {
		return 0, 0, err
	}
	nextX := int64(parent.GridX) + postgresAutomaticProcessMapPadding
	if nextX < ProcessMapMinCoordinate || nextX > ProcessMapMaxCoordinate || nextY < ProcessMapMinCoordinate || nextY > ProcessMapMaxCoordinate {
		return 0, 0, ErrInvalid
	}
	return int(nextX), int(nextY), nil
}

func postgresExpandAutomaticProcessMapAncestorsTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, parentID string,
	child domain.ProcessMapPlacement,
) error {
	for parentID != "" {
		parent, err := processMapPlacementByResourceTx(ctx, tx, companyID, domain.ProcessMapResourceTypeFolder, parentID, true)
		if err != nil {
			return err
		}
		requiredWidth := int64(child.GridX) + int64(child.GridWidth) - int64(parent.GridX) + postgresAutomaticProcessMapPadding
		requiredHeight := int64(child.GridY) + int64(child.GridHeight) - int64(parent.GridY) + postgresAutomaticProcessMapPadding
		changed := false
		if requiredWidth > int64(parent.GridWidth) {
			if requiredWidth > ProcessMapMaxDimension {
				return ErrInvalid
			}
			parent.GridWidth = int(requiredWidth)
			changed = true
		}
		if requiredHeight > int64(parent.GridHeight) {
			if requiredHeight > ProcessMapMaxDimension {
				return ErrInvalid
			}
			parent.GridHeight = int(requiredHeight)
			changed = true
		}
		if changed {
			parent, err = postgresUpdateProcessMapPlacementTx(ctx, tx, parent)
			if err != nil {
				return err
			}
		}
		child = parent
		if parent.MapParentFolderID == nil {
			parentID = ""
		} else {
			parentID = *parent.MapParentFolderID
		}
	}
	return nil
}

// postgresSyncAutomaticProcessMapPlacementTx maintains the Process Map as a
// projection of Company Explorer parentage. It never creates operational
// relationships or traces.
func postgresSyncAutomaticProcessMapPlacementTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, resourceType, resourceID, parentID string,
) (bool, error) {
	if err := postgresLockProcessMapCompanyTx(ctx, tx, companyID); err != nil {
		return false, err
	}
	if parentID != "" {
		if _, err := processMapPlacementByResourceTx(ctx, tx, companyID, domain.ProcessMapResourceTypeFolder, parentID, true); err != nil {
			return false, err
		}
	}
	current, currentErr := processMapPlacementByResourceTx(ctx, tx, companyID, resourceType, resourceID, true)
	exists := currentErr == nil
	if currentErr != nil && !errors.Is(currentErr, ErrNotFound) {
		return false, currentErr
	}
	if exists && postgresProcessMapParentMatches(current, parentID) {
		return false, nil
	}

	gridX, gridY, err := postgresAutomaticProcessMapPositionTx(ctx, tx, companyID, resourceType, resourceID, parentID)
	if err != nil {
		return false, err
	}
	target := current
	if !exists {
		target = domain.ProcessMapPlacement{
			CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID,
			GridWidth: postgresAutomaticProcessMapProcessWidth, GridHeight: postgresAutomaticProcessMapProcessHeight,
		}
		if resourceType == domain.ProcessMapResourceTypeFolder {
			target.GridWidth = postgresAutomaticProcessMapNestedFolderWidth
			target.GridHeight = postgresAutomaticProcessMapNestedFolderHeight
			if parentID == "" {
				target.GridWidth = postgresAutomaticProcessMapRootFolderWidth
				target.GridHeight = postgresAutomaticProcessMapRootFolderHeight
			}
		}
	}
	if resourceType == domain.ProcessMapResourceTypeFolder && parentID == "" {
		if target.GridWidth < postgresAutomaticProcessMapRootFolderWidth {
			target.GridWidth = postgresAutomaticProcessMapRootFolderWidth
		}
		if target.GridHeight < postgresAutomaticProcessMapRootFolderHeight {
			target.GridHeight = postgresAutomaticProcessMapRootFolderHeight
		}
	}
	if parentID == "" {
		target.MapParentFolderID = nil
	} else {
		parentCopy := parentID
		target.MapParentFolderID = &parentCopy
	}
	target.GridX, target.GridY = gridX, gridY
	if !validProcessMapGeometry(target.GridX, target.GridY, target.GridWidth, target.GridHeight) {
		return false, ErrInvalid
	}

	descendants := []domain.ProcessMapPlacement{}
	internalTraces := []domain.ProcessMapTrace{}
	deltaX, deltaY := 0, 0
	if exists && resourceType == domain.ProcessMapResourceTypeFolder {
		deltaX, deltaY = target.GridX-current.GridX, target.GridY-current.GridY
		descendants, err = postgresProcessMapDescendantsTx(ctx, tx, companyID, resourceID, true)
		if err != nil {
			return false, err
		}
		moved := []domain.ProcessMapResourceRef{{ResourceType: resourceType, ResourceID: resourceID}}
		for _, descendant := range descendants {
			if !validProcessMapGeometry(descendant.GridX+deltaX, descendant.GridY+deltaY, descendant.GridWidth, descendant.GridHeight) {
				return false, ErrInvalid
			}
			moved = append(moved, domain.ProcessMapResourceRef{ResourceType: descendant.ResourceType, ResourceID: descendant.ResourceID})
		}
		internalTraces, err = postgresInternalProcessMapTracesTx(ctx, tx, companyID, moved)
		if err != nil {
			return false, err
		}
	}

	var saved domain.ProcessMapPlacement
	if exists {
		saved, err = postgresUpdateProcessMapPlacementTx(ctx, tx, target)
	} else {
		saved, err = postgresInsertProcessMapPlacementTx(ctx, tx, target)
	}
	if err != nil {
		return false, err
	}
	for _, descendant := range descendants {
		descendant.GridX += deltaX
		descendant.GridY += deltaY
		if _, err := postgresUpdateProcessMapPlacementTx(ctx, tx, descendant); err != nil {
			return false, err
		}
	}
	for _, trace := range internalTraces {
		if _, err := postgresSaveTranslatedProcessMapTraceTx(ctx, tx, trace, deltaX, deltaY); err != nil {
			return false, err
		}
	}
	if err := postgresExpandAutomaticProcessMapAncestorsTx(ctx, tx, companyID, parentID, saved); err != nil {
		return false, err
	}
	return true, nil
}

func (r *PostgresRepo) syncAutomaticProcessMapPlacementTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, resourceType, resourceID, parentID, actorUserID string,
) error {
	changed, err := postgresSyncAutomaticProcessMapPlacementTx(ctx, tx, companyID, resourceType, resourceID, parentID)
	if err != nil || !changed {
		return err
	}
	_, err = r.appendDomainEventTx(ctx, tx, processMapEventInput(
		companyID,
		actorUserID,
		ProcessMapPlacementSavedEvent,
		processMapResourceEventPayload(resourceType, resourceID),
	))
	return err
}

func (r *PostgresRepo) syncCompanyExplorerParentFromProcessMapTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, resourceType, resourceID, parentID, actorUserID string,
) (*DomainEventInput, error) {
	switch resourceType {
	case domain.ProcessMapResourceTypeFolder:
		var currentParent sql.NullString
		if err := tx.QueryRowContext(ctx, `
select parent_folder_id::text
from company_explorer_folders
where company_id=$1::uuid and folder_id=$2::uuid
for update`, companyID, resourceID).Scan(&currentParent); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		if currentParent.Valid == (parentID != "") && currentParent.String == parentID {
			return nil, nil
		}
		if err := protectCompanyExplorerDefaultFolderMutation(companyID, resourceID); err != nil {
			return nil, err
		}
		var explorerParent any
		if parentID != "" {
			explorerParent = parentID
		}
		position, err := nextCompanyExplorerFinalPositionSQL(ctx, tx, companyID, explorerParent)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
update company_explorer_folders
set parent_folder_id=nullif($3,'')::uuid,position=$4,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and folder_id=$2::uuid`, companyID, resourceID, parentID, position); err != nil {
			return nil, err
		}
		event := workspaceDomainEventInput(companyID, "company_explorer_folder_updated", map[string]any{
			"folder_id": resourceID, "parent_entity_id": parentID,
		})
		event.ActorUserID = actorUserID
		return &event, nil
	case domain.ProcessMapResourceTypeProcess:
		var itemID string
		var currentParent sql.NullString
		if err := tx.QueryRowContext(ctx, `
select item_id::text,parent_folder_id::text
from company_explorer_items
where company_id=$1::uuid and target_type='logic_gate' and target_id=$2::uuid
for update`, companyID, resourceID).Scan(&itemID, &currentParent); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		if currentParent.Valid == (parentID != "") && currentParent.String == parentID {
			return nil, nil
		}
		var explorerParent any
		if parentID != "" {
			explorerParent = parentID
		}
		position, err := nextCompanyExplorerFinalPositionSQL(ctx, tx, companyID, explorerParent)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
update company_explorer_items
set parent_folder_id=nullif($3,'')::uuid,position=$4,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and item_id=$2::uuid`, companyID, itemID, parentID, position); err != nil {
			return nil, err
		}
		eventParentID := parentID
		if eventParentID == "" {
			eventParentID = companyID
		}
		event := workspaceDomainEventInput(companyID, "company_explorer_item_placed", map[string]any{
			"item_id": itemID, "parent_entity_id": eventParentID,
			"target_type": EntityTypeLogicGate, "target_id": resourceID,
		})
		event.ActorUserID = actorUserID
		return &event, nil
	default:
		return nil, ErrInvalid
	}
}

func postgresDeleteAutomaticProcessMapPlacementTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, resourceType, resourceID string,
) ([]string, bool, error) {
	if err := postgresLockProcessMapCompanyTx(ctx, tx, companyID); err != nil {
		return nil, false, err
	}
	rows, err := tx.QueryContext(ctx, `
delete from process_map_traces trace using resource_operational_relationships relationship
where trace.company_id=$1::uuid and relationship.company_id=trace.company_id
  and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
  and ((relationship.source_resource_type=$2 and relationship.source_resource_id=$3::uuid)
    or (relationship.target_resource_type=$2 and relationship.target_resource_id=$3::uuid))
returning trace.resource_operational_relationship_id::text`, companyID, resourceType, resourceID)
	if err != nil {
		return nil, false, err
	}
	deletedTraceIDs := []string{}
	for rows.Next() {
		var relationshipID string
		if err := rows.Scan(&relationshipID); err != nil {
			rows.Close()
			return nil, false, err
		}
		deletedTraceIDs = append(deletedTraceIDs, relationshipID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, false, err
	}
	if err := rows.Close(); err != nil {
		return nil, false, err
	}
	result, err := tx.ExecContext(ctx, `
delete from process_map_placements
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, resourceType, resourceID)
	if err != nil {
		return nil, false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, false, err
	}
	sort.Strings(deletedTraceIDs)
	return deletedTraceIDs, affected > 0, nil
}

func postgresValidateTraceEndpointsMappedTx(ctx context.Context, tx *sql.Tx, companyID string, relationship domain.ResourceOperationalRelationship) error {
	for _, endpoint := range sortProcessMapEndpoints(relationship.Source, relationship.Target) {
		if _, err := processMapPlacementByResourceTx(ctx, tx, companyID, endpoint.ResourceType, endpoint.ResourceID, true); err != nil {
			return err
		}
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

func postgresLockProcessMapCompanyTx(ctx context.Context, tx *sql.Tx, companyID string) error {
	_, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended('process-map-parent:' || $1,0))`, companyID)
	return err
}

func postgresRequireProcessMapResourcesTx(ctx context.Context, tx *sql.Tx, companyID, permissionUserID string, resources []domain.ProcessMapResourceRef) error {
	resources = append([]domain.ProcessMapResourceRef{}, resources...)
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
			return err
		}
	}
	return nil
}

func postgresDirectProcessMapChildrenTx(ctx context.Context, tx *sql.Tx, companyID, folderID string, forUpdate bool) ([]domain.ProcessMapPlacement, error) {
	lock := ""
	if forUpdate {
		lock = " for update"
	}
	rows, err := tx.QueryContext(ctx, `
select company_id::text,resource_type,resource_id::text,map_parent_folder_id::text,
       grid_x,grid_y,grid_width,grid_height,revision,created_timestamp,updated_timestamp
from process_map_placements
where company_id=$1::uuid and map_parent_folder_id=$2::uuid
order by resource_type,resource_id`+lock, companyID, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.ProcessMapPlacement{}
	for rows.Next() {
		item, err := scanProcessMapPlacement(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresInternalProcessMapTracesTx(ctx context.Context, tx *sql.Tx, companyID string, moved []domain.ProcessMapResourceRef) ([]domain.ProcessMapTrace, error) {
	if len(moved) == 0 {
		return []domain.ProcessMapTrace{}, nil
	}
	movedJSON, err := json.Marshal(moved)
	if err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `
with moved as (
  select resource_type,resource_id
  from jsonb_to_recordset($2::jsonb) item(resource_type text,resource_id uuid)
)
select trace.company_id::text,trace.resource_operational_relationship_id::text,
       trace.route_points,trace.revision,trace.created_timestamp,trace.updated_timestamp
from process_map_traces trace
join resource_operational_relationships relationship
  on relationship.company_id=trace.company_id
 and relationship.resource_operational_relationship_id=trace.resource_operational_relationship_id
join moved source_moved
  on source_moved.resource_type=relationship.source_resource_type
 and source_moved.resource_id=relationship.source_resource_id
join moved target_moved
  on target_moved.resource_type=relationship.target_resource_type
 and target_moved.resource_id=relationship.target_resource_id
where trace.company_id=$1::uuid
order by trace.resource_operational_relationship_id
for update of trace`, companyID, string(movedJSON))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.ProcessMapTrace{}
	for rows.Next() {
		item, err := scanProcessMapTrace(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresSaveTranslatedProcessMapTraceTx(ctx context.Context, tx *sql.Tx, item domain.ProcessMapTrace, deltaX, deltaY int) (domain.ProcessMapTrace, error) {
	for index := range item.RoutePoints {
		if !validProcessMapCoordinate(item.RoutePoints[index].X+deltaX) || !validProcessMapCoordinate(item.RoutePoints[index].Y+deltaY) {
			return domain.ProcessMapTrace{}, ErrInvalid
		}
		item.RoutePoints[index].X += deltaX
		item.RoutePoints[index].Y += deltaY
	}
	routeJSON, err := json.Marshal(item.RoutePoints)
	if err != nil {
		return domain.ProcessMapTrace{}, err
	}
	return scanProcessMapTrace(tx.QueryRowContext(ctx, `
update process_map_traces
set route_points=$3::jsonb,revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid
returning company_id::text,resource_operational_relationship_id::text,route_points,revision,created_timestamp,updated_timestamp`,
		item.CompanyID, item.ResourceOperationalRelationshipID, string(routeJSON)))
}

func processMapEnvelopeVersionTx(ctx context.Context, tx *sql.Tx, companyID string, result *ProcessMapMutationEnvelope) error {
	version, _, err := processMapVersionsTx(ctx, tx, companyID)
	if err == nil {
		result.ProcessMapReadVersion = version
	}
	return err
}

func (r *PostgresRepo) PutProcessMapPlacement(ctx context.Context, input ProcessMapPlacementPutInput) (ProcessMapMutationEnvelope, error) {
	companyID, actorUserID, permissionUserID, err := normalizePostgresProcessMapMutation(input.CompanyID, input.ActorUserID, input.PermissionUserID)
	resourceType, typeOK := normalizeProcessMapResourceType(input.ResourceType)
	resourceID := cleanUUIDText(input.ResourceID)
	parentID := ""
	if input.MapParentFolderID != nil {
		parentID = cleanUUIDText(*input.MapParentFolderID)
	}
	if err != nil || !typeOK || resourceID == "" || (input.MapParentFolderID != nil && parentID == "") ||
		!validProcessMapGeometry(input.GridX, input.GridY, input.GridWidth, input.GridHeight) {
		return ProcessMapMutationEnvelope{}, ErrInvalid
	}
	if resourceType == domain.ProcessMapResourceTypeFolder && parentID == resourceID {
		return ProcessMapMutationEnvelope{}, ErrProcessMapCycle
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresCompanyExplorerMutationTx(ctx, tx, companyID, permissionUserID, true); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := postgresLockProcessMapCompanyTx(ctx, tx, companyID); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}

	current, currentErr := processMapPlacementByResourceTx(ctx, tx, companyID, resourceType, resourceID, false)
	exists := currentErr == nil
	if currentErr != nil && !errors.Is(currentErr, ErrNotFound) {
		return ProcessMapMutationEnvelope{}, currentErr
	}
	descendants := []domain.ProcessMapPlacement{}
	if resourceType == domain.ProcessMapResourceTypeFolder && exists {
		descendants, err = postgresProcessMapDescendantsTx(ctx, tx, companyID, resourceID, false)
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
	}
	movesFolderGroup := resourceType == domain.ProcessMapResourceTypeFolder && exists &&
		(input.GridX != current.GridX || input.GridY != current.GridY) &&
		input.GridWidth == current.GridWidth && input.GridHeight == current.GridHeight
	resources := []domain.ProcessMapResourceRef{{ResourceType: resourceType, ResourceID: resourceID}}
	if parentID != "" {
		resources = append(resources, domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: parentID})
	}
	if movesFolderGroup {
		for _, item := range descendants {
			resources = append(resources, domain.ProcessMapResourceRef{ResourceType: item.ResourceType, ResourceID: item.ResourceID})
		}
	}
	if err := postgresRequireProcessMapResourcesTx(ctx, tx, companyID, permissionUserID, resources); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	current, currentErr = processMapPlacementByResourceTx(ctx, tx, companyID, resourceType, resourceID, true)
	exists = currentErr == nil
	if currentErr != nil && !errors.Is(currentErr, ErrNotFound) {
		return ProcessMapMutationEnvelope{}, currentErr
	}
	if resourceType == domain.ProcessMapResourceTypeFolder && exists {
		descendants, err = postgresProcessMapDescendantsTx(ctx, tx, companyID, resourceID, true)
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
	}
	var parent domain.ProcessMapPlacement
	if parentID != "" {
		parent, err = processMapPlacementByResourceTx(ctx, tx, companyID, domain.ProcessMapResourceTypeFolder, parentID, true)
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
	}
	if resourceType == domain.ProcessMapResourceTypeFolder {
		cycle, err := postgresProcessMapFolderCycleTx(ctx, tx, companyID, resourceID, parentID)
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
		if cycle {
			return ProcessMapMutationEnvelope{}, ErrProcessMapCycle
		}
	}
	explorerEvent, err := r.syncCompanyExplorerParentFromProcessMapTx(ctx, tx, companyID, resourceType, resourceID, parentID, actorUserID)
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}

	deltaX, deltaY := 0, 0
	if exists {
		deltaX, deltaY = input.GridX-current.GridX, input.GridY-current.GridY
	}
	target := current
	if !exists {
		target = domain.ProcessMapPlacement{CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID}
	}
	if parentID == "" {
		target.MapParentFolderID = nil
	} else {
		parentCopy := parentID
		target.MapParentFolderID = &parentCopy
	}
	target.GridX, target.GridY = input.GridX, input.GridY
	target.GridWidth, target.GridHeight = input.GridWidth, input.GridHeight
	if parentID != "" && !processMapBoundsContain(processMapPlacementBounds(parent), processMapPlacementBounds(target)) {
		return ProcessMapMutationEnvelope{}, ErrProcessMapContainment
	}

	changedPlacements := []domain.ProcessMapPlacement{}
	movedRefs := []domain.ProcessMapResourceRef{{ResourceType: resourceType, ResourceID: resourceID}}
	if resourceType == domain.ProcessMapResourceTypeFolder {
		folderBounds := processMapPlacementBounds(target)
		for _, descendant := range descendants {
			shifted := descendant
			if movesFolderGroup {
				shifted.GridX += deltaX
				shifted.GridY += deltaY
			}
			if !validProcessMapGeometry(shifted.GridX, shifted.GridY, shifted.GridWidth, shifted.GridHeight) {
				return ProcessMapMutationEnvelope{}, ErrInvalid
			}
			if !processMapBoundsContain(folderBounds, processMapPlacementBounds(shifted)) {
				return ProcessMapMutationEnvelope{}, ErrProcessMapContainment
			}
			if movesFolderGroup {
				movedRefs = append(movedRefs, domain.ProcessMapResourceRef{ResourceType: descendant.ResourceType, ResourceID: descendant.ResourceID})
			}
		}
	}
	internalTraces := []domain.ProcessMapTrace{}
	if movesFolderGroup {
		internalTraces, err = postgresInternalProcessMapTracesTx(ctx, tx, companyID, movedRefs)
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
		for _, trace := range internalTraces {
			for _, point := range trace.RoutePoints {
				if !validProcessMapCoordinate(point.X+deltaX) || !validProcessMapCoordinate(point.Y+deltaY) {
					return ProcessMapMutationEnvelope{}, ErrInvalid
				}
			}
		}
		for _, descendant := range descendants {
			descendant.GridX += deltaX
			descendant.GridY += deltaY
			updated, err := postgresUpdateProcessMapPlacementTx(ctx, tx, descendant)
			if err != nil {
				return ProcessMapMutationEnvelope{}, err
			}
			changedPlacements = append(changedPlacements, updated)
		}
	}
	var saved domain.ProcessMapPlacement
	if exists {
		saved, err = postgresUpdateProcessMapPlacementTx(ctx, tx, target)
	} else {
		saved, err = postgresInsertProcessMapPlacementTx(ctx, tx, target)
	}
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	changedPlacements = append(changedPlacements, saved)
	changedTraces := []domain.ProcessMapTrace{}
	for _, trace := range internalTraces {
		updated, err := postgresSaveTranslatedProcessMapTraceTx(ctx, tx, trace, deltaX, deltaY)
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
		changedTraces = append(changedTraces, updated)
	}
	sort.Slice(changedPlacements, func(i, j int) bool {
		return compareProcessMapPlacements(changedPlacements[i], changedPlacements[j]) < 0
	})
	result := ProcessMapMutationEnvelope{Placements: changedPlacements, Traces: changedTraces, DeletedTraceIDs: []string{}, Created: !exists, Changed: true}
	eventInputs := []DomainEventInput{processMapMutationEventInput(companyID, actorUserID, input.RealtimeConnectionID, ProcessMapPlacementSavedEvent, processMapResourceEventPayload(resourceType, resourceID))}
	if explorerEvent != nil {
		eventInputs = append(eventInputs, *explorerEvent)
	}
	result.Events, err = r.appendDomainEventsTx(ctx, tx, eventInputs)
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := processMapEnvelopeVersionTx(ctx, tx, companyID, &result); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	return result, nil
}
func (r *PostgresRepo) DeleteProcessMapPlacement(ctx context.Context, input ProcessMapPlacementDeleteInput) (ProcessMapMutationEnvelope, error) {
	companyID, actorUserID, permissionUserID, err := normalizePostgresProcessMapMutation(input.CompanyID, input.ActorUserID, input.PermissionUserID)
	resourceType, typeOK := normalizeProcessMapResourceType(input.ResourceType)
	resourceID := cleanUUIDText(input.ResourceID)
	if err != nil || !typeOK || resourceID == "" {
		return ProcessMapMutationEnvelope{}, ErrInvalid
	}
	if resourceType == domain.ProcessMapResourceTypeFolder {
		deleted, err := r.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: "folder", ID: resourceID}}, actorUserID)
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
		processVersion, _, err := r.CurrentProcessMapVersions(ctx, companyID)
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
		return ProcessMapMutationEnvelope{
			Placements: []domain.ProcessMapPlacement{}, Traces: []domain.ProcessMapTrace{}, DeletedTraceIDs: []string{},
			ProcessMapReadVersion: processVersion, Changed: true, Events: deleted.Events,
		}, nil
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresCompanyExplorerMutationTx(ctx, tx, companyID, permissionUserID, true); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := postgresLockProcessMapCompanyTx(ctx, tx, companyID); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := postgresRequireProcessMapResourceTx(ctx, tx, companyID, resourceType, resourceID, permissionUserID); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if _, err := processMapPlacementByResourceTx(ctx, tx, companyID, resourceType, resourceID, true); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}

	deletedTraceIDs := []string{}
	explorerEvent := DomainEventInput{}
	if resourceType == domain.ProcessMapResourceTypeProcess {
		var itemID, parentID string
		if err := tx.QueryRowContext(ctx, `
select item_id::text,coalesce(parent_folder_id::text,'')
from company_explorer_items
where company_id=$1::uuid and target_type='logic_gate' and target_id=$2::uuid
for update`, companyID, resourceID).Scan(&itemID, &parentID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ProcessMapMutationEnvelope{}, ErrNotFound
			}
			return ProcessMapMutationEnvelope{}, err
		}
		if _, err := tx.ExecContext(ctx, `
delete from company_explorer_items
where company_id=$1::uuid and item_id=$2::uuid`, companyID, itemID); err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
		deletedTraceIDs, _, err = postgresDeleteAutomaticProcessMapPlacementTx(ctx, tx, companyID, resourceType, resourceID)
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
		explorerEvent = workspaceDomainEventInput(companyID, "company_explorer_item_removed", map[string]any{
			"item_id": itemID, "parent_entity_id": parentID,
			"target_type": EntityTypeLogicGate, "target_id": resourceID,
		})
	}
	explorerEvent.ActorUserID = actorUserID
	result := ProcessMapMutationEnvelope{Placements: []domain.ProcessMapPlacement{}, Traces: []domain.ProcessMapTrace{}, DeletedTraceIDs: deletedTraceIDs, Changed: true}
	result.Events, err = r.appendDomainEventsTx(ctx, tx, []DomainEventInput{
		processMapMutationEventInput(companyID, actorUserID, input.RealtimeConnectionID, ProcessMapPlacementDeletedEvent, processMapResourceEventPayload(resourceType, resourceID)),
		explorerEvent,
	})
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := processMapEnvelopeVersionTx(ctx, tx, companyID, &result); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	return result, nil
}

func (r *PostgresRepo) CreateResourceOperationalRelationship(ctx context.Context, input ResourceOperationalRelationshipCreateInput) (ProcessMapMutationEnvelope, error) {
	companyID, actorUserID, permissionUserID, err := normalizePostgresProcessMapMutation(input.CompanyID, input.ActorUserID, input.PermissionUserID)
	sourceType, sourceOK := normalizeProcessMapResourceType(input.Source.ResourceType)
	targetType, targetOK := normalizeProcessMapResourceType(input.Target.ResourceType)
	input.Source = domain.ProcessMapResourceRef{ResourceType: sourceType, ResourceID: cleanUUIDText(input.Source.ResourceID)}
	input.Target = domain.ProcessMapResourceRef{ResourceType: targetType, ResourceID: cleanUUIDText(input.Target.ResourceID)}
	if err != nil || !sourceOK || !targetOK || input.Source.ResourceID == "" || input.Target.ResourceID == "" ||
		input.Source == input.Target || (input.Trace != nil && !validProcessMapRoutePoints(input.Trace.RoutePoints)) {
		return ProcessMapMutationEnvelope{}, ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, false); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := postgresLockProcessMapCompanyTx(ctx, tx, companyID); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := postgresRequireProcessMapEndpointsTx(ctx, tx, companyID, permissionUserID, input.Source, input.Target); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	inserted, err := tx.ExecContext(ctx, `
insert into resource_operational_relationships(
  company_id,resource_operational_relationship_id,source_resource_type,source_resource_id,
  target_resource_type,target_resource_id,created_timestamp
)
values($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::uuid,statement_timestamp())
on conflict(company_id,source_resource_type,source_resource_id,target_resource_type,target_resource_id) do nothing`,
		companyID, newUUIDv7String(), input.Source.ResourceType, input.Source.ResourceID, input.Target.ResourceType, input.Target.ResourceID)
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	affected, err := inserted.RowsAffected()
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	created := affected == 1
	relationship, err := scanResourceOperationalRelationship(tx.QueryRowContext(ctx, `
select company_id::text,resource_operational_relationship_id::text,
       source_resource_type,source_resource_id::text,target_resource_type,target_resource_id::text,created_timestamp
from resource_operational_relationships
where company_id=$1::uuid and source_resource_type=$2 and source_resource_id=$3::uuid
  and target_resource_type=$4 and target_resource_id=$5::uuid
for update`, companyID, input.Source.ResourceType, input.Source.ResourceID, input.Target.ResourceType, input.Target.ResourceID))
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	result := ProcessMapMutationEnvelope{
		Placements: []domain.ProcessMapPlacement{}, Traces: []domain.ProcessMapTrace{}, DeletedTraceIDs: []string{},
		Relationship: &relationship, Created: created, Changed: created,
	}
	eventInputs := []DomainEventInput{}
	if created {
		eventInputs = append(eventInputs, processMapMutationEventInput(companyID, actorUserID, input.RealtimeConnectionID,
			ResourceOperationalRelationshipCreatedEvent, processMapRelationshipEventPayload(relationship)))
	}
	if input.Trace != nil {
		if err := postgresValidateTraceEndpointsMappedTx(ctx, tx, companyID, relationship); err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
		trace, changed, err := upsertPostgresProcessMapTraceTx(ctx, tx, companyID, relationship.ResourceOperationalRelationshipID, input.Trace.RoutePoints)
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
		result.Traces = append(result.Traces, trace)
		result.Changed = result.Changed || changed
		if changed {
			eventInputs = append(eventInputs, processMapMutationEventInput(companyID, actorUserID, input.RealtimeConnectionID,
				ProcessMapTraceSavedEvent, processMapRelationshipEventPayload(relationship)))
		}
	}
	if len(eventInputs) > 0 {
		result.Events, err = r.appendDomainEventsTx(ctx, tx, eventInputs)
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
	} else {
		result.Events = []domain.DomainEvent{}
	}
	if err := processMapEnvelopeVersionTx(ctx, tx, companyID, &result); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	return result, nil
}

func (r *PostgresRepo) PutProcessMapTrace(ctx context.Context, input ProcessMapTracePutInput) (ProcessMapMutationEnvelope, error) {
	companyID, actorUserID, permissionUserID, err := normalizePostgresProcessMapMutation(input.CompanyID, input.ActorUserID, input.PermissionUserID)
	relationshipID := cleanUUIDText(input.ResourceOperationalRelationshipID)
	if err != nil || relationshipID == "" || !validProcessMapRoutePoints(input.RoutePoints) {
		return ProcessMapMutationEnvelope{}, ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, false); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := postgresLockProcessMapCompanyTx(ctx, tx, companyID); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	relationship, err := processMapRelationshipByIDTx(ctx, tx, companyID, relationshipID, false)
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := postgresRequireProcessMapEndpointsTx(ctx, tx, companyID, permissionUserID, relationship.Source, relationship.Target); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	relationship, err = processMapRelationshipByIDTx(ctx, tx, companyID, relationshipID, true)
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := postgresValidateTraceEndpointsMappedTx(ctx, tx, companyID, relationship); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	trace, changed, err := upsertPostgresProcessMapTraceTx(ctx, tx, companyID, relationshipID, input.RoutePoints)
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	result := ProcessMapMutationEnvelope{
		Placements: []domain.ProcessMapPlacement{}, Traces: []domain.ProcessMapTrace{trace}, DeletedTraceIDs: []string{},
		Relationship: &relationship, Changed: changed, Events: []domain.DomainEvent{},
	}
	if changed {
		result.Events, err = r.appendDomainEventsTx(ctx, tx, []DomainEventInput{processMapMutationEventInput(companyID, actorUserID, input.RealtimeConnectionID,
			ProcessMapTraceSavedEvent, processMapRelationshipEventPayload(relationship))})
		if err != nil {
			return ProcessMapMutationEnvelope{}, err
		}
	}
	if err := processMapEnvelopeVersionTx(ctx, tx, companyID, &result); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	return result, nil
}

func (r *PostgresRepo) DeleteResourceOperationalRelationship(ctx context.Context, input ResourceOperationalRelationshipDeleteInput) (ProcessMapMutationEnvelope, error) {
	companyID, actorUserID, permissionUserID, err := normalizePostgresProcessMapMutation(input.CompanyID, input.ActorUserID, input.PermissionUserID)
	relationshipID := cleanUUIDText(input.ResourceOperationalRelationshipID)
	if err != nil || relationshipID == "" {
		return ProcessMapMutationEnvelope{}, ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, companyID, false); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := postgresLockProcessMapCompanyTx(ctx, tx, companyID); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	relationship, err := processMapRelationshipByIDTx(ctx, tx, companyID, relationshipID, false)
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := postgresRequireProcessMapEndpointsTx(ctx, tx, companyID, permissionUserID, relationship.Source, relationship.Target); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if _, err := processMapRelationshipByIDTx(ctx, tx, companyID, relationshipID, true); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if _, err := tx.ExecContext(ctx, `
delete from resource_operational_relationships
where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`, companyID, relationshipID); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	result := ProcessMapMutationEnvelope{
		Placements: []domain.ProcessMapPlacement{}, Traces: []domain.ProcessMapTrace{}, DeletedTraceIDs: []string{},
		Relationship: &relationship, Changed: true,
	}
	result.Events, err = r.appendDomainEventsTx(ctx, tx, []DomainEventInput{processMapMutationEventInput(companyID, actorUserID, input.RealtimeConnectionID,
		ResourceOperationalRelationshipDeletedEvent, processMapRelationshipEventPayload(relationship))})
	if err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := processMapEnvelopeVersionTx(ctx, tx, companyID, &result); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProcessMapMutationEnvelope{}, err
	}
	return result, nil
}

func postgresProcessMapFolderCleanupOrderTx(ctx context.Context, tx *sql.Tx, companyID string, folderIDs []string) ([]string, error) {
	if len(folderIDs) == 0 {
		return []string{}, nil
	}
	folderJSON, err := json.Marshal(folderIDs)
	if err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `
with recursive selected(folder_id) as (
  select value::uuid from jsonb_array_elements_text($2::jsonb)
), ancestry(start_id,parent_id,depth,path,cycle) as (
  select selected.folder_id,placement.map_parent_folder_id,0,array[selected.folder_id],false
  from selected
  left join process_map_placements placement
    on placement.company_id=$1::uuid
   and placement.resource_type='company_explorer_folder'
   and placement.resource_id=selected.folder_id
  union all
  select ancestry.start_id,parent.map_parent_folder_id,ancestry.depth+1,
         ancestry.path || ancestry.parent_id,ancestry.parent_id=any(ancestry.path)
  from ancestry
  join process_map_placements parent
    on parent.company_id=$1::uuid
   and parent.resource_type='company_explorer_folder'
   and parent.resource_id=ancestry.parent_id
  where ancestry.parent_id is not null and not ancestry.cycle
)
select start_id::text,max(depth) depth
from ancestry
group by start_id
order by max(depth),start_id`, companyID, string(folderJSON))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]string, 0, len(folderIDs))
	for rows.Next() {
		var folderID string
		var depth int
		if err := rows.Scan(&folderID, &depth); err != nil {
			return nil, err
		}
		result = append(result, folderID)
	}
	return result, rows.Err()
}

// postgresDeleteProcessMapResourceTx is the one typed permanent-source cleanup
// path. A deleted mapped Folder reparents its direct map children to its former
// map parent. Operational relationships survive unless the deleted source is an
// exact endpoint.
func postgresDeleteProcessMapResourceTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	if resourceType != domain.ProcessMapResourceTypeFolder && resourceType != domain.ProcessMapResourceTypeProcess {
		return ErrInvalid
	}
	if err := postgresLockProcessMapCompanyTx(ctx, tx, companyID); err != nil {
		return err
	}
	placement, err := processMapPlacementByResourceTx(ctx, tx, companyID, resourceType, resourceID, true)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	if resourceType == domain.ProcessMapResourceTypeFolder && err == nil {
		children, err := postgresDirectProcessMapChildrenTx(ctx, tx, companyID, resourceID, true)
		if err != nil {
			return err
		}
		for _, child := range children {
			child.MapParentFolderID = placement.MapParentFolderID
			if _, err := postgresUpdateProcessMapPlacementTx(ctx, tx, child); err != nil {
				return err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `
delete from process_map_placements
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, companyID, resourceType, resourceID); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
delete from resource_operational_relationships
where company_id=$1::uuid
  and ((source_resource_type=$2 and source_resource_id=$3::uuid)
    or (target_resource_type=$2 and target_resource_id=$3::uuid))`, companyID, resourceType, resourceID)
	return err
}
