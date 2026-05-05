package store

import (
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) UpsertAuthUser(cognitoSubject, email string) (domain.User, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	email = strings.TrimSpace(email)
	if cognitoSubject == "" {
		return domain.User{}, ErrInvalid
	}

	var user domain.User
	err := r.db.QueryRow(
		`insert into users (user_id, cognito_subject, email, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, now(), now())
		 on conflict (cognito_subject) do update set
		   email = excluded.email,
		   updated_timestamp = now()
		 returning user_id, cognito_subject, email, created_timestamp, updated_timestamp`,
		newUUIDv7String(),
		cognitoSubject,
		email,
	).Scan(&user.UserID, &user.CognitoSubject, &user.Email, &user.CreatedTimestamp, &user.UpdatedTimestamp)
	if err != nil {
		return domain.User{}, err
	}
	return user, nil
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
		     and cm.company_id = $2
		 )`,
		cognitoSubject,
		companyID,
	).Scan(&ok)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return ok, err
}
