package store

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func openCriticalLogicGateMovePostgresIntegration(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("MANGORTS_CRITICAL_LOGIC_GATE_MOVE_POSTGRES_TEST") != "1" || os.Getenv("DB_NAME") != "mangorts_critical_bugs_test" {
		t.Skip("disposable critical logic gate move PostgreSQL database not configured")
	}
	host := strings.TrimSpace(os.Getenv("DB_HOST"))
	if host != "127.0.0.1" && !strings.EqualFold(host, "localhost") {
		t.Fatalf("refusing non-local disposable database host %q", host)
	}
	dsn := fmt.Sprintf("host=%s port=%s user=%s password='%s' dbname=%s sslmode=%s search_path=public",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"), os.Getenv("DB_SSLMODE"))
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	db := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestPostgresCrossLogicGateMoveSucceedsWithoutEmailRelationship(t *testing.T) {
	db := openCriticalLogicGateMovePostgresIntegration(t)
	repo := NewPostgresRepo(db)
	companyID := newUUIDv7String()
	actorUserID := newUUIDv7String()
	nodeID := newUUIDv7String()
	sourceLogicGateID := newUUIDv7String()
	targetLogicGateID := newUUIDv7String()
	assignmentID := newUUIDv7String()

	setup := []struct {
		query string
		args  []any
	}{
		{"insert into users(user_id,cognito_subject,email,display_name) values($1::uuid,$2,'move-test@example.test','Move Test')", []any{actorUserID, "move-test-" + actorUserID}},
		{"insert into companies(company_id,name) values($1::uuid,'Critical move integration')", []any{companyID}},
		{"insert into company_memberships(company_id,user_id,role) values($1::uuid,$2::uuid,'company_admin')", []any{companyID, actorUserID}},
		{"insert into logic_gates(company_id,logic_gate_id,header,created_timestamp) values($1::uuid,$2::uuid,'Source',now()),($1::uuid,$3::uuid,'Target',now())", []any{companyID, sourceLogicGateID, targetLogicGateID}},
		{"insert into nodes(company_id,node_id,name,priority,created_timestamp) values($1::uuid,$2::uuid,'Move me',1,now())", []any{companyID, nodeID}},
		{"insert into node_logic_gate_assignments(assignment_id,company_id,node_id,logic_gate_id,is_issue,position,placed_by_user_id) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,false,1000,$5::uuid)", []any{assignmentID, companyID, nodeID, sourceLogicGateID, actorUserID}},
	}
	for _, statement := range setup {
		if _, err := db.Exec(statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.Exec("delete from nodes where company_id=$1::uuid", companyID)
		_, _ = db.Exec("delete from logic_gates where company_id=$1::uuid", companyID)
		_, _ = db.Exec("delete from companies where company_id=$1::uuid", companyID)
		_, _ = db.Exec("delete from users where user_id=$1::uuid", actorUserID)
	})

	moved, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID: companyID, LogicGateID: targetLogicGateID, FromLogicGateID: sourceLogicGateID,
		NodeID: nodeID, Status: LogicGateWorkStatusRequested, ActorUserID: actorUserID,
	})
	if err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment: %v", err)
	}
	if moved.Assignment.LogicGateID != targetLogicGateID || nodeWorkStatus(moved.Node) != "Requested" {
		t.Fatalf("moved: %+v", moved)
	}

	var persistedLogicGateID, persistedStatus string
	if err := db.QueryRow("select a.logic_gate_id::text,n.status from node_logic_gate_assignments a join nodes n on n.company_id=a.company_id and n.node_id=a.node_id where a.company_id=$1::uuid and a.node_id=$2::uuid", companyID, nodeID).Scan(&persistedLogicGateID, &persistedStatus); err != nil {
		t.Fatal(err)
	}
	if persistedLogicGateID != targetLogicGateID || persistedStatus != "Requested" {
		t.Fatalf("persisted assignment logic_gate=%q status=%q", persistedLogicGateID, persistedStatus)
	}
}
