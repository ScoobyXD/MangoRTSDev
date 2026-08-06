package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) ListResourceGVICAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceGVICAssignment, error) {
	policy, err := r.GetResourceGVICPolicy(companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	return policy.GVICAssignments, nil
}

func (r *PostgresRepo) SetResourceGVICAssignments(input ResourceGVICAssignmentUpdateInput) (ResourceGVICAssignmentMutationResult, error) {
	current, err := r.GetResourceGVICPolicy(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	action := PolicyDescendantActionInheritedOnly
	if input.ApplyToDescendants {
		action = PolicyDescendantActionIncludingCustomized
	}
	assignments := append([]ResourceGVICAssignmentInput{}, input.Assignments...)
	policy, events, err := r.PutResourceGVICPolicy(ResourceGVICPolicyUpdateInput{
		CompanyID: input.CompanyID, ResourceType: input.ResourceType, ResourceID: input.ResourceID,
		AssignmentMode: PolicyModeCustomized, Assignments: assignments, DescendantAction: action,
		ExpectedRevision: current.Revision, ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey,
	})
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	return ResourceGVICAssignmentMutationResult{
		CompanyID: policy.CompanyID, ResourceType: policy.ResourceType, ResourceID: policy.ResourceID,
		Operation: GVICAssignmentCommandSet, Changed: true, GVICAssignments: policy.GVICAssignments,
		EffectiveAssignments: policy.EffectiveAssignments, Events: events,
	}, nil
}

func v2GVICAssignmentsForEdit(policy ResourceGVICPolicy) []ResourceGVICAssignmentInput {
	items := []ResourceGVICAssignmentInput{}
	if policy.AssignmentMode == PolicyModeCustomized && policy.OverwrittenByAncestor == nil {
		for _, item := range policy.GVICAssignments {
			items = append(items, ResourceGVICAssignmentInput{Role: item.Role, PrincipalType: item.PrincipalType, PrincipalID: item.PrincipalID})
		}
		return items
	}
	seen := map[string]bool{}
	for _, item := range policy.EffectiveAssignments {
		candidate := ResourceGVICAssignmentInput{Role: item.Role, PrincipalType: item.SourcePrincipalType, PrincipalID: item.SourcePrincipalID}
		keyValue := candidate.Role + ":" + candidate.PrincipalType + ":" + candidate.PrincipalID
		if !seen[keyValue] {
			seen[keyValue] = true
			items = append(items, candidate)
		}
	}
	return items
}

func v2GVICInputSetsEqual(left, right []ResourceGVICAssignmentInput) bool {
	if len(left) != len(right) {
		return false
	}
	keys := map[string]int{}
	for _, item := range left {
		keys[strings.TrimSpace(item.Role)+":"+strings.TrimSpace(item.PrincipalType)+":"+strings.TrimSpace(item.PrincipalID)]++
	}
	for _, item := range right {
		keyValue := strings.TrimSpace(item.Role) + ":" + strings.TrimSpace(item.PrincipalType) + ":" + strings.TrimSpace(item.PrincipalID)
		if keys[keyValue] == 0 {
			return false
		}
		keys[keyValue]--
	}
	return true
}

func unchangedV2GVICMutation(policy ResourceGVICPolicy, operation string) ResourceGVICAssignmentMutationResult {
	return ResourceGVICAssignmentMutationResult{
		CompanyID: policy.CompanyID, ResourceType: policy.ResourceType, ResourceID: policy.ResourceID,
		Operation: operation, Changed: false, GVICAssignments: policy.GVICAssignments,
		EffectiveAssignments: policy.EffectiveAssignments, Events: []domain.DomainEvent{},
	}
}

func (r *PostgresRepo) AddResourceGVICAssignments(input ResourceGVICAssignmentCommandInput) (ResourceGVICAssignmentMutationResult, error) {
	current, err := r.GetResourceGVICPolicy(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	items := v2GVICAssignmentsForEdit(current)
	before := append([]ResourceGVICAssignmentInput{}, items...)
	byPrincipal := map[string]ResourceGVICAssignmentInput{}
	for _, item := range items {
		byPrincipal[item.PrincipalType+":"+item.PrincipalID] = item
	}
	for _, item := range input.Assignments {
		if strings.TrimSpace(item.Role) == domain.GVICRoleGenerated {
			for principalKey, existing := range byPrincipal {
				if existing.Role == domain.GVICRoleGenerated {
					delete(byPrincipal, principalKey)
				}
			}
		}
		byPrincipal[strings.TrimSpace(item.PrincipalType)+":"+strings.TrimSpace(item.PrincipalID)] = item
	}
	items = items[:0]
	for _, item := range byPrincipal {
		items = append(items, item)
	}
	if v2GVICInputSetsEqual(before, items) {
		return unchangedV2GVICMutation(current, GVICAssignmentCommandAdd), nil
	}
	return r.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{CompanyID: input.CompanyID, ResourceType: input.ResourceType, ResourceID: input.ResourceID, Assignments: items, ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey, ApplyToDescendants: input.ApplyToDescendants})
}

func (r *PostgresRepo) RemoveResourceGVICAssignments(input ResourceGVICAssignmentCommandInput) (ResourceGVICAssignmentMutationResult, error) {
	current, err := r.GetResourceGVICPolicy(input.CompanyID, input.ResourceType, input.ResourceID)
	if err != nil {
		return ResourceGVICAssignmentMutationResult{}, err
	}
	remove := map[string]bool{}
	for _, item := range input.Assignments {
		remove[item.Role+":"+item.PrincipalType+":"+item.PrincipalID] = true
	}
	items := []ResourceGVICAssignmentInput{}
	for _, item := range v2GVICAssignmentsForEdit(current) {
		if !remove[item.Role+":"+item.PrincipalType+":"+item.PrincipalID] {
			items = append(items, item)
		}
	}
	if v2GVICInputSetsEqual(v2GVICAssignmentsForEdit(current), items) {
		return unchangedV2GVICMutation(current, GVICAssignmentCommandRemove), nil
	}
	return r.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{CompanyID: input.CompanyID, ResourceType: input.ResourceType, ResourceID: input.ResourceID, Assignments: items, ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey, ApplyToDescendants: input.ApplyToDescendants})
}

func (r *PostgresRepo) ListResourceGVICEffectiveAssignments(companyID, resourceType, resourceID string) ([]domain.ResourceGVICEffectiveAssignment, error) {
	policy, err := r.GetResourceGVICPolicy(companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	return policy.EffectiveAssignments, nil
}

type postgresGVICQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func postgresGVICResourceExists(ctx context.Context, queryer postgresGVICQueryer, keyValue resourceGVICKey) (bool, error) {
	var sqlText string
	switch keyValue.resourceType {
	case EntityTypeNode:
		sqlText = `select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)`
	case EntityTypeLogicGate:
		sqlText = `select exists(select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid)`
	case EntityTypeProject:
		sqlText = `select exists(select 1 from projects where company_id=$1::uuid and project_id=$2::uuid)`
	case EntityTypeCompanyExplorerFolder:
		sqlText = `select exists(select 1 from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid)`
	case EntityTypeSharedInbox:
		sqlText = `select exists(select 1 from shared_inboxes where company_id=$1::uuid and shared_inbox_id=$2::uuid)`
	case EntityTypeSharedInboxFolder:
		sqlText = `select exists(select 1 from shared_inbox_folders where company_id=$1::uuid and folder_id=$2::uuid)`
	default:
		return false, ErrInvalid
	}
	var exists bool
	err := queryer.QueryRowContext(ctx, sqlText, keyValue.companyID, keyValue.resourceID).Scan(&exists)
	return exists, err
}

func validatePostgresGVICPrincipalTx(ctx context.Context, tx *sql.Tx, companyID, principalType, principalID string) error {
	var sqlText string
	switch principalType {
	case EntityPermissionSubjectUser:
		sqlText = `select exists(select 1 from company_memberships where company_id=$1::uuid and user_id=$2::uuid)`
	case EntityPermissionSubjectGroup:
		sqlText = `select exists(select 1 from company_user_groups where company_id=$1::uuid and group_id=$2::uuid)`
	default:
		return ErrInvalid
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, sqlText, companyID, principalID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrPrincipalNotInCompany
	}
	return nil
}

func postgresDirectResourceGVICAssignmentsForResource(ctx context.Context, queryer postgresGVICQueryer, keyValue resourceGVICKey) ([]domain.ResourceGVICAssignment, error) {
	rows, err := queryer.QueryContext(ctx, `
select
  assignment.company_id::text,
  assignment.resource_type,
  assignment.resource_id::text,
  assignment.role,
  assignment.principal_type,
  assignment.principal_id::text,
  coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, '')),
  coalesce(app_user.user_id::text, ''),
  nullif(app_user.display_name, ''),
  nullif(app_user.email, ''),
  assignment.created_timestamp,
  assignment.updated_timestamp
from resource_gvic_assignments assignment
left join users app_user
  on assignment.principal_type='user'
 and app_user.user_id=assignment.principal_id
left join company_user_groups user_group
  on assignment.principal_type='group'
 and user_group.company_id=assignment.company_id
 and user_group.group_id=assignment.principal_id
where assignment.company_id=$1::uuid
  and assignment.resource_type=$2
  and assignment.resource_id=$3::uuid
order by
  case assignment.role
    when 'generated' then 1
    when 'verified' then 2
    when 'consulted' then 3
    when 'informed' then 4
    else 5
  end,
  assignment.principal_type,
  lower(coalesce(nullif(user_group.name, ''), nullif(app_user.display_name, ''), nullif(app_user.email, ''), assignment.principal_id::text)),
  assignment.principal_id::text`, keyValue.companyID, keyValue.resourceType, keyValue.resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ResourceGVICAssignment, 0)
	for rows.Next() {
		var item domain.ResourceGVICAssignment
		var principalName sql.NullString
		var userID sql.NullString
		var displayName sql.NullString
		var email sql.NullString
		if err := rows.Scan(
			&item.CompanyID,
			&item.ResourceType,
			&item.ResourceID,
			&item.Role,
			&item.PrincipalType,
			&item.PrincipalID,
			&principalName,
			&userID,
			&displayName,
			&email,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		if principalName.Valid {
			item.PrincipalName = principalName.String
		}
		if userID.Valid {
			item.UserID = userID.String
		}
		if displayName.Valid {
			item.UserDisplayName = displayName.String
		}
		if email.Valid {
			item.UserEmail = email.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sortResourceGVICAssignments(items)
	return items, nil
}
