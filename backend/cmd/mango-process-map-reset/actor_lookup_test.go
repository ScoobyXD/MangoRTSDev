package main

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestActorEmailLookupRequiresOneSameCompanyDevAdmin(t *testing.T) {
	const email = "jonathankim829@gmail.com"
	adminRow := []driver.Value{testActorID, email, "Jonathan", "dev_admin"}
	memberRow := []driver.Value{testActorID, email, "Jonathan", "company_admin"}
	for _, test := range []struct {
		name string
		rows [][]driver.Value
		want error
	}{
		{"one company dev admin", [][]driver.Value{adminRow}, nil},
		{"missing company member", nil, errActorMissing},
		{"non dev admin", [][]driver.Value{memberRow}, errActorNotAdmin},
		{"ambiguous admins", [][]driver.Value{adminRow, adminRow}, errActorAmbiguous},
		{"ambiguous mixed roles", [][]driver.Value{adminRow, memberRow}, errActorAmbiguous},
	} {
		t.Run(test.name, func(t *testing.T) {
			queried := false
			db := sql.OpenDB(actorTestConnector{query: func(query string, args []driver.NamedValue) (driver.Rows, error) {
				queried = true
				compact := strings.Join(strings.Fields(query), " ")
				for _, required := range []string{
					"join company_memberships membership on membership.user_id=app_user.user_id",
					"membership.company_id=$1::uuid and lower(btrim(app_user.email))=$2", "limit 2",
				} {
					if !strings.Contains(compact, required) {
						t.Fatalf("actor query lost its bounded company/email scope: %s", query)
					}
				}
				if len(args) != 2 || args[0].Value != testCompanyID || args[1].Value != email {
					t.Fatalf("actor lookup scope arguments = %+v", args)
				}
				return &actorTestRows{values: test.rows}, nil
			}})
			defer db.Close()
			actor, err := resolveActorByEmail(context.Background(), db, testCompanyID, email)
			if !queried || !errors.Is(err, test.want) {
				t.Fatalf("actor = %+v, error=%v, want %v", actor, err, test.want)
			}
			if test.want == nil && (actor.UserID != testActorID || actor.Email != email || actor.Role != "dev_admin") {
				t.Fatalf("lookup changed exact resolved identity: %+v", actor)
			}
			if test.want != nil && actor.UserID != "" {
				t.Fatal("failed lookup guessed an actor")
			}
		})
	}
}

// This database/sql driver supplies rows without opening a network connection.
type actorTestConnector struct {
	query func(string, []driver.NamedValue) (driver.Rows, error)
}

func (c actorTestConnector) Connect(context.Context) (driver.Conn, error) {
	return actorTestConn{query: c.query}, nil
}
func (actorTestConnector) Driver() driver.Driver { return actorTestDriver{} }

type actorTestDriver struct{}

func (actorTestDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("unexpected driver open")
}

type actorTestConn struct {
	query func(string, []driver.NamedValue) (driver.Rows, error)
}

func (c actorTestConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return c.query(query, args)
}
func (actorTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepared query")
}
func (actorTestConn) Begin() (driver.Tx, error) {
	return nil, errors.New("actor lookup must be read-only")
}
func (actorTestConn) Close() error { return nil }

type actorTestRows struct {
	values [][]driver.Value
	index  int
}

func (*actorTestRows) Columns() []string { return []string{"user_id", "email", "display_name", "role"} }
func (*actorTestRows) Close() error      { return nil }
func (r *actorTestRows) Next(values []driver.Value) error {
	if r.index == len(r.values) {
		return io.EOF
	}
	copy(values, r.values[r.index])
	r.index++
	return nil
}
