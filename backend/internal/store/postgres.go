package store

import (
	"context"
	"database/sql"
	"sync"
)

type PostgresRepo struct {
	db                              *sql.DB
	companyExplorerSchemaMu         sync.Mutex
	companyExplorerSharedInboxReady bool
}

func NewPostgresRepo(db *sql.DB) *PostgresRepo {
	return &PostgresRepo{db: db}
}

func (r *PostgresRepo) ensureCompanyExplorerSharedInboxSchema(ctx context.Context) error {
	r.companyExplorerSchemaMu.Lock()
	defer r.companyExplorerSchemaMu.Unlock()
	if r.companyExplorerSharedInboxReady {
		return nil
	}
	if err := ensureCompanyExplorerSharedInboxSchemaSQL(ctx, r.db); err != nil {
		return err
	}
	r.companyExplorerSharedInboxReady = true
	return nil
}
