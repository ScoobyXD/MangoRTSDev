package store

import (
	"context"
	"database/sql"
	"errors"
)

func (r *PostgresRepo) CurrentNodeViewVersion(companyID, nodeID, userID string) (NodeViewVersion, error) {
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	userID = cleanUUIDText(userID)
	if companyID == "" || nodeID == "" {
		return NodeViewVersion{}, ErrInvalid
	}

	var version NodeViewVersion
	err := r.db.QueryRowContext(context.Background(), `
select coalesce(shared.version, 0), coalesce(actor.version, 0)
from nodes node
left join node_view_versions shared
  on shared.company_id=node.company_id
 and shared.node_id=node.node_id
left join node_view_user_versions actor
  on actor.company_id=node.company_id
 and actor.node_id=node.node_id
 and actor.user_id=nullif($3::text, '')::uuid
where node.company_id=$1::uuid
  and node.node_id=$2::uuid`, companyID, nodeID, userID).Scan(&version.Shared, &version.User)
	if errors.Is(err, sql.ErrNoRows) {
		return NodeViewVersion{}, ErrNotFound
	}
	if err != nil {
		return NodeViewVersion{}, err
	}
	return version, nil
}

func (r *PostgresRepo) AnchorCleanNodeProjections(input NodeProjectionAnchorInput) (int, error) {
	companyID := cleanUUIDText(input.CompanyID)
	nodeID := cleanUUIDText(input.NodeID)
	userID := cleanUUIDText(input.UserID)
	if companyID == "" || nodeID == "" || userID == "" {
		return 0, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `select set_config('mangorts.node_view_anchor_clean', '1', true)`); err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, `
insert into node_projection_seen_snapshots as snapshot
  (company_id, node_id, information_id, user_id, information, projection_updated_timestamp, seen_timestamp)
select projection.company_id,
       projection.node_id,
       projection.information_id,
       $3::uuid,
       projection.information,
       projection.updated_timestamp,
       projection.updated_timestamp
from node_projection_table projection
left join node_projection_seen_snapshots current_snapshot
  on current_snapshot.company_id=projection.company_id
 and current_snapshot.node_id=projection.node_id
 and current_snapshot.information_id=projection.information_id
 and current_snapshot.user_id=$3::uuid
where projection.company_id=$1::uuid
  and projection.node_id=$2::uuid
  and projection.type='Text box'::information_type
  and not exists (
    select 1
    from node_content_changes change
    where change.company_id=projection.company_id
      and change.node_id=projection.node_id
      and change.information_id=projection.information_id
      and change.actor_user_id is distinct from $3::uuid
      and not exists (
        select 1
        from node_content_change_seen seen_change
        where seen_change.company_id=change.company_id
          and seen_change.change_id=change.change_id
          and seen_change.user_id=$3::uuid
      )
      and (current_snapshot.seen_timestamp is null or change.created_timestamp >= current_snapshot.seen_timestamp)
  )
on conflict (company_id, node_id, information_id, user_id)
do update set
  information=excluded.information,
  projection_updated_timestamp=excluded.projection_updated_timestamp,
  seen_timestamp=excluded.seen_timestamp
where snapshot.information is distinct from excluded.information
   or snapshot.projection_updated_timestamp is distinct from excluded.projection_updated_timestamp`, companyID, nodeID, userID)
	if err != nil {
		return 0, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if affected == 0 {
		var exists bool
		if err := tx.QueryRowContext(ctx, `
select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)`, companyID, nodeID).Scan(&exists); err != nil {
			return 0, err
		}
		if !exists {
			return 0, ErrNotFound
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return int(affected), nil
}
