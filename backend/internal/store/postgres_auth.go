package store

import (
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *PostgresRepo) UpsertAuthUser(cognitoSubject, email, displayName string) (domain.User, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	email = normalizeEmail(email)
	displayName = strings.TrimSpace(displayName)
	if cognitoSubject == "" {
		return domain.User{}, ErrInvalid
	}

	var user domain.User
	err := r.db.QueryRow(
		`insert into users (user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, now(), now())
		 on conflict (cognito_subject) do update set
		   email = case when excluded.email <> '' then excluded.email else users.email end,
		   display_name = case when excluded.display_name <> '' then excluded.display_name else users.display_name end,
		   updated_timestamp = now()
		 returning user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp`,
		newUUIDv7String(),
		cognitoSubject,
		email,
		displayName,
	).Scan(&user.UserID, &user.CognitoSubject, &user.Email, &user.DisplayName, &user.CreatedTimestamp, &user.UpdatedTimestamp)
	if err != nil {
		return domain.User{}, err
	}
	return user, nil
}

func (r *PostgresRepo) GetAuthUser(cognitoSubject string) (domain.User, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	if cognitoSubject == "" {
		return domain.User{}, ErrInvalid
	}

	var user domain.User
	err := r.db.QueryRow(
		`select user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp
		 from users
		 where cognito_subject = $1`,
		cognitoSubject,
	).Scan(&user.UserID, &user.CognitoSubject, &user.Email, &user.DisplayName, &user.CreatedTimestamp, &user.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.User{}, ErrNotFound
	}
	return user, err
}

func (r *PostgresRepo) GetAuthUserByEmail(email string) (domain.User, error) {
	email = normalizeEmail(email)
	if email == "" {
		return domain.User{}, ErrInvalid
	}

	var user domain.User
	err := r.db.QueryRow(
		`select user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp
		 from users
		 where email = $1`,
		email,
	).Scan(&user.UserID, &user.CognitoSubject, &user.Email, &user.DisplayName, &user.CreatedTimestamp, &user.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.User{}, ErrNotFound
	}
	return user, err
}

func (r *PostgresRepo) ListUserMemberships(userID string) ([]domain.CompanyMembership, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalid
	}

	rows, err := r.db.Query(
		`select cm.company_id, c.name, cm.user_id, cm.role, cm.created_timestamp, cm.updated_timestamp
		 from company_memberships cm
		 join companies c on c.company_id = cm.company_id
		 where cm.user_id = $1
		 order by c.name, cm.company_id`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyMembership, 0)
	for rows.Next() {
		var item domain.CompanyMembership
		if err := rows.Scan(&item.CompanyID, &item.CompanyName, &item.UserID, &item.Role, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) UserHasCompanyAccess(cognitoSubject, companyID string) (bool, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	companyID = strings.TrimSpace(companyID)
	if cognitoSubject == "" || companyID == "" {
		return false, ErrInvalid
	}

	var ok bool
	err := r.db.QueryRow(
		`select exists(
		   select 1
		   from users u
		   join company_memberships cm on cm.user_id = u.user_id
		   where u.cognito_subject = $1
		     and (cm.company_id = $2 or cm.role = 'dev_admin')
		 )`,
		cognitoSubject,
		companyID,
	).Scan(&ok)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return ok, err
}

func (r *PostgresRepo) CreateCompany(name string) (domain.Company, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return domain.Company{}, ErrInvalid
	}

	var company domain.Company
	err := r.db.QueryRow(
		`insert into companies (company_id, name, created_timestamp, updated_timestamp)
		 values ($1, $2, now(), now())
		 returning company_id, name, created_timestamp, updated_timestamp`,
		newUUIDv7String(),
		name,
	).Scan(&company.CompanyID, &company.Name, &company.CreatedTimestamp, &company.UpdatedTimestamp)
	return company, err
}

