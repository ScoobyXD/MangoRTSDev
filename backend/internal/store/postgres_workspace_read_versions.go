package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

func (r *PostgresRepo) CurrentWorkspaceReadVersion(query WorkspaceReadVersionQuery) (int64, bool, error) {
	query, err := NormalizeWorkspaceReadVersionQuery(query)
	if err != nil {
		return 0, false, err
	}

	var version int64
	err = r.db.QueryRowContext(context.Background(), `
select version
from workspace_read_versions
where company_id=$1::uuid
  and scope=$2
  and resource_key=$3`, query.CompanyID, query.Scope, query.ResourceKey).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) || isPostgresUndefinedTableError(err) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return version, true, nil
}

func isPostgresUndefinedTableError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "SQLSTATE 42P01") || strings.Contains(message, "relation \"workspace_read_versions\" does not exist")
}
