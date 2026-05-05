package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *MemoryRepo) UpsertAuthUser(cognitoSubject, email string) (domain.User, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	email = strings.TrimSpace(email)
	if cognitoSubject == "" {
		return domain.User{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	user, ok := r.users[cognitoSubject]
	if !ok {
		user = domain.User{
			UserID:           newUUIDv7String(),
			CognitoSubject:   cognitoSubject,
			Email:            email,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
	} else {
		user.Email = email
		user.UpdatedTimestamp = now
	}
	r.users[cognitoSubject] = user
	return user, nil
}

func (r *MemoryRepo) UserHasCompanyAccess(cognitoSubject, companyID string) (bool, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	companyID = strings.TrimSpace(companyID)
	if cognitoSubject == "" || companyID == "" {
		return false, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	user, ok := r.users[cognitoSubject]
	if !ok {
		return false, nil
	}
	_, ok = r.memberships[membershipKey(companyID, user.UserID)]
	return ok, nil
}

func (r *MemoryRepo) EnsureCompany(companyID, name string) domain.Company {
	companyID = strings.TrimSpace(companyID)
	name = strings.TrimSpace(name)
	if name == "" {
		name = "MangoRTS Dev Company"
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	company, ok := r.companies[companyID]
	if !ok {
		company = domain.Company{
			CompanyID:        companyID,
			Name:             name,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
	} else {
		company.Name = name
		company.UpdatedTimestamp = now
	}
	r.companies[companyID] = company
	return company
}

func (r *MemoryRepo) AddCompanyMembership(cognitoSubject, companyID, role string) (domain.CompanyMembership, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	companyID = strings.TrimSpace(companyID)
	role = strings.TrimSpace(role)
	if role == "" {
		role = "member"
	}
	if cognitoSubject == "" || companyID == "" {
		return domain.CompanyMembership{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	user, ok := r.users[cognitoSubject]
	if !ok {
		return domain.CompanyMembership{}, ErrNotFound
	}
	now := time.Now().UTC()
	membership := domain.CompanyMembership{
		CompanyID:        companyID,
		UserID:           user.UserID,
		Role:             role,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.memberships[membershipKey(companyID, user.UserID)] = membership
	return membership, nil
}
