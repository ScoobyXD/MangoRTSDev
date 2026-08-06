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
