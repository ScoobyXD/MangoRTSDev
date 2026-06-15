package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const (
	CompanyExplorerFolderScopeCompany = "company"
	CompanyExplorerFolderScopeUser    = "user"
	CompanyExplorerFolderScopeTeam    = "team"
)

func normalizeCompanyExplorerFolderScope(scopeType, scopeID string) (string, *string, error) {
	scopeType = strings.TrimSpace(scopeType)
	scopeID = strings.TrimSpace(scopeID)
	if scopeType == "" {
		scopeType = CompanyExplorerFolderScopeCompany
	}
	switch scopeType {
	case CompanyExplorerFolderScopeCompany:
		return scopeType, nil, nil
	case CompanyExplorerFolderScopeUser, CompanyExplorerFolderScopeTeam:
		if scopeID == "" {
			return "", nil, ErrInvalid
		}
		value := scopeID
		return scopeType, &value, nil
	default:
		return "", nil, ErrInvalid
	}
}

func companyExplorerFolderScopeType(folder domain.CompanyExplorerFolder) string {
	scopeType := strings.TrimSpace(folder.ScopeType)
	if scopeType == "" {
		return CompanyExplorerFolderScopeCompany
	}
	return scopeType
}

func companyExplorerFolderScopeID(folder domain.CompanyExplorerFolder) *string {
	if folder.ScopeID == nil {
		return nil
	}
	value := strings.TrimSpace(*folder.ScopeID)
	if value == "" {
		return nil
	}
	return &value
}
