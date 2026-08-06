package store

import (
	"crypto/md5"
	"strings"
)

const (
	CompanyExplorerDefaultRootFolderName       = "Unfiled"
	CompanyExplorerDefaultProjectsFolderName   = "Projects"
	CompanyExplorerDefaultLogicGatesFolderName = "Logic Gates"

	CompanyExplorerProtectedDefaultFolderNativeContextKey = "protected_default_folder"

	companyExplorerDefaultRootKey       = "unfiled"
	companyExplorerDefaultProjectsKey   = "unfiled_projects"
	companyExplorerDefaultLogicGatesKey = "unfiled_logic_gates"

	CompanyExplorerSearchDefaultLimit = 40
	CompanyExplorerSearchMaxLimit     = 100
)

type companyExplorerDefaultFolders struct {
	UnfiledFolderID    string
	ProjectsFolderID   string
	LogicGatesFolderID string
}

func companyExplorerDefaultFolderIDs(companyID string) companyExplorerDefaultFolders {
	companyID = cleanUUIDText(companyID)
	return companyExplorerDefaultFolders{
		UnfiledFolderID:    companyExplorerDefaultFolderID(companyID, companyExplorerDefaultRootKey),
		ProjectsFolderID:   companyExplorerDefaultFolderID(companyID, companyExplorerDefaultProjectsKey),
		LogicGatesFolderID: companyExplorerDefaultFolderID(companyID, companyExplorerDefaultLogicGatesKey),
	}
}

func companyExplorerDefaultFolderID(companyID, folderKey string) string {
	companyID = cleanUUIDText(companyID)
	folderKey = strings.ToLower(strings.TrimSpace(folderKey))
	if companyID == "" || folderKey == "" {
		return ""
	}
	sum := md5.Sum([]byte(companyID + ":company_explorer_default_folder:" + folderKey))
	return uuidStringFromMD5(sum[:])
}

func companyExplorerDefaultFolderIDForTargetType(companyID, targetType string) (string, bool) {
	folders := companyExplorerDefaultFolderIDs(companyID)
	switch strings.ToLower(strings.TrimSpace(targetType)) {
	case EntityTypeProject:
		return folders.ProjectsFolderID, folders.ProjectsFolderID != ""
	case EntityTypeLogicGate:
		return folders.LogicGatesFolderID, folders.LogicGatesFolderID != ""
	default:
		return "", false
	}
}

func isCompanyExplorerDefaultFolderID(companyID, folderID string) bool {
	folderID = cleanUUIDText(folderID)
	if folderID == "" {
		return false
	}
	folders := companyExplorerDefaultFolderIDs(companyID)
	return folderID == folders.UnfiledFolderID ||
		folderID == folders.ProjectsFolderID ||
		folderID == folders.LogicGatesFolderID
}

func applyCompanyExplorerDefaultFolderNativeContext(row *CompanyExplorerV2Row) {
	if row == nil || row.EntityType != CompanyExplorerV2EntityFolder || !isCompanyExplorerDefaultFolderID(row.CompanyID, row.EntityID) {
		return
	}
	if row.NativeContext == nil {
		row.NativeContext = map[string]string{}
	}
	row.NativeContext[CompanyExplorerProtectedDefaultFolderNativeContextKey] = "true"
}

func protectCompanyExplorerDefaultFolderMutation(companyID, folderID string) error {
	if isCompanyExplorerDefaultFolderID(companyID, folderID) {
		return ErrInvalid
	}
	return nil
}
func normalizeCompanyExplorerSearchQuery(query CompanyExplorerSearchQuery) (CompanyExplorerSearchQuery, error) {
	query.CompanyID = cleanUUIDText(query.CompanyID)
	query.Query = strings.TrimSpace(query.Query)
	query.PermissionUserID = cleanUUIDText(query.PermissionUserID)
	resourceTypes, err := normalizeCompanyExplorerSearchResourceTypes(query.ResourceTypes)
	if err != nil {
		return CompanyExplorerSearchQuery{}, err
	}
	query.ResourceTypes = resourceTypes
	if query.CompanyID == "" || (query.Query == "" && !query.EditorEntityRanking) {
		return CompanyExplorerSearchQuery{}, ErrInvalid
	}
	if query.Limit <= 0 {
		query.Limit = CompanyExplorerSearchDefaultLimit
	}
	if query.Limit > CompanyExplorerSearchMaxLimit {
		query.Limit = CompanyExplorerSearchMaxLimit
	}
	return query, nil
}

func normalizeCompanyExplorerSearchResourceTypes(values []string) ([]string, error) {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		clean := strings.ToLower(strings.TrimSpace(value))
		if clean == "" {
			continue
		}
		switch clean {
		case EntityTypeLogicGate, EntityTypeNode, EntityTypeProject, CompanyExplorerV2EntityFolder:
		default:
			return nil, ErrInvalid
		}
		if seen[clean] {
			continue
		}
		seen[clean] = true
		out = append(out, clean)
	}
	return out, nil
}

func companyExplorerSearchResourceTypeAllowed(resourceTypes []string, resourceType string) bool {
	if len(resourceTypes) == 0 {
		return true
	}
	resourceType = strings.ToLower(strings.TrimSpace(resourceType))
	for _, allowed := range resourceTypes {
		if allowed == resourceType {
			return true
		}
	}
	return false
}
