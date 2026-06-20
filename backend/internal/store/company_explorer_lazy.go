package store

import "strings"

func NormalizeCompanyExplorerLazyScope(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", CompanyExplorerLazyScopeAll:
		return CompanyExplorerLazyScopeAll, true
	default:
		return "", false
	}
}

func normalizeCompanyExplorerLazyRowsQuery(query CompanyExplorerLazyRowsQuery, requireParent bool) (CompanyExplorerLazyRowsQuery, error) {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.ScopeUserID = strings.TrimSpace(query.ScopeUserID)
	query.PermissionUserID = strings.TrimSpace(query.PermissionUserID)
	query.ParentID = strings.TrimSpace(query.ParentID)
	scope, ok := NormalizeCompanyExplorerLazyScope(query.Scope)
	if !ok {
		return CompanyExplorerLazyRowsQuery{}, ErrInvalid
	}
	query.Scope = scope
	if query.CompanyID == "" || (requireParent && query.ParentID == "") {
		return CompanyExplorerLazyRowsQuery{}, ErrInvalid
	}
	return query, nil
}
