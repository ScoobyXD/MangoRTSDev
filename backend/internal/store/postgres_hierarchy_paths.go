package store

import (
	"context"
	"database/sql"
	"errors"
)

func (r *PostgresRepo) GetCompanyExplorerHierarchyPath(query CompanyExplorerHierarchyPathQuery) (ExplorerHierarchyPath, error) {
	query, err := normalizeCompanyExplorerHierarchyPathQuery(query)
	if err != nil {
		return ExplorerHierarchyPath{}, err
	}
	query.CompanyID = cleanUUIDText(query.CompanyID)
	query.ResourceID = cleanUUIDText(query.ResourceID)
	if query.PermissionUserID != "" {
		query.PermissionUserID = cleanUUIDText(query.PermissionUserID)
		if query.PermissionUserID == "" {
			return ExplorerHierarchyPath{}, ErrInvalid
		}
	}
	if query.CompanyID == "" || query.ResourceID == "" {
		return ExplorerHierarchyPath{}, ErrInvalid
	}
	ctx := query.Context
	if ctx == nil {
		ctx = context.Background()
	}

	exists, err := r.postgresCompanyHierarchyResourceExists(ctx, query.CompanyID, query.ResourceType, query.ResourceID)
	if err != nil {
		return ExplorerHierarchyPath{}, err
	}
	if !exists {
		return ExplorerHierarchyPath{}, ErrNotFound
	}
	visible, err := r.postgresHierarchyResourceVisible(ctx, query.CompanyID, query.ResourceType, query.ResourceID, query.PermissionUserID)
	if err != nil {
		return ExplorerHierarchyPath{}, err
	}
	if !visible {
		return ExplorerHierarchyPath{}, ErrNotFound
	}

	if query.ResourceType == EntityTypeNode {
		segments, resolved, err := r.postgresNodeHierarchyPath(ctx, query)
		if err != nil {
			return ExplorerHierarchyPath{}, err
		}
		if !resolved {
			return omittedExplorerHierarchyPath(ExplorerHierarchyKindCompanyExplorer), nil
		}
		return resolvedExplorerHierarchyPath(ExplorerHierarchyKindCompanyExplorer, segments), nil
	}

	segments, resolved, err := r.postgresCompanyContainerPath(ctx, query.CompanyID, query.ResourceType, query.ResourceID, query.PermissionUserID)
	if err != nil {
		return ExplorerHierarchyPath{}, err
	}
	if !resolved {
		return omittedExplorerHierarchyPath(ExplorerHierarchyKindCompanyExplorer), nil
	}
	return resolvedExplorerHierarchyPath(ExplorerHierarchyKindCompanyExplorer, segments), nil
}

