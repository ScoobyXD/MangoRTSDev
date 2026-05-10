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
		`with input(cognito_subject, email, display_name) as (
		   values ($2::text, $3::text, $4::text)
		 ), upsert as (
		   insert into users (user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp)
		   select $1, cognito_subject, email, display_name, now(), now()
		   from input
		   on conflict (cognito_subject) do update set
		     email = case when excluded.email <> '' then excluded.email else users.email end,
		     display_name = case when excluded.display_name <> '' then excluded.display_name else users.display_name end,
		     updated_timestamp = now()
		   where users.email is distinct from case when excluded.email <> '' then excluded.email else users.email end
		      or users.display_name is distinct from case when excluded.display_name <> '' then excluded.display_name else users.display_name end
		   returning user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp
		 )
		 select user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp
		 from upsert
		 union all
		 select u.user_id, u.cognito_subject, u.email, u.display_name, u.created_timestamp, u.updated_timestamp
		 from users u
		 join input i on i.cognito_subject = u.cognito_subject
		 where not exists (select 1 from upsert)`,
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

func (r *PostgresRepo) ListCompanies(query string, limit int) ([]domain.Company, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	limit = NormalizeCompanyListLimit(limit)

	rows, err := r.db.Query(
		`select company_id, name, created_timestamp, updated_timestamp
		 from companies
		 where $1 = ''
		    or lower(name) like '%' || $1 || '%'
		    or company_id::text like '%' || $1 || '%'
		 order by lower(name), company_id
		 limit $2`,
		query,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.Company, 0)
	for rows.Next() {
		var item domain.Company
		if err := rows.Scan(&item.CompanyID, &item.Name, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
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

func (r *PostgresRepo) GetCompanyUser(companyID, userID string) (domain.CompanyUser, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return domain.CompanyUser{}, ErrInvalid
	}

	var item domain.CompanyUser
	err := r.db.QueryRow(
		`select cm.company_id, u.user_id, u.cognito_subject, u.email, u.display_name, cm.role, cm.created_timestamp, cm.updated_timestamp
		 from company_memberships cm
		 join users u on u.user_id = cm.user_id
		 where cm.company_id = $1
		   and u.user_id = $2`,
		companyID,
		userID,
	).Scan(&item.CompanyID, &item.UserID, &item.CognitoSubject, &item.Email, &item.DisplayName, &item.Role, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyUser{}, ErrNotFound
	}
	return item, err
}

func (r *PostgresRepo) DeleteCompanyUser(companyID, userID string) (DeleteCompanyUserResult, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return DeleteCompanyUserResult{}, ErrInvalid
	}

	tx, err := r.db.Begin()
	if err != nil {
		return DeleteCompanyUserResult{}, err
	}
	defer tx.Rollback()

	var item domain.CompanyUser
	err = tx.QueryRow(
		`select cm.company_id, u.user_id, u.cognito_subject, u.email, u.display_name, cm.role, cm.created_timestamp, cm.updated_timestamp
		 from company_memberships cm
		 join users u on u.user_id = cm.user_id
		 where cm.company_id = $1
		   and u.user_id = $2
		 for update of cm, u`,
		companyID,
		userID,
	).Scan(&item.CompanyID, &item.UserID, &item.CognitoSubject, &item.Email, &item.DisplayName, &item.Role, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return DeleteCompanyUserResult{}, ErrNotFound
	}
	if err != nil {
		return DeleteCompanyUserResult{}, err
	}

	if _, err = tx.Exec(`update nodes set assignee_user_id = null where company_id = $1 and assignee_user_id = $2`, companyID, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if _, err = tx.Exec(`delete from company_memberships where company_id = $1 and user_id = $2`, companyID, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}

	var hasRemainingMembership bool
	if err = tx.QueryRow(`select exists(select 1 from company_memberships where user_id = $1)`, userID).Scan(&hasRemainingMembership); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if !hasRemainingMembership {
		if _, err = tx.Exec(
			`insert into auth_external_identity_deletions
			 (provider, external_subject, user_id, email, status, attempts, last_error, created_timestamp, updated_timestamp)
			 values ('cognito', $1, $2, $3, 'pending', 0, '', now(), now())
			 on conflict (provider, external_subject) do update set
			   user_id=excluded.user_id,
			   email=excluded.email,
			   status='pending',
			   last_error='',
			   updated_timestamp=now(),
			   completed_timestamp=null`,
			item.CognitoSubject,
			userID,
			normalizeEmail(item.Email),
		); err != nil {
			return DeleteCompanyUserResult{}, err
		}
		if _, err = tx.Exec(
			`delete from invitations
			 where ($1 <> '' and email = $1)
			    or invited_by_user_id = $2
			    or accepted_by_user_id = $2`,
			normalizeEmail(item.Email),
			userID,
		); err != nil {
			return DeleteCompanyUserResult{}, err
		}
		if _, err = tx.Exec(`delete from user_email_connections where user_id = $1`, userID); err != nil {
			return DeleteCompanyUserResult{}, err
		}
		if _, err = tx.Exec(`update nodes set assignee_user_id = null where assignee_user_id = $1`, userID); err != nil {
			return DeleteCompanyUserResult{}, err
		}
		if _, err = tx.Exec(`delete from users where user_id = $1`, userID); err != nil {
			return DeleteCompanyUserResult{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	return DeleteCompanyUserResult{User: item, DeleteExternalIdentity: !hasRemainingMembership}, nil
}

func (r *PostgresRepo) CompleteExternalIdentityDeletion(cognitoSubject string) error {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	if cognitoSubject == "" {
		return ErrInvalid
	}
	_, err := r.db.Exec(
		`update auth_external_identity_deletions
		 set status='completed', last_error='', updated_timestamp=now(), completed_timestamp=now()
		 where provider='cognito' and external_subject=$1`,
		cognitoSubject,
	)
	return err
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
	var existingCompanyUser bool
	if err = tx.QueryRow(
		`select exists(
		   select 1
		   from users u
		   join company_memberships cm on cm.user_id = u.user_id
		   where lower(u.email) = $1
		     and cm.company_id = $2
		 )`,
		email,
		companyID,
	).Scan(&existingCompanyUser); err != nil {
		return domain.Invitation{}, err
	}
	if existingCompanyUser {
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

func (r *PostgresRepo) ValidateInvitationToken(token string) (domain.Invitation, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return domain.Invitation{}, ErrInvalid
	}

	var invitation domain.Invitation
	var acceptedBy sql.NullString
	var acceptedAt sql.NullTime
	err := r.db.QueryRow(
		`select i.invitation_id, i.company_id, c.name, i.email, i.role, i.status, i.invited_by_user_id,
		   i.accepted_by_user_id, i.expires_timestamp, i.accepted_timestamp, i.created_timestamp, i.updated_timestamp
		 from invitations i
		 join companies c on c.company_id = i.company_id
		 where i.token_hash = $1`,
		invitationTokenHash(token),
	).Scan(
		&invitation.InvitationID,
		&invitation.CompanyID,
		&invitation.CompanyName,
		&invitation.Email,
		&invitation.Role,
		&invitation.Status,
		&invitation.InvitedByUserID,
		&acceptedBy,
		&invitation.ExpiresTimestamp,
		&acceptedAt,
		&invitation.CreatedTimestamp,
		&invitation.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Invitation{}, ErrInvitationBadToken
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
	if err := invitationAvailabilityError(invitation, time.Now().UTC()); err != nil {
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
		return domain.Invitation{}, ErrInvitationBadToken
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
	if stateErr := invitationAvailabilityError(invitation, time.Now().UTC()); stateErr != nil {
		err = stateErr
		return domain.Invitation{}, stateErr
	}
	if normalizeEmail(invitation.Email) != email {
		err = ErrInvitationEmailMismatch
		return domain.Invitation{}, err
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
