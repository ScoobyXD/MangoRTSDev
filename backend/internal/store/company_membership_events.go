package store

import (
	"miraeopus/backend/internal/domain"
	"slices"
	"strings"
)

const (
	CompanyMembershipSavedEventType    = "company_membership_saved"
	CompanyMembershipDeletedEventType  = "company_membership_deleted"
	CompanyUserProfileUpdatedEventType = "company_user_profile_updated"
)

func companyMembershipEventInputs(companyIDs []string, eventType, userID string) []DomainEventInput {
	userID = strings.TrimSpace(userID)
	if userID == "" || (eventType != CompanyMembershipSavedEventType && eventType != CompanyMembershipDeletedEventType && eventType != CompanyUserProfileUpdatedEventType) {
		return nil
	}
	cleanCompanyIDs := make([]string, 0, len(companyIDs))
	for _, companyID := range companyIDs {
		companyID = strings.TrimSpace(companyID)
		if companyID == "" || slices.Contains(cleanCompanyIDs, companyID) {
			continue
		}
		cleanCompanyIDs = append(cleanCompanyIDs, companyID)
	}
	slices.Sort(cleanCompanyIDs)
	inputs := make([]DomainEventInput, 0, len(cleanCompanyIDs))
	for _, companyID := range cleanCompanyIDs {
		inputs = append(inputs, workspaceDomainEventInput(companyID, eventType, map[string]any{"user_id": userID}))
	}
	return inputs
}

func memoryUserHasDevAdminMembershipLocked(memberships map[string]domain.CompanyMembership, userID string) bool {
	userID = strings.TrimSpace(userID)
	for _, membership := range memberships {
		if membership.UserID == userID && membership.Role == domain.RoleDevAdmin {
			return true
		}
	}
	return false
}

func memoryMembershipAffectedCompanyIDsLocked(companies map[string]domain.Company, targetCompanyID string, globalAccessChanged bool) []string {
	targetCompanyID = strings.TrimSpace(targetCompanyID)
	if !globalAccessChanged {
		return []string{targetCompanyID}
	}
	companyIDs := make([]string, 0, len(companies))
	for companyID := range companies {
		companyIDs = append(companyIDs, companyID)
	}
	return companyIDs
}

func (r *MemoryRepo) advancePolicyGroupMembershipVersionsLocked(companyIDs []string) {
	if r.workspaceReadVersions == nil {
		r.workspaceReadVersions = map[string]int64{}
	}
	seen := map[string]bool{}
	for _, companyID := range companyIDs {
		companyID = strings.TrimSpace(companyID)
		if companyID == "" || seen[companyID] {
			continue
		}
		seen[companyID] = true
		r.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "policy-group-membership", "")]++
	}
}
