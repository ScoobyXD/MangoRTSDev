package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

type effectiveAccessExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func replaceEffectiveFactsForSourceTx(ctx context.Context, tx effectiveAccessExecer, companyID, sourceType, sourceID string, facts []domain.EffectiveResourceAccess) error {
	return validatePostgresCompatibilitySourceScope(ctx, tx, companyID, sourceType, sourceID)
}

func deleteEffectiveFactsForSourceTx(ctx context.Context, tx effectiveAccessExecer, companyID, sourceType, sourceID string) error {
	return validatePostgresCompatibilitySourceScope(ctx, tx, companyID, sourceType, sourceID)
}

func replaceEffectiveFactsForResourceSourceTx(ctx context.Context, tx effectiveAccessExecer, companyID, resourceType, resourceID, sourceType string, facts []domain.EffectiveResourceAccess) error {
	return validatePostgresCompatibilityResourceScope(ctx, tx, companyID, resourceType, resourceID)
}

func deleteEffectiveFactsForResourceSourceTx(ctx context.Context, tx effectiveAccessExecer, companyID, resourceType, resourceID, sourceType string) error {
	return validatePostgresCompatibilityResourceScope(ctx, tx, companyID, resourceType, resourceID)
}

func deleteEffectiveFactsForResourceTx(ctx context.Context, tx effectiveAccessExecer, companyID, resourceType, resourceID string) error {
	return validatePostgresCompatibilityResourceScope(ctx, tx, companyID, resourceType, resourceID)
}

func deleteEffectiveFactsForCompanyUserTx(ctx context.Context, tx effectiveAccessExecer, companyID, userID string) error {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if ctx == nil || tx == nil || companyID == "" || userID == "" {
		return ErrInvalid
	}
	return nil
}

func recomputeDirectGrantEffectiveAccessForResourceTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	return validatePostgresCompatibilityResourceScope(ctx, tx, companyID, resourceType, resourceID)
}

func recomputeCompanyAdminEffectiveAccessForUserTx(ctx context.Context, tx *sql.Tx, userID string) error {
	if ctx == nil || tx == nil || cleanUUIDText(userID) == "" {
		return ErrInvalid
	}
	return nil
}

func recomputeCompanyAdminEffectiveAccessForResourceTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	return validatePostgresCompatibilityResourceScope(ctx, tx, companyID, resourceType, resourceID)
}

func recomputeCompanyMemberDefaultEffectiveAccessForResourceTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID string) error {
	return validatePostgresCompatibilityResourceScope(ctx, tx, companyID, resourceType, resourceID)
}

func recomputeCompanyMemberDefaultEffectiveAccessForUserTx(ctx context.Context, tx *sql.Tx, companyID, userID string) error {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	if ctx == nil || tx == nil || companyID == "" || userID == "" {
		return ErrInvalid
	}
	return nil
}

func recomputeNodeAssigneeEffectiveAccessTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) error {
	if _, err := syncResourceGVICEffectiveAssignmentsTx(ctx, tx, companyID, []resourceGVICKey{{companyID: companyID, resourceType: EntityTypeNode, resourceID: nodeID}}); err != nil {
		return err
	}
	return syncPostgresRacioProjectionForNodeTx(ctx, tx, companyID, nodeID)
}

func recomputeLogicGateRaciEffectiveAccessTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	affected, err := postgresAffectedGVICResourceKeysTx(ctx, tx, resourceGVICKey{companyID: companyID, resourceType: EntityTypeLogicGate, resourceID: logicGateID})
	if err != nil {
		return err
	}
	if _, err := syncResourceGVICEffectiveAssignmentsTx(ctx, tx, companyID, affected); err != nil {
		return err
	}
	return syncPostgresRacioProjectionForLogicGateTx(ctx, tx, companyID, logicGateID)
}

func recomputeSharedTriageRaciEffectiveAccessForResourceTx(ctx context.Context, tx *sql.Tx, companyID, folderID string) error {
	return validatePostgresCompatibilityResourceScope(ctx, tx, companyID, EntityTypeSharedTriageFolder, folderID)
}

func recomputeSharedTriageInheritedEffectiveAccessForSubtreeTx(ctx context.Context, tx *sql.Tx, companyID, folderID string) error {
	return validatePostgresCompatibilityResourceScope(ctx, tx, companyID, EntityTypeSharedTriageFolder, folderID)
}

