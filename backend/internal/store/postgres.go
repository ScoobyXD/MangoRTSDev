package store

import (
	"database/sql"
	"sync"
)

type PostgresRepo struct {
	db *sql.DB

	communicationsMessageReadStatusSchemaOnce sync.Once
	communicationsMessageReadStatusSchemaErr  error
}

func NewPostgresRepo(db *sql.DB) *PostgresRepo {
	return &PostgresRepo{db: db}
}
