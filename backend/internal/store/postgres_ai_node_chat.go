package store

import (
	"context"
	"database/sql"

	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) AICreateNodeChat(ctx context.Context, run AIRun, actionKey string, input AINodeChatCreateInput) (domain.NodeInformation, error) {
	write, err := aiNodeChatInput(run, input)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	return postgresAIMutation(r, ctx, run, aiActionKey{"mango_create_node_chat", actionKey}, func(tx *sql.Tx) error {
		return aiRequireEditTx(ctx, tx, run, EntityTypeNode, write.NodeID)
	}, func(tx *sql.Tx) (domain.NodeInformation, error) {
		return r.addNodeInformationTx(ctx, tx, write)
	})
}