func deleteNodeLogicGateAssignmentsAndRecomputeVisibilityTx(ctx context.Context, tx *sql.Tx, companyID, logicGateID string) error {
	companyID = cleanUUIDText(companyID)
	logicGateID = cleanUUIDText(logicGateID)
	if companyID == "" || logicGateID == "" || ctx == nil || tx == nil {
		return ErrInvalid
	}
	nodeIDs, err := nodeIDsAssignedToLogicGatesTx(ctx, tx, companyID, []string{logicGateID})
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
delete from node_logic_gate_assignments
where company_id=$1::uuid
  and logic_gate_id=$2::uuid`, companyID, logicGateID); err != nil {
		return err
	}
	if err := deleteKanbanBoardProjectionForLogicGateTx(ctx, tx, companyID, logicGateID); err != nil {
		return err
	}
	for _, nodeID := range nodeIDs {
		if _, err := syncResourceGVICEffectiveAssignmentsTx(ctx, tx, companyID, []resourceGVICKey{{companyID: companyID, resourceType: EntityTypeNode, resourceID: nodeID}}); err != nil {
			return err
		}
		if err := syncPostgresRacioProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return err
		}
	}
	return nil
}

func recomputeLogicGateAssignedNodeVisibilityTx(ctx context.Context, tx *sql.Tx, companyID string, logicGateIDs, nodeIDs []string) error {
	companyID = cleanUUIDText(companyID)
	if companyID == "" || ctx == nil || tx == nil {
		return ErrInvalid
	}
	targetNodeIDs := cleanUUIDTextSlice(nodeIDs)
	assignedNodeIDs, err := nodeIDsAssignedToLogicGatesTx(ctx, tx, companyID, logicGateIDs)
	if err != nil {
		return err
	}
	targetNodeIDs = cleanUUIDTextSlice(append(targetNodeIDs, assignedNodeIDs...))
	for _, nodeID := range targetNodeIDs {
		if _, err := syncResourceGVICEffectiveAssignmentsTx(ctx, tx, companyID, []resourceGVICKey{{companyID: companyID, resourceType: EntityTypeNode, resourceID: nodeID}}); err != nil {
			return err
		}
		if err := syncPostgresRacioProjectionForNodeTx(ctx, tx, companyID, nodeID); err != nil {
			return err
		}
	}
	return nil
}

func recomputeGroupDependentEffectiveAccessForCompanyTx(ctx context.Context, tx *sql.Tx, companyID string) error {
	if ctx == nil || tx == nil || cleanUUIDText(companyID) == "" {
		return ErrInvalid
	}
	return syncPostgresGVICForGroupAssignmentsTx(ctx, tx, companyID)
}

func nodeIDsAssignedToLogicGatesTx(ctx context.Context, tx *sql.Tx, companyID string, logicGateIDs []string) ([]string, error) {
	companyID = cleanUUIDText(companyID)
	logicGateIDs = cleanUUIDTextSlice(logicGateIDs)
	if companyID == "" || ctx == nil || tx == nil {
		return nil, ErrInvalid
	}
	if len(logicGateIDs) == 0 {
		return nil, nil
	}
	nodeIDs := []string{}
	for _, logicGateID := range logicGateIDs {
		rows, err := tx.QueryContext(ctx, `
select node_id::text
from node_logic_gate_assignments
where company_id=$1::uuid
  and logic_gate_id=$2::uuid`, companyID, logicGateID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var nodeID string
			if err := rows.Scan(&nodeID); err != nil {
				rows.Close()
				return nil, err
			}
			nodeIDs = append(nodeIDs, nodeID)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	return cleanUUIDTextSlice(nodeIDs), nil
}

func (r *PostgresRepo) UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, accessLevel string) (bool, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || userID == "" || resourceID == "" || !typeOK || !accessOK || EntityPermissionRank(accessLevel) == 0 {
		return false, ErrInvalid
	}
	ctx := context.Background()
	var allowed bool
	err := r.db.QueryRowContext(ctx, `
select mangorts_user_can_access_resource($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text)`,
		companyID, resourceType, resourceID, userID, accessLevel,
	).Scan(&allowed)
	return allowed, err
}

func (r *PostgresRepo) ListEffectiveResourceIDsForUser(companyID, userID, resourceType, accessLevel string, resourceIDs []string) (map[string]bool, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	resourceIDs = cleanUUIDTextSlice(resourceIDs)
	if companyID == "" || userID == "" || !typeOK || !accessOK || EntityPermissionRank(accessLevel) == 0 {
		return nil, ErrInvalid
	}
	if len(resourceIDs) == 0 {
		return map[string]bool{}, nil
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx, `
with requested(resource_id) as (
  select distinct unnest(string_to_array($5, ',')::uuid[])
)
select requested.resource_id::text
from requested
where mangorts_user_can_access_resource($1::uuid, $3::text, requested.resource_id, $2::uuid, $4::text)`,
		companyID, userID, resourceType, accessLevel, strings.Join(resourceIDs, ","))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var resourceID string
		if err := rows.Scan(&resourceID); err != nil {
			return nil, err
		}
		out[resourceID] = true
	}
	return out, rows.Err()
}

func (r *PostgresRepo) effectiveAccessLevelsForUser(ctx context.Context, companyID, userID, resourceType string, resourceIDs []string) (map[string]string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	resourceIDs = cleanUUIDTextSlice(resourceIDs)
	if companyID == "" || userID == "" || !typeOK {
		return nil, ErrInvalid
	}
	out := map[string]string{}
	for _, resourceID := range resourceIDs {
		out[resourceID] = EntityPermissionNoAccess
	}
	if len(resourceIDs) == 0 {
		return out, nil
	}
	rows, err := r.db.QueryContext(ctx, `
with requested(resource_id) as (
  select distinct unnest(string_to_array($4, ',')::uuid[])
), admin_actor as (
  select exists (
    select 1
    from company_memberships membership
    where membership.user_id=$2::uuid
      and (
        membership.role='dev_admin'
        or (membership.company_id=$1::uuid and membership.role='company_admin')
      )
  ) as allowed
)
select requested.resource_id::text,
       case
         when (select allowed from admin_actor) then 'admin'
         when mangorts_user_can_access_resource($1::uuid, $3::text, requested.resource_id, $2::uuid, 'edit') then 'edit'
         when mangorts_user_can_access_resource($1::uuid, $3::text, requested.resource_id, $2::uuid, 'view') then 'view'
         else 'no_access'
       end
from requested`,
		companyID, userID, resourceType, strings.Join(resourceIDs, ","))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var resourceID string
		var accessLevel string
		if err := rows.Scan(&resourceID, &accessLevel); err != nil {
			return nil, err
		}
		out[resourceID] = accessLevel
	}
	return out, rows.Err()
}

func (r *PostgresRepo) ListEffectiveUsersForResource(companyID, resourceType, resourceID, accessLevel string) ([]string, error) {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, typeOK := NormalizeEntityType(resourceType)
	accessLevel, accessOK := NormalizeEntityPermission(accessLevel)
	if companyID == "" || resourceID == "" || !typeOK || !accessOK || EntityPermissionRank(accessLevel) == 0 {
		return nil, ErrInvalid
	}
	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx, `
select distinct membership.user_id::text
from company_memberships membership
where (membership.company_id=$1::uuid or membership.role='dev_admin')
  and mangorts_user_can_access_resource($1::uuid, $2::text, $3::uuid, membership.user_id, $4::text)
order by membership.user_id::text`, companyID, resourceType, resourceID, accessLevel)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	userIDs := []string{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		userIDs = append(userIDs, userID)
	}
	return userIDs, rows.Err()
}

func (r *PostgresRepo) ListEffectiveUsersForWorkspaceEvent(event domain.DomainEvent) ([]string, error) {
	targets := WorkspaceEventAccessTargets(event)
	if len(targets) == 0 {
		return []string{}, nil
	}
	seen := map[string]bool{}
	for _, target := range targets {
		userIDs, err := r.ListEffectiveUsersForResource(event.CompanyID, target.ResourceType, target.ResourceID, EntityPermissionView)
		if err != nil {
			return nil, err
		}
		for _, userID := range userIDs {
			seen[userID] = true
		}
	}
	return sortWorkspaceEventUserIDs(seen), nil
}

func validatePostgresCompatibilitySourceScope(ctx context.Context, tx effectiveAccessExecer, companyID, sourceType, sourceID string) error {
	if ctx == nil || tx == nil || cleanUUIDText(companyID) == "" || strings.TrimSpace(sourceType) == "" || strings.TrimSpace(sourceID) == "" {
		return ErrInvalid
	}
	return nil
}

func validatePostgresCompatibilityResourceScope(ctx context.Context, tx effectiveAccessExecer, companyID, resourceType, resourceID string) error {
	resourceType, typeOK := NormalizeEntityType(resourceType)
	if ctx == nil || tx == nil || cleanUUIDText(companyID) == "" || cleanUUIDText(resourceID) == "" || !typeOK {
		return ErrInvalid
	}
	return nil
}

func cleanUUIDTextSlice(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = cleanUUIDText(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