func (r *PostgresRepo) GetHuddleExplorerHierarchyPath(query HuddleExplorerHierarchyPathQuery) (ExplorerHierarchyPath, error) {
	query, err := normalizeHuddleExplorerHierarchyPathQuery(query)
	if err != nil {
		return ExplorerHierarchyPath{}, err
	}
	query.CompanyID = cleanUUIDText(query.CompanyID)
	query.ResourceID = cleanUUIDText(query.ResourceID)
	if query.PermissionUserID != "" {
		query.PermissionUserID = cleanUUIDText(query.PermissionUserID)
		if query.PermissionUserID == "" {
			return ExplorerHierarchyPath{}, ErrInvalid
		}
	}
	if query.CompanyID == "" || query.ResourceID == "" {
		return ExplorerHierarchyPath{}, ErrInvalid
	}
	ctx := query.Context
	if ctx == nil {
		ctx = context.Background()
	}

	exists, err := r.postgresHuddleHierarchyResourceExists(ctx, query.CompanyID, query.ResourceType, query.ResourceID)
	if err != nil {
		return ExplorerHierarchyPath{}, err
	}
	if !exists {
		return ExplorerHierarchyPath{}, ErrNotFound
	}
	visible, err := r.postgresHierarchyResourceVisible(ctx, query.CompanyID, query.ResourceType, query.ResourceID, query.PermissionUserID)
	if err != nil {
		return ExplorerHierarchyPath{}, err
	}
	if !visible {
		return ExplorerHierarchyPath{}, ErrNotFound
	}

	if query.ResourceType == EntityTypeHuddleLogicGate {
		segments, resolved, err := r.postgresHuddleContainerPath(ctx, query.CompanyID, query.ResourceID)
		if err != nil {
			return ExplorerHierarchyPath{}, err
		}
		if !resolved {
			return omittedExplorerHierarchyPath(ExplorerHierarchyKindHuddleExplorer), nil
		}
		return resolvedExplorerHierarchyPath(ExplorerHierarchyKindHuddleExplorer, segments), nil
	}

	var ownerID string
	var ownerName sql.NullString
	err = r.db.QueryRowContext(ctx, `
select node.huddle_logic_gate_id::text, gate.header
from huddle_nodes node
left join huddle_logic_gates gate
  on gate.company_id=node.company_id
 and gate.huddle_logic_gate_id=node.huddle_logic_gate_id
where node.company_id=$1::uuid and node.huddle_node_id=$2::uuid`, query.CompanyID, query.ResourceID).Scan(&ownerID, &ownerName)
	if errors.Is(err, sql.ErrNoRows) {
		return ExplorerHierarchyPath{}, ErrNotFound
	}
	if err != nil {
		return ExplorerHierarchyPath{}, err
	}
	if !ownerName.Valid {
		return omittedExplorerHierarchyPath(ExplorerHierarchyKindHuddleExplorer), nil
	}
	ownerVisible, err := r.postgresHierarchyResourceVisible(ctx, query.CompanyID, EntityTypeHuddleLogicGate, ownerID, query.PermissionUserID)
	if err != nil {
		return ExplorerHierarchyPath{}, err
	}
	if !ownerVisible {
		return omittedExplorerHierarchyPath(ExplorerHierarchyKindHuddleExplorer), nil
	}
	segments, resolved, err := r.postgresHuddleContainerPath(ctx, query.CompanyID, ownerID)
	if err != nil {
		return ExplorerHierarchyPath{}, err
	}
	if !resolved {
		return omittedExplorerHierarchyPath(ExplorerHierarchyKindHuddleExplorer), nil
	}
	segments = append(segments, CompanyExplorerLocationSegment{EntityType: EntityTypeHuddleLogicGate, EntityID: ownerID, ResourceID: ownerID, Name: ownerName.String})
	return resolvedExplorerHierarchyPath(ExplorerHierarchyKindHuddleExplorer, segments), nil
}

