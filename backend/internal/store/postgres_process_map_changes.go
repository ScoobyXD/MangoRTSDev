package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) GetProcessMapChanges(ctx context.Context, input ProcessMapChangesQuery) (ProcessMapChanges, error) {
	companyID, userID, err := normalizePostgresProcessMapRead(input.CompanyID, input.PermissionUserID)
	if err != nil {
		return ProcessMapChanges{}, err
	}
	input.CompanyID, input.PermissionUserID = companyID, userID
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return ProcessMapChanges{}, err
	}
	defer tx.Rollback()
	scene, err := postgresProcessMapScene(ctx, tx, companyID, userID)
	if err != nil {
		return ProcessMapChanges{}, err
	}
	version := scene.ProcessMapReadVersion
	minimumVersion, err := validateProcessMapChangesQuery(input, version)
	if err != nil {
		return ProcessMapChanges{}, err
	}
	rows, err := tx.QueryContext(ctx, `select `+domainEventSelectColumns+`
from domain_events where company_id=$1::uuid and stream_type='workspace' and stream_id=$1::text
 and sequence>$2 and sequence<=$3 order by sequence limit $4`, companyID, minimumVersion, version, processMapMaxReplayEvents)
	if err != nil {
		return ProcessMapChanges{}, err
	}
	events := []domain.DomainEvent{}
	for rows.Next() {
		event, err := scanDomainEvent(rows)
		if err != nil {
			rows.Close()
			return ProcessMapChanges{}, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return ProcessMapChanges{}, err
	}
	if err := rows.Close(); err != nil {
		return ProcessMapChanges{}, err
	}
	access := map[domain.ProcessMapResourceRef]bool{}
	presentationDamage := map[domain.ProcessMapResourceRef]processMapDamage{}
	result, err := validateProcessMapCachedTiles(input, scene, events, minimumVersion, func(event domain.DomainEvent) (processMapDamage, bool, error) {
		damage, selective := processMapEventDamage(event)
		if !selective {
			if ref, ok := processMapPresentationEventResource(event); ok {
				var cached bool
				damage, cached = presentationDamage[ref]
				if !cached {
					damage = newProcessMapDamage()
					placement, readErr := processMapPlacementByResourceTx(ctx, tx, companyID, ref.ResourceType, ref.ResourceID, false)
					if readErr != nil && !errors.Is(readErr, ErrNotFound) {
						return damage, false, readErr
					}
					if readErr == nil {
						damage.addPlacement(placement)
					}
					presentationDamage[ref] = damage
				}
				selective = true
			}
		}
		if !selective {
			return damage, false, nil
		}
		for _, ref := range damage.Resources {
			allowed, checked := access[ref]
			if !checked {
				query, ok := postgresProcessMapResourceQuery(ref.ResourceType, false)
				if !ok {
					return damage, false, nil
				}
				checkErr := tx.QueryRowContext(ctx, query, companyID, ref.ResourceID, userID).Scan(&allowed)
				if checkErr != nil && !errors.Is(checkErr, sql.ErrNoRows) {
					return damage, false, checkErr
				}
				access[ref] = allowed
			}
			// A dirty-tile pattern must not reveal a restricted item's dimensions.
			if !allowed {
				return damage, false, nil
			}
		}
		return damage, true, nil
	})
	if err != nil {
		return ProcessMapChanges{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProcessMapChanges{}, err
	}
	return result, nil
}

// Capture both endpoint-derived and routed geometry for every incident trace,
// including external connections whose saved route does not change in a move.
func postgresProcessMapDamageTx(ctx context.Context, tx *sql.Tx, companyID string, resources []domain.ProcessMapResourceRef, relationshipID string) (processMapDamage, error) {
	damage := newProcessMapDamage()
	encoded, err := json.Marshal(resources)
	if err != nil {
		return damage, err
	}
	if len(resources) > 0 {
		placements, err := tx.QueryContext(ctx, `
select placement.company_id::text,placement.resource_type,placement.resource_id::text,
 placement.map_parent_folder_id::text,placement.grid_x,placement.grid_y,placement.grid_width,placement.grid_height,
 placement.revision,placement.created_timestamp,placement.updated_timestamp
from jsonb_to_recordset($2::jsonb) affected(resource_type text,resource_id uuid)
join process_map_placements placement on placement.company_id=$1::uuid and placement.resource_type=affected.resource_type and placement.resource_id=affected.resource_id`, companyID, string(encoded))
		if err != nil {
			return damage, err
		}
		for placements.Next() {
			placement, err := scanProcessMapPlacement(placements)
			if err != nil {
				placements.Close()
				return damage, err
			}
			damage.addPlacement(placement)
		}
		if err := placements.Err(); err != nil {
			placements.Close()
			return damage, err
		}
		if err := placements.Close(); err != nil {
			return damage, err
		}
	}
	rows, err := tx.QueryContext(ctx, `
with affected as (select resource_type,resource_id from jsonb_to_recordset(coalesce(nullif($2::jsonb,'null'::jsonb),'[]'::jsonb)) item(resource_type text,resource_id uuid))
select relationship.company_id::text,relationship.resource_operational_relationship_id::text,
 relationship.source_resource_type,relationship.source_resource_id::text,
 relationship.target_resource_type,relationship.target_resource_id::text,
 trace.route_points,
 source.grid_x,source.grid_y,source.grid_width,source.grid_height,
 target.grid_x,target.grid_y,target.grid_width,target.grid_height
from resource_operational_relationships relationship
join process_map_traces trace using(company_id,resource_operational_relationship_id)
join process_map_placements source on source.company_id=relationship.company_id and source.resource_type=relationship.source_resource_type and source.resource_id=relationship.source_resource_id
join process_map_placements target on target.company_id=relationship.company_id and target.resource_type=relationship.target_resource_type and target.resource_id=relationship.target_resource_id
where relationship.company_id=$1::uuid and (
 relationship.resource_operational_relationship_id=nullif($3,'')::uuid
 or exists(select 1 from affected where (resource_type=relationship.source_resource_type and resource_id=relationship.source_resource_id) or (resource_type=relationship.target_resource_type and resource_id=relationship.target_resource_id)))`, companyID, string(encoded), relationshipID)
	if err != nil {
		return damage, err
	}
	defer rows.Close()
	for rows.Next() {
		var relationship domain.ResourceOperationalRelationship
		var source, target domain.ProcessMapPlacement
		var trace domain.ProcessMapTrace
		var route []byte
		if err := rows.Scan(&relationship.CompanyID, &relationship.ResourceOperationalRelationshipID,
			&relationship.Source.ResourceType, &relationship.Source.ResourceID, &relationship.Target.ResourceType, &relationship.Target.ResourceID, &route,
			&source.GridX, &source.GridY, &source.GridWidth, &source.GridHeight, &target.GridX, &target.GridY, &target.GridWidth, &target.GridHeight); err != nil {
			return damage, err
		}
		if err := json.Unmarshal(route, &trace.RoutePoints); err != nil {
			return damage, err
		}
		damage.addTrace(relationship, source, target, trace)
	}
	return damage, rows.Err()
}