func (r *PostgresRepo) ListCompanyUsers(companyID string) ([]domain.CompanyUser, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	rows, err := r.db.Query(
		`select cm.company_id, u.user_id, u.cognito_subject, u.email, u.display_name, cm.role, cm.created_timestamp, cm.updated_timestamp
		 from company_memberships cm
		 join users u on u.user_id = cm.user_id
		 where cm.company_id = $1
		 order by coalesce(nullif(u.display_name, ''), u.email), u.user_id`,
		companyID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyUser, 0)
	for rows.Next() {
		var item domain.CompanyUser
		if err := rows.Scan(&item.CompanyID, &item.UserID, &item.CognitoSubject, &item.Email, &item.DisplayName, &item.Role, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CreateInvitation(input CreateInvitationInput) (domain.Invitation, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	email := normalizeEmail(input.Email)
	role, ok := normalizeInvitableRole(input.Role)
	invitedByUserID := strings.TrimSpace(input.InvitedByUserID)
	if companyID == "" || email == "" || invitedByUserID == "" || !ok {
		return domain.Invitation{}, ErrInvalid
	}
	tx, err := r.db.Begin()
	if err != nil {
		return domain.Invitation{}, err
	}
	defer tx.Rollback()
	var companyExists bool
	if err = tx.QueryRow(
		`select exists(
		   select 1
		   from companies
		   where company_id = $1
		 )`,
		companyID,
	).Scan(&companyExists); err != nil {
		return domain.Invitation{}, err
	}
	if !companyExists {
		return domain.Invitation{}, ErrNotFound
	}
	var inviterCanManage bool
	if err = tx.QueryRow(
		`select exists(
		   select 1
		   from company_memberships
		   where user_id = $1
		     and (role = 'dev_admin' or (company_id = $2 and role = 'company_admin'))
		 )`,
		invitedByUserID,
		companyID,
	).Scan(&inviterCanManage); err != nil {
		return domain.Invitation{}, err
	}
	if !inviterCanManage {
		return domain.Invitation{}, ErrInvalid
	}
	var existingUser bool
	if err = tx.QueryRow(
		`select exists(
		   select 1
		   from users
		   where lower(email) = $1
		 )`,
		email,
	).Scan(&existingUser); err != nil {
		return domain.Invitation{}, err
	}
	if existingUser {
		return domain.Invitation{}, ErrAlreadyExists
	}
	token, tokenHash, err := newInvitationToken()
	if err != nil {
		return domain.Invitation{}, err
	}
	ttl := input.ExpiresIn
	if ttl <= 0 {
		ttl = DefaultInvitationTTL
	}

	var invitation domain.Invitation
	if _, err = tx.Exec(
		`update invitations
		 set status = 'revoked',
		     updated_timestamp = now()
		 where company_id = $1
		   and email = $2
		   and status = 'pending'`,
		companyID,
		email,
	); err != nil {
		return domain.Invitation{}, err
	}
	err = tx.QueryRow(
		`insert into invitations (
		   invitation_id, company_id, email, role, token_hash, status,
		   invited_by_user_id, expires_timestamp, created_timestamp, updated_timestamp
		 )
		 values ($1, $2, $3, $4, $5, 'pending', $6, now() + ($7 * interval '1 second'), now(), now())
		 returning invitation_id, company_id, email, role, status, invited_by_user_id,
		   expires_timestamp, created_timestamp, updated_timestamp`,
		newUUIDv7String(),
		companyID,
		email,
		role,
		tokenHash,
		invitedByUserID,
		int64(ttl.Seconds()),
	).Scan(
		&invitation.InvitationID,
		&invitation.CompanyID,
		&invitation.Email,
		&invitation.Role,
		&invitation.Status,
		&invitation.InvitedByUserID,
		&invitation.ExpiresTimestamp,
		&invitation.CreatedTimestamp,
		&invitation.UpdatedTimestamp,
	)
	if err != nil {
		return domain.Invitation{}, err
	}
	if err = tx.QueryRow(`select name from companies where company_id = $1`, companyID).Scan(&invitation.CompanyName); err != nil {
		return domain.Invitation{}, err
	}
	invitation.Token = token
	if err = tx.Commit(); err != nil {
		return domain.Invitation{}, err
	}
	return invitation, nil
}

func (r *PostgresRepo) AcceptInvitation(token, cognitoSubject, email, displayName string) (domain.Invitation, error) {
	token = strings.TrimSpace(token)
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	email = normalizeEmail(email)
	displayName = strings.TrimSpace(displayName)
	if token == "" || cognitoSubject == "" || email == "" || displayName == "" {
		return domain.Invitation{}, ErrInvalid
	}

	tx, err := r.db.Begin()
	if err != nil {
		return domain.Invitation{}, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	var invitation domain.Invitation
	var tokenHash string
	var acceptedBy sql.NullString
	var acceptedAt sql.NullTime
	err = tx.QueryRow(
		`select i.invitation_id, i.company_id, c.name, i.email, i.role, i.status, i.token_hash, i.invited_by_user_id,
		   i.accepted_by_user_id, i.expires_timestamp, i.accepted_timestamp, i.created_timestamp, i.updated_timestamp
		 from invitations i
		 join companies c on c.company_id = i.company_id
		 where i.token_hash = $1
		 for update`,
		invitationTokenHash(token),
	).Scan(
		&invitation.InvitationID,
		&invitation.CompanyID,
		&invitation.CompanyName,
		&invitation.Email,
		&invitation.Role,
		&invitation.Status,
		&tokenHash,
		&invitation.InvitedByUserID,
		&acceptedBy,
		&invitation.ExpiresTimestamp,
		&acceptedAt,
		&invitation.CreatedTimestamp,
		&invitation.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Invitation{}, ErrNotFound
	}
	if err != nil {
		return domain.Invitation{}, err
	}
	if acceptedBy.Valid {
		invitation.AcceptedByUserID = &acceptedBy.String
	}
	if acceptedAt.Valid {
		invitation.AcceptedTimestamp = &acceptedAt.Time
	}
	if invitation.Status != domain.InvitationStatusPending || time.Now().UTC().After(invitation.ExpiresTimestamp) {
		return domain.Invitation{}, ErrNotFound
	}
	if normalizeEmail(invitation.Email) != email {
		return domain.Invitation{}, ErrInvalid
	}

	var user domain.User
	err = tx.QueryRow(
		`insert into users (user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, now(), now())
		 on conflict (cognito_subject) do update set
		   email = case when excluded.email <> '' then excluded.email else users.email end,
		   display_name = case when excluded.display_name <> '' then excluded.display_name else users.display_name end,
		   updated_timestamp = now()
		 returning user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp`,
		newUUIDv7String(),
		cognitoSubject,
		email,
		displayName,
	).Scan(&user.UserID, &user.CognitoSubject, &user.Email, &user.DisplayName, &user.CreatedTimestamp, &user.UpdatedTimestamp)
	if err != nil {
		return domain.Invitation{}, err
	}

	_, err = tx.Exec(
		`insert into company_memberships (company_id, user_id, role, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, now(), now())
		 on conflict (company_id, user_id) do update set
		   role = excluded.role,
		   updated_timestamp = now()`,
		invitation.CompanyID,
		user.UserID,
		invitation.Role,
	)
	if err != nil {
		return domain.Invitation{}, err
	}

	err = tx.QueryRow(
		`update invitations
		 set status = 'accepted',
		     accepted_by_user_id = $2,
		     accepted_timestamp = now(),
		     updated_timestamp = now()
		 where token_hash = $1
		 returning status, accepted_by_user_id, accepted_timestamp, updated_timestamp`,
		tokenHash,
		user.UserID,
	).Scan(&invitation.Status, &acceptedBy, &acceptedAt, &invitation.UpdatedTimestamp)
	if err != nil {
		return domain.Invitation{}, err
	}
	if acceptedBy.Valid {
		invitation.AcceptedByUserID = &acceptedBy.String
	}
	if acceptedAt.Valid {
		invitation.AcceptedTimestamp = &acceptedAt.Time
	}
	if err = tx.Commit(); err != nil {
		return domain.Invitation{}, err
	}
	return invitation, nil
}

func (r *PostgresRepo) CreatePasswordResetCode(input CreatePasswordResetCodeInput) (domain.PasswordResetCode, error) {
	email := normalizeEmail(input.Email)
	if email == "" {
		return domain.PasswordResetCode{}, ErrInvalid
	}
	ttl := input.ExpiresIn
	if ttl <= 0 {
		ttl = DefaultPasswordResetTTL
	}
	code, salt, hash, err := newPasswordResetCode()
	if err != nil {
		return domain.PasswordResetCode{}, err
	}

	tx, err := r.db.Begin()
	if err != nil {
		return domain.PasswordResetCode{}, err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(
		`update password_reset_codes
		 set status = 'revoked',
		     updated_timestamp = now()
		 where email = $1
		   and status = 'pending'`,
		email,
	); err != nil {
		return domain.PasswordResetCode{}, err
	}

	var item domain.PasswordResetCode
	var usedAt sql.NullTime
	err = tx.QueryRow(
		`insert into password_reset_codes (
		   reset_id, email, code_hash, code_salt, status, expires_timestamp, created_timestamp, updated_timestamp
		 )
		 values ($1, $2, $3, $4, 'pending', now() + ($5 * interval '1 second'), now(), now())
		 returning reset_id, email, status, expires_timestamp, used_timestamp, created_timestamp, updated_timestamp`,
		newUUIDv7String(),
		email,
		hash,
		salt,
		int64(ttl.Seconds()),
	).Scan(&item.ResetID, &item.Email, &item.Status, &item.ExpiresTimestamp, &usedAt, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	if err != nil {
		return domain.PasswordResetCode{}, err
	}
	if usedAt.Valid {
		item.UsedTimestamp = &usedAt.Time
	}
	item.Code = code
	if err = tx.Commit(); err != nil {
		return domain.PasswordResetCode{}, err
	}
	return item, nil
}

func (r *PostgresRepo) ConsumePasswordResetCode(email, code string) (domain.PasswordResetCode, error) {
	email = normalizeEmail(email)
	code = strings.TrimSpace(code)
	if email == "" || code == "" {
		return domain.PasswordResetCode{}, ErrInvalid
	}

	tx, err := r.db.Begin()
	if err != nil {
		return domain.PasswordResetCode{}, err
	}
	defer tx.Rollback()

	var item domain.PasswordResetCode
	var codeHash string
	var codeSalt string
	var usedAt sql.NullTime
	err = tx.QueryRow(
		`select reset_id, email, status, code_hash, code_salt, expires_timestamp, used_timestamp,
		   created_timestamp, updated_timestamp
		 from password_reset_codes
		 where email = $1
		   and status = 'pending'
		 order by created_timestamp desc, reset_id desc
		 limit 1
		 for update`,
		email,
	).Scan(
		&item.ResetID,
		&item.Email,
		&item.Status,
		&codeHash,
		&codeSalt,
		&item.ExpiresTimestamp,
		&usedAt,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.PasswordResetCode{}, ErrNotFound
	}
	if err != nil {
		return domain.PasswordResetCode{}, err
	}
	if usedAt.Valid {
		item.UsedTimestamp = &usedAt.Time
	}

	if time.Now().UTC().After(item.ExpiresTimestamp) {
		_, _ = tx.Exec(
			`update password_reset_codes
			 set status = 'revoked',
			     updated_timestamp = now()
			 where reset_id = $1`,
			item.ResetID,
		)
		_ = tx.Commit()
		return domain.PasswordResetCode{}, ErrExpired
	}
	if passwordResetCodeHash(codeSalt, code) != codeHash {
		return domain.PasswordResetCode{}, ErrInvalid
	}

	usedAt = sql.NullTime{}
	err = tx.QueryRow(
		`update password_reset_codes
		 set status = 'used',
		     used_timestamp = now(),
		     updated_timestamp = now()
		 where reset_id = $1
		 returning status, used_timestamp, updated_timestamp`,
		item.ResetID,
	).Scan(&item.Status, &usedAt, &item.UpdatedTimestamp)
	if err != nil {
		return domain.PasswordResetCode{}, err
	}
	if usedAt.Valid {
		item.UsedTimestamp = &usedAt.Time
	}
	if err = tx.Commit(); err != nil {
		return domain.PasswordResetCode{}, err
	}
	return item, nil
}

func (r *PostgresRepo) ListResourceAssignments(query ResourceAssignmentQuery) ([]domain.ResourceAssignment, error) {
	companyID := strings.TrimSpace(query.CompanyID)
	resourceType := strings.TrimSpace(query.ResourceType)
	resourceID := strings.TrimSpace(query.ResourceID)
	userID := strings.TrimSpace(query.UserID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	rows, err := r.db.Query(
		`select company_id, resource_type, resource_id, user_id, assigned_by_user_id, created_timestamp, updated_timestamp
		 from resource_assignments
		 where company_id = $1
		   and ($2 = '' or resource_type = $2)
		   and ($3 = '' or resource_id = $3)
		   and ($4 = '' or user_id = $4)
		 order by resource_type, resource_id, user_id`,
		companyID,
		resourceType,
		resourceID,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.ResourceAssignment, 0)
	for rows.Next() {
		var item domain.ResourceAssignment
		if err := rows.Scan(&item.CompanyID, &item.ResourceType, &item.ResourceID, &item.UserID, &item.AssignedByUserID, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) AssignResource(input ResourceAssignmentInput) (domain.ResourceAssignment, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	resourceType, ok := normalizeResourceType(input.ResourceType)
	resourceID := strings.TrimSpace(input.ResourceID)
	userID := strings.TrimSpace(input.UserID)
	assignedByUserID := strings.TrimSpace(input.AssignedByUserID)
	if companyID == "" || !ok || resourceID == "" || userID == "" || assignedByUserID == "" {
		return domain.ResourceAssignment{}, ErrInvalid
	}

	var assignment domain.ResourceAssignment
	err := r.db.QueryRow(
		`insert into resource_assignments (
		   company_id, resource_type, resource_id, user_id, assigned_by_user_id, created_timestamp, updated_timestamp
		 )
		 values ($1, $2, $3, $4, $5, now(), now())
		 on conflict (company_id, resource_type, resource_id, user_id) do update set
		   assigned_by_user_id = excluded.assigned_by_user_id,
		   updated_timestamp = now()
		 returning company_id, resource_type, resource_id, user_id, assigned_by_user_id, created_timestamp, updated_timestamp`,
		companyID,
		resourceType,
		resourceID,
		userID,
		assignedByUserID,
	).Scan(&assignment.CompanyID, &assignment.ResourceType, &assignment.ResourceID, &assignment.UserID, &assignment.AssignedByUserID, &assignment.CreatedTimestamp, &assignment.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ResourceAssignment{}, ErrNotFound
	}
	return assignment, err
}

func (r *PostgresRepo) UnassignResource(companyID, resourceType, resourceID, userID string) error {
	companyID = strings.TrimSpace(companyID)
	resourceType, ok := normalizeResourceType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || !ok || resourceID == "" || userID == "" {
		return ErrInvalid
	}

	res, err := r.db.Exec(
		`delete from resource_assignments
		 where company_id = $1
		   and resource_type = $2
		   and resource_id = $3
		   and user_id = $4`,
		companyID,
		resourceType,
		resourceID,
		userID,
	)
	if err != nil {
		return err
	}
	if rows, err := res.RowsAffected(); err == nil && rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepo) UserHasResourceAssignment(companyID, userID, resourceType, resourceID string) (bool, error) {
	companyID = strings.TrimSpace(companyID)
	resourceType, ok := normalizeResourceType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || !ok || resourceID == "" || userID == "" {
		return false, ErrInvalid
	}

	var exists bool
	err := r.db.QueryRow(
		`select exists(
		   select 1
		   from resource_assignments
		   where company_id = $1
		     and user_id = $2
		     and resource_type = $3
		     and resource_id = $4
		 )`,
		companyID,
		userID,
		resourceType,
		resourceID,
	).Scan(&exists)
	return exists, err
}