func (r *PostgresRepo) postgresNodeHierarchyPath(ctx context.Context, query CompanyExplorerHierarchyPathQuery) ([]CompanyExplorerLocationSegment, bool, error) {
	hasOrganization := false
	var gateID string
	var gateName sql.NullString
	err := r.db.QueryRowContext(ctx, `
select assignment.logic_gate_id::text, gate.header
from node_logic_gate_assignments assignment
left join logic_gates gate
  on gate.company_id=assignment.company_id
 and gate.logic_gate_id=assignment.logic_gate_id
where assignment.company_id=$1::uuid and assignment.node_id=$2::uuid`, query.CompanyID, query.ResourceID).Scan(&gateID, &gateName)
	if err == nil {
		hasOrganization = true
		if gateName.Valid {
			visible, accessErr := r.postgresHierarchyResourceVisible(ctx, query.CompanyID, EntityTypeLogicGate, gateID, query.PermissionUserID)
			if accessErr != nil {
				return nil, false, accessErr
			}
			if visible {
				segments, resolved, pathErr := r.postgresCompanyContainerPath(ctx, query.CompanyID, EntityTypeLogicGate, gateID, query.PermissionUserID)
				if pathErr != nil {
					return nil, false, pathErr
				}
				if resolved {
					return append(segments, CompanyExplorerLocationSegment{EntityType: EntityTypeLogicGate, EntityID: gateID, ResourceID: gateID, Name: gateName.String}), true, nil
				}
			}
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, false, err
	}

	var projectID string
	var projectName sql.NullString
	err = r.db.QueryRowContext(ctx, `
select relationship.project_id::text, project.name
from project_relationships relationship
left join projects project
  on project.company_id=relationship.company_id
 and project.project_id=relationship.project_id
where relationship.company_id=$1::uuid
  and relationship.resource_type='node'
  and relationship.resource_id=$2::uuid
order by relationship.project_id
limit 1`, query.CompanyID, query.ResourceID).Scan(&projectID, &projectName)
	if err == nil {
		hasOrganization = true
		if projectName.Valid {
			visible, accessErr := r.postgresHierarchyResourceVisible(ctx, query.CompanyID, EntityTypeProject, projectID, query.PermissionUserID)
			if accessErr != nil {
				return nil, false, accessErr
			}
			if visible {
				segments, resolved, pathErr := r.postgresCompanyContainerPath(ctx, query.CompanyID, EntityTypeProject, projectID, query.PermissionUserID)
				if pathErr != nil {
					return nil, false, pathErr
				}
				if resolved {
					return append(segments, CompanyExplorerLocationSegment{EntityType: EntityTypeProject, EntityID: projectID, ResourceID: projectID, Name: projectName.String}), true, nil
				}
			}
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, false, err
	}

	if hasOrganization {
		return []CompanyExplorerLocationSegment{}, false, nil
	}
	return []CompanyExplorerLocationSegment{}, true, nil
}

func (r *PostgresRepo) postgresCompanyContainerPath(ctx context.Context, companyID, resourceType, resourceID, permissionUserID string) ([]CompanyExplorerLocationSegment, bool, error) {
	var parentFolderID sql.NullString
	err := r.db.QueryRowContext(ctx, `
select parent_folder_id::text
from company_explorer_items
where company_id=$1::uuid and target_type=$2 and target_id=$3::uuid`, companyID, resourceType, resourceID).Scan(&parentFolderID)
	if errors.Is(err, sql.ErrNoRows) {
		return []CompanyExplorerLocationSegment{}, false, nil
	}
	if err == nil && !parentFolderID.Valid {
		return []CompanyExplorerLocationSegment{}, true, nil
	}
	if err != nil {
		return nil, false, err
	}
	return r.postgresCompanyFolderPath(ctx, companyID, parentFolderID.String, permissionUserID)
}

func (r *PostgresRepo) postgresHuddleContainerPath(ctx context.Context, companyID, huddleLogicGateID string) ([]CompanyExplorerLocationSegment, bool, error) {
	var parentFolderID sql.NullString
	err := r.db.QueryRowContext(ctx, `
select parent_folder_id::text
from huddle_explorer_items
where company_id=$1::uuid
  and huddle_type='huddle_logic_gate'
  and resource_huddle_resource_id=$2::uuid`, companyID, huddleLogicGateID).Scan(&parentFolderID)
	if errors.Is(err, sql.ErrNoRows) {
		return []CompanyExplorerLocationSegment{}, false, nil
	}
	if err == nil && !parentFolderID.Valid {
		return []CompanyExplorerLocationSegment{}, true, nil
	}
	if err != nil {
		return nil, false, err
	}
	return r.postgresHuddleFolderPath(ctx, companyID, parentFolderID.String)
}

func (r *PostgresRepo) postgresCompanyFolderPath(ctx context.Context, companyID, folderID, permissionUserID string) ([]CompanyExplorerLocationSegment, bool, error) {
	rows, err := r.db.QueryContext(ctx, `
with recursive ancestry(folder_id,parent_folder_id,name,depth,path) as (
  select folder.folder_id,folder.parent_folder_id,folder.name,0,array[folder.folder_id]
  from company_explorer_folders folder
  where folder.company_id=$1::uuid and folder.folder_id=$2::uuid
  union all
  select parent.folder_id,parent.parent_folder_id,parent.name,child.depth+1,child.path || parent.folder_id
  from ancestry child
  join company_explorer_folders parent
    on parent.company_id=$1::uuid and parent.folder_id=child.parent_folder_id
  where cardinality(child.path)<$3 and not parent.folder_id=any(child.path)
)
select folder_id::text,parent_folder_id::text,name
from ancestry
order by depth desc`, companyID, folderID, explorerHierarchyMaximumDepth)
	if err != nil {
		return nil, false, err
	}
	segments, complete, err := scanPostgresHierarchyFolders(rows, CompanyExplorerV2EntityFolder)
	if err != nil || !complete {
		return segments, complete, err
	}
	if permissionUserID != "" {
		folderIDs := make([]string, 0, len(segments))
		for _, segment := range segments {
			folderIDs = append(folderIDs, segment.EntityID)
		}
		levels, accessErr := r.effectiveAccessLevelsForUser(ctx, companyID, permissionUserID, EntityTypeCompanyExplorerFolder, folderIDs)
		if accessErr != nil {
			return nil, false, accessErr
		}
		for _, folderID := range folderIDs {
			if EntityPermissionSatisfies(levels[folderID], EntityPermissionEdit) {
				continue
			}
			return []CompanyExplorerLocationSegment{}, false, nil
		}
	}
	return segments, true, nil
}

func (r *PostgresRepo) postgresHuddleFolderPath(ctx context.Context, companyID, folderID string) ([]CompanyExplorerLocationSegment, bool, error) {
	rows, err := r.db.QueryContext(ctx, `
with recursive ancestry(folder_id,parent_folder_id,name,depth,path) as (
  select folder.folder_id,folder.parent_folder_id,folder.name,0,array[folder.folder_id]
  from huddle_explorer_folders folder
  where folder.company_id=$1::uuid and folder.folder_id=$2::uuid
  union all
  select parent.folder_id,parent.parent_folder_id,parent.name,child.depth+1,child.path || parent.folder_id
  from ancestry child
  join huddle_explorer_folders parent
    on parent.company_id=$1::uuid and parent.folder_id=child.parent_folder_id
  where cardinality(child.path)<$3 and not parent.folder_id=any(child.path)
)
select folder_id::text,parent_folder_id::text,name
from ancestry
order by depth desc`, companyID, folderID, explorerHierarchyMaximumDepth)
	if err != nil {
		return nil, false, err
	}
	return scanPostgresHierarchyFolders(rows, HuddleExplorerHierarchyEntityFolder)
}

func scanPostgresHierarchyFolders(rows *sql.Rows, entityType string) ([]CompanyExplorerLocationSegment, bool, error) {
	defer rows.Close()
	segments := make([]CompanyExplorerLocationSegment, 0)
	complete := false
	first := true
	for rows.Next() {
		var folderID, name string
		var parentFolderID sql.NullString
		if err := rows.Scan(&folderID, &parentFolderID, &name); err != nil {
			return nil, false, err
		}
		if first {
			complete = !parentFolderID.Valid
			first = false
		}
		segments = append(segments, CompanyExplorerLocationSegment{EntityType: entityType, EntityID: folderID, Name: name})
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	if first || !complete {
		return []CompanyExplorerLocationSegment{}, false, nil
	}
	return segments, true, nil
}

func (r *PostgresRepo) postgresHierarchyResourceVisible(ctx context.Context, companyID, resourceType, resourceID, permissionUserID string) (bool, error) {
	if permissionUserID == "" {
		return true, nil
	}
	levels, err := r.effectiveAccessLevelsForUser(ctx, companyID, permissionUserID, resourceType, []string{resourceID})
	if err != nil {
		return false, err
	}
	return EntityPermissionSatisfies(levels[resourceID], EntityPermissionEdit), nil
}

func (r *PostgresRepo) postgresCompanyHierarchyResourceExists(ctx context.Context, companyID, resourceType, resourceID string) (bool, error) {
	var query string
	switch resourceType {
	case EntityTypeNode:
		query = `select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)`
	case EntityTypeLogicGate:
		query = `select exists(select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid)`
	case EntityTypeProject:
		query = `select exists(select 1 from projects where company_id=$1::uuid and project_id=$2::uuid)`
	default:
		return false, ErrInvalid
	}
	var exists bool
	err := r.db.QueryRowContext(ctx, query, companyID, resourceID).Scan(&exists)
	return exists, err
}

func (r *PostgresRepo) postgresHuddleHierarchyResourceExists(ctx context.Context, companyID, resourceType, resourceID string) (bool, error) {
	var query string
	switch resourceType {
	case EntityTypeHuddleLogicGate:
		query = `select exists(select 1 from huddle_logic_gates where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid)`
	case EntityTypeHuddleNode:
		query = `select exists(select 1 from huddle_nodes where company_id=$1::uuid and huddle_node_id=$2::uuid)`
	default:
		return false, ErrInvalid
	}
	var exists bool
	err := r.db.QueryRowContext(ctx, query, companyID, resourceID).Scan(&exists)
	return exists, err
}
