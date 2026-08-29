package store

import (
	"context"
	"database/sql"
	"encoding/json"

	"miraeopus/backend/internal/domain"
)

func syncPostgresNodeCompletionTransitionsTx(ctx context.Context, tx *sql.Tx, events []domain.DomainEvent) error {
	updates := nodeCompletionTransitionUpdates(events)
	if len(updates) == 0 {
		return nil
	}
	payload, err := json.Marshal(updates)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
with snapshots as (
  select company_id::uuid,node_id::uuid,completed,replace_timestamp,transition_timestamp
  from jsonb_to_recordset($1::jsonb) as snapshot(
    company_id text,
    node_id text,
    completed boolean,
    replace_timestamp boolean,
    transition_timestamp timestamptz
  )
)
update nodes node
set completion_transition_timestamp=case
  when not snapshot.completed then null
  when snapshot.replace_timestamp then snapshot.transition_timestamp
  else coalesce(node.completion_transition_timestamp,snapshot.transition_timestamp)
end
from snapshots snapshot
where node.company_id=snapshot.company_id
  and node.node_id=snapshot.node_id
  and node.completion_transition_timestamp is distinct from case
    when not snapshot.completed then null
    when snapshot.replace_timestamp then snapshot.transition_timestamp
    else coalesce(node.completion_transition_timestamp,snapshot.transition_timestamp)
  end`, string(payload))
	return err
}
