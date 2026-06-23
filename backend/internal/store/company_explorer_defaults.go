package store

import (
	"crypto/md5"
	"strings"
)

const (
	CompanyExplorerDefaultRootFolderName       = "Unfiled"
	CompanyExplorerDefaultProjectsFolderName   = "Projects"
	CompanyExplorerDefaultLogicGatesFolderName = "Logic Gates"
	CompanyExplorerDefaultNodesFolderName      = "Nodes"

	companyExplorerDefaultRootKey       = "unfiled"
	companyExplorerDefaultProjectsKey   = "unfiled_projects"
	companyExplorerDefaultLogicGatesKey = "unfiled_logic_gates"
	companyExplorerDefaultNodesKey      = "unfiled_nodes"

	CompanyExplorerSearchDefaultLimit = 40
	CompanyExplorerSearchMaxLimit     = 100
)

type companyExplorerDefaultFolders struct {
	UnfiledFolderID    string
	ProjectsFolderID   string
	LogicGatesFolderID string
	NodesFolderID      string
}

func companyExplorerDefaultFolderIDs(companyID string) companyExplorerDefaultFolders {
	companyID = cleanUUIDText(companyID)
	return companyExplorerDefaultFolders{
		UnfiledFolderID:    companyExplorerDefaultFolderID(companyID, companyExplorerDefaultRootKey),
		ProjectsFolderID:   companyExplorerDefaultFolderID(companyID, companyExplorerDefaultProjectsKey),
		LogicGatesFolderID: companyExplorerDefaultFolderID(companyID, companyExplorerDefaultLogicGatesKey),
		NodesFolderID:      companyExplorerDefaultFolderID(companyID, companyExplorerDefaultNodesKey),
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
	case EntityTypeNode:
		return folders.NodesFolderID, folders.NodesFolderID != ""
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
		folderID == folders.LogicGatesFolderID ||
		folderID == folders.NodesFolderID
}

func normalizeCompanyExplorerSearchQuery(query CompanyExplorerSearchQuery) (CompanyExplorerSearchQuery, error) {
	query.CompanyID = cleanUUIDText(query.CompanyID)
	query.Query = strings.TrimSpace(query.Query)
	query.PermissionUserID = cleanUUIDText(query.PermissionUserID)
	if query.CompanyID == "" || query.Query == "" {
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
