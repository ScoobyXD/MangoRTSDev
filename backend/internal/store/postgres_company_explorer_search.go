package store

// SearchCompanyExplorer uses one candidate-first search for both Company
// Explorer and editor pickers. The ranking mode changes presentation order,
// but permission work is always limited to the matching candidate batch.
func (r *PostgresRepo) SearchCompanyExplorer(query CompanyExplorerSearchQuery) (CompanyExplorerSearchResults, error) {
	query, err := normalizeCompanyExplorerSearchQuery(query)
	if err != nil {
		return CompanyExplorerSearchResults{}, err
	}
	return r.searchCompanyExplorerCandidates(query)
}
